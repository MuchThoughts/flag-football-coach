import type { AppState, Drive, Game, Player } from './types'
import { initialAppState, samplePlayers } from './sample-data'

const legacySamplePlayerIds = [
  'p-jack',
  'p-sam',
  'p-eli',
  'p-noah',
  'p-ben',
  'p-luke',
  'p-mason',
  'p-max',
  'p-owen',
  'p-ty',
  'p-liam',
  'p-cal'
]

function normalizePlayer(player: Player): Player {
  return {
    id: player.id,
    teamId: player.teamId,
    firstName: (player.firstName || '').trim(),
    active: player.active !== false,
    offenseRatings: player.offenseRatings || {},
    defenseRatings: player.defenseRatings || {},
    notes: player.notes || ''
  }
}

function normalizeGame(game: Game): Game {
  return {
    id: game.id,
    teamId: game.teamId,
    date: game.date || '',
    location: game.location || '',
    status: game.status || 'scheduled',
    patternLength: game.patternLength || 3
  }
}

function remapAssignments(drive: Drive, idMap: Map<string, string>): Drive {
  const assignments = Object.entries(drive.assignments).reduce<Record<string, string | null>>(
    (next, [slotCode, playerId]) => {
      next[slotCode] = playerId ? idMap.get(playerId) || null : null
      return next
    },
    {}
  )

  return { ...drive, assignments }
}

/**
 * Older saved states carry the demo roster. Swap it for the real roster and keep
 * planned lineups pointing at the equivalent player. Rosters the coach has
 * touched (any player id outside the demo set) are left alone.
 */
function replaceDemoRoster(state: AppState): AppState {
  const ids = state.players.map((player) => player.id)
  if (ids.length === 0 || !ids.every((id) => legacySamplePlayerIds.includes(id))) {
    return state
  }

  const idMap = new Map<string, string>()
  ids.forEach((id) => {
    const replacement = samplePlayers[legacySamplePlayerIds.indexOf(id)]
    if (replacement) {
      idMap.set(id, replacement.id)
    }
  })

  return {
    ...state,
    players: samplePlayers,
    drives: state.drives.map((drive) => remapAssignments(drive, idMap)),
    availabilityByGame: Object.entries(state.availabilityByGame || {}).reduce<
      Record<string, Record<string, boolean>>
    >((next, [gameId, availability]) => {
      next[gameId] = Object.entries(availability).reduce<Record<string, boolean>>(
        (mapped, [playerId, available]) => {
          const newId = idMap.get(playerId)
          if (newId) {
            mapped[newId] = available
          }
          return mapped
        },
        {}
      )
      return next
    }, {}),
    lineupTemplates: (state.lineupTemplates || []).map((template) => ({
      ...template,
      assignments: Object.entries(template.assignments).reduce<Record<string, string | null>>(
        (next, [slotCode, playerId]) => {
          next[slotCode] = playerId ? idMap.get(playerId) || null : null
          return next
        },
        {}
      )
    }))
  }
}

/**
 * Brings saved states forward: drops jersey numbers, last names and opponents,
 * and upgrades the demo roster to the real one.
 */
export function migrateAppState(saved: AppState): AppState {
  const state = replaceDemoRoster({
    ...initialAppState,
    ...saved,
    players: (saved.players || []).map(normalizePlayer),
    games: (saved.games || initialAppState.games).map(normalizeGame),
    availabilityByGame: saved.availabilityByGame || {},
    practices: saved.practices || [],
    practiceTemplates: saved.practiceTemplates || initialAppState.practiceTemplates,
    plays: saved.plays || [],
    lineupTemplates: saved.lineupTemplates || [],
    appSettings: saved.appSettings || initialAppState.appSettings
  })

  return {
    ...state,
    players: state.players.map(normalizePlayer)
  }
}
