'use client'

import { BookOpen, ChevronDown, Cloud, CloudOff, RefreshCw, Users } from 'lucide-react'
import type { Game } from '@/lib/types'

export type Section = 'playbooks' | 'roster'
export type SyncStatus = 'local' | 'loading' | 'synced' | 'saving' | 'error'

const sections: Array<{ value: Section; label: string; icon: typeof BookOpen }> = [
  { value: 'playbooks', label: 'Playbooks', icon: BookOpen },
  { value: 'roster', label: 'Roster', icon: Users }
]

const syncLabels: Record<SyncStatus, string> = {
  local: 'Local only',
  loading: 'Loading',
  synced: 'Synced',
  saving: 'Saving',
  error: 'Sync error'
}

/**
 * The app's one bar: where you are on the left, and on the right which game
 * everything is about and whether the staff's devices agree.
 */
export default function TopToolbar({
  section,
  onNavigate,
  games,
  selectedGameId,
  setSelectedGameId,
  syncStatus,
  syncMessage,
  saveNow,
  loadNow,
  syncBusy
}: {
  section: Section
  onNavigate: (section: Section) => void
  games: Game[]
  selectedGameId: string
  setSelectedGameId: (id: string) => void
  syncStatus: SyncStatus
  syncMessage: string
  saveNow: () => void
  loadNow: () => void
  syncBusy: boolean
}) {
  const syncDot =
    syncStatus === 'error'
      ? 'bg-[#f0705c]'
      : syncStatus === 'synced'
        ? 'bg-[#4cc38a]'
        : syncStatus === 'saving' || syncStatus === 'loading'
          ? 'bg-[#f7c948]'
          : 'bg-white/40'
  const SyncIcon = syncStatus === 'local' || syncStatus === 'error' ? CloudOff : Cloud

  return (
    <header className="sticky top-0 z-40 bg-[#10201a] text-white shadow-[0_8px_24px_rgba(16,32,26,0.18)]">
      <div className="mx-auto flex h-14 max-w-6xl items-stretch gap-1 px-1 sm:px-4">
        <nav className="flex items-stretch" aria-label="Main">
          {sections.map(({ value, label, icon: Icon }) => {
            const active = section === value
            return (
              <button
                key={value}
                type="button"
                onClick={() => onNavigate(value)}
                aria-current={active ? 'page' : undefined}
                className={`relative flex flex-col items-center justify-center gap-0.5 px-2.5 text-[11px] font-black transition-colors sm:flex-row sm:gap-2 sm:px-4 sm:text-sm ${
                  active ? 'text-white' : 'text-white/60 hover:text-white'
                }`}
              >
                <Icon size={18} strokeWidth={2.4} />
                {label}
                <span
                  aria-hidden
                  className={`absolute inset-x-2 bottom-0 h-[3px] rounded-t-full ${active ? 'bg-[#f7c948]' : 'bg-transparent'}`}
                />
              </button>
            )
          })}
        </nav>

        <div className="flex-1" />

        <div className="flex items-center gap-2">
          <label className="relative flex items-center">
            <span className="sr-only">Game</span>
            <select
              value={selectedGameId}
              onChange={(event) => setSelectedGameId(event.target.value)}
              className="max-w-[118px] appearance-none truncate rounded-lg border border-white/15 bg-white/10 py-1.5 pl-3 pr-7 text-sm font-black text-white outline-none hover:bg-white/15 focus:border-[#f7c948] sm:max-w-[200px]"
            >
              {games.map((game) => (
                <option key={game.id} value={game.id} className="text-[#10201a]">
                  {game.name}
                </option>
              ))}
            </select>
            <ChevronDown size={14} className="pointer-events-none absolute right-2 text-white/70" />
          </label>

          <details className="relative">
            <summary
              aria-label={`Sync: ${syncLabels[syncStatus]}`}
              title={syncLabels[syncStatus]}
              className="relative flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-lg border border-white/15 bg-white/10 hover:bg-white/15 [&::-webkit-details-marker]:hidden"
            >
              <SyncIcon size={17} />
              <span className={`absolute right-1.5 top-1.5 h-2 w-2 rounded-full ring-2 ring-[#10201a] ${syncDot}`} />
            </summary>
            <div className="absolute right-0 top-full mt-2 w-[min(320px,calc(100vw-1rem))] rounded-lg border border-[#d8ded5] bg-white p-3 text-sm text-[#10201a] shadow-xl">
              <p className="flex items-center gap-2 font-black">
                <span className={`h-2 w-2 rounded-full ${syncDot}`} />
                {syncLabels[syncStatus]}
              </p>
              <p className="mt-1 text-xs font-bold text-[#53665c]">{syncMessage}</p>
              <p className="mt-2 text-xs font-bold text-[#53665c]">
                Everyone with the app shares this team&apos;s data — no sign-in needed.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={saveNow}
                  disabled={syncBusy || syncStatus === 'local'}
                  className="rounded-lg bg-[#10201a] px-3 py-2 font-black text-white disabled:opacity-40"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={loadNow}
                  disabled={syncBusy || syncStatus === 'local'}
                  className="flex items-center justify-center gap-1 rounded-lg border border-[#d8ded5] px-3 py-2 font-black disabled:opacity-40"
                >
                  <RefreshCw size={14} />
                  Refresh
                </button>
              </div>
            </div>
          </details>
        </div>
      </div>
    </header>
  )
}
