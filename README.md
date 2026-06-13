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

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the Supabase SQL editor.
3. Create `.env.local` from `.env.example`:

```env
NEXT_PUBLIC_SUPABASE_URL=your_project_url
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_publishable_key
```

4. Restart the dev server.
5. Go to `More > Supabase` to create an account or sign in.

## Verification

```bash
npm run test:logic
npm run typecheck
npm run build
```
