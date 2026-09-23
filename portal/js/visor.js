/* ============================================================
   Visor de PDF propio para celulares y tablets.
   Chrome de Android no muestra un PDF dentro de un iframe (lo
   descarga) y el iPad solo enseña la primera página. Aquí cada
   página se dibuja como imagen con PDF.js, debajo del formulario,
   igual que la vista previa del computador.
   PDF.js se descarga solo la primera vez que se usa.
   ============================================================ */
(function () {
  const BASE = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/";
  let cargando = null;
  let turno = 0;

  function cargar() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (!cargando) {
      cargando = new Promise((ok, mal) => {
        const s = document.createElement("script");
        s.src = BASE + "pdf.min.js";
        s.async = true;
        s.onload = () => {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = BASE + "pdf.worker.min.js";
          ok(window.pdfjsLib);
        };
        s.onerror = () => {
          cargando = null; // permite reintentar cuando vuelva la conexión
          mal(new Error("no se pudo cargar el visor de PDF. Revisa tu conexión."));
        };
        document.head.appendChild(s);
      });
    }
    return cargando;
  }

  /* Dibuja todas las páginas dentro de `cont`, a su ancho. Si llega otra
     vista previa mientras tanto, la anterior se abandona. */
  async function pintar(bytes, cont) {
    const mio = ++turno;
    const lib = await cargar();
    // PDF.js se queda con el búfer (lo pasa al worker): se le da una copia
    const pdf = await lib.getDocument({ data: new Uint8Array(bytes).slice() }).promise;
    try {
      if (mio !== turno) return;
      cont.replaceChildren();
      const ancho = cont.clientWidth || 360;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      for (let n = 1; n <= pdf.numPages; n++) {
        const pagina = await pdf.getPage(n);
        if (mio !== turno) return;
        const base = pagina.getViewport({ scale: 1 });
        const vista = pagina.getViewport({ scale: (ancho / base.width) * dpr });
        const lienzo = document.createElement("canvas");
        lienzo.className = "pdf-page";
        lienzo.width = Math.floor(vista.width);
        lienzo.height = Math.floor(vista.height);
        lienzo.setAttribute("aria-label", `Página ${n} de ${pdf.numPages}`);
        // cada página aparece apenas está lista, sin esperar a las demás
        cont.appendChild(lienzo);
        await pagina.render({ canvasContext: lienzo.getContext("2d"), viewport: vista }).promise;
      }
    } finally {
      pdf.destroy();
    }
  }

  window.VisorPDF = { pintar };
})();
