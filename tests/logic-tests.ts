import assert from 'node:assert/strict'
import { applySourceAssignmentsToRepeats, getLinkedRepeatCount, resetRepeatedDriveFromSource } from '../lib/drive-patterns'
import { mergeDriveNotes } from '../lib/drive-notes'
import { autoFillDrive, computeUsage, getDriveWarnings, isSlotFillable } from '../lib/fair-play'
import { getGameSummary, getResultCount } from '../lib/game-summary'
import { applyLineupTemplateToDrive } from '../lib/lineup-templates'
import { migrateAppState } from '../lib/migrate-state'
import { OFFENSE_SLOTS, DEFENSE_SLOTS, getSlotPosition, slotPositionKey } from '../lib/positions'
import { createDrive, initialAppState, samplePlayers } from '../lib/sample-data'
import { computeSeasonUsage, getAttendanceSummary } from '../lib/season-analytics'
import { normalizeAppStateForSupabase } from '../lib/supabase/app-state'
import type { LineupTemplate } from '../lib/types'

function assignedIds(assignments: Record<string, string | null>) {
  return Object.values(assignments).filter(Boolean)
}

const unavailable = { 'p-luther': false }

assert.equal(OFFENSE_SLOTS.length, 7)
assert.equal(DEFENSE_SLOTS.length, 7)
assert.equal(new Set(OFFENSE_SLOTS.map((slot) => slot.code)).size, 7)
assert.equal(new Set(DEFENSE_SLOTS.map((slot) => slot.code)).size, 7)

const emptyOffense = createDrive('test-offense', 'offense', 1, 'test-game')
const emptyWarnings = getDriveWarnings(emptyOffense, samplePlayers, unavailable)
assert.equal(emptyWarnings.some((warning) => warning.message === '7 open positions'), true)

const duplicateDrive = {
  ...emptyOffense,
  assignments: {
    ...emptyOffense.assignments,
    C: 'p-rhett',
    QB: 'p-rhett'
  }
}
const duplicateWarnings = getDriveWarnings(duplicateDrive, samplePlayers, unavailable)
assert.equal(duplicateWarnings.some((warning) => warning.message === 'Duplicate player assignment'), true)

const filledDrive = autoFillDrive(emptyOffense, samplePlayers, unavailable, [emptyOffense])
assert.equal(assignedIds(filledDrive.assignments).length, 7)
assert.equal(assignedIds(filledDrive.assignments).includes('p-luther'), false)

assert.equal(samplePlayers.length, 11)
assert.equal(samplePlayers.every((player) => player.firstName.trim().length > 0), true)

const gameId = initialAppState.selectedGameId
const usage = computeUsage(samplePlayers, initialAppState.drives, initialAppState.availabilityByGame[gameId])
const dodgerUsage = usage.find((playerUsage) => playerUsage.playerId === 'p-dodger')
const gradyUsage = usage.find((playerUsage) => playerUsage.playerId === 'p-grady')
assert.equal(dodgerUsage?.totalDrives, 2)
assert.equal(gradyUsage?.totalDrives, 1)

const seasonUsage = computeSeasonUsage(samplePlayers, initialAppState.drives, initialAppState.availabilityByGame)
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

const sourceDrive = {
  ...createDrive('pattern-source', 'offense', 1, 'pattern-game'),
  assignments: {
    ...createDrive('pattern-source-empty', 'offense', 1, 'pattern-game').assignments,
    QB: 'p-rhett',
    C: 'p-teddy'
  }
}
const linkedRepeat = {
  ...createDrive('pattern-repeat', 'offense', 4, 'pattern-game'),
  sourceDriveId: sourceDrive.id,
  isRepeated: true,
  assignments: {
    ...sourceDrive.assignments,
    QB: 'p-locklan',
    C: 'p-rhodes'
  }
}
const customRepeat = {
  ...linkedRepeat,
  id: 'pattern-custom',
  isCustomized: true,
  assignments: {
    ...linkedRepeat.assignments,
    QB: 'p-henry'
  }
}
const patternDrives = [sourceDrive, linkedRepeat, customRepeat]
const syncedPatternDrives = applySourceAssignmentsToRepeats(patternDrives, sourceDrive.id)
assert.equal(syncedPatternDrives.find((drive) => drive.id === linkedRepeat.id)?.assignments.QB, 'p-rhett')
assert.equal(syncedPatternDrives.find((drive) => drive.id === customRepeat.id)?.assignments.QB, 'p-henry')
assert.equal(getLinkedRepeatCount(patternDrives, sourceDrive.id), 2)

const resetPatternDrives = resetRepeatedDriveFromSource(patternDrives, customRepeat.id)
const resetCustomRepeat = resetPatternDrives.find((drive) => drive.id === customRepeat.id)
assert.equal(resetCustomRepeat?.assignments.QB, 'p-rhett')
assert.equal(resetCustomRepeat?.isCustomized, false)

const template: LineupTemplate = {
  id: 'template-1',
  teamId: 'team-wildcats',
  name: 'Base Offense',
  unit: 'offense',
  assignments: {
    QB: 'p-rhett',
    C: 'p-luther',
    RB: 'p-mikey',
    '1': 'p-dodger',
    '2': 'p-maddox',
    '3': 'p-william',
    '4': 'p-grady'
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}
const templatedDrive = applyLineupTemplateToDrive(emptyOffense, template, samplePlayers, unavailable)
assert.equal(templatedDrive.assignments.QB, 'p-rhett')
assert.equal(templatedDrive.assignments.C, null)
assert.equal(assignedIds(templatedDrive.assignments).includes('p-luther'), false)

const mismatchedTemplateDrive = applyLineupTemplateToDrive(createDrive('template-defense', 'defense', 1, 'test-game'), template, samplePlayers, unavailable)
assert.equal(assignedIds(mismatchedTemplateDrive.assignments).length, 0)

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
  players: [legacyPlayer],
  games: [{ ...initialAppState.games[0], opponent: 'Eagles' }],
  drives: [
    {
      ...createDrive('legacy-off-1', 'offense', 1),
      assignments: { ...createDrive('legacy-empty', 'offense', 1).assignments, QB: 'p-jack' }
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
assert.equal(migrated.drives[0].assignments.QB, 'p-rhett')
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
  players: [legacyPlayer, customPlayer],
  drives: [
    {
      ...createDrive('mixed-off-1', 'offense', 1),
      assignments: {
        ...createDrive('mixed-empty', 'offense', 1).assignments,
        QB: 'p-jack',
        RB: 'player-custom'
      }
    }
  ],
  availabilityByGame: { [gameId]: { 'p-jack': false, 'player-custom': false } }
} as unknown as typeof initialAppState

const mixed = migrateAppState(mixedState)
assert.equal(mixed.players.some((player) => player.firstName === 'Jack'), false)
assert.equal(mixed.players.some((player) => player.firstName === 'Rhett'), true)
assert.equal(mixed.players.filter((player) => player.id === 'player-custom').length, 1)
assert.equal(mixed.players.length, 12)
assert.equal(mixed.drives[0].assignments.QB, 'p-rhett')
assert.equal(mixed.drives[0].assignments.RB, 'player-custom')
assert.equal(mixed.availabilityByGame[gameId]['player-custom'], false)

// A player who is out keeps their spot (shown red on the field) until auto-fill replaces them.
const driveWithOutPlayer = {
  ...emptyOffense,
  assignments: { ...emptyOffense.assignments, QB: 'p-luther', C: 'p-rhett' }
}
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

console.log('logic tests passed')
