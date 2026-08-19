# Bidi Revenue Engine

Shared business-development pipeline board for KKN Law LLP partners — prospects, referrals, tenders, clients, activity tracking, a monthly scorecard, and firm-wide Insights. Ported from a Claude artifact into a standalone Vite + React app, backed by Supabase instead of the artifact-only `window.storage` API.

This is the "Bidi" rebrand of the original KKN Revenue Engine artifact, adding: a notification bell with an unseen-updates feed, an Insights tab (firm-wide and by-partner analytics with charts, powered by `recharts`), a private per-partner Watchlist, client types, a Reminders calendar view, referral-attribution tracking ("🤝 X referred"), contact quick-actions (call/email), and a built-in sample-data generator.

## 1. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com) (free tier is fine).
2. Open **SQL Editor → New query**, paste in the contents of [`supabase/schema.sql`](./supabase/schema.sql), and run it. This creates the `kkn_kv` table, the access policy, and seeds demo data (partners, prospects, clients, tenders, activity).
3. Go to **Project Settings → API** and copy the **Project URL** and the **anon / public** key.

## 2. Configure the app

```bash
cp .env.example .env.local
```

Fill in `.env.local`:

```
VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

## 3. Run locally

```bash
npm install
npm run dev
```

Open the printed local URL. Pick a partner, add a prospect, and confirm it persists after a refresh — then check the same row appears in Supabase's **Table Editor → kkn_kv**.

## 4. Turn on magic-link sign-in

Partners sign in with a Supabase magic link before they can see the board — no password to manage.

1. In Supabase: **Authentication → Providers → Email**. Make sure Email is enabled. "Confirm email" can stay on or off — it doesn't affect magic links either way.
2. Still in Authentication, go to **URL Configuration** and set:
   - **Site URL**: your deployed app's URL (e.g. `https://kkn-bd-engine.vercel.app`). While testing locally, you can temporarily set this to `http://localhost:5173` instead, then switch it back once deployed.
   - **Redirect URLs**: add both `http://localhost:5173` (local dev) and your production URL, so the login link works from either.
3. That's it — no other setup needed. `supabase/schema.sql` tightens the `kkn_kv` row-level-security policy so only signed-in (authenticated) requests can read or write.

**Who can sign in:** right now, anyone who enters an email address gets a magic link and gets in — there's no allowlist. If you'd rather restrict it to specific partner emails or your firm's domain, say so and this can be added as a next step (a small allowed-emails table plus a database check, or a domain check in the login form).

**Signing out:** each partner can sign out from the "Sign out" button in the top bar (or on the partner-picker screen). Signing out clears their session; the next visit asks for a fresh magic link.

## 5. Deploy to Vercel

1. Push this repo to GitHub.
2. In Vercel: **New Project → Import** the repo. Vercel auto-detects Vite.
3. Before the first deploy, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` under **Project Settings → Environment Variables** (same values as `.env.local`).
4. Deploy, then go back to Supabase's **Authentication → URL Configuration** and make sure the Vercel URL is set as the Site URL / in Redirect URLs (see step 4 above) — otherwise magic links will redirect to the wrong place.
5. Share the resulting URL with the partners.

## How storage works

The original artifact persisted data through `window.storage.get()` / `window.storage.set()`, an API that only exists inside Claude's artifact sandbox. `src/lib/storagePolyfill.js` re-implements that exact interface, so the rest of the app (`src/App.jsx`, unchanged from the artifact source) keeps working without modification — with one important distinction the artifact itself relies on:

- **Shared data** (`shared=true`, the default) — `kkn-partners`, `kkn-prospects`, `kkn-referrals`, `kkn-activity`, `kkn-tenders`, `kkn-tender-vault`, `kkn-clients` — is stored as rows in the Supabase `kkn_kv` table, so every partner sees the same board.
- **Private, per-device data** (`shared=false`) — `seen-prospects`, `seen-clients`, `seen-referrals`, `seen-tenders`, `seen-activity-types` (which power the notification-bell "unseen" badges) and `watchlist` (the private per-partner Watchlist) — is stored in the browser's own `localStorage`, namespaced under `kkn-local:`. This never syncs to Supabase or to other partners/devices, matching the artifact's intent that this data stay personal (the Watchlist panel explicitly says "Private to you — names here don't show up to other partners"). A practical consequence: a partner's watchlist and "seen" state are tied to one browser — they won't follow that partner to a different device.

## How sign-in works

`src/Login.jsx` is a simple email field that calls Supabase's `signInWithOtp`, which emails the partner a one-tap magic link — no password to create or remember. `src/lib/AuthGate.jsx` wraps the whole app: it checks for an existing Supabase session on load, shows `Login` if there isn't one, and renders the app (with a `signOut` handler wired into the "Sign out" buttons) once there is. The `kkn_kv` table's row-level-security policy only allows authenticated requests, so this isn't just a UI gate — signed-out visitors can't read or write shared data even by calling Supabase directly.

## What's new vs. the original KKN Revenue Engine

- **Notification bell** — a combined feed of everything with unseen activity across prospects, clients, referrals, and tenders, plus scorecard activity types.
- **Insights tab** — firm-wide and by-partner analytics (including a "compare all partners" leaderboard), all-time or by-month, with bar charts via `recharts`.
- **My Watchlist** — a private, per-partner list of organizations being quietly cultivated before they become a real pipeline Prospect; promotes to a full Prospect record when ready.
- **Client types** — clients are now tagged Institutional or Individual.
- **Reminders calendar view** — a month-grid view of upcoming next actions, with reschedule support.
- **Referral attribution** — prospects can be linked to the specific client or referral partner that brought them in, powering "🤝 X referred" badges and impact panels (deals referred, won value, pipeline value).
- **Contact quick-actions** — one-tap call/email links on prospect and client contacts.
- **Sample-data generator** — a built-in control to load or clear a full set of realistic demo data.

## Known limitations / good next steps

- **No live sync yet.** Partners see each other's shared-data changes on their next page load or save, not instantly. Wiring up [Supabase Realtime](https://supabase.com/docs/guides/realtime) subscriptions would push updates live — worth doing once this is in daily use.
- **Open sign-up.** Any email can request a magic link and get in — there's no allowlist restricting it to firm partners yet. Easy to add later (allowed-emails table, or a domain check) once you know exactly who should have access.
- **Watchlist/seen-state is per-browser.** Since this data is intentionally private and stored in `localStorage`, it won't follow a partner across devices or browsers — only the shared board data does.
- **Voice input** uses the browser's `SpeechRecognition` API (Chrome/Edge only); it degrades gracefully elsewhere.
