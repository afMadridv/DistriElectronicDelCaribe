/* ============================================================
   Configuración — Portal DistriElectronicDelCaribe
   ------------------------------------------------------------
   Cuando tengas tu proyecto de Supabase, pega aquí la URL y la
   clave anónima (Settings → API). Mientras estén vacías, el
   portal funciona en MODO DEMO (datos guardados en este
   navegador con localStorage).
   ============================================================ */
window.APP_CONFIG = {
  SUPABASE_URL: "https://diramayapswiqwtlcqid.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_BgzwCb3JW7Snef3JURtJAw_e_z2gjr5",
  STORAGE_BUCKET: "cotizacion-images",
  /* Cupo del plan de Supabase, en MB, para la barra de almacenamiento.
     Plan gratis: 1 GB de archivos y 500 MB de base de datos.
     Si se cambia a Pro: ARCHIVOS_MB: 102400, BASE_DATOS_MB: 8192. */
  PLAN: { ARCHIVOS_MB: 1024, BASE_DATOS_MB: 500 },
  /* Notificaciones push con el portal cerrado: clave PÚBLICA VAPID.
     Se genera con  npx web-push generate-vapid-keys  (la privada va
     solo en los secretos de Supabase, nunca aquí). Vacía = sin push;
     los avisos siguen llegando mientras el portal esté abierto. */
  VAPID_PUBLIC_KEY: "BC7mBB6nplOdS3W5o2Ikgtb0W1XvWRxU6chEO5FxBKkmds13EK2EueFhl8ChaArzsbk3CfKvd73KZQiavwJk26A",
  /* Llamadas: servidores TURN opcionales para redes muy cerradas
     (algunas móviles o corporativas). Ejemplo:
     [{ urls: "turn:turn.ejemplo.com:3478", username: "u", credential: "c" }] */
  ICE_SERVERS: [],
  COMPANY: {
    name: "DISTRIELECTRONIC DEL CARIBE LTDA.",
    nit: "NIT 900.278.185-2",
    address: "Cra. 64 # 79 - 49, Barranquilla - Colombia",
    phone: "PBX: (5) 304 69 60 · Móvil: 300 243 7281",
    email: "distrielectronicdelcaribe@live.com",
  },
};

window.IS_DEMO = !window.APP_CONFIG.SUPABASE_URL || !window.APP_CONFIG.SUPABASE_ANON_KEY;
