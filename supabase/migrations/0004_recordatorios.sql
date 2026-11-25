-- Recordatorios con notificaciones del sistema (Web Push). Las llaves VAPID se insertan aparte en app_secrets.
create table if not exists public.push_subs(
  endpoint text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  p256dh text not null, auth text not null, tz text not null default 'America/El_Salvador',
  created_at timestamptz not null default now());
alter table public.push_subs enable row level security;
create policy push_subs_own on public.push_subs for all to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
create index if not exists push_subs_user on public.push_subs(user_id);
create table if not exists public.push_log(user_id uuid not null references auth.users(id) on delete cascade, kind text not null, day date not null, sent_at timestamptz not null default now(), primary key(user_id,kind,day));
alter table public.push_log enable row level security;
revoke all on public.push_log from anon, authenticated;
create table if not exists public.app_secrets(name text primary key, value text not null);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;
select cron.schedule('recordatorios-15min','*/15 * * * *',$$select net.http_post(url:='https://dxjyxmlknhjokkbatqla.supabase.co/functions/v1/recordatorios',headers:='{"Content-Type":"application/json"}'::jsonb,body:='{}'::jsonb,timeout_milliseconds:=55000)$$);
