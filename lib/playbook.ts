import { OFFENSE_SLOTS } from './positions'
import type { Formation, PlayArea, PlaybookPlay, PlayType, SlotPositions } from './types'

export const PLAY_TYPES: PlayType[] = ['pass', 'run']
export const PLAY_AREAS: PlayArea[] = ['deep', 'sidelines', 'middle']

/** Plays are drawn from the offensive positions: QB, RB, C, 1, 2, 3, 4. */
export const PLAYBOOK_SLOTS = OFFENSE_SLOTS

export function defaultFormationPositions(): SlotPositions {
  return PLAYBOOK_SLOTS.reduce<SlotPositions>((positions, slot) => {
    positions[slot.code] = { x: slot.x, y: slot.y }
    return positions
  }, {})
}

/** Falls back to the default spot for any position the formation does not place. */
export function getFormationPosition(slotCode: string, formation?: Formation) {
  const placed = formation?.positions[slotCode]
  if (placed) return placed
  const slot = PLAYBOOK_SLOTS.find((item) => item.code === slotCode)
  return { x: slot?.x ?? 50, y: slot?.y ?? 50 }
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
