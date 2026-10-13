-- ============================================================
-- Portal DistriElectronicDelCaribe — Esquema de base de datos
-- Ejecutar en: Supabase Dashboard → SQL Editor → New query
--
-- El archivo es IDEMPOTENTE y SEGURO de re-ejecutar: no borra
-- tablas ni datos. Cada vez que cambie algo, pega este archivo
-- completo y dale Run; no hay que quitar nada de lo anterior.
--
-- Contenido:
--   1) Perfiles y roles
--   2) Cotizaciones
--   3) Consecutivo real del número de documento
--   4) Storage privado de imágenes
--   5) Migración de datos ya guardados
--   6) Firma digital de cada usuario
--   7) Almacenamiento usado (barra del menú)
--   8) Rol Administrador (único por portal)
--   9) Eventos de auditoría (avisos al Administrador y Jefes)
--  10) Dispositivos de cada cuenta (alertas de inicio de sesión)
--  11) Suscripciones a notificaciones push
--  12) Permisos del tiempo real (presencia, edición en conjunto, llamadas)
-- ============================================================


-- ============================================================
-- 1) PERFILES (extiende auth.users)
-- ============================================================
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text not null,
  email      text not null,
  role       text not null default 'trabajador' check (role in ('trabajador', 'jefe', 'administrador')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- ¿El usuario conectado gestiona el portal? (Jefe o Administrador:
-- el Administrador tiene todos los permisos de un Jefe)
create or replace function public.is_jefe()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('jefe', 'administrador')
  );
$$;

-- Cada quien ve su propio perfil; el jefe ve todos.
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select using (id = auth.uid() or public.is_jefe());

-- Sin políticas de insert/update/delete: los perfiles solo se tocan
-- desde la Edge Function admin-users (service role).

-- Nunca dejar el portal sin un jefe. Vale incluso para la service
-- role y para el borrado en cascada desde auth.users, así que un
-- jefe no se puede degradar ni eliminar si es el último que queda.
create or replace function public.proteger_ultimo_jefe()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  otros integer;
begin
  if OLD.role = 'jefe'
     and not (TG_OP = 'UPDATE' and NEW.role = 'jefe') then
    select count(*) into otros
    from public.profiles
    where role = 'jefe' and id <> OLD.id;
    if otros = 0 then
      raise exception 'No se puede dejar el portal sin ningún Jefe.';
    end if;
  end if;
  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end;
$$;

drop trigger if exists proteger_jefe on public.profiles;
create trigger proteger_jefe
  before update or delete on public.profiles
  for each row execute function public.proteger_ultimo_jefe();


