/* ============================================================
   PWA: instalación en la pantalla de inicio, Service Worker,
   aviso de versión nueva y de conexión.
   ============================================================ */
(function () {
  const esIOS = /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  const esStandalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

  let promptInstalar = null;   // evento beforeinstallprompt (Chrome, Edge, Samsung)
  let recargarAlActivar = false;

  const PWA = {
    esIOS,
    esStandalone,
    registro: null,

    /* parámetros con los que se abrió el portal: accesos directos del
       ícono (?vista=historial) o clic en una notificación (?registro=id) */
    parametrosInicio() {
      const p = new URLSearchParams(location.search);
      const r = { vista: p.get("vista"), registro: p.get("registro") };
      if (r.vista || r.registro || p.has("source")) history.replaceState(null, "", location.pathname);
      return r;
    },

    async instalar() {
      if (promptInstalar) {
        promptInstalar.prompt();
        const { outcome } = await promptInstalar.userChoice;
        if (outcome === "accepted") promptInstalar = null;
        pintarBotones();
        return;
      }
      if (esIOS) guiaIOS();
    },
  };

  /* ----------------------------------------------------------
     Botón «Instalar app» (en el menú lateral)
     ---------------------------------------------------------- */
  function pintarBotones() {
    const visible = !esStandalone() && (!!promptInstalar || esIOS);
    document.querySelectorAll("[data-instalar]").forEach((b) => {
      b.classList.toggle("hidden", !visible);
      if (!b._listo) { b._listo = true; b.addEventListener("click", () => PWA.instalar()); }
    });
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();          // se ofrece con el botón propio, no con la barra del navegador
    promptInstalar = e;
    pintarBotones();
  });
  window.addEventListener("appinstalled", () => { promptInstalar = null; pintarBotones(); });
  document.addEventListener("DOMContentLoaded", pintarBotones);

  function guiaIOS() {
    const capa = document.createElement("div");
    capa.className = "modal-overlay";
    capa.innerHTML = `
      <div class="modal modal-sm" role="dialog" aria-modal="true" aria-labelledby="guia-ios-t">
        <h3 id="guia-ios-t">Instalar en iPhone o iPad</h3>
        <ol class="guia-ios">
          <li>Abre el portal en <b>Safari</b>.</li>
          <li>Toca el botón <b>Compartir</b> <span aria-hidden="true">(el cuadro con la flecha hacia arriba)</span>.</li>
          <li>Elige <b>«Agregar a pantalla de inicio»</b> y luego <b>Agregar</b>.</li>
        </ol>
        <p class="field-hint">Desde ese ícono el portal abre a pantalla completa y puede mostrar notificaciones.</p>
        <div class="modal-actions"><button type="button" class="btn btn-primary">Entendido</button></div>
      </div>`;
    document.body.appendChild(capa);
    const cerrar = () => capa.remove();
    capa.querySelector(".btn").addEventListener("click", cerrar);
    capa.addEventListener("click", (e) => { if (e.target === capa) cerrar(); });
  }

  /* ----------------------------------------------------------
     Aviso fijo arriba (sin conexión / versión nueva)
     ---------------------------------------------------------- */
  function avisoFijo(id, texto, boton, alPulsar) {
    let el = document.getElementById(id);
    if (!texto) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement("div");
      el.id = id;
      el.className = "aviso-fijo";
      el.setAttribute("role", "status");
      document.body.prepend(el);
    }
    el.innerHTML = `<span>${texto}</span>${boton ? `<button type="button" class="btn btn-sm">${boton}</button>` : ""}`;
    if (boton) el.querySelector("button").addEventListener("click", alPulsar);
  }

  function pintarConexion() {
    avisoFijo("aviso-red", navigator.onLine ? null
      : "Sin conexión: puedes seguir llenando el formato y ver la vista previa. Para guardar necesitas internet.");
  }
  window.addEventListener("online", pintarConexion);
  window.addEventListener("offline", pintarConexion);
  document.addEventListener("DOMContentLoaded", pintarConexion);

  /* ----------------------------------------------------------
     Service Worker
     ---------------------------------------------------------- */
  function ofrecerActualizacion(reg) {
    avisoFijo("aviso-version", "Hay una versión nueva del portal.", "Actualizar", () => {
      if (window.Llamadas && Llamadas.enLlamada()) {
        avisoFijo("aviso-version", "Termina la llamada para actualizar el portal.");
        return;
      }
      recargarAlActivar = true;
      if (reg.waiting) reg.waiting.postMessage({ tipo: "saltar-espera" });
    });
  }

  async function registrar() {
    if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
    try {
      const reg = await navigator.serviceWorker.register("sw.js", { scope: "./" });
      PWA.registro = reg;
      // una versión ya esperando (se descargó en una visita anterior)
      if (reg.waiting && navigator.serviceWorker.controller) ofrecerActualizacion(reg);
      reg.addEventListener("updatefound", () => {
        const nuevo = reg.installing;
        if (!nuevo) return;
        nuevo.addEventListener("statechange", () => {
          if (nuevo.state === "installed" && navigator.serviceWorker.controller) ofrecerActualizacion(reg);
        });
      });
      // busca versiones nuevas al volver a la pestaña (las PWA abiertas por días)
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") reg.update().catch(() => {});
      });
    } catch (e) {
      console.warn("Service Worker:", e && e.message);
    }
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (recargarAlActivar) { recargarAlActivar = false; location.reload(); }
    });
    /* mensajes del Service Worker: clic en una notificación y push que
       llegó con el portal a la vista (se muestra como banner) */
    navigator.serviceWorker.addEventListener("message", ({ data }) => {
      if (!data || !window.NotificationService) return;
      if (data.tipo === "notificacion-click") {
        const accion = data.datos && data.datos.accion;
        if (accion) NotificationService.ejecutarAccion({ ...accion, boton: data.accion });
      } else if (data.tipo === "suscripcion-cambio") {
        NotificationService.suscribirPush();
      } else if (data.tipo === "push" && data.datos) {
        const d = data.datos;
        if (d.evento) NotificationService.recibirEvento(d.evento);
        else NotificationService.banner({ cat: d.cat, titulo: d.titulo, cuerpo: d.cuerpo });
      }
    });
    window.addEventListener("load", registrar);
  }

  window.PWA = PWA;
})();
