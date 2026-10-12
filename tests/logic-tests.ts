import assert from 'node:assert/strict'
import { mergeDriveNotes } from '../lib/drive-notes'
import {
  autoFillDrive,
  computeUsage,
  countSitOuts,
  getDriveWarnings,
  getRestWindowLineups,
  orderedLineups,
  isSlotFillable
} from '../lib/fair-play'
import { getGameSummary, getResultCount } from '../lib/game-summary'
import { migrateAppState } from '../lib/migrate-state'
import { phinsPlaybook } from '../lib/phins-playbook'
import { playDiagramSvg, playFileName } from '../lib/play-svg'
import { DEFAULT_POSITIONS, layoutPositions, positionLabelsValid, suggestedPositions } from '../lib/playbook'
import {
  createCallSheet,
  createPlaybook,
  ensurePlaybooks,
  MAIN_PLAYBOOK_ID,
  moveItem,
  numberCallSheet,
  BASE_PACKAGE_ID,
  createPackage,
  packageFor,
  removePlaysFromCallSheets,
  starterFormation
} from '../lib/playbooks'
import {
  classifySteps,
  COMPONENT_GROUPS,
  componentsInGroup,
  findComponent,
  parsePlayCall,
  playCallFromSteps,
  stepsFromPlay,
  PLAY_COMPONENTS,
  stepIsComplete,
  stepLabel
} from '../lib/play-builder'
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
import { compareLineups, previousDrive } from '../lib/substitutions'
import { createDrive, initialAppState, samplePlayers } from '../lib/sample-data'
import { computeSeasonUsage, getAttendanceSummary } from '../lib/season-analytics'
import { normalizeAppStateForSupabase } from '../lib/supabase/app-state'
import type { AppState, Playbook, PlaybookPlay, ResolvedDrive } from '../lib/types'
import { createLineup, createLineups, defaultLineupSlot, findLineup, lineupId, resolveDrive, resolveDrives } from '../lib/lineups'

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
// Games saved before the kickoff choice existed start on offense.
assert.equal(preNamedGames.games[0].startingUnit, 'offense')
assert.equal(
  migrateAppState({
    ...initialAppState,
    games: [{ ...initialAppState.games[0], startingUnit: 'defense' }]
  } as unknown as typeof initialAppState).games[0].startingUnit,
  'defense'
)
assert.equal(preNamedGames.drives[0].conversion, '')
// Every drive points at one of the eight lineups.
assert.equal(Boolean(findLineup(preNamedGames.lineups, preNamedGames.drives[0])), true)

const namedGame = migrateAppState({
  ...initialAppState,
  games: [{ ...initialAppState.games[0], name: 'Season Opener' }]
} as unknown as typeof initialAppState)
assert.equal(namedGame.games[0].name, 'Season Opener')

// ---- Playbook ----
// A new playbook ships with the formations and no plays.
assert.equal(initialAppState.formations.length, 9)
assert.deepEqual(initialAppState.plays, [])

const samplePlay: PlaybookPlay = {
  id: 'play-sample',
  teamId: 'team-wildcats',
  playbookId: 'playbook-main',
  name: 'Sweep Right',
  formationId: 'formation-phins-base',
  type: 'run',
  area: 'sidelines',
  notes: '',
  routes: [],
  footballs: [],
  createdAt: '',
  updatedAt: ''
}
assert.deepEqual(Object.keys(defaultFormationPositions()).sort(), ['1', '2', '3', '4', 'C', 'QB', 'RB'])

const trips = initialAppState.formations.find((formation) => formation.name === 'Trips Right')!
assert.deepEqual(getFormationPosition('3', trips), { x: 90, y: 72 })
// A position the formation does not place falls back to its default spot.
assert.deepEqual(getFormationPosition('QB', { ...trips, positions: {} }), { x: 50, y: 72 })

const catalog: PlaybookPlay[] = [
  { ...samplePlay, id: 'p1', name: 'Sweep Right', type: 'run' as const, area: 'sidelines' as const, formationId: 'formation-phins-base', notes: 'edge crashes' },
  { ...samplePlay, id: 'p2', name: 'Post Wheel', type: 'pass' as const, area: 'deep' as const, formationId: 'formation-phins-trips-right', notes: '' },
  { ...samplePlay, id: 'p3', name: 'Dive', type: 'run' as const, area: 'middle' as const, formationId: 'formation-phins-base', notes: '' }
]
const ids = (result: PlaybookPlay[]) => result.map((play) => play.id).join(',')