-- ============================================================
-- 2) COTIZACIONES
-- ============================================================
create table if not exists public.cotizaciones (
  id          uuid primary key default gen_random_uuid(),
  numero      text not null,
  format_type text not null,
  data        jsonb not null default '{}'::jsonb,
  user_id     uuid references auth.users (id) on delete set null,
  owner_name  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists cotizaciones_user_idx on public.cotizaciones (user_id, updated_at desc);
create index if not exists cotizaciones_fecha_idx on public.cotizaciones (updated_at desc);

-- Borrar un trabajador ya NO borra sus reportes: la cotización queda
-- huérfana (user_id null) y solo el jefe la sigue viendo.
-- (Reemplaza la llave anterior, que tenía on delete cascade.)
alter table public.cotizaciones alter column user_id drop not null;

do $$
declare
  fk text;
begin
  -- quita cualquier llave foránea que cuelgue de user_id, se llame como se llame
  for fk in
    select con.conname
    from pg_constraint con
    join pg_attribute att
      on att.attrelid = con.conrelid and att.attnum = any (con.conkey)
    where con.conrelid = 'public.cotizaciones'::regclass
      and con.contype = 'f'
      and att.attname = 'user_id'
  loop
    execute format('alter table public.cotizaciones drop constraint %I', fk);
  end loop;

  alter table public.cotizaciones add constraint cotizaciones_user_id_fkey
    foreign key (user_id) references auth.users (id) on delete set null;
end;
$$;

alter table public.cotizaciones enable row level security;

-- Cada quien ve y edita solo lo suyo; el jefe, todo.
drop policy if exists "cot_select" on public.cotizaciones;
create policy "cot_select" on public.cotizaciones
  for select using (user_id = auth.uid() or public.is_jefe());

drop policy if exists "cot_insert" on public.cotizaciones;
create policy "cot_insert" on public.cotizaciones
  for insert with check (user_id = auth.uid());

drop policy if exists "cot_update" on public.cotizaciones;
create policy "cot_update" on public.cotizaciones
  for update using (user_id = auth.uid() or public.is_jefe());

drop policy if exists "cot_delete" on public.cotizaciones;
create policy "cot_delete" on public.cotizaciones
  for delete using (user_id = auth.uid() or public.is_jefe());

-- Quién lo modificó por última vez (se ve en el historial).
alter table public.cotizaciones add column if not exists updated_by uuid references auth.users (id) on delete set null;
alter table public.cotizaciones add column if not exists updated_by_name text;
-- se rellena con el dueño SIN pasar por el trigger, que pondría la fecha de hoy a todo
do $$
declare
  hay boolean := exists (select 1 from pg_trigger
    where tgname = 'cot_updated_at' and tgrelid = 'public.cotizaciones'::regclass);
begin
  if hay then alter table public.cotizaciones disable trigger cot_updated_at; end if;
  update public.cotizaciones set updated_by = user_id, updated_by_name = owner_name
    where updated_by is null and updated_by_name is null;
  if hay then alter table public.cotizaciones enable trigger cot_updated_at; end if;
end;
$$;

-- La fecha de modificación y quién la hizo los pone el servidor, no el
-- navegador: así nadie puede firmar un cambio a nombre de otro.
create or replace function public.tocar_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- editar_detalles (abajo) corrige nombre y fechas a mano: se respeta
  if tg_op = 'UPDATE' and current_setting('app.detalles', true) = '1' then
    return new;
  end if;
  new.updated_at := now();
  if auth.uid() is not null then
    new.updated_by := auth.uid();
    new.updated_by_name := coalesce((select full_name from public.profiles where id = auth.uid()), new.updated_by_name);
  end if;
  return new;
end;
$$;

drop trigger if exists cot_updated_at on public.cotizaciones;
create trigger cot_updated_at
  before insert or update on public.cotizaciones
  for each row execute function public.tocar_updated_at();

-- Nombre del archivo (título en el historial y nombre del PDF)
alter table public.cotizaciones add column if not exists nombre text;

-- Detalles de un formato ya terminado: nombre (dueño, Jefe o Administrador)
-- y fechas de creación y última modificación (solo Jefe o Administrador).
create or replace function public.editar_detalles(
  p_id uuid, p_nombre text, p_creado timestamptz, p_modificado timestamptz)
returns public.cotizaciones
language plpgsql security definer set search_path = public
as $$
declare
  r public.cotizaciones;
  gestor boolean := public.is_jefe();
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  select * into r from public.cotizaciones where id = p_id;
  if not found or not (r.user_id = auth.uid() or gestor) then
    raise exception 'No autorizado';
  end if;
  -- fecha en null = no se cambia
  if not gestor and (p_creado is not null or p_modificado is not null) then
    raise exception 'Solo un Jefe o el Administrador cambian las fechas';
  end if;
  if p_creado > now() or p_modificado > now() then
    raise exception 'Las fechas no pueden quedar en el futuro';
  end if;
  if coalesce(p_modificado, r.updated_at) < coalesce(p_creado, r.created_at) then
    raise exception 'La última modificación no puede ser anterior a la creación';
  end if;
  perform set_config('app.detalles', '1', true);
  update public.cotizaciones set
    nombre = nullif(left(trim(coalesce(p_nombre, '')), 120), ''),
    created_at = coalesce(p_creado, created_at),
    updated_at = coalesce(p_modificado, updated_at)
  where id = p_id
  returning * into r;
  perform set_config('app.detalles', '', true);
  return r;
end;
$$;

revoke all on function public.editar_detalles(uuid, text, timestamptz, timestamptz) from public, anon;
grant execute on function public.editar_detalles(uuid, text, timestamptz, timestamptz) to authenticated;


-- ============================================================
-- 3) CONSECUTIVO DEL NÚMERO DE DOCUMENTO
--    Antes el número traía 3 dígitos al azar (900 posibles): con
--    ~20 documentos del mismo tipo en un día había 1 de cada 5
--    posibilidades de repetir, y la tabla no lo impedía.
--    Ahora lo entrega el servidor y no se puede repetir.
-- ============================================================
create table if not exists public.consecutivos (
  prefijo text primary key,
  ultimo  bigint not null default 0
);

