'use client'

import { useState } from 'react'
import { ArrowDown, ArrowUp, ChevronLeft, ClipboardList, Plus, Printer, Search, Trash2, X } from 'lucide-react'
import { PlayDiagram, PrintPortal } from '@/components/PlaybookExport'
import { moveItem, numberCallSheet } from '@/lib/playbooks'
import type { CallSheet, CallSheetSection, Formation, PlaybookPlay } from '@/lib/types'

function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function countPlays(sheet: CallSheet) {
  return sheet.sections.reduce((total, section) => total + section.playIds.length, 0)
}

/**
 * The call sheets made from one playbook: pick one to work on, or start a new
 * one. Opening a sheet takes over the screen with its editor.
 */
export function CallSheetsSheet({
  playbookName,
  teamName,
  defaultName,
  callSheets,
  plays,
  formations,
  onCreate,
  onSave,
  onDelete,
  onClose
}: {
  playbookName: string
  teamName: string
  defaultName: string
  callSheets: CallSheet[]
  plays: PlaybookPlay[]
  formations: Formation[]
  onCreate: (name: string) => CallSheet
  onSave: (sheet: CallSheet) => void
  onDelete: (sheetId: string) => void
  onClose: () => void
}) {
  const [openId, setOpenId] = useState<string | null>(null)
  const [newName, setNewName] = useState(defaultName)
  const open = callSheets.find((sheet) => sheet.id === openId)

  if (open) {
    return (
      <CallSheetEditor
        sheet={open}
        plays={plays}
        formations={formations}
        teamName={teamName}
        playbookName={playbookName}
        onChange={onSave}
        onDelete={() => {
          onDelete(open.id)
          setOpenId(null)
        }}
        onBack={() => setOpenId(null)}
      />
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-3 pb-3 sm:items-center">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border border-[#d8ded5] bg-white p-4 shadow-xl safe-bottom">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display text-xl font-black">Call Sheets</h3>
            <p className="mt-1 text-sm font-bold text-[#53665c]">Built from {playbookName}.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#d8ded5]"
          >
            <X size={18} />
          </button>
        </div>

        <form
          className="mt-4 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            const created = onCreate(newName)
            setOpenId(created.id)
          }}
        >
          <input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="Call sheet name"
            aria-label="New call sheet name"
            className="min-w-0 flex-1 rounded-lg border border-[#d8ded5] px-3 py-2 outline-none focus:border-[#1f7a4d]"
          />
          <button
            type="submit"
            disabled={plays.length === 0}
            className="flex shrink-0 items-center gap-1 rounded-lg bg-[#10201a] px-3 py-2 text-sm font-black text-white disabled:opacity-40"
          >
            <Plus size={16} />
            Create
          </button>
        </form>
        {plays.length === 0 && (
          <p className="mt-2 text-xs font-bold text-[#53665c]">Add plays to this playbook before making a call sheet.</p>
        )}

        <div className="mt-4 space-y-2">
          {callSheets.length === 0 ? (
            <p className="rounded-lg border border-dashed border-[#d8ded5] px-3 py-6 text-center text-sm font-bold text-[#53665c]">
              No call sheets yet.
            </p>
          ) : (
            callSheets.map((sheet) => (
              <button
                key={sheet.id}
                type="button"
                onClick={() => setOpenId(sheet.id)}
                className="flex w-full items-center gap-3 rounded-lg border border-[#d8ded5] bg-white px-3 py-3 text-left hover:border-[#10201a]"
              >
                <ClipboardList size={18} className="shrink-0 text-[#53665c]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-black">{sheet.name}</span>
                  <span className="block text-xs font-bold text-[#53665c]">
                    {countPlays(sheet)} play{countPlays(sheet) === 1 ? '' : 's'} · {sheet.sections.length} section
                    {sheet.sections.length === 1 ? '' : 's'}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function CallSheetEditor({
  sheet,
  plays,
  formations,
  teamName,
  playbookName,
  onChange,
  onDelete,
  onBack
}: {
  sheet: CallSheet
  plays: PlaybookPlay[]
  formations: Formation[]
  teamName: string
  playbookName: string
  onChange: (sheet: CallSheet) => void
  onDelete: () => void
  onBack: () => void
}) {
  const [pickingSectionId, setPickingSectionId] = useState<string | null>(null)
  const [printing, setPrinting] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const numbered = numberCallSheet(sheet, plays)
  const pickingSection = sheet.sections.find((section) => section.id === pickingSectionId)

  function update(patch: Partial<CallSheet>) {
    onChange({ ...sheet, ...patch, updatedAt: new Date().toISOString() })
  }

  function updateSection(sectionId: string, patch: Partial<CallSheetSection>) {
    update({ sections: sheet.sections.map((section) => (section.id === sectionId ? { ...section, ...patch } : section)) })
  }

  const formationName = (play: PlaybookPlay) => formations.find((item) => item.id === play.formationId)?.name || 'No formation'

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[#f7f5ee]">
      <div className="sticky top-0 z-10 border-b border-[#d8ded5] bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-3 py-2 sm:px-5">
          <button
            type="button"
            onClick={onBack}
            className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-2 text-sm font-black text-[#53665c] hover:bg-[#f7f5ee]"
          >
            <ChevronLeft size={18} />
            Call Sheets
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setPrinting(true)}
            className="flex shrink-0 items-center gap-2 rounded-lg bg-[#10201a] px-3 py-2 text-sm font-black text-white"
          >
            <Printer size={16} />
            Print
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-3xl space-y-4 px-3 py-4 sm:px-5">
        <div>
          <p className="text-xs font-black uppercase tracking-wide text-[#53665c]">{playbookName}</p>
          <input
            value={sheet.name}
            onChange={(event) => update({ name: event.target.value })}
            aria-label="Call sheet name"
            className="mt-1 w-full rounded-lg border border-transparent bg-transparent px-1 py-1 font-display text-2xl font-black outline-none hover:border-[#d8ded5] focus:border-[#1f7a4d] focus:bg-white"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {numbered.map((section, sectionIndex) => (
            <section key={section.id} className="overflow-hidden rounded-lg border border-[#d8ded5] bg-white">
              <div className="flex items-center gap-1 border-b border-[#d8ded5] bg-[#10201a] px-2 py-1.5">
                <input
                  value={section.title}
                  onChange={(event) => updateSection(section.id, { title: event.target.value })}
                  aria-label="Section title"
                  className="min-w-0 flex-1 rounded bg-transparent px-1 py-1 text-sm font-black uppercase tracking-wide text-white outline-none focus:bg-white/10"
                />
                <button
                  type="button"
                  onClick={() => update({ sections: moveItem(sheet.sections, sectionIndex, -1) })}
                  disabled={sectionIndex === 0}
                  aria-label="Move section earlier"
                  className="flex h-7 w-7 items-center justify-center rounded text-white/80 hover:bg-white/10 disabled:opacity-30"
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => update({ sections: moveItem(sheet.sections, sectionIndex, 1) })}
                  disabled={sectionIndex === sheet.sections.length - 1}
                  aria-label="Move section later"
                  className="flex h-7 w-7 items-center justify-center rounded text-white/80 hover:bg-white/10 disabled:opacity-30"
                >
                  <ArrowDown size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => update({ sections: sheet.sections.filter((item) => item.id !== section.id) })}
                  aria-label={`Remove ${section.title || 'section'}`}
                  className="flex h-7 w-7 items-center justify-center rounded text-white/80 hover:bg-white/10"
                >
                  <Trash2 size={14} />
                </button>
              </div>

              <ol className="divide-y divide-[#eef0ea]">
                {section.plays.map(({ play, number }, playIndex) => (
                  <li key={play.id} className="flex items-center gap-2 px-2 py-2">
                    <span className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-[#f7f5ee] px-1 text-xs font-black">
                      {number}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-black">{play.name}</span>
                      <span className="block truncate text-[11px] font-bold uppercase text-[#53665c]">
                        {formationName(play)} · {play.type}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => updateSection(section.id, { playIds: moveItem(section.playIds, playIndex, -1) })}
                      disabled={playIndex === 0}
                      aria-label={`Move ${play.name} up`}
                      className="flex h-7 w-7 items-center justify-center rounded text-[#53665c] hover:bg-[#f7f5ee] disabled:opacity-30"
                    >
                      <ArrowUp size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => updateSection(section.id, { playIds: moveItem(section.playIds, playIndex, 1) })}
                      disabled={playIndex === section.plays.length - 1}
                      aria-label={`Move ${play.name} down`}
                      className="flex h-7 w-7 items-center justify-center rounded text-[#53665c] hover:bg-[#f7f5ee] disabled:opacity-30"
                    >
                      <ArrowDown size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => updateSection(section.id, { playIds: section.playIds.filter((id) => id !== play.id) })}
                      aria-label={`Remove ${play.name}`}
                      className="flex h-7 w-7 items-center justify-center rounded text-[#53665c] hover:bg-[#f7f5ee]"
                    >
                      <X size={14} />
                    </button>
                  </li>
                ))}
              </ol>
              <button
                type="button"
                onClick={() => setPickingSectionId(section.id)}
                className="flex w-full items-center justify-center gap-1 border-t border-[#eef0ea] px-3 py-2 text-sm font-black text-[#1f7a4d] hover:bg-[#f7f5ee]"
              >
                <Plus size={15} />
                {section.plays.length === 0 ? 'Add plays' : 'Add or remove plays'}
              </button>
            </section>
          ))}
        </div>

        <button
          type="button"
          onClick={() => update({ sections: [...sheet.sections, { id: uid('section'), title: 'New Section', playIds: [] }] })}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-[#b9c4b8] px-3 py-3 text-sm font-black text-[#53665c] hover:bg-white"
        >
          <Plus size={16} />
          Add section
        </button>

        <div className="pt-4">
          {confirmingDelete ? (
            <div className="flex items-center justify-end gap-2">
              <span className="text-sm font-bold text-[#53665c]">Delete this call sheet?</span>
              <button type="button" onClick={() => setConfirmingDelete(false)} className="rounded-lg border border-[#d8ded5] bg-white px-3 py-2 text-sm font-black">
                Cancel
              </button>
              <button type="button" onClick={onDelete} className="rounded-lg bg-[#c2412d] px-3 py-2 text-sm font-black text-white">
                Delete
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="ml-auto flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-black text-[#c2412d] hover:bg-white"
            >
              <Trash2 size={15} />
              Delete call sheet
            </button>
          )}
        </div>
      </div>

      {pickingSection && (
        <PlayPicker
          title={pickingSection.title}
          plays={plays}
          formations={formations}
          selectedIds={pickingSection.playIds}
          onChange={(playIds) => updateSection(pickingSection.id, { playIds })}
          onClose={() => setPickingSectionId(null)}
        />
      )}

      {printing && (
        <PrintCallSheet
          sheet={sheet}
          plays={plays}
          formations={formations}
          teamName={teamName}
          playbookName={playbookName}
          onClose={() => setPrinting(false)}
        />
      )}
    </div>
  )
}

/** Tick plays in or out of one section; new picks go to the bottom of the box. */
function PlayPicker({
  title,
  plays,
  formations,
  selectedIds,
  onChange,
  onClose
}: {
  title: string
  plays: PlaybookPlay[]
  formations: Formation[]
  selectedIds: string[]
  onChange: (playIds: string[]) => void
  onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const term = search.trim().toLowerCase()
  const formationName = (play: PlaybookPlay) => formations.find((item) => item.id === play.formationId)?.name || ''
  const visible = plays.filter((play) => !term || `${play.name} ${formationName(play)} ${play.type}`.toLowerCase().includes(term))

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 px-3 pb-3 sm:items-center">
      <div className="flex max-h-[85vh] w-full max-w-md flex-col rounded-lg border border-[#d8ded5] bg-white shadow-xl safe-bottom">
        <div className="flex items-center justify-between gap-3 border-b border-[#eef0ea] p-4">
          <div className="min-w-0">
            <h3 className="truncate font-display text-xl font-black">{title || 'Section'}</h3>
            <p className="text-sm font-bold text-[#53665c]">{selectedIds.length} selected</p>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 rounded-lg bg-[#10201a] px-4 py-2 text-sm font-black text-white">
            Done
          </button>
        </div>
        <div className="p-3 pb-0">
          <label className="flex items-center gap-2 rounded-lg border border-[#d8ded5] px-3 focus-within:border-[#1f7a4d]">
            <Search size={16} className="text-[#53665c]" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search plays"
              aria-label="Search plays"
              className="min-w-0 flex-1 py-2 outline-none"
            />
          </label>
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto p-3">
          {visible.map((play) => {
            const checked = selectedIds.includes(play.id)
            return (
              <label
                key={play.id}
                className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 ${
                  checked ? 'border-[#1f7a4d] bg-[#eef6f0]' : 'border-[#d8ded5]'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onChange(checked ? selectedIds.filter((id) => id !== play.id) : [...selectedIds, play.id])}
                  className="h-4 w-4 accent-[#1f7a4d]"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-black">{play.name}</span>
                  <span className="block truncate text-xs font-bold uppercase text-[#53665c]">
                    {formationName(play) || 'No formation'} · {play.type} · {play.area}
                  </span>
                </span>
              </label>
            )
          })}
          {visible.length === 0 && (
            <p className="px-3 py-6 text-center text-sm font-bold text-[#53665c]">No plays match that.</p>
          )}
        </div>
      </div>
    </div>
  )
}

/** A one-glance game-day sheet: every box on landscape paper, plays numbered straight through. */
function PrintCallSheet({
  sheet,
  plays,
  formations,
  teamName,
  playbookName,
  onClose
}: {
  sheet: CallSheet
  plays: PlaybookPlay[]
  formations: Formation[]
  teamName: string
  playbookName: string
  onClose: () => void
}) {
  const [diagrams, setDiagrams] = useState(false)
  const sections = numberCallSheet(sheet, plays).filter((section) => section.plays.length > 0)
  const total = sections.reduce((sum, section) => sum + section.plays.length, 0)
  const formationFor = (play: PlaybookPlay) => formations.find((item) => item.id === play.formationId)

  return (
    <>
      <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 px-3 pb-3 sm:items-center">
        <div className="w-full max-w-md rounded-lg border border-[#d8ded5] bg-white p-4 shadow-xl safe-bottom">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-display text-xl font-black">Print Call Sheet</h3>
              <p className="mt-1 text-sm font-bold text-[#53665c]">
                {total} play{total === 1 ? '' : 's'} on landscape paper. Choose Save as PDF in the print dialog to keep a copy.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#d8ded5]"
            >
              <X size={18} />
            </button>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {(
              [
                { value: false, label: 'Names only' },
                { value: true, label: 'With diagrams' }
              ] as const
            ).map((option) => (
              <button
                key={option.label}
                type="button"
                onClick={() => setDiagrams(option.value)}
                className={`rounded-lg px-3 py-2 text-sm font-black ${
                  diagrams === option.value ? 'bg-[#10201a] text-white' : 'bg-[#f7f5ee] text-[#53665c]'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={total === 0}
            onClick={() => window.print()}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-[#10201a] px-3 py-3 font-black text-white disabled:opacity-40"
          >
            <Printer size={16} />
            Print or Save PDF
          </button>
        </div>
      </div>

      <PrintPortal page="letter landscape">
        <header className="print-header">
          <div>
            <h1>{sheet.name}</h1>
            <p className="print-header-team">{[teamName, playbookName].filter(Boolean).join(' · ')}</p>
          </div>
          <p>
            {total} play{total === 1 ? '' : 's'}
          </p>
        </header>
        <div className={diagrams ? 'callsheet-grid callsheet-diagrams' : 'callsheet-grid'}>
          {sections.map((section) => (
            <section key={section.id} className="callsheet-section">
              <h2>{section.title}</h2>
              <ol>
                {section.plays.map(({ play, number }) => (
                  <li key={play.id}>
                    <div className="callsheet-row">
                      <span className="callsheet-number">{number}</span>
                      <span className="callsheet-name">{play.name}</span>
                      <span className="callsheet-formation">{formationFor(play)?.name}</span>
                    </div>
                    {diagrams && <PlayDiagram play={play} formation={formationFor(play)} />}
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      </PrintPortal>
    </>
  )
}
