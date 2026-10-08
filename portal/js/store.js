/* ============================================================
   Capa de datos: Supabase (producción) o localStorage (demo).
   La app solo habla con `Store`, nunca con Supabase directo.
   ============================================================ */
(function () {
  const DEMO_KEYS = {
    users: "dec_users", cots: "dec_cotizaciones", session: "dec_session", seq: "dec_seq",
    eventos: "dec_eventos", dispositivos: "dec_dispositivos",
  };
  const PERFIL_CACHE = "dec_perfil";   // para poder abrir el portal sin conexión
  /* roles que gestionan el portal (ven usuarios, auditoría y llaman) */
  const GESTORES = ["jefe", "administrador"];
  const esGestor = (p) => !!p && GESTORES.includes(p.role);
  const SIGNED_TTL = 3600;        // segundos que vive una URL firmada
  const signedUrls = new Map();   // ruta → { url, expira }
  let sb = null;          // cliente supabase
  let currentProfile = null;

  /* ---------- utilidades ---------- */
  function lsGet(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  }
  function lsSet(key, val) { localStorage.setItem(key, JSON.stringify(val)); }
  function uid() { return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8); }

  /* perfil que usa la app (el demo guarda la misma forma) */
  function perfil(u) {
    return { id: u.id, name: u.name ?? u.full_name, email: u.email, role: u.role, firma: u.firma || null };
  }

  /* Si falta correr el schema.sql nuevo, Supabase responde que no encuentra
     la función o la columna: se dice qué hacer en vez de mostrar el error crudo. */
  function errorDeEsquema(error, que) {
    const m = String((error && error.message) || "");
    if (/could not find the function|does not exist|schema cache|column .* not found/i.test(m)) {
      return new Error(`Falta actualizar la base de datos para ${que}: pega supabase/schema.sql en el SQL Editor de Supabase y dale Run.`);
    }
    return new Error(m || `No se pudo ${que}.`);
  }

  /* "lalfonso" → "lalfonso@distrielectronicdelcaribe.com" */
  function normalizeEmail(input) {
    const v = String(input || "").trim();
    return v && !v.includes("@") ? v + "@distrielectronicdelcaribe.com" : v;
  }

  /* cliente supabase con almacenamiento según "mantener sesión" */
  function makeClient(keep) {
    return window.supabase.createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_ANON_KEY, {
      auth: { storage: keep ? window.localStorage : window.sessionStorage },
      /* latidos del tiempo real en un Worker: el navegador frena los
         temporizadores de las pestañas en segundo plano y sin esto la
         conexión se caía (presencia y llamadas entrantes) */
      realtime: { worker: true },
    });
  }

  /* Comprime una imagen a JPEG máx 1200px para que cargue rápido */
  function compressImage(file, maxSize = 1200, quality = 0.8) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          if (width > maxSize || height > maxSize) {
            const scale = maxSize / Math.max(width, height);
            width = Math.round(width * scale);
            height = Math.round(height * scale);
          }
          const canvas = document.createElement("canvas");
          canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", quality));
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function dataURLtoBlob(dataURL) {
    const [meta, b64] = dataURL.split(",");
    const mime = meta.match(/data:(.*?);/)[1];
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  /* ---------- semilla del modo demo ---------- */
  function seedDemo() {
    if (!lsGet(DEMO_KEYS.users, null)) {
      lsSet(DEMO_KEYS.users, [
        { id: uid(), name: "Jefe Demo", email: "jefe@demo.com", password: "demo1234", role: "jefe" },
        { id: uid(), name: "Trabajador Demo", email: "trabajador@demo.com", password: "demo1234", role: "trabajador" },
      ]);
    }
    if (!lsGet(DEMO_KEYS.cots, null)) lsSet(DEMO_KEYS.cots, []);
  }

  /* sesión del modo demo: con «mantener sesión» va en localStorage y sin
     ella en sessionStorage (como en producción). Así también se pueden
     abrir dos pestañas con personas distintas para probar el tiempo real. */
  function demoSesion() {
    try { return JSON.parse(sessionStorage.getItem(DEMO_KEYS.session)) || lsGet(DEMO_KEYS.session, null); }
    catch { return lsGet(DEMO_KEYS.session, null); }
  }

  /* fetch solo dice «Failed to fetch» cuando la petición ni siquiera salió */
  const esErrorDeRed = (e) => /failed to fetch|load failed|networkerror|network request failed/i
    .test(String((e && e.message) || e || ""));

  /* ============================================================ */
  const Store = {
    isDemo: window.IS_DEMO,
    esGestor,

    async init() {
      if (this.isDemo) {
        seedDemo();
        const sess = demoSesion();
        if (sess) {
          const user = lsGet(DEMO_KEYS.users, []).find((u) => u.id === sess.id);
          if (user) currentProfile = perfil(user);
        }
        return currentProfile;
      }
      sb = makeClient(localStorage.getItem("dec_keep") !== "0");
      const { data: { session } } = await sb.auth.getSession();
      if (!session) return null;
      try {
        currentProfile = await this._loadProfile(session.user.id);
      } catch (e) {
        /* sin internet: se entra con el último perfil conocido de esta misma
           cuenta, para poder llenar formatos y ver la vista previa. Guardar
           sí necesita conexión y lo avisa al intentarlo. */
        const guardado = lsGet(PERFIL_CACHE, null);
        if (!esErrorDeRed(e) || !guardado || guardado.id !== session.user.id) throw e;
        currentProfile = { ...guardado, sinConexion: true };
      }
      return currentProfile;
    },

    getProfile() { return currentProfile; },

    /* cliente de Supabase para el tiempo real (null en modo demo) */
    cliente() { return sb; },

    async _loadProfile(userId) {
      const { data, error } = await sb.from("profiles").select("*").eq("id", userId).single();
      if (error) throw error;
      const p = perfil(data);
      try { lsSet(PERFIL_CACHE, p); } catch { /* sin espacio: no pasa nada */ }
      return p;
    },

    /* ---------- autenticación ---------- */
    normalizeEmail,

    async login(rawEmail, password, keep = true) {
      const email = normalizeEmail(rawEmail);
      if (this.isDemo) {
        const user = lsGet(DEMO_KEYS.users, []).find(
          (u) => u.email.toLowerCase() === email.toLowerCase() && u.password === password
        );
        if (!user) throw new Error("Usuario o contraseña incorrectos.");
        currentProfile = perfil(user);
        if (keep) lsSet(DEMO_KEYS.session, { id: user.id });
        else sessionStorage.setItem(DEMO_KEYS.session, JSON.stringify({ id: user.id }));
        return currentProfile;
      }
      localStorage.setItem("dec_keep", keep ? "1" : "0");
      sb = makeClient(keep);
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw new Error("Usuario o contraseña incorrectos.");
      currentProfile = await this._loadProfile(data.user.id);
      return currentProfile;
    },

    async logout() {
      if (this.isDemo) {
        localStorage.removeItem(DEMO_KEYS.session);
        sessionStorage.removeItem(DEMO_KEYS.session);
      } else {
        await sb.auth.signOut();
        localStorage.removeItem(PERFIL_CACHE);
      }
      currentProfile = null;
    },

    /* ---------- cotizaciones ---------- */
    /* El número lo entrega el servidor (tabla consecutivos): así no se
       puede repetir, cosa que el número aleatorio anterior sí permitía. */
    async nextNumber(prefix) {
      if (this.isDemo) {
        const seq = lsGet(DEMO_KEYS.seq, {});
        seq[prefix] = (seq[prefix] || 0) + 1;
        lsSet(DEMO_KEYS.seq, seq);
        return `${prefix}-${String(seq[prefix]).padStart(4, "0")}`;
      }
      const { data, error } = await sb.rpc("siguiente_numero", { p_prefijo: prefix });
      if (error) throw new Error("No se pudo asignar el número del documento.");
      return data;
    },

    /* El historial solo necesita la cabecera de cada registro: pedir la
       columna `data` completa traía las firmas en base64 de TODO el
       histórico en cada carga. Se pagina para no toparse con el tope de
       filas de la API. */
    async listCotizaciones() {
      if (this.isDemo) {
        const all = lsGet(DEMO_KEYS.cots, []);
        const mine = esGestor(currentProfile) ? all : all.filter((c) => c.user_id === currentProfile.id);
        return mine
          .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
          .map((c) => ({ ...c, cliente: c.data?.cliente || "", no_doc: c.data?.no_ott || "" }));
      }
      const PAGE = 1000;
      const rows = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await sb
          .from("cotizaciones")
          // no_doc: el No. OTT que se escribe a mano en el UPS (se muestra en el historial)
          .select("id, numero, format_type, user_id, owner_name, created_at, updated_at, cliente:data->>cliente, no_doc:data->>no_ott")
          .order("updated_at", { ascending: false })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        rows.push(...data);
        if (data.length < PAGE) break;
      }
      return rows;
    },

    async getCotizacion(id) {
      if (this.isDemo) return lsGet(DEMO_KEYS.cots, []).find((c) => c.id === id) || null;
      const { data, error } = await sb.from("cotizaciones").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },

    async createCotizacion({ numero, format_type, data }) {
      const now = new Date().toISOString();
      if (this.isDemo) {
        const cot = {
          id: uid(), numero, format_type, data,
          user_id: currentProfile.id, owner_name: currentProfile.name,
          created_at: now, updated_at: now,
        };
        const all = lsGet(DEMO_KEYS.cots, []);
        all.push(cot);
        lsSet(DEMO_KEYS.cots, all);
        return cot;
      }
      const { data: row, error } = await sb
        .from("cotizaciones")
        .insert({ numero, format_type, data, user_id: currentProfile.id, owner_name: currentProfile.name })
        .select().single();
      if (error) throw error;
      return row;
    },

    async updateCotizacion(id, data) {
      const now = new Date().toISOString();
      if (this.isDemo) {
        const all = lsGet(DEMO_KEYS.cots, []);
        const idx = all.findIndex((c) => c.id === id);
        if (idx === -1) throw new Error("Cotización no encontrada.");
        all[idx].data = data;
        all[idx].updated_at = now;
        lsSet(DEMO_KEYS.cots, all);
        return all[idx];
      }
      const { data: row, error } = await sb
        .from("cotizaciones")
        .update({ data, updated_at: now })
        .eq("id", id).select().single();
      if (error) throw error;
      return row;
    },

    async deleteCotizacion(id) {
      if (this.isDemo) {
        lsSet(DEMO_KEYS.cots, lsGet(DEMO_KEYS.cots, []).filter((c) => c.id !== id));
        return;
      }
      // primero las imágenes: si no, quedan en el bucket para siempre
      const rec = await this.getCotizacion(id).catch(() => null);
      const { error } = await sb.from("cotizaciones").delete().eq("id", id);
      if (error) throw error;
      await this._deleteImages(rec);
    },

    /* ---------- imágenes ---------- */
    compressImage,

    /* Guarda la RUTA dentro del bucket, no una URL: el bucket es privado
       y cada vez que hay que mostrar la imagen se firma una URL temporal. */
    async uploadImage(dataURL) {
      if (this.isDemo) return dataURL; // en demo se guarda el dataURL directo
      const blob = dataURLtoBlob(dataURL);
      const path = `${currentProfile.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      const { error } = await sb.storage
        .from(APP_CONFIG.STORAGE_BUCKET)
        .upload(path, blob, { contentType: "image/jpeg" });
      if (error) throw error;
      return path;
    },

    /* Ruta guardada → URL que el navegador puede abrir. Los dataURL y las
       URLs completas (registros anteriores a la migración) pasan tal cual. */
    async imageUrl(ref) {
      if (!ref) return "";
      const s = String(ref);
      if (this.isDemo || s.startsWith("data:") || s.startsWith("blob:") || s.startsWith("http")) return s;
      const hit = signedUrls.get(s);
      if (hit && hit.expira > Date.now()) return hit.url;
      const { data, error } = await sb.storage
        .from(APP_CONFIG.STORAGE_BUCKET)
        .createSignedUrl(s, SIGNED_TTL);
      if (error) throw error;
      signedUrls.set(s, { url: data.signedUrl, expira: Date.now() + (SIGNED_TTL - 300) * 1000 });
      return data.signedUrl;
    },

    /* Copia del registro con las imágenes ya firmadas, lista para el PDF.
       El registro original conserva las rutas, que es lo que se guarda.
       Acepta tanto la ruta suelta como { src, desc } del registro fotográfico. */
    async hydrateImages(record) {
      const data = { ...record.data };
      for (const key of Object.keys(data)) {
        const arr = data[key];
        if (!Array.isArray(arr) || !arr.length) continue;
        const esFoto = (v) => typeof v === "string"
          || (v && typeof v === "object" && typeof v.src === "string");
        if (!arr.every(esFoto)) continue;
        data[key] = await Promise.all(arr.map(async (v) =>
          typeof v === "string"
            ? await this.imageUrl(v)
            : { ...v, src: await this.imageUrl(v.src) }));
      }
      return { ...record, data };
    },

    /* Borra del bucket las imágenes de un registro (evita que el
       almacenamiento crezca con archivos que ya nadie usa). */
    async _deleteImages(record) {
      if (this.isDemo || !record) return;
      const rutas = [];
      for (const val of Object.values(record.data || {})) {
        if (!Array.isArray(val)) continue;
        for (const item of val) {
          const v = (item && typeof item === "object") ? item.src : item;
          if (typeof v === "string" && !v.startsWith("data:") && !v.startsWith("http") && v.includes("/")) {
            rutas.push(v);
          }
        }
      }
      if (!rutas.length) return;
      try { await sb.storage.from(APP_CONFIG.STORAGE_BUCKET).remove(rutas); }
      catch (e) { console.warn("No se pudieron borrar las imágenes:", e); }
    },

    /* ---------- usuarios (solo jefe) ---------- */
    async listUsers() {
      if (this.isDemo) {
        return lsGet(DEMO_KEYS.users, []).map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role }));
      }
      const { data, error } = await sb.from("profiles").select("id, full_name, email, role").order("full_name");
      if (error) throw error;
      return data.map((u) => ({ id: u.id, name: u.full_name, email: u.email, role: u.role }));
    },

    /* Reglas del Administrador (las mismas que aplica la Edge Function
       admin-users y la base de datos): solo puede haber uno, lo crea un
       Jefe, nadie lo modifica salvo él mismo, no cambia de rol y solo se
       elimina desde el panel de Supabase. */
    async createUser({ name, email, password, role }) {
      if (this.isDemo) {
        const users = lsGet(DEMO_KEYS.users, []);
        if (users.some((u) => u.email.toLowerCase() === email.toLowerCase()))
          throw new Error("Ya existe un usuario con ese correo.");
        if (role === "administrador" && users.some((u) => u.role === "administrador"))
          throw new Error("Ya hay un Administrador en el portal: solo puede haber uno.");
        const id = uid();
        users.push({ id, name, email, password, role });
        lsSet(DEMO_KEYS.users, users);
        return id;
      }
      const r = await this._adminUsers({ action: "create", name, email, password, role });
      return r && r.id;
    },

    async updateUser(id, { name, email, password, role }) {
      if (this.isDemo) {
        const users = lsGet(DEMO_KEYS.users, []);
        const u = users.find((x) => x.id === id);
        if (!u) throw new Error("Usuario no encontrado.");
        if (u.role === "administrador" && currentProfile.id !== id)
          throw new Error("Solo el Administrador puede modificar su propia cuenta.");
        if (u.role === "administrador" && role !== "administrador")
          throw new Error("El rol de Administrador no se puede cambiar desde el portal.");
        if (role === "administrador" && u.role !== "administrador" && users.some((x) => x.role === "administrador"))
          throw new Error("Ya hay un Administrador en el portal: solo puede haber uno.");
        u.name = name; u.email = email; u.role = role;
        if (password) u.password = password;
        lsSet(DEMO_KEYS.users, users);
        if (currentProfile.id === id) Object.assign(currentProfile, { name, email, role });
        return;
      }
      await this._adminUsers({ action: "update", id, name, email, password: password || undefined, role });
    },

    async deleteUser(id) {
      if (this.isDemo) {
        const users = lsGet(DEMO_KEYS.users, []);
        if ((users.find((u) => u.id === id) || {}).role === "administrador")
          throw new Error("El Administrador solo se puede eliminar desde Supabase.");
        lsSet(DEMO_KEYS.users, users.filter((u) => u.id !== id));
        return;
      }
      await this._adminUsers({ action: "delete", id });
    },

    /* ---------- firma digital de cada usuario ----------
       Es un PNG (dataURL) guardado en su perfil. Cada quien solo puede
       leer la suya (RLS de profiles); el jefe, la de todos. */
    async getUserFirma(id) {
      if (this.isDemo) return (lsGet(DEMO_KEYS.users, []).find((u) => u.id === id) || {}).firma || null;
      const { data, error } = await sb.from("profiles").select("firma").eq("id", id).single();
      if (error) throw errorDeEsquema(error, "leer la firma");
      return data.firma || null;
    },

    async saveUserFirma(id, firma) {
      if (this.isDemo) {
        const users = lsGet(DEMO_KEYS.users, []);
        const u = users.find((x) => x.id === id);
        if (!u) throw new Error("Usuario no encontrado.");
        if (u.role === "administrador" && currentProfile.id !== id)
          throw new Error("Solo el Administrador puede cambiar su propia firma.");
        u.firma = firma || null;
        lsSet(DEMO_KEYS.users, users);
      } else {
        const { error } = await sb.rpc("guardar_firma", { p_usuario: id, p_firma: firma || null });
        if (error) throw errorDeEsquema(error, "guardar la firma");
      }
      // si es la propia, los formatos nuevos la usan desde ya
      if (currentProfile && currentProfile.id === id) currentProfile.firma = firma || null;
    },

    /* ---------- almacenamiento usado (solo jefe) ----------
       bytes de las fotos/archivos del Storage y tamaño de la base de datos */
    async storageUsage() {
      if (this.isDemo) {
        // en demo todo vive en localStorage: se mide eso
        let total = 0, archivos = 0, cantidad = 0;
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          total += (k.length + (localStorage.getItem(k) || "").length) * 2;
        }
        for (const c of lsGet(DEMO_KEYS.cots, [])) {
          for (const v of Object.values(c.data || {})) {
            if (!Array.isArray(v)) continue;
            for (const x of v) {
              const s = x && typeof x === "object" ? x.src : x;
              if (typeof s === "string" && s.startsWith("data:image")) { archivos += Math.round(s.length * 0.75); cantidad++; }
            }
          }
        }
        return { archivos, cantidad, base_datos: total };
      }
      const { data, error } = await sb.rpc("uso_almacenamiento");
      if (error) throw errorDeEsquema(error, "ver el almacenamiento");
      return data;
    },

    /* ---------- eventos de auditoría ----------
       Lo que ve el Administrador (y los Jefes): ingresos, formatos abiertos,
       completados o firmados, y alertas de inicio de sesión. El nombre y el
       rol de quien lo hizo los pone la base de datos, no el navegador. */
    async registrarEvento(tipo, { cotizacion_id = null, detalle = {} } = {}) {
      if (this.isDemo) {
        const ev = {
          id: uid(), tipo, cotizacion_id, detalle,
          actor_id: currentProfile.id, actor_nombre: currentProfile.name, actor_rol: currentProfile.role,
          created_at: new Date().toISOString(),
        };
        const todos = lsGet(DEMO_KEYS.eventos, []);
        todos.push(ev);
        lsSet(DEMO_KEYS.eventos, todos.slice(-200));
        if (window.Tiempo) Tiempo.publicarEventoDemo(ev);
        return ev;
      }
      const { data, error } = await sb.from("eventos")
        .insert({ tipo, cotizacion_id, detalle }).select("id").single();
      if (error) throw errorDeEsquema(error, "registrar el evento");
      /* aviso push a quien tenga el portal cerrado (Edge Function
         «notificar»); si no está desplegada, simplemente no llega */
      sb.functions.invoke("notificar", { body: { evento_id: data.id } })
        .then(({ error: e }) => e && console.debug("push:", e.message))
        .catch(() => {});
      return data;
    },

    /* últimos eventos visibles para este usuario (la RLS decide cuáles) */
    async listarEventos(limite = 20) {
      if (this.isDemo) {
        return lsGet(DEMO_KEYS.eventos, [])
          .filter((e) => (esGestor(currentProfile) && e.tipo !== "nuevo_dispositivo")
            || (e.tipo === "nuevo_dispositivo" && e.actor_id === currentProfile.id))
          .slice(-limite).reverse();
      }
      const { data, error } = await sb.from("eventos").select("*")
        .order("created_at", { ascending: false }).limit(limite);
      if (error) throw errorDeEsquema(error, "leer los eventos");
      return data;
    },

    /* ---------- dispositivos de cada cuenta ----------
       Devuelve { nuevo, otros }: si este navegador no se había usado con
       la cuenta y ya hay otros, es un inicio de sesión en equipo nuevo. */
    async registrarDispositivo(info) {
      if (this.isDemo) {
        const mapa = lsGet(DEMO_KEYS.dispositivos, {});
        const mios = mapa[currentProfile.id] || [];
        const nuevo = !mios.includes(info.id);
        const otros = mios.filter((d) => d !== info.id).length;
        if (nuevo) { mios.push(info.id); mapa[currentProfile.id] = mios; lsSet(DEMO_KEYS.dispositivos, mapa); }
        return { nuevo, otros };
      }
      const { data, error } = await sb.rpc("registrar_dispositivo", {
        p_dispositivo: info.id, p_navegador: info.navegador, p_sistema: info.sistema, p_tipo: info.tipo,
      });
      if (error) throw errorDeEsquema(error, "registrar el dispositivo");
      return data;
    },

    /* ---------- suscripción a notificaciones push ----------
       Cada navegador guarda su suscripción y qué avisos quiere recibir. */
    async guardarSuscripcion(sub, prefs, dispositivo) {
      if (this.isDemo) return;
      const j = sub.toJSON();
      const { error } = await sb.rpc("guardar_suscripcion", {
        p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth,
        p_dispositivo: dispositivo, p_prefs: prefs,
      });
      if (error) throw errorDeEsquema(error, "activar las notificaciones push");
    },

    async borrarSuscripcion(endpoint) {
      if (this.isDemo || !endpoint) return;
      await sb.from("push_suscripciones").delete().eq("endpoint", endpoint);
    },

    /* Llama a la Edge Function admin-users (usa service role en el servidor) */
    async _adminUsers(body) {
      const { data, error } = await sb.functions.invoke("admin-users", { body });
      if (error) throw new Error(error.message || "Error en la operación de usuarios.");
      if (data && data.error) throw new Error(data.error);
      return data;
    },
  };

  window.Store = Store;
})();
