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
  /** Which unit takes the field for the first drive. */
  startingUnit: Unit
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
  playbookId: string
  /** Which personnel package lines up in it. */
  packageId: string
  /** Where the line of scrimmage sits, top to bottom in field percent. */
  lineOfScrimmage?: number
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

export type PositionType = 'OL' | 'QB' | 'RB' | 'TE' | 'WR'

/** One player a playbook draws on the field, with the label shown in their circle. */
export interface PlaybookPosition {
  /** Stable key that formations place; the label can change without moving anyone. */
  code: string
  /** The position's name, free text, shown in the player's circle. */
  label: string
  /** What kind of player this is, whatever the coach calls them. */
  type: PositionType
}

/**
 * A personnel package: which players take the field, under what labels. Packages
 * in a playbook share position codes where they can, so switching a formation
 * from one package to another keeps everybody's spot and only the labels change.
 */
export interface PersonnelPackage {
  id: string
  name: string
  positions: PlaybookPosition[]
}

/** A named collection of plays, like an offense for one season or one opponent. */
export interface Playbook {
  id: string
  teamId: string
  name: string
  /** The personnel packages this playbook lines up in; the first is the default. */
  packages: PersonnelPackage[]
  /** The formation new formations start from and new plays default to. */
  baseFormationId?: string
  createdAt: string
  updatedAt: string
}

/** One box on a call sheet: a situation and the plays to call in it, in order. */
export interface CallSheetSection {
  id: string
  title: string
  playIds: string[]
}

/** A game-day sheet built from one playbook's plays. */
export interface CallSheet {
  id: string
  teamId: string
  playbookId: string
  name: string
  sections: CallSheetSection[]
  createdAt: string
  updatedAt: string
}

/** What a drawn line means, which sets how it looks. */
export type PlayLineKind = 'route' | 'run' | 'fake' | 'block' | 'motion'

/**
 * A line drawn from one player. It starts wherever that player lines up (or,
 * after a motion, where the motion ends), so it moves with the formation.
 * Points and bends are field percentages.
 */
export interface PlayLine {
  id: string
  playerCode: string
  kind: PlayLineKind
  /** Every point after the start: pivots, then the end. */
  points: FieldPoint[]
  /** One per segment: a control point that curves it, or null for straight. */
  bends: (FieldPoint | null)[]
}

/** The part of the field a play is shown at: a centre in field percent, and how far in. */
export interface PlayView {
  x: number
  y: number
  zoom: number
}

export interface PlaybookPlay {
  id: string
  teamId: string
  playbookId: string
  name: string
  formationId: string
  type: PlayType
  area: PlayArea
  notes: string
  routes: PlayRoute[]
  footballs: PlayFootball[]
  /** Set when the play was written in the builder rather than drawn. */
  steps?: PlayStep[]
  /** Lines drawn in the play editor, anchored to players. */
  lines?: PlayLine[]
  /** How far in and where the play is shown, here and when exported. */
  view?: PlayView
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
  playbooks: Playbook[]
  callSheets: CallSheet[]
  formations: Formation[]
  /** Which seeded playbook this state has already taken. */
  playbookSeed: string
  lineups: Lineup[]
  slotPositions: SlotPositions
  appSettings: AppSettings
}
