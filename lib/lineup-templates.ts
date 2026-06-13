import { isPlayerAvailable } from './fair-play'
import { SLOTS_BY_UNIT } from './positions'
import type { Drive, LineupTemplate, Player } from './types'

export function applyLineupTemplateToDrive(
  drive: Drive,
  template: LineupTemplate,
  players: Player[],
  availability: Record<string, boolean>
) {
  if (drive.locked || drive.status === 'completed' || drive.unit !== template.unit) {
    return drive
  }

  const usedPlayerIds = new Set<string>()
  const assignments = SLOTS_BY_UNIT[drive.unit].reduce<Record<string, string | null>>((next, slot) => {
    const playerId = template.assignments[slot.code]
    const player = players.find((item) => item.id === playerId)

    const nextPlayerId = player && player.active && isPlayerAvailable(player.id, availability) && !usedPlayerIds.has(player.id) ? player.id : null
    next[slot.code] = nextPlayerId
    if (nextPlayerId) {
      usedPlayerIds.add(nextPlayerId)
    }

    return next
  }, {})

  return {
    ...drive,
    assignments,
    isCustomized: drive.isRepeated ? true : drive.isCustomized
  }
}
