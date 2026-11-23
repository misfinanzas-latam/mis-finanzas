-- Alertas bancarias: clave personal (hash) y bandeja de alertas crudas
create table if not exists public.alert_keys (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  key_hash text not null unique,
  created_at timestamptz not null default now()
);
alter table public.alert_keys enable row level security;
create policy alert_keys_own_select on public.alert_keys for select to authenticated using ((select auth.uid()) = user_id);
create policy alert_keys_own_insert on public.alert_keys for insert to authenticated with check ((select auth.uid()) = user_id);
create policy alert_keys_own_update on public.alert_keys for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy alert_keys_own_delete on public.alert_keys for delete to authenticated using ((select auth.uid()) = user_id);
revoke all on public.alert_keys from anon;
grant select, insert, update, delete on public.alert_keys to authenticated;

create table if not exists public.inbox (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null default 'otro' check (char_length(source) <= 20),
  text text not null check (char_length(text) between 1 and 5000),
  created_at timestamptz not null default now()
);
create index if not exists inbox_user_idx on public.inbox(user_id, created_at);
alter table public.inbox enable row level security;
create policy inbox_own_select on public.inbox for select to authenticated using ((select auth.uid()) = user_id);
create policy inbox_own_delete on public.inbox for delete to authenticated using ((select auth.uid()) = user_id);
revoke all on public.inbox from anon;
grant select, delete on public.inbox to authenticated;
do $$ begin alter publication supabase_realtime add table public.inbox; exception when duplicate_object then null; end $$;