assert.equal(ids(filterPlays(catalog, initialAppState.formations, emptyPlayFilters)), 'p1,p2,p3')
assert.equal(ids(filterPlays(catalog, initialAppState.formations, { ...emptyPlayFilters, type: 'run' })), 'p1,p3')
assert.equal(ids(filterPlays(catalog, initialAppState.formations, { ...emptyPlayFilters, area: 'deep' })), 'p2')
assert.equal(
  ids(filterPlays(catalog, initialAppState.formations, { ...emptyPlayFilters, formationId: 'formation-phins-base' })),
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
assert.equal(countPlaysByFormation(catalog, 'formation-phins-base'), 2)

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
  plays: [{ ...samplePlay, routes: undefined, footballs: undefined }]
} as unknown as typeof initialAppState)
assert.deepEqual(predrawing.plays[0].routes, [])
assert.deepEqual(predrawing.plays[0].footballs, [])
assert.equal(predrawing.plays[0].name, 'Sweep Right')

// Already-migrated playbooks are left alone.
const stablePlaybook = migrateAppState({ ...initialAppState, plays: [samplePlay] })
assert.deepEqual(stablePlaybook.plays.map((play) => play.id), ['play-sample'])
assert.deepEqual(stablePlaybook.formations.map((f) => f.id), initialAppState.formations.map((f) => f.id))

// ---- The seeded Phins playbook ----
const seeded = phinsPlaybook('team-dolphins')
assert.equal(seeded.formations.every((formation) => formation.id.startsWith('formation-phins-')), true)
assert.deepEqual(seeded.formations.map((formation) => formation.name), [
  'Base',
  'Twins',
  'Bunch',
  'Trips Right',
  'Trips Left',
  'Empty Left',
  'Empty Right',
  'Splitback Twins Right',
  'Splitback Twins Left'
])
assert.equal(seeded.formations.every((formation) => formation.teamId === 'team-dolphins'), true)

// Every formation places all seven spots, on the field and clear of each other.
seeded.formations.forEach((formation) => {
  const codes = Object.keys(formation.positions)
  assert.deepEqual(codes.sort(), ['1', '2', '3', '4', 'C', 'QB', 'RB'])
  codes.forEach((code, index) => {
    const spot = formation.positions[code]
    assert.equal(spot.x >= 0 && spot.x <= 100 && spot.y >= 0 && spot.y <= 100, true)
    codes.slice(index + 1).forEach((other) => {
      const against = formation.positions[other]
      // The playbook field is twice as wide as it is tall, so x counts double.
      const gap = Math.hypot((spot.x - against.x) * 2, spot.y - against.y)
      assert.equal(gap >= 16, true, `${formation.name} ${code}/${other} only ${gap.toFixed(1)} apart`)
    })
  })
})

// The seed brings formations only; the plays get written in the builder.
assert.deepEqual(Object.keys(seeded), ['formations'])

const demoPlay = (id: string, name: string, formationId: string) => ({
  id,
  teamId: 'team-wildcats',
  name,
  formationId,
  type: 'run',
  area: 'sidelines',
  notes: '',
  routes: [],
  footballs: []
})
const demoFormation = (id: string, name: string) => ({
  id,
  teamId: 'team-wildcats',
  name,
  positions: defaultFormationPositions()
})
const seedInto = (plays: unknown[], formations: unknown[]) =>
  migrateAppState({
    ...initialAppState,
    playbookSeed: undefined,
    plays,
    formations
  } as unknown as typeof initialAppState)

// A saved state carrying the old playbook keeps the formations and loses the plays.
const demoPlaybook = seedInto(
  [demoPlay('play-1', 'Sweep Right', 'formation-balanced')],
  [demoFormation('formation-balanced', 'Balanced')]
)
assert.equal(demoPlaybook.formations.length, 9)
assert.deepEqual(demoPlaybook.plays, [])
assert.equal(demoPlaybook.formations.every((formation) => formation.id.startsWith('formation-phins-')), true)

// Formations the coach drew themselves survive; the demo ones do not.
const coachPlaybook = seedInto(
  [demoPlay('play-mine', 'Wildcat Left', 'formation-mine')],
  [demoFormation('formation-balanced', 'Balanced'), demoFormation('formation-mine', 'My Set')]
)
assert.deepEqual(coachPlaybook.plays, [])
assert.equal(coachPlaybook.formations.length, 10)
assert.deepEqual(
  coachPlaybook.formations.filter((formation) => !formation.id.startsWith('formation-phins-')).map((f) => f.id),
  ['formation-mine']
)

// The clear-out happens once: plays written afterwards stay put.
const afterWriting = migrateAppState({
  ...demoPlaybook,
  plays: [{ ...samplePlay, formationId: demoPlaybook.formations[0].id }]
})
assert.deepEqual(afterWriting.plays.map((play) => play.id), ['play-sample'])
assert.equal(afterWriting.playbookSeed, demoPlaybook.playbookSeed)
// And it does not run again on the next load either.
assert.deepEqual(migrateAppState(afterWriting).plays.map((play) => play.id), ['play-sample'])

