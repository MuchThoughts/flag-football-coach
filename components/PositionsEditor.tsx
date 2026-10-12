'use client'

import { Minus, Plus } from 'lucide-react'
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  POSITION_LABEL_LENGTH,
  POSITION_TYPES,
  suggestedPositions
} from '@/lib/playbook'
import type { PlaybookPosition, PositionType } from '@/lib/types'

/**
 * One package as a table: the player numbers are fixed, and each row has the
 * kind of player and the name shown in their circle.
 */
export function PositionRows({
  positions,
  onChange
}: {
  positions: PlaybookPosition[]
  onChange: (positions: PlaybookPosition[]) => void
}) {
  const names = positions.map((position) => position.label.trim().toLowerCase())
  const clash = (label: string) => !label.trim() || names.filter((item) => item === label.trim().toLowerCase()).length > 1

  function update(code: string, patch: Partial<PlaybookPosition>) {
    onChange(positions.map((position) => (position.code === code ? { ...position, ...patch } : position)))
  }

  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="whitespace-nowrap text-left text-[11px] font-black uppercase text-[#53665c]">
          <th className="w-8 py-1 pl-2.5 font-black">#</th>
          <th className="w-24 py-1 pr-1.5 font-black">Position Type</th>
          <th className="py-1 pr-2.5 font-black">Position Name</th>
        </tr>
      </thead>
      <tbody>
        {positions.map((position, index) => (
          <tr key={position.code} className="border-t border-[#eef0ea]">
            <td className="py-0.5 pl-2.5 font-display text-sm font-black text-[#53665c]">{index + 1}</td>
            <td className="py-0.5 pr-1.5">
              <select
                value={position.type}
                onChange={(event) => update(position.code, { type: event.target.value as PositionType })}
                aria-label={`Position type for player ${index + 1}`}
                className="w-full rounded border border-[#d8ded5] bg-white px-1.5 py-0.5 text-sm font-black outline-none focus:border-[#1f7a4d]"
              >
                {POSITION_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </td>
            <td className="py-0.5 pr-2.5">
              <input
                value={position.label}
                maxLength={POSITION_LABEL_LENGTH}
                onChange={(event) => update(position.code, { label: event.target.value })}
                aria-label={`Position name for player ${index + 1}`}
                className={`w-full rounded border px-1.5 py-0.5 text-sm font-black outline-none focus:border-[#1f7a4d] ${
                  clash(position.label) ? 'border-[#c2412d] bg-[#fbeeeb]' : 'border-[#d8ded5]'
                }`}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/**
 * Setting up a new playbook: how many players are on the field, then what
 * each one is. Changing the count starts over from a suggested lineup.
 */
export default function PositionsEditor({
  positions,
  onChange
}: {
  positions: PlaybookPosition[]
  onChange: (positions: PlaybookPosition[]) => void
}) {
  const count = positions.length

  function setCount(next: number) {
    if (next < MIN_PLAYERS || next > MAX_PLAYERS) return
    onChange(suggestedPositions(next))
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-black">Players on the field</p>
          <p className="text-xs font-bold text-[#53665c]">
            {MIN_PLAYERS} to {MAX_PLAYERS}. Names show in each player&apos;s circle.
          </p>
        </div>
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
      </div>

      <div className="overflow-hidden rounded-lg border border-[#d8ded5]">
        <PositionRows positions={positions} onChange={onChange} />
      </div>
    </div>
  )
}
