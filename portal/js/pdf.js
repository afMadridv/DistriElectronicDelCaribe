/* ============================================================
   Generador de PDFs — reproduce el estilo de los formatos
   originales de DistriElectronic: cajas con borde, casillas
   de chequeo, tablas con rejilla, logo ovalado y firmas.
   ============================================================ */
(function () {
  const { jsPDF } = window.jspdf;
  const YELLOW = [255, 196, 0];
  const YELLOW_SOFT = [255, 247, 220];
  const BLACK = [20, 20, 20];
  const GRAY = [110, 110, 110];
  const LIGHT = [244, 244, 242];

  const PAGE_W = 210, PAGE_H = 297;
  const MARGIN = 14;
  const CONTENT_W = PAGE_W - MARGIN * 2;
  const FOOT_LIMIT = PAGE_H - 20;

  function loadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0);
          resolve({ dataURL: canvas.toDataURL("image/jpeg", 0.85), w: canvas.width, h: canvas.height });
        } catch { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  function money(n) {
    const num = Number(n) || 0;
    return "$ " + num.toLocaleString("es-CO", { maximumFractionDigits: 0 });
  }

  function fmtDate(iso) {
    if (!iso) return "";
    const [y, m, d] = String(iso).split("-");
    if (!y || !m || !d) return iso;
    return `${d}/${m}/${y}`;
  }

  async function build(formatKey, record) {
    const format = FORMATS[formatKey];
    const data = record.data || {};
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    let y = 0;

    /* ---------- logo ovalado (como el original) ---------- */
    function drawLogo(x, cy) {
      doc.setFillColor(...YELLOW_SOFT);
      doc.setDrawColor(...YELLOW);
      doc.setLineWidth(1.1);
      doc.ellipse(x + 21, cy, 21, 8.5, "FD");
      doc.setTextColor(...BLACK);
      doc.setFont("helvetica", "bolditalic");
      doc.setFontSize(8.2);
      doc.text("DISTRIELECTRONIC", x + 21, cy - 0.8, { align: "center" });
      doc.setFontSize(7.2);
      doc.text("DEL CARIBE", x + 21, cy + 2.6, { align: "center" });
    }

    /* ---------- encabezado principal (pág. 1) ---------- */
    function header() {
      doc.setDrawColor(...BLACK);
      doc.setLineWidth(0.4);
      doc.rect(MARGIN, 10, CONTENT_W, 22);
      drawLogo(MARGIN + 3, 21);

      doc.setTextColor(...BLACK);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11.5);
      const titleLines = doc.splitTextToSize(format.docTitle, 92);
      doc.text(titleLines, MARGIN + 52, 18 - (titleLines.length - 1) * 2.2);

      // línea doble decorativa como el original
      doc.setLineWidth(0.8);
      doc.line(MARGIN + 52, 27, MARGIN + 144, 27);
      doc.setDrawColor(...YELLOW);
      doc.setLineWidth(0.8);
      doc.line(MARGIN + 52, 28.2, MARGIN + 144, 28.2);

      // caja No.
      doc.setDrawColor(...BLACK);
      doc.setLineWidth(0.4);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.text("No.", MARGIN + CONTENT_W - 32, 16);
      doc.rect(MARGIN + CONTENT_W - 32, 18, 29, 7);
      doc.setFontSize(9);
      doc.text(String(record.numero || ""), MARGIN + CONTENT_W - 17.5, 22.8, { align: "center" });

      y = 37;
    }

    /* encabezado corto en páginas siguientes */
    function miniHeader() {
      doc.setDrawColor(...BLACK);
      doc.setLineWidth(0.4);
      doc.rect(MARGIN, 10, CONTENT_W, 12);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(...BLACK);
      doc.text(format.docTitle, MARGIN + 3, 17.5);
      doc.text(`No. ${record.numero || ""}`, MARGIN + CONTENT_W - 3, 17.5, { align: "right" });
      y = 27;
    }

    function footer() {
      const pages = doc.getNumberOfPages();
      for (let i = 1; i <= pages; i++) {
        doc.setPage(i);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.2);
        doc.setTextColor(...GRAY);
        doc.text(
          `${APP_CONFIG.COMPANY.name} · ${APP_CONFIG.COMPANY.nit} · ${APP_CONFIG.COMPANY.address}`,
          PAGE_W / 2, PAGE_H - 11, { align: "center" });
        doc.text(
          `${APP_CONFIG.COMPANY.phone} · E-mail: ${APP_CONFIG.COMPANY.email}`,
          PAGE_W / 2, PAGE_H - 7.5, { align: "center" });
        doc.text(`Hoja ${i} de ${pages}`, PAGE_W - MARGIN, PAGE_H - 7.5, { align: "right" });
      }
    }

    function ensureSpace(h) {
      if (y + h > FOOT_LIMIT) {
        doc.addPage();
        miniHeader();
      }
    }

    /* ---------- título de sección en caja (como el original) ---------- */
    function sectionTitle(title) {
      ensureSpace(13);
      const t = title.toUpperCase();
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.6);
      const w = doc.getTextWidth(t) + 8;
      doc.setDrawColor(...BLACK);
      doc.setLineWidth(0.4);
      doc.setFillColor(...YELLOW);
      doc.rect(MARGIN, y + 2, w, 6.2, "FD");
      doc.setTextColor(...BLACK);
      doc.text(t, MARGIN + 4, y + 6.4);
      y += 10.5;
    }

    /* ---------- pares etiqueta: valor con línea punteada ---------- */
    function kvGrid(pairs) {
      const colW = CONTENT_W / 2;
      const rowsNeeded = Math.ceil(pairs.length / 2);
      const boxH = rowsNeeded * 7.4 + 3;
      ensureSpace(boxH + 2);
      doc.setDrawColor(...BLACK);
      doc.setLineWidth(0.35);
      doc.rect(MARGIN, y, CONTENT_W, boxH);
      let yy = y + 5.6;
      for (let i = 0; i < pairs.length; i += 2) {
        [pairs[i], pairs[i + 1]].forEach((p, col) => {
          if (!p) return;
          const x = MARGIN + 3 + col * colW;
          doc.setFont("helvetica", "bold");
          doc.setFontSize(7.4);
          doc.setTextColor(...BLACK);
          const label = p.label.toUpperCase() + ":";
          doc.text(label, x, yy);
          const lw = doc.getTextWidth(label);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(8.6);
          const maxW = colW - lw - 8;
          let val = String(p.value);
          while (doc.getTextWidth(val) > maxW && val.length > 3) val = val.slice(0, -2) + "…";
          doc.text(val, x + lw + 2, yy);
          doc.setDrawColor(...GRAY);
          doc.setLineDashPattern([0.7, 0.7], 0);
          doc.setLineWidth(0.2);
          doc.line(x + lw + 1, yy + 1, x + colW - 6, yy + 1);
          doc.setLineDashPattern([], 0);
        });
        yy += 7.4;
      }
      y += boxH + 2;
    }

    /* ---------- área de texto en caja con líneas punteadas ---------- */
    function textBlock(label, value) {
      doc.setFontSize(8.6);
      const lines = doc.splitTextToSize(String(value), CONTENT_W - 8);
      const boxH = Math.max(lines.length * 4.4 + 9, 16);
      ensureSpace(boxH + 2);
      doc.setDrawColor(...BLACK);
      doc.setLineWidth(0.35);
      doc.rect(MARGIN, y, CONTENT_W, boxH);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.4);
      doc.setTextColor(...BLACK);
      doc.text(label.toUpperCase() + ":", MARGIN + 3, y + 4.6);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.6);
      doc.text(lines, MARGIN + 4, y + 9.6);
      y += boxH + 2;
    }

    /* ---------- casillas de chequeo (BIEN/MAL/... con cuadro marcado) ---------- */
    function checklistBlock(f, obj) {
      const rows = (f.rows || []).filter((r) => obj && obj[r.key]);
      if (!rows.length) return;
      const opts = f.options;
      const rowH = 5.8;
      const boxH = rows.length * rowH + 3;
      ensureSpace(Math.min(boxH, 40) + 2);

      // si el bloque no cabe completo se parte en dos cajas
      let remaining = [...rows];
      while (remaining.length) {
        const fit = Math.max(1, Math.floor((FOOT_LIMIT - y - 5) / rowH));
        const chunk = remaining.slice(0, fit);
        remaining = remaining.slice(fit);
        const h = chunk.length * rowH + 3;
        doc.setDrawColor(...BLACK);
        doc.setLineWidth(0.35);
        doc.rect(MARGIN, y, CONTENT_W, h);

        const optAreaW = Math.min(96, opts.length * 17 + 6);
        const optStartX = MARGIN + CONTENT_W - optAreaW;
        let yy = y + 4.6;
        chunk.forEach((r) => {
          doc.setFont("helvetica", "normal");
          doc.setFontSize(7.6);
          doc.setTextColor(...BLACK);
          let label = r.label.toUpperCase() + ":";
          while (doc.getTextWidth(label) > optStartX - MARGIN - 6 && label.length > 4)
            label = label.slice(0, -2) + "…";
          doc.text(label, MARGIN + 3, yy);

          opts.forEach((opt, oi) => {
            const ox = optStartX + oi * ((optAreaW - 6) / opts.length);
            doc.setFontSize(5.6);
            doc.setTextColor(...GRAY);
            doc.text(opt.toUpperCase(), ox, yy - 0.4, { maxWidth: 14 });
            doc.setDrawColor(...BLACK);
            doc.setLineWidth(0.25);
            const sq = 2.6;
            doc.rect(ox + 10.5, yy - 2.4, sq, sq);
            if (obj[r.key] === opt) {
              doc.setFillColor(...BLACK);
              doc.rect(ox + 10.9, yy - 2.0, sq - 0.8, sq - 0.8, "F");
            }
          });
          yy += rowH;
        });
        y += h + 2;
        if (remaining.length) { doc.addPage(); miniHeader(); }
      }
    }

    /* ---------- tabla con rejilla completa (como FORMATO DE ACTIVIDADES) ---------- */
    function itemsTable(items, f) {
      const withPrice = f.withPrice;
      const cantLabel = (f.colCant || "CANT.").toUpperCase();
      const descLabel = (f.colDesc || "DESCRIPCIÓN").toUpperCase();
      const rows = (items || []).filter((it) => (it.descripcion || "").trim());
      if (!rows.length) return;
      const cantW = f.colCant ? 26 : 20;
      const cols = withPrice
        ? [{ w: cantW }, { w: CONTENT_W - cantW - 34 - 34 }, { w: 34, right: true }, { w: 34, right: true }]
        : [{ w: cantW }, { w: CONTENT_W - cantW }];
      const labels = withPrice ? [cantLabel, descLabel, "VR. UNIT.", "TOTAL"] : [cantLabel, descLabel];

      function headRow() {
        ensureSpace(14);
        doc.setDrawColor(...BLACK);
        doc.setLineWidth(0.35);
        doc.setFillColor(...LIGHT);
        doc.rect(MARGIN, y, CONTENT_W, 6, "FD");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7.2);
        doc.setTextColor(...BLACK);
        let x = MARGIN;
        cols.forEach((c, i) => {
          doc.text(labels[i], c.right ? x + c.w - 2 : x + 2, y + 4.2, { align: c.right ? "right" : "left" });
          if (i > 0) doc.line(x, y, x, y + 6);
          x += c.w;
        });
        y += 6;
      }

      headRow();
      let subtotal = 0;
      rows.forEach((it) => {
        const cant = it.cant === "" || it.cant == null ? "" : String(it.cant);
        const precio = Number(it.precio) || 0;
        const total = (Number(it.cant) || 1) * precio;
        subtotal += total;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.2);
        const descLines = doc.splitTextToSize(String(it.descripcion), cols[1].w - 5);
        const rowH = Math.max(6, descLines.length * 4 + 2.6);
        if (y + rowH > FOOT_LIMIT) { doc.addPage(); miniHeader(); headRow(); }
        doc.setDrawColor(...BLACK);
        doc.setLineWidth(0.25);
        doc.rect(MARGIN, y, CONTENT_W, rowH);
        let x = MARGIN;
        doc.setTextColor(...BLACK);
        doc.text(cant, x + 2, y + 4.4);
        x += cols[0].w;
        doc.line(x, y, x, y + rowH);
        doc.text(descLines, x + 2, y + 4.4);
        x += cols[1].w;
        if (withPrice) {
          doc.line(x, y, x, y + rowH);
          doc.text(money(precio), x + cols[2].w - 2, y + 4.4, { align: "right" });
          x += cols[2].w;
          doc.line(x, y, x, y + rowH);
          doc.text(money(total), x + cols[3].w - 2, y + 4.4, { align: "right" });
        }
        y += rowH;
      });

      if (withPrice) {
        const iva = subtotal * 0.19;
        [["Subtotal", money(subtotal)], ["IVA (19%)", money(iva)], ["TOTAL", money(subtotal + iva)]]
          .forEach(([label, val], i) => {
            ensureSpace(6.5);
            const bold = i === 2;
            if (bold) {
              doc.setFillColor(...YELLOW);
              doc.rect(MARGIN + CONTENT_W - 72, y, 72, 6, "F");
            }
            doc.setFont("helvetica", bold ? "bold" : "normal");
            doc.setFontSize(bold ? 9 : 8.2);
            doc.setTextColor(...BLACK);
            doc.text(label, MARGIN + CONTENT_W - 68, y + 4.2);
            doc.text(val, MARGIN + CONTENT_W - 2, y + 4.2, { align: "right" });
            y += 6;
          });
      }
      y += 2.5;
    }

    async function imagesGrid(urls) {
      const list = (urls || []).slice(0, 8);
      if (!list.length) return;
      const imgW = (CONTENT_W - 6) / 2;
      for (let i = 0; i < list.length; i += 2) {
        const pair = await Promise.all(list.slice(i, i + 2).map(loadImage));
        const heights = pair.map((im) => (im ? Math.min(imgW * (im.h / im.w), 75) : 0));
        const rowH = Math.max(...heights, 0);
        if (!rowH) continue;
        ensureSpace(rowH + 5);
        pair.forEach((im, col) => {
          if (!im) return;
          const w = Math.min(imgW, (im.w / im.h) * heights[col]);
          const x = MARGIN + col * (imgW + 6);
          doc.addImage(im.dataURL, "JPEG", x, y, w, heights[col]);
          doc.setDrawColor(...BLACK);
          doc.setLineWidth(0.3);
          doc.rect(x, y, w, heights[col]);
        });
        y += rowH + 5;
      }
    }

    /* ---------- firmas lado a lado (como los originales) ---------- */
    async function signaturesRow(sigs) {
      if (!sigs.length) return;
      const colW = (CONTENT_W - 10) / 2;
      for (let i = 0; i < sigs.length; i += 2) {
        const pair = sigs.slice(i, i + 2);
        ensureSpace(40);
        const baseY = y + 24;
        for (let c = 0; c < pair.length; c++) {
          const s = pair[c];
          const x = MARGIN + c * (colW + 10);
          if (s.dataURL) {
            const im = await loadImage(s.dataURL);
            if (im) {
              const h = 20;
              const w = Math.min((im.w / im.h) * h, colW - 10);
              doc.addImage(im.dataURL, "JPEG", x + 4, baseY - 21, w, h);
            }
          }
          doc.setDrawColor(...BLACK);
          doc.setLineWidth(0.4);
          doc.line(x, baseY, x + colW - 8, baseY);
          doc.setFont("helvetica", "bold");
          doc.setFontSize(8);
          doc.setTextColor(...BLACK);
          doc.text(s.label.toUpperCase(), x, baseY + 4.4);
          if (s.nombre) {
            doc.setFont("helvetica", "normal");
            doc.setFontSize(7.6);
            doc.setTextColor(...GRAY);
            doc.text(String(s.nombre), x, baseY + 8.4);
          }
        }
        y = baseY + 13;
      }
    }

    /* ============ recorrido de campos ============ */
    header();

    let pendingKV = [];
    const sigQueue = [];
    function flushKV() {
      if (pendingKV.length) { kvGrid(pendingKV); pendingKV = []; }
    }

    const nameKeys = new Set(
      format.fields.filter((f) => f.type === "signature" && f.nameKey).map((f) => f.nameKey)
    );

    /* una sección se omite si todo su contenido son firmas (van al final) */
    function sectionHasVisibleContent(idx) {
      for (let i = idx + 1; i < format.fields.length; i++) {
        const f = format.fields[i];
        if (f.section) return false;
        if (f.type === "signature") continue;
        if (nameKeys.has(f.key)) continue;
        const v = data[f.key];
        if (f.type === "checklist" && v && Object.keys(v).length) return true;
        if (f.type === "items" && Array.isArray(v) && v.some((it) => (it.descripcion || "").trim())) return true;
        if (f.type === "images" && Array.isArray(v) && v.length) return true;
        if (v && typeof v === "string") return true;
      }
      return false;
    }

    for (let idx = 0; idx < format.fields.length; idx++) {
      const f = format.fields[idx];
      if (f.section) {
        flushKV();
        if (sectionHasVisibleContent(idx)) sectionTitle(f.section);
        continue;
      }
      const val = data[f.key];

      switch (f.type) {
        case "text": case "select": case "number":
          if (nameKeys.has(f.key)) break;
          if (val) pendingKV.push({ label: f.label, value: val });
          break;
        case "date":
          if (val) pendingKV.push({ label: f.label, value: fmtDate(val) });
          break;
        case "textarea":
          flushKV();
          if (val) textBlock(f.label, val);
          break;
        case "items":
          flushKV();
          itemsTable(val, f);
          break;
        case "checklist":
          flushKV();
          checklistBlock(f, val);
          break;
        case "images":
          flushKV();
          await imagesGrid(val);
          break;
        case "signature":
          flushKV();
          sigQueue.push({
            dataURL: val || null,
            nombre: data[f.nameKey || "firma_nombre"] || "",
            label: f.label,
          });
          break;
      }
    }
    flushKV();
    await signaturesRow(sigQueue);
    footer();
    return doc;
  }

  window.PDFGen = {
    build,
    async download(formatKey, record) {
      const doc = await build(formatKey, record);
      doc.save(`${record.numero || "documento"}.pdf`);
    },
    async previewDataURL(formatKey, record) {
      const doc = await build(formatKey, record);
      return doc.output("datauristring");
    },
  };
})();