// ---- Play builder ----
// Component ids and phrases are what saved plays point at, so they must be unique.
assert.equal(new Set(PLAY_COMPONENTS.map((component) => component.id)).size, PLAY_COMPONENTS.length)
assert.equal(
  PLAY_COMPONENTS.every((component) => Boolean(findComponent(component.id))),
  true
)

// The call reads back in the order the coach says it.
const keeperSteps = [
  { id: 's1', componentId: 'hb-stretch', direction: 'right' as const, fake: true },
  { id: 's2', componentId: 'sweep', receivers: ['4'], fake: true },
  { id: 's3', componentId: 'qb-keeper' }
]
assert.equal(stepLabel(keeperSteps[0]), 'Fake HB Stretch Right')
assert.equal(playCallFromSteps(keeperSteps), 'Fake HB Stretch Right Fake 4 Sweep QB Keeper')
// The formation opens the call, the way it gets said.
assert.equal(playCallFromSteps(keeperSteps, 'Twins'), 'Twins Fake HB Stretch Right Fake 4 Sweep QB Keeper')
assert.equal(playCallFromSteps([], 'Twins'), 'Twins')
// Fakes and motion do not decide what the play is; the last real component does.
assert.deepEqual(classifySteps(keeperSteps), { type: 'run', area: 'middle' })
assert.deepEqual(
  classifySteps([
    { id: 's1', componentId: 'motion', receivers: ['2'] },
    { id: 's2', componentId: 'hb-dive', fake: true },
    { id: 's3', componentId: 'explosion' }
  ]),
  { type: 'pass', area: 'deep' }
)
// With nothing but fakes there is no real component to classify by.
assert.deepEqual(classifySteps([{ id: 's1', componentId: 'hb-dive', fake: true }]), { type: 'run', area: 'middle' })

// A carry is not finished until someone is named.
assert.equal(stepIsComplete({ id: 's', componentId: 'sweep' }), false)
assert.equal(stepIsComplete({ id: 's', componentId: 'sweep', receivers: ['3'] }), true)
assert.equal(stepIsComplete({ id: 's', componentId: 'qb-keeper' }), true)

// Written calls read back into steps.
assert.equal(playCallFromSteps(parsePlayCall('Fake HB Stretch Right Fake 4 Sweep QB Keeper')!), 'Fake HB Stretch Right Fake 4 Sweep QB Keeper')
// Either receiver can take it, and both are kept.
assert.deepEqual(parsePlayCall('2 / 3 Sweep')![0].receivers, ['2', '3'])
assert.equal(playCallFromSteps(parsePlayCall('2 / 3 Sweep')!), '2 / 3 Sweep')
// Filler between components is dropped.
assert.equal(playCallFromSteps(parsePlayCall('3 Sweep to 1 Reverse')!), '3 Sweep 1 Reverse')
// The back is named in the phrase, not as a receiver.
assert.deepEqual(parsePlayCall('RB Dive')!.map((step) => [step.componentId, step.receivers]), [['hb-dive', undefined]])
assert.deepEqual(parsePlayCall('3 Dive')!.map((step) => [step.componentId, step.receivers]), [['carry-dive', ['3']]])
// A carry written without anyone named still opens, waiting for a pick.
assert.equal(stepIsComplete(parsePlayCall('3 Sweep Fake Reverse')![1]), false)
// Nonsense does not parse.
assert.equal(parsePlayCall('Statue Of Liberty'), null)
assert.equal(parsePlayCall('   '), null)

// Calls the team writes by hand still open in the builder.
const writtenCalls = [
  'HB Dive',
  'Fake HB Dive QB Sneak',
  '2 / 3 Sweep',
  '4 / 1 Reverse',
  'Fake Dive 3 Sweep to 1 Reverse',
  'Fake Stretch Fake 1 / 4 Sweep Pass',
  'Fake Dive WR Slants Wings Flat Center Go',
  'Fake Dive Fake 3 Sweep QB Boot Right',
  '2 / 3 Motion Sweep Fake Dive',
  'RB Dive Fake 3 Dive',
  'Fake HB Dive 3 Toss Right Flood Right',
  'Slant Go Slow Wheel',
  'Jail Break',
  'Quick Sneak',
  'RB Flat Throwback'
]
assert.deepEqual(writtenCalls.filter((name) => !parsePlayCall(name)), [])

