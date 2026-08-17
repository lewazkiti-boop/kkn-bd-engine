import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";

/* ------------------------------------------------------------------ *
* KKN REVENUE ENGINE — shared BD pipeline for KKN Law LLP partners
* Data model (all shared=true so every partner sees the same board):
* "kkn-partners" -> [{id,name,identity}]
* "kkn-prospects" -> [{...}]
* "kkn-referrals" -> [{...}]
* "kkn-activity" -> [{id,partnerId,type,date,subject}]
* "kkn-tenders" -> [{...}]
* "kkn-tender-vault" -> {itemKey: boolean}
* "kkn-clients" -> [{...}]
* ------------------------------------------------------------------ */

const DEFAULT_PARTNERS = [
{ id: "p-gerald", name: "Gerald Kiti", identity: "Technology / AI / Cybersecurity + Strategic Relationships" },
{ id: "p-a", name: "Partner A", identity: "Corporate & M&A" },
{ id: "p-b", name: "Partner B", identity: "Real Estate & Conveyancing" },
{ id: "p-c", name: "Partner C", identity: "Tax" },
{ id: "p-d", name: "Partner D", identity: "Commercial Litigation" },
];

const STAGES = [
{ key: "target", label: "Target", n: 1 },
{ key: "contacted", label: "Contacted", n: 2 },
{ key: "conversation", label: "Conversation", n: 3 },
{ key: "qualified", label: "Qualified Opportunity", n: 4 },
{ key: "proposal_requested", label: "Proposal Requested", n: 5 },
{ key: "proposal_submitted", label: "Proposal Submitted", n: 6 },
{ key: "negotiation", label: "Negotiation", n: 7 },
{ key: "won", label: "Won", n: 8 },
{ key: "lost", label: "Lost", n: 8 },
];

const PRACTICES = [
"Corporate & Commercial",
"Real Estate & Conveyancing",
"Tax",
"Technology",
"Commercial Litigation",
"Other",
];

const STRENGTHS = ["Cold", "Warm", "Strong"];

const SOURCES = [
"Referral",
"Event",
"Partner introduction",
"Family / personal network",
"LinkedIn / social media",
"Existing client",
"Cold outreach",
"Tender",
"Foreign firm",
];
const PROBABILITIES = [10, 25, 50, 75, 90];

const ACTIVITY_TYPES = [
{ key: "org_researched", label: "Target org researched", target: 100, source: "prospects" },
{ key: "outreach", label: "Quality direct outreach", target: 90, source: "prospects" },
{ key: "existing_client", label: "Existing client contacted", target: 20, source: "clients" },
{ key: "referral_contact", label: "Referral partner contacted", target: 15, source: "referrals" },
{ key: "meeting", label: "Client / prospect meeting", target: 13, source: "prospects_clients" },
{ key: "event", label: "Event attended", target: 4, source: null },
{ key: "linkedin_post", label: "LinkedIn post published", target: 12, source: null },
{ key: "client_alert", label: "Client alert / article", target: 2, source: "clients" },
{ key: "foreign_firm", label: "Foreign firm approached", target: 17, source: null },
{ key: "tender_reviewed", label: "Tender / RFP reviewed", target: 15, source: "tenders" },
{ key: "bid_submitted", label: "Serious bid submitted", target: 4, source: "tenders" },
];

const TENDER_STAGES = [
{ key: "opportunity", label: "Opportunity Identified", n: 1 },
{ key: "qualification", label: "Qualification (Bid/No-Bid)", n: 2 },
{ key: "documents", label: "Documents", n: 3 },
{ key: "technical", label: "Technical Proposal", n: 4 },
{ key: "financial", label: "Financial Proposal", n: 5 },
{ key: "partner_review", label: "Partner Review", n: 6 },
{ key: "submission", label: "Submission", n: 7 },
{ key: "follow_up", label: "Follow-up", n: 8 },
{ key: "result", label: "Result & Lessons", n: 9 },
];
const TENDER_STAGE_COUNT = 9;

const SCORING_CRITERIA = [
{ key: "relationship", label: "Relationship with procuring entity", max: 20 },
{ key: "practiceFit", label: "Practice fit", max: 20 },
{ key: "eligibility", label: "Eligibility", max: 15 },
{ key: "pastExperience", label: "Past experience", max: 15 },
{ key: "commercialAttractiveness", label: "Commercial attractiveness", max: 10 },
{ key: "competitivePosition", label: "Competitive position", max: 10 },
{ key: "strategicValue", label: "Strategic value", max: 10 },
];
const SCORE_MAX = SCORING_CRITERIA.reduce((a, c) => a + c.max, 0); // 100
const tenderScore = (t) => SCORING_CRITERIA.reduce((a, c) => a + (Number(t.scores?.[c.key]) || 0), 0);

const VAULT_ITEMS = [
{ key: "firm_profile", label: "Firm profile" },
{ key: "incorporation", label: "Incorporation documents" },
{ key: "practising_certs", label: "Practising certificates" },
{ key: "tax_compliance", label: "Tax compliance certificate" },
{ key: "cr12", label: "CR12 / equivalent records" },
{ key: "partner_cvs", label: "Partner CVs" },
{ key: "references", label: "References" },
{ key: "past_experience", label: "Past experience record" },
{ key: "certificates", label: "Certificates" },
{ key: "prof_indemnity", label: "Professional indemnity cover" },
{ key: "client_letters", label: "Client recommendation letters" },
{ key: "litigation_experience", label: "Litigation experience summary" },
{ key: "deal_sheets", label: "Deal sheets" },
{ key: "policies", label: "Policies" },
{ key: "standard_responses", label: "Standard technical responses" },
];

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const todayISO = () => new Date().toISOString().slice(0, 10);
const monthKey = (d) => (d || todayISO()).slice(0, 7);
const shiftMonthKey = (mk, delta) => {
const [y, m] = mk.split("-").map(Number);
const d = new Date(y, m - 1 + delta, 1);
return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const monthLabel = (mk) => {
const [y, m] = mk.split("-").map(Number);
return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
};
// Did a prospect reach a given stage during month mk? Falls back to current status only when
// viewing the live month and no history exists yet (older records saved before history tracking).
const reachedStageInMonth = (p, stageKey, mk) => {
const hist = p.statusHistory || [];
if (hist.some((h) => h.kind === "stage" && h.stage === stageKey && monthKey(h.date) === mk)) return true;
return hist.length === 0 && p.status === stageKey && mk === monthKey();
};
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
const fmtKES = (n) => (n ? `KES ${Number(n).toLocaleString()}` : "—");

function useStorage() {
const [ready, setReady] = useState(false);
const [partners, setPartners] = useState(DEFAULT_PARTNERS);
const [prospects, setProspects] = useState([]);
const [referrals, setReferrals] = useState([]);
const [activity, setActivity] = useState([]);
const [tenders, setTenders] = useState([]);
const [vault, setVault] = useState({});
const [clients, setClients] = useState([]);
const [error, setError] = useState(null);

useEffect(() => {
(async () => {
try {
const safe = async (key, fallback) => {
try {
const r = await window.storage.get(key, true);
return r ? JSON.parse(r.value) : fallback;
} catch {
return fallback;
}
};
const [pt, pr, rf, ac, td, vl, cl] = await Promise.all([
safe("kkn-partners", DEFAULT_PARTNERS),
safe("kkn-prospects", []),
safe("kkn-referrals", []),
safe("kkn-activity", []),
safe("kkn-tenders", []),
safe("kkn-tender-vault", {}),
safe("kkn-clients", []),
]);
setPartners(pt);
setProspects(pr);
setReferrals(rf);
setActivity(ac);
setTenders(td);
setVault(vl);
setClients(cl);
} catch (e) {
setError("Could not load shared data. You can keep working; changes may not save.");
} finally {
setReady(true);
}
})();
}, []);

const persist = useCallback(async (key, value) => {
try {
await window.storage.set(key, JSON.stringify(value), true);
} catch {
setError("A save didn't go through. Check your connection and try again.");
}
}, []);

const api = useMemo(
() => ({
partners,
prospects,
referrals,
activity,
tenders,
vault,
clients,
addPartner: (p) => {
const next = [...partners, { id: uid(), ...p }];
setPartners(next);
persist("kkn-partners", next);
},
saveProspect: (p) => {
const exists = prospects.some((x) => x.id === p.id);
const next = exists
? prospects.map((x) => (x.id === p.id ? p : x))
: [...prospects, p];
setProspects(next);
persist("kkn-prospects", next);
},
deleteProspect: (id) => {
const next = prospects.filter((x) => x.id !== id);
setProspects(next);
persist("kkn-prospects", next);
},
saveReferral: (r) => {
const exists = referrals.some((x) => x.id === r.id);
const next = exists
? referrals.map((x) => (x.id === r.id ? r : x))
: [...referrals, r];
setReferrals(next);
persist("kkn-referrals", next);
},
deleteReferral: (id) => {
const next = referrals.filter((x) => x.id !== id);
setReferrals(next);
persist("kkn-referrals", next);
},
logActivity: (partnerId, type, subject) => {
const next = [...activity, { id: uid(), partnerId, type, date: todayISO(), subject: subject || "" }];
setActivity(next);
persist("kkn-activity", next);
},
undoActivity: (type, partnerId) => {
const idx = [...activity]
.reverse()
.findIndex((a) => a.type === type && a.partnerId === partnerId && monthKey(a.date) === monthKey());
if (idx === -1) return;
const realIdx = activity.length - 1 - idx;
const next = activity.filter((_, i) => i !== realIdx);
setActivity(next);
persist("kkn-activity", next);
},
saveTender: (t) => {
const exists = tenders.some((x) => x.id === t.id);
const next = exists ? tenders.map((x) => (x.id === t.id ? t : x)) : [...tenders, t];
setTenders(next);
persist("kkn-tenders", next);
},
deleteTender: (id) => {
const next = tenders.filter((x) => x.id !== id);
setTenders(next);
persist("kkn-tenders", next);
},
toggleVaultItem: (key) => {
const next = { ...vault, [key]: !vault[key] };
setVault(next);
persist("kkn-tender-vault", next);
},
saveClient: (c) => {
const exists = clients.some((x) => x.id === c.id);
const next = exists ? clients.map((x) => (x.id === c.id ? c : x)) : [...clients, c];
setClients(next);
persist("kkn-clients", next);
},
deleteClient: (id) => {
const next = clients.filter((x) => x.id !== id);
setClients(next);
persist("kkn-clients", next);
},
}),
[partners, prospects, referrals, activity, tenders, vault, clients, persist]
);

return { ready, error, ...api };
}

/* ---------------------------- UI bits ---------------------------- */

function StageRail({ stage }) {
const idx = STAGES.findIndex((s) => s.key === stage);
const filled = STAGES[idx] ? STAGES[idx].n : 0;
const isLost = stage === "lost";
return (
<div className="rail">
{[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
<span
key={n}
className={`dot ${n <= filled ? (isLost ? "dot-lost" : "dot-fill") : ""}`}
/>
))}
</div>
);
}

