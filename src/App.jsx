import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { supabase } from "./lib/supabaseClient";

/* ------------------------------------------------------------------ *
 *  Bideey — shared BD pipeline for law-firm teams
 *  Data model (all shared=true so every partner sees the same board):
 *    shared firm storage -> partners, prospects, referrals, activity,
 *    tenders, tender vault, clients, and settings
 * ------------------------------------------------------------------ */

/* ============================================================================
 * MULTI-TENANCY MIGRATION NOTES — read this before wiring in a real backend
 * ============================================================================
 * This artifact runs as a single-firm app on window.storage: one flat,
 * unauthenticated shared data space, no server-side access control. The
 * notes below mark what's already structured to make a future multi-tenant
 * rebuild easier, and — just as importantly — what is NOT solved here and
 * must not be mistaken for having been solved.
 *
 * 1. RECORD TAGGING (done, low-risk, no behavior change today):
 *    Every new partner/prospect/client/tender/referral/activity entry is
 *    stamped with the active firm id from the authenticated session (see the
 *    relevant save/add actions in useStorage). Supabase RLS scopes shared
 *    reads/writes by firm at the `firm_kv` table, so this client-side tag is
 *    descriptive and useful for exports/backfills rather than the security
 *    boundary.
 *
 * 2. FIRM-WIDE SETTINGS (not tagged the same way, different mechanism needed):
 *    Practice Areas, Sectors, Referral Types, Next Action Templates, Cost of
 *    BD, Monthly BD Targets are each a single shared config object, not an
 *    array of records — firmId-per-item doesn't apply. In a multi-tenant
 *    backend these need their own per-firm namespacing (e.g. a firm-scoped
 *    storage key or table row), not the tagging pattern used for records.
 *
 * 3. IDENTITY vs AUTHORIZATION (already a clean seam — preserve it):
 *    `me` (which partner you are) and `getPermissions(myPartner)` (what
 *    that role can do) are already separate concerns in this code. That
 *    split is exactly what a real login needs to plug into: replace how
 *    `me` gets set, and every downstream permission check keeps working
 *    unchanged. See the note at the `me` state declaration for specifics
 *    on what "who's picking this up" actually is today.
 *
 * 4. WHAT IS STILL UI-LEVEL ONLY:
 *    Partner/admin permissions below decide what the app displays once a user
 *    is inside an allowed firm. The hard cross-firm isolation lives in
 *    Supabase RLS; per-role write protection would need additional database
 *    policies if the client later requires adversarial role security inside a
 *    single firm.
 * ========================================================================= */
const DEFAULT_FIRM_ID = "kkn";
const DEMO_REMINDER_DELAY_MS = 24 * 60 * 60 * 1000;

const DEFAULT_PARTNERS = [
  { id: "p-gerald", name: "Gerald Kiti", identity: "Technology / AI / Cybersecurity + Strategic Relationships" },
  { id: "p-a", name: "Partner A", identity: "Corporate & M&A" },
  { id: "p-b", name: "Oscar Kariuki", identity: "Real Estate & Conveyancing" },
  { id: "p-c", name: "George Kimotho", identity: "Tax" },
  { id: "p-d", name: "Lorraine Ouma", identity: "Commercial Litigation" },
];
const DEMO_PARTNERS = [
  { id: "p-gerald", userId: "demo-user", email: "demo@bideey.com", name: "Demo Partner", identity: "Managing Partner", role: "partner", canExport: true },
  { id: "p-a", name: "Amina Kariuki", identity: "Corporate & Commercial", role: "partner", canExport: true },
  { id: "p-b", name: "Brian Otieno", identity: "Real Estate & Conveyancing", role: "partner" },
  { id: "p-c", name: "Caroline Mwangi", identity: "Tax", role: "partner" },
  { id: "p-d", name: "David Njoroge", identity: "Commercial Litigation", role: "partner" },
];

// Access levels. This is a UI-level gate, not a hard security boundary — window.storage has no
// server-side per-role permissions, so a restricted person could in principle still find the
// underlying data. For a trusted internal team this is the right tradeoff: it keeps performance
// figures out of the screens someone doesn't need, without pretending to be adversarial security.
// Adding a new access level later (e.g. a partial-access admin) is just a new key here — nothing
// else in the app needs to change, since every gate below checks a permission flag, not a role name.
const ROLE_LABELS = { partner: "Partner", admin: "Office Admin" };
const ROLE_HELP = {
  partner: "Full access — pipeline, tenders, clients, referrals, Scorecard, and Insights.",
  admin: "Adds and updates records — clients, tenders, prospects, referrals — without seeing money, performance figures, or partner-by-partner views. Can't filter by partner either.",
};
const ROLE_PERMISSIONS = {
  partner: { seeInsights: true, seeScorecardByPartner: true, seeAmounts: true, seeMetrics: true, usePartnerFilters: true, manageRoles: true },
  admin: { seeInsights: false, seeScorecardByPartner: false, seeAmounts: false, seeMetrics: false, usePartnerFilters: false, manageRoles: false },
};
const getPermissions = (partner) => ROLE_PERMISSIONS[partner?.role] || ROLE_PERMISSIONS.partner;
const membershipRoleToAppRole = (role) => (role === "member" ? "admin" : "partner");
const displayNameFromSession = (session) => {
  const metadata = session?.user?.user_metadata || {};
  const fromMetadata = metadata.full_name || metadata.name;
  if (fromMetadata) return fromMetadata;

  const email = session?.user?.email || "";
  if (!email) return "Bideey user";
  return email
    .split("@")[0]
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
};

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

const DEFAULT_PRACTICES = [
  "Corporate & Commercial",
  "Real Estate & Conveyancing",
  "Tax",
  "Technology",
  "Commercial Litigation",
  "Other",
];

const DEFAULT_SECTORS = [
  "Financial Services & Banking",
  "Insurance",
  "Real Estate & Construction",
  "Manufacturing",
  "Technology & Fintech",
  "Energy & Mining",
  "Agriculture & Agribusiness",
  "Logistics & Transport",
  "Healthcare & Pharmaceuticals",
  "Hospitality & Tourism",
  "Telecommunications",
  "Retail & FMCG",
  "Other",
];

const DEFAULT_REFERRAL_TYPES = [
  "Accountant",
  "Auditor",
  "Real-estate agent",
  "Insurance broker",
  "Company secretary",
  "Banker",
  "Financial advisor",
  "Notary",
  "Business consultant",
  "Other",
];

// Resource People are deliberately kept outside the revenue-tracking model entirely — no stage, no
// fee, no responsible partner, nothing that could ever end up counted in Insights. They're a
// directory, not a pipeline: specialists to call when a brief lands outside the firm's own
// expertise, and execution support (clerks, registry contacts) who help get existing work done.
const RESOURCE_PEOPLE_CATEGORIES = ["Specialist Advisor", "Execution Support"];

// "Next action" suggestions have two layers, kept deliberately separate:
//  1. A curated starter list per record type, below — edited only when someone deliberately visits
//     Settings and changes it. Nothing ever gets written into this list automatically.
//  2. An organically learned layer (see learnedNextActions) that quietly reuses phrases already
//     typed on real records, the same way Occupation and Organization already work — but capped to
//     a length that's plausibly a reusable phrase, so a one-off bespoke paragraph about a specific
//     situation never becomes a suggestion, and never touches the curated list in #1 either way.
const NEXT_ACTION_TYPE_LABELS = { prospect: "Prospects", client: "Clients", tender: "Tenders", referral: "Referral Partners" };
const DEFAULT_NEXT_ACTION_TEMPLATES = {
  prospect: [
    "Send introductory email",
    "Call to introduce ourselves",
    "Set up a coffee meeting",
    "Schedule a discovery call",
    "Send capability statement",
    "Draft and send proposal",
    "Send fee proposal",
    "Follow up on proposal sent",
    "Revise proposal per feedback",
    "Follow up on fee negotiation",
    "Send engagement letter",
    "Confirm final terms",
  ],
  client: [
    "Check in — no contact in a while",
    "Send client alert / legal update",
    "Invite to firm event",
    "Send thank-you note",
    "Introduce to another partner for cross-sell",
    "Schedule quarterly check-in",
  ],
  tender: [
    "Review tender documents",
    "Decide bid/no-bid",
    "Assemble technical proposal team",
    "Submit tender documents",
    "Follow up on tender result",
    "Finalize technical proposal review",
  ],
  referral: [
    "Coffee to discuss pipeline",
    "Send thank-you note",
    "Introduce to relevant partner",
    "Check in — no contact in 30+ days",
    "Share recent win / case study",
  ],
};
const NEXT_ACTION_MAX_LEN = 60;
const learnedNextActions = (records) => {
  const seen = new Map();
  (records || []).forEach((r) => {
    const val = (r.nextAction || "").trim();
    if (!val || val.length > NEXT_ACTION_MAX_LEN) return;
    const key = val.toLowerCase();
    if (!seen.has(key)) seen.set(key, val);
  });
  return [...seen.values()];
};
const nextActionSuggestions = (templates, records) => {
  const seen = new Map();
  (templates || []).forEach((t) => {
    const key = (t || "").trim().toLowerCase();
    if (key && !seen.has(key)) seen.set(key, t.trim());
  });
  learnedNextActions(records).forEach((t) => {
    const key = t.toLowerCase();
    if (!seen.has(key)) seen.set(key, t);
  });
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
};

const STRENGTHS = ["Cold", "Warm", "Strong"];

const SOURCES = [
  "Referral",
  "Event",
  "Partner introduction",
  "Family / personal network",
  "LinkedIn / social media",
  "Existing client",
  "Repeat business",
  "Cold outreach",
  "Tender",
  "Foreign firm",
];
const CLIENT_TYPES = ["Institutional", "Individual"];
const PROBABILITIES = [10, 25, 50, 75, 90];