// Reading a play back drops the formation name it opens with.
const twins = seeded.formations.find((formation) => formation.name === 'Twins')!
const builtPlay = {
  id: 'play-built',
  teamId: 'team-dolphins',
  playbookId: 'playbook-main',
  formationId: twins.id,
  name: 'Twins Fake HB Stretch Right QB Keeper',
  type: 'run' as const,
  area: 'middle' as const,
  notes: '',
  routes: [],
  footballs: [],
  steps: undefined,
  createdAt: '',
  updatedAt: ''
}
assert.deepEqual(
  stepsFromPlay(builtPlay, seeded.formations)!.map((step) => step.componentId),
  ['hb-stretch', 'qb-keeper']
)
// Saved steps are used as they are, whatever the play ended up being called.
assert.deepEqual(stepsFromPlay({ ...builtPlay, name: 'QB Keeper', steps: keeperSteps }, seeded.formations), keeperSteps)
// A play whose name carries no formation still reads back.
assert.equal(Boolean(stepsFromPlay({ ...builtPlay, name: 'HB Dive' }, seeded.formations)), true)
// A name the builder cannot say has no components behind it.
assert.equal(stepsFromPlay({ ...builtPlay, name: 'Twins Statue Of Liberty' }, seeded.formations), null)

// The picker offers exactly the playbook's vocabulary; retired components stay
// readable so older plays still open, but are never offered again.
assert.deepEqual(
  COMPONENT_GROUPS.map((group) => [group.label, componentsInGroup(group.id).map((component) => component.label)]),
  [
    ['Backfield', ['HB Dive', 'HB Stretch', 'RB Swing', 'RB Screen']],
    ['Quarterback', ['QB Keeper', 'QB Sneak', 'QB Draw', 'QB Bootleg']],
    ['Receiver runs', ['Sweep', 'Reverse']],
    ['Motion', ['Motion']],
    ['Pass concepts', ['High Low', 'Explosion', 'Slant Wheel', 'All Go', 'Flood', 'Hitches']],
    ['Single routes', ['Go', 'Slant', 'Corner', 'Wheel', 'Flat', 'Out', 'In', 'Hitch', 'Screen']]
  ]
)
// A screen belongs to a receiver, like the other single routes.
assert.equal(findComponent('screen')!.group, 'routes')
assert.equal(findComponent('screen')!.needsReceiver, true)
// Hook was renamed, and old calls that say it still read back.
assert.equal(findComponent('route-hitch')!.phrase, 'Hitch')
assert.deepEqual(parsePlayCall('3 Hook')!.map((step) => step.componentId), ['route-hitch'])
assert.equal(playCallFromSteps(parsePlayCall('3 Hook')!), '3 Hitch')
// The two new concepts.
assert.equal(playCallFromSteps(parsePlayCall('All Go')!), 'All Go')
assert.equal(playCallFromSteps(parsePlayCall('Hitches')!), 'Hitches')
// "All Go" is a concept, not somebody's go route.
assert.deepEqual(parsePlayCall('All Go')!.map((step) => [step.componentId, step.receivers]), [['all-go', undefined]])
assert.deepEqual(parsePlayCall('2 Go')!.map((step) => [step.componentId, step.receivers]), [['route-go', ['2']]])
// Everything dropped from the picker is still understood.
assert.equal(
  PLAY_COMPONENTS.filter((component) => component.retired).every((component) => Boolean(parsePlayCall(
    component.needsReceiver ? `3 ${component.phrase}` : component.phrase
  ))),
  true
)

// ---- Substitutions ----
const subDrive = (id: string, unit: 'offense' | 'defense', n: number, assignments: Record<string, string | null>) =>
  resolved(createDrive(id, unit, n, 'g'), assignments)

const offOne = subDrive('s-off-1', 'offense', 1, {
  QB: 'p-rhett', C: 'p-teddy', RB: 'p-mikey', '1': 'p-dodger', '2': 'p-maddox', '3': 'p-william', '4': 'p-grady'
})

// Nothing moved.
assert.equal(compareLineups(offOne, { ...offOne, id: 's-off-2' }).unchanged, true)

// Two straight swaps: someone off the field comes on for whoever held the spot.
const twoSwaps = compareLineups(
  offOne,
  subDrive('s-off-2', 'offense', 2, {
    QB: 'p-rhett', C: 'p-teddy', RB: 'p-mikey', '1': 'p-dodger', '2': 'p-locklan', '3': 'p-william', '4': 'p-luther'
  })
)
assert.equal(twoSwaps.unchanged, false)
assert.deepEqual(twoSwaps.subs, [
  { slotCode: '2', playerIn: 'p-locklan', playerOut: 'p-maddox' },
  { slotCode: '4', playerIn: 'p-luther', playerOut: 'p-grady' }
])
assert.deepEqual(twoSwaps.moves, [])
assert.deepEqual(twoSwaps.outs, [])

