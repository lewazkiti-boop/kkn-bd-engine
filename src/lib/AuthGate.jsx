import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import Login from "../Login";

// Wraps the app: shows the magic-link login screen until there's an authenticated
// Supabase session, then renders children (passing a signOut callback down).
export default function AuthGate({ children }) {
  const [session, setSession] = useState(undefined); // undefined = still checking, null = signed out

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return (
      <div className="boot">
        <div className="boot-mark">KKN</div>
        <p>Checking your session…</p>
      </div>
    );
  }

  if (!session) {
    return <Login />;
  }

  return children({ session, signOut: () => supabase.auth.signOut() });
}
