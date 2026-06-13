export type Unit = 'offense' | 'defense'

export type DriveStatus = 'planned' | 'current' | 'completed'

export type DriveResult =
  | 'TD'
  | 'Stop'
  | 'Turnover'
  | 'Extra Point'
  | 'Punt'
  | 'End Half'
  | 'End Game'
  | 'TD Allowed'
  | ''

export type PlayerRatings = Record<string, number>

export interface Team {
  id: string
  name: string
  season: string
  ageGroup: string
}

export interface Player {
  id: string
  teamId: string
  firstName: string
  lastName: string
  jerseyNumber: string
  active: boolean
  offenseRatings: PlayerRatings
  defenseRatings: PlayerRatings
  notes: string
}

export interface Game {
  id: string
  teamId: string
  opponent: string
  date: string
  location: string
  status: 'scheduled' | 'in_progress' | 'completed'
  patternLength: number
}

export interface DriveNote {
  whatWorked: string
  whatFailed: string
  playerNotes: string
  playCalls: string
  result: DriveResult
  freeform: string
}

export interface Drive {
  id: string
  gameId: string
  unit: Unit
  driveNumber: number
  sourceDriveId?: string
  isRepeated: boolean
  isCustomized: boolean
  assignments: Record<string, string | null>
  result: DriveResult
  notes: DriveNote
  startedAt?: string
  endedAt?: string
  status: DriveStatus
  locked: boolean
}

export interface PracticePlan {
  id: string
  teamId: string
  title: string
  date: string
  warmup: string
  skills: string
  offense: string
  defense: string
  scrimmage: string
  notes: string
}

export interface PracticeTemplate {
  id: string
  teamId: string
  name: string
  warmup: string
  skills: string
  offense: string
  defense: string
  scrimmage: string
  notes: string
  createdAt: string
  updatedAt: string
}

export interface PlaybookPlay {
  id: string
  teamId: string
  name: string
  formation: string
  positions: string
  notes: string
  tags: string[]
}

export interface LineupTemplate {
  id: string
  teamId: string
  name: string
  unit: Unit
  assignments: Record<string, string | null>
  createdAt: string
  updatedAt: string
}

export interface AppSettings {
  role: 'head' | 'assistant'
  assistantCanAddNotes: boolean
  assistantCanAdvanceDrive: boolean
}

export interface AppState {
  team: Team
  players: Player[]
  games: Game[]
  selectedGameId: string
  drives: Drive[]
  selectedDriveId: string
  availabilityByGame: Record<string, Record<string, boolean>>
  practices: PracticePlan[]
  practiceTemplates: PracticeTemplate[]
  plays: PlaybookPlay[]
  lineupTemplates: LineupTemplate[]
  appSettings: AppSettings
}
