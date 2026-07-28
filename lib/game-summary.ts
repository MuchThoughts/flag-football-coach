import { CONVERSION_POINTS, type Drive, type DriveResult } from './types'

export interface ScoringPlay {
  driveId: string
  label: string
  team: 'us' | 'opponent'
  points: number
}

export interface GameSummary {
  teamScore: number
  opponentScore: number
  completedDrives: number
  remainingDrives: number
  resultCounts: Record<string, number>
  scoringPlays: ScoringPlay[]
}

export function getGameSummary(drives: Drive[]): GameSummary {
  const summary: GameSummary = {
    teamScore: 0,
    opponentScore: 0,
    completedDrives: 0,
    remainingDrives: 0,
    resultCounts: {},
    scoringPlays: []
  }

  drives.forEach((drive) => {
    if (drive.status !== 'completed') {
      summary.remainingDrives += 1
      return
    }

    summary.completedDrives += 1
    const result = drive.result || 'No Result'
    summary.resultCounts[result] = (summary.resultCounts[result] || 0) + 1

    const scoringPlay = getScoringPlay(drive)
    if (!scoringPlay) {
      return
    }

    summary.scoringPlays.push(scoringPlay)
    if (scoringPlay.team === 'us') {
      summary.teamScore += scoringPlay.points
    } else {
      summary.opponentScore += scoringPlay.points
    }
  })

  return summary
}

/**
 * A touchdown counts for whoever had the ball: ours on an offensive drive, theirs
 * on a defensive one. Any conversion goes to the same side.
 */
function getScoringPlay(drive: Drive): ScoringPlay | null {
  const label = `${drive.unit === 'offense' ? 'OFF' : 'DEF'} ${drive.driveNumber}`
  const conversionPoints = CONVERSION_POINTS[drive.conversion || '']

  if (drive.result === 'TD') {
    const team = drive.unit === 'offense' ? 'us' : 'opponent'
    return {
      driveId: drive.id,
      label,
      team,
      points: 6 + conversionPoints
    }
  }

  // Results kept for games recorded before touchdowns knew which unit was on the field.
  if (drive.result === 'TD Allowed') {
    return {
      driveId: drive.id,
      label,
      team: 'opponent',
      points: 6 + conversionPoints
    }
  }

  if (drive.result === 'Extra Point') {
    return {
      driveId: drive.id,
      label,
      team: drive.unit === 'offense' ? 'us' : 'opponent',
      points: 1
    }
  }

  return null
}

export function getResultCount(summary: GameSummary, result: Exclude<DriveResult, ''>) {
  return summary.resultCounts[result] || 0
}