const ACTIVITY_TYPES = [
  { key: "org_researched", label: "Target org researched", target: 100, source: "prospects", defaultCost: 0 },
  { key: "outreach", label: "Quality direct outreach", target: 90, source: "prospects", defaultCost: 200 },
  { key: "existing_client", label: "Existing client contacted", target: 20, source: "clients", defaultCost: 500 },
  { key: "referral_contact", label: "Referral partner contacted", target: 15, source: "referrals", defaultCost: 500 },
  { key: "meeting", label: "Client / prospect meeting", target: 13, source: "prospects_clients", defaultCost: 2000 },
  { key: "event", label: "Event attended", target: 4, source: null, defaultCost: 5000 },
  { key: "linkedin_post", label: "LinkedIn post published", target: 12, source: null, defaultCost: 0 },
  { key: "client_alert", label: "Client alert / article", target: 2, source: "clients", defaultCost: 0 },
  { key: "foreign_firm", label: "Foreign firm approached", target: 17, source: null, defaultCost: 300 },
  { key: "tender_reviewed", label: "Tender / RFP reviewed", target: 15, source: "tenders", defaultCost: 0 },
  { key: "bid_submitted", label: "Serious bid submitted", target: 4, source: "tenders", defaultCost: 3000 },
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

// saveProspect (below, in useStorage) auto-creates a client the moment a prospect is saved as
// Won — but that only fires for prospects that actually pass through that action. Anything that
// sets the prospects/clients arrays directly (loading from storage, sample data, a future import)
// bypasses it entirely, which is exactly how a won prospect can end up with no matching client.
// This reconciles that after the fact: given a set of prospects and existing clients, it returns
// clients with a record added for any won prospect that doesn't already have one. It never edits
// or note-annotates an existing client (that note-on-repeat-win flourish belongs to the live,
// single-event path in saveProspect, not a bulk backfill) — it only ever adds what's missing.
function ensureClientsForWonProspects(prospects, clients, firmId = DEFAULT_FIRM_ID) {
  const result = [...(clients || [])];
  (prospects || [])
    .filter((p) => p.status === "won" && (p.organization || "").trim())
    .forEach((p) => {
      const orgKey = p.organization.trim().toLowerCase();
      const alreadyExists = result.some((c) => (c.name || "").trim().toLowerCase() === orgKey);
      if (alreadyExists) return;
      result.push({
        id: uid(),
        firmId: p.firmId || firmId,
        name: p.organization,
        sector: p.sector || "",
        clientType: p.clientType || CLIENT_TYPES[0],
        instructedOn: p.opportunity || "",
        potentialNeeds: "",
        responsiblePartner: p.responsiblePartner || "",
        origin: p.source || "",
        lastContact: todayISO(),
        nextAction: "",
        nextActionDate: "",
        notes: "",
        notesHistory: [],
      });
    });
  return result;
}

function loadScript(src, globalName) {
  return new Promise((resolve, reject) => {
    if (window[globalName]) {
      resolve(window[globalName]);
      return;
    }
    const existing = document.querySelector(`script[data-loader="${globalName}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(window[globalName]));
      existing.addEventListener("error", () => reject(new Error(`Failed to load ${globalName}`)));
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.dataset.loader = globalName;
    script.onload = () => resolve(window[globalName]);
    script.onerror = () => reject(new Error(`Failed to load ${globalName}`));
    document.head.appendChild(script);
  });
}

async function parseSpreadsheetFile(file) {
  const XLSX = await loadScript("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js", "XLSX");
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
}

async function parseDocxTable(file) {
  const mammoth = await loadScript("https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js", "mammoth");
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.convertToHtml({ arrayBuffer });
  const doc = new DOMParser().parseFromString(result.value, "text/html");
  const table = doc.querySelector("table");
  if (!table) return null;
  return [...table.querySelectorAll("tr")].map((tr) =>
    [...tr.querySelectorAll("td, th")].map((cell) => cell.textContent.trim())
  );
}

const csvEscape = (value) => {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const normalizeImportKey = (value) => (value || "").toString().trim().toLowerCase();
const splitListValue = (value) => value.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
const matchChoice = (value, choices, fallback = "") => {
  const found = choices.find((choice) => choice.toLowerCase() === value.trim().toLowerCase());
  return found || fallback;
};

const IMPORT_ENTITY_CONFIGS = {
  prospect: {
    title: "Import leads",
    label: "lead",
    labelPlural: "leads",
    nameKey: "organization",
    templateName: "bideey-leads-template.csv",
    sampleRows: [
      ["organization", "contact_person", "email", "phone", "sector", "practice_area", "opportunity", "source", "relationship_strength", "status", "next_action", "next_action_date", "estimated_value", "notes"],
      ["Acme Holdings", "Jane Mwangi", "jane@acme.co.ke", "+254700000000", "Financial Services & Banking", "Corporate & Commercial", "Potential retainer", "Referral", "Warm", "Target", "Schedule intro call", todayISO(), "250000", "Met at banking forum"],
    ],
    fieldOptions: [
      { key: "", label: "Don't import this column" },
      { key: "organization", label: "Organization / lead name" },
      { key: "contact", label: "Contact person" },
      { key: "contactEmail", label: "Email" },
      { key: "contactPhone", label: "Phone" },
      { key: "sector", label: "Sector" },
      { key: "practiceArea", label: "Practice area" },
      { key: "opportunity", label: "Opportunity" },
      { key: "source", label: "Source" },
      { key: "strength", label: "Relationship strength" },
      { key: "status", label: "Pipeline status" },
      { key: "nextAction", label: "Next action" },
      { key: "nextActionDate", label: "Next action date" },
      { key: "estimatedValue", label: "Estimated value" },
      { key: "notes", label: "Notes" },
    ],
    guessMapping: (key) => {
      if (/organi[sz]ation|company|firm|lead|client|name/.test(key)) return "organization";
      if (/contact|person/.test(key) && !/phone|email/.test(key)) return "contact";
      if (/email/.test(key)) return "contactEmail";
      if (/phone|mobile|tel/.test(key)) return "contactPhone";
      if (/sector|industry/.test(key)) return "sector";
      if (/practice/.test(key)) return "practiceArea";
      if (/opportunity|matter|need/.test(key)) return "opportunity";
      if (/source|origin|via/.test(key)) return "source";
      if (/strength|relationship/.test(key)) return "strength";
      if (/status|stage/.test(key)) return "status";
      if (/next.*date|follow.*date/.test(key)) return "nextActionDate";
      if (/next|follow/.test(key)) return "nextAction";
      if (/value|amount|fee|estimate/.test(key)) return "estimatedValue";
      if (/note|comment/.test(key)) return "notes";
      return "";
    },
    buildDefaults: (me) => ({
      id: uid(),
      responsiblePartner: me,
      status: "target",
      strength: "Warm",
      source: "Import",
      probability: 25,
      estimatedValue: "",
      nextAction: "",
      nextActionDate: "",
      notes: "",
      notesHistory: [],
      statusHistory: [{ kind: "stage", stage: "target", date: todayISO() }],
      archived: false,
    }),
    applyField: (obj, key, value) => {
      if (key === "status") {
        const normalized = normalizeImportKey(value).replaceAll(" ", "_");
        const found = STAGES.find((s) => s.key === normalized || normalizeImportKey(s.label).replaceAll(" ", "_") === normalized);
        obj.status = found?.key || "target";
        obj.statusHistory = [{ kind: "stage", stage: obj.status, date: todayISO() }];
      } else if (key === "strength") {
        obj.strength = matchChoice(value, STRENGTHS, "Warm");
      } else if (key === "source") {
        obj.source = matchChoice(value, SOURCES, value || "Import");
      } else if (key === "estimatedValue") {
        obj.estimatedValue = value.replace(/[^0-9.]/g, "");
      } else {
        obj[key] = value;
      }
    },
  },
  client: {
    title: "Import clients",
    label: "client",
    labelPlural: "clients",
    nameKey: "name",
    templateName: "bideey-clients-template.csv",
    sampleRows: [
      ["name", "contact_person", "position", "sector", "phone", "email", "instructed_on", "possible_need", "origin", "last_contact", "next_action", "next_action_date", "notes"],
      ["Acme Holdings", "Jane Mwangi", "Legal Counsel", "Financial Services & Banking", "+254700000000", "jane@acme.co.ke", "Corporate advisory", "Employment review", "Referral", todayISO(), "Schedule review meeting", todayISO(), "Existing client"],
    ],
    fieldOptions: [
      { key: "", label: "Don't import this column" },
      { key: "name", label: "Client / organization name" },
      { key: "contact", label: "Contact person" },
      { key: "position", label: "Position" },
      { key: "sector", label: "Sector" },
      { key: "contactPhone", label: "Phone" },
      { key: "contactEmail", label: "Email" },
      { key: "instructedOn", label: "What they instructed us on" },
      { key: "potentialNeeds", label: "What else they probably need" },
      { key: "origin", label: "Origin" },
      { key: "lastContact", label: "Last contact" },
      { key: "nextAction", label: "Next action" },
      { key: "nextActionDate", label: "Next action date" },
      { key: "notes", label: "Notes" },
    ],
    guessMapping: (key) => {
      if (/name|client|organi[sz]ation|company/.test(key)) return "name";
      if (/contact|person/.test(key) && !/phone|email/.test(key)) return "contact";
      if (/position|title|role/.test(key)) return "position";
      if (/sector|industry/.test(key)) return "sector";
      if (/phone|mobile|tel/.test(key)) return "contactPhone";
      if (/email/.test(key)) return "contactEmail";
      if (/instruct/.test(key)) return "instructedOn";
      if (/need|opportunity/.test(key)) return "potentialNeeds";
      if (/origin|source|via/.test(key)) return "origin";
      if (/last.*contact/.test(key)) return "lastContact";
      if (/next.*date|follow.*date/.test(key)) return "nextActionDate";
      if (/next|follow/.test(key)) return "nextAction";
      if (/note|comment/.test(key)) return "notes";
      return "";
    },
    buildDefaults: (me) => ({
      id: uid(),
      clientType: "Institutional",
      origin: "Import",
      responsiblePartner: me,
      lastContact: todayISO(),
      nextAction: "",
      nextActionDate: "",
      notes: "",
      notesHistory: [],
      hasRetainer: false,
      retainerAmount: "",
      retainerFrequency: "Monthly",
      retainerRenewalDate: "",
    }),
    applyField: (obj, key, value) => { obj[key] = value; },
  },
  referral: {
    title: "Import referral partners",
    label: "referral partner",
    labelPlural: "referral partners",
    nameKey: "name",
    templateName: "bideey-referral-partners-template.csv",
    sampleRows: [
      ["name", "institution", "type", "practice_fed", "phone", "email", "last_contact", "next_action", "next_action_date", "notes"],
      ["John Kamau", "Kamau Tax Advisory", "Accountant", "Corporate & Commercial, Tax", "+254711000000", "john@example.com", todayISO(), "Coffee catch-up", todayISO(), "Good tax referral contact"],
    ],
    fieldOptions: [
      { key: "", label: "Don't import this column" },
      { key: "name", label: "Name" },
      { key: "institution", label: "Affiliated organization / institution" },
      { key: "type", label: "Type" },
      { key: "practiceFed", label: "Practice fed (comma-separated)" },
      { key: "phone", label: "Phone" },
      { key: "email", label: "Email" },
      { key: "lastContact", label: "Last contact" },
      { key: "nextAction", label: "Next action" },
      { key: "nextActionDate", label: "Next action date" },
      { key: "notes", label: "Notes" },
    ],
    guessMapping: (key) => {
      if (/name/.test(key)) return "name";
      if (/institution|organi[sz]ation|firm|company/.test(key)) return "institution";
      if (/type|profession|role/.test(key)) return "type";
      if (/practice/.test(key)) return "practiceFed";
      if (/phone|mobile|tel/.test(key)) return "phone";
      if (/email/.test(key)) return "email";
      if (/last.*contact/.test(key)) return "lastContact";
      if (/next.*date|follow.*date/.test(key)) return "nextActionDate";
      if (/next|follow/.test(key)) return "nextAction";
      if (/note|comment/.test(key)) return "notes";
      return "";
    },
    buildDefaults: (me) => ({ id: uid(), responsiblePartner: me, practiceFed: [], lastContact: todayISO(), nextAction: "", nextActionDate: "", notes: "", notesHistory: [] }),
    applyField: (obj, key, value) => {
      if (key === "practiceFed") obj.practiceFed = splitListValue(value);
      else obj[key] = value;
    },
  },
  resource: {
    title: "Import resource people",
    label: "resource person",
    labelPlural: "resource people",
    nameKey: "name",
    templateName: "bideey-resource-people-template.csv",
    sampleRows: [
      ["name", "category", "institution", "useful_for", "phone", "email", "notes"],
      ["Amina Otieno", "Specialist Advisor", "Independent", "Competition law opinions", "+254722000000", "amina@example.com", "Useful external specialist"],
    ],
    fieldOptions: [
      { key: "", label: "Don't import this column" },
      { key: "name", label: "Name" },
      { key: "category", label: "Category" },
      { key: "institution", label: "Institution" },
      { key: "usefulFor", label: "What they're useful for" },
      { key: "phone", label: "Phone" },
      { key: "email", label: "Email" },
      { key: "notes", label: "Notes" },
    ],
    guessMapping: (key) => {
      if (/name/.test(key)) return "name";
      if (/categ/.test(key)) return "category";
      if (/institution|organi[sz]ation|firm|company/.test(key)) return "institution";
      if (/useful|expert|specialt|notes/.test(key)) return "usefulFor";
      if (/phone|mobile|tel/.test(key)) return "phone";
      if (/email/.test(key)) return "email";
      return "";
    },
    buildDefaults: () => ({ id: uid(), category: RESOURCE_PEOPLE_CATEGORIES[0], notesHistory: [] }),
    applyField: (obj, key, value) => {
      if (key === "category") obj.category = matchChoice(value, RESOURCE_PEOPLE_CATEGORIES, RESOURCE_PEOPLE_CATEGORIES[0]);
      else obj[key] = value;
    },
  },
};

const joinNotes = (r) => (r.notesHistory || []).map((n) => `${n.date}: ${n.text}`).join(" | ");
const resolvePartnerName = (r, store) => store.partners.find((p) => p.id === r.responsiblePartner)?.name || "";
const EXPORT_ENTITY_CONFIGS = {
  prospect: {
    filename: () => `bideey-leads-${todayISO()}.xlsx`,
    rows: (store) => store.prospects,
    columns: [
      { key: "organization", label: "Organization / lead" },
      { key: "contact", label: "Contact" },
      { key: "contactEmail", label: "Email" },
      { key: "contactPhone", label: "Phone" },
      { key: "sector", label: "Sector" },
      { key: "practiceArea", label: "Practice area" },
      { key: "opportunity", label: "Opportunity" },
      { key: "source", label: "Source" },
      { key: "strength", label: "Relationship strength" },
      { key: "status", label: "Status" },
      { key: "responsiblePartner", label: "Responsible partner", resolve: resolvePartnerName },
      { key: "estimatedValue", label: "Estimated value" },
      { key: "nextAction", label: "Next action" },
      { key: "nextActionDate", label: "Next action date" },
      { key: "notesHistory", label: "Notes", resolve: joinNotes },
    ],
  },
  client: {
    filename: () => `bideey-clients-${todayISO()}.xlsx`,
    rows: (store) => store.clients,
    columns: [
      { key: "name", label: "Name" },
      { key: "clientType", label: "Client type" },
      { key: "contact", label: "Contact" },
      { key: "position", label: "Position" },
      { key: "sector", label: "Sector" },
      { key: "contactPhone", label: "Phone" },
      { key: "contactEmail", label: "Email" },
      { key: "instructedOn", label: "Instructed on" },
      { key: "potentialNeeds", label: "Possible need" },
      { key: "responsiblePartner", label: "Responsible partner", resolve: resolvePartnerName },
      { key: "origin", label: "Origin" },
      { key: "lastContact", label: "Last contact" },
      { key: "nextAction", label: "Next action" },
      { key: "nextActionDate", label: "Next action date" },
      { key: "notesHistory", label: "Notes", resolve: joinNotes },
    ],
  },
  referral: {
    filename: () => `bideey-referral-partners-${todayISO()}.xlsx`,
    rows: (store) => store.referrals,
    columns: [
      { key: "name", label: "Name" },
      { key: "institution", label: "Institution" },
      { key: "type", label: "Type" },
      { key: "practiceFed", label: "Practice fed", resolve: (r) => (Array.isArray(r.practiceFed) ? r.practiceFed : [r.practiceFed].filter(Boolean)).join(", ") },
      { key: "responsiblePartner", label: "Responsible partner", resolve: resolvePartnerName },
      { key: "phone", label: "Phone" },
      { key: "email", label: "Email" },
      { key: "lastContact", label: "Last contact" },
      { key: "nextAction", label: "Next action" },
      { key: "nextActionDate", label: "Next action date" },
      { key: "notesHistory", label: "Notes", resolve: joinNotes },
    ],
  },
  resource: {
    filename: () => `bideey-resource-people-${todayISO()}.xlsx`,
    rows: (store) => store.resourcePeople,
    columns: [
      { key: "name", label: "Name" },
      { key: "category", label: "Category" },
      { key: "institution", label: "Institution" },
      { key: "usefulFor", label: "What they're useful for" },
      { key: "phone", label: "Phone" },
      { key: "email", label: "Email" },
      { key: "notesHistory", label: "Notes", resolve: joinNotes },
    ],
  },
};

async function exportEntityToXlsx(entityType, store) {
  const config = EXPORT_ENTITY_CONFIGS[entityType];
  const XLSX = await loadScript("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js", "XLSX");
  const data = config.rows(store).map((r) => {
    const obj = {};
    config.columns.forEach((col) => {
      obj[col.label] = col.resolve ? col.resolve(r, store) : (r[col.key] ?? "");
    });
    return obj;
  });
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  XLSX.writeFile(wb, config.filename());
}

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
// Did a prospect ever reach a given stage, at any point (ignores which month) — used for
// funnel counts and win-rate, where a since-lost deal should still count toward stages it passed through.
const everReachedStage = (p, stageKey) => {
  const hist = p.statusHistory || [];
  if (hist.some((h) => h.kind === "stage" && h.stage === stageKey)) return true;
  return hist.length === 0 && p.status === stageKey;
};
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
const addDays = (dateStr, n) => {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
// A retainer renewal is recurring, not a one-off — marking it done should push the date forward by
// the retainer's own cycle (a month or a year out), not just clear it into nothing.
const advanceRetainerDate = (dateStr, frequency) => {
  const d = new Date(dateStr + "T00:00:00");
  if (frequency === "Annual") d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
};
// Builds a standard Sun–Sat month grid for a given "YYYY-MM" — null cells pad the leading and
// trailing days outside the month so the grid always lines up in full weeks.
const buildMonthGrid = (mk) => {
  const [y, m] = mk.split("-").map(Number);
  const startWeekday = new Date(y, m - 1, 1).getDay();
  const daysInMonth = new Date(y, m, 0).getDate();
  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
};
const fmtKES = (n) => (n ? `KES ${Number(n).toLocaleString()}` : "—");
// Same formatting as fmtKES, but for figures where zero is a genuine, meaningful answer (nothing
// collected yet, nothing outstanding) rather than an empty/unset field — those should read as
// "KES 0", not fmtKES's "—", which would wrongly look like missing data instead of a real zero.
const fmtKESExact = (n) => `KES ${Number(n || 0).toLocaleString()}`;
// A small "vs last month" indicator for Scorecard's monthly-flow numbers (Won, qualified
// opportunities, proposals sent, spend) — deliberately not applied to Live pipeline value, since
// that's a right-now snapshot rather than a monthly flow, and there's no historical snapshot to
// honestly compare it against.
function monthTrend(current, previous) {
  if (!previous && !current) return null;
  if (!previous) return { text: "New this month", tone: "up" };
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return { text: "Flat vs last month", tone: "flat" };
  return { text: `${pct > 0 ? "↑" : "↓"} ${Math.abs(pct)}% vs last month`, tone: pct > 0 ? "up" : "down" };
}
// A referral partner's name plus their affiliated organization, e.g. "Amina — KMP & Associates" —
// falls back to the bare name when no institution is set (including on older, pre-field records).
const referralDisplayName = (r) => (r?.institution?.trim() ? `${r.name} — ${r.institution.trim()}` : r?.name || "");

// Type-ahead suggestions for the free-text "Occupation / role" field on individual clients and
// prospects — deliberately not a fixed, Settings-managed list. Just reuses whatever's already been
// typed elsewhere, so common phrasing ("Business owner") gets reinforced without ever needing upkeep.
// De-dupes case-insensitively but keeps the casing of whichever version was typed first.
const individualOccupations = (clients, prospects) => {
  const seen = new Map(); // lowercase -> original casing
  [...(clients || []), ...(prospects || [])].forEach((r) => {
    if (r.clientType !== "Individual") return;
    const val = (r.sector || "").trim();
    if (!val) return;
    const key = val.toLowerCase();
    if (!seen.has(key)) seen.set(key, val);
  });
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
};

// Type-ahead suggestions for the Position field on institutional contacts — "CFO", "Managing
// Director", "General Counsel" repeat constantly across completely unrelated organizations, so
// this is an even cleaner fit than Occupation: purely organic, no curated starter list needed,
// since job titles are inherently short and don't carry the "bespoke paragraph" risk Next Action
// has to guard against.
const positionSuggestions = (clients, prospects) => {
  const seen = new Map();
  [...(clients || []), ...(prospects || [])].forEach((r) => {
    const val = (r.position || "").trim();
    if (!val) return;
    const key = val.toLowerCase();
    if (!seen.has(key)) seen.set(key, val);
  });
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
};

// Type-ahead suggestions for the Organization/Client name field when adding a prospect. Clients
// are checked first so their name's casing wins if a prospect elsewhere typed it differently —
// picking the suggested name (rather than retyping) is what keeps clientValue's name-matching
// accurate for repeat matters, since that match is a case-insensitive string comparison.
const organizationSuggestions = (clients, prospects) => {
  const seen = new Map();
  (clients || []).forEach((c) => {
    const val = (c.name || "").trim();
    if (!val) return;
    const key = val.toLowerCase();
    if (!seen.has(key)) seen.set(key, val);
  });
  (prospects || []).forEach((p) => {
    const val = (p.organization || "").trim();
    if (!val) return;
    const key = val.toLowerCase();
    if (!seen.has(key)) seen.set(key, val);
  });
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
};

// A realistic, cross-referenced dataset spanning the whole app — for exploring the product
// without hand-entering everything first. Dates are relative to "today" so it always looks current.
function buildSampleData() {
  const [P_GERALD, P_A, P_B, P_C, P_D] = ["p-gerald", "p-a", "p-b", "p-c", "p-d"];
  const today = new Date();
  const iso = (daysAgo) => {
    const d = new Date(today);
    d.setDate(d.getDate() - daysAgo);
    return d.toISOString().slice(0, 10);
  };
  const isoFuture = (daysAhead) => iso(-daysAhead);
  const stageHist = (entries) => entries.map(([stage, daysAgo, partnerId]) => ({ kind: "stage", stage, date: iso(daysAgo), partnerId }));

  const referrals = [
    { id: "r1", name: "Amina Hassan — Senior Auditor, KMP & Associates", type: "Auditor", practiceFed: ["Tax"], responsiblePartner: P_C, lastContact: iso(14), nextAction: "Send Q3 tax alert", nextActionDate: isoFuture(5), notes: "" },
    { id: "r2", name: "David Mwangi — Real Estate Agent, Knight Frank", type: "Real-estate agent", practiceFed: ["Real Estate & Conveyancing"], responsiblePartner: P_B, lastContact: iso(41), nextAction: "Coffee to discuss new listings", nextActionDate: iso(21), notes: "" },
    { id: "r3", name: "Grace Wambui — Company Secretary, Corporate Sec Ltd", type: "Company secretary", practiceFed: ["Corporate & Commercial"], responsiblePartner: P_A, lastContact: iso(5), nextAction: "Introduce to Partner A re: governance mandate", nextActionDate: isoFuture(3), notes: "" },
    { id: "r4", name: "Peter Otieno — Insurance Broker, AON Kenya", type: "Insurance broker", practiceFed: ["Commercial Litigation", "Corporate & Commercial"], responsiblePartner: P_D, lastContact: iso(56), nextAction: "", nextActionDate: "", notes: "" },
  ];

  const clients = [
    { id: "c1", name: "Savannah Properties Ltd", sector: "Real estate", instructedOn: "Title due diligence for Karen development", potentialNeeds: "Succession planning, tax structuring", responsiblePartner: P_B, lastContact: iso(10), nextAction: "Check in on succession planning brief", nextActionDate: isoFuture(4), notes: "", notesHistory: [{ text: "Long-standing client since 2019, very responsive", date: iso(75), partnerId: P_B }] },
    { id: "c2", name: "PesaLink Technologies", sector: "Fintech", instructedOn: "Data protection compliance audit", potentialNeeds: "AI governance readiness, contract review", responsiblePartner: P_GERALD, lastContact: iso(3), nextAction: "Send AI Governance Readiness Review proposal", nextActionDate: isoFuture(1), notes: "", notesHistory: [] },
    { id: "c3", name: "Rift Valley Manufacturers Ltd", sector: "Manufacturing", instructedOn: "KRA customs assessment objection", potentialNeeds: "Corporate restructuring", responsiblePartner: P_C, lastContact: iso(45), nextAction: "", nextActionDate: "", notes: "", notesHistory: [] },
    { id: "c4", name: "Coastline Logistics", sector: "Logistics", instructedOn: "Employment dispute defense", potentialNeeds: "Commercial contracts review", responsiblePartner: P_D, lastContact: iso(1), nextAction: "Follow up on settlement terms", nextActionDate: iso(0), notes: "", notesHistory: [] },
  ];

  const tenders = [
    {
      id: "t1", title: "Nairobi City County — Legal Services Panel", procuringEntity: "Nairobi City County", deadline: isoFuture(26), estimatedValue: 3500000,
      responsiblePartner: P_A, stage: "partner_review", nextAction: "Finalize technical proposal review", nextActionDate: isoFuture(7),
      scores: { relationship: 18, practiceFit: 18, eligibility: 14, pastExperience: 13, commercialAttractiveness: 9, competitivePosition: 8, strategicValue: 9 },
      result: "", notes: "", notesHistory: [{ text: "Strong existing relationship with procurement office", date: iso(30), partnerId: P_A }],
      stageHistory: stageHist([["opportunity", 40, P_A], ["qualification", 35, P_A], ["documents", 25, P_A], ["technical", 12, P_A], ["partner_review", 3, P_A]]),
    },
    {
      id: "t2", title: "Parastatal Legal Retainer 2027", procuringEntity: "State Corporation X", deadline: isoFuture(47), estimatedValue: 800000,
      responsiblePartner: P_C, stage: "qualification", nextAction: "Decide bid/no-bid", nextActionDate: isoFuture(2),
      scores: { relationship: 4, practiceFit: 8, eligibility: 10, pastExperience: 5, commercialAttractiveness: 4, competitivePosition: 3, strategicValue: 2 },
      result: "", notes: "", notesHistory: [],
      stageHistory: stageHist([["opportunity", 6, P_C], ["qualification", 2, P_C]]),
    },
    {
      id: "t3", title: "Regional Bank Legal Panel", procuringEntity: "Equity Bank Foundation", deadline: isoFuture(10), estimatedValue: 2200000,
      responsiblePartner: P_GERALD, stage: "submission", nextAction: "Submit final bid documents", nextActionDate: isoFuture(9),
      scores: { relationship: 14, practiceFit: 16, eligibility: 12, pastExperience: 11, commercialAttractiveness: 7, competitivePosition: 6, strategicValue: 7 },
      result: "", notes: "", notesHistory: [],
      stageHistory: stageHist([["opportunity", 22, P_GERALD], ["qualification", 20, P_GERALD], ["documents", 15, P_GERALD], ["technical", 10, P_GERALD], ["financial", 6, P_GERALD], ["submission", 1, P_GERALD]]),
    },
    {
      id: "t4", title: "County Government Compliance Advisory", procuringEntity: "Mombasa County", deadline: iso(61), estimatedValue: 1500000,
      responsiblePartner: P_B, stage: "result", nextAction: "", nextActionDate: "",
      scores: { relationship: 16, practiceFit: 17, eligibility: 13, pastExperience: 12, commercialAttractiveness: 8, competitivePosition: 7, strategicValue: 8 },
      result: "Won — strongest technical score of three bidders", notes: "", notesHistory: [],
      stageHistory: stageHist([["opportunity", 90, P_B], ["qualification", 85, P_B], ["documents", 78, P_B], ["technical", 70, P_B], ["financial", 68, P_B], ["partner_review", 65, P_B], ["submission", 63, P_B], ["follow_up", 58, P_B], ["result", 55, P_B]]),
    },
  ];

  const vault = {
    firm_profile: true, incorporation: true, practising_certs: true, tax_compliance: true, cr12: true,
    partner_cvs: true, references: true, past_experience: true, certificates: false, prof_indemnity: true,
    client_letters: true, litigation_experience: false, deal_sheets: true, policies: false, standard_responses: true,
  };

  const prospects = [
    {
      id: "pr1", organization: "Zenith Sacco Ltd", contact: "James Kariuki", position: "CEO", sector: "SACCO",
      practiceArea: "Real Estate & Conveyancing", opportunity: "Property acquisition financing", estimatedFee: 1200000,
      source: "Referral", sourceDetailId: "r2", relationshipStrength: "Strong", lastContact: iso(20), nextAction: "", nextActionDate: "",
      responsiblePartner: P_B, probability: 100, status: "won", notes: "", notesHistory: [{ text: "Repeat client potential — SACCO has 3 more sites planned", date: iso(21), partnerId: P_B }],
      statusHistory: stageHist([["target", 95, P_B], ["contacted", 90, P_B], ["conversation", 85, P_B], ["qualified", 80, P_B], ["proposal_requested", 75, P_B], ["proposal_submitted", 70, P_B], ["negotiation", 60, P_B], ["won", 55, P_B]]),
    },
    {
      id: "pr2", organization: "Highland Coffee Exports", contact: "Susan Chebet", position: "Finance Director", sector: "Agribusiness export",
      practiceArea: "Corporate & Commercial", opportunity: "Investment structuring", estimatedFee: 900000,
      source: "Existing client", sourceDetailId: "c3", relationshipStrength: "Strong", lastContact: iso(35), nextAction: "", nextActionDate: "",
      responsiblePartner: P_A, probability: 100, status: "won", notes: "", notesHistory: [],
      statusHistory: stageHist([["target", 75, P_A], ["contacted", 70, P_A], ["conversation", 65, P_A], ["qualified", 60, P_A], ["proposal_requested", 55, P_A], ["proposal_submitted", 50, P_A], ["negotiation", 42, P_A], ["won", 38, P_A]]),
    },
    {
      id: "pr3", organization: "TechHub Innovation Center", contact: "Brian Otieno", position: "Founder", sector: "Startup incubator",
      practiceArea: "Technology", opportunity: "AI Governance Readiness Review", estimatedFee: 650000,
      source: "Partner introduction", sourceDetailId: P_GERALD, relationshipStrength: "Strong", lastContact: iso(2), nextAction: "", nextActionDate: "",
      responsiblePartner: P_GERALD, probability: 100, status: "won", notes: "", notesHistory: [{ text: "Great case study for The Guardrail", date: iso(2), partnerId: P_GERALD }],
      statusHistory: stageHist([["target", 40, P_GERALD], ["contacted", 35, P_GERALD], ["conversation", 28, P_GERALD], ["qualified", 22, P_GERALD], ["proposal_requested", 16, P_GERALD], ["proposal_submitted", 10, P_GERALD], ["negotiation", 5, P_GERALD], ["won", 2, P_GERALD]]),
    },
    {
      id: "pr4", organization: "Uwezo Microfinance", contact: "Nancy Adhiambo", position: "CFO", sector: "Microfinance",
      practiceArea: "Tax", opportunity: "KRA dispute response", estimatedFee: 400000,
      source: "Cold outreach", sourceDetailId: "", relationshipStrength: "Cold", lastContact: iso(50), nextAction: "", nextActionDate: "",
      responsiblePartner: P_C, probability: 0, status: "lost", notes: "", notesHistory: [{ text: "Went with a smaller local firm on price", date: iso(48), partnerId: P_C }],
      statusHistory: stageHist([["target", 70, P_C], ["contacted", 65, P_C], ["conversation", 60, P_C], ["qualified", 58, P_C], ["proposal_requested", 55, P_C], ["proposal_submitted", 52, P_C], ["lost", 48, P_C]]),
    },
    {
      id: "pr5", organization: "Baraka Freight Ltd", contact: "Tom Kiplagat", position: "Ops Director", sector: "Logistics",
      practiceArea: "Commercial Litigation", opportunity: "Contract breach dispute", estimatedFee: 550000,
      source: "Event", sourceDetailId: "", relationshipStrength: "Warm", lastContact: iso(65), nextAction: "", nextActionDate: "",
      responsiblePartner: P_D, probability: 0, status: "lost", notes: "", notesHistory: [],
      statusHistory: stageHist([["target", 80, P_D], ["contacted", 75, P_D], ["conversation", 70, P_D], ["qualified", 66, P_D], ["lost", 63, P_D]]),
    },
    {
      id: "pr6", organization: "Savanna Beverages Ltd", contact: "Linda Mutua", position: "General Counsel", sector: "FMCG",
      practiceArea: "Corporate & Commercial", opportunity: "M&A due diligence", estimatedFee: 2000000,
      source: "Foreign firm", sourceDetailId: "", relationshipStrength: "Strong", lastContact: iso(3), nextAction: "Send revised fee proposal", nextActionDate: isoFuture(1),
      responsiblePartner: P_A, probability: 75, status: "negotiation", notes: "", notesHistory: [{ text: "UK instructing firm — wants Kenyan counsel for the deal", date: iso(20), partnerId: P_A }],
      statusHistory: stageHist([["target", 25, P_A], ["contacted", 20, P_A], ["conversation", 16, P_A], ["qualified", 12, P_A], ["proposal_requested", 9, P_A], ["proposal_submitted", 6, P_A], ["negotiation", 3, P_A]]),
    },
    {
      id: "pr7", organization: "GreenGrid Energy", contact: "Faith Njeri", position: "Legal Manager", sector: "Renewable energy / Cleantech",
      practiceArea: "Technology", opportunity: "Regulatory & licensing advisory", estimatedFee: 1100000,
      source: "LinkedIn / social media", sourceDetailId: "", relationshipStrength: "Warm", lastContact: iso(8), nextAction: "Follow up on proposal", nextActionDate: iso(1),
      responsiblePartner: P_GERALD, probability: 50, status: "proposal_submitted", notes: "", notesHistory: [],
      statusHistory: stageHist([["target", 18, P_GERALD], ["contacted", 14, P_GERALD], ["conversation", 11, P_GERALD], ["qualified", 9, P_GERALD], ["proposal_requested", 7, P_GERALD], ["proposal_submitted", 5, P_GERALD]]),
    },
    {
      id: "pr8", organization: "Amani Insurance Group", contact: "Michael Wafula", position: "Head of Claims", sector: "Insurance",
      practiceArea: "Commercial Litigation", opportunity: "Policy dispute strategy", estimatedFee: 750000,
      source: "Referral", sourceDetailId: "r4", relationshipStrength: "Warm", lastContact: iso(2), nextAction: "Send proposal", nextActionDate: iso(0),
      responsiblePartner: P_D, probability: 25, status: "proposal_requested", notes: "", notesHistory: [],
      statusHistory: stageHist([["target", 12, P_D], ["contacted", 9, P_D], ["conversation", 6, P_D], ["qualified", 4, P_D], ["proposal_requested", 2, P_D]]),
    },
    {
      id: "pr9", organization: "Nyumbani Estates", contact: "Esther Kamau", position: "Development Manager", sector: "Real estate development",
      practiceArea: "Real Estate & Conveyancing", opportunity: "400-unit development conveyancing", estimatedFee: 1800000,
      source: "Tender", sourceDetailId: "t1", relationshipStrength: "Warm", lastContact: iso(5), nextAction: "Introduce conveyancing partner", nextActionDate: isoFuture(6),
      responsiblePartner: P_B, probability: 25, status: "qualified", notes: "", notesHistory: [],
      statusHistory: stageHist([["target", 15, P_B], ["contacted", 11, P_B], ["conversation", 8, P_B], ["qualified", 5, P_B]]),
    },
    {
      id: "pr10", organization: "Kilimo Fresh Produce", contact: "Josephine Wanjala", position: "CFO", sector: "Agriculture",
      practiceArea: "Tax", opportunity: "VAT restructuring advisory", estimatedFee: 300000,
      source: "Family / personal network", sourceDetailId: "", relationshipStrength: "Warm", lastContact: iso(4), nextAction: "Schedule call with CFO", nextActionDate: isoFuture(10),
      responsiblePartner: P_C, probability: 10, status: "conversation", notes: "", notesHistory: [],
      statusHistory: stageHist([["target", 9, P_C], ["contacted", 6, P_C], ["conversation", 4, P_C]]),
    },
    {
      id: "pr11", organization: "BluePeak Mining Corp", contact: "Robert Sang", position: "Legal Director", sector: "Mining",
      practiceArea: "Corporate & Commercial", opportunity: "Joint venture structuring", estimatedFee: 2500000,
      source: "Existing client", sourceDetailId: "c2", relationshipStrength: "Cold", lastContact: iso(6), nextAction: "Send capability statement", nextActionDate: isoFuture(15),
      responsiblePartner: P_A, probability: 10, status: "contacted", notes: "", notesHistory: [],
      statusHistory: stageHist([["target", 8, P_A], ["contacted", 6, P_A]]),
    },
    {
      id: "pr12", organization: "Serengeti Digital Bank", contact: "Catherine Njoroge", position: "CISO", sector: "Digital banking",
      practiceArea: "Technology", opportunity: "Cybersecurity & data protection review", estimatedFee: 1600000,
      source: "Other", sourceDetailId: "", relationshipStrength: "Cold", lastContact: iso(1), nextAction: "", nextActionDate: "",
      responsiblePartner: P_GERALD, probability: 10, status: "target", notes: "", notesHistory: [{ text: "Met at the Fintech Association mixer", date: iso(1), partnerId: P_GERALD }],
      statusHistory: stageHist([["target", 1, P_GERALD]]),
    },
  ];

  // Scorecard activity log — spread across the last three months, several partners, a mix of
  // linked subjects (so "Already a prospect/client" shows) and a couple of fresh ones (so
  // "+ Add as prospect" has something to demonstrate).
  const activity = [];
  let actId = 0;
  const logMany = (type, subjects, spreadDays, partnerIds) => {
    subjects.forEach((subject, i) => {
      actId += 1;
      const daysAgo = Math.round((i / Math.max(1, subjects.length - 1)) * spreadDays);
      activity.push({ id: `seed-act-${actId}`, partnerId: partnerIds[i % partnerIds.length], type, date: iso(daysAgo), subject });
    });
  };
  const ALL_PARTNERS = [P_GERALD, P_A, P_B, P_C, P_D];
  logMany("org_researched", [
    "Zenith Sacco Ltd", "Highland Coffee Exports", "TechHub Innovation Center", "Savanna Beverages Ltd",
    "GreenGrid Energy", "Amani Insurance Group", "Nyumbani Estates", "BluePeak Mining Corp",
    "Serengeti Digital Bank", "Baringo Textiles Ltd", "Coral Coast Hospitality", "Rift Basin Solar",
  ], 70, ALL_PARTNERS);
  logMany("outreach", [
    "Zenith Sacco Ltd", "Savanna Beverages Ltd", "GreenGrid Energy", "Amani Insurance Group", "Nyumbani Estates",
    "BluePeak Mining Corp", "Serengeti Digital Bank", "Baringo Textiles Ltd", "Coral Coast Hospitality",
  ], 55, ALL_PARTNERS);
  logMany("existing_client", ["Savannah Properties Ltd", "PesaLink Technologies", "Coastline Logistics", "Rift Valley Manufacturers Ltd"], 40, ALL_PARTNERS);
  logMany("referral_contact", ["Amina Hassan — Senior Auditor, KMP & Associates", "David Mwangi — Real Estate Agent, Knight Frank", "Grace Wambui — Company Secretary, Corporate Sec Ltd"], 35, ALL_PARTNERS);
  logMany("meeting", ["Savanna Beverages Ltd", "GreenGrid Energy", "Amani Insurance Group", "Savannah Properties Ltd", "PesaLink Technologies"], 30, ALL_PARTNERS);
  logMany("event", ["Fintech Association Mixer", "LSK Nairobi Legal Tech Week"], 45, ALL_PARTNERS);
  logMany("linkedin_post", ["AI Bill 2026 explainer", "KRA objection deadlines", "Diaspora legal desk launch", "M&A due diligence checklist", "Data protection audit tips"], 25, ALL_PARTNERS);
  logMany("client_alert", ["Q3 tax compliance bulletin", "Data protection amendment alert"], 20, ALL_PARTNERS);
  logMany("foreign_firm", ["Clyde & Co — London", "Bowmans — Johannesburg"], 60, ALL_PARTNERS);
  logMany("tender_reviewed", ["Nairobi City County — Legal Services Panel", "Parastatal Legal Retainer 2027", "Regional Bank Legal Panel", "County Government Compliance Advisory"], 50, ALL_PARTNERS);
  logMany("bid_submitted", ["County Government Compliance Advisory", "Regional Bank Legal Panel"], 30, ALL_PARTNERS);

  return { referrals, clients, tenders, vault, prospects, activity };
}

function useStorage(activeFirmId) {
  const [ready, setReady] = useState(false);
  const [partners, setPartners] = useState(DEFAULT_PARTNERS);
  const [prospects, setProspects] = useState([]);
  const [referrals, setReferrals] = useState([]);
  const [activity, setActivity] = useState([]);
  const [tenders, setTenders] = useState([]);
  const [vault, setVault] = useState({});
  const [clients, setClients] = useState([]);
  const [error, setError] = useState(null);
  // Personal (per-device) "have I opened this since it last changed" maps — power the update badges.
  const [seenProspects, setSeenProspects] = useState({});
  const [seenClients, setSeenClients] = useState({});
  const [seenReferrals, setSeenReferrals] = useState({});
  const [seenTenders, setSeenTenders] = useState({});
  const [seenActivityTypes, setSeenActivityTypes] = useState({});
  // Personal (per-device), keyed by partner id — names a partner is quietly cultivating before
  // they're ready to become a real, firm-visible Prospect. Never synced to the shared board.
  const [watchlist, setWatchlist] = useState({});
  // Firm-wide default cost per activity type (KES) — a settings table any partner can tune, applied
  // as the starting estimate when logging an activity, always overridable at the point of entry.
  const [activityCosts, setActivityCosts] = useState(
    Object.fromEntries(ACTIVITY_TYPES.map((t) => [t.key, t.defaultCost]))
  );
  // Firm-wide monthly activity targets — the Section 16 numbers, editable per firm appetite. Seeded
  // from ACTIVITY_TYPES' built-in defaults, same pattern as the cost table.
  const [activityTargets, setActivityTargets] = useState(
    Object.fromEntries(ACTIVITY_TYPES.map((t) => [t.key, t.target]))
  );
  // Firm-wide practice area list — editable in Settings, so a firm can add "Aviation" or "M&A"
  // without needing a code change.
  const [practices, setPractices] = useState(DEFAULT_PRACTICES);
  const [sectors, setSectors] = useState(DEFAULT_SECTORS);
  const [referralTypes, setReferralTypes] = useState(DEFAULT_REFERRAL_TYPES);
  const [nextActionTemplates, setNextActionTemplates] = useState(DEFAULT_NEXT_ACTION_TEMPLATES);
  const [resourcePeople, setResourcePeople] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const safe = async (key, fallback, shared = true) => {
          try {
            const r = await window.storage.get(key, shared);
            return r ? JSON.parse(r.value) : fallback;
          } catch {
            return fallback;
          }
        };
        const defaultCosts = Object.fromEntries(ACTIVITY_TYPES.map((t) => [t.key, t.defaultCost]));
        const defaultTargets = Object.fromEntries(ACTIVITY_TYPES.map((t) => [t.key, t.target]));
        const defaultPartners = activeFirmId === "demo" ? DEMO_PARTNERS : activeFirmId === DEFAULT_FIRM_ID ? DEFAULT_PARTNERS : [];
        const [pt, pr, rf, ac, td, vl, cl, sp, sc, sr, st, sat, wl, ct, pc, sx, rt, at, nat, rp] = await Promise.all([
          safe("kkn-partners", defaultPartners),
          safe("kkn-prospects", []),
          safe("kkn-referrals", []),
          safe("kkn-activity", []),
          safe("kkn-tenders", []),
          safe("kkn-tender-vault", {}),
          safe("kkn-clients", []),
          safe("seen-prospects", {}, false),
          safe("seen-clients", {}, false),
          safe("seen-referrals", {}, false),
          safe("seen-tenders", {}, false),
          safe("seen-activity-types", {}, false),
          safe("watchlist", {}, false),
          safe("kkn-activity-costs", defaultCosts),
          safe("kkn-practices", DEFAULT_PRACTICES),
          safe("kkn-sectors", DEFAULT_SECTORS),
          safe("kkn-referral-types", DEFAULT_REFERRAL_TYPES),
          safe("kkn-activity-targets", defaultTargets),
          safe("kkn-next-action-templates", DEFAULT_NEXT_ACTION_TEMPLATES),
          safe("kkn-resource-people", []),
        ]);
        setPartners(pt);
        setProspects(pr);
        setReferrals(rf);
        setActivity(ac);
        setTenders(td);
        setVault(vl);
        // Backfills any won prospect that's missing a matching client — covers historical data
        // saved before this rule existed, on top of the live path in saveProspect that already
        // handles it for every win going forward.
        const reconciledClients = ensureClientsForWonProspects(pr, cl, activeFirmId);
        setClients(reconciledClients);
        if (reconciledClients.length !== cl.length) persist("kkn-clients", reconciledClients);
        setSeenProspects(sp);
        setSeenClients(sc);
        setSeenReferrals(sr);
        setSeenTenders(st);
        setSeenActivityTypes(sat);
        setWatchlist(wl);
        // Merge over defaults so a newly added activity type always has a sane starting cost,
        // even if the saved table predates it.
        setActivityCosts({ ...defaultCosts, ...ct });
        setPractices(pc && pc.length > 0 ? pc : DEFAULT_PRACTICES);
        setSectors(sx && sx.length > 0 ? sx : DEFAULT_SECTORS);
        setReferralTypes(rt && rt.length > 0 ? rt : DEFAULT_REFERRAL_TYPES);
        setActivityTargets({ ...defaultTargets, ...at });
        setNextActionTemplates({ ...DEFAULT_NEXT_ACTION_TEMPLATES, ...nat });
        setResourcePeople(rp);
      } catch (e) {
        setError("Could not load shared data. You can keep working; changes may not save.");
      } finally {
        setReady(true);
      }
    })();
  }, [activeFirmId]);

  const persist = useCallback(async (key, value, shared = true) => {
    try {
      await window.storage.set(key, JSON.stringify(value), shared);
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
      seenProspects,
      seenClients,
      seenReferrals,
      seenTenders,
      seenActivityTypes,
      watchlist,
      markProspectSeen: (id, count) => {
        setSeenProspects((prev) => {
          const next = { ...prev, [id]: count };
          persist("seen-prospects", next, false);
          return next;
        });
      },
      markClientSeen: (id, count) => {
        setSeenClients((prev) => {
          const next = { ...prev, [id]: count };
          persist("seen-clients", next, false);
          return next;
        });
      },
      markReferralSeen: (id, count) => {
        setSeenReferrals((prev) => {
          const next = { ...prev, [id]: count };
          persist("seen-referrals", next, false);
          return next;
        });
      },
      markTenderSeen: (id, count) => {
        setSeenTenders((prev) => {
          const next = { ...prev, [id]: count };
          persist("seen-tenders", next, false);
          return next;
        });
      },
      markActivityTypeSeen: (type, count) => {
        setSeenActivityTypes((prev) => {
          const next = { ...prev, [type]: count };
          persist("seen-activity-types", next, false);
          return next;
        });
      },
      addWatchlistItem: (partnerId, organization, note, industry, checkBackDate) => {
        const item = { id: uid(), organization, industry: industry || "", note: note || "", checkBackDate: checkBackDate || "", date: todayISO() };
        setWatchlist((prev) => {
          const next = { ...prev, [partnerId]: [...(prev[partnerId] || []), item] };
          persist("watchlist", next, false);
          return next;
        });
      },
      removeWatchlistItem: (partnerId, id) => {
        setWatchlist((prev) => {
          const next = { ...prev, [partnerId]: (prev[partnerId] || []).filter((x) => x.id !== id) };
          persist("watchlist", next, false);
          return next;
        });
      },
      updateWatchlistItem: (partnerId, id, changes) => {
        setWatchlist((prev) => {
          const next = { ...prev, [partnerId]: (prev[partnerId] || []).map((x) => (x.id === id ? { ...x, ...changes } : x)) };
          persist("watchlist", next, false);
          return next;
        });
      },
      addPartner: (p) => {
        const next = [...partners, { id: uid(), firmId: p.firmId || activeFirmId, ...p }];
        setPartners(next);
        persist("kkn-partners", next);
      },
      updatePartnerRole: (partnerId, role) => {
        const next = partners.map((p) => (p.id === partnerId ? { ...p, role } : p));
        setPartners(next);
        persist("kkn-partners", next);
      },
      updatePartnerExport: (partnerId, canExport) => {
        const next = partners.map((p) => (p.id === partnerId ? { ...p, canExport } : p));
        setPartners(next);
        persist("kkn-partners", next);
      },
      saveProspect: (p) => {
        const prev = prospects.find((x) => x.id === p.id);
        const exists = Boolean(prev);
        const next = exists
          ? prospects.map((x) => (x.id === p.id ? p : x))
          : [...prospects, { firmId: p.firmId || activeFirmId, ...p }];
        setProspects(next);
        persist("kkn-prospects", next);

        // A prospect that's just been won is, by definition, now a client — carry it over
        // automatically rather than making someone re-key it. If a client with the same name
        // already exists (a repeat win / cross-sell), log a note on it instead of duplicating.
        const justWon = p.status === "won" && (!prev || prev.status !== "won");
        if (justWon && (p.organization || "").trim()) {
          const winNote = {
            text: `Won as a prospect — ${p.opportunity || "opportunity"}`,
            date: todayISO(),
            partnerId: p.responsiblePartner || null,
          };
          const matchIdx = clients.findIndex((c) => (c.name || "").trim().toLowerCase() === p.organization.trim().toLowerCase());
          const nextClients = matchIdx >= 0
            ? clients.map((c, i) => (i === matchIdx ? { ...c, notesHistory: [...(c.notesHistory || []), winNote] } : c))
            : [
                ...clients,
                {
                  id: uid(),
                  firmId: p.firmId || activeFirmId,
                  name: p.organization,
                  sector: p.sector || "",
                  clientType: p.clientType || CLIENT_TYPES[0],
                  instructedOn: p.opportunity || "",
                  potentialNeeds: "",
                  responsiblePartner: p.responsiblePartner || "",
                  origin: p.source || "",
                  lastContact: todayISO(),
                  nextAction: "",
                  nextActionDate: "",
                  notes: "",
                  notesHistory: [winNote],
                },
              ];
          setClients(nextClients);
          persist("kkn-clients", nextClients);
        }
      },
      deleteProspect: (id) => {
        const next = prospects.filter((x) => x.id !== id);
        setProspects(next);
        persist("kkn-prospects", next);
      },
      bulkImportProspects: (newProspects) => {
        const stamped = newProspects.map((p) => ({ firmId: p.firmId || activeFirmId, ...p }));
        const nextProspects = [...prospects, ...stamped];
        const nextClients = ensureClientsForWonProspects(nextProspects, clients, activeFirmId);
        setProspects(nextProspects);
        setClients(nextClients);
        persist("kkn-prospects", nextProspects);
        persist("kkn-clients", nextClients);
      },
      saveReferral: (r) => {
        const exists = referrals.some((x) => x.id === r.id);
        const next = exists
          ? referrals.map((x) => (x.id === r.id ? r : x))
          : [...referrals, { firmId: r.firmId || activeFirmId, ...r }];
        setReferrals(next);
        persist("kkn-referrals", next);
      },
      deleteReferral: (id) => {
        const next = referrals.filter((x) => x.id !== id);
        setReferrals(next);
        persist("kkn-referrals", next);
      },
      bulkImportReferrals: (newReferrals) => {
        const stamped = newReferrals.map((r) => ({ firmId: r.firmId || activeFirmId, ...r }));
        const next = [...referrals, ...stamped];
        setReferrals(next);
        persist("kkn-referrals", next);
      },
      logActivity: (partnerId, type, subject, cost) => {
        const next = [...activity, { id: uid(), firmId: activeFirmId, partnerId, type, date: todayISO(), subject: subject || "", cost: Number(cost) || 0 }];
        setActivity(next);
        persist("kkn-activity", next);
      },
      activityCosts,
      saveActivityCosts: (next) => {
        setActivityCosts(next);
        persist("kkn-activity-costs", next);
      },
      activityTargets,
      saveActivityTargets: (next) => {
        setActivityTargets(next);
        persist("kkn-activity-targets", next);
      },
      practices,
      savePractices: (next) => {
        setPractices(next);
        persist("kkn-practices", next);
      },
      renamePracticeArea: (oldValue, newValue) => {
        const nextPractices = practices.map((p) => (p === oldValue ? newValue : p));
        setPractices(nextPractices);
        persist("kkn-practices", nextPractices);
        const nextProspects = prospects.map((p) => (p.practiceArea === oldValue ? { ...p, practiceArea: newValue } : p));
        setProspects(nextProspects);
        persist("kkn-prospects", nextProspects);
      },
      sectors,
      saveSectors: (next) => {
        setSectors(next);
        persist("kkn-sectors", next);
      },
      renameSector: (oldValue, newValue) => {
        const nextSectors = sectors.map((s) => (s === oldValue ? newValue : s));
        setSectors(nextSectors);
        persist("kkn-sectors", nextSectors);
        const nextProspects = prospects.map((p) => (p.sector === oldValue ? { ...p, sector: newValue } : p));
        setProspects(nextProspects);
        persist("kkn-prospects", nextProspects);
        const nextClients = clients.map((c) => (c.sector === oldValue ? { ...c, sector: newValue } : c));
        setClients(nextClients);
        persist("kkn-clients", nextClients);
      },
      referralTypes,
      saveReferralTypes: (next) => {
        setReferralTypes(next);
        persist("kkn-referral-types", next);
      },
      renameReferralType: (oldValue, newValue) => {
        const nextTypes = referralTypes.map((t) => (t === oldValue ? newValue : t));
        setReferralTypes(nextTypes);
        persist("kkn-referral-types", nextTypes);
        const nextReferrals = referrals.map((r) => (r.type === oldValue ? { ...r, type: newValue } : r));
        setReferrals(nextReferrals);
        persist("kkn-referrals", nextReferrals);
      },
      nextActionTemplates,
      saveNextActionTemplates: (recordType, list) => {
        const next = { ...nextActionTemplates, [recordType]: list };
        setNextActionTemplates(next);
        persist("kkn-next-action-templates", next);
      },
      resourcePeople,
      saveResourcePerson: (rp) => {
        const exists = resourcePeople.some((x) => x.id === rp.id);
        const next = exists
          ? resourcePeople.map((x) => (x.id === rp.id ? rp : x))
          : [...resourcePeople, { firmId: rp.firmId || activeFirmId, ...rp }];
        setResourcePeople(next);
        persist("kkn-resource-people", next);
      },
      bulkImportResourcePeople: (newPeople) => {
        const stamped = newPeople.map((rp) => ({ firmId: rp.firmId || activeFirmId, ...rp }));
        const next = [...resourcePeople, ...stamped];
        setResourcePeople(next);
        persist("kkn-resource-people", next);
      },
      deleteResourcePerson: (id) => {
        const next = resourcePeople.filter((x) => x.id !== id);
        setResourcePeople(next);
        persist("kkn-resource-people", next);
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
        const next = exists ? tenders.map((x) => (x.id === t.id ? t : x)) : [...tenders, { firmId: t.firmId || activeFirmId, ...t }];
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
        const next = exists ? clients.map((x) => (x.id === c.id ? c : x)) : [...clients, { firmId: c.firmId || activeFirmId, ...c }];
        setClients(next);
        persist("kkn-clients", next);
      },
      bulkImportClients: (newClients) => {
        const stamped = newClients.map((c) => ({ firmId: c.firmId || activeFirmId, ...c }));
        const next = [...clients, ...stamped];
        setClients(next);
        persist("kkn-clients", next);
      },
      deleteClient: (id) => {
        const next = clients.filter((x) => x.id !== id);
        setClients(next);
        persist("kkn-clients", next);
      },
      loadSampleData: async () => {
        const sample = buildSampleData();
        const stamp = (items) => items.map((item) => ({ ...item, firmId: activeFirmId }));
        const sampleProspects = stamp(sample.prospects);
        const sampleReferrals = stamp(sample.referrals);
        const sampleClients = stamp(sample.clients);
        const sampleTenders = stamp(sample.tenders);
        const sampleActivity = stamp(sample.activity);
        const reconciledClients = ensureClientsForWonProspects(sampleProspects, sampleClients, activeFirmId);
        setReferrals(sampleReferrals);
        setClients(reconciledClients);
        setTenders(sampleTenders);
        setVault(sample.vault);
        setProspects(sampleProspects);
        setActivity(sampleActivity);
        await Promise.all([
          persist("kkn-referrals", sampleReferrals),
          persist("kkn-clients", reconciledClients),
          persist("kkn-tenders", sampleTenders),
          persist("kkn-tender-vault", sample.vault),
          persist("kkn-prospects", sampleProspects),
          persist("kkn-activity", sampleActivity),
        ]);
      },
      clearAllData: async () => {
        setReferrals([]);
        setClients([]);
        setTenders([]);
        setVault({});
        setProspects([]);
        setActivity([]);
        await Promise.all([
          persist("kkn-referrals", []),
          persist("kkn-clients", []),
          persist("kkn-tenders", []),
          persist("kkn-tender-vault", {}),
          persist("kkn-prospects", []),
          persist("kkn-activity", []),
        ]);
      },
      restoreDataSnapshot: async (snapshot = {}) => {
        const nextReferrals = snapshot.referrals || [];
        const nextClients = snapshot.clients || [];
        const nextTenders = snapshot.tenders || [];
        const nextVault = snapshot.vault || {};
        const nextProspects = snapshot.prospects || [];
        const nextActivity = snapshot.activity || [];
        setReferrals(nextReferrals);
        setClients(nextClients);
        setTenders(nextTenders);
        setVault(nextVault);
        setProspects(nextProspects);
        setActivity(nextActivity);
        await Promise.all([
          persist("kkn-referrals", nextReferrals),
          persist("kkn-clients", nextClients),
          persist("kkn-tenders", nextTenders),
          persist("kkn-tender-vault", nextVault),
          persist("kkn-prospects", nextProspects),
          persist("kkn-activity", nextActivity),
        ]);
      },
    }),
    [partners, prospects, referrals, activity, tenders, vault, clients, seenProspects, seenClients, seenReferrals, seenTenders, seenActivityTypes, watchlist, activityCosts, activityTargets, practices, sectors, referralTypes, nextActionTemplates, resourcePeople, activeFirmId, persist]
  );

  return { ready, error, ...api };
}

/* ---------------------------- UI bits ---------------------------- */

const stageMaturity = (status) => {
  if (status === "lost") return { percent: 0, label: "Lost" };
  if (status === "won") return { percent: 100, label: "Won" };
  const s = STAGES.find((x) => x.key === status);
  const n = s ? s.n : 0;
  return { percent: Math.round((n / 8) * 100), label: `${Math.round((n / 8) * 100)}% there` };
};

function StageRail({ stage, showLabel }) {
  const idx = STAGES.findIndex((s) => s.key === stage);
  const filled = STAGES[idx] ? STAGES[idx].n : 0;
  const isLost = stage === "lost";
  const maturity = stageMaturity(stage);
  return (
    <div className="rail-row">
      <div className="rail">
        {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
          <span
            key={n}
            className={`dot ${n <= filled ? (isLost ? "dot-lost" : "dot-fill") : ""}`}
          />
        ))}
      </div>
      {showLabel && (
        <span className={`rail-pct ${isLost ? "rail-pct-lost" : ""}`}>{maturity.label}</span>
      )}
    </div>
  );
}

// How much history/notes a record carries — compared against each partner's own "last seen"
// count (stored locally, per device) to decide whether an update badge should show.
const prospectActivityCount = (p) => (p.statusHistory?.length || 0) + (p.notesHistory?.length || 0);
// A won deal's value and what's actually been collected against it are two different numbers —
// billing lags matter completion, partial payments come in over time. This sums a dated log of
// payments rather than one editable total, so there's a real record of when each payment landed.
const paymentsReceived = (p) => (p.payments || []).reduce((a, x) => a + (Number(x.amount) || 0), 0);
// Three different numbers, deliberately kept distinct: Estimated (the guess, made while this is
// still a prospect) → Agreed (what was actually signed, once won — can differ from the estimate)
// → Collected (paymentsReceived, above). Everywhere the app needs "what is this deal worth," it
// should ask this function, not read estimatedFee directly — that field is frozen at whatever
// guess existed before the deal closed, and once something is won, the agreed figure (if entered)
// is the truth, with the original estimate as a fallback for a won deal nobody's re-priced yet.
const effectiveDealValue = (p) => {
  if (p.status === "won" && p.agreedValue !== undefined && p.agreedValue !== "" && p.agreedValue !== null) {
    return Number(p.agreedValue) || 0;
  }
  return Number(p.estimatedFee) || 0;
};
const clientActivityCount = (c) => c.notesHistory?.length || 0;
const referralActivityCount = (r) => r.notesHistory?.length || 0;
const tenderActivityCount = (t) => (t.stageHistory?.length || 0) + (t.notesHistory?.length || 0);

// Activity log entries only carry a free-text subject, not a hard link to a prospect record — so
// "was this touch about this deal" is a name match, not a guaranteed relationship. Good enough for
// touch-type activities (outreach, meetings, research) where people naturally log the org's name;
// weak for content-type activities (LinkedIn posts, events) where the subject is usually a topic.
const activityMatchesProspect = (activity, prospect) => {
  const org = (prospect.organization || "").trim().toLowerCase();
  const subject = (activity.subject || "").trim().toLowerCase();
  if (org.length < 3 || subject.length < 3) return false;
  return subject === org || subject.includes(org) || org.includes(subject);
};

// If a record's saved value predates a dropdown (or was typed as free text before one existed),
// keep it selectable rather than silently dropping it when the list doesn't contain an exact match.
const optionsWithLegacy = (list, currentValue) =>
  currentValue && !list.includes(currentValue) ? [currentValue, ...list] : list;
// Same idea, for a multi-select tag field — anything already selected but no longer on the shared
// list still shows up as a selectable (checked) tag instead of silently vanishing.
const tagOptionsWithLegacy = (list, currentValues) => {
  const arr = Array.isArray(currentValues) ? currentValues : (currentValues ? [currentValues] : []);
  const extra = arr.filter((x) => !list.includes(x));
  return [...list, ...extra];
};

// Every prospect a specific client or referral partner is credited with bringing in — same
// linkage the Source field captures when someone picks "Existing client" or "Referral" and names
// the specific record, plus a summary of what that's actually worth so far.
const SOURCE_LABEL_FOR_KIND = { client: "Existing client", referral: "Referral" };
function referredProspects(kind, id, store) {
  const label = SOURCE_LABEL_FOR_KIND[kind];
  let matches = store.prospects.filter((p) => p.source === label && p.sourceDetailId === id);
  // A client picked as their own source (a repeat matter for the same organization) is not a
  // referral — it's account growth, tracked separately by clientValue below. Without this
  // exclusion a client could appear to have "referred themselves," corrupting the referral count.
  if (kind === "client") {
    const ownName = (store.clients.find((c) => c.id === id)?.name || "").trim().toLowerCase();
    matches = matches.filter((p) => (p.organization || "").trim().toLowerCase() !== ownName);
  }
  return matches;
}
function referralImpact(kind, id, store) {
  const prospects = referredProspects(kind, id, store);
  const won = prospects.filter((p) => p.status === "won");
  const wonValue = won.reduce((a, p) => a + effectiveDealValue(p), 0);
  const pipelineValue = prospects
    .filter((p) => !["won", "lost"].includes(p.status))
    .reduce((a, p) => a + (Number(p.estimatedFee) || 0), 0);
  return { prospects, count: prospects.length, wonCount: won.length, wonValue, pipelineValue };
}

// A client's own total worth to the firm — every matter logged under their exact organization
// name, regardless of how it was sourced. Deliberately separate from referralImpact above: this
// is "how much has this account bought from us" (wallet share / cross-sell), not "who did this
// account bring us" (new logos). Matching is by name, so it depends on that name being typed
// consistently — see organizationSuggestions, which nudges toward reusing the exact client name.
function clientMatters(clientName, prospects) {
  const name = (clientName || "").trim().toLowerCase();
  if (!name) return [];
  return (prospects || []).filter((p) => (p.organization || "").trim().toLowerCase() === name);
}
function clientValue(clientName, prospects) {
  const matters = clientMatters(clientName, prospects);
  const won = matters.filter((p) => p.status === "won");
  const wonValue = won.reduce((a, p) => a + effectiveDealValue(p), 0);
  const pipelineValue = matters
    .filter((p) => !["won", "lost"].includes(p.status))
    .reduce((a, p) => a + (Number(p.estimatedFee) || 0), 0);
  return { matters, matterCount: matters.length, wonCount: won.length, wonValue, pipelineValue };
}

// Pulls together every record with unseen activity, across all four record types plus the
// Scorecard's activity types, so the header bell can show one combined count and feed list.
function computeUnseenFeed(store) {
  const prospects = store.prospects
    .map((p) => ({ ref: p, count: prospectActivityCount(p) - (store.seenProspects[p.id] || 0) }))
    .filter((x) => x.count > 0);
  const clients = store.clients
    .map((c) => ({ ref: c, count: clientActivityCount(c) - (store.seenClients[c.id] || 0) }))
    .filter((x) => x.count > 0);
  const referrals = store.referrals
    .map((r) => ({ ref: r, count: referralActivityCount(r) - (store.seenReferrals[r.id] || 0) }))
    .filter((x) => x.count > 0);
  const tenders = store.tenders
    .map((t) => ({ ref: t, count: tenderActivityCount(t) - (store.seenTenders[t.id] || 0) }))
    .filter((x) => x.count > 0);
  const mk = monthKey();
  const activityTypes = ACTIVITY_TYPES
    .map((t) => {
      const monthCount = store.activity.filter((a) => a.type === t.key && monthKey(a.date) === mk).length;
      const allTimeCount = store.activity.filter((a) => a.type === t.key).length;
      return { ref: t, count: Math.min(monthCount, allTimeCount - (store.seenActivityTypes[t.key] || 0)) };
    })
    .filter((x) => x.count > 0);
  const total = prospects.length + clients.length + referrals.length + tenders.length + activityTypes.length;
  return { prospects, clients, referrals, tenders, activityTypes, total };
}

function UpdateBadge({ count }) {
  if (!count || count <= 0) return null;
  return (
    <span className="update-badge" title={`${count} update${count > 1 ? "s" : ""} since you last opened this`}>
      🔔 {count}
    </span>
  );
}

// Warns right where a next-action date gets picked, if that day is already carrying other
// follow-ups — the point being to notice before a date quietly stacks up, not after.
function DayLoadNote({ getDayLoad, date, excludeId }) {
  if (!getDayLoad || !date) return null;
  const count = getDayLoad(date, excludeId);
  if (count <= 0) return null;
  return (
    <span className={`flag ${count >= 3 ? "flag-red" : "flag-amber"}`} style={{ alignSelf: "flex-start" }}>
      {count} other{count > 1 ? "s" : ""} already due {date}
    </span>
  );
}

function Pill({ children, tone }) {
  return <span className={`pill ${tone || ""}`}>{children}</span>;
}

function SearchBox({ value, onChange, placeholder }) {
  return (
    <div className="search-box-wrap">
      <input
        type="search"
        className="search-box"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      {value && (
        <button type="button" className="search-clear" onClick={() => onChange("")} aria-label="Clear search">✕</button>
      )}
    </div>
  );
}

// Case-insensitive "does any of these fields contain the query" check, used by every list search.
const matchesSearch = (query, fields) => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => (f || "").toString().toLowerCase().includes(q));
};

function ProspectCard({ p, partners, clients, seenMap, onOpen, permissions = ROLE_PERMISSIONS.partner, onArchiveToggle }) {
  const overdue = p.nextActionDate && daysBetween(p.nextActionDate, todayISO()) > 0;
  const stale = p.lastContact && daysBetween(p.lastContact, todayISO()) >= 14;
  const owner = partners.find((x) => x.id === p.responsiblePartner);
  const unseen = prospectActivityCount(p) - (seenMap?.[p.id] || 0);
  const canArchive = onArchiveToggle && (p.status === "won" || p.status === "lost");
  const outstanding = p.status === "won" ? effectiveDealValue(p) - paymentsReceived(p) : 0;
  // Live name match, same check the "matches existing client" panel in the editor uses — not
  // dependent on whether Source was correctly set to "Repeat business" at data-entry time, so it
  // self-corrects even for older records or a mis-picked source.
  const orgKey = (p.organization || "").trim().toLowerCase();
  const isRepeatBusiness = orgKey && (clients || []).some((c) => (c.name || "").trim().toLowerCase() === orgKey);
  return (
    <button className="card" onClick={() => onOpen(p)}>
      <div className="card-top">
        <span className="org">{p.organization || "Unnamed prospect"}</span>
        {permissions.seeAmounts && <span className="fee">{fmtKES(effectiveDealValue(p))}</span>}
      </div>
      <StageRail stage={p.status} showLabel={permissions.seeMetrics} />
      <div className="card-meta">
        <Pill>{p.practiceArea || "—"}</Pill>
        {owner && <Pill tone="owner">{owner.name}</Pill>}
        {isRepeatBusiness && <Pill tone="score">🔁 Repeat business</Pill>}
        {permissions.seeMetrics && p.probability != null && <Pill tone="prob">{p.probability}%</Pill>}
        <UpdateBadge count={unseen} />
        {canArchive && (
          <button
            type="button"
            className="archive-badge"
            onClick={(e) => { e.stopPropagation(); onArchiveToggle(p); }}
          >
            {p.archived ? "↩ Unarchive" : "🗄 Archive"}
          </button>
        )}
      </div>
      {(overdue || stale || (permissions.seeAmounts && outstanding > 0)) && (
        <div className="flags">
          {overdue && <span className="flag flag-red">Follow-up overdue</span>}
          {stale && !overdue && <span className="flag flag-amber">No contact 14+ days</span>}
          {permissions.seeAmounts && outstanding > 0 && (
            <span className="flag flag-amber">{fmtKES(outstanding)} outstanding</span>
          )}
        </div>
      )}
    </button>
  );
}

function ReminderCard({ item, ownerName, kindLabel, onOpen, onMarkDone, onReschedule }) {
  const diff = item.diff;
  const [rescheduling, setRescheduling] = useState(false);
  const [newDate, setNewDate] = useState(item.date);

  return (
    <div className="card reminder-card" onClick={rescheduling ? undefined : onOpen}>
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
      {!rescheduling && item.action && (
        <div className="reminder-actions">
          <button className="chip-btn reminder-done" onClick={(e) => { e.stopPropagation(); onMarkDone(); }}>
            ✓ Mark done
          </button>
          <button
            className="chip-btn chip-ghost reminder-done"
            onClick={(e) => { e.stopPropagation(); setNewDate(item.date); setRescheduling(true); }}
          >
            ↻ Reschedule
          </button>
        </div>
      )}
      {rescheduling && (
        <div className="reschedule-row" onClick={(e) => e.stopPropagation()}>
          <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
          <button
            className="chip-btn"
            onClick={() => { onReschedule(newDate); setRescheduling(false); }}
          >
            Save
          </button>
          <button className="chip-btn chip-ghost" onClick={() => setRescheduling(false)}>Cancel</button>
        </div>
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
    if (c.hasRetainer && c.retainerRenewalDate) {
      items.push({ kind: "retainer", id: c.id, title: c.name, action: `Renew retainer (${c.retainerFrequency || "recurring"})`, date: c.retainerRenewalDate, ownerId: c.responsiblePartner, ref: c });
    }
  });
  store.tenders.forEach((t) => {
    // A one-shot tender's story ends at Result — no more action needed, so reminders stop. A won
    // empanelment reaching Result is the opposite: that's when the ongoing relationship (and its
    // renewal cycle) actually begins, so its next-action reminders should keep firing past that
    // stage. A lost or withdrawn empanelment application has truly concluded, same as a lost tender.
    const stillNeedsReminders = t.stage !== "result" || (t.kind === "empanelment" && t.outcome === "Won");
    if (t.nextActionDate && stillNeedsReminders) {
      items.push({ kind: "tender", id: t.id, title: t.title, action: t.nextAction, date: t.nextActionDate, ownerId: t.responsiblePartner, ref: t });
    }
  });
  store.referrals.forEach((r) => {
    if (r.nextActionDate) {
      items.push({ kind: "referral", id: r.id, title: referralDisplayName(r), action: r.nextAction, date: r.nextActionDate, ownerId: r.responsiblePartner || null, ref: r });
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

function TenderCard({ t, partners, seenMap, onOpen, permissions = ROLE_PERMISSIONS.partner, onArchiveToggle }) {
  const score = tenderScore(t);
  const noBid = score > 0 && score < 50;
  // "submission"/"follow_up" always mean the deadline has already passed by design, for either
  // kind — but "result" only ends the story for a one-shot tender, or an empanelment that didn't
  // win. A won empanelment reaching Result is when its renewal cycle begins, so its (renamed)
  // deadline field should keep being checked past that point.
  const empanelmentWonCard = t.kind === "empanelment" && t.outcome === "Won";
  const dormantStages = empanelmentWonCard ? ["submission", "follow_up"] : ["submission", "follow_up", "result"];
  const overdue = t.deadline && daysBetween(t.deadline, todayISO()) > 0 && !dormantStages.includes(t.stage);
  const owner = partners.find((x) => x.id === t.responsiblePartner);
  const unseen = tenderActivityCount(t) - (seenMap?.[t.id] || 0);
  const canArchive = onArchiveToggle && t.outcome;
  return (
    <button className="card" onClick={() => onOpen(t)}>
      <div className="card-top">
        <span className="org">{t.title || "Unnamed tender"}</span>
        {permissions.seeAmounts && <span className="fee">{fmtKES(t.estimatedValue)}</span>}
      </div>
      <TenderStageRail stage={t.stage} />
      <div className="card-meta">
        {t.kind === "empanelment" && <Pill tone="score">Empanelment</Pill>}
        {t.outcome && <Pill tone={t.outcome === "Won" ? "score" : t.outcome === "Lost" ? "score-low" : "owner"}>{t.outcome}</Pill>}
        {t.procuringEntity && <Pill>{t.procuringEntity}</Pill>}
        {owner && <Pill tone="owner">{owner.name}</Pill>}
        {permissions.seeMetrics && <Pill tone={noBid ? "score-low" : "score"}>{score}/{SCORE_MAX}</Pill>}
        <UpdateBadge count={unseen} />
        {canArchive && (
          <button
            type="button"
            className="archive-badge"
            onClick={(e) => { e.stopPropagation(); onArchiveToggle(t); }}
          >
            {t.archived ? "↩ Unarchive" : "🗄 Archive"}
          </button>
        )}
      </div>
      {(overdue || (noBid && permissions.seeMetrics)) && (
        <div className="flags">
          {overdue && <span className="flag flag-red">{t.kind === "empanelment" ? "Renewal overdue" : "Deadline passed"}</span>}
          {noBid && permissions.seeMetrics && <span className="flag flag-amber">Below 50 — consider no-bid</span>}
        </div>
      )}
    </button>
  );
}

function VaultChecklist({ vault, onToggle, permissions = ROLE_PERMISSIONS.partner }) {
  const have = VAULT_ITEMS.filter((i) => vault[i.key]).length;
  return (
    <section className="vault">
      <div className="vault-head">
        <span>Tender Vault</span>
        {permissions.seeMetrics && <span className="stat-label">{have}/{VAULT_ITEMS.length} ready</span>}
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

// Deal value (what was won) and amount collected (what's actually come in) are different things —
// this shows both, plus the dated history of each individual payment, since collections against a
// won matter come in over time rather than as a single lump sum.
function PaymentLog({ payments, dealValue, partners }) {
  const received = paymentsReceived({ payments });
  const outstanding = dealValue - received;
  const rows = [...(payments || [])].reverse();
  // fmtKES shows "—" for zero because in most of the app zero means "not set yet" (an empty fee
  // field). Here zero is a real, meaningful answer — nothing has been collected — so it needs to
  // say "KES 0" plainly via fmtKESExact rather than borrow fmtKES's "unset" dash.
  const receivedDisplay = fmtKESExact(received);
  return (
    <div className="history">
      <div className="vault-head" style={{ marginBottom: 8 }}>
        <span>Payments received</span>
        <span className="stat-label">{receivedDisplay} of {fmtKES(dealValue)} collected</span>
      </div>
      {outstanding > 0 && (
        <p className="insight-note" style={{ marginBottom: rows.length ? 10 : 0 }}>
          {fmtKES(outstanding)} still outstanding on this matter.
        </p>
      )}
      {rows.length > 0 && (
        <div className="history-list">
          {rows.map((pmt, i) => {
            const who = partners.find((p) => p.id === pmt.partnerId);
            return (
              <div key={pmt.id || i} className="note-row">
                <div className="note-text">{fmtKES(Number(pmt.amount) || 0)}{pmt.note ? ` — ${pmt.note}` : ""}</div>
                <div className="history-meta">{pmt.date}{who ? ` · ${who.name}` : ""}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Interleaves stage changes with matched Scorecard touches, so it's visible which logged activity
// sat right before each stage jump — the closest thing to "what was the turning point" this data
// model can honestly show, given activity subjects are free text rather than a hard link.
function ActivityTimeline({ prospect, activity, partners }) {
  const matched = (activity || []).filter((a) => activityMatchesProspect(a, prospect));
  if (matched.length === 0) return null;
  const stageEvents = (prospect.statusHistory || []).map((h) => ({ ...h, source: "stage" }));
  const touchEvents = matched.map((a) => ({
    kind: "touch",
    source: "touch",
    text: ACTIVITY_TYPES.find((t) => t.key === a.type)?.label || a.type,
    date: a.date,
    partnerId: a.partnerId,
  }));
  const timeline = [...stageEvents, ...touchEvents].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const stageLabel = (key) => {
    const s = STAGES.find((x) => x.key === key);
    return s ? `${s.n}. ${s.label}` : key;
  };
  return (
    <div className="history">
      <div className="vault-head" style={{ marginBottom: 8 }}>
        <span>Activity timeline</span>
        <span className="stat-label">{matched.length} matched touch{matched.length > 1 ? "es" : ""}</span>
      </div>
      <p className="insight-note" style={{ marginBottom: 8 }}>
        Scorecard entries logged under "{prospect.organization}" (matched by name), alongside pipeline moves — in order.
      </p>
      <div className="history-list">
        {timeline.map((h, i) => {
          const who = partners.find((p) => p.id === h.partnerId);
          const label = h.source === "touch" ? h.text : h.kind === "action" ? `Done: ${h.text}` : stageLabel(h.stage);
          return (
            <div key={i} className="history-row">
              <span className={`history-dot ${h.source === "touch" ? "history-dot-touch" : h.kind === "action" ? "history-dot-action" : ""}`} />
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

// A safety net before anything gets permanently deleted — tap once to ask, tap again to actually
// do it. Works as a full labeled button (Delete) or a small icon-only one (✕) interchangeably.
function ConfirmButton({ onConfirm, className, children, confirmLabel = "Yes, delete", ariaLabel }) {
  const [confirming, setConfirming] = useState(false);
  if (confirming) {
    return (
      <span className="confirm-inline">
        <span className="confirm-inline-text">Sure?</span>
        <button type="button" className="chip-btn chip-danger" onClick={onConfirm}>{confirmLabel}</button>
        <button type="button" className="chip-btn chip-ghost" onClick={(e) => { e.stopPropagation(); setConfirming(false); }}>Cancel</button>
      </span>
    );
  }
  return (
    <button type="button" className={className} onClick={(e) => { e.stopPropagation(); setConfirming(true); }} aria-label={ariaLabel}>
      {children}
    </button>
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

// A type-ahead text input with its own suggestion dropdown. Native <datalist> is unreliable in
// mobile Safari and webviews like this one — it often won't show suggestions until the text is a
// near-exact match, if at all — so this filters and renders the list itself instead. The blur
// handler is delayed slightly so a tap on a suggestion registers before the dropdown unmounts.
function SuggestInput({ value, onChange, suggestions, placeholder, autoFocus }) {
  const [open, setOpen] = useState(false);
  const q = (value || "").trim().toLowerCase();
  const filtered = q
    ? (suggestions || []).filter((s) => s.toLowerCase().includes(q) && s.toLowerCase() !== q).slice(0, 6)
    : [];
  return (
    <div className="suggest-input-wrap">
      <input
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoComplete="off"
        autoFocus={autoFocus}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && filtered.length > 0 && (
        <div className="suggest-dropdown">
          {filtered.map((s) => (
            <button
              key={s}
              type="button"
              className="suggest-dropdown-row"
              onClick={() => { onChange({ target: { value: s } }); setOpen(false); }}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// A single tap that actually opens the phone/message/WhatsApp/email sheet — the OS already lets
// you select text and get a "Call" option, but nothing on screen hints that's possible. This makes
// it visible. Call, Message, and WhatsApp all key off the same phone number; Email keys off email.
function ContactLinkRow({ phone, email }) {
  if (!phone && !email) return null;
  const dialDigits = phone ? phone.replace(/[^\d+]/g, "") : "";
  const waDigits = phone ? phone.replace(/[^\d]/g, "") : ""; // wa.me wants digits only, no leading +
  return (
    <div className="contact-link-row">
      {phone && <a className="contact-link" href={`tel:${dialDigits}`}>📞 Call</a>}
      {phone && <a className="contact-link" href={`sms:${dialDigits}`}>💬 Message</a>}
      {phone && <a className="contact-link" href={`https://wa.me/${waDigits}`}>🟢 WhatsApp</a>}
      {email && <a className="contact-link" href={`mailto:${email}`}>✉️ Email</a>}
    </div>
  );
}

// Collapsed by default unless it already has content — used for optional, lower-priority fields
// like direct contact details, so they're available without cluttering the main form.
function CollapsibleSection({ title, defaultOpen, children }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="collapsible">
      <button type="button" className="collapsible-head" onClick={() => setOpen((o) => !o)}>
        <span>{title}</span>
        <span className="collapsible-caret">{open ? "▾" : "▸"}</span>
      </button>
      {open && <div className="collapsible-body">{children}</div>}
    </div>
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
function VoiceField({ label, value, onChange, textarea, rows, placeholder, autoFocus, suggestions }) {
  const [voiceError, setVoiceError] = useState("");
  const [suggestOpen, setSuggestOpen] = useState(false);
  const appendVoiceText = (text) => {
    const merged = value ? `${value} ${text}` : text;
    onChange({ target: { value: merged } });
  };
  const q = (value || "").trim().toLowerCase();
  const filtered = suggestions && q
    ? suggestions.filter((s) => s.toLowerCase().includes(q) && s.toLowerCase() !== q).slice(0, 6)
    : [];
  return (
    <Field label={label}>
      <div className="input-mic-row">
        {textarea ? (
          <textarea rows={rows || 3} value={value} onChange={onChange} placeholder={placeholder} />
        ) : (
          <input
            value={value}
            onChange={onChange}
            placeholder={placeholder}
            autoFocus={autoFocus}
            autoComplete={suggestions ? "off" : undefined}
            onFocus={suggestions ? () => setSuggestOpen(true) : undefined}
            onBlur={suggestions ? () => setTimeout(() => setSuggestOpen(false), 150) : undefined}
          />
        )}
        <VoiceButton onResult={appendVoiceText} onError={setVoiceError} />
        {suggestions && suggestOpen && filtered.length > 0 && (
          <div className="suggest-dropdown">
            {filtered.map((s) => (
              <button
                key={s}
                type="button"
                className="suggest-dropdown-row"
                onClick={() => { onChange({ target: { value: s } }); setSuggestOpen(false); }}
              >
                {s}
              </button>
            ))}
          </div>
        )}
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
  const goBack = () => {
    const updated = { ...f, [field.key]: draft };
    setF(updated);
    setVoiceError("");
    const prevStep = Math.max(0, step - 1);
    setStep(prevStep);
    setDraft(updated[fields[prevStep].key] || "");
  };
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
        <button type="button" className="chip-btn chip-ghost" onClick={goBack} disabled={step === 0}>← Back</button>
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
  { key: "contact", label: "Contact", placeholder: "e.g. Jane Wanjiru" },
  { key: "position", label: "Position", placeholder: "e.g. CFO" },
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
  { key: "name", label: "Name", placeholder: "e.g. Amina" },
  { key: "institution", label: "Affiliated organization / institution", placeholder: "e.g. KMP & Associates" },
  { key: "type", label: "Type", placeholder: "e.g. Accountant / Agent / Broker..." },
  { key: "nextAction", label: "Next action", placeholder: "e.g. Coffee to discuss pipeline" },
  { key: "notes", label: "Notes", placeholder: "Context" },
];

function ProspectModal({ prospect, partners, referrals, clients, prospects, tenders, activity, practices, sectors, occupations, organizations, positions, nextActionSuggestions, permissions = ROLE_PERMISSIONS.partner, me, prefillOrg, onSave, onDelete, onClose, markSeen, getDayLoad }) {
  const [f, setF] = useState(
    prospect
      ? {
          ...prospect,
          clientType: prospect.clientType || CLIENT_TYPES[0],
          agreedValue: prospect.agreedValue ?? "",
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
          contactPhone: "",
          contactEmail: "",
          sector: "",
          practiceArea: practices[0],
          clientType: CLIENT_TYPES[0],
          opportunity: "",
          estimatedFee: "",
          agreedValue: "",
          source: prefillOrg ? "Logged activity" : "",
          sourceDetailId: "",
          relationshipStrength: "Warm",
          lastContact: todayISO(),
          nextAction: "",
          nextActionDate: "",
          responsiblePartner: partners[0]?.id || "",
          probability: 25,
          status: "target",
          archived: false,
          payments: [],
          notes: "",
          notesHistory: [],
          statusHistory: [],
        }
  );
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const [saveError, setSaveError] = useState("");
  useEffect(() => {
    if (prospect) markSeen?.(prospect.id, prospectActivityCount(prospect));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Sources that map to a specific record elsewhere in the app, so a won deal can be credited to
  // an actual person or record rather than just a generic category.
  const LINKED_SOURCES = {
    Referral: { fieldLabel: "Which referral partner?", list: referrals || [], getLabel: (r) => referralDisplayName(r) },
    "Partner introduction": { fieldLabel: "Which partner?", list: partners || [], getLabel: (p) => p.name },
    "Existing client": { fieldLabel: "Which client?", list: clients || [], getLabel: (c) => c.name },
    Tender: { fieldLabel: "Which tender?", list: tenders || [], getLabel: (t) => t.title },
  };
  const linkedSourceConfig = LINKED_SOURCES[f.source];
  // If the organization typed here matches an existing client (case-insensitive), this is a repeat
  // matter rather than a brand-new relationship — surface what that client is already worth so
  // whoever's adding this sees the account's full picture, not just the single deal in front of them.
  const matchedClient = (clients || []).find(
    (c) => (c.name || "").trim().toLowerCase() === (f.organization || "").trim().toLowerCase() && (f.organization || "").trim()
  );
  const matchedClientValue = matchedClient ? clientValue(matchedClient.name, prospects) : null;
  const stageLabel = (key) => {
    const s = STAGES.find((x) => x.key === key);
    return s ? `${s.n}. ${s.label}` : key;
  };
  const [voiceFillOpen, setVoiceFillOpen] = useState(false);
  const voiceSupported = hasVoiceSupport();
  const [otherSource, setOtherSource] = useState(Boolean(f.source) && !SOURCES.includes(f.source));
  const [showContact, setShowContact] = useState(Boolean(f.contactPhone || f.contactEmail));
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentNote, setPaymentNote] = useState("");
  // Whether the "was this won at the estimate, or a different agreed amount?" prompt has been
  // resolved this session — starts true if there's already an agreed value on record (nothing to
  // ask), so the prompt only ever appears once per genuinely unresolved deal, not on every open.
  const [agreedValuePrompted, setAgreedValuePrompted] = useState(
    f.agreedValue !== "" && f.agreedValue !== undefined && f.agreedValue !== null
  );
  const [focusAgreedInput, setFocusAgreedInput] = useState(false);
  // Existing prospects collapse the rarely-changing identity fields (client type, organization,
  // contact, position, sector, practice area, opportunity, estimated fee, source, contact details)
  // into a compact summary — Pipeline stage, Probability, Relationship strength, Last contact, Next
  // action, and everything Won-related stay live below, since those are what actually move as a
  // deal progresses. New prospects have nothing to summarize yet, so start expanded.
  const [editingDetails, setEditingDetails] = useState(!prospect);

  // When the organization just typed matches an existing client, pull contact details forward
  // from that client's most recent matter — same institution, likely the same or a related contact
  // — and default Source to "Repeat business" rather than making someone route a same-organization
  // matter through "Existing client → which client?", which is a contradiction (a client can't have
  // referred itself). Everything here stays editable. Falls back to the client record's own contact
  // info if no prior matter has any (e.g. a client added directly, never yet won through the
  // pipeline). Guarded to new prospects only, and to fields still empty, so a manual edit is never
  // overwritten.
  useEffect(() => {
    if (prospect || !matchedClient) return;
    const lastMatch = (prospects || [])
      .filter((p) => (p.organization || "").trim().toLowerCase() === matchedClient.name.trim().toLowerCase())
      .filter((p) => p.contact || p.position || p.contactPhone || p.contactEmail)
      .sort((a, b) => ((a.lastContact || "") < (b.lastContact || "") ? 1 : -1))[0];
    const source = lastMatch || matchedClient;
    setF((prev) => ({
      ...prev,
      contact: prev.contact || source.contact || "",
      position: prev.position || source.position || "",
      contactPhone: prev.contactPhone || source.contactPhone || "",
      contactEmail: prev.contactEmail || source.contactEmail || "",
      source: prev.source || "Repeat business",
    }));
    if (source.contactPhone || source.contactEmail) setShowContact(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchedClient?.id]);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h3>{prospect ? "Edit prospect" : "New prospect"}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="sheet-body">
          {!editingDetails ? (
            <div className="record-summary">
              <div className="record-summary-top">
                <span className="org">{f.organization || "Unnamed prospect"}</span>
                <button type="button" className="mini-btn" onClick={() => setEditingDetails(true)}>✏️ Edit details</button>
              </div>
              <div className="card-meta">
                <Pill>{f.practiceArea || "—"}</Pill>
                {matchedClient && <Pill tone="score">🔁 Repeat business</Pill>}
                {permissions.seeAmounts && Number(f.estimatedFee) > 0 && (
                  <Pill tone="owner">{fmtKES(f.estimatedFee)}</Pill>
                )}
              </div>
              {f.opportunity && <p className="reminder-action">{f.opportunity}</p>}
              <ContactLinkRow phone={f.contactPhone} email={f.contactEmail} />
            </div>
          ) : (
            <>
              {voiceSupported && (
                voiceFillOpen ? (
                  <VoiceFillPanel fields={PROSPECT_VOICE_FIELDS} f={f} setF={setF} onExit={() => setVoiceFillOpen(false)} />
                ) : (
                  <button type="button" className="voice-fill-trigger" onClick={() => setVoiceFillOpen(true)}>
                    🎤 Fill by voice
                  </button>
                )
              )}
              <Field label="Client type">
                <select value={f.clientType} onChange={set("clientType")}>
                  {CLIENT_TYPES.map((x) => <option key={x}>{x}</option>)}
                </select>
              </Field>
              <Field label={f.clientType === "Individual" ? "Full name" : "Organization"}>
                <SuggestInput
                  value={f.organization}
                  onChange={set("organization")}
                  suggestions={organizations}
                  placeholder={f.clientType === "Individual" ? "e.g. Jane Wanjiru" : "ABC Developers Ltd"}
                />
              </Field>
              {matchedClient && (
                <div className="existing-client-note">
                  <span className="existing-client-tag">✓ Matches an existing client — this is a new matter for them, not a new relationship</span>
                  {(permissions.seeAmounts || permissions.seeMetrics) && matchedClientValue && (
                    <div className="existing-client-stats">
                      {permissions.seeMetrics && (
                        <span>{matchedClientValue.matterCount} matter{matchedClientValue.matterCount === 1 ? "" : "s"} total</span>
                      )}
                      {permissions.seeAmounts && <span>{fmtKES(matchedClientValue.wonValue)} won so far</span>}
                      {permissions.seeAmounts && matchedClientValue.pipelineValue > 0 && (
                        <span>{fmtKES(matchedClientValue.pipelineValue)} still in pipeline</span>
                      )}
                    </div>
                  )}
                </div>
              )}
              {f.clientType !== "Individual" && (
                <div className="row2">
                  <Field label="Contact">
                    <input value={f.contact} onChange={set("contact")} placeholder="Jane Wanjiru" />
                  </Field>
                  <Field label="Position">
                    <SuggestInput value={f.position} onChange={set("position")} suggestions={positions} placeholder="CFO" />
                  </Field>
                </div>
              )}
              <button type="button" className="voice-fill-trigger" onClick={() => setShowContact((v) => !v)}>
                {showContact
                  ? "− Hide contact details"
                  : (f.contactPhone || f.contactEmail) ? "👁 View contact details" : "+ Add contact details (optional)"}
              </button>
              {showContact && (
                <div className="row2">
                  <Field label="Phone">
                    <input type="tel" value={f.contactPhone} onChange={set("contactPhone")} placeholder="+254 7XX XXX XXX" />
                  </Field>
                  <Field label="Email">
                    <input type="email" value={f.contactEmail} onChange={set("contactEmail")} placeholder="name@company.com" />
                  </Field>
                </div>
              )}
              {showContact && <ContactLinkRow phone={f.contactPhone} email={f.contactEmail} />}
              <div className="row2">
                {f.clientType === "Individual" ? (
                  <Field label="Occupation / role (optional)">
                    <SuggestInput
                      value={f.sector}
                      onChange={set("sector")}
                      suggestions={occupations}
                      placeholder="e.g. Business owner, retired banker"
                    />
                  </Field>
                ) : (
                  <Field label="Sector">
                    <select value={f.sector} onChange={set("sector")}>
                      <option value="">— Select —</option>
                      {optionsWithLegacy(sectors, f.sector).map((x) => <option key={x}>{x}</option>)}
                    </select>
                  </Field>
                )}
                <Field label="Practice area">
                  <select value={f.practiceArea} onChange={set("practiceArea")}>
                    {practices.map((x) => <option key={x}>{x}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="Opportunity">
                <input value={f.opportunity} onChange={set("opportunity")} placeholder="Acquisition / development due diligence" />
              </Field>
              {permissions.seeAmounts ? (
                <>
                  <div className="row2">
                    <Field label={f.status === "won" ? "Original estimate (KES)" : "Estimated fee (KES)"}>
                      <input type="number" value={f.estimatedFee} onChange={set("estimatedFee")} placeholder="600000" />
                    </Field>
                    <Field label="Source">
                      <select
                        value={otherSource ? "Other" : (SOURCES.includes(f.source) ? f.source : "")}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === "Other") {
                            setOtherSource(true);
                            setF({ ...f, sourceDetailId: "" });
                          } else {
                            setOtherSource(false);
                            setF({ ...f, source: v, sourceDetailId: "" });
                          }
                        }}
                      >
                        <option value="">Select a source…</option>
                        {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
                        <option value="Other">Other</option>
                      </select>
                    </Field>
                  </div>
                </>
              ) : (
                <Field label="Source">
                  <select
                    value={otherSource ? "Other" : (SOURCES.includes(f.source) ? f.source : "")}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "Other") {
                        setOtherSource(true);
                        setF({ ...f, sourceDetailId: "" });
                      } else {
                        setOtherSource(false);
                        setF({ ...f, source: v, sourceDetailId: "" });
                      }
                    }}
                  >
                    <option value="">Select a source…</option>
                    {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
                    <option value="Other">Other</option>
                  </select>
                </Field>
              )}
              {otherSource && (
                <Field label="Describe the source">
                  <input value={f.source} onChange={set("source")} placeholder="e.g. Chamber of Commerce mixer" autoFocus />
                </Field>
              )}
              {linkedSourceConfig && (
                <Field label={linkedSourceConfig.fieldLabel}>
                  <select value={f.sourceDetailId} onChange={set("sourceDetailId")}>
                    <option value="">Select…</option>
                    {linkedSourceConfig.list.map((item) => (
                      <option key={item.id} value={item.id}>{linkedSourceConfig.getLabel(item)}</option>
                    ))}
                  </select>
                </Field>
              )}
            </>
          )}
          {permissions.seeMetrics ? (
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
          ) : (
            <Field label="Relationship strength">
              <select value={f.relationshipStrength} onChange={set("relationshipStrength")}>
                {STRENGTHS.map((x) => <option key={x}>{x}</option>)}
              </select>
            </Field>
          )}
          <div className="row2">
            <Field label="Last contact">
              <input type="date" value={f.lastContact} onChange={set("lastContact")} />
            </Field>
            <Field label="Next action date">
              <input type="date" value={f.nextActionDate} onChange={set("nextActionDate")} />
              <DayLoadNote getDayLoad={getDayLoad} date={f.nextActionDate} excludeId={f.id} />
            </Field>
          </div>
          <VoiceField
            label="Next action"
            value={f.nextAction}
            onChange={set("nextAction")}
            suggestions={nextActionSuggestions}
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
          <StageRail stage={f.status} showLabel={permissions.seeMetrics} />
          {f.status === "won" && permissions.seeAmounts && (
            !agreedValuePrompted ? (
              Number(f.estimatedFee) > 0 ? (
                <div className="agreed-value-prompt">
                  <p className="agreed-value-prompt-text">
                    This was estimated at <strong>{fmtKES(f.estimatedFee)}</strong>. Now that it's won — is that still the agreed value, or was a different amount actually agreed?
                  </p>
                  <div className="agreed-value-prompt-actions">
                    <button
                      type="button"
                      className="chip-btn"
                      onClick={() => { setF({ ...f, agreedValue: f.estimatedFee }); setAgreedValuePrompted(true); }}
                    >
                      Same as estimated
                    </button>
                    <button type="button" className="chip-btn chip-ghost" onClick={() => { setAgreedValuePrompted(true); setFocusAgreedInput(true); }}>
                      Different amount
                    </button>
                  </div>
                </div>
              ) : (
                <div className="agreed-value-prompt">
                  <p className="agreed-value-prompt-text">
                    There's no estimated value on record for this deal. What was actually agreed?
                  </p>
                  <button type="button" className="chip-btn" onClick={() => { setAgreedValuePrompted(true); setFocusAgreedInput(true); }}>
                    Enter agreed value
                  </button>
                </div>
              )
            ) : (
              <Field label="Agreed value (KES)">
                <input type="number" value={f.agreedValue} onChange={set("agreedValue")} placeholder="600000" autoFocus={focusAgreedInput} />
              </Field>
            )
          )}
          {(f.status === "won" || f.status === "lost") && (
            <button
              type="button"
              className="voice-fill-trigger"
              onClick={() => setF({ ...f, archived: !f.archived })}
            >
              {f.archived ? "↩ Restore from archive" : "🗄 Archive this deal"}
            </button>
          )}
          {f.status === "won" && permissions.seeAmounts && (
            <>
              <PaymentLog payments={f.payments} dealValue={effectiveDealValue(f)} partners={partners} />
              <div className="row2">
                <Field label="Log a payment (KES)">
                  <input
                    type="number"
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value)}
                    placeholder="e.g. 400000"
                  />
                </Field>
                <Field label="Note (optional)">
                  <input
                    value={paymentNote}
                    onChange={(e) => setPaymentNote(e.target.value)}
                    placeholder="e.g. Interim invoice"
                  />
                </Field>
              </div>
              <button
                type="button"
                className="chip-btn"
                disabled={!paymentAmount || Number(paymentAmount) <= 0}
                onClick={() => {
                  const entry = { id: uid(), amount: Number(paymentAmount), date: todayISO(), note: paymentNote.trim(), partnerId: me };
                  setF({ ...f, payments: [...(f.payments || []), entry] });
                  setPaymentAmount("");
                  setPaymentNote("");
                }}
              >
                + Log payment
              </button>
            </>
          )}
          <HistoryLog history={f.statusHistory} partners={partners} stageLabel={stageLabel} />
          {prospect && <ActivityTimeline prospect={prospect} activity={activity} partners={partners} />}
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
          {saveError && <p className="save-error">⚠️ {saveError}</p>}
          {prospect && (
            <ConfirmButton className="btn btn-ghost btn-danger" onConfirm={() => { onDelete(f.id); onClose(); }}>
              Delete
            </ConfirmButton>
          )}
          <button
            className="btn btn-primary"
            onClick={() => {
              if (!f.organization.trim()) {
                setSaveError("Organization name is required before this can be saved.");
                return;
              }
              setSaveError("");
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
              const finalStatusHistory = [...prevHistory, ...newEntries];
              onSave({ ...f, notes: "", notesHistory: nextNotesHistory, statusHistory: finalStatusHistory });
              markSeen?.(f.id, finalStatusHistory.length + nextNotesHistory.length);
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

function ReferralModal({ item, prefillName, partners, practices, referralTypes, nextActionSuggestions, me, onSave, onDelete, onClose, markSeen, getDayLoad }) {
  // practiceFed used to be a single free-text string ("Tax / Corporate") — treat that as a legacy
  // value and split it into tags on open, rather than losing it or forcing a re-entry.
  const normalizePracticeFed = (val) => {
    if (Array.isArray(val)) return val;
    if (!val) return [];
    return val.split(/[,/]/).map((s) => s.trim()).filter(Boolean);
  };
  const [f, setF] = useState(
    item
      ? {
          ...item,
          institution: item.institution || "",
          responsiblePartner: item.responsiblePartner || partners[0]?.id || "",
          practiceFed: normalizePracticeFed(item.practiceFed),
          notes: "",
          notesHistory:
            item.notesHistory ||
            (item.notes ? [{ text: item.notes, date: item.lastContact || todayISO(), partnerId: null }] : []),
        }
      : {
          id: uid(),
          name: prefillName || "",
          institution: "",
          type: "",
          practiceFed: [],
          responsiblePartner: partners[0]?.id || "",
          phone: "",
          email: "",
          lastContact: todayISO(),
          nextAction: "",
          nextActionDate: "",
          notes: "",
          notesHistory: [],
        }
  );
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const [saveError, setSaveError] = useState("");
  useEffect(() => {
    if (item) markSeen?.(item.id, referralActivityCount(item));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [voiceFillOpen, setVoiceFillOpen] = useState(false);
  const voiceSupported = hasVoiceSupport();
  const [showContact, setShowContact] = useState(Boolean(f.phone || f.email));
  // Editing an existing record starts with the rarely-changing identity fields (name, type,
  // responsible partner, practice fed, contact details) collapsed into a compact summary — those
  // get set once and revisited rarely, unlike Last contact/Next action/Notes below, which is what
  // actually gets touched on every check-in. A brand-new record has nothing to summarize yet, so
  // it starts fully expanded.
  const [editingDetails, setEditingDetails] = useState(!item);
  const owner = partners.find((p) => p.id === f.responsiblePartner);
  const practiceFedTags = Array.isArray(f.practiceFed) ? f.practiceFed : (f.practiceFed ? [f.practiceFed] : []);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h3>{item ? "Edit referral partner" : "New referral partner"}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="sheet-body">
          {!editingDetails ? (
            <div className="record-summary">
              <div className="record-summary-top">
                <span className="org">{referralDisplayName(f)}</span>
                <button type="button" className="mini-btn" onClick={() => setEditingDetails(true)}>✏️ Edit details</button>
              </div>
              <div className="card-meta">
                {f.type && <Pill>{f.type}</Pill>}
                {practiceFedTags.map((tag) => <Pill key={tag} tone="owner">{tag}</Pill>)}
                {owner && <Pill tone="owner">{owner.name}</Pill>}
              </div>
              <ContactLinkRow phone={f.phone} email={f.email} />
            </div>
          ) : (
            <>
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
                <input value={f.name} onChange={set("name")} placeholder="Amina" />
              </Field>
              <Field label="Affiliated organization / institution">
                <input value={f.institution} onChange={set("institution")} placeholder="KMP & Associates" />
              </Field>
              <div className="row2">
                <Field label="Type">
                  <select value={f.type} onChange={set("type")}>
                    <option value="">— Select —</option>
                    {optionsWithLegacy(referralTypes, f.type).map((x) => <option key={x}>{x}</option>)}
                  </select>
                </Field>
                <Field label="Responsible partner">
                  <select value={f.responsiblePartner} onChange={set("responsiblePartner")}>
                    {partners.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="Practice fed">
                <div className="tag-picker">
                  {tagOptionsWithLegacy(practices, f.practiceFed).map((p) => {
                    const active = (f.practiceFed || []).includes(p);
                    return (
                      <button
                        key={p}
                        type="button"
                        className={`tag-chip ${active ? "tag-chip-active" : ""}`}
                        onClick={() => {
                          const current = f.practiceFed || [];
                          const next = active ? current.filter((x) => x !== p) : [...current, p];
                          setF({ ...f, practiceFed: next });
                        }}
                      >
                        {p}
                      </button>
                    );
                  })}
                </div>
              </Field>
              <button type="button" className="voice-fill-trigger" onClick={() => setShowContact((v) => !v)}>
                {showContact
                  ? "− Hide contact details"
                  : (f.phone || f.email) ? "👁 View contact details" : "+ Add contact details (optional)"}
              </button>
              {showContact && (
                <div className="row2">
                  <Field label="Phone">
                    <input type="tel" value={f.phone} onChange={set("phone")} placeholder="+254 7XX XXX XXX" />
                  </Field>
                  <Field label="Email">
                    <input type="email" value={f.email} onChange={set("email")} placeholder="name@company.com" />
                  </Field>
                </div>
              )}
              {showContact && <ContactLinkRow phone={f.phone} email={f.email} />}
            </>
          )}
          <div className="row2">
            <Field label="Last contact">
              <input type="date" value={f.lastContact} onChange={set("lastContact")} />
            </Field>
            <Field label="Next action date">
              <input type="date" value={f.nextActionDate} onChange={set("nextActionDate")} />
              <DayLoadNote getDayLoad={getDayLoad} date={f.nextActionDate} excludeId={f.id} />
            </Field>
          </div>
          <VoiceField
            label="Next action"
            value={f.nextAction}
            onChange={set("nextAction")}
            suggestions={nextActionSuggestions}
            placeholder="Coffee to discuss pipeline"
          />
          <NoteLog notes={f.notesHistory} partners={partners || []} />
          <VoiceField
            label="Add a note"
            value={f.notes}
            onChange={set("notes")}
            textarea
            rows={3}
            placeholder="Context — saved as a new dated note"
          />
        </div>
        <div className="sheet-actions">
          {saveError && <p className="save-error">⚠️ {saveError}</p>}
          {item && (
            <ConfirmButton className="btn btn-ghost btn-danger" onConfirm={() => { onDelete(f.id); onClose(); }}>
              Delete
            </ConfirmButton>
          )}
          <button
            className="btn btn-primary"
            onClick={() => {
              if (!f.name.trim()) {
                setSaveError("Name is required before this can be saved.");
                return;
              }
              setSaveError("");
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
              markSeen?.(f.id, nextNotesHistory.length);
              onClose();
            }}
          >
            {item ? "Update referral partner" : "Save referral partner"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ClientModal({ item, partners, sectors, occupations, prospects, positions, nextActionSuggestions, permissions = ROLE_PERMISSIONS.partner, me, prefillName, onSave, onDelete, onLogNewWork, onClose, markSeen, getDayLoad }) {
  const [f, setF] = useState(
    item
      ? {
          ...item,
          clientType: item.clientType || CLIENT_TYPES[0],
          contact: item.contact || "",
          position: item.position || "",
          origin: item.origin || "",
          hasRetainer: item.hasRetainer || false,
          retainerAmount: item.retainerAmount || "",
          retainerFrequency: item.retainerFrequency || "Monthly",
          retainerRenewalDate: item.retainerRenewalDate || "",
          notes: "",
          notesHistory:
            item.notesHistory ||
            (item.notes ? [{ text: item.notes, date: item.lastContact || todayISO(), partnerId: null }] : []),
        }
      : {
          id: uid(),
          name: prefillName || "",
          sector: "",
          clientType: CLIENT_TYPES[0],
          contact: "",
          position: "",
          instructedOn: "",
          potentialNeeds: "",
          responsiblePartner: partners[0]?.id || "",
          contactPhone: "",
          contactEmail: "",
          hasRetainer: false,
          retainerAmount: "",
          retainerFrequency: "Monthly",
          retainerRenewalDate: "",
          lastContact: todayISO(),
          nextAction: "",
          nextActionDate: "",
          notes: "",
          notesHistory: [],
        }
  );
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const [saveError, setSaveError] = useState("");
  useEffect(() => {
    if (item) markSeen?.(item.id, clientActivityCount(item));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [voiceFillOpen, setVoiceFillOpen] = useState(false);
  const voiceSupported = hasVoiceSupport();
  const [showContact, setShowContact] = useState(Boolean(f.contactPhone || f.contactEmail));
  const cv = item ? clientValue(item.name, prospects) : null;
  const canSeeClientValue = permissions.seeAmounts || permissions.seeMetrics;
  // Existing clients collapse the rarely-changing identity fields (type, name, contact, position,
  // sector, responsible partner, what they instructed us on / probably need, contact details) into
  // a compact summary — Last contact/Next action/Notes stay live below, since that's what actually
  // gets touched on a check-in. New clients have nothing to summarize yet, so start expanded.
  const [editingDetails, setEditingDetails] = useState(!item);
  // A retainer that's already configured collapses into a compact summary too — once set,
  // there's no reason three input fields should permanently occupy the form every time it's
  // opened. Starts expanded only for a client with no retainer configured yet (nothing to
  // collapse), or a brand-new client.
  const [editingRetainer, setEditingRetainer] = useState(!item || !item.hasRetainer);
  const owner = partners.find((p) => p.id === f.responsiblePartner);

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
          {!editingDetails ? (
            <div className="record-summary">
              <div className="record-summary-top">
                <span className="org">{f.name || "Unnamed client"}</span>
                <button type="button" className="mini-btn" onClick={() => setEditingDetails(true)}>✏️ Edit details</button>
              </div>
              <div className="card-meta">
                {f.sector && <Pill>{f.sector}</Pill>}
                {f.clientType !== "Individual" && f.position && <Pill tone="owner">{f.position}</Pill>}
                {owner && <Pill tone="owner">{owner.name}</Pill>}
                {f.hasRetainer && <Pill tone="score">Retainer</Pill>}
                {f.origin && <Pill tone="owner">Via {f.origin}</Pill>}
              </div>
              {f.instructedOn && <p className="reminder-action">Instructed on: {f.instructedOn}</p>}
              {f.potentialNeeds && <p className="reminder-action muted-line">Possible need: {f.potentialNeeds}</p>}
              <ContactLinkRow phone={f.contactPhone} email={f.contactEmail} />
            </div>
          ) : (
            <>
              <Field label="Client type">
                <select value={f.clientType} onChange={set("clientType")}>
                  {CLIENT_TYPES.map((x) => <option key={x}>{x}</option>)}
                </select>
              </Field>
              <Field label={f.clientType === "Individual" ? "Client name" : "Client / organization name"}>
                <input
                  value={f.name}
                  onChange={set("name")}
                  placeholder={f.clientType === "Individual" ? "e.g. Jane Wanjiru" : "ABC Holdings Ltd"}
                />
              </Field>
              {f.clientType !== "Individual" && (
                <div className="row2">
                  <Field label="Contact">
                    <input value={f.contact} onChange={set("contact")} placeholder="Jane Wanjiru" />
                  </Field>
                  <Field label="Position">
                    <SuggestInput value={f.position} onChange={set("position")} suggestions={positions} placeholder="CFO" />
                  </Field>
                </div>
              )}
              <div className="row2">
                {f.clientType === "Individual" ? (
                  <Field label="Occupation / role (optional)">
                    <SuggestInput
                      value={f.sector}
                      onChange={set("sector")}
                      suggestions={occupations}
                      placeholder="e.g. Business owner, retired banker"
                    />
                  </Field>
                ) : (
                  <Field label="Sector">
                    <select value={f.sector} onChange={set("sector")}>
                      <option value="">— Select —</option>
                      {optionsWithLegacy(sectors, f.sector).map((x) => <option key={x}>{x}</option>)}
                    </select>
                  </Field>
                )}
                <Field label="Responsible partner">
                  <select value={f.responsiblePartner} onChange={set("responsiblePartner")}>
                    {partners.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="What they instructed us on">
                <input value={f.instructedOn} onChange={set("instructedOn")} placeholder="Property acquisition" autoComplete="off" />
              </Field>
              <Field label="What else they probably need">
                <input value={f.potentialNeeds} onChange={set("potentialNeeds")} placeholder="Succession planning, tax structuring" autoComplete="off" />
              </Field>
              <button type="button" className="voice-fill-trigger" onClick={() => setShowContact((v) => !v)}>
                {showContact
                  ? "− Hide contact details"
                  : (f.contactPhone || f.contactEmail) ? "👁 View contact details" : "+ Add contact details (optional)"}
              </button>
              {showContact && (
                <div className="row2">
                  <Field label="Phone">
                    <input type="tel" value={f.contactPhone} onChange={set("contactPhone")} placeholder="+254 7XX XXX XXX" />
                  </Field>
                  <Field label="Email">
                    <input type="email" value={f.contactEmail} onChange={set("contactEmail")} placeholder="name@company.com" />
                  </Field>
                </div>
              )}
              {showContact && <ContactLinkRow phone={f.contactPhone} email={f.contactEmail} />}
            </>
          )}
          {item && (
            <button type="button" className="chip-btn" style={{ alignSelf: "flex-start" }} onClick={() => onLogNewWork(f.name)}>
              + Log new work for {f.name || "this client"}
            </button>
          )}
          {!f.hasRetainer ? (
            <label className="field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={f.hasRetainer}
                onChange={(e) => { setF({ ...f, hasRetainer: e.target.checked }); setEditingRetainer(true); }}
                style={{ width: 16, height: 16, accentColor: "var(--navy)" }}
              />
              <span>This is a retainer client</span>
            </label>
          ) : !editingRetainer ? (
            <div className="record-summary">
              <div className="record-summary-top">
                <span className="org" style={{ fontSize: 14.5 }}>
                  Retainer{permissions.seeAmounts && f.retainerAmount ? ` — ${fmtKES(f.retainerAmount)}/${f.retainerFrequency === "Annual" ? "yr" : "mo"}` : ""}
                </span>
                <button type="button" className="mini-btn" onClick={() => setEditingRetainer(true)}>✏️ Edit</button>
              </div>
              {f.retainerRenewalDate && <p className="reminder-action muted-line">Renews {f.retainerRenewalDate}</p>}
            </div>
          ) : (
            <>
              <label className="field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={f.hasRetainer}
                  onChange={(e) => setF({ ...f, hasRetainer: e.target.checked })}
                  style={{ width: 16, height: 16, accentColor: "var(--navy)" }}
                />
                <span>This is a retainer client</span>
              </label>
              {permissions.seeAmounts ? (
                <div className="row2">
                  <Field label="Retainer amount (KES)">
                    <input type="number" value={f.retainerAmount} onChange={set("retainerAmount")} placeholder="150000" />
                  </Field>
                  <Field label="Frequency">
                    <select value={f.retainerFrequency} onChange={set("retainerFrequency")}>
                      <option value="Monthly">Monthly</option>
                      <option value="Annual">Annual</option>
                    </select>
                  </Field>
                </div>
              ) : (
                <Field label="Frequency">
                  <select value={f.retainerFrequency} onChange={set("retainerFrequency")}>
                    <option value="Monthly">Monthly</option>
                    <option value="Annual">Annual</option>
                  </select>
                </Field>
              )}
              <Field label="Renewal date">
                <input type="date" value={f.retainerRenewalDate} onChange={set("retainerRenewalDate")} />
                <DayLoadNote getDayLoad={getDayLoad} date={f.retainerRenewalDate} excludeId={f.id} />
              </Field>
            </>
          )}
          {item && cv && cv.matterCount > 0 && canSeeClientValue && (
            <section className="client-value-block">
              <div className="vault-head">
                <span>Client value</span>
                <span className="stat-label">Every matter logged under this name</span>
              </div>
              <div className="stat-grid" style={{ marginBottom: 0 }}>
                {permissions.seeMetrics && (
                  <div className="stat">
                    <span className="stat-value">{cv.matterCount}</span>
                    <span className="stat-label">Matters total{cv.wonCount ? ` (${cv.wonCount} won)` : ""}</span>
                  </div>
                )}
                {permissions.seeAmounts && (
                  <div className="stat">
                    <span className="stat-value">{fmtKES(cv.wonValue)}</span>
                    <span className="stat-label">Won across all matters</span>
                  </div>
                )}
                {permissions.seeAmounts && cv.pipelineValue > 0 && (
                  <div className="stat">
                    <span className="stat-value">{fmtKES(cv.pipelineValue)}</span>
                    <span className="stat-label">Still in live pipeline</span>
                  </div>
                )}
              </div>
            </section>
          )}
          <Field label="Last contact">
            <input type="date" value={f.lastContact} onChange={set("lastContact")} />
          </Field>
          <div className="row-date-action">
            <Field label="Next action date">
              <input type="date" value={f.nextActionDate} onChange={set("nextActionDate")} />
              <DayLoadNote getDayLoad={getDayLoad} date={f.nextActionDate} excludeId={f.id} />
            </Field>
            <VoiceField
              label="Next action"
              value={f.nextAction}
              onChange={set("nextAction")}
              suggestions={nextActionSuggestions}
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
          {saveError && <p className="save-error">⚠️ {saveError}</p>}
          {item && (
            <ConfirmButton className="btn btn-ghost btn-danger" onConfirm={() => { onDelete(f.id); onClose(); }}>
              Delete
            </ConfirmButton>
          )}
          <button
            className="btn btn-primary"
            onClick={() => {
              if (!f.name.trim()) {
                setSaveError("Client / organization name is required before this can be saved.");
                return;
              }
              setSaveError("");
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
              markSeen?.(f.id, nextNotesHistory.length);
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

function TenderModal({ tender, partners, clients, prospects, nextActionSuggestions, permissions = ROLE_PERMISSIONS.partner, me, prefillTitle, onSave, onDelete, onAutoCreateClient, onAddAsWonProspect, onLogNewWork, onClose, markSeen, getDayLoad }) {
  const [f, setF] = useState(
    tender
      ? {
          ...tender,
          kind: tender.kind || "tender",
          outcome: tender.outcome || "",
          archived: tender.archived || false,
          contact: tender.contact || "",
          position: tender.position || "",
          contactPhone: tender.contactPhone || "",
          contactEmail: tender.contactEmail || "",
          notes: "",
          notesHistory:
            tender.notesHistory ||
            (tender.notes ? [{ text: tender.notes, date: todayISO(), partnerId: null }] : []),
        }
      : {
          id: uid(),
          kind: "tender",
          outcome: "",
          archived: false,
          title: prefillTitle || "",
          procuringEntity: "",
          contact: "",
          position: "",
          contactPhone: "",
          contactEmail: "",
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
  const [saveError, setSaveError] = useState("");
  const [showContact, setShowContact] = useState(Boolean(tender?.contactPhone || tender?.contactEmail));
  const setScore = (k) => (e) => setF({ ...f, scores: { ...f.scores, [k]: Number(e.target.value) } });
  const total = tenderScore(f);
  const noBid = total < 50;
  const stageLabel = (key) => {
    const s = TENDER_STAGES.find((x) => x.key === key);
    return s ? `${s.n}. ${s.label}` : key;
  };
  const [voiceFillOpen, setVoiceFillOpen] = useState(false);
  const voiceSupported = hasVoiceSupport();
  // Existing tenders collapse the rarely-changing identity fields (title, procuring entity,
  // deadline, estimated value, responsible partner) into a compact summary — Stage/Next
  // action/scorecard/Result stay live below, since those are what actually move as a tender
  // progresses. New tenders have nothing to summarize yet, so start expanded.
  const [editingDetails, setEditingDetails] = useState(!tender);
  const owner = partners.find((p) => p.id === f.responsiblePartner);
  // Empanelment is an "award" workflow, not a sales pipeline — the real value never lives on this
  // record itself, it lives on whatever actual instructions come through afterward, tracked as
  // ordinary matters against a Client record for the same institution. This surfaces that Client
  // Value directly here, the same mechanism already used elsewhere for repeat business. Gated on an
  // actual Won outcome (not just reaching the final stage, and not just having typed a name) — an
  // application that's still pending or was turned down shouldn't prematurely offer to link a
  // client relationship that doesn't exist yet.
  //
  // Critically, this reads `tender` (the saved prop) rather than `f` (the live, possibly-unsaved
  // form) — auto-creating a client, and unlocking "Log new work," are real, consequential actions.
  // If they fired off an unsaved "Won" selection, someone could close this form without ever
  // hitting Save and still end up with a real Client record (and even logged work) for an
  // empanelment that was never actually persisted to the Tenders store — a phantom entry that would
  // never show up in Insights' empanelment counts. Gating on the saved record forces Save first,
  // then the client-linking and work-logging unlock on reopen — deliberate, not accidental.
  const empanelmentWon = tender?.kind === "empanelment" && tender?.outcome === "Won";
  const matchedInstitutionClient = empanelmentWon
    ? (clients || []).find((c) => (c.name || "").trim().toLowerCase() === (f.procuringEntity || "").trim().toLowerCase() && f.procuringEntity.trim())
    : null;
  const institutionClientValue = matchedInstitutionClient ? clientValue(matchedInstitutionClient.name, prospects) : null;
  // Existing client names, for type-ahead on Institution/Procuring entity — this is exactly what
  // needs to match (whitespace, casing, everything) for the "Linked to client" panel above to
  // trigger, so suggesting the exact stored name beats hoping someone retypes it identically.
  const institutionSuggestions = (clients || []).map((c) => c.name).filter(Boolean);
  // A regular Tender's win IS the business — unlike empanelment, there's no separate sales pipeline
  // needed afterward, since the tender's own stages already represented that journey. This checks
  // whether it's already been logged as a won prospect, so the action below doesn't create a dupe.
  const alreadyLoggedAsWon = (prospects || []).some((p) => p.source === "Tender" && p.sourceDetailId === f.id);
  const [justLoggedWon, setJustLoggedWon] = useState(false);
  // Creating a Client record carries no revenue with it — unlike logging a won tender, there's no
  // number here that could silently corrupt real financial reporting, so this fires automatically
  // the moment an empanelment is won, the same way a won prospect already auto-creates a client
  // today with no manual step. The guard just stops it firing again before the `clients` prop has
  // caught up with the just-created record on the next render.
  const [autoCreateAttempted, setAutoCreateAttempted] = useState(false);
  useEffect(() => {
    if (empanelmentWon && f.procuringEntity.trim() && !matchedInstitutionClient && !autoCreateAttempted) {
      onAutoCreateClient(f.procuringEntity);
      setAutoCreateAttempted(true);
    }
  }, [empanelmentWon, f.procuringEntity, matchedInstitutionClient, autoCreateAttempted]);
  useEffect(() => {
    if (tender) markSeen?.(tender.id, tenderActivityCount(tender));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          {!editingDetails ? (
            <div className="record-summary">
              <div className="record-summary-top">
                <span className="org">{f.title || "Unnamed tender"}</span>
                <button type="button" className="mini-btn" onClick={() => setEditingDetails(true)}>✏️ Edit details</button>
              </div>
              <div className="card-meta">
                {f.kind === "empanelment" && <Pill tone="score">Empanelment</Pill>}
                {f.outcome && <Pill tone={f.outcome === "Won" ? "score" : f.outcome === "Lost" ? "score-low" : "owner"}>{f.outcome}</Pill>}
                {f.procuringEntity && <Pill>{f.procuringEntity}</Pill>}
                {owner && <Pill tone="owner">{owner.name}</Pill>}
                {permissions.seeAmounts && <Pill tone="owner">{fmtKES(f.estimatedValue)}</Pill>}
              </div>
              {f.deadline && (
                <p className="reminder-action">{f.kind === "empanelment" ? "Renewal date" : "Submission deadline"}: {f.deadline}</p>
              )}
              {f.contact && <p className="reminder-action muted-line">{f.contact}{f.position ? ` — ${f.position}` : ""}</p>}
              <ContactLinkRow phone={f.contactPhone} email={f.contactEmail} />
            </div>
          ) : (
            <>
              <Field label="Type">
                <select value={f.kind} onChange={set("kind")}>
                  <option value="tender">Tender</option>
                  <option value="empanelment">Empanelment</option>
                </select>
              </Field>
              <Field label="Tender title">
                <input value={f.title} onChange={set("title")} placeholder="Nairobi City County — legal services panel" />
              </Field>
              <div className="row2">
                <Field label={f.kind === "empanelment" ? "Institution" : "Procuring entity"}>
                  <SuggestInput value={f.procuringEntity} onChange={set("procuringEntity")} suggestions={institutionSuggestions} placeholder="Nairobi City County" />
                </Field>
                <Field label={f.kind === "empanelment" ? "Renewal date" : "Submission deadline"}>
                  <input type="date" value={f.deadline} onChange={set("deadline")} />
                </Field>
              </div>
              <div className="row2">
                <Field label="Contact person">
                  <input value={f.contact} onChange={set("contact")} placeholder="Jane Wanjiru" />
                </Field>
                <Field label="Position">
                  <input value={f.position} onChange={set("position")} placeholder="Procurement Officer" />
                </Field>
              </div>
              <button type="button" className="voice-fill-trigger" onClick={() => setShowContact((v) => !v)}>
                {showContact
                  ? "− Hide contact details"
                  : (f.contactPhone || f.contactEmail) ? "👁 View contact details" : "+ Add contact details (optional)"}
              </button>
              {showContact && (
                <div className="row2">
                  <Field label="Phone">
                    <input type="tel" value={f.contactPhone} onChange={set("contactPhone")} placeholder="+254 7XX XXX XXX" />
                  </Field>
                  <Field label="Email">
                    <input type="email" value={f.contactEmail} onChange={set("contactEmail")} placeholder="name@company.com" />
                  </Field>
                </div>
              )}
              {showContact && <ContactLinkRow phone={f.contactPhone} email={f.contactEmail} />}
              {permissions.seeAmounts ? (
                <div className="row2">
                  <Field label={f.kind === "empanelment" ? "Est. annual value (optional)" : "Estimated value (KES)"}>
                    <input type="number" value={f.estimatedValue} onChange={set("estimatedValue")} placeholder="1200000" />
                  </Field>
                  <Field label="Responsible partner">
                    <select value={f.responsiblePartner} onChange={set("responsiblePartner")}>
                      {partners.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>
                  </Field>
                </div>
              ) : (
                <Field label="Responsible partner">
                  <select value={f.responsiblePartner} onChange={set("responsiblePartner")}>
                    {partners.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                </Field>
              )}
              {f.kind === "empanelment" && (
                <p className="insight-note" style={{ margin: 0 }}>
                  This is just a rough planning figure — an empanelment's real worth is whatever actual instructions come through afterward, tracked below once linked to a client.
                </p>
              )}
              {empanelmentWon && f.procuringEntity.trim() && (
                matchedInstitutionClient ? (
                  <div className="existing-client-note">
                    <span className="existing-client-tag">✓ {matchedInstitutionClient.name} added as a client — awarded work from here on gets logged on their client record, not this one</span>
                    {(permissions.seeAmounts || permissions.seeMetrics) && institutionClientValue && (
                      <div className="existing-client-stats">
                        {permissions.seeMetrics && (
                          <span>{institutionClientValue.matterCount} matter{institutionClientValue.matterCount === 1 ? "" : "s"} so far</span>
                        )}
                        {permissions.seeAmounts && <span>{fmtKES(institutionClientValue.wonValue)} won</span>}
                        {permissions.seeAmounts && institutionClientValue.pipelineValue > 0 && (
                          <span>{fmtKES(institutionClientValue.pipelineValue)} in pipeline</span>
                        )}
                      </div>
                    )}
                    <button
                      type="button"
                      className="mini-btn"
                      onClick={() => onLogNewWork(matchedInstitutionClient.name)}
                    >
                      + Log new work for {matchedInstitutionClient.name}
                    </button>
                  </div>
                ) : (
                  <p className="insight-note" style={{ margin: 0 }}>Setting up the client record…</p>
                )
              )}
            </>
          )}
          <Field label="Pipeline stage">
            <select value={f.stage} onChange={set("stage")}>
              {TENDER_STAGES.map((s) => (
                <option key={s.key} value={s.key}>{`${s.n}. ${s.label}`}</option>
              ))}
            </select>
          </Field>
          {f.stage === "result" && (
            <>
              <Field label="Outcome">
                <select value={f.outcome} onChange={set("outcome")}>
                  <option value="">— Not yet decided —</option>
                  <option value="Won">Won</option>
                  <option value="Lost">Lost</option>
                  <option value="Withdrawn">Withdrawn</option>
                </select>
              </Field>
              {f.kind === "tender" && f.outcome === "Won" && !(tender?.kind === "tender" && tender?.outcome === "Won") && (
                <p className="insight-note" style={{ margin: 0 }}>Tap Save tender below first. Once saved, you can log this as won business.</p>
              )}
              {f.kind === "empanelment" && f.outcome === "Won" && !empanelmentWon && (
                <p className="insight-note" style={{ margin: 0 }}>Tap Save tender below first. Once saved, {f.procuringEntity || "this institution"} will be added as a client — log every new piece of work they give you from their client page from then on, not here.</p>
              )}
              {tender?.kind === "tender" && tender?.outcome === "Won" && (
                alreadyLoggedAsWon ? (
                  <p className="mini-tag" style={{ alignSelf: "flex-start" }}>
                    ✓ Logged as won business — agreed value, payments, and further updates now happen on that record, not here
                  </p>
                ) : (
                  <button
                    type="button"
                    className="chip-btn"
                    onClick={() => {
                      onAddAsWonProspect(f);
                      setJustLoggedWon(true);
                      setTimeout(() => setJustLoggedWon(false), 2000);
                    }}
                  >
                    {justLoggedWon ? "✓ Logged as won business" : "+ Log as won business"}
                  </button>
                )
              )}
              <Field label="Result / lessons learned">
                <input value={f.result} onChange={set("result")} placeholder="Why — pricing, relationship, technical score..." />
              </Field>
              {f.outcome && (
                <button
                  type="button"
                  className="voice-fill-trigger"
                  onClick={() => setF({ ...f, archived: !f.archived })}
                >
                  {f.archived ? "↩ Restore from archive" : "🗄 Archive this tender"}
                </button>
              )}
            </>
          )}
          <div className="row-date-action">
            <Field label="Next action date">
              <input type="date" value={f.nextActionDate} onChange={set("nextActionDate")} />
              <DayLoadNote getDayLoad={getDayLoad} date={f.nextActionDate} excludeId={f.id} />
            </Field>
            <VoiceField
              label="Next action"
              value={f.nextAction}
              onChange={set("nextAction")}
              suggestions={nextActionSuggestions}
              placeholder="Follow up on technical proposal review"
            />
          </div>

          {permissions.seeMetrics && (
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
          )}

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
          {saveError && <p className="save-error">⚠️ {saveError}</p>}
          {tender && (
            <ConfirmButton className="btn btn-ghost btn-danger" onConfirm={() => { onDelete(f.id); onClose(); }}>
              Delete
            </ConfirmButton>
          )}
          <button
            className="btn btn-primary"
            onClick={() => {
              if (!f.title.trim()) {
                setSaveError("Tender title is required before this can be saved.");
                return;
              }
              setSaveError("");
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
              const saved = { ...f, notes: "", notesHistory: nextNotesHistory, stageHistory: nextHistory };
              onSave(saved);
              markSeen?.(f.id, nextHistory.length + nextNotesHistory.length);
              // The client needs to be created right here, at the moment of saving — waiting on the
              // `tender` prop to reflect this on a later render doesn't work, because the modal
              // closes in this same instant. Using `saved` (what's actually being persisted right
              // now) rather than the stale `matchedInstitutionClient` computed from props avoids
              // that exact one-save-behind lag.
              if (saved.kind === "empanelment" && saved.outcome === "Won" && saved.procuringEntity.trim() && !matchedInstitutionClient) {
                onAutoCreateClient(saved.procuringEntity);
              }
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

// Shown when tapping the "X referred" badge on a client or referral partner card — every prospect
// credited to them, plus what that's actually worth so far.
function ReferralImpactPanel({ kind, record, store, onOpenProspect, onClose }) {
  const impact = referralImpact(kind, record.id, store);
  const title = kind === "referral" ? referralDisplayName(record) : record.name;
  const kindLabel = kind === "client" ? "Client" : "Referral partner";

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h3>Referred by {title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="sheet-body">
          <p className="insight-note">
            Every prospect logged with <strong>{kindLabel.toLowerCase()}: {title}</strong> as the source — this is what {title} has actually been worth to the firm.
          </p>
          <section className="stat-grid">
            <div className="stat">
              <span className="stat-value">{impact.count}</span>
              <span className="stat-label">Prospects referred</span>
            </div>
            <div className="stat">
              <span className="stat-value">{fmtKES(impact.wonValue)}</span>
              <span className="stat-label">Won ({impact.wonCount})</span>
            </div>
            <div className="stat">
              <span className="stat-value">{fmtKES(impact.pipelineValue)}</span>
              <span className="stat-label">Still in live pipeline</span>
            </div>
          </section>
          {impact.prospects.length === 0 ? (
            <p className="empty">Nothing logged with this source yet.</p>
          ) : (
            <div className="card-list">
              {impact.prospects.map((p) => (
                <ProspectCard key={p.id} p={p} partners={store.partners} clients={store.clients} seenMap={store.seenProspects} onOpen={onOpenProspect} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Cost of BD — the firm's shared, editable estimate table. A page within Settings, not the
// whole of it; more bespoke items (practice areas, and whatever else needs tailoring per firm)
// live alongside it as their own pages off the same menu.
function CostOfBDPage({ store }) {
  const [costs, setCosts] = useState({ ...store.activityCosts });
  const [justSaved, setJustSaved] = useState(false);
  const dirty = ACTIVITY_TYPES.some((t) => Number(costs[t.key] || 0) !== Number(store.activityCosts[t.key] || 0));

  return (
    <>
      <p className="insight-note">
        Standard, out-of-pocket estimates per activity — fuel, airtime, event tickets, that kind of thing. Not billable time. These pre-fill the cost field when anyone logs an activity on the Scorecard, and can always be overridden for a specific entry.
      </p>
      <div className="cost-table">
        {ACTIVITY_TYPES.map((t) => (
          <div key={t.key} className="cost-row">
            <span className="cost-row-label">{t.label}</span>
            <div className="cost-row-input">
              <span>KES</span>
              <input
                type="number"
                min="0"
                value={costs[t.key] ?? 0}
                onChange={(e) => setCosts({ ...costs, [t.key]: e.target.value })}
              />
            </div>
          </div>
        ))}
      </div>
      <button
        className="btn btn-primary"
        disabled={!dirty}
        onClick={() => {
          const cleaned = Object.fromEntries(ACTIVITY_TYPES.map((t) => [t.key, Number(costs[t.key]) || 0]));
          store.saveActivityCosts(cleaned);
          setJustSaved(true);
          setTimeout(() => setJustSaved(false), 2000);
        }}
        style={{ marginTop: 14 }}
      >
        {justSaved ? "✓ Saved" : "Save cost table"}
      </button>
    </>
  );
}

// Monthly BD Targets — the Section 16 numbers, editable per firm appetite. Same table pattern as
// Cost of BD; a different number per activity type, not a cost.
function BDTargetsPage({ store }) {
  const [targets, setTargets] = useState({ ...store.activityTargets });
  const [justSaved, setJustSaved] = useState(false);
  const dirty = ACTIVITY_TYPES.some((t) => Number(targets[t.key] || 0) !== Number(store.activityTargets[t.key] || 0));

  return (
    <>
      <p className="insight-note">
        How many of each activity the firm expects, per partner, per month — the numbers the Scorecard's progress bars measure against. Set these to match the firm's actual appetite; there's nothing sacred about the starting numbers.
      </p>
      <div className="cost-table">
        {ACTIVITY_TYPES.map((t) => (
          <div key={t.key} className="cost-row">
            <span className="cost-row-label">{t.label}</span>
            <div className="cost-row-input">
              <input
                type="number"
                min="0"
                value={targets[t.key] ?? 0}
                onChange={(e) => setTargets({ ...targets, [t.key]: e.target.value })}
              />
            </div>
          </div>
        ))}
      </div>
      <button
        className="btn btn-primary"
        disabled={!dirty}
        onClick={() => {
          const cleaned = Object.fromEntries(ACTIVITY_TYPES.map((t) => [t.key, Math.max(0, Number(targets[t.key]) || 0)]));
          store.saveActivityTargets(cleaned);
          setJustSaved(true);
          setTimeout(() => setJustSaved(false), 2000);
        }}
        style={{ marginTop: 14 }}
      >
        {justSaved ? "✓ Saved" : "Save monthly targets"}
      </button>
    </>
  );
}

// Practice Areas — the list every prospect's "Practice area" dropdown pulls from, editable here
// instead of needing a code change every time the firm picks up a new practice.
// A reusable editable list — practice areas, sectors, or whatever else needs the same "add one,
// remove one, existing records keep their old tag" treatment.
function EditableListPage({ initial, note, addPlaceholder, addLabel, saveLabel, onSave, onRename, renameNote }) {
  const [items, setItems] = useState([...initial]);
  const [newItem, setNewItem] = useState("");
  const [renamingIndex, setRenamingIndex] = useState(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [justSaved, setJustSaved] = useState(false);
  const dirty = JSON.stringify(items) !== JSON.stringify(initial);

  const add = () => {
    const v = newItem.trim();
    if (!v || items.includes(v)) return;
    setItems([...items, v]);
    setNewItem("");
  };
  const remove = (i) => setItems(items.filter((_, idx) => idx !== i));

  const startRename = (i) => {
    setRenamingIndex(i);
    setRenameDraft(items[i]);
  };
  const confirmRename = (i) => {
    const oldValue = items[i];
    const newValue = renameDraft.trim();
    if (!newValue || (newValue !== oldValue && items.includes(newValue))) return;
    if (newValue !== oldValue) {
      onRename(oldValue, newValue);
      setItems(items.map((x, idx) => (idx === i ? newValue : x)));
    }
    setRenamingIndex(null);
  };

  return (
    <>
      <p className="insight-note">{note}</p>
      {onRename && renameNote && <p className="insight-note">{renameNote}</p>}
      <div className="cost-table">
        {items.map((p, i) =>
          renamingIndex === i ? (
            <div key={p} className="cost-row cost-row-editing">
              <input
                className="rename-input"
                value={renameDraft}
                onChange={(e) => setRenameDraft(e.target.value)}
                autoFocus
              />
              <div className="rename-actions">
                <button type="button" className="chip-btn" onClick={() => confirmRename(i)}>Save</button>
                <button type="button" className="chip-btn chip-ghost" onClick={() => setRenamingIndex(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            <div key={p} className="cost-row">
              <span className="cost-row-label">{p}</span>
              <div className="cost-row-actions">
                {onRename && (
                  <button type="button" className="icon-btn" onClick={() => startRename(i)} aria-label={`Rename ${p}`}>✏️</button>
                )}
                <ConfirmButton className="icon-btn" ariaLabel={`Remove ${p}`} onConfirm={() => remove(i)}>✕</ConfirmButton>
              </div>
            </div>
          )
        )}
        {items.length === 0 && <p className="empty">Nothing left — add at least one below.</p>}
      </div>
      <div className="watchlist-add" style={{ marginTop: 12 }}>
        <input value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder={addPlaceholder} />
        <button type="button" className="chip-btn" onClick={add}>{addLabel}</button>
      </div>
      <button
        className="btn btn-primary"
        disabled={!dirty || items.length === 0}
        onClick={() => {
          onSave(items);
          setJustSaved(true);
          setTimeout(() => setJustSaved(false), 2000);
        }}
        style={{ marginTop: 14 }}
      >
        {justSaved ? "✓ Saved" : saveLabel}
      </button>
    </>
  );
}

function PracticeAreasPage({ store }) {
  return (
    <EditableListPage
      initial={store.practices}
      note="The practice areas every prospect and client get categorized under. Add one when the firm picks up a new area — Aviation, M&A, whatever's next — remove one that's no longer used. Existing records keep whatever they were already tagged with even if it's removed from this list."
      renameNote="✏️ Renaming updates every prospect already tagged with the old name too — it's a true rename, not a delete-and-recreate. Takes effect immediately, no need to hit Save."
      addPlaceholder="e.g. Aviation"
      addLabel="+ Add practice area"
      saveLabel="Save practice areas"
      onSave={store.savePractices}
      onRename={store.renamePracticeArea}
    />
  );
}

function SectorsPage({ store }) {
  return (
    <EditableListPage
      initial={store.sectors}
      note="The industries every prospect and client's 'Sector' dropdown pulls from. Add one the firm's client base has grown into, remove one that isn't used. Existing records keep whatever they were already tagged with even if it's removed from this list."
      renameNote="✏️ Renaming updates every prospect and client already tagged with the old name too — it's a true rename, not a delete-and-recreate. Takes effect immediately, no need to hit Save."
      addPlaceholder="e.g. Aviation"
      addLabel="+ Add sector"
      saveLabel="Save sectors"
      onSave={store.saveSectors}
      onRename={store.renameSector}
    />
  );
}

// A resource person's own contact/notes shape mirrors ReferralModal's, minus everything that
// implies revenue tracking — no fee, no stage, no responsible partner. This is a directory entry,
// not a pipeline record.
function ResourcePersonModal({ item, me, referrals, onSave, onDelete, onAddAsReferral, onClose }) {
  const [f, setF] = useState(
    item
      ? {
          ...item,
          notes: "",
          notesHistory: item.notesHistory || [],
        }
      : {
          id: uid(),
          name: "",
          category: RESOURCE_PEOPLE_CATEGORIES[0],
          institution: "",
          usefulFor: "",
          phone: "",
          email: "",
          notes: "",
          notesHistory: [],
        }
  );
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const [saveError, setSaveError] = useState("");
  const [showContact, setShowContact] = useState(Boolean(f.phone || f.email));
  // Existing resource people collapse the rarely-changing identity fields (name, category,
  // institution, what they're useful for, contact details) into a compact summary — Notes stays
  // live below, since that's what actually gets touched over time. New entries start expanded,
  // since there's nothing to summarize yet.
  const [editingDetails, setEditingDetails] = useState(!item);
  const alreadyReferralPartner = (referrals || []).some(
    (r) => (r.name || "").trim().toLowerCase() === (f.name || "").trim().toLowerCase() && f.name.trim()
  );
  const [justPromoted, setJustPromoted] = useState(false);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h3>{item ? "Edit resource person" : "New resource person"}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="sheet-body">
          {!editingDetails ? (
            <div className="record-summary">
              <div className="record-summary-top">
                <span className="org">{f.name || "Unnamed"}</span>
                <button type="button" className="mini-btn" onClick={() => setEditingDetails(true)}>✏️ Edit details</button>
              </div>
              <div className="card-meta">
                <Pill tone="owner">{f.category}</Pill>
                {f.institution && <Pill>{f.institution}</Pill>}
              </div>
              {f.usefulFor && <p className="reminder-action muted-line">{f.usefulFor}</p>}
              <ContactLinkRow phone={f.phone} email={f.email} />
            </div>
          ) : (
            <>
              <Field label="Name">
                <input value={f.name} onChange={set("name")} placeholder="e.g. Dr. Achieng Otieno" autoFocus />
              </Field>
              <div className="row2">
                <Field label="Category">
                  <select value={f.category} onChange={set("category")}>
                    {RESOURCE_PEOPLE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </Field>
                <Field label="Institution (optional)">
                  <input value={f.institution} onChange={set("institution")} placeholder="e.g. Nairobi Registry" />
                </Field>
              </div>
              <VoiceField
                label="What they're useful for"
                value={f.usefulFor}
                onChange={set("usefulFor")}
                placeholder="e.g. International tax opinions, land registry filings"
              />
              <button type="button" className="voice-fill-trigger" onClick={() => setShowContact((v) => !v)}>
                {showContact
                  ? "− Hide contact details"
                  : (f.phone || f.email) ? "👁 View contact details" : "+ Add contact details (optional)"}
              </button>
              {showContact && (
                <div className="row2">
                  <Field label="Phone">
                    <input type="tel" value={f.phone} onChange={set("phone")} placeholder="+254 7XX XXX XXX" />
                  </Field>
                  <Field label="Email">
                    <input type="email" value={f.email} onChange={set("email")} placeholder="name@company.com" />
                  </Field>
                </div>
              )}
              {showContact && <ContactLinkRow phone={f.phone} email={f.email} />}
            </>
          )}
          {item && (
            <button
              type="button"
              className="voice-fill-trigger"
              disabled={alreadyReferralPartner}
              onClick={() => {
                onAddAsReferral(f);
                setJustPromoted(true);
                setTimeout(() => setJustPromoted(false), 2000);
              }}
            >
              {justPromoted
                ? "✓ Added as referral partner"
                : alreadyReferralPartner
                ? "Already a referral partner"
                : "→ Add as referral partner"}
            </button>
          )}
          <NoteLog notes={f.notesHistory} partners={[]} />
          <VoiceField
            label="Add a note"
            value={f.notes}
            onChange={set("notes")}
            textarea
            rows={3}
            placeholder="Context — saved as a new dated note"
          />
        </div>
        <div className="sheet-actions">
          {saveError && <p className="save-error">⚠️ {saveError}</p>}
          {item && (
            <ConfirmButton className="btn btn-ghost btn-danger" onConfirm={() => { onDelete(f.id); onClose(); }}>
              Delete
            </ConfirmButton>
          )}
          <button
            className="btn btn-primary"
            onClick={() => {
              if (!f.name.trim()) {
                setSaveError("Name is required before this can be saved.");
                return;
              }
              setSaveError("");
              const noteText = f.notes.trim();
              const nextNotesHistory = noteText
                ? [...(f.notesHistory || []), { text: noteText, date: todayISO(), partnerId: me }]
                : f.notesHistory || [];
              onSave({ ...f, notes: "", notesHistory: nextNotesHistory });
              onClose();
            }}
          >
            {item ? "Update resource person" : "Save resource person"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ResourcePeoplePage({ store, me, canExport }) {
  const [search, setSearch] = useState("");
  const [openPerson, setOpenPerson] = useState(undefined); // undefined=closed, null=new, obj=edit
  const [importOpen, setImportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const visible = store.resourcePeople.filter((rp) =>
    matchesSearch(search, [rp.name, rp.category, rp.institution, rp.usefulFor])
  );

  return (
    <>
      <p className="insight-note">
        A directory, not a pipeline — specialists to call when a brief lands outside the firm's own expertise, and execution support (clerks, registry contacts) who help get existing work done. Nothing here carries a fee, a stage, or a responsible partner, and none of it feeds Insights — this is contacts, not revenue.
      </p>
      <SearchBox value={search} onChange={setSearch} placeholder="Search name, category, institution…" />
      <div className="filter-row">
        <button type="button" className="mini-btn" onClick={() => setImportOpen(true)}>📄 Import resource people</button>
        {canExport && (
          <button
            type="button"
            className="mini-btn"
            disabled={exporting}
            onClick={() => { setExporting(true); exportEntityToXlsx("resource", store).finally(() => setExporting(false)); }}
          >
            {exporting ? "Exporting…" : "⬇ Export resource people"}
          </button>
        )}
      </div>
      <div className="card-list">
        {store.resourcePeople.length === 0 && <p className="empty">No resource people added yet.</p>}
        {visible.map((rp) => (
          <button key={rp.id} className="card" onClick={() => setOpenPerson(rp)}>
            <div className="card-top">
              <span className="org">{rp.name}</span>
            </div>
            <div className="card-meta">
              <Pill tone="owner">{rp.category}</Pill>
              {rp.institution && <Pill>{rp.institution}</Pill>}
            </div>
            {rp.usefulFor && <p className="reminder-action muted-line">{rp.usefulFor}</p>}
          </button>
        ))}
      </div>
      <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => setOpenPerson(null)}>
        + New resource person
      </button>
      {importOpen && (
        <ImportModal
          entityType="resource"
          existingItems={store.resourcePeople}
          me={me}
          onImport={store.bulkImportResourcePeople}
          onClose={() => setImportOpen(false)}
        />
      )}
      {openPerson !== undefined && (
        <ResourcePersonModal
          item={openPerson}
          me={me}
          referrals={store.referrals}
          onSave={store.saveResourcePerson}
          onDelete={store.deleteResourcePerson}
          onAddAsReferral={(rp) => {
            store.saveReferral({
              id: uid(),
              name: rp.name,
              institution: rp.institution || "",
              type: "",
              practiceFed: [],
              responsiblePartner: me,
              phone: rp.phone || "",
              email: rp.email || "",
              lastContact: todayISO(),
              nextAction: "",
              nextActionDate: "",
              notesHistory: [
                ...(rp.notesHistory || []),
                { text: "Promoted from Resource People — was a specialist contact, now also an active referral source.", date: todayISO(), partnerId: me },
              ],
            });
          }}
          onClose={() => setOpenPerson(undefined)}
        />
      )}
    </>
  );
}

function ReferralTypesPage({ store }) {
  return (
    <EditableListPage
      initial={store.referralTypes}
      note="The list a referral partner's 'Type' dropdown pulls from — the kind of professional they are, not what they refer. Existing records keep whatever they were already tagged with even if it's removed from this list."
      renameNote="✏️ Renaming updates every referral partner already tagged with the old name too — it's a true rename, not a delete-and-recreate. Takes effect immediately, no need to hit Save."
      addPlaceholder="e.g. Notary"
      addLabel="+ Add referral type"
      saveLabel="Save referral types"
      onSave={store.saveReferralTypes}
      onRename={store.renameReferralType}
    />
  );
}

function NextActionTemplatesPage({ store }) {
  const [type, setType] = useState("prospect");
  return (
    <>
      <p className="insight-note">
        Starter phrases for the "Next action" suggestion box — kept separate per record type since a tender's next step rarely looks like a client's. This list only changes when someone edits it here; whatever anyone actually types also gets suggested automatically over time, on top of this, without ever needing to be added here.
      </p>
      <div className="filter-row">
        <select value={type} onChange={(e) => setType(e.target.value)}>
          {Object.entries(NEXT_ACTION_TYPE_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
      </div>
      <EditableListPage
        key={type}
        initial={store.nextActionTemplates[type] || []}
        note={`Shown as suggestions when adding a next action for ${NEXT_ACTION_TYPE_LABELS[type]}.`}
        addPlaceholder="e.g. Send fee proposal"
        addLabel="+ Add next action"
        saveLabel={`Save ${NEXT_ACTION_TYPE_LABELS[type]} next actions`}
        onSave={(list) => store.saveNextActionTemplates(type, list)}
      />
    </>
  );
}

function TeamRolesPage({ store }) {
  return (
    <>
      <p className="insight-note">
        Partners have full access. Office Admins can do the same day-to-day work — tenders, client and prospect data entry, logging Scorecard activity — but never see the Insights tab or partner-to-partner comparisons, so performance figures stay between partners. This is a UI-level restriction, not a hard security boundary.
      </p>
      <p className="insight-note">
        Export access is separate from role. Turn it on only for people you trust with a spreadsheet copy of the firm's leads, clients, referral partners, and resource people.
      </p>
      <div className="cost-table">
        {store.partners.map((p) => (
          <div key={p.id} className="cost-row">
            <span className="cost-row-label">
              {p.name}
              <span className="role-help-text">{ROLE_HELP[p.role || "partner"]}</span>
            </span>
            <select value={p.role || "partner"} onChange={(e) => store.updatePartnerRole(p.id, e.target.value)}>
              {Object.keys(ROLE_PERMISSIONS).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
          </div>
        ))}
        {store.partners.length === 0 && <p className="empty">No one added yet.</p>}
      </div>
      <div className="cost-table" style={{ marginTop: 14 }}>
        {store.partners.map((p) => (
          <label key={p.id} className="cost-row" style={{ cursor: "pointer" }}>
            <span className="cost-row-label">{p.name} — can export data</span>
            <input
              type="checkbox"
              checked={Boolean(p.canExport)}
              onChange={(e) => store.updatePartnerExport(p.id, e.target.checked)}
              style={{ width: 16, height: 16, accentColor: "var(--navy)" }}
            />
          </label>
        ))}
      </div>
    </>
  );
}

// Settings — a menu of bespoke, firm-wide items. The pattern is meant to grow, so each item is its
// own page rather than everything living flat on one screen.
const SETTINGS_PAGES = [
  { key: "access", label: "Invite your people", desc: "Create invite links for this firm's users", Component: FirmAccessPage, partnerOnly: true },
  { key: "roles", label: "Team & Roles", desc: "Who has full partner access vs Office Admin access", Component: TeamRolesPage, partnerOnly: true },
  { key: "targets", label: "Monthly BD Targets", desc: "How many touches the firm expects per activity type, per month", Component: BDTargetsPage, requiresAmounts: true },
  { key: "cost", label: "Cost of BD", desc: "Standard estimates for what each activity typically costs", Component: CostOfBDPage, requiresAmounts: true },
  { key: "practices", label: "Practice Areas", desc: "The list prospects and clients get categorized under", Component: PracticeAreasPage },
  { key: "sectors", label: "Sectors", desc: "The industry list prospects and clients get categorized under", Component: SectorsPage },
  { key: "referralTypes", label: "Referral Types", desc: "The professions a referral partner can be tagged with", Component: ReferralTypesPage },
  { key: "nextActions", label: "Next Action Templates", desc: "Starter phrases suggested for Next Action, by record type", Component: NextActionTemplatesPage },
  { key: "resourcePeople", label: "Resource People", desc: "Specialist advisors and execution support to call on — not a pipeline", Component: ResourcePeoplePage },
];

function FirmAccessPage({ activeFirm }) {
  const activeFirmName = activeFirm?.name;
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [inviteUrl, setInviteUrl] = useState("");
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");

  const createInvite = async (e) => {
    e.preventDefault();
    setStatus("saving");
    setError("");
    setInviteUrl("");

    const { data, error: inviteError } = await supabase.rpc("create_firm_invite", {
      invite_email: email.trim() || null,
      invite_role: role,
    });

    if (inviteError) {
      setStatus("error");
      setError(inviteError.message || "Could not create invite.");
      return;
    }

    const invitedEmail = email.trim().toLowerCase();
    const url = new URL(window.location.origin + window.location.pathname);
    url.searchParams.set("invite", data);
    const nextInviteUrl = url.toString();
    setInviteUrl(nextInviteUrl);

    if (invitedEmail) {
      const { error: emailError } = await supabase.auth.signInWithOtp({
        email: invitedEmail,
        options: { emailRedirectTo: nextInviteUrl },
      });

      if (emailError) {
        setStatus("error");
        setError(
          `Invite link created, but the email could not be sent automatically. Copy the link below and send it manually. ${emailError.message || ""}`.trim()
        );
        return;
      }

      setStatus("sent");
      return;
    }

    setStatus("idle");
  };

  const copyInvite = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setStatus("copied");
    } catch {
      setStatus("idle");
    }
  };

  return (
    <>
      <p className="section-intro">
        Invite people into {activeFirmName || "this firm"} workspace by link. A user can belong to one firm only, and accepted invites open only this firm's workspace.
      </p>
      <form className="watchlist-add" onSubmit={createInvite}>
        <Field label="Email address">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="person@firm.com"
          />
        </Field>
        <Field label="Access level">
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="member">Office Admin</option>
            <option value="admin">Partner</option>
          </select>
        </Field>
        <button className="btn btn-primary" type="submit" disabled={status === "saving"}>
          {status === "saving" ? (email.trim() ? "Creating and sending…" : "Creating invite…") : "Create invite link"}
        </button>
      </form>
      {error && <p className="voice-error">{error}</p>}
      {status === "sent" && <p className="fine">Invite email sent. You can also copy the invite link below.</p>}
      {inviteUrl && (
        <section className="record-summary">
          <div className="record-summary-top">
            <span className="rank-name">{inviteUrl}</span>
            <button type="button" className="mini-btn" onClick={copyInvite}>
              {status === "copied" ? "Copied" : "Copy"}
            </button>
          </div>
        </section>
      )}
    </>
  );
}

function SettingsModal({ store, permissions = ROLE_PERMISSIONS.partner, me, activeFirm, canExport = false, initialPage = null, onClose }) {
  const [page, setPage] = useState(initialPage); // null = menu, or a SETTINGS_PAGES key
  const visiblePages = SETTINGS_PAGES.filter(
    (p) => (!p.requiresAmounts || permissions.seeAmounts) && (!p.partnerOnly || permissions.manageRoles)
  );
  const active = visiblePages.find((p) => p.key === page);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          {active ? (
            <button className="icon-btn" onClick={() => setPage(null)} aria-label="Back to Settings">‹</button>
          ) : (
            <span style={{ width: 28 }} />
          )}
          <h3>{active ? active.label : "Settings"}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="sheet-body">
          {active ? (
            <active.Component store={store} me={me} activeFirm={activeFirm} canExport={canExport} />
          ) : (
            <div className="settings-menu">
              {visiblePages.map((p) => (
                <button key={p.key} type="button" className="settings-menu-row" onClick={() => setPage(p.key)}>
                  <span className="settings-menu-text">
                    <span className="settings-menu-label">{p.label}</span>
                    <span className="settings-menu-desc">{p.desc}</span>
                  </span>
                  <span className="settings-menu-caret">›</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function NotificationFeed({ feed, onSelectProspect, onSelectClient, onSelectReferral, onSelectTender, onSelectActivityType, onClose }) {
  const groups = [
    { label: "Prospects", items: feed.prospects, getTitle: (r) => r.organization, onSelect: onSelectProspect },
    { label: "Clients", items: feed.clients, getTitle: (r) => r.name, onSelect: onSelectClient },
    { label: "Referral partners", items: feed.referrals, getTitle: (r) => referralDisplayName(r), onSelect: onSelectReferral },
    { label: "Tenders", items: feed.tenders, getTitle: (r) => r.title, onSelect: onSelectTender },
    { label: "Scorecard", items: feed.activityTypes, getTitle: (r) => r.label, onSelect: onSelectActivityType },
  ].filter((g) => g.items.length > 0);

  return (
    <div className="overlay notif-overlay" onClick={onClose}>
      <div className="notif-panel" onClick={(e) => e.stopPropagation()}>
        <div className="notif-head">
          <span>Updates</span>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="notif-body">
          {groups.length === 0 && <p className="empty">Nothing new since you last checked.</p>}
          {groups.map((g) => (
            <div key={g.label} className="notif-group">
              <span className="notif-group-label">{g.label}</span>
              {g.items.map((x) => (
                <button key={x.ref.id || x.ref.key} className="notif-row" onClick={() => g.onSelect(x.ref)}>
                  <span className="notif-row-title">{g.getTitle(x.ref)}</span>
                  <UpdateBadge count={x.count} />
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DemoDataHelper({ active, hasData, onLoadSample, onClearSample, onRemindLater, onClose }) {
  return (
    <aside className="demo-helper" aria-label="Demo data helper">
      <div className="demo-helper-copy">
        <span className="demo-helper-kicker">{active ? "Demo data is loaded" : "Try Bideey faster"}</span>
        <strong>{active ? "Ready to switch to real firm data?" : hasData ? "Want sample data to explore the dashboard?" : "Load sample data and see the dashboard working."}</strong>
        <p>
          {active
            ? "You can clear the demo data when the firm is ready to start entering its own leads, clients, referrals, tenders, and activity."
            : "Use fictional records to understand the flow before adding the firm's real commercial pipeline."}
        </p>
      </div>
      <div className="demo-helper-actions">
        {active ? (
          <>
            <button type="button" className="btn btn-primary" onClick={onClearSample}>Clear demo data</button>
            <button type="button" className="btn btn-ghost" onClick={onRemindLater}>Remind me tomorrow</button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-primary" onClick={onLoadSample}>Load sample data</button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Not now</button>
          </>
        )}
      </div>
    </aside>
  );
}

export default function App({ session, activeFirm, membershipRole, onSignOut, isDemo = false }) {
  const activeFirmId = activeFirm?.id || DEFAULT_FIRM_ID;
  const store = useStorage(activeFirmId);
  // iOS shrinks the *visible* area when the keyboard opens but leaves position:fixed elements
  // sized to the full, unchanged layout viewport — that mismatch is what causes a fixed modal to
  // scroll unpredictably and let the page behind it show through. Tracking the real visual
  // viewport height and feeding it back in as a CSS variable keeps every modal correctly sized.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const setVvh = () => document.documentElement.style.setProperty("--vvh", `${vv.height}px`);
    setVvh();
    vv.addEventListener("resize", setVvh);
    vv.addEventListener("scroll", setVvh);
    // iOS's AutoFill quick-bar (the key/card/location icon row above the keyboard) can still be
    // animating in after the keyboard's own resize event fires, so a single immediate measurement
    // can lock in a too-tall height and visibly squash the sheet's content. Re-checking shortly
    // after any focus change catches the settled, final height once everything's done animating.
    const recheckSoon = () => { setVvh(); setTimeout(setVvh, 350); };
    window.addEventListener("focusin", recheckSoon);
    window.addEventListener("focusout", recheckSoon);
    return () => {
      vv.removeEventListener("resize", setVvh);
      vv.removeEventListener("scroll", setVvh);
      window.removeEventListener("focusin", recheckSoon);
      window.removeEventListener("focusout", recheckSoon);
    };
  }, []);
  const [tab, setTab] = useState("pipeline");
  // `me` is who the app THINKS is using it — set purely by tapping a name on the "who's picking
  // this up" screen below, with no password, no session, no verification of any kind. Anyone with
  // this app's URL can select any partner and act, write, and save data as them. This is fine for
  // a single trusted team on an internal tool; it is not authentication and must not be treated as
  // one. To wire in real auth later: replace how `me` gets set (from a verified login session
  // instead of a tap), and leave everything downstream — getPermissions(myPartner), every
  // permissions.xyz check — exactly as-is. That separation between "who you are" and "what you can
  // do" already exists and is the intended seam for this to plug into.
  const [me, setMe] = useState(null);
  const [filterPartner, setFilterPartner] = useState("all");
  const [filterTendersPartner, setFilterTendersPartner] = useState("all");
  const [filterClientsPartner, setFilterClientsPartner] = useState("all");
  const [filterReferralsPartner, setFilterReferralsPartner] = useState("all");
  const [searchPipeline, setSearchPipeline] = useState("");
  const [searchTenders, setSearchTenders] = useState("");
  const [searchClients, setSearchClients] = useState("");
  const [searchReferrals, setSearchReferrals] = useState("");
  const [openProspect, setOpenProspect] = useState(undefined); // undefined=closed, null=new, obj=edit
  const [openReferral, setOpenReferral] = useState(undefined);
  const [openTender, setOpenTender] = useState(undefined);
  const [openClient, setOpenClient] = useState(undefined);
  const [importProspectsOpen, setImportProspectsOpen] = useState(false);
  const [importClientsOpen, setImportClientsOpen] = useState(false);
  const [importReferralsOpen, setImportReferralsOpen] = useState(false);
  const [exportingType, setExportingType] = useState(null);
  const [prospectPrefill, setProspectPrefill] = useState("");
  const [clientPrefill, setClientPrefill] = useState("");
  const [referralPrefill, setReferralPrefill] = useState("");
  const [tenderPrefill, setTenderPrefill] = useState("");
  const [collapsed, setCollapsed] = useState({});
  const [tenderCollapsed, setTenderCollapsed] = useState({});
  const [showArchived, setShowArchived] = useState({});
  const [showArchivedTenders, setShowArchivedTenders] = useState({});
  const [notifOpen, setNotifOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialPage, setSettingsInitialPage] = useState(null);
  const demoHelperKey = `bideey-demo-helper-${activeFirmId}`;
  const demoBackupKey = `bideey-demo-backup-${activeFirmId}`;
  const [demoHelperState, setDemoHelperState] = useState(() => {
    try {
      return JSON.parse(window.localStorage.getItem(demoHelperKey) || "{}");
    } catch {
      return {};
    }
  });
  const [openReferralImpact, setOpenReferralImpact] = useState(undefined); // { kind, record } | undefined
  const occupationSuggestions = useMemo(
    () => individualOccupations(store.clients, store.prospects),
    [store.clients, store.prospects]
  );
  const positionSuggestionsList = useMemo(
    () => positionSuggestions(store.clients, store.prospects),
    [store.clients, store.prospects]
  );
  const orgSuggestions = useMemo(
    () => organizationSuggestions(store.clients, store.prospects),
    [store.clients, store.prospects]
  );
  const prospectNextActionSuggestions = useMemo(
    () => nextActionSuggestions(store.nextActionTemplates.prospect, store.prospects),
    [store.nextActionTemplates, store.prospects]
  );
  const clientNextActionSuggestions = useMemo(
    () => nextActionSuggestions(store.nextActionTemplates.client, store.clients),
    [store.nextActionTemplates, store.clients]
  );
  const tenderNextActionSuggestions = useMemo(
    () => nextActionSuggestions(store.nextActionTemplates.tender, store.tenders),
    [store.nextActionTemplates, store.tenders]
  );
  const referralNextActionSuggestions = useMemo(
    () => nextActionSuggestions(store.nextActionTemplates.referral, store.referrals),
    [store.nextActionTemplates, store.referrals]
  );

  useEffect(() => {
    document.title = "Bideey";
  }, []);

  useEffect(() => {
    try {
      setDemoHelperState(JSON.parse(window.localStorage.getItem(demoHelperKey) || "{}"));
    } catch {
      setDemoHelperState({});
    }
  }, [demoHelperKey]);

  const openSettings = (initialPage = null) => {
    setSettingsInitialPage(initialPage);
    setSettingsOpen(true);
  };
  const saveDemoHelperState = (next) => {
    setDemoHelperState(next);
    try {
      window.localStorage.setItem(demoHelperKey, JSON.stringify(next));
    } catch {
      // Ignore private browsing/local storage edge cases.
    }
  };
  const snapshotDashboardData = () => ({
    prospects: store.prospects,
    referrals: store.referrals,
    clients: store.clients,
    tenders: store.tenders,
    vault: store.vault,
    activity: store.activity,
  });
  const loadDashboardSampleData = async () => {
    try {
      if (!demoHelperState.active) {
        window.localStorage.setItem(demoBackupKey, JSON.stringify(snapshotDashboardData()));
      }
    } catch {
      // If backup storage is unavailable, the sample data still loads.
    }
    await store.loadSampleData();
    saveDemoHelperState({ active: true, loadedAt: Date.now(), remindAt: Date.now() + DEMO_REMINDER_DELAY_MS });
  };
  const clearDashboardSampleData = async () => {
    let backup = null;
    try {
      backup = JSON.parse(window.localStorage.getItem(demoBackupKey) || "null");
    } catch {
      backup = null;
    }
    if (backup) {
      await store.restoreDataSnapshot(backup);
    } else {
      await store.clearAllData();
    }
    try {
      window.localStorage.removeItem(demoBackupKey);
    } catch {
      // Ignore private browsing/local storage edge cases.
    }
    saveDemoHelperState({ active: false, clearedAt: Date.now(), remindAt: Date.now() + DEMO_REMINDER_DELAY_MS });
  };
  const remindDemoHelperLater = () => {
    saveDemoHelperState({ ...demoHelperState, remindAt: Date.now() + DEMO_REMINDER_DELAY_MS });
  };

  const sessionUserId = session?.user?.id || "";
  const sessionUserEmail = session?.user?.email || "";
  const currentUserPartnerId = sessionUserId ? `user-${sessionUserId}` : "";
  const currentUserAppRole = membershipRoleToAppRole(membershipRole);
  const demoLoadedRef = useRef(false);

  useEffect(() => {
    if (!store.ready || !sessionUserId || me) return;

    const existing = store.partners.find(
      (p) => p.userId === sessionUserId || p.id === currentUserPartnerId || (sessionUserEmail && p.email === sessionUserEmail)
    );

    if (existing) {
      if ((existing.role || "partner") !== currentUserAppRole) {
        store.updatePartnerRole(existing.id, currentUserAppRole);
      }
      setMe(existing.id);
      return;
    }

    store.addPartner({
      id: currentUserPartnerId,
      userId: sessionUserId,
      email: sessionUserEmail,
      name: displayNameFromSession(session),
      identity: currentUserAppRole === "admin" ? "Office Admin" : "Partner",
      role: currentUserAppRole,
      canExport: currentUserAppRole === "partner",
    });
    setMe(currentUserPartnerId);
  }, [currentUserAppRole, currentUserPartnerId, me, session, sessionUserEmail, sessionUserId, store]);

  useEffect(() => {
    if (!isDemo || !store.ready || demoLoadedRef.current) return;
    const hasDemoData = store.prospects.length || store.clients.length || store.referrals.length || store.tenders.length || store.activity.length;
    if (!hasDemoData) {
      demoLoadedRef.current = true;
      store.loadSampleData();
    }
  }, [isDemo, store]);

  if (!store.ready) {
    return (
      <div className="boot">
        <Style />
        <div className="boot-mark" aria-hidden="true">B</div>
        <p>Loading the pipeline…</p>
      </div>
    );
  }

  if (!me) {
    return (
      <div className="boot">
        <Style />
        <div className="boot-mark" aria-hidden="true">B</div>
        <h1>Bideey</h1>
        <p className="muted">Opening your workspace…</p>
        <p className="fine">You are signed in. We are matching your account to your firm workspace.</p>
        <button className="link-btn" onClick={onSignOut}>Sign out</button>
      </div>
    );
  }

  const myPartner = store.partners.find((p) => p.id === me);
  const myPermissions = getPermissions(myPartner);
  const canExport = Boolean(myPartner?.canExport || isDemo);
  const hasDashboardData = Boolean(store.prospects.length || store.clients.length || store.referrals.length || store.tenders.length || store.activity.length);
  const shouldShowDemoHelper = !isDemo && (!demoHelperState.remindAt || Date.now() >= demoHelperState.remindAt) && (!hasDashboardData || demoHelperState.active);
  const visibleProspects = store.prospects
    .filter((p) => filterPartner === "all" || p.responsiblePartner === filterPartner)
    .filter((p) => matchesSearch(searchPipeline, [p.organization, p.contact, p.sector, p.opportunity, p.practiceArea]));

  const grouped = STAGES.filter((s, i, arr) => arr.findIndex((y) => y.key === s.key) === i).map((s) => {
    const items = visibleProspects.filter((p) => p.status === s.key);
    return {
      ...s,
      items,
      activeItems: items.filter((p) => !p.archived),
      archivedItems: items.filter((p) => p.archived),
    };
  });

  const overdueCount = collectReminders(store).filter((item) => daysBetween(item.date, todayISO()) > 0).length;
  const feed = computeUnseenFeed(store);
  // How many other open next-actions (across every record type) already fall on a given date —
  // shown right where a next-action date gets picked, so a day doesn't quietly stack up unnoticed.
  const getDayLoad = (date, excludeId) => {
    if (!date) return 0;
    return collectReminders(store).filter((item) => item.date === date && item.id !== excludeId).length;
  };
  const openFromFeed = {
    prospect: (p) => { setTab("pipeline"); setOpenProspect(p); setNotifOpen(false); },
    client: (c) => { setTab("clients"); setOpenClient(c); setNotifOpen(false); },
    referral: (r) => { setTab("referrals"); setOpenReferral(r); setNotifOpen(false); },
    tender: (t) => { setTab("tenders"); setOpenTender(t); setNotifOpen(false); },
    activityType: (t) => {
      const allTimeCount = store.activity.filter((a) => a.type === t.key).length;
      store.markActivityTypeSeen(t.key, allTimeCount);
      setTab("scorecard");
      setNotifOpen(false);
    },
  };
  return (
    <div className="app">
      <Style />
      {isDemo && (
        <div className="demo-banner">
          Demo playground — fictional data only. Changes are saved in this browser and never touch a real firm workspace.
        </div>
      )}
      <header className="topbar">
        <button className="brand" onClick={() => setTab("reminders")} aria-label="Go to home">
          <span className="brand-icon brand-letter" aria-hidden="true">B</span>
          <span className="brand-mark">Bideey</span>
        </button>
        <div className="header-right">
          {feed.total > 0 && (
            <button className="notif-bell" onClick={() => setNotifOpen(true)} aria-label="View updates">
              🔔<span className="notif-count">{feed.total}</span>
            </button>
          )}
          <button className="notif-bell" onClick={() => openSettings()} aria-label="Settings">⚙️</button>
          <span className="me-name">
            {myPartner?.name || "Switch"}
          </span>
          <button className="signout-btn" onClick={onSignOut}>Sign out</button>
        </div>
      </header>

      {notifOpen && (
        <NotificationFeed
          feed={feed}
          onSelectProspect={openFromFeed.prospect}
          onSelectClient={openFromFeed.client}
          onSelectReferral={openFromFeed.referral}
          onSelectTender={openFromFeed.tender}
          onSelectActivityType={openFromFeed.activityType}
          onClose={() => setNotifOpen(false)}
        />
      )}

      {settingsOpen && (
        <SettingsModal
          store={store}
          permissions={myPermissions}
          me={me}
          activeFirm={activeFirm}
          canExport={canExport}
          initialPage={settingsInitialPage}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {shouldShowDemoHelper && (
        <DemoDataHelper
          active={Boolean(demoHelperState.active)}
          hasData={hasDashboardData}
          onLoadSample={loadDashboardSampleData}
          onClearSample={clearDashboardSampleData}
          onRemindLater={remindDemoHelperLater}
          onClose={remindDemoHelperLater}
        />
      )}

      <nav className="tabs">
        {[
          ["reminders", "Reminders", overdueCount],
          ["pipeline", "Pipeline", 0],
          ["tenders", "Tenders", 0],
          ["clients", "Clients", 0],
          ["referrals", "Referrals", 0],
          ["scorecard", "Scorecard", 0],
          ["insights", "Insights", 0],
        ]
          .filter(([k]) => k !== "insights" || myPermissions.seeInsights)
          .map(([k, label, badge]) => (
          <button key={k} className={`tab ${tab === k ? "tab-active" : ""}`} onClick={() => setTab(k)}>
            {label}{badge > 0 && <span className="tab-badge">{badge}</span>}
          </button>
        ))}
      </nav>

      {tab === "reminders" && (
        <Reminders
          store={store}
          me={me}
          permissions={myPermissions}
          setOpenProspect={setOpenProspect}
          setOpenClient={setOpenClient}
          setOpenTender={setOpenTender}
          setOpenReferral={setOpenReferral}
          setProspectPrefill={setProspectPrefill}
        />
      )}

      {tab === "pipeline" && (() => {
        const visibleProspectCount = grouped.reduce((a, s) => a + s.items.length, 0);
        return (
        <main className="content">
          <SearchBox value={searchPipeline} onChange={setSearchPipeline} placeholder="Search organization, contact, sector, opportunity…" />
          <div className="filter-row">
            {myPermissions.usePartnerFilters && (
              <select value={filterPartner} onChange={(e) => setFilterPartner(e.target.value)}>
                <option value="all">All partners</option>
                {store.partners.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}
            <button type="button" className="mini-btn" onClick={() => setImportProspectsOpen(true)}>📄 Import leads</button>
            {canExport && (
              <button
                type="button"
                className="mini-btn"
                disabled={exportingType === "prospect"}
                onClick={() => { setExportingType("prospect"); exportEntityToXlsx("prospect", store).finally(() => setExportingType(null)); }}
              >
                {exportingType === "prospect" ? "Exporting…" : "⬇ Export leads"}
              </button>
            )}
            {myPermissions.seeMetrics && (
              <span className="list-count">{visibleProspectCount} prospect{visibleProspectCount === 1 ? "" : "s"}</span>
            )}
            {overdueCount > 0 && <span className="overdue-banner">{overdueCount} overdue follow-up{overdueCount > 1 ? "s" : ""}</span>}
          </div>

          {grouped.map((s) => (
            <section key={s.key} className="stage-group">
              <button className="stage-head" onClick={() => setCollapsed({ ...collapsed, [s.key]: !collapsed[s.key] })}>
                <span>{s.n}. {s.label}</span>
                {myPermissions.seeMetrics && (
                  <span className="stage-count">
                    {s.items.length} · {fmtKES(s.items.reduce((a, p) => a + effectiveDealValue(p), 0))}
                  </span>
                )}
              </button>
              {!collapsed[s.key] && (
                <div className="card-list">
                  {s.activeItems.length === 0 && s.archivedItems.length === 0 && <p className="empty">Nothing here yet.</p>}
                  {s.activeItems.length === 0 && s.archivedItems.length > 0 && !showArchived[s.key] && (
                    <p className="empty">Everything here is archived.</p>
                  )}
                  {s.activeItems.map((p) => (
                    <ProspectCard
                      key={p.id}
                      p={p}
                      partners={store.partners}
                      clients={store.clients}
                      seenMap={store.seenProspects}
                      onOpen={setOpenProspect}
                      permissions={myPermissions}
                      onArchiveToggle={(prospect) => store.saveProspect({ ...prospect, archived: !prospect.archived })}
                    />
                  ))}
                  {s.archivedItems.length > 0 && (
                    <button
                      type="button"
                      className="chip-btn chip-ghost"
                      style={{ alignSelf: "flex-start" }}
                      onClick={() => setShowArchived({ ...showArchived, [s.key]: !showArchived[s.key] })}
                    >
                      {showArchived[s.key] ? "− Hide" : "🗄 Show"} {s.archivedItems.length} archived
                    </button>
                  )}
                  {showArchived[s.key] && s.archivedItems.map((p) => (
                    <ProspectCard
                      key={p.id}
                      p={p}
                      partners={store.partners}
                      clients={store.clients}
                      seenMap={store.seenProspects}
                      onOpen={setOpenProspect}
                      permissions={myPermissions}
                      onArchiveToggle={(prospect) => store.saveProspect({ ...prospect, archived: !prospect.archived })}
                    />
                  ))}
                </div>
              )}
            </section>
          ))}

          <button className="fab" onClick={() => { setProspectPrefill(""); setOpenProspect(null); }}>+ New prospect</button>
        </main>
        );
      })()}

      {tab === "tenders" && (() => {
        const visibleTenderCount = TENDER_STAGES.reduce((a, s) => a + store.tenders
          .filter((t) => t.stage === s.key)
          .filter((t) => matchesSearch(searchTenders, [t.title, t.procuringEntity]))
          .filter((t) => filterTendersPartner === "all" || t.responsiblePartner === filterTendersPartner).length, 0);
        return (
        <main className="content">
          <VaultChecklist vault={store.vault} onToggle={store.toggleVaultItem} permissions={myPermissions} />

          <p className="section-intro" style={{ marginTop: 16 }}>
            Score every opportunity before committing resources. A disciplined firm wins partly by knowing which tenders not to pursue.
          </p>

          <SearchBox value={searchTenders} onChange={setSearchTenders} placeholder="Search tender title, procuring entity…" />
          <div className="filter-row">
            {myPermissions.usePartnerFilters && (
              <select value={filterTendersPartner} onChange={(e) => setFilterTendersPartner(e.target.value)}>
                <option value="all">All partners</option>
                {store.partners.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}
            {myPermissions.seeMetrics && (
              <span className="list-count">{visibleTenderCount} tender{visibleTenderCount === 1 ? "" : "s"}</span>
            )}
          </div>

          {TENDER_STAGES.map((s) => {
            const items = store.tenders
              .filter((t) => t.stage === s.key)
              .filter((t) => matchesSearch(searchTenders, [t.title, t.procuringEntity]))
              .filter((t) => filterTendersPartner === "all" || t.responsiblePartner === filterTendersPartner);
            const activeItems = items.filter((t) => !t.archived);
            const archivedItems = items.filter((t) => t.archived);
            return (
              <section key={s.key} className="stage-group">
                <button
                  className="stage-head"
                  onClick={() => setTenderCollapsed({ ...tenderCollapsed, [s.key]: !tenderCollapsed[s.key] })}
                >
                  <span>{s.n}. {s.label}</span>
                  {myPermissions.seeMetrics && (
                    <span className="stage-count">
                      {items.length} · {fmtKES(items.reduce((a, t) => a + (Number(t.estimatedValue) || 0), 0))}
                    </span>
                  )}
                </button>
                {!tenderCollapsed[s.key] && (
                  <div className="card-list">
                    {activeItems.length === 0 && archivedItems.length === 0 && <p className="empty">Nothing here yet.</p>}
                    {activeItems.length === 0 && archivedItems.length > 0 && !showArchivedTenders[s.key] && (
                      <p className="empty">Everything here is archived.</p>
                    )}
                    {activeItems.map((t) => (
                      <TenderCard
                        key={t.id}
                        t={t}
                        partners={store.partners}
                        seenMap={store.seenTenders}
                        onOpen={setOpenTender}
                        permissions={myPermissions}
                        onArchiveToggle={(tenderItem) => store.saveTender({ ...tenderItem, archived: !tenderItem.archived })}
                      />
                    ))}
                    {archivedItems.length > 0 && (
                      <button
                        type="button"
                        className="chip-btn chip-ghost"
                        style={{ alignSelf: "flex-start" }}
                        onClick={() => setShowArchivedTenders({ ...showArchivedTenders, [s.key]: !showArchivedTenders[s.key] })}
                      >
                        {showArchivedTenders[s.key] ? "− Hide" : "🗄 Show"} {archivedItems.length} archived
                      </button>
                    )}
                    {showArchivedTenders[s.key] && archivedItems.map((t) => (
                      <TenderCard
                        key={t.id}
                        t={t}
                        partners={store.partners}
                        seenMap={store.seenTenders}
                        onOpen={setOpenTender}
                        permissions={myPermissions}
                        onArchiveToggle={(tenderItem) => store.saveTender({ ...tenderItem, archived: !tenderItem.archived })}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}

          <button className="fab" onClick={() => { setTenderPrefill(""); setOpenTender(null); }}>+ New tender</button>
        </main>
        );
      })()}

      {tab === "clients" && (() => {
        const visibleClients = store.clients
          .filter((c) => matchesSearch(searchClients, [c.name, c.sector, c.instructedOn, c.potentialNeeds, c.origin]))
          .filter((c) => filterClientsPartner === "all" || c.responsiblePartner === filterClientsPartner)
          .slice()
          .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        return (
        <main className="content">
          <p className="section-intro">
            Your existing client base — before hunting strangers, this is where the next instruction is often already sitting.
          </p>
          <SearchBox value={searchClients} onChange={setSearchClients} placeholder="Search client, sector, instructed on…" />
          <div className="filter-row">
            {myPermissions.usePartnerFilters && (
              <select value={filterClientsPartner} onChange={(e) => setFilterClientsPartner(e.target.value)}>
                <option value="all">All partners</option>
                {store.partners.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}
            <button type="button" className="mini-btn" onClick={() => setImportClientsOpen(true)}>📄 Import clients</button>
            {canExport && (
              <button
                type="button"
                className="mini-btn"
                disabled={exportingType === "client"}
                onClick={() => { setExportingType("client"); exportEntityToXlsx("client", store).finally(() => setExportingType(null)); }}
              >
                {exportingType === "client" ? "Exporting…" : "⬇ Export clients"}
              </button>
            )}
            {myPermissions.seeMetrics && (
              <span className="list-count">{visibleClients.length} client{visibleClients.length === 1 ? "" : "s"}</span>
            )}
          </div>
          <div className="card-list">
            {store.clients.length === 0 && <p className="empty">No clients logged yet.</p>}
            {visibleClients
              .map((c) => {
                const owner = store.partners.find((x) => x.id === c.responsiblePartner);
                const stale = c.lastContact && daysBetween(c.lastContact, todayISO()) >= 60;
                const unseen = clientActivityCount(c) - (store.seenClients[c.id] || 0);
                const impact = referralImpact("client", c.id, store);
                return (
                  <button key={c.id} className="card" onClick={() => setOpenClient(c)}>
                    <div className="card-top">
                      <span className="org">{c.name}</span>
                    </div>
                    <div className="card-meta">
                      {c.sector && <Pill>{c.sector}</Pill>}
                      {owner && <Pill tone="owner">{owner.name}</Pill>}
                      {c.hasRetainer && <Pill tone="score">Retainer</Pill>}
                      {c.origin && <Pill tone="owner">Via {c.origin}</Pill>}
                      <UpdateBadge count={unseen} />
                      {myPermissions.seeMetrics && impact.count > 0 && (
                        <button
                          type="button"
                          className="referral-badge"
                          onClick={(e) => { e.stopPropagation(); setOpenReferralImpact({ kind: "client", record: c }); }}
                        >
                          🤝 {impact.count} referred
                        </button>
                      )}
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
        );
      })()}

      {tab === "referrals" && (() => {
        const visibleReferrals = store.referrals
          .filter((r) => matchesSearch(searchReferrals, [r.name, r.type, ...(Array.isArray(r.practiceFed) ? r.practiceFed : [r.practiceFed])]))
          .filter((r) => filterReferralsPartner === "all" || r.responsiblePartner === filterReferralsPartner)
          .slice()
          .sort((a, b) => (a.lastContact || "") < (b.lastContact || "") ? -1 : 1);
        return (
        <main className="content">
          <p className="section-intro">
            Your fastest source of business — people who already advise your clients. Aim to review any contact silent for 30+ days.
          </p>
          <SearchBox value={searchReferrals} onChange={setSearchReferrals} placeholder="Search name, type, practice fed…" />
          <div className="filter-row">
            {myPermissions.usePartnerFilters && (
              <select value={filterReferralsPartner} onChange={(e) => setFilterReferralsPartner(e.target.value)}>
                <option value="all">All partners</option>
                {store.partners.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}
            <button type="button" className="mini-btn" onClick={() => setImportReferralsOpen(true)}>📄 Import referral partners</button>
            {canExport && (
              <button
                type="button"
                className="mini-btn"
                disabled={exportingType === "referral"}
                onClick={() => { setExportingType("referral"); exportEntityToXlsx("referral", store).finally(() => setExportingType(null)); }}
              >
                {exportingType === "referral" ? "Exporting…" : "⬇ Export referral partners"}
              </button>
            )}
            {myPermissions.seeMetrics && (
              <span className="list-count">{visibleReferrals.length} referral partner{visibleReferrals.length === 1 ? "" : "s"}</span>
            )}
          </div>
          <div className="card-list">
            {store.referrals.length === 0 && <p className="empty">No referral partners logged yet.</p>}
            {visibleReferrals
              .map((r) => {
                const silent = r.lastContact && daysBetween(r.lastContact, todayISO()) >= 30;
                const unseen = referralActivityCount(r) - (store.seenReferrals[r.id] || 0);
                const owner = store.partners.find((p) => p.id === r.responsiblePartner);
                const impact = referralImpact("referral", r.id, store);
                const practiceFedTags = Array.isArray(r.practiceFed) ? r.practiceFed : (r.practiceFed ? [r.practiceFed] : []);
                return (
                  <button key={r.id} className="card" onClick={() => setOpenReferral(r)}>
                    <div className="card-top">
                      <span className="org">{referralDisplayName(r)}</span>
                    </div>
                    <div className="card-meta">
                      {r.type && <Pill>{r.type}</Pill>}
                      {practiceFedTags.map((tag) => <Pill key={tag} tone="owner">{tag}</Pill>)}
                      {owner && <Pill tone="owner">{owner.name}</Pill>}
                      <UpdateBadge count={unseen} />
                      {myPermissions.seeMetrics && impact.count > 0 && (
                        <button
                          type="button"
                          className="referral-badge"
                          onClick={(e) => { e.stopPropagation(); setOpenReferralImpact({ kind: "referral", record: r }); }}
                        >
                          🤝 {impact.count} referred
                        </button>
                      )}
                    </div>
                    {silent && <div className="flags"><span className="flag flag-amber">Silent 30+ days</span></div>}
                  </button>
                );
              })}
          </div>
          <button className="fab" onClick={() => { setReferralPrefill(""); setOpenReferral(null); }}>+ Referral partner</button>
        </main>
        );
      })()}

      {tab === "scorecard" && (
        <Scorecard
          store={store}
          me={me}
          myPartner={myPartner}
          canViewByPartner={myPermissions.seeScorecardByPartner}
          canSeeMetrics={myPermissions.seeMetrics}
          canSeeAmounts={myPermissions.seeAmounts}
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

      {tab === "insights" && myPermissions.seeInsights && <Insights store={store} />}

      {openProspect !== undefined && (
        <ProspectModal
          prospect={openProspect}
          partners={store.partners}
          referrals={store.referrals}
          clients={store.clients}
          prospects={store.prospects}
          tenders={store.tenders}
          activity={store.activity}
          practices={store.practices}
          sectors={store.sectors}
          occupations={occupationSuggestions}
          organizations={orgSuggestions}
          positions={positionSuggestionsList}
          nextActionSuggestions={prospectNextActionSuggestions}
          permissions={myPermissions}
          me={me}
          prefillOrg={prospectPrefill}
          onSave={store.saveProspect}
          onDelete={store.deleteProspect}
          onClose={() => { setOpenProspect(undefined); setProspectPrefill(""); }}
          markSeen={store.markProspectSeen}
          getDayLoad={getDayLoad}
        />
      )}

      {importProspectsOpen && (
        <ImportModal
          entityType="prospect"
          existingItems={store.prospects}
          me={me}
          onImport={store.bulkImportProspects}
          onClose={() => setImportProspectsOpen(false)}
        />
      )}

      {openClient !== undefined && (
        <ClientModal
          item={openClient}
          partners={store.partners}
          sectors={store.sectors}
          occupations={occupationSuggestions}
          prospects={store.prospects}
          positions={positionSuggestionsList}
          nextActionSuggestions={clientNextActionSuggestions}
          permissions={myPermissions}
          me={me}
          prefillName={clientPrefill}
          onSave={store.saveClient}
          onDelete={store.deleteClient}
          onLogNewWork={(name) => {
            setProspectPrefill(name);
            setOpenProspect(null);
            setOpenClient(undefined);
            setClientPrefill("");
          }}
          onClose={() => { setOpenClient(undefined); setClientPrefill(""); }}
          markSeen={store.markClientSeen}
          getDayLoad={getDayLoad}
        />
      )}

      {importClientsOpen && (
        <ImportModal
          entityType="client"
          existingItems={store.clients}
          me={me}
          onImport={store.bulkImportClients}
          onClose={() => setImportClientsOpen(false)}
        />
      )}

      {openReferral !== undefined && (
        <ReferralModal
          item={openReferral}
          prefillName={referralPrefill}
          partners={store.partners}
          practices={store.practices}
          referralTypes={store.referralTypes}
          nextActionSuggestions={referralNextActionSuggestions}
          me={me}
          onSave={store.saveReferral}
          onDelete={store.deleteReferral}
          onClose={() => { setOpenReferral(undefined); setReferralPrefill(""); }}
          markSeen={store.markReferralSeen}
          getDayLoad={getDayLoad}
        />
      )}

      {importReferralsOpen && (
        <ImportModal
          entityType="referral"
          existingItems={store.referrals}
          me={me}
          onImport={store.bulkImportReferrals}
          onClose={() => setImportReferralsOpen(false)}
        />
      )}

      {openTender !== undefined && (
        <TenderModal
          tender={openTender}
          partners={store.partners}
          clients={store.clients}
          prospects={store.prospects}
          nextActionSuggestions={tenderNextActionSuggestions}
          permissions={myPermissions}
          me={me}
          prefillTitle={tenderPrefill}
          onSave={store.saveTender}
          onDelete={store.deleteTender}
          onAutoCreateClient={(name) => {
            store.saveClient({
              id: uid(),
              name,
              clientType: "Institutional",
              contact: "",
              position: "",
              sector: "",
              instructedOn: "",
              potentialNeeds: "",
              responsiblePartner: me,
              origin: "Empanelment",
              contactPhone: "",
              contactEmail: "",
              hasRetainer: false,
              retainerAmount: "",
              retainerFrequency: "Monthly",
              retainerRenewalDate: "",
              lastContact: todayISO(),
              nextAction: "",
              nextActionDate: "",
              notes: "",
              notesHistory: [],
            });
          }}
          onLogNewWork={(name) => {
            setProspectPrefill(name);
            setOpenProspect(null);
            setOpenTender(undefined);
            setTenderPrefill("");
          }}
          onAddAsWonProspect={(t) => {
            store.saveProspect({
              id: uid(),
              organization: t.procuringEntity,
              contact: "",
              position: "",
              contactPhone: "",
              contactEmail: "",
              sector: "",
              practiceArea: "",
              clientType: "Institutional",
              opportunity: t.title,
              estimatedFee: t.estimatedValue,
              agreedValue: "",
              source: "Tender",
              sourceDetailId: t.id,
              relationshipStrength: "Strong",
              lastContact: todayISO(),
              nextAction: "",
              nextActionDate: "",
              responsiblePartner: t.responsiblePartner,
              probability: 100,
              status: "won",
              archived: false,
              payments: [],
              notes: "",
              notesHistory: [],
              statusHistory: [{ kind: "stage", stage: "won", date: todayISO(), partnerId: me }],
            });
          }}
          onClose={() => { setOpenTender(undefined); setTenderPrefill(""); }}
          markSeen={store.markTenderSeen}
          getDayLoad={getDayLoad}
        />
      )}

      {openReferralImpact !== undefined && (
        <ReferralImpactPanel
          kind={openReferralImpact.kind}
          record={openReferralImpact.record}
          store={store}
          onOpenProspect={(p) => { setOpenReferralImpact(undefined); setOpenProspect(p); }}
          onClose={() => setOpenReferralImpact(undefined)}
        />
      )}
    </div>
  );
}

const KIND_LABEL = { prospect: "Prospect", client: "Client", tender: "Tender", referral: "Referral", retainer: "Retainer" };

function Reminders({ store, me, permissions = ROLE_PERMISSIONS.partner, setOpenProspect, setOpenClient, setOpenTender, setOpenReferral, setProspectPrefill }) {
  const [filterPartner, setFilterPartner] = useState("all");
  const [dayFilter, setDayFilter] = useState(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(monthKey());
  const withDiff = collectReminders(store)
    .filter((item) => filterPartner === "all" || item.ownerId === filterPartner)
    .map((item) => ({ ...item, diff: daysBetween(item.date, todayISO()) }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const visibleRows = dayFilter ? withDiff.filter((x) => x.date === dayFilter) : withDiff;
  const overdue = visibleRows.filter((x) => x.diff > 0);
  const today = visibleRows.filter((x) => x.diff === 0);
  const week = visibleRows.filter((x) => x.diff < 0 && x.diff >= -7);
  const later = visibleRows.filter((x) => x.diff < -7);

  const openFor = (item) => {
    if (item.kind === "prospect") setOpenProspect(item.ref);
    else if (item.kind === "client" || item.kind === "retainer") setOpenClient(item.ref);
    else if (item.kind === "tender") setOpenTender(item.ref);
    else if (item.kind === "referral") setOpenReferral(item.ref);
  };

  const markDone = (item) => {
    const entry = { kind: "action", text: item.action, date: todayISO(), partnerId: me };
    if (item.kind === "prospect") {
      const statusHistory = [...(item.ref.statusHistory || []), entry];
      store.saveProspect({ ...item.ref, nextAction: "", nextActionDate: "", statusHistory });
      store.markProspectSeen(item.ref.id, statusHistory.length + (item.ref.notesHistory?.length || 0));
    } else if (item.kind === "tender") {
      const stageHistory = [...(item.ref.stageHistory || []), entry];
      store.saveTender({ ...item.ref, nextAction: "", nextActionDate: "", stageHistory });
      store.markTenderSeen(item.ref.id, stageHistory.length + (item.ref.notesHistory?.length || 0));
    } else if (item.kind === "client") {
      const noteEntry = { text: `Done: ${item.action}`, date: todayISO(), partnerId: me };
      const notesHistory = [...(item.ref.notesHistory || []), noteEntry];
      store.saveClient({ ...item.ref, nextAction: "", nextActionDate: "", notesHistory });
      store.markClientSeen(item.ref.id, notesHistory.length);
    } else if (item.kind === "referral") {
      store.saveReferral({ ...item.ref, nextAction: "", nextActionDate: "" });
    } else if (item.kind === "retainer") {
      const noteEntry = { text: `Renewed retainer — next renewal pushed forward.`, date: todayISO(), partnerId: me };
      const notesHistory = [...(item.ref.notesHistory || []), noteEntry];
      store.saveClient({ ...item.ref, retainerRenewalDate: advanceRetainerDate(item.date, item.ref.retainerFrequency), notesHistory });
      store.markClientSeen(item.ref.id, notesHistory.length);
    }
  };

  const reschedule = (item, newDate) => {
    if (!newDate) return;
    if (item.kind === "retainer") {
      store.saveClient({ ...item.ref, retainerRenewalDate: newDate });
      return;
    }
    const updated = { ...item.ref, nextActionDate: newDate };
    if (item.kind === "prospect") store.saveProspect(updated);
    else if (item.kind === "tender") store.saveTender(updated);
    else if (item.kind === "client") store.saveClient(updated);
    else if (item.kind === "referral") store.saveReferral(updated);
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
                onReschedule={(newDate) => reschedule(item, newDate)}
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
      <div className="filter-row">
        {permissions.usePartnerFilters && (
          <select value={filterPartner} onChange={(e) => setFilterPartner(e.target.value)}>
            <option value="all">All partners</option>
            {store.partners.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}
      </div>
      <button type="button" className="voice-fill-trigger" onClick={() => setCalendarOpen((o) => !o)}>
        {calendarOpen ? "− Hide calendar" : "📅 View calendar"}
      </button>
      {calendarOpen && (
        <div className="cal-panel">
          <div className="month-nav">
            <button className="icon-btn" onClick={() => setCalendarMonth(shiftMonthKey(calendarMonth, -1))} aria-label="Previous month">‹</button>
            <span className="month-nav-label">{monthLabel(calendarMonth)}</span>
            <button className="icon-btn" onClick={() => setCalendarMonth(shiftMonthKey(calendarMonth, 1))} aria-label="Next month">›</button>
          </div>
          <div className="cal-weekday-row">
            {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <span key={i}>{d}</span>)}
          </div>
          {buildMonthGrid(calendarMonth).map((week, wi) => (
            <div key={wi} className="cal-week">
              {week.map((date, di) => {
                if (!date) return <span key={di} className="cal-cell cal-cell-empty" />;
                const count = withDiff.filter((x) => x.date === date).length;
                const isToday = date === todayISO();
                const active = dayFilter === date;
                return (
                  <button
                    key={di}
                    type="button"
                    className={`cal-cell ${isToday ? "cal-cell-today" : ""} ${active ? "cal-cell-active" : ""}`}
                    onClick={() => { setDayFilter(active ? null : date); setCalendarOpen(false); }}
                  >
                    <span className="cal-cell-num">{Number(date.slice(-2))}</span>
                    {count > 0 && <span className={`cal-cell-count ${count >= 3 ? "cal-cell-count-hot" : ""}`}>{count}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
      {dayFilter && (
        <div className="filter-row">
          <span className="active-filter-chip">
            Showing {dayFilter} only
            <button type="button" onClick={() => setDayFilter(null)}>✕ Clear</button>
          </span>
        </div>
      )}
      {visibleRows.length === 0 && (
        <p className="empty">
          {dayFilter
            ? "Nothing due that day."
            : filterPartner === "all"
            ? "Nothing due. Add a next action date to any prospect, client, tender, or referral partner to see it here."
            : "Nothing due for this partner right now."}
        </p>
      )}
      <Group title="Overdue" rows={overdue} tone="red" />
      <Group title="Due today" rows={today} tone="amber" />
      <Group title="This week" rows={week} />
      <Group title="Later" rows={later} />
      <WatchlistPanel store={store} me={me} setOpenProspect={setOpenProspect} setProspectPrefill={setProspectPrefill} />
    </main>
  );
}

function WatchlistItemCard({ item, onRemove, onPromote, onReschedule }) {
  const [rescheduling, setRescheduling] = useState(false);
  const [newDate, setNewDate] = useState(item.checkBackDate || todayISO());
  const dueForCheckBack = item.checkBackDate && item.checkBackDate <= todayISO();

  return (
    <div className="watchlist-item">
      <div className="watchlist-item-top">
        <span className="org">{item.organization}</span>
        <ConfirmButton className="icon-btn" ariaLabel="Remove" onConfirm={onRemove}>✕</ConfirmButton>
      </div>
      {item.industry && <Pill>{item.industry}</Pill>}
      {item.note && <p className="watchlist-note">{item.note}</p>}
      {item.checkBackDate && !rescheduling && (
        <span className={`watchlist-checkback ${dueForCheckBack ? "watchlist-checkback-due" : ""}`}>
          {dueForCheckBack ? "Check back — " : "Check back "}{item.checkBackDate}
        </span>
      )}
      {!rescheduling && (
        <div className="watchlist-item-actions">
          <button type="button" className="chip-btn" onClick={onPromote}>→ Promote to prospect</button>
          <button
            type="button"
            className="chip-btn chip-ghost"
            onClick={() => { setNewDate(item.checkBackDate || todayISO()); setRescheduling(true); }}
          >
            {item.checkBackDate ? "↻ Reschedule" : "+ Set check-back date"}
          </button>
        </div>
      )}
      {rescheduling && (
        <div className="reschedule-row">
          <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
          <button type="button" className="chip-btn" onClick={() => { onReschedule(newDate); setRescheduling(false); }}>Save</button>
          <button type="button" className="chip-btn chip-ghost" onClick={() => setRescheduling(false)}>Cancel</button>
        </div>
      )}
    </div>
  );
}

function WatchlistPanel({ store, me, setOpenProspect, setProspectPrefill }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  const [note, setNote] = useState("");
  const [checkBackDate, setCheckBackDate] = useState("");
  const items = [...(store.watchlist[me] || [])].sort((a, b) => {
    if (a.checkBackDate && b.checkBackDate) return a.checkBackDate < b.checkBackDate ? -1 : 1;
    if (a.checkBackDate) return -1;
    if (b.checkBackDate) return 1;
    return a.date < b.date ? -1 : 1;
  });

  const add = () => {
    if (!name.trim()) return;
    store.addWatchlistItem(me, name.trim(), note.trim(), industry.trim(), checkBackDate);
    setName("");
    setIndustry("");
    setNote("");
    setCheckBackDate("");
  };

  const promote = (item) => {
    setProspectPrefill(item.organization);
    setOpenProspect(null);
    store.removeWatchlistItem(me, item.id);
  };

  const dueCount = items.filter((i) => i.checkBackDate && i.checkBackDate <= todayISO()).length;

  return (
    <section className="watchlist-panel">
      <button type="button" className="watchlist-head" onClick={() => setOpen((o) => !o)}>
        <span>
          🕵️ My Watchlist
          {items.length > 0 && <span className="watchlist-count">{items.length}</span>}
          {dueCount > 0 && <span className="watchlist-count watchlist-count-due">{dueCount} due</span>}
        </span>
        <span className="collapsible-caret">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="watchlist-body">
          <p className="insight-note">
            Private to you — names here don't show up to other partners, aren't part of Reminders' pressure, and don't touch the Scorecard or leaderboard. Somewhere to park a name before it's real. The moment you've actually made contact, promote it — that's when it should start carrying weight.
          </p>
          {items.length === 0 && <p className="empty">Nobody on your watchlist yet.</p>}
          <div className="card-list">
            {items.map((item) => (
              <WatchlistItemCard
                key={item.id}
                item={item}
                onRemove={() => store.removeWatchlistItem(me, item.id)}
                onPromote={() => promote(item)}
                onReschedule={(newDate) => store.updateWatchlistItem(me, item.id, { checkBackDate: newDate })}
              />
            ))}
          </div>
          <div className="watchlist-add">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Organization or person" />
            <input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="Industry (optional)" />
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note to yourself (optional)" />
            <label className="watchlist-checkback-field">
              <span>Check back on (optional, private only)</span>
              <input type="date" value={checkBackDate} onChange={(e) => setCheckBackDate(e.target.value)} />
            </label>
            <button type="button" className="chip-btn" onClick={add}>+ Add to watchlist</button>
          </div>
        </div>
      )}
    </section>
  );
}

function ImportModal({ entityType, existingItems, me, onImport, onClose }) {
  const config = IMPORT_ENTITY_CONFIGS[entityType];
  const [stage, setStage] = useState("upload");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState("");
  const [rawRows, setRawRows] = useState(null);
  const [mapping, setMapping] = useState({});
  const [imported, setImported] = useState(0);

  const handleFile = async (file) => {
    setError("");
    setLoading(true);
    setFileName(file.name);
    try {
      const ext = file.name.split(".").pop().toLowerCase();
      let rows;
      if (["xlsx", "xls", "csv"].includes(ext)) {
        rows = await parseSpreadsheetFile(file);
      } else if (ext === "docx") {
        rows = await parseDocxTable(file);
        if (!rows) {
          setError("No table found in this document. Bideey can only reliably pull structured data out of an actual table — try exporting the list as a spreadsheet (.xlsx or .csv) instead.");
          setLoading(false);
          return;
        }
      } else {
        setError("Unsupported file type. Please upload a .csv, .xlsx, .xls, or .docx file with a table.");
        setLoading(false);
        return;
      }
      rows = rows.filter((r) => r.some((cell) => String(cell || "").trim()));
      if (rows.length < 2) {
        setError("Couldn't find any data rows below the header row.");
        setLoading(false);
        return;
      }
      const guess = {};
      rows[0].forEach((h, i) => {
        const guessed = config.guessMapping(normalizeImportKey(h));
        if (guessed) guess[i] = guessed;
      });
      setMapping(guess);
      setRawRows(rows);
      setStage("mapping");
    } catch (e) {
      setError("Couldn't read that file — " + (e.message || "it may be corrupted or in an unsupported format."));
    }
    setLoading(false);
  };

  const headers = useMemo(() => (rawRows ? rawRows[0] : []), [rawRows]);
  const dataRows = useMemo(() => (rawRows ? rawRows.slice(1) : []), [rawRows]);
  const nameColIndex = Object.keys(mapping).find((i) => mapping[i] === config.nameKey);

  const preview = useMemo(() => {
    if (!rawRows || nameColIndex === undefined) return null;
    const existingNames = new Set((existingItems || []).map((item) => (item[config.nameKey] || "").trim().toLowerCase()));
    const toCreate = [];
    const skippedNoName = [];
    const skippedDuplicate = [];

    dataRows.forEach((row) => {
      const obj = config.buildDefaults(me);
      Object.entries(mapping).forEach(([colIdx, fieldKey]) => {
        if (!fieldKey) return;
        config.applyField(obj, fieldKey, (row[colIdx] || "").toString().trim());
      });
      if (obj.notes && !(obj.notesHistory || []).length) {
        obj.notesHistory = [{ date: todayISO(), text: obj.notes, partnerId: me || null }];
      }
      if (!obj[config.nameKey]) {
        skippedNoName.push(row);
        return;
      }
      if (existingNames.has(obj[config.nameKey].trim().toLowerCase())) {
        skippedDuplicate.push(obj[config.nameKey]);
        return;
      }
      toCreate.push(obj);
    });

    return { toCreate, skippedNoName, skippedDuplicate };
  }, [config, dataRows, existingItems, mapping, me, nameColIndex, rawRows]);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h3>{config.title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="sheet-body">
          {stage === "upload" && (
            <>
              <p className="insight-note">
                Upload a spreadsheet of your existing {config.labelPlural}. You will map the columns and preview exactly what will be created before anything is saved.
              </p>
              <div className="filter-row" style={{ marginTop: 10 }}>
                <button type="button" className="mini-btn" onClick={() => downloadCsv(config.templateName, config.sampleRows)}>
                  ⬇ Download sample CSV
                </button>
              </div>
              <label className="voice-fill-trigger" style={{ display: "block", textAlign: "center", cursor: "pointer" }}>
                {loading ? "Reading file…" : "📄 Choose a file to import"}
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv,.docx"
                  style={{ display: "none" }}
                  onChange={(e) => e.target.files[0] && handleFile(e.target.files[0])}
                  disabled={loading}
                />
              </label>
              {error && <p className="save-error">⚠️ {error}</p>}
              <p className="insight-note" style={{ marginTop: 10 }}>
                Start from the sample CSV if you want the fastest path. You can also upload a .docx file if the details are in a real table. Missing optional details are fine; you can fill them in later.
              </p>
            </>
          )}

          {stage === "mapping" && rawRows && (
            <>
              <p className="insight-note">
                Match each column in <strong>{fileName}</strong> to the right Bideey field. The name column is required.
              </p>
              {headers.map((h, i) => (
                <div className="row2" key={i}>
                  <Field label={`Column: "${h || `Column ${i + 1}`}"`}>
                    <input value={dataRows[0]?.[i] || ""} disabled />
                  </Field>
                  <Field label="Maps to">
                    <select value={mapping[i] || ""} onChange={(e) => setMapping({ ...mapping, [i]: e.target.value })}>
                      {config.fieldOptions.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                    </select>
                  </Field>
                </div>
              ))}
              {nameColIndex === undefined && <p className="save-error">⚠️ Map one column to the required name field to continue.</p>}
              <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                <button className="btn btn-ghost" onClick={() => { setStage("upload"); setRawRows(null); }}>← Choose a different file</button>
                <button className="btn btn-primary" disabled={nameColIndex === undefined} onClick={() => setStage("preview")}>
                  Review {dataRows.length} rows →
                </button>
              </div>
            </>
          )}

          {stage === "preview" && preview && (
            <>
              <div className="stat-grid" style={{ marginBottom: 14 }}>
                <div className="stat">
                  <span className="stat-value">{preview.toCreate.length}</span>
                  <span className="stat-label">New {config.labelPlural} will be created</span>
                </div>
                <div className="stat">
                  <span className="stat-value">{preview.skippedDuplicate.length}</span>
                  <span className="stat-label">Duplicates skipped</span>
                </div>
              </div>
              {preview.skippedNoName.length > 0 && (
                <p className="insight-note">{preview.skippedNoName.length} row{preview.skippedNoName.length === 1 ? "" : "s"} had no name and will be skipped.</p>
              )}
              {preview.skippedDuplicate.length > 0 && (
                <p className="insight-note">
                  Already in Bideey: {preview.skippedDuplicate.slice(0, 6).join(", ")}{preview.skippedDuplicate.length > 6 ? `, +${preview.skippedDuplicate.length - 6} more` : ""}.
                </p>
              )}
              <div className="history-list">
                {preview.toCreate.slice(0, 8).map((item) => (
                  <div key={item.id} className="note-row">
                    <div className="note-text">{item[config.nameKey]}</div>
                    <div className="history-meta">
                      {[item.organization, item.institution, item.sector, item.contact, item.contactEmail, item.email].filter((x) => x && x !== item[config.nameKey]).join(" · ") || "No other details on this row"}
                    </div>
                  </div>
                ))}
                {preview.toCreate.length > 8 && <p className="insight-note">+{preview.toCreate.length - 8} more…</p>}
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
                <button className="btn btn-ghost" onClick={() => setStage("mapping")}>← Back to mapping</button>
                <button
                  className="btn btn-primary"
                  disabled={preview.toCreate.length === 0}
                  onClick={() => {
                    onImport(preview.toCreate);
                    setImported(preview.toCreate.length);
                    setStage("done");
                  }}
                >
                  Import {preview.toCreate.length} {preview.toCreate.length === 1 ? config.label : config.labelPlural}
                </button>
              </div>
            </>
          )}

          {stage === "done" && (
            <>
              <p className="insight-note">
                ✓ {imported} {imported === 1 ? config.label : config.labelPlural} imported. You can fill in anything missing from each record later.
              </p>
              <button className="btn btn-primary" onClick={onClose}>Done</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function LogActivityModal({ activityType, store, me, onClose }) {
  const [query, setQuery] = useState("");
  const [suggestOpen, setSuggestOpen] = useState(true);
  const [firmName, setFirmName] = useState("");
  const [firmIndustry, setFirmIndustry] = useState("");
  const [cost, setCost] = useState(String(store.activityCosts[activityType.key] ?? 0));
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
    store.logActivity(me, activityType.key, subject, cost);
    const newAllTimeCount = store.activity.filter((a) => a.type === activityType.key).length + 1;
    store.markActivityTypeSeen(activityType.key, newAllTimeCount);
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
                  onChange={(e) => { setQuery(e.target.value); setSuggestOpen(true); }}
                  placeholder={source ? "Start typing..." : "e.g. topic, event name..."}
                />
              </Field>
              {source && suggestOpen && filtered.length > 0 && (
                <div className="suggest-list">
                  {filtered.map((o) => (
                    <button
                      key={`${o.tag}-${o.id}`}
                      className="suggest-row"
                      onClick={() => { setQuery(o.label); setSuggestOpen(false); }}
                    >
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
          <Field label="Estimated cost (KES, optional)">
            <input type="number" min="0" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0" />
          </Field>
          <p className="insight-note">
            Pre-filled from the firm's standard estimate for {activityType.label.toLowerCase()} — adjust it if this one cost more or less. Change the default in ⚙️ Settings → Cost of BD.
          </p>
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

const CHART_GOLD = "#C89B3C";
const CHART_NAVY = "#0B2A4A";

function Insights({ store }) {
  const [scope, setScope] = useState("firm"); // "firm" | "partner"
  const [selectedPartner, setSelectedPartner] = useState("all"); // "all" | partnerId
  const isCompareAll = scope === "partner" && selectedPartner === "all";
  const isDrilldown = scope === "partner" && selectedPartner !== "all";
  const drilldownPartner = isDrilldown ? store.partners.find((p) => p.id === selectedPartner) : null;

  const prospects = isDrilldown ? store.prospects.filter((p) => p.responsiblePartner === selectedPartner) : store.prospects;
  const scopedActivity = isDrilldown ? store.activity.filter((a) => a.partnerId === selectedPartner) : store.activity;

  // --- Universal (all-time, cumulative) vs a specific month ---
  const [viewMonth, setViewMonth] = useState("all"); // "all" | "YYYY-MM"
  const isAllTime = viewMonth === "all";
  // Did a prospect reach a stage within the current view — "ever" for the cumulative view,
  // "during this specific month" once a month is picked.
  const reachedInScope = (p, stageKey) => (isAllTime ? everReachedStage(p, stageKey) : reachedStageInMonth(p, stageKey, viewMonth));
  const isWonInScope = (p) => (isAllTime ? p.status === "won" : reachedStageInMonth(p, "won", viewMonth));
  const isLostInScope = (p) => (isAllTime ? p.status === "lost" : reachedStageInMonth(p, "lost", viewMonth));
  const isDecidedInScope = (p) => isWonInScope(p) || isLostInScope(p);

  // --- Top-line numbers ---
  const livePipelineValue = prospects
    .filter((p) => !["won", "lost"].includes(p.status))
    .reduce((a, p) => a + (Number(p.estimatedFee) || 0), 0);
  const wonInScopeValue = prospects.filter(isWonInScope).reduce((a, p) => a + effectiveDealValue(p), 0);
  // Collected is scoped by WHEN the payment landed, not when the deal was won — a payment logged
  // this month counts here even if the deal itself was won three months ago. That lag is the whole
  // point of tracking this separately from wonInScopeValue.
  const collectedInScopeValue = prospects.reduce((sum, p) => {
    const paymentsInScope = (p.payments || []).filter((pmt) => isAllTime || monthKey(pmt.date) === viewMonth);
    return sum + paymentsInScope.reduce((a, pmt) => a + (Number(pmt.amount) || 0), 0);
  }, 0);
  // Outstanding is always a right-now snapshot across every won deal, never scoped by month — it
  // doesn't make sense to ask "what was outstanding in March," only "what's outstanding now."
  const totalOutstanding = prospects
    .filter((p) => p.status === "won")
    .reduce((sum, p) => sum + Math.max(0, effectiveDealValue(p) - paymentsReceived(p)), 0);

  // Retainers and empanelments are ongoing relationships, not one-off deals — they don't have a
  // single "won" moment, so they're deliberately computed as right-now snapshots (same category as
  // Live pipeline value), not scoped by the all-time/by-month toggle above.
  const clientsInScope = isDrilldown ? store.clients.filter((c) => c.responsiblePartner === selectedPartner) : store.clients;
  const tendersInScope = isDrilldown ? store.tenders.filter((t) => t.responsiblePartner === selectedPartner) : store.tenders;
  const retainerClients = clientsInScope.filter((c) => c.hasRetainer);
  const mrr = retainerClients.reduce((sum, c) => {
    const amt = Number(c.retainerAmount) || 0;
    return sum + (c.retainerFrequency === "Annual" ? amt / 12 : amt);
  }, 0);
  const activeEmpanelments = tendersInScope.filter((t) => t.kind === "empanelment" && t.stage === "result");
  const empanelmentsInProgress = tendersInScope.filter((t) => t.kind === "empanelment" && t.stage !== "result");

  const reachedProposal = prospects.filter((p) => reachedInScope(p, "proposal_submitted")).length;
  const wonCount = prospects.filter(isWonInScope).length;
  const winRate = reachedProposal > 0 ? Math.round((wonCount / reachedProposal) * 100) : null;

  // --- Cost of BD — what's actually being spent, and what it's buying. Out-of-pocket only, scoped
  // to the same all-time/month view as the rest of the page. Framed as a firm/self-reflection number,
  // deliberately never surfaced as a ranked comparison across partners.
  const costScopedActivity = isAllTime ? scopedActivity : scopedActivity.filter((a) => monthKey(a.date) === viewMonth);
  const totalCost = costScopedActivity.reduce((a, x) => a + (Number(x.cost) || 0), 0);
  const costByType = ACTIVITY_TYPES.map((t) => ({
    label: t.label,
    cost: costScopedActivity.filter((a) => a.type === t.key).reduce((a, x) => a + (Number(x.cost) || 0), 0),
  })).filter((r) => r.cost > 0).sort((a, b) => b.cost - a.cost);
  const costPerWin = wonCount > 0 ? Math.round(totalCost / wonCount) : null;
  const costAsShareOfWon = wonInScopeValue > 0 ? Math.round((totalCost / wonInScopeValue) * 1000) / 10 : null;

  // --- Won value by month, last 6 months ---
  const monthKeys = [];
  let mk = monthKey();
  for (let i = 0; i < 6; i++) { monthKeys.unshift(mk); mk = shiftMonthKey(mk, -1); }
  const wonByMonth = monthKeys.map((k) => {
    const value = prospects.reduce((sum, p) => {
      const hist = p.statusHistory || [];
      const wonThisMonth = hist.some((h) => h.kind === "stage" && h.stage === "won" && monthKey(h.date) === k);
      const legacyFallback = hist.length === 0 && p.status === "won" && k === monthKey();
      return wonThisMonth || legacyFallback ? sum + effectiveDealValue(p) : sum;
    }, 0);
    const collected = prospects.reduce((sum, p) => {
      const paymentsThisMonth = (p.payments || []).filter((pmt) => monthKey(pmt.date) === k);
      return sum + paymentsThisMonth.reduce((a, pmt) => a + (Number(pmt.amount) || 0), 0);
    }, 0);
    return { name: monthLabel(k).split(" ")[0], value, collected };
  });
  const avgMonthlyWon = wonByMonth.length ? wonByMonth.reduce((a, m) => a + m.value, 0) / wonByMonth.length : 0;
  const pipelineCoverageMonths = avgMonthlyWon > 0 ? livePipelineValue / avgMonthlyWon : null;

  // --- Activity discipline by month: logged touches vs. the Section 16 monthly targets ---
  const firmMonthlyTarget = ACTIVITY_TYPES.reduce((a, t) => a + (Number(store.activityTargets[t.key]) || 0), 0);
  const perPartnerTarget = store.partners.length ? firmMonthlyTarget / store.partners.length : firmMonthlyTarget;
  const activityByMonth = monthKeys.map((k) => {
    const logged = scopedActivity.filter((a) => monthKey(a.date) === k).length;
    const targetForScope = isDrilldown ? perPartnerTarget : firmMonthlyTarget;
    return { name: monthLabel(k).split(" ")[0], pct: targetForScope ? Math.round((logged / targetForScope) * 100) : 0, logged };
  });

  // --- Which logged activity types correlate with actually winning ---
  // Matches activity subjects to prospects by name (see activityMatchesProspect) — strongest for
  // touch-type activities where people log the org's name, weak for content-type ones (LinkedIn
  // posts, events) whose subject is a topic, not a company. Only counts prospects with a settled
  // outcome (won or lost) so still-open deals don't distort the rate either way.
  const correlationByType = ACTIVITY_TYPES.map((t) => {
    const withTouch = prospects.filter((p) => scopedActivity.some((a) => a.type === t.key && activityMatchesProspect(a, p)));
    const withTouchIds = new Set(withTouch.map((p) => p.id));
    const withoutTouch = prospects.filter((p) => !withTouchIds.has(p.id));
    const decided = (arr) => arr.filter(isDecidedInScope);
    const wonOf = (arr) => arr.filter(isWonInScope).length;
    const withDecided = decided(withTouch);
    const withoutDecided = decided(withoutTouch);
    return {
      type: t,
      rateWith: withDecided.length ? Math.round((wonOf(withDecided) / withDecided.length) * 100) : null,
      rateWithout: withoutDecided.length ? Math.round((wonOf(withoutDecided) / withoutDecided.length) * 100) : null,
      withN: withDecided.length,
      withoutN: withoutDecided.length,
    };
  })
    .filter((r) => r.withN > 0 || r.withoutN > 0)
    .sort((a, b) => (b.rateWith ?? -1) - (a.rateWith ?? -1));

  const thisMonthActivityAll = store.activity.filter((a) => monthKey(a.date) === monthKey());
  const fairSharePerPartner = store.partners.length ? firmMonthlyTarget / store.partners.length : 0;
  const activityByPartner = store.partners.map((p) => {
    const count = thisMonthActivityAll.filter((a) => a.partnerId === p.id).length;
    return { name: p.name, count };
  }).sort((a, b) => b.count - a.count);
  const totalActivityThisMonth = activityByPartner.reduce((a, p) => a + p.count, 0);


  // --- Won vs live pipeline by practice area ---
  const byPractice = store.practices.map((pa) => {
    const won = prospects.filter((p) => p.practiceArea === pa && isWonInScope(p)).reduce((a, p) => a + effectiveDealValue(p), 0);
    const pipeline = prospects.filter((p) => p.practiceArea === pa && !["won", "lost"].includes(p.status)).reduce((a, p) => a + (Number(p.estimatedFee) || 0), 0);
    return { name: pa.replace(" & ", " &\n"), Won: won, Pipeline: pipeline };
  }).filter((r) => r.Won > 0 || r.Pipeline > 0);

  // --- Won vs live pipeline by client type — individuals vs institutional/corporate business ---
  const byClientType = CLIENT_TYPES.map((ct) => {
    const won = prospects.filter((p) => (p.clientType || CLIENT_TYPES[0]) === ct && isWonInScope(p)).reduce((a, p) => a + effectiveDealValue(p), 0);
    const pipeline = prospects.filter((p) => (p.clientType || CLIENT_TYPES[0]) === ct && !["won", "lost"].includes(p.status)).reduce((a, p) => a + (Number(p.estimatedFee) || 0), 0);
    return { name: ct, Won: won, Pipeline: pipeline };
  }).filter((r) => r.Won > 0 || r.Pipeline > 0);

  // --- Source of business: volume ---
  // All-time view: every prospect counts toward its source. Scoped to a month: only prospects that
  // actually entered the pipeline (reached Target) that month count, so the chart reflects that
  // month's intake rather than the whole cumulative list every time.
  const sourceVolumeMap = {};
  prospects.forEach((p) => {
    if (!isAllTime && !reachedInScope(p, "target")) return;
    const key = p.source || "Unspecified";
    sourceVolumeMap[key] = (sourceVolumeMap[key] || 0) + 1;
  });
  const sourceRows = Object.entries(sourceVolumeMap)
    .map(([name, count]) => {
      const wonValue = prospects
        .filter((p) => (p.source || "Unspecified") === name && isWonInScope(p))
        .reduce((a, p) => a + effectiveDealValue(p), 0);
      return { name, count, wonValue };
    })
    .sort((a, b) => b.count - a.count);

  // --- Source of business: conversion ---
  // Independent of intake timing — this is about outcomes that landed in scope (won/lost during
  // the month, or ever, for all-time), regardless of when the prospect first showed up.
  const sourceConversionMap = {};
  prospects.filter(isDecidedInScope).forEach((p) => {
    const key = p.source || "Unspecified";
    if (!sourceConversionMap[key]) sourceConversionMap[key] = { name: key, won: 0, lost: 0 };
    if (isWonInScope(p)) sourceConversionMap[key].won += 1;
    if (isLostInScope(p)) sourceConversionMap[key].lost += 1;
  });
  // Conversion by source — of everything logged under this source, how much of it actually closed?
  // Only counts prospects with a settled outcome (won or lost) as "decided," so sources that are
  // still mostly sitting in an open pipeline don't get an artificially low or high rate.
  const conversionBySource = Object.values(sourceConversionMap)
    .map((s) => {
      const decided = s.won + s.lost;
      return { ...s, decided, rate: decided > 0 ? Math.round((s.won / decided) * 100) : null };
    })
    .filter((s) => s.decided > 0)
    .sort((a, b) => b.rate - a.rate);

  // Credit a won deal to the specific referral partner / firm partner / client / tender that
  // brought it in, where that was captured — falling back to the generic category otherwise.
  // Deliberately won-only: crediting a specific person or record for a deal that hasn't closed yet
  // would overstate their contribution.
  const resolveWonAttribution = (p) => {
    if (p.sourceDetailId) {
      if (p.source === "Referral") {
        const r = store.referrals.find((x) => x.id === p.sourceDetailId);
        if (r) return referralDisplayName(r);
      } else if (p.source === "Partner introduction") {
        const pt = store.partners.find((x) => x.id === p.sourceDetailId);
        if (pt) return pt.name;
      } else if (p.source === "Existing client") {
        const c = store.clients.find((x) => x.id === p.sourceDetailId);
        if (c) return c.name;
      } else if (p.source === "Tender") {
        const t = store.tenders.find((x) => x.id === p.sourceDetailId);
        if (t) return t.title;
      }
    }
    return p.source || "Unspecified";
  };
  const wonAttributionMap = {};
  prospects.filter(isWonInScope).forEach((p) => {
    const key = resolveWonAttribution(p);
    wonAttributionMap[key] = (wonAttributionMap[key] || 0) + effectiveDealValue(p);
  });
  const topSourcesByValue = Object.entries(wonAttributionMap)
    .map(([name, wonValue]) => ({ name, wonValue }))
    .sort((a, b) => b.wonValue - a.wonValue)
    .slice(0, 5);

  // --- Pipeline funnel (ever reached each stage, regardless of current status) ---
  const funnelStages = STAGES.filter((s) => s.key !== "lost");
  const funnel = funnelStages.map((s) => ({ label: s.label, count: prospects.filter((p) => reachedInScope(p, s.key)).length }));
  const funnelTop = funnel[0]?.count || 0;

  // --- Lost deals: how many, and how far they got before falling off ---
  const lostProspects = prospects.filter(isLostInScope);
  const lostValue = lostProspects.reduce((a, p) => a + (Number(p.estimatedFee) || 0), 0);
  const progressStages = STAGES.filter((s) => s.key !== "lost" && s.key !== "won");
  const lostByStage = {};
  lostProspects.forEach((p) => {
    const hist = (p.statusHistory || []).filter((h) => h.kind === "stage");
    let furthest = null;
    hist.forEach((h) => {
      const s = progressStages.find((x) => x.key === h.stage);
      if (s && (!furthest || s.n > furthest.n)) furthest = s;
    });
    const label = furthest ? furthest.label : "Unknown stage";
    lostByStage[label] = (lostByStage[label] || 0) + 1;
  });
  const lostByStageRows = progressStages
    .map((s) => ({ label: s.label, count: lostByStage[s.label] || 0 }))
    .concat(lostByStage["Unknown stage"] ? [{ label: "Unknown stage", count: lostByStage["Unknown stage"] }] : [])
    .filter((r) => r.count > 0);
  const lostByStageTop = Math.max(1, ...lostByStageRows.map((r) => r.count));

  // --- By responsible partner — always firm-wide, feeds the "compare all" leaderboard ---
  const byPartner = store.partners.map((partner) => {
    const mine = store.prospects.filter((p) => p.responsiblePartner === partner.id);
    const mineReachedProposal = mine.filter((p) => everReachedStage(p, "proposal_submitted")).length;
    const mineWonCount = mine.filter((p) => p.status === "won").length;
    return {
      id: partner.id,
      name: partner.name,
      pipeline: mine.filter((p) => !["won", "lost"].includes(p.status)).reduce((a, p) => a + (Number(p.estimatedFee) || 0), 0),
      won: mine.filter((p) => p.status === "won").reduce((a, p) => a + effectiveDealValue(p), 0),
      count: mine.length,
      winRate: mineReachedProposal > 0 ? Math.round((mineWonCount / mineReachedProposal) * 100) : null,
      activity: thisMonthActivityAll.filter((a) => a.partnerId === partner.id).length,
    };
  }).sort((a, b) => (b.pipeline + b.won) - (a.pipeline + a.won));

  // --- Where each partner's won business actually comes from — which tactic is working for whom ---
  const sourceByPartner = store.partners.map((partner) => {
    const mineWon = store.prospects.filter((p) => p.responsiblePartner === partner.id && p.status === "won");
    const bySource = {};
    mineWon.forEach((p) => {
      const key = p.source || "Unspecified";
      bySource[key] = (bySource[key] || 0) + effectiveDealValue(p);
    });
    const ranked = Object.entries(bySource).map(([source, value]) => ({ source, value })).sort((a, b) => b.value - a.value);
    const total = ranked.reduce((a, s) => a + s.value, 0);
    return { id: partner.id, name: partner.name, top: ranked[0] || null, rest: ranked.slice(1), total };
  });

  const chartTooltip = (v) => fmtKES(v);
  // Default Recharts tooltips only show the one series being hovered — this shows both the
  // prospect count and the won value for that source together, so you can see at a glance whether
  // a high-volume source is actually converting, not just how many prospects it's produced.
  const sourceTooltip = ({ active, payload }) => {
    if (!active || !payload || !payload.length) return null;
    const row = payload[0].payload;
    return (
      <div style={{ background: "#fff", border: "1px solid #E4DFD3", borderRadius: 8, padding: "8px 10px", fontSize: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 2 }}>{row.name}</div>
        <div>{row.count} prospect{row.count === 1 ? "" : "s"}</div>
        <div>{row.wonValue > 0 ? `${fmtKES(row.wonValue)} won` : "Nothing won yet"}</div>
      </div>
    );
  };

  return (
    <main className="content">
      <p className="section-intro">
        How the pipeline is actually behaving — where the money's coming from, where it's stuck, and what it's worth.
      </p>

      <div className="filter-row">
        <div className="seg">
          <button className={scope === "firm" ? "seg-active" : ""} onClick={() => { setScope("firm"); setSelectedPartner("all"); }}>Firm-wide</button>
          <button className={scope === "partner" ? "seg-active" : ""} onClick={() => setScope("partner")}>By partner</button>
        </div>
      </div>
      {scope === "partner" && (
        <div className="filter-row">
          <select value={selectedPartner} onChange={(e) => setSelectedPartner(e.target.value)}>
            <option value="all">Compare all partners</option>
            {store.partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      )}

      {isCompareAll ? (
        store.partners.length === 0 ? (
          <p className="empty">Add partners to compare performance across the firm.</p>
        ) : (
          <>
            <section className="insight-card">
              <h4>Partner leaderboard</h4>
              <p className="insight-note">Ranked by pipeline + won value combined. A friendly scoreboard, not a performance review.</p>
              <div className="partner-table">
                <div className="partner-row partner-head partner-row-4">
                  <span>Partner</span><span>Pipeline</span><span>Won</span><span>Win rate</span>
                </div>
                {byPartner.map((r) => (
                  <div key={r.id} className="partner-row partner-row-4">
                    <span>{r.name}</span>
                    <span>{fmtKES(r.pipeline)}</span>
                    <span>{fmtKES(r.won)}</span>
                    <span className={r.winRate == null ? "" : r.winRate >= 50 ? "rate-good" : "rate-poor"}>{r.winRate != null ? `${r.winRate}%` : "—"}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="insight-card">
              <h4>Where each partner's won business comes from</h4>
              <p className="insight-note">Each partner's top-performing source, by won value — so what's working for one partner can get borrowed by the rest.</p>
              <div className="rank-list" style={{ marginTop: 0, borderTop: "none", paddingTop: 0 }}>
                {sourceByPartner.map((p) => (
                  <div key={p.id} className="rank-row">
                    <span className="rank-num rank-num-name">{p.name}</span>
                    <span className="rank-name">
                      {p.top ? (
                        <>
                          {p.top.source}
                          {p.rest.length > 0 && (
                            <span className="rank-sub">
                              also: {p.rest.map((s) => `${s.source} (${fmtKES(s.value)})`).join(", ")}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="muted-line">No won deals yet</span>
                      )}
                    </span>
                    <span className="rank-value">{p.top ? fmtKES(p.top.value) : "—"}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="insight-card">
              <h4>Won value by partner</h4>
              <p className="insight-note">All-time, side by side.</p>
              <ResponsiveContainer width="100%" height={Math.max(160, byPartner.length * 40)}>
                <BarChart data={byPartner} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E4DFD3" />
                  <XAxis type="number" tick={{ fontSize: 10, fill: "#6B7684" }} axisLine={false} tickLine={false} tickFormatter={(v) => (v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${Math.round(v / 1000)}K` : v)} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "#1B2430" }} axisLine={false} tickLine={false} width={90} />
                  <Tooltip formatter={chartTooltip} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Bar dataKey="won" fill={CHART_GOLD} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </section>

            <section className="insight-card">
              <h4>Activity by partner, this month</h4>
              <p className="insight-note">
                Who's actually logging the touches, meetings, and proposals — {totalActivityThisMonth} entries logged so far this month. An even split across {store.partners.length} partner{store.partners.length > 1 ? "s" : ""} against the firm target works out to roughly {Math.round(fairSharePerPartner)} each.
              </p>
              <div className="rank-list" style={{ marginTop: 0, borderTop: "none", paddingTop: 0 }}>
                {activityByPartner.map((p, i) => {
                  const shareOfFirm = totalActivityThisMonth ? Math.round((p.count / totalActivityThisMonth) * 100) : 0;
                  const shareOfFair = fairSharePerPartner ? Math.round((p.count / fairSharePerPartner) * 100) : 0;
                  return (
                    <div key={p.name} className="rank-row">
                      <span className="rank-num">{i + 1}</span>
                      <span className="rank-name">
                        {p.name}
                        <span className="rank-sub">{shareOfFirm}% of this month's logs · {shareOfFair}% of fair share</span>
                      </span>
                      <span className="rank-value">{p.count}</span>
                    </div>
                  );
                })}
              </div>
            </section>
          </>
        )
      ) : (
      <>
      {isDrilldown && (
        <p className="section-intro" style={{ marginTop: -4 }}>
          Showing <strong>{drilldownPartner?.name}</strong>'s own pipeline and activity only.
        </p>
      )}
      <div className="filter-row">
        <div className="seg">
          <button className={isAllTime ? "seg-active" : ""} onClick={() => setViewMonth("all")}>All time</button>
          <button className={!isAllTime ? "seg-active" : ""} onClick={() => setViewMonth((v) => (v === "all" ? monthKey() : v))}>By month</button>
        </div>
      </div>
      {!isAllTime && (
        <div className="month-nav">
          <button className="icon-btn" onClick={() => setViewMonth(shiftMonthKey(viewMonth, -1))} aria-label="Previous month">‹</button>
          <span className="month-nav-label">{monthLabel(viewMonth)}</span>
          <button className="icon-btn" onClick={() => setViewMonth(shiftMonthKey(viewMonth, 1))} disabled={viewMonth === monthKey()} aria-label="Next month">›</button>
        </div>
      )}
      {prospects.length === 0 ? (
        <p className="empty">
          {isDrilldown ? `${drilldownPartner?.name} has no prospects yet.` : "Add some prospects and mark a few won or lost — insights build themselves from there."}
        </p>
      ) : (
        <>
          <section className="stat-grid">
            <div className="stat">
              <span className="stat-value">{fmtKES(livePipelineValue)}</span>
              <span className="stat-label">Live pipeline value{!isAllTime ? " (current, not historical)" : ""}</span>
            </div>
            <div className="stat">
              <span className="stat-value">{fmtKES(wonInScopeValue)}</span>
              <span className="stat-label">{isAllTime ? "Won, all time" : `Won in ${monthLabel(viewMonth)}`}</span>
            </div>
            <div className="stat">
              <span className="stat-value">{fmtKESExact(collectedInScopeValue)}</span>
              <span className="stat-label">{isAllTime ? "Collected, all time" : `Collected in ${monthLabel(viewMonth)}`}</span>
            </div>
            <div className="stat">
              <span className="stat-value">{fmtKESExact(totalOutstanding)}</span>
              <span className="stat-label">Outstanding right now, across all won deals</span>
            </div>
            <div className="stat">
              <span className="stat-value">{winRate != null ? `${winRate}%` : "—"}</span>
              <span className="stat-label">Win rate (of proposals sent)</span>
            </div>
            <div className="stat">
              <span className="stat-value">{pipelineCoverageMonths != null ? `${pipelineCoverageMonths.toFixed(1)} mo` : "—"}</span>
              <span className="stat-label">Pipeline coverage, at recent pace</span>
            </div>
          </section>

          <section className="insight-card">
            <h4>Cost of BD{isDrilldown ? ` — ${drilldownPartner?.name}'s own activity` : ""}</h4>
            <p className="insight-note">
              Out-of-pocket only — fuel, airtime, tickets, that kind of thing, {isAllTime ? "all time" : `for ${monthLabel(viewMonth)}`}. {isDrilldown ? "Your own numbers, for your own reflection — not a comparison." : "A firm-level view, not a per-partner ranking."} Edit the standard estimates in ⚙️ Settings.
            </p>
            <section className="stat-grid">
              <div className="stat">
                <span className="stat-value">{fmtKES(totalCost)}</span>
                <span className="stat-label">Total spent on BD</span>
              </div>
              <div className="stat">
                <span className="stat-value">{costPerWin != null ? fmtKES(costPerWin) : "—"}</span>
                <span className="stat-label">Cost per win</span>
              </div>
              <div className="stat">
                <span className="stat-value">{costAsShareOfWon != null ? `${costAsShareOfWon}%` : "—"}</span>
                <span className="stat-label">Cost as share of won value</span>
              </div>
            </section>
            {costByType.length > 0 && (
              <ResponsiveContainer width="100%" height={Math.max(100, costByType.length * 34)}>
                <BarChart data={costByType} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E4DFD3" />
                  <XAxis type="number" tick={{ fontSize: 10, fill: "#6B7684" }} axisLine={false} tickLine={false} tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}K` : v)} />
                  <YAxis type="category" dataKey="label" tick={{ fontSize: 10.5, fill: "#1B2430" }} axisLine={false} tickLine={false} width={110} />
                  <Tooltip formatter={chartTooltip} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Bar dataKey="cost" fill={CHART_NAVY} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </section>

          {(retainerClients.length > 0 || activeEmpanelments.length > 0 || empanelmentsInProgress.length > 0) && (
            <section className="insight-card">
              <h4>Recurring Revenue & Empanelments</h4>
              <p className="insight-note">
                Retainers and empanelments are ongoing relationships, not one-off deals — no single "won" moment to measure, so these are right-now snapshots rather than scoped to the all-time/by-month toggle above.
              </p>
              <section className="stat-grid" style={{ marginBottom: 0 }}>
                <div className="stat">
                  <span className="stat-value">{fmtKESExact(mrr)}</span>
                  <span className="stat-label">Monthly recurring revenue (retainers)</span>
                </div>
                <div className="stat">
                  <span className="stat-value">{retainerClients.length}</span>
                  <span className="stat-label">Active retainer clients</span>
                </div>
                <div className="stat">
                  <span className="stat-value">{activeEmpanelments.length}</span>
                  <span className="stat-label">Active empanelments</span>
                </div>
                <div className="stat">
                  <span className="stat-value">{empanelmentsInProgress.length}</span>
                  <span className="stat-label">Empanelment applications in progress</span>
                </div>
              </section>
            </section>
          )}

          <section className="insight-card">
            <h4>Won vs. Collected by month</h4>
            <p className="insight-note">
              Won reflects when each deal actually reached Won. Collected reflects when a payment was logged against it — which can land months after the deal itself was won, regardless of which month that was.
            </p>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={wonByMonth} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E4DFD3" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#6B7684" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#6B7684" }} axisLine={false} tickLine={false} width={44} tickFormatter={(v) => (v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${Math.round(v / 1000)}K` : v)} />
                <Tooltip formatter={chartTooltip} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Bar dataKey="value" name="Won" fill={CHART_GOLD} radius={[4, 4, 0, 0]} />
                <Bar dataKey="collected" name="Collected" fill={CHART_NAVY} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div className="legend-row">
              <span><span className="legend-dot" style={{ background: CHART_GOLD }} /> Won</span>
              <span><span className="legend-dot" style={{ background: CHART_NAVY }} /> Collected</span>
            </div>
          </section>

          <section className="insight-card">
            <h4>Activity discipline by month</h4>
            <p className="insight-note">
              Logged touches (all types combined) against the Section 16 firm-wide monthly target of {firmMonthlyTarget}. Sits next to the chart above deliberately — activity should lead revenue by a month or two.
            </p>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={activityByMonth} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E4DFD3" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#6B7684" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#6B7684" }} axisLine={false} tickLine={false} width={34} tickFormatter={(v) => `${v}%`} />
                <Tooltip formatter={(v, n, p) => [`${v}% (${p.payload.logged} logged)`, "Of target"]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Bar dataKey="pct" fill={CHART_NAVY} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </section>

          {correlationByType.length > 0 && (
            <section className="insight-card">
              <h4>Which activities correlate with winning</h4>
              <p className="insight-note">
                For each activity type, the win rate among prospects with at least one matched touch of that type, versus those without — matched by name against the activity log's subject line, so it's strongest for outreach and meetings and weaker for content like LinkedIn posts. Only counts prospects that {isAllTime ? "have actually won or lost" : `won or lost during ${monthLabel(viewMonth)}`}.
              </p>
              <div className="corr-list">
                {correlationByType.map((r) => (
                  <div key={r.type.key} className="corr-row">
                    <span className="corr-label">{r.type.label}</span>
                    <div className="corr-bar-line">
                      <span className="corr-bar-tag">With</span>
                      <div className="bar"><div className="bar-fill" style={{ width: `${r.rateWith ?? 0}%` }} /></div>
                      <span className="corr-bar-value">{r.rateWith != null ? `${r.rateWith}%` : "—"} <span className="corr-n">(n={r.withN})</span></span>
                    </div>
                    <div className="corr-bar-line">
                      <span className="corr-bar-tag">Without</span>
                      <div className="bar"><div className="bar-fill bar-fill-navy" style={{ width: `${r.rateWithout ?? 0}%` }} /></div>
                      <span className="corr-bar-value">{r.rateWithout != null ? `${r.rateWithout}%` : "—"} <span className="corr-n">(n={r.withoutN})</span></span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {byPractice.length > 0 && (
            <section className="insight-card">
              <h4>Won vs. live pipeline, by practice area</h4>
              <p className="insight-note">
                Which practices are converting, and which are carrying unrealised value.
                {!isAllTime && " Won bars reflect " + monthLabel(viewMonth) + "; Pipeline is always the current live snapshot, not historical."}
              </p>
              <ResponsiveContainer width="100%" height={Math.max(160, byPractice.length * 56)}>
                <BarChart data={byPractice} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E4DFD3" />
                  <XAxis type="number" tick={{ fontSize: 10, fill: "#6B7684" }} axisLine={false} tickLine={false} tickFormatter={(v) => (v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${Math.round(v / 1000)}K` : v)} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "#1B2430" }} axisLine={false} tickLine={false} width={100} />
                  <Tooltip formatter={chartTooltip} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Bar dataKey="Won" fill={CHART_GOLD} radius={[0, 4, 4, 0]} />
                  <Bar dataKey="Pipeline" fill={CHART_NAVY} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <div className="legend-row">
                <span><span className="legend-dot" style={{ background: CHART_GOLD }} /> Won</span>
                <span><span className="legend-dot" style={{ background: CHART_NAVY }} /> Live pipeline</span>
              </div>
            </section>
          )}

          {byClientType.length > 0 && (
            <section className="insight-card">
              <h4>Won vs. live pipeline, by client type</h4>
              <p className="insight-note">
                Individual clients versus institutional/corporate ones — where the business is actually coming from.
                {!isAllTime && " Won bars reflect " + monthLabel(viewMonth) + "; Pipeline is always the current live snapshot, not historical."}
              </p>
              <ResponsiveContainer width="100%" height={Math.max(120, byClientType.length * 56)}>
                <BarChart data={byClientType} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E4DFD3" />
                  <XAxis type="number" tick={{ fontSize: 10, fill: "#6B7684" }} axisLine={false} tickLine={false} tickFormatter={(v) => (v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${Math.round(v / 1000)}K` : v)} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "#1B2430" }} axisLine={false} tickLine={false} width={90} />
                  <Tooltip formatter={chartTooltip} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Bar dataKey="Won" fill={CHART_GOLD} radius={[0, 4, 4, 0]} />
                  <Bar dataKey="Pipeline" fill={CHART_NAVY} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <div className="legend-row">
                <span><span className="legend-dot" style={{ background: CHART_GOLD }} /> Won</span>
                <span><span className="legend-dot" style={{ background: CHART_NAVY }} /> Live pipeline</span>
              </div>
            </section>
          )}

          <section className="insight-card">
            <h4>Where prospects come from</h4>
            <p className="insight-note">
              {isAllTime ? "By number of prospects logged against each source." : `By number of prospects that entered the pipeline in ${monthLabel(viewMonth)}, against each source.`}
            </p>
            <ResponsiveContainer width="100%" height={Math.max(160, sourceRows.length * 34)}>
              <BarChart data={sourceRows} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E4DFD3" />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fill: "#6B7684" }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "#1B2430" }} axisLine={false} tickLine={false} width={110} />
                <Tooltip content={sourceTooltip} />
                <Bar dataKey="count" fill={CHART_NAVY} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
            {topSourcesByValue.length > 0 && (
              <div className="rank-list">
                <span className="insight-note">Who's actually brought in won business — credited to the specific referral partner, partner, client, or tender where captured</span>
                {topSourcesByValue.map((s, i) => (
                  <div key={s.name} className="rank-row">
                    <span className="rank-num">{i + 1}</span>
                    <span className="rank-name">{s.name}</span>
                    <span className="rank-value">{fmtKES(s.wonValue)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {conversionBySource.length > 0 && (
            <section className="insight-card">
              <h4>Which sources actually convert</h4>
              <p className="insight-note">
                {isAllTime
                  ? "Of prospects from each source with a settled outcome (won or lost), what share closed."
                  : `Of prospects from each source that were won or lost during ${monthLabel(viewMonth)}, what share closed.`} A source with a lot of volume but a low rate is worth questioning; a small source with a high rate is worth leaning into.
              </p>
              <div className="partner-table">
                <div className="partner-row partner-head">
                  <span>Source</span><span>Won / Lost</span><span>Win rate</span>
                </div>
                {conversionBySource.map((s) => (
                  <div key={s.name} className="partner-row">
                    <span>{s.name}</span>
                    <span>{s.won} / {s.lost}</span>
                    <span className={s.rate >= 50 ? "rate-good" : "rate-poor"}>{s.rate}%</span>
                  </div>
                ))}
              </div>
              {sourceRows.some((s) => s.count > s.won + s.lost) && (
                <p className="insight-note" style={{ marginTop: 8, marginBottom: 0 }}>
                  Sources with prospects still open (no won/lost outcome yet) aren't counted above until those deals settle.
                </p>
              )}
            </section>
          )}

          <section className="insight-card">
            <h4>Pipeline funnel</h4>
            <p className="insight-note">
              {isAllTime
                ? "Every prospect that ever reached each stage — shows where deals stall."
                : `Every prospect that reached each stage during ${monthLabel(viewMonth)} — shows where that month's deals stalled.`}
            </p>
            <div className="funnel">
              {funnel.map((s) => (
                <div key={s.label} className="funnel-row">
                  <span className="funnel-label">{s.label}</span>
                  <div className="bar"><div className="bar-fill" style={{ width: `${funnelTop ? Math.round((s.count / funnelTop) * 100) : 0}%` }} /></div>
                  <span className="funnel-count">{s.count}</span>
                </div>
              ))}
              <div className="funnel-row funnel-row-lost">
                <span className="funnel-label">Lost</span>
                <div className="bar"><div className="bar-fill bar-fill-lost" style={{ width: `${funnelTop ? Math.round((lostProspects.length / funnelTop) * 100) : 0}%` }} /></div>
                <span className="funnel-count">{lostProspects.length}</span>
              </div>
            </div>
          </section>

          {lostByStageRows.length > 0 && (
            <section className="insight-card">
              <h4>Where lost deals fell off</h4>
              <p className="insight-note">
                {lostProspects.length} lost deal{lostProspects.length > 1 ? "s" : ""}
                {isAllTime ? "" : ` in ${monthLabel(viewMonth)}`}, worth {fmtKES(lostValue)} had they closed — grouped by the furthest stage each one reached.
              </p>
              <div className="funnel">
                {lostByStageRows.map((r) => (
                  <div key={r.label} className="funnel-row">
                    <span className="funnel-label">{r.label}</span>
                    <div className="bar"><div className="bar-fill bar-fill-lost" style={{ width: `${Math.round((r.count / lostByStageTop) * 100)}%` }} /></div>
                    <span className="funnel-count">{r.count}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
      </>
      )}
    </main>
  );
}

function Scorecard({ store, me, myPartner, canViewByPartner = true, canSeeMetrics = true, canSeeAmounts = true, onAddAsProspect, onAddAsClient, onAddAsReferral, onAddAsTender }) {
  const [scope, setScope] = useState("firm"); // firm | partner
  const [selectedPartner, setSelectedPartner] = useState(me);
  const [logOpen, setLogOpen] = useState(null); // activity type object or null
  const [expanded, setExpanded] = useState({});
  const [viewMonth, setViewMonth] = useState(monthKey());
  const isCurrentMonth = viewMonth === monthKey();
  const mk = viewMonth;
  const monthActivity = store.activity.filter((a) => monthKey(a.date) === mk && (scope === "firm" || a.partnerId === selectedPartner));

  const countOf = (type) => monthActivity.filter((a) => a.type === type).length;
  const entriesOf = (type) => monthActivity.filter((a) => a.type === type).slice().reverse();

  const monthProspects = store.prospects.filter(
    (p) => (scope === "firm" || p.responsiblePartner === selectedPartner)
  );
  const qualifiedThisMonth = monthProspects.filter((p) => reachedStageInMonth(p, "qualified", mk)).length;
  const formalProposals = monthProspects.filter((p) => reachedStageInMonth(p, "proposal_submitted", mk)).length;
  const pipelineValue = monthProspects
    .filter((p) => !["won", "lost"].includes(p.status))
    .reduce((a, p) => a + (Number(p.estimatedFee) || 0), 0);
  const wonValue = monthProspects
    .filter((p) => reachedStageInMonth(p, "won", mk))
    .reduce((a, p) => a + effectiveDealValue(p), 0);
  const totalSpent = monthActivity.reduce((a, x) => a + (Number(x.cost) || 0), 0);

  // Previous month's equivalents, same scope filter, purely for the "vs last month" trend labels.
  const prevMk = shiftMonthKey(mk, -1);
  const prevMonthActivity = store.activity.filter((a) => monthKey(a.date) === prevMk && (scope === "firm" || a.partnerId === selectedPartner));
  const prevQualified = monthProspects.filter((p) => reachedStageInMonth(p, "qualified", prevMk)).length;
  const prevFormalProposals = monthProspects.filter((p) => reachedStageInMonth(p, "proposal_submitted", prevMk)).length;
  const prevWonValue = monthProspects
    .filter((p) => reachedStageInMonth(p, "won", prevMk))
    .reduce((a, p) => a + effectiveDealValue(p), 0);
  const prevTotalSpent = prevMonthActivity.reduce((a, x) => a + (Number(x.cost) || 0), 0);
  const wonTrend = monthTrend(wonValue, prevWonValue);
  const qualifiedTrend = monthTrend(qualifiedThisMonth, prevQualified);
  const proposalsTrend = monthTrend(formalProposals, prevFormalProposals);
  const spentTrend = monthTrend(totalSpent, prevTotalSpent);

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
          <button className={scope === "firm" ? "seg-active" : ""} onClick={() => setScope("firm")}>Firm-wide</button>
          {canViewByPartner && (
            <button className={scope === "partner" ? "seg-active" : ""} onClick={() => setScope("partner")}>By partner</button>
          )}
        </div>
      </div>
      {canViewByPartner && scope === "partner" && (
        <div className="filter-row">
          <select value={selectedPartner} onChange={(e) => setSelectedPartner(e.target.value)}>
            {store.partners.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      )}

      {(canSeeAmounts || canSeeMetrics) && (
        <section className="stat-grid">
          {canSeeAmounts && (
            <div className="stat">
              <span className="stat-value">{fmtKES(pipelineValue)}</span>
              <span className="stat-label">Live pipeline value{!isCurrentMonth ? " (current, not historical)" : ""}</span>
            </div>
          )}
          {canSeeAmounts && (
            <div className="stat">
              <span className="stat-value">{fmtKES(wonValue)}</span>
              <span className="stat-label">Won in {monthLabel(viewMonth)}</span>
              {wonTrend && <span className={`stat-trend stat-trend-${wonTrend.tone}`}>{wonTrend.text}</span>}
            </div>
          )}
          {canSeeMetrics && (
            <div className="stat">
              <span className="stat-value">{qualifiedThisMonth}</span>
              <span className="stat-label">New qualified opportunities</span>
              {qualifiedTrend && <span className={`stat-trend stat-trend-${qualifiedTrend.tone}`}>{qualifiedTrend.text}</span>}
            </div>
          )}
          {canSeeMetrics && (
            <div className="stat">
              <span className="stat-value">{formalProposals}</span>
              <span className="stat-label">Formal proposals / quotes</span>
              {proposalsTrend && <span className={`stat-trend stat-trend-${proposalsTrend.tone}`}>{proposalsTrend.text}</span>}
            </div>
          )}
          {canSeeAmounts && (
            <div className="stat">
              <span className="stat-value">{fmtKESExact(totalSpent)}</span>
              <span className="stat-label">Spent on BD in {monthLabel(viewMonth)}</span>
              {spentTrend && <span className={`stat-trend stat-trend-${spentTrend.tone}`}>{spentTrend.text}</span>}
            </div>
          )}
        </section>
      )}

      {isCurrentMonth ? (
        <p className="section-intro">Log today's touches as you make them — this is the Section 16 monthly scorecard, tallied automatically. It resets itself every month; nothing to archive.</p>
      ) : (
        <p className="section-intro">Viewing a past month, read-only — logging is always dated to today, so switch back to the current month to add entries.</p>
      )}

      <div className="activity-grid">
        {ACTIVITY_TYPES.map((t) => {
          const target = Number(store.activityTargets[t.key]) || 0;
          const count = countOf(t.key);
          const pct = target ? Math.min(100, Math.round((count / target) * 100)) : 0;
          const entries = entriesOf(t.key);
          const allTimeCount = store.activity.filter((a) => a.type === t.key).length;
          // Clamped so the badge can never claim more unseen entries than are actually
          // shown in this month's count on the right — it's a subset of "count", never more.
          const unseen = Math.min(count, allTimeCount - (store.seenActivityTypes[t.key] || 0));
          const toggleLog = () => {
            const willExpand = !expanded[t.key];
            setExpanded({ ...expanded, [t.key]: willExpand });
            if (willExpand) store.markActivityTypeSeen(t.key, allTimeCount);
          };
          return (
            <div key={t.key} className="activity-row">
              <div className="activity-top">
                <span>{t.label}</span>
                {canSeeMetrics && <span className="activity-count">{count} / {target}</span>}
              </div>
              {canSeeMetrics && <div className="bar"><div className="bar-fill" style={{ width: `${pct}%` }} /></div>}
              <div className="activity-actions">
                {isCurrentMonth && <button className="chip-btn" onClick={() => setLogOpen(t)}>+ Log</button>}
                {isCurrentMonth && <button className="chip-btn chip-ghost" onClick={() => store.undoActivity(t.key, me)}>Undo</button>}
                {count > 0 && (
                  <button className="chip-btn chip-ghost" onClick={toggleLog}>
                    {expanded[t.key] ? "Hide" : "View"} log
                  </button>
                )}
                {unseen > 0 && (
                  <button type="button" className="update-badge-btn" onClick={toggleLog} aria-label="View log">
                    <UpdateBadge count={unseen} />
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

export function Style() {
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
      .boot-mark{ width:46px; height:46px; display:grid; place-items:center; margin:0 auto 6px; border-radius:14px; background:linear-gradient(135deg,var(--gold),var(--gold-2)); color:var(--ink); font-family:'Playfair Display',serif; font-size:25px; font-weight:900; line-height:1; box-shadow:0 8px 24px rgba(0,0,0,0.12); }
      .boot h1{ font-family:'Playfair Display',serif; font-size:26px; margin:6px 0 0; }
      .muted{ color:var(--muted); margin:0; }
      .who-list{ display:flex; flex-direction:column; gap:10px; width:100%; margin-top:8px; }
      .who-btn{ text-align:left; background:#fff; border:1px solid var(--line); border-left:4px solid var(--navy); border-radius:6px; padding:12px 14px; display:flex; flex-direction:column; gap:2px; }
      .who-name{ font-weight:700; }
      .who-identity{ font-size:12.5px; color:var(--muted); }
      .who-role-badge{ display:inline-block; margin-left:8px; font-size:10px; font-weight:700; color:var(--amber); background:#FBF1DC; padding:2px 7px; border-radius:999px; vertical-align:middle; }
      .link-btn{ background:none; border:none; color:var(--navy-2); text-decoration:underline; font-size:13px; margin-top:6px; }
      .link-btn-danger{ color:var(--red); }
      .add-user-btn{ width:100%; margin-top:10px; background:#FBF1DC; border:1px solid #E9D9AE; color:var(--navy); border-radius:8px; padding:11px 14px; font-size:13px; font-weight:800; text-align:center; }
      .add-user-btn:hover{ background:#F6E7C4; }
      .sample-data-row{ display:flex; gap:16px; justify-content:center; margin-top:10px; }
      .sample-data-confirm{ width:100%; margin-top:10px; background:#FBF1DC; border:1px solid #E9D9AE; border-radius:8px; padding:12px; text-align:left; }
      .sample-data-confirm .fine{ margin:0 0 8px; color:var(--ink); }
      .sample-data-confirm .sample-data-row{ justify-content:flex-start; }
      .add-partner{ display:flex; flex-direction:column; gap:8px; width:100%; margin-top:8px; }
      .add-partner input, .add-partner select{ padding:10px; border:1px solid var(--line); border-radius:6px; font-family:inherit; background:#fff; }
      .role-help-text{ display:block; font-size:11px; color:var(--muted); font-weight:500; margin-top:2px; }
      .fine{ font-size:11.5px; color:var(--muted); margin-top:18px; }

      .demo-banner{ background:#fff4d6; color:#5f3b00; border-bottom:1px solid #ead39d; padding:8px 16px; text-align:center; font-size:12.5px; font-weight:800; }
      .demo-helper{ position:fixed; left:50%; bottom:18px; transform:translateX(-50%); z-index:8; width:calc(100% - 28px); max-width:532px; background:#fff; border:1px solid rgba(200,155,60,0.45); border-radius:16px; padding:14px; box-shadow:0 18px 45px rgba(11,42,74,0.22); display:flex; gap:14px; align-items:center; }
      .demo-helper-copy{ flex:1; min-width:0; }
      .demo-helper-kicker{ display:block; color:var(--amber); font-size:10.5px; font-weight:900; letter-spacing:0.08em; text-transform:uppercase; margin-bottom:3px; }
      .demo-helper strong{ display:block; color:var(--navy); font-size:14.5px; line-height:1.25; }
      .demo-helper p{ color:var(--muted); font-size:12.3px; line-height:1.45; margin:4px 0 0; }
      .demo-helper-actions{ display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end; flex:0 0 auto; }
      .demo-helper-actions .btn{ padding:9px 12px; font-size:12.5px; white-space:nowrap; }
      @media (max-width:480px){
        .demo-helper{ align-items:flex-start; flex-direction:column; }
        .demo-helper-actions{ width:100%; justify-content:stretch; }
        .demo-helper-actions .btn{ flex:1 1 140px; }
      }
      .topbar{ position:sticky; top:0; z-index:5; background:var(--navy); color:#fff; display:flex; align-items:center; justify-content:space-between; gap:12px; padding:14px 16px; }
      .brand{ display:flex; align-items:center; gap:8px; background:none; border:none; padding:0; cursor:pointer; text-align:left; }
      .brand-icon{ width:28px; height:28px; display:grid; place-items:center; }
      .brand-letter{ border-radius:9px; background:linear-gradient(135deg,var(--gold),var(--gold-2)); color:var(--ink); font-family:'Playfair Display',serif; font-size:16px; font-weight:900; line-height:1; box-shadow:0 4px 14px rgba(0,0,0,0.18); }
      .brand-mark{ font-family:'Playfair Display',serif; font-size:18px; font-weight:800; letter-spacing:0.08em; color:var(--gold-2); text-transform:uppercase; }
      .me-name{ background:none; border:none; color:#fff; padding:6px 0; font-size:12.5px; font-weight:700; max-width:110px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .signout-btn{ background:var(--gold); border:1px solid var(--gold); color:var(--ink); border-radius:999px; padding:7px 12px; font-size:12.5px; font-weight:800; }
      .header-right{ display:flex; align-items:center; gap:10px; }
      .notif-bell{ position:relative; background:rgba(255,255,255,0.12); border:1px solid rgba(255,255,255,0.25); color:#fff; border-radius:999px; padding:6px 10px; font-size:14px; display:inline-flex; align-items:center; }
      .notif-count{ position:absolute; top:-5px; right:-6px; background:var(--red); color:#fff; font-size:10px; font-weight:700; border-radius:999px; min-width:16px; height:16px; display:flex; align-items:center; justify-content:center; padding:0 3px; }
      .overlay.notif-overlay{ align-items:flex-start; justify-content:flex-end; padding:60px 14px 0 0; }
      .notif-panel{ background:#fff; width:100%; max-width:340px; border-radius:12px; box-shadow:0 12px 30px rgba(11,20,32,0.25); max-height:70vh; display:flex; flex-direction:column; overflow:hidden; }
      .notif-head{ display:flex; justify-content:space-between; align-items:center; padding:14px 16px; border-bottom:1px solid var(--line); font-weight:700; color:var(--navy); font-family:'Playfair Display',serif; font-size:16px; }
      .notif-body{ overflow-y:auto; padding:6px 0; }
      .notif-group{ padding:8px 16px; }
      .notif-group-label{ display:block; font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:0.04em; margin-bottom:6px; }
      .notif-row{ display:flex; justify-content:space-between; align-items:center; gap:8px; width:100%; background:none; border:none; padding:8px 0; border-bottom:1px solid var(--line); text-align:left; }
      .notif-row:last-child{ border-bottom:none; }
      .notif-row-title{ font-size:13px; color:var(--ink); min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; }

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
      .search-box-wrap{ position:relative; margin-bottom:10px; }
      .search-box{ width:100%; padding:10px 34px 10px 12px; border:1px solid var(--line); border-radius:8px; font-family:inherit; font-size:13.5px; color:var(--ink); background:#fff; outline:none; -webkit-appearance:none; appearance:none; }
      .search-box::-webkit-search-cancel-button{ display:none; }
      .search-box:focus{ border-color:var(--gold); box-shadow:0 0 0 3px rgba(200,155,60,0.18); }
      .search-box::placeholder{ color:var(--muted); }
      .search-clear{ position:absolute; right:8px; top:50%; transform:translateY(-50%); background:none; border:none; color:var(--muted); font-size:13px; padding:4px; }
      .filter-row{ display:flex; align-items:center; gap:10px; margin-bottom:12px; flex-wrap:wrap; }
      .filter-row select{ padding:8px 10px; border:1px solid var(--line); border-radius:6px; background:#fff; font-family:inherit; font-size:13px; }
      .overdue-banner{ background:#F7E3E3; color:var(--red); font-size:12px; font-weight:600; padding:5px 10px; border-radius:999px; }
      .list-count{ font-size:12px; color:var(--muted); font-weight:600; padding:5px 2px; margin-left:auto; }

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
      .rail-row{ display:flex; align-items:center; gap:8px; }
      .rail{ display:flex; gap:3px; flex:1; }
      .dot{ height:5px; flex:1; background:var(--line); border-radius:3px; }
      .dot-fill{ background:var(--gold); }
      .dot-lost{ background:var(--red); }
      .rail-pct{ flex:0 0 auto; font-size:11px; font-weight:700; color:var(--amber); white-space:nowrap; }
      .rail-pct-lost{ color:var(--red); }
      .card-meta{ display:flex; gap:6px; flex-wrap:wrap; }
      .pill{ font-size:11px; background:#F0EEE7; color:var(--ink); padding:3px 8px; border-radius:999px; }
      .pill.owner{ background:#E7EEF5; color:var(--navy-2); }
      .pill.prob{ background:#FBF1DC; color:var(--amber); }
      .pill.score{ background:#E9F3EA; color:#2F6B33; }
      .pill.score-low{ background:#F7E3E3; color:var(--red); }
      .update-badge{ font-size:11px; font-weight:700; background:var(--navy); color:var(--gold-2); padding:3px 8px; border-radius:999px; display:inline-flex; align-items:center; gap:3px; white-space:nowrap; }
      .referral-badge{ font-size:11px; font-weight:700; background:#E9F3EA; color:#2F6B33; border:1px solid #CBE3CD; padding:3px 8px; border-radius:999px; display:inline-flex; align-items:center; gap:3px; white-space:nowrap; }
      .archive-badge{ font-size:11px; font-weight:700; background:var(--cream); color:var(--muted); border:1px solid var(--line); padding:3px 8px; border-radius:999px; display:inline-flex; align-items:center; gap:3px; white-space:nowrap; }
      .update-badge-btn{ background:none; border:none; padding:0; cursor:pointer; display:inline-flex; }
      .flags{ display:flex; gap:6px; }
      .flag{ font-size:11px; font-weight:600; padding:3px 8px; border-radius:999px; }
      .flag-red{ background:#F7E3E3; color:var(--red); }
      .flag-amber{ background:#FBF1DC; color:var(--amber); }
      .flag-soon{ background:#EAF0F6; color:var(--navy-2); }
      .reminder-card{ cursor:pointer; }
      .reminder-action{ font-size:13px; margin:0; color:var(--ink); }
      .reminder-done{ align-self:flex-start; margin-top:2px; }
      .reminder-actions{ display:flex; gap:8px; margin-top:2px; }
      .reschedule-row{ display:flex; gap:8px; align-items:center; margin-top:6px; }
      .reschedule-row input{ flex:1; min-width:0; padding:8px 10px; border:1px solid var(--line); border-radius:6px; font-family:inherit; font-size:13px; background:#fff; }

      .fab{ position:fixed; bottom:20px; left:50%; transform:translateX(-50%); max-width:520px; width:calc(100% - 28px); background:var(--navy); color:#fff; border:none; padding:14px; border-radius:10px; font-weight:700; font-size:14px; box-shadow:0 8px 20px rgba(11,42,74,0.35); }

      .section-intro{ font-size:13px; color:var(--muted); margin:0 0 12px; }

      .overlay{ position:fixed; top:0; left:0; right:0; height:var(--vvh, 100vh); background:rgba(11,20,32,0.5); display:flex; align-items:flex-end; z-index:20; overflow-x:hidden; }
      .sheet{ background:#fff; width:100%; max-width:560px; margin:0 auto; border-radius:14px 14px 0 0; max-height:min(92vh, calc(var(--vvh, 100vh) * 0.92)); display:flex; flex-direction:column; overflow-x:hidden; }
      .sheet-head{ display:flex; justify-content:space-between; align-items:center; gap:10px; padding:16px; border-bottom:1px solid var(--line); }
      .sheet-head h3{ min-width:0; flex:1 1 auto; overflow-wrap:break-word; }
      .icon-btn{ flex:0 0 auto; }
      .sheet-head h3{ font-family:'Playfair Display',serif; margin:0; font-size:18px; }
      .icon-btn{ background:none; border:none; font-size:16px; color:var(--muted); }
      .sheet-body{ padding:14px 16px; overflow-y:auto; display:flex; flex-direction:column; gap:12px; }
      .field{ display:flex; flex-direction:column; gap:4px; font-size:12.5px; color:var(--muted); font-weight:600; min-width:0; }
      .field input, .field select, .field textarea{ font-family:inherit; font-size:14px; color:var(--ink); padding:9px 10px; border:1px solid var(--line); border-radius:6px; background:#fff; outline:none; width:100%; min-width:0; box-sizing:border-box; }
      .field select{ text-overflow:ellipsis; white-space:nowrap; overflow:hidden; }
      .field input:focus, .field select:focus, .field textarea:focus{ border-color:var(--gold); box-shadow:0 0 0 3px rgba(200,155,60,0.18); }
      .suggest-input-wrap{ position:relative; }
      .suggest-dropdown{ position:absolute; top:calc(100% + 4px); left:0; right:0; background:#fff; border:1px solid var(--line); border-radius:8px; box-shadow:0 8px 20px rgba(11,20,32,0.18); max-height:220px; overflow-y:auto; z-index:6; }
      .suggest-dropdown-row{ display:block; width:100%; text-align:left; padding:10px 12px; font-size:13.5px; color:var(--ink); background:none; border:none; border-bottom:1px solid var(--line); font-family:inherit; }
      .suggest-dropdown-row:last-child{ border-bottom:none; }
      .suggest-dropdown-row:active{ background:var(--cream); }
      .input-mic-row{ display:flex; gap:8px; align-items:center; position:relative; }
      .input-mic-row input, .input-mic-row textarea{ flex:1; min-width:0; }
      .mic-btn{ flex:0 0 auto; width:36px; height:36px; border-radius:50%; border:1px solid var(--line); background:#fff; font-size:15px; display:flex; align-items:center; justify-content:center; color:var(--navy); }
      .mic-btn-active{ background:var(--red); border-color:var(--red); color:#fff; animation:mic-pulse 1.1s ease-in-out infinite; }
      @keyframes mic-pulse{ 0%,100%{ opacity:1; } 50%{ opacity:0.55; } }
      .voice-error{ display:block; margin-top:6px; font-size:12px; color:var(--red); }
      .save-error{ display:flex; align-items:center; gap:6px; background:#F7E3E3; color:var(--red); border-radius:8px; padding:9px 12px; font-size:12.5px; font-weight:600; margin-bottom:10px; }
      .voice-error-dark{ color:#F5B4B4; }

      .voice-fill-trigger{ width:100%; background:var(--cream); border:1px dashed var(--gold); color:var(--navy); font-weight:700; font-size:13.5px; padding:11px; border-radius:8px; }
      .collapsible{ border:1px solid var(--line); border-radius:8px; overflow:hidden; }
      .collapsible-head{ width:100%; display:flex; justify-content:space-between; align-items:center; background:var(--navy); border:none; padding:12px 14px; font-size:13.5px; font-weight:700; color:#fff; }
      .collapsible-caret{ color:var(--gold-2); font-size:14px; font-weight:700; }
      .collapsible-body{ padding:12px; display:flex; flex-direction:column; gap:12px; background:#fff; }
      .watchlist-panel{ border:1px dashed var(--gold); border-radius:8px; background:var(--cream); margin-top:20px; overflow:hidden; }
      .watchlist-head{ width:100%; display:flex; justify-content:space-between; align-items:center; background:none; border:none; padding:12px 14px; font-size:13.5px; font-weight:700; color:var(--navy); }
      .watchlist-count{ display:inline-block; margin-left:6px; background:var(--navy); color:#fff; font-size:10.5px; font-weight:700; padding:1px 7px; border-radius:999px; vertical-align:middle; }
      .watchlist-count-due{ background:var(--amber); }
      .watchlist-body{ padding:0 14px 14px; display:flex; flex-direction:column; gap:10px; }
      .watchlist-item{ background:#fff; border:1px solid var(--line); border-radius:8px; padding:10px 12px; display:flex; flex-direction:column; gap:6px; align-items:flex-start; }
      .watchlist-item-top{ display:flex; justify-content:space-between; align-items:center; width:100%; }
      .watchlist-note{ font-size:12.5px; color:var(--muted); margin:0; }
      .watchlist-item-actions{ display:flex; gap:8px; flex-wrap:wrap; }
      .watchlist-add{ display:flex; flex-direction:column; gap:8px; }
      .watchlist-add input{ padding:9px 10px; border:1px solid var(--line); border-radius:6px; font-family:inherit; font-size:13px; background:#fff; outline:none; }
      .watchlist-add input:focus{ border-color:var(--gold); box-shadow:0 0 0 3px rgba(200,155,60,0.18); }
      .watchlist-checkback-field{ display:flex; flex-direction:column; gap:4px; font-size:11.5px; color:var(--muted); font-weight:600; }
      .watchlist-checkback{ font-size:11px; color:var(--navy-2); background:#EAF0F6; padding:3px 8px; border-radius:999px; align-self:flex-start; }
      .watchlist-checkback-due{ color:var(--amber); background:#FBF1DC; }
      .contact-link-row{ display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:-4px; }
      .contact-link{ text-align:center; font-size:12.5px; font-weight:700; color:var(--navy); background:#E7EEF5; border-radius:8px; padding:9px; text-decoration:none; }
      .cost-table{ display:flex; flex-direction:column; gap:2px; }
      .cost-row{ display:flex; justify-content:space-between; align-items:center; gap:10px; padding:10px 0; border-bottom:1px solid var(--line); }
      .cost-row-actions{ display:flex; align-items:center; gap:4px; }
      .cost-row-editing{ gap:8px; }
      .rename-input{ flex:1; padding:8px 10px; border:1px solid var(--gold); border-radius:6px; font-family:inherit; font-size:13px; background:#fff; outline:none; }
      .rename-actions{ display:flex; gap:6px; flex:0 0 auto; }
      .cost-row-label{ font-size:12.5px; color:var(--ink); flex:1; }
      .cost-row-input{ display:flex; align-items:center; gap:5px; background:var(--cream); border:1px solid var(--line); border-radius:6px; padding:5px 8px; }
      .cost-row-input span{ font-size:10.5px; color:var(--muted); font-weight:600; }
      .cost-row-input input{ width:64px; border:none; background:none; font-size:13px; text-align:right; font-family:inherit; }
      .cost-row-input input:focus{ outline:none; }
      .settings-menu{ display:flex; flex-direction:column; gap:2px; }
      .settings-menu-row{ display:flex; align-items:center; justify-content:space-between; gap:10px; background:#fff; border:1px solid var(--line); border-radius:10px; padding:14px 16px; margin-bottom:8px; text-align:left; }
      .settings-menu-text{ display:flex; flex-direction:column; gap:2px; }
      .settings-menu-label{ font-size:14px; font-weight:700; color:var(--navy); }
      .settings-menu-desc{ font-size:11.5px; color:var(--muted); }
      .settings-menu-caret{ font-size:18px; color:var(--muted); }
      .cal-panel{ background:#fff; border:1px solid var(--line); border-radius:10px; padding:12px; margin-bottom:14px; }
      .cal-weekday-row{ display:grid; grid-template-columns:repeat(7,1fr); text-align:center; font-size:10.5px; color:var(--muted); font-weight:700; margin-bottom:4px; }
      .cal-week{ display:grid; grid-template-columns:repeat(7,1fr); gap:4px; margin-bottom:4px; }
      .cal-cell{ aspect-ratio:1; display:flex; flex-direction:column; align-items:center; justify-content:center; background:var(--cream); border:1px solid transparent; border-radius:8px; position:relative; padding:0; }
      .cal-cell-empty{ background:none; }
      .cal-cell-today{ border-color:var(--navy); }
      .cal-cell-active{ background:var(--navy); }
      .cal-cell-active .cal-cell-num{ color:#fff; }
      .cal-cell-num{ font-size:12.5px; font-weight:600; color:var(--ink); }
      .cal-cell-count{ position:absolute; top:-4px; right:-4px; background:var(--navy-2); color:#fff; font-size:9px; font-weight:700; min-width:14px; height:14px; border-radius:999px; display:flex; align-items:center; justify-content:center; padding:0 3px; }
      .cal-cell-count-hot{ background:var(--amber); }
      .active-filter-chip{ display:inline-flex; align-items:center; gap:8px; font-size:12px; color:var(--navy); background:var(--cream); border:1px solid var(--line); padding:6px 10px; border-radius:999px; }
      .active-filter-chip button{ background:none; border:none; color:var(--red); font-weight:700; font-size:11.5px; padding:0; }
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
      .voice-panel-actions{ display:flex; gap:8px; flex-wrap:wrap; }
      .voice-panel-actions .chip-btn{ background:rgba(255,255,255,0.12); color:#fff; border:1px solid rgba(255,255,255,0.3); }
      .voice-panel-actions .chip-btn:disabled{ opacity:0.35; }
      .voice-panel-actions .btn-primary{ background:var(--gold); color:var(--navy); flex:1; padding:10px; border-radius:8px; font-weight:700; }
      .row2{ display:grid; grid-template-columns:1fr 1fr; gap:10px; }
      .row-date-action{ display:grid; grid-template-columns:1fr 1.6fr; gap:10px; }
      .sheet-actions{ display:flex; gap:10px; padding:14px 16px; border-top:1px solid var(--line); }
      .btn{ flex:1; padding:12px; border-radius:8px; font-weight:700; font-size:14px; border:none; }
      .btn-primary{ background:var(--navy); color:#fff; }
      .btn-ghost{ background:#fff; border:1px solid var(--line); color:var(--ink); flex:0 0 auto; padding:12px 16px; }
      .btn-danger{ color:var(--red); border-color:#EAD2D2; }
      .confirm-inline{ display:inline-flex; align-items:center; gap:6px; flex-wrap:wrap; }
      .confirm-inline-text{ font-size:11px; color:var(--muted); font-weight:600; }
      .chip-danger{ background:var(--red); color:#fff; }
      .tag-picker{ display:flex; flex-wrap:wrap; gap:6px; }
      .tag-chip{ font-size:12px; font-weight:600; padding:6px 12px; border-radius:999px; background:var(--cream); border:1px solid var(--line); color:var(--ink); }
      .tag-chip-active{ background:var(--navy); border-color:var(--navy); color:#fff; }

      .stat-grid{ display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:16px; }
      .stat{ background:#fff; border:1px solid var(--line); border-left:4px solid var(--gold); border-radius:8px; padding:12px; }
      .stat-value{ display:block; font-family:'Playfair Display',serif; font-size:20px; font-weight:700; color:var(--navy); }
      .stat-label{ font-size:11.5px; color:var(--muted); }
      .stat-trend{ display:block; font-size:10.5px; font-weight:700; margin-top:3px; }
      .stat-trend-up{ color:#2F6B33; }
      .stat-trend-down{ color:var(--red); }
      .stat-trend-flat{ color:var(--muted); font-weight:600; }

      .insight-card{ background:#fff; border:1px solid var(--line); border-radius:10px; padding:14px; margin-bottom:14px; }
      .insight-card h4{ font-family:'Playfair Display',serif; font-size:15px; margin:0 0 2px; color:var(--navy); }
      .insight-note{ font-size:11.5px; color:var(--muted); margin:0 0 8px; }
      .legend-row{ display:flex; gap:14px; margin-top:6px; font-size:11.5px; color:var(--muted); }
      .legend-dot{ display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:5px; }
      .rank-list{ margin-top:12px; border-top:1px solid var(--line); padding-top:10px; }
      .rank-row{ display:flex; align-items:center; gap:8px; padding:5px 0; font-size:13px; }
      .rank-num{ flex:0 0 auto; width:18px; height:18px; border-radius:50%; background:var(--cream); color:var(--navy); font-size:10.5px; font-weight:700; display:flex; align-items:center; justify-content:center; }
      .rank-num-name{ width:auto; height:auto; border-radius:0; background:none; font-size:12.5px; padding:0; }
      .rank-name{ flex:1; min-width:0; overflow-wrap:break-word; display:flex; flex-direction:column; }
      .rank-sub{ font-size:10.5px; color:var(--muted); font-weight:500; }
      .rank-value{ flex:0 0 auto; font-weight:700; color:var(--navy); font-size:12.5px; }
      .funnel{ display:flex; flex-direction:column; gap:10px; }
      .funnel-row{ display:grid; grid-template-columns:88px 1fr 28px; align-items:center; gap:8px; }
      .funnel-row .bar{ margin-bottom:0; }
      .funnel-row-lost{ margin-top:2px; padding-top:10px; border-top:1px dashed var(--line); }
      .funnel-row-lost .funnel-label, .funnel-row-lost .funnel-count{ color:var(--red); }
      .bar-fill-lost{ background:var(--red); }
      .bar-fill-navy{ background:var(--navy); }
      .corr-list{ display:flex; flex-direction:column; gap:16px; }
      .corr-row{ display:flex; flex-direction:column; gap:6px; padding-bottom:12px; border-bottom:1px solid var(--line); }
      .corr-row:last-child{ border-bottom:none; padding-bottom:0; }
      .corr-label{ font-size:13px; font-weight:700; color:var(--navy); }
      .corr-bar-line{ display:grid; grid-template-columns:52px 1fr 72px; align-items:center; gap:8px; }
      .corr-bar-tag{ font-size:10.5px; color:var(--muted); }
      .corr-bar-value{ font-size:11.5px; font-weight:700; color:var(--ink); text-align:right; }
      .corr-n{ font-weight:500; color:var(--muted); }
      .funnel-label{ font-size:11.5px; color:var(--muted); overflow-wrap:break-word; }
      .funnel-count{ font-size:12px; font-weight:700; color:var(--navy); text-align:right; }
      .partner-table{ display:flex; flex-direction:column; }
      .partner-row{ display:grid; grid-template-columns:1.3fr 1fr 1fr; gap:6px; padding:8px 0; border-bottom:1px solid var(--line); font-size:12.5px; }
      .partner-row-4{ grid-template-columns:1.1fr 0.9fr 0.9fr 0.7fr; }
      .partner-row:last-child{ border-bottom:none; }
      .partner-head{ font-weight:700; color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:0.03em; }
      .rate-good{ color:#2F6B33; font-weight:700; }
      .rate-poor{ color:var(--red); font-weight:700; }

      .vault{ background:#fff; border:1px solid var(--line); border-left:4px solid var(--navy); border-radius:8px; padding:12px; }
      .client-value-block{ background:var(--cream); border:1px solid var(--line); border-left:4px solid var(--gold); border-radius:8px; padding:12px; }
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
      .history-dot-touch{ background:var(--navy-2); }
      .note-row{ padding:8px 0; border-bottom:1px solid var(--line); }
      .note-row:last-child{ border-bottom:none; }
      .note-text{ font-size:13px; margin-bottom:2px; white-space:pre-wrap; }
      .mini-btn{ margin-top:6px; background:none; border:1px solid var(--navy); color:var(--navy); font-size:11.5px; font-weight:700; padding:4px 9px; border-radius:999px; }
      .record-summary{ background:var(--cream); border:1px solid var(--line); border-radius:8px; padding:12px; display:flex; flex-direction:column; gap:10px; }
      .record-summary-top{ display:flex; justify-content:space-between; align-items:flex-start; gap:10px; }
      .record-summary-top .mini-btn{ margin-top:0; flex:0 0 auto; }
      .mini-tag{ display:inline-block; margin-top:6px; font-size:11px; color:#2F6B33; background:#E9F3EA; padding:3px 8px; border-radius:999px; }
      .existing-client-note{ background:#E9F3EA; border:1px solid #CBE3CD; border-radius:8px; padding:10px 12px; display:flex; flex-direction:column; gap:6px; }
      .agreed-value-prompt{ background:var(--cream); border:1px solid var(--gold); border-radius:8px; padding:12px; display:flex; flex-direction:column; gap:10px; }
      .agreed-value-prompt-text{ font-size:13px; color:var(--ink); margin:0; line-height:1.5; }
      .agreed-value-prompt-actions{ display:flex; gap:8px; flex-wrap:wrap; }
      .existing-client-tag{ font-size:12.5px; font-weight:600; color:#2F6B33; }
      .existing-client-stats{ display:flex; gap:12px; flex-wrap:wrap; font-size:12px; color:#2F6B33; font-weight:600; }
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
      .activity-actions{ display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
      .chip-btn{ background:var(--navy); color:#fff; border:none; padding:6px 12px; border-radius:999px; font-size:12px; font-weight:600; }
      .chip-ghost{ background:#fff; color:var(--muted); border:1px solid var(--line); }
    `}</style>
  );
}

