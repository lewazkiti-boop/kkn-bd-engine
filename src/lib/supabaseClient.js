import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const isDemoMode = import.meta.env.VITE_APP_MODE === "demo";

if (!isDemoMode && (!supabaseUrl || !supabaseAnonKey)) {
  // eslint-disable-next-line no-console
  console.error(
    "Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.local (or set them in Vercel's Environment Variables) and reload."
  );
}

function normalizeAuthHash() {
  if (typeof window === "undefined") return;

  const { hash, pathname, search } = window.location;
  let nextHash = "";

  if (hash.startsWith("##access_token") || hash.startsWith("##error")) {
    nextHash = `#${hash.slice(2)}`;
  } else if (hash.startsWith("#/#access_token") || hash.startsWith("#/#error")) {
    nextHash = `#${hash.slice(3)}`;
  }

  if (nextHash) {
    window.history.replaceState(window.history.state, "", `${pathname}${search}${nextHash}`);
  }
}

normalizeAuthHash();

const clientUrl = supabaseUrl || (isDemoMode ? "https://demo.supabase.co" : "");
const clientAnonKey = supabaseAnonKey || (isDemoMode ? "demo-anon-key" : "");

export const supabase = createClient(clientUrl, clientAnonKey, {
  auth: {
    autoRefreshToken: true,
    detectSessionInUrl: true,
    persistSession: true,
  },
});
