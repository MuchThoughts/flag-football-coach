'use client'

import { useState } from 'react'
import { Plus, Trash2, Users, X } from 'lucide-react'
import PlaybookField from '@/components/PlaybookField'
import PositionsEditor from '@/components/PositionsEditor'
import { layoutPositions, positionLabelsValid } from '@/lib/playbook'
import type { Formation, PersonnelPackage } from '@/lib/types'

/**
 * The Packages tab: every personnel package in the playbook, who it puts on
 * the field, and which formations line up in it.
 */
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
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-bold text-[#53665c]">Who takes the field, and what each player is called.</p>
        <button
          type="button"
          onClick={onAdd}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[#1f7a4d] px-3 py-2 text-sm font-black text-white"
        >
          <Plus size={16} />
          New Package
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {packages.map((item, index) => {
          const used = formations.filter((formation) => formation.packageId === item.id)
          return (
            <div key={item.id} className="flex min-w-0 flex-col rounded-lg border border-[#d8ded5] bg-white p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 truncate font-black">
                    <Users size={15} className="shrink-0 text-[#53665c]" />
                    {item.name}
                    {index === 0 && (
                      <span className="rounded-full bg-[#f7f5ee] px-2 py-0.5 text-[10px] font-black uppercase text-[#53665c]">Default</span>
                    )}
                  </p>
                  <p className="text-xs font-bold text-[#53665c]">
                    {item.positions.length} players · {used.length} formation{used.length === 1 ? '' : 's'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onEdit(item)}
                  className="shrink-0 rounded-lg border border-[#d8ded5] px-3 py-2 text-sm font-black hover:border-[#10201a]"
                >
                  Edit
                </button>
              </div>

              <div className="mt-2">
                <PlaybookField positions={layoutPositions(item.positions)} packageId={item.id} compact />
              </div>

              <div className="mt-2 flex flex-wrap gap-1">
                {item.positions.map((position) => (
                  <span
                    key={position.code}
                    className="flex h-7 min-w-7 items-center justify-center rounded-full border-2 border-[#10201a] px-1 text-[11px] font-black"
                  >
                    {position.label}
                  </span>
                ))}
              </div>

              <p className="mt-2 truncate text-xs font-bold text-[#53665c]">
                {used.length > 0 ? `Used by ${used.map((formation) => formation.name).join(', ')}` : 'No formations use it yet.'}
              </p>
            </div>
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
