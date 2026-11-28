// Tasas de cambio del día para el convertidor y el modo viaje.
// Monedas: ExchangeRate-API (acceso abierto, pide atribución y guardar en caché 24 h).
// Bitcoin: CoinGecko (API pública sin clave, pide atribución).
// Se consulta a los proveedores una vez al día; el resto sale de la tabla fx_cache.
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "max-age=3600" } });
const MONEDAS = ["GTQ", "HNL", "NIO", "CRC", "MXN", "EUR", "COP", "DOP", "GBP", "CAD", "JPY", "CNY", "PAB"];

async function traer(url: string) {
  const r = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return await r.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const hoy = new Date().toISOString().slice(0, 10);
  const { data: c } = await sb.from("fx_cache").select("day,data").order("day", { ascending: false }).limit(1).maybeSingle();
  if (c && c.day === hoy) return json(c.data);

  const r: Record<string, number> = {};
  let act: string | null = null, ok = false, btc: number | null = null;
  try {
    const j = await traer("https://open.er-api.com/v6/latest/USD");
    if (j && j.result === "success" && j.rates) {
      for (const k of MONEDAS) if (typeof j.rates[k] === "number" && j.rates[k] > 0) r[k] = j.rates[k];
      act = typeof j.time_last_update_utc === "string" ? j.time_last_update_utc : null;
      ok = Object.keys(r).length > 0;
    }
  } catch (_e) { /* se usa la última tasa guardada */ }
  try {
    const j = await traer("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd");
    const p = j && j.bitcoin && j.bitcoin.usd;
    if (typeof p === "number" && p > 0) btc = p;
  } catch (_e) { /* sin bitcoin hoy */ }

  const prev = c ? c.data : null;
  if (!ok) return prev ? json({ ...prev, viejo: true }) : json({ error: "sin-tasas" }, 503);
  const bu = btc ?? (prev && prev.btcUsd) ?? null;
  if (bu) { r.BTC = 1 / bu; r.SAT = 1e8 / bu; }
  const data = { fecha: hoy, act, base: "USD", r, btcUsd: bu, btcFecha: btc ? hoy : (prev && prev.btcFecha) || null };
  await sb.from("fx_cache").upsert({ day: hoy, data });
  const viejo = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
  await sb.from("fx_cache").delete().lt("day", viejo);
  return json(data);
});
