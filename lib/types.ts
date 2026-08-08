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

/** How many lineups a team keeps per unit. Drives cycle through them. */
export const LINEUPS_PER_UNIT = 4

/**
 * One of the team's four offensive or defensive lineups. Lineups belong to the
 * team, not to a game, so they carry from game to game until they are edited.
 */
export interface Lineup {
  id: string
  teamId: string
  unit: Unit
  /** 1 through LINEUPS_PER_UNIT. */
  slot: number
  assignments: Record<string, string | null>
  /** Stand-in per position if the starter goes down, keyed by slot code. */
  backups: Record<string, string | null>
}

export interface Drive {
  id: string
  gameId: string
  unit: Unit
  driveNumber: number
  /** Which of the unit's lineups takes this drive. */
  lineupId: string
  result: DriveResult
  conversion: Conversion
  notes: DriveNote
  startedAt?: string
  endedAt?: string
  status: DriveStatus
  locked: boolean
}

/** A drive with its lineup's assignments filled in, for anything that reads them. */
export interface ResolvedDrive extends Drive {
  assignments: Record<string, string | null>
  backups: Record<string, string | null>
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

/** One component of a play call, in the order the coach says it. */
export interface PlayStep {
  id: string
  componentId: string
  /** Who it belongs to, for components that name someone. "2 / 3" is two options. */
  receivers?: string[]
  direction?: 'left' | 'right'
  fake?: boolean
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
  /** Set when the play was written in the builder rather than drawn. */
  steps?: PlayStep[]
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
  /** Which seeded playbook this state has already taken. */
  playbookSeed: string
  lineups: Lineup[]
  slotPositions: SlotPositions
  appSettings: AppSettings
}
