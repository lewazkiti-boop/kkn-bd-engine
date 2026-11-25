import { useEffect, useState } from "react";
import { disablePush, enablePush, pushStatus, pushSupport, sendTestPush, updatePushScope } from "./lib/push";

export default function NotificationSettings({ me }) {
  const [support] = useState(pushSupport);
  const [on, setOn] = useState(false);
  const [scope, setScope] = useState("mine");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (support !== "ok") return undefined;
    let cancelled = false;
    pushStatus()
      .then((saved) => {
        if (cancelled || !saved) return;
        setOn(true);
        setScope(saved.scope);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [support]);

  if (support === "unsupported") return null;
  if (support === "needs-install") {
    return (
      <div className="push-panel">
        <p><strong>🔔 Reminder alerts</strong></p>
        <p>To get them on iPhone: tap Share, choose <strong>Add to Home Screen</strong>, then open Bideey from that new icon and turn alerts on.</p>
      </div>
    );
  }

  const run = async (task, done) => {
    setBusy(true);
    setMessage("");
    try {
      await task();
      done?.();
    } catch (e) {
      setMessage(e.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="push-panel">
      <p><strong>🔔 Reminder alerts {on ? "are on" : "are off"}</strong> on this device</p>
      <p>At 9:00 the day before, and 1 hour before anything with a time.</p>
      <div className="push-row">
        <select
          aria-label="Which reminders to alert me about"
          value={scope}
          disabled={busy}
          onChange={(e) => {
            const next = e.target.value;
            const previous = scope;
            setScope(next);
            if (on) run(() => updatePushScope(me, next).catch((err) => { setScope(previous); throw err; }));
          }}
        >
          <option value="mine">My reminders</option>
          <option value="all">All partners’ reminders</option>
        </select>
        {!on && (
          <button type="button" className="chip-btn" disabled={busy || !me} onClick={() => run(() => enablePush(me, scope), () => setOn(true))}>
            {busy ? "Please wait…" : "Turn on"}
          </button>
        )}
        {on && (
          <>
            <button type="button" className="chip-btn" disabled={busy} onClick={() => run(sendTestPush, () => setMessage("Test sent — it should appear in a few seconds."))}>
              Send test
            </button>
            <button type="button" className="chip-btn chip-ghost" disabled={busy} onClick={() => run(disablePush, () => setOn(false))}>
              Turn off
            </button>
          </>
        )}
      </div>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
