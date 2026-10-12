/* ============================================================
   Llamadas de voz dentro del portal (WebRTC).
   - Solo los Jefes y el Administrador ven la burbuja para llamar;
     el trabajador recibe la llamada y la ve mientras dura.
   - Señalización por el buzón de cada persona («usuario:<id>»):
     oferta, respuesta, candidatos ICE, colgar, rechazar, ocupado.
   - El audio va directo entre los dos navegadores (cifrado DTLS-SRTP).
   - La llamada vive en un contenedor propio, fuera de las vistas:
     se puede minimizar a una burbuja y seguir usando el portal sin
     que se corte.
   Estados: llamando → conectando → en_curso (⇄ reconectando) → finalizada
            sonando  ↗              (entrante)
   ============================================================ */
(function () {
  /* captura de audio: cancelación de eco, supresión de ruido y control
     automático de ganancia obligatorios; mono a 48 kHz (lo que usa Opus) */
  const AUDIO = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: { ideal: 1 },
    sampleRate: { ideal: 48000 },
    sampleSize: { ideal: 16 },
    latency: { ideal: 0.02 },
  };
  /* STUN públicos; para redes muy cerradas (algunas móviles o
     corporativas) hace falta un servidor TURN en config.js → ICE_SERVERS */
  const ICE = () => {
    const extra = ((window.APP_CONFIG || {}).ICE_SERVERS) || [];
    return [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }, ...extra];
  };
  const TIEMPO_TIMBRE = 35000;        // ms sonando antes de darse por no contestada
  const REENVIO_OFERTA = 3000;        // la oferta se repite por si el otro abre el portal tarde
  const ROLES = { trabajador: "Técnico", jefe: "Jefe", administrador: "Administrador" };
  const GESTORES = ["jefe", "administrador"];

  const ICONOS = {
    fono: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" fill="currentColor"/></svg>',
    colgar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.6 13.9c-.6-.6-.6-1.6.1-2.2C6 9.6 8.9 8.5 12 8.5s6 1.1 8.3 3.2c.7.6.7 1.6.1 2.2l-1.6 1.6c-.5.5-1.3.6-1.9.2l-1.7-1.1c-.4-.3-.7-.8-.7-1.3v-1.6a9 9 0 0 0-5 0v1.6c0 .5-.3 1-.7 1.3l-1.7 1.1c-.6.4-1.4.3-1.9-.2z" fill="currentColor"/></svg>',
    mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    micOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1 1l22 22M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V5a3 3 0 0 0-5.94-.6M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23M12 19v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    minimizar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    cerrar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  };

  let perfil = null;
  let buzon = null;          // canal usuario:<mi id>
  let ui = null;             // referencias del DOM
  let llamada = null;        // la llamada en curso (solo una a la vez)
  let ultimoEnLinea = [];
  const terminadas = new Set();   // ids de llamadas ya cerradas (ignora reenvíos tardíos)

  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const inicial = (n) => (String(n || "?").trim().charAt(0) || "?").toUpperCase();
  const nuevoId = () => (crypto.randomUUID ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const yo = () => ({ id: perfil.id, nombre: perfil.name, rol: perfil.role, clave: Tiempo.idPestana });
  const reloj = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  /* ----------------------------------------------------------
     Tonos (sin archivos de audio): espera de 425 Hz para quien
     llama y timbre de dos tonos para quien recibe
     ---------------------------------------------------------- */
  let audioCtx = null;
  let relojTono = null;
  let vibrando = false;
  /* Chrome bloquea (y lo marca como error) vibrar antes de que la persona
     haya tocado la página alguna vez */
  function vibrar(patron) {
    if (!navigator.vibrate) return;
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    try { navigator.vibrate(patron); } catch { /* sin vibración */ }
  }
  /* iOS: con el interruptor de silencio el sonido de la página se apaga;
     en modo «reproducción» suena igual que una llamada (Safari 16.4+) */
  function sesionAudio(tipo) {
    try { if (navigator.audioSession) navigator.audioSession.type = tipo; } catch { /* sin soporte */ }
  }

  /* Los navegadores solo dejan sonar una página después de que la persona
     la toca. Con el primer toque (en cualquier parte del portal) se deja
     el audio habilitado, así el timbre suena cuando llegue una llamada. */
  function crearAudioCtx() {
    try { audioCtx ||= new (window.AudioContext || window.webkitAudioContext)({ latencyHint: "interactive" }); }
    catch { audioCtx = null; }
    return audioCtx;
  }
  function habilitarAudio() {
    const ctx = crearAudioCtx();
    if (!ctx) return;
    const listo = () => ctx.state === "running";
    const desbloquear = () => {
      ctx.resume().catch(() => {});
      // un sonido mudo de 1 muestra: iOS cuenta el audio como «ya permitido»
      try {
        const b = ctx.createBuffer(1, 1, 22050);
        const s = ctx.createBufferSource();
        s.buffer = b; s.connect(ctx.destination); s.start(0);
      } catch { /* nada */ }
      if (ui && ui.audio && !ui.audio.srcObject) ui.audio.play().catch(() => {});
      if (listo()) quitar();
    };
    const eventos = ["pointerdown", "touchend", "keydown"];
    const quitar = () => eventos.forEach((e) => document.removeEventListener(e, desbloquear, true));
    eventos.forEach((e) => document.addEventListener(e, desbloquear, true));
  }

  function tonos(tipo) {
    pararTonos();
    if (!crearAudioCtx()) return;
    sesionAudio("playback");
    audioCtx.resume().catch(() => {});
    // aún sin ningún toque en la página: el timbre suena en cuanto toquen la pantalla
    if (audioCtx.state !== "running" && ui && llamada && llamada.estado === "sonando") {
      ui.estado.textContent = "Llamada entrante · toca la pantalla para oír el timbre";
    }
    const pita = (frec, dur, vol = 0.08) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.frequency.value = frec;
      g.gain.setValueAtTime(0, audioCtx.currentTime);
      g.gain.linearRampToValueAtTime(vol, audioCtx.currentTime + 0.02);
      g.gain.setValueAtTime(vol, audioCtx.currentTime + dur - 0.03);
      g.gain.linearRampToValueAtTime(0, audioCtx.currentTime + dur);
      o.connect(g).connect(audioCtx.destination);
      o.start();
      o.stop(audioCtx.currentTime + dur);
    };
    const ciclo = tipo === "espera"
      ? () => pita(425, 1, 0.12)
      : () => { pita(880, 0.35, 0.25); setTimeout(() => pita(660, 0.35, 0.25), 400); vibrando = true; vibrar([350, 150, 350]); };
    ciclo();
    relojTono = setInterval(ciclo, tipo === "espera" ? 4000 : 2200);
  }
  function pararTonos() {
    clearInterval(relojTono);
    relojTono = null;
    if (vibrando) { vibrando = false; vibrar(0); }
    // en la llamada el audio va en modo «llamada» (micrófono + parlante); sin llamada, normal
    sesionAudio(llamada && llamada.estado !== "finalizada" ? "play-and-record" : "auto");
  }

  /* ----------------------------------------------------------
     SDP de Opus: corrección de errores en banda, sin silencios
     comprimidos (DTX) y hasta 64 kbps: voz clara en redes regulares
     ---------------------------------------------------------- */
  function ajustarOpus(sdp) {
    const m = sdp.match(/a=rtpmap:(\d+) opus\/48000/i);
    if (!m) return sdp;
    const pt = m[1];
    // paquetes de 10 ms (en vez de 20): la voz sale antes, menos retraso
    const extra = "minptime=10;useinbandfec=1;usedtx=0;stereo=0;maxaveragebitrate=64000";
    const linea = new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`);
    let out;
    if (linea.test(sdp)) {
      out = sdp.replace(linea, (_, params) => {
        const limpio = params.split(";").filter((p) => !/^(minptime|useinbandfec|usedtx|stereo|maxaveragebitrate)=/.test(p.trim()));
        return `a=fmtp:${pt} ${[...limpio, extra].join(";")}`;
      });
    } else {
      out = sdp.replace(new RegExp(`(a=rtpmap:${pt} [^\\r\\n]*)`), `$1\r\na=fmtp:${pt} ${extra}`);
    }
    // a=ptime junto a la línea de Opus (si ya estaba, se cambia)
    out = out.replace(/a=ptime:\d+\r\n/g, "");
    return out.replace(new RegExp(`(a=rtpmap:${pt} [^\\r\\n]*)`), "$1\r\na=ptime:10");
  }

  /* ----------------------------------------------------------
     Interfaz (contenedor global fuera de las vistas del portal)
     ---------------------------------------------------------- */
  function crearUI() {
    if (ui) return;
    const raiz = document.createElement("div");
    raiz.id = "llamadas";
    raiz.className = "llamadas";
    raiz.innerHTML = `
      <button type="button" class="burbuja burbuja-llamar hidden" aria-haspopup="dialog" aria-expanded="false" aria-label="Llamar a un técnico">
        ${ICONOS.fono}<span class="burbuja-cuenta" hidden>0</span>
      </button>
      <section class="llamar-panel hidden" role="dialog" aria-label="Llamar a un técnico">
        <header><strong>Llamar</strong><small>Personas conectadas ahora</small>
          <button type="button" class="llamada-icono" data-cerrar-panel aria-label="Cerrar">${ICONOS.cerrar}</button></header>
        <ul class="llamar-lista"></ul>
      </section>
      <section class="llamada-card hidden" role="dialog" aria-live="polite" aria-label="Llamada">
        <div class="llamada-cabeza">
          <span class="llamada-avatar"></span>
          <div class="llamada-datos"><strong class="llamada-nombre"></strong><small class="llamada-rol"></small></div>
          <button type="button" class="llamada-icono" data-minimizar aria-label="Minimizar llamada" title="Minimizar">${ICONOS.minimizar}</button>
        </div>
        <p class="llamada-estado"></p>
        <div class="llamada-botones"></div>
      </section>
      <button type="button" class="burbuja llamada-mini hidden" aria-label="Volver a la llamada">
        <span class="llamada-mini-avatar"></span><span class="llamada-mini-tiempo">00:00</span>
      </button>
      <audio class="llamada-audio" autoplay playsinline></audio>`;
    document.body.appendChild(raiz);
    ui = {
      raiz,
      lanzador: $(".burbuja-llamar", raiz),
      cuenta: $(".burbuja-cuenta", raiz),
      panel: $(".llamar-panel", raiz),
      lista: $(".llamar-lista", raiz),
      card: $(".llamada-card", raiz),
      avatar: $(".llamada-avatar", raiz),
      nombre: $(".llamada-nombre", raiz),
      rol: $(".llamada-rol", raiz),
      estado: $(".llamada-estado", raiz),
      botones: $(".llamada-botones", raiz),
      mini: $(".llamada-mini", raiz),
      miniAvatar: $(".llamada-mini-avatar", raiz),
      miniTiempo: $(".llamada-mini-tiempo", raiz),
      audio: $(".llamada-audio", raiz),
    };
    ui.lanzador.addEventListener("click", () => {
      if (ui.lanzador._arrastrado) return;
      alternarPanel();
    });
    $("[data-cerrar-panel]", raiz).addEventListener("click", () => alternarPanel(false));
    $("[data-minimizar]", raiz).addEventListener("click", () => minimizar(true));
    ui.mini.addEventListener("click", () => { if (!ui.mini._arrastrado) minimizar(false); });
    hacerArrastrable(ui.lanzador, "dec_burbuja_llamar");
    hacerArrastrable(ui.mini, "dec_burbuja_llamada");
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") alternarPanel(false); });
  }

  /* Burbujas arrastrables con el dedo o el mouse; se pegan al borde
     más cercano y recuerdan dónde quedaron. */
  function hacerArrastrable(el, clave) {
    try {
      const pos = JSON.parse(sessionStorage.getItem(clave));
      if (pos) { el.style.setProperty("--burbuja-y", `${pos.y}px`); el.classList.toggle("izquierda", pos.lado === "izq"); }
    } catch { /* sin posición guardada */ }
    let inicio = null;
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const r = el.getBoundingClientRect();
      inicio = { x: e.clientX, y: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top, movio: false };
      el._arrastrado = false;
    });
    el.addEventListener("pointermove", (e) => {
      if (!inicio) return;
      if (!inicio.movio && Math.hypot(e.clientX - inicio.x, e.clientY - inicio.y) < 8) return;
      if (!inicio.movio) { inicio.movio = true; el.setPointerCapture(e.pointerId); el.classList.add("arrastrando"); }
      el.style.left = `${e.clientX - inicio.dx}px`;
      el.style.top = `${e.clientY - inicio.dy}px`;
      el.style.right = el.style.bottom = "auto";
    });
    const soltar = (e) => {
      if (!inicio) return;
      const movio = inicio.movio;
      inicio = null;
      if (!movio) return;
      el._arrastrado = true;
      setTimeout(() => { el._arrastrado = false; }, 50);
      el.classList.remove("arrastrando");
      const r = el.getBoundingClientRect();
      const lado = r.left + r.width / 2 < window.innerWidth / 2 ? "izq" : "der";
      const y = Math.max(72, Math.min(window.innerHeight - r.height - 16, r.top));
      el.style.left = el.style.top = el.style.right = el.style.bottom = "";
      el.style.setProperty("--burbuja-y", `${y}px`);
      el.classList.toggle("izquierda", lado === "izq");
      try { sessionStorage.setItem(clave, JSON.stringify({ lado, y })); } catch { /* sin almacenamiento */ }
      if (e.pointerId != null && el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };
    el.addEventListener("pointerup", soltar);
    el.addEventListener("pointercancel", soltar);
  }

  function alternarPanel(abrir) {
    const abierto = !ui.panel.classList.contains("hidden");
    const mostrar = abrir ?? !abierto;
    ui.panel.classList.toggle("hidden", !mostrar);
    ui.lanzador.setAttribute("aria-expanded", String(mostrar));
    if (mostrar) pintarLista();
  }

  /* personas conectadas a las que se puede llamar (una por cuenta) */
  function llamables() {
    const vistos = new Map();
    for (const m of ultimoEnLinea) {
      if (!m || !m.uid || m.uid === perfil.id) continue;
      const prev = vistos.get(m.uid);
      // si tiene el portal abierto en varios equipos, se muestra el más reciente
      if (!prev || (m.desde || 0) > (prev.desde || 0)) vistos.set(m.uid, m);
    }
    return [...vistos.values()].sort((a, b) =>
      (a.rol === "trabajador" ? 0 : 1) - (b.rol === "trabajador" ? 0 : 1) || a.nombre.localeCompare(b.nombre));
  }

  function pintarLista() {
    const lista = llamables();
    const trabajadores = lista.filter((m) => m.rol === "trabajador").length;
    ui.cuenta.textContent = String(trabajadores);
    ui.cuenta.hidden = trabajadores === 0;
    if (ui.panel.classList.contains("hidden")) return;
    ui.lista.innerHTML = lista.length ? lista.map((m) => `
      <li>
        <span class="llamada-avatar sm">${esc(inicial(m.nombre))}</span>
        <span class="llamar-info"><strong>${esc(m.nombre)}</strong>
          <small>${esc(ROLES[m.rol] || m.rol)}${m.dispositivo ? ` · ${esc(m.dispositivo)}` : ""}${m.vista ? ` · ${esc(m.vista)}` : ""}</small></span>
        <button type="button" class="btn btn-primary llamar-btn" data-uid="${esc(m.uid)}" ${llamada ? "disabled" : ""}
          aria-label="Llamar a ${esc(m.nombre)}">${ICONOS.fono}<span>Llamar</span></button>
      </li>`).join("")
      : '<li class="llamar-vacio">No hay nadie más conectado en este momento.</li>';
    ui.lista.querySelectorAll(".llamar-btn").forEach((b) => b.addEventListener("click", () => {
      const m = lista.find((x) => x.uid === b.dataset.uid);
      alternarPanel(false);
      if (m) llamar({ id: m.uid, nombre: m.nombre, rol: m.rol });
    }));
  }

  /* pinta la tarjeta según el estado de la llamada */
  function pintar() {
    if (!llamada) {
      ui.card.classList.add("hidden");
      ui.mini.classList.add("hidden");
      ui.lanzador.classList.toggle("hidden", !GESTORES.includes(perfil.role));
      document.body.classList.remove("en-llamada");
      return;
    }
    const L = llamada;
    ui.lanzador.classList.add("hidden");
    ui.avatar.textContent = inicial(L.otro.nombre);
    ui.miniAvatar.textContent = inicial(L.otro.nombre);
    ui.nombre.textContent = L.otro.nombre;
    ui.rol.textContent = ROLES[L.otro.rol] || L.otro.rol || "";
    const seg = L.inicio ? Math.floor((Date.now() - L.inicio) / 1000) : 0;
    const textos = {
      llamando: "Llamando…",
      sonando: `${L.otro.nombre.split(" ")[0]} te está llamando`,
      conectando: "Conectando…",
      en_curso: `En llamada · ${reloj(seg)}`,
      reconectando: "Se cortó la señal, reconectando…",
      finalizada: L.motivo || `Llamada finalizada${seg ? ` · ${reloj(seg)}` : ""}`,
    };
    ui.estado.textContent = textos[L.estado] || "";
    ui.miniTiempo.textContent = L.estado === "en_curso" ? reloj(seg) : (L.estado === "sonando" ? "Entrante" : "…");
    ui.card.dataset.estado = L.estado;
    ui.mini.dataset.estado = L.estado;
    ui.card.classList.toggle("hidden", L.minimizada);
    ui.mini.classList.toggle("hidden", !L.minimizada);
    document.body.classList.add("en-llamada");

    const firma = `${L.estado}|${L.silenciado}`;
    if (ui.botones.dataset.firma === firma) return;
    ui.botones.dataset.firma = firma;
    if (L.estado === "sonando") {
      ui.botones.innerHTML = `
        <button type="button" class="llamada-btn rechazar" data-accion="rechazar" aria-label="Rechazar">${ICONOS.colgar}<span>Rechazar</span></button>
        <button type="button" class="llamada-btn contestar" data-accion="contestar" aria-label="Contestar">${ICONOS.fono}<span>Contestar</span></button>`;
    } else if (L.estado === "finalizada") {
      ui.botones.innerHTML = `<button type="button" class="btn btn-ghost" data-accion="cerrar">Cerrar</button>`;
    } else {
      ui.botones.innerHTML = `
        <button type="button" class="llamada-btn silenciar" data-accion="silenciar" aria-pressed="${L.silenciado}"
          aria-label="${L.silenciado ? "Activar micrófono" : "Silenciar micrófono"}">${L.silenciado ? ICONOS.micOff : ICONOS.mic}<span>${L.silenciado ? "Activar" : "Silenciar"}</span></button>
        <button type="button" class="llamada-btn colgar" data-accion="colgar" aria-label="Colgar">${ICONOS.colgar}<span>Colgar</span></button>`;
    }
    ui.botones.querySelectorAll("[data-accion]").forEach((b) => b.addEventListener("click", () => {
      const a = b.dataset.accion;
      if (a === "contestar") contestar();
      else if (a === "rechazar") rechazar();
      else if (a === "colgar") colgar();
      else if (a === "silenciar") silenciar();
      else if (a === "cerrar") limpiar();
    }));
  }

  function minimizar(si) {
    if (!llamada) return;
    llamada.minimizada = si;
    pintar();
    if (!si) ui.card.querySelector("[data-accion]")?.focus();
  }

  /* ----------------------------------------------------------
     Señalización
     ---------------------------------------------------------- */
  function enviar(destinoUid, evento, datos) {
    return Tiempo.enviarA(`usuario:${destinoUid}`, evento, { ...datos, de: yo() })
      .catch((e) => console.warn(`llamada (${evento}):`, e && e.message));
  }
  const paraMi = (d) => !d.para || d.para === Tiempo.idPestana;

  function crearConexion() {
    const pc = new RTCPeerConnection({ iceServers: ICE(), bundlePolicy: "max-bundle" });
    pc.onicecandidate = ({ candidate }) => {
      if (candidate && llamada && llamada.pc === pc) {
        enviar(llamada.otro.id, "llamada:ice", { id: llamada.id, para: llamada.otro.clave, candidato: candidate.toJSON() });
      }
    };
    pc.ontrack = ({ streams, receiver }) => {
      /* sin colchón extra: la voz se reproduce apenas llega (el navegador
         solo guarda lo mínimo para no cortarse) — menos retraso */
      try { if ("jitterBufferTarget" in receiver) receiver.jitterBufferTarget = 0; } catch { /* nada */ }
      try { if ("playoutDelayHint" in receiver) receiver.playoutDelayHint = 0; } catch { /* nada */ }
      ui.audio.srcObject = streams[0];
      const p = ui.audio.play();
      if (p) p.catch(() => {
        // el navegador pidió un toque antes de reproducir sonido
        ui.estado.textContent = "Toca aquí para escuchar";
        ui.card.addEventListener("click", () => ui.audio.play(), { once: true });
      });
    };
    pc.onconnectionstatechange = () => {
      if (!llamada || llamada.pc !== pc) return;
      const s = pc.connectionState;
      if (s === "connected") {
        clearTimeout(llamada.relojCorte);
        if (!llamada.inicio) llamada.inicio = Date.now();
        cambiar("en_curso");
        mejorarEnvio(pc);
      } else if (s === "disconnected") {
        cambiar("reconectando");
        clearTimeout(llamada.relojCorte);
        llamada.relojCorte = setTimeout(() => reiniciarIce(), 4000);
      } else if (s === "failed") {
        reiniciarIce();
      }
    };
    return pc;
  }

  /* más ancho de banda y prioridad alta para el audio, si el navegador lo permite */
  function mejorarEnvio(pc) {
    for (const s of pc.getSenders()) {
      if (!s.track || s.track.kind !== "audio" || !s.getParameters) continue;
      const p = s.getParameters();
      p.encodings = (p.encodings && p.encodings.length ? p.encodings : [{}])
        .map((e) => ({ ...e, maxBitrate: 64000, priority: "high", networkPriority: "high" }));
      s.setParameters(p).catch(() => {});
    }
  }

  /* si la red cambió (wifi ↔ datos), quien llamó renegocia la ruta;
     al tercer intento sin éxito se da por cortada */
  async function reiniciarIce() {
    const L = llamada;
    if (!L || L.estado === "finalizada") return;
    L.reintentos = (L.reintentos || 0) + 1;
    if (L.reintentos > 3) { terminar("Se perdió la conexión.", true); return; }
    cambiar("reconectando");
    if (L.rol !== "saliente") return;   // espera la nueva oferta de quien llamó
    try {
      const oferta = await L.pc.createOffer({ iceRestart: true });
      oferta.sdp = ajustarOpus(oferta.sdp);
      await L.pc.setLocalDescription(oferta);
      enviar(L.otro.id, "llamada:oferta", { id: L.id, para: L.otro.clave, sdp: L.pc.localDescription.sdp, renegociar: true });
    } catch (e) { console.warn("reconectar:", e); }
    clearTimeout(L.relojCorte);
    L.relojCorte = setTimeout(() => { if (llamada === L && L.estado === "reconectando") reiniciarIce(); }, 8000);
  }

  async function microfono() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("Este navegador no permite llamadas (se necesita HTTPS y un navegador actual).");
    }
    const soporte = navigator.mediaDevices.getSupportedConstraints ? navigator.mediaDevices.getSupportedConstraints() : {};
    const audio = { ...AUDIO };
    /* sin «aislamiento de voz»: filtra más ruido pero agrega retraso a la
       voz; la supresión de ruido normal ya limpia bien sin demorar */
    if (soporte.voiceIsolation) audio.voiceIsolation = false;
    try {
      const flujo = await navigator.mediaDevices.getUserMedia({ audio, video: false });
      const pista = flujo.getAudioTracks()[0];
      if (pista && "contentHint" in pista) pista.contentHint = "speech";
      return flujo;
    } catch (e) {
      if (e && (e.name === "NotAllowedError" || e.name === "SecurityError")) {
        throw new Error("Permite el uso del micrófono para hablar (ícono junto a la dirección del sitio).");
      }
      if (e && e.name === "NotFoundError") throw new Error("No se encontró un micrófono en este equipo.");
      throw e;
    }
  }

  function cambiar(estado) {
    if (!llamada) return;
    llamada.estado = estado;
    if (estado === "en_curso" || estado === "conectando") pararTonos();
    pintar();
  }

  /* reloj de la llamada (también actualiza la burbuja minimizada) */
  let relojPantalla = null;
  function arrancarReloj() {
    clearInterval(relojPantalla);
    relojPantalla = setInterval(() => { if (llamada && llamada.estado === "en_curso") pintar(); }, 1000);
  }

  /* ----------------------------------------------------------
     Llamar (Jefe / Administrador)
     ---------------------------------------------------------- */
  async function llamar(otro) {
    if (llamada) return;
    const id = nuevoId();
    llamada = { id, rol: "saliente", otro: { ...otro, clave: null }, estado: "llamando", colaIce: [], minimizada: false, silenciado: false };
    pintar();
    tonos("espera");
    try {
      const flujo = await microfono();
      // colgó mientras el navegador pedía el micrófono
      if (!llamada || llamada.id !== id) { parar(flujo); return; }
      llamada.local = flujo;
      const pc = crearConexion();
      llamada.pc = pc;
      for (const t of flujo.getTracks()) pc.addTrack(t, flujo);
      const oferta = await pc.createOffer({ offerToReceiveAudio: true });
      oferta.sdp = ajustarOpus(oferta.sdp);
      await pc.setLocalDescription(oferta);
      /* se espera a reunir las rutas de red (máx. 2,5 s): así la oferta ya
         las lleva dentro y sirve aunque el otro abra el portal tarde */
      await new Promise((ok) => {
        if (pc.iceGatheringState === "complete") return ok();
        const listo = () => { if (pc.iceGatheringState === "complete") { pc.removeEventListener("icegatheringstatechange", listo); ok(); } };
        pc.addEventListener("icegatheringstatechange", listo);
        setTimeout(ok, 2500);
      });
      if (!llamada || llamada.id !== id) return;
      arrancarReloj();
      const mandar = () => enviar(otro.id, "llamada:oferta", { id, sdp: pc.localDescription.sdp });
      mandar();
      // aviso push por si tiene el portal cerrado (Edge Function «notificar»)
      Store.registrarEvento("llamada", { detalle: { para: otro.id } }).catch(() => {});
      llamada.relojOferta = setInterval(() => { if (llamada && llamada.estado === "llamando") mandar(); }, REENVIO_OFERTA);
      llamada.relojTimbre = setTimeout(() => {
        if (llamada && llamada.id === id && llamada.estado === "llamando") {
          enviar(otro.id, "llamada:colgar", { id, motivo: "sin-respuesta" });
          terminar(`${otro.nombre.split(" ")[0]} no contestó.`);
        }
      }, TIEMPO_TIMBRE);
    } catch (e) {
      terminar(e.message || "No se pudo iniciar la llamada.");
    }
  }

  /* ----------------------------------------------------------
     Recibir (cualquier rol)
     ---------------------------------------------------------- */
  async function alOferta(d) {
    if (terminadas.has(d.id)) return;
    // renegociación de una llamada ya establecida (cambio de red)
    if (llamada && llamada.id === d.id) {
      if (!d.renegociar || !llamada.pc || !paraMi(d)) return;
      try {
        await llamada.pc.setRemoteDescription({ type: "offer", sdp: d.sdp });
        const r = await llamada.pc.createAnswer();
        r.sdp = ajustarOpus(r.sdp);
        await llamada.pc.setLocalDescription(r);
        enviar(llamada.otro.id, "llamada:respuesta", { id: d.id, para: llamada.otro.clave, sdp: llamada.pc.localDescription.sdp });
      } catch (e) { console.warn("renegociar:", e); }
      return;
    }
    if (llamada) {
      // ya está en otra llamada
      enviar(d.de.id, "llamada:ocupado", { id: d.id, para: d.de.clave });
      return;
    }
    llamada = {
      id: d.id, rol: "entrante", otro: { ...d.de }, estado: "sonando", oferta: d.sdp,
      colaIce: [], minimizada: false, silenciado: false,
    };
    pintar();
    tonos("timbre");
    // si el portal no está a la vista: notificación del sistema con botones
    if (document.visibilityState !== "visible" || !document.hasFocus()) {
      NotificationService.mostrarSistema({
        titulo: "Llamada entrante",
        cuerpo: `${d.de.nombre} (${ROLES[d.de.rol] || d.de.rol}) te está llamando`,
        tag: `llamada-${d.id}`, insistente: true,
        accion: { tipo: "llamada", id: d.id },
        acciones: [{ action: "contestar", title: "Contestar" }, { action: "rechazar", title: "Rechazar" }],
      }).catch(() => {});
    }
    const id = d.id;
    llamada.relojTimbre = setTimeout(() => {
      if (llamada && llamada.id === id && llamada.estado === "sonando") {
        terminar(`Llamada perdida de ${d.de.nombre}.`);
        NotificationService.banner({ cat: "llamadas", titulo: "Llamada perdida", cuerpo: `${d.de.nombre} te llamó.` });
      }
    }, TIEMPO_TIMBRE + 3000);
  }

  async function contestar() {
    const L = llamada;
    if (!L || L.estado !== "sonando") return;
    cambiar("conectando");
    arrancarReloj();
    // las demás pestañas de esta misma persona dejan de sonar
    Tiempo.enviarA(`usuario:${perfil.id}`, "llamada:atendida", { id: L.id, de: yo() });
    try {
      L.local = await microfono();
      if (llamada !== L) { parar(L.local); return; }
      const pc = crearConexion();
      L.pc = pc;
      await pc.setRemoteDescription({ type: "offer", sdp: L.oferta });
      for (const t of L.local.getTracks()) pc.addTrack(t, L.local);
      const r = await pc.createAnswer();
      r.sdp = ajustarOpus(r.sdp);
      await pc.setLocalDescription(r);
      await vaciarColaIce();
      enviar(L.otro.id, "llamada:respuesta", { id: L.id, para: L.otro.clave, sdp: pc.localDescription.sdp });
    } catch (e) {
      enviar(L.otro.id, "llamada:colgar", { id: L.id, para: L.otro.clave, motivo: "error" });
      terminar(e.message || "No se pudo contestar.");
    }
  }

  function rechazar() {
    if (!llamada) return;
    enviar(llamada.otro.id, "llamada:rechazada", { id: llamada.id, para: llamada.otro.clave });
    Tiempo.enviarA(`usuario:${perfil.id}`, "llamada:atendida", { id: llamada.id, de: yo() });
    terminar("Rechazaste la llamada.", true);
  }

  function colgar() {
    if (!llamada) return;
    enviar(llamada.otro.id, "llamada:colgar", { id: llamada.id, para: llamada.otro.clave });
    terminar(null, true);
  }

  function silenciar() {
    if (!llamada || !llamada.local) return;
    llamada.silenciado = !llamada.silenciado;
    llamada.local.getAudioTracks().forEach((t) => { t.enabled = !llamada.silenciado; });
    pintar();
  }

  async function vaciarColaIce() {
    const L = llamada;
    if (!L || !L.pc || !L.pc.remoteDescription) return;
    for (const c of L.colaIce.splice(0)) {
      try { await L.pc.addIceCandidate(c); } catch (e) { console.debug("ICE:", e.message); }
    }
  }

  const parar = (flujo) => flujo && flujo.getTracks().forEach((t) => t.stop());

  /* cierra la llamada; la tarjeta muestra el motivo unos segundos */
  function terminar(motivo, inmediato = false) {
    const L = llamada;
    if (!L) return;
    terminadas.add(L.id);
    pararTonos();
    clearInterval(L.relojOferta);
    clearTimeout(L.relojTimbre);
    clearTimeout(L.relojCorte);
    clearInterval(relojPantalla);
    parar(L.local);
    if (L.pc) { L.pc.onconnectionstatechange = null; L.pc.close(); }
    ui.audio.srcObject = null;
    L.estado = "finalizada";
    sesionAudio("auto");
    L.minimizada = false;
    const seg = L.inicio ? Math.floor((Date.now() - L.inicio) / 1000) : 0;
    L.motivo = motivo || `Llamada finalizada${seg ? ` · ${reloj(seg)}` : ""}`;
    pintar();
    if (inmediato && !motivo) { limpiar(); return; }
    setTimeout(() => { if (llamada === L) limpiar(); }, 3500);
  }

  function limpiar() {
    llamada = null;
    ui.botones.dataset.firma = "";
    pintar();
    pintarLista();
  }

  /* ----------------------------------------------------------
     Mensajes del buzón
     ---------------------------------------------------------- */
  function escucharBuzon() {
    buzon = Tiempo.canal(`usuario:${perfil.id}`)
      .on("llamada:oferta", (d) => alOferta(d))
      .on("llamada:respuesta", async (d) => {
        const L = llamada;
        if (!L || L.id !== d.id || L.rol !== "saliente" || !paraMi(d)) return;
        try {
          if (!L.otro.clave) {
            L.otro.clave = d.de.clave;   // desde ahora todo va solo a la pestaña que contestó
            clearInterval(L.relojOferta);
            clearTimeout(L.relojTimbre);
            cambiar("conectando");
          }
          if (L.pc.signalingState === "have-local-offer") {
            await L.pc.setRemoteDescription({ type: "answer", sdp: d.sdp });
            await vaciarColaIce();
          }
        } catch (e) { console.warn("respuesta:", e); }
      })
      .on("llamada:ice", async (d) => {
        const L = llamada;
        if (!L || L.id !== d.id || !paraMi(d) || !d.candidato) return;
        if (L.pc && L.pc.remoteDescription) {
          try { await L.pc.addIceCandidate(d.candidato); } catch (e) { console.debug("ICE:", e.message); }
        } else L.colaIce.push(d.candidato);
      })
      .on("llamada:colgar", (d) => {
        if (!llamada || llamada.id !== d.id || !paraMi(d)) return;
        const nombre = llamada.otro.nombre.split(" ")[0];
        if (llamada.estado === "sonando") {
          terminar(d.motivo === "sin-respuesta" ? `Llamada perdida de ${llamada.otro.nombre}.` : `${nombre} colgó antes de que contestaras.`);
        } else terminar(`${nombre} colgó.`);
      })
      .on("llamada:rechazada", (d) => {
        if (llamada && llamada.id === d.id && llamada.rol === "saliente") terminar(`${llamada.otro.nombre.split(" ")[0]} rechazó la llamada.`);
      })
      .on("llamada:ocupado", (d) => {
        if (llamada && llamada.id === d.id && llamada.rol === "saliente") terminar(`${llamada.otro.nombre.split(" ")[0]} está en otra llamada.`);
      })
      .on("llamada:atendida", (d) => {
        // la contestó o rechazó en otra pestaña/equipo: aquí deja de sonar
        if (llamada && llamada.id === d.id && llamada.estado === "sonando" && d.de.clave !== Tiempo.idPestana) {
          terminadas.add(d.id);
          pararTonos();
          clearTimeout(llamada.relojTimbre);
          limpiar();
        }
      });
    buzon.conectar().catch((e) => console.warn("buzón de llamadas:", e && e.message));
  }

  /* ----------------------------------------------------------
     API pública
     ---------------------------------------------------------- */
  const Llamadas = {
    iniciar(p) {
      perfil = p;
      if (!window.RTCPeerConnection) return;   // navegador sin WebRTC: sin llamadas
      crearUI();
      habilitarAudio();
      escucharBuzon();
      pintar();
      Tiempo.onEnLinea((lista) => { ultimoEnLinea = lista; pintarLista(); });
      ultimoEnLinea = Tiempo.enLinea();
      pintarLista();
      // cerrar la pestaña en plena llamada corta del lado del otro enseguida
      window.addEventListener("pagehide", () => { if (llamada && llamada.estado !== "finalizada") colgar(); });
    },
    llamar,
    colgar,
    enLlamada: () => !!llamada && llamada.estado !== "finalizada",
    /* botones de la notificación del sistema (Contestar / Rechazar) */
    accionNotificacion(accion) {
      if (!llamada || llamada.id !== accion.id) return;
      if (accion.boton === "rechazar") rechazar();
      else { minimizar(false); if (accion.boton === "contestar") contestar(); }
    },
    detener() {
      if (llamada) colgar();
      if (buzon) buzon.salir();
      buzon = null;
      if (ui) { ui.raiz.remove(); ui = null; }
    },
  };

  window.Llamadas = Llamadas;
})();
