import type { SlotPositions, Unit } from './types'

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
  { code: '1', name: '1', shortName: '1', unit: 'offense', ratingKey: 'WR', x: 8, y: 52 },
  { code: '2', name: '2', shortName: '2', unit: 'offense', ratingKey: 'WR', x: 28, y: 52 },
  { code: 'C', name: 'Center', shortName: 'C', unit: 'offense', ratingKey: 'C', x: 50, y: 52 },
  { code: '3', name: '3', shortName: '3', unit: 'offense', ratingKey: 'WR', x: 72, y: 52 },
  { code: '4', name: '4', shortName: '4', unit: 'offense', ratingKey: 'WR', x: 92, y: 52 },
  { code: 'QB', name: 'Quarterback', shortName: 'QB', unit: 'offense', ratingKey: 'QB', x: 50, y: 72 },
  { code: 'RB', name: 'Running Back', shortName: 'RB', unit: 'offense', ratingKey: 'RB', x: 36, y: 80 }
]

export const DEFENSE_SLOTS: FieldSlot[] = [
  { code: 'LE', name: 'Left End', shortName: 'LE', unit: 'defense', ratingKey: 'E', x: 30, y: 52 },
  { code: 'R', name: 'Rusher', shortName: 'R', unit: 'defense', ratingKey: 'R', x: 50, y: 52 },
  { code: 'RE', name: 'Right End', shortName: 'RE', unit: 'defense', ratingKey: 'E', x: 70, y: 52 },
  { code: 'LCB', name: 'Left Corner', shortName: 'LCB', unit: 'defense', ratingKey: 'CB', x: 8, y: 28 },
  { code: 'MLB', name: 'Middle Linebacker', shortName: 'MLB', unit: 'defense', ratingKey: 'MLB', x: 50, y: 28 },
  { code: 'RCB', name: 'Right Corner', shortName: 'RCB', unit: 'defense', ratingKey: 'CB', x: 92, y: 28 },
  { code: 'S', name: 'Safety', shortName: 'S', unit: 'defense', ratingKey: 'S', x: 50, y: 8 }
]

/** Both fields draw the ball on this line, and markers are magnetic to it. */
export const LINE_OF_SCRIMMAGE = 52

export const SLOTS_BY_UNIT: Record<Unit, FieldSlot[]> = {
  offense: OFFENSE_SLOTS,
  defense: DEFENSE_SLOTS
}

export function slotPositionKey(unit: Unit, slotCode: string) {
  return `${unit}:${slotCode}`
}

/** Where a marker sits on the field: the coach's dragged position, else the default. */
export function getSlotPosition(slot: FieldSlot, slotPositions: SlotPositions) {
  return slotPositions[slotPositionKey(slot.unit, slot.code)] || { x: slot.x, y: slot.y }
}

export function createEmptyAssignments(unit: Unit) {
  return SLOTS_BY_UNIT[unit].reduce<Record<string, string | null>>((assignments, slot) => {
    assignments[slot.code] = null
    return assignments
  }, {})
}
