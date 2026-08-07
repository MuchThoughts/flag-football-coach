import assert from 'node:assert/strict'
import { mergeDriveNotes } from '../lib/drive-notes'
import { autoFillDrive, computeUsage, getDriveWarnings, isSlotFillable } from '../lib/fair-play'
import { getGameSummary, getResultCount } from '../lib/game-summary'
import { migrateAppState } from '../lib/migrate-state'
import {
  countPlaysByFormation,
  defaultFormationPositions,
  emptyPlayFilters,
  filterPlays,
  getFormationPosition
} from '../lib/playbook'
import {
  createEmptyAssignments,
  DEFENSE_SLOTS,
  getSlotPosition,
  LINE_OF_SCRIMMAGE,
  OFFENSE_SLOTS,
  slotPositionKey
} from '../lib/positions'
import { snapToField } from '../lib/snapping'
import { createDrive, initialAppState, samplePlayers } from '../lib/sample-data'
import { computeSeasonUsage, getAttendanceSummary } from '../lib/season-analytics'
import { normalizeAppStateForSupabase } from '../lib/supabase/app-state'
import type { PlaybookPlay, ResolvedDrive } from '../lib/types'
import { createLineups, defaultLineupSlot, findLineup, lineupId, resolveDrive, resolveDrives } from '../lib/lineups'

function assignedIds(assignments: Record<string, string | null>) {
  return Object.values(assignments).filter(Boolean)
}

const unavailable = { 'p-luther': false }

assert.equal(OFFENSE_SLOTS.length, 7)
assert.equal(DEFENSE_SLOTS.length, 7)
assert.equal(new Set(OFFENSE_SLOTS.map((slot) => slot.code)).size, 7)
assert.equal(new Set(DEFENSE_SLOTS.map((slot) => slot.code)).size, 7)

const lineups = createLineups('team-wildcats')
function resolved(drive: ReturnType<typeof createDrive>, assignments: Record<string, string | null> = {}): ResolvedDrive {
  return { ...drive, assignments: { ...createEmptyAssignments(drive.unit), ...assignments }, backups: {} }
}

const emptyOffense = resolved(createDrive('test-offense', 'offense', 1, 'test-game'))
const emptyWarnings = getDriveWarnings(emptyOffense, samplePlayers, unavailable)
assert.equal(emptyWarnings.some((warning) => warning.message === '7 open positions'), true)

const duplicateDrive = resolved(createDrive('dupe-test', 'offense', 1, 'test-game'), {
  C: 'p-rhett',
  QB: 'p-rhett'
})
const duplicateWarnings = getDriveWarnings(duplicateDrive, samplePlayers, unavailable)
assert.equal(duplicateWarnings.some((warning) => warning.message === 'Duplicate player assignment'), true)

const filledDrive = autoFillDrive(emptyOffense, samplePlayers, unavailable, [emptyOffense])
assert.equal(assignedIds(filledDrive.assignments).length, 7)
assert.equal(assignedIds(filledDrive.assignments).includes('p-luther'), false)

assert.equal(samplePlayers.length, 11)
assert.equal(samplePlayers.every((player) => player.firstName.trim().length > 0), true)

const gameId = initialAppState.selectedGameId
const seedDrives = resolveDrives(initialAppState.drives, initialAppState.lineups)
const usage = computeUsage(samplePlayers, seedDrives, initialAppState.availabilityByGame[gameId])
const dodgerUsage = usage.find((playerUsage) => playerUsage.playerId === 'p-dodger')
const gradyUsage = usage.find((playerUsage) => playerUsage.playerId === 'p-grady')
assert.equal(dodgerUsage?.totalDrives, 2)
assert.equal(gradyUsage?.totalDrives, 1)

