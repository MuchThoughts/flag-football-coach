'use client'

import { useState } from 'react'
import { Plus, Trash2, Users, X } from 'lucide-react'
import PositionsEditor from '@/components/PositionsEditor'
import { positionLabelsValid } from '@/lib/playbook'
import type { Formation, PersonnelPackage } from '@/lib/types'

/** The playbook's personnel packages, each with who it puts on the field. */
export function PackagesPanel({
  packages,
  formations,
  onEdit,
  onAdd
}: {
  packages: PersonnelPackage[]
  formations: Formation[]
  onEdit: (item: PersonnelPackage) => void
  onAdd: () => void
}) {
  return (
    <section className="rounded-xl border border-[#d8ded5] bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-display text-xl font-black">
            <Users size={18} />
            Personnel Packages
          </h2>
          <p className="text-sm font-bold text-[#53665c]">Who takes the field, and what each player is called.</p>
        </div>
        <button
          type="button"
          onClick={onAdd}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[#d8ded5] px-3 py-2 text-sm font-black hover:border-[#10201a]"
        >
          <Plus size={16} />
          New Package
        </button>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {packages.map((item) => {
          const used = formations.filter((formation) => formation.packageId === item.id).length
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onEdit(item)}
              className="rounded-lg border border-[#d8ded5] p-3 text-left hover:border-[#10201a]"
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate font-black">{item.name}</span>
                <span className="shrink-0 text-xs font-bold text-[#53665c]">
                  {used} formation{used === 1 ? '' : 's'}
                </span>
              </span>
              <span className="mt-2 flex flex-wrap gap-1">
                {item.positions.map((position) => (
                  <span
                    key={position.code}
                    className="flex h-7 min-w-7 items-center justify-center rounded-full border-2 border-[#10201a] px-1 text-[11px] font-black"
                  >
                    {position.label}
                  </span>
                ))}
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

/** Name a package and set who is in it. */
export function PackageEditorSheet({
  draft,
  isNew,
  formationCount,
  canDelete,
  onSave,
  onDelete,
  onClose
}: {
  draft: PersonnelPackage
  isNew: boolean
  formationCount: number
  canDelete: boolean
  onSave: (item: PersonnelPackage) => void
  onDelete: () => void
  onClose: () => void
}) {
  const [name, setName] = useState(draft.name)
  const [positions, setPositions] = useState(draft.positions)
  const [confirming, setConfirming] = useState(false)
  const ready = name.trim() !== '' && positionLabelsValid(positions)

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-3 pb-3 sm:items-center">
      <form
        className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-lg border border-[#d8ded5] bg-white p-4 shadow-xl safe-bottom"
        onSubmit={(event) => {
          event.preventDefault()
          if (ready) onSave({ ...draft, name, positions })
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-display text-xl font-black">{isNew ? 'New Package' : 'Edit Package'}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#d8ded5]"
          >
            <X size={18} />
          </button>
        </div>

        <label className="mt-4 block">
          <span className="text-xs font-black uppercase text-[#53665c]">Package name</span>
          <input
            autoFocus={isNew}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Base, Heavy, Empty, 2 TE"
            aria-label="Package name"
            className="mt-1 w-full rounded-lg border border-[#d8ded5] px-3 py-3 outline-none focus:border-[#1f7a4d]"
          />
        </label>

        <div className="mt-4 border-t border-[#eef0ea] pt-4">
          <PositionsEditor positions={positions} onChange={setPositions} mode="edit" />
        </div>

        <button type="submit" disabled={!ready} className="mt-4 w-full rounded-lg bg-[#10201a] px-3 py-3 font-black text-white disabled:opacity-40">
          {isNew ? 'Create Package' : 'Save Package'}
        </button>

        {!isNew &&
          canDelete &&
          (confirming ? (
            <div className="mt-3 rounded-lg border border-[#c2412d] p-3">
              <p className="text-sm font-bold">
                Delete {draft.name}?{' '}
                {formationCount > 0
                  ? `Its ${formationCount} formation${formationCount === 1 ? '' : 's'} will use the first package instead.`
                  : 'No formations use it.'}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setConfirming(false)} className="rounded-lg border border-[#d8ded5] px-3 py-2 font-black">
                  Cancel
                </button>
                <button type="button" onClick={onDelete} className="rounded-lg bg-[#c2412d] px-3 py-2 font-black text-white">
                  Delete
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-black text-[#c2412d] hover:bg-[#fbeeeb]"
            >
              <Trash2 size={15} />
              Delete Package
            </button>
          ))}
      </form>
    </div>
  )
}
