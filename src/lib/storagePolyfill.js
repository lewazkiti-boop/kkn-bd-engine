import { supabase } from "./supabaseClient";

/**
 * Drop-in replacement for the Claude-artifact-only `window.storage` API
 * (window.storage.get(key, shared) / window.storage.set(key, value, shared))
 * that the app's useStorage() hook was written against.
 *
 * Backed by a single Supabase table, `kkn_kv`, with one row per storage key:
 *   key         text primary key
 *   value       jsonb
 *   updated_at  timestamptz
 *
 * All partners share the same Supabase project/table, so every save is
 * visible to every partner on their next load (or next save round-trip).
 * See supabase/schema.sql for the table + policy definitions.
 */

async function get(key /*, shared */) {
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

async function set(key, value /*, shared */) {
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
