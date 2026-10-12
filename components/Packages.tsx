'use client'

import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { PositionRows } from '@/components/PositionsEditor'
import { positionLabelsValid } from '@/lib/playbook'
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
  onDelete
}: {
  packages: PersonnelPackage[]
  formations: Formation[]
  onChange: (item: PersonnelPackage) => void
  onAdd: () => void
  onDelete: (packageIds: string[]) => void
}) {
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  // At least one package has to stay for formations to line up in.
  const deletingAll = selected.length >= packages.length
  const movedFormations = formations.filter((formation) => selected.includes(formation.packageId)).length

  function stopSelecting() {
    setSelecting(false)
    setSelected([])
  }

  return (
    <section className="space-y-3">
      {selecting ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#c2412d] bg-[#fbeeeb] px-3 py-2">
          <p className="text-sm font-bold">
            {selected.length === 0
              ? 'Select the packages to delete.'
              : deletingAll
                ? 'Keep at least one package.'
                : `${selected.length} selected.${
                    movedFormations > 0
                      ? ` ${movedFormations} formation${movedFormations === 1 ? '' : 's'} will move to the first remaining package.`
                      : ''
                  }`}
          </p>
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={stopSelecting} className="rounded-lg border border-[#d8ded5] bg-white px-3 py-2 text-sm font-black">
              Cancel
            </button>
            <button
              type="button"
              disabled={selected.length === 0 || deletingAll}
              onClick={() => {
                onDelete(selected)
                stopSelecting()
              }}
              className="flex items-center gap-1.5 rounded-lg bg-[#c2412d] px-3 py-2 text-sm font-black text-white disabled:opacity-40"
            >
              <Trash2 size={15} />
              Delete{selected.length > 0 ? ` ${selected.length}` : ''}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-bold text-[#53665c]">Who takes the field in each package. Changes save as you type.</p>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={onAdd}
              className="flex items-center gap-1.5 rounded-lg bg-[#1f7a4d] px-3 py-2 text-sm font-black text-white"
            >
              <Plus size={16} />
              New Package
            </button>
            <button
              type="button"
              onClick={() => setSelecting(true)}
              disabled={packages.length <= 1}
              className="flex items-center gap-1.5 rounded-lg border border-[#d8ded5] bg-white px-3 py-2 text-sm font-black text-[#c2412d] disabled:opacity-40"
            >
              <Trash2 size={15} />
              Delete Packages
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
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
              <div className="flex items-center gap-2 border-b border-[#d8ded5] bg-[#10201a] px-3 py-2">
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
                  className="min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 font-display text-lg font-black text-white outline-none placeholder:text-white/40 focus:bg-white/10"
                />
                <span className="shrink-0 text-xs font-bold text-white/70">
                  {used} formation{used === 1 ? '' : 's'}
                </span>
              </div>
              <PositionRows positions={item.positions} onChange={(positions) => onChange({ ...item, positions })} />
              {!positionLabelsValid(item.positions) && (
                <p className="border-t border-[#eef0ea] px-3 py-2 text-xs font-bold text-[#c2412d]">
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
