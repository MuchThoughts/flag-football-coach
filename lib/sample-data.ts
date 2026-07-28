import type { AppState, Drive, DriveNote, Player, Unit } from './types'
import { createEmptyAssignments } from './positions'
import { defaultFormationPositions } from './playbook'

const teamId = 'team-wildcats'
const gameId = 'game-1'
const seedTimestamp = '2026-09-01T00:00:00.000Z'

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
    isRepeated: false,
    isCustomized: false,
    assignments: createEmptyAssignments(unit),
    backups: {},
    result: '',
    conversion: '',
    notes: emptyNote(),
    status: 'planned',
    locked: false
  }
}

function withAssignments(drive: Drive, assignments: Record<string, string>): Drive {
  return {
    ...drive,
    assignments: {
      ...drive.assignments,
      ...assignments
    }
  }
}

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
    withAssignments(createDrive('drive-off-1', 'offense', 1), {
      QB: 'p-rhett',
      RB: 'p-mikey',
      C: 'p-teddy',
      '1': 'p-dodger',
      '2': 'p-maddox',
      '3': 'p-william',
      '4': 'p-grady'
    }),
    withAssignments(createDrive('drive-def-1', 'defense', 1), {
      R: 'p-locklan',
      MLB: 'p-luther',
      S: 'p-rhodes',
      LE: 'p-henry',
      RE: 'p-dodger',
      LCB: 'p-maddox',
      RCB: 'p-william'
    }),
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
  plays: [
    {
      id: 'play-1',
      teamId,
      name: 'Sweep Right',
      formationId: 'formation-balanced',
      type: 'run',
      area: 'sidelines',
      notes: 'RB motion right, 3 clears, 4 stalks space. Good early-down call when the edge defender crashes.',
      createdAt: seedTimestamp,
      updatedAt: seedTimestamp
    },
    {
      id: 'play-2',
      teamId,
      name: 'Slot Cross',
      formationId: 'formation-trips-right',
      type: 'pass',
      area: 'middle',
      notes: '2 shallow, 3 dig, 4 clear, RB check release. Use when the QB has time and the middle is open.',
      createdAt: seedTimestamp,
      updatedAt: seedTimestamp
    }
  ],
  formations: [
    {
      id: 'formation-balanced',
      teamId,
      name: 'Balanced',
      positions: defaultFormationPositions(),
      createdAt: seedTimestamp,
      updatedAt: seedTimestamp
    },
    {
      id: 'formation-trips-right',
      teamId,
      name: 'Trips Right',
      positions: {
        ...defaultFormationPositions(),
        '1': { x: 12, y: 66 },
        '2': { x: 62, y: 63 },
        '3': { x: 76, y: 70 },
        '4': { x: 89, y: 78 }
      },
      createdAt: seedTimestamp,
      updatedAt: seedTimestamp
    }
  ],
  lineupTemplates: [],
  slotPositions: {},
  appSettings: {
    role: 'head',
    assistantCanAddNotes: true,
    assistantCanAdvanceDrive: false
  }
}