const seasonUsage = computeSeasonUsage(samplePlayers, seedDrives, initialAppState.availabilityByGame)
const dodgerSeasonUsage = seasonUsage.find((playerUsage) => playerUsage.playerId === 'p-dodger')
const gradySeasonUsage = seasonUsage.find((playerUsage) => playerUsage.playerId === 'p-grady')
assert.equal(dodgerSeasonUsage?.totalDrives, 2)
assert.equal(gradySeasonUsage?.totalDrives, 1)

const attendance = getAttendanceSummary(samplePlayers, initialAppState.games, { [gameId]: unavailable })
const dodgerAttendance = attendance.find((playerAttendance) => playerAttendance.playerId === 'p-dodger')
const lutherAttendance = attendance.find((playerAttendance) => playerAttendance.playerId === 'p-luther')
assert.equal(dodgerAttendance?.presentGames, 1)
assert.equal(lutherAttendance?.presentGames, 0)

const normalizedSupabaseState = normalizeAppStateForSupabase({
  ...initialAppState,
  appSettings: {
    ...initialAppState.appSettings,
    role: 'assistant'
  }
})
assert.equal(normalizedSupabaseState.appSettings.role, 'head')

const scoringDrives = [
  { ...createDrive('score-off-1', 'offense', 1, 'score-game'), status: 'completed' as const, result: 'TD' as const },
  { ...createDrive('score-off-xp', 'offense', 2, 'score-game'), status: 'completed' as const, result: 'Extra Point' as const },
  { ...createDrive('score-def-1', 'defense', 1, 'score-game'), status: 'completed' as const, result: 'TD Allowed' as const },
  { ...createDrive('score-def-2', 'defense', 2, 'score-game'), status: 'planned' as const }
]
const scoreSummary = getGameSummary(scoringDrives)
assert.equal(scoreSummary.teamScore, 7)
assert.equal(scoreSummary.opponentScore, 6)
assert.equal(scoreSummary.completedDrives, 3)
assert.equal(scoreSummary.remainingDrives, 1)
assert.equal(getResultCount(scoreSummary, 'TD'), 1)
assert.equal(getResultCount(scoreSummary, 'TD Allowed'), 1)

// A touchdown counts for whoever had the ball, and the conversion follows it.
const unitScoring = getGameSummary([
  { ...createDrive('u-off-td', 'offense', 1, 'unit-game'), status: 'completed', result: 'TD', conversion: 'extra_point' },
  { ...createDrive('u-off-td2', 'offense', 2, 'unit-game'), status: 'completed', result: 'TD', conversion: 'two_point' },
  { ...createDrive('u-def-td', 'defense', 1, 'unit-game'), status: 'completed', result: 'TD', conversion: 'extra_point' },
  { ...createDrive('u-def-stop', 'defense', 2, 'unit-game'), status: 'completed', result: 'Stop' }
])
assert.equal(unitScoring.teamScore, 15)
assert.equal(unitScoring.opponentScore, 7)
assert.equal(unitScoring.scoringPlays.filter((play) => play.team === 'opponent').length, 1)

const bareTouchdowns = getGameSummary([
  { ...createDrive('b-off-td', 'offense', 1, 'bare-game'), status: 'completed', result: 'TD' },
  { ...createDrive('b-def-td', 'defense', 1, 'bare-game'), status: 'completed', result: 'TD' }
])
assert.equal(bareTouchdowns.teamScore, 6)
assert.equal(bareTouchdowns.opponentScore, 6)

// An unfinished drive never scores, conversion or not.
const pendingTouchdown = getGameSummary([
  { ...createDrive('p-off-td', 'offense', 1, 'pending-game'), result: 'TD', conversion: 'two_point' }
])
assert.equal(pendingTouchdown.teamScore, 0)