function Pill({ children, tone }) {
return <span className={`pill ${tone || ""}`}>{children}</span>;
}

function ProspectCard({ p, partners, onOpen }) {
const overdue = p.nextActionDate && daysBetween(p.nextActionDate, todayISO()) > 0;
const stale = p.lastContact && daysBetween(p.lastContact, todayISO()) >= 14;
const owner = partners.find((x) => x.id === p.responsiblePartner);
return (
<button className="card" onClick={() => onOpen(p)}>
<div className="card-top">
<span className="org">{p.organization || "Unnamed prospect"}</span>
<span className="fee">{fmtKES(p.estimatedFee)}</span>
</div>
<StageRail stage={p.status} />
<div className="card-meta">
<Pill>{p.practiceArea || "—"}</Pill>
{owner && <Pill tone="owner">{owner.name}</Pill>}
{p.probability != null && <Pill tone="prob">{p.probability}%</Pill>}
</div>
{(overdue || stale) && (
<div className="flags">
{overdue && <span className="flag flag-red">Follow-up overdue</span>}
{stale && !overdue && <span className="flag flag-amber">No contact 14+ days</span>}
</div>
)}
</button>
);
}

function ReminderCard({ item, ownerName, kindLabel, onOpen, onMarkDone }) {
const diff = item.diff;
return (
<div className="card reminder-card" onClick={onOpen}>
<div className="card-top">
<span className="org">{item.title || "Untitled"}</span>
<span className="fee">{item.date}</span>
</div>
{item.action && <p className="reminder-action">{item.action}</p>}
<div className="card-meta">
<Pill tone="owner">{kindLabel}</Pill>
{ownerName && <Pill>{ownerName}</Pill>}
</div>
<div className="flags">
{diff > 0 && <span className="flag flag-red">{diff} day{diff > 1 ? "s" : ""} overdue</span>}
{diff === 0 && <span className="flag flag-amber">Due today</span>}
{diff < 0 && diff >= -7 && <span className="flag flag-soon">Due in {-diff} day{-diff > 1 ? "s" : ""}</span>}
</div>
{item.action && (
<button
className="chip-btn reminder-done"
onClick={(e) => { e.stopPropagation(); onMarkDone(); }}
>
✓ Mark done
</button>
)}
</div>
);
}

// Gathers every open next-action across prospects, clients, tenders, and referrals into one shape.
function collectReminders(store) {
const items = [];
store.prospects.forEach((p) => {
if (p.nextActionDate && !["won", "lost"].includes(p.status)) {
items.push({ kind: "prospect", id: p.id, title: p.organization, action: p.nextAction, date: p.nextActionDate, ownerId: p.responsiblePartner, ref: p });
}
});
store.clients.forEach((c) => {
if (c.nextActionDate) {
items.push({ kind: "client", id: c.id, title: c.name, action: c.nextAction, date: c.nextActionDate, ownerId: c.responsiblePartner, ref: c });
}
});
store.tenders.forEach((t) => {
if (t.nextActionDate && t.stage !== "result") {
items.push({ kind: "tender", id: t.id, title: t.title, action: t.nextAction, date: t.nextActionDate, ownerId: t.responsiblePartner, ref: t });
}
});
store.referrals.forEach((r) => {
if (r.nextActionDate) {
items.push({ kind: "referral", id: r.id, title: r.name, action: r.nextAction, date: r.nextActionDate, ownerId: null, ref: r });
}
});
return items;
}

function TenderStageRail({ stage }) {
const s = TENDER_STAGES.find((x) => x.key === stage);
const filled = s ? s.n : 0;
return (
<div className="rail">
{Array.from({ length: TENDER_STAGE_COUNT }, (_, i) => i + 1).map((n) => (
<span key={n} className={`dot ${n <= filled ? "dot-fill" : ""}`} />
))}
</div>
);
}

function TenderCard({ t, partners, onOpen }) {
const score = tenderScore(t);
const noBid = score > 0 && score < 50;
const overdue = t.deadline && daysBetween(t.deadline, todayISO()) > 0 && !["submission", "follow_up", "result"].includes(t.stage);
const owner = partners.find((x) => x.id === t.responsiblePartner);
return (
<button className="card" onClick={() => onOpen(t)}>
<div className="card-top">
<span className="org">{t.title || "Unnamed tender"}</span>
<span className="fee">{fmtKES(t.estimatedValue)}</span>
</div>
<TenderStageRail stage={t.stage} />
<div className="card-meta">
{t.procuringEntity && <Pill>{t.procuringEntity}</Pill>}
{owner && <Pill tone="owner">{owner.name}</Pill>}
<Pill tone={noBid ? "score-low" : "score"}>{score}/{SCORE_MAX}</Pill>
</div>
{(overdue || noBid) && (
<div className="flags">
{overdue && <span className="flag flag-red">Deadline passed</span>}
{noBid && <span className="flag flag-amber">Below 50 — consider no-bid</span>}
</div>
)}
</button>
);
}

function VaultChecklist({ vault, onToggle }) {
const have = VAULT_ITEMS.filter((i) => vault[i.key]).length;
return (
<section className="vault">
<div className="vault-head">
<span>Tender Vault</span>
<span className="stat-label">{have}/{VAULT_ITEMS.length} ready</span>
</div>
<p className="section-intro" style={{ margin: "8px 0 10px" }}>
Keep this current so no application is ever rebuilt from scratch.
</p>
<div className="vault-grid">
{VAULT_ITEMS.map((i) => (
<label key={i.key} className={`vault-item ${vault[i.key] ? "vault-item-on" : ""}`}>
<input type="checkbox" checked={!!vault[i.key]} onChange={() => onToggle(i.key)} />
<span>{i.label}</span>
</label>
))}
</div>
</section>
);
}

function HistoryLog({ history, partners, stageLabel }) {
if (!history || history.length === 0) return null;
const rows = [...history].reverse();
return (
<div className="history">
<div className="vault-head" style={{ marginBottom: 8 }}>
<span>Status history</span>
<span className="stat-label">{history.length} entr{history.length > 1 ? "ies" : "y"}</span>
</div>
<div className="history-list">
{rows.map((h, i) => {
const who = partners.find((p) => p.id === h.partnerId);
const isAction = h.kind === "action";
const label = isAction ? `Done: ${h.text}` : stageLabel(h.stage);
return (
<div key={i} className="history-row">
<span className={`history-dot ${isAction ? "history-dot-action" : ""}`} />
<div className="history-text">
<span className="history-stage">{label}</span>
<span className="history-meta">{h.date}{who ? ` · ${who.name}` : ""}</span>
</div>
</div>
);
})}
</div>
</div>
);
}

function NoteLog({ notes, partners }) {
if (!notes || notes.length === 0) return null;
const rows = [...notes].reverse();
return (
<div className="history">
<div className="vault-head" style={{ marginBottom: 8 }}>
<span>Notes</span>
<span className="stat-label">{notes.length} note{notes.length > 1 ? "s" : ""}</span>
</div>
<div className="history-list">
{rows.map((n, i) => {
const who = partners.find((p) => p.id === n.partnerId);
return (
<div key={i} className="note-row">
<div className="note-text">{n.text}</div>
<div className="history-meta">{n.date}{who ? ` · ${who.name}` : ""}</div>
</div>
);
})}
</div>
</div>
);
}

function Field({ label, children }) {
return (
<label className="field">
<span>{label}</span>
{children}
</label>
);
}

// Optional mic button — quietly disappears on browsers/webviews without speech recognition support.
function VoiceButton({ onResult, onError }) {
const [listening, setListening] = useState(false);
const recogRef = useRef(null);
const SR = typeof window !== "undefined" ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
if (!SR) return null;

const fail = (code) => {
setListening(false);
if (!onError) return;
const messages = {
"not-allowed": "Microphone access was blocked — check this app's mic permission in Settings.",
"service-not-allowed": "Voice input isn't available in this app on this device.",
"no-speech": "Didn't catch that — try again.",
"audio-capture": "No microphone found on this device.",
network: "Voice input needs a network connection.",
};
onError(messages[code] || "Voice input didn't work here — try typing instead.");
};

const start = () => {
onError?.(""); // clear any previous message
const recog = new SR();
recog.lang = "en-US";
recog.interimResults = false;
recog.maxAlternatives = 1;
recog.onresult = (e) => {
const text = e.results?.[0]?.[0]?.transcript || "";
if (text) onResult(text);
};
recog.onerror = (e) => fail(e?.error);
recog.onend = () => setListening(false);
recogRef.current = recog;
try {
recog.start();
setListening(true);
} catch {
fail();
}
};
const stop = () => {
recogRef.current?.stop();
setListening(false);
};

return (
<button
type="button"
className={`mic-btn ${listening ? "mic-btn-active" : ""}`}
onClick={listening ? stop : start}
aria-label={listening ? "Stop voice input" : "Start voice input"}
title="Voice input"
>
{listening ? "●" : "🎤"}
</button>
);
}

// A Field whose input/textarea can optionally be filled by voice, appended to whatever's already there.
function VoiceField({ label, value, onChange, textarea, rows, placeholder, autoFocus }) {
const [voiceError, setVoiceError] = useState("");
const appendVoiceText = (text) => {
const merged = value ? `${value} ${text}` : text;
onChange({ target: { value: merged } });
};
return (
<Field label={label}>
<div className="input-mic-row">
{textarea ? (
<textarea rows={rows || 3} value={value} onChange={onChange} placeholder={placeholder} />
) : (
<input value={value} onChange={onChange} placeholder={placeholder} autoFocus={autoFocus} />
)}
<VoiceButton onResult={appendVoiceText} onError={setVoiceError} />
</div>
{voiceError && <span className="voice-error">{voiceError}</span>}
</Field>
);
}

