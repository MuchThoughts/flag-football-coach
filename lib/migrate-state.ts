import type { AppState, Drive, Formation, Game, PlayArea, PlaybookPlay, Player, PlayType, SlotPositions } from './types'
import { defaultFormationPositions } from './playbook'
import { initialAppState, samplePlayers } from './sample-data'

const legacyTimestamp = '2026-01-01T00:00:00.000Z'

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

function normalizeGame(game: Game, index: number): Game {
  return {
    id: game.id,
    teamId: game.teamId,
    name: game.name || `Game ${index + 1}`,
    date: game.date || '',
    location: game.location || '',
    status: game.status || 'scheduled',
    patternLength: game.patternLength || 3
  }
}

function normalizeDrive(drive: Drive): Drive {
  return {
    ...drive,
    backups: drive.backups || {},
    conversion: drive.conversion || ''
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
    drives: state.drives.map((drive) => ({
      ...drive,
      assignments: remapAssignments(drive.assignments, idMap),
      backups: remapAssignments(drive.backups || {}, idMap)
    })),
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

/** Spots authored for the old, nearly square field. */
const legacyDefaultPositions: Record<string, SlotPositions> = {
  offense: {
    '1': { x: 11, y: 78 },
    '2': { x: 28, y: 63 },
    C: { x: 50, y: 82 },
    QB: { x: 50, y: 58 },
    RB: { x: 50, y: 34 },
    '3': { x: 72, y: 63 },
    '4': { x: 89, y: 78 }
  },
  defense: {
    LCB: { x: 12, y: 28 },
    LE: { x: 34, y: 38 },
    R: { x: 50, y: 18 },
    RE: { x: 66, y: 38 },
    RCB: { x: 88, y: 28 },
    MLB: { x: 50, y: 52 },
    S: { x: 50, y: 78 }
  }
}

function samePosition(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01
}

/** True when every placed marker still sits on an old default spot. */
function matchesLegacyLayout(positions: SlotPositions, unit: 'offense' | 'defense') {
  const defaults = legacyDefaultPositions[unit]
  const placed = Object.keys(positions)
  return placed.length > 0 && placed.every((code) => defaults[code] && samePosition(positions[code], defaults[code]))
}

/**
 * The field went from nearly square to twice as wide, so spots laid out against
 * the old shape no longer read right. Untouched layouts move to the new
 * defaults; anything the coach dragged themselves is left alone.
 */
function migrateFieldLayouts(state: AppState): AppState {
  const slotPositions = Object.entries(state.slotPositions || {}).reduce<SlotPositions>((next, [key, position]) => {
    const [unit, code] = key.split(':')
    const legacy = legacyDefaultPositions[unit]?.[code]
    if (!legacy || !samePosition(position, legacy)) {
      next[key] = position
    }
    return next
  }, {})

  return {
    ...state,
    slotPositions,
    formations: (state.formations || []).map((formation) =>
      matchesLegacyLayout(formation.positions, 'offense')
        ? { ...formation, positions: defaultFormationPositions() }
        : formation
    )
  }
}

interface LegacyPlay {
  id: string
  teamId: string
  name: string
  formation?: string
  positions?: string
  notes?: string
  tags?: string[]
}

function legacyPlayArea(tags: string[]): PlayArea {
  if (tags.includes('deep')) return 'deep'
  if (tags.includes('outside') || tags.includes('sideline') || tags.includes('sidelines')) return 'sidelines'
  return 'middle'
}

/**
 * Plays used to carry a formation name as free text and loose tags. Turn each
 * distinct name into a real formation and map the tags onto type and area.
 */
function migratePlaybook(state: AppState): { plays: PlaybookPlay[]; formations: Formation[] } {
  const formations = [...(state.formations || [])]
  const plays = (state.plays || []).map((play) => {
    const legacy = play as unknown as LegacyPlay
    if (play.formationId && play.type && play.area) {
      return { ...play, notes: play.notes || '', routes: play.routes || [], footballs: play.footballs || [] }
    }

    const formationName = legacy.formation?.trim() || 'Balanced'
    let formation = formations.find((item) => item.name.toLowerCase() === formationName.toLowerCase())
    if (!formation) {
      formation = {
        id: `formation-${formationName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        teamId: legacy.teamId,
        name: formationName,
        positions: defaultFormationPositions(),
        createdAt: legacyTimestamp,
        updatedAt: legacyTimestamp
      }
      formations.push(formation)
    }

    const tags = legacy.tags || []
    // The old free-text routes are worth keeping, so fold them into the notes.
    const notes = [legacy.positions, legacy.notes].map((part) => part?.trim()).filter(Boolean).join(' ')

    return {
      id: legacy.id,
      teamId: legacy.teamId,
      name: legacy.name,
      formationId: formation.id,
      type: tags.includes('run') ? ('run' as PlayType) : ('pass' as PlayType),
      area: legacyPlayArea(tags),
      notes,
      routes: [],
      footballs: [],
      createdAt: legacyTimestamp,
      updatedAt: legacyTimestamp
    }
  })

  return { plays, formations }
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
    drives: (saved.drives || []).map(normalizeDrive),
    availabilityByGame: saved.availabilityByGame || {},
    practices: saved.practices || [],
    practiceTemplates: saved.practiceTemplates || initialAppState.practiceTemplates,
    plays: saved.plays || [],
    formations: saved.formations || [],
    lineupTemplates: saved.lineupTemplates || [],
    slotPositions: saved.slotPositions || {},
    appSettings: saved.appSettings || initialAppState.appSettings
  })

  const relaidOut = migrateFieldLayouts(state)
  const playbook = migratePlaybook(relaidOut)

  return {
    ...relaidOut,
    players: state.players.map(normalizePlayer),
    plays: playbook.plays,
    formations: playbook.formations
  }
}