const mergedNotes = mergeDriveNotes(
  {
    whatWorked: 'Sweep',
    whatFailed: '',
    playerNotes: 'Locklan disciplined',
    playCalls: '',
    result: '',
    freeform: ''
  },
  'TD',
  {
    whatWorked: 'Motion',
    whatFailed: 'Late handoff',
    playCalls: 'Sweep Right',
    freeform: 'Next: short routes'
  }
)
assert.equal(mergedNotes.result, 'TD')
assert.equal(mergedNotes.whatWorked, 'Sweep; Motion')
assert.equal(mergedNotes.whatFailed, 'Late handoff')
assert.equal(mergedNotes.playerNotes, 'Locklan disciplined')
assert.equal(mergedNotes.playCalls, 'Sweep Right')
assert.equal(mergedNotes.freeform, 'Next: short routes')

const legacyPlayer = {
  id: 'p-jack',
  teamId: 'team-wildcats',
  firstName: 'Jack',
  lastName: 'Miller',
  jerseyNumber: '7',
  active: true,
  offenseRatings: { QB: 5, C: 2, WR: 4, RB: 3 },
  defenseRatings: { R: 2, S: 4, MLB: 4, CB: 3, E: 3 },
  notes: ''
}
const legacyState = {
  ...initialAppState,
  lineups: undefined,
  players: [legacyPlayer],
  games: [{ ...initialAppState.games[0], opponent: 'Eagles' }],
  drives: [
    {
      ...createDrive('legacy-off-1', 'offense', 1),
      assignments: { QB: 'p-jack' }
    }
  ],
  availabilityByGame: { [gameId]: { 'p-jack': false } }
} as unknown as typeof initialAppState

const migrated = migrateAppState(legacyState)
assert.equal(migrated.players.length, 11)
assert.equal(migrated.players[0].id, 'p-rhett')
assert.equal(migrated.players.some((player) => player.firstName === 'Jack'), false)
assert.equal('lastName' in migrated.players[0], false)
assert.equal('jerseyNumber' in migrated.players[0], false)
assert.equal('opponent' in migrated.games[0], false)
assert.equal(findLineup(migrated.lineups, migrated.drives[0])?.assignments.QB, 'p-rhett')
assert.equal(migrated.availabilityByGame[gameId]['p-rhett'], false)

const coachEditedState = {
  ...initialAppState,
  players: [...samplePlayers, { ...samplePlayers[0], id: 'player-custom', firstName: 'Sean' }]
}
const untouchedRoster = migrateAppState(coachEditedState)
assert.equal(untouchedRoster.players.length, 12)
assert.equal(untouchedRoster.players[11].firstName, 'Sean')

// Demo roster plus a player the coach added: demo names go, the coach's player stays put.
const customPlayer = {
  id: 'player-custom',
  teamId: 'team-wildcats',
  firstName: 'Sean',
  active: true,
  offenseRatings: { QB: 3, C: 3, WR: 3, RB: 3 },
  defenseRatings: { R: 3, S: 3, MLB: 3, CB: 3, E: 3 },
  notes: ''
}
const mixedState = {
  ...initialAppState,
  lineups: undefined,
  players: [legacyPlayer, customPlayer],
  drives: [
    {
      ...createDrive('mixed-off-1', 'offense', 1),
      assignments: { QB: 'p-jack', RB: 'player-custom' }
    }
  ],
  availabilityByGame: { [gameId]: { 'p-jack': false, 'player-custom': false } }
} as unknown as typeof initialAppState

const mixed = migrateAppState(mixedState)
assert.equal(mixed.players.some((player) => player.firstName === 'Jack'), false)
assert.equal(mixed.players.some((player) => player.firstName === 'Rhett'), true)
assert.equal(mixed.players.filter((player) => player.id === 'player-custom').length, 1)
assert.equal(mixed.players.length, 12)
const mixedLineup = findLineup(mixed.lineups, mixed.drives[0])
assert.equal(mixedLineup?.assignments.QB, 'p-rhett')
assert.equal(mixedLineup?.assignments.RB, 'player-custom')
assert.equal(mixed.availabilityByGame[gameId]['player-custom'], false)