const hasVoiceSupport = () => typeof window !== "undefined" && !!(window.SpeechRecognition || window.webkitSpeechRecognition);

// Walks the person through a fixed set of free-text fields one at a time by voice.
// Each field is confirmed with a tap before moving on — no silent auto-advance.
function VoiceFillPanel({ fields, f, setF, onExit }) {
const [step, setStep] = useState(0);
const field = fields[step];
const [draft, setDraft] = useState(f[field.key] || "");
const [voiceError, setVoiceError] = useState("");

const appendVoice = (text) => setDraft((d) => (d ? `${d} ${text}` : text));

const goTo = (nextStep, updatedF) => {
setVoiceError("");
if (nextStep >= fields.length) {
onExit();
} else {
setStep(nextStep);
setDraft((updatedF || f)[fields[nextStep].key] || "");
}
};

const confirm = () => {
const updated = { ...f, [field.key]: draft };
setF(updated);
goTo(step + 1, updated);
};
const skip = () => goTo(step + 1);
const clearDraft = () => setDraft("");

return (
<div className="voice-panel">
<div className="voice-panel-head">
<span className="voice-panel-step">Voice fill · {step + 1} of {fields.length}</span>
<button type="button" className="icon-btn" onClick={onExit} aria-label="Exit voice fill">✕</button>
</div>
<div className="voice-panel-field">
<span className="voice-panel-label">{field.label}</span>
<div className="input-mic-row">
<input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={field.placeholder} autoFocus />
<VoiceButton onResult={appendVoice} onError={setVoiceError} />
</div>
{voiceError && <span className="voice-error voice-error-dark">{voiceError}</span>}
</div>
<div className="voice-panel-actions">
<button type="button" className="chip-btn chip-ghost" onClick={clearDraft}>Clear</button>
<button type="button" className="chip-btn chip-ghost" onClick={skip}>Skip</button>
<button type="button" className="btn btn-primary" onClick={confirm}>
{step + 1 === fields.length ? "Finish" : "Next →"}
</button>
</div>
</div>
);
}

const PROSPECT_VOICE_FIELDS = [
{ key: "organization", label: "Organization", placeholder: "e.g. ABC Developers Ltd" },
{ key: "contact", label: "Contact", placeholder: "e.g. Jane Wanjiru" },
{ key: "position", label: "Position", placeholder: "e.g. CFO" },
{ key: "sector", label: "Sector", placeholder: "e.g. Real estate" },
{ key: "opportunity", label: "Opportunity", placeholder: "e.g. Acquisition / development due diligence" },
{ key: "nextAction", label: "Next action", placeholder: "e.g. Send real-estate capability statement" },
{ key: "notes", label: "Notes", placeholder: "Context, what was said, who to loop in" },
];

const CLIENT_VOICE_FIELDS = [
{ key: "name", label: "Client / organization name", placeholder: "e.g. ABC Holdings Ltd" },
{ key: "sector", label: "Sector", placeholder: "e.g. Manufacturing" },
{ key: "instructedOn", label: "What they instructed us on", placeholder: "e.g. Property acquisition" },
{ key: "potentialNeeds", label: "What else they probably need", placeholder: "e.g. Succession planning, tax structuring" },
{ key: "nextAction", label: "Next action", placeholder: "e.g. Check in on succession planning" },
{ key: "notes", label: "Notes", placeholder: "Relationship context, who to loop in" },
];

const TENDER_VOICE_FIELDS = [
{ key: "title", label: "Tender title", placeholder: "e.g. Nairobi City County — legal services panel" },
{ key: "procuringEntity", label: "Procuring entity", placeholder: "e.g. Nairobi City County" },
{ key: "nextAction", label: "Next action", placeholder: "e.g. Follow up on technical proposal review" },
{ key: "result", label: "Result / lessons learned", placeholder: "e.g. Won / lost / withdrawn — why" },
{ key: "notes", label: "Notes", placeholder: "Contacts at procuring entity, technical angle, risks" },
];

const REFERRAL_VOICE_FIELDS = [
{ key: "name", label: "Name", placeholder: "e.g. Amina — auditor, KMP & Associates" },
{ key: "type", label: "Type", placeholder: "e.g. Accountant / Agent / Broker..." },
{ key: "practiceFed", label: "Practice fed", placeholder: "e.g. Tax / Corporate" },
{ key: "nextAction", label: "Next action", placeholder: "e.g. Coffee to discuss pipeline" },
{ key: "notes", label: "Notes", placeholder: "Context" },
];

