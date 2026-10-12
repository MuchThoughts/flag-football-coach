'use client'

import { useState } from 'react'
import { Minus, Plus, Trash2 } from 'lucide-react'
import { PositionRows } from '@/components/PositionsEditor'
import { MAX_PLAYERS, MIN_PLAYERS, positionLabelsValid } from '@/lib/playbook'
import type { Formation, PersonnelPackage } from '@/lib/types'

/**
 * The Packages tab: every personnel package as a table, edited in place.
 * Deleting is a mode: pick the packages, then confirm.
 */
export function PackagesPanel({
  packages,
  formations,
  onChange,
  onAdd,
  onDelete,
  playerCount,
  onPlayerCountChange
}: {
  packages: PersonnelPackage[]
  formations: Formation[]
  onChange: (item: PersonnelPackage) => void
  onAdd: () => void
  onDelete: (packageIds: string[]) => void
  playerCount: number
  onPlayerCountChange: (count: number) => void
}) {
  const [confirmingFewer, setConfirmingFewer] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  // At least one package has to stay for formations to line up in.
  const deletingAll = selected.length >= packages.length
  const movedFormations = formations.filter((formation) => selected.includes(formation.packageId)).length

  function stopSelecting() {
    setSelecting(false)
    setSelected([])
  }

  const smallButton = 'flex items-center gap-1 rounded-md px-2.5 py-1 text-sm font-black disabled:opacity-40'
  const stepButton = 'flex h-7 w-7 items-center justify-center rounded-md border border-[#d8ded5] bg-white disabled:opacity-30'

  return (
    <section className="space-y-2">
      <div
        className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border px-2.5 py-1.5 ${
          selecting || confirmingFewer ? 'border-[#c2412d] bg-[#fbeeeb]' : 'border-[#d8ded5] bg-white'
        }`}
      >
        {confirmingFewer ? (
          <>
            <span className="text-sm font-bold">Remove player {playerCount} from every package and formation?</span>
            <div className="ml-auto flex gap-1.5">
              <button type="button" onClick={() => setConfirmingFewer(false)} className={`${smallButton} border border-[#d8ded5] bg-white`}>
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  onPlayerCountChange(playerCount - 1)
                  setConfirmingFewer(false)
                }}
                className={`${smallButton} bg-[#c2412d] text-white`}
              >
                Remove
              </button>
            </div>
          </>
        ) : selecting ? (
          <>
            <span className="text-sm font-bold">
              {selected.length === 0
                ? 'Select the packages to delete.'
                : deletingAll
                  ? 'Keep at least one package.'
                  : `${selected.length} selected.${
                      movedFormations > 0
                        ? ` ${movedFormations} formation${movedFormations === 1 ? '' : 's'} will move to the first remaining package.`
                        : ''
                    }`}
            </span>
            <div className="ml-auto flex gap-1.5">
              <button type="button" onClick={stopSelecting} className={`${smallButton} border border-[#d8ded5] bg-white`}>
                Cancel
              </button>
              <button
                type="button"
                disabled={selected.length === 0 || deletingAll}
                onClick={() => {
                  onDelete(selected)
                  stopSelecting()
                }}
                className={`${smallButton} bg-[#c2412d] text-white`}
              >
                <Trash2 size={14} />
                Delete{selected.length > 0 ? ` ${selected.length}` : ''}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-1.5" title="Every package in this playbook has this many players">
              <span className="text-sm font-black">Players</span>
              <button
                type="button"
                onClick={() => setConfirmingFewer(true)}
                disabled={playerCount <= MIN_PLAYERS}
                aria-label="Fewer players"
                className={stepButton}
              >
                <Minus size={14} />
              </button>
              <span className="w-6 text-center font-display text-lg font-black" aria-live="polite">
                {playerCount}
              </span>
              <button
                type="button"
                onClick={() => onPlayerCountChange(playerCount + 1)}
                disabled={playerCount >= MAX_PLAYERS}
                aria-label="More players"
                className={stepButton}
              >
                <Plus size={14} />
              </button>
            </div>
            <span className="hidden text-xs font-bold text-[#53665c] md:inline">Changes save as you type.</span>
            <div className="ml-auto flex gap-1.5">
              <button type="button" onClick={onAdd} className={`${smallButton} bg-[#1f7a4d] text-white`}>
                <Plus size={14} />
                New Package
              </button>
              <button
                type="button"
                onClick={() => setSelecting(true)}
                disabled={packages.length <= 1}
                className={`${smallButton} border border-[#d8ded5] bg-white text-[#c2412d]`}
              >
                <Trash2 size={14} />
                Delete Packages
              </button>
            </div>
          </>
        )}
      </div>

      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {packages.map((item) => {
          const used = formations.filter((formation) => formation.packageId === item.id).length
          const checked = selected.includes(item.id)
          return (
            <div
              key={item.id}
              className={`min-w-0 overflow-hidden rounded-lg border bg-white ${
                checked ? 'border-[#c2412d] ring-2 ring-[#c2412d]/30' : 'border-[#d8ded5]'
              }`}
            >
              <div className="flex items-center gap-2 bg-[#10201a] px-2.5 py-1">
                {selecting && (
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => setSelected((current) => (checked ? current.filter((id) => id !== item.id) : [...current, item.id]))}
                    aria-label={`Select ${item.name || 'package'} to delete`}
                    className="h-4 w-4 shrink-0 accent-[#c2412d]"
                  />
                )}
                <input
                  value={item.name}
                  onChange={(event) => onChange({ ...item, name: event.target.value })}
                  placeholder="Package name"
                  aria-label="Package name"
                  className="min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 font-display text-base font-black text-white outline-none placeholder:text-white/40 focus:bg-white/10"
                />
                <span className="shrink-0 text-[11px] font-bold text-white/70">
                  {used} formation{used === 1 ? '' : 's'}
                </span>
              </div>
              <PositionRows positions={item.positions} onChange={(positions) => onChange({ ...item, positions })} />
              {!positionLabelsValid(item.positions) && (
                <p className="border-t border-[#eef0ea] px-2.5 py-1 text-xs font-bold text-[#c2412d]">
                  Every position needs a name, and no two can match.
                </p>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
