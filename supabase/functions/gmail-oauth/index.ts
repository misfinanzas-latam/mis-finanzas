// Conectar Gmail con un toque (OAuth de Google, permiso de solo lectura).
// POST (con la sesión del usuario) -> devuelve la URL de Google.
// GET  (vuelta de Google con ?code&state) -> guarda el permiso y regresa a la app.
import { createClient } from "jsr:@supabase/supabase-js@2";

const CID = Deno.env.get("GOOGLE_CLIENT_ID") || "";
const CSEC = Deno.env.get("GOOGLE_CLIENT_SECRET") || "";
const SITE = Deno.env.get("SITE_URL") || "https://wvillanuevau.github.io/mis-finanzas/";
const SELF = Deno.env.get("SUPABASE_URL") + "/functions/v1/gmail-oauth";
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, GET, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const back = (q: string) => Response.redirect(SITE + "?gmail=" + q, 302);
const b64u = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function sign(t: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(CSEC), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(t))));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!CID || !CSEC) return req.method === "GET" ? back("sin-configurar") : json({ ok: false, error: "Falta configurar Google en el servidor" }, 503);
  const url = new URL(req.url);

  if (req.method === "POST") {
    const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data, error } = await admin.auth.getUser(jwt);
    if (error || !data.user) return json({ ok: false, error: "Inicia sesión" }, 401);
    const p = b64u(new TextEncoder().encode(JSON.stringify({ u: data.user.id, e: Date.now() + 15 * 60e3 })));
    const state = p + "." + (await sign(p));
    const g = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    g.search = new URLSearchParams({
      client_id: CID, redirect_uri: SELF, response_type: "code", access_type: "offline", prompt: "consent",
      scope: "https://www.googleapis.com/auth/gmail.readonly", state,
    }).toString();
    return json({ ok: true, url: g.toString() });
  }

  // GET: vuelta de Google
  if (url.searchParams.get("error")) return back("cancelado");
  const code = url.searchParams.get("code") || "", state = url.searchParams.get("state") || "";
  const [p, s] = state.split(".");
  if (!p || !s || (await sign(p)) !== s) return back("error");
  let u = "";
  try {
    const o = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(p.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))));
    if (o.e < Date.now()) return back("vencido");
    u = o.u;
  } catch (_e) { return back("error"); }

  const tr = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: CID, client_secret: CSEC, redirect_uri: SELF, grant_type: "authorization_code" }),
  });
  const tk = await tr.json();
  if (!tk.refresh_token || !tk.access_token) return back("sin-permiso");
  if (!String(tk.scope || "").includes("gmail.readonly")) return back("sin-permiso");

  const prof = await (await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { Authorization: "Bearer " + tk.access_token } })).json();
  // Lo que ya está en el correo no se importa: solo lo nuevo desde ahora.
  const ls = await (await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=100&q=" + encodeURIComponent("newer_than:3d"), { headers: { Authorization: "Bearer " + tk.access_token } })).json();
  const seen = (ls.messages || []).map((m: { id: string }) => m.id);
  const { error } = await admin.from("gmail_links").upsert({ user_id: u, email: prof.emailAddress || null, refresh_token: tk.refresh_token, seen, last_check: new Date().toISOString(), last_error: null });
  if (error) return back("error");
  await admin.from("inbox").insert({ user_id: u, source: "gmail", text: "MF-CONEXION gmail" });
  return back("ok");
});
