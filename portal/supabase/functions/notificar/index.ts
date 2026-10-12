// ============================================================
// Edge Function: notificar
// Envía la notificación PUSH de un evento a quien tenga el portal
// cerrado (con el portal abierto ya llega por tiempo real).
//
// Lo llama el propio portal justo después de registrar un evento:
//   POST { evento_id }  con la sesión de quien lo registró.
//
// A quién le llega:
//   ingreso / formato_*      → Jefes y Administrador (no al autor)
//   nuevo_dispositivo        → el dueño de la cuenta, en sus OTROS equipos
//   llamada                  → la persona a la que están llamando
// Cada suscripción guarda sus preferencias (prefs); si apagó esa
// categoría, no se le envía.
//
// Configuración (una sola vez):
//   npx web-push generate-vapid-keys
//   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:correo@empresa.com
//   supabase functions deploy notificar
// y la clave PÚBLICA en js/config.js → VAPID_PUBLIC_KEY.
// ============================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const sinBarra = (s: string) => s.trim().replace(/\/+$/, "");
const ORIGENES = (Deno.env.get("ALLOWED_ORIGIN") ?? "").split(",").map(sinBarra).filter(Boolean);

function cabecerasCors(req: Request): Record<string, string> {
  const origen = sinBarra(req.headers.get("Origin") ?? "");
  const permitido = ORIGENES.length === 0 ? (origen || "*") : (ORIGENES.includes(origen) ? origen : "");
  const h: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  if (permitido) h["Access-Control-Allow-Origin"] = permitido;
  return h;
}

/* los secretos a veces se pegan con comillas, el nombre delante
   ("VAPID_PRIVATE_KEY=..."), texto extra o en Base64 normal; web-push
   solo acepta Base64 URL-safe sin "=". Se toma la clave del texto:
   la privada mide 43 caracteres y la pública 87 */
