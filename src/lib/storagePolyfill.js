import { supabase } from "./supabaseClient";

/**
 * Drop-in replacement for the Claude-artifact-only `window.storage` API
 * (window.storage.get(key, shared) / window.storage.set(key, value, shared))
 * that the app's useStorage() hook was written against.
 *
 * shared=true (or omitted)  -> Supabase `firm_kv` table, one row per
 *   firm/key pair. Supabase row-level security only exposes rows for firms the
 *   current authenticated user belongs to.
 *
 * shared=false -> browser localStorage, namespaced by firm and user.
 *   Used for per-device/private data (seen-state maps, the personal
 *   Watchlist) that should never sync across partners or devices — matches
 *   the artifact's original per-browser-storage behavior for these keys.
 */

const LOCAL_PREFIX = "kkn-local:";
const DEMO_PREFIX = "kkn-demo:";
const isDemoMode = import.meta.env.VITE_APP_MODE === "demo";
let activeFirmId = null;
let activeUserId = null;

export function configureStorageContext({ firmId, userId } = {}) {
  activeFirmId = firmId || null;
  activeUserId = userId || null;
}

const localKey = (key) => `${LOCAL_PREFIX}${activeFirmId || "no-firm"}:${activeUserId || "anonymous"}:${key}`;
const demoKey = (key) => `${DEMO_PREFIX}${activeFirmId || "demo"}:${key}`;

function requireFirm() {
  if (!activeFirmId) {
    throw new Error("No active firm selected for shared storage.");
  }
  return activeFirmId;
}

async function get(key, shared = true) {
  if (!shared || isDemoMode) {
    try {
      const raw = window.localStorage.getItem(shared && isDemoMode ? demoKey(key) : localKey(key));
      return raw === null ? null : { value: raw };
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`[storage] local get(${key}) failed:`, e.message);
      return null;
    }
  }

  const firmId = requireFirm();
  const { data, error } = await supabase
    .from("firm_kv")
    .select("value")
    .eq("firm_id", firmId)
    .eq("key", key)
    .maybeSingle();

  if (error) {
    // eslint-disable-next-line no-console
    console.error(`[storage] get(${key}) failed:`, error.message);
    throw error;
  }
  if (!data) return null;

  // The app's useStorage hook does JSON.parse(r.value), so re-stringify here
  // to match the exact shape it expects back from window.storage.get().
  return { value: JSON.stringify(data.value) };
}

async function set(key, value, shared = true) {
  if (!shared || isDemoMode) {
    try {
      window.localStorage.setItem(shared && isDemoMode ? demoKey(key) : localKey(key), value);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`[storage] local set(${key}) failed:`, e.message);
      throw e;
    }
    return;
  }

  const firmId = requireFirm();
  const parsed = JSON.parse(value);
  const { error } = await supabase
    .from("firm_kv")
    .upsert({ firm_id: firmId, key, value: parsed, updated_at: new Date().toISOString() }, { onConflict: "firm_id,key" });

  if (error) {
    // eslint-disable-next-line no-console
    console.error(`[storage] set(${key}) failed:`, error.message);
    throw error;
  }
}

export function installStoragePolyfill() {
  if (typeof window !== "undefined") {
    window.storage = { get, set };
  }
}
