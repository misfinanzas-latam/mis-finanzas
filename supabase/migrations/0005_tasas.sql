-- Tasas de cambio del día (las llena la función "tasas"; nadie más lee ni escribe)
create table if not exists public.fx_cache (
  day date primary key,
  data jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.fx_cache enable row level security;
revoke all on public.fx_cache from anon, authenticated;
