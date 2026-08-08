'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Cloud,
  Copy,
  LogIn,
  LogOut,
  Minimize2,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  Undo2,
  X
} from 'lucide-react'
import {
  appSettingsFromMembership,
  ensureSupabaseMembership,
  loadSupabaseState,
  saveSupabaseState,
  subscribeToSupabaseState,
  type SupabaseMembership
} from '@/lib/supabase/app-state'
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/client'
import {
  autoFillDrive,
  computeUsage,
  countSitOuts,
  getDriveWarnings,
  getRestWindowDrives,
  isPlayerAvailable
} from '@/lib/fair-play'
import { getGameSummary } from '@/lib/game-summary'
import { migrateAppState } from '@/lib/migrate-state'
import {
  countPlaysByFormation,
  defaultFormationPositions,
  emptyPlayFilters,
  filterPlays,
  PLAY_AREAS,
  PLAY_TYPES,
  PLAYBOOK_SLOTS,
  type PlayFilters
} from '@/lib/playbook'
import {
  classifySteps,
  COMPONENT_GROUPS,
  componentsInGroup,
  findComponent,
  parsePlayCall,
  playCallFromSteps,
  RECEIVER_CODES,
  stepIsComplete,
  stepLabel,
  type ComponentGroup
} from '@/lib/play-builder'
import { LINEUPS_PER_UNIT } from '@/lib/types'
import PlaybookField from '@/components/PlaybookField'
import { findLineup, getLineupsForUnit, lineupLabel, resolveDrive, resolveDrives } from '@/lib/lineups'
import { getSlotPosition, LINE_OF_SCRIMMAGE, slotPositionKey, SLOTS_BY_UNIT, type FieldSlot } from '@/lib/positions'
import { snapToField, type SnapResult } from '@/lib/snapping'
import { createDrive, createPlayer, initialAppState } from '@/lib/sample-data'
import type {
  AppSettings,
  AppState,
  Conversion,
  Drive,
  DriveNote,
  DriveResult,
  Formation,
  Game,
  Lineup,
  PlayArea,
  PlaybookPlay,
  PlayFootball,
  Player,
  PlayRoute,
  PlayStep,
  PlayType,
  ResolvedDrive,
  SlotPositions,
  Unit
} from '@/lib/types'

type Workflow = 'planning' | 'gameday' | 'playbook' | 'play-builder'
type SyncStatus = 'local' | 'signed_out' | 'loading' | 'synced' | 'saving' | 'error'

const storageKey = 'flag-football-coach:v3'
const legacyStorageKeys = ['flag-football-coach:v2', 'flag-football-coach:v1']
const resultOptions: Array<Exclude<DriveResult, ''>> = ['TD', 'Stop', 'Turnover', 'Punt', 'End Half', 'End Game']
const conversionOptions: Array<{ value: Conversion; label: string }> = [
  { value: '', label: 'None' },
  { value: 'extra_point', label: 'XP +1' },
  { value: 'two_point', label: '2-Pt +2' }
]

function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function driveSortValue(drive: Drive) {
  return drive.driveNumber * 10 + (drive.unit === 'offense' ? 0 : 1)
}

function emptyNote(): DriveNote {
  return {
    whatWorked: '',
    whatFailed: '',
    playerNotes: '',
    playCalls: '',
    result: '',
    freeform: ''
  }
}

function driveLabel(drive: Drive) {
  return `${drive.unit === 'offense' ? 'OFF' : 'DEF'} ${drive.driveNumber}`
}

function nextDriveNumber(drives: Drive[], unit: Unit) {
  return Math.max(0, ...drives.filter((drive) => drive.unit === unit).map((drive) => drive.driveNumber)) + 1
}

function shortResult(result: DriveResult) {
  if (!result) return 'Open'
  if (result === 'TD Allowed') return 'Allowed'
  return result
}

function workflowFromPath(pathname: string): Workflow {
  if (pathname.includes('/gameday')) return 'gameday'
  if (pathname.includes('/play-builder')) return 'play-builder'
  if (pathname.includes('/playbook')) return 'playbook'
  return 'planning'
}

function workflowPath(workflow: Workflow) {
  return `/${workflow}`
}