// Someone already on the field changing spots is a move, not a substitution.
const moved = compareLineups(
  offOne,
  subDrive('s-off-2', 'offense', 2, {
    QB: 'p-rhett', C: 'p-teddy', RB: 'p-mikey', '1': 'p-dodger', '2': 'p-william', '3': 'p-maddox', '4': 'p-grady'
  })
)
assert.deepEqual(moved.subs, [])
assert.deepEqual(moved.moves, [
  { playerId: 'p-william', from: '3', to: '2' },
  { playerId: 'p-maddox', from: '2', to: '3' }
])
assert.deepEqual(moved.outs, [])

// A player moving into someone else's spot leaves that someone unaccounted for,
// so they get called off on their own line.
const shuffled = compareLineups(
  offOne,
  subDrive('s-off-2', 'offense', 2, {
    QB: 'p-rhett', C: 'p-teddy', RB: 'p-mikey', '1': 'p-dodger', '2': 'p-grady', '3': 'p-william', '4': 'p-henry'
  })
)
// Grady held the 4 spot but is still on the field, so Henry is not "in for" him.
assert.deepEqual(shuffled.subs, [{ slotCode: '4', playerIn: 'p-henry', playerOut: null }])
assert.deepEqual(shuffled.moves, [{ playerId: 'p-grady', from: '4', to: '2' }])
assert.deepEqual(shuffled.outs, ['p-maddox'])

// An open spot being filled names nobody on the way out.
const filledOpen = compareLineups(
  subDrive('s-off-1', 'offense', 1, { QB: 'p-rhett', C: null }),
  subDrive('s-off-2', 'offense', 2, { QB: 'p-rhett', C: 'p-teddy' })
)
assert.deepEqual(filledOpen.subs, [{ slotCode: 'C', playerIn: 'p-teddy', playerOut: null }])

// The comparison is against whatever ran last, whichever unit that was.
const order = [
  subDrive('d1', 'offense', 1, { QB: 'p-rhett' }),
  subDrive('d2', 'defense', 1, { R: 'p-teddy' }),
  subDrive('d3', 'offense', 2, { QB: 'p-mikey' }),
  subDrive('d4', 'defense', 2, { R: 'p-grady' })
]
assert.equal(previousDrive(order, order[1])?.id, 'd1')
assert.equal(previousDrive(order, order[2])?.id, 'd2')
assert.equal(previousDrive(order, order[3])?.id, 'd3')
// The first drive of the game has nothing behind it.
assert.equal(previousDrive(order, order[0]), undefined)
// A drive that is not in the list has nothing behind it either.
assert.equal(previousDrive(order, subDrive('stray', 'offense', 9, {})), undefined)

// Across a change of unit, only who enters and who leaves is called: everyone
// staying on the field has a new position by definition.
const offField = subDrive('x-off', 'offense', 1, {
  QB: 'p-rhett', C: 'p-teddy', RB: 'p-mikey', '1': 'p-dodger', '2': 'p-maddox', '3': 'p-william', '4': 'p-grady'
})
const defField = subDrive('x-def', 'defense', 1, {
  LE: 'p-teddy', R: 'p-rhett', RE: 'p-mikey', LCB: 'p-dodger', MLB: 'p-locklan', RCB: 'p-luther', S: 'p-grady'
})
const unitSwitch = compareLineups(offField, defField)
assert.deepEqual(unitSwitch.subs, [
  { slotCode: 'MLB', playerIn: 'p-locklan', playerOut: null },
  { slotCode: 'RCB', playerIn: 'p-luther', playerOut: null }
])
assert.deepEqual(unitSwitch.moves, [])
assert.deepEqual(unitSwitch.outs, ['p-maddox', 'p-william'])

// The same seven staying out for the other unit is a quiet change.
const sameSeven = compareLineups(
  offField,
  subDrive('x-def-2', 'defense', 1, {
    LE: 'p-teddy', R: 'p-rhett', RE: 'p-mikey', LCB: 'p-dodger', MLB: 'p-maddox', RCB: 'p-william', S: 'p-grady'
  })
)
assert.equal(sameSeven.unchanged, true)

// Each drive counts only what changed since that unit was last out, so applying
// the bullets to the previous lineup has to land exactly on the current one.
const roundTripCodes = OFFENSE_SLOTS.map((slot) => slot.code)
const roundTripRoster = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k']
let seedState = 12345
const nextRandom = () => {
  seedState = (seedState * 1103515245 + 12345) % 2147483648
  return seedState / 2147483648
}
const randomLineup = (id: string): ResolvedDrive => {
  const pool = [...roundTripRoster].sort(() => nextRandom() - 0.5)
  const assignments = { ...createEmptyAssignments('offense') }
  roundTripCodes.forEach((code, index) => {
    assignments[code] = nextRandom() < 0.08 ? null : pool[index]
  })
  return resolved(createDrive(id, 'offense', 1, 'g'), assignments)
}

