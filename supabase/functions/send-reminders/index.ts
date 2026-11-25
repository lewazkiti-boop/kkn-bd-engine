// Sends Bideey reminder alerts. Deploy with "Verify JWT" OFF: this function checks callers itself
// (the scheduler presents a secret held only in the database; the app presents the user's session).
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { alertFor, belongsTo, collectReminders } from "./schedule.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage, x-region, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
// Only real browser push services; stops the function being pointed at arbitrary addresses.
const PUSH_HOSTS = /(^|\.)(push\.apple\.com|fcm\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com)$/;

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function must<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

// The signing keys are created on first use and stay in the database; nobody has to handle them.
async function config() {
  const read = async () => must(await db.from("push_config").select("*").eq("id", 1).single()) as any;
  let row = await read();
  if (!row.vapid_public) {
    const keys = webpush.generateVAPIDKeys();
    must(await db.from("push_config").update({ vapid_public: keys.publicKey, vapid_private: keys.privateKey }).eq("id", 1).is("vapid_public", null));
    row = await read();
  }
  return row;
}

async function deliver(sub: any, cfg: any, message: { title: string; body: string; tag: string }, ttl: number): Promise<boolean> {
  try {
    const url = new URL(sub.endpoint);
    if (url.protocol !== "https:" || !PUSH_HOSTS.test(url.hostname)) return false;
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(message),
      {
        TTL: Math.max(60, ttl),
        urgency: "high",
        timeout: 10000,
        vapidDetails: { subject: "https://app.bideey.com", publicKey: cfg.vapid_public, privateKey: cfg.vapid_private },
      },
    );
    return true;
  } catch (error: any) {
    if (error?.statusCode === 404 || error?.statusCode === 410) {
      await db.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
    } else {
      console.error("push failed", error?.statusCode || error?.message);
    }
    return false;
  }
}

async function run(cfg: any) {
  const subs = must(await db.from("push_subscriptions").select("*")) as any[];
  const members = subs.length ? (must(await db.from("firm_members").select("*")) as any[]) : [];
  const firms = new Map<string, Record<string, any>>();
  let sent = 0;
  for (const sub of subs) {
    // Someone removed from the firm must stop receiving its client names.
    if (!members.some((m) => m.user_id === sub.user_id && m.firm_id === sub.firm_id && m.active !== false)) continue;
    try {
      if (!firms.has(sub.firm_id)) {
        const rows = must(await db.from("firm_kv").select("key, value").eq("firm_id", sub.firm_id)
          .in("key", ["kkn-partners", "kkn-prospects", "kkn-clients", "kkn-tenders", "kkn-referrals"])) as any[];
        firms.set(sub.firm_id, Object.fromEntries(rows.map((r) => [r.key, r.value])));
      }
      const data = firms.get(sub.firm_id)!;
      for (const item of collectReminders(data)) {
        if (!belongsTo(item, sub.scope, sub.partner_id, data["kkn-partners"] || [])) continue;
        const alert = alertFor(item, Date.now(), sub.timezone);
        if (!alert) continue;
        // Claim first so overlapping runs can't send twice; release the claim if delivery fails.
        const claim = await db.from("push_sent").insert({ endpoint: sub.endpoint, reminder_key: alert.key });
        if (claim.error?.code === "23505") continue; // already sent
        must(claim);
        if (await deliver(sub, cfg, { title: alert.title, body: alert.body, tag: alert.key }, alert.ttl)) sent += 1;
        else await db.from("push_sent").delete().eq("endpoint", sub.endpoint).eq("reminder_key", alert.key);
      }
    } catch (error: any) {
      // One bad device or record must not stop everyone else's alerts.
      console.error("subscription skipped", error?.message);
    }
  }
  return { sent };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  try {
    const { action, endpoint } = await req.json().catch(() => ({}));
    const cfg = await config();

    if (action === "run") {
      if (req.headers.get("x-cron-secret") !== cfg.cron_secret) return reply({ error: "Not allowed" }, 401);
      return reply(await run(cfg));
    }

    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: auth } = await db.auth.getUser(token);
    if (!auth?.user) return reply({ error: "Sign in first" }, 401);
    const member = must(await db.from("firm_members").select("*").eq("user_id", auth.user.id).maybeSingle()) as any;
    if (!member || member.active === false) return reply({ error: "Not a firm member" }, 403);

    if (action === "public-key") return reply({ publicKey: cfg.vapid_public });
    if (action === "test") {
      const sub = must(await db.from("push_subscriptions").select("*").eq("endpoint", endpoint || "").eq("user_id", auth.user.id).maybeSingle());
      if (!sub) return reply({ sent: false });
      return reply({ sent: await deliver(sub, cfg, { title: "Bideey alerts are working", body: "You'll be reminded the day before and 1 hour before.", tag: "test" }, 300) });
    }
    return reply({ error: "Unknown action" }, 400);
  } catch (error: any) {
    console.error(error?.message);
    return reply({ error: "Alert service error" }, 500);
  }
});
