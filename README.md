# KKN Revenue Engine

Shared business-development pipeline board for KKN Law LLP partners — prospects, referrals, tenders, clients, activity tracking and a monthly scorecard. Ported from a Claude artifact into a standalone Vite + React app, backed by Supabase instead of the artifact-only `window.storage` API.

## 1. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com) (free tier is fine).
2. Open **SQL Editor → New query**, paste in the contents of [`supabase/schema.sql`](./supabase/schema.sql), and run it. This creates the `kkn_kv` table, the access policy, and seeds the default partner list.
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

## 4. Deploy to Vercel

1. Push this repo to GitHub.
2. In Vercel: **New Project → Import** the repo. Vercel auto-detects Vite.
3. Before the first deploy, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` under **Project Settings → Environment Variables** (same values as `.env.local`).
4. Deploy. Share the resulting URL with the partners.

## How storage works

The original artifact persisted data through `window.storage.get()` / `window.storage.set()`, an API that only exists inside Claude's artifact sandbox. `src/lib/storagePolyfill.js` re-implements that exact interface on top of Supabase, so the rest of the app (`src/App.jsx`, effectively unchanged from the original) keeps working without modification. Every key (`kkn-partners`, `kkn-prospects`, `kkn-referrals`, `kkn-activity`, `kkn-tenders`, `kkn-tender-vault`, `kkn-clients`) is stored as one row in the `kkn_kv` table.

## Known limitations / good next steps

- **No live sync yet.** Partners see each other's changes on their next page load or save, not instantly. Wiring up [Supabase Realtime](https://supabase.com/docs/guides/realtime) subscriptions would push updates live — worth doing once this is in daily use.
- **No login.** Anyone with the URL and the anon key can read/write the board (matches the original artifact's design — partners just pick their name from a list). If this needs to be restricted to firm partners only, add Supabase Auth and tighten the row-level-security policy in `supabase/schema.sql`.
- **Voice input** uses the browser's `SpeechRecognition` API (Chrome/Edge only); it degrades gracefully elsewhere.
