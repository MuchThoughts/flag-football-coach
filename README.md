# Flag Football Coach

Mobile-first web app for youth flag football coaches to manage rosters, availability, 7v7 lineups, drive planning, game-day execution, notes, practices, playbook entries, and analytics.

## Local Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

The app works local-first with `localStorage` when Supabase is not configured.

## Supabase Setup

Sync is one shared dataset for the whole coaching staff: no accounts and no
sign-in. Every device that opens the app reads and writes the same team data
and receives everyone else's changes live.

1. Create a Supabase project.
2. Run `supabase/migrations/202608190001_shared_app_state.sql` in the Supabase SQL editor.
   (`supabase/schema.sql` holds the older account-based schema; the shared
   dataset does not need it.)
3. Create `.env.local` from `.env.example`:

```env
NEXT_PUBLIC_SUPABASE_URL=your_project_url
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_publishable_key
```

4. Restart the dev server. The cloud badge in the header shows the sync state,
   with manual Save and Refresh under it.

Anyone with the app URL shares the data — that is the point, so only hand the
URL to the coaching staff.

## Verification

```bash
npm run test:logic
npm run typecheck
npm run build
```
