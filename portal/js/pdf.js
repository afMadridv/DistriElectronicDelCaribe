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
    /* Abierto con doble clic (file://) el navegador bloquea fetch y lo único
       que dice es «Failed to fetch»: se explica el motivo real. */
    if (location.protocol === "file:") {
      throw new Error("el portal está abierto como archivo (doble clic en index.html) y el navegador no deja cargar las plantillas. Ábrelo desde su dirección web.");
    }
    let res;
    try { res = await fetch("plantillas/" + encodeURIComponent(file)); }
    catch (e) { throw new Error("sin conexión: no se pudo descargar la plantilla " + file + "."); }
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

/* Ancho del texto. La «Ω» no existe en Helvetica (se dibuja con la fuente
   Symbol, ver `pintar`): para medir se cuenta como una «O», que ocupa
   prácticamente lo mismo (778 contra 768 milésimas). */
function medir(font, text, size) {
  return font.widthOfTextAtSize(String(text ?? "").replace(/Ω/g, "O"), size);
}

/* recorta el texto al ancho disponible */
function fit(font, text, size, maxW) {
  let t = String(text ?? "");
  if (!maxW) return t;
  while (medir(font, t, size) > maxW && t.length > 1) t = t.slice(0, -1);
  return t;
}

/* Las fuentes estándar del PDF solo traen el juego WinAnsi (latín): un
   carácter fuera de él, como «Ω», «≥» o un emoji escrito desde el celular,
   hacía fallar el PDF entero. Se cambia por su equivalente o se omite; la
   «Ω» se conserva porque se dibuja aparte con la fuente Symbol. */
const EQUIVALENTES = { "Ω": "Ω", "≤": "<=", "≥": ">=", "≠": "!=", "≈": "~", "μ": "µ", " ": " " };

function limpiarTexto(s, juego) {
  let out = "";
  for (const ch of s) {
    if (ch === "Ω" || ch === "\n" || juego.has(ch.codePointAt(0))) { out += ch; continue; }
    if (EQUIVALENTES[ch]) { out += EQUIVALENTES[ch]; continue; }
    if (/\s/.test(ch)) { out += " "; continue; }
    const sinTilde = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
    if (sinTilde !== ch && [...sinTilde].every((c) => juego.has(c.codePointAt(0)))) out += sinTilde;
  }
  return out;
}

/* Limpia todos los textos del registro; las imágenes (data:, rutas y URLs)
   son ASCII y se dejan tal cual para no recorrerlas carácter a carácter. */
