// Recordatorios con notificaciones del sistema (Web Push).
// pg_cron la llama cada 15 min con su clave secreta. Con sesión del usuario: {accion:"prueba"} manda una de prueba.
// Por privacidad, los montos solo aparecen si el usuario activó "Mostrar montos en las notificaciones".
import { createClient } from "jsr:@supabase/supabase-js@2";
import { sendPush } from "./webpush.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const SITE = "https://misfinanzas-latam.github.io/mis-finanzas/";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const MES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const num = (v: unknown) => { const n = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, "")); return isFinite(n) ? n : 0; };
const fmt = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt0 = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

// deno-lint-ignore no-explicit-any
type Any = any;
function local(tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short" }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  const day = `${p.year}-${p.month}-${p.day}`, hm = (+p.hour % 24) * 60 + +p.minute;
  const last = new Date(Date.UTC(+p.year, +p.month, 0)).getUTCDate() === +p.day;
  return { day, hm, dow: p.weekday, last, month: +p.month };
}
const toMin = (s: string) => { const [h, m] = String(s || "0:0").split(":").map(Number); return h * 60 + (m || 0); };
const sgn = (x: Any) => x.tipo === "ingreso" ? 1 : x.tipo === "ajuste" ? (x.aj < 0 ? -1 : 1) : -1;
const saldo = (c: Any, items: Any[]) => num(c.saldo) + items.filter((x) => x.cuenta === c.id && (c.ts ? (x.ts || 0) > c.ts : x.fecha >= (c.fecha || ""))).reduce((t, x) => t + sgn(x) * num(x.monto), 0);
const esGasto = (x: Any) => x.tipo !== "ingreso" && x.tipo !== "ajuste";
const shiftDay = (d: string, n: number) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

export function bolsaDe(cfg: Any, cuentas: Any[]) {
  const r = cfg.rec || {};
  return cuentas.find((c) => c.id === r.bolsa) || cuentas.find((c) => c.sys) || cuentas.find((c) => /cartera|bolsa|billetera/i.test((c.nombre || "") + " " + (c.banco || ""))) || cuentas.find((c) => /efectivo/i.test((c.tipo || "") + (c.banco || "")));
}

async function datos(uid: string) {
  const { data } = await admin.from("docs").select("id,body").eq("user_id", uid);
  const D: Record<string, Any> = {}; const items: Any[] = [];
  for (const r of data || []) { if (["cfg", "cuentas", "fuentes", "fijos", "escs", "reglas", "pend"].includes(r.id)) D[r.id] = r.body; else if (r.body && r.body.fecha) items.push(r.body); }
  return { cfg: D.cfg || {}, cuentas: (D.cuentas && D.cuentas.list) || [], pend: (D.pend && D.pend.list) || [], items };
}