export default function CoachApp() {
  const [team, setTeam] = useState(initialAppState.team)
  const [players, setPlayers] = useState(initialAppState.players)
  const [games, setGames] = useState(initialAppState.games)
  const [selectedGameId, setSelectedGameId] = useState(initialAppState.selectedGameId)
  const [drives, setDrives] = useState(initialAppState.drives)
  const [selectedDriveId, setSelectedDriveId] = useState(initialAppState.selectedDriveId)
  const [availabilityByGame, setAvailabilityByGame] = useState(initialAppState.availabilityByGame)
  const [practices, setPractices] = useState(initialAppState.practices)
  const [practiceTemplates, setPracticeTemplates] = useState(initialAppState.practiceTemplates)
  const [plays, setPlays] = useState(initialAppState.plays)
  const [formations, setFormations] = useState(initialAppState.formations)
  const [playbookSeed, setPlaybookSeed] = useState(initialAppState.playbookSeed)
  const [lineups, setLineups] = useState(initialAppState.lineups)
  const [slotPositions, setSlotPositions] = useState(initialAppState.slotPositions)
  const [appSettings, setAppSettings] = useState<AppSettings>(initialAppState.appSettings)
  const [workflow, setWorkflow] = useState<Workflow>('planning')
  const [rosterCollapsed, setRosterCollapsed] = useState(false)
  const [selectedLineupId, setSelectedLineupId] = useState(initialAppState.lineups[0].id)
  const [loaded, setLoaded] = useState(false)
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null)
  const [draggingPlayerId, setDraggingPlayerId] = useState<string | null>(null)
  const [gameNoteDraft, setGameNoteDraft] = useState('')
  const [authForm, setAuthForm] = useState({ email: '', password: '' })
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(isSupabaseConfigured() ? 'loading' : 'local')
  const [syncMessage, setSyncMessage] = useState(isSupabaseConfigured() ? 'Checking session' : 'Local only')
  const [syncUserId, setSyncUserId] = useState<string | null>(null)
  const [syncUserEmail, setSyncUserEmail] = useState('')
  const [syncTeamId, setSyncTeamId] = useState<string | null>(null)
  const [syncMembership, setSyncMembership] = useState<SupabaseMembership | null>(null)
  const [syncReady, setSyncReady] = useState(false)
  const saveTimerRef = useRef<number | null>(null)
  const applyingRemoteStateRef = useRef(false)

  const selectedGame = games.find((game) => game.id === selectedGameId) || games[0]
  const gameDrives = drives
    .filter((drive) => drive.gameId === selectedGame?.id)
    .sort((a, b) => driveSortValue(a) - driveSortValue(b))
  const resolvedDrives = resolveDrives(gameDrives, lineups)
  const selectedDrive = gameDrives.find((drive) => drive.id === selectedDriveId) || gameDrives[0]
  const selectedResolvedDrive = resolvedDrives.find((drive) => drive.id === selectedDrive?.id)
  const selectedDriveIndex = Math.max(0, gameDrives.findIndex((drive) => drive.id === selectedDrive?.id))
  const selectedLineup = lineups.find((lineup) => lineup.id === selectedLineupId) || lineups[0]
  const availability = availabilityByGame[selectedGame?.id || ''] || {}
  const activePlayers = players.filter((player) => player.active)
  const availablePlayers = activePlayers.filter((player) => isPlayerAvailable(player.id, availability))
  const unavailablePlayers = activePlayers.filter((player) => !isPlayerAvailable(player.id, availability))
  const assignedIds = selectedLineup ? Object.values(selectedLineup.assignments).filter(Boolean) : []
  const benchPlayers = availablePlayers.filter((player) => !assignedIds.includes(player.id))
  const selectedPlayer = selectedPlayerId ? players.find((player) => player.id === selectedPlayerId) : undefined
  const gameSummary = getGameSummary(gameDrives)
  const usage = computeUsage(players, resolvedDrives, availability)
  const lineupWarnings = selectedLineup
    ? getDriveWarnings(
        { ...gameDrives[0], unit: selectedLineup.unit, assignments: selectedLineup.assignments, backups: selectedLineup.backups },
        players,
        availability
      )
    : []
  const nextOpenDrive = gameDrives.find((drive) => drive.status !== 'completed') || gameDrives[0]
  const syncBusy = syncStatus === 'loading' || syncStatus === 'saving'

  function navigateWorkflow(nextWorkflow: Workflow) {
    setWorkflow(nextWorkflow)

    const nextPath = workflowPath(nextWorkflow)
    if (window.location.pathname !== nextPath) {
      window.history.pushState({ workflow: nextWorkflow }, '', nextPath)
    }
  }

  useEffect(() => {
    function applyPathWorkflow() {
      const nextWorkflow = workflowFromPath(window.location.pathname)
      setWorkflow(nextWorkflow)

      if (window.location.pathname === '/') {
        window.history.replaceState({ workflow: nextWorkflow }, '', workflowPath(nextWorkflow))
      }
    }

    applyPathWorkflow()
    window.addEventListener('popstate', applyPathWorkflow)
    return () => {
      window.removeEventListener('popstate', applyPathWorkflow)
    }
  }, [])

  useEffect(() => {
    setGameNoteDraft(selectedDrive?.notes.freeform || '')
  }, [selectedDrive?.id])

  function getCurrentState(): AppState {
    return {
      team,
      players,
      games,
      selectedGameId,
      drives,
      selectedDriveId,
      availabilityByGame,
      practices,
      practiceTemplates,
      plays,
      formations,
      playbookSeed,
      lineups,
      slotPositions,
      appSettings
    }
  }

  function applyAppState(incoming: AppState, membership = syncMembership) {
    const saved = migrateAppState(incoming)
    setTeam(saved.team)
    setPlayers(saved.players)
    setGames(saved.games)
    setSelectedGameId(saved.selectedGameId)
    setDrives(saved.drives)
    setSelectedDriveId(saved.selectedDriveId)
    setAvailabilityByGame(saved.availabilityByGame)
    setPractices(saved.practices)
    setPracticeTemplates(saved.practiceTemplates)
    setPlays(saved.plays)
    setFormations(saved.formations)
    setPlaybookSeed(saved.playbookSeed)
    setLineups(saved.lineups)
    setSlotPositions(saved.slotPositions)
    setAppSettings(membership ? appSettingsFromMembership(membership, saved.appSettings) : saved.appSettings)
  }

  async function hydrateSupabaseSession(userId: string, userEmail: string, seedState: AppState) {
    setSyncStatus('loading')
    setSyncMessage('Loading cloud data')

    const membership = await ensureSupabaseMembership(seedState, userId)
    setSyncUserId(userId)
    setSyncUserEmail(userEmail)
    setSyncTeamId(membership.teamId)
    setSyncMembership(membership)

    const snapshot = await loadSupabaseState(membership.teamId)
    if (snapshot?.state) {
      applyingRemoteStateRef.current = true
      applyAppState(snapshot.state, membership)
      window.setTimeout(() => {
        applyingRemoteStateRef.current = false
      }, 500)
    } else {
      await saveSupabaseState(membership.teamId, seedState, userId)
    }

    setSyncReady(true)
    setSyncStatus('synced')
    setSyncMessage('Cloud sync active')
  }

  useEffect(() => {
    const raw =
      window.localStorage.getItem(storageKey) ||
      legacyStorageKeys.map((key) => window.localStorage.getItem(key)).find(Boolean)
    if (raw) {
      try {
        applyAppState(JSON.parse(raw) as AppState, null)
      } catch {
        window.localStorage.removeItem(storageKey)
      }
    }
    setLoaded(true)
  }, [])

  useEffect(() => {
    if (!loaded || !isSupabaseConfigured()) {
      if (loaded) {
        setSyncStatus('local')
        setSyncMessage('Local only')
      }
      return
    }

    let canceled = false

    async function initializeSupabase() {
      try {
        const supabase = getSupabaseClient()
        const { data, error } = await supabase.auth.getSession()
        if (error) throw error

        if (!data.session?.user) {
          setSyncStatus('signed_out')
          setSyncMessage('Signed out')
          return
        }

        if (!canceled) {
          await hydrateSupabaseSession(data.session.user.id, data.session.user.email || '', getCurrentState())
        }
      } catch (error) {
        if (!canceled) {
          setSyncStatus('error')
          setSyncMessage(error instanceof Error ? error.message : 'Supabase session failed')
        }
      }
    }

    initializeSupabase()
    return () => {
      canceled = true
    }
  }, [loaded])

  useEffect(() => {
    if (!loaded) return

    const state = getCurrentState()
    window.localStorage.setItem(storageKey, JSON.stringify(state))

    if (!isSupabaseConfigured() || !syncReady || !syncTeamId || !syncUserId || applyingRemoteStateRef.current) {
      return
    }

    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
    }

    setSyncStatus('saving')
    setSyncMessage('Saving')
    saveTimerRef.current = window.setTimeout(() => {
      saveSupabaseState(syncTeamId, state, syncUserId)
        .then(() => {
          setSyncStatus('synced')
          setSyncMessage('Cloud sync active')
        })
        .catch((error) => {
          setSyncStatus('error')
          setSyncMessage(error instanceof Error ? error.message : 'Cloud save failed')
        })
    }, 700)
  }, [appSettings, availabilityByGame, drives, formations, games, lineups, loaded, players, plays, practiceTemplates, practices, playbookSeed, selectedDriveId, selectedGameId, slotPositions, team])

  useEffect(() => {
    if (!syncReady || !syncTeamId || !syncUserId) return

    const channel = subscribeToSupabaseState(syncTeamId, (row) => {
      if (row.updated_by === syncUserId) return
      applyingRemoteStateRef.current = true
      applyAppState(row.state, syncMembership)
      setSyncStatus('synced')
      setSyncMessage('Updated from cloud')
      window.setTimeout(() => {
        applyingRemoteStateRef.current = false
      }, 500)
    })

    return () => {
      getSupabaseClient().removeChannel(channel)
    }
  }, [syncMembership, syncReady, syncTeamId, syncUserId])

  /**
   * Marking a player out leaves their lineup spots alone: the field shows them in
   * red so it is obvious which positions need a replacement.
   */
  function setPlayerAvailable(playerId: string, available: boolean) {
    if (!selectedGame) return
    setAvailabilityByGame((current) => ({
      ...current,
      [selectedGame.id]: {
        ...(current[selectedGame.id] || {}),
        [playerId]: available
      }
    }))

    if (!available && selectedPlayerId === playerId) {
      setSelectedPlayerId(null)
    }
  }

  function addPlayer(name: string) {
    const firstName = name.trim()
    if (!firstName) return

    const player = createPlayer(uid('player'), firstName, team.id)

    setPlayers((items) => [...items, player])
    setAvailabilityByGame((current) =>
      games.reduce<Record<string, Record<string, boolean>>>((next, game) => {
        next[game.id] = { ...(current[game.id] || {}), [player.id]: true }
        return next
      }, { ...current })
    )
  }

  /** Removes a player from the team for good, along with every reference to them. */
  function deletePlayer(playerId: string) {
    setPlayers((items) => items.filter((player) => player.id !== playerId))

    setLineups((items) =>
      items.map((lineup) => {
        const assignments = { ...lineup.assignments }
        const backups = { ...lineup.backups }
        let changed = false
        Object.keys(assignments).forEach((slotCode) => {
          if (assignments[slotCode] === playerId) {
            assignments[slotCode] = null
            changed = true
          }
        })
        Object.keys(backups).forEach((slotCode) => {
          if (backups[slotCode] === playerId) {
            backups[slotCode] = null
            changed = true
          }
        })
        return changed ? { ...lineup, assignments, backups } : lineup
      })
    )

    setAvailabilityByGame((current) =>
      Object.keys(current).reduce<Record<string, Record<string, boolean>>>((next, gameId) => {
        const { [playerId]: removed, ...rest } = current[gameId]
        next[gameId] = rest
        return next
      }, {})
    )

    if (selectedPlayerId === playerId) setSelectedPlayerId(null)
  }

  /** Puts players back on the list. Their lineup spots were never taken away. */
  function restorePlayers(playerIds: string[]) {
    if (!selectedGame || playerIds.length === 0) return
    setAvailabilityByGame((current) => ({
      ...current,
      [selectedGame.id]: playerIds.reduce<Record<string, boolean>>(
        (next, playerId) => {
          next[playerId] = true
          return next
        },
        { ...(current[selectedGame.id] || {}) }
      )
    }))
  }

  /**
   * Starts a named game. Lineups carry over from the current game, results and
   * notes do not, and the old game stays put so it can be reopened later.
   */
  function startNewGame(name: string) {
    const game: Game = {
      id: uid('game'),
      teamId: team.id,
      name: name.trim() || `Game ${games.length + 1}`,
      date: new Date().toISOString().slice(0, 10),
      location: '',
      status: 'scheduled',
      patternLength: selectedGame?.patternLength || 3
    }

    // Lineups belong to the team, so a new game only needs fresh drives pointing at them.
    const carriedDrives = gameDrives.map((drive) => ({
      ...drive,
      id: uid('drive'),
      gameId: game.id,
      result: '' as DriveResult,
      conversion: '' as Conversion,
      notes: emptyNote(),
      status: 'planned' as const,
      startedAt: undefined,
      endedAt: undefined
    }))

    setGames((items) => [...items, game])
    setDrives((items) => [...items, ...carriedDrives])
    setAvailabilityByGame((current) => ({ ...current, [game.id]: {} }))
    setSelectedGameId(game.id)
    setSelectedDriveId(carriedDrives[0]?.id || '')
    setGameNoteDraft('')
  }

  /** Drops a saved game and everything recorded in it. The last game always stays. */
  function deleteGame(gameId: string) {
    const remaining = games.filter((game) => game.id !== gameId)
    if (remaining.length === 0) return

    setGames(remaining)
    setDrives((items) => items.filter((drive) => drive.gameId !== gameId))
    setAvailabilityByGame((current) =>
      Object.keys(current).reduce<Record<string, Record<string, boolean>>>((next, id) => {
        if (id !== gameId) next[id] = current[id]
        return next
      }, {})
    )

    if (selectedGameId === gameId) {
      const nextGame = remaining[remaining.length - 1]
      const nextDrive = drives
        .filter((drive) => drive.gameId === nextGame.id)
        .sort((a, b) => driveSortValue(a) - driveSortValue(b))[0]
      setSelectedGameId(nextGame.id)
      setSelectedDriveId(nextDrive?.id || '')
      setGameNoteDraft('')
    }
  }

  function updateSelectedLineup(update: (lineup: Lineup) => Lineup) {
    if (!selectedLineup) return
    setLineups((items) => items.map((lineup) => (lineup.id === selectedLineup.id ? update(lineup) : lineup)))
  }

  function assignPlayerToSlot(slotCode: string, playerId = selectedPlayer?.id) {
    if (!playerId) return

    updateSelectedLineup((lineup) => {
      const assignments = { ...lineup.assignments }
      // A player only holds one position, so clear wherever they were before.
      Object.keys(assignments).forEach((code) => {
        if (assignments[code] === playerId) {
          assignments[code] = null
        }
      })
      assignments[slotCode] = playerId
      return { ...lineup, assignments }
    })

    setSelectedPlayerId(null)
    setDraggingPlayerId(null)
  }

  /** The stand-in for a position if the starter goes down. */
  function setSlotBackup(slotCode: string, playerId: string | null) {
    updateSelectedLineup((lineup) => ({ ...lineup, backups: { ...lineup.backups, [slotCode]: playerId } }))
  }

  function clearSlot(slotCode: string) {
    updateSelectedLineup((lineup) => ({
      ...lineup,
      assignments: { ...lineup.assignments, [slotCode]: null },
      backups: { ...lineup.backups, [slotCode]: null }
    }))
  }

  /** Copies another lineup of the same unit onto the selected one, position for position. */
  function copyLineup(sourceLineupId: string) {
    const source = lineups.find((lineup) => lineup.id === sourceLineupId)
    if (!source || !selectedLineup || source.unit !== selectedLineup.unit) return
    updateSelectedLineup((lineup) => ({
      ...lineup,
      assignments: { ...source.assignments },
      backups: { ...source.backups }
    }))
  }

  /** Which lineup takes a given drive on gameday. */
  function setDriveLineup(driveId: string, lineupIdValue: string) {
    setDrives((items) => items.map((drive) => (drive.id === driveId ? { ...drive, lineupId: lineupIdValue } : drive)))
  }

  /** Creates or updates a play, keeping the original created date on an edit. */
  function savePlay(draft: Omit<PlaybookPlay, 'teamId' | 'createdAt' | 'updatedAt'>) {
    const now = new Date().toISOString()
    setPlays((items) => {
      const existing = items.find((play) => play.id === draft.id)
      const play: PlaybookPlay = {
        ...draft,
        teamId: team.id,
        createdAt: existing?.createdAt || now,
        updatedAt: now
      }
      return existing ? items.map((item) => (item.id === play.id ? play : item)) : [...items, play]
    })
  }

  function deletePlay(playId: string) {
    setPlays((items) => items.filter((play) => play.id !== playId))
  }

  function saveFormation(draft: Omit<Formation, 'teamId' | 'createdAt' | 'updatedAt'>) {
    const now = new Date().toISOString()
    setFormations((items) => {
      const existing = items.find((formation) => formation.id === draft.id)
      const formation: Formation = {
        ...draft,
        teamId: team.id,
        createdAt: existing?.createdAt || now,
        updatedAt: now
      }
      return existing ? items.map((item) => (item.id === formation.id ? formation : item)) : [...items, formation]
    })
  }

  /** Plays built on a deleted formation would have nothing to draw, so they go too. */
  function deleteFormation(formationId: string) {
    setFormations((items) => items.filter((formation) => formation.id !== formationId))
    setPlays((items) => items.filter((play) => play.formationId !== formationId))
  }

  function moveSlot(unit: Unit, slotCode: string, position: { x: number; y: number }) {
    setSlotPositions((current) => ({ ...current, [slotPositionKey(unit, slotCode)]: position }))
  }

  function autoFillSelectedLineup() {
    if (!selectedLineup) return
    const filled = autoFillDrive(
      { ...gameDrives[0], unit: selectedLineup.unit, assignments: selectedLineup.assignments, backups: selectedLineup.backups },
      players,
      availability,
      resolvedDrives
    )
    updateSelectedLineup((lineup) => ({ ...lineup, assignments: filled.assignments }))
  }

  function selectAdjacentDrive(direction: -1 | 1) {
    const nextDrive = gameDrives[selectedDriveIndex + direction]
    if (nextDrive) {
      setSelectedDriveId(nextDrive.id)
    }
  }

  function recordDriveResult(result: Exclude<DriveResult, ''>, advance = false) {
    if (!selectedDrive) return
    const now = new Date().toISOString()
    setDrives((items) =>
      items.map((drive) =>
        drive.id === selectedDrive.id
          ? {
              ...drive,
              result,
              status: 'completed',
              endedAt: now,
              notes: {
                ...drive.notes,
                result,
                freeform: gameNoteDraft
              }
            }
          : drive
      )
    )

    if (advance) {
      const nextDrive = gameDrives.slice(selectedDriveIndex + 1).find((drive) => drive.status !== 'completed')
      if (nextDrive) setSelectedDriveId(nextDrive.id)
    }
  }

  function setDriveConversion(conversion: Conversion) {
    if (!selectedDrive) return
    setDrives((items) => items.map((drive) => (drive.id === selectedDrive.id ? { ...drive, conversion } : drive)))
  }

  function updateDriveNote(value: string) {
    if (!selectedDrive) return
    setGameNoteDraft(value)
    setDrives((items) =>
      items.map((drive) =>
        drive.id === selectedDrive.id
          ? {
              ...drive,
              notes: {
                ...drive.notes,
                freeform: value
              }
            }
          : drive
      )
    )
  }

  async function authenticate(mode: 'sign-in' | 'sign-up') {
    if (!isSupabaseConfigured()) {
      setSyncStatus('local')
      setSyncMessage('Supabase env missing')
      return
    }

    const email = authForm.email.trim()
    if (!email || !authForm.password) {
      setSyncStatus('error')
      setSyncMessage('Email and password required')
      return
    }

    setSyncStatus('loading')
    setSyncMessage(mode === 'sign-in' ? 'Signing in' : 'Creating account')

    try {
      const supabase = getSupabaseClient()
      const result =
        mode === 'sign-in'
          ? await supabase.auth.signInWithPassword({ email, password: authForm.password })
          : await supabase.auth.signUp({ email, password: authForm.password })

      if (result.error) throw result.error
      if (!result.data.session?.user) {
        setSyncStatus('signed_out')
        setSyncMessage('Check email confirmation')
        return
      }

      await hydrateSupabaseSession(result.data.session.user.id, result.data.session.user.email || email, getCurrentState())
      setAuthForm({ email: '', password: '' })
    } catch (error) {
      setSyncStatus('error')
      setSyncMessage(error instanceof Error ? error.message : 'Auth failed')
    }
  }

  async function signOut() {
    if (isSupabaseConfigured()) {
      await getSupabaseClient().auth.signOut()
    }
    setSyncReady(false)
    setSyncUserId(null)
    setSyncUserEmail('')
    setSyncTeamId(null)
    setSyncMembership(null)
    setSyncStatus('signed_out')
    setSyncMessage('Signed out')
  }

  async function saveNow() {
    if (!syncTeamId || !syncUserId) return
    setSyncStatus('saving')
    setSyncMessage('Saving')
    try {
      await saveSupabaseState(syncTeamId, getCurrentState(), syncUserId)
      setSyncStatus('synced')
      setSyncMessage('Cloud sync active')
    } catch (error) {
      setSyncStatus('error')
      setSyncMessage(error instanceof Error ? error.message : 'Cloud save failed')
    }
  }

  async function loadNow() {
    if (!syncTeamId) return
    setSyncStatus('loading')
    setSyncMessage('Loading')
    try {
      const snapshot = await loadSupabaseState(syncTeamId)
      if (snapshot?.state) {
        applyingRemoteStateRef.current = true
        applyAppState(snapshot.state, syncMembership)
        window.setTimeout(() => {
          applyingRemoteStateRef.current = false
        }, 500)
      }
      setSyncStatus('synced')
      setSyncMessage('Cloud sync active')
    } catch (error) {
      setSyncStatus('error')
      setSyncMessage(error instanceof Error ? error.message : 'Cloud load failed')
    }
  }

  return (
    <main className="min-h-screen pb-24">
      <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-3 py-3 sm:px-5">
        <AppHeader
          teamName={team.name}
          readyCount={availablePlayers.length}
          games={games}
          selectedGameId={selectedGame?.id || ''}
          setSelectedGameId={setSelectedGameId}
          workflow={workflow}
          syncStatus={syncStatus}
          syncMessage={syncMessage}
          syncUserEmail={syncUserEmail}
          authForm={authForm}
          setAuthForm={setAuthForm}
          authenticate={authenticate}
          signOut={signOut}
          saveNow={saveNow}
          loadNow={loadNow}
          syncBusy={syncBusy}
        />

        {workflow === 'planning' ? (
          <PlanningPage
            availablePlayers={availablePlayers}
            unavailablePlayers={unavailablePlayers}
            removePlayer={(playerId) => setPlayerAvailable(playerId, false)}
            restorePlayers={restorePlayers}
            deletePlayer={deletePlayer}
            addPlayer={addPlayer}
            slotPositions={slotPositions}
            moveSlot={moveSlot}
            availability={availability}
            rosterCollapsed={rosterCollapsed}
            setRosterCollapsed={setRosterCollapsed}
            copyLineup={copyLineup}
            lineups={lineups}
            selectedLineup={selectedLineup}
            setSelectedLineupId={setSelectedLineupId}
            resolvedDrives={resolvedDrives}
            autoFillSelectedLineup={autoFillSelectedLineup}
            selectedPlayer={selectedPlayer}
            selectedPlayerId={selectedPlayerId}
            setSelectedPlayerId={setSelectedPlayerId}
            benchPlayers={benchPlayers}
            assignPlayerToSlot={assignPlayerToSlot}
            setSlotBackup={setSlotBackup}
            clearSlot={clearSlot}
            playersById={players}
            usage={usage}
            lineupWarnings={lineupWarnings}
            draggingPlayerId={draggingPlayerId}
            setDraggingPlayerId={setDraggingPlayerId}
          />
        ) : workflow === 'play-builder' ? (
          <PlayBuilderPage plays={plays} formations={formations} savePlay={savePlay} deletePlay={deletePlay} />
        ) : workflow === 'playbook' ? (
          <PlaybookPage
            plays={plays}
            formations={formations}
            savePlay={savePlay}
            deletePlay={deletePlay}
            saveFormation={saveFormation}
            deleteFormation={deleteFormation}
          />
        ) : (
          <GamedayPage
            gameDrives={gameDrives}
            selectedDrive={selectedDrive}
            selectedDriveIndex={selectedDriveIndex}
            setSelectedDriveId={setSelectedDriveId}
            selectAdjacentDrive={selectAdjacentDrive}
            nextOpenDrive={nextOpenDrive}
            players={players}
            availablePlayers={availablePlayers}
            gameSummary={gameSummary}
            gameNoteDraft={gameNoteDraft}
            updateDriveNote={updateDriveNote}
            recordDriveResult={recordDriveResult}
            setDriveConversion={setDriveConversion}
            lineups={lineups}
            setDriveLineup={setDriveLineup}
            selectedResolvedDrive={selectedResolvedDrive}
            startNewGame={startNewGame}
            deleteGame={() => selectedGame && deleteGame(selectedGame.id)}
            gameName={selectedGame?.name || ''}
            gameCount={games.length}
            slotPositions={slotPositions}
            availability={availability}
          />
        )}
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-[#d8ded5] bg-white/95 px-3 py-2 shadow-[0_-10px_30px_rgba(16,32,26,0.12)] backdrop-blur safe-bottom">
        <div className="mx-auto grid max-w-md grid-cols-4 gap-1.5">
          <BottomNavButton active={workflow === 'planning'} label="Planning" onClick={() => navigateWorkflow('planning')} />
          <BottomNavButton active={workflow === 'gameday'} label="Gameday" onClick={() => navigateWorkflow('gameday')} />
          <BottomNavButton active={workflow === 'playbook'} label="Playbook" onClick={() => navigateWorkflow('playbook')} />
          <BottomNavButton active={workflow === 'play-builder'} label="Builder" onClick={() => navigateWorkflow('play-builder')} />
        </div>
      </nav>
    </main>
  )
}