function limpiarDatos(v, juego) {
  if (typeof v === "string") return /^(data:|https?:|blob:)/.test(v) ? v : limpiarTexto(v, juego);
  if (Array.isArray(v)) return v.map((x) => limpiarDatos(x, juego));
  if (v && typeof v === "object") {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = limpiarDatos(x, juego);
    return o;
  }
  return v;
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

/* filas escritas de una tabla de ítems; sin ninguna, la tabla dice algo
   («Ninguno») en vez de quedar en blanco */
function filasItems(it, data) {
  const rows = (data[it.key] || []).filter((r) => (r.descripcion || "").trim());
  return !rows.length && it.vacio ? [{ cant: "", descripcion: it.vacio }] : rows;
}

function wrapText(font, text, size, maxW) {
  const words = String(text ?? "").replace(/\r/g, "").split(/\s+|\n/);
  const paras = String(text ?? "").replace(/\r/g, "").split("\n");
  const lines = [];
  for (const para of paras) {
    let line = "";
    for (const w of para.split(/\s+/).filter(Boolean)) {
      const test = line ? line + " " + w : w;
      if (medir(font, test, size) <= maxW) line = test;
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

/* Número que va impreso en el formato. Donde la plantilla pide un número
   que se escribe a mano (el No. OTT del UPS, como una orden de compra) va
   el que digitó quien llenó el formulario, y si lo dejó vacío la casilla
   queda en blanco. En los demás formatos, el consecutivo del sistema, que
   de todas formas sigue identificando el registro en el historial. */
function numeroImpreso(formatKey, record) {
  const campo = (PLANTILLAS[formatKey] || {}).numeroCampo;
  if (campo) return String((record.data || {})[campo] ?? "").trim();
  return record.numero || "";
}

/* ---------- DATOS PARA VOLVER A IMPORTAR ----------
   Cada PDF que se descarga lleva adentro, como archivo adjunto, los datos
   del formulario con sus fotos y firmas. Si el registro se borra del
   portal, ese PDF sirve de copia: se importa y se sigue editando. */
const ADJUNTO = "datos-portal.json";
const PORTAL = "DistriElectronicDelCaribe";

/* foto firmada (URL) → dataURL, para que la copia no dependa del almacenamiento */
async function aDataURL(src) {
  if (typeof src !== "string" || !/^(https?:|blob:)/.test(src)) return src;
  try {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    return await new Promise((ok, mal) => {
      const r = new FileReader();
      r.onload = () => ok(r.result);
      r.onerror = () => mal(r.error);
      r.readAsDataURL(blob);
    });
  } catch (e) {
    console.warn("La foto no quedó dentro de la copia del PDF:", e.message);
    return src;
  }
}

/* Mismo criterio que Store.hydrateImages: listas de fotos (ruta o {src, desc}) */
async function datosPortables(formatKey, record) {
  const data = { ...(record.data || {}) };
  const esFoto = (v) => typeof v === "string" || (v && typeof v === "object" && typeof v.src === "string");
  for (const [k, arr] of Object.entries(data)) {
    if (!Array.isArray(arr) || !arr.length || !arr.every(esFoto)) continue;
    data[k] = await Promise.all(arr.map(async (v) =>
      typeof v === "string" ? aDataURL(v) : { ...v, src: await aDataURL(v.src) }));
  }
  return {
    portal: PORTAL, version: 1, format_type: formatKey,
    numero: record.numero || "", nombre: record.nombre || "", exportado: new Date().toISOString(), data,
  };
}

/* Lee los datos adjuntos de un PDF descargado del portal (null si no trae) */
async function leerDatos(bytes) {
  const { PDFName, PDFDict, PDFArray, decodePDFRawStream } = PDFLib;
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
  const names = doc.catalog.lookupMaybe(PDFName.of("Names"), PDFDict);
  const raiz = names && names.lookupMaybe(PDFName.of("EmbeddedFiles"), PDFDict);
  if (!raiz) return null;
  // árbol de nombres: pares [nombre, especificación] directos o en Kids
  const pares = [];
  const recorrer = (nodo) => {
    const arr = nodo.lookupMaybe(PDFName.of("Names"), PDFArray);
    if (arr) for (let i = 0; i + 1 < arr.size(); i += 2) pares.push([arr.lookup(i), arr.lookup(i + 1)]);
    const kids = nodo.lookupMaybe(PDFName.of("Kids"), PDFArray);
    if (kids) for (let i = 0; i < kids.size(); i++) recorrer(kids.lookup(i, PDFDict));
  };
  recorrer(raiz);
  for (const [nombre, spec] of pares) {
    if (!nombre || typeof nombre.decodeText !== "function" || nombre.decodeText() !== ADJUNTO) continue;
    const ef = spec.lookup(PDFName.of("EF"), PDFDict);
    const bruto = decodePDFRawStream(ef.lookup(PDFName.of("F"))).decode();
    const datos = JSON.parse(new TextDecoder().decode(bruto));
    return datos && datos.portal === PORTAL ? datos : null;
  }
  return null;
}

async function build(formatKey, record, opts = {}) {
  const cfg = PLANTILLAS[formatKey];
  if (!cfg) throw new Error("Formato sin plantilla: " + formatKey);

  const bytes = await fetchTemplate(cfg.file, opts.templateDir);
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, throwOnInvalidObject: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const symbol = await doc.embedFont(StandardFonts.Symbol);
  const data = limpiarDatos(record.data || {}, new Set(font.getCharacterSet()));
  const numeroDoc = numeroImpreso(formatKey, { ...record, data });
  const pages = doc.getPages();
  const P = (i) => pages[Math.min(i, pages.length - 1)];

  /* Escribe el texto por tramos: las «Ω» van con la fuente Symbol y el
     resto con la fuente pedida, uno pegado al otro. */
  const pintar = (page, t, x, y, size, f, color) => {
    let cx = x;
    for (const tramo of String(t).split(/(Ω+)/)) {
      if (!tramo) continue;
      const ff = tramo[0] === "Ω" ? symbol : f;
      page.drawText(tramo, { x: cx, y, size, font: ff, color });
      cx += ff.widthOfTextAtSize(tramo, size);
    }
  };

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
      while (s > min && medir(f, t, s) > maxW) s -= 0.25;
      t = fit(f, t, s, maxW);
    }
    const dx = center && maxW ? Math.max(0, (maxW - medir(f, t, s)) / 2) : 0;
    pintar(page, t, x + dx, y, s, f, INK);
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
      drawText(P(n.page), numeroDoc, n.x, n.y, n.size || 10, n.maxW || 110, true, n.c);
    }
  }

  /* rótulo en negro: serif imita la letra de la plantilla (Times negrita);
     con x1 va centrado en [x0, x1], sin x1 alineado a la izquierda */
  let timesBold = null;
  const rotulo = async (pg, r) => {
    const s = r.size || 8;
    const f = r.serif ? (timesBold ||= await doc.embedFont(StandardFonts.TimesRomanBold)) : bold;
    const w = f.widthOfTextAtSize(r.t, s);
    const x = r.x1 != null ? r.x0 + (r.x1 - r.x0 - w) / 2 : r.x0;
    pg.drawText(r.t, { x, y: r.y, size: s, font: f, color: rgb(0, 0, 0) });
  };

  /* retoques fijos sobre la plantilla (p. ej. partir una columna en dos):
     tapa en blanco, líneas y rótulos en negro, como si fueran del formato */
  for (const pa of cfg.parches || []) {
    const pg = P(pa.page);
    for (const [x, y, w, h] of pa.blanco || []) pg.drawRectangle({ x, y, width: w, height: h, color: rgb(1, 1, 1) });
    for (const [x1, y1, x2, y2, g] of pa.lineas || []) {
      pg.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: g || 0.8, color: rgb(0, 0, 0) });
    }
    for (const r of pa.rotulos || []) await rotulo(pg, r);
  }

  /* ---------- tabla que crece (cfg.elastica) ----------
     Las filas que necesita cada tabla se cuentan con el mismo corte de
     líneas con que se escriben. `ajuste` cambia, solo para este PDF, la
     primera fila (dy) y el tope de filas (max) de cada dato. */
  const ajuste = {};
  const el = cfg.elastica;
  if (el) {
    const lineasItems = (key) => {
      const it = (cfg.items || []).find((i) => i.key === key);
      return it ? filasItems(it, data).reduce((n, r) => n + wrapText(font, r.descripcion, it.size || 8, it.descMaxW).length, 0) : 0;
    };
    const lineasWrap = (key) => {
      const w = (cfg.wrap || []).find((x) => x.key === key);
      return w && data[key] ? wrapText(font, data[key], w.size || 8, w.maxW).length : 0;
    };
    const faltan = lineasItems(el.arriba) - el.filasArriba;
    const necesitaAbajo = Math.max(el.minAbajo, ...el.abajoItems.map(lineasItems), ...el.abajoWrap.map(lineasWrap));
    const extra = faltan > 0 ? Math.max(0, Math.min(faltan, el.filasAbajo - necesitaAbajo)) : 0;
    if (extra) {
      const d = extra * el.paso, g = el.grosor, negro = rgb(0, 0, 0);
      const pg = P(el.page);
      ajuste[el.arriba] = { max: el.filasArriba + extra };
      for (const k of [...el.abajoItems, ...el.abajoWrap]) ajuste[k] = { dy: -d, max: el.filasAbajo - extra };

      const [zx, zy, zw, zh] = el.zona;
      pg.drawRectangle({ x: zx, y: zy, width: zw, height: zh, color: rgb(1, 1, 1) });
      const linea = (y) => pg.drawRectangle({ x: el.x0, y, width: el.x1 + g - el.x0, height: g, color: negro });
      const vertical = (x, abajo, arriba) => pg.drawRectangle({ x, y: abajo, width: g, height: arriba - abajo, color: negro });

      // filas nuevas de la tabla de arriba
      for (let k = 1; k <= extra; k++) linea(el.fondoArriba - k * el.paso);
      for (const x of [el.x0, ...el.colsArriba, el.x1]) vertical(x, el.fondoArriba - d, el.fondoArriba + g);

      // título y tabla de abajo, corridos hacia abajo; su fondo no se mueve
      const t = el.titulo;
      await rotulo(pg, { t: t.t, x0: t.x, y: t.y - d, size: t.size, serif: true });
      const tope = el.topeAbajo - d;
      const filas = Math.round((tope - el.fondoAbajo) / el.paso);
      for (let k = 0; k <= filas; k++) linea(tope - k * el.paso);
      for (const x of [el.x0, ...el.colsAbajo, el.x1]) vertical(x, el.fondoAbajo, tope + g);
      for (const r of el.encabezado) await rotulo(pg, { ...r, y: r.y - d });
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

  /* Lo que no cabe en la plantilla (con `continua`) no se pierde: sigue en
     hojas de continuación al final, antes de las fotos. */
  const continuacion = [];   // { titulo, filas: [{ cant, texto }] } o { titulo, texto }
  // nota pequeña bajo la tabla, alineada a su borde derecho
  const avisoSigue = (page, xDer, y) => {
    const t = "Continúa en la hoja siguiente";
    page.drawText(t, { x: xDer - font.widthOfTextAtSize(t, 6.5), y, size: 6.5, font, color: INK });
  };

  /* texto multilínea */
  for (const w0 of cfg.wrap || []) {
    const val = data[w0.key];
    if (!val) continue;
    const aj = ajuste[w0.key] || {};
    const w = { ...w0, y0: w0.y0 + (aj.dy || 0), maxLines: aj.max ?? w0.maxLines };
    const todas = wrapText(font, val, w.size || 8, w.maxW);
    const max = w.maxLines || 8;
    todas.slice(0, max).forEach((line, i) => {
      drawText(P(w.page), line, w.x, w.y0 - i * w.lh, w.size || 8, w.maxW + 10);
    });
    if (w.continua && todas.length > max) {
      continuacion.push({ titulo: w.continua, texto: todas.slice(max).join(" ") });
      avisoSigue(P(w.page), w.x + w.maxW, w.y0 - max * w.lh);
    }
  }

  /* Tablas de ítems. Una descripción larga ocupa varias filas de la tabla
     con la letra del mismo tamaño, en vez de encogerse hasta caber en una:
     el número del ítem se escribe solo en la primera fila, así una misma
     idea no gasta varios números. */
  for (const it0 of cfg.items || []) {
    const aj = ajuste[it0.key] || {};
    const it = { ...it0, y0: it0.y0 + (aj.dy || 0), max: aj.max ?? it0.max };
    const rows = filasItems(it, data);
    const size = it.size || 8;
    const sigue = [];
    let fila = 0;
    for (const r of rows) {
      wrapText(font, r.descripcion, size, it.descMaxW).forEach((linea, n) => {
        const cant = n === 0 ? String(r.cant ?? "") : "";
        if (fila >= it.max) { sigue.push({ cant, texto: linea }); return; }
        const y = it.y0 - fila * it.step;
        drawText(P(it.page), cant, it.cantX, y, size, it.cantW || 35, false, true);
        drawText(P(it.page), linea, it.descX, y, size, it.descMaxW);
        fila++;
      });
    }
    if (it.continua && sigue.length) {
      continuacion.push({ titulo: it.continua, columnas: it.columnas, filas: sigue });
      avisoSigue(P(it.page), it.descX + it.descMaxW, it.y0 - it.max * it.step);
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
    /* Voltaje y resistencia llegan solo como números y aquí se les pone la
       unidad. Los registros de antes traen todo escrito en «descripcion». */
    const unidades = cfg.baterias.unidades || {};
    const medida = (r) => {
      const partes = Object.entries(unidades)
        .filter(([k]) => String(r[k] ?? "").trim())
        .map(([k, u]) => `${String(r[k]).trim()} ${u}`);
      return partes.length ? partes.join("  ") : String(r.descripcion || "").trim();
    };
    const rows = (data.voltajes_baterias || []).filter((r) => medida(r));
    if (rows.length) {
      const bt = cfg.baterias;
      const page = P(bt.page);
      const n = bt.numero;
      drawText(page, numeroDoc, n.x, n.y, n.size, n.maxW || 110, true, n.c);

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
          drawText(page, medida(r), bt.xBanks[banco], bt.yTop - fila * bt.step,
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

  /* ---------- HOJAS DE CONTINUACIÓN ----------
     Del tamaño de la plantilla: encabezado con el logo, el formato y sus
     datos, y cada parte que no cupo en su propia tabla (ÍTEM | DESCRIPCIÓN,
     o una sola columna para el texto). */
  if (continuacion.length) {
    const { width: W, height: H } = pages[0].getSize();
    const logo = await embedImg(doc, opts.logo || logoURL());
    const NEGRO = rgb(0, 0, 0);
    const MX = 50, PASO = 14, LETRA = 9, PIE = 50;
    const x0 = MX, x1 = W - MX, xm = MX + 62;
    let page, y;

    const hoja = () => {
      page = doc.addPage([W, H]);
      if (logo) {
        const alto = 42, ancho = logo.width * (alto / logo.height);
        page.drawImage(logo, { x: MX, y: H - 70, width: ancho, height: alto });
      }
      const titulo = cfg.titulo || "FORMATO";
      page.drawText(titulo, { x: (W - bold.widthOfTextAtSize(titulo, 13)) / 2, y: H - 52, size: 13, font: bold, color: NEGRO });
      const sub = "Continuación";
      page.drawText(sub, { x: (W - font.widthOfTextAtSize(sub, 9)) / 2, y: H - 65, size: 9, font, color: NEGRO });
      const datos = [numeroDoc, data.cliente, fmtDate(data.fecha)].filter(Boolean).join("  ·  ");
      drawText(page, datos, MX, H - 92, 9, x1 - MX, false, true);
      page.drawLine({ start: { x: MX, y: H - 100 }, end: { x: x1, y: H - 100 }, thickness: 1.5, color: rgb(1, 0.77, 0) });
      y = H - 122;
    };
    const celda = (xa, xb, alto, relleno) => page.drawRectangle({
      x: xa, y: y - alto + PASO - 4, width: xb - xa, height: alto,
      borderColor: NEGRO, borderWidth: 0.6, ...(relleno ? { color: rgb(0.93, 0.93, 0.93) } : {}),
    });
    const encabezado = (sec, sigueDe) => {
      if (!page || y - PASO * 3 < PIE) hoja();
      const t = sec.titulo + (sigueDe ? " (continuación)" : "");
      page.drawText(t, { x: x0, y, size: 11, font: bold, color: NEGRO });
      y -= PASO + 6;
      if (!sec.filas) return;
      const [cItem, cDesc] = sec.columnas || ["ITEM", "DESCRIPCIÓN"];
      celda(x0, xm, PASO, true); celda(xm, x1, PASO, true);
      page.drawText(cItem, { x: x0 + (xm - x0 - bold.widthOfTextAtSize(cItem, 8)) / 2, y, size: 8, font: bold, color: NEGRO });
      page.drawText(cDesc, { x: xm + (x1 - xm - bold.widthOfTextAtSize(cDesc, 8)) / 2, y, size: 8, font: bold, color: NEGRO });
      y -= PASO;
    };

    for (const sec of continuacion) {
      const filas = sec.filas
        || wrapText(font, sec.texto, LETRA, x1 - x0 - 10).map((texto) => ({ texto }));
      encabezado(sec, true);
      for (const f of filas) {
        if (y < PIE) { hoja(); encabezado(sec, true); }
        if (sec.filas) {
          celda(x0, xm, PASO); celda(xm, x1, PASO);
          drawText(page, f.cant, x0, y, LETRA, xm - x0, false, true);
          drawText(page, f.texto, xm + 5, y, LETRA, x1 - xm - 10);
        } else {
          celda(x0, x1, PASO);
          drawText(page, f.texto, x0 + 5, y, LETRA, x1 - x0 - 10);
        }
        y -= PASO;
      }
      y -= PASO;
    }
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
      const numero = numeroDoc;

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
            pintar(page, fit(font, linea, 8, n === 0 ? libre : CELDA_W - 12),
              n === 0 ? x0 + 5 + anchoEtiqueta + 3 : x0 + 5,
              yBase + PIE_H - 11 - n * 9.5, 8, font, rgb(0.08, 0.08, 0.08));
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

  if (opts.adjunto) {
    await doc.attach(new TextEncoder().encode(JSON.stringify(opts.adjunto)), ADJUNTO, {
      mimeType: "application/json",
      description: "Datos del formato para importarlo al portal",
      creationDate: new Date(), modificationDate: new Date(),
    });
  }

  return doc;
}

/* El nombre lo puede elegir quien descarga; se limpian los caracteres
   que Windows no admite en un nombre de archivo. */
function nombreArchivo(formatKey, record, elegido) {
  const name = (PLANTILLAS[formatKey].file || "documento.pdf").replace(/\.pdf$/i, "");
  const propuesto = `${name} - ${numeroImpreso(formatKey, record) || record.numero || ""}`;
  const limpio = String(elegido || record.nombre || propuesto).trim().replace(/[\\/:*?"<>|]/g, "-").replace(/\.pdf$/i, "");
  return (limpio || propuesto) + ".pdf";
}

const PDFGen = {
  build,
  numeroImpreso,
  leerDatos,
  /* PDF con sus datos adjuntos (record con las fotos ya firmadas) */
  async archivo(formatKey, record, elegido) {
    const doc = await build(formatKey, record, { adjunto: await datosPortables(formatKey, record) });
    return { bytes: await doc.save(), nombre: nombreArchivo(formatKey, record, elegido) };
  },
  async download(formatKey, record, elegido) {
    const { bytes, nombre } = await this.archivo(formatKey, record, elegido);
    const blob = new Blob([bytes], { type: "application/pdf" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = nombre;
    a.click();
    /* el enlace sigue vivo 10 min: el aviso «PDF listo» lo usa para
       abrir el archivo con un toque */
    setTimeout(() => URL.revokeObjectURL(a.href), 10 * 60000);
    return { url: a.href, nombre: a.download };
  },
  /* Blob URL en lugar de data-URI: los data-URI grandes (plantilla A.A ~8MB)
     superan el límite del iframe en Chrome y la vista previa sale en blanco. */
  _lastPreviewURL: null,
  /* bytes del PDF para el visor propio (celulares y tablets) */
  async previewBytes(formatKey, record) {
    const doc = await build(formatKey, record);
    return doc.save();
  },
  async previewDataURL(formatKey, record) {
    const bytes = await this.previewBytes(formatKey, record);
    if (this._lastPreviewURL) URL.revokeObjectURL(this._lastPreviewURL);
    this._lastPreviewURL = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    return this._lastPreviewURL;
  },
};

if (isNode) module.exports = PDFGen;
else root.PDFGen = PDFGen;

})(typeof window !== "undefined" ? window : globalThis);