// A player who is out keeps their spot (shown red on the field) until auto-fill replaces them.
const driveWithOutPlayer = resolved(createDrive('out-test', 'offense', 1, 'test-game'), {
  QB: 'p-luther',
  C: 'p-rhett'
})
assert.equal(isSlotFillable('p-luther', samplePlayers, unavailable), true)
assert.equal(isSlotFillable('p-rhett', samplePlayers, unavailable), false)
assert.equal(isSlotFillable(null, samplePlayers, unavailable), true)
assert.equal(isSlotFillable('p-deleted', samplePlayers, unavailable), true)

const refilled = autoFillDrive(driveWithOutPlayer, samplePlayers, unavailable, [driveWithOutPlayer])
assert.equal(assignedIds(refilled.assignments).length, 7)
assert.equal(assignedIds(refilled.assignments).includes('p-luther'), false)
assert.equal(refilled.assignments.C, 'p-rhett')

const outWarnings = getDriveWarnings(driveWithOutPlayer, samplePlayers, unavailable)
assert.equal(outWarnings.some((warning) => warning.message === 'Luther is not available'), true)

assert.equal(initialAppState.team.name, 'Franklin Dolphins')
assert.deepEqual(OFFENSE_SLOTS.map((slot) => slot.shortName).sort(), ['1', '2', '3', '4', 'C', 'QB', 'RB'])

const renamedTeam = migrateAppState({
  ...initialAppState,
  team: { ...initialAppState.team, name: 'Wildcats' }
} as unknown as typeof initialAppState)
assert.equal(renamedTeam.team.name, 'Franklin Dolphins')

const customTeamName = migrateAppState({
  ...initialAppState,
  team: { ...initialAppState.team, name: 'Franklin Dolphins Blue' }
} as unknown as typeof initialAppState)
assert.equal(customTeamName.team.name, 'Franklin Dolphins Blue')

const qbSlot = OFFENSE_SLOTS.find((slot) => slot.code === 'QB')!
assert.deepEqual(getSlotPosition(qbSlot, {}), { x: qbSlot.x, y: qbSlot.y })
assert.deepEqual(getSlotPosition(qbSlot, { [slotPositionKey('offense', 'QB')]: { x: 20, y: 40 } }), { x: 20, y: 40 })
assert.deepEqual(getSlotPosition(qbSlot, { [slotPositionKey('defense', 'QB')]: { x: 20, y: 40 } }), { x: qbSlot.x, y: qbSlot.y })

const statelessPositions = migrateAppState({ ...initialAppState, slotPositions: undefined } as unknown as typeof initialAppState)
assert.deepEqual(statelessPositions.slotPositions, {})

// Games and drives saved before names, backups and conversions existed.
const preNamedGames = migrateAppState({
  ...initialAppState,
  games: [
    { ...initialAppState.games[0], name: undefined },
    { ...initialAppState.games[0], id: 'game-2', name: undefined }
  ],
  drives: [{ ...createDrive('legacy-drive', 'offense', 1), conversion: undefined }]
} as unknown as typeof initialAppState)
assert.equal(preNamedGames.games[0].name, 'Game 1')
assert.equal(preNamedGames.games[1].name, 'Game 2')
assert.equal(preNamedGames.drives[0].conversion, '')
// Every drive points at one of the eight lineups.
assert.equal(Boolean(findLineup(preNamedGames.lineups, preNamedGames.drives[0])), true)

const namedGame = migrateAppState({
  ...initialAppState,
  games: [{ ...initialAppState.games[0], name: 'Season Opener' }]
} as unknown as typeof initialAppState)
assert.equal(namedGame.games[0].name, 'Season Opener')

// ---- Playbook ----
assert.equal(initialAppState.formations.length, 2)
assert.equal(
  initialAppState.plays.every((play) => initialAppState.formations.some((formation) => formation.id === play.formationId)),
  true
)
assert.deepEqual(Object.keys(defaultFormationPositions()).sort(), ['1', '2', '3', '4', 'C', 'QB', 'RB'])