let roundTripFailures = 0
for (let attempt = 0; attempt < 2000; attempt += 1) {
  const before = randomLineup('rt-before')
  const after = randomLineup('rt-after')
  const changes = compareLineups(before, after)
  const board: Record<string, string | null> = { ...before.assignments }

  // Clear everyone the bullets take off the field or out of a spot.
  changes.outs.forEach((playerId) => {
    const slot = roundTripCodes.find((code) => board[code] === playerId)
    if (slot) board[slot] = null
  })
  changes.moves.forEach((move) => {
    board[move.from] = null
  })
  changes.subs.forEach((sub) => {
    const slot = sub.playerOut ? roundTripCodes.find((code) => board[code] === sub.playerOut) : undefined
    if (slot) board[slot] = null
  })
  // Then put everyone where the bullets say they end up.
  changes.moves.forEach((move) => {
    board[move.to] = move.playerId
  })
  changes.subs.forEach((sub) => {
    board[sub.slotCode] = sub.playerIn
  })

  if (!roundTripCodes.every((code) => (board[code] || null) === (after.assignments[code] || null))) {
    roundTripFailures += 1
  }
}
assert.equal(roundTripFailures, 0)

// Exported diagrams draw every position, each route with an arrow, and each football.
{
  const exportFormation = {
    id: 'f-export',
    teamId: 't',
    playbookId: 'playbook-main',
    packageId: 'package-base',
    name: 'Trips',
    positions: { QB: { x: 50, y: 70 } },
    createdAt: '',
    updatedAt: ''
  }
  const svg = playDiagramSvg(
    {
      routes: [
        { id: 'r1', style: 'solid', points: [{ x: 10, y: 52 }, { x: 10, y: 20 }] },
        { id: 'r2', style: 'dashed', points: [{ x: 50, y: 70 }, { x: 60, y: 30 }] },
        { id: 'r3', style: 'solid', points: [{ x: 40, y: 40 }] }
      ],
      footballs: [{ id: 'b1', x: 30, y: 84 }]
    },
    exportFormation
  )
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'))
  assert.equal((svg.match(/<circle /g) || []).length, 7)
  // A single point is not a route, so only two lines and two arrows.
  assert.equal((svg.match(/<polyline /g) || []).length, 2)
  assert.equal((svg.match(/<polygon /g) || []).length, 2)
  assert.equal((svg.match(/stroke-dasharray/g) || []).length, 1)
  assert.equal((svg.match(/<ellipse /g) || []).length, 1)
  // The formation's QB spot is used; positions it leaves out fall back to defaults.
  assert.ok(svg.includes('cx="100" cy="70"'))
  assert.ok(svg.includes('cx="16" cy="52"'))
  // Missing formations still draw a play from the default spots.
  assert.equal((playDiagramSvg({ routes: [], footballs: [] }, undefined).match(/<circle /g) || []).length, 7)

  assert.equal(playFileName('Trips Right — Go!', 'png'), 'trips-right-go.png')
  assert.equal(playFileName('  ', 'png'), 'play.png')
}

