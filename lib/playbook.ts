import { LINE_OF_SCRIMMAGE, OFFENSE_SLOTS } from './positions'
import type { Formation, PlayArea, PlaybookPlay, PlaybookPosition, PlayType, PositionType, SlotPositions } from './types'

export const PLAY_TYPES: PlayType[] = ['pass', 'run']
export const PLAY_AREAS: PlayArea[] = ['deep', 'sidelines', 'middle']

/** The original seven: QB, RB, C and receivers 1-4. Playbooks from before custom positions use these. */
export const PLAYBOOK_SLOTS = OFFENSE_SLOTS

export const POSITION_TYPES: PositionType[] = ['OL', 'QB', 'RB', 'TE', 'WR']

/** A best guess at the kind of player from what the coach calls them. */
export function inferPositionType(label: string): PositionType {
  const name = label.trim().toUpperCase()
  if (name === 'QB') return 'QB'
  if (['RB', 'HB', 'FB', 'TB'].includes(name)) return 'RB'
  if (name.startsWith('TE') || name === 'Y') return 'TE'
  if (['C', 'G', 'T', 'OL', 'LT', 'LG', 'RG', 'RT'].includes(name)) return 'OL'
  return 'WR'
}

export const DEFAULT_POSITIONS: PlaybookPosition[] = OFFENSE_SLOTS.map((slot) => ({
  code: slot.code,
  label: slot.shortName,
  type: inferPositionType(slot.shortName)
}))

export const MIN_PLAYERS = 3
export const MAX_PLAYERS = 11
/** Long enough for QB, WR1 or X; short enough to fit in a circle. */
export const POSITION_LABEL_LENGTH = 4

export function defaultFormationPositions(): SlotPositions {
  return PLAYBOOK_SLOTS.reduce<SlotPositions>((positions, slot) => {
    positions[slot.code] = { x: slot.x, y: slot.y }
    return positions
  }, {})
}

/**
 * A starting lineup for any number of players: a quarterback, a back once
 * there are six, a center once three are on the line, and numbered receivers
 * either side of him. Seven gives the original 1, 2, C, 3, 4, QB, RB.
 */
export function suggestedPositions(count: number): PlaybookPosition[] {
  const total = Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, Math.round(count)))
  const backfield = total >= 6 ? ['QB', 'RB'] : ['QB']
  const lineCount = total - backfield.length
  const hasCenter = lineCount >= 3
  const receivers = Array.from({ length: lineCount - (hasCenter ? 1 : 0) }, (_, index) => String(index + 1))
  const line = hasCenter
    ? [...receivers.slice(0, Math.ceil(receivers.length / 2)), 'C', ...receivers.slice(Math.ceil(receivers.length / 2))]
    : receivers
  return [...line, ...backfield].map((label) => ({ code: label, label, type: inferPositionType(label) }))
}

/** Quarterbacks and backs line up behind the line; everyone else is on it. */
function inBackfield(position: PlaybookPosition) {
  return position.type === 'QB' || position.type === 'RB'
}

function isDefaultSet(positions: PlaybookPosition[]) {
  return positions.length === DEFAULT_POSITIONS.length && DEFAULT_POSITIONS.every((slot) => positions.some((item) => item.code === slot.code))
}

/**
 * Where each position starts in a new formation. Backs line up behind the
 * center and everyone else spreads evenly along the line of scrimmage.
 */
export function layoutPositions(positions: PlaybookPosition[] = DEFAULT_POSITIONS): SlotPositions {
  if (isDefaultSet(positions)) return defaultFormationPositions()

  const line = positions.filter((position) => !inBackfield(position))
  const backs = positions.filter(inBackfield)
  const spots: SlotPositions = {}

  line.forEach((position, index) => {
    spots[position.code] = { x: line.length === 1 ? 50 : Math.round(8 + (index * 84) / (line.length - 1)), y: LINE_OF_SCRIMMAGE }
  })
  // The quarterback sits under center; any other backs fan out behind him.
  const quarterback = backs.find((position) => position.type === 'QB')
  const others = backs.filter((position) => position !== quarterback)
  if (quarterback) spots[quarterback.code] = { x: 50, y: 72 }
  others.forEach((position, index) => {
    spots[position.code] = { x: index % 2 === 0 ? 30 - Math.floor(index / 2) * 12 : 70 + Math.floor(index / 2) * 12, y: 84 }
  })
  return spots
}

/** Falls back to the starting spot for any position the formation does not place. */
export function getFormationPosition(slotCode: string, formation?: Formation, positions: PlaybookPosition[] = DEFAULT_POSITIONS) {
  const placed = formation?.positions[slotCode]
  if (placed) return placed
  return layoutPositions(positions)[slotCode] || { x: 50, y: 50 }
}

/** Labels have to tell the circles apart, so blanks and repeats are not allowed. */
/** Fills in a type for players saved before positions had one. */
export function withPositionTypes(positions: PlaybookPosition[]): PlaybookPosition[] {
  return positions.map((position) =>
    POSITION_TYPES.includes(position.type) ? position : { ...position, type: inferPositionType(position.label || '') }
  )
}

export function positionLabelsValid(positions: PlaybookPosition[]) {
  const labels = positions.map((position) => position.label.trim().toLowerCase())
  return labels.every(Boolean) && new Set(labels).size === labels.length
}

export interface PlayFilters {
  search: string
  type: PlayType | 'all'
  area: PlayArea | 'all'
  formationId: string
}

export const emptyPlayFilters: PlayFilters = {
  search: '',
  type: 'all',
  area: 'all',
  formationId: 'all'
}

/** Text search covers the play name, its notes and the formation it is built on. */
export function filterPlays(plays: PlaybookPlay[], formations: Formation[], filters: PlayFilters): PlaybookPlay[] {
  const search = filters.search.trim().toLowerCase()

  return plays.filter((play) => {
    if (filters.type !== 'all' && play.type !== filters.type) return false
    if (filters.area !== 'all' && play.area !== filters.area) return false
    if (filters.formationId !== 'all' && play.formationId !== filters.formationId) return false
    if (!search) return true

    const formationName = formations.find((formation) => formation.id === play.formationId)?.name || ''
    return `${play.name} ${play.notes} ${formationName}`.toLowerCase().includes(search)
  })
}

export function countPlaysByFormation(plays: PlaybookPlay[], formationId: string) {
  return plays.filter((play) => play.formationId === formationId).length
}
