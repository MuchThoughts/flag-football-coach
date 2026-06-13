'use client'

import { useEffect, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import {
  AlertTriangle,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Cloud,
  Copy,
  Eye,
  LogIn,
  LogOut,
  Lock,
  Plus,
  RotateCcw,
  Save,
  Search,
  Trash2,
  Unlock,
  Users,
  Play,
  Settings,
  Download,
  Upload
} from 'lucide-react'
import { mergeDriveNotes, type DriveNoteDraft } from '@/lib/drive-notes'
import { applySourceAssignmentsToRepeats, getLinkedRepeatCount, resetRepeatedDriveFromSource } from '@/lib/drive-patterns'
import { autoFillDrive, computeUsage, getDriveWarnings, getFairPlayWarnings, getRating, isPlayerAvailable } from '@/lib/fair-play'
import { getGameSummary, getResultCount } from '@/lib/game-summary'
import { applyLineupTemplateToDrive } from '@/lib/lineup-templates'
import { SLOTS_BY_UNIT } from '@/lib/positions'
import { createDrive, initialAppState } from '@/lib/sample-data'
import { computeSeasonUsage, getAttendanceSummary } from '@/lib/season-analytics'
import {
  acceptSupabaseAssistantInvite,
  appSettingsFromMembership,
  createSupabaseAssistantInvite,
  ensureSupabaseMembership,
  loadSupabaseState,
  saveSupabaseState,
  subscribeToSupabaseState,
  type SupabaseMembership
} from '@/lib/supabase/app-state'
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/client'
import type { AppSettings, AppState, Drive, DriveNote, DriveResult, Game, LineupTemplate, Player, PlaybookPlay, PracticePlan, PracticeTemplate, Unit } from '@/lib/types'

type View = 'dashboard' | 'roster' | 'planner' | 'gameday' | 'more'
type QuickNoteField = 'whatWorked' | 'whatFailed' | 'playerNotes' | 'playCalls' | 'freeform'
type SyncStatus = 'local' | 'signed_out' | 'loading' | 'synced' | 'saving' | 'error'

interface DragItem {
  playerId: string
  fromSlot?: string
  driveId?: string
}

const storageKey = 'flag-football-coach:v1'

const resultOptions: Array<Exclude<DriveResult, ''>> = ['TD', 'Stop', 'Turnover', 'Extra Point', 'Punt', 'End Half', 'End Game', 'TD Allowed']
const summaryResultOptions: Array<Exclude<DriveResult, ''>> = ['TD', 'Stop', 'Turnover', 'TD Allowed']

function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
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

function driveSortValue(drive: Drive) {
  return drive.driveNumber * 10 + (drive.unit === 'offense' ? 0 : 1)
}

function getDriveNoteCount(notes: DriveNote) {
  return [notes.whatWorked, notes.whatFailed, notes.playerNotes, notes.playCalls, notes.freeform].filter((value) => value.trim()).length
}

function createStarterDrives(gameId: string, driveCount = 3) {
  const nextDrives: Drive[] = []

  Array.from({ length: driveCount }).forEach((_, index) => {
    const driveNumber = index + 1
    nextDrives.push(createDrive(uid('drive'), 'offense', driveNumber, gameId))
    nextDrives.push(createDrive(uid('drive'), 'defense', driveNumber, gameId))
  })

  return nextDrives
}

function removePlayerFromOpenAssignments(drives: Drive[], playerId: string, gameId?: string) {
  return drives.map((drive) => {
    if ((gameId && drive.gameId !== gameId) || drive.status === 'completed') {
      return drive
    }

    const assignments = { ...drive.assignments }
    let changed = false

    Object.keys(assignments).forEach((slotCode) => {
      if (assignments[slotCode] === playerId) {
        assignments[slotCode] = null
        changed = true
      }
    })

    return changed
      ? {
          ...drive,
          assignments,
          isCustomized: drive.isRepeated ? true : drive.isCustomized
        }
      : drive
  })
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
  const [activeView, setActiveView] = useState<View>('dashboard')
  const [loaded, setLoaded] = useState(false)
  const [history, setHistory] = useState<string[]>([])
  const [dragItem, setDragItem] = useState<DragItem | null>(null)
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null)
  const [editingPlayerId, setEditingPlayerId] = useState<string | null>(initialAppState.players[0]?.id || null)
  const [newPlayer, setNewPlayer] = useState({ firstName: '', lastName: '', jerseyNumber: '' })
  const [newGame, setNewGame] = useState({ opponent: '', date: '', location: '' })
  const [newPractice, setNewPractice] = useState({
    title: '',
    date: '',
    warmup: '',
    skills: '',
    offense: '',
    defense: '',
    scrimmage: '',
    notes: ''
  })
  const [newPlay, setNewPlay] = useState({
    name: '',
    formation: '',
    positions: '',
    notes: '',
    tags: ''
  })
  const [newTemplateName, setNewTemplateName] = useState('')
  const [newPracticeTemplateName, setNewPracticeTemplateName] = useState('')
  const [playFilter, setPlayFilter] = useState('')
  const [backupText, setBackupText] = useState('')
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(isSupabaseConfigured() ? 'loading' : 'local')
  const [syncMessage, setSyncMessage] = useState(isSupabaseConfigured() ? 'Checking session' : 'Local only')
  const [syncUserId, setSyncUserId] = useState<string | null>(null)
  const [syncUserEmail, setSyncUserEmail] = useState('')
  const [syncTeamId, setSyncTeamId] = useState<string | null>(null)
  const [syncMembership, setSyncMembership] = useState<SupabaseMembership | null>(null)
  const [syncReady, setSyncReady] = useState(false)
  const [authForm, setAuthForm] = useState({ email: '', password: '' })
  const [assistantInviteForm, setAssistantInviteForm] = useState({
    email: '',
    canAddNotes: true,
    canAdvanceDrive: false
  })
  const [assistantInviteToken, setAssistantInviteToken] = useState('')
  const [assistantInviteAcceptCode, setAssistantInviteAcceptCode] = useState('')
  const saveTimerRef = useRef<number | null>(null)
  const applyingRemoteStateRef = useRef(false)

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
    const raw = window.localStorage.getItem(storageKey)
    if (raw) {
      try {
        const saved = JSON.parse(raw) as AppState
        applyAppState(saved, null)
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
        if (error) {
          throw error
        }

        if (!data.session?.user) {
          setSyncStatus('signed_out')
          setSyncMessage('Signed out')
          return
        }

        if (canceled) {
          return
        }

        await hydrateSupabaseSession(data.session.user.id, data.session.user.email || '', getCurrentState())
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
    if (!loaded) {
      return
    }

    const state: AppState = {
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

    window.localStorage.setItem(storageKey, JSON.stringify(state))

    if (!isSupabaseConfigured() || !syncReady || !syncTeamId || !syncUserId || applyingRemoteStateRef.current) {
      return
    }

    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
    }

    setSyncStatus('saving')
    setSyncMessage('Saving to cloud')
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
    if (!syncReady || !syncTeamId || !syncUserId) {
      return
    }

    const channel = subscribeToSupabaseState(syncTeamId, (row) => {
      if (row.updated_by === syncUserId) {
        return
      }

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

  const selectedGame = games.find((game) => game.id === selectedGameId) || games[0]
  const gameDrives = drives
    .filter((drive) => drive.gameId === selectedGame?.id)
    .sort((a, b) => driveSortValue(a) - driveSortValue(b))
  const selectedDrive = gameDrives.find((drive) => drive.id === selectedDriveId) || gameDrives[0]
  const currentDrive = gameDrives.find((drive) => drive.status === 'current') || gameDrives.find((drive) => drive.status === 'planned') || selectedDrive
  const availability = availabilityByGame[selectedGame?.id || ''] || {}
  const assignedPlayerIds = selectedDrive ? Object.values(selectedDrive.assignments).filter(Boolean) : []
  const gameDayDisplayDrive = selectedDrive || currentDrive
  const gameDayAssignedPlayerIds = gameDayDisplayDrive ? Object.values(gameDayDisplayDrive.assignments).filter(Boolean) : []
  const availablePlayers = players.filter((player) => player.active && isPlayerAvailable(player.id, availability))
  const unavailablePlayers = players.filter((player) => player.active && !isPlayerAvailable(player.id, availability))
  const benchPlayers = availablePlayers.filter((player) => !assignedPlayerIds.includes(player.id))
  const gameDayBenchPlayers = availablePlayers.filter((player) => !gameDayAssignedPlayerIds.includes(player.id))
  const driveWarnings = selectedDrive ? getDriveWarnings(selectedDrive, players, availability) : []
  const fairPlayWarnings = getFairPlayWarnings(players, gameDrives, availability)
  const gameSummary = getGameSummary(gameDrives)
  const usage = computeUsage(players, gameDrives, availability)
  const seasonDrives = drives.filter((drive) => games.some((game) => game.id === drive.gameId))
  const seasonSummary = getGameSummary(seasonDrives)
  const seasonUsage = computeSeasonUsage(players, seasonDrives, availabilityByGame)
  const attendanceSummary = getAttendanceSummary(players, games, availabilityByGame)
  const selectedPlayer = players.find((player) => player.id === selectedPlayerId)
  const editingPlayer = players.find((player) => player.id === editingPlayerId) || players[0]
  const isAssistantMode = appSettings.role === 'assistant'
  const canEditLineups = appSettings.role === 'head'
  const canAddGameDayNotes = appSettings.role === 'head' || appSettings.assistantCanAddNotes
  const canAdvanceDrive = appSettings.role === 'head' || appSettings.assistantCanAdvanceDrive

  useEffect(() => {
    if (isAssistantMode && (activeView === 'roster' || activeView === 'planner')) {
      setActiveView('gameday')
    }
  }, [activeView, isAssistantMode])

  function snapshot() {
    return JSON.stringify({
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
    } satisfies AppState)
  }

  function remember() {
    setHistory((items) => [snapshot(), ...items].slice(0, 20))
  }

  function undo() {
    const latest = history[0]
    if (!latest) {
      return
    }

    const saved = JSON.parse(latest) as AppState
    setTeam(saved.team)
    setPlayers(saved.players)
    setGames(saved.games)
    setSelectedGameId(saved.selectedGameId)
    setDrives(saved.drives)
    setSelectedDriveId(saved.selectedDriveId)
    setAvailabilityByGame(saved.availabilityByGame)
    setPractices(saved.practices)
    setPracticeTemplates(saved.practiceTemplates || initialAppState.practiceTemplates)
    setPlays(saved.plays)
    setLineupTemplates(saved.lineupTemplates || [])
    setAppSettings(saved.appSettings || initialAppState.appSettings)
    setHistory((items) => items.slice(1))
  }

  function getPlayer(playerId?: string | null) {
    return players.find((player) => player.id === playerId)
  }

  function addPlayer() {
    if (!newPlayer.firstName.trim()) {
      return
    }

    remember()
    const player: Player = {
      id: uid('player'),
      teamId: team.id,
      firstName: newPlayer.firstName.trim(),
      lastName: newPlayer.lastName.trim(),
      jerseyNumber: newPlayer.jerseyNumber.trim(),
      active: true,
      offenseRatings: { QB: 3, C: 3, WR: 3, RB: 3 },
      defenseRatings: { R: 3, S: 3, MLB: 3, CB: 3, E: 3 },
      notes: ''
    }

    setPlayers((items) => [...items, player])
    setAvailabilityByGame((byGame) =>
      games.reduce<Record<string, Record<string, boolean>>>((next, game) => {
        next[game.id] = {
          ...(byGame[game.id] || {}),
          [player.id]: true
        }
        return next
      }, { ...byGame })
    )
    setEditingPlayerId(player.id)
    setNewPlayer({ firstName: '', lastName: '', jerseyNumber: '' })
  }

  function updatePlayer(playerId: string, updates: Partial<Player>) {
    remember()
    setPlayers((items) => items.map((player) => (player.id === playerId ? { ...player, ...updates } : player)))
  }

  function setPlayerActive(playerId: string, active: boolean) {
    remember()
    setPlayers((items) => items.map((player) => (player.id === playerId ? { ...player, active } : player)))
    setAvailabilityByGame((byGame) =>
      games.reduce<Record<string, Record<string, boolean>>>((next, game) => {
        next[game.id] = {
          ...(byGame[game.id] || {}),
          [playerId]: active
        }
        return next
      }, { ...byGame })
    )

    if (!active) {
      setDrives((items) => removePlayerFromOpenAssignments(items, playerId))
    }
  }

  function updateRating(playerId: string, unit: Unit, ratingKey: string, delta: number) {
    remember()
    setPlayers((items) =>
      items.map((player) => {
        if (player.id !== playerId) {
          return player
        }

        const ratings = unit === 'offense' ? player.offenseRatings : player.defenseRatings
        const nextValue = Math.max(0, Math.min(5, (ratings[ratingKey] || 0) + delta))

        return unit === 'offense'
          ? { ...player, offenseRatings: { ...ratings, [ratingKey]: nextValue } }
          : { ...player, defenseRatings: { ...ratings, [ratingKey]: nextValue } }
      })
    )
  }

  function toggleAvailability(playerId: string) {
    const player = players.find((item) => item.id === playerId)
    if (!player?.active) {
      return
    }

    const nextAvailable = availability[playerId] === false
    remember()
    setAvailabilityByGame((byGame) => ({
      ...byGame,
      [selectedGame.id]: {
        ...availability,
        [playerId]: nextAvailable
      }
    }))

    if (!nextAvailable) {
      setDrives((items) => removePlayerFromOpenAssignments(items, playerId, selectedGame.id))
    }
  }

  function setSelectedGameAttendance(available: boolean) {
    remember()
    setAvailabilityByGame((byGame) => ({
      ...byGame,
      [selectedGame.id]: players.reduce<Record<string, boolean>>((next, player) => {
        next[player.id] = player.active ? available : false
        return next
      }, {})
    }))

    if (!available) {
      setDrives((items) =>
        players.reduce((nextDrives, player) => removePlayerFromOpenAssignments(nextDrives, player.id, selectedGame.id), items)
      )
    }
  }

  function resetSelectedGameAttendance() {
    remember()
    setAvailabilityByGame((byGame) => ({
      ...byGame,
      [selectedGame.id]: players.reduce<Record<string, boolean>>((next, player) => {
        next[player.id] = player.active
        return next
      }, {})
    }))
    setDrives((items) =>
      players
        .filter((player) => !player.active)
        .reduce((nextDrives, player) => removePlayerFromOpenAssignments(nextDrives, player.id, selectedGame.id), items)
    )
  }

  function selectGame(gameId: string, nextView: View = 'dashboard') {
    const nextGame = games.find((game) => game.id === gameId)
    if (!nextGame) {
      return
    }

    const nextDrive = drives
      .filter((drive) => drive.gameId === nextGame.id)
      .sort((a, b) => driveSortValue(a) - driveSortValue(b))[0]

    setSelectedGameId(nextGame.id)
    setSelectedDriveId(nextDrive?.id || '')
    setActiveView(nextView)
  }

  function addGame(copySelectedPlan = false) {
    if (!newGame.opponent.trim()) {
      return
    }

    remember()
    const game: Game = {
      id: uid('game'),
      teamId: team.id,
      opponent: newGame.opponent.trim(),
      date: newGame.date,
      location: newGame.location.trim(),
      status: 'scheduled',
      patternLength: 3
    }
    const sourceDrives = gameDrives.sort((a, b) => driveSortValue(a) - driveSortValue(b))
    const starterDrives = copySelectedPlan
      ? sourceDrives.map((drive) => ({
          ...drive,
          id: uid('drive'),
          gameId: game.id,
          sourceDriveId: undefined,
          isRepeated: false,
          isCustomized: drive.isRepeated || drive.isCustomized,
          status: 'planned' as const,
          locked: false,
          startedAt: undefined,
          endedAt: undefined,
          result: '' as const,
          notes: emptyNote()
        }))
      : createStarterDrives(game.id)

    setGames((items) => [...items, game])
    setDrives((items) => [...items, ...starterDrives])
    setAvailabilityByGame((byGame) => ({
      ...byGame,
      [game.id]: players.reduce<Record<string, boolean>>((next, player) => {
        next[player.id] = player.active
        return next
      }, {})
    }))
    setSelectedGameId(game.id)
    setSelectedDriveId(starterDrives[0]?.id || '')
    setNewGame({ opponent: '', date: '', location: '' })
  }

  function deleteSelectedGame() {
    if (games.length <= 1 || !selectedGame) {
      return
    }

    remember()
    const nextGame = games.find((game) => game.id !== selectedGame.id)
    const nextDrive = nextGame
      ? drives
          .filter((drive) => drive.gameId === nextGame.id)
          .sort((a, b) => driveSortValue(a) - driveSortValue(b))[0]
      : undefined

    setGames((items) => items.filter((game) => game.id !== selectedGame.id))
    setDrives((items) => items.filter((drive) => drive.gameId !== selectedGame.id))
    setAvailabilityByGame((byGame) => {
      const nextAvailability = { ...byGame }
      delete nextAvailability[selectedGame.id]
      return nextAvailability
    })
    setSelectedGameId(nextGame?.id || '')
    setSelectedDriveId(nextDrive?.id || '')
  }

  function updateSelectedGame(updates: Partial<Game>) {
    remember()
    setGames((items) => items.map((game) => (game.id === selectedGame.id ? { ...game, ...updates } : game)))
  }

  function updateTeam(updates: Partial<typeof team>) {
    remember()
    setTeam((current) => ({ ...current, ...updates }))
  }

  function updateAppSettings(updates: Partial<AppSettings>) {
    remember()
    setAppSettings((current) => ({ ...current, ...updates }))
  }

  function createNewDrive(unit: Unit) {
    remember()
    const nextNumber = Math.max(0, ...gameDrives.filter((drive) => drive.unit === unit).map((drive) => drive.driveNumber)) + 1
    const drive = createDrive(uid('drive'), unit, nextNumber, selectedGame.id)
    setDrives((items) => [...items, drive])
    setSelectedDriveId(drive.id)
    setActiveView('planner')
  }

  function duplicateDrive() {
    if (!selectedDrive) {
      return
    }

    remember()
    const nextNumber =
      Math.max(0, ...gameDrives.filter((drive) => drive.unit === selectedDrive.unit).map((drive) => drive.driveNumber)) + 1
    const drive: Drive = {
      ...selectedDrive,
      id: uid('drive'),
      driveNumber: nextNumber,
      isRepeated: false,
      isCustomized: true,
      sourceDriveId: undefined,
      status: 'planned',
      locked: false,
      startedAt: undefined,
      endedAt: undefined,
      result: '',
      notes: emptyNote()
    }
    setDrives((items) => [...items, drive])
    setSelectedDriveId(drive.id)
  }

  function deleteDrive() {
    if (!selectedDrive || gameDrives.length <= 1) {
      return
    }

    remember()
    const remaining = gameDrives.filter((drive) => drive.id !== selectedDrive.id)
    setDrives((items) => items.filter((drive) => drive.id !== selectedDrive.id))
    setSelectedDriveId(remaining[0]?.id || '')
  }

  function toggleDriveLock() {
    if (!selectedDrive) {
      return
    }

    remember()
    setDrives((items) => items.map((drive) => (drive.id === selectedDrive.id ? { ...drive, locked: !drive.locked } : drive)))
  }

  function fillDrive() {
    if (!selectedDrive || selectedDrive.locked) {
      return
    }

    remember()
    setDrives((items) =>
      items.map((drive) =>
        drive.id === selectedDrive.id ? autoFillDrive(drive, players, availability, gameDrives) : drive
      )
    )
  }

  function fillOpenDrives() {
    remember()
    setDrives((items) => {
      let nextItems = [...items]
      let nextGameDrives = nextItems
        .filter((drive) => drive.gameId === selectedGame.id)
        .sort((a, b) => driveSortValue(a) - driveSortValue(b))

      nextGameDrives.forEach((gameDrive) => {
        if (gameDrive.locked || gameDrive.status === 'completed') {
          return
        }

        const filledDrive = autoFillDrive(gameDrive, players, availability, nextGameDrives)
        nextItems = nextItems.map((drive) => (drive.id === filledDrive.id ? filledDrive : drive))
        nextGameDrives = nextGameDrives.map((drive) => (drive.id === filledDrive.id ? filledDrive : drive))
      })

      return nextItems
    })
  }

  function saveSelectedDriveAsTemplate() {
    if (!selectedDrive) {
      return
    }

    const templateName = newTemplateName.trim() || `${selectedDrive.unit === 'offense' ? 'Offense' : 'Defense'} Drive ${selectedDrive.driveNumber}`
    const now = new Date().toISOString()

    remember()
    setLineupTemplates((items) => {
      const existingTemplate = items.find((template) => template.unit === selectedDrive.unit && template.name.toLowerCase() === templateName.toLowerCase())
      if (existingTemplate) {
        return items.map((template) =>
          template.id === existingTemplate.id
            ? {
                ...template,
                assignments: { ...selectedDrive.assignments },
                updatedAt: now
              }
            : template
        )
      }

      const template: LineupTemplate = {
        id: uid('template'),
        teamId: team.id,
        name: templateName,
        unit: selectedDrive.unit,
        assignments: { ...selectedDrive.assignments },
        createdAt: now,
        updatedAt: now
      }

      return [template, ...items]
    })
    setNewTemplateName('')
  }

  function applyTemplateToSelectedDrive(templateId: string) {
    if (!selectedDrive) {
      return
    }

    const template = lineupTemplates.find((item) => item.id === templateId)
    if (!template) {
      return
    }

    remember()
    setDrives((items) =>
      items.map((drive) =>
        drive.id === selectedDrive.id ? applyLineupTemplateToDrive(drive, template, players, availability) : drive
      )
    )
  }

  function deleteLineupTemplate(templateId: string) {
    remember()
    setLineupTemplates((items) => items.filter((template) => template.id !== templateId))
  }

  function generateRepeats() {
    remember()
    const nextDrives: Drive[] = []

    ;(['offense', 'defense'] as Unit[]).forEach((unit) => {
      const baseDrives = gameDrives
        .filter((drive) => drive.unit === unit && !drive.isRepeated)
        .sort((a, b) => a.driveNumber - b.driveNumber)
        .slice(0, selectedGame.patternLength)
      const maxNumber = Math.max(0, ...gameDrives.filter((drive) => drive.unit === unit).map((drive) => drive.driveNumber))

      baseDrives.forEach((source, index) => {
        nextDrives.push({
          ...source,
          id: uid(`repeat-${unit}`),
          driveNumber: maxNumber + index + 1,
          sourceDriveId: source.id,
          isRepeated: true,
          isCustomized: false,
          status: 'planned',
          locked: false,
          result: '',
          notes: emptyNote(),
          startedAt: undefined,
          endedAt: undefined
        })
      })
    })

    setDrives((items) => [...items, ...nextDrives])
  }

  function applySelectedDriveToRepeats() {
    if (!selectedDrive) {
      return
    }

    remember()
    setDrives((items) => applySourceAssignmentsToRepeats(items, selectedDrive.id))
  }

  function resetSelectedRepeatFromSource() {
    if (!selectedDrive?.isRepeated) {
      return
    }

    remember()
    setDrives((items) => resetRepeatedDriveFromSource(items, selectedDrive.id))
  }

  function movePlayerToSlot(playerId: string, toSlot: string, fromSlot?: string, driveId = selectedDrive?.id) {
    const targetDrive = gameDrives.find((drive) => drive.id === driveId)
    if (!targetDrive || targetDrive.locked || !isPlayerAvailable(playerId, availability)) {
      return
    }

    remember()
    setDrives((items) =>
      items.map((drive) => {
        if (drive.id !== targetDrive.id) {
          return drive
        }

        const assignments = { ...drive.assignments }
        const targetPlayerId = assignments[toSlot]

        Object.keys(assignments).forEach((slotCode) => {
          if (assignments[slotCode] === playerId) {
            assignments[slotCode] = null
          }
        })

        assignments[toSlot] = playerId

        if (targetPlayerId && targetPlayerId !== playerId && fromSlot) {
          assignments[fromSlot] = targetPlayerId
        }

        return {
          ...drive,
          assignments,
          isCustomized: drive.isRepeated ? true : drive.isCustomized
        }
      })
    )
  }

  function clearSlot(slotCode: string, driveId = selectedDrive?.id) {
    const targetDrive = gameDrives.find((drive) => drive.id === driveId)
    if (!targetDrive || targetDrive.locked || !targetDrive.assignments[slotCode]) {
      return
    }

    remember()
    setDrives((items) =>
      items.map((drive) =>
        drive.id === targetDrive.id
          ? {
              ...drive,
              assignments: { ...drive.assignments, [slotCode]: null },
              isCustomized: drive.isRepeated ? true : drive.isCustomized
            }
          : drive
      )
    )
  }

  function dropOnSlot(event: DragEvent<HTMLDivElement>, slotCode: string, driveId = selectedDrive?.id) {
    event.preventDefault()
    if (dragItem) {
      movePlayerToSlot(dragItem.playerId, slotCode, dragItem.fromSlot, driveId)
    }
    setDragItem(null)
  }

  function dropOnBench(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    if (!selectedDrive || !dragItem?.fromSlot) {
      return
    }
    clearSlot(dragItem.fromSlot, dragItem.driveId)
    setDragItem(null)
  }

  function startDrive(driveId = selectedDrive?.id) {
    if (!driveId) {
      return
    }

    remember()
    const now = new Date().toISOString()
    setDrives((items) =>
      items.map((drive) => {
        if (drive.gameId !== selectedGame.id) {
          return drive
        }
        if (drive.id === driveId) {
          return { ...drive, status: 'current', startedAt: drive.startedAt || now }
        }
        return drive.status === 'current' ? { ...drive, status: 'planned' } : drive
      })
    )
    setGames((items) => items.map((game) => (game.id === selectedGame.id ? { ...game, status: 'in_progress' } : game)))
    setSelectedDriveId(driveId)
    setActiveView('gameday')
  }

  function completeCurrentDrive(result: DriveResult, noteDraft: DriveNoteDraft = {}) {
    if (!currentDrive) {
      return
    }

    remember()
    const now = new Date().toISOString()
    setDrives((items) =>
      items.map((drive) =>
        drive.id === currentDrive.id
          ? {
              ...drive,
              status: 'completed',
              result,
              endedAt: now,
              notes: mergeDriveNotes(drive.notes, result, noteDraft)
            }
          : drive
      )
    )
  }

  function completeCurrentDriveAndAdvance(result: DriveResult, noteDraft: DriveNoteDraft = {}) {
    if (!currentDrive) {
      return
    }

    remember()
    const now = new Date().toISOString()
    const currentIndex = gameDrives.findIndex((drive) => drive.id === currentDrive.id)
    const nextDrive = gameDrives.slice(currentIndex + 1).find((drive) => drive.status !== 'completed')

    setDrives((items) =>
      items.map((drive) => {
        if (drive.id === currentDrive.id) {
          return {
            ...drive,
            status: 'completed',
            result,
            endedAt: now,
            notes: mergeDriveNotes(drive.notes, result, noteDraft)
          }
        }

        if (nextDrive && drive.id === nextDrive.id) {
          return {
            ...drive,
            status: 'current',
            startedAt: drive.startedAt || now
          }
        }

        return drive
      })
    )

    if (nextDrive) {
      setSelectedDriveId(nextDrive.id)
    } else {
      setGames((items) => items.map((game) => (game.id === selectedGame.id ? { ...game, status: 'completed' } : game)))
    }
  }

  function updateDriveNote(field: keyof DriveNote, value: string, driveId?: string) {
    const targetDrive = driveId
      ? gameDrives.find((drive) => drive.id === driveId)
      : activeView === 'gameday'
        ? currentDrive
        : selectedDrive
    if (!targetDrive) {
      return
    }

    remember()
    setDrives((items) =>
      items.map((drive) =>
        drive.id === targetDrive.id
          ? {
              ...drive,
              notes: {
                ...drive.notes,
                [field]: value
              }
            }
          : drive
      )
    )
  }

  function appendDriveNote(field: QuickNoteField, value: string, driveId?: string) {
    const targetDrive = driveId
      ? gameDrives.find((drive) => drive.id === driveId)
      : activeView === 'gameday'
        ? currentDrive
        : selectedDrive
    if (!targetDrive) {
      return
    }

    remember()
    setDrives((items) =>
      items.map((drive) => {
        if (drive.id !== targetDrive.id) {
          return drive
        }

        const currentValue = drive.notes[field]
        return {
          ...drive,
          notes: {
            ...drive.notes,
            [field]: currentValue ? `${currentValue}; ${value}` : value
          }
        }
      })
    )
  }

  function addPractice() {
    if (!newPractice.title.trim()) {
      return
    }

    remember()
    const practice: PracticePlan = {
      id: uid('practice'),
      teamId: team.id,
      title: newPractice.title.trim(),
      date: newPractice.date,
      warmup: newPractice.warmup,
      skills: newPractice.skills,
      offense: newPractice.offense,
      defense: newPractice.defense,
      scrimmage: newPractice.scrimmage,
      notes: newPractice.notes
    }

    setPractices((items) => [practice, ...items])
    setNewPractice({
      title: '',
      date: '',
      warmup: '',
      skills: '',
      offense: '',
      defense: '',
      scrimmage: '',
      notes: ''
    })
  }

  function updatePractice(practiceId: string, updates: Partial<PracticePlan>) {
    remember()
    setPractices((items) => items.map((practice) => (practice.id === practiceId ? { ...practice, ...updates } : practice)))
  }

  function copyPractice(practiceId: string) {
    const practice = practices.find((item) => item.id === practiceId)
    if (!practice) {
      return
    }

    remember()
    setPractices((items) => [
      {
        ...practice,
        id: uid('practice'),
        title: `${practice.title} Copy`,
        date: ''
      },
      ...items
    ])
  }

  function deletePractice(practiceId: string) {
    remember()
    setPractices((items) => items.filter((practice) => practice.id !== practiceId))
  }

  function savePracticeTemplateFromPractice(practiceId: string) {
    const practice = practices.find((item) => item.id === practiceId)
    if (!practice) {
      return
    }

    const now = new Date().toISOString()
    const templateName = newPracticeTemplateName.trim() || `${practice.title} Template`
    remember()
    setPracticeTemplates((items) => {
      const existingTemplate = items.find((template) => template.name.toLowerCase() === templateName.toLowerCase())
      if (existingTemplate) {
        return items.map((template) =>
          template.id === existingTemplate.id
            ? {
                ...template,
                warmup: practice.warmup,
                skills: practice.skills,
                offense: practice.offense,
                defense: practice.defense,
                scrimmage: practice.scrimmage,
                notes: practice.notes,
                updatedAt: now
              }
            : template
        )
      }

      const template: PracticeTemplate = {
        id: uid('practice-template'),
        teamId: team.id,
        name: templateName,
        warmup: practice.warmup,
        skills: practice.skills,
        offense: practice.offense,
        defense: practice.defense,
        scrimmage: practice.scrimmage,
        notes: practice.notes,
        createdAt: now,
        updatedAt: now
      }

      return [template, ...items]
    })
    setNewPracticeTemplateName('')
  }

  function applyPracticeTemplate(templateId: string) {
    const template = practiceTemplates.find((item) => item.id === templateId)
    if (!template) {
      return
    }

    remember()
    setNewPractice({
      title: template.name,
      date: '',
      warmup: template.warmup,
      skills: template.skills,
      offense: template.offense,
      defense: template.defense,
      scrimmage: template.scrimmage,
      notes: template.notes
    })
  }

  function deletePracticeTemplate(templateId: string) {
    remember()
    setPracticeTemplates((items) => items.filter((template) => template.id !== templateId))
  }

  function addPlay() {
    if (!newPlay.name.trim()) {
      return
    }

    remember()
    const play: PlaybookPlay = {
      id: uid('play'),
      teamId: team.id,
      name: newPlay.name.trim(),
      formation: newPlay.formation.trim(),
      positions: newPlay.positions,
      notes: newPlay.notes,
      tags: newPlay.tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)
    }

    setPlays((items) => [play, ...items])
    setNewPlay({ name: '', formation: '', positions: '', notes: '', tags: '' })
  }

  function updatePlay(playId: string, updates: Partial<PlaybookPlay>) {
    remember()
    setPlays((items) => items.map((play) => (play.id === playId ? { ...play, ...updates } : play)))
  }

  function deletePlay(playId: string) {
    remember()
    setPlays((items) => items.filter((play) => play.id !== playId))
  }

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

  function exportBackup() {
    setBackupText(JSON.stringify(getCurrentState(), null, 2))
  }

  function importBackup() {
    if (!backupText.trim()) {
      return
    }

    try {
      const saved = JSON.parse(backupText) as AppState
      remember()
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
      setAppSettings(saved.appSettings || initialAppState.appSettings)
    } catch {
      setBackupText('Invalid backup JSON')
    }
  }

  function resetDemoData() {
    remember()
    setTeam(initialAppState.team)
    setPlayers(initialAppState.players)
    setGames(initialAppState.games)
    setSelectedGameId(initialAppState.selectedGameId)
    setDrives(initialAppState.drives)
    setSelectedDriveId(initialAppState.selectedDriveId)
    setAvailabilityByGame(initialAppState.availabilityByGame)
    setPractices(initialAppState.practices)
    setPracticeTemplates(initialAppState.practiceTemplates)
    setPlays(initialAppState.plays)
    setLineupTemplates(initialAppState.lineupTemplates)
    setAppSettings(initialAppState.appSettings)
    setNewTemplateName('')
    setNewPracticeTemplateName('')
    setPlayFilter('')
    setBackupText('')
  }

  async function authenticateSupabase(mode: 'sign-in' | 'sign-up') {
    if (!isSupabaseConfigured()) {
      setSyncStatus('local')
      setSyncMessage('Supabase env vars missing')
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

      if (result.error) {
        throw result.error
      }

      if (!result.data.session?.user) {
        setSyncStatus('signed_out')
        setSyncMessage('Check email confirmation')
        return
      }

      await hydrateSupabaseSession(result.data.session.user.id, result.data.session.user.email || email, getCurrentState())
      setAuthForm({ email: '', password: '' })
    } catch (error) {
      setSyncStatus('error')
      setSyncMessage(error instanceof Error ? error.message : 'Supabase auth failed')
    }
  }

  async function signOutSupabase() {
    if (!isSupabaseConfigured()) {
      return
    }

    try {
      await getSupabaseClient().auth.signOut()
    } finally {
      setSyncReady(false)
      setSyncUserId(null)
      setSyncUserEmail('')
      setSyncTeamId(null)
      setSyncMembership(null)
      setSyncStatus('signed_out')
      setSyncMessage('Signed out')
    }
  }

  async function saveCloudNow() {
    if (!syncTeamId || !syncUserId) {
      setSyncStatus('signed_out')
      setSyncMessage('Sign in to sync')
      return
    }

    try {
      setSyncStatus('saving')
      setSyncMessage('Saving to cloud')
      await saveSupabaseState(syncTeamId, getCurrentState(), syncUserId)
      setSyncStatus('synced')
      setSyncMessage('Cloud sync active')
    } catch (error) {
      setSyncStatus('error')
      setSyncMessage(error instanceof Error ? error.message : 'Cloud save failed')
    }
  }

  async function loadCloudNow() {
    if (!syncTeamId) {
      setSyncStatus('signed_out')
      setSyncMessage('Sign in to sync')
      return
    }

    try {
      setSyncStatus('loading')
      setSyncMessage('Loading cloud data')
      const snapshot = await loadSupabaseState(syncTeamId)
      if (snapshot?.state) {
        applyingRemoteStateRef.current = true
        applyAppState(snapshot.state, syncMembership)
        window.setTimeout(() => {
          applyingRemoteStateRef.current = false
        }, 500)
      }
      setSyncStatus('synced')
      setSyncMessage(snapshot?.state ? 'Cloud sync active' : 'No cloud data yet')
    } catch (error) {
      setSyncStatus('error')
      setSyncMessage(error instanceof Error ? error.message : 'Cloud load failed')
    }
  }

  async function createAssistantInvite() {
    if (!syncTeamId || !syncUserId) {
      setSyncStatus('signed_out')
      setSyncMessage('Sign in as head coach first')
      return
    }

    if (syncMembership?.role !== 'head_coach') {
      setSyncStatus('error')
      setSyncMessage('Only head coaches can invite assistants')
      return
    }

    try {
      setSyncStatus('saving')
      setSyncMessage('Creating invite')
      const token = await createSupabaseAssistantInvite(
        syncTeamId,
        assistantInviteForm.email,
        assistantInviteForm.canAddNotes,
        assistantInviteForm.canAdvanceDrive
      )
      setAssistantInviteToken(token)
      setAssistantInviteForm((current) => ({ ...current, email: '' }))
      setSyncStatus('synced')
      setSyncMessage('Invite code created')
    } catch (error) {
      setSyncStatus('error')
      setSyncMessage(error instanceof Error ? error.message : 'Invite failed')
    }
  }

  async function acceptAssistantInvite() {
    if (!syncUserId) {
      setSyncStatus('signed_out')
      setSyncMessage('Sign in before accepting an invite')
      return
    }

    const token = assistantInviteAcceptCode.trim()
    if (!token) {
      setSyncStatus('error')
      setSyncMessage('Invite code required')
      return
    }

    try {
      setSyncStatus('loading')
      setSyncMessage('Accepting invite')
      const membership = await acceptSupabaseAssistantInvite(token)
      setSyncTeamId(membership.teamId)
      setSyncMembership(membership)
      setAppSettings((current) => appSettingsFromMembership(membership, current))
      const snapshot = await loadSupabaseState(membership.teamId)
      if (snapshot?.state) {
        applyingRemoteStateRef.current = true
        applyAppState(snapshot.state, membership)
        window.setTimeout(() => {
          applyingRemoteStateRef.current = false
        }, 500)
      }
      setAssistantInviteAcceptCode('')
      setSyncReady(true)
      setSyncStatus('synced')
      setSyncMessage('Assistant access active')
      setActiveView('gameday')
    } catch (error) {
      setSyncStatus('error')
      setSyncMessage(error instanceof Error ? error.message : 'Invite failed')
    }
  }

  return (
    <main className="min-h-screen pb-24 lg:pb-0">
      <div className="mx-auto flex w-full max-w-7xl gap-5 px-3 py-3 sm:px-5 lg:px-6">
        <aside className="sticky top-4 hidden h-[calc(100vh-2rem)] w-64 shrink-0 rounded-lg border border-[#d8ded5] bg-white/86 p-3 shadow-sm backdrop-blur lg:block">
          <div className="rounded-lg bg-[#10201a] p-4 text-white">
            <p className="text-xs uppercase text-[#f7c948]">{team.ageGroup}</p>
            <h1 className="mt-1 font-display text-2xl font-black">{team.name}</h1>
            <p className="text-sm text-white/70">{team.season}</p>
          </div>
          {isAssistantMode && (
            <div className="mt-3 flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-sm font-black text-white ring-1 ring-white/20">
              <Eye size={16} />
              Assistant View
            </div>
          )}
          <nav className="mt-4 space-y-1">
            <NavButton active={activeView === 'dashboard'} icon={<ClipboardList size={18} />} label="Dashboard" onClick={() => setActiveView('dashboard')} />
            {!isAssistantMode && <NavButton active={activeView === 'roster'} icon={<Users size={18} />} label="Roster" onClick={() => setActiveView('roster')} />}
            {!isAssistantMode && <NavButton active={activeView === 'planner'} icon={<CalendarDays size={18} />} label="Planner" onClick={() => setActiveView('planner')} />}
            <NavButton active={activeView === 'gameday'} icon={<Play size={18} />} label="Game Day" onClick={() => setActiveView('gameday')} />
            <NavButton active={activeView === 'more'} icon={<Settings size={18} />} label="More" onClick={() => setActiveView('more')} />
          </nav>
          <button
            type="button"
            onClick={undo}
            disabled={history.length === 0}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-[#d8ded5] px-3 py-2 text-sm font-bold text-[#10201a] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RotateCcw size={16} />
            Undo
          </button>
        </aside>

        <section className="min-w-0 flex-1">
          <header className="mb-3 rounded-lg border border-[#d8ded5] bg-white/88 p-3 shadow-sm backdrop-blur lg:hidden">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase text-[#53665c]">{team.ageGroup}</p>
                <h1 className="font-display text-2xl font-black">{team.name}</h1>
              </div>
              <button
                type="button"
                onClick={undo}
                disabled={history.length === 0}
                className="rounded-lg border border-[#d8ded5] p-3 text-[#10201a] disabled:opacity-40"
                aria-label="Undo"
              >
                <RotateCcw size={18} />
              </button>
            </div>
          </header>

          {activeView === 'dashboard' && (
            <DashboardView
              selectedGame={selectedGame}
              selectedGameId={selectedGameId}
              games={games}
              drives={drives}
              currentDrive={currentDrive}
              availablePlayers={availablePlayers}
              unavailablePlayers={unavailablePlayers}
              gameDrives={gameDrives}
              gameSummary={gameSummary}
              driveWarnings={driveWarnings}
              fairPlayWarnings={fairPlayWarnings}
              newGame={newGame}
              setNewGame={setNewGame}
              addGame={addGame}
              selectGame={selectGame}
              deleteSelectedGame={deleteSelectedGame}
              startDrive={startDrive}
              setActiveView={setActiveView}
              isAssistantMode={isAssistantMode}
            />
          )}

          {activeView === 'roster' && !isAssistantMode && (
            <RosterView
              players={players}
              availability={availability}
              editingPlayer={editingPlayer}
              newPlayer={newPlayer}
              setNewPlayer={setNewPlayer}
              addPlayer={addPlayer}
              setEditingPlayerId={setEditingPlayerId}
              updatePlayer={updatePlayer}
              setPlayerActive={setPlayerActive}
              updateRating={updateRating}
              toggleAvailability={toggleAvailability}
              setSelectedGameAttendance={setSelectedGameAttendance}
              resetSelectedGameAttendance={resetSelectedGameAttendance}
            />
          )}

          {activeView === 'planner' && selectedDrive && !isAssistantMode && (
            <PlannerView
              selectedGame={selectedGame}
              games={games}
              setSelectedGameId={(gameId) => selectGame(gameId, 'planner')}
              updateSelectedGame={updateSelectedGame}
              gameDrives={gameDrives}
              selectedDrive={selectedDrive}
              selectedPlayer={selectedPlayer}
              players={players}
              benchPlayers={benchPlayers}
              unavailablePlayers={unavailablePlayers}
              driveWarnings={driveWarnings}
              fairPlayWarnings={fairPlayWarnings}
              setSelectedDriveId={setSelectedDriveId}
              createNewDrive={createNewDrive}
              duplicateDrive={duplicateDrive}
              deleteDrive={deleteDrive}
              toggleDriveLock={toggleDriveLock}
              fillDrive={fillDrive}
              fillOpenDrives={fillOpenDrives}
              generateRepeats={generateRepeats}
              applySelectedDriveToRepeats={applySelectedDriveToRepeats}
              resetSelectedRepeatFromSource={resetSelectedRepeatFromSource}
              lineupTemplates={lineupTemplates}
              newTemplateName={newTemplateName}
              setNewTemplateName={setNewTemplateName}
              saveSelectedDriveAsTemplate={saveSelectedDriveAsTemplate}
              applyTemplateToSelectedDrive={applyTemplateToSelectedDrive}
              deleteLineupTemplate={deleteLineupTemplate}
              setSelectedPlayerId={setSelectedPlayerId}
              setDragItem={setDragItem}
              dropOnSlot={dropOnSlot}
              dropOnBench={dropOnBench}
              movePlayerToSlot={movePlayerToSlot}
              clearSlot={clearSlot}
              getPlayer={getPlayer}
            />
          )}

          {activeView === 'gameday' && selectedDrive && (
            <GameDayView
              selectedGame={selectedGame}
              selectedDrive={selectedDrive}
              currentDrive={currentDrive}
              gameDrives={gameDrives}
              gameSummary={gameSummary}
              usage={usage}
              players={players}
              benchPlayers={gameDayBenchPlayers}
              driveWarnings={getDriveWarnings(selectedDrive, players, availability)}
              setSelectedDriveId={setSelectedDriveId}
              setActiveView={setActiveView}
              startDrive={startDrive}
              completeCurrentDrive={completeCurrentDrive}
              completeCurrentDriveAndAdvance={completeCurrentDriveAndAdvance}
              updateDriveNote={updateDriveNote}
              appendDriveNote={appendDriveNote}
              setDragItem={setDragItem}
              dropOnSlot={dropOnSlot}
              dropOnBench={dropOnBench}
              movePlayerToSlot={movePlayerToSlot}
              clearSlot={clearSlot}
              getPlayer={getPlayer}
              isAssistantMode={isAssistantMode}
              canAddNotes={canAddGameDayNotes}
              canAdvanceDrive={canAdvanceDrive}
              canEditLineups={canEditLineups}
            />
          )}

          {activeView === 'more' && (
            <MoreView
              practices={practices}
              practiceTemplates={practiceTemplates}
              plays={plays}
              usage={usage}
              seasonUsage={seasonUsage}
              attendanceSummary={attendanceSummary}
              players={players}
              games={games}
              gameDrives={gameDrives}
              gameSummary={gameSummary}
              seasonSummary={seasonSummary}
              seasonDriveCount={seasonDrives.length}
              team={team}
              updateTeam={updateTeam}
              appSettings={appSettings}
              updateAppSettings={updateAppSettings}
              supabaseConfigured={isSupabaseConfigured()}
              syncStatus={syncStatus}
              syncMessage={syncMessage}
              syncUserEmail={syncUserEmail}
              syncMembership={syncMembership}
              authForm={authForm}
              setAuthForm={setAuthForm}
              assistantInviteForm={assistantInviteForm}
              setAssistantInviteForm={setAssistantInviteForm}
              assistantInviteToken={assistantInviteToken}
              assistantInviteAcceptCode={assistantInviteAcceptCode}
              setAssistantInviteAcceptCode={setAssistantInviteAcceptCode}
              authenticateSupabase={authenticateSupabase}
              signOutSupabase={signOutSupabase}
              saveCloudNow={saveCloudNow}
              loadCloudNow={loadCloudNow}
              createAssistantInvite={createAssistantInvite}
              acceptAssistantInvite={acceptAssistantInvite}
              newPractice={newPractice}
              setNewPractice={setNewPractice}
              addPractice={addPractice}
              updatePractice={updatePractice}
              copyPractice={copyPractice}
              deletePractice={deletePractice}
              newPracticeTemplateName={newPracticeTemplateName}
              setNewPracticeTemplateName={setNewPracticeTemplateName}
              savePracticeTemplateFromPractice={savePracticeTemplateFromPractice}
              applyPracticeTemplate={applyPracticeTemplate}
              deletePracticeTemplate={deletePracticeTemplate}
              newPlay={newPlay}
              setNewPlay={setNewPlay}
              addPlay={addPlay}
              updatePlay={updatePlay}
              deletePlay={deletePlay}
              playFilter={playFilter}
              setPlayFilter={setPlayFilter}
              backupText={backupText}
              setBackupText={setBackupText}
              exportBackup={exportBackup}
              importBackup={importBackup}
              resetDemoData={resetDemoData}
            />
          )}
        </section>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-[#d8ded5] bg-white/94 px-2 py-2 shadow-[0_-10px_30px_rgba(16,32,26,0.12)] backdrop-blur lg:hidden safe-bottom">
        <div className={`mx-auto grid max-w-md gap-1 ${isAssistantMode ? 'grid-cols-3' : 'grid-cols-5'}`}>
          <MobileNavButton active={activeView === 'dashboard'} icon={<ClipboardList size={19} />} label="Home" onClick={() => setActiveView('dashboard')} />
          {!isAssistantMode && <MobileNavButton active={activeView === 'roster'} icon={<Users size={19} />} label="Roster" onClick={() => setActiveView('roster')} />}
          {!isAssistantMode && <MobileNavButton active={activeView === 'planner'} icon={<CalendarDays size={19} />} label="Plan" onClick={() => setActiveView('planner')} />}
          <MobileNavButton active={activeView === 'gameday'} icon={<Play size={19} />} label="Game" onClick={() => setActiveView('gameday')} />
          <MobileNavButton active={activeView === 'more'} icon={<Settings size={19} />} label="More" onClick={() => setActiveView('more')} />
        </div>
      </nav>
    </main>
  )
}

function DashboardView({
  selectedGame,
  selectedGameId,
  games,
  drives,
  currentDrive,
  availablePlayers,
  unavailablePlayers,
  gameDrives,
  gameSummary,
  driveWarnings,
  fairPlayWarnings,
  newGame,
  setNewGame,
  addGame,
  selectGame,
  deleteSelectedGame,
  startDrive,
  setActiveView,
  isAssistantMode
}: {
  selectedGame: Game
  selectedGameId: string
  games: Game[]
  drives: Drive[]
  currentDrive: Drive
  availablePlayers: Player[]
  unavailablePlayers: Player[]
  gameDrives: Drive[]
  gameSummary: ReturnType<typeof getGameSummary>
  driveWarnings: ReturnType<typeof getDriveWarnings>
  fairPlayWarnings: ReturnType<typeof getFairPlayWarnings>
  newGame: { opponent: string; date: string; location: string }
  setNewGame: (game: { opponent: string; date: string; location: string }) => void
  addGame: (copySelectedPlan?: boolean) => void
  selectGame: (gameId: string) => void
  deleteSelectedGame: () => void
  startDrive: (driveId?: string) => void
  setActiveView: (view: View) => void
  isAssistantMode: boolean
}) {
  const completed = gameDrives.filter((drive) => drive.status === 'completed').length
  const gameRows = games.map((game) => {
    const rowDrives = drives.filter((drive) => drive.gameId === game.id).sort((a, b) => driveSortValue(a) - driveSortValue(b))
    const summary = getGameSummary(rowDrives)
    const rowCompleted = rowDrives.filter((drive) => drive.status === 'completed').length
    const nextDrive = rowDrives.find((drive) => drive.status === 'current') || rowDrives.find((drive) => drive.status === 'planned') || rowDrives[0]

    return {
      game,
      summary,
      completed: rowCompleted,
      total: rowDrives.length,
      nextDrive
    }
  })

  return (
    <div className="grid gap-3 xl:grid-cols-[1fr_360px]">
      <section className="rounded-lg border border-[#d8ded5] bg-white/90 p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase text-[#53665c]">Current Game</p>
            <h2 className="mt-1 font-display text-3xl font-black">vs {selectedGame.opponent}</h2>
            <p className="mt-1 text-sm text-[#53665c]">
              {selectedGame.date || 'No date set'} · {selectedGame.location || 'No location set'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => (isAssistantMode ? setActiveView('gameday') : startDrive(currentDrive.id))}
            className="inline-flex items-center gap-2 rounded-lg bg-[#10201a] px-4 py-3 text-sm font-black text-white"
          >
            <Play size={17} />
            Open Game Day
          </button>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2 md:grid-cols-4">
          <Metric label="Score" value={`${gameSummary.teamScore}-${gameSummary.opponentScore}`} tone="ink" />
          <Metric label="Available" value={availablePlayers.length.toString()} tone="green" />
          <Metric label="Unavailable" value={unavailablePlayers.length.toString()} tone="amber" />
          <Metric label="Completed" value={`${completed}/${gameDrives.length}`} tone="sky" />
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          {isAssistantMode ? (
            <ActionPanel
              icon={<Eye size={20} />}
              title="Assistant View"
              detail="Current drive, bench, timeline, and notes"
              action="Open"
              onClick={() => setActiveView('gameday')}
            />
          ) : (
            <>
              <ActionPanel
                icon={<Users size={20} />}
                title="Roster"
                detail={`${availablePlayers.length} ready, ${unavailablePlayers.length} unavailable`}
                action="Manage"
                onClick={() => setActiveView('roster')}
              />
              <ActionPanel
                icon={<ClipboardList size={20} />}
                title="Lineup Planner"
                detail={`${driveWarnings.length + fairPlayWarnings.length} warning${driveWarnings.length + fairPlayWarnings.length === 1 ? '' : 's'}`}
                action="Plan"
                onClick={() => setActiveView('planner')}
              />
            </>
          )}
        </div>

        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="font-display text-xl font-black">Games</h3>
            <span className="rounded-full bg-[#d9eef6] px-2 py-1 text-xs font-black text-[#10201a]">{games.length} total</span>
          </div>
          <div className="space-y-2">
            {gameRows.map(({ game, summary, completed: rowCompleted, total, nextDrive }) => (
              <button
                key={game.id}
                type="button"
                onClick={() => selectGame(game.id)}
                className={`w-full rounded-lg border px-3 py-3 text-left ${
                  game.id === selectedGameId ? 'border-[#10201a] bg-[#f7c948]/25' : 'border-[#d8ded5] bg-white'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-black">vs {game.opponent}</p>
                    <p className="mt-1 text-sm text-[#53665c]">{game.date || 'No date'} · {game.location || 'No location'}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-display text-xl font-black">{summary.teamScore}-{summary.opponentScore}</p>
                    <p className="text-xs font-black uppercase text-[#53665c]">{game.status.replace('_', ' ')}</p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-black text-[#53665c]">
                  <span className="rounded-full bg-[#f7f5ee] px-2 py-1">{rowCompleted}/{total} drives</span>
                  <span className="rounded-full bg-[#f7f5ee] px-2 py-1">
                    Next {nextDrive ? `${nextDrive.unit === 'offense' ? 'OFF' : 'DEF'} ${nextDrive.driveNumber}` : 'none'}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-[#d8ded5] bg-white/90 p-4 shadow-sm">
        <h3 className="font-display text-xl font-black">Add Game</h3>
        <div className="mt-3 space-y-2">
          <input
            value={newGame.opponent}
            onChange={(event) => setNewGame({ ...newGame, opponent: event.target.value })}
            className="w-full rounded-lg border border-[#d8ded5] bg-white px-3 py-3 text-base outline-none focus:border-[#1f7a4d]"
            placeholder="Opponent"
          />
          <input
            type="date"
            value={newGame.date}
            onChange={(event) => setNewGame({ ...newGame, date: event.target.value })}
            className="w-full rounded-lg border border-[#d8ded5] bg-white px-3 py-3 text-base outline-none focus:border-[#1f7a4d]"
          />
          <input
            value={newGame.location}
            onChange={(event) => setNewGame({ ...newGame, location: event.target.value })}
            className="w-full rounded-lg border border-[#d8ded5] bg-white px-3 py-3 text-base outline-none focus:border-[#1f7a4d]"
            placeholder="Location"
          />
          <button
            type="button"
            onClick={() => addGame(false)}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#f7c948] px-4 py-3 font-black text-[#10201a]"
          >
            <Plus size={18} />
            Create Game
          </button>
          <button
            type="button"
            onClick={() => addGame(true)}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#d8ded5] bg-white px-4 py-3 font-black text-[#10201a]"
          >
            <Copy size={18} />
            Copy Selected Plan
          </button>
          <button
            type="button"
            onClick={deleteSelectedGame}
            disabled={games.length <= 1}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#c2412d] bg-white px-4 py-3 font-black text-[#c2412d] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Trash2 size={18} />
            Delete Current Game
          </button>
        </div>
      </section>
    </div>
  )
}

function RosterView({
  players,
  availability,
  editingPlayer,
  newPlayer,
  setNewPlayer,
  addPlayer,
  setEditingPlayerId,
  updatePlayer,
  setPlayerActive,
  updateRating,
  toggleAvailability,
  setSelectedGameAttendance,
  resetSelectedGameAttendance
}: {
  players: Player[]
  availability: Record<string, boolean>
  editingPlayer?: Player
  newPlayer: { firstName: string; lastName: string; jerseyNumber: string }
  setNewPlayer: (player: { firstName: string; lastName: string; jerseyNumber: string }) => void
  addPlayer: () => void
  setEditingPlayerId: (id: string) => void
  updatePlayer: (playerId: string, updates: Partial<Player>) => void
  setPlayerActive: (playerId: string, active: boolean) => void
  updateRating: (playerId: string, unit: Unit, ratingKey: string, delta: number) => void
  toggleAvailability: (playerId: string) => void
  setSelectedGameAttendance: (available: boolean) => void
  resetSelectedGameAttendance: () => void
}) {
  const activePlayers = players.filter((player) => player.active)
  const readyPlayers = activePlayers.filter((player) => isPlayerAvailable(player.id, availability))
  const outPlayers = activePlayers.filter((player) => !isPlayerAvailable(player.id, availability))
  const inactivePlayers = players.filter((player) => !player.active)

  return (
    <div className="grid gap-3 xl:grid-cols-[420px_1fr]">
      <section className="rounded-lg border border-[#d8ded5] bg-white/90 p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-black uppercase text-[#53665c]">Roster</p>
            <h2 className="font-display text-2xl font-black">{activePlayers.length} Active</h2>
          </div>
          <Users className="text-[#1f7a4d]" size={28} />
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <Metric label="Ready" value={readyPlayers.length.toString()} tone="green" />
          <Metric label="Out" value={outPlayers.length.toString()} tone="amber" />
          <Metric label="Inactive" value={inactivePlayers.length.toString()} tone="sky" />
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <button type="button" onClick={() => setSelectedGameAttendance(true)} className="rounded-lg bg-[#1f7a4d] px-2 py-3 text-sm font-black text-white">
            All Ready
          </button>
          <button type="button" onClick={() => setSelectedGameAttendance(false)} className="rounded-lg bg-[#f7c948] px-2 py-3 text-sm font-black text-[#10201a]">
            All Out
          </button>
          <button type="button" onClick={resetSelectedGameAttendance} className="rounded-lg border border-[#d8ded5] bg-white px-2 py-3 text-sm font-black text-[#10201a]">
            Reset
          </button>
        </div>

        <div className="mt-4 grid grid-cols-[1fr_1fr_88px] gap-2">
          <input
            value={newPlayer.firstName}
            onChange={(event) => setNewPlayer({ ...newPlayer, firstName: event.target.value })}
            placeholder="First"
            className="rounded-lg border border-[#d8ded5] px-3 py-3 outline-none focus:border-[#1f7a4d]"
          />
          <input
            value={newPlayer.lastName}
            onChange={(event) => setNewPlayer({ ...newPlayer, lastName: event.target.value })}
            placeholder="Last"
            className="rounded-lg border border-[#d8ded5] px-3 py-3 outline-none focus:border-[#1f7a4d]"
          />
          <input
            value={newPlayer.jerseyNumber}
            onChange={(event) => setNewPlayer({ ...newPlayer, jerseyNumber: event.target.value })}
            placeholder="#"
            className="rounded-lg border border-[#d8ded5] px-3 py-3 outline-none focus:border-[#1f7a4d]"
          />
        </div>
        <button
          type="button"
          onClick={addPlayer}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-[#10201a] px-4 py-3 font-black text-white"
        >
          <Plus size={18} />
          Add Player
        </button>

        <div className="mt-4 space-y-4">
          {[
            { label: 'Ready', players: readyPlayers, tone: 'bg-[#1f7a4d] text-white' },
            { label: 'Out', players: outPlayers, tone: 'bg-[#f7c948] text-[#10201a]' },
            { label: 'Inactive', players: inactivePlayers, tone: 'bg-[#d9eef6] text-[#10201a]' }
          ].map((group) => (
            <div key={group.label}>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-black uppercase text-[#53665c]">{group.label}</p>
                <span className="rounded-full bg-[#f7f5ee] px-2 py-1 text-xs font-black text-[#53665c]">{group.players.length}</span>
              </div>
              <div className="space-y-2">
                {group.players.length === 0 && <p className="rounded-lg border border-[#d8ded5] bg-white px-3 py-3 text-sm font-bold text-[#53665c]">None</p>}
                {group.players.map((player) => (
                  <button
                    key={player.id}
                    type="button"
                    onClick={() => setEditingPlayerId(player.id)}
                    className={`w-full rounded-lg border p-3 text-left transition ${
                      editingPlayer?.id === player.id
                        ? 'border-[#10201a] bg-[#f7c948]/25'
                        : 'border-[#d8ded5] bg-white hover:border-[#1f7a4d]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="font-black">
                          {player.firstName} {player.lastName}
                        </p>
                        <p className="text-sm text-[#53665c]">#{player.jerseyNumber || '--'}</p>
                      </div>
                      <span className={`rounded-full px-2 py-1 text-xs font-black ${group.tone}`}>
                        {group.label}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {editingPlayer && (
        <section className="rounded-lg border border-[#d8ded5] bg-white/90 p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase text-[#53665c]">Player</p>
              <h2 className="font-display text-2xl font-black">
                {editingPlayer.firstName} {editingPlayer.lastName}
              </h2>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => toggleAvailability(editingPlayer.id)}
                disabled={!editingPlayer.active}
                className={`rounded-lg px-3 py-2 text-sm font-black ${
                  !editingPlayer.active
                    ? 'bg-[#d9eef6] text-[#10201a] opacity-60'
                    : isPlayerAvailable(editingPlayer.id, availability)
                      ? 'bg-[#1f7a4d] text-white'
                      : 'bg-[#f7c948] text-[#10201a]'
                }`}
              >
                {!editingPlayer.active ? 'Inactive' : isPlayerAvailable(editingPlayer.id, availability) ? 'Available' : 'Unavailable'}
              </button>
              <button
                type="button"
                onClick={() => setPlayerActive(editingPlayer.id, !editingPlayer.active)}
                className="rounded-lg border border-[#d8ded5] px-3 py-2 text-sm font-black"
              >
                {editingPlayer.active ? 'Deactivate' : 'Reactivate'}
              </button>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <label className="text-sm font-bold">
              First Name
              <input
                value={editingPlayer.firstName}
                onChange={(event) => updatePlayer(editingPlayer.id, { firstName: event.target.value })}
                className="mt-1 w-full rounded-lg border border-[#d8ded5] px-3 py-3 outline-none focus:border-[#1f7a4d]"
              />
            </label>
            <label className="text-sm font-bold">
              Last Name
              <input
                value={editingPlayer.lastName}
                onChange={(event) => updatePlayer(editingPlayer.id, { lastName: event.target.value })}
                className="mt-1 w-full rounded-lg border border-[#d8ded5] px-3 py-3 outline-none focus:border-[#1f7a4d]"
              />
            </label>
            <label className="text-sm font-bold">
              Jersey
              <input
                value={editingPlayer.jerseyNumber}
                onChange={(event) => updatePlayer(editingPlayer.id, { jerseyNumber: event.target.value })}
                className="mt-1 w-full rounded-lg border border-[#d8ded5] px-3 py-3 outline-none focus:border-[#1f7a4d]"
              />
            </label>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <RatingPanel title="Offense" unit="offense" keys={['QB', 'C', 'WR', 'RB']} player={editingPlayer} updateRating={updateRating} />
            <RatingPanel title="Defense" unit="defense" keys={['R', 'S', 'MLB', 'CB', 'E']} player={editingPlayer} updateRating={updateRating} />
          </div>

          <label className="mt-4 block text-sm font-bold">
            Notes
            <textarea
              value={editingPlayer.notes}
              onChange={(event) => updatePlayer(editingPlayer.id, { notes: event.target.value })}
              rows={4}
              className="mt-1 w-full rounded-lg border border-[#d8ded5] px-3 py-3 outline-none focus:border-[#1f7a4d]"
            />
          </label>
        </section>
      )}
    </div>
  )
}

function PlannerView({
  selectedGame,
  games,
  setSelectedGameId,
  updateSelectedGame,
  gameDrives,
  selectedDrive,
  selectedPlayer,
  players,
  benchPlayers,
  unavailablePlayers,
  driveWarnings,
  fairPlayWarnings,
  setSelectedDriveId,
  createNewDrive,
  duplicateDrive,
  deleteDrive,
  toggleDriveLock,
  fillDrive,
  fillOpenDrives,
  generateRepeats,
  applySelectedDriveToRepeats,
  resetSelectedRepeatFromSource,
  lineupTemplates,
  newTemplateName,
  setNewTemplateName,
  saveSelectedDriveAsTemplate,
  applyTemplateToSelectedDrive,
  deleteLineupTemplate,
  setSelectedPlayerId,
  setDragItem,
  dropOnSlot,
  dropOnBench,
  movePlayerToSlot,
  clearSlot,
  getPlayer
}: {
  selectedGame: Game
  games: Game[]
  setSelectedGameId: (id: string) => void
  updateSelectedGame: (updates: Partial<Game>) => void
  gameDrives: Drive[]
  selectedDrive: Drive
  selectedPlayer?: Player
  players: Player[]
  benchPlayers: Player[]
  unavailablePlayers: Player[]
  driveWarnings: ReturnType<typeof getDriveWarnings>
  fairPlayWarnings: ReturnType<typeof getFairPlayWarnings>
  setSelectedDriveId: (id: string) => void
  createNewDrive: (unit: Unit) => void
  duplicateDrive: () => void
  deleteDrive: () => void
  toggleDriveLock: () => void
  fillDrive: () => void
  fillOpenDrives: () => void
  generateRepeats: () => void
  applySelectedDriveToRepeats: () => void
  resetSelectedRepeatFromSource: () => void
  lineupTemplates: LineupTemplate[]
  newTemplateName: string
  setNewTemplateName: (value: string) => void
  saveSelectedDriveAsTemplate: () => void
  applyTemplateToSelectedDrive: (templateId: string) => void
  deleteLineupTemplate: (templateId: string) => void
  setSelectedPlayerId: (id: string | null) => void
  setDragItem: (item: DragItem | null) => void
  dropOnSlot: (event: DragEvent<HTMLDivElement>, slotCode: string, driveId?: string) => void
  dropOnBench: (event: DragEvent<HTMLDivElement>) => void
  movePlayerToSlot: (playerId: string, toSlot: string, fromSlot?: string, driveId?: string) => void
  clearSlot: (slotCode: string, driveId?: string) => void
  getPlayer: (playerId?: string | null) => Player | undefined
}) {
  const selectedSourceDrive = selectedDrive.sourceDriveId ? gameDrives.find((drive) => drive.id === selectedDrive.sourceDriveId) : undefined
  const linkedRepeatCount = getLinkedRepeatCount(gameDrives, selectedDrive.id)
  const unitTemplates = lineupTemplates.filter((template) => template.unit === selectedDrive.unit)

  return (
    <div className="grid gap-3 2xl:grid-cols-[320px_1fr_320px]">
      <section className="rounded-lg border border-[#d8ded5] bg-white/90 p-3 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-xs font-black uppercase text-[#53665c]">Planner</p>
            <h2 className="font-display text-xl font-black">vs {selectedGame.opponent}</h2>
          </div>
          <select
            value={selectedGame.id}
            onChange={(event) => setSelectedGameId(event.target.value)}
            className="rounded-lg border border-[#d8ded5] bg-white px-2 py-2 text-sm font-bold"
          >
            {games.map((game) => (
              <option key={game.id} value={game.id}>
                {game.opponent}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => createNewDrive('offense')} className="rounded-lg bg-[#10201a] px-3 py-2 text-sm font-black text-white">
            + Offense
          </button>
          <button type="button" onClick={() => createNewDrive('defense')} className="rounded-lg bg-[#10201a] px-3 py-2 text-sm font-black text-white">
            + Defense
          </button>
        </div>

        <div className="mt-3 space-y-2">
          {gameDrives.map((drive) => {
            const warnings = getDriveWarnings(drive, players, unavailablePlayers.reduce<Record<string, boolean>>((next, player) => {
              next[player.id] = false
              return next
            }, {}))
            const sourceDrive = gameDrives.find((item) => item.id === drive.sourceDriveId)
            return (
              <button
                key={drive.id}
                type="button"
                onClick={() => setSelectedDriveId(drive.id)}
                className={`w-full rounded-lg border p-3 text-left ${
                  selectedDrive.id === drive.id ? 'border-[#10201a] bg-[#f7c948]/25' : 'border-[#d8ded5] bg-white'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="font-black uppercase">
                      {drive.unit === 'offense' ? 'OFF' : 'DEF'} {drive.driveNumber}
                    </p>
                    <p className="text-xs text-[#53665c]">
                      {drive.isRepeated
                        ? `Based on ${sourceDrive ? `${sourceDrive.unit === 'offense' ? 'OFF' : 'DEF'} ${sourceDrive.driveNumber}` : 'source'}`
                        : 'Original'}
                      {drive.isCustomized ? ' · Customized' : ''}
                    </p>
                  </div>
                  <StatusPill status={drive.status} locked={drive.locked} warnings={warnings.length} />
                </div>
              </button>
            )
          })}
        </div>
      </section>

      <section className="rounded-lg border border-[#d8ded5] bg-white/90 p-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-black uppercase text-[#53665c]">{selectedDrive.unit}</p>
            <h2 className="font-display text-2xl font-black">Drive {selectedDrive.driveNumber}</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <IconButton label="Auto Fill" onClick={fillDrive} disabled={selectedDrive.locked}>
              <CheckCircle2 size={17} />
            </IconButton>
            <IconButton label="Fill Open" onClick={fillOpenDrives}>
              <CheckCircle2 size={17} />
            </IconButton>
            {!selectedDrive.isRepeated && (
              <IconButton label="Sync Repeats" onClick={applySelectedDriveToRepeats}>
                <RotateCcw size={17} />
              </IconButton>
            )}
            {selectedDrive.isRepeated && (
              <IconButton label="Reset From Source" onClick={resetSelectedRepeatFromSource} disabled={!selectedSourceDrive || selectedDrive.status === 'completed'}>
                <RotateCcw size={17} />
              </IconButton>
            )}
            <IconButton label="Duplicate" onClick={duplicateDrive}>
              <Copy size={17} />
            </IconButton>
            <IconButton label={selectedDrive.locked ? 'Unlock' : 'Lock'} onClick={toggleDriveLock}>
              {selectedDrive.locked ? <Unlock size={17} /> : <Lock size={17} />}
            </IconButton>
            <IconButton label="Delete" onClick={deleteDrive}>
              <Trash2 size={17} />
            </IconButton>
          </div>
        </div>

        <div className="mt-3 rounded-lg border border-[#d8ded5] bg-white px-3 py-2 text-sm">
          {selectedDrive.isRepeated ? (
            <p className="font-bold text-[#53665c]">
              Based on{' '}
              <span className="text-[#10201a]">
                {selectedSourceDrive ? `${selectedSourceDrive.unit === 'offense' ? 'OFF' : 'DEF'} ${selectedSourceDrive.driveNumber}` : 'missing source'}
              </span>
              {selectedDrive.isCustomized ? ' · Customized' : ' · Linked'}
            </p>
          ) : (
            <p className="font-bold text-[#53665c]">
              Original drive · <span className="text-[#10201a]">{linkedRepeatCount}</span> linked repeat{linkedRepeatCount === 1 ? '' : 's'}
            </p>
          )}
        </div>

        <Warnings warnings={[...driveWarnings, ...fairPlayWarnings.slice(0, 2)]} />

        <FieldBoard
          drive={selectedDrive}
          getPlayer={getPlayer}
          selectedPlayer={selectedPlayer}
          setSelectedPlayerId={setSelectedPlayerId}
          setDragItem={setDragItem}
          dropOnSlot={dropOnSlot}
          movePlayerToSlot={movePlayerToSlot}
          clearSlot={clearSlot}
        />
      </section>

      <section className="grid gap-3">
        <BenchPanel
          benchPlayers={benchPlayers}
          unavailablePlayers={unavailablePlayers}
          selectedPlayer={selectedPlayer}
          setSelectedPlayerId={setSelectedPlayerId}
          setDragItem={setDragItem}
          dropOnBench={dropOnBench}
        />
        <section className="rounded-lg border border-[#d8ded5] bg-white/90 p-3 shadow-sm">
          <h3 className="font-display text-lg font-black">Templates</h3>
          <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
            <input
              value={newTemplateName}
              onChange={(event) => setNewTemplateName(event.target.value)}
              placeholder={`${selectedDrive.unit === 'offense' ? 'Offense' : 'Defense'} template`}
              className="min-w-0 rounded-lg border border-[#d8ded5] bg-white px-3 py-2 text-sm font-bold outline-none focus:border-[#1f7a4d]"
            />
            <button
              type="button"
              onClick={saveSelectedDriveAsTemplate}
              className="inline-flex items-center justify-center rounded-lg bg-[#10201a] px-3 py-2 text-white"
              title="Save template"
              aria-label="Save template"
            >
              <Save size={16} />
            </button>
          </div>
          <div className="mt-3 space-y-2">
            {unitTemplates.length === 0 && <p className="rounded-lg border border-[#d8ded5] bg-white px-3 py-3 text-sm font-bold text-[#53665c]">No {selectedDrive.unit} templates</p>}
            {unitTemplates.map((template) => {
              const assignedCount = Object.values(template.assignments).filter(Boolean).length
              return (
                <div key={template.id} className="rounded-lg border border-[#d8ded5] bg-white p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-black">{template.name}</p>
                      <p className="text-xs font-bold uppercase text-[#53665c]">{assignedCount}/7 assigned</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => deleteLineupTemplate(template.id)}
                      className="rounded-lg border border-[#d8ded5] p-2 text-[#c2412d]"
                      title="Delete template"
                      aria-label={`Delete ${template.name}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => applyTemplateToSelectedDrive(template.id)}
                    disabled={selectedDrive.locked || selectedDrive.status === 'completed'}
                    className="mt-3 w-full rounded-lg bg-[#f7c948] px-3 py-2 text-sm font-black text-[#10201a] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Apply
                  </button>
                </div>
              )
            })}
          </div>
        </section>
        <section className="rounded-lg border border-[#d8ded5] bg-white/90 p-3 shadow-sm">
          <h3 className="font-display text-lg font-black">Pattern</h3>
          <div className="mt-2 flex items-center justify-between rounded-lg bg-white px-3 py-2">
            <span className="text-sm font-black">Length</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => updateSelectedGame({ patternLength: Math.max(1, selectedGame.patternLength - 1) })}
                className="h-9 w-9 rounded-lg border border-[#d8ded5] bg-white font-black"
              >
                -
              </button>
              <span className="w-8 text-center font-black">{selectedGame.patternLength}</span>
              <button
                type="button"
                onClick={() => updateSelectedGame({ patternLength: Math.min(8, selectedGame.patternLength + 1) })}
                className="h-9 w-9 rounded-lg border border-[#d8ded5] bg-white font-black"
              >
                +
              </button>
            </div>
          </div>
          <p className="mt-2 text-sm text-[#53665c]">Generate the next repeated set from the first original drives.</p>
          <button
            type="button"
            onClick={generateRepeats}
            className="mt-3 w-full rounded-lg bg-[#f7c948] px-4 py-3 font-black text-[#10201a]"
          >
            Generate Repeats
          </button>
        </section>
      </section>
    </div>
  )
}

function GameDayView({
  selectedGame,
  selectedDrive,
  currentDrive,
  gameDrives,
  gameSummary,
  usage,
  players,
  benchPlayers,
  driveWarnings,
  setSelectedDriveId,
  setActiveView,
  startDrive,
  completeCurrentDrive,
  completeCurrentDriveAndAdvance,
  updateDriveNote,
  appendDriveNote,
  setDragItem,
  dropOnSlot,
  dropOnBench,
  movePlayerToSlot,
  clearSlot,
  getPlayer,
  isAssistantMode,
  canAddNotes,
  canAdvanceDrive,
  canEditLineups
}: {
  selectedGame: Game
  selectedDrive: Drive
  currentDrive: Drive
  gameDrives: Drive[]
  gameSummary: ReturnType<typeof getGameSummary>
  usage: ReturnType<typeof computeUsage>
  players: Player[]
  benchPlayers: Player[]
  driveWarnings: ReturnType<typeof getDriveWarnings>
  setSelectedDriveId: (id: string) => void
  setActiveView: (view: View) => void
  startDrive: (driveId?: string) => void
  completeCurrentDrive: (result: DriveResult, noteDraft?: DriveNoteDraft) => void
  completeCurrentDriveAndAdvance: (result: DriveResult, noteDraft?: DriveNoteDraft) => void
  updateDriveNote: (field: keyof DriveNote, value: string, driveId?: string) => void
  appendDriveNote: (field: QuickNoteField, value: string, driveId?: string) => void
  setDragItem: (item: DragItem | null) => void
  dropOnSlot: (event: DragEvent<HTMLDivElement>, slotCode: string, driveId?: string) => void
  dropOnBench: (event: DragEvent<HTMLDivElement>) => void
  movePlayerToSlot: (playerId: string, toSlot: string, fromSlot?: string, driveId?: string) => void
  clearSlot: (slotCode: string, driveId?: string) => void
  getPlayer: (playerId?: string | null) => Player | undefined
  isAssistantMode: boolean
  canAddNotes: boolean
  canAdvanceDrive: boolean
  canEditLineups: boolean
}) {
  const currentIndex = gameDrives.findIndex((drive) => drive.id === currentDrive.id)
  const displayDrive = selectedDrive
  const displayIndex = gameDrives.findIndex((drive) => drive.id === displayDrive.id)
  const previousDrive = gameDrives[displayIndex - 1]
  const nextDrive = gameDrives[displayIndex + 1]
  const nextLiveDrive = gameDrives.slice(currentIndex + 1).find((drive) => drive.status !== 'completed')
  const completedCount = gameDrives.filter((drive) => drive.status === 'completed').length
  const isReviewingDrive = displayDrive.id !== currentDrive.id
  const currentLabel = `${currentDrive.unit === 'offense' ? 'OFF' : 'DEF'} ${currentDrive.driveNumber}`
  const gameIsComplete = gameSummary.remainingDrives === 0 || selectedGame.status === 'completed'
  const reviewDrives = gameDrives.filter((drive) => getDriveNoteCount(drive.notes) > 0 || drive.result)
  const reviewUsage = usage
    .filter((item) => item.totalDrives > 0 || item.benchDrives > 0)
    .sort((a, b) => b.totalDrives - a.totalDrives || a.benchDrives - b.benchDrives)
  const [finishResult, setFinishResult] = useState<Exclude<DriveResult, ''>>((currentDrive.result || 'TD') as Exclude<DriveResult, ''>)
  const [finishDraft, setFinishDraft] = useState<DriveNoteDraft>({})

  useEffect(() => {
    setFinishResult((currentDrive.result || 'TD') as Exclude<DriveResult, ''>)
    setFinishDraft({})
  }, [currentDrive.id, currentDrive.result])

  function appendFinishDraft(field: keyof DriveNoteDraft, value: string) {
    if (!canAddNotes) {
      return
    }

    setFinishDraft((draft) => ({
      ...draft,
      [field]: draft[field] ? `${draft[field]}; ${value}` : value
    }))
  }

  function updateFinishDraft(field: keyof DriveNoteDraft, value: string) {
    if (!canAddNotes) {
      return
    }

    setFinishDraft((draft) => ({
      ...draft,
      [field]: value
    }))
  }

  function saveFinishedDrive(advance: boolean) {
    if (!canAdvanceDrive) {
      return
    }

    if (advance) {
      completeCurrentDriveAndAdvance(finishResult, finishDraft)
    } else {
      completeCurrentDrive(finishResult, finishDraft)
    }
    setFinishDraft({})
  }

  return (
    <div className="grid gap-3 xl:grid-cols-[1fr_360px]">
      {gameIsComplete && (
        <GameReviewPanel
          gameSummary={gameSummary}
          gameDrives={gameDrives}
          reviewDrives={reviewDrives}
          reviewUsage={reviewUsage}
          players={players}
          setActiveView={setActiveView}
        />
      )}
      <section className="rounded-lg border border-[#d8ded5] bg-white/90 p-3 shadow-sm">
        <div className="rounded-lg bg-[#10201a] p-4 text-white">
          <p className="text-xs font-black uppercase text-[#f7c948]">{isReviewingDrive ? 'Reviewing' : 'Current'}</p>
          <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
            <div>
              {isAssistantMode && <p className="mb-1 inline-flex items-center gap-2 rounded-full bg-white/12 px-2 py-1 text-xs font-black uppercase text-white ring-1 ring-white/20"><Eye size={13} /> Assistant</p>}
              <h2 className="font-display text-3xl font-black">
                {displayDrive.unit === 'offense' ? 'OFFENSE' : 'DEFENSE'} DRIVE {displayDrive.driveNumber}
              </h2>
              <p className="text-sm text-white/70">
                {displayIndex + 1} of {gameDrives.length} · {completedCount} complete · {driveWarnings.length > 0 ? `${driveWarnings.length} warning${driveWarnings.length === 1 ? '' : 's'}` : 'ready'}
              </p>
              {isReviewingDrive && (
                <button
                  type="button"
                  onClick={() => setSelectedDriveId(currentDrive.id)}
                  className="mt-3 rounded-lg bg-white/12 px-3 py-2 text-sm font-black text-white ring-1 ring-white/20"
                >
                  Back to Current: {currentLabel}
                </button>
              )}
            </div>
            <div className="text-right text-sm text-white/70">
              <p className="text-[#f7c948]">Score</p>
              <p className="font-display text-3xl font-black text-white">{gameSummary.teamScore}-{gameSummary.opponentScore}</p>
              <p className="mt-1">Next</p>
              <p className="font-black text-white">
                {nextLiveDrive ? `${nextLiveDrive.unit === 'offense' ? 'OFF' : 'DEF'} ${nextLiveDrive.driveNumber}` : 'End Game'}
              </p>
            </div>
          </div>
        </div>

        <Warnings warnings={driveWarnings} />

        <FieldBoard
          drive={displayDrive}
          getPlayer={getPlayer}
          selectedPlayer={undefined}
          setSelectedPlayerId={() => undefined}
          setDragItem={setDragItem}
          dropOnSlot={dropOnSlot}
          movePlayerToSlot={movePlayerToSlot}
          clearSlot={clearSlot}
          readOnly={!canEditLineups}
        />

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <button
            type="button"
            onClick={() => startDrive(displayDrive.id)}
            disabled={!canAdvanceDrive || displayDrive.status === 'completed'}
            className="rounded-lg bg-[#1f7a4d] px-3 py-3 font-black text-white disabled:opacity-40"
          >
            Start
          </button>
          <button
            type="button"
            onClick={() => {
              if (previousDrive) {
                setSelectedDriveId(previousDrive.id)
              }
            }}
            disabled={!previousDrive}
            className="rounded-lg border border-[#d8ded5] bg-white px-3 py-3 font-black disabled:opacity-40"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() => {
              if (nextDrive) {
                setSelectedDriveId(nextDrive.id)
              }
            }}
            disabled={!nextDrive}
            className="rounded-lg border border-[#d8ded5] bg-white px-3 py-3 font-black disabled:opacity-40"
          >
            Next
          </button>
          <button
            type="button"
            onClick={() => setActiveView('planner')}
            disabled={!canEditLineups}
            className="rounded-lg bg-[#f7c948] px-3 py-3 font-black text-[#10201a] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Edit
          </button>
        </div>
      </section>

      <section className="grid gap-3">
        <BenchPanel
          benchPlayers={benchPlayers}
          unavailablePlayers={[]}
          selectedPlayer={undefined}
          setSelectedPlayerId={() => undefined}
          setDragItem={setDragItem}
          dropOnBench={dropOnBench}
          readOnly={!canEditLineups}
        />

        {isReviewingDrive ? (
          <section className="rounded-lg border border-[#d8ded5] bg-white/90 p-3 shadow-sm">
            <h3 className="font-display text-lg font-black">Review</h3>
            <p className="mt-1 text-sm text-[#53665c]">
              Editing notes for {displayDrive.unit === 'offense' ? 'OFF' : 'DEF'} {displayDrive.driveNumber}. Live drive is {currentLabel}.
            </p>
            <button
              type="button"
              onClick={() => setSelectedDriveId(currentDrive.id)}
              className="mt-3 w-full rounded-lg bg-[#10201a] px-3 py-3 text-sm font-black text-white"
            >
              Back to Current
            </button>
          </section>
        ) : gameIsComplete ? (
          <section className="rounded-lg border border-[#d8ded5] bg-white/90 p-3 shadow-sm">
            <h3 className="font-display text-lg font-black">Game Complete</h3>
            <p className="mt-1 text-sm text-[#53665c]">
              {gameSummary.completedDrives} drives complete · Final score {gameSummary.teamScore}-{gameSummary.opponentScore}
            </p>
            <button
              type="button"
              onClick={() => setActiveView('dashboard')}
              className="mt-3 w-full rounded-lg bg-[#10201a] px-3 py-3 text-sm font-black text-white"
            >
              Dashboard
            </button>
          </section>
        ) : (
          <section className="rounded-lg border border-[#d8ded5] bg-white/90 p-3 shadow-sm">
            <h3 className="font-display text-lg font-black">Finish Drive</h3>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {resultOptions.map((result) => (
                <button
                  key={result}
                  type="button"
                  onClick={() => setFinishResult(result)}
                  disabled={!canAdvanceDrive}
                  className={`rounded-lg border px-3 py-3 text-sm font-black ${
                    finishResult === result ? 'border-[#10201a] bg-[#f7c948] text-[#10201a]' : 'border-[#d8ded5] bg-white'
                  } disabled:cursor-not-allowed disabled:opacity-40`}
                >
                  {result}
                </button>
              ))}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <QuickNoteButton label="Sweep worked" onClick={() => appendFinishDraft('whatWorked', 'Sweep worked')} disabled={!canAddNotes} />
              <QuickNoteButton label="Late handoff" onClick={() => appendFinishDraft('whatFailed', 'Late handoff')} disabled={!canAddNotes} />
              <QuickNoteButton label="Stayed home" onClick={() => appendFinishDraft('playerNotes', 'Stayed home')} disabled={!canAddNotes} />
              <QuickNoteButton label="Missed flags" onClick={() => appendFinishDraft('whatFailed', 'Missed flags')} disabled={!canAddNotes} />
              <QuickNoteButton label="Sweep Right" onClick={() => appendFinishDraft('playCalls', 'Sweep Right')} disabled={!canAddNotes} />
              <QuickNoteButton label="More motion" onClick={() => appendFinishDraft('freeform', 'Next: more motion')} disabled={!canAddNotes} />
            </div>

            <QuickNote label="Calls" value={finishDraft.playCalls || ''} onChange={(value) => updateFinishDraft('playCalls', value)} disabled={!canAddNotes} />
            <QuickNote label="Worked" value={finishDraft.whatWorked || ''} onChange={(value) => updateFinishDraft('whatWorked', value)} disabled={!canAddNotes} />
            <QuickNote label="Failed" value={finishDraft.whatFailed || ''} onChange={(value) => updateFinishDraft('whatFailed', value)} disabled={!canAddNotes} />
            <QuickNote label="Players" value={finishDraft.playerNotes || ''} onChange={(value) => updateFinishDraft('playerNotes', value)} disabled={!canAddNotes} />
            <QuickNote label="Next" value={finishDraft.freeform || ''} onChange={(value) => updateFinishDraft('freeform', value)} disabled={!canAddNotes} />

            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => saveFinishedDrive(false)}
                disabled={!canAdvanceDrive}
                className="rounded-lg border border-[#d8ded5] bg-white px-3 py-3 text-sm font-black disabled:cursor-not-allowed disabled:opacity-40"
              >
                Save Result
              </button>
              <button
                type="button"
                onClick={() => saveFinishedDrive(true)}
                disabled={!canAdvanceDrive}
                className="rounded-lg bg-[#10201a] px-3 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Save + Next
              </button>
            </div>
          </section>
        )}

        <section className="rounded-lg border border-[#d8ded5] bg-white/90 p-3 shadow-sm">
          <h3 className="font-display text-lg font-black">{isReviewingDrive ? 'Notes' : 'Saved Notes'}</h3>
          {isReviewingDrive && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <QuickNoteButton label="Sweep worked" onClick={() => appendDriveNote('whatWorked', 'Sweep worked', displayDrive.id)} disabled={!canAddNotes} />
              <QuickNoteButton label="Use motion" onClick={() => appendDriveNote('whatWorked', 'Use more motion', displayDrive.id)} disabled={!canAddNotes} />
              <QuickNoteButton label="Late handoff" onClick={() => appendDriveNote('whatFailed', 'Late handoff', displayDrive.id)} disabled={!canAddNotes} />
              <QuickNoteButton label="Missed flags" onClick={() => appendDriveNote('whatFailed', 'Missed flags', displayDrive.id)} disabled={!canAddNotes} />
              <QuickNoteButton label="Stayed home" onClick={() => appendDriveNote('playerNotes', 'Stayed home', displayDrive.id)} disabled={!canAddNotes} />
              <QuickNoteButton label="Rotate QB" onClick={() => appendDriveNote('playerNotes', 'Rotate QB', displayDrive.id)} disabled={!canAddNotes} />
              <QuickNoteButton label="Sweep right" onClick={() => appendDriveNote('playCalls', 'Sweep Right', displayDrive.id)} disabled={!canAddNotes} />
              <QuickNoteButton label="QB keep" onClick={() => appendDriveNote('playCalls', 'QB Keep', displayDrive.id)} disabled={!canAddNotes} />
              <QuickNoteButton label="Short routes" onClick={() => appendDriveNote('freeform', 'Next: short routes', displayDrive.id)} disabled={!canAddNotes} />
              <QuickNoteButton label="More motion" onClick={() => appendDriveNote('freeform', 'Next: more motion', displayDrive.id)} disabled={!canAddNotes} />
            </div>
          )}
          <QuickNote label="Play Calls" value={displayDrive.notes.playCalls} onChange={(value) => updateDriveNote('playCalls', value, displayDrive.id)} disabled={!canAddNotes} />
          <QuickNote label="Worked" value={displayDrive.notes.whatWorked} onChange={(value) => updateDriveNote('whatWorked', value, displayDrive.id)} disabled={!canAddNotes} />
          <QuickNote label="Failed" value={displayDrive.notes.whatFailed} onChange={(value) => updateDriveNote('whatFailed', value, displayDrive.id)} disabled={!canAddNotes} />
          <QuickNote label="Players" value={displayDrive.notes.playerNotes} onChange={(value) => updateDriveNote('playerNotes', value, displayDrive.id)} disabled={!canAddNotes} />
          <QuickNote label="Next" value={displayDrive.notes.freeform} onChange={(value) => updateDriveNote('freeform', value, displayDrive.id)} disabled={!canAddNotes} />
        </section>

        <section className="rounded-lg border border-[#d8ded5] bg-white/90 p-3 shadow-sm">
          <h3 className="font-display text-lg font-black">Timeline</h3>
          <div className="mt-2 max-h-80 space-y-2 overflow-auto pr-1">
            {gameDrives.map((drive) => {
              const statusLabel = drive.id === currentDrive.id ? 'Current' : drive.status === 'completed' ? drive.result || 'Done' : 'Planned'
              const noteCount = getDriveNoteCount(drive.notes)
              return (
                <button
                  key={drive.id}
                  type="button"
                  onClick={() => setSelectedDriveId(drive.id)}
                  className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left ${
                    drive.id === selectedDrive.id ? 'border-[#10201a] bg-[#f7c948]/25' : 'border-[#d8ded5] bg-white'
                  }`}
                >
                  <span className="font-black">
                    {drive.unit === 'offense' ? 'OFF' : 'DEF'} {drive.driveNumber}
                  </span>
                  <span className="text-right text-sm text-[#53665c]">
                    <span className="block">{statusLabel}</span>
                    {noteCount > 0 && <span className="block text-xs font-black text-[#1f7a4d]">{noteCount} notes</span>}
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      </section>
    </div>
  )
}

function GameReviewPanel({
  gameSummary,
  gameDrives,
  reviewDrives,
  reviewUsage,
  players,
  setActiveView
}: {
  gameSummary: ReturnType<typeof getGameSummary>
  gameDrives: Drive[]
  reviewDrives: Drive[]
  reviewUsage: ReturnType<typeof computeUsage>
  players: Player[]
  setActiveView: (view: View) => void
}) {
  return (
    <section className="rounded-lg border border-[#d8ded5] bg-white/90 p-4 shadow-sm xl:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase text-[#53665c]">Game Review</p>
          <h2 className="font-display text-3xl font-black">Final {gameSummary.teamScore}-{gameSummary.opponentScore}</h2>
          <p className="mt-1 text-sm text-[#53665c]">{gameSummary.completedDrives}/{gameDrives.length} drives complete</p>
        </div>
        <button
          type="button"
          onClick={() => setActiveView('more')}
          className="rounded-lg bg-[#10201a] px-4 py-3 text-sm font-black text-white"
        >
          Analytics
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
        <Metric label="TDs" value={getResultCount(gameSummary, 'TD').toString()} tone="green" />
        <Metric label="Stops" value={getResultCount(gameSummary, 'Stop').toString()} tone="ink" />
        <Metric label="Turnovers" value={getResultCount(gameSummary, 'Turnover').toString()} tone="amber" />
        <Metric label="Allowed" value={getResultCount(gameSummary, 'TD Allowed').toString()} tone="sky" />
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-[1fr_1fr]">
        <div className="rounded-lg border border-[#d8ded5] bg-white p-3">
          <p className="text-xs font-black uppercase text-[#53665c]">Drive Notes</p>
          <div className="mt-2 max-h-72 space-y-2 overflow-auto pr-1">
            {reviewDrives.length === 0 && <p className="text-sm text-[#53665c]">No drive notes or results captured.</p>}
            {reviewDrives.map((drive) => (
              <div key={drive.id} className="rounded-lg bg-[#f7f5ee] px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-black">
                    {drive.unit === 'offense' ? 'OFF' : 'DEF'} {drive.driveNumber}
                  </p>
                  <p className="text-xs font-black text-[#53665c]">{drive.result || 'Notes'}</p>
                </div>
                {drive.notes.playCalls && <p className="mt-1"><span className="font-black">Calls:</span> {drive.notes.playCalls}</p>}
                {drive.notes.whatWorked && <p className="mt-1"><span className="font-black">Worked:</span> {drive.notes.whatWorked}</p>}
                {drive.notes.whatFailed && <p className="mt-1"><span className="font-black">Failed:</span> {drive.notes.whatFailed}</p>}
                {drive.notes.playerNotes && <p className="mt-1"><span className="font-black">Players:</span> {drive.notes.playerNotes}</p>}
                {drive.notes.freeform && <p className="mt-1"><span className="font-black">Next:</span> {drive.notes.freeform}</p>}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-[#d8ded5] bg-white p-3">
          <p className="text-xs font-black uppercase text-[#53665c]">Fair Play</p>
          <div className="mt-2 max-h-72 space-y-2 overflow-auto pr-1">
            {reviewUsage.length === 0 && <p className="text-sm text-[#53665c]">No player usage yet.</p>}
            {reviewUsage.map((item) => {
              const player = players.find((candidate) => candidate.id === item.playerId)
              const topPositions = Object.entries(item.positionCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 2)
                .map(([position, count]) => `${position} ${count}`)
                .join(' · ')

              return (
                <div key={item.playerId} className="rounded-lg bg-[#f7f5ee] px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-black">{player?.firstName || 'Player'}</p>
                    <p className="text-xs font-black text-[#53665c]">{item.totalDrives}/{gameDrives.length}</p>
                  </div>
                  <p className="mt-1 text-[#53665c]">OFF {item.offenseDrives} · DEF {item.defenseDrives} · Bench {item.benchDrives}</p>
                  {topPositions && <p className="mt-1 text-xs font-bold text-[#53665c]">{topPositions}</p>}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-[#d8ded5] bg-white p-3">
        <p className="text-xs font-black uppercase text-[#53665c]">Scoring Plays</p>
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          {gameSummary.scoringPlays.length === 0 && <p className="text-sm text-[#53665c]">No scoring plays captured.</p>}
          {gameSummary.scoringPlays.map((play) => (
            <div key={`${play.driveId}-${play.points}`} className="flex items-center justify-between rounded-lg bg-[#f7f5ee] px-3 py-2 text-sm">
              <span className="font-black">{play.label}</span>
              <span className={play.team === 'us' ? 'font-black text-[#1f7a4d]' : 'font-black text-[#c2412d]'}>
                {play.team === 'us' ? '+' : 'Opp +'}{play.points}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function MoreView({
  practices,
  practiceTemplates,
  plays,
  usage,
  seasonUsage,
  attendanceSummary,
  players,
  games,
  gameDrives,
  gameSummary,
  seasonSummary,
  seasonDriveCount,
  team,
  updateTeam,
  appSettings,
  updateAppSettings,
  supabaseConfigured,
  syncStatus,
  syncMessage,
  syncUserEmail,
  syncMembership,
  authForm,
  setAuthForm,
  assistantInviteForm,
  setAssistantInviteForm,
  assistantInviteToken,
  assistantInviteAcceptCode,
  setAssistantInviteAcceptCode,
  authenticateSupabase,
  signOutSupabase,
  saveCloudNow,
  loadCloudNow,
  createAssistantInvite,
  acceptAssistantInvite,
  newPractice,
  setNewPractice,
  addPractice,
  updatePractice,
  copyPractice,
  deletePractice,
  newPracticeTemplateName,
  setNewPracticeTemplateName,
  savePracticeTemplateFromPractice,
  applyPracticeTemplate,
  deletePracticeTemplate,
  newPlay,
  setNewPlay,
  addPlay,
  updatePlay,
  deletePlay,
  playFilter,
  setPlayFilter,
  backupText,
  setBackupText,
  exportBackup,
  importBackup,
  resetDemoData
}: {
  practices: AppState['practices']
  practiceTemplates: PracticeTemplate[]
  plays: AppState['plays']
  usage: ReturnType<typeof computeUsage>
  seasonUsage: ReturnType<typeof computeSeasonUsage>
  attendanceSummary: ReturnType<typeof getAttendanceSummary>
  players: Player[]
  games: Game[]
  gameDrives: Drive[]
  gameSummary: ReturnType<typeof getGameSummary>
  seasonSummary: ReturnType<typeof getGameSummary>
  seasonDriveCount: number
  team: AppState['team']
  updateTeam: (updates: Partial<AppState['team']>) => void
  appSettings: AppSettings
  updateAppSettings: (updates: Partial<AppSettings>) => void
  supabaseConfigured: boolean
  syncStatus: SyncStatus
  syncMessage: string
  syncUserEmail: string
  syncMembership: SupabaseMembership | null
  authForm: { email: string; password: string }
  setAuthForm: (form: { email: string; password: string }) => void
  assistantInviteForm: { email: string; canAddNotes: boolean; canAdvanceDrive: boolean }
  setAssistantInviteForm: (form: { email: string; canAddNotes: boolean; canAdvanceDrive: boolean }) => void
  assistantInviteToken: string
  assistantInviteAcceptCode: string
  setAssistantInviteAcceptCode: (value: string) => void
  authenticateSupabase: (mode: 'sign-in' | 'sign-up') => void
  signOutSupabase: () => void
  saveCloudNow: () => void
  loadCloudNow: () => void
  createAssistantInvite: () => void
  acceptAssistantInvite: () => void
  newPractice: Omit<PracticePlan, 'id' | 'teamId'>
  setNewPractice: (practice: Omit<PracticePlan, 'id' | 'teamId'>) => void
  addPractice: () => void
  updatePractice: (practiceId: string, updates: Partial<PracticePlan>) => void
  copyPractice: (practiceId: string) => void
  deletePractice: (practiceId: string) => void
  newPracticeTemplateName: string
  setNewPracticeTemplateName: (value: string) => void
  savePracticeTemplateFromPractice: (practiceId: string) => void
  applyPracticeTemplate: (templateId: string) => void
  deletePracticeTemplate: (templateId: string) => void
  newPlay: { name: string; formation: string; positions: string; notes: string; tags: string }
  setNewPlay: (play: { name: string; formation: string; positions: string; notes: string; tags: string }) => void
  addPlay: () => void
  updatePlay: (playId: string, updates: Partial<PlaybookPlay>) => void
  deletePlay: (playId: string) => void
  playFilter: string
  setPlayFilter: (value: string) => void
  backupText: string
  setBackupText: (value: string) => void
  exportBackup: () => void
  importBackup: () => void
  resetDemoData: () => void
}) {
  const normalizedPlayFilter = playFilter.trim().toLowerCase()
  const filteredPlays = normalizedPlayFilter
    ? plays.filter((play) =>
        [play.name, play.formation, play.positions, play.notes, play.tags.join(' ')]
          .join(' ')
          .toLowerCase()
          .includes(normalizedPlayFilter)
      )
    : plays
  const currentGameUsage = usage
    .filter((item) => item.totalDrives > 0 || item.benchDrives > 0)
    .sort((a, b) => b.totalDrives - a.totalDrives || a.benchDrives - b.benchDrives)
  const sortedSeasonUsage = seasonUsage
    .filter((item) => item.totalDrives > 0 || item.benchDrives > 0)
    .sort((a, b) => b.totalDrives - a.totalDrives || a.benchDrives - b.benchDrives)
  const syncBusy = syncStatus === 'loading' || syncStatus === 'saving'
  const syncTone =
    syncStatus === 'error'
      ? 'bg-[#c2412d] text-white'
      : syncStatus === 'synced'
        ? 'bg-[#1f7a4d] text-white'
        : syncStatus === 'saving' || syncStatus === 'loading'
          ? 'bg-[#f7c948] text-[#10201a]'
          : 'bg-[#d9eef6] text-[#10201a]'

  return (
    <div className="grid gap-3 xl:grid-cols-[1fr_1fr_380px]">
      <section className="rounded-lg border border-[#d8ded5] bg-white/90 p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <CalendarDays className="text-[#1f7a4d]" size={22} />
          <h2 className="font-display text-xl font-black">Practice</h2>
        </div>
        <div className="mt-3 space-y-2 rounded-lg border border-[#d8ded5] bg-white p-3">
          <input
            value={newPractice.title}
            onChange={(event) => setNewPractice({ ...newPractice, title: event.target.value })}
            className="w-full rounded-lg border border-[#d8ded5] px-3 py-2 outline-none focus:border-[#1f7a4d]"
            placeholder="Practice title"
          />
          <input
            type="date"
            value={newPractice.date}
            onChange={(event) => setNewPractice({ ...newPractice, date: event.target.value })}
            className="w-full rounded-lg border border-[#d8ded5] px-3 py-2 outline-none focus:border-[#1f7a4d]"
          />
          <div className="rounded-lg border border-[#d8ded5] bg-[#f7f5ee] p-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-black uppercase text-[#53665c]">Templates</p>
              <span className="rounded-full bg-white px-2 py-1 text-xs font-black text-[#53665c]">{practiceTemplates.length}</span>
            </div>
            <div className="mt-2 grid gap-2">
              {practiceTemplates.map((template) => (
                <div key={template.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-lg bg-white px-2 py-2">
                  <p className="min-w-0 truncate text-sm font-black">{template.name}</p>
                  <button
                    type="button"
                    onClick={() => applyPracticeTemplate(template.id)}
                    className="rounded-lg bg-[#f7c948] px-3 py-2 text-xs font-black text-[#10201a]"
                  >
                    Apply
                  </button>
                  <button
                    type="button"
                    onClick={() => deletePracticeTemplate(template.id)}
                    className="rounded-lg border border-[#d8ded5] p-2 text-[#c2412d]"
                    title={`Delete ${template.name}`}
                    aria-label={`Delete ${template.name}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              {practiceTemplates.length === 0 && <p className="rounded-lg bg-white px-3 py-2 text-sm font-bold text-[#53665c]">No saved templates</p>}
            </div>
          </div>
          <textarea
            value={newPractice.warmup}
            onChange={(event) => setNewPractice({ ...newPractice, warmup: event.target.value })}
            className="w-full rounded-lg border border-[#d8ded5] px-3 py-2 outline-none focus:border-[#1f7a4d]"
            placeholder="Warmup"
            rows={2}
          />
          <textarea
            value={newPractice.skills}
            onChange={(event) => setNewPractice({ ...newPractice, skills: event.target.value })}
            className="w-full rounded-lg border border-[#d8ded5] px-3 py-2 outline-none focus:border-[#1f7a4d]"
            placeholder="Skills"
            rows={2}
          />
          <div className="grid grid-cols-2 gap-2">
            <textarea
              value={newPractice.offense}
              onChange={(event) => setNewPractice({ ...newPractice, offense: event.target.value })}
              className="rounded-lg border border-[#d8ded5] px-3 py-2 outline-none focus:border-[#1f7a4d]"
              placeholder="Offense"
              rows={2}
            />
            <textarea
              value={newPractice.defense}
              onChange={(event) => setNewPractice({ ...newPractice, defense: event.target.value })}
              className="rounded-lg border border-[#d8ded5] px-3 py-2 outline-none focus:border-[#1f7a4d]"
              placeholder="Defense"
              rows={2}
            />
          </div>
          <textarea
            value={newPractice.scrimmage}
            onChange={(event) => setNewPractice({ ...newPractice, scrimmage: event.target.value })}
            className="w-full rounded-lg border border-[#d8ded5] px-3 py-2 outline-none focus:border-[#1f7a4d]"
            placeholder="Scrimmage"
            rows={2}
          />
          <textarea
            value={newPractice.notes}
            onChange={(event) => setNewPractice({ ...newPractice, notes: event.target.value })}
            className="w-full rounded-lg border border-[#d8ded5] px-3 py-2 outline-none focus:border-[#1f7a4d]"
            placeholder="Practice notes"
            rows={2}
          />
          <button type="button" onClick={addPractice} className="w-full rounded-lg bg-[#10201a] px-4 py-3 font-black text-white">
            Add Practice
          </button>
        </div>
        <div className="mt-3 rounded-lg border border-[#d8ded5] bg-white p-3">
          <p className="text-xs font-black uppercase text-[#53665c]">Save Template Name</p>
          <input
            value={newPracticeTemplateName}
            onChange={(event) => setNewPracticeTemplateName(event.target.value)}
            className="mt-2 w-full rounded-lg border border-[#d8ded5] px-3 py-2 text-sm outline-none focus:border-[#1f7a4d]"
            placeholder="Optional name before saving a practice"
          />
        </div>
        <div className="mt-3 space-y-3">
          {practices.map((practice) => (
            <div key={practice.id} className="rounded-lg border border-[#d8ded5] bg-white p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <input
                    value={practice.title}
                    onChange={(event) => updatePractice(practice.id, { title: event.target.value })}
                    className="w-full rounded-lg border border-transparent px-1 py-1 font-black outline-none focus:border-[#d8ded5]"
                  />
                  <input
                    type="date"
                    value={practice.date}
                    onChange={(event) => updatePractice(practice.id, { date: event.target.value })}
                    className="mt-1 rounded-lg border border-transparent px-1 py-1 text-sm text-[#53665c] outline-none focus:border-[#d8ded5]"
                  />
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => savePracticeTemplateFromPractice(practice.id)}
                    className="rounded-lg border border-[#d8ded5] p-2"
                    title="Save as template"
                    aria-label={`Save ${practice.title} as template`}
                  >
                    <Save size={15} />
                  </button>
                  <button type="button" onClick={() => copyPractice(practice.id)} className="rounded-lg border border-[#d8ded5] p-2" title="Copy practice">
                    <Copy size={15} />
                  </button>
                  <button type="button" onClick={() => deletePractice(practice.id)} className="rounded-lg border border-[#d8ded5] p-2" title="Delete practice">
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
              <p className="mt-2 text-xs font-black uppercase text-[#53665c]">Warmup</p>
              <textarea
                value={practice.warmup}
                onChange={(event) => updatePractice(practice.id, { warmup: event.target.value })}
                className="mt-1 w-full rounded-lg border border-[#d8ded5] px-3 py-2 text-sm outline-none focus:border-[#1f7a4d]"
                rows={2}
              />
              <p className="mt-2 text-xs font-black uppercase text-[#53665c]">Skills</p>
              <textarea
                value={practice.skills}
                onChange={(event) => updatePractice(practice.id, { skills: event.target.value })}
                className="mt-1 w-full rounded-lg border border-[#d8ded5] px-3 py-2 text-sm outline-none focus:border-[#1f7a4d]"
                rows={2}
              />
              <p className="mt-2 text-xs font-black uppercase text-[#53665c]">Offense / Defense</p>
              <div className="mt-1 grid grid-cols-2 gap-2">
                <textarea
                  value={practice.offense}
                  onChange={(event) => updatePractice(practice.id, { offense: event.target.value })}
                  className="rounded-lg border border-[#d8ded5] px-3 py-2 text-sm outline-none focus:border-[#1f7a4d]"
                  rows={2}
                />
                <textarea
                  value={practice.defense}
                  onChange={(event) => updatePractice(practice.id, { defense: event.target.value })}
                  className="rounded-lg border border-[#d8ded5] px-3 py-2 text-sm outline-none focus:border-[#1f7a4d]"
                  rows={2}
                />
              </div>
              <p className="mt-2 text-xs font-black uppercase text-[#53665c]">Scrimmage</p>
              <textarea
                value={practice.scrimmage}
                onChange={(event) => updatePractice(practice.id, { scrimmage: event.target.value })}
                className="mt-1 w-full rounded-lg border border-[#d8ded5] px-3 py-2 text-sm outline-none focus:border-[#1f7a4d]"
                rows={2}
              />
              <p className="mt-2 text-xs font-black uppercase text-[#53665c]">Notes</p>
              <textarea
                value={practice.notes}
                onChange={(event) => updatePractice(practice.id, { notes: event.target.value })}
                className="mt-1 w-full rounded-lg border border-[#d8ded5] px-3 py-2 text-sm outline-none focus:border-[#1f7a4d]"
                rows={2}
              />
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-[#d8ded5] bg-white/90 p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <BookOpen className="text-[#1f7a4d]" size={22} />
          <h2 className="font-display text-xl font-black">Playbook</h2>
        </div>
        <label className="mt-3 flex items-center gap-2 rounded-lg border border-[#d8ded5] bg-white px-3 py-2">
          <Search size={16} className="shrink-0 text-[#53665c]" />
          <input
            value={playFilter}
            onChange={(event) => setPlayFilter(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-sm font-bold outline-none"
            placeholder="Search plays"
          />
        </label>
        <div className="mt-3 space-y-2 rounded-lg border border-[#d8ded5] bg-white p-3">
          <input
            value={newPlay.name}
            onChange={(event) => setNewPlay({ ...newPlay, name: event.target.value })}
            className="w-full rounded-lg border border-[#d8ded5] px-3 py-2 outline-none focus:border-[#1f7a4d]"
            placeholder="Play name"
          />
          <input
            value={newPlay.formation}
            onChange={(event) => setNewPlay({ ...newPlay, formation: event.target.value })}
            className="w-full rounded-lg border border-[#d8ded5] px-3 py-2 outline-none focus:border-[#1f7a4d]"
            placeholder="Formation"
          />
          <textarea
            value={newPlay.positions}
            onChange={(event) => setNewPlay({ ...newPlay, positions: event.target.value })}
            className="w-full rounded-lg border border-[#d8ded5] px-3 py-2 outline-none focus:border-[#1f7a4d]"
            placeholder="Positions"
            rows={2}
          />
          <textarea
            value={newPlay.notes}
            onChange={(event) => setNewPlay({ ...newPlay, notes: event.target.value })}
            className="w-full rounded-lg border border-[#d8ded5] px-3 py-2 outline-none focus:border-[#1f7a4d]"
            placeholder="Notes"
            rows={2}
          />
          <input
            value={newPlay.tags}
            onChange={(event) => setNewPlay({ ...newPlay, tags: event.target.value })}
            className="w-full rounded-lg border border-[#d8ded5] px-3 py-2 outline-none focus:border-[#1f7a4d]"
            placeholder="Tags, comma separated"
          />
          <button type="button" onClick={addPlay} className="w-full rounded-lg bg-[#10201a] px-4 py-3 font-black text-white">
            Add Play
          </button>
        </div>
        <div className="mt-3 space-y-3">
          {filteredPlays.length === 0 && <p className="rounded-lg border border-[#d8ded5] bg-white px-3 py-3 text-sm font-bold text-[#53665c]">No plays match the filter.</p>}
          {filteredPlays.map((play) => (
            <div key={play.id} className="rounded-lg border border-[#d8ded5] bg-white p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <input
                    value={play.name}
                    onChange={(event) => updatePlay(play.id, { name: event.target.value })}
                    className="w-full rounded-lg border border-transparent px-1 py-1 font-black outline-none focus:border-[#d8ded5]"
                  />
                  <input
                    value={play.formation}
                    onChange={(event) => updatePlay(play.id, { formation: event.target.value })}
                    className="w-full rounded-lg border border-transparent px-1 py-1 text-sm text-[#53665c] outline-none focus:border-[#d8ded5]"
                  />
                </div>
                <button type="button" onClick={() => deletePlay(play.id)} className="rounded-lg border border-[#d8ded5] p-2" title="Delete play">
                  <Trash2 size={15} />
                </button>
              </div>
              <textarea
                value={play.positions}
                onChange={(event) => updatePlay(play.id, { positions: event.target.value })}
                className="mt-2 w-full rounded-lg border border-[#d8ded5] px-3 py-2 text-sm outline-none focus:border-[#1f7a4d]"
                rows={2}
              />
              <textarea
                value={play.notes}
                onChange={(event) => updatePlay(play.id, { notes: event.target.value })}
                className="mt-2 w-full rounded-lg border border-[#d8ded5] px-3 py-2 text-sm outline-none focus:border-[#1f7a4d]"
                rows={2}
              />
              <div className="mt-2 flex flex-wrap gap-1">
                {play.tags.map((tag) => (
                  <span key={tag} className="rounded-full bg-[#d9eef6] px-2 py-1 text-xs font-black text-[#10201a]">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-[#d8ded5] bg-white/90 p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <ClipboardList className="text-[#1f7a4d]" size={22} />
          <h2 className="font-display text-xl font-black">Analytics</h2>
        </div>
        <div className="mt-3 rounded-lg border border-[#d8ded5] bg-white p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-black uppercase text-[#53665c]">Season</p>
            <span className="rounded-full bg-[#d9eef6] px-2 py-1 text-xs font-black text-[#10201a]">{games.length} game{games.length === 1 ? '' : 's'}</span>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <Metric label="Score" value={`${seasonSummary.teamScore}-${seasonSummary.opponentScore}`} tone="ink" />
            <Metric label="Drives" value={`${seasonSummary.completedDrives}/${seasonDriveCount}`} tone="sky" />
            <Metric label="TDs" value={getResultCount(seasonSummary, 'TD').toString()} tone="green" />
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className="rounded-lg bg-[#f7f5ee] p-3">
              <p className="text-xs font-black uppercase text-[#53665c]">Season Usage</p>
              <div className="mt-2 max-h-56 space-y-2 overflow-auto pr-1">
                {sortedSeasonUsage.length === 0 && <p className="text-sm text-[#53665c]">No season usage yet.</p>}
                {sortedSeasonUsage.map((item) => {
                  const player = players.find((candidate) => candidate.id === item.playerId)
                  const topPositions = Object.entries(item.positionCounts)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 2)
                    .map(([position, count]) => `${position} ${count}`)
                    .join(' · ')

                  return (
                    <div key={item.playerId} className="rounded-lg bg-white px-3 py-2 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-black">{player?.firstName || 'Player'}</p>
                        <p className="text-xs font-black text-[#53665c]">{item.totalDrives}/{seasonDriveCount}</p>
                      </div>
                      <p className="mt-1 text-[#53665c]">OFF {item.offenseDrives} · DEF {item.defenseDrives} · Bench {item.benchDrives}</p>
                      {topPositions && <p className="mt-1 text-xs font-bold text-[#53665c]">{topPositions}</p>}
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="rounded-lg bg-[#f7f5ee] p-3">
              <p className="text-xs font-black uppercase text-[#53665c]">Attendance</p>
              <div className="mt-2 max-h-56 space-y-2 overflow-auto pr-1">
                {attendanceSummary.map((item) => {
                  const player = players.find((candidate) => candidate.id === item.playerId)
                  return (
                    <div key={item.playerId} className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-sm">
                      <span className="font-black">{player?.firstName || 'Player'}</span>
                      <span className="font-black text-[#53665c]">{item.presentGames}/{item.totalGames}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Metric label="Score" value={`${gameSummary.teamScore}-${gameSummary.opponentScore}`} tone="ink" />
          <Metric label="Drives" value={`${gameSummary.completedDrives}/${gameDrives.length}`} tone="sky" />
          <Metric label="TDs" value={getResultCount(gameSummary, 'TD').toString()} tone="green" />
        </div>

        <div className="mt-3 rounded-lg border border-[#d8ded5] bg-white p-3">
          <p className="text-xs font-black uppercase text-[#53665c]">Results</p>
          <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
            {summaryResultOptions.map((result) => (
              <div key={result} className="flex items-center justify-between rounded-lg bg-[#f7f5ee] px-3 py-2">
                <span className="font-bold">{result}</span>
                <span className="font-black">{getResultCount(gameSummary, result)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-3 rounded-lg border border-[#d8ded5] bg-white p-3">
          <p className="text-xs font-black uppercase text-[#53665c]">Scoring Plays</p>
          <div className="mt-2 space-y-2">
            {gameSummary.scoringPlays.length === 0 && <p className="text-sm text-[#53665c]">No scoring plays yet.</p>}
            {gameSummary.scoringPlays.map((play) => (
              <div key={`${play.driveId}-${play.points}`} className="flex items-center justify-between rounded-lg bg-[#f7f5ee] px-3 py-2 text-sm">
                <span className="font-black">{play.label}</span>
                <span className={play.team === 'us' ? 'font-black text-[#1f7a4d]' : 'font-black text-[#c2412d]'}>
                  {play.team === 'us' ? '+' : 'Opp +'}{play.points}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-3 rounded-lg border border-[#d8ded5] bg-white p-3">
          <p className="text-xs font-black uppercase text-[#53665c]">Drive Notes</p>
          <div className="mt-2 space-y-2">
            {gameDrives.filter((drive) => getDriveNoteCount(drive.notes) > 0 || drive.result).length === 0 && (
              <p className="text-sm text-[#53665c]">No drive notes yet.</p>
            )}
            {gameDrives
              .filter((drive) => getDriveNoteCount(drive.notes) > 0 || drive.result)
              .map((drive) => (
                <div key={drive.id} className="rounded-lg bg-[#f7f5ee] px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-black">
                      {drive.unit === 'offense' ? 'OFF' : 'DEF'} {drive.driveNumber}
                    </p>
                    <p className="text-xs font-black text-[#53665c]">{drive.result || 'Notes'}</p>
                  </div>
                  {drive.notes.playCalls && <p className="mt-1"><span className="font-black">Calls:</span> {drive.notes.playCalls}</p>}
                  {drive.notes.whatWorked && <p className="mt-1"><span className="font-black">Worked:</span> {drive.notes.whatWorked}</p>}
                  {drive.notes.whatFailed && <p className="mt-1"><span className="font-black">Failed:</span> {drive.notes.whatFailed}</p>}
                  {drive.notes.playerNotes && <p className="mt-1"><span className="font-black">Players:</span> {drive.notes.playerNotes}</p>}
                  {drive.notes.freeform && <p className="mt-1"><span className="font-black">Next:</span> {drive.notes.freeform}</p>}
                </div>
              ))}
          </div>
        </div>
        <div className="mt-3 space-y-2">
          {currentGameUsage
            .map((item) => {
              const player = players.find((candidate) => candidate.id === item.playerId)
              const topPositions = Object.entries(item.positionCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .map(([position, count]) => `${position} ${count}`)
                .join(' · ')
              return (
                <div key={item.playerId} className="rounded-lg border border-[#d8ded5] bg-white p-3">
                  <div className="flex items-center justify-between">
                    <p className="font-black">{player?.firstName}</p>
                    <p className="text-sm font-black">{item.totalDrives}/{gameDrives.length}</p>
                  </div>
                  <p className="text-sm text-[#53665c]">
                    OFF {item.offenseDrives} · DEF {item.defenseDrives} · Bench {item.benchDrives}
                  </p>
                  {topPositions && <p className="mt-1 text-xs font-bold text-[#53665c]">{topPositions}</p>}
                </div>
              )
            })}
        </div>

        <div className="mt-5 border-t border-[#d8ded5] pt-4">
          <div className="flex items-center gap-2">
            <Settings className="text-[#1f7a4d]" size={22} />
            <h2 className="font-display text-xl font-black">Settings</h2>
          </div>
          <div className="mt-3 grid gap-2">
            <label className="text-sm font-black">
              Team Name
              <input
                value={team.name}
                onChange={(event) => updateTeam({ name: event.target.value })}
                className="mt-1 w-full rounded-lg border border-[#d8ded5] px-3 py-2 outline-none focus:border-[#1f7a4d]"
              />
            </label>
            <label className="text-sm font-black">
              Season
              <input
                value={team.season}
                onChange={(event) => updateTeam({ season: event.target.value })}
                className="mt-1 w-full rounded-lg border border-[#d8ded5] px-3 py-2 outline-none focus:border-[#1f7a4d]"
              />
            </label>
            <label className="text-sm font-black">
              Age Group
              <input
                value={team.ageGroup}
                onChange={(event) => updateTeam({ ageGroup: event.target.value })}
                className="mt-1 w-full rounded-lg border border-[#d8ded5] px-3 py-2 outline-none focus:border-[#1f7a4d]"
              />
            </label>
          </div>

          <div className="mt-4 rounded-lg border border-[#d8ded5] bg-white p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-black uppercase text-[#53665c]">Supabase</p>
                <p className="mt-1 truncate text-sm font-bold text-[#53665c]">{syncUserEmail || syncMessage}</p>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-black uppercase ${syncTone}`}>
                {syncStatus.replace('_', ' ')}
              </span>
            </div>

            {!supabaseConfigured ? (
              <div className="mt-3 rounded-lg bg-[#f7f5ee] px-3 py-2 text-sm font-bold text-[#53665c]">
                Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
              </div>
            ) : syncUserEmail ? (
              <div className="mt-3 grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={saveCloudNow}
                  disabled={syncBusy}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#10201a] px-3 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Cloud size={16} />
                  Save
                </button>
                <button
                  type="button"
                  onClick={loadCloudNow}
                  disabled={syncBusy}
                  className="rounded-lg border border-[#d8ded5] bg-white px-3 py-3 text-sm font-black disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Load
                </button>
                <button
                  type="button"
                  onClick={signOutSupabase}
                  disabled={syncBusy}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#d8ded5] bg-white px-3 py-3 text-sm font-black disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <LogOut size={16} />
                  Out
                </button>
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                <input
                  value={authForm.email}
                  onChange={(event) => setAuthForm({ ...authForm, email: event.target.value })}
                  className="w-full rounded-lg border border-[#d8ded5] px-3 py-2 text-sm outline-none focus:border-[#1f7a4d]"
                  placeholder="Email"
                  type="email"
                />
                <input
                  value={authForm.password}
                  onChange={(event) => setAuthForm({ ...authForm, password: event.target.value })}
                  className="w-full rounded-lg border border-[#d8ded5] px-3 py-2 text-sm outline-none focus:border-[#1f7a4d]"
                  placeholder="Password"
                  type="password"
                />
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => authenticateSupabase('sign-in')}
                    disabled={syncBusy}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#10201a] px-3 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <LogIn size={16} />
                    Sign In
                  </button>
                  <button
                    type="button"
                    onClick={() => authenticateSupabase('sign-up')}
                    disabled={syncBusy}
                    className="rounded-lg border border-[#d8ded5] bg-white px-3 py-3 text-sm font-black disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Create
                  </button>
                </div>
              </div>
            )}

            {supabaseConfigured && syncUserEmail && (
              <div className="mt-4 space-y-3 border-t border-[#d8ded5] pt-3">
                {syncMembership?.role === 'head_coach' && (
                  <div className="space-y-2">
                    <p className="text-xs font-black uppercase text-[#53665c]">Assistant Invite</p>
                    <input
                      value={assistantInviteForm.email}
                      onChange={(event) => setAssistantInviteForm({ ...assistantInviteForm, email: event.target.value })}
                      className="w-full rounded-lg border border-[#d8ded5] px-3 py-2 text-sm outline-none focus:border-[#1f7a4d]"
                      placeholder="Assistant email"
                      type="email"
                    />
                    <label className="flex items-center justify-between gap-3 rounded-lg bg-[#f7f5ee] px-3 py-2 text-sm font-black">
                      Add notes
                      <input
                        type="checkbox"
                        checked={assistantInviteForm.canAddNotes}
                        onChange={(event) => setAssistantInviteForm({ ...assistantInviteForm, canAddNotes: event.target.checked })}
                        className="h-5 w-5 accent-[#1f7a4d]"
                      />
                    </label>
                    <label className="flex items-center justify-between gap-3 rounded-lg bg-[#f7f5ee] px-3 py-2 text-sm font-black">
                      Advance drives
                      <input
                        type="checkbox"
                        checked={assistantInviteForm.canAdvanceDrive}
                        onChange={(event) => setAssistantInviteForm({ ...assistantInviteForm, canAdvanceDrive: event.target.checked })}
                        className="h-5 w-5 accent-[#1f7a4d]"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={createAssistantInvite}
                      disabled={syncBusy}
                      className="w-full rounded-lg bg-[#10201a] px-3 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Create Invite Code
                    </button>
                    {assistantInviteToken && (
                      <div className="rounded-lg bg-[#f7c948] px-3 py-2 text-sm font-black text-[#10201a]">
                        <p className="text-xs uppercase opacity-75">Invite Code</p>
                        <p className="break-all font-mono text-base">{assistantInviteToken}</p>
                      </div>
                    )}
                  </div>
                )}
                <div className="space-y-2">
                  <p className="text-xs font-black uppercase text-[#53665c]">Join Team</p>
                  <input
                    value={assistantInviteAcceptCode}
                    onChange={(event) => setAssistantInviteAcceptCode(event.target.value)}
                    className="w-full rounded-lg border border-[#d8ded5] px-3 py-2 text-sm outline-none focus:border-[#1f7a4d]"
                    placeholder="Invite code"
                  />
                  <button
                    type="button"
                    onClick={acceptAssistantInvite}
                    disabled={syncBusy}
                    className="w-full rounded-lg bg-[#10201a] px-3 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Accept Invite
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="mt-4 rounded-lg border border-[#d8ded5] bg-white p-3">
            <p className="text-xs font-black uppercase text-[#53665c]">Local Role</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => updateAppSettings({ role: 'head' })}
                className={`rounded-lg px-3 py-3 text-sm font-black ${
                  appSettings.role === 'head' ? 'bg-[#10201a] text-white' : 'border border-[#d8ded5] bg-white text-[#10201a]'
                }`}
              >
                Head Coach
              </button>
              <button
                type="button"
                onClick={() => updateAppSettings({ role: 'assistant' })}
                className={`rounded-lg px-3 py-3 text-sm font-black ${
                  appSettings.role === 'assistant' ? 'bg-[#10201a] text-white' : 'border border-[#d8ded5] bg-white text-[#10201a]'
                }`}
              >
                Assistant
              </button>
            </div>
            <label className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-[#f7f5ee] px-3 py-2 text-sm font-black">
              Add notes
              <input
                type="checkbox"
                checked={appSettings.assistantCanAddNotes}
                onChange={(event) => updateAppSettings({ assistantCanAddNotes: event.target.checked })}
                className="h-5 w-5 accent-[#1f7a4d]"
              />
            </label>
            <label className="mt-2 flex items-center justify-between gap-3 rounded-lg bg-[#f7f5ee] px-3 py-2 text-sm font-black">
              Advance drives
              <input
                type="checkbox"
                checked={appSettings.assistantCanAdvanceDrive}
                onChange={(event) => updateAppSettings({ assistantCanAdvanceDrive: event.target.checked })}
                className="h-5 w-5 accent-[#1f7a4d]"
              />
            </label>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <button type="button" onClick={exportBackup} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#10201a] px-3 py-3 text-sm font-black text-white">
              <Download size={16} />
              Export
            </button>
            <button type="button" onClick={importBackup} className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#d8ded5] bg-white px-3 py-3 text-sm font-black">
              <Upload size={16} />
              Import
            </button>
          </div>
          <textarea
            value={backupText}
            onChange={(event) => setBackupText(event.target.value)}
            rows={5}
            className="mt-2 w-full rounded-lg border border-[#d8ded5] px-3 py-2 text-xs outline-none focus:border-[#1f7a4d]"
            placeholder="Backup JSON"
          />
          <button type="button" onClick={resetDemoData} className="mt-2 w-full rounded-lg bg-[#c2412d] px-3 py-3 text-sm font-black text-white">
            Reset Demo Data
          </button>
        </div>
      </section>
    </div>
  )
}

function FieldBoard({
  drive,
  getPlayer,
  selectedPlayer,
  setSelectedPlayerId,
  setDragItem,
  dropOnSlot,
  movePlayerToSlot,
  clearSlot,
  readOnly = false
}: {
  drive: Drive
  getPlayer: (playerId?: string | null) => Player | undefined
  selectedPlayer?: Player
  setSelectedPlayerId: (id: string | null) => void
  setDragItem: (item: DragItem | null) => void
  dropOnSlot: (event: DragEvent<HTMLDivElement>, slotCode: string, driveId?: string) => void
  movePlayerToSlot: (playerId: string, toSlot: string, fromSlot?: string, driveId?: string) => void
  clearSlot: (slotCode: string, driveId?: string) => void
  readOnly?: boolean
}) {
  const slots = SLOTS_BY_UNIT[drive.unit]
  const assignedCount = Object.values(drive.assignments).filter(Boolean).length
  const boardReadOnly = readOnly || drive.locked

  return (
    <div className="mt-3">
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="font-black">{assignedCount}/7 assigned</span>
        <span className="text-[#53665c]">{readOnly ? 'View only' : drive.locked ? 'Locked' : 'Editable'}</span>
      </div>
      <div className="field-yardlines relative h-[460px] min-h-[430px] overflow-hidden rounded-lg border-4 border-[#f6f2df] shadow-field sm:h-[520px]">
        <div className="absolute inset-x-0 top-1/2 h-px bg-[#f6f2df]/70" />
        <div className="absolute left-3 top-3 rounded-full bg-black/20 px-2 py-1 text-xs font-black uppercase text-white">
          {drive.unit}
        </div>
        {slots.map((slot) => {
          const player = getPlayer(drive.assignments[slot.code])
          return (
            <div
              key={slot.code}
              onDragOver={boardReadOnly ? undefined : (event) => event.preventDefault()}
              onDrop={boardReadOnly ? undefined : (event) => dropOnSlot(event, slot.code, drive.id)}
              className="absolute w-[108px] -translate-x-1/2 -translate-y-1/2 sm:w-32"
              style={{ left: `${slot.x}%`, top: `${slot.y}%` }}
            >
              <div
                draggable={!!player && !boardReadOnly}
                onDragStart={() => player && !boardReadOnly && setDragItem({ playerId: player.id, fromSlot: slot.code, driveId: drive.id })}
                onClick={() => {
                  if (boardReadOnly) {
                    return
                  }
                  if (selectedPlayer) {
                    movePlayerToSlot(selectedPlayer.id, slot.code, undefined, drive.id)
                    setSelectedPlayerId(null)
                    return
                  }
                  if (player) {
                    setSelectedPlayerId(player.id)
                  }
                }}
                className={`min-h-[82px] rounded-lg border-2 p-2 text-center shadow-sm transition ${
                  player
                    ? 'border-[#10201a] bg-white text-[#10201a]'
                    : 'border-dashed border-[#f6f2df] bg-white/16 text-white'
                } ${boardReadOnly ? 'cursor-default' : 'cursor-pointer'}`}
              >
                <p className="text-xs font-black uppercase opacity-80">{slot.shortName}</p>
                <p className="mt-1 text-sm font-black leading-tight">{player ? player.firstName : slot.name}</p>
                {player && <p className="text-xs text-[#53665c]">#{player.jerseyNumber || '--'}</p>}
                {player && !boardReadOnly && (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      clearSlot(slot.code, drive.id)
                    }}
                    className="mt-1 rounded-full bg-[#c2412d] px-2 py-1 text-[11px] font-black text-white"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function BenchPanel({
  benchPlayers,
  unavailablePlayers,
  selectedPlayer,
  setSelectedPlayerId,
  setDragItem,
  dropOnBench,
  readOnly = false
}: {
  benchPlayers: Player[]
  unavailablePlayers: Player[]
  selectedPlayer?: Player
  setSelectedPlayerId: (id: string | null) => void
  setDragItem: (item: DragItem | null) => void
  dropOnBench: (event: DragEvent<HTMLDivElement>) => void
  readOnly?: boolean
}) {
  return (
    <section
      onDragOver={readOnly ? undefined : (event) => event.preventDefault()}
      onDrop={readOnly ? undefined : dropOnBench}
      className="rounded-lg border border-[#d8ded5] bg-white/90 p-3 shadow-sm"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-display text-lg font-black">Bench</h3>
        <span className="rounded-full bg-[#d9eef6] px-2 py-1 text-xs font-black">{benchPlayers.length} ready</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 2xl:grid-cols-2">
        {benchPlayers.map((player) => (
          <PlayerChip
            key={player.id}
            player={player}
            selected={selectedPlayer?.id === player.id}
            onClick={() => setSelectedPlayerId(selectedPlayer?.id === player.id ? null : player.id)}
            onDragStart={() => setDragItem({ playerId: player.id })}
            readOnly={readOnly}
          />
        ))}
      </div>
      {unavailablePlayers.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-black text-[#53665c]">Unavailable ({unavailablePlayers.length})</summary>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {unavailablePlayers.map((player) => (
              <div key={player.id} className="rounded-lg border border-[#d8ded5] bg-[#f7c948]/25 p-2 text-sm font-bold text-[#53665c]">
                {player.firstName} #{player.jerseyNumber || '--'}
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  )
}

function PlayerChip({
  player,
  selected,
  onClick,
  onDragStart,
  readOnly = false
}: {
  player: Player
  selected?: boolean
  onClick: () => void
  onDragStart: () => void
  readOnly?: boolean
}) {
  return (
    <button
      type="button"
      draggable={!readOnly}
      onDragStart={() => {
        if (!readOnly) {
          onDragStart()
        }
      }}
      onClick={() => {
        if (!readOnly) {
          onClick()
        }
      }}
      aria-disabled={readOnly}
      className={`rounded-lg border p-2 text-left shadow-sm transition ${
        selected ? 'border-[#10201a] bg-[#f7c948]/35' : 'border-[#d8ded5] bg-white hover:border-[#1f7a4d]'
      } ${readOnly ? 'cursor-default' : ''}`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="font-black leading-tight">{player.firstName}</p>
        <span className="rounded-full bg-[#10201a] px-2 py-1 text-xs font-black text-white">#{player.jerseyNumber || '--'}</span>
      </div>
      <p className="mt-1 text-xs text-[#53665c]">
        QB {player.offenseRatings.QB || 0} · WR {player.offenseRatings.WR || 0} · R {player.defenseRatings.R || 0}
      </p>
    </button>
  )
}

function RatingPanel({
  title,
  unit,
  keys,
  player,
  updateRating
}: {
  title: string
  unit: Unit
  keys: string[]
  player: Player
  updateRating: (playerId: string, unit: Unit, ratingKey: string, delta: number) => void
}) {
  return (
    <div className="rounded-lg border border-[#d8ded5] bg-white p-3">
      <h3 className="font-display text-lg font-black">{title}</h3>
      <div className="mt-2 space-y-2">
        {keys.map((key) => (
          <div key={key} className="flex items-center justify-between rounded-lg bg-[#f7f5ee] px-3 py-2">
            <span className="font-black">{key}</span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => updateRating(player.id, unit, key, -1)} className="h-8 w-8 rounded-lg bg-white font-black">
                -
              </button>
              <span className="w-6 text-center font-black">{getRating(player, unit, key)}</span>
              <button type="button" onClick={() => updateRating(player.id, unit, key, 1)} className="h-8 w-8 rounded-lg bg-white font-black">
                +
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Warnings({ warnings }: { warnings: ReturnType<typeof getFairPlayWarnings> }) {
  if (warnings.length === 0) {
    return (
      <div className="mt-3 flex items-center gap-2 rounded-lg border border-[#d8ded5] bg-white px-3 py-2 text-sm font-bold text-[#1f7a4d]">
        <CheckCircle2 size={16} />
        Ready
      </div>
    )
  }

  return (
    <div className="mt-3 space-y-2">
      {warnings.slice(0, 4).map((warning) => (
        <div
          key={warning.id}
          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold ${
            warning.level === 'error' ? 'bg-[#c2412d] text-white' : 'bg-[#f7c948] text-[#10201a]'
          }`}
        >
          <AlertTriangle size={16} />
          {warning.message}
        </div>
      ))}
    </div>
  )
}

function QuickNote({
  label,
  value,
  onChange,
  disabled = false
}: {
  label: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}) {
  return (
    <label className="mt-3 block text-sm font-black">
      {label}
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        rows={2}
        className="mt-1 w-full rounded-lg border border-[#d8ded5] px-3 py-2 text-sm outline-none focus:border-[#1f7a4d] disabled:cursor-not-allowed disabled:bg-[#f7f5ee] disabled:text-[#53665c]"
      />
    </label>
  )
}

function QuickNoteButton({ label, onClick, disabled = false }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg border border-[#d8ded5] bg-white px-3 py-3 text-left text-sm font-black text-[#10201a] disabled:cursor-not-allowed disabled:opacity-40"
    >
      {label}
    </button>
  )
}

function Metric({ label, value, tone }: { label: string; value: string; tone: 'green' | 'amber' | 'sky' | 'ink' }) {
  const tones = {
    green: 'bg-[#1f7a4d] text-white',
    amber: 'bg-[#f7c948] text-[#10201a]',
    sky: 'bg-[#d9eef6] text-[#10201a]',
    ink: 'bg-[#10201a] text-white'
  }

  return (
    <div className={`rounded-lg p-3 ${tones[tone]}`}>
      <p className="text-xs font-black uppercase opacity-75">{label}</p>
      <p className="mt-1 font-display text-3xl font-black">{value}</p>
    </div>
  )
}

function ActionPanel({
  icon,
  title,
  detail,
  action,
  onClick
}: {
  icon: React.ReactNode
  title: string
  detail: string
  action: string
  onClick: () => void
}) {
  return (
    <button type="button" onClick={onClick} className="rounded-lg border border-[#d8ded5] bg-white p-4 text-left">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-[#d9eef6] p-3 text-[#10201a]">{icon}</div>
        <div>
          <p className="font-black">{title}</p>
          <p className="text-sm text-[#53665c]">{detail}</p>
        </div>
      </div>
      <p className="mt-4 text-sm font-black text-[#1f7a4d]">{action}</p>
    </button>
  )
}

function StatusPill({ status, locked, warnings }: { status: Drive['status']; locked: boolean; warnings: number }) {
  return (
    <span
      className={`rounded-full px-2 py-1 text-xs font-black ${
        warnings > 0 ? 'bg-[#f7c948] text-[#10201a]' : status === 'completed' ? 'bg-[#1f7a4d] text-white' : 'bg-[#d9eef6] text-[#10201a]'
      }`}
    >
      {locked ? 'Locked' : warnings > 0 ? `${warnings} warn` : status}
    </span>
  )
}

function IconButton({
  label,
  onClick,
  disabled,
  children
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#d8ded5] bg-white px-3 text-sm font-black disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}

function NavButton({
  active,
  icon,
  label,
  onClick
}: {
  active: boolean
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-black ${
        active ? 'bg-[#f7c948] text-[#10201a]' : 'text-[#53665c] hover:bg-[#f7f5ee]'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

function MobileNavButton({
  active,
  icon,
  label,
  onClick
}: {
  active: boolean
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-14 flex-col items-center justify-center rounded-lg text-[11px] font-black ${
        active ? 'bg-[#10201a] text-white' : 'text-[#53665c]'
      }`}
    >
      {icon}
      <span className="mt-1">{label}</span>
    </button>
  )
}