alter table public.consecutivos enable row level security;
-- Sin políticas: nadie la toca directo. Solo la función de abajo,
-- que es security definer y por eso sí puede escribir.

-- Arranca cada contador donde va la numeración actual.
insert into public.consecutivos (prefijo, ultimo)
select split_part(numero, '-', 1), count(*)
from public.cotizaciones
where numero like '%-%'
group by 1
on conflict (prefijo) do nothing;

create or replace function public.siguiente_numero(p_prefijo text)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  n bigint;
  p text := upper(trim(coalesce(p_prefijo, '')));
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;
  if p = '' or p !~ '^[A-Z]{2,8}$' then
    raise exception 'Prefijo no válido';
  end if;
  insert into public.consecutivos (prefijo, ultimo)
  values (p, 1)
  on conflict (prefijo) do update set ultimo = public.consecutivos.ultimo + 1
  returning ultimo into n;
  return p || '-' || to_char(now() at time zone 'America/Bogota', 'YYYYMMDD')
           || '-' || lpad(n::text, 4, '0');
end;
$$;

-- Índice único sobre el número. Si ya hay duplicados de la época del
-- número aleatorio, NO se crea y se avisa cuáles son (no se borra ni
-- se renombra nada por cuenta propia).
do $$
declare
  dups integer;
begin
  select count(*) into dups from (
    select numero from public.cotizaciones group by numero having count(*) > 1
  ) t;
  if dups > 0 then
    raise warning 'Hay % número(s) duplicado(s): no se creó el índice único. Míralos con:  select numero, count(*) from public.cotizaciones group by numero having count(*) > 1;', dups;
  else
    create unique index if not exists cotizaciones_numero_key on public.cotizaciones (numero);
  end if;
end;
$$;


-- ============================================================
-- 4) STORAGE — imágenes de los servicios (bucket PRIVADO)
--    Antes el bucket era público y la política de lectura no pedía
--    sesión: con la anon key (que va en el navegador) cualquiera
--    podía listar el bucket y bajarse TODAS las fotos de todos los
--    clientes. Ahora hace falta sesión y solo se ve lo propio.
--    El portal abre las imágenes con URL firmada temporal.
-- ============================================================
insert into storage.buckets (id, name, public)
values ('cotizacion-images', 'cotizacion-images', false)
on conflict (id) do nothing;

update storage.buckets
   set public = false,
       file_size_limit = 10485760,          -- 10 MB por imagen
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id = 'cotizacion-images';

-- Cada trabajador sube a su propia carpeta: <uuid-usuario>/archivo.jpg
drop policy if exists "img_insert" on storage.objects;
create policy "img_insert" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'cotizacion-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Lectura: solo con sesión, y solo la carpeta propia (el jefe, todas)
drop policy if exists "img_select" on storage.objects;
create policy "img_select" on storage.objects
  for select to authenticated using (
    bucket_id = 'cotizacion-images'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_jefe())
  );

drop policy if exists "img_delete" on storage.objects;
create policy "img_delete" on storage.objects
  for delete to authenticated using (
    bucket_id = 'cotizacion-images'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_jefe())
  );


-- ============================================================
-- 5) MIGRACIÓN DE LO YA GUARDADO
--    Los registros viejos tienen la URL pública completa dentro de
--    data.imagenes. Con el bucket privado esa URL deja de servir,
--    así que se deja únicamente la ruta y el portal la firma al
--    momento de mostrarla.
--      antes:  https://<proy>.supabase.co/storage/v1/object/public/cotizacion-images/<uuid>/foto.jpg
--      ahora:  <uuid>/foto.jpg
-- ============================================================
update public.cotizaciones c
   set data = jsonb_set(c.data, '{imagenes}', (
         select coalesce(jsonb_agg(
                  case when v like 'http%/cotizacion-images/%'
                       then to_jsonb(split_part(v, '/cotizacion-images/', 2))
                       else to_jsonb(v) end
                  order by ord),
                '[]'::jsonb)
         from jsonb_array_elements_text(c.data -> 'imagenes') with ordinality as t(v, ord)
       ))
 where jsonb_typeof(c.data -> 'imagenes') = 'array'
   and c.data ->> 'imagenes' like '%/cotizacion-images/%';


