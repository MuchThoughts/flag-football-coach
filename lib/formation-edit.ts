import { LINE_OF_SCRIMMAGE } from './positions'
import { gridStepX, gridStepY } from './snapping'
import type { FieldPoint, Formation, PlaybookPosition, SlotPositions } from './types'

/**
 * Moving, selecting and lining up players on the formation page. Positions are
 * field percentages: x across, y down.
 */

/** Players stay this far inside the field's edges. */
export const FIELD_MARGIN_X = 4
export const FIELD_MARGIN_Y = 8
/** The line of scrimmage can move anywhere between these. */
export const LINE_MIN = 15
export const LINE_MAX = 85

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function round(value: number) {
  return Math.round(value * 100) / 100
}

export function lineOf(formation?: Pick<Formation, 'lineOfScrimmage'>) {
  return formation?.lineOfScrimmage ?? LINE_OF_SCRIMMAGE
}

/**
 * Moves a group of players by the same amount from where the drag began. The
 * move is cut short so nobody in the group leaves the field, which keeps the
 * group's shape intact at the edges.
 */
export function moveGroup(origins: SlotPositions, delta: FieldPoint): SlotPositions {
  const spots = Object.values(origins)
  if (spots.length === 0) return {}
  const minX = Math.min(...spots.map((spot) => spot.x))
  const maxX = Math.max(...spots.map((spot) => spot.x))
  const minY = Math.min(...spots.map((spot) => spot.y))
  const maxY = Math.max(...spots.map((spot) => spot.y))
  const dx = clamp(delta.x, FIELD_MARGIN_X - minX, 100 - FIELD_MARGIN_X - maxX)
  const dy = clamp(delta.y, FIELD_MARGIN_Y - minY, 100 - FIELD_MARGIN_Y - maxY)

  return Object.entries(origins).reduce<SlotPositions>((moved, [code, spot]) => {
    moved[code] = { x: round(spot.x + dx), y: round(spot.y + dy) }
    return moved
  }, {})
}

/** Codes of the players inside a box dragged between two corners. */
export function playersInBox(spots: SlotPositions, codes: string[], a: FieldPoint, b: FieldPoint) {
  const left = Math.min(a.x, b.x)
  const right = Math.max(a.x, b.x)
  const top = Math.min(a.y, b.y)
  const bottom = Math.max(a.y, b.y)
  return codes.filter((code) => {
    const spot = spots[code]
    return spot && spot.x >= left && spot.x <= right && spot.y >= top && spot.y <= bottom
  })
}

/**
 * Lines the selected players up in a row across the field, at their average
 * depth. A row that lands near the line of scrimmage goes right onto it.
 */
export function alignHorizontally(spots: SlotPositions, codes: string[], line = LINE_OF_SCRIMMAGE): SlotPositions {
  const chosen = codes.filter((code) => spots[code])
  if (chosen.length < 2) return spots
  const average = chosen.reduce((sum, code) => sum + spots[code].y, 0) / chosen.length
  const y = Math.abs(average - line) <= gridStepY ? line : Math.round(average / gridStepY) * gridStepY
  const next = { ...spots }
  chosen.forEach((code) => {
    next[code] = { ...spots[code], y }
  })
  return next
}

/** Lines the selected players up in a column, at their average spot across. */
export function alignVertically(spots: SlotPositions, codes: string[]): SlotPositions {
  const chosen = codes.filter((code) => spots[code])
  if (chosen.length < 2) return spots
  const average = chosen.reduce((sum, code) => sum + spots[code].x, 0) / chosen.length
  const x = Math.round(average / gridStepX) * gridStepX
  const next = { ...spots }
  chosen.forEach((code) => {
    next[code] = { ...spots[code], x }
  })
  return next
}

/**
 * Spaces the selected players evenly between the two furthest apart, along
 * whichever direction they are more spread out in. The two ends stay put.
 */
export function spaceEvenly(spots: SlotPositions, codes: string[]): SlotPositions {
  const chosen = codes.filter((code) => spots[code])
  if (chosen.length < 3) return spots
  const xs = chosen.map((code) => spots[code].x)
  const ys = chosen.map((code) => spots[code].y)
  // The field is twice as wide as it is tall, so compare spreads on screen.
  const across = (Math.max(...xs) - Math.min(...xs)) * 2 >= Math.max(...ys) - Math.min(...ys)
  const axis = across ? 'x' : 'y'
  const ordered = [...chosen].sort((a, b) => spots[a][axis] - spots[b][axis])
  const first = spots[ordered[0]][axis]
  const last = spots[ordered[ordered.length - 1]][axis]
  const step = (last - first) / (ordered.length - 1)
  const next = { ...spots }
  ordered.forEach((code, index) => {
    next[code] = { ...spots[code], [axis]: round(first + step * index) }
  })
  return next
}

/**
 * Moves the line of scrimmage. Players standing on the line go with it;
 * everyone else stays where they are.
 */
export function moveLine(spots: SlotPositions, from: number, to: number): { line: number; spots: SlotPositions } {
  const line = clamp(Math.round(to), LINE_MIN, LINE_MAX)
  const next = Object.entries(spots).reduce<SlotPositions>((moved, [code, spot]) => {
    moved[code] = Math.abs(spot.y - from) < 0.01 ? { ...spot, y: line } : spot
    return moved
  }, {})
  return { line, spots: next }
}

/**
 * Where the center lines up across the field: the player named C, else the
 * middle of the offensive line, else the middle of the field.
 */
export function centerX(spots: SlotPositions, positions: PlaybookPosition[]) {
  const named = positions.find((position) => /^c(tr)?$/i.test(position.label.trim()) && spots[position.code])
  if (named) return spots[named.code].x
  const line = positions.filter((position) => position.type === 'OL' && spots[position.code])
  if (line.length > 0) return line.reduce((sum, position) => sum + spots[position.code].x, 0) / line.length
  return 50
}

/**
 * Mirrors a formation left to right around the center, for making the other
 * side's version. Linemen keep their spots, so a left guard stays on the left.
 */
export function flipFormation(spots: SlotPositions, positions: PlaybookPosition[]): SlotPositions {
  const axis = centerX(spots, positions)
  const linemen = new Set(positions.filter((position) => position.type === 'OL').map((position) => position.code))
  return Object.entries(spots).reduce<SlotPositions>((flipped, [code, spot]) => {
    flipped[code] = linemen.has(code)
      ? spot
      : { x: round(clamp(2 * axis - spot.x, FIELD_MARGIN_X, 100 - FIELD_MARGIN_X)), y: spot.y }
    return flipped
  }, {})
}

/** "Trips Right" becomes "Trips Left" and the other way round, keeping capitals. */
export function flipName(name: string) {
  return name.replace(/\b(left|right)\b/gi, (word) => {
    const swapped = word.toLowerCase() === 'left' ? 'right' : 'left'
    if (word === word.toUpperCase()) return swapped.toUpperCase()
    if (word[0] === word[0].toUpperCase()) return swapped[0].toUpperCase() + swapped.slice(1)
    return swapped
  })
}
