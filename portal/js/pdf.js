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
const INK = rgb(0.05, 0.05, 0.35);      // azul oscuro tipo esfero
const MARCA = rgb(0.16, 0.72, 0.94);    // cian del relleno de las casillas
const MARCA_X = rgb(0.00, 0.42, 0.75);  // azul de la X donde no hay recuadro

const templateCache = {};

/* Ruta del logo de la empresa. En el navegador se sirve desde el sitio;
   en Node (pruebas) se lee del disco. */
function logoURL() {
  if (!isNode) return "img/logo.png";
  try {
    const p = require("path").join(__dirname, "..", "img", "logo.png");
    return "data:image/png;base64," + require("fs").readFileSync(p).toString("base64");
  } catch { return null; }
}

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

/* Deja el texto comparable: sin tildes, mayúsculas, espacios ni la unidad
   de voltaje, para que «480 VAC», «480v» y «480» se traten como iguales. */
function clave(s) {
  return String(s ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")   // quita tildes
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")                          // quita espacios y signos
    .replace(/V(AC|DC)?$/, "");                          // quita la unidad final
}

/* Busca en el mapa de opciones la que equivalga al valor escrito */
function igual(mapa, valor) {
  const k = clave(valor);
  if (!k) return undefined;
  return Object.keys(mapa).find((op) => clave(op) === k);
}

/* Parte un valor de varias medidas. Acepta «/», «-», «;» o coma como
   separador, porque en campo se escribe de las cuatro formas. */
function partir(val) {
  return String(val ?? "")
    .split(/[/;,]|\s-\s|(?<=\d)-(?=\d)/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
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

/* Carga una imagen y la incrusta en el PDF. Devuelve null si no se pudo,
   pero SIEMPRE deja el motivo en la consola: antes fallaba en silencio y
   las páginas de fotos salían en blanco sin ninguna pista. */
async function embedImg(doc, src) {
  try {
    if (typeof src !== "string" || !src) return null;
    let bytes;
    if (src.startsWith("data:")) {
      const b64 = src.split(",")[1] || "";
      bytes = isNode ? Buffer.from(b64, "base64")
        : Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    } else {
      const res = await fetch(src);
      if (!res.ok) throw new Error(`HTTP ${res.status} al descargar la imagen`);
      bytes = new Uint8Array(await res.arrayBuffer());
    }
    if (!bytes || bytes.length < 4) throw new Error("La imagen llegó vacía");
    /* pdf-lib lee la imagen con `new DataView(bytes.buffer)`, SIN tener en
       cuenta byteOffset. Buffer.from() de Node devuelve una vista sobre un
       búfer compartido más grande, así que pdf-lib leía desde el principio
       de ese búfer y no de la foto: de ahí el error «SOI not found in JPEG»
       y las páginas de evidencia en blanco. Con una copia propia el offset
       siempre es 0 y la imagen se incrusta bien. */
    if (bytes.byteOffset !== 0 || bytes.byteLength !== bytes.buffer.byteLength) {
      bytes = new Uint8Array(bytes);
    }
    // PNG empieza con 0x89 0x50
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
    return isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  } catch (e) {
    const ref = String(src || "").slice(0, 80);
    console.warn("No se pudo incrustar la imagen:", ref, "→", e.message);
    return null;
  }
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
  /* (x,y) es el CENTRO de la casilla. Si se conoce el tamaño del recuadro
     (box = [ancho, alto]) se rellena de color, como en los reportes hechos
     a mano, y la X va encima para que se siga leyendo impreso en blanco y
     negro. Donde la plantilla no dibuja recuadro (plantas y A.A marcan al
     lado de la palabra) va solo la X, en color.
     0.717 es la altura de mayúscula de Helvetica-Bold: restar 0.3585*size
     deja la X centrada en el punto. */
  /* Casilla dibujada por nosotros: la plantilla no trae recuadro impreso,
     así que se traza el cuadro vacío y la X va dentro. */
  const drawBoxX = (page, x, y, lado = 8) => {
    page.drawRectangle({
      x: x - lado / 2, y: y - lado / 2, width: lado, height: lado,
      borderColor: INK, borderWidth: 0.7,
    });
    const size = lado * 0.78;
    page.drawText("X", {
      x: x - bold.widthOfTextAtSize("X", size) / 2,
      y: y - size * 0.3585,
      size, font: bold, color: INK,
    });
  };
  const drawX = (page, x, y, size = 8, box = null, soloColor = false) => {
    if (box) {
      const [bw, bh] = box;
      const m = soloColor ? 0 : 0.55;       // deja ver el borde del recuadro
      page.drawRectangle({
        x: x - bw / 2 + m, y: y - bh / 2 + m,
        width: Math.max(bw - m * 2, 0), height: Math.max(bh - m * 2, 0),
        color: MARCA,
        /* el resalte va translúcido para que la letra impresa debajo
           (B / R / M) se siga leyendo */
        opacity: soloColor ? 0.5 : 1,
      });
      /* Donde la opción ya viene impresa (las letras B/R/M del formato de
         A.A) solo se resalta en color: una X encima taparía la letra. */
      if (soloColor) return;
      size = Math.min(size, bh * 0.82);     // la X nunca desborda la casilla
    }
    page.drawText("X", {
      x: x - bold.widthOfTextAtSize("X", size) / 2,
      y: y - size * 0.3585,
      size, font: bold, color: box ? INK : MARCA_X,
    });
  };

  /* número del documento */
  if (cfg.numero) {
    for (const n of cfg.numero) {
      drawText(P(n.page), record.numero || "", n.x, n.y, n.size || 10, n.maxW || 110, true, n.c);
    }
  }

  /* textos simples; join une varios campos en una misma línea y src
     permite repetir el mismo dato en otra página (p. ej. «HOJA _ DE _») */
  for (const t of cfg.text || []) {
    const origen = t.src || t.key;
    let val = t.date ? fmtDate(data[origen]) : data[origen];
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
    const parts = partir(val);
    tr.ys.forEach((y, i) => {
      if (parts[i]) drawText(P(tr.page), parts[i], tr.x, y, tr.size || 7, tr.maxW, false, tr.c);
    });
  }

  /* un valor partido por "/" repartido en casillas sueltas [x,y,ancho] */
  for (const sl of cfg.slots || []) {
    const val = data[sl.key];
    if (!val) continue;
    const parts = partir(val);
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

  /* Tablas de ítems. Una descripción larga ocupa varias filas de la tabla
     con la letra del mismo tamaño, en vez de encogerse hasta caber en una:
     el número del ítem se escribe solo en la primera fila, así una misma
     idea no gasta varios números. */
  for (const it of cfg.items || []) {
    const rows = (data[it.key] || []).filter((r) => (r.descripcion || "").trim());
    const size = it.size || 8;
    let fila = 0;
    for (const r of rows) {
      if (fila >= it.max) break;
      const lineas = wrapText(font, r.descripcion, size, it.descMaxW)
        .slice(0, it.max - fila);
      lineas.forEach((linea, n) => {
        const y = it.y0 - (fila + n) * it.step;
        if (n === 0) {
          drawText(P(it.page), String(r.cant ?? ""), it.cantX, y, size, it.cantW || 35, false, true);
        }
        drawText(P(it.page), linea, it.descX, y, size, it.descMaxW);
      });
      fila += lineas.length;
    }
  }

  /* marcas X — [x, y] o [x, y, ancho, alto] de la casilla.
     El valor puede venir de un select o escrito a mano, así que si no
     coincide exacto se compara sin tildes, mayúsculas ni unidades: «480»,
     «480V» y «480 vac» marcan la misma casilla que «480 VAC». */
  for (const m of cfg.marks || []) {
    const val = data[m.src || m.key];
    if (!val) continue;
    const pts = m.map[val] || m.map[igual(m.map, val)];
    if (!pts) continue;
    for (const [x, y, bw, bh] of pts) {
      drawX(P(m.page), x, y, 8, bw ? [bw, bh] : null, m.hl);
    }
  }

  /* checklists (fila → opción) */
  for (const g of cfg.grid || []) {
    const obj = data[g.src || g.key] || {};
    for (const [rowKey, y] of Object.entries(g.rows)) {
      const val = obj[rowKey];
      if (!val) continue;
      const x = g.opts[val];
      if (x != null) drawX(P(g.page), x, y, 7.5, g.box, g.hl);
      else if (g.onlyYes && val === "Sí" && g.opts["Sí"] != null) drawX(P(g.page), g.opts["Sí"], y, 7.5, g.box, g.hl);
    }
  }

  /* pruebas de plantas (Sí-Bien / Sí-Mal / No) */
  if (cfg.pruebas) {
    const obj = data.chk_pruebas || {};
    const caja = cfg.pruebas.box;
    for (const [key, pos] of Object.entries(cfg.pruebas)) {
      if (key === "page" || key === "box") continue;
      const val = obj[key];
      if (!val) continue;
      const page = P(cfg.pruebas.page);
      const hl = cfg.pruebas.hl;
      if (val.startsWith("Sí")) {
        drawX(page, pos.si, pos.y, 7.5, caja, hl);
        if (val.includes("Bien")) drawX(page, pos.bien, pos.y, 7.5, caja, hl);
        if (val.includes("Mal")) drawX(page, pos.mal, pos.y, 7.5, caja, hl);
      } else if (val === "No") drawX(page, pos.no, pos.y, 7.5, caja, hl);
    }
  }

  /* baterías de plantas (marcas sueltas) */
  if (cfg.bateriasChk) {
    const obj = data.chk_baterias || {};
    const page = P(cfg.bateriasChk.page);
    /* «Libres de mantenimiento» tiene las palabras SI/NO impresas: se
       resaltan. Las demás filas no traen palabra ni recuadro impreso, así
       que se les dibuja la casilla con la X dentro. */
    const caja = cfg.bateriasChk.box;
    if (obj.libres_mantenimiento === "Sí") drawX(page, ...cfg.bateriasChk.libres.si, 7.5, caja, true);
    if (obj.libres_mantenimiento === "No") drawX(page, ...cfg.bateriasChk.libres.no, 7.5, caja, true);
    for (const [key, pos] of Object.entries(cfg.bateriasChk.simple)) {
      if (obj[key] === "Sí") drawBoxX(page, pos[0], pos[1], cfg.bateriasChk.lado || 8);
    }
  }

  /* tabla de voltajes por batería (UPS pág. 2)
     Cada fila trae su banco (1..4) y va a la columna que le toca. Las que
     no lo traigan (registros anteriores) se reparten llenando un banco tras
     otro, como se hacía antes. */
  if (cfg.baterias) {
    const rows = (data.voltajes_baterias || []).filter((r) => (r.descripcion || "").trim());
    if (rows.length) {
      const bt = cfg.baterias;
      const page = P(bt.page);
      const n = bt.numero;
      drawText(page, record.numero || "", n.x, n.y, n.size, n.maxW || 110, true, n.c);

      const nBancos = bt.xBanks.length;
      const porBanco = Array.from({ length: nBancos }, () => []);
      rows.forEach((r, i) => {
        const banco = Number(r.banco) >= 1 && Number(r.banco) <= nBancos
          ? Number(r.banco) - 1
          : Math.floor(i / bt.max);
        if (banco < nBancos) porBanco[banco].push(r);
      });

      porBanco.forEach((lista, banco) => {
        if (!lista.length) return;
        drawText(page, String(banco + 1), bt.bancoNoX[banco], bt.bancoNoY, 8, bt.bancoNoW || 18, true, true);
        /* la plantilla ya trae numerada cada batería: solo va el voltaje */
        lista.slice(0, bt.max).forEach((r, fila) => {
          drawText(page, r.descripcion, bt.xBanks[banco], bt.yTop - fila * bt.step,
                   bt.size, bt.colW || 70, false, true);
        });
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

  /* ---------- REGISTRO FOTOGRÁFICO ----------
     Páginas extra al final (no tocan la plantilla): 6 fotos por página en
     dos columnas por tres filas, cada una numerada «Figura N.» con su
     descripción debajo. Cada foto puede ser un texto (la imagen suelta) o
     un objeto { src, desc }. */
  const fotos = (data.imagenes || []).map((f) =>
    (f && typeof f === "object") ? f : { src: f, desc: "" });

  if (fotos.length) {
    const COLS = 2, FILAS = 3, PORPAG = COLS * FILAS;
    const MX = 45;                                  // margen lateral
    const CELDA_W = (612 - MX * 2) / COLS;          // 261
    const CELDA_H = 218;                            // foto + pie
    const PIE_H = 26;                               // alto del pie de foto
    const TOP = 726;                                // borde superior de la rejilla
    const GRIS = rgb(0.25, 0.25, 0.25);

    /* El logo se carga y se incrusta UNA sola vez para todas las hojas
       de fotos; las hojas de la plantilla ya lo traen impreso. */
    const logo = await embedImg(doc, opts.logo || logoURL());

    for (let p = 0; p < fotos.length; p += PORPAG) {
      const page = doc.addPage([612, 792]);
      const numero = record.numero || "";

      /* encabezado: logo arriba a la izquierda, como en la plantilla */
      if (logo) {
        const alto = 42;
        const ancho = logo.width * (alto / logo.height);
        page.drawImage(logo, { x: MX, y: 748 - alto / 2, width: ancho, height: alto });
      }
      const titulo = "REGISTRO FOTOGRÁFICO";
      page.drawText(titulo, {
        x: (612 - bold.widthOfTextAtSize(titulo, 13)) / 2,
        y: 752, size: 13, font: bold, color: rgb(0.08, 0.08, 0.08),
      });
      if (numero) {
        drawText(page, numero, MX, 738, 9, 612 - MX * 2, true, true);
      }
      page.drawLine({
        start: { x: MX, y: TOP + 4 }, end: { x: 612 - MX, y: TOP + 4 },
        thickness: 1.5, color: rgb(1, 0.77, 0),
      });

      const chunk = fotos.slice(p, p + PORPAG);
      for (let i = 0; i < chunk.length; i++) {
        const col = i % COLS, fila = Math.floor(i / COLS);
        const x0 = MX + col * CELDA_W;
        const yTop = TOP - fila * CELDA_H;           // borde superior de la celda
        const yBase = yTop - CELDA_H;                // borde inferior de la celda
        const areaH = CELDA_H - PIE_H;

        /* recuadro de la celda */
        page.drawRectangle({
          x: x0, y: yBase, width: CELDA_W, height: CELDA_H,
          borderColor: GRIS, borderWidth: 0.8,
        });
        page.drawLine({
          start: { x: x0, y: yBase + PIE_H }, end: { x: x0 + CELDA_W, y: yBase + PIE_H },
          thickness: 0.8, color: GRIS,
        });

        /* la foto, centrada y sin deformar dentro de su celda */
        const img = await embedImg(doc, chunk[i].src);
        if (img) {
          const escala = Math.min((CELDA_W - 10) / img.width, (areaH - 10) / img.height);
          const w = img.width * escala, h = img.height * escala;
          page.drawImage(img, {
            x: x0 + (CELDA_W - w) / 2,
            y: yBase + PIE_H + (areaH - h) / 2,
            width: w, height: h,
          });
        } else {
          /* si la imagen no se pudo cargar, se deja constancia en el PDF
             en vez de dejar el hueco en blanco sin explicación */
          const aviso = "(No se pudo cargar la imagen)";
          page.drawText(aviso, {
            x: x0 + (CELDA_W - font.widthOfTextAtSize(aviso, 8)) / 2,
            y: yBase + PIE_H + areaH / 2, size: 8, font, color: rgb(0.6, 0.2, 0.2),
          });
        }

        /* pie: «Figura N.» en negrita y la descripción a continuación */
        const etiqueta = `Figura ${p + i + 1}.`;
        const anchoEtiqueta = bold.widthOfTextAtSize(etiqueta, 8);
        page.drawText(etiqueta, {
          x: x0 + 5, y: yBase + PIE_H - 11, size: 8, font: bold, color: rgb(0.08, 0.08, 0.08),
        });
        const desc = String(chunk[i].desc || "").trim();
        if (desc) {
          const libre = CELDA_W - 12 - anchoEtiqueta - 3;
          const lineas = wrapText(font, desc, 8, libre).slice(0, 2);
          lineas.forEach((linea, n) => {
            page.drawText(fit(font, linea, 8, n === 0 ? libre : CELDA_W - 12), {
              x: n === 0 ? x0 + 5 + anchoEtiqueta + 3 : x0 + 5,
              y: yBase + PIE_H - 11 - n * 9.5,
              size: 8, font, color: rgb(0.08, 0.08, 0.08),
            });
          });
        }
      }
    }
  }

  /* «HOJA _ DE _»: el total se cuenta al final, cuando ya se sabe cuántas
     paginas de fotos se agregaron, y se escribe en cada sitio donde la
     plantilla lo pide. El numero de hoja es el de la pagina donde va. */
  if (cfg.hojas) {
    const total = String(doc.getPageCount());
    for (const h of cfg.hojas) {
      drawText(P(h.page), String(h.n), h.xn, h.y, h.size || 8, h.w || 16, false, true);
      drawText(P(h.page), total, h.xt, h.y, h.size || 8, h.w || 16, false, true);
    }
  }

  return doc;
}

const PDFGen = {
  build,
  async download(formatKey, record, nombreArchivo) {
    const doc = await build(formatKey, record);
    const bytes = await doc.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const name = (PLANTILLAS[formatKey].file || "documento.pdf").replace(/\.pdf$/i, "");
    const propuesto = `${name} - ${record.numero || ""}`;
    /* El nombre lo puede elegir quien descarga; se limpian los caracteres
       que Windows no admite en un nombre de archivo. */
    const elegido = String(nombreArchivo || propuesto)
      .trim()
      .replace(/[\\/:*?"<>|]/g, "-")
      .replace(/\.pdf$/i, "");
    a.download = (elegido || propuesto) + ".pdf";
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
