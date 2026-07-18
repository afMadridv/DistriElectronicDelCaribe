/* ============================================================
   Capa de datos: Supabase (producción) o localStorage (demo).
   La app solo habla con `Store`, nunca con Supabase directo.
   ============================================================ */
(function () {
  const DEMO_KEYS = { users: "dec_users", cots: "dec_cotizaciones", session: "dec_session", seq: "dec_seq" };
  let sb = null;          // cliente supabase
  let currentProfile = null;

  /* ---------- utilidades ---------- */
  function lsGet(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  }
  function lsSet(key, val) { localStorage.setItem(key, JSON.stringify(val)); }
  function uid() { return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8); }

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
      sb = window.supabase.createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_ANON_KEY);
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
    async login(email, password) {
      if (this.isDemo) {
        const user = lsGet(DEMO_KEYS.users, []).find(
          (u) => u.email.toLowerCase() === email.toLowerCase() && u.password === password
        );
        if (!user) throw new Error("Usuario o contraseña incorrectos.");
        currentProfile = { id: user.id, name: user.name, email: user.email, role: user.role };
        lsSet(DEMO_KEYS.session, { id: user.id });
        return currentProfile;
      }
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
    nextNumber(prefix) {
      if (this.isDemo) {
        const seq = lsGet(DEMO_KEYS.seq, {});
        seq[prefix] = (seq[prefix] || 0) + 1;
        lsSet(DEMO_KEYS.seq, seq);
        return `${prefix}-${String(seq[prefix]).padStart(4, "0")}`;
      }
      // Producción: número legible basado en fecha + aleatorio (evita colisiones sin secuencia central)
      const d = new Date();
      const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
      return `${prefix}-${ymd}-${Math.floor(100 + Math.random() * 900)}`;
    },

    async listCotizaciones() {
      if (this.isDemo) {
        const all = lsGet(DEMO_KEYS.cots, []);
        const mine = currentProfile.role === "jefe" ? all : all.filter((c) => c.user_id === currentProfile.id);
        return mine.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
      }
      const { data, error } = await sb
        .from("cotizaciones")
        .select("id, numero, format_type, data, user_id, owner_name, created_at, updated_at")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data;
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
      const { error } = await sb.from("cotizaciones").delete().eq("id", id);
      if (error) throw error;
    },

    /* ---------- imágenes ---------- */
    compressImage,

    /* Recibe un dataURL ya comprimido y devuelve la URL final a guardar */
    async uploadImage(dataURL) {
      if (this.isDemo) return dataURL; // en demo se guarda el dataURL directo
      const blob = dataURLtoBlob(dataURL);
      const path = `${currentProfile.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      const { error } = await sb.storage.from(APP_CONFIG.STORAGE_BUCKET).upload(path, blob, { contentType: "image/jpeg" });
      if (error) throw error;
      const { data } = sb.storage.from(APP_CONFIG.STORAGE_BUCKET).getPublicUrl(path);
      return data.publicUrl;
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
