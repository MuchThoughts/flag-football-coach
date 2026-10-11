'use client'

import { BookOpen, ChevronRight, ClipboardList, Flag, Users } from 'lucide-react'
import type { GameSummary } from '@/lib/game-summary'
import type { Game, Playbook, Team } from '@/lib/types'

export interface PlaybookOverview {
  playbook: Playbook
  playCount: number
  callSheetCount: number
}

/** Where a coach lands: the game at hand, who is here for it, and the playbooks. */
export default function HomePage({
  team,
  game,
  availableCount,
  rosterCount,
  summary,
  playbooks,
  onOpenRoster,
  onOpenPlaybook,
  onOpenPlaybooks
}: {
  team: Team
  game?: Game
  availableCount: number
  rosterCount: number
  summary: GameSummary
  playbooks: PlaybookOverview[]
  onOpenRoster: (tab: 'planning' | 'gameday') => void
  onOpenPlaybook: (playbookId: string) => void
  onOpenPlaybooks: () => void
}) {
  const started = summary.completedDrives > 0
  const gameDetails = [game?.date, game?.location].filter(Boolean).join(' · ')

  return (
    <div className="space-y-5 py-5">
      <div>
        <p className="text-xs font-black uppercase tracking-wide text-[#53665c]">
          {[team.season, team.ageGroup].filter(Boolean).join(' · ') || 'Flag Coach'}
        </p>
        <h1 className="font-display text-3xl font-black">{team.name}</h1>
      </div>

      <section className="overflow-hidden rounded-xl border border-[#d8ded5] bg-white shadow-sm">
        <div className="field-yardlines px-4 py-4 text-white">
          <p className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-white/75">
            <Flag size={13} />
            Selected game
          </p>
          <div className="mt-1 flex items-end justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate font-display text-2xl font-black">{game?.name || 'No game yet'}</h2>
              {gameDetails && <p className="text-sm font-bold text-white/80">{gameDetails}</p>}
            </div>
            <div className="shrink-0 text-right">
              {started ? (
                <>
                  <p className="font-display text-3xl font-black leading-none">
                    {summary.teamScore}
                    <span className="px-1 text-white/60">–</span>
                    {summary.opponentScore}
                  </p>
                  <p className="mt-1 text-xs font-black uppercase text-white/75">
                    {summary.completedDrives} drive{summary.completedDrives === 1 ? '' : 's'} played
                  </p>
                </>
              ) : (
                <p className="rounded-full bg-white/15 px-3 py-1 text-xs font-black uppercase">Not started</p>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 border-b border-[#eef0ea] px-4 py-3">
          <Users size={18} className="shrink-0 text-[#53665c]" />
          <p className="text-sm font-bold">
            <span className="font-black">{availableCount}</span> of {rosterCount} players available
          </p>
        </div>
        <div className="grid grid-cols-2 divide-x divide-[#eef0ea]">
          <button
            type="button"
            onClick={() => onOpenRoster('planning')}
            className="flex items-center justify-between gap-2 px-4 py-3 text-left text-sm font-black hover:bg-[#f7f5ee]"
          >
            Plan lineups
            <ChevronRight size={16} className="text-[#53665c]" />
          </button>
          <button
            type="button"
            onClick={() => onOpenRoster('gameday')}
            className="flex items-center justify-between gap-2 px-4 py-3 text-left text-sm font-black hover:bg-[#f7f5ee]"
          >
            Run gameday
            <ChevronRight size={16} className="text-[#53665c]" />
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-[#d8ded5] bg-white shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-[#eef0ea] px-4 py-3">
          <h2 className="flex items-center gap-2 font-display text-lg font-black">
            <BookOpen size={18} />
            Playbooks
          </h2>
          <button type="button" onClick={onOpenPlaybooks} className="text-sm font-black text-[#1f7a4d] hover:underline">
            View all
          </button>
        </div>
        <ul className="divide-y divide-[#eef0ea]">
          {playbooks.slice(0, 4).map(({ playbook, playCount, callSheetCount }) => (
            <li key={playbook.id}>
              <button
                type="button"
                onClick={() => onOpenPlaybook(playbook.id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[#f7f5ee]"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-black">{playbook.name}</span>
                  <span className="flex items-center gap-3 text-xs font-bold text-[#53665c]">
                    <span>
                      {playCount} play{playCount === 1 ? '' : 's'}
                    </span>
                    <span className="flex items-center gap-1">
                      <ClipboardList size={12} />
                      {callSheetCount} call sheet{callSheetCount === 1 ? '' : 's'}
                    </span>
                  </span>
                </span>
                <ChevronRight size={16} className="shrink-0 text-[#53665c]" />
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
