import assert from 'node:assert/strict'
import { applySourceAssignmentsToRepeats, getLinkedRepeatCount, resetRepeatedDriveFromSource } from '../lib/drive-patterns'
import { mergeDriveNotes } from '../lib/drive-notes'
import { autoFillDrive, computeUsage, getDriveWarnings } from '../lib/fair-play'
import { getGameSummary, getResultCount } from '../lib/game-summary'
import { applyLineupTemplateToDrive } from '../lib/lineup-templates'
import { OFFENSE_SLOTS, DEFENSE_SLOTS } from '../lib/positions'
import { createDrive, initialAppState, samplePlayers } from '../lib/sample-data'
import { computeSeasonUsage, getAttendanceSummary } from '../lib/season-analytics'
import { normalizeAppStateForSupabase } from '../lib/supabase/app-state'
import type { LineupTemplate } from '../lib/types'

function assignedIds(assignments: Record<string, string | null>) {
  return Object.values(assignments).filter(Boolean)
}

const unavailable = { 'p-liam': false }

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
    C: 'p-jack',
    QB: 'p-jack'
  }
}
const duplicateWarnings = getDriveWarnings(duplicateDrive, samplePlayers, unavailable)
assert.equal(duplicateWarnings.some((warning) => warning.message === 'Duplicate player assignment'), true)

const filledDrive = autoFillDrive(emptyOffense, samplePlayers, unavailable, [emptyOffense])
assert.equal(assignedIds(filledDrive.assignments).length, 7)
assert.equal(assignedIds(filledDrive.assignments).includes('p-liam'), false)

const usage = computeUsage(samplePlayers, initialAppState.drives, initialAppState.availabilityByGame[initialAppState.selectedGameId])
const jackUsage = usage.find((playerUsage) => playerUsage.playerId === 'p-jack')
const liamUsage = usage.find((playerUsage) => playerUsage.playerId === 'p-liam')
assert.equal(jackUsage?.totalDrives, 2)
assert.equal(liamUsage?.totalDrives, 0)

const seasonUsage = computeSeasonUsage(samplePlayers, initialAppState.drives, initialAppState.availabilityByGame)
const jackSeasonUsage = seasonUsage.find((playerUsage) => playerUsage.playerId === 'p-jack')
const liamSeasonUsage = seasonUsage.find((playerUsage) => playerUsage.playerId === 'p-liam')
assert.equal(jackSeasonUsage?.totalDrives, 2)
assert.equal(liamSeasonUsage?.totalDrives, 0)

const attendance = getAttendanceSummary(samplePlayers, initialAppState.games, initialAppState.availabilityByGame)
const jackAttendance = attendance.find((playerAttendance) => playerAttendance.playerId === 'p-jack')
const liamAttendance = attendance.find((playerAttendance) => playerAttendance.playerId === 'p-liam')
assert.equal(jackAttendance?.presentGames, 1)
assert.equal(liamAttendance?.presentGames, 0)

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
    QB: 'p-jack',
    C: 'p-eli'
  }
}
const linkedRepeat = {
  ...createDrive('pattern-repeat', 'offense', 4, 'pattern-game'),
  sourceDriveId: sourceDrive.id,
  isRepeated: true,
  assignments: {
    ...sourceDrive.assignments,
    QB: 'p-owen',
    C: 'p-cal'
  }
}
const customRepeat = {
  ...linkedRepeat,
  id: 'pattern-custom',
  isCustomized: true,
  assignments: {
    ...linkedRepeat.assignments,
    QB: 'p-ty'
  }
}
const patternDrives = [sourceDrive, linkedRepeat, customRepeat]
const syncedPatternDrives = applySourceAssignmentsToRepeats(patternDrives, sourceDrive.id)
assert.equal(syncedPatternDrives.find((drive) => drive.id === linkedRepeat.id)?.assignments.QB, 'p-jack')
assert.equal(syncedPatternDrives.find((drive) => drive.id === customRepeat.id)?.assignments.QB, 'p-ty')
assert.equal(getLinkedRepeatCount(patternDrives, sourceDrive.id), 2)

const resetPatternDrives = resetRepeatedDriveFromSource(patternDrives, customRepeat.id)
const resetCustomRepeat = resetPatternDrives.find((drive) => drive.id === customRepeat.id)
assert.equal(resetCustomRepeat?.assignments.QB, 'p-jack')
assert.equal(resetCustomRepeat?.isCustomized, false)

const template: LineupTemplate = {
  id: 'template-1',
  teamId: 'team-wildcats',
  name: 'Base Offense',
  unit: 'offense',
  assignments: {
    QB: 'p-jack',
    C: 'p-liam',
    RB: 'p-sam',
    '1': 'p-noah',
    '2': 'p-ben',
    '3': 'p-luke',
    '4': 'p-mason'
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}
const templatedDrive = applyLineupTemplateToDrive(emptyOffense, template, samplePlayers, unavailable)
assert.equal(templatedDrive.assignments.QB, 'p-jack')
assert.equal(templatedDrive.assignments.C, null)
assert.equal(assignedIds(templatedDrive.assignments).includes('p-liam'), false)

const mismatchedTemplateDrive = applyLineupTemplateToDrive(createDrive('template-defense', 'defense', 1, 'test-game'), template, samplePlayers, unavailable)
assert.equal(assignedIds(mismatchedTemplateDrive.assignments).length, 0)

const mergedNotes = mergeDriveNotes(
  {
    whatWorked: 'Sweep',
    whatFailed: '',
    playerNotes: 'Max disciplined',
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
assert.equal(mergedNotes.playerNotes, 'Max disciplined')
assert.equal(mergedNotes.playCalls, 'Sweep Right')
assert.equal(mergedNotes.freeform, 'Next: short routes')

console.log('logic tests passed')
