/* ============================================================
   Auditoría de variables: cruza los campos del formulario
   (js/formats.js) con el mapa de coordenadas del PDF
   (js/plantillas.js) para cada uno de los 5 formatos.

   Uso:  node tools/audit-campos.js   (desde la carpeta portal/)

   Reporta:
   - Campos del formulario que NO se imprimen en el PDF
   - Claves del PDF que NO existen en el formulario (nunca se llenan)
   ============================================================ */
const path = require("path");

global.window = globalThis; // formats.js espera window
require(path.join(__dirname, "..", "js", "formats.js"));
const PLANTILLAS = require(path.join(__dirname, "..", "js", "plantillas.js"));
const FORMATS = global.window.FORMATS;

let problemas = 0;

for (const key of Object.keys(FORMATS)) {
  const format = FORMATS[key];
  const plantilla = PLANTILLAS[key];
  if (!plantilla) {
    console.log(`\n[${key}] SIN PLANTILLA`);
    problemas++;
    continue;
  }

  /* claves que el formulario captura */
  const formKeys = new Set(format.fields.filter((f) => !f.section).map((f) => f.key));

  /* claves que la plantilla imprime */
  const pdfKeys = new Set();
  (plantilla.text || []).forEach((t) => pdfKeys.add(t.key));
  (plantilla.wrap || []).forEach((w) => pdfKeys.add(w.key));
  (plantilla.triple || []).forEach((t) => pdfKeys.add(t.key));
  (plantilla.items || []).forEach((i) => pdfKeys.add(i.key));
  (plantilla.sigs || []).forEach((s) => pdfKeys.add(s.key));
  (plantilla.marks || []).forEach((m) => pdfKeys.add(m.src || m.key));
  (plantilla.grid || []).forEach((g) => pdfKeys.add(g.src || g.key));
  if (plantilla.baterias) pdfKeys.add("voltajes_baterias");
  if (plantilla.pruebas) pdfKeys.add("chk_pruebas");
  if (plantilla.bateriasChk) pdfKeys.add("chk_baterias");
  pdfKeys.add("imagenes"); // siempre van como páginas anexas

  const sinImprimir = [...formKeys].filter((k) => !pdfKeys.has(k));
  const sinFormulario = [...pdfKeys].filter((k) => !formKeys.has(k) && k !== "imagenes");

  console.log(`\n=== ${format.name} (${key}) ===`);
  console.log(`  Campos en formulario: ${formKeys.size} · Claves en PDF: ${pdfKeys.size}`);
  if (sinImprimir.length) {
    console.log(`  ⚠ En formulario pero NO se imprimen en el PDF: ${sinImprimir.join(", ")}`);
    problemas += sinImprimir.length;
  }
  if (sinFormulario.length) {
    console.log(`  ⚠ En el PDF pero SIN campo en el formulario: ${sinFormulario.join(", ")}`);
    problemas += sinFormulario.length;
  }
  if (!sinImprimir.length && !sinFormulario.length) console.log("  ✓ Todo cruzado correctamente");
}

console.log(`\n${problemas === 0 ? "AUDITORÍA OK" : "TOTAL DISCREPANCIAS: " + problemas}`);
process.exit(problemas === 0 ? 0 : 1);
