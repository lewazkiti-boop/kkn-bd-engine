import { supabase } from "./supabaseClient";

/**
 * Drop-in replacement for the Claude-artifact-only `window.storage` API
 * (window.storage.get(key, shared) / window.storage.set(key, value, shared))
 * that the app's useStorage() hook was written against.
 *
 * shared=true (or omitted)  -> Supabase `kkn_kv` table, one row per key.
 *   Every partner shares the same Supabase project/table, so these saves are
 *   visible to every partner on their next load (or next save round-trip).
 *   See supabase/schema.sql for the table + policy definitions.
 *
 * shared=false -> browser localStorage, namespaced under `kkn-local:`.
 *   Used for per-device/private data (seen-state maps, the personal
 *   Watchlist) that should never sync across partners or devices — matches
 *   the artifact's original per-browser-storage behavior for these keys.
 */

const LOCAL_PREFIX = "kkn-local:";

async function get(key, shared = true) {
  if (!shared) {
    try {
      const raw = window.localStorage.getItem(LOCAL_PREFIX + key);
      return raw === null ? null : { value: raw };
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`[storage] local get(${key}) failed:`, e.message);
      return null;
    }
  }

  const { data, error } = await supabase
    .from("kkn_kv")
    .select("value")
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
  if (!shared) {
    try {
      window.localStorage.setItem(LOCAL_PREFIX + key, value);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`[storage] local set(${key}) failed:`, e.message);
      throw e;
    }
    return;
  }

  const parsed = JSON.parse(value);
  const { error } = await supabase
    .from("kkn_kv")
    .upsert({ key, value: parsed, updated_at: new Date().toISOString() }, { onConflict: "key" });

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
