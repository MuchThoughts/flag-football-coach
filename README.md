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
2. Run `supabase/migrations/202608190001_shared_app_state.sql` in the SQL editor.
3. Create `.env.local` from `.env.example`:

```env
NEXT_PUBLIC_SUPABASE_URL=your_project_url
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_publishable_key
```

4. Restart the dev server. The cloud badge in the header shows the sync state,
   with manual Save and Refresh under it.

Anyone with the app URL shares the data — that is the point, so only hand the
URL to the coaching staff.

### Filling the shared dataset the first time

The shared row starts empty, and **the first device to open the app publishes
whatever it is holding**. So open the app on the device whose data you want to
keep before handing the URL to anyone else. Every device that opens afterwards
adopts the shared data.

Before a device adopts shared data for the first time it copies its own
contents to `flag-football-coach:pre-sync-backup` in `localStorage` and never
overwrites that copy, so the state it held beforehand stays recoverable.

If you would rather seed from an old account-based snapshot than from a phone,
`supabase/migrations/202608190002_seed_shared_state.sql` walks through it. It
asks you to identify the team first rather than guessing, because every device
that ever signed up got its own team and the newest snapshot is often an
untouched one.

## Installing on iPhone, iPad and Mac

Host the app anywhere with HTTPS (Vercel's free Hobby plan works), then open
the URL and add it like an app. It gets its own icon and opens in its own
window, without browser bars.

- **iPhone / iPad:** in Safari, tap Share → **Add to Home Screen**.
- **Mac:** in Safari, choose File → **Add to Dock**. In Chrome, use the install
  icon in the address bar.

## Getting around

The toolbar across the top has **Home**, **Roster** (with **Planning** and
**Gameday** tabs) and **Playbooks**, plus the game picker and the sync status
on the right.

Under **Playbooks** the team can keep several playbooks. Each play belongs to
one playbook; formations are shared by all of them. Plays saved before
playbooks existed are in **Main Playbook**.

## Call sheets

Open a playbook and tap **Call Sheet** to start one. A new sheet comes with
Openers, Runs, Passes, Red Zone and Extra Point boxes, with the playbook's runs
and passes already sorted in. Rename, reorder, add or remove boxes and plays,
then **Print** it on one landscape page, as play names only or with diagrams.
Plays are numbered straight through the sheet.

## Exporting the playbook

- **Print or PDF:** open a playbook and tap **Export**. It prints every play
  in it, six to a page or one per page, with or without notes. Choose
  **Save as PDF** in the print dialog to keep a file.
- **One play as an image:** open a play and tap **Save as Image**. On a phone
  the share sheet opens (Save Image, Messages, AirDrop); elsewhere a PNG
  downloads.

## Verification

```bash
npm run test:logic
npm run typecheck
npm run build
```
