import type { AppState, Drive, DriveNote, Player, Unit } from './types'
import { createEmptyAssignments } from './positions'

const teamId = 'team-wildcats'
const gameId = 'game-1'

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
    result: '',
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

export const samplePlayers: Player[] = [
  {
    id: 'p-jack',
    teamId,
    firstName: 'Jack',
    lastName: 'Miller',
    jerseyNumber: '7',
    active: true,
    offenseRatings: { QB: 5, C: 2, WR: 4, RB: 3 },
    defenseRatings: { R: 2, S: 4, MLB: 4, CB: 3, E: 3 },
    notes: 'Calm huddle voice.'
  },
  {
    id: 'p-sam',
    teamId,
    firstName: 'Sam',
    lastName: 'Reed',
    jerseyNumber: '12',
    active: true,
    offenseRatings: { QB: 2, C: 3, WR: 3, RB: 5 },
    defenseRatings: { R: 4, S: 3, MLB: 3, CB: 3, E: 5 },
    notes: 'Good edge discipline.'
  },
  {
    id: 'p-eli',
    teamId,
    firstName: 'Eli',
    lastName: 'Grant',
    jerseyNumber: '4',
    active: true,
    offenseRatings: { QB: 3, C: 5, WR: 3, RB: 2 },
    defenseRatings: { R: 2, S: 4, MLB: 5, CB: 3, E: 3 },
    notes: 'Reliable snapper.'
  },
  {
    id: 'p-noah',
    teamId,
    firstName: 'Noah',
    lastName: 'King',
    jerseyNumber: '18',
    active: true,
    offenseRatings: { QB: 1, C: 2, WR: 5, RB: 3 },
    defenseRatings: { R: 3, S: 3, MLB: 2, CB: 5, E: 3 },
    notes: 'Best deep route runner.'
  },
  {
    id: 'p-ben',
    teamId,
    firstName: 'Ben',
    lastName: 'Parker',
    jerseyNumber: '22',
    active: true,
    offenseRatings: { QB: 2, C: 3, WR: 4, RB: 3 },
    defenseRatings: { R: 3, S: 4, MLB: 3, CB: 4, E: 4 },
    notes: ''
  },
  {
    id: 'p-luke',
    teamId,
    firstName: 'Luke',
    lastName: 'Hayes',
    jerseyNumber: '9',
    active: true,
    offenseRatings: { QB: 3, C: 2, WR: 4, RB: 4 },
    defenseRatings: { R: 5, S: 2, MLB: 3, CB: 3, E: 5 },
    notes: 'Quick first step.'
  },
  {
    id: 'p-mason',
    teamId,
    firstName: 'Mason',
    lastName: 'Diaz',
    jerseyNumber: '3',
    active: true,
    offenseRatings: { QB: 2, C: 2, WR: 5, RB: 3 },
    defenseRatings: { R: 3, S: 5, MLB: 2, CB: 5, E: 2 },
    notes: ''
  },
  {
    id: 'p-max',
    teamId,
    firstName: 'Max',
    lastName: 'Brown',
    jerseyNumber: '11',
    active: true,
    offenseRatings: { QB: 1, C: 4, WR: 3, RB: 3 },
    defenseRatings: { R: 5, S: 3, MLB: 4, CB: 2, E: 5 },
    notes: 'Strong rusher.'
  },
  {
    id: 'p-owen',
    teamId,
    firstName: 'Owen',
    lastName: 'Scott',
    jerseyNumber: '14',
    active: true,
    offenseRatings: { QB: 4, C: 2, WR: 3, RB: 4 },
    defenseRatings: { R: 3, S: 4, MLB: 3, CB: 4, E: 3 },
    notes: ''
  },
  {
    id: 'p-ty',
    teamId,
    firstName: 'Ty',
    lastName: 'Cole',
    jerseyNumber: '5',
    active: true,
    offenseRatings: { QB: 2, C: 3, WR: 3, RB: 4 },
    defenseRatings: { R: 4, S: 3, MLB: 4, CB: 3, E: 4 },
    notes: ''
  },
  {
    id: 'p-liam',
    teamId,
    firstName: 'Liam',
    lastName: 'Young',
    jerseyNumber: '20',
    active: true,
    offenseRatings: { QB: 1, C: 3, WR: 4, RB: 2 },
    defenseRatings: { R: 2, S: 5, MLB: 3, CB: 4, E: 2 },
    notes: ''
  },
  {
    id: 'p-cal',
    teamId,
    firstName: 'Cal',
    lastName: 'Evans',
    jerseyNumber: '6',
    active: true,
    offenseRatings: { QB: 3, C: 4, WR: 2, RB: 3 },
    defenseRatings: { R: 3, S: 2, MLB: 5, CB: 2, E: 4 },
    notes: ''
  }
]

export const initialAppState: AppState = {
  team: {
    id: teamId,
    name: 'Wildcats',
    season: 'Fall 2026',
    ageGroup: '3rd Grade'
  },
  players: samplePlayers,
  games: [
    {
      id: gameId,
      teamId,
      opponent: 'Eagles',
      date: '2026-09-12',
      location: 'Field 3',
      status: 'scheduled',
      patternLength: 3
    }
  ],
  selectedGameId: gameId,
  drives: [
    withAssignments(createDrive('drive-off-1', 'offense', 1), {
      QB: 'p-jack',
      RB: 'p-sam',
      C: 'p-eli',
      '1': 'p-noah',
      '2': 'p-ben',
      '3': 'p-luke',
      '4': 'p-mason'
    }),
    withAssignments(createDrive('drive-def-1', 'defense', 1), {
      R: 'p-max',
      MLB: 'p-jack',
      S: 'p-eli',
      LE: 'p-sam',
      RE: 'p-ben',
      LCB: 'p-noah',
      RCB: 'p-mason'
    }),
    withAssignments(createDrive('drive-off-2', 'offense', 2), {
      QB: 'p-owen',
      RB: 'p-ty',
      C: 'p-cal',
      '1': 'p-mason',
      '2': 'p-noah',
      '3': 'p-ben',
      '4': 'p-luke'
    }),
    withAssignments(createDrive('drive-def-2', 'defense', 2), {
      R: 'p-luke',
      MLB: 'p-cal',
      S: 'p-mason',
      LE: 'p-max',
      RE: 'p-ty',
      LCB: 'p-ben',
      RCB: 'p-owen'
    }),
    createDrive('drive-off-3', 'offense', 3),
    createDrive('drive-def-3', 'defense', 3)
  ],
  selectedDriveId: 'drive-off-1',
  availabilityByGame: {
    [gameId]: {
      'p-liam': false
    }
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
      formation: 'Balanced',
      positions: 'RB motion right, 3 clears, 4 stalks space',
      notes: 'Good early-down call when edge defender crashes.',
      tags: ['run', 'outside']
    },
    {
      id: 'play-2',
      teamId,
      name: 'Slot Cross',
      formation: 'Trips Right',
      positions: '2 shallow, 3 dig, 4 clear, RB check release',
      notes: 'Use when QB has time and middle is open.',
      tags: ['pass', 'middle']
    }
  ],
  lineupTemplates: [],
  appSettings: {
    role: 'head',
    assistantCanAddNotes: true,
    assistantCanAdvanceDrive: false
  }
}
