# Bideey

Bideey is a shared business-development workspace for law-firm teams — prospects, referrals, tenders, clients, activity tracking, a monthly scorecard, and firm-wide Insights. It runs as a standalone Vite + React app backed by Supabase.

The app now supports invite-only firm workspaces so each firm sees only its own pipeline, clients, referrals, tenders, activity, and settings. It also includes a notification bell with an unseen-updates feed, an Insights tab (firm-wide and by-partner analytics with charts, powered by `recharts`), a private per-partner Watchlist, client types, a Reminders calendar view, referral-attribution tracking ("🤝 X referred"), contact quick-actions (call/email), and a built-in sample-data generator.

## 1. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com) (free tier is fine).
2. Open **SQL Editor → New query**, paste in the contents of [`supabase/schema.sql`](./supabase/schema.sql), and run it. This creates the multitenant `firms`, `firm_members`, `firm_invites`, and `firm_kv` tables, adds row-level-security policies, migrates any old `kkn_kv` rows into the seeded KKN firm, and seeds the original KKN starter records when needed.
3. Go to **Project Settings → API** and copy the **Project URL** and the **anon / public** key.

### Adding a firm

The first user for a firm signs in and creates that firm's workspace in the app. That user becomes the firm owner. Everyone else must join through an invite link created inside **Settings → Firm Access** by the owner or an admin.

A user can belong to one firm only. The database enforces this with a unique membership constraint, so the app never needs to ask users which firm to open.

If you are migrating the original seeded KKN workspace, let the first KKN owner sign in once, then run this once in Supabase SQL Editor so they can access the migrated KKN data and create invite links:

```sql
insert into firm_members (firm_id, user_id, role)
select 'kkn', id, 'owner'
from auth.users
where email = 'person@example.com'
on conflict (user_id) do update set firm_id = excluded.firm_id, role = excluded.role;
```

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

Open the printed local URL. Pick a partner, add a prospect, and confirm it persists after a refresh — then check the same firm's rows appear in Supabase's **Table Editor → firm_kv**.

## 4. Turn on magic-link sign-in

Users sign in with a Supabase magic link before they can see their firm's workspace — no password to manage.

1. In Supabase: **Authentication → Providers → Email**. Make sure Email is enabled. "Confirm email" can stay on or off — it doesn't affect magic links either way.
2. Still in Authentication, go to **URL Configuration** and set:
   - **Site URL**: your deployed app's URL (e.g. `https://app.bideey.com`). While testing locally, you can temporarily set this to `http://localhost:5173` instead, then switch it back once deployed.
   - **Redirect URLs**: add both `http://localhost:5173` (local dev) and your production URL, so the login link works from either.
3. That's it for authentication. `supabase/schema.sql` enforces the real access boundary: signed-in users can only read or write `firm_kv` rows for firms where they have a `firm_members` record.

**Who can sign in:** anyone can request a magic link, but they only enter a firm workspace after creating the first workspace for a firm or accepting an invite link. Users do not pick a firm, and there is no public list of firms.

**Signing out:** each partner can sign out from the "Sign out" button in the top bar (or on the partner-picker screen). Signing out clears their session; the next visit asks for a fresh magic link.

## 5. Deploy to Vercel

1. Push this repo to GitHub.
2. In Vercel: **New Project → Import** the repo. Vercel auto-detects Vite.
3. Before the first deploy, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` under **Project Settings → Environment Variables** (same values as `.env.local`).
4. Deploy, then go back to Supabase's **Authentication → URL Configuration** and make sure the Vercel URL is set as the Site URL / in Redirect URLs (see step 4 above) — otherwise magic links will redirect to the wrong place.
5. Share the resulting URL with the partners.

## 6. Landing page

The static marketing site lives in [`landing/`](./landing/). It is plain HTML, CSS, and JavaScript so it can be copied into cPanel hosting for `bideey.com` while the app itself continues to run separately at `app.bideey.com`.

## How storage works

The original artifact persisted data through `window.storage.get()` / `window.storage.set()`, an API that only exists inside Claude's artifact sandbox. `src/lib/storagePolyfill.js` re-implements that exact interface, so the rest of the app (`src/App.jsx`, unchanged from the artifact source) keeps working without modification — with one important distinction the artifact itself relies on:

- **Shared firm data** (`shared=true`, the default) — `kkn-partners`, `kkn-prospects`, `kkn-referrals`, `kkn-activity`, `kkn-tenders`, `kkn-tender-vault`, `kkn-clients`, and firm settings — is stored in Supabase `firm_kv` rows keyed by `(firm_id, key)`. Row-level security checks the logged-in user's `firm_members` row before every read or write, so users from one firm cannot access another firm's data even by calling Supabase directly.
- **Private, per-device data** (`shared=false`) — `seen-prospects`, `seen-clients`, `seen-referrals`, `seen-tenders`, `seen-activity-types` (which power the notification-bell "unseen" badges) and `watchlist` (the private per-partner Watchlist) — is stored in the browser's own `localStorage`, namespaced by firm and user. This never syncs to Supabase or to other partners/devices, matching the artifact's intent that this data stay personal. A practical consequence: a partner's watchlist and "seen" state are tied to one browser — they won't follow that partner to a different device.

## How sign-in works

`src/Login.jsx` is a simple email field that calls Supabase's `signInWithOtp`, which emails the user a one-tap magic link — no password to create or remember. Invite links keep their `?invite=...` token through that magic-link round trip. `src/lib/AuthGate.jsx` wraps the whole app: it checks for an existing Supabase session on load, accepts any invite token, fetches the user's single firm membership, configures storage with that firm, and renders only that firm's workspace. The `firm_kv` table's row-level-security policy only allows access to rows for that firm, so this isn't just a UI gate — signed-out users and users from other firms cannot read or write the workspace data directly.

## What's included

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
- **Invite management is basic.** Owners/admins can create invite links in the app, but there is not yet a full screen for revoking invites or removing existing users.
- **Watchlist/seen-state is per-browser.** Since this data is intentionally private and stored in `localStorage`, it won't follow a partner across devices or browsers — only the shared board data does.
- **Voice input** uses the browser's `SpeechRecognition` API (Chrome/Edge only); it degrades gracefully elsewhere.
