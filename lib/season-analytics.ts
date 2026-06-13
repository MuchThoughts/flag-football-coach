import { isPlayerAvailable, type PlayerUsage } from './fair-play'
import type { Drive, Game, Player } from './types'

export interface AttendanceSummary {
  playerId: string
  presentGames: number
  totalGames: number
}

export function computeSeasonUsage(
  players: Player[],
  drives: Drive[],
  availabilityByGame: Record<string, Record<string, boolean>>
): PlayerUsage[] {
  return players.map((player) => {
    const usage: PlayerUsage = {
      playerId: player.id,
      totalDrives: 0,
      offenseDrives: 0,
      defenseDrives: 0,
      benchDrives: 0,
      positionCounts: {}
    }

    if (!player.active) {
      return usage
    }

    drives.forEach((drive) => {
      const availability = availabilityByGame[drive.gameId] || {}
      if (!isPlayerAvailable(player.id, availability)) {
        return
      }

      const entry = Object.entries(drive.assignments).find(([, playerId]) => playerId === player.id)
      if (entry) {
        usage.totalDrives += 1
        if (drive.unit === 'offense') {
          usage.offenseDrives += 1
        } else {
          usage.defenseDrives += 1
        }
        usage.positionCounts[entry[0]] = (usage.positionCounts[entry[0]] || 0) + 1
      } else {
        usage.benchDrives += 1
      }
    })

    return usage
  })
}

export function getAttendanceSummary(
  players: Player[],
  games: Game[],
  availabilityByGame: Record<string, Record<string, boolean>>
): AttendanceSummary[] {
  return players.map((player) => ({
    playerId: player.id,
    totalGames: games.length,
    presentGames: games.filter((game) => player.active && isPlayerAvailable(player.id, availabilityByGame[game.id] || {})).length
  }))
}