-- ============================================================
-- 6) FIRMA DIGITAL DE CADA USUARIO
--    PNG (dataURL) guardado en el perfil. Por la política
--    profiles_select cada quien lee solo la suya y el jefe la de
--    todos: el usuario Y nunca recibe la firma del usuario X.
--    Se escribe solo con guardar_firma(): el jefe la de cualquiera,
--    cada usuario la propia.
-- ============================================================
alter table public.profiles add column if not exists firma text;

alter table public.profiles drop constraint if exists profiles_firma_check;
alter table public.profiles add constraint profiles_firma_check check (
  firma is null
  or (firma like 'data:image/png;base64,%' and length(firma) <= 700000)
);

create or replace function public.guardar_firma(p_usuario uuid, p_firma text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;
  if p_usuario <> auth.uid() and not public.is_jefe() then
    raise exception 'Solo los Jefes pueden cambiar la firma de otro usuario.';
  end if;
  -- la firma del Administrador solo la cambia él mismo
  if p_usuario <> auth.uid()
     and exists (select 1 from public.profiles where id = p_usuario and role = 'administrador') then
    raise exception 'Solo el Administrador puede cambiar su propia firma.';
  end if;
  update public.profiles set firma = nullif(p_firma, '') where id = p_usuario;
  if not found then
    raise exception 'Usuario no encontrado.';
  end if;
end;
$$;

revoke all on function public.guardar_firma(uuid, text) from public, anon;
grant execute on function public.guardar_firma(uuid, text) to authenticated;


-- ============================================================
-- 7) ALMACENAMIENTO USADO
--    Lo que muestra la barra del menú (solo a los Jefes):
--    bytes de todos los archivos del Storage y tamaño de la base.
-- ============================================================
create or replace function public.uso_almacenamiento()
returns json
language plpgsql stable security definer set search_path = public, storage
as $$
begin
  if not public.is_jefe() then
    raise exception 'Solo los Jefes pueden ver el almacenamiento.';
  end if;
  return json_build_object(
    'archivos',   (select coalesce(sum((metadata ->> 'size')::bigint), 0) from storage.objects),
    'cantidad',   (select count(*) from storage.objects),
    'base_datos', pg_database_size(current_database())
  );
end;
$$;

revoke all on function public.uso_almacenamiento() from public, anon;
grant execute on function public.uso_almacenamiento() to authenticated;


-- ============================================================
-- 8) ROL ADMINISTRADOR
--    - Solo puede haber UNO por portal (índice único).
--    - Lo crea un Jefe desde el portal (Usuarios → Nuevo usuario).
--    - Tiene todos los permisos de un Jefe (ver is_jefe) y además
--      recibe los avisos de auditoría.
--    - Desde el portal nadie lo degrada ni lo elimina: solo desde el
--      panel de Supabase (SQL Editor o Authentication → Users).
-- ============================================================
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('trabajador', 'jefe', 'administrador'));

create unique index if not exists profiles_un_administrador
  on public.profiles (role) where role = 'administrador';

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'administrador');
$$;

/* Las órdenes que llegan por la API (PostgREST) traen un JWT en
   request.jwt.claims; el SQL Editor y el panel de Authentication no.
   Así el Administrador no se puede degradar ni borrar desde el portal
   (ni con la service role de la Edge Function), pero sí desde Supabase. */
create or replace function public.proteger_administrador()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  por_api boolean := coalesce(current_setting('request.jwt.claims', true), '') <> '';
begin
  if OLD.role = 'administrador'
     and (TG_OP = 'DELETE' or NEW.role <> 'administrador')
     and por_api then
    raise exception 'El Administrador solo se puede quitar desde el panel de Supabase.';
  end if;
  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end;
$$;

drop trigger if exists proteger_administrador on public.profiles;
create trigger proteger_administrador
  before update or delete on public.profiles
  for each row execute function public.proteger_administrador();


