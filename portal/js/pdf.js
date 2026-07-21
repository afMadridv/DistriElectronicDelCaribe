/* ============================================================
   Generador de PDFs — rellena las plantillas ORIGINALES
   (portal/plantillas/*.pdf) con pdf-lib. El diseño del PDF
   nunca cambia: solo se escriben los datos encima.
   Funciona en navegador (window.PDFLib) y en Node (require).
   ============================================================ */
(function (root) {

const isNode = typeof module !== "undefined" && module.exports;
const PDFLib = isNode ? require("pdf-lib") : root.PDFLib;
const PLANTILLAS = isNode ? require("./plantillas.js") : root.PLANTILLAS;

const { PDFDocument, StandardFonts, rgb } = PDFLib;
const INK = rgb(0.05, 0.05, 0.35); // azul oscuro tipo esfero

const templateCache = {};

async function fetchTemplate(file, baseUrl) {
  if (templateCache[file]) return templateCache[file];
  let bytes;
  if (isNode) {
    bytes = require("fs").readFileSync((baseUrl || "") + file);
  } else {
    const res = await fetch("plantillas/" + encodeURIComponent(file));
    if (!res.ok) throw new Error("No se pudo cargar la plantilla " + file);
    bytes = await res.arrayBuffer();
  }
  templateCache[file] = bytes;
  return bytes;
}

function fmtDate(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).split("-");
  return y && m && d ? `${d}/${m}/${y}` : String(iso);
}

/* recorta el texto al ancho disponible */
function fit(font, text, size, maxW) {
  let t = String(text ?? "");
  if (!maxW) return t;
  while (font.widthOfTextAtSize(t, size) > maxW && t.length > 1) t = t.slice(0, -1);
  return t;
}

function wrapText(font, text, size, maxW) {
  const words = String(text ?? "").replace(/\r/g, "").split(/\s+|\n/);
  const paras = String(text ?? "").replace(/\r/g, "").split("\n");
  const lines = [];
  for (const para of paras) {
    let line = "";
    for (const w of para.split(/\s+/).filter(Boolean)) {
      const test = line ? line + " " + w : w;
      if (font.widthOfTextAtSize(test, size) <= maxW) line = test;
      else { if (line) lines.push(line); line = w; }
    }
    lines.push(line);
  }
  return lines;
}

async function embedImg(doc, src) {
  try {
    let bytes;
    if (typeof src === "string" && src.startsWith("data:")) {
      const b64 = src.split(",")[1];
      bytes = isNode ? Buffer.from(b64, "base64")
        : Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    } else if (!isNode) {
      const res = await fetch(src);
      bytes = new Uint8Array(await res.arrayBuffer());
    } else return null;
    // PNG empieza con 0x89 0x50
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
    return isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  } catch { return null; }
}

async function build(formatKey, record, opts = {}) {
  const cfg = PLANTILLAS[formatKey];
  if (!cfg) throw new Error("Formato sin plantilla: " + formatKey);
  const data = record.data || {};

  const bytes = await fetchTemplate(cfg.file, opts.templateDir);
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, throwOnInvalidObject: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pages = doc.getPages();
  const P = (i) => pages[Math.min(i, pages.length - 1)];

  /* center: centra el texto dentro de [x, x+maxW] — así los datos quedan
     centrados sobre la línea del formato, como en los reportes en limpio. */
  const drawText = (page, text, x, y, size, maxW, useBold, center) => {
    if (text == null || text === "") return;
    const f = useBold ? bold : font;
    let t = String(text), s = size;
    if (maxW) {
      /* antes de recortar se reduce la letra: así los valores largos
         siguen leyéndose completos dentro de su casilla */
      const min = Math.max(4.5, size * 0.6);
      while (s > min && f.widthOfTextAtSize(t, s) > maxW) s -= 0.25;
      t = fit(f, t, s, maxW);
    }
    const dx = center && maxW ? Math.max(0, (maxW - f.widthOfTextAtSize(t, s)) / 2) : 0;
    page.drawText(t, { x: x + dx, y, size: s, font: f, color: INK });
  };
  /* (x,y) es el CENTRO de la casilla: la X se centra sobre ese punto para
     que nunca sobresalga del recuadro. 0.717 es la altura de mayúscula
     de Helvetica-Bold, así que y - 0.717*size/2 deja la X centrada. */
  const drawX = (page, x, y, size = 8) => {
    page.drawText("X", {
      x: x - bold.widthOfTextAtSize("X", size) / 2,
      y: y - size * 0.3585,
      size, font: bold, color: INK,
    });
  };

  /* número del documento */
  if (cfg.numero) {
    for (const n of cfg.numero) {
      drawText(P(n.page), record.numero || "", n.x, n.y, n.size || 10, n.maxW || 110, true, n.c);
    }
  }

  /* textos simples; join une varios campos en una misma línea */
  for (const t of cfg.text || []) {
    let val = t.date ? fmtDate(data[t.key]) : data[t.key];
    if (t.join) {
      val = [val, ...t.join.map((k) => data[k])]
        .map((v) => (v == null ? "" : String(v).trim()))
        .filter(Boolean)
        .join(t.sep || " / ");
    }
    drawText(P(t.page), val, t.x, t.y, t.size || 8, t.maxW, false, t.c);
  }

  /* valores partidos por "/" (corrientes A/B/C, frecuencia, etc.) */
  for (const tr of cfg.triple || []) {
    const val = data[tr.key];
    if (!val) continue;
    const parts = String(val).split("/").map((s) => s.trim());
    tr.ys.forEach((y, i) => {
      if (parts[i]) drawText(P(tr.page), parts[i], tr.x, y, tr.size || 7, tr.maxW, false, tr.c);
    });
  }

  /* un valor partido por "/" repartido en casillas sueltas [x,y,ancho] */
  for (const sl of cfg.slots || []) {
    const val = data[sl.key];
    if (!val) continue;
    const parts = String(val).split("/").map((s) => s.trim());
    sl.at.forEach(([x, y, w], i) => {
      if (parts[i]) drawText(P(sl.page), parts[i], x, y, sl.size || 7, w, false, true);
    });
  }

  /* texto multilínea */
  for (const w of cfg.wrap || []) {
    const val = data[w.key];
    if (!val) continue;
    const lines = wrapText(font, val, w.size || 8, w.maxW).slice(0, w.maxLines || 8);
    lines.forEach((line, i) => {
      drawText(P(w.page), line, w.x, w.y0 - i * w.lh, w.size || 8, w.maxW + 10);
    });
  }

  /* tablas de ítems */
  for (const it of cfg.items || []) {
    const rows = (data[it.key] || []).filter((r) => (r.descripcion || "").trim()).slice(0, it.max);
    rows.forEach((r, i) => {
      const y = it.y0 - i * it.step;
      drawText(P(it.page), String(r.cant ?? ""), it.cantX, y, it.size || 8, it.cantW || 35, false, true);
      drawText(P(it.page), r.descripcion, it.descX, y, it.size || 8, it.descMaxW);
    });
  }

  /* marcas X según selects */
  for (const m of cfg.marks || []) {
    const val = data[m.src || m.key];
    if (!val || !m.map[val]) continue;
    for (const [x, y] of m.map[val]) drawX(P(m.page), x, y);
  }

  /* checklists (fila → opción) */
  for (const g of cfg.grid || []) {
    const obj = data[g.src || g.key] || {};
    for (const [rowKey, y] of Object.entries(g.rows)) {
      const val = obj[rowKey];
      if (!val) continue;
      const x = g.opts[val];
      if (x != null) drawX(P(g.page), x, y, 7.5);
      else if (g.onlyYes && val === "Sí" && g.opts["Sí"] != null) drawX(P(g.page), g.opts["Sí"], y, 7.5);
    }
  }

  /* pruebas de plantas (Sí-Bien / Sí-Mal / No) */
  if (cfg.pruebas) {
    const obj = data.chk_pruebas || {};
    for (const [key, pos] of Object.entries(cfg.pruebas)) {
      if (key === "page") continue;
      const val = obj[key];
      if (!val) continue;
      const page = P(cfg.pruebas.page);
      if (val.startsWith("Sí")) {
        drawX(page, pos.si, pos.y, 7.5);
        if (val.includes("Bien")) drawX(page, pos.bien, pos.y, 7.5);
        if (val.includes("Mal")) drawX(page, pos.mal, pos.y, 7.5);
      } else if (val === "No") drawX(page, pos.no, pos.y, 7.5);
    }
  }

  /* baterías de plantas (marcas sueltas) */
  if (cfg.bateriasChk) {
    const obj = data.chk_baterias || {};
    const page = P(cfg.bateriasChk.page);
    if (obj.libres_mantenimiento === "Sí") drawX(page, ...cfg.bateriasChk.libres.si, 7.5);
    if (obj.libres_mantenimiento === "No") drawX(page, ...cfg.bateriasChk.libres.no, 7.5);
    for (const [key, pos] of Object.entries(cfg.bateriasChk.simple)) {
      if (obj[key] === "Sí") drawX(page, pos[0], pos[1], 7.5);
    }
  }

  /* tabla de voltajes por batería (UPS pág. 2) */
  if (cfg.baterias) {
    const rows = (data.voltajes_baterias || []).filter((r) => (r.descripcion || "").trim());
    if (rows.length) {
      const bt = cfg.baterias;
      const page = P(bt.page);
      const n = bt.numero;
      drawText(page, record.numero || "", n.x, n.y, n.size, n.maxW || 110, true, n.c);
      rows.slice(0, bt.max * bt.xBanks.length).forEach((r, i) => {
        const bank = Math.floor(i / bt.max);
        const row = i % bt.max;
        if (row === 0) drawText(page, String(bank + 1), bt.bancoNoX[bank], bt.bancoNoY, 8, 18, true, true);
        /* la plantilla ya trae numerada cada batería: solo va el voltaje */
        drawText(page, r.descripcion, bt.xBanks[bank], bt.yTop - row * bt.step, bt.size, bt.colW || 70, false, true);
      });
    }
  }

  /* firmas */
  for (const s of cfg.sigs || []) {
    const src = data[s.key];
    if (!src) continue;
    const img = await embedImg(doc, src);
    if (!img) continue;
    const scale = Math.min(s.h / img.height, s.maxW / img.width);
    const w = img.width * scale, h = img.height * scale;
    /* cx centra la firma sobre la línea en vez de anclarla por la izquierda */
    P(s.page).drawImage(img, { x: s.cx != null ? s.cx - w / 2 : s.x, y: s.y, width: w, height: h });
  }

  /* evidencia fotográfica: páginas extra al final (no toca la plantilla) */
  const fotos = data.imagenes || [];
  if (fotos.length) {
    const perPage = 4;
    for (let p = 0; p < fotos.length; p += perPage) {
      const page = doc.addPage([612, 792]);
      page.drawText("EVIDENCIA FOTOGRÁFICA — " + (record.numero || ""), {
        x: 50, y: 750, size: 12, font: bold, color: rgb(0.08, 0.08, 0.08),
      });
      page.drawLine({ start: { x: 50, y: 744 }, end: { x: 562, y: 744 }, thickness: 1.5, color: rgb(1, 0.77, 0) });
      const chunk = fotos.slice(p, p + perPage);
      for (let i = 0; i < chunk.length; i++) {
        const img = await embedImg(doc, chunk[i]);
        if (!img) continue;
        const cellW = 240, cellH = 310;
        const x0 = 50 + (i % 2) * 262;
        const y0 = 410 - Math.floor(i / 2) * 330;
        const scale = Math.min(cellW / img.width, cellH / img.height);
        const w = img.width * scale, h = img.height * scale;
        page.drawImage(img, { x: x0, y: y0 + (cellH - h), width: w, height: h });
        page.drawRectangle({ x: x0, y: y0 + (cellH - h), width: w, height: h, borderColor: rgb(0.2, 0.2, 0.2), borderWidth: 0.8 });
      }
    }
  }

  return doc;
}

const PDFGen = {
  build,
  async download(formatKey, record) {
    const doc = await build(formatKey, record);
    const bytes = await doc.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const name = (PLANTILLAS[formatKey].file || "documento.pdf").replace(/\.pdf$/i, "");
    a.download = `${name} - ${record.numero || ""}.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  },
  /* Blob URL en lugar de data-URI: los data-URI grandes (plantilla A.A ~8MB)
     superan el límite del iframe en Chrome y la vista previa sale en blanco. */
  _lastPreviewURL: null,
  async previewDataURL(formatKey, record) {
    const doc = await build(formatKey, record);
    const bytes = await doc.save();
    if (this._lastPreviewURL) URL.revokeObjectURL(this._lastPreviewURL);
    this._lastPreviewURL = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    return this._lastPreviewURL;
  },
};

if (isNode) module.exports = PDFGen;
else root.PDFGen = PDFGen;

})(typeof window !== "undefined" ? window : globalThis);