function AppHeader({
  teamName,
  readyCount,
  games,
  selectedGameId,
  setSelectedGameId,
  workflow,
  syncStatus,
  syncMessage,
  syncUserEmail,
  authForm,
  setAuthForm,
  authenticate,
  signOut,
  saveNow,
  loadNow,
  syncBusy
}: {
  teamName: string
  readyCount: number
  games: Game[]
  selectedGameId: string
  setSelectedGameId: (id: string) => void
  workflow: Workflow
  syncStatus: SyncStatus
  syncMessage: string
  syncUserEmail: string
  authForm: { email: string; password: string }
  setAuthForm: (form: { email: string; password: string }) => void
  authenticate: (mode: 'sign-in' | 'sign-up') => void
  signOut: () => void
  saveNow: () => void
  loadNow: () => void
  syncBusy: boolean
}) {
  const syncTone =
    syncStatus === 'error'
      ? 'bg-[#c2412d] text-white'
      : syncStatus === 'synced'
        ? 'bg-[#1f7a4d] text-white'
        : syncStatus === 'saving' || syncStatus === 'loading'
          ? 'bg-[#f7c948] text-[#10201a]'
          : 'bg-[#d9eef6] text-[#10201a]'

  return (
    <header className="sticky top-0 z-30 -mx-3 border-b border-[#d8ded5] bg-[#f7f5ee]/95 px-3 pb-3 pt-2 backdrop-blur sm:-mx-5 sm:px-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase text-[#53665c]">{workflow}</p>
          <h1 className="truncate font-display text-2xl font-black">{teamName}</h1>
          <div className="mt-1 flex items-center gap-2">
            <select
              value={selectedGameId}
              onChange={(event) => setSelectedGameId(event.target.value)}
              aria-label="Game"
              className="min-w-0 max-w-[190px] truncate rounded-lg border border-[#d8ded5] bg-white px-2 py-1 text-sm font-black outline-none"
            >
              {games.map((game) => (
                <option key={game.id} value={game.id}>
                  {game.name}
                </option>
              ))}
            </select>
            <span className="shrink-0 text-xs font-bold text-[#53665c]">{readyCount} here</span>
          </div>
        </div>
        <details className="shrink-0">
          <summary className={`flex cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-2 text-xs font-black uppercase ${syncTone}`}>
            <Cloud size={15} />
            {syncStatus.replace('_', ' ')}
          </summary>
          <div className="absolute right-3 mt-2 w-[min(340px,calc(100vw-1.5rem))] rounded-lg border border-[#d8ded5] bg-white p-3 text-sm shadow-xl">
            <p className="font-black">{syncUserEmail || syncMessage}</p>
            {syncUserEmail ? (
              <div className="mt-3 grid grid-cols-3 gap-2">
                <button type="button" onClick={saveNow} disabled={syncBusy} className="rounded-lg bg-[#10201a] px-3 py-2 font-black text-white disabled:opacity-40">
                  Save
                </button>
                <button type="button" onClick={loadNow} disabled={syncBusy} className="rounded-lg border border-[#d8ded5] px-3 py-2 font-black disabled:opacity-40">
                  Load
                </button>
                <button type="button" onClick={signOut} disabled={syncBusy} className="rounded-lg border border-[#d8ded5] px-3 py-2 font-black disabled:opacity-40" aria-label="Sign out">
                  <LogOut size={16} className="mx-auto" />
                </button>
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                <input
                  value={authForm.email}
                  onChange={(event) => setAuthForm({ ...authForm, email: event.target.value })}
                  className="w-full rounded-lg border border-[#d8ded5] px-3 py-2 outline-none focus:border-[#1f7a4d]"
                  placeholder="Email"
                  type="email"
                />
                <input
                  value={authForm.password}
                  onChange={(event) => setAuthForm({ ...authForm, password: event.target.value })}
                  className="w-full rounded-lg border border-[#d8ded5] px-3 py-2 outline-none focus:border-[#1f7a4d]"
                  placeholder="Password"
                  type="password"
                />
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => authenticate('sign-in')} disabled={syncBusy} className="flex items-center justify-center gap-2 rounded-lg bg-[#10201a] px-3 py-2 font-black text-white disabled:opacity-40">
                    <LogIn size={15} />
                    Sign In
                  </button>
                  <button type="button" onClick={() => authenticate('sign-up')} disabled={syncBusy} className="rounded-lg border border-[#d8ded5] px-3 py-2 font-black disabled:opacity-40">
                    Create
                  </button>
                </div>
              </div>
            )}
          </div>
        </details>
      </div>
    </header>
  )
}

function PlanningPage({
  availablePlayers,
  unavailablePlayers,
  removePlayer,
  restorePlayers,
  deletePlayer,
  addPlayer,
  slotPositions,
  moveSlot,
  availability,
  rosterCollapsed,
  setRosterCollapsed,
  copyLineup,
  lineups,
  selectedLineup,
  setSelectedLineupId,
  resolvedDrives,
  autoFillSelectedLineup,
  selectedPlayer,
  selectedPlayerId,
  setSelectedPlayerId,
  benchPlayers,
  assignPlayerToSlot,
  setSlotBackup,
  clearSlot,
  playersById,
  usage,
  lineupWarnings,
  draggingPlayerId,
  setDraggingPlayerId
}: {
  availablePlayers: Player[]
  unavailablePlayers: Player[]
  removePlayer: (playerId: string) => void
  restorePlayers: (playerIds: string[]) => void
  deletePlayer: (playerId: string) => void
  addPlayer: (name: string) => void
  slotPositions: SlotPositions
  moveSlot: (unit: Unit, slotCode: string, position: { x: number; y: number }) => void
  availability: Record<string, boolean>
  rosterCollapsed: boolean
  setRosterCollapsed: (collapsed: boolean) => void
  copyLineup: (sourceLineupId: string) => void
  lineups: Lineup[]
  selectedLineup?: Lineup
  setSelectedLineupId: (id: string) => void
  resolvedDrives: ResolvedDrive[]
  autoFillSelectedLineup: () => void
  selectedPlayer?: Player
  selectedPlayerId: string | null
  setSelectedPlayerId: (id: string | null) => void
  benchPlayers: Player[]
  assignPlayerToSlot: (slotCode: string, playerId?: string) => void
  setSlotBackup: (slotCode: string, playerId: string | null) => void
  clearSlot: (slotCode: string) => void
  playersById: Player[]
  usage: ReturnType<typeof computeUsage>
  lineupWarnings: ReturnType<typeof getDriveWarnings>
  draggingPlayerId: string | null
  setDraggingPlayerId: (id: string | null) => void
}) {
  const [addingPlayer, setAddingPlayer] = useState(false)
  const [newPlayerName, setNewPlayerName] = useState('')
  const [showAddBack, setShowAddBack] = useState(false)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [pickingSlotCode, setPickingSlotCode] = useState<string | null>(null)
  const [showCopyDrive, setShowCopyDrive] = useState(false)
  const pendingDeletePlayer = availablePlayers.find((player) => player.id === pendingDeleteId)
  const copySourceLineups = selectedLineup
    ? lineups.filter(
        (lineup) =>
          lineup.id !== selectedLineup.id &&
          lineup.unit === selectedLineup.unit &&
          Object.values(lineup.assignments).some(Boolean)
      )
    : []
  const pickingSlot = selectedLineup
    ? SLOTS_BY_UNIT[selectedLineup.unit].find((slot) => slot.code === pickingSlotCode)
    : undefined

  useEffect(() => {
    setPickingSlotCode(null)
    setShowCopyDrive(false)
  }, [selectedLineup?.id])

  useEffect(() => {
    if (unavailablePlayers.length === 0) setShowAddBack(false)
  }, [unavailablePlayers.length])

  function submitNewPlayer() {
    if (!newPlayerName.trim()) {
      setAddingPlayer(false)
      return
    }
    addPlayer(newPlayerName)
    setNewPlayerName('')
    setAddingPlayer(false)
  }

  return (
    <div className="space-y-4 py-4">
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setRosterCollapsed(!rosterCollapsed)}
            aria-expanded={!rosterCollapsed}
            className="flex min-w-0 items-center gap-2 text-left"
          >
            <ChevronDown size={20} className={`shrink-0 transition-transform ${rosterCollapsed ? '-rotate-90' : ''}`} />
            <span className="min-w-0">
              <span className="block font-display text-xl font-black">Roster</span>
              <span className="block text-sm font-bold text-[#53665c]">
                {rosterCollapsed
                  ? `${availablePlayers.length} here${unavailablePlayers.length > 0 ? ` · ${unavailablePlayers.length} out` : ''}`
                  : 'Swipe a player off if they are not here.'}
              </span>
            </span>
          </button>
          <div className="flex shrink-0 items-center gap-2">
            <div className="rounded-lg bg-[#1f7a4d] px-3 py-1 text-center text-white">
              <p className="font-display text-xl font-black leading-tight">{availablePlayers.length}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setRosterCollapsed(false)
                setAddingPlayer((current) => !current)
              }}
              aria-label="Add player"
              aria-expanded={addingPlayer}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-[#10201a] text-white"
            >
              {addingPlayer ? <X size={18} /> : <Plus size={20} />}
            </button>
          </div>
        </div>

        {!rosterCollapsed && addingPlayer && (
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <input
              autoFocus
              value={newPlayerName}
              onChange={(event) => setNewPlayerName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submitNewPlayer()
                if (event.key === 'Escape') setAddingPlayer(false)
              }}
              placeholder="First name"
              className="min-w-0 rounded-lg border border-[#d8ded5] px-3 py-3 outline-none focus:border-[#1f7a4d]"
            />
            <button type="button" onClick={submitNewPlayer} className="rounded-lg bg-[#10201a] px-4 py-3 font-black text-white">
              Add
            </button>
          </div>
        )}

        {!rosterCollapsed && (
          <>
            <div className="space-y-2">
              {availablePlayers.length === 0 && (
                <p className="rounded-lg border border-dashed border-[#d8ded5] px-3 py-6 text-center text-sm font-bold text-[#53665c]">
                  Nobody on the list yet.
                </p>
              )}
              {availablePlayers.map((player) => (
                <RosterRow
                  key={player.id}
                  player={player}
                  driveCount={usage.find((item) => item.playerId === player.id)?.totalDrives || 0}
                  onRemove={() => removePlayer(player.id)}
                  onLongPress={() => setPendingDeleteId(player.id)}
                />
              ))}
            </div>

            {unavailablePlayers.length > 0 && (
              <button
                type="button"
                onClick={() => setShowAddBack(true)}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#d8ded5] bg-white px-3 py-3 text-sm font-black"
              >
                <Undo2 size={16} />
                Add Back ({unavailablePlayers.length})
              </button>
            )}
          </>
        )}

        {showAddBack && (
          <AddBackSheet
            players={unavailablePlayers}
            restorePlayers={restorePlayers}
            onClose={() => setShowAddBack(false)}
          />
        )}

        {pendingDeletePlayer && (
          <DeletePlayerSheet
            player={pendingDeletePlayer}
            onCancel={() => setPendingDeleteId(null)}
            onConfirm={() => {
              deletePlayer(pendingDeletePlayer.id)
              setPendingDeleteId(null)
            }}
          />
        )}
      </section>

      <section className="space-y-3 border-t border-[#d8ded5] pt-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-black">Lineups</h2>
            <p className="text-sm font-bold text-[#53665c]">Four each way. Drives cycle through them.</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setShowCopyDrive(true)}
              disabled={copySourceLineups.length === 0}
              className="flex items-center gap-2 rounded-lg border border-[#d8ded5] bg-white px-3 py-2 text-sm font-black disabled:opacity-40"
            >
              <Copy size={15} />
              Copy
            </button>
            <button type="button" onClick={autoFillSelectedLineup} disabled={!selectedLineup} className="flex items-center gap-2 rounded-lg bg-[#f7c948] px-3 py-2 text-sm font-black text-[#10201a] disabled:opacity-40">
              <Save size={15} />
              Fill
            </button>
          </div>
        </div>

        <LineupScroller lineups={lineups} selectedLineupId={selectedLineup?.id || ''} onSelect={setSelectedLineupId} />

        {selectedLineup && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-2">
              <p className="font-black">{lineupLabel(selectedLineup)}</p>
              <p className="text-sm font-bold text-[#53665c]">
                {Object.values(selectedLineup.assignments).filter(Boolean).length}/7 assigned
              </p>
            </div>
            {lineupWarnings.length > 0 && (
              <div className="mt-2 rounded-lg bg-[#f7c948] px-3 py-2 text-sm font-black text-[#10201a]">
                {lineupWarnings.map((warning) => warning.message).join(' · ')}
              </div>
            )}
            <FormationBoard
              lineup={selectedLineup}
              players={playersById}
              selectedPlayer={selectedPlayer}
              assignPlayerToSlot={assignPlayerToSlot}
              clearSlot={clearSlot}
              draggingPlayerId={draggingPlayerId}
              slotPositions={slotPositions}
              availability={availability}
              moveSlot={moveSlot}
              onPickSlot={setPickingSlotCode}
              interactive
            />
            {showCopyDrive && (
              <CopyLineupSheet
                lineups={copySourceLineups}
                players={playersById}
                target={selectedLineup}
                onCopy={(id) => {
                  copyLineup(id)
                  setShowCopyDrive(false)
                }}
                onClose={() => setShowCopyDrive(false)}
              />
            )}
            {pickingSlot && (
              <SlotPickerSheet
                slot={pickingSlot}
                lineup={selectedLineup}
                players={availablePlayers}
                onAssign={(playerId) => {
                  assignPlayerToSlot(pickingSlot.code, playerId)
                  setPickingSlotCode(null)
                }}
                onSetBackup={(playerId) => setSlotBackup(pickingSlot.code, playerId)}
                onClear={() => {
                  clearSlot(pickingSlot.code)
                  setPickingSlotCode(null)
                }}
                onClose={() => setPickingSlotCode(null)}
              />
            )}
            <BenchPicker
              benchPlayers={benchPlayers}
              selectedPlayerId={selectedPlayerId}
              setSelectedPlayerId={setSelectedPlayerId}
              setDraggingPlayerId={setDraggingPlayerId}
            />
          </>
        )}
      </section>

      <PlayingTimeTable players={availablePlayers.concat(unavailablePlayers)} drives={resolvedDrives} availability={availability} />
    </div>
  )
}