-- ============================================================
-- 9) EVENTOS DE AUDITORÍA
--    Lo que ven en vivo el Administrador y los Jefes: un trabajador
--    entra, abre o empieza a editar un formato, lo completa o firma.
--    También las alertas de inicio de sesión en un dispositivo nuevo
--    (esas solo las ve el dueño de la cuenta).
-- ============================================================
create table if not exists public.eventos (
  id            bigint generated always as identity primary key,
  tipo          text not null,
  actor_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  actor_nombre  text,
  actor_rol     text,
  cotizacion_id uuid references public.cotizaciones (id) on delete set null,
  detalle       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

alter table public.eventos drop constraint if exists eventos_tipo_check;
alter table public.eventos add constraint eventos_tipo_check check (tipo in (
  'ingreso', 'formato_abierto', 'formato_editando', 'formato_completado', 'nuevo_dispositivo', 'llamada'));
alter table public.eventos drop constraint if exists eventos_detalle_check;
alter table public.eventos add constraint eventos_detalle_check check (octet_length(detalle::text) <= 4000);

create index if not exists eventos_fecha_idx on public.eventos (created_at desc);

alter table public.eventos enable row level security;

drop policy if exists "ev_insert" on public.eventos;
create policy "ev_insert" on public.eventos
  for insert to authenticated with check (actor_id = auth.uid());

drop policy if exists "ev_select" on public.eventos;
create policy "ev_select" on public.eventos
  for select to authenticated using (
    (tipo = 'nuevo_dispositivo' and actor_id = auth.uid())
    -- el Administrador ve lo de trabajadores y Jefes; los Jefes, solo lo de trabajadores
    or (tipo <> 'nuevo_dispositivo' and (public.is_admin()
        or (public.is_jefe() and (actor_rol = 'trabajador' or actor_id = auth.uid()))))
  );

-- quién lo hizo lo pone la base de datos (no se puede falsear desde el navegador)
create or replace function public.completar_evento()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  NEW.actor_id := auth.uid();
  NEW.created_at := now();
  select full_name, role into NEW.actor_nombre, NEW.actor_rol
    from public.profiles where id = NEW.actor_id;
  if NEW.actor_nombre is null then
    raise exception 'Perfil no encontrado.';
  end if;
  if NEW.tipo = 'llamada' and NEW.actor_rol not in ('jefe', 'administrador') then
    raise exception 'Solo los Jefes y el Administrador hacen llamadas.';
  end if;
  -- la tabla no crece sin fin: de vez en cuando se borra lo de más de 90 días
  if random() < 0.02 then
    delete from public.eventos where created_at < now() - interval '90 days';
  end if;
  return NEW;
end;
$$;

drop trigger if exists completar_evento on public.eventos;
create trigger completar_evento
  before insert on public.eventos
  for each row execute function public.completar_evento();

-- los eventos nuevos viajan en tiempo real (la RLS de arriba decide a quién)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'eventos') then
    alter publication supabase_realtime add table public.eventos;
  end if;
end;
$$;


-- ============================================================
-- 10) DISPOSITIVOS DE CADA CUENTA
--     Si alguien entra desde un navegador que la cuenta no había usado
--     y ya tiene otros, el portal avisa en los otros equipos (estilo
--     Gmail). Cada quien solo ve los suyos.
-- ============================================================
create table if not exists public.dispositivos (
  user_id     uuid not null references auth.users (id) on delete cascade,
  dispositivo text not null check (length(dispositivo) between 8 and 64),
  navegador   text,
  sistema     text,
  tipo        text,
  creado      timestamptz not null default now(),
  visto       timestamptz not null default now(),
  primary key (user_id, dispositivo)
);

alter table public.dispositivos enable row level security;

drop policy if exists "disp_select" on public.dispositivos;
create policy "disp_select" on public.dispositivos
  for select to authenticated using (user_id = auth.uid());

create or replace function public.registrar_dispositivo(
  p_dispositivo text, p_navegador text, p_sistema text, p_tipo text)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  otros integer;
  nuevo boolean;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;
  select count(*) into otros from public.dispositivos
   where user_id = auth.uid() and dispositivo <> p_dispositivo;
  insert into public.dispositivos (user_id, dispositivo, navegador, sistema, tipo)
  values (auth.uid(), left(p_dispositivo, 64), left(p_navegador, 40), left(p_sistema, 40), left(p_tipo, 20))
  on conflict (user_id, dispositivo) do update
    set visto = now(), navegador = excluded.navegador, sistema = excluded.sistema, tipo = excluded.tipo
  returning (xmax = 0) into nuevo;   -- true = era nuevo (se insertó)
  return json_build_object('nuevo', nuevo, 'otros', otros);
