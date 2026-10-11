'use client'

import { Minus, Plus, X } from 'lucide-react'
import PlaybookField from '@/components/PlaybookField'
import { PositionsContext } from '@/components/PositionsContext'
import {
  layoutPositions,
  MAX_PLAYERS,
  MIN_PLAYERS,
  POSITION_LABEL_LENGTH,
  positionLabelsValid,
  suggestedPositions
} from '@/lib/playbook'
import type { PlaybookPosition } from '@/lib/types'

/** The next number nobody is using yet, for a newly added player. */
function nextLabel(positions: PlaybookPosition[]) {
  const used = new Set(positions.map((position) => position.label.trim()))
  let number = 1
  while (used.has(String(number))) number += 1
  return String(number)
}

/**
 * How many players a playbook has and what each circle says. When creating a
 * playbook the count sets up a fresh suggested lineup; once plays exist,
 * players are added or removed one at a time so nobody else moves.
 */
export default function PositionsEditor({
  positions,
  onChange,
  mode
}: {
  positions: PlaybookPosition[]
  onChange: (positions: PlaybookPosition[]) => void
  mode: 'create' | 'edit'
}) {
  const count = positions.length
  const labels = positions.map((position) => position.label.trim().toLowerCase())
  const duplicate = (label: string) => label.trim() !== '' && labels.filter((item) => item === label.trim().toLowerCase()).length > 1

  function setCount(next: number) {
    if (next < MIN_PLAYERS || next > MAX_PLAYERS) return
    if (mode === 'create') {
      onChange(suggestedPositions(next))
    } else if (next > count) {
      onChange([...positions, { code: `pos-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`, label: nextLabel(positions) }])
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-black">Players on the field</p>
          <p className="text-xs font-bold text-[#53665c]">
            {MIN_PLAYERS} to {MAX_PLAYERS}. Labels show in each circle.
          </p>
        </div>
        {mode === 'create' ? (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setCount(count - 1)}
              disabled={count <= MIN_PLAYERS}
              aria-label="Fewer players"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#d8ded5] disabled:opacity-30"
            >
              <Minus size={16} />
            </button>
            <span className="w-8 text-center font-display text-xl font-black" aria-live="polite">
              {count}
            </span>
            <button
              type="button"
              onClick={() => setCount(count + 1)}
              disabled={count >= MAX_PLAYERS}
              aria-label="More players"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#d8ded5] disabled:opacity-30"
            >
              <Plus size={16} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCount(count + 1)}
            disabled={count >= MAX_PLAYERS}
            className="flex shrink-0 items-center gap-1 rounded-lg border border-[#d8ded5] px-3 py-2 text-sm font-black disabled:opacity-30"
          >
            <Plus size={15} />
            Add player
          </button>
        )}
      </div>

      <PositionsContext.Provider value={positions}>
        <PlaybookField positions={layoutPositions(positions)} compact />
      </PositionsContext.Provider>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {positions.map((position, index) => (
          <label key={position.code} className="relative block">
            <span className="mb-1 block text-[11px] font-black uppercase text-[#53665c]">Player {index + 1}</span>
            <input
              value={position.label}
              maxLength={POSITION_LABEL_LENGTH}
              onChange={(event) =>
                onChange(positions.map((item) => (item.code === position.code ? { ...item, label: event.target.value } : item)))
              }
              aria-label={`Label for player ${index + 1}`}
              className={`w-full rounded-lg border px-2 py-2 text-center font-black outline-none focus:border-[#1f7a4d] ${
                !position.label.trim() || duplicate(position.label) ? 'border-[#c2412d]' : 'border-[#d8ded5]'
              }`}
            />
            {mode === 'edit' && count > MIN_PLAYERS && (
              <button
                type="button"
                onClick={() => onChange(positions.filter((item) => item.code !== position.code))}
                aria-label={`Remove ${position.label || `player ${index + 1}`}`}
                className="absolute -right-1 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-[#10201a] text-white"
              >
                <X size={11} />
              </button>
            )}
          </label>
        ))}
      </div>
      {!positionLabelsValid(positions) && (
        <p className="text-xs font-bold text-[#c2412d]">Every player needs a label, and no two can match.</p>
      )}
    </div>
  )
}
