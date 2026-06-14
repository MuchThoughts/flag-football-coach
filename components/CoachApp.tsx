'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Cloud,
  LogIn,
  LogOut,
  Save,
  UserPlus
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
import { SLOTS_BY_UNIT } from '@/lib/positions'
import { createDrive, initialAppState } from '@/lib/sample-data'
import type { AppSettings, AppState, Drive, DriveNote, DriveResult, Game, Player, Unit } from '@/lib/types'

type Workflow = 'planning' | 'gameday'
type SyncStatus = 'local' | 'signed_out' | 'loading' | 'synced' | 'saving' | 'error'

const storageKey = 'flag-football-coach:v2'
const resultOptions: Array<Exclude<DriveResult, ''>> = ['TD', 'Stop', 'Turnover', 'Extra Point', 'Punt', 'End Half', 'End Game', 'TD Allowed']

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

function fullName(player: Player) {
  return `${player.firstName} ${player.lastName}`.trim()
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

function playerInitials(player?: Player) {
  if (!player) return ''
  return `${player.firstName[0] || ''}${player.lastName[0] || ''}`.toUpperCase()
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
  const [appSettings, setAppSettings] = useState<AppSettings>(initialAppState.appSettings)
  const [workflow, setWorkflow] = useState<Workflow>('planning')
  const [loaded, setLoaded] = useState(false)
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null)
  const [draggingPlayerId, setDraggingPlayerId] = useState<string | null>(null)
  const [newPlayer, setNewPlayer] = useState({ firstName: '', lastName: '', jerseyNumber: '' })
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
      appSettings
    }
  }

  function applyAppState(saved: AppState, membership = syncMembership) {
    setTeam(saved.team)
    setPlayers(saved.players)
    setGames(saved.games)
    setSelectedGameId(saved.selectedGameId)
    setDrives(saved.drives)
    setSelectedDriveId(saved.selectedDriveId)
    setAvailabilityByGame(saved.availabilityByGame)
    setPractices(saved.practices || [])
    setPracticeTemplates(saved.practiceTemplates || initialAppState.practiceTemplates)
    setPlays(saved.plays || [])
    setLineupTemplates(saved.lineupTemplates || [])
    setAppSettings(membership ? appSettingsFromMembership(membership, saved.appSettings || initialAppState.appSettings) : saved.appSettings || initialAppState.appSettings)
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
    const raw = window.localStorage.getItem(storageKey) || window.localStorage.getItem('flag-football-coach:v1')
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
  }, [appSettings, availabilityByGame, drives, games, lineupTemplates, loaded, players, plays, practiceTemplates, practices, selectedDriveId, selectedGameId, team])

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

  function setPlayerAvailable(playerId: string, available: boolean) {
    if (!selectedGame) return
    setAvailabilityByGame((current) => ({
      ...current,
      [selectedGame.id]: {
        ...(current[selectedGame.id] || {}),
        [playerId]: available
      }
    }))

    if (!available) {
      setDrives((items) =>
        items.map((drive) => {
          if (drive.gameId !== selectedGame.id || drive.status === 'completed') return drive
          const assignments = { ...drive.assignments }
          let changed = false
          Object.keys(assignments).forEach((slotCode) => {
            if (assignments[slotCode] === playerId) {
              assignments[slotCode] = null
              changed = true
            }
          })
          return changed ? { ...drive, assignments } : drive
        })
      )
      if (selectedPlayerId === playerId) setSelectedPlayerId(null)
    }
  }

  function addPlayer() {
    const firstName = newPlayer.firstName.trim()
    if (!firstName) return

    const player: Player = {
      id: uid('player'),
      teamId: team.id,
      firstName,
      lastName: newPlayer.lastName.trim(),
      jerseyNumber: newPlayer.jerseyNumber.trim(),
      active: true,
      offenseRatings: { QB: 3, C: 3, WR: 3, RB: 3 },
      defenseRatings: { R: 3, S: 3, MLB: 3, CB: 3, E: 3 },
      notes: ''
    }

    setPlayers((items) => [...items, player])
    setAvailabilityByGame((current) =>
      games.reduce<Record<string, Record<string, boolean>>>((next, game) => {
        next[game.id] = { ...(current[game.id] || {}), [player.id]: true }
        return next
      }, { ...current })
    )
    setNewPlayer({ firstName: '', lastName: '', jerseyNumber: '' })
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

  function clearSlot(slotCode: string) {
    if (!selectedDrive) return

    setDrives((items) =>
      items.map((drive) =>
        drive.id === selectedDrive.id
          ? {
              ...drive,
              assignments: { ...drive.assignments, [slotCode]: null },
              isCustomized: drive.isRepeated ? true : drive.isCustomized
            }
          : drive
      )
    )
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
          game={selectedGame}
          games={games}
          selectedGameId={selectedGameId}
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
            players={activePlayers}
            availablePlayers={availablePlayers}
            unavailablePlayers={unavailablePlayers}
            availability={availability}
            setPlayerAvailable={setPlayerAvailable}
            newPlayer={newPlayer}
            setNewPlayer={setNewPlayer}
            addPlayer={addPlayer}
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
  game,
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
  game?: Game
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
          <p className="truncate text-sm font-bold text-[#53665c]">vs {game?.opponent || 'Opponent'} · {game?.date || 'No date'}</p>
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

      <div className="mt-3">
        <select
          value={selectedGameId}
          onChange={(event) => setSelectedGameId(event.target.value)}
          className="w-full min-w-0 rounded-lg border border-[#d8ded5] bg-white px-3 py-3 text-sm font-black outline-none"
        >
          {games.map((item) => (
            <option key={item.id} value={item.id}>
              {item.opponent}
            </option>
          ))}
        </select>
      </div>
    </header>
  )
}