function ProspectModal({ prospect, partners, me, prefillOrg, onSave, onDelete, onClose }) {
const [f, setF] = useState(
prospect
? {
...prospect,
notes: "",
notesHistory:
prospect.notesHistory ||
(prospect.notes ? [{ text: prospect.notes, date: prospect.lastContact || todayISO(), partnerId: null }] : []),
}
: {
id: uid(),
organization: prefillOrg || "",
contact: "",
position: "",
sector: "",
practiceArea: PRACTICES[0],
opportunity: "",
estimatedFee: "",
source: prefillOrg ? "Logged activity" : "",
relationshipStrength: "Warm",
lastContact: todayISO(),
nextAction: "",
nextActionDate: "",
responsiblePartner: partners[0]?.id || "",
probability: 25,
status: "target",
notes: "",
notesHistory: [],
statusHistory: [],
}
);
const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
const stageLabel = (key) => {
const s = STAGES.find((x) => x.key === key);
return s ? `${s.n}. ${s.label}` : key;
};
const [voiceFillOpen, setVoiceFillOpen] = useState(false);
const voiceSupported = hasVoiceSupport();
const [otherSource, setOtherSource] = useState(Boolean(f.source) && !SOURCES.includes(f.source));

return (
<div className="overlay" onClick={onClose}>
<div className="sheet" onClick={(e) => e.stopPropagation()}>
<div className="sheet-head">
<h3>{prospect ? "Edit prospect" : "New prospect"}</h3>
<button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
</div>
<div className="sheet-body">
{voiceSupported && (
voiceFillOpen ? (
<VoiceFillPanel fields={PROSPECT_VOICE_FIELDS} f={f} setF={setF} onExit={() => setVoiceFillOpen(false)} />
) : (
<button type="button" className="voice-fill-trigger" onClick={() => setVoiceFillOpen(true)}>
🎤 Fill by voice
</button>
)
)}
<Field label="Organization">
<input value={f.organization} onChange={set("organization")} placeholder="ABC Developers Ltd" />
</Field>
<div className="row2">
<Field label="Contact">
<input value={f.contact} onChange={set("contact")} placeholder="Jane Wanjiru" />
</Field>
<Field label="Position">
<input value={f.position} onChange={set("position")} placeholder="CFO" />
</Field>
</div>
<div className="row2">
<Field label="Sector">
<input value={f.sector} onChange={set("sector")} placeholder="Real estate" />
</Field>
<Field label="Practice area">
<select value={f.practiceArea} onChange={set("practiceArea")}>
{PRACTICES.map((x) => <option key={x}>{x}</option>)}
</select>
</Field>
</div>
<Field label="Opportunity">
<input value={f.opportunity} onChange={set("opportunity")} placeholder="Acquisition / development due diligence" />
</Field>
<div className="row2">
<Field label="Estimated fee (KES)">
<input type="number" value={f.estimatedFee} onChange={set("estimatedFee")} placeholder="600000" />
</Field>
<Field label="Source">
<select
value={otherSource ? "Other" : (SOURCES.includes(f.source) ? f.source : "")}
onChange={(e) => {
const v = e.target.value;
if (v === "Other") {
setOtherSource(true);
} else {
setOtherSource(false);
setF({ ...f, source: v });
}
}}
>
<option value="">Select a source…</option>
{SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
<option value="Other">Other</option>
</select>
</Field>
</div>
{otherSource && (
<Field label="Describe the source">
<input value={f.source} onChange={set("source")} placeholder="e.g. Chamber of Commerce mixer" autoFocus />
</Field>
)}
<div className="row2">
<Field label="Relationship strength">
<select value={f.relationshipStrength} onChange={set("relationshipStrength")}>
{STRENGTHS.map((x) => <option key={x}>{x}</option>)}
</select>
</Field>
<Field label="Probability">
<select value={f.probability} onChange={(e) => setF({ ...f, probability: Number(e.target.value) })}>
{PROBABILITIES.map((x) => <option key={x} value={x}>{x}%</option>)}
</select>
</Field>
</div>
<div className="row2">
<Field label="Last contact">
<input type="date" value={f.lastContact} onChange={set("lastContact")} />
</Field>
<Field label="Next action date">
<input type="date" value={f.nextActionDate} onChange={set("nextActionDate")} />
</Field>
</div>
<VoiceField
label="Next action"
value={f.nextAction}
onChange={set("nextAction")}
placeholder="Send real-estate capability statement"
/>
<div className="row2">
<Field label="Responsible partner">
<select value={f.responsiblePartner} onChange={set("responsiblePartner")}>
{partners.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
</select>
</Field>
<Field label="Pipeline stage">
<select value={f.status} onChange={set("status")}>
{STAGES.filter((s, i, arr) => arr.findIndex((y) => y.key === s.key) === i).map((s) => (
<option key={s.key} value={s.key}>{`${s.n}. ${s.label}`}</option>
))}
</select>
</Field>
</div>
<HistoryLog history={f.statusHistory} partners={partners} stageLabel={stageLabel} />
<NoteLog notes={f.notesHistory} partners={partners} />
<VoiceField
label="Add a note"
value={f.notes}
onChange={set("notes")}
textarea
rows={3}
placeholder="Context, what was said, who to loop in — saved as a new dated note"
/>
</div>
<div className="sheet-actions">
{prospect && (
<button className="btn btn-ghost btn-danger" onClick={() => { onDelete(f.id); onClose(); }}>
Delete
</button>
)}
<button
className="btn btn-primary"
onClick={() => {
if (!f.organization.trim()) return;
const prevHistory = f.statusHistory || [];
const statusChanged = !prospect || prospect.status !== f.status;
const actionCompleted = prospect && prospect.nextAction && prospect.nextAction !== f.nextAction;
const newEntries = [];
if (actionCompleted) {
newEntries.push({ kind: "action", text: prospect.nextAction, date: todayISO(), partnerId: me });
}
if (statusChanged) {
newEntries.push({ kind: "stage", stage: f.status, date: todayISO(), partnerId: me });
}
const noteText = f.notes.trim();
const nextNotesHistory = noteText
? [...(f.notesHistory || []), { text: noteText, date: todayISO(), partnerId: me }]
: f.notesHistory || [];
onSave({ ...f, notes: "", notesHistory: nextNotesHistory, statusHistory: [...prevHistory, ...newEntries] });
onClose();
}}
>
{prospect ? "Update prospect" : "Save prospect"}
</button>
</div>
</div>
</div>
);
}

function ReferralModal({ item, prefillName, onSave, onDelete, onClose }) {
const [f, setF] = useState(
item || { id: uid(), name: prefillName || "", type: "", practiceFed: "", lastContact: todayISO(), nextAction: "", nextActionDate: "", notes: "" }
);
const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
const [voiceFillOpen, setVoiceFillOpen] = useState(false);
const voiceSupported = hasVoiceSupport();
return (
<div className="overlay" onClick={onClose}>
<div className="sheet" onClick={(e) => e.stopPropagation()}>
<div className="sheet-head">
<h3>{item ? "Edit referral partner" : "New referral partner"}</h3>
<button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
</div>
<div className="sheet-body">
{voiceSupported && (
voiceFillOpen ? (
<VoiceFillPanel fields={REFERRAL_VOICE_FIELDS} f={f} setF={setF} onExit={() => setVoiceFillOpen(false)} />
) : (
<button type="button" className="voice-fill-trigger" onClick={() => setVoiceFillOpen(true)}>
🎤 Fill by voice
</button>
)
)}
<Field label="Name">
<input value={f.name} onChange={set("name")} placeholder="Amina — auditor, KMP & Associates" />
</Field>
<div className="row2">
<Field label="Type">
<input value={f.type} onChange={set("type")} placeholder="Accountant / Agent / Broker..." />
</Field>
<Field label="Practice fed">
<input value={f.practiceFed} onChange={set("practiceFed")} placeholder="Tax / Corporate" />
</Field>
</div>
<div className="row2">
<Field label="Last contact">
<input type="date" value={f.lastContact} onChange={set("lastContact")} />
</Field>
<Field label="Next action date">
<input type="date" value={f.nextActionDate} onChange={set("nextActionDate")} />
</Field>
</div>
<VoiceField
label="Next action"
value={f.nextAction}
onChange={set("nextAction")}
placeholder="Coffee to discuss pipeline"
/>
<VoiceField
label="Notes"
value={f.notes}
onChange={set("notes")}
textarea
rows={3}
/>
</div>
<div className="sheet-actions">
{item && (
<button className="btn btn-ghost btn-danger" onClick={() => { onDelete(f.id); onClose(); }}>
Delete
</button>
)}
<button
className="btn btn-primary"
onClick={() => { if (!f.name.trim()) return; onSave(f); onClose(); }}
>
Save
</button>
</div>
</div>
</div>
);
}

function ClientModal({ item, partners, me, prefillName, onSave, onDelete, onClose }) {
const [f, setF] = useState(
item
? {
...item,
notes: "",
notesHistory:
item.notesHistory ||
(item.notes ? [{ text: item.notes, date: item.lastContact || todayISO(), partnerId: null }] : []),
}
: {
id: uid(),
name: prefillName || "",
sector: "",
instructedOn: "",
potentialNeeds: "",
responsiblePartner: partners[0]?.id || "",
lastContact: todayISO(),
nextAction: "",
nextActionDate: "",
notes: "",
notesHistory: [],
}
);
const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
const [voiceFillOpen, setVoiceFillOpen] = useState(false);
const voiceSupported = hasVoiceSupport();

return (
<div className="overlay" onClick={onClose}>
<div className="sheet" onClick={(e) => e.stopPropagation()}>
<div className="sheet-head">
<h3>{item ? "Edit client" : "New client"}</h3>
<button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
</div>
<div className="sheet-body">
{voiceSupported && (
voiceFillOpen ? (
<VoiceFillPanel fields={CLIENT_VOICE_FIELDS} f={f} setF={setF} onExit={() => setVoiceFillOpen(false)} />
) : (
<button type="button" className="voice-fill-trigger" onClick={() => setVoiceFillOpen(true)}>
🎤 Fill by voice
</button>
)
)}
<Field label="Client / organization name">
<input value={f.name} onChange={set("name")} placeholder="ABC Holdings Ltd" />
</Field>
<div className="row2">
<Field label="Sector">
<input value={f.sector} onChange={set("sector")} placeholder="Manufacturing" />
</Field>
<Field label="Responsible partner">
<select value={f.responsiblePartner} onChange={set("responsiblePartner")}>
{partners.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
</select>
</Field>
</div>
<Field label="What they instructed us on">
<input value={f.instructedOn} onChange={set("instructedOn")} placeholder="Property acquisition" />
</Field>
<Field label="What else they probably need">
<input value={f.potentialNeeds} onChange={set("potentialNeeds")} placeholder="Succession planning, tax structuring" />
</Field>
<Field label="Last contact">
<input type="date" value={f.lastContact} onChange={set("lastContact")} />
</Field>
<div className="row2">
<Field label="Next action date">
<input type="date" value={f.nextActionDate} onChange={set("nextActionDate")} />
</Field>
<VoiceField
label="Next action"
value={f.nextAction}
onChange={set("nextAction")}
placeholder="Check in on succession planning"
/>
</div>
<NoteLog notes={f.notesHistory} partners={partners} />
<VoiceField
label="Add a note"
value={f.notes}
onChange={set("notes")}
textarea
rows={3}
placeholder="Relationship context, who to loop in — saved as a new dated note"
/>
</div>
<div className="sheet-actions">
{item && (
<button className="btn btn-ghost btn-danger" onClick={() => { onDelete(f.id); onClose(); }}>
Delete
</button>
)}
<button
className="btn btn-primary"
onClick={() => {
if (!f.name.trim()) return;
const actionCompleted = item && item.nextAction && item.nextAction !== f.nextAction;
const noteText = f.notes.trim();
let nextNotesHistory = f.notesHistory || [];
if (actionCompleted) {
nextNotesHistory = [...nextNotesHistory, { text: `Done: ${item.nextAction}`, date: todayISO(), partnerId: me }];
}
if (noteText) {
nextNotesHistory = [...nextNotesHistory, { text: noteText, date: todayISO(), partnerId: me }];
}
onSave({ ...f, notes: "", notesHistory: nextNotesHistory });
onClose();
}}
>
{item ? "Update client" : "Save client"}
</button>
</div>
</div>
</div>
);
}

function TenderModal({ tender, partners, me, prefillTitle, onSave, onDelete, onClose }) {
const [f, setF] = useState(
tender
? {
...tender,
notes: "",
notesHistory:
tender.notesHistory ||
(tender.notes ? [{ text: tender.notes, date: todayISO(), partnerId: null }] : []),
}
: {
id: uid(),
title: prefillTitle || "",
procuringEntity: "",
deadline: "",
estimatedValue: "",
responsiblePartner: partners[0]?.id || "",
stage: "opportunity",
nextAction: "",
nextActionDate: "",
scores: {},
result: "",
notes: "",
notesHistory: [],
stageHistory: [],
}
);
const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
const setScore = (k) => (e) => setF({ ...f, scores: { ...f.scores, [k]: Number(e.target.value) } });
const total = tenderScore(f);
const noBid = total < 50;
const stageLabel = (key) => {
const s = TENDER_STAGES.find((x) => x.key === key);
return s ? `${s.n}. ${s.label}` : key;
};
const [voiceFillOpen, setVoiceFillOpen] = useState(false);
const voiceSupported = hasVoiceSupport();

return (
<div className="overlay" onClick={onClose}>
<div className="sheet" onClick={(e) => e.stopPropagation()}>
<div className="sheet-head">
<h3>{tender ? "Edit tender" : "New tender"}</h3>
<button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
</div>
<div className="sheet-body">
{voiceSupported && (
voiceFillOpen ? (
<VoiceFillPanel fields={TENDER_VOICE_FIELDS} f={f} setF={setF} onExit={() => setVoiceFillOpen(false)} />
) : (
<button type="button" className="voice-fill-trigger" onClick={() => setVoiceFillOpen(true)}>
🎤 Fill by voice
</button>
)
)}
<Field label="Tender title">
<input value={f.title} onChange={set("title")} placeholder="Nairobi City County — legal services panel" />
</Field>
<div className="row2">
<Field label="Procuring entity">
<input value={f.procuringEntity} onChange={set("procuringEntity")} placeholder="Nairobi City County" />
</Field>
<Field label="Submission deadline">
<input type="date" value={f.deadline} onChange={set("deadline")} />
</Field>
</div>
<div className="row2">
<Field label="Estimated value (KES)">
<input type="number" value={f.estimatedValue} onChange={set("estimatedValue")} placeholder="1200000" />
</Field>
<Field label="Responsible partner">
<select value={f.responsiblePartner} onChange={set("responsiblePartner")}>
{partners.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
</select>
</Field>
</div>
<Field label="Pipeline stage">
<select value={f.stage} onChange={set("stage")}>
{TENDER_STAGES.map((s) => (
<option key={s.key} value={s.key}>{`${s.n}. ${s.label}`}</option>
))}
</select>
</Field>
<div className="row2">
<Field label="Next action date">
<input type="date" value={f.nextActionDate} onChange={set("nextActionDate")} />
</Field>
<VoiceField
label="Next action"
value={f.nextAction}
onChange={set("nextAction")}
placeholder="Follow up on technical proposal review"
/>
</div>

<div className="score-block">
<div className="vault-head">
<span>Bid/No-Bid scorecard</span>
<span className={`score-total ${noBid ? "score-total-low" : ""}`}>{total}/{SCORE_MAX}</span>
</div>
{SCORING_CRITERIA.map((c) => (
<div key={c.key} className="score-row">
<div className="score-row-top">
<span>{c.label}</span>
<span className="activity-count">{f.scores?.[c.key] || 0}/{c.max}</span>
</div>
<input
type="range"
min={0}
max={c.max}
value={f.scores?.[c.key] || 0}
onChange={setScore(c.key)}
/>
</div>
))}
{total > 0 && (
<p className={`score-verdict ${noBid ? "score-verdict-low" : ""}`}>
{noBid
? "Below 50/100 — a disciplined firm sometimes wins because it knows which tenders not to pursue."
: "Above 50/100 — worth committing resources."}
</p>
)}
</div>

<Field label="Result / lessons learned">
<input value={f.result} onChange={set("result")} placeholder="Won / lost / withdrawn — why" />
</Field>
<HistoryLog history={f.stageHistory} partners={partners} stageLabel={stageLabel} />
<NoteLog notes={f.notesHistory} partners={partners} />
<VoiceField
label="Add a note"
value={f.notes}
onChange={set("notes")}
textarea
rows={3}
placeholder="Contacts at procuring entity, technical angle, risks — saved as a new dated note"
/>
</div>
<div className="sheet-actions">
{tender && (
<button className="btn btn-ghost btn-danger" onClick={() => { onDelete(f.id); onClose(); }}>
Delete
</button>
)}
<button
className="btn btn-primary"
onClick={() => {
if (!f.title.trim()) return;
const prevHistory = f.stageHistory || [];
const stageChanged = !tender || tender.stage !== f.stage;
const actionCompleted = tender && tender.nextAction && tender.nextAction !== f.nextAction;
const newEntries = [];
if (actionCompleted) {
newEntries.push({ kind: "action", text: tender.nextAction, date: todayISO(), partnerId: me });
}
if (stageChanged) {
newEntries.push({ kind: "stage", stage: f.stage, date: todayISO(), partnerId: me });
}
const nextHistory = [...prevHistory, ...newEntries];
const noteText = f.notes.trim();
const nextNotesHistory = noteText
? [...(f.notesHistory || []), { text: noteText, date: todayISO(), partnerId: me }]
: f.notesHistory || [];
onSave({ ...f, notes: "", notesHistory: nextNotesHistory, stageHistory: nextHistory });
onClose();
}}
>
{tender ? "Update tender" : "Save tender"}
</button>
</div>
</div>
</div>
);
}

/* ------------------------------ App ------------------------------ */

export default function App() {
const store = useStorage();
const [tab, setTab] = useState("pipeline");
const [me, setMe] = useState(null);
const [filterPartner, setFilterPartner] = useState("all");
const [openProspect, setOpenProspect] = useState(undefined); // undefined=closed, null=new, obj=edit
const [openReferral, setOpenReferral] = useState(undefined);
const [openTender, setOpenTender] = useState(undefined);
const [openClient, setOpenClient] = useState(undefined);
const [prospectPrefill, setProspectPrefill] = useState("");
const [clientPrefill, setClientPrefill] = useState("");
const [referralPrefill, setReferralPrefill] = useState("");
const [tenderPrefill, setTenderPrefill] = useState("");
const [collapsed, setCollapsed] = useState({});
const [tenderCollapsed, setTenderCollapsed] = useState({});

useEffect(() => {
document.title = "KKN Revenue Engine";
}, []);

if (!store.ready) {
return (
<div className="boot">
<Style />
<div className="boot-mark">KKN</div>
<p>Loading the pipeline…</p>
</div>
);
}

if (!me) {
return (
<div className="boot">
<Style />
<div className="boot-mark">KKN</div>
<h1>Revenue Engine</h1>
<p className="muted">Who's picking this up?</p>
<div className="who-list">
{store.partners.map((p) => (
<button key={p.id} className="who-btn" onClick={() => setMe(p.id)}>
<span className="who-name">{p.name}</span>
<span className="who-identity">{p.identity}</span>
</button>
))}
</div>
<AddPartner onAdd={store.addPartner} />
<p className="fine">This board is shared — everything logged here is visible to every partner.</p>
</div>
);
}

const myPartner = store.partners.find((p) => p.id === me);
const visibleProspects =
filterPartner === "all" ? store.prospects : store.prospects.filter((p) => p.responsiblePartner === filterPartner);

const grouped = STAGES.filter((s, i, arr) => arr.findIndex((y) => y.key === s.key) === i).map((s) => ({
...s,
items: visibleProspects.filter((p) => p.status === s.key),
}));

const overdueCount = collectReminders(store).filter((item) => daysBetween(item.date, todayISO()) > 0).length;

return (
<div className="app">
<Style />
<header className="topbar">
<div className="brand">
<span className="brand-mark">KKN</span>
<span className="brand-sub">Revenue Engine</span>
</div>
<button className="me-chip" onClick={() => setMe(null)}>
{myPartner?.name || "Switch"}
</button>
</header>

<nav className="tabs">
{[
["reminders", "Reminders", overdueCount],
["pipeline", "Pipeline", 0],
["tenders", "Tenders", 0],
["clients", "Clients", 0],
["referrals", "Referrals", 0],
["scorecard", "Scorecard", 0],
].map(([k, label, badge]) => (
<button key={k} className={`tab ${tab === k ? "tab-active" : ""}`} onClick={() => setTab(k)}>
{label}{badge > 0 && <span className="tab-badge">{badge}</span>}
</button>
))}
</nav>

{tab === "reminders" && (
<Reminders
store={store}
me={me}
setOpenProspect={setOpenProspect}
setOpenClient={setOpenClient}
setOpenTender={setOpenTender}
setOpenReferral={setOpenReferral}
/>
)}

{tab === "pipeline" && (
<main className="content">
<div className="filter-row">
<select value={filterPartner} onChange={(e) => setFilterPartner(e.target.value)}>
<option value="all">All partners</option>
{store.partners.map((p) => (
<option key={p.id} value={p.id}>{p.name}</option>
))}
</select>
{overdueCount > 0 && <span className="overdue-banner">{overdueCount} overdue follow-up{overdueCount > 1 ? "s" : ""}</span>}
</div>

{grouped.map((s) => (
<section key={s.key} className="stage-group">
<button className="stage-head" onClick={() => setCollapsed({ ...collapsed, [s.key]: !collapsed[s.key] })}>
<span>{s.n}. {s.label}</span>
<span className="stage-count">
{s.items.length} · {fmtKES(s.items.reduce((a, p) => a + (Number(p.estimatedFee) || 0), 0))}
</span>
</button>
{!collapsed[s.key] && (
<div className="card-list">
{s.items.length === 0 && <p className="empty">Nothing here yet.</p>}
{s.items.map((p) => (
<ProspectCard key={p.id} p={p} partners={store.partners} onOpen={setOpenProspect} />
))}
</div>
)}
</section>
))}

<button className="fab" onClick={() => { setProspectPrefill(""); setOpenProspect(null); }}>+ New prospect</button>
</main>
)}

{tab === "tenders" && (
<main className="content">
<VaultChecklist vault={store.vault} onToggle={store.toggleVaultItem} />

<p className="section-intro" style={{ marginTop: 16 }}>
Score every opportunity before committing resources. A disciplined firm wins partly by knowing which tenders not to pursue.
</p>

{TENDER_STAGES.map((s) => {
const items = store.tenders.filter((t) => t.stage === s.key);
return (
<section key={s.key} className="stage-group">
<button
className="stage-head"
onClick={() => setTenderCollapsed({ ...tenderCollapsed, [s.key]: !tenderCollapsed[s.key] })}
>
<span>{s.n}. {s.label}</span>
<span className="stage-count">
{items.length} · {fmtKES(items.reduce((a, t) => a + (Number(t.estimatedValue) || 0), 0))}
</span>
</button>
{!tenderCollapsed[s.key] && (
<div className="card-list">
{items.length === 0 && <p className="empty">Nothing here yet.</p>}
{items.map((t) => (
<TenderCard key={t.id} t={t} partners={store.partners} onOpen={setOpenTender} />
))}
</div>
)}
</section>
);
})}

<button className="fab" onClick={() => { setTenderPrefill(""); setOpenTender(null); }}>+ New tender</button>
</main>
)}

{tab === "clients" && (
<main className="content">
<p className="section-intro">
Your existing client base — before hunting strangers, this is where the next instruction is often already sitting.
</p>
<div className="card-list">
{store.clients.length === 0 && <p className="empty">No clients logged yet.</p>}
{store.clients
.slice()
.sort((a, b) => (a.name || "").localeCompare(b.name || ""))
.map((c) => {
const owner = store.partners.find((x) => x.id === c.responsiblePartner);
const stale = c.lastContact && daysBetween(c.lastContact, todayISO()) >= 60;
return (
<button key={c.id} className="card" onClick={() => setOpenClient(c)}>
<div className="card-top">
<span className="org">{c.name}</span>
</div>
<div className="card-meta">
{c.sector && <Pill>{c.sector}</Pill>}
{owner && <Pill tone="owner">{owner.name}</Pill>}
</div>
{c.instructedOn && <p className="reminder-action">Instructed on: {c.instructedOn}</p>}
{c.potentialNeeds && <p className="reminder-action muted-line">Possible need: {c.potentialNeeds}</p>}
{stale && <div className="flags"><span className="flag flag-amber">No contact 60+ days</span></div>}
</button>
);
})}
</div>
<button className="fab" onClick={() => { setClientPrefill(""); setOpenClient(null); }}>+ New client</button>
</main>
)}

{tab === "referrals" && (
<main className="content">
<p className="section-intro">
Your fastest source of business — people who already advise your clients. Aim to review any contact silent for 30+ days.
</p>
<div className="card-list">
{store.referrals.length === 0 && <p className="empty">No referral partners logged yet.</p>}
{store.referrals
.slice()
.sort((a, b) => (a.lastContact || "") < (b.lastContact || "") ? -1 : 1)
.map((r) => {
const silent = r.lastContact && daysBetween(r.lastContact, todayISO()) >= 30;
return (
<button key={r.id} className="card" onClick={() => setOpenReferral(r)}>
<div className="card-top">
<span className="org">{r.name}</span>
</div>
<div className="card-meta">
{r.type && <Pill>{r.type}</Pill>}
{r.practiceFed && <Pill tone="owner">{r.practiceFed}</Pill>}
</div>
{silent && <div className="flags"><span className="flag flag-amber">Silent 30+ days</span></div>}
</button>
);
})}
</div>
<button className="fab" onClick={() => { setReferralPrefill(""); setOpenReferral(null); }}>+ Referral partner</button>
</main>
)}

{tab === "scorecard" && (
<Scorecard
store={store}
me={me}
myPartner={myPartner}
onAddAsProspect={(subject) => {
setProspectPrefill(subject);
setOpenProspect(null);
}}
onAddAsClient={(subject) => {
setClientPrefill(subject);
setOpenClient(null);
}}
onAddAsReferral={(subject) => {
setReferralPrefill(subject);
setOpenReferral(null);
}}
onAddAsTender={(subject) => {
setTenderPrefill(subject);
setOpenTender(null);
}}
/>
)}

{openProspect !== undefined && (
<ProspectModal
prospect={openProspect}
partners={store.partners}
me={me}
prefillOrg={prospectPrefill}
onSave={store.saveProspect}
onDelete={store.deleteProspect}
onClose={() => { setOpenProspect(undefined); setProspectPrefill(""); }}
/>
)}

{openClient !== undefined && (
<ClientModal
item={openClient}
partners={store.partners}
me={me}
prefillName={clientPrefill}
onSave={store.saveClient}
onDelete={store.deleteClient}
onClose={() => { setOpenClient(undefined); setClientPrefill(""); }}
/>
)}

{openReferral !== undefined && (
<ReferralModal
item={openReferral}
prefillName={referralPrefill}
onSave={store.saveReferral}
onDelete={store.deleteReferral}
onClose={() => { setOpenReferral(undefined); setReferralPrefill(""); }}
/>
)}

{openTender !== undefined && (
<TenderModal
tender={openTender}
partners={store.partners}
me={me}
prefillTitle={tenderPrefill}
onSave={store.saveTender}
onDelete={store.deleteTender}
onClose={() => { setOpenTender(undefined); setTenderPrefill(""); }}
/>
)}
</div>
);
}

const KIND_LABEL = { prospect: "Prospect", client: "Client", tender: "Tender", referral: "Referral" };

function Reminders({ store, me, setOpenProspect, setOpenClient, setOpenTender, setOpenReferral }) {
const withDiff = collectReminders(store)
.map((item) => ({ ...item, diff: daysBetween(item.date, todayISO()) }))
.sort((a, b) => (a.date < b.date ? -1 : 1));

const overdue = withDiff.filter((x) => x.diff > 0);
const today = withDiff.filter((x) => x.diff === 0);
const week = withDiff.filter((x) => x.diff < 0 && x.diff >= -7);
const later = withDiff.filter((x) => x.diff < -7);

const openFor = (item) => {
if (item.kind === "prospect") setOpenProspect(item.ref);
else if (item.kind === "client") setOpenClient(item.ref);
else if (item.kind === "tender") setOpenTender(item.ref);
else if (item.kind === "referral") setOpenReferral(item.ref);
};

const markDone = (item) => {
const entry = { kind: "action", text: item.action, date: todayISO(), partnerId: me };
if (item.kind === "prospect") {
store.saveProspect({ ...item.ref, nextAction: "", nextActionDate: "", statusHistory: [...(item.ref.statusHistory || []), entry] });
} else if (item.kind === "tender") {
store.saveTender({ ...item.ref, nextAction: "", nextActionDate: "", stageHistory: [...(item.ref.stageHistory || []), entry] });
} else if (item.kind === "client") {
const noteEntry = { text: `Done: ${item.action}`, date: todayISO(), partnerId: me };
store.saveClient({ ...item.ref, nextAction: "", nextActionDate: "", notesHistory: [...(item.ref.notesHistory || []), noteEntry] });
} else if (item.kind === "referral") {
store.saveReferral({ ...item.ref, nextAction: "", nextActionDate: "" });
}
};

const Group = ({ title, rows, tone }) =>
rows.length > 0 && (
<section className="stage-group">
<div className={`stage-head ${tone ? `stage-head-${tone}` : ""}`}>
<span>{title}</span>
<span className="stage-count">{rows.length}</span>
</div>
<div className="card-list">
{rows.map((item) => {
const owner = item.ownerId ? store.partners.find((p) => p.id === item.ownerId) : null;
return (
<ReminderCard
key={`${item.kind}-${item.id}`}
item={item}
ownerName={owner?.name}
kindLabel={KIND_LABEL[item.kind]}
onOpen={() => openFor(item)}
onMarkDone={() => markDone(item)}
/>
);
})}
</div>
</section>
);

return (
<main className="content">
<p className="section-intro">
Every open next action — across prospects, clients, tenders, and referral partners — gathered in one place. This is the 8:00 pipeline review from the playbook.
</p>
{withDiff.length === 0 && <p className="empty">Nothing due. Add a next action date to any prospect, client, tender, or referral partner to see it here.</p>}
<Group title="Overdue" rows={overdue} tone="red" />
<Group title="Due today" rows={today} tone="amber" />
<Group title="This week" rows={week} />
<Group title="Later" rows={later} />
</main>
);
}

function AddPartner({ onAdd }) {
const [open, setOpen] = useState(false);
const [name, setName] = useState("");
const [identity, setIdentity] = useState("");
if (!open) {
return <button className="link-btn" onClick={() => setOpen(true)}>+ Add a partner not listed</button>;
}
return (
<div className="add-partner">
<input placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
<input placeholder="Market identity, e.g. Employment & Pensions" value={identity} onChange={(e) => setIdentity(e.target.value)} />
<button
className="btn btn-primary"
onClick={() => {
if (!name.trim()) return;
onAdd({ name, identity });
setName(""); setIdentity(""); setOpen(false);
}}
>
Add partner
</button>
</div>
);
}

function LogActivityModal({ activityType, store, me, onClose }) {
const [query, setQuery] = useState("");
const [firmName, setFirmName] = useState("");
const [firmIndustry, setFirmIndustry] = useState("");
const isForeignFirm = activityType.key === "foreign_firm";
const source = activityType.source;

let options = [];
if (source === "prospects") {
options = store.prospects.map((p) => ({ id: p.id, label: p.organization, tag: "Prospect" }));
} else if (source === "clients") {
options = store.clients.map((c) => ({ id: c.id, label: c.name, tag: "Client" }));
} else if (source === "referrals") {
options = store.referrals.map((r) => ({ id: r.id, label: r.name, tag: "Referral" }));
} else if (source === "tenders") {
options = store.tenders.map((t) => ({ id: t.id, label: t.title, tag: "Tender" }));
} else if (source === "prospects_clients") {
options = [
...store.prospects.map((p) => ({ id: p.id, label: p.organization, tag: "Prospect" })),
...store.clients.map((c) => ({ id: c.id, label: c.name, tag: "Client" })),
];
}
const q = query.trim().toLowerCase();
const filtered = (q ? options.filter((o) => (o.label || "").toLowerCase().includes(q)) : options).slice(0, 6);

const foreignFirmSubject = () => {
const name = firmName.trim();
const industry = firmIndustry.trim();
if (name && industry) return `${name} — ${industry}`;
return name || industry;
};

const submit = (label) => {
const subject = isForeignFirm ? foreignFirmSubject() : (label ?? query).trim();
store.logActivity(me, activityType.key, subject);
onClose();
};

const sourceLabel = { prospects: "prospects", clients: "clients", referrals: "referral partners", tenders: "tenders", prospects_clients: "prospects & clients" }[source];

return (
<div className="overlay" onClick={onClose}>
<div className="sheet" onClick={(e) => e.stopPropagation()}>
<div className="sheet-head">
<h3>Log: {activityType.label}</h3>
<button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
</div>
<div className="sheet-body">
{isForeignFirm ? (
<>
<Field label="Firm name">
<input autoFocus value={firmName} onChange={(e) => setFirmName(e.target.value)} placeholder="Clyde & Co" />
</Field>
<Field label="Industry">
<input value={firmIndustry} onChange={(e) => setFirmIndustry(e.target.value)} placeholder="Insurance / reinsurance" />
</Field>
</>
) : (
<>
<Field label={source ? `Search ${sourceLabel}, or type a new name` : "What is this about? (optional)"}>
<input
autoFocus
value={query}
onChange={(e) => setQuery(e.target.value)}
placeholder={source ? "Start typing..." : "e.g. topic, event name..."}
/>
</Field>
{source && filtered.length > 0 && (
<div className="suggest-list">
{filtered.map((o) => (
<button key={`${o.tag}-${o.id}`} className="suggest-row" onClick={() => submit(o.label)}>
<span>{o.label}</span>
<Pill tone="owner">{o.tag}</Pill>
</button>
))}
</div>
)}
{source && q && filtered.length === 0 && (
<p className="empty">No match in {sourceLabel} — you can still log it under "{query.trim()}".</p>
)}
</>
)}
</div>
<div className="sheet-actions">
<button className="btn btn-primary" onClick={() => submit()}>
{isForeignFirm
? (foreignFirmSubject() ? `Log "${foreignFirmSubject()}"` : "Log entry")
: (query.trim() ? `Log "${query.trim()}"` : "Log entry")}
</button>
</div>
</div>

</div>
);
}

function Scorecard({ store, me, myPartner, onAddAsProspect, onAddAsClient, onAddAsReferral, onAddAsTender }) {
const [scope, setScope] = useState("firm"); // firm | mine
const [logOpen, setLogOpen] = useState(null); // activity type object or null
const [expanded, setExpanded] = useState({});
const [viewMonth, setViewMonth] = useState(monthKey());
const isCurrentMonth = viewMonth === monthKey();
const mk = viewMonth;
const monthActivity = store.activity.filter((a) => monthKey(a.date) === mk && (scope === "firm" || a.partnerId === me));

const countOf = (type) => monthActivity.filter((a) => a.type === type).length;
const entriesOf = (type) => monthActivity.filter((a) => a.type === type).slice().reverse();

const monthProspects = store.prospects.filter(
(p) => (scope === "firm" || p.responsiblePartner === me)
);
const qualifiedThisMonth = monthProspects.filter((p) => reachedStageInMonth(p, "qualified", mk)).length;
const formalProposals = monthProspects.filter((p) => reachedStageInMonth(p, "proposal_submitted", mk)).length;
const pipelineValue = monthProspects
.filter((p) => !["won", "lost"].includes(p.status))
.reduce((a, p) => a + (Number(p.estimatedFee) || 0), 0);
const wonValue = monthProspects
.filter((p) => reachedStageInMonth(p, "won", mk))
.reduce((a, p) => a + (Number(p.estimatedFee) || 0), 0);

const nameSet = (arr, key) => new Set(arr.map((x) => (x[key] || "").trim().toLowerCase()));
const prospectNames = nameSet(store.prospects, "organization");
const clientNames = nameSet(store.clients, "name");
const referralNames = nameSet(store.referrals, "name");
const tenderNames = nameSet(store.tenders, "title");

// For a given activity source, which entity databases could this subject become?
const targetsFor = (source) => {
if (source === "prospects") return [{ label: "prospect", names: prospectNames, onAdd: onAddAsProspect }];
if (source === "clients") return [{ label: "client", names: clientNames, onAdd: onAddAsClient }];
if (source === "referrals") return [{ label: "referral partner", names: referralNames, onAdd: onAddAsReferral }];
if (source === "tenders") return [{ label: "tender", names: tenderNames, onAdd: onAddAsTender }];
if (source === "prospects_clients") {
return [
{ label: "prospect", names: prospectNames, onAdd: onAddAsProspect },
{ label: "client", names: clientNames, onAdd: onAddAsClient },
];
}
return [];
};

return (
<main className="content">
<div className="month-nav">
<button className="icon-btn" onClick={() => setViewMonth(shiftMonthKey(viewMonth, -1))} aria-label="Previous month">‹</button>
<span className="month-nav-label">{monthLabel(viewMonth)}</span>
<button
className="icon-btn"
onClick={() => setViewMonth(shiftMonthKey(viewMonth, 1))}
disabled={isCurrentMonth}
aria-label="Next month"
>
›
</button>
{!isCurrentMonth && (
<button className="mini-btn" onClick={() => setViewMonth(monthKey())}>Back to current</button>
)}
</div>

<div className="filter-row">
<div className="seg">
<button className={scope === "firm" ? "seg-active" : ""} onClick={() => setScope("firm")}>Whole firm</button>
<button className={scope === "mine" ? "seg-active" : ""} onClick={() => setScope("mine")}>{myPartner?.name || "Mine"}</button>
</div>
</div>

<section className="stat-grid">
<div className="stat">
<span className="stat-value">{fmtKES(pipelineValue)}</span>
<span className="stat-label">Live pipeline value{!isCurrentMonth ? " (current, not historical)" : ""}</span>
</div>
<div className="stat">
<span className="stat-value">{fmtKES(wonValue)}</span>
<span className="stat-label">Won in {monthLabel(viewMonth)}</span>
</div>
<div className="stat">
<span className="stat-value">{qualifiedThisMonth}</span>
<span className="stat-label">New qualified opportunities</span>
</div>
<div className="stat">
<span className="stat-value">{formalProposals}</span>
<span className="stat-label">Formal proposals / quotes</span>
</div>
</section>

{isCurrentMonth ? (
<p className="section-intro">Log today's touches as you make them — this is the Section 16 monthly scorecard, tallied automatically. It resets itself every month; nothing to archive.</p>
) : (
<p className="section-intro">Viewing a past month, read-only — logging is always dated to today, so switch back to the current month to add entries.</p>
)}

<div className="activity-grid">
{ACTIVITY_TYPES.map((t) => {
const count = countOf(t.key);
const pct = Math.min(100, Math.round((count / t.target) * 100));
const entries = entriesOf(t.key);
return (
<div key={t.key} className="activity-row">
<div className="activity-top">
<span>{t.label}</span>
<span className="activity-count">{count} / {t.target}</span>
</div>
<div className="bar"><div className="bar-fill" style={{ width: `${pct}%` }} /></div>
<div className="activity-actions">
{isCurrentMonth && <button className="chip-btn" onClick={() => setLogOpen(t)}>+ Log</button>}
{isCurrentMonth && <button className="chip-btn chip-ghost" onClick={() => store.undoActivity(t.key, me)}>Undo</button>}
{count > 0 && (
<button
className="chip-btn chip-ghost"
onClick={() => setExpanded({ ...expanded, [t.key]: !expanded[t.key] })}
>
{expanded[t.key] ? "Hide" : "View"} log
</button>
)}
</div>
{expanded[t.key] && (
<div className="history-list" style={{ marginTop: 10 }}>
{entries.map((a) => {
const who = store.partners.find((p) => p.id === a.partnerId);
const subject = (a.subject || "").trim();
const targets = subject ? targetsFor(t.source) : [];
return (
<div key={a.id} className="note-row">
<div className="note-text">{a.subject || "—"}</div>
<div className="history-meta">{a.date}{who ? ` · ${who.name}` : ""}</div>
{targets.map((tg) =>
tg.names.has(subject.toLowerCase()) ? (
<span key={tg.label} className="mini-tag">Already a {tg.label}</span>
) : (
<button key={tg.label} className="mini-btn" onClick={() => tg.onAdd(subject)}>
+ Add as {tg.label}
</button>
)
)}
</div>
);
})}
</div>
)}
</div>
);
})}
</div>

{logOpen && (
<LogActivityModal activityType={logOpen} store={store} me={me} onClose={() => setLogOpen(null)} />
)}
</main>
);
}

function Style() {
return (
<style>{`
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=DM+Sans:wght@400;500;600;700&display=swap');

:root{
--navy:#0B2A4A; --navy-2:#123A63; --gold:#C89B3C; --gold-2:#E4C878;
--red:#7A1F1F; --cream:#F7F4EE; --ink:#1B2430; --muted:#6B7684; --line:#E4DFD3;
--amber:#B7791F;
}
*{box-sizing:border-box;}
body,html,#root{height:100%; overflow-x:hidden;}
.app,.boot{
font-family:'DM Sans',sans-serif; background:var(--cream); color:var(--ink);
min-height:100vh; max-width:560px; margin:0 auto; position:relative; overflow-x:hidden;
}
.boot{ display:flex; flex-direction:column; align-items:center; justify-content:center; padding:32px 24px; text-align:center; gap:10px;}
.boot-mark{ font-family:'Playfair Display',serif; font-weight:700; font-size:15px; letter-spacing:0.3em; color:var(--gold); background:var(--navy); padding:10px 18px; border-radius:2px; }
.boot h1{ font-family:'Playfair Display',serif; font-size:26px; margin:6px 0 0; }
.muted{ color:var(--muted); margin:0; }
.who-list{ display:flex; flex-direction:column; gap:10px; width:100%; margin-top:8px; }
.who-btn{ text-align:left; background:#fff; border:1px solid var(--line); border-left:4px solid var(--navy); border-radius:6px; padding:12px 14px; display:flex; flex-direction:column; gap:2px; }
.who-name{ font-weight:700; }
.who-identity{ font-size:12.5px; color:var(--muted); }
.link-btn{ background:none; border:none; color:var(--navy-2); text-decoration:underline; font-size:13px; margin-top:6px; }
.add-partner{ display:flex; flex-direction:column; gap:8px; width:100%; margin-top:8px; }
.add-partner input{ padding:10px; border:1px solid var(--line); border-radius:6px; font-family:inherit; }
.fine{ font-size:11.5px; color:var(--muted); margin-top:18px; }

.topbar{ position:sticky; top:0; z-index:5; background:var(--navy); color:#fff; display:flex; align-items:center; justify-content:space-between; padding:14px 16px; }
.brand{ display:flex; align-items:baseline; gap:8px; }
.brand-mark{ font-family:'Playfair Display',serif; font-weight:700; letter-spacing:0.1em; color:var(--gold-2); }
.brand-sub{ font-size:12.5px; opacity:0.85; }
.me-chip{ background:rgba(255,255,255,0.12); border:1px solid rgba(255,255,255,0.25); color:#fff; border-radius:999px; padding:6px 12px; font-size:12.5px; }

.tabs{ display:flex; background:#fff; border-bottom:1px solid var(--line); position:sticky; top:52px; z-index:4; overflow-x:auto; -webkit-overflow-scrolling:touch; scrollbar-width:none; }
.tabs::-webkit-scrollbar{ display:none; }
.tab{ flex:0 0 auto; padding:12px 14px; background:none; border:none; font-size:13px; font-weight:600; color:var(--muted); border-bottom:2px solid transparent; white-space:nowrap; }
.tab-active{ color:var(--navy); border-bottom-color:var(--gold); }
.tab-badge{ display:inline-block; margin-left:5px; background:var(--red); color:#fff; font-size:10.5px; font-weight:700; padding:1px 6px; border-radius:999px; vertical-align:middle; }

.content{ padding:14px 14px 90px; }
.month-nav{ display:flex; align-items:center; gap:10px; margin-bottom:14px; }
.month-nav-label{ font-family:'Playfair Display',serif; font-weight:700; font-size:16px; color:var(--navy); flex:1; text-align:center; }
.month-nav .icon-btn{ font-size:20px; color:var(--navy); padding:2px 8px; }
.month-nav .icon-btn:disabled{ opacity:0.3; }
.filter-row{ display:flex; align-items:center; gap:10px; margin-bottom:12px; flex-wrap:wrap; }
.filter-row select{ padding:8px 10px; border:1px solid var(--line); border-radius:6px; background:#fff; font-family:inherit; font-size:13px; }
.overdue-banner{ background:#F7E3E3; color:var(--red); font-size:12px; font-weight:600; padding:5px 10px; border-radius:999px; }

.seg{ display:flex; border:1px solid var(--line); border-radius:8px; overflow:hidden; }
.seg button{ padding:8px 14px; background:#fff; border:none; font-size:13px; font-family:inherit; color:var(--muted); }
.seg-active{ background:var(--navy) !important; color:#fff !important; font-weight:600; }

.stage-group{ margin-bottom:10px; }
.stage-head{ width:100%; display:flex; justify-content:space-between; align-items:center; gap:8px; background:var(--navy); color:#fff; border:none; padding:10px 12px; border-radius:6px; font-size:13px; font-weight:600; }
.stage-head span:first-child{ min-width:0; overflow-wrap:break-word; }
.stage-head-red{ background:var(--red); }
.stage-head-amber{ background:var(--amber); }
.stage-count{ font-weight:500; opacity:0.85; font-size:12px; }
.card-list{ display:flex; flex-direction:column; gap:8px; margin-top:8px; }
.empty{ color:var(--muted); font-size:13px; padding:8px 2px; }

.card{ text-align:left; background:#fff; border:1px solid var(--line); border-radius:8px; padding:12px; display:flex; flex-direction:column; gap:8px; }
.card-top{ display:flex; justify-content:space-between; gap:8px; align-items:baseline; }
.org{ font-weight:700; font-size:14.5px; min-width:0; overflow-wrap:break-word; }
.fee{ font-size:12.5px; color:var(--muted); white-space:nowrap; flex:0 0 auto; }
.rail{ display:flex; gap:3px; }
.dot{ height:5px; flex:1; background:var(--line); border-radius:3px; }
.dot-fill{ background:var(--gold); }
.dot-lost{ background:var(--red); }
.card-meta{ display:flex; gap:6px; flex-wrap:wrap; }
.pill{ font-size:11px; background:#F0EEE7; color:var(--ink); padding:3px 8px; border-radius:999px; }
.pill.owner{ background:#E7EEF5; color:var(--navy-2); }
.pill.prob{ background:#FBF1DC; color:var(--amber); }
.pill.score{ background:#E9F3EA; color:#2F6B33; }
.pill.score-low{ background:#F7E3E3; color:var(--red); }
.flags{ display:flex; gap:6px; }
.flag{ font-size:11px; font-weight:600; padding:3px 8px; border-radius:999px; }
.flag-red{ background:#F7E3E3; color:var(--red); }
.flag-amber{ background:#FBF1DC; color:var(--amber); }
.flag-soon{ background:#EAF0F6; color:var(--navy-2); }
.reminder-card{ cursor:pointer; }
.reminder-action{ font-size:13px; margin:0; color:var(--ink); }
.reminder-done{ align-self:flex-start; margin-top:2px; }

.fab{ position:fixed; bottom:20px; left:50%; transform:translateX(-50%); max-width:520px; width:calc(100% - 28px); background:var(--navy); color:#fff; border:none; padding:14px; border-radius:10px; font-weight:700; font-size:14px; box-shadow:0 8px 20px rgba(11,42,74,0.35); }

.section-intro{ font-size:13px; color:var(--muted); margin:0 0 12px; }

.overlay{ position:fixed; inset:0; background:rgba(11,20,32,0.5); display:flex; align-items:flex-end; z-index:20; overflow-x:hidden; }
.sheet{ background:#fff; width:100%; max-width:560px; margin:0 auto; border-radius:14px 14px 0 0; max-height:92vh; display:flex; flex-direction:column; overflow-x:hidden; }
.sheet-head{ display:flex; justify-content:space-between; align-items:center; gap:10px; padding:16px; border-bottom:1px solid var(--line); }
.sheet-head h3{ min-width:0; flex:1 1 auto; overflow-wrap:break-word; }
.icon-btn{ flex:0 0 auto; }
.sheet-head h3{ font-family:'Playfair Display',serif; margin:0; font-size:18px; }
.icon-btn{ background:none; border:none; font-size:16px; color:var(--muted); }
.sheet-body{ padding:14px 16px; overflow-y:auto; display:flex; flex-direction:column; gap:12px; }
.field{ display:flex; flex-direction:column; gap:4px; font-size:12.5px; color:var(--muted); font-weight:600; }
.field input, .field select, .field textarea{ font-family:inherit; font-size:14px; color:var(--ink); padding:9px 10px; border:1px solid var(--line); border-radius:6px; background:#fff; outline:none; }
.field input:focus, .field select:focus, .field textarea:focus{ border-color:var(--gold); box-shadow:0 0 0 3px rgba(200,155,60,0.18); }
.input-mic-row{ display:flex; gap:8px; align-items:center; }
.input-mic-row input, .input-mic-row textarea{ flex:1; min-width:0; }
.mic-btn{ flex:0 0 auto; width:36px; height:36px; border-radius:50%; border:1px solid var(--line); background:#fff; font-size:15px; display:flex; align-items:center; justify-content:center; color:var(--navy); }
.mic-btn-active{ background:var(--red); border-color:var(--red); color:#fff; animation:mic-pulse 1.1s ease-in-out infinite; }
@keyframes mic-pulse{ 0%,100%{ opacity:1; } 50%{ opacity:0.55; } }
.voice-error{ display:block; margin-top:6px; font-size:12px; color:var(--red); }
.voice-error-dark{ color:#F5B4B4; }

.voice-fill-trigger{ width:100%; background:var(--cream); border:1px dashed var(--gold); color:var(--navy); font-weight:700; font-size:13.5px; padding:11px; border-radius:8px; }
.voice-panel{ background:var(--navy); border-radius:12px; padding:16px; display:flex; flex-direction:column; gap:12px; }
.voice-panel-head{ display:flex; justify-content:space-between; align-items:center; gap:8px; }
.voice-panel-step{ color:var(--gold-2); font-size:11px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; }
.voice-panel .icon-btn{ color:rgba(255,255,255,0.75); }
.voice-panel-field{ display:flex; flex-direction:column; gap:8px; }
.voice-panel-label{ color:#fff; font-family:'Playfair Display',serif; font-size:17px; }
.voice-panel .input-mic-row{ gap:10px; }
.voice-panel .input-mic-row input{
background:#fff; height:46px; padding:0 14px; border-radius:23px; border:1px solid transparent;
font-size:14.5px; text-overflow:ellipsis; outline:none;
}
.voice-panel .input-mic-row input::placeholder{ color:var(--muted); opacity:0.75; }
.voice-panel .input-mic-row input:focus{ border-color:var(--gold); box-shadow:0 0 0 3px rgba(200,155,60,0.28); }
.voice-panel .mic-btn{ width:46px; height:46px; background:var(--gold); border-color:var(--gold); color:var(--navy); font-size:17px; }
.voice-panel .mic-btn-active{ background:var(--red); border-color:var(--red); color:#fff; }
.voice-panel-actions{ display:flex; gap:8px; }
.voice-panel-actions .chip-btn{ background:rgba(255,255,255,0.12); color:#fff; border:1px solid rgba(255,255,255,0.3); }
.voice-panel-actions .btn-primary{ background:var(--gold); color:var(--navy); flex:1; padding:10px; border-radius:8px; font-weight:700; }
.row2{ display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.sheet-actions{ display:flex; gap:10px; padding:14px 16px; border-top:1px solid var(--line); }
.btn{ flex:1; padding:12px; border-radius:8px; font-weight:700; font-size:14px; border:none; }
.btn-primary{ background:var(--navy); color:#fff; }
.btn-ghost{ background:#fff; border:1px solid var(--line); color:var(--ink); flex:0 0 auto; padding:12px 16px; }
.btn-danger{ color:var(--red); border-color:#EAD2D2; }

.stat-grid{ display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:16px; }
.stat{ background:#fff; border:1px solid var(--line); border-left:4px solid var(--gold); border-radius:8px; padding:12px; }
.stat-value{ display:block; font-family:'Playfair Display',serif; font-size:20px; font-weight:700; color:var(--navy); }
.stat-label{ font-size:11.5px; color:var(--muted); }

.vault{ background:#fff; border:1px solid var(--line); border-left:4px solid var(--navy); border-radius:8px; padding:12px; }
.vault-head{ display:flex; justify-content:space-between; align-items:center; gap:8px; font-weight:700; font-size:13.5px; }
.vault-head span:first-child{ min-width:0; overflow-wrap:break-word; }
.vault-grid{ display:grid; grid-template-columns:1fr 1fr; gap:8px; }
.vault-item{ display:flex; align-items:center; gap:7px; font-size:12.5px; padding:7px 8px; border:1px solid var(--line); border-radius:6px; background:var(--cream); }
.vault-item input{ accent-color:var(--navy); width:14px; height:14px; }
.vault-item-on{ background:#E9F3EA; border-color:#CBE3CD; color:#2F6B33; }

.score-block{ background:var(--cream); border:1px solid var(--line); border-radius:8px; padding:12px; display:flex; flex-direction:column; gap:12px; }
.score-row{ display:flex; flex-direction:column; gap:4px; }
.score-row-top{ display:flex; justify-content:space-between; font-size:13px; }
.score-row input[type="range"]{ width:100%; accent-color:var(--gold); }
.score-total{ font-family:'Playfair Display',serif; font-weight:700; color:#2F6B33; }
.score-total-low{ color:var(--red); }
.score-verdict{ font-size:12.5px; color:#2F6B33; background:#E9F3EA; padding:8px 10px; border-radius:6px; margin:0; }
.score-verdict-low{ color:var(--red); background:#F7E3E3; }

.history{ background:var(--cream); border:1px solid var(--line); border-radius:8px; padding:12px; }
.history-list{ display:flex; flex-direction:column; gap:10px; max-height:220px; overflow-y:auto; }
.history-row{ display:flex; gap:10px; align-items:flex-start; }
.history-dot{ width:7px; height:7px; border-radius:50%; background:var(--gold); margin-top:5px; flex:none; }
.history-dot-action{ background:#2F6B33; }
.note-row{ padding:8px 0; border-bottom:1px solid var(--line); }
.note-row:last-child{ border-bottom:none; }
.note-text{ font-size:13px; margin-bottom:2px; white-space:pre-wrap; }
.mini-btn{ margin-top:6px; background:none; border:1px solid var(--navy); color:var(--navy); font-size:11.5px; font-weight:700; padding:4px 9px; border-radius:999px; }
.mini-tag{ display:inline-block; margin-top:6px; font-size:11px; color:#2F6B33; background:#E9F3EA; padding:3px 8px; border-radius:999px; }
.suggest-list{ display:flex; flex-direction:column; gap:6px; max-height:240px; overflow-y:auto; }
.suggest-row{ display:flex; justify-content:space-between; align-items:center; background:var(--cream); border:1px solid var(--line); border-radius:6px; padding:9px 10px; font-size:13.5px; text-align:left; }
.muted-line{ color:var(--muted); }
.history-text{ display:flex; flex-direction:column; }
.history-stage{ font-size:13px; font-weight:600; }
.history-meta{ font-size:11.5px; color:var(--muted); }

.activity-grid{ display:flex; flex-direction:column; gap:12px; }
.activity-row{ background:#fff; border:1px solid var(--line); border-radius:8px; padding:10px 12px; }
.activity-top{ display:flex; justify-content:space-between; gap:8px; font-size:13px; margin-bottom:6px; }
.activity-top span:first-child{ min-width:0; overflow-wrap:break-word; }
.activity-count{ color:var(--muted); font-variant-numeric:tabular-nums; }
.bar{ height:5px; background:var(--line); border-radius:3px; overflow:hidden; margin-bottom:8px; }
.bar-fill{ height:100%; background:var(--gold); }
.activity-actions{ display:flex; gap:8px; }
.chip-btn{ background:var(--navy); color:#fff; border:none; padding:6px 12px; border-radius:999px; font-size:12px; font-weight:600; }
.chip-ghost{ background:#fff; color:var(--muted); border:1px solid var(--line); }
`}</style>
);
}
