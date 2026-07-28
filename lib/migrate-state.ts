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

/** Demo ids become their real-roster equivalent; anyone else keeps their slot. */
function remapPlayerId(playerId: string | null, idMap: Map<string, string>): string | null {
  if (!playerId) return null
  if (!legacySamplePlayerIds.includes(playerId)) return playerId
  return idMap.get(playerId) || null
}

function remapAssignments(assignments: Record<string, string | null>, idMap: Map<string, string>) {
  return Object.entries(assignments).reduce<Record<string, string | null>>((next, [slotCode, playerId]) => {
    next[slotCode] = remapPlayerId(playerId, idMap)
    return next
  }, {})
}

/**
 * Older saved states carry the demo roster. Drop every demo player, drop in the
 * real roster in their place, and keep planned lineups pointing at the
 * equivalent player. Players the coach added themselves are always kept.
 */
function replaceDemoRoster(state: AppState): AppState {
  const demoIds = state.players.map((player) => player.id).filter((id) => legacySamplePlayerIds.includes(id))
  if (demoIds.length === 0) {
    return state
  }

  const idMap = new Map<string, string>()
  demoIds.forEach((id) => {
    const replacement = samplePlayers[legacySamplePlayerIds.indexOf(id)]
    if (replacement) {
      idMap.set(id, replacement.id)
    }
  })

  const coachAddedPlayers = state.players.filter((player) => !legacySamplePlayerIds.includes(player.id))

  return {
    ...state,
    players: [
      ...samplePlayers,
      ...coachAddedPlayers.filter((player) => !samplePlayers.some((seed) => seed.id === player.id))
    ],
    drives: state.drives.map((drive) => ({ ...drive, assignments: remapAssignments(drive.assignments, idMap) })),
    availabilityByGame: Object.entries(state.availabilityByGame || {}).reduce<
      Record<string, Record<string, boolean>>
    >((next, [gameId, availability]) => {
      next[gameId] = Object.entries(availability).reduce<Record<string, boolean>>(
        (mapped, [playerId, available]) => {
          const newId = remapPlayerId(playerId, idMap)
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
      assignments: remapAssignments(template.assignments, idMap)
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
    team: {
      ...(saved.team || initialAppState.team),
      // The old placeholder team name predates the real one.
      name: !saved.team?.name || saved.team.name === 'Wildcats' ? initialAppState.team.name : saved.team.name
    },
    players: (saved.players || []).map(normalizePlayer),
    games: (saved.games || initialAppState.games).map(normalizeGame),
    availabilityByGame: saved.availabilityByGame || {},
    practices: saved.practices || [],
    practiceTemplates: saved.practiceTemplates || initialAppState.practiceTemplates,
    plays: saved.plays || [],
    lineupTemplates: saved.lineupTemplates || [],
    slotPositions: saved.slotPositions || {},
    appSettings: saved.appSettings || initialAppState.appSettings
  })

  return {
    ...state,
    players: state.players.map(normalizePlayer)
  }
}
