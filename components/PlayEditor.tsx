'use client'

import { useEffect, useState } from 'react'
import { ChevronLeft, Download, FlipHorizontal2, Trash2, X } from 'lucide-react'
import CallBuilder from '@/components/CallBuilder'
import PlayCanvas from '@/components/PlayCanvas'
import { savePlayImage } from '@/components/PlaybookExport'
import { usePositions } from '@/components/PositionsContext'
import { flipName, lineOf } from '@/lib/formation-edit'
import { PLAY_AREAS, PLAY_TYPES, placeAll } from '@/lib/playbook'
import { classifySteps, playCallFromSteps, stepsFromPlay } from '@/lib/play-builder'
import { formationTitle, mirrorParts, otherSide, playSide, playSpots } from '@/lib/play-flip'
import { LINE_VERSION, playLines, RUN_BLUE, validDefenders, viewOrDefault } from '@/lib/play-lines'
import type { Formation, PlayArea, PlaybookPlay, PlayDefender, PlayLine, PlaySide, PlayStep, PlayType, PlayView } from '@/lib/types'

/** A phone turned sideways: a touch screen that is wider than tall and short. */
const phoneLandscapeQuery = '(orientation: landscape) and (max-height: 500px) and (pointer: coarse)'

function usePhoneLandscape() {
  const [matches, setMatches] = useState(false)
  useEffect(() => {
    const query = window.matchMedia(phoneLandscapeQuery)
    const update = () => setMatches(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return matches
}

/** A play as the editor hands it over; the app fills in team, playbook and dates. */
export type PlayEditorDraft = Omit<PlaybookPlay, 'teamId' | 'playbookId' | 'createdAt' | 'updatedAt'>

function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

/**
 * Drawing a play gets the whole page: the field on the left with the players
 * fixed in their formation, and the play's details beside it, including its
 * call, stacked up from components, which names the play. The view the play
 * is saved at is how it shows everywhere else.
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
  const [formationId, setFormationId] = useState(play?.formationId || defaultFormationId || formations[0]?.id || '')
  const formation = formations.find((item) => item.id === formationId)
  const [side, setSide] = useState<PlaySide>(() => (play ? playSide(play) : 'right'))
  // True when the players stand as the formation's mirror image, for the other side of the play.
  const [mirrored, setMirrored] = useState(Boolean(play?.mirrored))
  /** A mirrored play calls its formation by the other side's name: Trips Right becomes Trips Left. */
  const formationName = (item?: Formation, flipped = mirrored) => (item && flipped ? flipName(item.name) : item?.name)
  // Plays written before the editor had a call are read back from their names where they can be.
  const [steps, setSteps] = useState<PlayStep[]>(() => (play && stepsFromPlay(play, formations)) || [])
  const call = steps.length > 0 ? playCallFromSteps(steps, formationName(formation)) : ''
  const [name, setName] = useState(play?.name || '')
  // The name follows the call until the coach types their own.
  const [nameEdited, setNameEdited] = useState(() => {
    if (!play) return false
    const opened = stepsFromPlay(play, formations) || []
    return opened.length === 0 || play.name !== playCallFromSteps(opened, formationName(formations.find((item) => item.id === play.formationId), Boolean(play.mirrored)))
  })
  const [type, setType] = useState<PlayType>(play?.type || 'pass')
  const [area, setArea] = useState<PlayArea>(play?.area || 'middle')
  const [notes, setNotes] = useState(play?.notes || '')
  const [lines, setLines] = useState<PlayLine[]>(() => (play ? playLines(play) : []))
  const [view, setView] = useState<PlayView>(() => viewOrDefault(play?.view))
  const [defenders, setDefenders] = useState<PlayDefender[]>(() => validDefenders(play?.defenders))
  // Lines from the old freehand tool still show until the coach clears them.
  const [legacyRoutes, setLegacyRoutes] = useState(play?.routes || [])
  const [legacyFootballs, setLegacyFootballs] = useState(play?.footballs || [])
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [savingImage, setSavingImage] = useState(false)

  // Turning a phone sideways gives the field the whole screen; turning it back brings the rest back.
  const fullscreen = usePhoneLandscape() && Boolean(formation)
  useEffect(() => {
    if (!fullscreen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [fullscreen])

  const players = usePositions(formation?.packageId)
  const spots = playSpots({ mirrored }, formation, players)
  // Anyone but the quarterback can get the ball or run a route.
  const receivers = players
    .filter((position) => position.type !== 'QB')
    .map((position) => position.label.trim())
    .filter(Boolean)
  const displayName = nameEdited ? name : call

  /**
   * Turns the play into its other side: everyone but the linemen mirrors
   * across the center, every line, defender and the view mirror with them,
   * and Left and Right swap in the call and the name.
   */
  function flipSide() {
    const flipped = mirrorParts(
      { lines, lineVersion: LINE_VERSION, defenders, view, steps, routes: legacyRoutes, footballs: legacyFootballs },
      placeAll(formation?.positions || {}, players),
      players
    )
    setLines(flipped.lines || [])
    setDefenders(flipped.defenders || [])
    if (flipped.view) setView(flipped.view)
    setSteps(flipped.steps || [])
    setLegacyRoutes(flipped.routes)
    setLegacyFootballs(flipped.footballs)
    if (nameEdited) setName(flipName(name))
    setSide(otherSide(side))
    setMirrored(!mirrored)
  }

  /** A new call also says what kind of play it is, until the coach picks otherwise. */
  function changeSteps(next: PlayStep[]) {
    setSteps(next)
    if (next.length > 0) {
      const sorted = classifySteps(next)
      setType(sorted.type)
      setArea(sorted.area)
    }
  }

  function draft(): PlayEditorDraft {
    return {
      id: play?.id || uid('play'),
      name: displayName.trim() || 'Untitled Play',
      formationId,
      type,
      area,
      notes: notes.trim(),
      routes: legacyRoutes,
      footballs: legacyFootballs,
      steps,
      lines,
      lineVersion: LINE_VERSION,
      view,
      defenders,
      side,
      mirrored
    }
  }

  function save() {
    if (!formationId) return
    onSave(draft())
  }

  async function saveImage() {
    setSavingImage(true)
    try {
      await savePlayImage({ ...draft(), teamId: '', playbookId: '', createdAt: '', updatedAt: '' }, formation, players)
    } finally {
      setSavingImage(false)
    }
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
        {/* The play's name as it stands, following the call and the side. */}
        <h1 className="line-clamp-2 min-w-0 flex-1 break-words font-display text-sm font-black leading-tight sm:line-clamp-1 sm:text-xl" title={displayName.trim() || undefined}>
          {displayName.trim() || 'New Play'}
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
            {formation && (
              <div className="flex items-center rounded-lg border border-[#d8ded5] bg-white p-0.5" role="group" aria-label="Side">
                <FlipHorizontal2 size={14} className="mx-1 hidden text-[#53665c] sm:block" />
                {(['right', 'left'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => option !== side && flipSide()}
                    aria-pressed={side === option}
                    title={side === option ? `Drawn to the ${option}` : `Flip the play to the ${option}. Linemen keep their spots.`}
                    className={`rounded-md px-2 py-1 text-xs font-black capitalize ${
                      side === option ? 'bg-[#10201a] text-white' : 'text-[#53665c] hover:text-[#10201a]'
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            )}
            {formation && (
              <button
                type="button"
                onClick={saveImage}
                disabled={savingImage}
                aria-label="Save as Image"
                title="Save the play as a picture, right and left, at the view on screen"
                className={`${headerButton} border border-[#d8ded5] bg-white disabled:opacity-50`}
              >
                <Download size={14} />
                <span className="hidden md:inline">Image</span>
              </button>
            )}
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

      <div className="space-y-2">
        {/* The field takes the whole width, as tall as the screen allows with its menu still in sight. */}
        <div
          className={fullscreen ? 'fixed inset-0 z-[70] flex items-center justify-center bg-[#10201a]' : 'mx-auto w-full'}
          style={fullscreen ? undefined : { maxWidth: 'max(320px, calc((100dvh - 140px) * 2))' }}
        >
          {/* Same element either way, so turning the phone keeps whatever is selected. */}
          <div className="w-full" style={fullscreen ? { maxWidth: 'calc(100dvh * 2)' } : undefined}>
          {formation ? (
            <PlayCanvas
              players={players}
              spots={spots}
              scrimmage={lineOf(formation)}
              lines={lines}
              onLinesChange={setLines}
              view={view}
              onViewChange={setView}
              defenders={defenders}
              onDefendersChange={setDefenders}
              legacyRoutes={legacyRoutes}
              legacyFootballs={legacyFootballs}
              fullscreen={fullscreen}
            />
          ) : (
            <p className="rounded-lg border border-dashed border-[#d8ded5] px-3 py-3 text-center text-sm font-bold text-[#53665c]">
              Build a formation first, then plays can be drawn from it.
            </p>
          )}
          </div>
        </div>

        <section className="grid gap-x-4 gap-y-2 rounded-lg border border-[#d8ded5] bg-white p-2.5 md:grid-cols-[minmax(240px,1fr)_minmax(0,2fr)]">
          <div className="space-y-2">
            <label className="block">
              <span className="flex items-baseline justify-between gap-2">
                <span className={label}>Name</span>
                {nameEdited && call && (
                  <button
                    type="button"
                    onClick={() => {
                      setNameEdited(false)
                      setName('')
                    }}
                    className="truncate text-[11px] font-black text-[#1f7a4d] hover:underline"
                  >
                    Use the call
                  </button>
                )}
              </span>
              <input
                autoFocus={!play}
                value={displayName}
                onChange={(event) => {
                  setName(event.target.value)
                  setNameEdited(true)
                }}
                placeholder="Build the call below, or type a name"
                aria-label="Play name"
                className="mt-0.5 w-full rounded-lg border border-[#d8ded5] px-2.5 py-1.5 text-sm font-black outline-none focus:border-[#1f7a4d]"
              />
            </label>

            <label className="flex items-center gap-2">
              <span className={`${label} w-[4.6rem] shrink-0`}>Formation</span>
              <select
                value={formationId}
                onChange={(event) => setFormationId(event.target.value)}
                aria-label="Formation"
                className="min-w-0 flex-1 rounded-lg border border-[#d8ded5] bg-white px-2 py-1 text-sm font-black outline-none focus:border-[#1f7a4d]"
              >
                {formations.map((item) => (
                  <option key={item.id} value={item.id}>
                    {formationTitle(item.name, mirrored)}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex items-center gap-2">
              <span className={`${label} w-[4.6rem] shrink-0`}>Type</span>
              <div className="grid flex-1 grid-cols-2 gap-1">
                {PLAY_TYPES.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setType(option)}
                    aria-pressed={type === option}
                    className={`rounded-md border px-2 py-0.5 text-xs font-black capitalize ${
                      type === option ? 'border-transparent text-white' : 'border-[#d8ded5] bg-white text-[#53665c]'
                    }`}
                    style={type === option ? { background: option === 'run' ? RUN_BLUE : '#10201a' } : undefined}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className={`${label} w-[4.6rem] shrink-0`}>Area</span>
              <div className="grid flex-1 grid-cols-3 gap-1">
                {PLAY_AREAS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setArea(option)}
                    aria-pressed={area === option}
                    className={`rounded-md border px-1 py-0.5 text-xs font-black capitalize ${
                      area === option ? 'border-[#10201a] bg-[#f7c948]' : 'border-[#d8ded5] bg-white text-[#53665c]'
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
                rows={2}
                placeholder="Reads, when to call it"
                aria-label="Play notes"
                className="mt-0.5 w-full rounded-lg border border-[#d8ded5] px-2.5 py-1.5 text-sm outline-none focus:border-[#1f7a4d]"
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
          </div>

          <div className="border-t border-[#eef0ea] pt-1.5 md:border-l md:border-t-0 md:pl-4 md:pt-0">
            <span className={label}>Call</span>
            <p className="mb-1 text-xs font-bold leading-tight text-[#53665c]">{call || 'Add components to build the call; it names the play.'}</p>
            <CallBuilder steps={steps} onChange={changeSteps} receivers={receivers} />
          </div>

        </section>
      </div>
    </div>
  )
}