function PlanningPage({
  players,
  availablePlayers,
  unavailablePlayers,
  availability,
  setPlayerAvailable,
  newPlayer,
  setNewPlayer,
  addPlayer,
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
  clearSlot,
  playersById,
  usage,
  driveWarnings,
  draggingPlayerId,
  setDraggingPlayerId
}: {
  players: Player[]
  availablePlayers: Player[]
  unavailablePlayers: Player[]
  availability: Record<string, boolean>
  setPlayerAvailable: (playerId: string, available: boolean) => void
  newPlayer: { firstName: string; lastName: string; jerseyNumber: string }
  setNewPlayer: (player: { firstName: string; lastName: string; jerseyNumber: string }) => void
  addPlayer: () => void
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
  clearSlot: (slotCode: string) => void
  playersById: Player[]
  usage: ReturnType<typeof computeUsage>
  driveWarnings: ReturnType<typeof getDriveWarnings>
  draggingPlayerId: string | null
  setDraggingPlayerId: (id: string | null) => void
}) {
  return (
    <div className="space-y-4 py-4">
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-black">Roster</h2>
            <p className="text-sm font-bold text-[#53665c]">Who is going to be there?</p>
          </div>
          <div className="rounded-lg bg-[#1f7a4d] px-3 py-2 text-center text-white">
            <p className="text-xs font-black uppercase opacity-80">Ready</p>
            <p className="font-display text-2xl font-black">{availablePlayers.length}</p>
          </div>
        </div>

        <div className="grid grid-cols-[1fr_1fr_72px] gap-2">
          <input
            value={newPlayer.firstName}
            onChange={(event) => setNewPlayer({ ...newPlayer, firstName: event.target.value })}
            placeholder="First"
            className="min-w-0 rounded-lg border border-[#d8ded5] px-3 py-3 outline-none focus:border-[#1f7a4d]"
          />
          <input
            value={newPlayer.lastName}
            onChange={(event) => setNewPlayer({ ...newPlayer, lastName: event.target.value })}
            placeholder="Last"
            className="min-w-0 rounded-lg border border-[#d8ded5] px-3 py-3 outline-none focus:border-[#1f7a4d]"
          />
          <input
            value={newPlayer.jerseyNumber}
            onChange={(event) => setNewPlayer({ ...newPlayer, jerseyNumber: event.target.value })}
            placeholder="#"
            className="min-w-0 rounded-lg border border-[#d8ded5] px-3 py-3 outline-none focus:border-[#1f7a4d]"
          />
        </div>
        <button type="button" onClick={addPlayer} className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#10201a] px-3 py-3 font-black text-white">
          <UserPlus size={17} />
          Add Player
        </button>

        <div className="space-y-2">
          {players.map((player) => {
            const ready = isPlayerAvailable(player.id, availability)
            const playerUsage = usage.find((item) => item.playerId === player.id)
            return (
              <div key={player.id} className="grid grid-cols-[1fr_auto] items-center gap-2 rounded-lg border border-[#d8ded5] bg-white px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate font-black">{fullName(player) || player.firstName}</p>
                  <p className="text-xs font-bold text-[#53665c]">
                    #{player.jerseyNumber || '--'} · {playerUsage?.totalDrives || 0} drive{playerUsage?.totalDrives === 1 ? '' : 's'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setPlayerAvailable(player.id, !ready)}
                  className={`min-w-24 rounded-lg px-3 py-2 text-sm font-black ${ready ? 'bg-[#1f7a4d] text-white' : 'bg-[#f7c948] text-[#10201a]'}`}
                >
                  {ready ? 'Here' : 'Out'}
                </button>
              </div>
            )
          })}
        </div>
        {unavailablePlayers.length > 0 && <p className="text-sm font-bold text-[#53665c]">{unavailablePlayers.length} marked out for this game.</p>}
      </section>

      <section className="space-y-3 border-t border-[#d8ded5] pt-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-black">Lineups</h2>
            <p className="text-sm font-bold text-[#53665c]">Where do they play, and which drive?</p>
          </div>
          <button type="button" onClick={autoFillSelectedDrive} disabled={!selectedDrive} className="flex items-center gap-2 rounded-lg bg-[#f7c948] px-3 py-2 text-sm font-black text-[#10201a] disabled:opacity-40">
            <Save size={15} />
            Fill
          </button>
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
              interactive
            />
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
  recordDriveResult
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
}) {
  return (
    <div className="space-y-4 py-4">
      <section className="rounded-lg border border-[#d8ded5] bg-[#10201a] p-4 text-white shadow-sm">
        <p className="text-xs font-black uppercase text-[#f7c948]">Gameday</p>
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
        {nextOpenDrive && (
          <button
            type="button"
            onClick={() => setSelectedDriveId(nextOpenDrive.id)}
            className="mt-3 rounded-lg bg-white/10 px-3 py-2 text-sm font-black text-white ring-1 ring-white/20"
          >
            Jump to next open: {driveLabel(nextOpenDrive)}
          </button>
        )}
      </section>

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

        {selectedDrive && <FormationBoard drive={selectedDrive} players={players} compact />}
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
                {result}
              </button>
            ))}
          </div>
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

