/* ============================================================
   Capa de datos: Supabase (producción) o localStorage (demo).
   La app solo habla con `Store`, nunca con Supabase directo.
   ============================================================ */
(function () {
  const DEMO_KEYS = { users: "dec_users", cots: "dec_cotizaciones", session: "dec_session", seq: "dec_seq" };
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

  /* "lalfonso" → "lalfonso@distrielectronicdelcaribe.com" */
  function normalizeEmail(input) {
    const v = String(input || "").trim();
    return v && !v.includes("@") ? v + "@distrielectronicdelcaribe.com" : v;
  }

  /* cliente supabase con almacenamiento según "mantener sesión" */
  function makeClient(keep) {
    return window.supabase.createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_ANON_KEY, {
      auth: { storage: keep ? window.localStorage : window.sessionStorage },
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

  /* ============================================================ */
  const Store = {
    isDemo: window.IS_DEMO,

    async init() {
      if (this.isDemo) {
        seedDemo();
        const sess = lsGet(DEMO_KEYS.session, null);
        if (sess) {
          const user = lsGet(DEMO_KEYS.users, []).find((u) => u.id === sess.id);
          if (user) currentProfile = { id: user.id, name: user.name, email: user.email, role: user.role };
        }
        return currentProfile;
      }
      sb = makeClient(localStorage.getItem("dec_keep") !== "0");
      const { data: { session } } = await sb.auth.getSession();
      if (session) currentProfile = await this._loadProfile(session.user.id);
      return currentProfile;
    },

    getProfile() { return currentProfile; },

    async _loadProfile(userId) {
      const { data, error } = await sb.from("profiles").select("*").eq("id", userId).single();
      if (error) throw error;
      return { id: data.id, name: data.full_name, email: data.email, role: data.role };
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
        currentProfile = { id: user.id, name: user.name, email: user.email, role: user.role };
        lsSet(DEMO_KEYS.session, { id: user.id });
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
      if (this.isDemo) localStorage.removeItem(DEMO_KEYS.session);
      else await sb.auth.signOut();
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
        const mine = currentProfile.role === "jefe" ? all : all.filter((c) => c.user_id === currentProfile.id);
        return mine
          .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
          .map((c) => ({ ...c, cliente: c.data?.cliente || "" }));
      }
      const PAGE = 1000;
      const rows = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await sb
          .from("cotizaciones")
          .select("id, numero, format_type, user_id, owner_name, created_at, updated_at, cliente:data->>cliente")
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
       El registro original conserva las rutas, que es lo que se guarda. */
    async hydrateImages(record) {
      const data = { ...record.data };
      for (const key of Object.keys(data)) {
        if (!Array.isArray(data[key]) || !data[key].length) continue;
        if (!data[key].every((v) => typeof v === "string")) continue;
        data[key] = await Promise.all(data[key].map((v) => this.imageUrl(v)));
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
        for (const v of val) {
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

    async createUser({ name, email, password, role }) {
      if (this.isDemo) {
        const users = lsGet(DEMO_KEYS.users, []);
        if (users.some((u) => u.email.toLowerCase() === email.toLowerCase()))
          throw new Error("Ya existe un usuario con ese correo.");
        users.push({ id: uid(), name, email, password, role });
        lsSet(DEMO_KEYS.users, users);
        return;
      }
      await this._adminUsers({ action: "create", name, email, password, role });
    },

    async updateUser(id, { name, email, password, role }) {
      if (this.isDemo) {
        const users = lsGet(DEMO_KEYS.users, []);
        const u = users.find((x) => x.id === id);
        if (!u) throw new Error("Usuario no encontrado.");
        u.name = name; u.email = email; u.role = role;
        if (password) u.password = password;
        lsSet(DEMO_KEYS.users, users);
        return;
      }
      await this._adminUsers({ action: "update", id, name, email, password: password || undefined, role });
    },

    async deleteUser(id) {
      if (this.isDemo) {
        lsSet(DEMO_KEYS.users, lsGet(DEMO_KEYS.users, []).filter((u) => u.id !== id));
        return;
      }
      await this._adminUsers({ action: "delete", id });
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