const trips = initialAppState.formations.find((formation) => formation.name === 'Trips Right')!
assert.deepEqual(getFormationPosition('3', trips), { x: 76, y: 52 })
// A position the formation does not place falls back to its default spot.
assert.deepEqual(getFormationPosition('QB', { ...trips, positions: {} }), { x: 50, y: 72 })

const catalog: PlaybookPlay[] = [
  { ...initialAppState.plays[0], id: 'p1', name: 'Sweep Right', type: 'run' as const, area: 'sidelines' as const, formationId: 'formation-balanced', notes: 'edge crashes' },
  { ...initialAppState.plays[0], id: 'p2', name: 'Post Wheel', type: 'pass' as const, area: 'deep' as const, formationId: 'formation-trips-right', notes: '' },
  { ...initialAppState.plays[0], id: 'p3', name: 'Dive', type: 'run' as const, area: 'middle' as const, formationId: 'formation-balanced', notes: '' }
]
const ids = (result: PlaybookPlay[]) => result.map((play) => play.id).join(',')

assert.equal(ids(filterPlays(catalog, initialAppState.formations, emptyPlayFilters)), 'p1,p2,p3')
assert.equal(ids(filterPlays(catalog, initialAppState.formations, { ...emptyPlayFilters, type: 'run' })), 'p1,p3')
assert.equal(ids(filterPlays(catalog, initialAppState.formations, { ...emptyPlayFilters, area: 'deep' })), 'p2')
assert.equal(
  ids(filterPlays(catalog, initialAppState.formations, { ...emptyPlayFilters, formationId: 'formation-balanced' })),
  'p1,p3'
)
// Search covers name, notes and the formation name.
assert.equal(ids(filterPlays(catalog, initialAppState.formations, { ...emptyPlayFilters, search: 'sweep' })), 'p1')
assert.equal(ids(filterPlays(catalog, initialAppState.formations, { ...emptyPlayFilters, search: 'CRASHES' })), 'p1')
assert.equal(ids(filterPlays(catalog, initialAppState.formations, { ...emptyPlayFilters, search: 'trips' })), 'p2')
assert.equal(
  ids(filterPlays(catalog, initialAppState.formations, { ...emptyPlayFilters, search: 'e', type: 'run', area: 'sidelines' })),
  'p1'
)
assert.equal(ids(filterPlays(catalog, initialAppState.formations, { ...emptyPlayFilters, search: 'nothing here' })), '')
assert.equal(countPlaysByFormation(catalog, 'formation-balanced'), 2)

// Plays saved with a free-text formation and tags become real formations.
const legacyPlaybook = migrateAppState({
  ...initialAppState,
  formations: undefined,
  plays: [
    { id: 'old-1', teamId: 'team-wildcats', name: 'Sweep Right', formation: 'Balanced', positions: 'RB motion right', notes: 'edge crashes', tags: ['run', 'outside'] },
    { id: 'old-2', teamId: 'team-wildcats', name: 'Slot Cross', formation: 'Trips Right', positions: '2 shallow', notes: '', tags: ['pass', 'middle'] },
    { id: 'old-3', teamId: 'team-wildcats', name: 'Go Route', formation: 'Balanced', positions: '', notes: '', tags: ['pass', 'deep'] }
  ]
} as unknown as typeof initialAppState)

assert.equal(legacyPlaybook.formations.length, 2)
assert.deepEqual(legacyPlaybook.formations.map((formation) => formation.name).sort(), ['Balanced', 'Trips Right'])
assert.equal(legacyPlaybook.plays[0].type, 'run')
assert.equal(legacyPlaybook.plays[0].area, 'sidelines')
assert.equal(legacyPlaybook.plays[0].notes, 'RB motion right edge crashes')
assert.equal(legacyPlaybook.plays[1].area, 'middle')
assert.equal(legacyPlaybook.plays[2].type, 'pass')
assert.equal(legacyPlaybook.plays[2].area, 'deep')
// Both Balanced plays point at the same generated formation.
assert.equal(legacyPlaybook.plays[0].formationId, legacyPlaybook.plays[2].formationId)
assert.equal(
  legacyPlaybook.plays.every((play) => legacyPlaybook.formations.some((formation) => formation.id === play.formationId)),
  true
)

