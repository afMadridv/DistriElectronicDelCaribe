/* ============================================================
   Lógica de la aplicación: login, navegación, formularios
   dinámicos, vista previa, historial y gestión de usuarios.
   ============================================================ */
(function () {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  /* ---------- estado ---------- */
  let currentFormat = null;   // clave del formato activo
  let editingRecord = null;   // registro en edición (null = nuevo)
  let formImages = {};        // { fieldKey: [url|dataURL, ...] }
  let signatures = {};        // { fieldKey: { canvas, drawn, existing } }
  let previewTimer = null;
  let formDirty = false;      // cambios sin guardar en el formulario

  /* ---------- helpers UI ---------- */
  function toast(msg, type = "ok") {
    const el = $("#toast");
    el.textContent = msg;
    el.className = `toast ${type}`;
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.add("hidden"), 2600);
  }

  function showConfirm(title, text, okLabel = "Eliminar") {
    return new Promise((resolve) => {
      $("#confirm-title").textContent = title;
      $("#confirm-text").textContent = text;
      $("#confirm-ok").textContent = okLabel;
      const modal = $("#confirm-modal");
      modal.classList.remove("hidden");
      const done = (val) => {
        modal.classList.add("hidden");
        $("#confirm-ok").onclick = null;
        modal.querySelector("[data-close-modal]").onclick = null;
        resolve(val);
      };
      $("#confirm-ok").onclick = () => done(true);
      modal.querySelector("[data-close-modal]").onclick = () => done(false);
    });
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /* ============================================================
     ARRANQUE Y SESIÓN
     ============================================================ */
  async function boot() {
    if (Store.isDemo) $("#demo-hint").classList.remove("hidden");
    let profile = null;
    try { profile = await Store.init(); }
    catch (e) { console.error(e); }
    if (profile) enterApp(profile);
    else $("#view-login").classList.remove("hidden");
  }

  function enterApp(profile) {
    $("#view-login").classList.add("hidden");
    $("#app").classList.remove("hidden");
    $("#user-name").textContent = profile.name;
    $("#user-role").textContent = profile.role;
    $("#user-avatar").textContent = (profile.name || "?").trim().charAt(0).toUpperCase();
    $("#nav-usuarios").classList.toggle("hidden", profile.role !== "jefe");
    renderFormatPicker();
    switchView("generar");
  }

  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#login-btn");
    const err = $("#login-error");
    err.classList.add("hidden");
    btn.disabled = true;
    btn.textContent = "Ingresando…";
    try {
      const profile = await Store.login(
        $("#login-email").value.trim(),
        $("#login-password").value,
        $("#login-keep").checked
      );
      enterApp(profile);
    } catch (ex) {
      err.textContent = ex.message || "No fue posible iniciar sesión.";
      err.classList.remove("hidden");
    } finally {
      btn.disabled = false;
      btn.textContent = "Ingresar";
    }
  });

  $("#logout-btn").addEventListener("click", async () => {
    const ok = await showConfirm("Cerrar sesión", "¿Seguro que deseas salir del portal?", "Cerrar sesión");
    if (!ok) return;
    await Store.logout();
    location.reload();
  });

  /* aviso nativo al recargar o cerrar la pestaña con cambios sin guardar */
  window.addEventListener("beforeunload", (e) => {
    if (formDirty && !$("#form-wrap").classList.contains("hidden")) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  /* modal propio para navegación interna con cambios sin guardar */
  function guardExit(proceed) {
    if (!formDirty || $("#form-wrap").classList.contains("hidden")) { proceed(); return; }
    const modal = $("#exit-modal");
    modal.classList.remove("hidden");
    const close = () => {
      modal.classList.add("hidden");
      $("#exit-save").onclick = $("#exit-discard").onclick = null;
      modal.querySelector("[data-close-modal]").onclick = null;
    };
    $("#exit-save").onclick = async () => {
      const ok = await saveCotizacion(false);
      close();
      if (ok) proceed();
    };
    $("#exit-discard").onclick = () => { formDirty = false; close(); proceed(); };
    modal.querySelector("[data-close-modal]").onclick = close;
  }

  /* ============================================================
     NAVEGACIÓN
     ============================================================ */
  function switchView(view) {
    $$(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
    ["generar", "historial", "usuarios"].forEach((v) =>
      $(`#view-${v}`).classList.toggle("hidden", v !== view));
    if (view === "historial") renderHistorial();
    if (view === "usuarios") renderUsers();
  }

  $$(".nav-item").forEach((b) => b.addEventListener("click", () => guardExit(() => switchView(b.dataset.view))));

  /* ============================================================
     GENERAR — selector de formato
     ============================================================ */
  function renderFormatPicker() {
    const grid = $("#format-picker");
    grid.innerHTML = Object.entries(FORMATS).map(([key, f]) => `
      <button class="format-card" data-format="${key}">
        <div class="fc-icon">${f.icon}</div>
        <h3>${f.name}</h3>
      </button>`).join("");
    grid.querySelectorAll(".format-card").forEach((c) =>
      c.addEventListener("click", () => openForm(c.dataset.format, null)));
  }

  $("#back-to-formats").addEventListener("click", () => {
    guardExit(() => {
      $("#form-wrap").classList.add("hidden");
      $("#format-picker").classList.remove("hidden");
      editingRecord = null;
    });
  });

  /* ============================================================
     GENERAR — formulario dinámico
     ============================================================ */
  function openForm(formatKey, record) {
    currentFormat = formatKey;
    editingRecord = record;
    formImages = {};
    signatures = {};
    const format = FORMATS[formatKey];
    const data = record ? record.data : {};

    $("#format-picker").classList.add("hidden");
    $("#form-wrap").classList.remove("hidden");
    $("#current-format-name").textContent = (record ? `Editando ${record.numero} — ` : "") + format.name;
    $("#generate-btn-label").textContent = record ? "Guardar cambios y descargar PDF" : "Generar PDF";
    $("#save-status").textContent = "";

    const form = $("#dynamic-form");
    form.innerHTML = "";
    let rowOpen = null;

    const closeRow = () => { rowOpen = null; };
    const container = (half) => {
      if (half) {
        if (!rowOpen) {
          rowOpen = document.createElement("div");
          rowOpen.className = "form-row";
          form.appendChild(rowOpen);
        }
        const target = rowOpen;
        if (target.children.length >= 1) rowOpen = null; // la fila se llena con 2
        return target;
      }
      closeRow();
      return form;
    };

    for (const f of format.fields) {
      if (f.section) {
        closeRow();
        const h = document.createElement("div");
        h.className = "form-section-title";
        h.textContent = f.section;
        form.appendChild(h);
        continue;
      }
      const val = data[f.key];
      switch (f.type) {
        case "text": case "number": case "date": {
          const label = document.createElement("label");
          label.className = "field";
          label.innerHTML = `<span>${f.label}${f.required ? " *" : ""}</span>
            <input type="${f.type}" id="f-${f.key}" ${f.required ? "required" : ""}
              placeholder="${escapeHtml(f.placeholder || "")}" value="${escapeHtml(val || "")}" />`;
          container(f.half).appendChild(label);
          break;
        }
        case "select": {
          const label = document.createElement("label");
          label.className = "field";
          label.innerHTML = `<span>${f.label}</span>
            <select id="f-${f.key}">
              <option value="">— Seleccionar —</option>
              ${f.options.map((o) => `<option ${o === val ? "selected" : ""}>${o}</option>`).join("")}
            </select>`;
          container(f.half).appendChild(label);
          break;
        }
        case "textarea": {
          const label = document.createElement("label");
          label.className = "field";
          label.innerHTML = `<span>${f.label}${f.required ? " *" : ""}</span>
            <textarea id="f-${f.key}" ${f.required ? "required" : ""}>${escapeHtml(val || "")}</textarea>`;
          container(false).appendChild(label);
          break;
        }
        case "items":
          container(false).appendChild(buildItemsField(f, val));
          break;
        case "checklist":
          container(false).appendChild(buildChecklistField(f, val));
          break;
        case "images":
          // los registros anteriores guardaban solo la ruta: se normalizan
          formImages[f.key] = (Array.isArray(val) ? val : [])
            .map((v) => (v && typeof v === "object") ? { src: v.src, desc: v.desc || "" } : { src: v, desc: "" })
            .filter((v) => v.src);
          container(false).appendChild(buildImagesField(f));
          break;
        case "signature":
          container(false).appendChild(buildSignatureField(f, val));
          break;
      }
    }

    // fecha por defecto hoy
    const fechaInput = $("#f-fecha");
    if (fechaInput && !fechaInput.value) fechaInput.value = new Date().toISOString().slice(0, 10);

    form.addEventListener("input", schedulePreview);
    formDirty = false;
    $("#preview-panel").classList.add("hidden");
    $("#pdf-preview").removeAttribute("src");
    $("#view-generar").scrollIntoView({ behavior: "smooth", block: "start" });
    switchView("generar");
  }

  /* ----- campo: tabla de ítems ----- */
  function buildItemsField(f, val) {
    const bancos = f.withBank ? (f.maxBancos || 4) : 0;
    const wrap = document.createElement("div");
    wrap.className = "field";
    wrap.dataset.itemsKey = f.key;
    wrap.dataset.withPrice = f.withPrice ? "1" : "";
    wrap.innerHTML = `
      ${f.withBank ? `<p class="field-hint">Elige el banco de cada batería. La numeración se reinicia en cada banco y va sola.</p>` : ""}
      <table class="items-table">
        <thead><tr>
          ${f.withBank ? '<th class="col-banco">Banco</th>' : ""}
          <th class="col-cant">${escapeHtml(f.colCant || "Cant.")}</th><th>${escapeHtml(f.colDesc || "Descripción")}</th>
          ${f.withPrice ? '<th class="col-precio">Vr. unitario</th>' : ""}
          <th class="col-del"></th>
        </tr></thead>
        <tbody></tbody>
      </table>
      ${f.withPrice ? '<div class="items-total"></div>' : ""}
      <button type="button" class="btn btn-ghost btn-sm add-row-btn">+ Agregar fila</button>`;

    const tbody = wrap.querySelector("tbody");

    /* con autoNum el número no se escribe: se calcula por posición, y en las
       tablas por banco se reinicia en cada uno (1, 2, 3… por banco) */
    function renumerar() {
      if (!f.autoNum) return;
      const cuenta = {};
      tbody.querySelectorAll("tr").forEach((tr) => {
        const b = f.withBank ? (tr.querySelector(".it-banco").value || "1") : "1";
        cuenta[b] = (cuenta[b] || 0) + 1;
        tr.querySelector(".it-cant").value = cuenta[b];
      });
    }

    function addRow(item = {}) {
      const tr = document.createElement("tr");
      const opciones = Array.from({ length: bancos }, (_, i) =>
        `<option value="${i + 1}" ${String(item.banco || 1) === String(i + 1) ? "selected" : ""}>${i + 1}</option>`).join("");
      tr.innerHTML = `
        ${f.withBank ? `<td class="col-banco"><select class="it-banco">${opciones}</select></td>` : ""}
        <td class="col-cant"><input type="number" min="1" class="it-cant" value="${escapeHtml(item.cant || 1)}"
          ${f.autoNum ? "readonly tabindex='-1'" : ""} /></td>
        <td><input type="text" class="it-desc" value="${escapeHtml(item.descripcion || "")}" placeholder="${escapeHtml(f.placeholderDesc || f.colDesc || "Descripción")}" /></td>
        ${f.withPrice ? `<td class="col-precio"><input type="number" min="0" class="it-precio" value="${escapeHtml(item.precio ?? "")}" placeholder="0" /></td>` : ""}
        <td class="col-del"><button type="button" class="row-del" title="Quitar">×</button></td>`;
      tr.querySelector(".row-del").addEventListener("click", () => {
        tr.remove();
        renumerar();
        updateTotal();
        schedulePreview();
      });
      const selBanco = tr.querySelector(".it-banco");
      if (selBanco) selBanco.addEventListener("change", () => { renumerar(); schedulePreview(); });
      tbody.appendChild(tr);
    }

    function updateTotal() {
      if (!f.withPrice) return;
      let sub = 0;
      tbody.querySelectorAll("tr").forEach((tr) => {
        sub += (Number(tr.querySelector(".it-cant").value) || 0) * (Number(tr.querySelector(".it-precio").value) || 0);
      });
      wrap.querySelector(".items-total").textContent =
        "Subtotal: $ " + sub.toLocaleString("es-CO", { maximumFractionDigits: 0 });
    }
    wrap.addEventListener("input", updateTotal);

    const items = Array.isArray(val) && val.length ? val : [{}];
    items.forEach(addRow);
    renumerar();
    updateTotal();
    wrap.querySelector(".add-row-btn").addEventListener("click", () => {
      addRow();
      renumerar();
      schedulePreview();
    });
    return wrap;
  }

  /* ----- campo: checklist ----- */
  function buildChecklistField(f, val) {
    const data = val || {};
    const wrap = document.createElement("div");
    wrap.className = "field checklist";
    wrap.dataset.checklistKey = f.key;
    wrap.innerHTML = f.rows.map((r) => `
      <div class="chk-row">
        <span class="chk-label">${escapeHtml(r.label)}</span>
        <select data-chk-row="${r.key}">
          <option value="">—</option>
          ${f.options.map((o) => `<option ${o === data[r.key] ? "selected" : ""}>${escapeHtml(o)}</option>`).join("")}
        </select>
      </div>`).join("");
    return wrap;
  }

  /* ----- campo: imágenes ----- */
  function buildImagesField(f) {
    const wrap = document.createElement("div");
    wrap.className = "field";
    wrap.innerHTML = `
      <span>${f.label}</span>
      <p class="field-hint">Van 6 fotos por página, numeradas. La descripción sale como «Figura N.» debajo de cada una.</p>
      <div class="img-thumbs"></div>
      <div class="img-drop"><span class="drop-icon">${window.ICONS.camera}</span> Haz clic para agregar imágenes (se comprimen automáticamente)</div>
      <input type="file" accept="image/*" multiple class="hidden img-input" />`;

    const thumbs = wrap.querySelector(".img-thumbs");
    const input = wrap.querySelector(".img-input");

    function renderThumbs() {
      thumbs.innerHTML = "";
      formImages[f.key].forEach((foto, i) => {
        const t = document.createElement("div");
        t.className = "img-thumb";

        const img = document.createElement("img");
        // el valor guardado es una ruta del bucket privado: hay que firmarla
        Store.imageUrl(foto.src).then((u) => { img.src = u; }).catch(() => {});

        const del = document.createElement("button");
        del.type = "button";
        del.className = "thumb-del";
        del.textContent = "×";
        del.addEventListener("click", () => {
          formImages[f.key].splice(i, 1);
          renderThumbs();
          schedulePreview();
        });

        const num = document.createElement("span");
        num.className = "thumb-num";
        num.textContent = `Figura ${i + 1}`;

        const desc = document.createElement("input");
        desc.type = "text";
        desc.className = "thumb-desc";
        desc.maxLength = 90;
        desc.placeholder = "Descripción de la foto";
        desc.value = foto.desc || "";
        desc.addEventListener("input", () => {
          formImages[f.key][i].desc = desc.value;
          schedulePreview();
        });

        t.append(img, del, num, desc);
        thumbs.appendChild(t);
      });
    }

    wrap.querySelector(".img-drop").addEventListener("click", () => input.click());
    input.addEventListener("change", async () => {
      for (const file of input.files) {
        try {
          const dataURL = await Store.compressImage(file);
          formImages[f.key].push({ src: dataURL, desc: "" });
        } catch { toast("No se pudo leer una imagen.", "error"); }
      }
      input.value = "";
      renderThumbs();
      schedulePreview();
    });

    renderThumbs();
    return wrap;
  }

  /* ----- campo: firma ----- */
  function buildSignatureField(f, existing) {
    const wrap = document.createElement("div");
    wrap.className = "field";
    wrap.innerHTML = `
      <span>${f.label}</span>
      <canvas class="sig-canvas" width="600" height="180"></canvas>
      <div class="sig-actions"><button type="button" class="btn btn-ghost btn-sm sig-clear">Limpiar firma</button></div>`;

    const canvas = wrap.querySelector("canvas");
    const ctx = canvas.getContext("2d");
    // fondo transparente: así la firma no tapa el texto del PDF
    ctx.strokeStyle = "#141414";
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const state = { canvas, drawn: false, existing: existing || null };
    signatures[f.key] = state;

    if (existing) {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        state.drawn = true;
      };
      img.src = existing;
    }

    let drawing = false;
    const pos = (e) => {
      const r = canvas.getBoundingClientRect();
      return {
        x: ((e.clientX - r.left) / r.width) * canvas.width,
        y: ((e.clientY - r.top) / r.height) * canvas.height,
      };
    };
    canvas.addEventListener("pointerdown", (e) => {
      drawing = true;
      canvas.setPointerCapture(e.pointerId);
      const p = pos(e);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!drawing) return;
      const p = pos(e);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      state.drawn = true;
    });
    const stop = () => {
      if (drawing) { drawing = false; schedulePreview(); }
    };
    canvas.addEventListener("pointerup", stop);
    canvas.addEventListener("pointerleave", stop);

    wrap.querySelector(".sig-clear").addEventListener("click", () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      state.drawn = false;
      state.existing = null;
      schedulePreview();
    });
    return wrap;
  }

  /* ============================================================
     RECOLECCIÓN DE DATOS + PREVIEW + GUARDADO
     ============================================================ */
  /* recorta el canvas al área realmente dibujada (solo el trazo, sin lienzo vacío) */
  function cropSignature(canvas) {
    const ctx = canvas.getContext("2d");
    const { width, height } = canvas;
    const px = ctx.getImageData(0, 0, width, height).data;
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (px[(y * width + x) * 4 + 3] > 10) { // alfa > 10 = hay trazo
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null; // nada dibujado
    const pad = 6;
    minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
    maxX = Math.min(width - 1, maxX + pad); maxY = Math.min(height - 1, maxY + pad);
    const out = document.createElement("canvas");
    out.width = maxX - minX + 1;
    out.height = maxY - minY + 1;
    out.getContext("2d").drawImage(canvas, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
    return out.toDataURL("image/png");
  }

  function collectData() {
    const format = FORMATS[currentFormat];
    const data = {};
    for (const f of format.fields) {
      if (f.section) continue;
      switch (f.type) {
        case "text": case "number": case "date": case "select": case "textarea": {
          const el = $(`#f-${f.key}`);
          if (el) data[f.key] = el.value.trim();
          break;
        }
        case "items": {
          const wrap = document.querySelector(`[data-items-key="${f.key}"]`);
          const rows = [];
          wrap.querySelectorAll("tbody tr").forEach((tr) => {
            const item = {
              cant: tr.querySelector(".it-cant").value,
              descripcion: tr.querySelector(".it-desc").value.trim(),
            };
            const banco = tr.querySelector(".it-banco");
            if (banco) item.banco = Number(banco.value) || 1;
            const precio = tr.querySelector(".it-precio");
            if (precio) item.precio = precio.value;
            if (item.descripcion) rows.push(item);
          });
          data[f.key] = rows;
          break;
        }
        case "checklist": {
          const wrap = document.querySelector(`[data-checklist-key="${f.key}"]`);
          const obj = {};
          wrap.querySelectorAll("[data-chk-row]").forEach((sel) => {
            if (sel.value) obj[sel.dataset.chkRow] = sel.value;
          });
          data[f.key] = obj;
          break;
        }
        case "images":
          data[f.key] = [...(formImages[f.key] || [])];
          break;
        case "signature": {
          const s = signatures[f.key];
          data[f.key] = s && s.drawn ? cropSignature(s.canvas) : null;
          break;
        }
      }
    }
    return data;
  }

  /* ya no refresca en vivo: solo marca cambios pendientes.
     La vista previa se genera a demanda con el botón "Vista previa". */
  function schedulePreview() {
    formDirty = true;
  }

  /* Chrome de Android no trae visor de PDF dentro de un iframe: la vista
     previa salía en blanco en el celular. Ahí se abre en otra pestaña. */
  const sinVisorPDF = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  let urlPreview = null;

  async function refreshPreview() {
    if (!currentFormat) return;
    $("#preview-panel").classList.remove("hidden");
    const aviso = $("#preview-aviso");
    try {
      const record = await Store.hydrateImages({
        numero: editingRecord ? editingRecord.numero : `${FORMATS[currentFormat].prefix}-BORRADOR`,
        data: collectData(),
      });
      urlPreview = await PDFGen.previewDataURL(currentFormat, record);
      $("#open-preview").classList.remove("hidden");
      if (sinVisorPDF) {
        $("#pdf-preview").classList.add("hidden");
        aviso.textContent = "Tu navegador no muestra el PDF aquí dentro. Pulsa «Abrir en otra pestaña».";
        aviso.classList.remove("hidden");
        window.open(urlPreview, "_blank");
      } else {
        $("#pdf-preview").classList.remove("hidden");
        $("#pdf-preview").src = urlPreview;
        aviso.classList.add("hidden");
      }
    } catch (e) {
      console.error("preview:", e);
      aviso.textContent = "No se pudo generar la vista previa: " + (e.message || "");
      aviso.classList.remove("hidden");
      toast("No se pudo generar la vista previa.", "error");
    }
  }
  $("#open-preview").addEventListener("click", () => {
    if (urlPreview) window.open(urlPreview, "_blank");
  });
  $("#refresh-preview").addEventListener("click", refreshPreview);

  $("#preview-btn").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await refreshPreview();
      $("#preview-panel").scrollIntoView({ behavior: "smooth", block: "nearest" });
    } finally { btn.disabled = false; }
  });

  $("#generate-btn").addEventListener("click", () => saveCotizacion(true));

  /* Antes de descargar se propone un nombre y se deja cambiarlo. */
  function pedirNombre(formatKey, record) {
    const base = `${FORMATS[formatKey].name} - ${record.numero || ""}`.trim();
    const r = window.prompt("Nombre del archivo PDF:", base);
    if (r === null) return base;          // cancelar = deja el nombre propuesto
    return r.trim() || base;
  }

  /* guarda la cotización; download=false para "guardar y salir" */
  async function saveCotizacion(download = true) {
    const format = FORMATS[currentFormat];
    // valida requeridos
    for (const f of format.fields) {
      if (f.required && !f.section) {
        const el = $(`#f-${f.key}`);
        if (el && !el.value.trim()) {
          el.focus();
          el.reportValidity ? el.reportValidity() : null;
          toast(`Completa el campo: ${f.label}`, "error");
          return false;
        }
      }
    }

    const btn = $("#generate-btn");
    btn.disabled = true;
    $("#save-status").textContent = "Guardando…";
    try {
      const data = collectData();

      // sube imágenes nuevas (dataURL) al almacenamiento
      for (const f of format.fields) {
        if (f.type === "images" && Array.isArray(data[f.key])) {
          data[f.key] = await Promise.all(data[f.key].map(async (foto) => ({
            src: String(foto.src).startsWith("data:") ? await Store.uploadImage(foto.src) : foto.src,
            desc: foto.desc || "",
          })));
        }
      }

      let record;
      if (editingRecord) {
        record = await Store.updateCotizacion(editingRecord.id, data);
        editingRecord = record;
      } else {
        const numero = await Store.nextNumber(format.prefix);
        record = await Store.createCotizacion({ numero, format_type: currentFormat, data });
        editingRecord = record;
        $("#current-format-name").textContent = `Editando ${record.numero} — ${format.name}`;
        $("#generate-btn-label").textContent = "Guardar cambios y descargar PDF";
      }

      if (download) {
        const rec = await Store.hydrateImages(record);
        await PDFGen.download(currentFormat, rec, pedirNombre(currentFormat, rec));
      }
      formDirty = false;
      $("#save-status").textContent = "✓ Guardado en el historial";
      toast(download ? `PDF ${record.numero} generado y guardado.` : `Cotización ${record.numero} guardada.`);
      return true;
    } catch (e) {
      console.error(e);
      $("#save-status").textContent = "";
      toast(e.message || "Error al generar el PDF.", "error");
      return false;
    } finally {
      btn.disabled = false;
    }
  }

  /* ============================================================
     HISTORIAL
     ============================================================ */
  let historialCache = [];

  async function renderHistorial() {
    const list = $("#historial-list");
    list.innerHTML = '<div class="empty-state">Cargando…</div>';
    try {
      historialCache = await Store.listCotizaciones();
    } catch (e) {
      list.innerHTML = '<div class="empty-state">Error al cargar el historial.</div>';
      return;
    }
    drawHistorial();
  }

  function drawHistorial() {
    const q = $("#search-historial").value.trim().toLowerCase();
    const list = $("#historial-list");
    const isJefe = Store.getProfile().role === "jefe";
    const rows = historialCache.filter((c) => {
      if (!q) return true;
      const fmt = FORMATS[c.format_type];
      return [c.numero, c.cliente, fmt?.name, c.owner_name]
        .some((s) => (s || "").toLowerCase().includes(q));
    });

    if (!rows.length) {
      list.innerHTML = `<div class="empty-state"><div class="es-icon">${window.ICONS.folder}</div>
        ${q ? "Sin resultados para la búsqueda." : "Aún no hay cotizaciones. Genera la primera desde «Generar Cotización»."}</div>`;
      return;
    }

    list.innerHTML = rows.map((c) => {
      const fmt = FORMATS[c.format_type] || { icon: window.ICONS.folder, name: c.format_type };
      const fecha = new Date(c.updated_at).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" });
      return `
      <div class="hist-card" data-id="${c.id}">
        <div class="hist-icon">${fmt.icon}</div>
        <div class="hist-info">
          <strong>${escapeHtml(c.cliente || "Sin cliente")}</strong>
          <small>${fmt.name} · ${fecha}${isJefe && c.owner_name ? " · " + escapeHtml(c.owner_name) : ""}</small>
        </div>
        <span class="hist-num">${escapeHtml(c.numero)}</span>
        <div class="hist-actions">
          <button class="btn btn-primary btn-sm" data-act="edit">Editar</button>
          <button class="btn btn-ghost btn-sm" data-act="pdf">PDF</button>
          <button class="icon-btn danger" data-act="del" title="Eliminar">${window.ICONS.trash}</button>
        </div>
      </div>`;
    }).join("");

    list.querySelectorAll(".hist-card").forEach((card) => {
      const id = card.dataset.id;
      card.querySelector('[data-act="edit"]').addEventListener("click", async () => {
        const rec = await Store.getCotizacion(id);
        if (rec && FORMATS[rec.format_type]) openForm(rec.format_type, rec);
        else toast("Este registro usa un formato que ya no existe.", "error");
      });
      card.querySelector('[data-act="pdf"]').addEventListener("click", async (e) => {
        e.target.disabled = true;
        try {
          const rec = await Store.getCotizacion(id);
          const listo = await Store.hydrateImages(rec);
          await PDFGen.download(rec.format_type, listo, pedirNombre(rec.format_type, listo));
        } catch (ex) {
          toast(ex.message || "No se pudo generar el PDF.", "error");
        } finally { e.target.disabled = false; }
      });
      card.querySelector('[data-act="del"]').addEventListener("click", async () => {
        const rec = historialCache.find((c) => c.id === id);
        const ok = await showConfirm("Eliminar cotización",
          `Se eliminará ${rec.numero} (${rec.cliente || "sin cliente"}) junto con sus fotos. Esta acción no se puede deshacer.`);
        if (!ok) return;
        try {
          await Store.deleteCotizacion(id);
          toast("Cotización eliminada.");
          renderHistorial();
        } catch (e) { toast(e.message || "Error al eliminar.", "error"); }
      });
    });
  }

  $("#search-historial").addEventListener("input", drawHistorial);

  /* ============================================================
     USUARIOS (solo jefe)
     ============================================================ */
  let editingUserId = null;

  async function renderUsers() {
    const list = $("#users-list");
    list.innerHTML = '<div class="empty-state">Cargando…</div>';
    let users;
    try { users = await Store.listUsers(); }
    catch (e) {
      list.innerHTML = `<div class="empty-state">Error al cargar usuarios.<br><small>${escapeHtml(e.message || "")}</small></div>`;
      return;
    }
    const me = Store.getProfile();
    list.innerHTML = users.map((u) => `
      <div class="user-card" data-id="${u.id}">
        <div class="user-avatar">${escapeHtml((u.name || "?").charAt(0).toUpperCase())}</div>
        <div class="uc-info">
          <strong>${escapeHtml(u.name)}${u.id === me.id ? " (tú)" : ""}</strong>
          <small>${escapeHtml(u.email)}</small>
          <span class="role-tag ${u.role}">${u.role}</span>
        </div>
        <div class="uc-actions">
          <button class="icon-btn" data-act="edit" title="Editar">${window.ICONS.edit}</button>
          ${u.id !== me.id ? `<button class="icon-btn danger" data-act="del" title="Eliminar">${window.ICONS.trash}</button>` : ""}
        </div>
      </div>`).join("");

    list.querySelectorAll(".user-card").forEach((card) => {
      const id = card.dataset.id;
      const u = users.find((x) => x.id === id);
      card.querySelector('[data-act="edit"]').addEventListener("click", () => openUserModal(u));
      const delBtn = card.querySelector('[data-act="del"]');
      if (delBtn) delBtn.addEventListener("click", async () => {
        const ok = await showConfirm("Eliminar usuario",
          `Se eliminará el acceso de ${u.name} (${u.email}). Sus cotizaciones se conservan y quedan visibles solo para los Jefes.`);
        if (!ok) return;
        try {
          await Store.deleteUser(id);
          toast("Usuario eliminado.");
          renderUsers();
        } catch (e) { toast(e.message || "Error al eliminar.", "error"); }
      });
    });
  }

  function openUserModal(user) {
    editingUserId = user ? user.id : null;
    $("#user-modal-title").textContent = user ? "Editar usuario" : "Nuevo trabajador";
    $("#uf-name").value = user ? user.name : "";
    $("#uf-email").value = user ? user.email : "";
    $("#uf-password").value = "";
    $("#uf-password").required = !user;
    $("#uf-password").placeholder = user ? "Dejar vacío para no cambiarla" : "Mínimo 6 caracteres";
    $("#uf-role").value = user ? user.role : "trabajador";
    $("#user-form-error").classList.add("hidden");
    $("#user-modal").classList.remove("hidden");
  }

  $("#new-user-btn").addEventListener("click", () => openUserModal(null));
  $("#user-modal [data-close-modal]").addEventListener("click", () => $("#user-modal").classList.add("hidden"));

  $("#user-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      name: $("#uf-name").value.trim(),
      email: Store.normalizeEmail($("#uf-email").value.trim()),
      password: $("#uf-password").value,
      role: $("#uf-role").value,
    };
    const err = $("#user-form-error");
    err.classList.add("hidden");
    try {
      if (editingUserId) await Store.updateUser(editingUserId, payload);
      else await Store.createUser(payload);
      $("#user-modal").classList.add("hidden");
      toast(editingUserId ? "Usuario actualizado." : "Trabajador creado.");
      renderUsers();
    } catch (ex) {
      err.textContent = ex.message || "Error al guardar el usuario.";
      err.classList.remove("hidden");
    }
  });

  /* ---------- go ---------- */
  boot();
})();
