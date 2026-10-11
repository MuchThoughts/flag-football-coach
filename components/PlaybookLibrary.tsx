'use client'

import { useState } from 'react'
import { BookOpen, ChevronRight, ClipboardList, Plus, X } from 'lucide-react'
import PositionsEditor from '@/components/PositionsEditor'
import { positionLabelsValid, suggestedPositions } from '@/lib/playbook'
import type { Playbook, PlaybookPosition } from '@/lib/types'

export interface PlaybookOverview {
  playbook: Playbook
  playCount: number
  callSheetCount: number
}

/** Every playbook the team keeps; pick one to work in, or start another. */
export default function PlaybookLibrary({
  playbooks,
  onCreate,
  onOpen
}: {
  playbooks: PlaybookOverview[]
  onCreate: (name: string, positions: PlaybookPosition[]) => void
  onOpen: (playbookId: string) => void
}) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [positions, setPositions] = useState<PlaybookPosition[]>(() => suggestedPositions(7))
  const ready = name.trim() !== '' && positionLabelsValid(positions)

  return (
    <div className="space-y-4 py-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-black">Playbooks</h1>
          <p className="text-sm font-bold text-[#53665c]">Choose a playbook to work in, or start a new one.</p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[#10201a] px-3 py-2 text-sm font-black text-white"
        >
          <Plus size={16} />
          New Playbook
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {playbooks.map(({ playbook, playCount, callSheetCount }) => (
          <button
            key={playbook.id}
            type="button"
            onClick={() => onOpen(playbook.id)}
            className="group flex items-center gap-3 rounded-xl border border-[#d8ded5] bg-white p-4 text-left shadow-sm transition hover:border-[#10201a] hover:shadow-md"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[#1f7a4d] text-white">
              <BookOpen size={20} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-display text-lg font-black">{playbook.name}</span>
              <span className="flex items-center gap-3 text-xs font-bold text-[#53665c]">
                <span>{playbook.positions.length} players</span>
                <span>
                  {playCount} play{playCount === 1 ? '' : 's'}
                </span>
                <span className="flex items-center gap-1">
                  <ClipboardList size={12} />
                  {callSheetCount} call sheet{callSheetCount === 1 ? '' : 's'}
                </span>
              </span>
            </span>
            <ChevronRight size={18} className="shrink-0 text-[#53665c] transition group-hover:translate-x-0.5" />
          </button>
        ))}
      </div>

      {creating && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-3 pb-3 sm:items-center">
          <form
            className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-lg border border-[#d8ded5] bg-white p-4 shadow-xl safe-bottom"
            onSubmit={(event) => {
              event.preventDefault()
              if (!ready) return
              onCreate(name, positions)
              setCreating(false)
              setName('')
              setPositions(suggestedPositions(7))
            }}
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-display text-xl font-black">New Playbook</h3>
              <button
                type="button"
                onClick={() => setCreating(false)}
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
              placeholder="e.g. Fall Offense, Tournament Plays"
              aria-label="Playbook name"
              className="mt-4 w-full rounded-lg border border-[#d8ded5] px-3 py-3 outline-none focus:border-[#1f7a4d]"
            />
            <div className="mt-4 border-t border-[#eef0ea] pt-4">
              <PositionsEditor positions={positions} onChange={setPositions} mode="create" />
            </div>
            <button
              type="submit"
              disabled={!ready}
              className="mt-4 w-full rounded-lg bg-[#10201a] px-3 py-3 font-black text-white disabled:opacity-40"
            >
              Create Playbook
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