function mensajes(uid: string, d: Awaited<ReturnType<typeof datos>>, L: ReturnType<typeof local>, forzar = "") {
  const r = Object.assign({ on: true, min: 3, am: "07:00", pm: "21:00", sem: true, mes: true, dia: true, arq: true, arqDia: 6, arqHora: "10:00", presu: true, presuHora: "09:00", montos: false }, d.cfg.rec || {});
  const M = r.montos === true; // mostrar montos en la pantalla bloqueada
  const out: { kind: string; title: string; body: string; url: string }[] = [];
  if (!r.on && !forzar) return out;
  const due = (t: string) => forzar || (L.hm >= toMin(t) && L.hm < toMin(t) + 60);
  const b = bolsaDe(d.cfg, d.cuentas);
  // Mañana: efectivo bajo
  if (b && (forzar === "am" || (!forzar && due(r.am)))) {
    const s = saldo(b, d.items);
    if (s < num(r.min) || forzar === "am") {
      const desde = shiftDay(L.day, -30);
      const g = d.items.filter((x) => x.cuenta === b.id && esGasto(x) && x.fecha >= desde && x.fecha <= L.day);
      const first = g.reduce((m, x) => x.fecha < m ? x.fecha : m, L.day);
      const dias = Math.max(7, Math.round((Date.parse(L.day) - Date.parse(first)) / 864e5) + 1);
      const prom = g.reduce((t, x) => t + num(x.monto), 0) / dias;
      const sug = Math.max(10, Math.ceil((prom * 7 - Math.max(s, 0)) / 5) * 5);
      const otras = d.cuentas.filter((c: Any) => c.id !== b.id).map((c: Any) => ({ c, s: saldo(c, d.items) })).sort((a: Any, z: Any) => z.s - a.s);
      const src = otras.find((o: Any) => o.s >= sug) || otras[0];
      out.push({ kind: "am", title: M ? `Tu ${b.nombre || "efectivo"} tiene ${fmt(s)}` : `Revisa tu ${b.nombre || "efectivo"}`,
        body: !M ? (src ? `Está por debajo de tu mínimo. Toca para pasar dinero desde ${src.c.nombre || src.c.banco}.` : "Está por debajo de tu mínimo. Toca para revisarlo.") : src ? `¿Pasar ${fmt0(sug)} de ${src.c.nombre || src.c.banco}? Gastas ~${fmt(prom)} al día en efectivo.` : `Gastas ~${fmt(prom)} al día en efectivo. Te sugerimos tener ${fmt0(sug)}.`,
        url: SITE + "?trf=" + encodeURIComponent((src ? src.c.id : "") + "|" + b.id + "|" + sug) });
    }
  }
  // Arqueo semanal
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  if ((forzar === "arq") || (!forzar && r.arq && DOW[+r.arqDia] === L.dow && due(r.arqHora))) {
    const tot = d.cuentas.reduce((t: number, c: Any) => t + saldo(c, d.items), 0);
    out.push({ kind: "arq", title: "Arqueo semanal", body: M ? `Cuenta tu efectivo y revisa tus bancos. Según la app tienes ${fmt(tot)} en total${b ? `, ${fmt(saldo(b, d.items))} en ${b.nombre || "efectivo"}` : ""}. Toca para consolidar.` : "Cuenta tu efectivo y revisa tus bancos. Toca para consolidar.", url: SITE + "?act=cons" });
  }
  // Día 30 (o último día si el mes es más corto): armar presupuesto del mes siguiente
  const dd = +L.day.slice(8);
  if (forzar === "presu" || (!forzar && r.presu && (dd === 30 || (L.last && dd < 30)) && due(r.presuHora))) {
    const [yy, mm] = L.day.split("-").map(Number), nx = mm === 12 ? `${yy + 1}-01` : `${yy}-${String(mm + 1).padStart(2, "0")}`;
    const P = (d.cfg.presup || {})[nx], nom = MES[+nx.slice(5) - 1];
    out.push({ kind: "presu", title: `Presupuesto de ${nom}`, body: P ? `Ya tienes “${P.nombre}”. Revisa tus fijos y escenarios antes del cierre y confirma o cámbialo.` : `Revisa tus fijos, arma tus escenarios y elige el presupuesto de ${nom} antes del cierre de mes.`, url: SITE + "?tab=proyeccion" });
  }
  // Noche: diario / semana / mes (uno solo por noche)
  if (forzar === "pm" || forzar === "sem" || forzar === "mes" || (!forzar && due(r.pm))) {
    const neg = d.cuentas.filter((c: Any) => saldo(c, d.items) < -0.004).length, pend = d.pend.length;
    const extra = [pend ? `${pend} alerta(s) por revisar` : "", neg ? `${neg} cuenta(s) en negativo` : ""].filter(Boolean).join(" · ");
    const sum = (a: string, z: string) => { const xs = d.items.filter((x) => x.fecha >= a && x.fecha <= z); return { g: xs.filter(esGasto).reduce((t, x) => t + num(x.monto), 0), i: xs.filter((x) => x.tipo === "ingreso").reduce((t, x) => t + num(x.monto), 0), n: xs.filter((x) => x.tipo !== "ajuste").length }; };
    if ((L.last && r.mes) || forzar === "mes") {
      const m = sum(L.day.slice(0, 8) + "01", L.day);
      out.push({ kind: "mes", title: `Cierre de ${MES[L.month - 1]}`, body: `${M ? `Gastaste ${fmt0(m.g)} · entró ${fmt0(m.i)}. ` : ""}Revisa tus cuentas antes de empezar el mes.${extra ? " " + extra + "." : ""}`, url: SITE + "?tab=resumen" });
    } else if ((L.dow === "Sun" && r.sem) || forzar === "sem") {
      const w = sum(shiftDay(L.day, -6), L.day);
      out.push({ kind: "sem", title: "Cierre de la semana", body: `${M ? `Gastaste ${fmt0(w.g)} en ${w.n} movimiento(s).` : `${w.n} movimiento(s) esta semana.`} Toca para ordenar tus cuentas.${extra ? " " + extra + "." : ""}`, url: SITE + "?tab=resumen" });
    } else if (r.dia || forzar === "pm") {
      const t = sum(L.day, L.day);
      out.push({ kind: "pm", title: "Ordena tus cuentas de hoy", body: `${t.n ? `Hoy: ${t.n} movimiento(s)${M ? `, gastaste ${fmt0(t.g)}` : ""}.` : "Hoy no registraste movimientos."} ¿Falta algo?${extra ? " " + extra + "." : ""}`, url: SITE + "?tab=movimientos" });
    }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const { data: sec } = await admin.from("app_secrets").select("name,value").in("name", ["vapid_public", "vapid_private", "cron_key"]);
  const K = Object.fromEntries((sec || []).map((x: Any) => [x.name, x.value]));
  if (!K.vapid_public || !K.vapid_private) return json({ ok: false, error: "Sin llaves" }, 500);
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  let only = "", body: Any = {};
  try { body = await req.json(); } catch (_e) { body = {}; }
  if (body.accion === "llave") return json({ ok: true, key: K.vapid_public });
  if (jwt.split(".").length === 3) { const { data } = await admin.auth.getUser(jwt); if (data?.user) only = data.user.id; }
  if (!only) {
    const k = req.headers.get("x-cron-key") || "", c = String(K.cron_key || "");
    let d = k.length === c.length && c ? 0 : 1;
    for (let i = 0; i < k.length && i < c.length; i++) d |= k.charCodeAt(i) ^ c.charCodeAt(i);
    if (d !== 0) return json({ ok: false, error: "No autorizado" }, 401);
  }
  let q = admin.from("push_subs").select("*");
  if (only) q = q.eq("user_id", only);
  const { data: subs } = await q;
  const byUser: Record<string, Any[]> = {};
  for (const s of subs || []) (byUser[s.user_id] ||= []).push(s);
  let enviados = 0;
  for (const [uid, ss] of Object.entries(byUser)) {
    const L = local(ss[0].tz || "America/El_Salvador");
    const d = await datos(uid);
    const forzar = only && body.accion === "prueba" ? (body.tipo || "pm") : "";
    for (const m of mensajes(uid, d, L, forzar)) {
      if (!forzar) {
        const { error } = await admin.from("push_log").insert({ user_id: uid, kind: m.kind, day: L.day });
        if (error) continue; // ya se mandó hoy
      }
      for (const s of ss) {
        try {
          const st = await sendPush(s, { title: m.title, body: m.body, url: m.url, tag: m.kind }, K.vapid_public, K.vapid_private);
          if (st === 404 || st === 410) await admin.from("push_subs").delete().eq("endpoint", s.endpoint);
          else if (st < 300) enviados++;
        } catch (_e) { /* sigue */ }
      }
    }
  }
  return json({ ok: true, usuarios: Object.keys(byUser).length, enviados });
});
