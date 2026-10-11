import type { CallSheet, CallSheetSection, Playbook, PlaybookPlay } from './types'

/** Plays written before there were several playbooks all land in this one. */
export const MAIN_PLAYBOOK_ID = 'playbook-main'
export const MAIN_PLAYBOOK_NAME = 'Main Playbook'

function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function createPlaybook(teamId: string, name: string, id = uid('playbook'), now = new Date().toISOString()): Playbook {
  return { id, teamId, name: name.trim() || 'Untitled Playbook', createdAt: now, updatedAt: now }
}

/**
 * Every play has to live in a playbook. A state with none gets the main one, and
 * a play pointing at a playbook that is gone moves to the first one left.
 */
export function ensurePlaybooks(
  teamId: string,
  playbooks: Playbook[] | undefined,
  plays: PlaybookPlay[],
  now: string
): { playbooks: Playbook[]; plays: PlaybookPlay[] } {
  const kept = (playbooks || []).filter((playbook) => playbook && playbook.id)
  const all = kept.length > 0 ? kept : [createPlaybook(teamId, MAIN_PLAYBOOK_NAME, MAIN_PLAYBOOK_ID, now)]
  const fallbackId = all[0].id
  return {
    playbooks: all,
    plays: plays.map((play) =>
      play.playbookId && all.some((playbook) => playbook.id === play.playbookId) ? play : { ...play, playbookId: fallbackId }
    )
  }
}

/** Situations a youth flag call sheet is usually split into. */
export const DEFAULT_CALL_SHEET_SECTIONS = ['Openers', 'Runs', 'Passes', 'Red Zone', 'Extra Point']

/**
 * A new call sheet starts with the usual situations, and the playbook's runs and
 * passes already sorted into their boxes, so the coach trims rather than types.
 */
export function createCallSheet(
  teamId: string,
  playbookId: string,
  name: string,
  plays: PlaybookPlay[],
  now = new Date().toISOString()
): CallSheet {
  const inBook = plays.filter((play) => play.playbookId === playbookId)
  const sections: CallSheetSection[] = DEFAULT_CALL_SHEET_SECTIONS.map((title) => ({
    id: uid('section'),
    title,
    playIds:
      title === 'Runs'
        ? inBook.filter((play) => play.type === 'run').map((play) => play.id)
        : title === 'Passes'
          ? inBook.filter((play) => play.type === 'pass').map((play) => play.id)
          : []
  }))
  return { id: uid('callsheet'), teamId, playbookId, name: name.trim() || 'Call Sheet', sections, createdAt: now, updatedAt: now }
}

/** Takes deleted plays off every sheet so no box points at nothing. */
export function removePlaysFromCallSheets(callSheets: CallSheet[], playIds: string[]): CallSheet[] {
  if (playIds.length === 0) return callSheets
  return callSheets.map((sheet) => {
    const touched = sheet.sections.some((section) => section.playIds.some((id) => playIds.includes(id)))
    if (!touched) return sheet
    return {
      ...sheet,
      sections: sheet.sections.map((section) => ({
        ...section,
        playIds: section.playIds.filter((id) => !playIds.includes(id))
      }))
    }
  })
}

/** Moves one entry up or down within a list, leaving it alone at either end. */
export function moveItem<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) return items
  const next = [...items]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

/**
 * Plays on a sheet are numbered straight through, box after box, so the number
 * a coach signals matches the one on the printed sheet.
 */
export function numberCallSheet(sheet: CallSheet, plays: PlaybookPlay[]) {
  let number = 0
  return sheet.sections.map((section) => ({
    ...section,
    plays: section.playIds
      .map((id) => plays.find((play) => play.id === id))
      .filter((play): play is PlaybookPlay => Boolean(play))
      .map((play) => ({ play, number: ++number }))
  }))
}
