// ============================================================
// Edge Function: admin-users
// Permite a los Jefes crear, editar y eliminar usuarios usando
// la service role key (nunca expuesta al frontend).
//
// Desplegar con:  supabase functions deploy admin-users
// ============================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // 1. Verificar que quien llama es un Jefe autenticado
    const authHeader = req.headers.get("Authorization") ?? "";
    const caller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return json({ error: "No autenticado." }, 401);

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: profile } = await admin
      .from("profiles").select("role").eq("id", user.id).single();
    if (!profile || profile.role !== "jefe") {
      return json({ error: "Solo los Jefes pueden gestionar usuarios." }, 403);
    }

    // 2. Ejecutar la acción
    const body = await req.json();
    const { action } = body;

    if (action === "create") {
      const { name, email, password, role } = body;
      if (!name || !email || !password) return json({ error: "Faltan datos." }, 400);
      const { data: created, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
      });
      if (error) return json({ error: error.message }, 400);
      const { error: pErr } = await admin.from("profiles").insert({
        id: created.user.id, full_name: name, email, role: role || "trabajador",
      });
      if (pErr) return json({ error: pErr.message }, 400);
      return json({ ok: true, id: created.user.id });
    }

    if (action === "update") {
      const { id, name, email, password, role } = body;
      if (!id) return json({ error: "Falta el id." }, 400);
      const authUpdate: Record<string, string> = {};
      if (email) authUpdate.email = email;
      if (password) authUpdate.password = password;
      if (Object.keys(authUpdate).length) {
        const { error } = await admin.auth.admin.updateUserById(id, authUpdate);
        if (error) return json({ error: error.message }, 400);
      }
      const { error: pErr } = await admin.from("profiles")
        .update({ full_name: name, email, role }).eq("id", id);
      if (pErr) return json({ error: pErr.message }, 400);
      return json({ ok: true });
    }

    if (action === "delete") {
      const { id } = body;
      if (!id) return json({ error: "Falta el id." }, 400);
      if (id === user.id) return json({ error: "No puedes eliminar tu propio usuario." }, 400);
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    return json({ error: "Acción no válida." }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