function FilterChips<T extends string>({
  options,
  value,
  onChange
}: {
  options: Array<{ value: T; label: string }>
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`shrink-0 rounded-full border px-3 py-1 text-xs font-black uppercase ${
            value === option.value ? 'border-[#10201a] bg-[#10201a] text-white' : 'border-[#d8ded5] bg-white text-[#53665c]'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function PlayBuilderPage({
  plays,
  formations,
  savePlay,
  deletePlay
}: {
  plays: PlaybookPlay[]
  formations: Formation[]
  savePlay: (play: Omit<PlaybookPlay, 'teamId' | 'createdAt' | 'updatedAt'>) => void
  deletePlay: (playId: string) => void
}) {
  const [playId, setPlayId] = useState<string | null>(null)
  const [formationId, setFormationId] = useState<string | null>(null)
  const [steps, setSteps] = useState<PlayStep[]>([])
  const [name, setName] = useState('')
  const [nameEdited, setNameEdited] = useState(false)
  const [notes, setNotes] = useState('')
  const [group, setGroup] = useState<ComponentGroup>('backfield')

  const formation = formations.find((item) => item.id === formationId)
  const call = playCallFromSteps(steps)
  const { type, area } = classifySteps(steps)
  // Anything the builder can say, whether it was written here or drawn earlier.
  const builtPlays = plays.filter((play) => (play.steps && play.steps.length > 0) || parsePlayCall(play.name))
  const incomplete = steps.some((step) => !stepIsComplete(step))
  const displayName = nameEdited ? name : call

  function reset() {
    setPlayId(null)
    setFormationId(null)
    setSteps([])
    setName('')
    setNameEdited(false)
    setNotes('')
    setGroup('backfield')
  }

  function addStep(componentId: string, receiver?: string) {
    setSteps((current) => [...current, { id: uid('step'), componentId, receivers: receiver ? [receiver] : undefined }])
  }

  /** Tapping a number adds them to the call; tapping again takes them back out. */
  function toggleReceiver(step: PlayStep, code: string) {
    const current = step.receivers || []
    const receivers = current.includes(code) ? current.filter((item) => item !== code) : [...current, code]
    updateStep(step.id, { receivers })
  }

  function updateStep(stepId: string, patch: Partial<PlayStep>) {
    setSteps((current) => current.map((step) => (step.id === stepId ? { ...step, ...patch } : step)))
  }

  function removeStep(stepId: string) {
    setSteps((current) => current.filter((step) => step.id !== stepId))
  }

  function openPlay(play: PlaybookPlay) {
    const opened = play.steps && play.steps.length > 0 ? play.steps : parsePlayCall(play.name) || []
    setPlayId(play.id)
    setFormationId(play.formationId)
    setSteps(opened)
    setName(play.name)
    setNameEdited(play.name !== playCallFromSteps(opened))
    setNotes(play.notes)
    setGroup('backfield')
    window.scrollTo({ top: 0 })
  }

  function save() {
    if (!formationId || steps.length === 0) return
    savePlay({
      id: playId || uid('play'),
      name: (displayName || 'Untitled play').trim(),
      formationId,
      type,
      area,
      notes,
      routes: [],
      footballs: [],
      steps
    })
    reset()
  }

  // --- Step one: which formation are we in?
  if (!formation) {
    return (
      <div className="space-y-4 py-4">
        <div>
          <h2 className="font-display text-xl font-black">Play Builder</h2>
          <p className="text-sm font-bold text-[#53665c]">Start with a formation, then stack up the call.</p>
        </div>

        {formations.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[#d8ded5] px-3 py-6 text-center text-sm font-bold text-[#53665c]">
            Build a formation in the playbook first.
          </p>
        ) : (
          <div className="space-y-2">
            {formations.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setFormationId(item.id)}
                className="w-full rounded-lg border border-[#d8ded5] bg-white p-3 text-left"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-black">{item.name}</span>
                  <span className="text-xs font-black uppercase text-[#53665c]">
                    {countPlaysByFormation(plays, item.id)} plays
                  </span>
                </div>
                <div className="mt-2">
                  <PlaybookField positions={item.positions} compact />
                </div>
              </button>
            ))}
          </div>
        )}

        {builtPlays.length > 0 && <BuiltPlayList plays={builtPlays} formations={formations} onOpen={openPlay} />}
      </div>
    )
  }

  // --- Step two: stack up the components.
  return (
    <div className="space-y-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-xl font-black">{formation.name}</h2>
          <p className="text-sm font-bold text-[#53665c]">{playId ? 'Editing a saved play' : 'New play'}</p>
        </div>
        <button
          type="button"
          onClick={reset}
          className="shrink-0 rounded-lg border border-[#d8ded5] px-3 py-2 text-sm font-black"
        >
          Change
        </button>
      </div>

      <PlaybookField positions={formation.positions} compact />

      <section className="rounded-lg border border-[#d8ded5] bg-white p-3">
        <p className="text-xs font-black uppercase tracking-wide text-[#53665c]">The call</p>
        <p className="mt-1 font-display text-lg font-black leading-tight">
          {call || <span className="text-[#9aa79f]">Pick your first component below</span>}
        </p>

        {steps.length > 0 && (
          <ul className="mt-3 space-y-2">
            {steps.map((step, index) => {
              const component = findComponent(step.componentId)
              if (!component) return null
              return (
                <li key={step.id} className="rounded-lg bg-[#f7f5ee] px-2 py-2">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#10201a] text-xs font-black text-white">
                      {index + 1}
                    </span>
                    <span className="flex-1 truncate text-sm font-black">
                      {stepLabel(step) || component.label}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeStep(step.id)}
                      aria-label={`Remove ${component.label}`}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#53665c]"
                    >
                      <X size={16} />
                    </button>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-8">
                    <StepToggle
                      active={Boolean(step.fake)}
                      label="Fake"
                      onClick={() => updateStep(step.id, { fake: !step.fake })}
                    />
                    {component.hasDirection && (
                      <>
                        <StepToggle
                          active={step.direction === 'left'}
                          label="Left"
                          onClick={() =>
                            updateStep(step.id, { direction: step.direction === 'left' ? undefined : 'left' })
                          }
                        />
                        <StepToggle
                          active={step.direction === 'right'}
                          label="Right"
                          onClick={() =>
                            updateStep(step.id, { direction: step.direction === 'right' ? undefined : 'right' })
                          }
                        />
                      </>
                    )}
                    {component.needsReceiver && (
                      <>
                        <span className="pl-1 text-xs font-black uppercase text-[#53665c]">Who</span>
                        {RECEIVER_CODES.map((code) => (
                          <StepToggle
                            key={code}
                            active={(step.receivers || []).includes(code)}
                            label={code}
                            onClick={() => toggleReceiver(step, code)}
                          />
                        ))}
                      </>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <div className="-mx-4 overflow-x-auto px-4">
          <div className="flex w-max gap-2">
            {COMPONENT_GROUPS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setGroup(item.id)}
                className={`shrink-0 rounded-full px-3 py-2 text-xs font-black uppercase ${
                  group === item.id ? 'bg-[#10201a] text-white' : 'bg-[#f7f5ee] text-[#53665c]'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            {componentsInGroup(group)
              .filter((component) => !component.needsReceiver)
              .map((component) => (
                <button
                  key={component.id}
                  type="button"
                  onClick={() => addStep(component.id)}
                  className="rounded-lg border border-[#d8ded5] bg-white px-3 py-3 text-sm font-black"
                >
                  {component.label}
                </button>
              ))}
          </div>

          {componentsInGroup(group)
            .filter((component) => component.needsReceiver)
            .map((component) => (
              <div
                key={component.id}
                className="flex items-center gap-2 rounded-lg border border-[#d8ded5] bg-white px-3 py-2"
              >
                <span className="flex-1 truncate text-sm font-black">{component.label}</span>
                {RECEIVER_CODES.map((code) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => addStep(component.id, code)}
                    aria-label={`${code} ${component.label}`}
                    className="h-9 w-9 rounded-full bg-[#f7f5ee] text-sm font-black text-[#10201a]"
                  >
                    {code}
                  </button>
                ))}
              </div>
            ))}
        </div>
      </section>

      <section className="space-y-2 rounded-lg border border-[#d8ded5] bg-white p-3">
        <label className="block">
          <span className="text-xs font-black uppercase tracking-wide text-[#53665c]">Save it as</span>
          <input
            value={displayName}
            onChange={(event) => {
              setName(event.target.value)
              setNameEdited(true)
            }}
            placeholder="Play name"
            aria-label="Play name"
            className="mt-1 w-full rounded-lg border border-[#d8ded5] px-3 py-3 font-black outline-none focus:border-[#1f7a4d]"
          />
        </label>
        {nameEdited && call && (
          <button
            type="button"
            onClick={() => {
              setNameEdited(false)
              setName('')
            }}
            className="text-xs font-black uppercase text-[#1f7a4d]"
          >
            Use the call
          </button>
        )}

        <label className="block">
          <span className="text-xs font-black uppercase tracking-wide text-[#53665c]">Notes</span>
          <input
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="When to call it"
            aria-label="Play notes"
            className="mt-1 w-full rounded-lg border border-[#d8ded5] px-3 py-3 outline-none focus:border-[#1f7a4d]"
          />
        </label>

        <p className="text-xs font-black uppercase text-[#53665c]">
          Files as {type} · {area}
          {incomplete && <span className="text-[#b4402f]"> · a step still needs a receiver</span>}
        </p>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={save}
            disabled={steps.length === 0 || incomplete}
            className="flex-1 rounded-lg bg-[#10201a] px-3 py-3 font-black text-white disabled:opacity-40"
          >
            {playId ? 'Save changes' : 'Save play'}
          </button>
          {playId && (
            <button
              type="button"
              onClick={() => {
                deletePlay(playId)
                reset()
              }}
              className="rounded-lg border border-[#b4402f] px-3 py-3 font-black text-[#b4402f]"
            >
              Delete
            </button>
          )}
        </div>
      </section>

      {builtPlays.length > 0 && <BuiltPlayList plays={builtPlays} formations={formations} onOpen={openPlay} />}
    </div>
  )
}

