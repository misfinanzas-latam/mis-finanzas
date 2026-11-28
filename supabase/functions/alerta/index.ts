// Recibe alertas de compra (SMS o correo) y las deja en la bandeja del usuario.
// Autenticación: clave personal del usuario (se compara su hash SHA-256 con alert_keys).
// Desplegada con verify_jwt = false porque la llaman Atajos de iPhone y Google Apps Script.
// Siri («Oye Siri, anota un gasto»): manda los campos monto y en; responde con texto para que Siri confirme.
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-alert-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

// "12.5", "12,50", "$1,234.56", "1.234,56" → número
function parseMonto(x: string): number | null {
  let t = x.replace(/usd|\$|\s/gi, "").replace(/−/g, "-");
  if (!t) return null;
  const lc = t.lastIndexOf(","), ld = t.lastIndexOf(".");
  if (lc > ld) t = /,\d{1,2}$/.test(t) ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  else t = t.replace(/,/g, "");
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
const usd = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const txt = (t: string, s = 200) => new Response(t, { status: s, headers: { ...CORS, "Content-Type": "text/plain; charset=utf-8" } });

async function sha256(t: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "Usa POST" }, 405);
  const url = new URL(req.url);
  let key = req.headers.get("x-alert-key") || url.searchParams.get("key") || "";
  let text = "", source = url.searchParams.get("source") || "otro", monto = "", en = "";
  const ct = req.headers.get("content-type") || "";
  try {
    if (ct.includes("application/json")) {
      const b = await req.json();
      key = String(b.key || key); text = String(b.text || ""); source = String(b.source || source);
      monto = String(b.monto ?? ""); en = String(b.en ?? b.lugar ?? "");
    } else if (ct.includes("form")) {
      const f = await req.formData();
      key = String(f.get("key") || key); text = String(f.get("text") || ""); source = String(f.get("source") || source);
      monto = String(f.get("monto") ?? ""); en = String(f.get("en") ?? f.get("lugar") ?? "");
    } else {
      text = await req.text();
    }
  } catch (_e) {
    return json({ ok: false, error: "Formato no válido" }, 400);
  }
  key = key.trim(); text = text.trim().slice(0, 4500); source = source.trim().toLowerCase().slice(0, 20) || "otro";
  const siri = source === "siri" || !!monto.trim();
  let nota = "";
  if (siri) {
    source = "siri";
    if (!/^[a-f0-9]{32,128}$/i.test(key)) return txt("Tu enlace no es válido. Cópialo otra vez desde la app.", 401);
    const n = parseMonto(monto.trim());
    if (n == null || !(n > 0) || n > 10_000_000) return txt("No entendí el monto. Intenta de nuevo.", 400);
    const m = Math.round(n * 100) / 100, lugar = en.replace(/\s+/g, " ").trim().slice(0, 80);
    text = "MF-SIRI " + JSON.stringify({ m, en: lugar });
    nota = "Anotado: " + usd(m) + (lugar ? " en " + lugar : "");
  }
  if (!/^[a-f0-9]{32,128}$/i.test(key)) return json({ ok: false, error: "Clave no válida" }, 401);
  if (!text) return json({ ok: false, error: "Falta el texto de la alerta" }, 400);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: k, error: e1 } = await sb.from("alert_keys").select("user_id").eq("key_hash", await sha256(key)).maybeSingle();
  if (e1) return json({ ok: false, error: "Error interno" }, 500);
  if (!k) return siri ? txt("Tu enlace ya no es válido. Cópialo otra vez desde la app.", 401) : json({ ok: false, error: "Clave no válida" }, 401);

  const desde = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await sb.from("inbox").select("id", { count: "exact", head: true }).eq("user_id", k.user_id).gte("created_at", desde);
  if ((count ?? 0) >= 120) return siri ? txt("Son demasiados en una hora. Intenta más tarde.", 429) : json({ ok: false, error: "Demasiadas alertas en una hora" }, 429);

  const { error: e2 } = await sb.from("inbox").insert({ user_id: k.user_id, source, text });
  if (e2) return siri ? txt("No se pudo guardar. Intenta de nuevo.", 500) : json({ ok: false, error: "No se pudo guardar" }, 500);
  return siri ? txt(nota) : json({ ok: true });
});
