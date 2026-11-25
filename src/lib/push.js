import { supabase } from "./supabaseClient";

// Browser side of reminder alerts. The server side is supabase/functions/send-reminders.
const isDemo = import.meta.env.VITE_APP_MODE === "demo";

const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isInstalled = () =>
  window.navigator.standalone === true || window.matchMedia?.("(display-mode: standalone)").matches;

/** "ok" | "needs-install" (iPhone browser tab) | "unsupported" */
export function pushSupport() {
  if (isDemo) return "unsupported";
  if (isIOS() && !isInstalled()) return "needs-install";
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window ? "ok" : "unsupported";
}

const keyBytes = (base64Url) => {
  const base64 = (base64Url + "=".repeat((4 - (base64Url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
};

async function currentSubscription() {
  if (isDemo || !("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration("/");
  return (await registration?.pushManager?.getSubscription()) || null;
}

async function callServer(body) {
  const { data, error } = await supabase.functions.invoke("send-reminders", { body });
  if (error) throw new Error("Couldn't reach the alert service. Check that it has been set up in Supabase.");
  return data;
}

/** The saved settings for this device, or null when alerts are off. */
export async function pushStatus() {
  const subscription = await currentSubscription();
  if (!subscription || Notification.permission !== "granted") return null;
  const { data } = await supabase
    .from("push_subscriptions")
    .select("scope, partner_id")
    .eq("endpoint", subscription.endpoint)
    .maybeSingle();
  return data || null;
}

async function save(subscription, partnerId, scope) {
  const { keys } = subscription.toJSON();
  const { error } = await supabase.rpc("save_push_subscription", {
    sub_endpoint: subscription.endpoint,
    sub_p256dh: keys.p256dh,
    sub_auth: keys.auth,
    sub_partner_id: partnerId,
    sub_scope: scope,
    sub_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Africa/Nairobi",
  });
  if (error) throw new Error(error.message || "Couldn't save this device.");
}

export async function enablePush(partnerId, scope) {
  // Must be the first await: iOS only allows the prompt directly from a tap.
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Notifications are blocked. Allow them for Bideey in your device settings, then try again.");
  }
  await navigator.serviceWorker.register("/sw.js");
  const registration = await navigator.serviceWorker.ready;
  const { publicKey } = await callServer({ action: "public-key" });
  const subscription =
    (await registration.pushManager.getSubscription()) ||
    (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  await save(subscription, partnerId, scope);
}

export async function updatePushScope(partnerId, scope) {
  const subscription = await currentSubscription();
  if (subscription) await save(subscription, partnerId, scope);
}

export async function sendTestPush() {
  const subscription = await currentSubscription();
  if (!subscription) throw new Error("Alerts are off on this device.");
  const result = await callServer({ action: "test", endpoint: subscription.endpoint });
  if (!result?.sent) throw new Error("The test couldn't be delivered. Turn alerts off and on, then retry.");
}

export async function disablePush() {
  const subscription = await currentSubscription();
  if (!subscription) return;
  // Unsubscribe the browser even if the database delete fails; the server prunes dead endpoints.
  try {
    await supabase.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint);
  } finally {
    await subscription.unsubscribe();
  }
}