function StepToggle({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-2.5 py-1 text-xs font-black ${
        active ? 'bg-[#1f7a4d] text-white' : 'bg-white text-[#53665c] ring-1 ring-[#d8ded5]'
      }`}
    >
      {label}
    </button>
  )
}

/** Every play written in the builder, so a call can be picked back up and edited. */
function BuiltPlayList({
  plays,
  formations,
  onOpen
}: {
  plays: PlaybookPlay[]
  formations: Formation[]
  onOpen: (play: PlaybookPlay) => void
}) {
  const [search, setSearch] = useState('')
  const term = search.trim().toLowerCase()
  const visible = plays.filter((play) => !term || play.name.toLowerCase().includes(term))

  return (
    <section className="space-y-2">
      <h3 className="font-display text-lg font-black">
        Every play <span className="text-sm font-black text-[#53665c]">({plays.length})</span>
      </h3>
      <input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search plays"
        aria-label="Search every play"
        className="w-full rounded-lg border border-[#d8ded5] px-3 py-3 outline-none focus:border-[#1f7a4d]"
      />
      {visible.length === 0 && (
        <p className="rounded-lg border border-dashed border-[#d8ded5] px-3 py-6 text-center text-sm font-bold text-[#53665c]">
          No plays match that.
        </p>
      )}
      {visible.map((play) => (
        <button
          key={play.id}
          type="button"
          onClick={() => onOpen(play)}
          className="w-full rounded-lg border border-[#d8ded5] bg-white px-3 py-3 text-left"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-black">{play.name}</span>
            <span className="shrink-0 rounded-full bg-[#f7f5ee] px-2 py-1 text-xs font-black uppercase text-[#53665c]">
              {play.type}
            </span>
          </div>
          <p className="mt-1 text-sm font-bold text-[#53665c]">{playCallFromSteps(play.steps || [])}</p>
          <p className="mt-1 text-xs font-black uppercase text-[#53665c]">
            {formations.find((item) => item.id === play.formationId)?.name || 'No formation'} · {play.area}
          </p>
        </button>
      ))}
    </section>
  )
}

function PlaybookPage({
  plays,
  formations,
  savePlay,
  deletePlay,
  saveFormation,
  deleteFormation
}: {
  plays: PlaybookPlay[]
  formations: Formation[]
  savePlay: (play: Omit<PlaybookPlay, 'teamId' | 'createdAt' | 'updatedAt'>) => void
  deletePlay: (playId: string) => void
  saveFormation: (formation: Omit<Formation, 'teamId' | 'createdAt' | 'updatedAt'>) => void
  deleteFormation: (formationId: string) => void
}) {
  const [tab, setTab] = useState<'plays' | 'formations'>('plays')
  const [filters, setFilters] = useState<PlayFilters>(emptyPlayFilters)
  const [editingPlay, setEditingPlay] = useState<PlaybookPlay | 'new' | null>(null)
  const [editingFormation, setEditingFormation] = useState<Formation | 'new' | null>(null)
  const [openPlayId, setOpenPlayId] = useState<string | null>(null)

  const visiblePlays = filterPlays(plays, formations, filters)
  const openPlay = plays.find((play) => play.id === openPlayId)

  return (
    <div className="space-y-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-xl font-black">Playbook</h2>
          <p className="text-sm font-bold text-[#53665c]">
            {plays.length} play{plays.length === 1 ? '' : 's'} · {formations.length} formation
            {formations.length === 1 ? '' : 's'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => (tab === 'plays' ? setEditingPlay('new') : setEditingFormation('new'))}
          disabled={tab === 'plays' && formations.length === 0}
          aria-label={tab === 'plays' ? 'New play' : 'New formation'}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#10201a] text-white disabled:opacity-40"
        >
          <Plus size={20} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setTab('plays')}
          className={`rounded-lg px-3 py-2 text-sm font-black ${tab === 'plays' ? 'bg-[#10201a] text-white' : 'bg-[#f7f5ee] text-[#53665c]'}`}
        >
          Plays
        </button>
        <button
          type="button"
          onClick={() => setTab('formations')}
          className={`rounded-lg px-3 py-2 text-sm font-black ${
            tab === 'formations' ? 'bg-[#10201a] text-white' : 'bg-[#f7f5ee] text-[#53665c]'
          }`}
        >
          Formations
        </button>
      </div>

      {tab === 'plays' ? (
        <section className="space-y-3">
          <input
            value={filters.search}
            onChange={(event) => setFilters({ ...filters, search: event.target.value })}
            placeholder="Search plays"
            aria-label="Search plays"
            className="w-full rounded-lg border border-[#d8ded5] px-3 py-3 outline-none focus:border-[#1f7a4d]"
          />

          <FilterChips
            value={filters.type}
            onChange={(type) => setFilters({ ...filters, type })}
            options={[
              { value: 'all', label: 'All' },
              ...PLAY_TYPES.map((type) => ({ value: type, label: type }))
            ]}
          />
          <FilterChips
            value={filters.area}
            onChange={(area) => setFilters({ ...filters, area })}
            options={[
              { value: 'all', label: 'Any area' },
              ...PLAY_AREAS.map((area) => ({ value: area, label: area }))
            ]}
          />
          <FilterChips
            value={filters.formationId}
            onChange={(formationId) => setFilters({ ...filters, formationId })}
            options={[
              { value: 'all', label: 'Any formation' },
              ...formations.map((formation) => ({ value: formation.id, label: formation.name }))
            ]}
          />

          {formations.length === 0 && (
            <p className="rounded-lg border border-dashed border-[#d8ded5] px-3 py-6 text-center text-sm font-bold text-[#53665c]">
              Build a formation first, then plays can be drawn from it.
            </p>
          )}

          <div className="space-y-2">
            {formations.length > 0 && visiblePlays.length === 0 && (
              <p className="rounded-lg border border-dashed border-[#d8ded5] px-3 py-6 text-center text-sm font-bold text-[#53665c]">
                {plays.length === 0 ? 'No plays yet.' : 'No plays match those filters.'}
              </p>
            )}
            {visiblePlays.map((play) => {
              const formation = formations.find((item) => item.id === play.formationId)
              return (
                <button
                  key={play.id}
                  type="button"
                  onClick={() => setOpenPlayId(play.id)}
                  className="w-full rounded-lg border border-[#d8ded5] bg-white px-3 py-3 text-left"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-black">{play.name}</span>
                    <span className="shrink-0 rounded-full bg-[#f7f5ee] px-2 py-1 text-xs font-black uppercase text-[#53665c]">
                      {play.type}
                    </span>
                  </div>
                  <p className="mt-1 text-xs font-black uppercase text-[#53665c]">
                    {formation?.name || 'No formation'} · {play.area}
                  </p>
                  {play.notes && <p className="mt-1 truncate text-sm font-bold text-[#53665c]">{play.notes}</p>}
                </button>
              )
            })}
          </div>
        </section>
      ) : (
        <section className="space-y-2">
          {formations.length === 0 && (
            <p className="rounded-lg border border-dashed border-[#d8ded5] px-3 py-6 text-center text-sm font-bold text-[#53665c]">
              No formations yet. Tap + to place the positions.
            </p>
          )}
          {formations.map((formation) => (
            <div key={formation.id} className="rounded-lg border border-[#d8ded5] bg-white p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-black">{formation.name}</p>
                  <p className="text-xs font-bold text-[#53665c]">
                    {countPlaysByFormation(plays, formation.id)} play
                    {countPlaysByFormation(plays, formation.id) === 1 ? '' : 's'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingFormation(formation)}
                  className="shrink-0 rounded-lg border border-[#d8ded5] px-3 py-2 text-sm font-black"
                >
                  Edit
                </button>
              </div>
              <div className="mt-2">
                <PlaybookField positions={formation.positions} compact />
              </div>
            </div>
          ))}
        </section>
      )}

      {editingPlay && (
        <PlayEditorSheet
          play={editingPlay === 'new' ? undefined : editingPlay}
          formations={formations}
          onSave={(play) => {
            savePlay(play)
            setEditingPlay(null)
          }}
          onDelete={
            editingPlay === 'new'
              ? undefined
              : () => {
                  deletePlay(editingPlay.id)
                  setEditingPlay(null)
                  setOpenPlayId(null)
                }
          }
          onClose={() => setEditingPlay(null)}
        />
      )}

      {editingFormation && (
        <FormationEditorSheet
          formation={editingFormation === 'new' ? undefined : editingFormation}
          playCount={editingFormation === 'new' ? 0 : countPlaysByFormation(plays, editingFormation.id)}
          onSave={(formation) => {
            saveFormation(formation)
            setEditingFormation(null)
          }}
          onDelete={
            editingFormation === 'new'
              ? undefined
              : () => {
                  deleteFormation(editingFormation.id)
                  setEditingFormation(null)
                }
          }
          onClose={() => setEditingFormation(null)}
        />
      )}

      {openPlay && (
        <PlayDetailSheet
          play={openPlay}
          formation={formations.find((item) => item.id === openPlay.formationId)}
          onEdit={() => {
            setEditingPlay(openPlay)
            setOpenPlayId(null)
          }}
          onClose={() => setOpenPlayId(null)}
        />
      )}
    </div>
  )
}

function PlayDetailSheet({
  play,
  formation,
  onEdit,
  onClose
}: {
  play: PlaybookPlay
  formation?: Formation
  onEdit: () => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-3 pb-3 sm:items-center">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border border-[#d8ded5] bg-white p-3 shadow-xl safe-bottom">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display text-xl font-black">{play.name}</h3>
            <p className="text-xs font-black uppercase text-[#53665c]">
              {formation?.name || 'No formation'} · {play.type} · {play.area}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#d8ded5]"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-3">
          <PlaybookField
            positions={formation?.positions || {}}
            routes={play.routes}
            footballs={play.footballs}
            fullscreenOnLandscape
          />
        </div>

        {play.notes && <p className="mt-3 whitespace-pre-wrap text-sm font-bold text-[#53665c]">{play.notes}</p>}

        <button type="button" onClick={onEdit} className="mt-3 w-full rounded-lg bg-[#10201a] px-3 py-3 font-black text-white">
          Edit Play
        </button>
      </div>
    </div>
  )
}

function PlayEditorSheet({
  play,
  formations,
  onSave,
  onDelete,
  onClose
}: {
  play?: PlaybookPlay
  formations: Formation[]
  onSave: (play: Omit<PlaybookPlay, 'teamId' | 'createdAt' | 'updatedAt'>) => void
  onDelete?: () => void
  onClose: () => void
}) {
  const [name, setName] = useState(play?.name || '')
  const [formationId, setFormationId] = useState(play?.formationId || formations[0]?.id || '')
  const [type, setType] = useState<PlayType>(play?.type || 'pass')
  const [area, setArea] = useState<PlayArea>(play?.area || 'middle')
  const [notes, setNotes] = useState(play?.notes || '')
  const [routes, setRoutes] = useState<PlayRoute[]>(play?.routes || [])
  const [footballs, setFootballs] = useState<PlayFootball[]>(play?.footballs || [])

  const formation = formations.find((item) => item.id === formationId)

  function submit() {
    if (!name.trim() || !formationId) return
    onSave({
      id: play?.id || uid('play'),
      name: name.trim(),
      formationId,
      type,
      area,
      notes: notes.trim(),
      routes,
      footballs
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-3 pb-3 sm:items-center">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border border-[#d8ded5] bg-white p-3 shadow-xl safe-bottom">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-display text-xl font-black">{play ? 'Edit Play' : 'New Play'}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#d8ded5]"
          >
            <X size={18} />
          </button>
        </div>

        <input
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Play name"
          aria-label="Play name"
          className="mt-3 w-full rounded-lg border border-[#d8ded5] px-3 py-3 outline-none focus:border-[#1f7a4d]"
        />

        <p className="mt-3 text-xs font-black uppercase text-[#53665c]">Formation</p>
        <select
          value={formationId}
          onChange={(event) => setFormationId(event.target.value)}
          aria-label="Formation"
          className="mt-1 w-full rounded-lg border border-[#d8ded5] bg-white px-3 py-3 font-black outline-none"
        >
          {formations.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>

        <p className="mt-3 text-xs font-black uppercase text-[#53665c]">Draw the play</p>
        <p className="text-xs font-bold text-[#53665c]">
          Drag to draw a route · hold for a handoff · double tap a line for a pass
        </p>
        <div className="mt-1">
          <PlaybookField
            positions={formation?.positions || {}}
            routes={routes}
            footballs={footballs}
            onRoutesChange={setRoutes}
            onFootballsChange={setFootballs}
            fullscreenOnLandscape
          />
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => setRoutes(routes.slice(0, -1))}
            disabled={routes.length === 0}
            className="rounded-lg border border-[#d8ded5] px-2 py-2 text-sm font-black disabled:opacity-40"
          >
            Undo Line
          </button>
          <button
            type="button"
            onClick={() => setFootballs(footballs.slice(0, -1))}
            disabled={footballs.length === 0}
            className="rounded-lg border border-[#d8ded5] px-2 py-2 text-sm font-black disabled:opacity-40"
          >
            Undo Ball
          </button>
          <button
            type="button"
            onClick={() => {
              setRoutes([])
              setFootballs([])
            }}
            disabled={routes.length === 0 && footballs.length === 0}
            className="rounded-lg border border-[#d8ded5] px-2 py-2 text-sm font-black disabled:opacity-40"
          >
            Clear
          </button>
        </div>

        <p className="mt-3 text-xs font-black uppercase text-[#53665c]">Pass or run</p>
        <div className="mt-1 grid grid-cols-2 gap-2">
          {PLAY_TYPES.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setType(option)}
              className={`rounded-lg border px-3 py-3 font-black capitalize ${
                type === option ? 'border-[#10201a] bg-[#f7c948]' : 'border-[#d8ded5] bg-white'
              }`}
            >
              {option}
            </button>
          ))}
        </div>

        <p className="mt-3 text-xs font-black uppercase text-[#53665c]">Area of attack</p>
        <div className="mt-1 grid grid-cols-3 gap-2">
          {PLAY_AREAS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setArea(option)}
              className={`rounded-lg border px-2 py-3 text-sm font-black capitalize ${
                area === option ? 'border-[#10201a] bg-[#f7c948]' : 'border-[#d8ded5] bg-white'
              }`}
            >
              {option}
            </button>
          ))}
        </div>

        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={3}
          placeholder="Routes, reads, when to call it"
          aria-label="Play notes"
          className="mt-3 w-full rounded-lg border border-[#d8ded5] px-3 py-3 text-sm outline-none focus:border-[#1f7a4d]"
        />

        <button
          type="button"
          onClick={submit}
          disabled={!name.trim() || !formationId}
          className="mt-3 w-full rounded-lg bg-[#10201a] px-3 py-3 font-black text-white disabled:opacity-40"
        >
          Save Play
        </button>
        {onDelete && (
          <button type="button" onClick={onDelete} className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-black text-[#c2412d]">
            <Trash2 size={15} />
            Delete Play
          </button>
        )}
      </div>
    </div>
  )
}

function FormationEditorSheet({
  formation,
  playCount,
  onSave,
  onDelete,
  onClose
}: {
  formation?: Formation
  playCount: number
  onSave: (formation: Omit<Formation, 'teamId' | 'createdAt' | 'updatedAt'>) => void
  onDelete?: () => void
  onClose: () => void
}) {
  const [name, setName] = useState(formation?.name || '')
  const [positions, setPositions] = useState<SlotPositions>(
    formation ? { ...defaultFormationPositions(), ...formation.positions } : defaultFormationPositions()
  )
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-3 pb-3 sm:items-center">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border border-[#d8ded5] bg-white p-3 shadow-xl safe-bottom">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display text-xl font-black">{formation ? 'Edit Formation' : 'New Formation'}</h3>
            <p className="text-sm font-bold text-[#53665c]">Drag the circles to place your positions.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#d8ded5]"
          >
            <X size={18} />
          </button>
        </div>

        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Formation name"
          aria-label="Formation name"
          className="mt-3 w-full rounded-lg border border-[#d8ded5] px-3 py-3 outline-none focus:border-[#1f7a4d]"
        />

        <div className="mt-3">
          <PlaybookField
            positions={positions}
            onMovePosition={(slotCode, position) => setPositions((current) => ({ ...current, [slotCode]: position }))}
            fullscreenOnLandscape
          />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setPositions(defaultFormationPositions())}
            className="rounded-lg border border-[#d8ded5] px-3 py-3 font-black"
          >
            Reset Spots
          </button>
          <button
            type="button"
            onClick={() => onSave({ id: formation?.id || uid('formation'), name: name.trim() || 'Formation', positions })}
            className="rounded-lg bg-[#10201a] px-3 py-3 font-black text-white"
          >
            Save Formation
          </button>
        </div>

        {onDelete && (
          <div className="mt-2">
            {confirmingDelete ? (
              <div className="rounded-lg border border-[#c2412d] p-3">
                <p className="text-sm font-bold text-[#53665c]">
                  Deleting this formation also deletes its {playCount} play{playCount === 1 ? '' : 's'}.
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(false)}
                    className="rounded-lg border border-[#d8ded5] px-3 py-2 font-black"
                  >
                    Cancel
                  </button>
                  <button type="button" onClick={onDelete} className="rounded-lg bg-[#c2412d] px-3 py-2 font-black text-white">
                    Delete
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-black text-[#c2412d]"
              >
                <Trash2 size={15} />
                Delete Formation
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function GamedayPage({
  gameDrives,
  selectedDrive,
  selectedDriveIndex,
  setSelectedDriveId,
  selectAdjacentDrive,
  nextOpenDrive,
  players,
  availablePlayers,
  gameSummary,
  gameNoteDraft,
  updateDriveNote,
  recordDriveResult,
  setDriveConversion,
  lineups,
  setDriveLineup,
  selectedResolvedDrive,
  startNewGame,
  deleteGame,
  gameName,
  gameCount,
  slotPositions,
  availability
}: {
  gameDrives: Drive[]
  selectedDrive?: Drive
  selectedDriveIndex: number
  setSelectedDriveId: (id: string) => void
  selectAdjacentDrive: (direction: -1 | 1) => void
  nextOpenDrive?: Drive
  players: Player[]
  availablePlayers: Player[]
  gameSummary: ReturnType<typeof getGameSummary>
  gameNoteDraft: string
  updateDriveNote: (value: string) => void
  recordDriveResult: (result: Exclude<DriveResult, ''>, advance?: boolean) => void
  setDriveConversion: (conversion: Conversion) => void
  lineups: Lineup[]
  setDriveLineup: (driveId: string, lineupId: string) => void
  selectedResolvedDrive?: ResolvedDrive
  startNewGame: (name: string) => void
  deleteGame: () => void
  gameName: string
  gameCount: number
  slotPositions: SlotPositions
  availability: Record<string, boolean>
}) {
  const [namingGame, setNamingGame] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  return (
    <div className="space-y-4 py-4">
      <section className="rounded-lg border border-[#d8ded5] bg-[#10201a] p-4 text-white shadow-sm">
        <p className="truncate text-xs font-black uppercase text-[#f7c948]">{gameName || 'Gameday'}</p>
        <div className="mt-1 flex items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-3xl font-black">{selectedDrive ? driveLabel(selectedDrive) : 'No Drive'}</h2>
            <p className="text-sm font-bold text-white/70">
              {gameSummary.completedDrives}/{gameDrives.length} complete · {availablePlayers.length} here
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs font-black uppercase text-[#f7c948]">Score</p>
            <p className="font-display text-3xl font-black">{gameSummary.teamScore}-{gameSummary.opponentScore}</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {nextOpenDrive && (
            <button
              type="button"
              onClick={() => setSelectedDriveId(nextOpenDrive.id)}
              className="rounded-lg bg-white/10 px-3 py-2 text-sm font-black text-white ring-1 ring-white/20"
            >
              Jump to next open: {driveLabel(nextOpenDrive)}
            </button>
          )}
          <button
            type="button"
            onClick={() => setNamingGame(true)}
            className="flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-sm font-black text-white ring-1 ring-white/20"
          >
            <RotateCcw size={15} />
            New Game
          </button>
        </div>
        <p className="mt-2 text-xs font-bold text-white/60">New Game starts a fresh scoresheet and carries your lineups over.</p>
      </section>

      {namingGame && (
        <NewGameSheet
          defaultName={`Game ${gameCount + 1}`}
          onCreate={(name) => {
            startNewGame(name)
            setNamingGame(false)
          }}
          onClose={() => setNamingGame(false)}
        />
      )}

      <section className="rounded-lg border border-[#d8ded5] bg-white p-3 shadow-sm">
        <div className="grid grid-cols-[44px_1fr_44px] items-center gap-2">
          <button type="button" onClick={() => selectAdjacentDrive(-1)} disabled={selectedDriveIndex === 0} className="h-11 rounded-lg border border-[#d8ded5] disabled:opacity-30" aria-label="Previous drive">
            <ChevronLeft className="mx-auto" size={20} />
          </button>
          <DriveScroller drives={gameDrives} selectedDriveId={selectedDrive?.id || ''} setSelectedDriveId={setSelectedDriveId} compact />
          <button type="button" onClick={() => selectAdjacentDrive(1)} disabled={selectedDriveIndex >= gameDrives.length - 1} className="h-11 rounded-lg border border-[#d8ded5] disabled:opacity-30" aria-label="Next drive">
            <ChevronRight className="mx-auto" size={20} />
          </button>
        </div>

        {selectedDrive && selectedResolvedDrive && (
          <>
            <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-1">
              <span className="shrink-0 text-xs font-black uppercase text-[#53665c]">Lineup</span>
              {getLineupsForUnit(lineups, selectedDrive.unit).map((lineup) => (
                <button
                  key={lineup.id}
                  type="button"
                  onClick={() => setDriveLineup(selectedDrive.id, lineup.id)}
                  className={`shrink-0 rounded-lg border px-3 py-1 text-sm font-black ${
                    findLineup(lineups, selectedDrive)?.id === lineup.id
                      ? 'border-[#10201a] bg-[#f7c948]'
                      : 'border-[#d8ded5] bg-white'
                  }`}
                >
                  {lineupLabel(lineup)}
                </button>
              ))}
            </div>
            <FormationBoard
              lineup={selectedResolvedDrive}
              players={players}
              slotPositions={slotPositions}
              availability={availability}
              compact
            />
          </>
        )}
      </section>

      {selectedDrive && (
        <section className="rounded-lg border border-[#d8ded5] bg-white p-3 shadow-sm">
          <h2 className="font-display text-xl font-black">Drive Result</h2>
          <p className="text-sm font-bold text-[#53665c]">{selectedDrive.result ? `${selectedDrive.result} recorded` : 'No result recorded'}</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {resultOptions.map((result) => (
              <button
                key={result}
                type="button"
                onClick={() => recordDriveResult(result)}
                className={`rounded-lg border px-3 py-3 text-left text-sm font-black ${
                  selectedDrive.result === result ? 'border-[#10201a] bg-[#f7c948] text-[#10201a]' : 'border-[#d8ded5] bg-white'
                }`}
              >
                {result === 'TD' && selectedDrive.unit === 'defense' ? 'TD (them)' : result}
              </button>
            ))}
          </div>

          {selectedDrive.result === 'TD' && (
            <div className="mt-3 rounded-lg bg-[#f7f5ee] p-3">
              <p className="text-xs font-black uppercase text-[#53665c]">
                After the touchdown{selectedDrive.unit === 'defense' ? ' (counts for them)' : ''}
              </p>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {conversionOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setDriveConversion(option.value)}
                    className={`rounded-lg border px-2 py-3 text-sm font-black ${
                      (selectedDrive.conversion || '') === option.value
                        ? 'border-[#10201a] bg-[#1f7a4d] text-white'
                        : 'border-[#d8ded5] bg-white'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <textarea
            value={gameNoteDraft}
            onChange={(event) => updateDriveNote(event.target.value)}
            className="mt-3 w-full rounded-lg border border-[#d8ded5] px-3 py-3 text-sm outline-none focus:border-[#1f7a4d]"
            rows={3}
            placeholder="Quick note"
          />
          <button
            type="button"
            onClick={() => recordDriveResult((selectedDrive.result || 'Stop') as Exclude<DriveResult, ''>, true)}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-[#10201a] px-3 py-4 font-black text-white"
          >
            <Check size={18} />
            Save + Next
          </button>
        </section>
      )}

      <section className="rounded-lg border border-[#d8ded5] bg-white p-3 shadow-sm">
        <h2 className="font-display text-xl font-black">Drive Log</h2>
        <div className="mt-3 space-y-2">
          {gameDrives.map((drive) => (
            <button
              key={drive.id}
              type="button"
              onClick={() => setSelectedDriveId(drive.id)}
              className={`grid w-full grid-cols-[72px_1fr_auto] items-center gap-2 rounded-lg border px-3 py-2 text-left ${
                selectedDrive?.id === drive.id ? 'border-[#10201a] bg-[#f7c948]/25' : 'border-[#d8ded5] bg-white'
              }`}
            >
              <span className="font-black">{driveLabel(drive)}</span>
              <span className="truncate text-sm font-bold text-[#53665c]">{drive.notes.freeform || 'No note'}</span>
              <span className="rounded-full bg-[#f7f5ee] px-2 py-1 text-xs font-black text-[#53665c]">{shortResult(drive.result)}</span>
            </button>
          ))}
        </div>
      </section>

      <div className="flex flex-col items-center gap-1 pt-1">
        <button
          type="button"
          onClick={() => setConfirmingDelete(true)}
          disabled={gameCount <= 1}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-black text-[#c2412d] disabled:opacity-40"
        >
          <Trash2 size={15} />
          Delete {gameName || 'this game'}
        </button>
        {gameCount <= 1 && <p className="text-xs font-bold text-[#53665c]">Start another game before deleting this one.</p>}
      </div>

      {confirmingDelete && (
        <DeleteGameSheet
          gameName={gameName}
          driveCount={gameDrives.length}
          teamScore={gameSummary.teamScore}
          opponentScore={gameSummary.opponentScore}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => {
            deleteGame()
            setConfirmingDelete(false)
          }}
        />
      )}
    </div>
  )
}

