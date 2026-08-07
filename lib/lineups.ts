import { createEmptyAssignments } from './positions'
import { LINEUPS_PER_UNIT, type Drive, type Lineup, type ResolvedDrive, type Unit } from './types'

export function lineupId(unit: Unit, slot: number) {
  return `lineup-${unit}-${slot}`
}

export function createLineup(unit: Unit, slot: number, teamId: string): Lineup {
  return {
    id: lineupId(unit, slot),
    teamId,
    unit,
    slot,
    assignments: createEmptyAssignments(unit),
    backups: {}
  }
}

/** The four offensive and four defensive lineups, in order. */
export function createLineups(teamId: string): Lineup[] {
  const slots = Array.from({ length: LINEUPS_PER_UNIT }, (_, index) => index + 1)
  return [
    ...slots.map((slot) => createLineup('offense', slot, teamId)),
    ...slots.map((slot) => createLineup('defense', slot, teamId))
  ]
}

export function getLineupsForUnit(lineups: Lineup[], unit: Unit) {
  return lineups.filter((lineup) => lineup.unit === unit).sort((a, b) => a.slot - b.slot)
}

/** Drives cycle through the lineups: drive 1 takes lineup 1, drive 5 takes lineup 1 again. */
export function defaultLineupSlot(driveNumber: number) {
  return ((driveNumber - 1) % LINEUPS_PER_UNIT) + 1
}

export function findLineup(lineups: Lineup[], drive: Drive) {
  return (
    lineups.find((lineup) => lineup.id === drive.lineupId) ||
    lineups.find((lineup) => lineup.unit === drive.unit && lineup.slot === defaultLineupSlot(drive.driveNumber))
  )
}

/** Fills a drive in with its lineup so anything reading assignments still works. */
export function resolveDrive(drive: Drive, lineups: Lineup[]): ResolvedDrive {
  const lineup = findLineup(lineups, drive)
  return {
    ...drive,
    assignments: lineup?.assignments || createEmptyAssignments(drive.unit),
    backups: lineup?.backups || {}
  }
}

export function resolveDrives(drives: Drive[], lineups: Lineup[]): ResolvedDrive[] {
  return drives.map((drive) => resolveDrive(drive, lineups))
}

export function lineupLabel(lineup: Lineup) {
  return `${lineup.unit === 'offense' ? 'OFF' : 'DEF'} ${lineup.slot}`
}
