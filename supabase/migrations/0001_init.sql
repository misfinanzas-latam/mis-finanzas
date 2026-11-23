-- Mis Finanzas: esquema inicial
-- Cada usuario guarda sus datos como documentos JSON (movimientos, cuentas, fuentes, gastos fijos, escenarios).
-- Las reglas RLS hacen que cada sesión solo pueda leer y escribir sus propias filas.

create table if not exists public.docs (
  user_id    uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  id         text        not null check (char_length(id) between 1 and 80),
  body       jsonb       not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  constraint docs_body_size check (pg_column_size(body) < 262144)
);

alter table public.docs enable row level security;
alter table public.docs replica identity full;

drop policy if exists docs_select_own on public.docs;
drop policy if exists docs_insert_own on public.docs;
drop policy if exists docs_update_own on public.docs;
drop policy if exists docs_delete_own on public.docs;

create policy docs_select_own on public.docs for select to authenticated using ((select auth.uid()) = user_id);
create policy docs_insert_own on public.docs for insert to authenticated with check ((select auth.uid()) = user_id);
create policy docs_update_own on public.docs for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy docs_delete_own on public.docs for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.docs from anon;
grant select, insert, update, delete on public.docs to authenticated;

-- Tiempo real (para sincronizar entre teléfono y computadora)
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null; end $$;

-- Eliminar la cuenta desde la app (requisito de Apple App Store)
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  delete from public.docs where user_id = auth.uid();
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