function DeleteGameSheet({
  gameName,
  driveCount,
  teamScore,
  opponentScore,
  onCancel,
  onConfirm
}: {
  gameName: string
  driveCount: number
  teamScore: number
  opponentScore: number
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-3 pb-3 sm:items-center">
      <div className="w-full max-w-md rounded-lg border border-[#d8ded5] bg-white p-4 shadow-xl safe-bottom">
        <h3 className="font-display text-xl font-black">Delete {gameName || 'this game'}?</h3>
        <p className="mt-1 text-sm font-bold text-[#53665c]">
          This removes the game for good, along with its {driveCount} drive{driveCount === 1 ? '' : 's'}, results and
          notes. Your roster and the lineups in other games are not touched.
        </p>
        <p className="mt-2 rounded-lg bg-[#f7f5ee] px-3 py-2 text-sm font-black">
          Final score {teamScore}-{opponentScore}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg border border-[#d8ded5] px-3 py-3 font-black">
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex items-center justify-center gap-2 rounded-lg bg-[#c2412d] px-3 py-3 font-black text-white"
          >
            <Trash2 size={16} />
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

const swipeRemoveDistance = 128
const swipeOpenDistance = 112
const longPressDuration = 2000

/**
 * Swipe left to drop a player from today's list. A short swipe parks the row open
 * so the Remove button can be tapped instead; a long swipe removes right away.
 * Holding the row still for two seconds asks to delete the player for good.
 */
function RosterRow({
  player,
  driveCount,
  onRemove,
  onLongPress
}: {
  player: Player
  driveCount: number
  onRemove: () => void
  onLongPress: () => void
}) {
  const [open, setOpen] = useState(false)
  const [dragOffset, setDragOffset] = useState<number | null>(null)
  const [holding, setHolding] = useState(false)
  const startXRef = useRef(0)
  const pointerIdRef = useRef<number | null>(null)
  const holdTimerRef = useRef<number | null>(null)
  const holdFiredRef = useRef(false)

  const restingOffset = open ? -swipeOpenDistance : 0
  const offset = dragOffset ?? restingOffset

  function cancelHold() {
    if (holdTimerRef.current) {
      window.clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
    setHolding(false)
  }

  useEffect(() => cancelHold, [])

  function startHold() {
    holdFiredRef.current = false
    setHolding(true)
    holdTimerRef.current = window.setTimeout(() => {
      holdFiredRef.current = true
      holdTimerRef.current = null
      setHolding(false)
      setDragOffset(null)
      setOpen(false)
      navigator.vibrate?.(20)
      onLongPress()
    }, longPressDuration)
  }

  function settle(finalOffset: number) {
    pointerIdRef.current = null
    setDragOffset(null)
    if (finalOffset <= -swipeRemoveDistance) {
      onRemove()
      return
    }
    setOpen(finalOffset <= -24)
  }

  return (
    <div className="relative overflow-hidden rounded-lg">
      <button
        type="button"
        onClick={onRemove}
        tabIndex={open ? 0 : -1}
        aria-hidden={!open}
        className="absolute inset-y-0 right-0 flex w-40 items-center justify-end gap-2 rounded-lg bg-[#c2412d] px-4 font-black text-white"
      >
        <Trash2 size={16} />
        Remove
      </button>
      <div
        style={{ transform: `translateX(${offset}px)`, touchAction: 'pan-y' }}
        className={`relative select-none overflow-hidden rounded-lg border border-[#d8ded5] bg-white ${
          dragOffset === null ? 'transition-transform duration-150' : ''
        }`}
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          if (event.pointerType === 'mouse' && event.button !== 0) return
          startXRef.current = event.clientX
          pointerIdRef.current = event.pointerId
          startHold()
        }}
        onPointerMove={(event) => {
          if (pointerIdRef.current !== event.pointerId) return
          const delta = event.clientX - startXRef.current
          if (Math.abs(delta) < 6 && dragOffset === null) return
          cancelHold()
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.setPointerCapture(event.pointerId)
          }
          setDragOffset(Math.min(0, Math.max(restingOffset + delta, -swipeRemoveDistance - 24)))
        }}
        onPointerUp={(event) => {
          if (pointerIdRef.current !== event.pointerId) return
          cancelHold()
          if (holdFiredRef.current) {
            pointerIdRef.current = null
            return
          }
          if (dragOffset === null) {
            pointerIdRef.current = null
            setOpen(false)
            return
          }
          settle(offset)
        }}
        onPointerCancel={(event) => {
          if (pointerIdRef.current !== event.pointerId) return
          cancelHold()
          settle(restingOffset)
        }}
      >
        <div
          aria-hidden
          style={{ width: holding ? '100%' : '0%', transition: holding ? `width ${longPressDuration}ms linear` : 'none' }}
          className="absolute inset-y-0 left-0 bg-[#f7c948]/50"
        />
        <div className="relative grid grid-cols-[1fr_auto] items-center gap-2 px-3 py-3">
          <p className="truncate font-black">{player.firstName}</p>
          <p className="shrink-0 text-xs font-bold text-[#53665c]">
            {driveCount} drive{driveCount === 1 ? '' : 's'}
          </p>
        </div>
      </div>
    </div>
  )
}

function NewGameSheet({
  defaultName,
  onCreate,
  onClose
}: {
  defaultName: string
  onCreate: (name: string) => void
  onClose: () => void
}) {
  const [name, setName] = useState(defaultName)

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-3 pb-3 sm:items-center">
      <div className="w-full max-w-md rounded-lg border border-[#d8ded5] bg-white p-4 shadow-xl safe-bottom">
        <h3 className="font-display text-xl font-black">New Game</h3>
        <p className="mt-1 text-sm font-bold text-[#53665c]">
          Your lineups carry over. Results and notes start fresh, and this game is saved so you can open it again later.
        </p>
        <input
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onCreate(name)
            if (event.key === 'Escape') onClose()
          }}
          placeholder="Game name"
          className="mt-3 w-full rounded-lg border border-[#d8ded5] px-3 py-3 outline-none focus:border-[#1f7a4d]"
        />
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-[#d8ded5] px-3 py-3 font-black">
            Cancel
          </button>
          <button type="button" onClick={() => onCreate(name)} className="rounded-lg bg-[#10201a] px-3 py-3 font-black text-white">
            Start Game
          </button>
        </div>
      </div>
    </div>
  )
}


