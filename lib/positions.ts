import type { Unit } from './types'

export interface FieldSlot {
  code: string
  name: string
  shortName: string
  unit: Unit
  ratingKey: string
  x: number
  y: number
}

export const OFFENSE_SLOTS: FieldSlot[] = [
  { code: '1', name: 'Left WR', shortName: 'LWR', unit: 'offense', ratingKey: 'WR', x: 11, y: 78 },
  { code: '2', name: 'Left Slot', shortName: 'LS', unit: 'offense', ratingKey: 'WR', x: 28, y: 63 },
  { code: 'C', name: 'Center', shortName: 'C', unit: 'offense', ratingKey: 'C', x: 50, y: 82 },
  { code: 'QB', name: 'Quarterback', shortName: 'QB', unit: 'offense', ratingKey: 'QB', x: 50, y: 58 },
  { code: 'RB', name: 'Running Back', shortName: 'RB', unit: 'offense', ratingKey: 'RB', x: 50, y: 34 },
  { code: '3', name: 'Right Slot', shortName: 'RS', unit: 'offense', ratingKey: 'WR', x: 72, y: 63 },
  { code: '4', name: 'Right WR', shortName: 'RWR', unit: 'offense', ratingKey: 'WR', x: 89, y: 78 }
]

export const DEFENSE_SLOTS: FieldSlot[] = [
  { code: 'LCB', name: 'Left Corner', shortName: 'LCB', unit: 'defense', ratingKey: 'CB', x: 12, y: 28 },
  { code: 'LE', name: 'Left End', shortName: 'LE', unit: 'defense', ratingKey: 'E', x: 34, y: 38 },
  { code: 'R', name: 'Rusher', shortName: 'R', unit: 'defense', ratingKey: 'R', x: 50, y: 18 },
  { code: 'RE', name: 'Right End', shortName: 'RE', unit: 'defense', ratingKey: 'E', x: 66, y: 38 },
  { code: 'RCB', name: 'Right Corner', shortName: 'RCB', unit: 'defense', ratingKey: 'CB', x: 88, y: 28 },
  { code: 'MLB', name: 'Middle Linebacker', shortName: 'MLB', unit: 'defense', ratingKey: 'MLB', x: 50, y: 52 },
  { code: 'S', name: 'Safety', shortName: 'S', unit: 'defense', ratingKey: 'S', x: 50, y: 78 }
]

export const SLOTS_BY_UNIT: Record<Unit, FieldSlot[]> = {
  offense: OFFENSE_SLOTS,
  defense: DEFENSE_SLOTS
}

export function createEmptyAssignments(unit: Unit) {
  return SLOTS_BY_UNIT[unit].reduce<Record<string, string | null>>((assignments, slot) => {
    assignments[slot.code] = null
    return assignments
  }, {})
}