// ---- Playbooks and call sheets ----
{
  const bookPlay = (id: string, playbookId: string, type: 'run' | 'pass') => ({
    ...samplePlay,
    id,
    playbookId,
    name: id,
    type
  })

  // Every state starts with a main playbook, and plays from before playbooks land in it.
  assert.equal(initialAppState.playbooks.length, 1)
  assert.equal(initialAppState.playbooks[0].id, MAIN_PLAYBOOK_ID)
  const legacyPlay = { ...samplePlay, playbookId: undefined } as unknown as PlaybookPlay
  const upgraded = migrateAppState({
    ...initialAppState,
    playbookSeed: initialAppState.playbookSeed,
    plays: [legacyPlay],
    playbooks: undefined,
    callSheets: undefined
  } as unknown as AppState)
  assert.equal(upgraded.playbooks.length, 1)
  assert.equal(upgraded.plays[0].playbookId, MAIN_PLAYBOOK_ID)
  assert.deepEqual(upgraded.callSheets, [])

  // A play whose playbook is gone moves to the first one left; playbooks the coach made stay.
  const fall = createPlaybook('t', 'Fall Offense', DEFAULT_POSITIONS, 'playbook-fall')
  const kept = ensurePlaybooks('t', [fall], [bookPlay('a', 'playbook-gone', 'run'), bookPlay('b', 'playbook-fall', 'pass')], [], '')
  assert.deepEqual(kept.playbooks.map((item) => item.id), ['playbook-fall'])
  assert.deepEqual(kept.plays.map((play) => play.playbookId), ['playbook-fall', 'playbook-fall'])

  // A new call sheet sorts its own playbook's runs and passes into their boxes.
  const bookPlays = [
    bookPlay('run-1', 'playbook-fall', 'run'),
    bookPlay('pass-1', 'playbook-fall', 'pass'),
    bookPlay('pass-2', 'playbook-fall', 'pass'),
    bookPlay('other', 'playbook-main', 'run')
  ]
  const sheet = createCallSheet('t', 'playbook-fall', 'Week 3', bookPlays)
  const box = (title: string) => sheet.sections.find((section) => section.title === title)!
  assert.deepEqual(sheet.sections.map((section) => section.title), ['Openers', 'Runs', 'Passes', 'Red Zone', 'Extra Point'])
  assert.deepEqual(box('Runs').playIds, ['run-1'])
  assert.deepEqual(box('Passes').playIds, ['pass-1', 'pass-2'])
  assert.deepEqual(box('Openers').playIds, [])

  // Numbers run straight through the sheet, box after box.
  const withOpener = { ...sheet, sections: sheet.sections.map((section) => (section.title === 'Openers' ? { ...section, playIds: ['pass-2'] } : section)) }
  const numbered = numberCallSheet(withOpener, bookPlays)
  assert.deepEqual(
    numbered.flatMap((section) => section.plays.map((entry) => `${entry.number}:${entry.play.id}`)),
    ['1:pass-2', '2:run-1', '3:pass-1', '4:pass-2']
  )

  // Deleting a play takes it off every sheet; sheets it was never on are untouched.
  const cleaned = removePlaysFromCallSheets([withOpener], ['pass-2'])
  assert.deepEqual(cleaned[0].sections.flatMap((section) => section.playIds), ['run-1', 'pass-1'])
  assert.equal(removePlaysFromCallSheets([sheet], ['missing'])[0], sheet)

  // Migration drops sheets whose playbook is gone and plays that no longer exist.
  const tidied = migrateAppState({
    ...initialAppState,
    playbooks: [fall],
    plays: [bookPlay('run-1', 'playbook-fall', 'run')],
    callSheets: [sheet, { ...sheet, id: 'orphan', playbookId: 'playbook-gone' }]
  })
  assert.deepEqual(tidied.callSheets.map((item) => item.id), [sheet.id])
  assert.deepEqual(tidied.callSheets[0].sections.flatMap((section) => section.playIds), ['run-1'])

  assert.deepEqual(moveItem(['a', 'b', 'c'], 0, 1), ['b', 'a', 'c'])
  assert.deepEqual(moveItem(['a', 'b', 'c'], 0, -1), ['a', 'b', 'c'])
  assert.deepEqual(moveItem(['a', 'b', 'c'], 2, 1), ['a', 'b', 'c'])
}

