/* ============================================================
   Edición en conjunto de un mismo formato.
   Cada formato guardado tiene su canal «doc:<id>»:
   - Presencia: quién está dentro, con su color, y en qué campo
     está escribiendo.
   - Campos: cada cambio viaja al resto en ~0,1 s (gana el último
     que escribe en ese campo). Las fotos nuevas se comparten al
     guardar, porque son pesadas.
   - Al entrar, quien ya estaba le pasa al recién llegado lo que
     lleva escrito y aún no se ha guardado.
   La app le entrega a este módulo cómo leer y escribir los campos
   (ver `ctx` en Colaboracion.unirse).
   ============================================================ */
(function () {
  const COLORES = ["#2563eb", "#16a34a", "#db2777", "#7c3aed", "#ea580c", "#0891b2", "#b45309"];
  const ESPERA_ENVIO = 120;   // ms entre un cambio y su envío (agrupa lo que se teclea)

  let canal = null;
  let ctx = null;
  let docId = null;
  let anteriores = new Map();        // clave → miembro (para saber quién entra y sale)
  const relojes = new Map();         // campo → temporizador de envío
  const ultimoLocal = new Map();     // campo → instante de la última tecla propia
  let miFoco = null;

  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function colorDe(uid) {
    let h = 0;
    for (const ch of String(uid)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return COLORES[h % COLORES.length];
  }
  const inicial = (n) => (String(n || "?").trim().charAt(0) || "?").toUpperCase();
  const ROLES = { trabajador: "Técnico", jefe: "Jefe", administrador: "Administrador" };

  function otros() {
    return canal ? canal.miembros().filter((m) => m.clave !== Tiempo.idPestana) : [];
  }
  function nombreDe(m) {
    return m.uid === ctx.perfil.id ? "Tú (en otra pestaña)" : m.nombre;
  }

  /* ----------------------------------------------------------
     Barra «Editando con…» y marcas sobre los campos
     ---------------------------------------------------------- */
  function pintarBarra() {
    const barra = $("#colab");
    if (!barra) return;
    const lista = otros();
    if (!lista.length) { barra.classList.add("hidden"); barra.innerHTML = ""; return; }
    const nombres = lista.map(nombreDe);
    const texto = nombres.length === 1 ? nombres[0]
      : `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`;
    barra.innerHTML = `
      <span class="colab-avatares">${lista.map((m) => `
        <span class="colab-avatar" style="--c:${m.color}" title="${esc(nombreDe(m))} · ${esc(ROLES[m.rol] || m.rol)}${m.foco ? ` · escribiendo en «${esc(ctx.etiqueta(m.foco))}»` : ""}">${esc(inicial(m.nombre))}</span>`).join("")}
      </span>
      <span class="colab-texto"><span class="colab-punto" aria-hidden="true"></span>Editando con <strong>${esc(texto)}</strong></span>`;
    barra.classList.remove("hidden");
  }

  function pintarFocos() {
    document.querySelectorAll("[data-campo].campo-remoto").forEach((el) => {
      el.classList.remove("campo-remoto");
      el.style.removeProperty("--colab");
      el.removeAttribute("data-colab");
    });
    for (const m of otros()) {
      if (!m.foco) continue;
      const el = document.querySelector(`[data-campo="${CSS.escape(m.foco)}"]`);
      if (!el) continue;
      el.classList.add("campo-remoto");
      el.style.setProperty("--colab", m.color);
      el.setAttribute("data-colab", m.nombre.split(" ")[0]);
    }
  }

  /* resalta un momento el campo que otra persona acaba de cambiar */
  function destello(campo, quien) {
    const el = document.querySelector(`[data-campo="${CSS.escape(campo)}"]`);
    if (!el) return;
    el.style.setProperty("--colab", quien.color || COLORES[0]);
    el.classList.remove("campo-cambio");
    void el.offsetWidth;   // reinicia la animación
    el.classList.add("campo-cambio");
  }

  /* avisos de quién entra y quién sale del formato */
  function alCambiarMiembros() {
    const ahora = new Map(otros().map((m) => [m.clave, m]));
    for (const [clave, m] of ahora) {
      if (!anteriores.has(clave)) ctx.aviso(`${nombreDe(m)} entró a este formato. Ahora lo están editando juntos.`);
    }
    for (const [clave, m] of anteriores) {
      if (!ahora.has(clave)) ctx.aviso(`${nombreDe(m)} salió de este formato.`);
    }
    anteriores = ahora;
    pintarBarra();
    pintarFocos();
  }

  /* quien lleva más tiempo dentro es el que le pasa el estado al nuevo */
  function soyElMasAntiguo(excepto) {
    const lista = canal.miembros().filter((m) => m.clave !== excepto);
    lista.sort((a, b) => (a.desde - b.desde) || String(a.clave).localeCompare(String(b.clave)));
    return lista.length && lista[0].clave === Tiempo.idPestana;
  }

  /* ----------------------------------------------------------
     API
     ---------------------------------------------------------- */
  const Colaboracion = {
    /* ctx: { perfil, valor(campo), aplicar(campo, valor),
              instantanea(), aplicarInstantanea(datos),
              alGuardado(info), etiqueta(campo), aviso(texto) } */
    async unirse(registro, contexto) {
      this.salir();
      if (!registro || !registro.id) return;
      ctx = contexto;
      docId = registro.id;
      anteriores = new Map();
      const yo = Tiempo.idPestana;

      canal = Tiempo.canal(`doc:${docId}`, { presencia: true })
        .on("campo", ({ de, campo, valor }) => {
          if (de === yo || !ctx) return;
          // si estoy escribiendo justo ahí, gana lo mío (mi próximo envío lo corrige allá)
          const enMiFoco = miFoco === campo && Date.now() - (ultimoLocal.get(campo) || 0) < 1500;
          if (enMiFoco) return;
          ctx.aplicar(campo, valor);
          const quien = canal.miembros().find((m) => m.clave === de);
          if (quien) destello(campo, quien);
        })
        .on("pedir-estado", ({ de }) => {
          if (de !== yo && soyElMasAntiguo(de)) {
            canal.enviar("estado", { para: de, de: yo, datos: ctx.instantanea() });
          }
        })
        .on("estado", ({ para, datos }) => {
          if (para === yo && ctx) ctx.aplicarInstantanea(datos || {});
        })
        .on("guardado", (info) => {
          if (info.de !== yo && ctx) ctx.alGuardado(info);
        })
        .onPresencia(alCambiarMiembros);

      const meta = {
        uid: ctx.perfil.id, nombre: ctx.perfil.name, rol: ctx.perfil.role,
        color: colorDe(ctx.perfil.id), foco: null, desde: Date.now(),
      };
      /* El servidor de tiempo real a veces falla un momento: se reintenta
         en silencio y solo se avisa si sigue sin conectar. */
      const este = canal;
      for (let intento = 1; ; intento++) {
        try {
          await este.conectar(meta);
          if (canal !== este) return;   // ya salió de este formato
          // pide lo que los demás llevan escrito y aún no está guardado
          canal.enviar("pedir-estado", { de: yo });
          return;
        } catch (e) {
          if (canal !== este) return;
          console.warn(`edición en conjunto, intento ${intento}:`, e && e.message);
          if (intento >= 3) {
            ctx.aviso("La edición en conjunto no está disponible ahora (falla del servidor de Supabase). Puedes seguir trabajando y guardar normalmente.", "ok");
            return;
          }
          await new Promise((r) => setTimeout(r, 2000 * intento));
          if (canal !== este) return;
        }
      }
    },

    salir() {
      for (const t of relojes.values()) clearTimeout(t);
      relojes.clear();
      ultimoLocal.clear();
      if (canal) canal.salir();
      canal = null;
      docId = null;
      miFoco = null;
      anteriores = new Map();
      const barra = $("#colab");
      if (barra) { barra.classList.add("hidden"); barra.innerHTML = ""; }
      document.querySelectorAll("[data-campo].campo-remoto").forEach((el) => el.classList.remove("campo-remoto"));
    },

    activo() { return !!canal; },
    acompanado() { return otros().length > 0; },
    personas() { return otros(); },

    /* un campo cambió en esta pestaña: se envía (agrupado) */
    cambio(campo) {
      if (!canal || !ctx) return;
      ultimoLocal.set(campo, Date.now());
      clearTimeout(relojes.get(campo));
      relojes.set(campo, setTimeout(() => {
        relojes.delete(campo);
        if (canal) canal.enviar("campo", { de: Tiempo.idPestana, campo, valor: ctx.valor(campo) });
      }, ESPERA_ENVIO));
    },

    /* en qué campo está escribiendo esta pestaña (lo ven los demás) */
    foco(campo) {
      if (!canal || miFoco === campo) return;
      miFoco = campo;
      canal.actualizar({ ...canal.meta, foco: campo || null });
    },

    /* esta pestaña guardó: los demás refrescan fotos y número */
    guardado(registro) {
      if (!canal || !registro) return;
      canal.enviar("guardado", {
        de: Tiempo.idPestana, id: registro.id, numero: registro.numero,
        por: ctx.perfil.name, updated_at: registro.updated_at,
      });
    },
  };

  window.Colaboracion = Colaboracion;
})();
