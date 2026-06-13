import type { DriveNote, DriveResult } from './types'

export type DriveNoteDraft = Partial<Pick<DriveNote, 'whatWorked' | 'whatFailed' | 'playerNotes' | 'playCalls' | 'freeform'>>

function appendNoteValue(currentValue: string, nextValue?: string) {
  const trimmed = nextValue?.trim()
  if (!trimmed) {
    return currentValue
  }

  return currentValue ? `${currentValue}; ${trimmed}` : trimmed
}

export function mergeDriveNotes(notes: DriveNote, result: DriveResult, draft: DriveNoteDraft = {}): DriveNote {
  return {
    ...notes,
    whatWorked: appendNoteValue(notes.whatWorked, draft.whatWorked),
    whatFailed: appendNoteValue(notes.whatFailed, draft.whatFailed),
    playerNotes: appendNoteValue(notes.playerNotes, draft.playerNotes),
    playCalls: appendNoteValue(notes.playCalls, draft.playCalls),
    freeform: appendNoteValue(notes.freeform, draft.freeform),
    result
  }
}
