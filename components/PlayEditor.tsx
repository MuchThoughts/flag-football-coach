'use client'

import { useState } from 'react'
import { ChevronLeft, Trash2, X } from 'lucide-react'
import PlayCanvas from '@/components/PlayCanvas'
import { usePositions } from '@/components/PositionsContext'
import { lineOf } from '@/lib/formation-edit'
import { PLAY_AREAS, PLAY_TYPES, placeAll } from '@/lib/playbook'
import { normalizeLine, viewOrDefault } from '@/lib/play-lines'
import type { Formation, PlayArea, PlaybookPlay, PlayLine, PlayType, PlayView } from '@/lib/types'

/** A play as the editor hands it over; the app fills in team, playbook and dates. */
export type PlayEditorDraft = Omit<PlaybookPlay, 'teamId' | 'playbookId' | 'createdAt' | 'updatedAt'>

function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

/**
 * Drawing a play gets the whole page: the field on the left with the players
 * fixed in their formation, and the play's details beside it. The view the
 * play is saved at is how it shows everywhere else.
 */
export default function PlayEditorPage({
  play,
  formations,
  defaultFormationId,
  onSave,
  onDelete,
  onClose
}: {
  play?: PlaybookPlay
  formations: Formation[]
  /** The playbook's base formation, picked for a new play. */
  defaultFormationId?: string
  onSave: (play: PlayEditorDraft) => void
  onDelete?: () => void
  onClose: () => void
}) {
  const [name, setName] = useState(play?.name || '')
  const [formationId, setFormationId] = useState(play?.formationId || defaultFormationId || formations[0]?.id || '')
  const [type, setType] = useState<PlayType>(play?.type || 'pass')
  const [area, setArea] = useState<PlayArea>(play?.area || 'middle')
  const [notes, setNotes] = useState(play?.notes || '')
  const [lines, setLines] = useState<PlayLine[]>(() => (play?.lines || []).map(normalizeLine))
  const [view, setView] = useState<PlayView>(() => viewOrDefault(play?.view))
  // Lines from the old freehand tool still show until the coach clears them.
  const [legacyRoutes, setLegacyRoutes] = useState(play?.routes || [])
  const [legacyFootballs, setLegacyFootballs] = useState(play?.footballs || [])
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const formation = formations.find((item) => item.id === formationId)
  const players = usePositions(formation?.packageId)
  const spots = placeAll(formation?.positions || {}, players)

  function save() {
    if (!formationId) return
    onSave({
      id: play?.id || uid('play'),
      name: name.trim() || 'Untitled Play',
      formationId,
      type,
      area,
      notes: notes.trim(),
      routes: legacyRoutes,
      footballs: legacyFootballs,
      steps: play?.steps,
      lines,
      view
    })
  }

  const headerButton = 'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-black'
  const label = 'text-xs font-black uppercase text-[#53665c]'

  return (
    <div className="space-y-2 py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <button
          type="button"
          onClick={onClose}
          aria-label="Back to plays"
          title="Back to plays"
          className="-ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#53665c] hover:bg-white"
        >
          <ChevronLeft size={18} />
        </button>
        <h1 className="font-display text-xl font-black">
          {play ? 'Edit' : 'New'}
          <span className="hidden sm:inline"> Play</span>
        </h1>
        {confirmingDelete ? (
          <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
            <span className="text-sm font-bold text-[#c2412d]">Delete this play?</span>
            <button type="button" onClick={() => setConfirmingDelete(false)} className={`${headerButton} border border-[#d8ded5] bg-white`}>
              Keep
            </button>
            <button type="button" onClick={onDelete} className={`${headerButton} bg-[#c2412d] text-white`}>
              <Trash2 size={14} />
              Delete
            </button>
          </div>
        ) : (
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {onDelete && (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                aria-label="Delete Play"
                title="Delete this play"
                className={`${headerButton} border border-[#d8ded5] bg-white text-[#c2412d] hover:border-[#c2412d]`}
              >
                <Trash2 size={14} />
                <span className="hidden md:inline">Delete</span>
              </button>
            )}
            <button type="button" onClick={onClose} aria-label="Cancel" className={`${headerButton} border border-[#d8ded5] bg-white`}>
              <X size={14} className="sm:hidden" />
              <span className="hidden sm:inline">Cancel</span>
            </button>
            <button type="button" onClick={save} disabled={!formationId} className={`${headerButton} bg-[#10201a] text-white disabled:opacity-40`}>
              <span className="sm:hidden">Save</span>
              <span className="hidden sm:inline">Save Play</span>
            </button>
          </div>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_240px] lg:items-start">
        <div className="mx-auto w-full" style={{ maxWidth: 'max(320px, calc((100vh - 120px) * 2))' }}>
          {formation ? (
            <PlayCanvas
              players={players}
              spots={spots}
              scrimmage={lineOf(formation)}
              lines={lines}
              onLinesChange={setLines}
              view={view}
              onViewChange={setView}
              legacyRoutes={legacyRoutes}
              legacyFootballs={legacyFootballs}
            />
          ) : (
            <p className="rounded-lg border border-dashed border-[#d8ded5] px-3 py-3 text-center text-sm font-bold text-[#53665c]">
              Build a formation first, then plays can be drawn from it.
            </p>
          )}
        </div>

        <aside className="space-y-2.5 rounded-lg border border-[#d8ded5] bg-white p-2.5">
          <label className="block">
            <span className={label}>Name</span>
            <input
              autoFocus={!play}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Trips Right Go"
              aria-label="Play name"
              className="mt-1 w-full rounded-lg border border-[#d8ded5] px-2.5 py-1.5 outline-none focus:border-[#1f7a4d]"
            />
          </label>

          <label className="block">
            <span className={label}>Formation</span>
            <select
              value={formationId}
              onChange={(event) => setFormationId(event.target.value)}
              aria-label="Formation"
              className="mt-1 w-full rounded-lg border border-[#d8ded5] bg-white px-2.5 py-1.5 font-black outline-none focus:border-[#1f7a4d]"
            >
              {formations.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>

          <div>
            <span className={label}>Pass or run</span>
            <div className="mt-1 grid grid-cols-2 gap-1">
              {PLAY_TYPES.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setType(option)}
                  aria-pressed={type === option}
                  className={`rounded-md border px-2 py-1 text-sm font-black capitalize ${
                    type === option ? 'border-[#10201a] bg-[#f7c948]' : 'border-[#d8ded5] bg-white'
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className={label}>Area of attack</span>
            <div className="mt-1 grid grid-cols-3 gap-1">
              {PLAY_AREAS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setArea(option)}
                  aria-pressed={area === option}
                  className={`rounded-md border px-1 py-1 text-xs font-black capitalize ${
                    area === option ? 'border-[#10201a] bg-[#f7c948]' : 'border-[#d8ded5] bg-white'
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          <label className="block">
            <span className={label}>Notes</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
              placeholder="Reads, when to call it"
              aria-label="Play notes"
              className="mt-1 w-full rounded-lg border border-[#d8ded5] px-2.5 py-1.5 text-sm outline-none focus:border-[#1f7a4d]"
            />
          </label>

          {(legacyRoutes.length > 0 || legacyFootballs.length > 0) && (
            <p className="text-xs font-bold text-[#53665c]">
              This play has lines from the old drawing tool, shown faded.{' '}
              <button
                type="button"
                onClick={() => {
                  setLegacyRoutes([])
                  setLegacyFootballs([])
                }}
                className="font-black text-[#c2412d] hover:underline"
              >
                Remove them
              </button>
            </p>
          )}
        </aside>
      </div>
    </div>
  )
}
