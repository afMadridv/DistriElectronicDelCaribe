/* ============================================================
   Service Worker — Portal DistriElectronic del Caribe
   1. Caché del portal para abrirlo sin conexión.
   2. Estrategias por tipo de recurso (ver «fetch»).
   3. Notificaciones push y clics en las notificaciones.
   Al cambiar archivos del portal, sube VERSION: así cada equipo
   descarga lo nuevo y borra la caché vieja.
   ============================================================ */
const VERSION = "2026-10-14.1";
const CACHE_APP = `dec-app-${VERSION}`;
const CACHE_LIBS = `dec-libs-${VERSION}`;

/* lo mínimo para que el portal abra sin conexión */
const APP = [
  "./",
  "index.html",
  "manifest.json",
  "css/styles.css",
  "js/config.js",
  "js/formats.js",
  "js/plantillas.js",
  "js/store.js",
  "js/pdf.js",
  "js/visor.js",
  "js/tiempo-real.js",
  "js/notificaciones.js",
  "js/colaboracion.js",
  "js/llamadas.js",
  "js/pwa.js",
  "js/app.js",
  "img/logo.png",
  "img/icon.svg",
  "img/icon-192.png",
  "img/icon-512.png",
  "img/badge-96.png",
];

/* librerías de los CDN (sin ellas el portal no arranca) */
const LIBS = [
  "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js",
];
const DOMINIOS_LIBS = ["cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com"];

/* ----------------------------------------------------------
   Instalación y activación
   ---------------------------------------------------------- */
self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const app = await caches.open(CACHE_APP);
    await app.addAll(APP.map((u) => new Request(u, { cache: "reload" })));
    // los CDN no deben impedir la instalación si fallan
    const libs = await caches.open(CACHE_LIBS);
    await Promise.all(LIBS.map((u) => libs.add(new Request(u, { mode: "cors" })).catch(() => {})));
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const vigentes = [CACHE_APP, CACHE_LIBS];
    for (const k of await caches.keys()) {
      if (k.startsWith("dec-") && !vigentes.includes(k)) await caches.delete(k);
    }
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable().catch(() => {});
    await self.clients.claim();
  })());
});

/* la página pide activar la versión nueva (botón «Actualizar») */
self.addEventListener("message", (e) => {
  if (e.data && e.data.tipo === "saltar-espera") self.skipWaiting();
});

/* ----------------------------------------------------------
   Estrategias de caché
   - Páginas: red primero (siempre lo último), caché si no hay red.
   - JS / CSS / manifiesto: red primero, caché si no hay red.
   - Plantillas PDF e imágenes: caché al instante y se renueva por
     detrás (pesan y cambian poco).
   - Librerías de CDN: caché y renovación por detrás.
   - Supabase (datos, sesión, fotos): nunca se guardan aquí.
   ---------------------------------------------------------- */
async function redPrimero(req, cacheName, { respaldo, espera = 0, precarga } = {}) {
  const cache = await caches.open(cacheName);
  try {
    const pedido = precarga ? precarga.then((r) => r || fetch(req)) : fetch(req);
    const res = espera
      ? await Promise.race([pedido, new Promise((_, mal) => setTimeout(() => mal(new Error("lento")), espera))])
      : await pedido;
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return (await cache.match(req, { ignoreSearch: true }))
      || (respaldo && await cache.match(respaldo))
      || Response.error();
  }
}

async function cacheYRenueva(e, req, cacheName) {
  const cache = await caches.open(cacheName);
  const guardada = await cache.match(req);
  const nueva = fetch(req).then((res) => {
    if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  if (guardada) { e.waitUntil(nueva); return guardada; }
  return (await nueva) || Response.error();
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.endsWith("/sw.js")) return;
    if (req.mode === "navigate") {
      e.respondWith(redPrimero(req, CACHE_APP, { respaldo: "index.html", espera: 6000, precarga: e.preloadResponse }));
      return;
    }
    if (url.pathname.includes("/plantillas/") || url.pathname.includes("/img/")) {
      e.respondWith(cacheYRenueva(e, req, CACHE_APP));
      return;
    }
    e.respondWith(redPrimero(req, CACHE_APP));
    return;
  }

  if (DOMINIOS_LIBS.includes(url.hostname)) {
    e.respondWith(cacheYRenueva(e, req, CACHE_LIBS));
  }
  // todo lo demás (Supabase incluido) va directo a la red
});

/* ----------------------------------------------------------
   Notificaciones push
   Llega { titulo, cuerpo, tag, url, accion, evento }. Si el portal
   está a la vista, se le pasa para que lo muestre como banner (el
   tiempo real ya lo suele traer); si no, notificación del sistema.
   ---------------------------------------------------------- */
function opcionesNotificacion(d) {
  return {
    body: d.cuerpo || "",
    icon: "img/icon-192.png",
    badge: "img/badge-96.png",
    tag: d.tag || undefined,
    renotify: !!d.insistente,
    requireInteraction: !!d.insistente,
    lang: "es-CO",
    timestamp: Date.now(),
    data: { accion: d.accion || null, url: d.url || "./" },
    actions: d.acciones || (d.accion ? [{ action: "abrir", title: d.textoAccion || "Ver" }] : []),
  };
}

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { cuerpo: e.data ? e.data.text() : "" }; }
  e.waitUntil((async () => {
    const ventanas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const aLaVista = ventanas.find((c) => c.visibilityState === "visible" && c.focused);
    if (aLaVista) {
      // una llamada ya está sonando en pantalla; lo demás se muestra como banner
      if (d.cat !== "llamadas") aLaVista.postMessage({ tipo: "push", datos: d });
      return;
    }
    await self.registration.showNotification(d.titulo || "DistriElectronic del Caribe", opcionesNotificacion(d));
  })());
});

/* Clic en la notificación (o en uno de sus botones): si el portal está
   abierto, se enfoca y se le pasa la acción; si no, se abre en la
   dirección que trae la notificación (?registro=…, ?vista=…). */
self.addEventListener("notificationclick", (e) => {
  const n = e.notification;
  const datos = n.data || {};
  n.close();
  e.waitUntil((async () => {
    const alcance = new URL(self.registration.scope);
    const ventanas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const abierta = ventanas.find((c) => new URL(c.url).pathname.startsWith(alcance.pathname));
    if (abierta) {
      await abierta.focus().catch(() => {});
      abierta.postMessage({ tipo: "notificacion-click", accion: e.action || "abrir", datos });
      return;
    }
    const destino = new URL(datos.url || "./", self.registration.scope);
    await self.clients.openWindow(destino.href);
  })());
});

/* El navegador renovó la suscripción push: se intenta de nuevo con la
   misma clave y se avisa al portal para que la guarde con la sesión. */
self.addEventListener("pushsubscriptionchange", (e) => {
  e.waitUntil((async () => {
    const opciones = e.oldSubscription && e.oldSubscription.options;
    if (opciones && opciones.applicationServerKey) {
      await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: opciones.applicationServerKey }).catch(() => {});
    }
    for (const c of await self.clients.matchAll({ type: "window" })) c.postMessage({ tipo: "suscripcion-cambio" });
  })());
});