const limpiarTexto = (s?: string) => (s ?? "").trim().replace(/^["']+|["']+$/g, "").trim();
const limpiarClave = (s: string | undefined, largo: number) => {
  const partes = (s ?? "").match(/[A-Za-z0-9_\-+/]{20,}/g) ?? [];
  const clave = partes.find((p) => p.length === largo) ?? partes.sort((a, b) => b.length - a.length)[0] ?? "";
  return clave.replace(/\+/g, "-").replace(/\//g, "_");
};

const CATEGORIA: Record<string, string> = {
  ingreso: "ingresos",
  formato_abierto: "formatos_abiertos",
  formato_editando: "formatos_abiertos",
  formato_completado: "formatos_completados",
  nuevo_dispositivo: "seguridad",
  llamada: "llamadas",
};
const ROLES: Record<string, string> = { trabajador: "Técnico", jefe: "Jefe", administrador: "Administrador" };

type Evento = {
  id: number; tipo: string; actor_id: string; actor_nombre: string | null; actor_rol: string | null;
  cotizacion_id: string | null; detalle: Record<string, unknown>; created_at: string;
};

/* mismos textos que muestra el portal (js/notificaciones.js) */
function texto(ev: Evento) {
  const d = (ev.detalle ?? {}) as Record<string, string | boolean>;
  const quien = ev.actor_nombre || "Un técnico";
  const doc = [d.formato, d.no_doc ? `No. OTT ${d.no_doc}` : d.numero, d.cliente].filter(Boolean).join(" · ");
  const hora = new Date(ev.created_at).toLocaleString("es-CO", {
    timeZone: "America/Bogota", day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
  });
  const abrir = ev.cotizacion_id ? `./?registro=${ev.cotizacion_id}` : "./";
  switch (ev.tipo) {
    case "ingreso":
      return { titulo: `${quien} entró al portal`, cuerpo: `${d.etiqueta || "Dispositivo"} · ${hora}`, url: "./" };
    case "formato_abierto":
      return { titulo: d.nuevo ? `${quien} empezó un formato nuevo` : `${quien} abrió un formato`, cuerpo: doc, url: abrir };
    case "formato_editando":
      return { titulo: `${quien} está editando un formato`, cuerpo: doc, url: abrir };
    case "formato_completado":
      return { titulo: d.firmado ? `${quien} completó y firmó un formato` : `${quien} completó un formato`, cuerpo: doc, url: abrir };
    case "nuevo_dispositivo":
      return {
        titulo: "Nuevo inicio de sesión en tu cuenta",
        cuerpo: `${d.etiqueta || "Dispositivo nuevo"} · ${hora}. Si no fuiste tú, cambia tu contraseña.`,
        url: "./?vista=usuarios",
      };
    case "llamada":
      return {
        titulo: "Llamada entrante",
        cuerpo: `${quien} (${ROLES[ev.actor_rol ?? ""] || "Jefe"}) te está llamando. Abre el portal para contestar.`,
        url: "./", insistente: true,
      };
    default:
      return null;
  }
}

Deno.serve(async (req) => {
  const corsHeaders = cabecerasCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const pub = limpiarClave(Deno.env.get("VAPID_PUBLIC_KEY"), 87);
    const priv = limpiarClave(Deno.env.get("VAPID_PRIVATE_KEY"), 43);
    if (!pub || !priv) return json({ ok: false, motivo: "Push sin configurar (faltan las claves VAPID)." });
    const sujeto = limpiarTexto(Deno.env.get("VAPID_SUBJECT"));
    try {
      webpush.setVapidDetails(/^(mailto:|https:)/.test(sujeto) ? sujeto : "mailto:distrielectronicdelcaribe@live.com", pub, priv);
    } catch (e) {
      // solo los largos, nunca las claves
      const motivo = `${(e as Error).message} (largo pública ${pub.length}/87, privada ${priv.length}/43)`;
      console.error("notificar:", motivo);
      return json({ error: motivo }, 500);
    }

    // 1. Quién llama
    const caller = createClient(url, anon, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return json({ error: "No autenticado." }, 401);

    // 2. El evento (solo su autor puede pedir que se notifique)
    const { evento_id } = await req.json();
    const admin = createClient(url, service);
    const { data: ev } = await admin.from("eventos").select("*").eq("id", evento_id).maybeSingle<Evento>();
    if (!ev) return json({ error: "Evento no encontrado." }, 404);
    if (ev.actor_id !== user.id) return json({ error: "Ese evento no es tuyo." }, 403);
    // un mismo evento no se notifica dos veces (reintentos del navegador)
    if (Date.now() - new Date(ev.created_at).getTime() > 2 * 60_000) return json({ ok: true, enviadas: 0 });

    // 3. Destinatarios
    let destinatarios: string[] = [];
    let excluirDispositivo: string | null = null;
    if (ev.tipo === "nuevo_dispositivo") {
      destinatarios = [ev.actor_id];
      excluirDispositivo = String((ev.detalle as Record<string, unknown>).id ?? "");
    } else if (ev.tipo === "llamada") {
      if (!["jefe", "administrador"].includes(ev.actor_rol ?? "")) return json({ error: "No autorizado." }, 403);
      const para = String((ev.detalle as Record<string, unknown>).para ?? "");
      if (para) destinatarios = [para];
    } else {
      /* lo que hace un técnico les llega a los Jefes y al Administrador;
         lo que hace un Jefe, solo al Administrador */
      const roles = ev.actor_rol === "trabajador" ? ["jefe", "administrador"]
        : ev.actor_rol === "jefe" ? ["administrador"] : [];
      if (!roles.length) return json({ ok: true, enviadas: 0 });
      const { data } = await admin.from("profiles").select("id").in("role", roles);
      destinatarios = (data ?? []).map((p) => p.id).filter((id) => id !== ev.actor_id);
    }
    if (!destinatarios.length) return json({ ok: true, enviadas: 0 });

    const t = texto(ev);
    if (!t) return json({ ok: true, enviadas: 0 });
    const categoria = CATEGORIA[ev.tipo];

    const { data: subs } = await admin.from("push_suscripciones").select("*").in("user_id", destinatarios);
    const payload = JSON.stringify({
      ...t,
      cat: categoria,
      tag: `ev-${ev.id}`,
      // con el portal abierto, el Service Worker se lo pasa a la página
      evento: ev.tipo === "llamada" ? undefined : ev,
      accion: ev.cotizacion_id ? { tipo: "abrir-registro", id: ev.cotizacion_id } : null,
    });

    let enviadas = 0;
    await Promise.all((subs ?? []).map(async (s) => {
      if (excluirDispositivo && s.dispositivo === excluirDispositivo) return;
      if (categoria !== "llamadas" && (s.prefs ?? {})[categoria] === false) return;
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
          { TTL: ev.tipo === "llamada" ? 40 : 3600, urgency: ev.tipo === "llamada" ? "high" : "normal" },
        );
        enviadas++;
      } catch (e) {
        // suscripción vencida o revocada por el navegador: se borra
        const code = (e as { statusCode?: number }).statusCode;
        console.error("push", code, (e as { body?: string }).body ?? (e as Error).message);
        if (code === 404 || code === 410) await admin.from("push_suscripciones").delete().eq("endpoint", s.endpoint);
      }
    }));
    return json({ ok: true, enviadas });
  } catch (e) {
    console.error("notificar:", (e as Error).message);
    return json({ error: (e as Error).message }, 500);
  }
});
