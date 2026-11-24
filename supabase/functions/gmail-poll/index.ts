// Revisa cada 5 minutos el Gmail de quienes lo conectaron y manda a su bandeja
// las alertas de compra de sus bancos. Solo lectura; no marca ni borra nada.
// Sin JWT: la llama pg_cron. Cada cuenta se revisa como máximo una vez cada 4 minutos.
import { createClient } from "jsr:@supabase/supabase-js@2";

const CID = Deno.env.get("GOOGLE_CLIENT_ID") || "";
const CSEC = Deno.env.get("GOOGLE_CLIENT_SECRET") || "";
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, GET, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const BANCOS: Record<string, string> = {
  "Banco Agrícola": "bancoagricola", "BAC Credomatic": "credomatic", "Banco Cuscatlán": "bancocuscatlan", "Davivienda": "davivienda",
  "Promerica": "promerica", "Banco Hipotecario": "bancohipotecario", "Banco Atlántida": "bancoatlantida", "Banco Azul": "bancoazul",
  "Banco Industrial": "bi.com.sv", "Fedecrédito": "fedecredito",
};
const PALABRAS = "{compra transaccion transacción consumo cargo retiro debito débito abono pago autorizada aprobada}";

const dec = (d: string) => { try { return new TextDecoder().decode(Uint8Array.from(atob(d.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))); } catch (_e) { return ""; } };
// deno-lint-ignore no-explicit-any
function bodyOf(p: any): { plain: string; html: string } {
  const r = { plain: "", html: "" };
  // deno-lint-ignore no-explicit-any
  const walk = (x: any) => {
    if (!x) return;
    if (x.mimeType === "text/plain" && x.body?.data && !r.plain) r.plain = dec(x.body.data);
    if (x.mimeType === "text/html" && x.body?.data && !r.html) r.html = dec(x.body.data);
    (x.parts || []).forEach(walk);
  };
  walk(p);
  return r;
}
const strip = (h: string) => h.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#36;|&dollar;/g, "$").replace(/&[a-z]+;/g, " ").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();

async function access(rt: string) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CID, client_secret: CSEC, refresh_token: rt, grant_type: "refresh_token" }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(j.error === "invalid_grant" ? "Permiso revocado: vuelve a conectar Gmail" : "No se pudo renovar el permiso");
  return j.access_token as string;
}

// deno-lint-ignore no-explicit-any
async function check(l: any) {
  const at = await access(l.refresh_token);
  const H = { Authorization: "Bearer " + at };
  const { data: cfgRow } = await admin.from("docs").select("body").eq("user_id", l.user_id).eq("id", "cfg").maybeSingle();
  const cfg = cfgRow?.body || {};
  const rem = [...(cfg.alBancos || []).map((n: string) => BANCOS[n]).filter(Boolean), ...(cfg.alCorreo ? [String(cfg.alCorreo).trim()] : [])];
  const from = (rem.length ? rem : Object.values(BANCOS)).join(" OR ");
  const q = `from:(${from}) ${PALABRAS} newer_than:2d`;
  const ls = await (await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=25&q=" + encodeURIComponent(q), { headers: H })).json();
  if (ls.error) throw new Error(ls.error.message || "Error de Gmail");
  const seen: string[] = Array.isArray(l.seen) ? l.seen : [];
  let n = 0;
  for (const m of (ls.messages || []).reverse()) {
    if (seen.includes(m.id)) continue;
    const msg = await (await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`, { headers: H })).json();
    if (msg.error) continue;
    const subj = (msg.payload?.headers || []).find((h: { name: string }) => h.name.toLowerCase() === "subject")?.value || "";
    const b = bodyOf(msg.payload);
    const text = (subj + "\n" + (b.plain || strip(b.html) || msg.snippet || "")).trim().slice(0, 4500);
    if (text) { const { error } = await admin.from("inbox").insert({ user_id: l.user_id, source: "gmail", text }); if (error) continue; n++; }
    seen.push(m.id);
  }
  await admin.from("gmail_links").update({ seen: seen.slice(-500), last_check: new Date().toISOString(), last_error: null }).eq("user_id", l.user_id);
  return n;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!CID || !CSEC) return json({ ok: false, error: "Google sin configurar" }, 503);
  // Con sesión del usuario: revisa solo su cuenta ya mismo. Sin sesión (pg_cron): todas las pendientes.
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  let only = "";
  if (jwt && jwt.split(".").length === 3) { const { data } = await admin.auth.getUser(jwt); if (data?.user) only = data.user.id; }
  let qb = admin.from("gmail_links").select("*");
  if (only) qb = qb.eq("user_id", only);
  else qb = qb.or(`last_check.is.null,last_check.lt.${new Date(Date.now() - 4 * 60e3).toISOString()}`);
  const { data: links, error } = await qb.limit(50);
  if (error) return json({ ok: false, error: error.message }, 500);
  let total = 0;
  for (const l of links || []) {
    try { total += await check(l); }
    catch (e) { await admin.from("gmail_links").update({ last_check: new Date().toISOString(), last_error: String((e as Error).message).slice(0, 300) }).eq("user_id", l.user_id); }
  }
  return json({ ok: true, cuentas: (links || []).length, nuevas: total });
});