// ---- Players and formations belong to each playbook ----
{
  // Seven players gives the original lineup; other counts get a sensible one.
  assert.deepEqual(suggestedPositions(7).map((item) => item.label), ['1', '2', 'C', '3', '4', 'QB', 'RB'])
  assert.deepEqual(suggestedPositions(5).map((item) => item.label), ['1', '2', 'C', '3', 'QB'])
  assert.deepEqual(suggestedPositions(3).map((item) => item.label), ['1', '2', 'QB'])
  assert.equal(suggestedPositions(40).length, 11)
  assert.equal(suggestedPositions(1).length, 3)

  // The original seven keep their exact spots; anything else spreads along the line.
  assert.deepEqual(layoutPositions(DEFAULT_POSITIONS), defaultFormationPositions())
  const five = [
    { code: 'x', label: 'X' },
    { code: 'c', label: 'C' },
    { code: 'z', label: 'Z' },
    { code: 'q', label: 'QB' },
    { code: 'h', label: 'HB' }
  ]
  const spots = layoutPositions(five)
  assert.deepEqual(spots.x, { x: 8, y: LINE_OF_SCRIMMAGE })
  assert.deepEqual(spots.c, { x: 50, y: LINE_OF_SCRIMMAGE })
  assert.deepEqual(spots.z, { x: 92, y: LINE_OF_SCRIMMAGE })
  assert.deepEqual(spots.q, { x: 50, y: 72 })
  assert.equal(spots.h.y, 84)
  assert.deepEqual(getFormationPosition('z', undefined, five), { x: 92, y: LINE_OF_SCRIMMAGE })

  assert.equal(positionLabelsValid(five), true)
  assert.equal(positionLabelsValid([...five, { code: 'dup', label: 'x ' }]), false)
  assert.equal(positionLabelsValid([...five, { code: 'blank', label: '  ' }]), false)

  // A new playbook keeps its players and gets one formation laid out for them.
  const flag5 = createPlaybook('t', 'Five on Five', five, 'playbook-five')
  assert.deepEqual(flag5.packages.map((item) => item.name), ['Base'])
  assert.deepEqual(flag5.packages[0].positions.map((item) => item.label), ['X', 'C', 'Z', 'QB', 'HB'])
  const base = starterFormation(flag5)
  assert.equal(base.playbookId, 'playbook-five')
  assert.equal(base.packageId, BASE_PACKAGE_ID)
  assert.deepEqual(Object.keys(base.positions).sort(), ['c', 'h', 'q', 'x', 'z'])

  // Diagrams draw the playbook's own players, with labels made safe for markup.
  const fiveSvg = playDiagramSvg({ routes: [], footballs: [] }, base, [...five.slice(0, 4), { code: 'h', label: '<b>' }])
  assert.equal((fiveSvg.match(/<circle /g) || []).length, 5)
  assert.ok(fiveSvg.includes('&lt;b&gt;'))
  assert.ok(!fiveSvg.includes('<b>'))

  // Shared formations split up: unowned ones go to the first playbook, and any
  // other playbook drawing on one gets its own copy.
  const shared = { ...base, id: 'f-shared', playbookId: '' }
  const split = ensurePlaybooks(
    't',
    [createPlaybook('t', 'Main', DEFAULT_POSITIONS, 'pb-a'), createPlaybook('t', 'Other', DEFAULT_POSITIONS, 'pb-b')],
    [
      { ...samplePlay, id: 'pa', playbookId: 'pb-a', formationId: 'f-shared' },
      { ...samplePlay, id: 'pb1', playbookId: 'pb-b', formationId: 'f-shared' },
      { ...samplePlay, id: 'pb2', playbookId: 'pb-b', formationId: 'f-shared' }
    ],
    [shared],
    ''
  )
  assert.deepEqual(split.formations.map((item) => `${item.id}@${item.playbookId}`), ['f-shared@pb-a', 'f-shared--pb-b@pb-b'])
  assert.deepEqual(split.plays.map((play) => play.formationId), ['f-shared', 'f-shared--pb-b', 'f-shared--pb-b'])

  // Playbooks saved before players existed get the original seven.
  const noPlayers = { ...flag5, packages: undefined } as unknown as Playbook
  assert.deepEqual(ensurePlaybooks('t', [noPlayers], [], [], '').playbooks[0].packages[0].positions, DEFAULT_POSITIONS)

  // A playbook from before packages turns its one set of players into a Base package.
  const { packages: _dropped, ...withoutPackages } = flag5
  const beforePackages = { ...withoutPackages, positions: five } as unknown as Playbook
  const upgradedBook = ensurePlaybooks('t', [beforePackages], [], [], '').playbooks[0]
  assert.deepEqual(upgradedBook.packages, [{ id: BASE_PACKAGE_ID, name: 'Base', positions: five }])
  assert.equal('positions' in upgradedBook, false)

  // A new package copies the base package's codes, so formations keep their spots.
  const heavy = createPackage(flag5, ' Heavy ')
  assert.equal(heavy.name, 'Heavy')
  assert.notEqual(heavy.id, BASE_PACKAGE_ID)
  assert.deepEqual(heavy.positions.map((item) => item.code), flag5.packages[0].positions.map((item) => item.code))
  const withHeavy = { ...flag5, packages: [...flag5.packages, { ...heavy, positions: heavy.positions.map((item) => (item.code === 'h' ? { ...item, label: 'TE' } : item)) }] }
  assert.equal(packageFor(withHeavy, heavy.id).positions.find((item) => item.code === 'h')!.label, 'TE')
  assert.equal(packageFor(withHeavy, 'missing').id, BASE_PACKAGE_ID)

  // A formation naming a package its playbook does not have falls back to the first.
  const strayed = ensurePlaybooks('t', [withHeavy], [], [{ ...base, packageId: 'package-gone' }, { ...base, id: 'f-heavy', packageId: heavy.id }], '')
  assert.deepEqual(strayed.formations.map((item) => item.packageId), [BASE_PACKAGE_ID, heavy.id])

  // A fresh app's seeded formations belong to the main playbook.
  assert.ok(migrateAppState(initialAppState).formations.every((item) => item.playbookId === MAIN_PLAYBOOK_ID))
  assert.ok(migrateAppState(initialAppState).formations.every((item) => item.packageId === BASE_PACKAGE_ID))
}

console.log('logic tests passed')
