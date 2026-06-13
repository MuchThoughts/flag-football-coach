import type { Drive, Player, Unit } from './types'
import { SLOTS_BY_UNIT } from './positions'

export interface PlayerUsage {
  playerId: string
  totalDrives: number
  offenseDrives: number
  defenseDrives: number
  benchDrives: number
  positionCounts: Record<string, number>
}

export interface FairPlayWarning {
  id: string
  level: 'info' | 'warning' | 'error'
  message: string
}

export function getAssignedPlayerIds(drive: Drive) {
  return Object.values(drive.assignments).filter(Boolean) as string[]
}

export function isPlayerAvailable(playerId: string, availability: Record<string, boolean>) {
  return availability[playerId] !== false
}

export function getDriveWarnings(
  drive: Drive,
  players: Player[],
  availability: Record<string, boolean>
): FairPlayWarning[] {
  const warnings: FairPlayWarning[] = []
  const slots = SLOTS_BY_UNIT[drive.unit]
  const assignedIds = getAssignedPlayerIds(drive)
  const duplicates = assignedIds.filter((playerId, index) => assignedIds.indexOf(playerId) !== index)
  const emptySlots = slots.filter((slot) => !drive.assignments[slot.code])

  if (emptySlots.length > 0) {
    warnings.push({
      id: `${drive.id}-missing`,
      level: 'error',
      message: `${emptySlots.length} open position${emptySlots.length === 1 ? '' : 's'}`
    })
  }

  if (duplicates.length > 0) {
    warnings.push({
      id: `${drive.id}-duplicate`,
      level: 'error',
      message: 'Duplicate player assignment'
    })
  }

  assignedIds.forEach((playerId) => {
    const player = players.find((item) => item.id === playerId)
    if (!player || !player.active || !isPlayerAvailable(playerId, availability)) {
      warnings.push({
        id: `${drive.id}-${playerId}-unavailable`,
        level: 'error',
        message: `${player ? player.firstName : 'Player'} is not available`
      })
    }
  })

  return warnings
}

export function computeUsage(
  players: Player[],
  drives: Drive[],
  availability: Record<string, boolean>
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

    if (!player.active || !isPlayerAvailable(player.id, availability)) {
      return usage
    }

    drives.forEach((drive) => {
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

export function getFairPlayWarnings(
  players: Player[],
  drives: Drive[],
  availability: Record<string, boolean>
): FairPlayWarning[] {
  const availablePlayers = players.filter((player) => player.active && isPlayerAvailable(player.id, availability))
  const usage = computeUsage(players, drives, availability)
  const warnings: FairPlayWarning[] = []

  if (availablePlayers.length < 7) {
    warnings.push({
      id: 'short-roster',
      level: 'error',
      message: `Only ${availablePlayers.length} available players`
    })
  }

  usage.forEach((playerUsage) => {
    const player = players.find((item) => item.id === playerUsage.playerId)
    if (!player || !player.active || !isPlayerAvailable(player.id, availability) || drives.length < 2) {
      return
    }

    if (playerUsage.totalDrives === 0) {
      warnings.push({
        id: `unused-${player.id}`,
        level: 'warning',
        message: `${player.firstName} has no planned drives`
      })
    }

    if (playerUsage.benchDrives >= Math.max(3, Math.ceil(drives.length * 0.65))) {
      warnings.push({
        id: `sitting-${player.id}`,
        level: 'warning',
        message: `${player.firstName} sits ${playerUsage.benchDrives} drives`
      })
    }
  })

  return warnings
}

export function autoFillDrive(
  drive: Drive,
  players: Player[],
  availability: Record<string, boolean>,
  allGameDrives: Drive[]
): Drive {
  const assignments = { ...drive.assignments }
  const used = new Set(Object.values(assignments).filter(Boolean) as string[])
  const usage = computeUsage(players, allGameDrives, availability)

  SLOTS_BY_UNIT[drive.unit].forEach((slot) => {
    if (assignments[slot.code]) {
      return
    }

    const candidates = players
      .filter((player) => player.active && isPlayerAvailable(player.id, availability) && !used.has(player.id))
      .sort((a, b) => {
        const aRating = getRating(a, drive.unit, slot.ratingKey)
        const bRating = getRating(b, drive.unit, slot.ratingKey)
        const aUsage = usage.find((item) => item.playerId === a.id)?.totalDrives || 0
        const bUsage = usage.find((item) => item.playerId === b.id)?.totalDrives || 0
        return bRating - aRating || aUsage - bUsage || a.firstName.localeCompare(b.firstName)
      })

    const selected = candidates[0]
    if (selected) {
      assignments[slot.code] = selected.id
      used.add(selected.id)
    }
  })

  return {
    ...drive,
    assignments,
    isCustomized: drive.isRepeated ? true : drive.isCustomized
  }
}

export function getRating(player: Player, unit: Unit, ratingKey: string) {
  const ratings = unit === 'offense' ? player.offenseRatings : player.defenseRatings
  return ratings[ratingKey] || 0
}