/**
 * Playing time at a glance: a row per player, a column per drive, showing the
 * position they take or a red OUT when they are resting.
 */
function PlayingTimeTable({
  players,
  drives,
  availability
}: {
  players: Player[]
  drives: ResolvedDrive[]
  availability: Record<string, boolean>
}) {
  function slotFor(drive: ResolvedDrive, playerId: string) {
    const entry = Object.entries(drive.assignments).find(([, assigned]) => assigned === playerId)
    return entry?.[0]
  }

  // The lineups only go four deep, so anything past the fourth drive each way is noise.
  const shownDrives = drives.filter((drive) => drive.driveNumber <= LINEUPS_PER_UNIT)
  const restWindow = getRestWindowDrives(drives)

  return (
    <section className="space-y-3 border-t border-[#d8ded5] pt-4">
      <div>
        <h2 className="font-display text-xl font-black">Playing Time</h2>
        <p className="text-sm font-bold text-[#53665c]">
          The number by each name is how many of the first {restWindow.length} drives they sit.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-center">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-[#f7f5ee] px-1 py-1 text-left text-[10px] font-black uppercase text-[#53665c]">
                Player · Sits
              </th>
              {shownDrives.map((drive) => (
                <th
                  key={drive.id}
                  className={`px-0.5 py-1 text-[9px] font-black uppercase ${
                    drive.unit === 'offense' ? 'text-[#1f7a4d]' : 'text-[#10201a]'
                  }`}
                >
                  {drive.unit === 'offense' ? 'OFF' : 'DEF'}
                  <span className="block text-[10px]">{drive.driveNumber}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {players.map((player) => {
              const out = !isPlayerAvailable(player.id, availability)
              const sits = out ? restWindow.length : countSitOuts(player.id, drives)
              const playing = out ? 0 : shownDrives.filter((drive) => slotFor(drive, player.id)).length
              return (
                <tr key={player.id} className={out ? 'opacity-60' : ''}>
                  <th className="sticky left-0 z-10 bg-[#f7f5ee] px-1 py-1 text-left">
                    <span className="flex items-center gap-1">
                      <span className="min-w-0 truncate text-xs font-black">{player.firstName}</span>
                      <span
                        aria-label={`Sits ${sits} of the first ${restWindow.length} drives`}
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-black ${
                          sits >= 3 ? 'bg-[#c2412d] text-white' : sits === 0 ? 'bg-[#1f7a4d] text-white' : 'bg-[#d8ded5] text-[#10201a]'
                        }`}
                      >
                        {sits}
                      </span>
                    </span>
                    <span className="block text-[9px] font-bold text-[#53665c]">
                      {playing}/{shownDrives.length} played
                    </span>
                  </th>
                  {shownDrives.map((drive) => {
                    const slotCode = out ? undefined : slotFor(drive, player.id)
                    return (
                      <td key={drive.id} className="px-0.5 py-1">
                        <span
                          className={`block rounded px-1 py-1 text-[10px] font-black uppercase ${
                            slotCode ? 'bg-[#1f7a4d] text-white' : 'bg-[#c2412d]/15 text-[#c2412d]'
                          }`}
                        >
                          {slotCode || 'Out'}
                        </span>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/** Copy a whole lineup from another of the same unit. */
function CopyLineupSheet({
  lineups,
  players,
  target,
  onCopy,
  onClose
}: {
  lineups: Lineup[]
  players: Player[]
  target: Lineup
  onCopy: (lineupId: string) => void
  onClose: () => void
}) {
  const slots = SLOTS_BY_UNIT[target.unit]

  function summary(lineup: Lineup) {
    return slots
      .map((slot) => players.find((player) => player.id === lineup.assignments[slot.code])?.firstName)
      .filter(Boolean)
      .join(', ')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-3 pb-3 sm:items-center">
      <div className="w-full max-w-md rounded-lg border border-[#d8ded5] bg-white p-3 shadow-xl safe-bottom">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display text-xl font-black">Copy into {lineupLabel(target)}</h3>
            <p className="text-sm font-bold text-[#53665c]">Replaces every position in this lineup.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#d8ded5]"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-3 max-h-[50vh] space-y-2 overflow-y-auto">
          {lineups.map((lineup) => (
            <button
              key={lineup.id}
              type="button"
              onClick={() => onCopy(lineup.id)}
              className="w-full rounded-lg border border-[#d8ded5] px-3 py-3 text-left"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-black">{lineupLabel(lineup)}</span>
                <span className="shrink-0 text-xs font-black uppercase text-[#53665c]">
                  {Object.values(lineup.assignments).filter(Boolean).length}/{slots.length}
                </span>
              </div>
              <p className="mt-1 truncate text-xs font-bold text-[#53665c]">{summary(lineup)}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/** The eight lineups, offense then defense, as a row of chips. */
function LineupScroller({
  lineups,
  selectedLineupId,
  onSelect
}: {
  lineups: Lineup[]
  selectedLineupId: string
  onSelect: (id: string) => void
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {lineups.map((lineup) => (
        <button
          key={lineup.id}
          type="button"
          onClick={() => onSelect(lineup.id)}
          className={`shrink-0 rounded-lg border px-3 py-2 text-sm font-black ${
            lineup.id === selectedLineupId
              ? 'border-[#10201a] bg-[#10201a] text-white'
              : 'border-[#d8ded5] bg-white text-[#10201a]'
          }`}
        >
          {lineupLabel(lineup)}
        </button>
      ))}
    </div>
  )
}

const backupHoldDuration = 700

/** Tap to make this player the starter, hold to make them the backup. */
function SlotPickerRow({
  player,
  isCurrent,
  isBackup,
  playingAt,
  onSelect,
  onHold
}: {
  player: Player
  isCurrent: boolean
  isBackup: boolean
  playingAt?: string
  onSelect: () => void
  onHold: () => void
}) {
  const [holding, setHolding] = useState(false)
  const holdTimerRef = useRef<number | null>(null)
  const holdFiredRef = useRef(false)

  function cancelHold() {
    if (holdTimerRef.current) {
      window.clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
    setHolding(false)
  }

  useEffect(() => cancelHold, [])

  return (
    <button
      type="button"
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return
        holdFiredRef.current = false
        setHolding(true)
        holdTimerRef.current = window.setTimeout(() => {
          holdFiredRef.current = true
          holdTimerRef.current = null
          setHolding(false)
          navigator.vibrate?.(15)
          onHold()
        }, backupHoldDuration)
      }}
      onPointerUp={cancelHold}
      onPointerLeave={cancelHold}
      onPointerCancel={cancelHold}
      onClick={() => {
        if (holdFiredRef.current) {
          holdFiredRef.current = false
          return
        }
        onSelect()
      }}
      className={`relative w-full select-none overflow-hidden rounded-lg border px-3 py-3 text-left ${
        isCurrent ? 'border-[#10201a] bg-[#f7c948]/30' : isBackup ? 'border-[#1f7a4d] bg-[#1f7a4d]/10' : 'border-[#d8ded5] bg-white'
      }`}
    >
      <span
        aria-hidden
        style={{ width: holding ? '100%' : '0%', transition: holding ? `width ${backupHoldDuration}ms linear` : 'none' }}
        className="absolute inset-y-0 left-0 bg-[#1f7a4d]/20"
      />
      <span className="relative flex items-center justify-between gap-2">
        <span className="truncate font-black">{player.firstName}</span>
        {isBackup ? (
          <span className="shrink-0 rounded-full bg-[#1f7a4d] px-2 py-1 text-xs font-black uppercase text-white">Backup</span>
        ) : isCurrent ? (
          <span className="shrink-0 text-xs font-black uppercase text-[#53665c]">Here now</span>
        ) : playingAt ? (
          <span className="shrink-0 rounded-full bg-[#f7f5ee] px-2 py-1 text-xs font-black text-[#53665c]">Now at {playingAt}</span>
        ) : (
          <span className="shrink-0 text-xs font-black uppercase text-[#53665c]">Bench</span>
        )}
      </span>
    </button>
  )
}

/**
 * Tapping a position on the field: pick anyone, including someone already on the
 * field. Holding a name instead marks them as the backup for that position.
 */
function SlotPickerSheet({
  slot,
  lineup,
  players,
  onAssign,
  onSetBackup,
  onClear,
  onClose
}: {
  slot: FieldSlot
  lineup: Lineup
  players: Player[]
  onAssign: (playerId: string) => void
  onSetBackup: (playerId: string | null) => void
  onClear: () => void
  onClose: () => void
}) {
  const currentPlayerId = lineup.assignments[slot.code]
  const backupPlayerId = lineup.backups[slot.code]
  const slots = SLOTS_BY_UNIT[lineup.unit]

  function currentSlotFor(playerId: string) {
    return slots.find((item) => item.code !== slot.code && lineup.assignments[item.code] === playerId)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-3 pb-3 sm:items-center">
      <div className="w-full max-w-md rounded-lg border border-[#d8ded5] bg-white p-3 shadow-xl safe-bottom">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display text-xl font-black">{slot.name}</h3>
            <p className="text-sm font-bold text-[#53665c]">Tap to start · hold to set a backup</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#d8ded5]"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-3 max-h-[50vh] space-y-2 overflow-y-auto">
          {players.length === 0 && (
            <p className="rounded-lg border border-dashed border-[#d8ded5] px-3 py-6 text-center text-sm font-bold text-[#53665c]">
              Nobody on the list.
            </p>
          )}
          {players.map((player) => {
            const playingElsewhere = currentSlotFor(player.id)
            const isCurrent = currentPlayerId === player.id
            const isBackup = backupPlayerId === player.id
            return (
              <SlotPickerRow
                key={player.id}
                player={player}
                isCurrent={isCurrent}
                isBackup={isBackup}
                playingAt={playingElsewhere?.shortName}
                onSelect={() => onAssign(player.id)}
                onHold={() => onSetBackup(isBackup ? null : player.id)}
              />
            )
          })}
        </div>

        <div className="mt-3 grid gap-2">
          {backupPlayerId && (
            <button type="button" onClick={() => onSetBackup(null)} className="w-full rounded-lg border border-[#d8ded5] px-3 py-3 font-black">
              Clear backup
            </button>
          )}
          {currentPlayerId && (
            <button type="button" onClick={onClear} className="w-full rounded-lg border border-[#d8ded5] px-3 py-3 font-black">
              Leave {slot.shortName} open
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function DeletePlayerSheet({
  player,
  onCancel,
  onConfirm
}: {
  player: Player
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-3 pb-3 sm:items-center">
      <div className="w-full max-w-md rounded-lg border border-[#d8ded5] bg-white p-4 shadow-xl safe-bottom">
        <h3 className="font-display text-xl font-black">Delete {player.firstName}?</h3>
        <p className="mt-1 text-sm font-bold text-[#53665c]">
          Removes {player.firstName} from the team for good, including every lineup. If they are just missing today,
          swipe them off the list instead.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg border border-[#d8ded5] px-3 py-3 font-black">
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex items-center justify-center gap-2 rounded-lg bg-[#c2412d] px-3 py-3 font-black text-white"
          >
            <Trash2 size={16} />
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

function AddBackSheet({
  players,
  restorePlayers,
  onClose
}: {
  players: Player[]
  restorePlayers: (playerIds: string[]) => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-3 pb-3 sm:items-center">
      <div className="w-full max-w-md rounded-lg border border-[#d8ded5] bg-white p-3 shadow-xl safe-bottom">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-xl font-black">Add Back</h3>
            <p className="text-sm font-bold text-[#53665c]">{players.length} off the list</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-[#d8ded5]"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-3 max-h-[50vh] space-y-2 overflow-y-auto">
          {players.map((player) => (
            <div key={player.id} className="flex items-center justify-between gap-2 rounded-lg border border-[#d8ded5] px-3 py-2">
              <p className="truncate font-black">{player.firstName}</p>
              <button
                type="button"
                onClick={() => restorePlayers([player.id])}
                className="shrink-0 rounded-lg bg-[#1f7a4d] px-4 py-2 text-sm font-black text-white"
              >
                Add
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => restorePlayers(players.map((player) => player.id))}
          className="mt-3 w-full rounded-lg bg-[#10201a] px-3 py-3 font-black text-white"
        >
          Add All
        </button>
      </div>
    </div>
  )
}

function DriveScroller({
  drives,
  selectedDriveId,
  setSelectedDriveId,
  compact = false
}: {
  drives: Drive[]
  selectedDriveId: string
  setSelectedDriveId: (id: string) => void
  compact?: boolean
}) {
  return (
    <div className={`flex gap-2 overflow-x-auto ${compact ? 'px-0' : 'mt-3 pb-1'}`}>
      {drives.map((drive) => (
        <button
          key={drive.id}
          type="button"
          onClick={() => setSelectedDriveId(drive.id)}
          className={`shrink-0 rounded-lg border px-3 py-2 text-left ${
            drive.id === selectedDriveId ? 'border-[#10201a] bg-[#10201a] text-white' : 'border-[#d8ded5] bg-white text-[#10201a]'
          }`}
        >
          <p className="text-sm font-black">{driveLabel(drive)}</p>
          <p className={`text-xs font-bold ${drive.id === selectedDriveId ? 'text-white/70' : 'text-[#53665c]'}`}>{shortResult(drive.result)}</p>
        </button>
      ))}
    </div>
  )
}

const markerDragThreshold = 8
const minZoom = 1
const maxZoom = 2.5

function pointerDistance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/**
 * The field. Tap a position to pick who plays it, drag a position to move the
 * marker on the field, and pinch with two fingers to zoom in on the formation.
 */
function FormationBoard({
  lineup,
  players,
  selectedPlayer,
  assignPlayerToSlot,
  clearSlot,
  draggingPlayerId,
  slotPositions,
  availability,
  moveSlot,
  onPickSlot,
  interactive = false,
  compact = false
}: {
  lineup: { unit: Unit; assignments: Record<string, string | null>; backups: Record<string, string | null> }
  players: Player[]
  selectedPlayer?: Player
  assignPlayerToSlot?: (slotCode: string, playerId?: string) => void
  clearSlot?: (slotCode: string) => void
  draggingPlayerId?: string | null
  slotPositions: SlotPositions
  availability: Record<string, boolean>
  moveSlot?: (unit: Unit, slotCode: string, position: { x: number; y: number }) => void
  onPickSlot?: (slotCode: string) => void
  interactive?: boolean
  compact?: boolean
}) {
  const slots = SLOTS_BY_UNIT[lineup.unit]
  const markerSize = compact ? 'h-[51px] w-[51px]' : 'h-[57px] w-[57px]'

  const fieldRef = useRef<HTMLDivElement | null>(null)
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 })
  const [draggingSlot, setDraggingSlot] = useState<string | null>(null)
  const [snap, setSnap] = useState<SnapResult | null>(null)
  const dragRef = useRef<{ slotCode: string; startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null)
  const pinchRef = useRef(new Map<number, { x: number; y: number }>())
  const lastPinchRef = useRef<{ distance: number; centerX: number; centerY: number } | null>(null)

  function endPinch() {
    lastPinchRef.current = null
  }

  /** Two fingers on the field: scale around the pinch center and pan with it. */
  function handleFieldPointerDown(event: React.PointerEvent) {
    pinchRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pinchRef.current.size === 2) {
      dragRef.current = null
      setDraggingSlot(null)
      const [a, b] = Array.from(pinchRef.current.values())
      lastPinchRef.current = {
        distance: pointerDistance(a, b),
        centerX: (a.x + b.x) / 2,
        centerY: (a.y + b.y) / 2
      }
    }
  }

  function handleFieldPointerMove(event: React.PointerEvent) {
    if (!pinchRef.current.has(event.pointerId)) return
    pinchRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pinchRef.current.size !== 2 || !lastPinchRef.current) return

    event.preventDefault()
    const [a, b] = Array.from(pinchRef.current.values())
    const distance = pointerDistance(a, b)
    const centerX = (a.x + b.x) / 2
    const centerY = (a.y + b.y) / 2
    const previous = lastPinchRef.current

    setView((current) => {
      const scale = Math.min(maxZoom, Math.max(minZoom, current.scale * (distance / (previous.distance || distance))))
      if (scale === minZoom) return { scale, x: 0, y: 0 }
      return {
        scale,
        x: current.x + (centerX - previous.centerX),
        y: current.y + (centerY - previous.centerY)
      }
    })

    lastPinchRef.current = { distance, centerX, centerY }
  }

  function handleFieldPointerUp(event: React.PointerEvent) {
    pinchRef.current.delete(event.pointerId)
    if (pinchRef.current.size < 2) endPinch()
  }

  function startMarkerDrag(event: React.PointerEvent, slotCode: string, position: { x: number; y: number }) {
    if (!interactive || !moveSlot) return
    if (event.pointerType === 'mouse' && event.button !== 0) return
    dragRef.current = {
      slotCode,
      startX: event.clientX,
      startY: event.clientY,
      originX: position.x,
      originY: position.y,
      moved: false
    }
  }

  function moveMarker(event: React.PointerEvent) {
    const drag = dragRef.current
    const field = fieldRef.current
    if (!drag || !field || !moveSlot || pinchRef.current.size > 1) return

    const deltaX = event.clientX - drag.startX
    const deltaY = event.clientY - drag.startY
    if (!drag.moved && Math.hypot(deltaX, deltaY) < markerDragThreshold) return

    if (!drag.moved) {
      drag.moved = true
      setDraggingSlot(drag.slotCode)
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.setPointerCapture(event.pointerId)
      }
    }

    const rect = field.getBoundingClientRect()
    const others = slots
      .filter((item) => item.code !== drag.slotCode)
      .map((item) => getSlotPosition(item, slotPositions))
    const snapped = snapToField(
      {
        x: drag.originX + (deltaX / (rect.width * view.scale)) * 100,
        y: drag.originY + (deltaY / (rect.height * view.scale)) * 100
      },
      others
    )
    setSnap(snapped)
    moveSlot(lineup.unit, drag.slotCode, { x: snapped.x, y: snapped.y })
  }

  function endMarkerDrag(slotCode: string) {
    const drag = dragRef.current
    dragRef.current = null
    setDraggingSlot(null)
    setSnap(null)

    // A press that never moved is a tap: pick who plays this position.
    if (!drag || drag.moved) return
    if (selectedPlayer && assignPlayerToSlot) {
      assignPlayerToSlot(slotCode)
    } else if (onPickSlot) {
      onPickSlot(slotCode)
    }
  }

  return (
    <div className="relative">
      <div
        ref={fieldRef}
        className="field-yardlines relative mt-3 aspect-[4/3] w-full touch-pan-y overflow-hidden rounded-lg border-4 border-[#f6f2df] shadow-field"
        onPointerDown={handleFieldPointerDown}
        onPointerMove={handleFieldPointerMove}
        onPointerUp={handleFieldPointerUp}
        onPointerCancel={handleFieldPointerUp}
      >
        <div
          className="absolute inset-0"
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            transformOrigin: 'center',
            transition: draggingSlot || lastPinchRef.current ? 'none' : 'transform 150ms ease-out'
          }}
        >
          <div
            className={`absolute inset-x-0 h-px ${snap?.onLine ? 'bg-[#f7c948] shadow-[0_0_6px_#f7c948]' : 'bg-[#f6f2df]/70'}`}
            style={{ top: `${LINE_OF_SCRIMMAGE}%` }}
          />
          {snap?.alignedX !== undefined && (
            <div className="absolute inset-y-0 w-px bg-[#f7c948]/80" style={{ left: `${snap.alignedX}%` }} />
          )}
          {snap?.alignedY !== undefined && (
            <div className="absolute inset-x-0 h-px bg-[#f7c948]/80" style={{ top: `${snap.alignedY}%` }} />
          )}
          <div className="absolute left-2 top-2 rounded-full bg-black/25 px-2 py-0.5 text-[10px] font-black uppercase text-white">
            {lineup.unit}
          </div>
          {slots.map((slot) => {
            const player = players.find((item) => item.id === lineup.assignments[slot.code])
            const backup = players.find((item) => item.id === lineup.backups[slot.code])
            const isOut = Boolean(player) && (!player!.active || !isPlayerAvailable(player!.id, availability))
            const position = getSlotPosition(slot, slotPositions)
            const isDragging = draggingSlot === slot.code
            return (
              <div
                key={slot.code}
                className={`absolute -translate-x-1/2 -translate-y-1/2 ${isDragging ? 'z-20' : 'z-10'}`}
                style={{ left: `${position.x}%`, top: `${position.y}%`, touchAction: interactive ? 'none' : undefined }}
                onDragOver={(event) => {
                  if (interactive) event.preventDefault()
                }}
                onDrop={(event) => {
                  if (!interactive || !assignPlayerToSlot) return
                  event.preventDefault()
                  const droppedPlayerId = event.dataTransfer.getData('text/plain') || draggingPlayerId || undefined
                  assignPlayerToSlot(slot.code, droppedPlayerId)
                }}
                onPointerDown={(event) => startMarkerDrag(event, slot.code, position)}
                onPointerMove={moveMarker}
                onPointerUp={() => endMarkerDrag(slot.code)}
                onPointerCancel={() => {
                  dragRef.current = null
                  setDraggingSlot(null)
                }}
              >
                <button
                  type="button"
                  tabIndex={interactive ? 0 : -1}
                  aria-label={`${slot.name}: ${player ? `${player.firstName}${isOut ? ' (out)' : ''}` : 'open'}`}
                  onClick={(event) => {
                    // Pointer taps are handled on pointerup; this catches keyboard activation.
                    event.preventDefault()
                    if (event.detail === 0 && interactive && onPickSlot) onPickSlot(slot.code)
                  }}
                  className={`relative flex ${markerSize} select-none flex-col items-center justify-center rounded-full border-2 shadow-sm ${
                    isOut
                      ? 'border-[#8f2e20] bg-[#c2412d] text-white'
                      : player
                        ? 'border-[#10201a] bg-white text-[#10201a]'
                        : 'border-dashed border-[#f6f2df] bg-white/20 text-white'
                  } ${interactive ? 'cursor-pointer' : 'cursor-default'} ${isDragging ? 'scale-110 shadow-lg ring-2 ring-[#f7c948]' : ''}`}
                >
                  <span className={`text-[10px] font-black uppercase leading-none ${isOut ? 'text-white/80' : 'text-[#53665c]'}`}>
                    {slot.shortName}
                  </span>
                  <span
                    className={`mt-0.5 w-full truncate text-center text-[12px] font-black leading-none tracking-tight ${
                      isOut ? 'line-through' : ''
                    }`}
                  >
                    {player ? player.firstName : 'Open'}
                  </span>
                  {backup && (
                    <span className="absolute left-1/2 top-full mt-0.5 max-w-[84px] -translate-x-1/2 truncate rounded-full bg-[#10201a]/70 px-1 text-[12px] font-bold italic leading-tight text-white">
                      {backup.firstName}
                    </span>
                  )}
                </button>
              </div>
            )
          })}
        </div>

        {view.scale > 1 && (
          <button
            type="button"
            onClick={() => setView({ scale: 1, x: 0, y: 0 })}
            className="absolute right-3 top-3 z-30 flex items-center gap-1 rounded-full bg-black/40 px-3 py-1 text-xs font-black uppercase text-white"
          >
            <Minimize2 size={13} />
            {Math.round(view.scale * 10) / 10}x
          </button>
        )}
      </div>
    </div>
  )
}

function BenchPicker({
  benchPlayers,
  selectedPlayerId,
  setSelectedPlayerId,
  setDraggingPlayerId
}: {
  benchPlayers: Player[]
  selectedPlayerId: string | null
  setSelectedPlayerId: (id: string | null) => void
  setDraggingPlayerId: (id: string | null) => void
}) {
  return (
    <div className="mt-3 rounded-lg bg-[#f7f5ee] p-3">
      <div className="flex items-center justify-between">
        <p className="font-black">Bench</p>
        <p className="text-xs font-black uppercase text-[#53665c]">Available</p>
      </div>
      <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
        {benchPlayers.length === 0 && <p className="rounded-lg bg-white px-3 py-3 text-sm font-bold text-[#53665c]">No available bench players</p>}
        {benchPlayers.map((player) => (
          <button
            key={player.id}
            type="button"
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData('text/plain', player.id)
              setDraggingPlayerId(player.id)
            }}
            onDragEnd={() => setDraggingPlayerId(null)}
            onClick={() => setSelectedPlayerId(selectedPlayerId === player.id ? null : player.id)}
            className={`min-w-24 shrink-0 rounded-lg border px-3 py-3 text-left ${
              selectedPlayerId === player.id ? 'border-[#10201a] bg-[#f7c948] text-[#10201a]' : 'border-[#d8ded5] bg-white'
            }`}
          >
            <p className="font-black">{player.firstName}</p>
          </button>
        ))}
      </div>
    </div>
  )
}

function BottomNavButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-14 rounded-lg text-sm font-black ${active ? 'bg-[#10201a] text-white' : 'bg-[#f7f5ee] text-[#53665c]'}`}
    >
      {label}
    </button>
  )
}