end;
$$;

revoke all on function public.registrar_dispositivo(text, text, text, text) from public, anon;
grant execute on function public.registrar_dispositivo(text, text, text, text) to authenticated;


-- ============================================================
-- 11) SUSCRIPCIONES A NOTIFICACIONES PUSH
--     Una por navegador, con las preferencias de avisos de esa
--     persona (la Edge Function «notificar» las respeta).
-- ============================================================
create table if not exists public.push_suscripciones (
  endpoint    text primary key check (endpoint like 'https://%' and length(endpoint) <= 1000),
  user_id     uuid not null references auth.users (id) on delete cascade,
  p256dh      text not null,
  auth        text not null,
  dispositivo text,
  prefs       jsonb not null default '{}'::jsonb,
  actualizada timestamptz not null default now()
);

create index if not exists push_usuario_idx on public.push_suscripciones (user_id);

alter table public.push_suscripciones enable row level security;

drop policy if exists "push_select" on public.push_suscripciones;
create policy "push_select" on public.push_suscripciones
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "push_delete" on public.push_suscripciones;
create policy "push_delete" on public.push_suscripciones
  for delete to authenticated using (user_id = auth.uid());

-- si el navegador ya estaba suscrito con otra cuenta, pasa a la actual
create or replace function public.guardar_suscripcion(
  p_endpoint text, p_p256dh text, p_auth text, p_dispositivo text, p_prefs jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;
  insert into public.push_suscripciones (endpoint, user_id, p256dh, auth, dispositivo, prefs)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth, left(p_dispositivo, 64), coalesce(p_prefs, '{}'::jsonb))
  on conflict (endpoint) do update
    set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth,
        dispositivo = excluded.dispositivo, prefs = excluded.prefs, actualizada = now();
end;
$$;

revoke all on function public.guardar_suscripcion(text, text, text, text, jsonb) from public, anon;
grant execute on function public.guardar_suscripcion(text, text, text, text, jsonb) to authenticated;


-- ============================================================
-- 12) PERMISOS DEL TIEMPO REAL (canales privados)
--     portal        presencia: todos los usuarios del portal
--     auditoria     cambios de la tabla eventos (filtra su propia RLS)
--     usuario:<id>  buzón de llamadas: lo lee solo su dueño; cualquiera
--                   del portal puede escribirle (para timbrar/contestar)
--     doc:<id>      un formato: quien puede verlo (dueño o Jefe/Admin)
-- ============================================================
create or replace function public.rt_permitido(p_topic text, p_escribir boolean)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare
  pre   text := split_part(p_topic, ':', 1);
  resto text := substr(p_topic, length(split_part(p_topic, ':', 1)) + 2);
begin
  if auth.uid() is null or not exists (select 1 from public.profiles where id = auth.uid()) then
    return false;
  end if;
  if p_topic in ('portal', 'auditoria') then
    return true;
  end if;
  if pre = 'usuario' then
    return p_escribir or resto = auth.uid()::text;
  end if;
  if pre = 'doc' and resto ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return exists (
      select 1 from public.cotizaciones c
       where c.id = resto::uuid and (c.user_id = auth.uid() or public.is_jefe())
    );
  end if;
  return false;
end;
$$;

revoke all on function public.rt_permitido(text, boolean) from public, anon;
grant execute on function public.rt_permitido(text, boolean) to authenticated;

drop policy if exists "rt_leer" on realtime.messages;
create policy "rt_leer" on realtime.messages
  for select to authenticated using (public.rt_permitido(realtime.topic(), false));

drop policy if exists "rt_escribir" on realtime.messages;
create policy "rt_escribir" on realtime.messages
  for insert to authenticated with check (public.rt_permitido(realtime.topic(), true));


-- ============================================================
-- PRIMER JEFE (solo la primera vez que montas el proyecto):
-- 1. Authentication → Users → Add user (marca "Auto Confirm User").
-- 2. Copia su UUID y ejecuta, cambiando los valores:
--
-- insert into public.profiles (id, full_name, email, role)
-- values ('UUID-DEL-USUARIO', 'Nombre del Jefe', 'jefe@empresa.com', 'jefe');
-- ============================================================