// Legacy plays have nothing drawn on them yet.
assert.deepEqual(legacyPlaybook.plays[0].routes, [])
assert.deepEqual(legacyPlaybook.plays[0].footballs, [])

// A play saved before drawing existed keeps its fields and gains empty ones.
const predrawing = migrateAppState({
  ...initialAppState,
  plays: [{ ...initialAppState.plays[0], routes: undefined, footballs: undefined }]
} as unknown as typeof initialAppState)
assert.deepEqual(predrawing.plays[0].routes, [])
assert.deepEqual(predrawing.plays[0].footballs, [])
assert.equal(predrawing.plays[0].name, 'Sweep Right')

// Seeded plays ship with a drawing, including a dashed pass and a handoff.
assert.equal(initialAppState.plays[0].footballs.length, 1)
assert.equal(initialAppState.plays[1].routes.some((route) => route.style === 'dashed'), true)
assert.equal(
  initialAppState.plays.every((play) => play.routes.every((route) => route.points.length >= 2)),
  true
)

// Already-migrated playbooks are left alone.
const stablePlaybook = migrateAppState(initialAppState)
assert.deepEqual(stablePlaybook.plays.map((play) => play.id), initialAppState.plays.map((play) => play.id))
assert.deepEqual(stablePlaybook.formations.map((f) => f.id), initialAppState.formations.map((f) => f.id))

// ---- Lineups ----
assert.equal(lineups.length, 8)
assert.equal(lineups.filter((lineup) => lineup.unit === 'offense').length, 4)
assert.equal(lineups.filter((lineup) => lineup.unit === 'defense').length, 4)
assert.equal(initialAppState.lineups.length, 8)

// Drives cycle through the four lineups of their unit.
assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9].map(defaultLineupSlot), [1, 2, 3, 4, 1, 2, 3, 4, 1])
assert.equal(createDrive('d1', 'offense', 1, 'g').lineupId, lineupId('offense', 1))
assert.equal(createDrive('d5', 'offense', 5, 'g').lineupId, lineupId('offense', 1))
assert.equal(createDrive('d2', 'defense', 2, 'g').lineupId, lineupId('defense', 2))

// A drive can be pointed at any lineup of its unit.
const pickedDrive = { ...createDrive('picked', 'offense', 1, 'g'), lineupId: lineupId('offense', 3) }
assert.equal(findLineup(initialAppState.lineups, pickedDrive)?.slot, 3)
// A drive pointing at nothing falls back to the one its number cycles to.
const strayDrive = { ...createDrive('stray', 'defense', 2, 'g'), lineupId: 'gone' }
assert.equal(findLineup(initialAppState.lineups, strayDrive)?.slot, 2)
assert.equal(findLineup(initialAppState.lineups, strayDrive)?.unit, 'defense')

// Resolving fills a drive in with its lineup's assignments.
const firstOffense = initialAppState.drives.find((drive) => drive.unit === 'offense')!
assert.equal(resolveDrive(firstOffense, initialAppState.lineups).assignments.QB, 'p-rhett')
// The seeded second and third drives take empty lineups, so nobody plays them yet.
const secondOffense = initialAppState.drives.filter((drive) => drive.unit === 'offense')[1]
assert.equal(assignedIds(resolveDrive(secondOffense, initialAppState.lineups).assignments).length, 0)

