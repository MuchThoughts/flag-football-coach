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
import { autoFillDrive, computeUsage, getDriveWarnings, isPlayerAvailable } from '@/lib/fair-play'
import { getGameSummary } from '@/lib/game-summary'
import { migrateAppState } from '@/lib/migrate-state'
import { getSlotPosition, slotPositionKey, SLOTS_BY_UNIT, type FieldSlot } from '@/lib/positions'
import { createDrive, createPlayer, initialAppState } from '@/lib/sample-data'
import type { AppSettings, AppState, Conversion, Drive, DriveNote, DriveResult, Game, Player, SlotPositions, Unit } from '@/lib/types'

type Workflow = 'planning' | 'gameday'
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
  return pathname.includes('/gameday') ? 'gameday' : 'planning'
}

function workflowPath(workflow: Workflow) {
  return workflow === 'gameday' ? '/gameday' : '/planning'
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
  const [lineupTemplates, setLineupTemplates] = useState(initialAppState.lineupTemplates)
  const [slotPositions, setSlotPositions] = useState(initialAppState.slotPositions)
  const [appSettings, setAppSettings] = useState<AppSettings>(initialAppState.appSettings)
  const [workflow, setWorkflow] = useState<Workflow>('planning')
  const [rosterCollapsed, setRosterCollapsed] = useState(false)
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
  const selectedDrive = gameDrives.find((drive) => drive.id === selectedDriveId) || gameDrives[0]
  const selectedDriveIndex = Math.max(0, gameDrives.findIndex((drive) => drive.id === selectedDrive?.id))
  const availability = availabilityByGame[selectedGame?.id || ''] || {}
  const activePlayers = players.filter((player) => player.active)
  const availablePlayers = activePlayers.filter((player) => isPlayerAvailable(player.id, availability))
  const unavailablePlayers = activePlayers.filter((player) => !isPlayerAvailable(player.id, availability))
  const assignedIds = selectedDrive ? Object.values(selectedDrive.assignments).filter(Boolean) : []
  const benchPlayers = availablePlayers.filter((player) => !assignedIds.includes(player.id))
  const selectedPlayer = selectedPlayerId ? players.find((player) => player.id === selectedPlayerId) : undefined
  const gameSummary = getGameSummary(gameDrives)
  const usage = computeUsage(players, gameDrives, availability)
  const driveWarnings = selectedDrive ? getDriveWarnings(selectedDrive, players, availability) : []
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
      lineupTemplates,
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
    setLineupTemplates(saved.lineupTemplates)
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
  }, [appSettings, availabilityByGame, drives, games, lineupTemplates, loaded, players, plays, practiceTemplates, practices, selectedDriveId, selectedGameId, slotPositions, team])

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

    setDrives((items) =>
      items.map((drive) => {
        const assignments = { ...drive.assignments }
        const backups = { ...drive.backups }
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
        return changed ? { ...drive, assignments, backups } : drive
      })
    )

    setLineupTemplates((items) =>
      items.map((template) => {
        const assignments = { ...template.assignments }
        let changed = false
        Object.keys(assignments).forEach((slotCode) => {
          if (assignments[slotCode] === playerId) {
            assignments[slotCode] = null
            changed = true
          }
        })
        return changed ? { ...template, assignments } : template
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

    const carriedDrives = gameDrives.map((drive) => ({
      ...drive,
      id: uid('drive'),
      gameId: game.id,
      assignments: { ...drive.assignments },
      backups: { ...drive.backups },
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

  function addDrive(unit: Unit) {
    if (!selectedGame) return
    const drive = createDrive(uid('drive'), unit, nextDriveNumber(gameDrives, unit), selectedGame.id)
    setDrives((items) => [...items, drive])
    setSelectedDriveId(drive.id)
  }

  function assignPlayerToSlot(slotCode: string, playerId = selectedPlayer?.id) {
    if (!selectedDrive || !playerId) return

    setDrives((items) =>
      items.map((drive) => {
        if (drive.id !== selectedDrive.id) return drive

        const assignments = { ...drive.assignments }
        Object.keys(assignments).forEach((code) => {
          if (assignments[code] === playerId) {
            assignments[code] = null
          }
        })
        assignments[slotCode] = playerId

        return {
          ...drive,
          assignments,
          isCustomized: drive.isRepeated ? true : drive.isCustomized
        }
      })
    )
    setSelectedPlayerId(null)
    setDraggingPlayerId(null)
  }

  /** The stand-in for a position if the starter goes down. */
  function setSlotBackup(slotCode: string, playerId: string | null) {
    if (!selectedDrive) return
    setDrives((items) =>
      items.map((drive) =>
        drive.id === selectedDrive.id ? { ...drive, backups: { ...drive.backups, [slotCode]: playerId } } : drive
      )
    )
  }

  function clearSlot(slotCode: string) {
    if (!selectedDrive) return

    setDrives((items) =>
      items.map((drive) =>
        drive.id === selectedDrive.id
          ? {
              ...drive,
              assignments: { ...drive.assignments, [slotCode]: null },
              backups: { ...drive.backups, [slotCode]: null },
              isCustomized: drive.isRepeated ? true : drive.isCustomized
            }
          : drive
      )
    )
  }

  /** Copies another drive's assignments onto the selected drive, slot for slot. */
  function copyDriveAssignments(sourceDriveId: string) {
    const source = drives.find((drive) => drive.id === sourceDriveId)
    if (!selectedDrive || !source || source.unit !== selectedDrive.unit) return

    setDrives((items) =>
      items.map((drive) =>
        drive.id === selectedDrive.id
          ? {
              ...drive,
              assignments: { ...source.assignments },
              backups: { ...source.backups },
              isCustomized: drive.isRepeated ? true : drive.isCustomized
            }
          : drive
      )
    )
  }

  function moveSlot(unit: Unit, slotCode: string, position: { x: number; y: number }) {
    setSlotPositions((current) => ({ ...current, [slotPositionKey(unit, slotCode)]: position }))
  }

  function autoFillSelectedDrive() {
    if (!selectedDrive) return
    setDrives((items) =>
      items.map((drive) =>
        drive.id === selectedDrive.id ? autoFillDrive(drive, players, availability, gameDrives) : drive
      )
    )
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
            copyDriveAssignments={copyDriveAssignments}
            gameDrives={gameDrives}
            selectedDrive={selectedDrive}
            setSelectedDriveId={setSelectedDriveId}
            addDrive={addDrive}
            autoFillSelectedDrive={autoFillSelectedDrive}
            selectedPlayer={selectedPlayer}
            selectedPlayerId={selectedPlayerId}
            setSelectedPlayerId={setSelectedPlayerId}
            benchPlayers={benchPlayers}
            assignPlayerToSlot={assignPlayerToSlot}
            setSlotBackup={setSlotBackup}
            clearSlot={clearSlot}
            playersById={players}
            usage={usage}
            driveWarnings={driveWarnings}
            draggingPlayerId={draggingPlayerId}
            setDraggingPlayerId={setDraggingPlayerId}
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
        <div className="mx-auto grid max-w-md grid-cols-2 gap-2">
          <BottomNavButton active={workflow === 'planning'} label="Planning" onClick={() => navigateWorkflow('planning')} />
          <BottomNavButton active={workflow === 'gameday'} label="Gameday" onClick={() => navigateWorkflow('gameday')} />
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
  copyDriveAssignments,
  gameDrives,
  selectedDrive,
  setSelectedDriveId,
  addDrive,
  autoFillSelectedDrive,
  selectedPlayer,
  selectedPlayerId,
  setSelectedPlayerId,
  benchPlayers,
  assignPlayerToSlot,
  setSlotBackup,
  clearSlot,
  playersById,
  usage,
  driveWarnings,
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
  copyDriveAssignments: (sourceDriveId: string) => void
  gameDrives: Drive[]
  selectedDrive?: Drive
  setSelectedDriveId: (id: string) => void
  addDrive: (unit: Unit) => void
  autoFillSelectedDrive: () => void
  selectedPlayer?: Player
  selectedPlayerId: string | null
  setSelectedPlayerId: (id: string | null) => void
  benchPlayers: Player[]
  assignPlayerToSlot: (slotCode: string, playerId?: string) => void
  setSlotBackup: (slotCode: string, playerId: string | null) => void
  clearSlot: (slotCode: string) => void
  playersById: Player[]
  usage: ReturnType<typeof computeUsage>
  driveWarnings: ReturnType<typeof getDriveWarnings>
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
  const copySourceDrives = selectedDrive
    ? gameDrives.filter(
        (drive) =>
          drive.id !== selectedDrive.id &&
          drive.unit === selectedDrive.unit &&
          Object.values(drive.assignments).some(Boolean)
      )
    : []
  const pickingSlot = selectedDrive
    ? SLOTS_BY_UNIT[selectedDrive.unit].find((slot) => slot.code === pickingSlotCode)
    : undefined

  useEffect(() => {
    setPickingSlotCode(null)
    setShowCopyDrive(false)
  }, [selectedDrive?.id])

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
            <p className="text-sm font-bold text-[#53665c]">Carries over to the next game until you edit it.</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setShowCopyDrive(true)}
              disabled={copySourceDrives.length === 0}
              className="flex items-center gap-2 rounded-lg border border-[#d8ded5] bg-white px-3 py-2 text-sm font-black disabled:opacity-40"
            >
              <Copy size={15} />
              Copy
            </button>
            <button type="button" onClick={autoFillSelectedDrive} disabled={!selectedDrive} className="flex items-center gap-2 rounded-lg bg-[#f7c948] px-3 py-2 text-sm font-black text-[#10201a] disabled:opacity-40">
              <Save size={15} />
              Fill
            </button>
          </div>
        </div>

        <DriveScroller drives={gameDrives} selectedDriveId={selectedDrive?.id || ''} setSelectedDriveId={setSelectedDriveId} />

        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => addDrive('offense')} className="rounded-lg border border-[#d8ded5] bg-white px-3 py-3 text-sm font-black">
            + Off Drive
          </button>
          <button type="button" onClick={() => addDrive('defense')} className="rounded-lg border border-[#d8ded5] bg-white px-3 py-3 text-sm font-black">
            + Def Drive
          </button>
        </div>

        {selectedDrive && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-2">
              <p className="font-black">{driveLabel(selectedDrive)}</p>
              <p className="text-sm font-bold text-[#53665c]">
                {Object.values(selectedDrive.assignments).filter(Boolean).length}/7 assigned
              </p>
            </div>
            {driveWarnings.length > 0 && (
              <div className="mt-2 rounded-lg bg-[#f7c948] px-3 py-2 text-sm font-black text-[#10201a]">
                {driveWarnings.map((warning) => warning.message).join(' · ')}
              </div>
            )}
            <FormationBoard
              drive={selectedDrive}
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
              <CopyDriveSheet
                drives={copySourceDrives}
                players={playersById}
                targetDrive={selectedDrive}
                onCopy={(driveId) => {
                  copyDriveAssignments(driveId)
                  setShowCopyDrive(false)
                }}
                onClose={() => setShowCopyDrive(false)}
              />
            )}
            {pickingSlot && (
              <SlotPickerSheet
                slot={pickingSlot}
                drive={selectedDrive}
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

        {selectedDrive && (
          <FormationBoard drive={selectedDrive} players={players} slotPositions={slotPositions} availability={availability} compact />
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

/** Copy a whole lineup from another drive of the same unit. */
function CopyDriveSheet({
  drives,
  players,
  targetDrive,
  onCopy,
  onClose
}: {
  drives: Drive[]
  players: Player[]
  targetDrive: Drive
  onCopy: (driveId: string) => void
  onClose: () => void
}) {
  const slots = SLOTS_BY_UNIT[targetDrive.unit]

  function lineupSummary(drive: Drive) {
    return slots
      .map((slot) => players.find((player) => player.id === drive.assignments[slot.code])?.firstName)
      .filter(Boolean)
      .join(', ')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-3 pb-3 sm:items-center">
      <div className="w-full max-w-md rounded-lg border border-[#d8ded5] bg-white p-3 shadow-xl safe-bottom">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display text-xl font-black">Copy into {driveLabel(targetDrive)}</h3>
            <p className="text-sm font-bold text-[#53665c]">Replaces every position on this drive.</p>
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
          {drives.map((drive) => (
            <button
              key={drive.id}
              type="button"
              onClick={() => onCopy(drive.id)}
              className="w-full rounded-lg border border-[#d8ded5] px-3 py-3 text-left"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-black">{driveLabel(drive)}</span>
                <span className="shrink-0 text-xs font-black uppercase text-[#53665c]">
                  {Object.values(drive.assignments).filter(Boolean).length}/{slots.length}
                </span>
              </div>
              <p className="mt-1 truncate text-xs font-bold text-[#53665c]">{lineupSummary(drive)}</p>
            </button>
          ))}
        </div>
      </div>
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
  drive,
  players,
  onAssign,
  onSetBackup,
  onClear,
  onClose
}: {
  slot: FieldSlot
  drive: Drive
  players: Player[]
  onAssign: (playerId: string) => void
  onSetBackup: (playerId: string | null) => void
  onClear: () => void
  onClose: () => void
}) {
  const currentPlayerId = drive.assignments[slot.code]
  const backupPlayerId = drive.backups[slot.code]
  const slots = SLOTS_BY_UNIT[drive.unit]

  function currentSlotFor(playerId: string) {
    return slots.find((item) => item.code !== slot.code && drive.assignments[item.code] === playerId)
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

function clampPercent(value: number, edge: number) {
  return Math.min(100 - edge, Math.max(edge, value))
}

function pointerDistance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/**
 * The field. Tap a position to pick who plays it, drag a position to move the
 * marker on the field, and pinch with two fingers to zoom in on the formation.
 */
function FormationBoard({
  drive,
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
  drive: Drive
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
  const slots = SLOTS_BY_UNIT[drive.unit]
  const boardHeight = compact ? 'h-[326px]' : 'h-[410px] sm:h-[460px]'
  const markerWidth = compact ? 'w-[72px] sm:w-28' : 'w-[76px] sm:w-28'
  const markerMinHeight = compact ? 'min-h-[58px] p-1' : 'min-h-[66px] p-1.5'

  const fieldRef = useRef<HTMLDivElement | null>(null)
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 })
  const [draggingSlot, setDraggingSlot] = useState<string | null>(null)
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
    moveSlot(drive.unit, drag.slotCode, {
      x: clampPercent(drag.originX + (deltaX / rect.width) * 100, 6),
      y: clampPercent(drag.originY + (deltaY / rect.height) * 100, 8)
    })
  }

  function endMarkerDrag(slotCode: string) {
    const drag = dragRef.current
    dragRef.current = null
    setDraggingSlot(null)

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
        className={`field-yardlines relative mt-3 ${boardHeight} touch-pan-y overflow-hidden rounded-lg border-4 border-[#f6f2df] shadow-field`}
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
          <div className="absolute inset-x-0 top-1/2 h-px bg-[#f6f2df]/70" />
          <div className="absolute left-3 top-3 rounded-full bg-black/20 px-2 py-1 text-xs font-black uppercase text-white">{drive.unit}</div>
          {slots.map((slot) => {
            const player = players.find((item) => item.id === drive.assignments[slot.code])
            const backup = players.find((item) => item.id === drive.backups[slot.code])
            const isOut = Boolean(player) && (!player!.active || !isPlayerAvailable(player!.id, availability))
            const position = getSlotPosition(slot, slotPositions)
            const isDragging = draggingSlot === slot.code
            return (
              <div
                key={slot.code}
                className={`absolute ${markerWidth} -translate-x-1/2 -translate-y-1/2 ${isDragging ? 'z-20' : 'z-10'}`}
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
                  className={`${markerMinHeight} w-full select-none rounded-lg border-2 text-center shadow-sm ${
                    isOut
                      ? 'border-[#8f2e20] bg-[#c2412d] text-white'
                      : player
                        ? 'border-[#10201a] bg-white text-[#10201a]'
                        : 'border-dashed border-[#f6f2df] bg-white/16 text-white'
                  } ${interactive ? 'cursor-pointer' : 'cursor-default'} ${isDragging ? 'scale-110 shadow-lg ring-2 ring-[#f7c948]' : ''}`}
                >
                  <p className="text-[11px] font-black uppercase opacity-80">{slot.shortName}</p>
                  <p className="mt-1 truncate text-sm font-black leading-tight">{player ? player.firstName : 'Open'}</p>
                  {isOut && <p className="text-[10px] font-black uppercase tracking-wide text-white/90">Out</p>}
                  {backup && (
                    <p className={`truncate text-[10px] italic leading-tight ${isOut ? 'text-white/80' : 'text-[#53665c]'}`}>
                      {backup.firstName}
                    </p>
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
