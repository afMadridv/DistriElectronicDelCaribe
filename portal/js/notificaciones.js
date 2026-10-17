/* ============================================================
   NotificationService — avisos del portal.
   - Banners dentro del portal (siempre que el aviso esté activo).
   - Notificaciones del sistema (a través del Service Worker, con
     botones de acción) cuando el portal no está a la vista.
   - Notificaciones push con el portal cerrado (Edge Function
     «notificar» + VAPID), si están configuradas.
   - Campanita: pide el permiso con un modal claro y luego abre el
     panel con los avisos recientes y las preferencias.

   Qué recibe cada rol:
     Trabajador     solo «formato descargado».
     Jefe           además: inicio de sesión en un dispositivo nuevo y
                    la actividad de los trabajadores (auditoría).
     Administrador  lo mismo, más la actividad de los Jefes.
   ============================================================ */
(function () {
  const GESTORES = ["jefe", "administrador"];
  const TODOS = ["trabajador", ...GESTORES];

  const CATEGORIAS = {
    descargas: {
      titulo: "Formato generado y descargado",
      desc: "Cuando termina de generarse un PDF, con el botón para abrirlo.",
      roles: TODOS,
    },
    seguridad: {
      titulo: "Inicio de sesión en un dispositivo nuevo",
      desc: "Si alguien entra con tu cuenta desde otro equipo o navegador.",
      roles: GESTORES,
    },
    ingresos: {
      titulo: "Entra al portal",
      desc: "Con el dispositivo y el navegador que usa.",
      roles: GESTORES,
    },
    formatos_nuevos: {
      titulo: "Empieza un formato nuevo",
      desc: "Cuando alguien abre un formato en blanco para llenarlo.",
      roles: GESTORES,
    },
    formatos_abiertos: {
      titulo: "Entra a editar un formato",
      desc: "Cuando abre o empieza a cambiar uno que ya estaba guardado.",
      roles: GESTORES,
    },
    formatos_completados: {
      titulo: "Termina un formato",
      desc: "Cuando lo guarda en el historial (y si lo firmó).",
      roles: GESTORES,
    },
  };

  /* De quién viene la actividad (el Administrador recibe la de ambos) */
  const ORIGENES = {
    de_tecnicos: { titulo: "De los técnicos", rol: "trabajador", roles: GESTORES },
    de_jefes: { titulo: "De los Jefes", rol: "jefe", roles: ["administrador"] },
  };
  const DE_ACTIVIDAD = ["ingresos", "formatos_nuevos", "formatos_abiertos", "formatos_completados"];

  const ICONOS = {
    campana: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    descargas: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    seguridad: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
    ingresos: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    formatos_nuevos: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M12 18v-6M9 15h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    formatos_abiertos: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    formatos_completados: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4 12 14.01l-3-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    llamadas: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  };

  /* tipo de evento de auditoría → categoría de preferencia */
  const TIPO_A_CATEGORIA = {
    ingreso: "ingresos",
    formato_abierto: "formatos_abiertos",
    formato_editando: "formatos_abiertos",
    formato_completado: "formatos_completados",
    nuevo_dispositivo: "seguridad",
  };
  // «abrió» un formato en blanco = empezó uno nuevo (mismo criterio que la función notificar)
  const categoriaDe = (ev) => (ev.tipo === "formato_abierto" && (ev.detalle || {}).nuevo
    ? "formatos_nuevos" : TIPO_A_CATEGORIA[ev.tipo]);

  let perfil = null;
  let prefs = {};
  let bandeja = [];
  let dejarDeEscuchar = null;
  const vistos = new Set();   // eventos ya mostrados (el realtime y el push pueden repetir)

  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin espacio */ } };
  const clavePrefs = () => `dec_noti_prefs:${perfil.id}`;
  const claveBandeja = () => `dec_bandeja:${perfil.id}`;

  const esIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  const esStandalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const soportaSistema = () => "Notification" in window;
  const permiso = () => (soportaSistema() ? Notification.permission : "no-soportado");

  /* el Administrador también recibe lo de los Jefes */
  const tituloCat = (k) => (perfil && perfil.role === "administrador" && CATEGORIAS[k].tituloAdmin) || CATEGORIAS[k].titulo;

  function categoriasDelRol() {
    return Object.entries(CATEGORIAS).filter(([, c]) => perfil && c.roles.includes(perfil.role)).map(([k]) => k);
  }
  /* En este equipo (respuesta inmediata) y en la cuenta: el servidor filtra
     con ellas el push de todos tus equipos */
  let relojPrefs = null;
  function guardarPrefs() {
    lsSet(clavePrefs(), prefs);
    clearTimeout(relojPrefs);
    relojPrefs = setTimeout(async () => {
      try { await Store.guardarPrefsNotificaciones(prefs); }
      catch (e) { console.warn("preferencias de avisos:", e.message); banner({ titulo: "No se pudieron guardar tus preferencias en la cuenta. Se usan en este equipo." }); }
      suscribirPush();
    }, 500);
  }

  function activa(cat) {
    return categoriasDelRol().includes(cat) && prefs[cat] !== false;
  }

  /* ----------------------------------------------------------
     Bandeja (avisos recientes de la campanita)
     ---------------------------------------------------------- */
  function guardarBandeja() {
    lsSet(claveBandeja(), bandeja.slice(0, 40));
    pintarContador();
  }
  function agregarABandeja(n) {
    if (n.id && bandeja.some((x) => x.id === n.id)) return;
    bandeja.unshift({
      id: n.id || `n-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      cat: n.cat, titulo: n.titulo, cuerpo: n.cuerpo || "",
      fecha: n.fecha || new Date().toISOString(), leida: false,
      // los enlaces blob: del PDF caducan: en la bandeja queda ir al historial
      accion: n.accion && n.accion.tipo === "abrir-pdf" ? { tipo: "historial" } : n.accion || null,
    });
    guardarBandeja();
  }
  function noLeidas() { return bandeja.filter((n) => !n.leida).length; }
  function pintarContador() {
    const n = noLeidas();
    document.querySelectorAll("[data-campana]").forEach((b) => {
      const badge = b.querySelector(".campana-badge");
      if (badge) { badge.textContent = n > 9 ? "9+" : String(n); badge.hidden = n === 0; }
      b.setAttribute("aria-label", n ? `Notificaciones (${n} sin leer)` : "Notificaciones");
    });
  }

  /* ----------------------------------------------------------
     Banners dentro del portal
     ---------------------------------------------------------- */
  function contenedorAvisos() {
    let c = $("#avisos");
    if (!c) {
      c = document.createElement("div");
      c.id = "avisos";
      c.className = "avisos";
      c.setAttribute("role", "status");
      c.setAttribute("aria-live", "polite");
      document.body.appendChild(c);
    }
    return c;
  }

  function banner({ cat, titulo, cuerpo, accion, textoAccion, duracion = 7000 }) {
    const c = contenedorAvisos();
    while (c.children.length >= 3) c.firstElementChild.remove();
    const el = document.createElement("div");
    el.className = `aviso aviso-${cat || "info"}`;
    el.innerHTML = `
      <div class="aviso-icono">${ICONOS[cat] || ICONOS.campana}</div>
      <div class="aviso-texto"><strong>${esc(titulo)}</strong>${cuerpo ? `<span>${esc(cuerpo)}</span>` : ""}</div>
      ${accion ? `<button type="button" class="aviso-accion">${esc(textoAccion || "Ver")}</button>` : ""}
      <button type="button" class="aviso-cerrar" aria-label="Cerrar aviso">×</button>`;
    const quitar = () => { el.classList.add("saliendo"); setTimeout(() => el.remove(), 220); };
    el.querySelector(".aviso-cerrar").addEventListener("click", quitar);
    if (accion) el.querySelector(".aviso-accion").addEventListener("click", () => { quitar(); ejecutarAccion(accion); });
    let reloj = setTimeout(quitar, duracion);
    // si la persona lo está leyendo (mouse encima) no se va
    el.addEventListener("pointerenter", () => clearTimeout(reloj));
    el.addEventListener("pointerleave", () => { reloj = setTimeout(quitar, 2500); });
    c.appendChild(el);
  }

  /* ----------------------------------------------------------
     Notificaciones del sistema
     ---------------------------------------------------------- */
  async function registroSW() {
    if (!("serviceWorker" in navigator)) return null;
    try {
      return await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((ok) => setTimeout(() => ok(null), 3000)),
      ]);
    } catch { return null; }
  }

  async function mostrarSistema({ titulo, cuerpo, tag, accion, acciones = [], insistente = false, url }) {
    if (permiso() !== "granted") return false;
    const opciones = {
      body: cuerpo || "",
      icon: "img/icon-192.png",
      badge: "img/badge-96.png",
      tag: tag || undefined,
      renotify: !!tag && insistente,
      requireInteraction: insistente,
      lang: "es-CO",
      timestamp: Date.now(),
      data: { accion: accion || null, url: url || urlDeAccion(accion) },
    };
    const reg = await registroSW();
    if (reg && reg.showNotification) {
      await reg.showNotification(titulo, { ...opciones, actions: acciones });
      return true;
    }
    const n = new Notification(titulo, opciones);
    n.onclick = () => { window.focus(); n.close(); ejecutarAccion(accion); };
    return true;
  }

  /* dirección que abre el Service Worker si el portal está cerrado */
  function urlDeAccion(accion) {
    if (!accion) return "./";
    if (accion.tipo === "abrir-registro") return `./?registro=${encodeURIComponent(accion.id)}`;
    if (accion.tipo === "historial" || accion.tipo === "abrir-pdf") return "./?vista=historial";
    if (accion.tipo === "mi-cuenta") return "./?vista=usuarios";
    return "./";
  }

  const enPrimerPlano = () => document.visibilityState === "visible" && document.hasFocus();

  /* ----------------------------------------------------------
     Disparo general
     sistema: "auto" (solo si el portal no está a la vista),
              "siempre" o "nunca"
     ---------------------------------------------------------- */
  async function notificar(n) {
    if (n.cat && !activa(n.cat)) return false;
    if (n.id) {
      if (vistos.has(n.id)) return false;
      vistos.add(n.id);
    }
    agregarABandeja(n);
    banner(n);
    const sistema = n.sistema || "auto";
    if (sistema === "siempre" || (sistema === "auto" && !enPrimerPlano())) {
      try {
        await mostrarSistema({
          titulo: n.titulo, cuerpo: n.cuerpo, accion: n.accion,
          tag: n.tag || n.id, acciones: n.acciones || (n.accion ? [{ action: "abrir", title: n.textoAccion || "Ver" }] : []),
        });
      } catch (e) { console.warn("notificación del sistema:", e); }
    }
    return true;
  }

  /* ----------------------------------------------------------
     Textos de los eventos de auditoría (los mismos que usa la
     Edge Function «notificar» para el push)
     ---------------------------------------------------------- */
  function textoEvento(ev) {
    const quien = ev.actor_nombre || (ev.actor_rol === "jefe" ? "Un Jefe" : "Un técnico");
    const d = ev.detalle || {};
    const doc = [d.formato, d.no_doc ? `No. OTT ${d.no_doc}` : d.numero, d.cliente].filter(Boolean).join(" · ");
    const hora = new Date(ev.created_at || Date.now())
      .toLocaleString("es-CO", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
    const abrir = ev.cotizacion_id ? { tipo: "abrir-registro", id: ev.cotizacion_id } : null;
    switch (ev.tipo) {
      case "ingreso":
        return { titulo: `${quien} entró al portal`,
          cuerpo: `${d.etiqueta || "Dispositivo desconocido"} · ${hora}${d.nuevo ? " · dispositivo nuevo" : ""}` };
      case "formato_abierto":
        return { titulo: d.nuevo ? `${quien} empezó un formato nuevo` : `${quien} abrió un formato`,
          cuerpo: doc || "Formato", accion: abrir, textoAccion: "Abrir" };
      case "formato_editando":
        return { titulo: `${quien} está editando un formato`, cuerpo: doc || "Formato", accion: abrir, textoAccion: "Abrir" };
      case "formato_completado":
        // guardado = lo dejó en el historial para seguir después, sin descargarlo
        return { titulo: d.guardado ? `${quien} guardó un formato para seguir después`
          : d.firmado ? `${quien} completó y firmó un formato` : `${quien} completó un formato`,
          cuerpo: doc || "Formato", accion: abrir, textoAccion: "Abrir" };
      case "nuevo_dispositivo":
        return { titulo: "Nuevo inicio de sesión en tu cuenta",
          cuerpo: `${d.etiqueta || "Dispositivo nuevo"} · ${hora}. Si no fuiste tú, cambia tu contraseña.`,
          accion: { tipo: "mi-cuenta" }, textoAccion: "Revisar", duracion: 14000 };
      default:
        return null;
    }
  }

  /* lo que hace uno mismo no se le avisa, salvo el inicio de sesión
     desde OTRO equipo, que es justamente la alerta de seguridad */
  function debeAvisar(ev) {
    if (ev.tipo === "nuevo_dispositivo") {
      return ev.actor_id === perfil.id && (ev.detalle || {}).id !== Dispositivo.id();
    }
    if (ev.actor_id === perfil.id) return false;
    // lo que hacen los Jefes solo se le avisa al Administrador
    if (ev.actor_rol === "jefe" && perfil.role !== "administrador") return false;
    // y cada quien elige de quién quiere recibir la actividad
    const origen = Object.keys(ORIGENES).find((k) => ORIGENES[k].rol === ev.actor_rol);
    return !origen || prefs[origen] !== false;
  }

  function recibirEvento(ev) {
    if (!perfil || !ev) return;
    const cat = categoriaDe(ev);
    if (!cat || !debeAvisar(ev)) return;
    const t = textoEvento(ev);
    if (!t) return;
    notificar({ ...t, cat, id: `ev-${ev.id}`, fecha: ev.created_at });
  }

  /* ----------------------------------------------------------
     Acciones (botón del banner, de la bandeja o de la
     notificación del sistema)
     ---------------------------------------------------------- */
  function ejecutarAccion(accion) {
    if (!accion) return;
    const App = window.App;
    switch (accion.tipo) {
      case "abrir-pdf":
        if (accion.url && accion.vence > Date.now()) window.open(accion.url, "_blank", "noopener");
        else App && App.irA("historial");
        break;
      case "historial": App && App.irA("historial"); break;
      case "abrir-registro": App && App.abrirRegistro(accion.id); break;
      case "mi-cuenta": App && App.editarMiCuenta(); break;
      case "llamada": window.Llamadas && Llamadas.accionNotificacion(accion); break;
      default: break;
    }
  }

  /* ----------------------------------------------------------
     Push con el portal cerrado
     ---------------------------------------------------------- */
  function claveVapid() {
    const k = (window.APP_CONFIG || {}).VAPID_PUBLIC_KEY || "";
    const b64 = k.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (k.length % 4)) % 4);
    const bin = atob(b64);
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  }

  async function suscribirPush() {
    if (Store.isDemo || permiso() !== "granted" || !(window.APP_CONFIG || {}).VAPID_PUBLIC_KEY) return;
    const reg = await registroSW();
    if (!reg || !reg.pushManager) return;
    try {
      const clave = claveVapid();
      let sub = await reg.pushManager.getSubscription();
      // si la clave VAPID cambió, la suscripción vieja ya no sirve: se rehace
      const vieja = sub && sub.options && sub.options.applicationServerKey;
      if (sub && vieja && new Uint8Array(vieja).join() !== clave.join()) {
        await Store.borrarSuscripcion(sub.endpoint).catch(() => {});
        await sub.unsubscribe();
        sub = null;
      }
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: clave });
      await Store.guardarSuscripcion(sub, prefs, Dispositivo.id());
    } catch (e) {
      console.warn("push:", e && e.message);
    }
  }

  /* ----------------------------------------------------------
     Modal de permiso
     ---------------------------------------------------------- */
  function modal(html, clase = "") {
    const capa = document.createElement("div");
    capa.className = "modal-overlay noti-modal";
    capa.innerHTML = `<div class="modal ${clase}" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(capa);
    const cerrar = () => { capa.remove(); document.removeEventListener("keydown", tecla); };
    const tecla = (e) => { if (e.key === "Escape") cerrar(); };
    document.addEventListener("keydown", tecla);
    capa.addEventListener("click", (e) => { if (e.target === capa) cerrar(); });
    return { capa, cerrar };
  }

  function pedirPermiso(alTerminar) {
    const lista = categoriasDelRol().map((k) => `<li>${ICONOS[k]}<span>${esc(tituloCat(k))}</span></li>`).join("");
    const { capa, cerrar } = modal(`
      <div class="noti-permiso-icono">${ICONOS.campana}</div>
      <h3>¿Activar las notificaciones?</h3>
      <p class="confirm-text">Te avisaremos aunque el portal esté en segundo plano:</p>
      <ul class="noti-permiso-lista">${lista}</ul>
      <p class="field-hint">El navegador te va a preguntar. Puedes elegir qué avisos recibir y cambiarlo cuando quieras.</p>
      <div class="modal-actions modal-actions-stack">
        <button type="button" class="btn btn-primary" data-si>Activar notificaciones</button>
        <button type="button" class="btn btn-ghost" data-no>Ahora no</button>
      </div>`, "modal-sm");
    $("[data-no]", capa).addEventListener("click", () => { cerrar(); alTerminar && alTerminar(); });
    $("[data-si]", capa).addEventListener("click", async () => {
      let r = "default";
      try { r = await Notification.requestPermission(); } catch { /* navegadores viejos */ }
      cerrar();
      if (r === "granted") {
        suscribirPush();
        mostrarSistema({ titulo: "Notificaciones activadas", cuerpo: "Así se verán los avisos del portal.", tag: "prueba" });
      }
      alTerminar && alTerminar();
    });
  }

  /* ----------------------------------------------------------
     Panel de la campanita
     ---------------------------------------------------------- */
  function hace(fecha) {
    const s = Math.round((Date.now() - new Date(fecha)) / 1000);
    if (s < 60) return "ahora";
    if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
    if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
    return new Date(fecha).toLocaleDateString("es-CO", { day: "numeric", month: "short" });
  }

  function estadoPermisoHTML() {
    const p = permiso();
    if (p === "granted") {
      return `<p class="noti-estado ok">Notificaciones del sistema activas en este dispositivo.</p>`;
    }
    if (p === "denied") {
      return `<p class="noti-estado alerta">El navegador tiene bloqueadas las notificaciones de este sitio. Para activarlas,
        toca el candado junto a la dirección → Permisos → Notificaciones → Permitir. Mientras tanto verás los avisos aquí dentro.</p>`;
    }
    if (p === "no-soportado" && esIOS() && !esStandalone()) {
      return `<p class="noti-estado alerta">En iPhone y iPad las notificaciones solo funcionan con el portal instalado:
        botón Compartir → «Agregar a pantalla de inicio», y ábrelo desde ese ícono.</p>`;
    }
    if (p === "no-soportado") {
      return `<p class="noti-estado alerta">Este navegador no muestra notificaciones del sistema; verás los avisos dentro del portal.</p>`;
    }
    return `<p class="noti-estado"><button type="button" class="btn btn-primary btn-sm" data-activar>Activar notificaciones del sistema</button></p>`;
  }

  let panelAbierto = null;
  let pestana = "recientes";

  /* «Qué me llega»: avisos por tipo y, para Jefes y Administrador, de quién */
  function prefsHTML() {
    const interruptor = (k, titulo, desc) => `
      <label class="interruptor">
        <input type="checkbox" role="switch" data-pref="${k}" ${prefs[k] !== false ? "checked" : ""} />
        <span class="interruptor-pista" aria-hidden="true"></span>
        <span class="interruptor-texto"><strong>${esc(titulo)}</strong>${desc ? `<small>${esc(desc)}</small>` : ""}</span>
      </label>`;
    const cats = categoriasDelRol();
    const propios = cats.filter((k) => !DE_ACTIVIDAD.includes(k));
    const actividad = cats.filter((k) => DE_ACTIVIDAD.includes(k));
    const origenes = Object.keys(ORIGENES).filter((k) => perfil && ORIGENES[k].roles.includes(perfil.role));
    return `
      <p class="noti-nota">Se guarda en tu cuenta: vale en todos tus equipos, también con el portal cerrado.</p>
      <div class="noti-sub"><span>Tus avisos</span></div>
      <div class="noti-prefs">${propios.map((k) => interruptor(k, tituloCat(k), CATEGORIAS[k].desc)).join("")}</div>
      ${actividad.length ? `
        <div class="noti-sub"><span>Cuando alguien…</span></div>
        <div class="noti-prefs">${actividad.map((k) => interruptor(k, tituloCat(k), CATEGORIAS[k].desc)).join("")}</div>` : ""}
      ${origenes.length ? `
        <div class="noti-sub"><span>¿De quién?</span></div>
        <div class="noti-prefs">${origenes.map((k) => interruptor(k, ORIGENES[k].titulo, "")).join("")}</div>` : ""}
      <p class="noti-nota">Las llamadas siempre suenan, para que no se pierda ninguna.</p>`;
  }

  function cerrarPanel() {
    if (!panelAbierto) return;
    panelAbierto.capa.remove();
    document.removeEventListener("keydown", panelAbierto.tecla);
    panelAbierto.boton && panelAbierto.boton.setAttribute("aria-expanded", "false");
    panelAbierto = null;
  }

  function abrirPanel(boton) {
    cerrarPanel();
    const capa = document.createElement("div");
    capa.className = "noti-capa";
    capa.innerHTML = `
      <section class="noti-panel" role="dialog" aria-modal="true" aria-labelledby="noti-titulo">
        <header class="noti-cabeza">
          <h3 id="noti-titulo">Notificaciones</h3>
          <button type="button" class="noti-icono-btn" data-cerrar aria-label="Cerrar">×</button>
        </header>
        <div class="noti-tabs" role="tablist">
          <button type="button" role="tab" class="noti-tab" data-tab="recientes" aria-selected="${pestana === "recientes"}">Recientes</button>
          <button type="button" role="tab" class="noti-tab" data-tab="prefs" aria-selected="${pestana === "prefs"}">Qué me llega</button>
        </div>
        <div class="noti-cuerpo" data-panel="recientes" ${pestana === "recientes" ? "" : "hidden"}>
          ${estadoPermisoHTML()}
          <div class="noti-sub"><span>Recientes</span>
            <button type="button" class="noti-enlace" data-leidas ${noLeidas() ? "" : "hidden"}>Marcar todo como leído</button></div>
          <ul class="noti-lista">${bandeja.length ? bandeja.slice(0, 20).map((n, i) => `
            <li class="noti-item ${n.leida ? "" : "nueva"}" data-i="${i}" ${n.accion ? 'tabindex="0" role="button"' : ""}>
              <span class="noti-item-icono">${ICONOS[n.cat] || ICONOS.campana}</span>
              <span class="noti-item-texto"><strong>${esc(n.titulo)}</strong>
                ${n.cuerpo ? `<small>${esc(n.cuerpo)}</small>` : ""}<time>${hace(n.fecha)}</time></span>
            </li>`).join("") : '<li class="noti-vacia">No tienes avisos todavía.</li>'}</ul>
        </div>
        <div class="noti-cuerpo" data-panel="prefs" ${pestana === "prefs" ? "" : "hidden"}>
          ${prefsHTML()}
        </div>
        <footer class="noti-pie">
          <button type="button" class="btn btn-ghost btn-sm" data-probar>Probar notificación</button>
        </footer>
      </section>`;
    document.body.appendChild(capa);

    const panel = $(".noti-panel", capa);
    /* en computador y tablet sale junto a la campanita; en el celular,
       como hoja desde abajo (lo resuelve el CSS) */
    if (boton && !window.matchMedia("(max-width: 760px)").matches) {
      const r = boton.getBoundingClientRect();
      const ancho = Math.min(380, window.innerWidth - 24);
      let left = r.right + 12;
      if (left + ancho > window.innerWidth - 12) left = Math.max(12, r.right - ancho);
      panel.style.left = `${left}px`;
      panel.style.top = `${Math.max(12, Math.min(r.top - 8, window.innerHeight - 560))}px`;
    }

    const tecla = (e) => { if (e.key === "Escape") cerrarPanel(); };
    document.addEventListener("keydown", tecla);
    panelAbierto = { capa, tecla, boton };
    boton && boton.setAttribute("aria-expanded", "true");
    capa.addEventListener("click", (e) => { if (e.target === capa) cerrarPanel(); });
    $("[data-cerrar]", capa).addEventListener("click", cerrarPanel);

    const activar = $("[data-activar]", capa);
    if (activar) activar.addEventListener("click", () => { cerrarPanel(); pedirPermiso(() => abrirPanel(boton)); });

    $("[data-leidas]", capa).addEventListener("click", (e) => {
      bandeja.forEach((n) => { n.leida = true; });
      guardarBandeja();
      capa.querySelectorAll(".noti-item.nueva").forEach((li) => li.classList.remove("nueva"));
      e.currentTarget.hidden = true;
    });

    capa.querySelectorAll(".noti-item").forEach((li) => {
      const abrir = () => {
        const n = bandeja[Number(li.dataset.i)];
        n.leida = true;
        guardarBandeja();
        if (n.accion) { cerrarPanel(); ejecutarAccion(n.accion); }
        else li.classList.remove("nueva");
      };
      li.addEventListener("click", abrir);
      li.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); abrir(); } });
    });

    capa.querySelectorAll("[data-tab]").forEach((tab) => tab.addEventListener("click", () => {
      pestana = tab.dataset.tab;
      capa.querySelectorAll("[data-tab]").forEach((t) => t.setAttribute("aria-selected", String(t === tab)));
      capa.querySelectorAll("[data-panel]").forEach((p) => { p.hidden = p.dataset.panel !== pestana; });
    }));

    capa.querySelectorAll("[data-pref]").forEach((chk) => chk.addEventListener("change", () => {
      prefs[chk.dataset.pref] = chk.checked;
      guardarPrefs();
    }));

    $("[data-probar]", capa).addEventListener("click", () => {
      const n = {
        titulo: "Así se ven los avisos",
        cuerpo: "Prueba de notificación del portal DistriElectronic.",
        cat: null, sistema: "siempre", tag: "prueba",
      };
      banner(n);
      mostrarSistema(n).then((ok) => { if (!ok && soportaSistema()) banner({ titulo: "Activa el permiso para verlas fuera del portal." }); });
    });

    // la primera opción enfocable recibe el foco (teclado y lectores de pantalla)
    (activar || $("[data-cerrar]", capa)).focus();
  }

  /* Clic en la campanita: sin permiso, primero el modal explicativo;
     con permiso (o sin soporte), el panel de avisos y preferencias. */
  function alPulsarCampana(boton) {
    if (panelAbierto) { cerrarPanel(); return; }
    if (permiso() === "default") pedirPermiso(() => abrirPanel(boton));
    else abrirPanel(boton);
  }

  /* ----------------------------------------------------------
     API pública
     ---------------------------------------------------------- */
  const NotificationService = {
    CATEGORIAS,

    async iniciar(p) {
      perfil = p;
      // las de la cuenta mandan; las del equipo quedan de respaldo (modo demo o sin conexión)
      prefs = { ...lsGet(clavePrefs(), {}), ...(p.noti_prefs || {}) };
      bandeja = lsGet(claveBandeja(), []);
      pintarContador();
      document.querySelectorAll("[data-campana]").forEach((b) => {
        b.onclick = () => alPulsarCampana(b);
      });

      // los Jefes y el Administrador escuchan la actividad en vivo
      if (dejarDeEscuchar) dejarDeEscuchar();
      dejarDeEscuchar = Tiempo.escucharEventos(recibirEvento);

      /* lo que pasó mientras no estaban: los eventos recientes que
         todavía no estén en la bandeja (sin banner, solo el contador) */
      if (GESTORES.includes(perfil.role)) {
        try {
          const recientes = await Store.listarEventos(20);
          const corte = Date.now() - 2 * 86400000;
          for (const ev of recientes.reverse()) {
            if (new Date(ev.created_at) < corte || bandeja.some((n) => n.id === `ev-${ev.id}`)) continue;
            const cat = categoriaDe(ev);
            if (!cat || !activa(cat) || !debeAvisar(ev)) continue;
            const t = textoEvento(ev);
            if (t) { vistos.add(`ev-${ev.id}`); agregarABandeja({ ...t, cat, id: `ev-${ev.id}`, fecha: ev.created_at }); }
          }
        } catch (e) { console.debug("eventos recientes:", e.message); }
      }
      suscribirPush();
    },

    notificar,
    banner,
    mostrarSistema,
    suscribirPush,
    ejecutarAccion,
    recibirEvento,
    activa,
    abrirPanel,

    /* El PDF ya se generó y se descargó: aviso con botón para abrirlo */
    formatoDescargado({ numero, formato, cliente, url, nombre }) {
      return notificar({
        cat: "descargas",
        titulo: `PDF ${numero} listo`,
        cuerpo: [formato, cliente, nombre ? `Guardado como «${nombre}»` : ""].filter(Boolean).join(" · "),
        accion: url ? { tipo: "abrir-pdf", url, vence: Date.now() + 10 * 60000 } : { tipo: "historial" },
        textoAccion: url ? "Abrir PDF" : "Ver historial",
        tag: `pdf-${numero}`,
      });
    },

    /* registra un evento de auditoría: lo de los trabajadores lo ven los
       Jefes y el Administrador; lo de los Jefes, solo el Administrador.
       Al Administrador no se le audita. */
    async registrar(tipo, opciones) {
      if (!perfil || !["trabajador", "jefe"].includes(perfil.role)) return;
      try { await Store.registrarEvento(tipo, opciones); }
      catch (e) { console.debug("auditoría:", e.message); }
    },

    /* al cerrar sesión este navegador deja de recibir avisos de esa cuenta */
    async cerrarSesion() {
      if (dejarDeEscuchar) { dejarDeEscuchar(); dejarDeEscuchar = null; }
      cerrarPanel();
      const reg = await registroSW();
      try {
        const sub = reg && reg.pushManager && await reg.pushManager.getSubscription();
        if (sub) { await Store.borrarSuscripcion(sub.endpoint); await sub.unsubscribe(); }
      } catch { /* sin conexión: el servidor la borra cuando falle el envío */ }
      perfil = null;
    },
  };

  window.NotificationService = NotificationService;
})();
