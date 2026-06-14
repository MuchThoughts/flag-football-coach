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
NEXT_PUBLIC_ENABLE_ASSISTANT_INVITES=false
```

4. Restart the dev server.
5. Go to `More > Supabase` to create an account or sign in.

## Assistant Coaches

Assistant invites are optional and hidden by default. Enable them by setting:

```env
NEXT_PUBLIC_ENABLE_ASSISTANT_INVITES=true
```

Head coaches can then create assistant invite codes from `More > Supabase`.

1. Sign in as the head coach.
2. Enter the assistant email.
3. Choose whether they can add notes or advance drives.
4. Create an invite code and send it to the assistant.
5. The assistant signs in, opens `More > Supabase`, enters the code under `Join Team`, and accepts.

If your database was created before assistant invites existed, run:

```text
supabase/migrations/202606130001_assistant_invites.sql
```

## Verification

```bash
npm run test:logic
npm run typecheck
npm run build
```
