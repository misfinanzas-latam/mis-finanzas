-- Espacios compartidos (pareja o familia): un libro aparte del personal que ven y editan sus miembros.
-- Salir, quitar a alguien o cerrar un espacio se marca con fecha (salio / borrado); el acceso se corta al instante.
create table if not exists public.espacios(
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (char_length(nombre) between 1 and 60),
  owner uuid not null,
  created_at timestamptz not null default now(),
  borrado timestamptz
);
create table if not exists public.espacio_miembros(
  espacio_id uuid not null references public.espacios(id),
  user_id uuid not null,
  nombre text not null default '' check (char_length(nombre) <= 40),
  rol text not null default 'miembro' check (rol in ('dueno','miembro')),
  created_at timestamptz not null default now(),
  salio timestamptz,
  primary key(espacio_id, user_id)
);
create index if not exists espacio_miembros_user_idx on public.espacio_miembros(user_id);
create table if not exists public.espacio_docs(
  espacio_id uuid not null references public.espacios(id),
  id text not null check (char_length(id) <= 80),
  body jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key(espacio_id, id)
);
create table if not exists public.espacio_invites(
  code text primary key,
  espacio_id uuid not null references public.espacios(id),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  used_by uuid,
  used_at timestamptz
);
create index if not exists espacio_invites_esp_idx on public.espacio_invites(espacio_id);

create or replace function public.es_miembro(e uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.espacio_miembros m join public.espacios s on s.id = m.espacio_id
    where m.espacio_id = e and m.user_id = (select auth.uid()) and m.salio is null and s.borrado is null)
$$;

alter table public.espacios enable row level security;
alter table public.espacio_miembros enable row level security;
alter table public.espacio_docs enable row level security;
alter table public.espacio_invites enable row level security;

create policy espacios_sel on public.espacios for select to authenticated using (public.es_miembro(id));
create policy espacios_mfa on public.espacios as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
create policy em_sel on public.espacio_miembros for select to authenticated using (public.es_miembro(espacio_id));
create policy em_mfa on public.espacio_miembros as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
create policy ed_all on public.espacio_docs for all to authenticated using (public.es_miembro(espacio_id)) with check (public.es_miembro(espacio_id));
create policy ed_mfa on public.espacio_docs as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
-- espacio_invites: sin políticas (nadie las lee directo); solo las funciones de abajo.

create or replace function public.crear_espacio(p_nombre text, p_mio text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid(); e uuid; n int;
begin
  if u is null or not public.mfa_ok() then raise exception 'forbidden' using errcode = '42501'; end if;
  select count(*) into n from public.espacio_miembros m join public.espacios s on s.id = m.espacio_id where m.user_id = u and m.salio is null and s.borrado is null;
  if n >= 5 then raise exception 'Puedes estar en máximo 5 espacios' using errcode = 'P0001'; end if;
  insert into public.espacios(nombre, owner) values (left(coalesce(nullif(trim(p_nombre), ''), 'Hogar'), 60), u) returning id into e;
  insert into public.espacio_miembros(espacio_id, user_id, nombre, rol) values (e, u, left(coalesce(trim(p_mio), ''), 40), 'dueno');
  return e;
end $$;

create or replace function public.invitar_espacio(p_espacio uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid(); b bytea; c text := ''; n int;
begin
  if u is null or not public.es_miembro(p_espacio) or not public.mfa_ok() then raise exception 'forbidden' using errcode = '42501'; end if;
  select count(*) into n from public.espacio_miembros where espacio_id = p_espacio and salio is null;
  if n >= 8 then raise exception 'El espacio ya tiene 8 personas' using errcode = 'P0001'; end if;
  select count(*) into n from public.espacio_invites where espacio_id = p_espacio and used_by is null and expires_at > now();
  if n >= 10 then raise exception 'Hay demasiadas invitaciones abiertas' using errcode = 'P0001'; end if;
  b := extensions.gen_random_bytes(10);
  for i in 0..9 loop c := c || substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (get_byte(b, i) % 32) + 1, 1); end loop;
  insert into public.espacio_invites(code, espacio_id, created_by) values (c, p_espacio, u);
  return c;
end $$;

create or replace function public.unirse_espacio(p_code text, p_mio text) returns json
language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid(); inv public.espacio_invites%rowtype; n int; nom text;
begin
  if u is null or not public.mfa_ok() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into inv from public.espacio_invites where code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')) for update;
  if not found or inv.used_by is not null or inv.expires_at < now() then raise exception 'El código no es válido o ya venció' using errcode = 'P0001'; end if;
  select s.nombre into nom from public.espacios s where s.id = inv.espacio_id and s.borrado is null;
  if nom is null then raise exception 'Ese espacio ya no existe' using errcode = 'P0001'; end if;
  if public.es_miembro(inv.espacio_id) then raise exception 'Ya estás en este espacio' using errcode = 'P0001'; end if;
  select count(*) into n from public.espacio_miembros m join public.espacios s on s.id = m.espacio_id where m.user_id = u and m.salio is null and s.borrado is null;
  if n >= 5 then raise exception 'Puedes estar en máximo 5 espacios' using errcode = 'P0001'; end if;
  update public.espacio_invites set used_by = u, used_at = now() where code = inv.code;
  insert into public.espacio_miembros(espacio_id, user_id, nombre, rol) values (inv.espacio_id, u, left(coalesce(trim(p_mio), ''), 40), 'miembro')
    on conflict (espacio_id, user_id) do update set salio = null, rol = 'miembro', nombre = excluded.nombre;
  return json_build_object('id', inv.espacio_id, 'nombre', nom);
end $$;

create or replace function public.salir_espacio(p_espacio uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid(); dueno boolean; otro uuid;
begin
  if u is null or not public.es_miembro(p_espacio) then raise exception 'forbidden' using errcode = '42501'; end if;
  select (owner = u) into dueno from public.espacios where id = p_espacio;
  update public.espacio_miembros set salio = now() where espacio_id = p_espacio and user_id = u;
  if dueno then
    select m.user_id into otro from public.espacio_miembros m where m.espacio_id = p_espacio and m.salio is null order by m.created_at limit 1;
    if otro is null then update public.espacios set borrado = now() where id = p_espacio;
    else
      update public.espacios set owner = otro where id = p_espacio;
      update public.espacio_miembros set rol = 'dueno' where espacio_id = p_espacio and user_id = otro;
    end if;
  end if;
end $$;

create or replace function public.quitar_miembro(p_espacio uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.espacios where id = p_espacio and owner = (select auth.uid()) and borrado is null) or not public.mfa_ok() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_user = (select auth.uid()) then raise exception 'Para irte usa Salir del espacio' using errcode = 'P0001'; end if;
  update public.espacio_miembros set salio = now() where espacio_id = p_espacio and user_id = p_user and salio is null;
end $$;

create or replace function public.cerrar_espacio(p_espacio uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.espacios where id = p_espacio and owner = (select auth.uid()) and borrado is null) or not public.mfa_ok() then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.espacio_miembros set salio = now() where espacio_id = p_espacio and salio is null;
  update public.espacios set borrado = now() where id = p_espacio;
end $$;

create or replace function public.renombrar_espacio(p_espacio uuid, p_nombre text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.espacios where id = p_espacio and owner = (select auth.uid()) and borrado is null) or not public.mfa_ok() then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.espacios set nombre = left(coalesce(nullif(trim(p_nombre), ''), nombre), 60) where id = p_espacio;
end $$;

do $$ begin alter publication supabase_realtime add table public.espacio_docs; exception when duplicate_object then null; end $$;
