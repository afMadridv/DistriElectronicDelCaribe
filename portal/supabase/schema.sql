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
-- ============================================================


-- ============================================================
-- 1) PERFILES (extiende auth.users)
-- ============================================================
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text not null,
  email      text not null,
  role       text not null default 'trabajador' check (role in ('trabajador', 'jefe')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- ¿El usuario conectado es jefe?
create or replace function public.is_jefe()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'jefe'
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

-- La fecha de modificación la pone el servidor, no el reloj del navegador.
create or replace function public.tocar_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists cot_updated_at on public.cotizaciones;
create trigger cot_updated_at
  before update on public.cotizaciones
  for each row execute function public.tocar_updated_at();


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
-- PRIMER JEFE (solo la primera vez que montas el proyecto):
-- 1. Authentication → Users → Add user (marca "Auto Confirm User").
-- 2. Copia su UUID y ejecuta, cambiando los valores:
--
-- insert into public.profiles (id, full_name, email, role)
-- values ('UUID-DEL-USUARIO', 'Nombre del Jefe', 'jefe@empresa.com', 'jefe');
-- ============================================================
