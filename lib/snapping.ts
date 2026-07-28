import { LINE_OF_SCRIMMAGE } from './positions'
import type { FieldPoint } from './types'

/**
 * The field is twice as wide as it is tall, so a step of 2 across and 4 down
 * covers the same distance on screen: the grid reads as square.
 */
export const gridStepX = 2
export const gridStepY = 4

/** How close a marker has to be for each pull, in field percent. */
const alignRangeX = 3
const alignRangeY = 6
const lineRange = 7

const edgeMarginX = 4
const edgeMarginY = 8

export interface SnapResult extends FieldPoint {
  /** Set when the marker lined up with a neighbour, for drawing a guide. */
  alignedX?: number
  alignedY?: number
  /** Set when the marker locked onto the line of scrimmage. */
  onLine: boolean
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function snapToGrid(value: number, step: number) {
  return Math.round(value / step) * step
}

/** The nearest neighbour value within range, or null when nothing is close. */
function nearest(values: number[], value: number, range: number) {
  let best: number | null = null
  let bestDistance = range

  values.forEach((candidate) => {
    const gap = Math.abs(candidate - value)
    if (gap <= bestDistance) {
      bestDistance = gap
      best = candidate
    }
  })

  return best
}

/**
 * Snaps a dragged marker: the line of scrimmage pulls hardest, then lining up
 * with a neighbouring marker, and otherwise the grid.
 */
export function snapToField(point: FieldPoint, others: FieldPoint[]): SnapResult {
  const result: SnapResult = { x: point.x, y: point.y, onLine: false }

  const alignedX = nearest(
    others.map((other) => other.x),
    point.x,
    alignRangeX
  )
  if (alignedX === null) {
    result.x = snapToGrid(point.x, gridStepX)
  } else {
    result.x = alignedX
    result.alignedX = alignedX
  }

  if (Math.abs(point.y - LINE_OF_SCRIMMAGE) <= lineRange) {
    result.y = LINE_OF_SCRIMMAGE
    result.onLine = true
  } else {
    const alignedY = nearest(
      others.map((other) => other.y),
      point.y,
      alignRangeY
    )
    if (alignedY === null) {
      result.y = snapToGrid(point.y, gridStepY)
    } else {
      result.y = alignedY
      result.alignedY = alignedY
    }
  }

  result.x = clamp(result.x, edgeMarginX, 100 - edgeMarginX)
  result.y = clamp(result.y, edgeMarginY, 100 - edgeMarginY)

  // Clamping can pull a marker off the thing it snapped to.
  if (result.alignedX !== undefined && result.alignedX !== result.x) delete result.alignedX
  if (result.alignedY !== undefined && result.alignedY !== result.y) delete result.alignedY
  if (result.onLine && result.y !== LINE_OF_SCRIMMAGE) result.onLine = false

  return result
}