function FormationBoard({
  drive,
  players,
  selectedPlayer,
  assignPlayerToSlot,
  clearSlot,
  draggingPlayerId,
  interactive = false,
  compact = false
}: {
  drive: Drive
  players: Player[]
  selectedPlayer?: Player
  assignPlayerToSlot?: (slotCode: string, playerId?: string) => void
  clearSlot?: (slotCode: string) => void
  draggingPlayerId?: string | null
  interactive?: boolean
  compact?: boolean
}) {
  const slots = SLOTS_BY_UNIT[drive.unit]
  const boardHeight = compact ? 'h-[326px]' : 'h-[410px] sm:h-[460px]'
  const markerWidth = compact ? 'w-[72px] sm:w-28' : 'w-[76px] sm:w-28'
  const markerMinHeight = compact ? 'min-h-[58px] p-1' : 'min-h-[66px] p-1.5'

  return (
    <div className={`field-yardlines relative mt-3 ${boardHeight} overflow-hidden rounded-lg border-4 border-[#f6f2df] shadow-field`}>
      <div className="absolute inset-x-0 top-1/2 h-px bg-[#f6f2df]/70" />
      <div className="absolute left-3 top-3 rounded-full bg-black/20 px-2 py-1 text-xs font-black uppercase text-white">{drive.unit}</div>
      {slots.map((slot) => {
        const player = players.find((item) => item.id === drive.assignments[slot.code])
        return (
          <div
            key={slot.code}
            className={`absolute ${markerWidth} -translate-x-1/2 -translate-y-1/2`}
            style={{ left: `clamp(40px, ${slot.x}%, calc(100% - 40px))`, top: `${slot.y}%` }}
            onDragOver={(event) => {
              if (interactive) event.preventDefault()
            }}
            onDrop={(event) => {
              if (!interactive || !assignPlayerToSlot) return
              event.preventDefault()
              const droppedPlayerId = event.dataTransfer.getData('text/plain') || draggingPlayerId || undefined
              assignPlayerToSlot(slot.code, droppedPlayerId)
            }}
          >
            <button
              type="button"
              onClick={() => {
                if (!interactive) return
                if (selectedPlayer && assignPlayerToSlot) {
                  assignPlayerToSlot(slot.code)
                } else if (player && clearSlot) {
                  clearSlot(slot.code)
                }
              }}
              className={`${markerMinHeight} w-full rounded-lg border-2 text-center shadow-sm ${
                player ? 'border-[#10201a] bg-white text-[#10201a]' : 'border-dashed border-[#f6f2df] bg-white/16 text-white'
              } ${interactive ? 'cursor-pointer' : 'cursor-default'}`}
            >
              <p className="text-[11px] font-black uppercase opacity-80">{slot.shortName}</p>
              <p className="mt-1 truncate text-sm font-black leading-tight">{player ? player.firstName : 'Open'}</p>
              {player && <p className="text-[11px] text-[#53665c]">#{player.jerseyNumber || '--'} · {playerInitials(player)}</p>}
            </button>
          </div>
        )
      })}
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
            className={`min-w-28 shrink-0 rounded-lg border px-3 py-3 text-left ${
              selectedPlayerId === player.id ? 'border-[#10201a] bg-[#f7c948] text-[#10201a]' : 'border-[#d8ded5] bg-white'
            }`}
          >
            <p className="font-black">{player.firstName}</p>
            <p className="text-xs font-bold text-[#53665c]">#{player.jerseyNumber || '--'}</p>
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
