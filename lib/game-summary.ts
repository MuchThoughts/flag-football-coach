import type { Drive, DriveResult } from './types'

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

function getScoringPlay(drive: Drive): ScoringPlay | null {
  const label = `${drive.unit === 'offense' ? 'OFF' : 'DEF'} ${drive.driveNumber}`

  if (drive.result === 'TD') {
    return {
      driveId: drive.id,
      label,
      team: 'us',
      points: 6
    }
  }

  if (drive.result === 'Extra Point') {
    return {
      driveId: drive.id,
      label,
      team: 'us',
      points: 1
    }
  }

  if (drive.result === 'TD Allowed') {
    return {
      driveId: drive.id,
      label,
      team: 'opponent',
      points: 6
    }
  }

  return null
}

export function getResultCount(summary: GameSummary, result: Exclude<DriveResult, ''>) {
  return summary.resultCounts[result] || 0
}
