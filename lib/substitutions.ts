import type { ResolvedDrive } from './types'
import { SLOTS_BY_UNIT } from './positions'

/**
 * What changed between the lineup that was last on the field and the one going
 * out now — the substitutions a coach reads off before sending the unit out.
 */

export interface Substitution {
  slotCode: string
  /** Coming on at this position. */
  playerIn: string
  /**
   * Who they are replacing — only set when that player leaves the field. If the
   * previous occupant just moved somewhere else, their move says so instead.
   */
  playerOut: string | null
}

export interface PositionMove {
  playerId: string
  from: string
  to: string
}

export interface LineupChanges {
  subs: Substitution[]
  moves: PositionMove[]
  /** On the field before, off it now, and not named in a substitution. */
  outs: string[]
  unchanged: boolean
}

function slotOf(assignments: Record<string, string | null>, playerId: string) {
  return Object.entries(assignments).find(([, assigned]) => assigned === playerId)?.[0]
}

/**
 * Reads one lineup against another. Someone new to the field is a substitution,
 * someone on both sides in a different spot has moved, and anyone who comes off
 * without a direct replacement is called out on their own.
 */
export function compareLineups(previous: ResolvedDrive, current: ResolvedDrive): LineupChanges {
  const slots = SLOTS_BY_UNIT[current.unit]
  const before = previous.assignments
  const after = current.assignments

  const wasOn = (playerId: string) => Boolean(slotOf(before, playerId))
  const isOn = (playerId: string) => Boolean(slotOf(after, playerId))

  const subs: Substitution[] = []
  const moves: PositionMove[] = []
  const named = new Set<string>()

  slots.forEach((slot) => {
    const playerIn = after[slot.code]
    if (!playerIn || wasOn(playerIn)) return

    const held = before[slot.code]
    const playerOut = held && !isOn(held) ? held : null

    subs.push({ slotCode: slot.code, playerIn, playerOut })
    named.add(playerIn)
    if (playerOut) {
      named.add(playerOut)
    }
  })

  slots.forEach((slot) => {
    const playerId = after[slot.code]
    if (!playerId || !wasOn(playerId)) return
    const from = slotOf(before, playerId)
    if (from && from !== slot.code) {
      moves.push({ playerId, from, to: slot.code })
      named.add(playerId)
    }
  })

  // Anyone whose spot was taken by a player moving over rather than coming on.
  const outs = slots
    .map((slot) => before[slot.code])
    .filter((playerId): playerId is string => Boolean(playerId) && !isOn(playerId!) && !named.has(playerId!))

  return {
    subs,
    moves,
    outs: Array.from(new Set(outs)),
    unchanged: subs.length === 0 && moves.length === 0 && outs.length === 0
  }
}

/** The last time this unit was on the field before the given drive. */
export function previousUnitDrive(drives: ResolvedDrive[], drive: ResolvedDrive): ResolvedDrive | undefined {
  const index = drives.findIndex((item) => item.id === drive.id)
  if (index < 0) return undefined

  for (let position = index - 1; position >= 0; position -= 1) {
    if (drives[position].unit === drive.unit) {
      return drives[position]
    }
  }

  return undefined
}
