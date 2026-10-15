'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import PlaybookField from '@/components/PlaybookField'
import { usePositions } from '@/components/PositionsContext'

import { placeAll } from '@/lib/playbook'
import type { Formation, SlotPositions } from '@/lib/types'

/** A name for the copy that is not already taken: "Trips copy", "Trips copy 2". */
function copyName(name: string, taken: string[]) {
  const base = `${name} copy`
  const used = new Set(taken.map((item) => item.trim().toLowerCase()))
  if (!used.has(base.toLowerCase())) return base
  let number = 2
  while (used.has(`${base} ${number}`.toLowerCase())) number += 1
  return `${base} ${number}`
}

/**
 * Copies a formation, to start a new one from it. There is no need to copy
 * one for its other side: every formation flips between right and left.
 */
export default function DuplicateFormationSheet({
  formation,
  takenNames,
  onCreate,
  onClose
}: {
  formation: Formation
  takenNames: string[]
  onCreate: (copy: { name: string; packageId: string; positions: SlotPositions; lineOfScrimmage?: number }) => void
  onClose: () => void
}) {
  const players = usePositions(formation.packageId)
  const [name, setName] = useState(() => copyName(formation.name, takenNames))
  const result = placeAll(formation.positions, players)

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-3 pb-3 sm:items-center">
      <form
        className="w-full max-w-lg rounded-lg border border-[#d8ded5] bg-white p-3 shadow-xl safe-bottom"
        onSubmit={(event) => {
          event.preventDefault()
          onCreate({
            name: name.trim() || copyName(formation.name, takenNames),
            packageId: formation.packageId,
            positions: result,
            lineOfScrimmage: formation.lineOfScrimmage
          })
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <h3 className="truncate font-display text-lg font-black">Duplicate {formation.name}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#d8ded5]"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mt-2 flex gap-2">
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-label="New formation name"
            className="min-w-0 flex-1 rounded-lg border border-[#d8ded5] px-2.5 py-1.5 outline-none focus:border-[#1f7a4d]"
          />
        </div>

        <div className="mt-2">
          <PlaybookField positions={result} packageId={formation.packageId} lineOfScrimmage={formation.lineOfScrimmage} compact />
        </div>
        <p className="mt-1 text-xs font-bold text-[#53665c]">An exact copy. Every formation already flips between right and left.</p>

        <button type="submit" className="mt-2 w-full rounded-lg bg-[#10201a] px-3 py-2 font-black text-white">
          Create Formation
        </button>
      </form>
    </div>
  )
}
