import type { AppState, Drive, DriveNote, Lineup, Player, Unit } from './types'
import { createLineups, defaultLineupSlot, lineupId } from './lineups'
import { PHINS_PLAYBOOK_SEED, phinsPlaybook } from './phins-playbook'

const teamId = 'team-wildcats'
const gameId = 'game-1'
const seedPlaybook = phinsPlaybook(teamId)

const emptyNote = (): DriveNote => ({
  whatWorked: '',
  whatFailed: '',
  playerNotes: '',
  playCalls: '',
  result: '',
  freeform: ''
})

export function createDrive(id: string, unit: Unit, driveNumber: number, game = gameId): Drive {
  return {
    id,
    gameId: game,
    unit,
    driveNumber,
    lineupId: lineupId(unit, defaultLineupSlot(driveNumber)),
    result: '',
    conversion: '',
    notes: emptyNote(),
    status: 'planned',
    locked: false
  }
}

function withAssignments(lineups: Lineup[], unit: Unit, slot: number, assignments: Record<string, string>): Lineup[] {
  return lineups.map((lineup) =>
    lineup.unit === unit && lineup.slot === slot
      ? { ...lineup, assignments: { ...lineup.assignments, ...assignments } }
      : lineup
  )
}

/** The starters go in the first lineup of each unit; the rest are left to fill in. */
const sampleLineups: Lineup[] = withAssignments(
  withAssignments(createLineups(teamId), 'offense', 1, {
    QB: 'p-rhett',
    RB: 'p-mikey',
    C: 'p-teddy',
    '1': 'p-dodger',
    '2': 'p-maddox',
    '3': 'p-william',
    '4': 'p-grady'
  }),
  'defense',
  1,
  {
    R: 'p-locklan',
    MLB: 'p-luther',
    S: 'p-rhodes',
    LE: 'p-henry',
    RE: 'p-dodger',
    LCB: 'p-maddox',
    RCB: 'p-william'
  }
)

const rosterNames = [
  'Rhett',
  'Mikey',
  'Teddy',
  'Dodger',
  'Maddox',
  'William',
  'Grady',
  'Locklan',
  'Luther',
  'Rhodes',
  'Henry'
]

export function createPlayer(id: string, firstName: string, team = teamId): Player {
  return {
    id,
    teamId: team,
    firstName,
    active: true,
    offenseRatings: { QB: 3, C: 3, WR: 3, RB: 3 },
    defenseRatings: { R: 3, S: 3, MLB: 3, CB: 3, E: 3 },
    notes: ''
  }
}

export const samplePlayers: Player[] = rosterNames.map((firstName) =>
  createPlayer(`p-${firstName.toLowerCase()}`, firstName)
)

export const initialAppState: AppState = {
  team: {
    id: teamId,
    name: 'Franklin Dolphins',
    season: 'Fall 2026',
    ageGroup: '3rd Grade'
  },
  players: samplePlayers,
  games: [
    {
      id: gameId,
      teamId,
      name: 'Game 1',
      date: '',
      location: '',
      status: 'scheduled',
      patternLength: 3
    }
  ],
  selectedGameId: gameId,
  drives: [
    createDrive('drive-off-1', 'offense', 1),
    createDrive('drive-def-1', 'defense', 1),
    createDrive('drive-off-2', 'offense', 2),
    createDrive('drive-def-2', 'defense', 2),
    createDrive('drive-off-3', 'offense', 3),
    createDrive('drive-def-3', 'defense', 3)
  ],
  selectedDriveId: 'drive-off-1',
  availabilityByGame: {
    [gameId]: {}
  },
  practices: [
    {
      id: 'practice-1',
      teamId,
      title: 'Week 1 Prep',
      date: '2026-09-09',
      warmup: 'Dynamic warmup, flag pulls',
      skills: 'Center-QB exchange, pursuit angles',
      offense: 'Trips right, sweep timing',
      defense: 'Rusher lane and safety depth',
      scrimmage: 'Three short drives',
      notes: ''
    }
  ],
  practiceTemplates: [
    {
      id: 'practice-template-1',
      teamId,
      name: 'Game Week Practice',
      warmup: 'Dynamic warmup, flag pulls',
      skills: 'Center-QB exchange, pursuit angles',
      offense: 'Base formation timing',
      defense: 'Rusher lane and safety depth',
      scrimmage: 'Three short drives',
      notes: 'Use as a starting point each week.',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z'
    }
  ],
  plays: seedPlaybook.plays,
  formations: seedPlaybook.formations,
  playbookSeed: PHINS_PLAYBOOK_SEED,
  lineups: sampleLineups,
  slotPositions: {},
  appSettings: {
    role: 'head',
    assistantCanAddNotes: true,
    assistantCanAdvanceDrive: false
  }
}
