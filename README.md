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

The toolbar across the top has **Playbooks** (where the app opens) and
**Roster** (with **Planning** and **Gameday** tabs), plus the game picker and
the sync status on the right.

Under **Playbooks** the team can keep several playbooks. A new playbook asks
how many players are on the field (3 to 11) and what each one's circle says
(QB, C, X, 1, and so on). Each playbook has its own formations and plays, so a
5v5 playbook and a 7v7 one never mix. Plays saved before playbooks existed are
in **Main Playbook**, with the original seven players.

### Personnel packages and formations

The **Packages** tab, next to **Formations**, shows every personnel package as
a table, edited right there and saved as you type. Each numbered player has a
**Position Type** (OL, QB, RB, TE or WR) and a free-text **Position Name**, the
label in their circle (up to 4 characters). So an RB in Base can be a TE named
Y in Heavy. **New Package** adds a table copied from the first package;
**Delete Packages** lets you tick the ones to remove, then confirm. Formations
in a deleted package move to the first one left.

**Players on the field**, at the top of the tab, changes how many players every
package in the playbook has (3 to 11). Added players get the next free number
as their name and WR as their type. In formations saved before, they take
their usual spot when it is free and otherwise wait in a row at the bottom of
the field, ready to drag in. Removing a player asks first, and takes the last
row off every package.

**New Formation** opens a full page with every player in the chosen package
already on the field, ready to drag into place. The field stays put: no
scrolling or zooming. Click a player to select them; shift-click, or drag a
box over empty grass, to select several, then drag any of them to move the
group (arrow keys nudge it). With two or more selected, **Align
Horizontally** puts them in a row, **Align Vertically** in a column, and
**Space Evenly** evens out the gaps. Drag the **LOS** tab beside the field to
move the line of scrimmage; players standing on the line move with it.

Click a formation card to edit it. Its plays are listed under the field, with
**New Play** at the top of that list to start one from this formation; a play
opens in the play editor and comes back here when you're done. **Duplicate**, at the top of the edit page,
saves the formation as it stands and makes a copy. **Flip** (on by default)
mirrors the copy left to right around the center, and every OL player keeps
their spot, so a left guard stays left. The name follows: "Trips Right" becomes
"Trips Left". The copy is placed next to its original.

The small star (**Set as base**) in the top bar makes a
formation the playbook's base: new formations start from it and new plays
pick it first. Switching a formation to
another package keeps everyone's spot and only changes the labels.

## Plays

The **Plays** tab lists every formation with its plays under it, runs first
(blue edge) then passes (gold edge). Search and the type, area and formation
filters narrow it down. Click a formation's name to open the formation, its
**+** to start a play from it, or a play to open it in the play editor.

## Drawing and naming plays

**New Play**, or clicking a play, opens the play editor: the field, as big as
the screen allows, with the formation's players fixed in place, and below it
the play's name, formation, pass or run, area, notes and call.

- **The call:** stack up components (Backfield, Quarterback, Receiver runs,
  Motion, Pass concepts, Single routes), with Fake, Left or Right and who
  carries it, the way you'd call it: "Fake HB Stretch Right QB Bootleg". The
  name follows the call, with the formation first, until you type your own
  (**Use the call** switches back), and the call sets pass or run and the area.
- **Moving around:** drag the grass to pan; scroll, pinch or use − / + to zoom
  (⛶ fits the whole field). The view you save with is how the play shows
  everywhere, in thumbnails, the image and printing, so zoom out for deep
  passes and in for runs.
- **Adding lines:** tap a player for **Block** (a short line with a bar across
  its end), **Motion** (a dotted line to a dashed copy of the player, which you
  drag to where they go), **Route** (solid), **Run** (bold blue), **Fake**
  (bold red), **Handoff** (ending in a big blue X) or **Fake Handoff** (a big
  red X). A handoff heads for the nearest running back.
- **What comes next:** select a motion, handoff or fake handoff (tap its end,
  or the dashed player) and the **Then** buttons add the player's next
  assignment from where it ends: a route after a motion, a bootleg after a
  fake handoff, even another motion. Moving the end takes what follows along.
- **Editing a line:** tap it to select it (it glows yellow and shows its
  handles). Drag the end, or any pivot, to reshape it. Double-click or hold on
  the line to add a pivot, and double-click a pivot to remove it. Drag the
  yellow dot in the middle of a segment to curve it. Tap the grass to let go;
  Delete removes the selected line (anything after it then starts from where
  it started), and the menu under the field can change its type.
- **Defenders:** **Add Defender**, top left of the field, drops a black X
  across the line. Drag it where the defender lines up; tap it for **Delete**.
  Defenders save with the play and show in its picture and printouts.
- **Right and left:** every play has a mirror image. **Right | Left** at the
  top flips the play: everyone mirrors across the center except the linemen,
  who keep their spots (a left guard stays left) and turn their blocks the
  other way. Lines, defenders and the view flip with them, and Right and Left
  swap in the call and the name ("Trips Right HB Dive Right" becomes "Trips
  Left HB Dive Left"). The play saves on whichever side is showing.
- **Image** at the top saves the play as a picture, right above left, at the
  view on screen.

## Call sheets

Open a playbook and tap **Call Sheet** to start one. A new sheet comes with
Openers, Runs, Passes, Red Zone and Extra Point boxes, with the playbook's runs
and passes already sorted in. Rename, reorder, add or remove boxes and plays,
then **Print** it on one landscape page, as play names only or with diagrams.
Plays are numbered straight through the sheet.

## Updates

An open tab or home-screen app keeps running the version it loaded. When a
newer version has been deployed, a yellow bar offers **Reload**.

## Exporting the playbook

- **Print or PDF:** open a playbook and tap **Export**. It prints every play
  in it twice, right then left (numbered 1R, 1L, 2R...), six to a page or one
  per page, with or without notes. Choose
  **Save as PDF** in the print dialog to keep a file.
- **One play as an image:** open a play and tap **Image**. On a phone
  the share sheet opens (Save Image, Messages, AirDrop); elsewhere a PNG
  downloads.

## Verification

```bash
npm run test:logic
npm run typecheck
npm run build
```
