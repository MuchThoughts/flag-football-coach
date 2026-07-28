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

/** What followed a touchdown: nothing, a 1-point extra point, or a 2-point conversion. */
export type Conversion = '' | 'extra_point' | 'two_point'

export const CONVERSION_POINTS: Record<Conversion, number> = {
  '': 0,
  extra_point: 1,
  two_point: 2
}

export type PlayerRatings = Record<string, number>

/** Coach-dragged marker positions, keyed `${unit}:${slotCode}`, as percentages of the field. */
export type SlotPositions = Record<string, { x: number; y: number }>

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
  active: boolean
  offenseRatings: PlayerRatings
  defenseRatings: PlayerRatings
  notes: string
}

export interface Game {
  id: string
  teamId: string
  name: string
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
  /** Stand-in per position if the starter goes down, keyed by slot code. */
  backups: Record<string, string | null>
  result: DriveResult
  conversion: Conversion
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

export interface FieldPoint {
  x: number
  y: number
}

/** A drawn route. Dashed means the ball travels through the air. */
export interface PlayRoute {
  id: string
  points: FieldPoint[]
  style: 'solid' | 'dashed'
}

/** A football dropped on the field to mark a handoff. */
export interface PlayFootball extends FieldPoint {
  id: string
}

export type PlayType = 'pass' | 'run'

/** Where the play is aimed. */
export type PlayArea = 'deep' | 'sidelines' | 'middle'

/** A reusable set of marker positions plays are drawn from. */
export interface Formation {
  id: string
  teamId: string
  name: string
  positions: SlotPositions
  createdAt: string
  updatedAt: string
}

export interface PlaybookPlay {
  id: string
  teamId: string
  name: string
  formationId: string
  type: PlayType
  area: PlayArea
  notes: string
  routes: PlayRoute[]
  footballs: PlayFootball[]
  createdAt: string
  updatedAt: string
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
  formations: Formation[]
  lineupTemplates: LineupTemplate[]
  slotPositions: SlotPositions
  appSettings: AppSettings
}
