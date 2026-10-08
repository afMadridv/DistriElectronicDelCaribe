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
  let signatures = {};        // { fieldKey: pad de firma (ver crearPadFirma) }
  let previewTimer = null;
  let formDirty = false;      // cambios sin guardar en el formulario

  /* ---------- helpers UI ---------- */
  function toast(msg, type = "ok") {
    const el = $("#toast");
    el.textContent = msg;
    el.className = `toast ${type}`;
    clearTimeout(el._t);
    // los errores se quedan más tiempo: en 2,6 s no alcanzaban a leerse
    el._t = setTimeout(() => el.classList.add("hidden"), type === "error" ? 8000 : 2600);
  }

  /* fetch solo dice «Failed to fetch» (Chrome), «Load failed» (Safari) o
     «NetworkError…» (Firefox) cuando la petición ni siquiera llegó. */
  function esErrorDeRed(e) {
    return /failed to fetch|load failed|networkerror|network request failed/i
      .test(String((e && e.message) || e || ""));
  }

  function mensajeError(e) {
    if (esErrorDeRed(e)) return "no hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.";
    return (e && e.message) || "error desconocido.";
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

  /* Jefe y Administrador gestionan el portal: usuarios, auditoría, llamadas */
  const esGestor = Store.esGestor;
  const ROLES = { trabajador: "Trabajador", jefe: "Jefe", administrador: "Administrador" };
  const rolTexto = (r) => ROLES[r] || r;
  const VISTAS = { generar: "Generando formatos", historial: "En el historial", usuarios: "Gestionando usuarios" };

  /* ============================================================
     ARRANQUE Y SESIÓN
     ============================================================ */
  async function boot() {
    if (Store.isDemo) $("#demo-hint").classList.remove("hidden");
    if (location.protocol === "file:") {
      const aviso = document.createElement("div");
      aviso.className = "aviso-archivo";
      aviso.textContent = "Abriste el portal como archivo (doble clic en index.html). Así el navegador " +
        "no deja cargar las plantillas y al guardar sale «Failed to fetch». Ábrelo desde su dirección web.";
      document.body.prepend(aviso);
    }
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
    $("#user-role").textContent = rolTexto(profile.role);
    $("#user-avatar").textContent = (profile.name || "?").trim().charAt(0).toUpperCase();
    $("#nav-usuarios").classList.toggle("hidden", !esGestor(profile));
    renderFormatPicker();
    switchView("generar");
    vigilarAlmacenamiento();
    iniciarTiempoReal(profile);
  }

  /* Presencia, notificaciones, llamadas y auditoría de inicio de sesión.
     Nada de esto bloquea la entrada: si falla, el portal sigue normal. */
  async function iniciarTiempoReal(p) {
    const disp = Dispositivo.info();
    Tiempo.unirsePortal({
      uid: p.id, nombre: p.name, rol: p.role,
      dispositivo: `${disp.tipo} · ${disp.navegador}`, vista: VISTAS.generar, desde: Date.now(),
    });
    NotificationService.iniciar(p);
    Llamadas.iniciar(p);

    // abierto desde un acceso directo del ícono o desde una notificación
    const inicio = PWA.parametrosInicio();
    if (inicio.registro) abrirRegistro(inicio.registro);
    else if (inicio.vista && VISTAS[inicio.vista] && (inicio.vista !== "usuarios" || esGestor(p))) switchView(inicio.vista);
    if (p.sinConexion) toast("Sin conexión: entraste con tu última sesión. Para guardar necesitas internet.", "error");

    let reg = { nuevo: false, otros: 0 };
    try { reg = await Store.registrarDispositivo(disp); }
    catch (e) { console.debug("dispositivo:", e.message); }

    // el Administrador ve cuándo entra cada trabajador (una vez por sesión del navegador)
    const clave = `dec_ingreso:${p.id}`;
    if (!sessionStorage.getItem(clave)) {
      sessionStorage.setItem(clave, "1");
      NotificationService.registrar("ingreso", { detalle: { ...disp, nuevo: reg.nuevo } });
    }
    // alerta de seguridad en los otros equipos de un Jefe/Administrador
    if (esGestor(p) && reg.nuevo && reg.otros > 0) {
      Store.registrarEvento("nuevo_dispositivo", { detalle: disp }).catch((e) => console.debug("seguridad:", e.message));
    }
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
    const enLlamada = Llamadas.enLlamada();
    const ok = await showConfirm("Cerrar sesión",
      enLlamada ? "Tienes una llamada en curso: si sales, se corta. ¿Cerrar sesión de todos modos?"
        : "¿Seguro que deseas salir del portal?", "Cerrar sesión");
    if (!ok) return;
    Colaboracion.salir();
    Llamadas.detener();
    await NotificationService.cerrarSesion().catch(() => {});
    Tiempo.salirTodo();
    await Store.logout();
    location.reload();
  });

  /* aviso nativo al recargar o cerrar la pestaña con cambios sin guardar
     o con una llamada en curso */
  window.addEventListener("beforeunload", (e) => {
    if ((formDirty && !$("#form-wrap").classList.contains("hidden")) || Llamadas.enLlamada()) {
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
    $$(".nav-item[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
    ["generar", "historial", "usuarios"].forEach((v) =>
      $(`#view-${v}`).classList.toggle("hidden", v !== view));
    if (view === "historial") renderHistorial();
    if (view === "usuarios") renderUsers();
    // los Jefes ven en qué parte del portal está cada quien (lista de llamadas)
    if (view !== "generar" || $("#form-wrap").classList.contains("hidden")) Tiempo.actualizarPortal({ vista: VISTAS[view] });
  }

  $$(".nav-item[data-view]").forEach((b) => b.addEventListener("click", () => {
    abrirMenuCelular(false);
    guardExit(() => switchView(b.dataset.view));
  }));

  /* Acciones que piden las notificaciones (botón «Abrir», clic en la
     notificación del sistema, enlaces ?registro= del push) */
  async function abrirRegistro(id) {
    try {
      const rec = await Store.getCotizacion(id);
      if (rec && FORMATS[rec.format_type]) openForm(rec.format_type, rec);
      else toast("Ese registro ya no existe o no tienes acceso.", "error");
    } catch (e) { toast(`No se pudo abrir el registro: ${mensajeError(e)}`, "error"); }
  }
  window.App = {
    irA: (vista) => { abrirMenuCelular(false); guardExit(() => switchView(vista)); },
    abrirRegistro: (id) => guardExit(() => abrirRegistro(id)),
    editarMiCuenta: () => {
      const me = Store.getProfile();
      if (!me || !esGestor(me)) return;
      guardExit(async () => {
        switchView("usuarios");
        const users = await Store.listUsers().catch(() => []);
        const yo = users.find((u) => u.id === me.id);
        if (yo) openUserModal(yo, users);
      });
    },
  };

  /* ============================================================
     MENÚ LATERAL
     En computador y tablet se oculta con las flechas de arriba y
     queda una franja con los íconos (más espacio para el formato).
     En el celular vive escondido y se abre desde la barra superior.
     ============================================================ */
  const enCelular = window.matchMedia("(max-width: 760px)");
  const CLAVE_MENU = "dec_menu_mini";

  function leerMenuMini() {
    try {
      const v = localStorage.getItem(CLAVE_MENU);
      if (v !== null) return v === "1";
    } catch { /* sin almacenamiento local: se usa el valor por defecto */ }
    // sin preferencia guardada, en tablet arranca oculto para dar espacio al formulario
    return window.matchMedia("(max-width: 1024px)").matches;
  }
  let menuMini = leerMenuMini();

  function aplicarMenu() {
    $("#app").classList.toggle("sidebar-mini", !enCelular.matches && menuMini);
    const texto = enCelular.matches ? "Cerrar menú" : menuMini ? "Mostrar menú" : "Ocultar menú";
    const t = $("#sidebar-toggle");
    t.title = texto;
    t.setAttribute("aria-label", texto);
  }

  function abrirMenuCelular(abrir) {
    $("#app").classList.toggle("menu-abierto", abrir);
    $("#menu-open").setAttribute("aria-expanded", String(abrir));
    document.body.classList.toggle("sin-scroll", abrir);
  }

  $("#sidebar-toggle").addEventListener("click", () => {
    if (enCelular.matches) { abrirMenuCelular(false); return; }
    menuMini = !menuMini;
    try { localStorage.setItem(CLAVE_MENU, menuMini ? "1" : "0"); } catch { /* sin almacenamiento local */ }
    aplicarMenu();
  });
  $("#menu-open").addEventListener("click", () => abrirMenuCelular(true));
  $("#sidebar-backdrop").addEventListener("click", () => abrirMenuCelular(false));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") abrirMenuCelular(false); });
  const alCambiarTamano = () => { abrirMenuCelular(false); aplicarMenu(); };
  if (enCelular.addEventListener) enCelular.addEventListener("change", alCambiarTamano);
  else enCelular.addListener(alCambiarTamano); // Safari < 14
  aplicarMenu();

  /* ============================================================
     ALMACENAMIENTO DEL SERVIDOR (barra del menú, solo Jefes)
     Se consulta al entrar, cada minuto mientras la pestaña está a
     la vista y después de guardar o borrar algo.
     ============================================================ */
  const PLAN = Object.assign({ ARCHIVOS_MB: 1024, BASE_DATOS_MB: 500 }, (window.APP_CONFIG || {}).PLAN || {});
  const MB = 1048576;
  let relojAlmacenamiento = null;

  function tamano(bytes) {
    const mb = bytes / MB;
    if (mb >= 1024) return (mb / 1024).toLocaleString("es-CO", { maximumFractionDigits: 2 }) + " GB";
    return mb.toLocaleString("es-CO", { maximumFractionDigits: mb < 10 ? 1 : 0 }) + " MB";
  }

  function pintarBarra(id, bytes, cupoMB) {
    const pct = Math.min(100, (bytes / (cupoMB * MB)) * 100);
    const barra = $(`#${id}`);
    // un mínimo visible: con poco uso la barra no se ve vacía
    barra.querySelector(".storage-fill").style.width = (bytes > 0 ? Math.max(pct, 2) : 0) + "%";
    barra.classList.toggle("alto", pct >= 80 && pct < 95);
    barra.classList.toggle("lleno", pct >= 95);
    barra.setAttribute("aria-valuenow", pct.toFixed(0));
    $(`#${id}-txt`).textContent = `${tamano(bytes)} de ${tamano(cupoMB * MB)}`;
  }

  async function actualizarAlmacenamiento() {
    const w = $("#storage-widget");
    const perfil = Store.getProfile();
    if (!esGestor(perfil)) { w.classList.add("hidden"); return; }
    w.classList.remove("hidden");
    w.classList.add("cargando");
    const msg = $("#storage-msg");
    try {
      const u = await Store.storageUsage();
      pintarBarra("st-files", Number(u.archivos) || 0, PLAN.ARCHIVOS_MB);
      pintarBarra("st-db", Number(u.base_datos) || 0, PLAN.BASE_DATOS_MB);
      msg.classList.add("hidden");
      const hora = new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
      w.title = `${u.cantidad ?? 0} archivos guardados · actualizado a las ${hora}`;
    } catch (e) {
      console.warn("almacenamiento:", e);
      msg.textContent = esErrorDeRed(e) ? "Sin conexión con el servidor." : (e.message || "No disponible.");
      msg.classList.remove("hidden");
    } finally {
      w.classList.remove("cargando");
    }
  }

  function vigilarAlmacenamiento() {
    clearInterval(relojAlmacenamiento);
    actualizarAlmacenamiento();
    relojAlmacenamiento = setInterval(() => {
      if (document.visibilityState === "visible") actualizarAlmacenamiento();
    }, 60000);
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Store.getProfile()) actualizarAlmacenamiento();
  });
  $("#storage-refresh").addEventListener("click", actualizarAlmacenamiento);

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
      Colaboracion.salir();
      $("#form-wrap").classList.add("hidden");
      $("#format-picker").classList.remove("hidden");
      editingRecord = null;
      currentFormat = null;
      Tiempo.actualizarPortal({ vista: VISTAS.generar });
    });
  });

  /* ============================================================
     CAMPOS: leer, escribir y avisar cambios
     Lo usan el guardado, la edición en conjunto y la auditoría.
     ============================================================ */
  let itemsCtl = {};          // tablas: { campo: { poner(filas) } }
  let fotosCtl = {};          // fotos: { campo: { pintar() } }
  let calculadores = {};      // campo origen → [recalcular, …]
  let firmasTocadas = new Set();
  let aviseEdicion = false;   // «empezó a editar» se registra una sola vez

  const campoDef = (clave) => currentFormat && FORMATS[currentFormat].fields.find((f) => f.key === clave);

  /* valor de un campo; crudo=true deja las filas vacías de las tablas
     (para que la otra persona vea la fila nueva antes de que se escriba) */
  function valorCampo(f, crudo = false) {
    switch (f.type) {
      case "text": case "number": case "date": case "select": case "textarea": {
        const el = $(`#f-${f.key}`);
        return el ? (crudo ? el.value : el.value.trim()) : "";
      }
      case "items": {
        const wrap = document.querySelector(`[data-items-key="${f.key}"]`);
        const rows = [];
        wrap.querySelectorAll("tbody tr").forEach((tr) => {
          const item = { cant: tr.querySelector(".it-cant").value };
          if (f.medidas) {
            // solo el número; la unidad la pone el PDF
            tr.querySelectorAll(".it-med").forEach((el) => { item[el.dataset.med] = el.value.trim(); });
          } else {
            item.descripcion = tr.querySelector(".it-desc").value.trim();
          }
          const banco = tr.querySelector(".it-banco");
          if (banco) item.banco = Number(banco.value) || 1;
          const precio = tr.querySelector(".it-precio");
          if (precio) item.precio = precio.value;
          const lleno = f.medidas ? f.medidas.some((m) => item[m.key]) : item.descripcion;
          if (lleno || crudo) rows.push(item);
        });
        return rows;
      }
      case "checklist": {
        const wrap = document.querySelector(`[data-checklist-key="${f.key}"]`);
        const obj = {};
        wrap.querySelectorAll("[data-chk-row]").forEach((sel) => {
          if (sel.value) obj[sel.dataset.chkRow] = sel.value;
        });
        return obj;
      }
      case "images":
        return [...(formImages[f.key] || [])];
      case "signature": {
        const s = signatures[f.key];
        return s && s.drawn ? cropSignature(s.canvas) : null;
      }
      default:
        return undefined;
    }
  }

  /* escribe en el formulario un valor que llegó de otra persona
     (si es igual a lo que ya hay, no hace nada ni marca cambios) */
  function aplicarCampo(f, v) {
    if (f.type === "signature") {
      const pad = signatures[f.key];
      if (!pad || (pad.fuente !== undefined && (pad.fuente || null) === (v || null))) return;
    } else if (JSON.stringify(valorCampo(f, true) ?? null) === JSON.stringify(v ?? null)) return;
    switch (f.type) {
      case "text": case "number": case "date": case "select": case "textarea": {
        const el = $(`#f-${f.key}`);
        if (el && el.value !== (v ?? "")) el.value = v ?? "";
        break;
      }
      case "items": if (itemsCtl[f.key]) itemsCtl[f.key].poner(v); break;
      case "checklist": {
        const wrap = document.querySelector(`[data-checklist-key="${f.key}"]`);
        if (!wrap) break;
        wrap.querySelectorAll("[data-chk-row]").forEach((sel) => { sel.value = (v || {})[sel.dataset.chkRow] || ""; });
        break;
      }
      case "signature": if (signatures[f.key]) signatures[f.key].cargar(v || null); break;
      default: break;   // las fotos se comparten al guardar
    }
    (calculadores[f.key] || []).forEach((fn) => fn());
    formDirty = true;
  }

  /* Un campo cambió en esta pestaña: cambios pendientes, envío a quienes
     editan el mismo formato y aviso de auditoría «empezó a editar». */
  function cambioCampo(clave) {
    formDirty = true;
    const f = campoDef(clave);
    if (!f) return;
    if (f.type !== "images") Colaboracion.cambio(clave);
    if (!aviseEdicion) {
      aviseEdicion = true;
      NotificationService.registrar("formato_editando", {
        cotizacion_id: editingRecord ? editingRecord.id : null, detalle: resumenDoc(),
      });
    }
  }

  /* datos del formato para los avisos (sin información sensible) */
  function resumenDoc(registro = editingRecord) {
    const f = FORMATS[currentFormat];
    const datos = registro ? registro.data || {} : {};
    const vivo = (k) => { const el = $(`#f-${k}`); return el ? el.value.trim() : ""; };
    return {
      formato: f ? f.name : currentFormat,
      numero: registro ? registro.numero : "",
      no_doc: vivo("no_ott") || datos.no_ott || "",
      cliente: vivo("cliente") || datos.cliente || "",
    };
  }

  /* todo lo que se puede compartir en vivo (las fotos no) */
  function instantanea() {
    const out = {};
    for (const f of FORMATS[currentFormat].fields) {
      if (f.section || f.type === "images") continue;
      out[f.key] = valorCampo(f, true);
    }
    return out;
  }

  /* otra persona guardó: se traen sus fotos y el número, sin perder las
     fotos nuevas que esta pestaña aún no ha subido */
  async function alGuardadoRemoto(info) {
    if (!editingRecord || info.id !== editingRecord.id) return;
    try {
      const rec = await Store.getCotizacion(info.id);
      if (!rec) return;
      editingRecord = rec;
      let pendientes = false;
      for (const f of FORMATS[currentFormat].fields) {
        if (f.type !== "images") continue;
        const guardadas = (rec.data[f.key] || []).map((v) => (v && typeof v === "object") ? { src: v.src, desc: v.desc || "" } : { src: v, desc: "" });
        const locales = (formImages[f.key] || []).filter((v) => String(v.src).startsWith("data:"));
        pendientes = pendientes || locales.length > 0;
        formImages[f.key] = [...guardadas, ...locales];
        if (fotosCtl[f.key]) fotosCtl[f.key].pintar();
      }
      formDirty = pendientes;
      $("#current-format-name").textContent = `Editando ${rec.numero} — ${FORMATS[currentFormat].name}`;
      toast(`${info.por || "Otra persona"} guardó el formato.`);
    } catch (e) { console.warn("guardado remoto:", e); }
  }

  /* contexto que usa colaboracion.js para leer y escribir este formulario */
  function ctxColaboracion() {
    return {
      perfil: Store.getProfile(),
      valor: (clave) => { const f = campoDef(clave); return f ? valorCampo(f, true) : null; },
      aplicar: (clave, v) => { const f = campoDef(clave); if (f) aplicarCampo(f, v); },
      instantanea,
      aplicarInstantanea: (datos) => {
        for (const [k, v] of Object.entries(datos)) { const f = campoDef(k); if (f && f.type !== "images") aplicarCampo(f, v); }
      },
      alGuardado: alGuardadoRemoto,
      etiqueta: (clave) => { const f = campoDef(clave); return f ? f.label : clave; },
      aviso: (texto, tipo) => toast(texto, tipo),
    };
  }

  /* un solo listener para todo el formulario (se arma de nuevo con cada formato) */
  const formEl = $("#dynamic-form");
  formEl.addEventListener("input", (e) => {
    const w = e.target.closest("[data-campo]");
    if (w) cambioCampo(w.dataset.campo);
    else schedulePreview();
  });
  formEl.addEventListener("focusin", (e) => {
    const w = e.target.closest("[data-campo]");
    Colaboracion.foco(w ? w.dataset.campo : null);
  });
  formEl.addEventListener("focusout", () => {
    // si el foco salió del formulario, los demás dejan de ver la marca
    setTimeout(() => { if (!formEl.contains(document.activeElement)) Colaboracion.foco(null); }, 0);
  });

  /* ============================================================
     GENERAR — formulario dinámico
     ============================================================ */
  function openForm(formatKey, record) {
    currentFormat = formatKey;
    editingRecord = record;
    formImages = {};
    signatures = {};
    itemsCtl = {};
    fotosCtl = {};
    calculadores = {};
    firmasTocadas = new Set();
    aviseEdicion = false;
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
          label.dataset.campo = f.key;
          label.innerHTML = `<span>${f.label}${f.required ? " *" : ""}</span>
            <input type="${f.type}" id="f-${f.key}" ${f.required ? "required" : ""}
              ${f.calc ? "readonly tabindex='-1'" : ""}
              placeholder="${escapeHtml(f.placeholder || "")}" value="${escapeHtml(val || "")}" />`;
          container(f.half).appendChild(label);
          break;
        }
        case "select": {
          const label = document.createElement("label");
          label.className = "field";
          label.dataset.campo = f.key;
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
          label.dataset.campo = f.key;
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
        case "signature": {
          /* La firma de quien hace el reporte sale sola en los formatos
             nuevos, tomada de SU usuario: cada quien ve solo la suya. Al
             editar un reporte se conserva la que ya quedó guardada en él. */
          const propia = !record && f.own ? (Store.getProfile() || {}).firma : null;
          container(false).appendChild(buildSignatureField(f, val || propia, !val && !!propia));
          break;
        }
      }
    }

    /* campos calculados: se llenan solos a partir de otro campo
       (celdas = baterías × 6). Si el origen no es un número, quedan vacíos. */
    for (const f of format.fields) {
      if (!f.calc) continue;
      const destino = $(`#f-${f.key}`);
      const origen = $(`#f-${f.calc.from}`);
      if (!destino || !origen) continue;
      const calcular = () => {
        const n = parseFloat(String(origen.value).replace(",", "."));
        destino.value = Number.isFinite(n) ? String(Math.round(n * f.calc.factor * 100) / 100) : "";
      };
      origen.addEventListener("input", calcular);
      // también cuando el valor llega de otra persona que edita el mismo formato
      (calculadores[f.calc.from] ||= []).push(calcular);
      // al abrir un reporte guardado se recalcula con la regla vigente
      if (origen.value.trim()) calcular();
    }

    // fecha por defecto hoy
    const fechaInput = $("#f-fecha");
    if (fechaInput && !fechaInput.value) fechaInput.value = new Date().toISOString().slice(0, 10);

    formDirty = false;

    /* auditoría (solo trabajadores) y edición en conjunto (formatos guardados) */
    NotificationService.registrar("formato_abierto", {
      cotizacion_id: record ? record.id : null, detalle: { ...resumenDoc(record), nuevo: !record },
    });
    Tiempo.actualizarPortal({ vista: record ? `Editando ${resumenDoc(record).no_doc || record.numero}` : `Llenando: ${format.name}` });
    if (record) Colaboracion.unirse(record, ctxColaboracion());
    else Colaboracion.salir();
    $("#preview-panel").classList.add("hidden");
    $("#pdf-preview").removeAttribute("src");
    $("#pdf-canvas").replaceChildren();
    $("#view-generar").scrollIntoView({ behavior: "smooth", block: "start" });
    switchView("generar");
  }

  /* ----- campo: tabla de ítems ----- */
  function buildItemsField(f, val) {
    const bancos = f.withBank ? (f.maxBancos || 4) : 0;
    const medidas = f.medidas || null;   // columnas solo de números (voltaje, resistencia…)
    const wrap = document.createElement("div");
    wrap.className = "field";
    wrap.dataset.itemsKey = f.key;
    wrap.dataset.campo = f.key;
    wrap.dataset.withPrice = f.withPrice ? "1" : "";
    if (medidas) wrap.classList.add("items-medidas");
    wrap.innerHTML = `
      ${f.label && medidas ? `<span>${escapeHtml(f.label)}</span>` : ""}
      ${f.withBank ? `<p class="field-hint">Elige el banco de cada batería; la fila nueva sigue en el mismo banco de la anterior. La numeración va sola.</p>` : ""}
      ${medidas ? `<p class="field-hint">Escribe solo los números: ${medidas.map((m) => escapeHtml(m.unidad)).join(" y ")} los pone el formato.</p>` : ""}
      <table class="items-table">
        <thead><tr>
          ${f.withBank ? '<th class="col-banco">Banco</th>' : ""}
          <th class="col-cant">${escapeHtml(f.colCant || "Cant.")}</th>
          ${medidas
            ? medidas.map((m) => `<th class="col-med">${escapeHtml(m.label)} <small>${escapeHtml(m.unidad)}</small></th>`).join("")
            : `<th>${escapeHtml(f.colDesc || "Descripción")}</th>`}
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
      /* registros de antes: «13,56 Vdc 16 mΩ» en una sola casilla; se
         reparten los números en sus columnas, en el mismo orden */
      const previos = medidas && item.descripcion && medidas.every((m) => item[m.key] == null)
        ? (String(item.descripcion).match(/\d+(?:[.,]\d+)?/g) || []) : [];
      const celdas = medidas
        ? medidas.map((m, i) => `<td class="col-med"><input type="text" inputmode="decimal" autocomplete="off"
            class="it-med" data-med="${m.key}" value="${escapeHtml(item[m.key] ?? previos[i] ?? "")}"
            placeholder="${escapeHtml(m.placeholder || "")}" aria-label="${escapeHtml(`${m.label} (${m.unidad})`)}" /></td>`).join("")
        : `<td><input type="text" class="it-desc" value="${escapeHtml(item.descripcion || "")}" placeholder="${escapeHtml(f.placeholderDesc || f.colDesc || "Descripción")}" /></td>`;
      tr.innerHTML = `
        ${f.withBank ? `<td class="col-banco"><select class="it-banco" aria-label="Banco">${opciones}</select></td>` : ""}
        <td class="col-cant"><input type="number" min="1" class="it-cant" value="${escapeHtml(item.cant || 1)}"
          ${f.autoNum ? "readonly tabindex='-1'" : ""} /></td>
        ${celdas}
        ${f.withPrice ? `<td class="col-precio"><input type="number" min="0" class="it-precio" value="${escapeHtml(item.precio ?? "")}" placeholder="0" /></td>` : ""}
        <td class="col-del"><button type="button" class="row-del" title="Quitar">×</button></td>`;
      tr.querySelector(".row-del").addEventListener("click", () => {
        tr.remove();
        renumerar();
        updateTotal();
        cambioCampo(f.key);
      });
      const selBanco = tr.querySelector(".it-banco");
      if (selBanco) selBanco.addEventListener("change", () => { renumerar(); cambioCampo(f.key); });
      tbody.appendChild(tr);
      return tr;
    }

    /* reemplaza las filas con las que llegaron de otra persona; si aquí
       se estaba escribiendo en una celda, el cursor vuelve a esa celda */
    function poner(filas) {
      const activo = tbody.contains(document.activeElement) ? document.activeElement : null;
      let donde = null;
      if (activo) {
        const tr = activo.closest("tr");
        donde = {
          fila: [...tbody.children].indexOf(tr),
          clase: [...activo.classList].find((c) => c.startsWith("it-")),
          med: activo.dataset.med || null,
          cursor: activo.selectionStart ?? null,
        };
      }
      tbody.innerHTML = "";
      (Array.isArray(filas) && filas.length ? filas : [{}]).forEach(addRow);
      renumerar();
      updateTotal();
      if (donde) {
        const tr = tbody.children[Math.min(donde.fila, tbody.children.length - 1)];
        const sel = donde.med ? `[data-med="${donde.med}"]` : `.${donde.clase}`;
        const el = tr && tr.querySelector(sel);
        if (el) {
          el.focus({ preventScroll: true });
          if (donde.cursor != null && el.setSelectionRange) { try { el.setSelectionRange(donde.cursor, donde.cursor); } catch { /* select */ } }
        }
      }
    }
    itemsCtl[f.key] = { poner };

    /* banco de la última fila: la fila nueva sigue en ese banco (1, 1, 2,
       2, 2…) en vez de volver siempre al 1 */
    const ultimoBanco = () => {
      const sel = tbody.querySelectorAll(".it-banco");
      return sel.length ? sel[sel.length - 1].value : 1;
    };

    // en las columnas de medidas solo caben cifras y la coma o el punto decimal
    if (medidas) {
      wrap.addEventListener("input", (e) => {
        const el = e.target;
        if (!el.classList.contains("it-med")) return;
        const limpio = el.value.replace(/[^\d.,]/g, "");
        if (limpio !== el.value) el.value = limpio;
      });
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
      const tr = addRow(f.withBank ? { banco: ultimoBanco() } : {});
      renumerar();
      cambioCampo(f.key);
      // listo para escribir la siguiente medida sin tocar la casilla
      if (medidas) tr.querySelector(".it-med").focus();
    });
    return wrap;
  }

  /* ----- campo: checklist ----- */
  function buildChecklistField(f, val) {
    const data = val || {};
    const wrap = document.createElement("div");
    wrap.className = "field checklist";
    wrap.dataset.checklistKey = f.key;
    wrap.dataset.campo = f.key;
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
    wrap.dataset.campo = f.key;
    wrap.innerHTML = `
      <span>${f.label}</span>
      <p class="field-hint">Van 6 fotos por página, numeradas. La descripción sale como «Figura N.» debajo de cada una.
        Si otra persona edita este formato contigo, las fotos nuevas le aparecen al guardar.</p>
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
    fotosCtl[f.key] = { pintar: renderThumbs };
    return wrap;
  }

  /* ----- lienzo de firma (formularios y ficha del usuario) -----
     Fondo transparente: así la firma no tapa las líneas del PDF. */
  function crearPadFirma(canvas, alCambiar = () => {}) {
    const ctx = canvas.getContext("2d");
    const pad = { canvas, drawn: false };
    const pincel = () => {
      ctx.strokeStyle = "#141414";
      ctx.lineWidth = 2.4;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
    };
    pincel();

    pad.limpiar = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      pad.drawn = false;
    };
    /* La firma guardada se centra sin deformarla. Antes se estiraba a
       todo el lienzo, y cada vez que se volvía a guardar salía más ancha. */
    pad.pintarImagen = (img) => {
      pad.limpiar();
      const esc = Math.min(1, canvas.width / img.width, canvas.height / img.height);
      const w = img.width * esc, h = img.height * esc;
      ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
      pincel();
      pad.drawn = true;
    };
    /* fuente: la imagen que se cargó (undefined si se firmó a mano aquí);
       sirve para no recargar la misma firma que llega de otra persona */
    pad.cargar = (src) => new Promise((ok) => {
      pad.fuente = src || null;
      if (!src) { pad.limpiar(); ok(); return; }
      const img = new Image();
      img.onload = () => { pad.pintarImagen(img); ok(); };
      img.onerror = () => ok();
      img.src = src;
    });
    pad.exportar = () => (pad.drawn ? cropSignature(canvas) : null);

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
      pad.drawn = true;
    });
    const stop = () => {
      if (drawing) { drawing = false; pad.fuente = undefined; alCambiar(); }
    };
    canvas.addEventListener("pointerup", stop);
    canvas.addEventListener("pointerleave", stop);
    canvas.addEventListener("pointercancel", stop);
    return pad;
  }

  /* Foto o escaneo de una firma → PNG con fondo transparente, del tamaño
     del lienzo. Lo claro (el papel) se vuelve transparente y los bordes
     del trazo quedan suaves. */
  function imagenAFirma(file) {
    return new Promise((ok, mal) => {
      const lector = new FileReader();
      lector.onerror = () => mal(new Error("No se pudo leer la imagen."));
      lector.onload = () => {
        const img = new Image();
        img.onerror = () => mal(new Error("El archivo no es una imagen válida."));
        img.onload = () => {
          const esc = Math.min(1, 600 / img.width, 180 / img.height);
          const w = Math.max(1, Math.round(img.width * esc));
          const h = Math.max(1, Math.round(img.height * esc));
          const c = document.createElement("canvas");
          c.width = w; c.height = h;
          const ctx = c.getContext("2d");
          ctx.drawImage(img, 0, 0, w, h);
          const datos = ctx.getImageData(0, 0, w, h);
          const px = datos.data;
          for (let i = 0; i < px.length; i += 4) {
            const luz = (px[i] + px[i + 1] + px[i + 2]) / 3;
            if (luz >= 200) px[i + 3] = 0;
            else if (luz > 150) px[i + 3] = Math.round(px[i + 3] * (200 - luz) / 50);
          }
          ctx.putImageData(datos, 0, 0);
          ok(c);
        };
        img.src = lector.result;
      };
      lector.readAsDataURL(file);
    });
  }

  /* ----- campo: firma ----- */
  function buildSignatureField(f, existing, deUsuario = false) {
    const wrap = document.createElement("div");
    wrap.className = "field";
    wrap.dataset.campo = f.key;
    wrap.innerHTML = `
      <span>${f.label}</span>
      <canvas class="sig-canvas" width="600" height="180"></canvas>
      <div class="sig-actions"><button type="button" class="btn btn-ghost btn-sm sig-clear">Limpiar firma</button></div>
      ${deUsuario ? '<small class="field-hint">Se puso tu firma guardada. Si quieres, límpiala y firma de nuevo.</small>' : ""}`;

    // firmar aquí cuenta para el aviso «completó y firmó»
    const pad = crearPadFirma(wrap.querySelector("canvas"), () => { firmasTocadas.add(f.key); cambioCampo(f.key); });
    signatures[f.key] = pad;
    pad.fuente = existing || null;
    if (existing) pad.cargar(existing);

    wrap.querySelector(".sig-clear").addEventListener("click", () => {
      pad.limpiar();
      pad.fuente = null;
      cambioCampo(f.key);
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
    const data = {};
    const SIMPLES = ["text", "number", "date", "select", "textarea"];
    for (const f of FORMATS[currentFormat].fields) {
      if (f.section) continue;
      if (SIMPLES.includes(f.type) && !$(`#f-${f.key}`)) continue;
      data[f.key] = valorCampo(f);
    }
    return data;
  }

  /* ya no refresca en vivo: solo marca cambios pendientes.
     La vista previa se genera a demanda con el botón "Vista previa". */
  function schedulePreview() {
    formDirty = true;
  }

  /* Celulares y tablets no muestran bien un PDF dentro de un iframe: Chrome
     de Android lo descarga o lo abre en otra pestaña y el iPad enseña solo
     la primera página. Ahí las páginas se dibujan con el visor propio
     (js/visor.js), debajo del formulario, igual que en el computador. */
  const esMovil = /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)); // iPad con iPadOS
  const visorPropio = esMovil || navigator.pdfViewerEnabled === false;
  let urlPreview = null;

  async function refreshPreview({ desplazar = false } = {}) {
    if (!currentFormat) return;
    const panel = $("#preview-panel");
    panel.classList.remove("hidden");
    // en pantallas angostas la vista previa queda debajo del formulario: se baja hasta ella
    if (desplazar) {
      const apilado = window.matchMedia("(max-width: 1024px)").matches;
      panel.scrollIntoView({ behavior: "smooth", block: apilado ? "start" : "nearest" });
    }
    const aviso = $("#preview-aviso");
    const lienzos = $("#pdf-canvas");
    aviso.classList.add("hidden");
    try {
      const record = await Store.hydrateImages({
        numero: editingRecord ? editingRecord.numero : `${FORMATS[currentFormat].prefix}-BORRADOR`,
        data: collectData(),
      });
      if (visorPropio) {
        $("#pdf-preview").classList.add("hidden");
        $("#open-preview").classList.add("hidden");
        lienzos.classList.remove("hidden");
        lienzos.classList.add("cargando");
        const bytes = await PDFGen.previewBytes(currentFormat, record);
        await VisorPDF.pintar(bytes, lienzos);
      } else {
        urlPreview = await PDFGen.previewDataURL(currentFormat, record);
        lienzos.classList.add("hidden");
        $("#open-preview").classList.remove("hidden");
        $("#pdf-preview").classList.remove("hidden");
        $("#pdf-preview").src = urlPreview;
      }
    } catch (e) {
      console.error("preview:", e);
      aviso.textContent = "No se pudo generar la vista previa: " + mensajeError(e);
      aviso.classList.remove("hidden");
      toast("No se pudo generar la vista previa.", "error");
    } finally {
      lienzos.classList.remove("cargando");
    }
  }
  $("#open-preview").addEventListener("click", () => {
    if (urlPreview) window.open(urlPreview, "_blank");
  });
  $("#refresh-preview").addEventListener("click", () => refreshPreview());

  $("#preview-btn").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await refreshPreview({ desplazar: true });
    } finally { btn.disabled = false; }
  });

  $("#generate-btn").addEventListener("click", () => saveCotizacion(true));

  /* Antes de descargar se propone un nombre y se deja cambiarlo. */
  function pedirNombre(formatKey, record) {
    const base = `${FORMATS[formatKey].name} - ${PDFGen.numeroImpreso(formatKey, record) || record.numero || ""}`.trim();
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
    /* etapa en curso: así el error dice qué falló y, si el registro ya
       quedó guardado, no se le hace creer al usuario que se perdió */
    let etapa = "fotos";
    let guardado = null;
    try {
      const data = collectData();

      /* sube imágenes nuevas (dataURL) al almacenamiento, de una en una:
         en datos móviles, subirlas todas a la vez hacía que alguna se
         cortara y el guardado entero fallaba con «Failed to fetch» */
      for (const f of format.fields) {
        if (f.type === "images" && Array.isArray(data[f.key])) {
          const fotos = [];
          for (const foto of data[f.key]) {
            fotos.push({
              src: String(foto.src).startsWith("data:") ? await subirFoto(foto.src) : foto.src,
              desc: foto.desc || "",
            });
          }
          data[f.key] = fotos;
        }
      }

      etapa = "guardar";
      let record;
      if (editingRecord) {
        record = await Store.updateCotizacion(editingRecord.id, data);
        editingRecord = record;
        // quienes editan el mismo formato refrescan fotos y número
        Colaboracion.guardado(record);
      } else {
        const numero = await Store.nextNumber(format.prefix);
        record = await Store.createCotizacion({ numero, format_type: currentFormat, data });
        editingRecord = record;
        $("#current-format-name").textContent = `Editando ${record.numero} — ${format.name}`;
        $("#generate-btn-label").textContent = "Guardar cambios y descargar PDF";
        // ya existe en el historial: desde ahora otros pueden entrar a editarlo
        Colaboracion.unirse(record, ctxColaboracion());
      }
      guardado = record;
      // auditoría: completó (y si firmó aquí, también firmó) el formato
      NotificationService.registrar("formato_completado", {
        cotizacion_id: record.id, detalle: { ...resumenDoc(record), firmado: firmasTocadas.size > 0 },
      });
      firmasTocadas = new Set();

      const num = PDFGen.numeroImpreso(currentFormat, record) || record.numero;
      if (download) {
        etapa = "pdf";
        const rec = await Store.hydrateImages(record);
        const descarga = await PDFGen.download(currentFormat, rec, pedirNombre(currentFormat, rec));
        const avisado = await NotificationService.formatoDescargado({
          numero: num, formato: format.name, cliente: data.cliente, url: descarga.url, nombre: descarga.nombre,
        });
        // con el aviso de descargas apagado, al menos la confirmación de siempre
        if (!avisado) toast(`PDF ${num} generado y guardado.`);
      }
      formDirty = false;
      $("#save-status").textContent = "✓ Guardado en el historial";
      if (!download) toast(`Cotización ${num} guardada.`);
      actualizarAlmacenamiento();
      return true;
    } catch (e) {
      console.error(`guardar (${etapa}):`, e);
      if (guardado) {
        // el registro sí quedó en el historial; solo falló el PDF
        formDirty = false;
        $("#save-status").textContent = "✓ Guardado en el historial";
        toast(`${PDFGen.numeroImpreso(currentFormat, guardado) || guardado.numero} se guardó, pero no se pudo generar el PDF: ${mensajeError(e)}`, "error");
        return true;
      }
      $("#save-status").textContent = "";
      const que = etapa === "fotos" ? "subir las fotos" : "guardar";
      /* si se cortó la red al crear, pudo haber llegado al servidor:
         se avisa para no terminar con el mismo reporte dos veces */
      const extra = etapa === "guardar" && !editingRecord && esErrorDeRed(e)
        ? " Antes de reintentar, revisa en el Historial si ya aparece." : "";
      toast(`No se pudo ${que}: ${mensajeError(e)}${extra}`, "error");
      return false;
    } finally {
      btn.disabled = false;
    }
  }

  /* Reintenta la subida si se cortó la red (hasta 3 intentos). Cada intento
     usa una ruta nueva, así que no choca con uno anterior a medias. */
  async function subirFoto(src) {
    for (let intento = 1; ; intento++) {
      try { return await Store.uploadImage(src); }
      catch (e) {
        if (intento >= 3 || !esErrorDeRed(e)) throw e;
        await new Promise((r) => setTimeout(r, 1500 * intento));
      }
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
    const isJefe = esGestor(Store.getProfile());
    const rows = historialCache.filter((c) => {
      if (!q) return true;
      const fmt = FORMATS[c.format_type];
      return [c.numero, c.no_doc, c.cliente, fmt?.name, c.owner_name]
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
        <span class="hist-num" title="Consecutivo del sistema: ${escapeHtml(c.numero)}">${escapeHtml(c.no_doc ? `No. OTT ${c.no_doc}` : c.numero)}</span>
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
          const descarga = await PDFGen.download(rec.format_type, listo, pedirNombre(rec.format_type, listo));
          NotificationService.formatoDescargado({
            numero: PDFGen.numeroImpreso(rec.format_type, rec) || rec.numero,
            formato: (FORMATS[rec.format_type] || {}).name, cliente: (rec.data || {}).cliente,
            url: descarga.url, nombre: descarga.nombre,
          });
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
          actualizarAlmacenamiento();
        } catch (e) { toast(e.message || "Error al eliminar.", "error"); }
      });
    });
  }

  $("#search-historial").addEventListener("input", drawHistorial);

  /* ============================================================
     USUARIOS (Jefes y Administrador)
     El Administrador es único: lo crea un Jefe, solo él edita su
     cuenta, no cambia de rol y no se elimina desde el portal (solo
     desde el panel de Supabase).
     ============================================================ */
  let editingUserId = null;
  let usuariosCache = [];

  async function renderUsers() {
    const list = $("#users-list");
    list.innerHTML = '<div class="empty-state">Cargando…</div>';
    let users;
    try { users = await Store.listUsers(); }
    catch (e) {
      list.innerHTML = `<div class="empty-state">Error al cargar usuarios.<br><small>${escapeHtml(e.message || "")}</small></div>`;
      return;
    }
    usuariosCache = users;
    const me = Store.getProfile();
    list.innerHTML = users.map((u) => {
      const esAdmin = u.role === "administrador";
      const puedeEditar = !esAdmin || u.id === me.id;
      const puedeBorrar = u.id !== me.id && !esAdmin;
      return `
      <div class="user-card" data-id="${u.id}">
        <div class="user-avatar">${escapeHtml((u.name || "?").charAt(0).toUpperCase())}</div>
        <div class="uc-info">
          <strong>${escapeHtml(u.name)}${u.id === me.id ? " (tú)" : ""}</strong>
          <small>${escapeHtml(u.email)}</small>
          <span class="role-tag ${u.role}">${escapeHtml(rolTexto(u.role))}</span>
        </div>
        <div class="uc-actions">
          ${puedeEditar ? `<button class="icon-btn" data-act="edit" title="Editar" aria-label="Editar a ${escapeHtml(u.name)}">${window.ICONS.edit}</button>` : ""}
          ${puedeBorrar ? `<button class="icon-btn danger" data-act="del" title="Eliminar" aria-label="Eliminar a ${escapeHtml(u.name)}">${window.ICONS.trash}</button>` : ""}
          ${esAdmin && u.id !== me.id ? '<span class="uc-candado" title="Solo el Administrador modifica su cuenta; se elimina desde Supabase">Protegido</span>' : ""}
        </div>
      </div>`;
    }).join("");

    list.querySelectorAll(".user-card").forEach((card) => {
      const id = card.dataset.id;
      const u = users.find((x) => x.id === id);
      const editBtn = card.querySelector('[data-act="edit"]');
      if (editBtn) editBtn.addEventListener("click", () => openUserModal(u, users));
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

  /* firma digital del usuario: a mano alzada o adjunta como imagen */
  let firmaUsuarioCambio = false;
  const padUsuario = crearPadFirma($("#uf-firma"), () => { firmaUsuarioCambio = true; });

  /* opciones de rol: «Administrador» se desactiva si ya hay uno, y el
     propio Administrador no puede cambiar su rol */
  function prepararRoles(user, users) {
    const sel = $("#uf-role");
    const hayAdmin = users.some((u) => u.role === "administrador");
    const esElAdmin = !!user && user.role === "administrador";
    const opcion = sel.querySelector('option[value="administrador"]');
    opcion.disabled = hayAdmin && !esElAdmin;
    opcion.textContent = opcion.disabled ? "Administrador (ya hay uno)" : "Administrador";
    sel.disabled = esElAdmin;
    const ayuda = $("#uf-role-hint");
    ayuda.textContent = esElAdmin
      ? "El rol de Administrador no se cambia desde el portal."
      : hayAdmin ? "Ya hay un Administrador en el portal: solo puede haber uno."
        : "El Administrador es único y solo se puede eliminar desde Supabase.";
  }

  async function openUserModal(user, users = usuariosCache) {
    editingUserId = user ? user.id : null;
    $("#user-modal-title").textContent = user ? "Editar usuario" : "Nuevo usuario";
    $("#uf-name").value = user ? user.name : "";
    $("#uf-email").value = user ? user.email : "";
    $("#uf-password").value = "";
    $("#uf-password").required = !user;
    $("#uf-password").placeholder = user ? "Dejar vacío para no cambiarla" : "Mínimo 6 caracteres";
    $("#uf-role").value = user ? user.role : "trabajador";
    prepararRoles(user, users || []);
    const err = $("#user-form-error");
    err.classList.add("hidden");
    padUsuario.limpiar();
    firmaUsuarioCambio = false;
    $("#user-modal").classList.remove("hidden");
    if (!user) return;
    try {
      const firma = await Store.getUserFirma(user.id);
      // si mientras llegaba ya empezó a firmar o cambió de usuario, no se pisa
      if (!firmaUsuarioCambio && editingUserId === user.id) await padUsuario.cargar(firma);
    } catch (ex) {
      err.textContent = ex.message || "No se pudo cargar la firma.";
      err.classList.remove("hidden");
    }
  }

  $("#uf-firma-clear").addEventListener("click", () => {
    padUsuario.limpiar();
    firmaUsuarioCambio = true;
  });
  $("#uf-firma-adjuntar").addEventListener("click", () => $("#uf-firma-file").click());
  $("#uf-firma-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      padUsuario.pintarImagen(await imagenAFirma(file));
      firmaUsuarioCambio = true;
    } catch (ex) {
      toast(ex.message || "No se pudo usar esa imagen.", "error");
    }
  });

  $("#new-user-btn").addEventListener("click", () => openUserModal(null, usuariosCache));
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
    const eraNuevo = !editingUserId;
    try {
      if (editingUserId) await Store.updateUser(editingUserId, payload);
      else {
        /* desde aquí el usuario ya existe: si luego falla la firma y se
           reintenta, se actualiza en vez de intentar crearlo otra vez */
        editingUserId = await Store.createUser(payload);
      }
      if (firmaUsuarioCambio && editingUserId) {
        try {
          await Store.saveUserFirma(editingUserId, padUsuario.exportar());
          firmaUsuarioCambio = false;
        } catch (ex) {
          throw new Error(`${eraNuevo ? "Usuario creado" : "Datos guardados"}, pero la firma no: ${ex.message}`);
        }
      }
      $("#user-modal").classList.add("hidden");
      toast(eraNuevo ? "Usuario creado." : "Usuario actualizado.");
      // si editó su propia cuenta, el menú muestra el nombre nuevo
      const me = Store.getProfile();
      if (me && editingUserId === me.id) {
        $("#user-name").textContent = payload.name;
        $("#user-avatar").textContent = (payload.name || "?").trim().charAt(0).toUpperCase();
      }
      renderUsers();
      actualizarAlmacenamiento();
    } catch (ex) {
      err.textContent = ex.message || "Error al guardar el usuario.";
      err.classList.remove("hidden");
      if (eraNuevo && editingUserId) {
        $("#user-modal-title").textContent = "Editar usuario";
        $("#uf-password").required = false;
      }
    }
  });

  /* ---------- go ---------- */
  boot();
})();
