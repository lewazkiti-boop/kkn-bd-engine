// Pure timing rules for reminder alerts (no network or database), so they can be tested directly.

export const DAY_BEFORE_AT = "09:00"; // local time of the "tomorrow" alert
const HOUR_MS = 60 * 60 * 1000;

type Rec = Record<string, any>;
export type Reminder = { kind: string; id: string; title: string; action: string; date: string; time: string; ownerId: string };
export type Alert = { key: string; title: string; body: string; ttl: number };

// Mirrors collectReminders() in src/App.jsx.
export function collectReminders(data: Record<string, any>): Reminder[] {
  const list = (key: string): Rec[] => (Array.isArray(data[key]) ? data[key] : []);
  const items: Reminder[] = [];
  const add = (kind: string, r: Rec, title: string, action: string, date: string, time: string) => {
    if (date) items.push({ kind, id: r.id, title: title || "Untitled", action: action || "", date, time: time || "", ownerId: r.responsiblePartner || "" });
  };
  list("kkn-prospects").forEach((p) => {
    if (!["won", "lost"].includes(p.status)) add("prospect", p, p.organization, p.nextAction, p.nextActionDate, p.nextActionTime);
  });
  list("kkn-clients").forEach((c) => {
    add("client", c, c.name, c.nextAction, c.nextActionDate, c.nextActionTime);
    if (c.hasRetainer) add("retainer", c, c.name, `Renew retainer (${c.retainerFrequency || "recurring"})`, c.retainerRenewalDate, "");
  });
  list("kkn-tenders").forEach((t) => {
    if (t.stage !== "result" || (t.kind === "empanelment" && t.outcome === "Won")) add("tender", t, t.title, t.nextAction, t.nextActionDate, t.nextActionTime);
  });
  list("kkn-referrals").forEach((r) => {
    const name = r.institution?.trim() ? `${r.name} — ${r.institution.trim()}` : r.name;
    add("referral", r, name, r.nextAction, r.nextActionDate, r.nextActionTime);
  });
  return items;
}

// "mine" = records assigned to me (including a duplicate partner entry with my exact name) or to nobody.
export function belongsTo(item: Reminder, scope: string, partnerId: string, partners: Rec[]): boolean {
  if (scope === "all" || !item.ownerId || item.ownerId === partnerId) return true;
  const nameOf = (id: string) => (partners.find((p) => p.id === id)?.name || "").trim().toLowerCase();
  const mine = nameOf(partnerId);
  return mine !== "" && nameOf(item.ownerId) === mine;
}

function offsetMs(instant: number, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(instant)).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

// Wall-clock date and time in a time zone -> epoch milliseconds. NaN if malformed.
export function zonedToUtc(date: string, time: string, timeZone: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d/.test(time)) return NaN;
  const wall = Date.parse(`${date}T${time.slice(0, 5)}:00Z`);
  const first = wall - offsetMs(wall, timeZone);
  return wall - offsetMs(first, timeZone);
}

const previousDay = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) - 24 * HOUR_MS).toISOString().slice(0, 10);

// The alert (if any) that is due for this reminder right now. Overdue items never alert.
export function alertFor(item: Reminder, now: number, timeZone: string): Alert | null {
  const dayStart = zonedToUtc(item.date, "00:00", timeZone);
  if (Number.isNaN(dayStart)) return null;
  const at = item.time ? zonedToUtc(item.date, item.time, timeZone) : NaN;
  const body = [item.title, item.action].filter(Boolean).join(" — ").slice(0, 180);
  const base = `${item.kind}:${item.id}:${item.date}:${item.time}`;

  if (!Number.isNaN(at) && now >= at - HOUR_MS && now < at) {
    const minutes = Math.max(1, Math.ceil((at - now) / 60000));
    const lead = minutes >= 59 ? "In 1 hour" : `In ${minutes} minute${minutes > 1 ? "s" : ""}`;
    return { key: `${base}:hour`, title: `${lead} · ${item.time}`, body, ttl: Math.ceil((at - now) / 1000) };
  }
  const dayAlertFrom = zonedToUtc(previousDay(item.date), DAY_BEFORE_AT, timeZone);
  const dayAlertUntil = Number.isNaN(at) ? dayStart : Math.min(dayStart, at - HOUR_MS);
  if (now >= dayAlertFrom && now < dayAlertUntil) {
    return { key: `${base}:day`, title: item.time ? `Tomorrow at ${item.time}` : "Due tomorrow", body, ttl: Math.ceil((dayAlertUntil - now) / 1000) };
  }
  return null;
}