// ---- Snapping ----
// Nothing nearby: fall back to the grid, which is square on a field twice as wide.
assert.deepEqual(snapToField({ x: 31.2, y: 33.4 }, []), { x: 32, y: 32, onLine: false })
assert.deepEqual(snapToField({ x: 30.9, y: 38.4 }, []), { x: 30, y: 40, onLine: false })

// The line of scrimmage pulls from further away than the grid.
const nearLine = snapToField({ x: 40, y: LINE_OF_SCRIMMAGE - 6 }, [])
assert.equal(nearLine.y, LINE_OF_SCRIMMAGE)
assert.equal(nearLine.onLine, true)
const offLine = snapToField({ x: 40, y: LINE_OF_SCRIMMAGE - 9 }, [])
assert.notEqual(offLine.y, LINE_OF_SCRIMMAGE)
assert.equal(offLine.onLine, false)

// A neighbour close by wins over the grid, and reports a guide to draw.
const alignedToNeighbour = snapToField({ x: 26.4, y: 30.5 }, [{ x: 27, y: 88 }])
assert.equal(alignedToNeighbour.x, 27)
assert.equal(alignedToNeighbour.alignedX, 27)
// Without that neighbour the same drag would land on the grid instead.
assert.equal(snapToField({ x: 26.4, y: 30.5 }, []).x, 26)
const alignedRow = snapToField({ x: 60, y: 30.5 }, [{ x: 8, y: 33 }])
assert.equal(alignedRow.y, 33)
assert.equal(alignedRow.alignedY, 33)

// The line beats neighbour alignment when both are in range.
const lineWins = snapToField({ x: 60, y: LINE_OF_SCRIMMAGE + 3 }, [{ x: 8, y: LINE_OF_SCRIMMAGE + 4 }])
assert.equal(lineWins.y, LINE_OF_SCRIMMAGE)
assert.equal(lineWins.alignedY, undefined)

// A far-away neighbour is ignored.
assert.equal(snapToField({ x: 50, y: 20 }, [{ x: 62, y: 20 }]).x, 50)

// Markers stay on the field, and a guide is dropped when clamping moves them off it.
const cornered = snapToField({ x: -20, y: 130 }, [{ x: -18, y: 128 }])
assert.equal(cornered.x >= 4 && cornered.x <= 96, true)
assert.equal(cornered.y >= 8 && cornered.y <= 92, true)
assert.equal(cornered.alignedX, undefined)

// Default spots are all snap-clean, so nothing jumps the first time it is dragged.
assert.equal(
  [...OFFENSE_SLOTS, ...DEFENSE_SLOTS].every((slot) => {
    const snapped = snapToField({ x: slot.x, y: slot.y }, [])
    return snapped.x === slot.x && snapped.y === slot.y
  }),
  true
)

// ---- Field layout migration ----
const legacyLayout = migrateAppState({
  ...initialAppState,
  slotPositions: {
    'offense:QB': { x: 50, y: 58 },
    'offense:RB': { x: 22, y: 40 },
    'defense:S': { x: 50, y: 78 }
  },
  formations: [
    { ...initialAppState.formations[0], positions: { '1': { x: 11, y: 78 }, QB: { x: 50, y: 58 } } },
    { ...initialAppState.formations[1], id: 'hand-made', positions: { QB: { x: 20, y: 20 } } }
  ]
} as unknown as typeof initialAppState)

// Spots left on the old defaults are dropped so the new ones apply.
assert.equal(legacyLayout.slotPositions['offense:QB'], undefined)
assert.equal(legacyLayout.slotPositions['defense:S'], undefined)
// A spot the coach dragged is kept.
assert.deepEqual(legacyLayout.slotPositions['offense:RB'], { x: 22, y: 40 })
// An untouched formation is relaid out; a hand-made one is not.
assert.deepEqual(legacyLayout.formations[0].positions, defaultFormationPositions())
assert.deepEqual(legacyLayout.formations[1].positions, { QB: { x: 20, y: 20 } })

console.log('logic tests passed')
