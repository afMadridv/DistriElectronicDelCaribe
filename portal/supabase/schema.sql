-- ============================================================
-- Portal DistriElectronicDelCaribe — Esquema de base de datos
-- Ejecutar en: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- ---------- Perfiles (extiende auth.users) ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null,
  role text not null default 'trabajador' check (role in ('trabajador', 'jefe')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Función auxiliar: ¿el usuario actual es jefe?
create or replace function public.is_jefe()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'jefe'
  );
$$;

-- Cada usuario ve su propio perfil; los jefes ven todos
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select using (id = auth.uid() or public.is_jefe());

-- Solo el sistema (service role via Edge Function) inserta/edita/elimina perfiles.
-- No se crean políticas de insert/update/delete para el rol anon/authenticated.

-- ---------- Cotizaciones ----------
create table if not exists public.cotizaciones (
  id uuid primary key default gen_random_uuid(),
  numero text not null,
  format_type text not null,
  data jsonb not null default '{}'::jsonb,
  user_id uuid not null references auth.users(id) on delete cascade,
  owner_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cotizaciones_user_idx on public.cotizaciones(user_id, updated_at desc);

alter table public.cotizaciones enable row level security;

-- RLS: cada usuario ve/edita solo sus cotizaciones; el jefe ve todas
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

-- ---------- Storage (imágenes) ----------
insert into storage.buckets (id, name, public)
values ('cotizacion-images', 'cotizacion-images', true)
on conflict (id) do nothing;

-- Cada usuario sube a su propia carpeta (userId/archivo.jpg); lectura pública
drop policy if exists "img_insert" on storage.objects;
create policy "img_insert" on storage.objects
  for insert with check (
    bucket_id = 'cotizacion-images'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "img_select" on storage.objects;
create policy "img_select" on storage.objects
  for select using (bucket_id = 'cotizacion-images');

drop policy if exists "img_delete" on storage.objects;
create policy "img_delete" on storage.objects
  for delete using (
    bucket_id = 'cotizacion-images'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_jefe())
  );

-- ============================================================
-- IMPORTANTE — Primer usuario Jefe:
-- 1. Crea el usuario en Authentication → Users → Add user
--    (marca "Auto Confirm User").
-- 2. Copia su UUID y ejecuta (reemplaza los valores):
--
-- insert into public.profiles (id, full_name, email, role)
-- values ('UUID-DEL-USUARIO', 'Nombre del Jefe', 'jefe@empresa.com', 'jefe');
-- ============================================================
