import { useState } from "react";
import { supabase } from "./lib/supabaseClient";

// Passwordless sign-in: partner enters their email, we email them a Supabase
// magic link, clicking it signs them in (AuthGate then reacts automatically).
export default function Login() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("idle"); // idle | sending | sent | error
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setStatus("sending");
    setError("");
    const { error: err } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: { emailRedirectTo: window.location.href },
    });
    if (err) {
      setStatus("error");
      setError(err.message || "Something went wrong sending the link.");
    } else {
      setStatus("sent");
    }
  };

  return (
    <div className="boot">
      <div className="boot-mark">Bideey</div>
      <h1>Bideey</h1>
      {status === "sent" ? (
        <>
          <p className="muted">Check your email</p>
          <p className="fine" style={{ marginTop: 4 }}>
            We sent a sign-in link to <strong>{email.trim()}</strong>. Open it on this device to get in — the link expires after a short while.
          </p>
          <button className="link-btn" onClick={() => setStatus("idle")}>Use a different email</button>
        </>
      ) : (
        <>
          <p className="muted">Sign in to your firm's workspace</p>
          <form className="add-partner" onSubmit={submit} style={{ marginTop: 8 }}>
            <input
              type="email"
              placeholder="you@yourfirm.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
              required
            />
            <button className="btn btn-primary" type="submit" disabled={status === "sending"}>
              {status === "sending" ? "Sending link…" : "Send magic link"}
            </button>
          </form>
          {status === "error" && <p className="voice-error">{error}</p>}
          <p className="fine">No password needed — we'll email you a one-tap sign-in link.</p>
        </>
      )}
    </div>
  );
}
