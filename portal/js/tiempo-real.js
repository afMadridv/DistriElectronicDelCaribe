/* ============================================================
   Tiempo real: canales de mensajes y presencia («quién está»).
   - Producción: Supabase Realtime con canales PRIVADOS; quién
     puede escuchar o escribir en cada canal lo deciden las
     políticas de realtime.messages del schema.sql.
   - Modo demo: BroadcastChannel del navegador. Sirve para probar
     entre pestañas del mismo equipo sin servidor.

   Canales que usa el portal:
     portal          presencia de todos los conectados
     doc:<id>        un formato abierto (edición en conjunto)
     usuario:<id>    buzón de cada persona (señales de llamada)
     auditoria       inserciones en la tabla eventos
   ============================================================ */
(function () {
  const nuevoId = () => (crypto.randomUUID ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2));

  /* identifica ESTA pestaña: una persona puede tener el portal abierto
     en el celular y en el computador a la vez */
  const ID_PESTANA = nuevoId();

  /* ----------------------------------------------------------
     Dispositivo y navegador (para alertas de seguridad y para
     mostrar desde dónde está conectado cada quien)
     ---------------------------------------------------------- */
  const Dispositivo = {
    /* id estable de este navegador: se crea una vez y se guarda */
    id() {
      try {
        let id = localStorage.getItem("dec_dispositivo");
        if (!id) { id = nuevoId(); localStorage.setItem("dec_dispositivo", id); }
        return id;
      } catch { return "sin-almacenamiento"; }
    },
    info() {
      const ua = navigator.userAgent || "";
      const ipad = navigator.maxTouchPoints > 1 && /Macintosh/.test(ua);
      const tipo = /iPad|Tablet/i.test(ua) || ipad || (/Android/i.test(ua) && !/Mobile/i.test(ua))
        ? "Tablet" : /Mobi|iPhone|iPod|Android/i.test(ua) ? "Celular" : "Computador";
      const navegador = /Edg\//.test(ua) ? "Edge"
        : /OPR\/|Opera/.test(ua) ? "Opera"
        : /SamsungBrowser/.test(ua) ? "Samsung Internet"
        : /Firefox|FxiOS/.test(ua) ? "Firefox"
        : /Chrome|CriOS/.test(ua) ? "Chrome"
        : /Safari/.test(ua) ? "Safari" : "Navegador";
      const sistema = /Windows/.test(ua) ? "Windows"
        : /Android/.test(ua) ? "Android"
        : /iPhone|iPad|iPod/.test(ua) || ipad ? (ipad || /iPad/.test(ua) ? "iPadOS" : "iOS")
        : /Mac OS X/.test(ua) ? "macOS"
        : /CrOS/.test(ua) ? "ChromeOS"
        : /Linux/.test(ua) ? "Linux" : "otro sistema";
      return { id: this.id(), tipo, navegador, sistema, etiqueta: `${tipo} · ${navegador} en ${sistema}` };
    },
  };

  /* ----------------------------------------------------------
     Canal de Supabase
     ---------------------------------------------------------- */
  class CanalSupabase {
    constructor(topic, { presencia = false } = {}) {
      this.topic = topic;
      this.presencia = presencia;
      this.handlers = {};
      this.alPresencia = null;
      this.alEstado = null;
      this.meta = null;
      this.listo = false;
      this.ch = null;
    }
    on(evento, cb) { (this.handlers[evento] ||= []).push(cb); return this; }
    onPresencia(cb) { this.alPresencia = cb; return this; }
    onEstado(cb) { this.alEstado = cb; return this; }

    _crear() {
      const sb = Store.cliente();
      if (!sb) throw new Error("Sin conexión con el servidor de tiempo real.");
      const ch = sb.channel(this.topic, {
        config: {
          private: true,
          broadcast: { self: false, ack: false },
          presence: { key: ID_PESTANA, enabled: this.presencia },
        },
      });
      for (const evento of Object.keys(this.handlers)) {
        ch.on("broadcast", { event: evento }, ({ payload }) => {
          for (const cb of this.handlers[evento]) {
            try { cb(payload || {}); } catch (e) { console.error(`tiempo real (${evento}):`, e); }
          }
        });
      }
      if (this.presencia) {
        ch.on("presence", { event: "sync" }, () => this.alPresencia && this.alPresencia(this.miembros()));
      }
      return ch;
    }

    async conectar(meta = null) {
      this.meta = meta;
      const sb = Store.cliente();
      // el token de la sesión viaja con el canal privado
      try {
        const { data } = await sb.auth.getSession();
        if (data.session) await sb.realtime.setAuth(data.session.access_token);
      } catch { /* se sigue: supabase-js también lo pone solo */ }
      // un intento anterior que falló no debe quedar colgado
      if (this.ch) { const viejo = this.ch; this.ch = null; sb.removeChannel(viejo); }
      this.ch = this._crear();
      await new Promise((ok, mal) => {
        const espera = setTimeout(() => mal(new Error("tiempo de espera agotado")), 12000);
        this.ch.subscribe((estado, err) => {
          if (estado === "SUBSCRIBED") {
            clearTimeout(espera);
            this.listo = true;
            this.alEstado && this.alEstado("conectado");
            ok();
            /* la presencia («quién está») va aparte: si el servidor de
               Supabase tarda en registrarla, los mensajes igual funcionan.
               Al reconectarse solo, supabase-js vuelve a pasar por aquí. */
            if (this.presencia && this.meta) this._marcarPresencia();
          } else if (estado === "CHANNEL_ERROR" || estado === "TIMED_OUT") {
            clearTimeout(espera);
            this.listo = false;
            this.alEstado && this.alEstado("error", err);
            mal(err || new Error(estado));
          } else if (estado === "CLOSED") {
            this.listo = false;
            this.alEstado && this.alEstado("cerrado");
          }
        });
      });
      return this;
    }

    /* registra la presencia; si el servidor no responde, reintenta (3 veces) */
    async _marcarPresencia(intento = 1) {
      const ch = this.ch;
      let r;
      try { r = await ch.track(this.meta); } catch { r = "error"; }
      if (r === "ok" || ch !== this.ch || !this.listo) return;
      if (intento < 3) setTimeout(() => this._marcarPresencia(intento + 1), 3000 * intento);
      else console.warn(`presencia en ${this.topic}: el servidor no respondió (${r})`);
    }

    async enviar(evento, payload = {}) {
      if (this.listo) return this.ch.send({ type: "broadcast", event: evento, payload });
      // sin suscripción (p. ej. avisar a otra persona) va por la API REST
      const ch = this.ch || Store.cliente().channel(this.topic, { config: { private: true } });
      return ch.httpSend ? ch.httpSend(evento, payload) : ch.send({ type: "broadcast", event: evento, payload });
    }

    async actualizar(meta) {
      this.meta = meta;
      if (this.listo && this.presencia) await this.ch.track(meta);
    }

    miembros() {
      if (!this.ch) return [];
      const estado = this.ch.presenceState();
      return Object.entries(estado).map(([clave, metas]) => ({ ...metas[metas.length - 1], clave }));
    }

    salir() {
      this.listo = false;
      if (this.ch) {
        const ch = this.ch;
        this.ch = null;
        Promise.resolve(this.presencia ? ch.untrack() : null).catch(() => {})
          .finally(() => Store.cliente() && Store.cliente().removeChannel(ch));
      }
    }
  }

  /* ----------------------------------------------------------
     Canal del modo demo (entre pestañas del mismo navegador)
     La presencia se simula con latidos: cada pestaña avisa que
     sigue ahí cada 4 s. Al cerrar se despide («adios»); sin noticias
     se da por ida a los 75 s, porque Chrome frena a una vez por minuto
     los temporizadores de las pestañas que llevan rato en segundo plano.
     ---------------------------------------------------------- */
  class CanalDemo {
    constructor(topic, { presencia = false } = {}) {
      this.topic = topic;
      this.presencia = presencia;
      this.handlers = {};
      this.alPresencia = null;
      this.alEstado = null;
      this.meta = null;
      this.otros = new Map();   // clave → { meta, visto }
      this.bc = null;
      this.reloj = null;
    }
    on(evento, cb) { (this.handlers[evento] ||= []).push(cb); return this; }
    onPresencia(cb) { this.alPresencia = cb; return this; }
    onEstado(cb) { this.alEstado = cb; return this; }

    _avisar() { this.alPresencia && this.alPresencia(this.miembros()); }

    async conectar(meta = null) {
      this.meta = meta;
      this.bc = new BroadcastChannel("dec-rt:" + this.topic);
      this.bc.onmessage = ({ data: m }) => {
        if (!m) return;
        if (m.t === "b") {
          for (const cb of this.handlers[m.evento] || []) {
            try { cb(m.payload || {}); } catch (e) { console.error(`tiempo real (${m.evento}):`, e); }
          }
          return;
        }
        if (m.t !== "p" || !this.presencia) return;
        if (m.a === "adios") { if (this.otros.delete(m.clave)) this._avisar(); return; }
        const nuevo = !this.otros.has(m.clave);
        this.otros.set(m.clave, { meta: m.meta, visto: Date.now() });
        if (m.a === "hola" && this.meta) this._latido("latido");
        if (nuevo || m.a === "cambio") this._avisar();
      };
      if (this.presencia) {
        this._latido("hola");
        this.reloj = setInterval(() => {
          this._latido("latido");
          let cambio = false;
          for (const [k, v] of this.otros) {
            if (Date.now() - v.visto > 75000) { this.otros.delete(k); cambio = true; }
          }
          if (cambio) this._avisar();
        }, 4000);
        this._avisar();
      }
      this.alEstado && this.alEstado("conectado");
      return this;
    }

    _latido(a) {
      if (this.bc && this.meta) this.bc.postMessage({ t: "p", a, clave: ID_PESTANA, meta: this.meta });
    }

    async enviar(evento, payload = {}) {
      const bc = this.bc || new BroadcastChannel("dec-rt:" + this.topic);
      bc.postMessage({ t: "b", evento, payload });
      if (!this.bc) bc.close();
    }

    async actualizar(meta) {
      this.meta = meta;
      this._latido("cambio");
      this._avisar();
    }

    miembros() {
      const lista = [...this.otros.entries()].map(([clave, v]) => ({ ...v.meta, clave }));
      if (this.presencia && this.meta) lista.push({ ...this.meta, clave: ID_PESTANA });
      return lista;
    }

    salir() {
      clearInterval(this.reloj);
      if (this.bc) {
        if (this.presencia && this.meta) this.bc.postMessage({ t: "p", a: "adios", clave: ID_PESTANA });
        this.bc.close();
        this.bc = null;
      }
      this.otros.clear();
    }
  }

  /* ----------------------------------------------------------
     API pública
     ---------------------------------------------------------- */
  const abiertos = new Set();
  let portal = null;
  let alPortal = [];
  let canalAuditoria = null;

  const Tiempo = {
    idPestana: ID_PESTANA,

    canal(topic, opciones) {
      const c = Store.isDemo ? new CanalDemo(topic, opciones) : new CanalSupabase(topic, opciones);
      abiertos.add(c);
      const salir = c.salir.bind(c);
      c.salir = () => { abiertos.delete(c); salir(); };
      return c;
    },

    /* manda un mensaje a un canal sin quedarse escuchándolo */
    async enviarA(topic, evento, payload) {
      if (Store.isDemo) {
        const bc = new BroadcastChannel("dec-rt:" + topic);
        bc.postMessage({ t: "b", evento, payload });
        bc.close();
        return;
      }
      return new CanalSupabase(topic).enviar(evento, payload);
    },

    /* presencia general: quién tiene el portal abierto ahora */
    async unirsePortal(meta) {
      if (portal) { await portal.actualizar(meta); return; }
      portal = this.canal("portal", { presencia: true })
        .onPresencia((lista) => alPortal.forEach((cb) => cb(lista)));
      try { await portal.conectar(meta); }
      catch (e) { console.warn("presencia del portal:", e && e.message); }
    },
    async actualizarPortal(cambios) {
      if (portal && portal.meta) await portal.actualizar({ ...portal.meta, ...cambios });
    },
    enLinea() { return portal ? portal.miembros() : []; },
    onEnLinea(cb) { alPortal.push(cb); return () => { alPortal = alPortal.filter((x) => x !== cb); }; },

    /* eventos de auditoría que acaban de registrarse. En producción llegan
       por postgres_changes y la RLS de la tabla decide quién los recibe. */
    escucharEventos(cb) {
      if (Store.isDemo) {
        const bc = new BroadcastChannel("dec-rt:auditoria");
        bc.onmessage = ({ data }) => data && data.t === "evento" && cb(data.evento);
        return () => bc.close();
      }
      const sb = Store.cliente();
      canalAuditoria = sb.channel("auditoria", { config: { private: true } })
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "eventos" }, (p) => cb(p.new))
        .subscribe((estado, err) => {
          if (estado === "CHANNEL_ERROR") console.warn("auditoría en tiempo real:", err && err.message);
        });
      return () => { if (canalAuditoria) sb.removeChannel(canalAuditoria); canalAuditoria = null; };
    },
    publicarEventoDemo(evento) {
      const bc = new BroadcastChannel("dec-rt:auditoria");
      bc.postMessage({ t: "evento", evento });
      bc.close();
    },

    salirTodo() {
      for (const c of [...abiertos]) c.salir();
      portal = null;
    },
  };

  // al cerrar la pestaña los demás dejan de verla enseguida
  window.addEventListener("pagehide", () => { for (const c of abiertos) if (c instanceof CanalDemo) c.salir(); });
  // al volver a la pestaña se avisa enseguida, sin esperar el próximo latido
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    for (const c of abiertos) if (c instanceof CanalDemo && c.presencia) c._latido("latido");
  });

  window.Tiempo = Tiempo;
  window.Dispositivo = Dispositivo;
})();
