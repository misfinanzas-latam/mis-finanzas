-- Conexión directa con Gmail (OAuth, solo lectura) y revisión automática cada 5 minutos.
create extension if not exists pg_cron;
create extension if not exists pg_net;
create table if not exists public.gmail_links (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  refresh_token text not null,
  seen jsonb not null default '[]'::jsonb,
  last_check timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
alter table public.gmail_links enable row level security;
revoke all on public.gmail_links from anon, authenticated;
create or replace function public.gmail_status()
returns table(email text, last_check timestamptz, last_error text, created_at timestamptz)
language sql security definer set search_path = '' stable as $$
  select g.email, g.last_check, g.last_error, g.created_at from public.gmail_links g where g.user_id = (select auth.uid());
$$;
create or replace function public.gmail_disconnect()
returns void language sql security definer set search_path = '' as $$
  delete from public.gmail_links where user_id = (select auth.uid());
$$;
revoke all on function public.gmail_status() from public, anon;
revoke all on function public.gmail_disconnect() from public, anon;
grant execute on function public.gmail_status() to authenticated;
grant execute on function public.gmail_disconnect() to authenticated;
select cron.schedule('gmail-poll-5min','*/5 * * * *',$$select net.http_post(url:='https://dxjyxmlknhjokkbatqla.supabase.co/functions/v1/gmail-poll',headers:='{"Content-Type":"application/json"}'::jsonb,body:='{}'::jsonb,timeout_milliseconds:=55000)$$);
