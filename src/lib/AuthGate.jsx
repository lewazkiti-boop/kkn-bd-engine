import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import { configureStorageContext } from "./storagePolyfill";
import Login from "../Login";

const isDemoMode = import.meta.env.VITE_APP_MODE === "demo";
const demoSession = {
  user: {
    id: "demo-user",
    email: "demo@bideey.com",
    user_metadata: { name: "Demo Partner" },
  },
};
const demoFirm = { id: "demo", name: "Bideey Demo Firm", slug: "demo" };

// Wraps the app: shows the magic-link login screen until there's an authenticated
// Supabase session, then renders children (passing a signOut callback down).
export default function AuthGate({ children }) {
  const [session, setSession] = useState(undefined); // undefined = still checking, null = signed out
  const [memberships, setMemberships] = useState(undefined);
  const [activeMembership, setActiveMembership] = useState(null);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [inviteToken] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get("invite") || "";
    } catch {
      return "";
    }
  });

  const cleanAuthUrl = (removeInvite = false) => {
    const url = new URL(window.location.href);
    if (removeInvite) url.searchParams.delete("invite");
    if (
      url.hash.includes("access_token=") ||
      url.hash.includes("refresh_token=") ||
      url.hash.includes("type=magiclink") ||
      url.hash.includes("error=")
    ) {
      url.hash = "";
    }
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  };

  useEffect(() => {
    if (isDemoMode) return undefined;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (isDemoMode) return undefined;
    if (!session) {
      configureStorageContext();
      setMemberships(undefined);
      setActiveMembership(null);
      return;
    }

    let cancelled = false;
    setMemberships(undefined);
    setError("");

    (async () => {
      if (inviteToken) {
        const { error: inviteError } = await supabase.rpc("accept_firm_invite", { invite_token: inviteToken });
        if (cancelled) return;

        if (inviteError) {
          setError(inviteError.message || "This invite could not be accepted.");
        } else {
          cleanAuthUrl(true);
        }
      }

      const { data, error: memberError } = await supabase
        .from("firm_members")
        .select("role, firm_id, firms(id, name, slug)")
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: true });

      if (cancelled) return;

      if (memberError) {
        setError(memberError.message || "Could not load your firm access.");
        setMemberships([]);
        configureStorageContext();
        return;
      }

      const next = (data || [])
        .map((m) => ({ ...m, firm: Array.isArray(m.firms) ? m.firms[0] : m.firms }))
        .filter((m) => m.firm?.id);

      setMemberships(next);
      const first = next[0] || null;
      setActiveMembership(first);
      configureStorageContext({ firmId: first?.firm.id, userId: session.user.id });
      cleanAuthUrl(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [session, inviteToken, refreshKey]);

  if (isDemoMode) {
    configureStorageContext({ firmId: demoFirm.id, userId: demoSession.user.id });
    return children({
      session: demoSession,
      activeFirm: demoFirm,
      membershipRole: "admin",
      signOut: () => window.location.reload(),
      isDemo: true,
    });
  }

  const signOut = async () => {
    configureStorageContext();
    await supabase.auth.signOut();
  };

  if (session === undefined) {
    return (
      <div className="boot">
        <div className="boot-mark" aria-hidden="true">B</div>
        <p>Checking your session…</p>
      </div>
    );
  }

  if (!session) {
    return <Login />;
  }

  if (memberships === undefined) {
    return (
      <div className="boot">
        <div className="boot-mark" aria-hidden="true">B</div>
        <p>Loading your workspace…</p>
      </div>
    );
  }

  if (error || memberships.length === 0) {
    return (
      <div className="boot">
        <div className="boot-mark" aria-hidden="true">B</div>
        <h1>Bideey</h1>
        {memberships.length === 0 ? (
          <RegisterFirm onCreated={() => setRefreshKey((n) => n + 1)} />
        ) : (
          <>
            <p className="muted">We could not load your workspace.</p>
            <p className="fine">Please sign out and try again.</p>
          </>
        )}
        {error && <p className="voice-error">{error}</p>}
        <button className="link-btn" onClick={signOut}>Sign out</button>
      </div>
    );
  }

  if (memberships.length > 1) {
    return (
      <div className="boot">
        <div className="boot-mark" aria-hidden="true">B</div>
        <h1>Bideey</h1>
        <p className="muted">Your account has more than one workspace.</p>
        <p className="fine">This app is configured for one firm per user. Ask an administrator to keep only the correct firm membership.</p>
        <button className="link-btn" onClick={signOut}>Sign out</button>
      </div>
    );
  }

  if (!activeMembership) {
    return null;
  }

  return children({ session, activeFirm: activeMembership.firm, membershipRole: activeMembership.role, signOut });
}

function RegisterFirm({ onCreated }) {
  const [firmName, setFirmName] = useState("");
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    const trimmed = firmName.trim();
    if (!trimmed) return;
    setStatus("saving");
    setError("");

    const { error: registerError } = await supabase.rpc("register_firm", { firm_name: trimmed });
    if (registerError) {
      setStatus("error");
      setError(registerError.message || "Could not register this firm.");
      return;
    }

    setStatus("idle");
    onCreated();
  };

  return (
    <>
      <p className="muted">Set up your firm's workspace</p>
      <p className="fine">If this is your firm's first time here, register it once. After that, invite everyone else by link.</p>
      <form className="add-partner" onSubmit={submit} style={{ marginTop: 8 }}>
        <input
          value={firmName}
          onChange={(e) => setFirmName(e.target.value)}
          placeholder="Firm name"
          required
        />
        <button className="btn btn-primary" type="submit" disabled={status === "saving"}>
          {status === "saving" ? "Creating workspace…" : "Create workspace"}
        </button>
      </form>
      {status === "error" && <p className="voice-error">{error}</p>}
    </>
  );
}
