import type { FieldPoint, PlayLine, PlayLineKind, PlayView, SlotPositions } from './types'

/**
 * Geometry for drawn plays, shared by the editor and every export so a play
 * looks the same everywhere. Lines live in field percent (x across 0-100, y
 * down); drawing happens in world units, where the field is 200 wide and 100
 * tall so a percent across and a percent down are the same distance.
 */

export const DEFAULT_VIEW: PlayView = { x: 50, y: 50, zoom: 1 }
export const MIN_ZOOM = 0.4
export const MAX_ZOOM = 3

export interface LineStyle {
  color: string
  /** In world units at zoom 1; drawn thinner as the view zooms in so lines look the same on screen. */
  width: number
  dash?: string
  end: 'arrow' | 'tee' | 'none'
  label: string
}

export const LINE_STYLES: Record<PlayLineKind, LineStyle> = {
  route: { color: '#10201a', width: 1.1, end: 'arrow', label: 'Route' },
  run: { color: '#0b4424', width: 2.2, end: 'arrow', label: 'Run' },
  fake: { color: '#c2412d', width: 2.2, end: 'arrow', label: 'Fake' },
  block: { color: '#10201a', width: 1.4, end: 'tee', label: 'Block' },
  motion: { color: '#10201a', width: 1, dash: '2 1.6', end: 'none', label: 'Motion' }
}

/** The order the player menu offers them in. */
export const LINE_KINDS: PlayLineKind[] = ['block', 'motion', 'route', 'run', 'fake']

function round(value: number) {
  return Math.round(value * 100) / 100
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function toWorld(point: FieldPoint): FieldPoint {
  return { x: round(point.x * 2), y: round(point.y) }
}

export function viewOrDefault(view?: PlayView): PlayView {
  if (!view || !Number.isFinite(view.x) || !Number.isFinite(view.y) || !Number.isFinite(view.zoom)) return DEFAULT_VIEW
  return { x: view.x, y: view.y, zoom: clamp(view.zoom, MIN_ZOOM, MAX_ZOOM) }
}

/** The world rectangle a view shows, always twice as wide as tall. */
export function viewBox(view: PlayView) {
  const w = 200 / view.zoom
  const h = 100 / view.zoom
  return { x: round(view.x * 2 - w / 2), y: round(view.y - h / 2), w: round(w), h: round(h) }
}

/** How much to scale strokes and handles so they look the same size on screen at any zoom. */
export function frameScale(view: PlayView) {
  return 1 / view.zoom
}

/** Zooms by a factor while keeping one field point fixed on screen. */
export function zoomAround(view: PlayView, factor: number, around: FieldPoint): PlayView {
  const zoom = clamp(view.zoom * factor, MIN_ZOOM, MAX_ZOOM)
  const ratio = view.zoom / zoom
  return clampView({
    zoom,
    x: around.x - (around.x - view.x) * ratio,
    y: around.y - (around.y - view.y) * ratio
  })
}

/** Keeps some of the field in sight however far the view is dragged. */
export function clampView(view: PlayView): PlayView {
  return { zoom: view.zoom, x: round(clamp(view.x, -50, 150)), y: round(clamp(view.y, -100, 200)) }
}

/** Where a player's motion ends, if they have one. */
export function motionEnd(lines: PlayLine[], playerCode: string): FieldPoint | undefined {
  const motion = lines.find((line) => line.kind === 'motion' && line.playerCode === playerCode)
  return motion?.points[motion.points.length - 1]
}

/** Where a line starts: at its player, or where the player's motion ends. */
export function lineStart(line: PlayLine, spots: SlotPositions, lines: PlayLine[]): FieldPoint | undefined {
  if (line.kind !== 'motion') {
    const moved = motionEnd(lines, line.playerCode)
    if (moved) return moved
  }
  return spots[line.playerCode]
}

export function linePath(line: PlayLine, start: FieldPoint): FieldPoint[] {
  return [start, ...line.points]
}

/** The SVG path, in world units, through the start and every point, curving where a bend is set. */
export function pathData(line: PlayLine, start: FieldPoint) {
  const path = linePath(line, start).map(toWorld)
  let d = `M${path[0].x},${path[0].y}`
  for (let index = 1; index < path.length; index += 1) {
    const bend = line.bends[index - 1]
    if (bend) {
      const control = toWorld(bend)
      d += ` Q${control.x},${control.y} ${path[index].x},${path[index].y}`
    } else {
      d += ` L${path[index].x},${path[index].y}`
    }
  }
  return d
}

/** One segment as its own path, for picking it out with the pointer. */
export function segmentData(a: FieldPoint, b: FieldPoint, bend: FieldPoint | null) {
  const wa = toWorld(a)
  const wb = toWorld(b)
  if (!bend) return `M${wa.x},${wa.y} L${wb.x},${wb.y}`
  const c = toWorld(bend)
  return `M${wa.x},${wa.y} Q${c.x},${c.y} ${wb.x},${wb.y}`
}

/** The point halfway along a segment, straight or curved: where its bend handle sits. */
export function segmentMiddle(a: FieldPoint, b: FieldPoint, bend: FieldPoint | null): FieldPoint {
  if (!bend) return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  return { x: (a.x + 2 * bend.x + b.x) / 4, y: (a.y + 2 * bend.y + b.y) / 4 }
}

/** The control point that makes a segment curve through a given middle point. */
export function bendThrough(a: FieldPoint, b: FieldPoint, middle: FieldPoint): FieldPoint | null {
  const straight = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  // Pulled back onto the straight line, the bend goes away.
  if (Math.hypot((middle.x - straight.x) * 2, middle.y - straight.y) < 0.6) return null
  return { x: round(2 * middle.x - straight.x), y: round(2 * middle.y - straight.y) }
}

/** The direction a line is travelling at its end, in world units. */
function endDirection(path: FieldPoint[], bends: (FieldPoint | null)[]) {
  const tip = toWorld(path[path.length - 1])
  const bend = bends[path.length - 2]
  const from = toWorld(bend || path[path.length - 2])
  const dx = tip.x - from.x
  const dy = tip.y - from.y
  const length = Math.hypot(dx, dy)
  return length < 0.001 ? { x: 0, y: -1, tip } : { x: dx / length, y: dy / length, tip }
}

/** The arrowhead or block bar at a line's end, as SVG markup in world units. */
export function lineEnd(line: PlayLine, start: FieldPoint, scale: number, color = LINE_STYLES[line.kind].color) {
  const style = LINE_STYLES[line.kind]
  const { x, y, tip } = endDirection(linePath(line, start), line.bends)
  if (style.end === 'arrow') {
    const size = (style.width > 2 ? 4 : 3.2) * scale
    const back = { x: tip.x - x * size, y: tip.y - y * size }
    const side = { x: -y * size * 0.5, y: x * size * 0.5 }
    return `<polygon points="${round(tip.x)},${round(tip.y)} ${round(back.x + side.x)},${round(back.y + side.y)} ${round(back.x - side.x)},${round(back.y - side.y)}" fill="${color}"/>`
  }
  if (style.end === 'tee') {
    const half = 2.8 * scale
    return `<line x1="${round(tip.x - y * half)}" y1="${round(tip.y + x * half)}" x2="${round(tip.x + y * half)}" y2="${round(tip.y - x * half)}" stroke="${color}" stroke-width="${round(style.width * scale)}" stroke-linecap="round"/>`
  }
  return ''
}

/**
 * A new line for a player. Routes, runs and fakes head upfield, a block is a
 * short step forward, and a motion goes sideways toward the middle.
 */
export function newLine(id: string, kind: PlayLineKind, playerCode: string, start: FieldPoint): PlayLine {
  const end =
    kind === 'block'
      ? { x: start.x, y: start.y - 5 }
      : kind === 'motion'
        ? { x: start.x + (start.x < 50 ? 12 : -12), y: start.y }
        : { x: start.x, y: start.y - 18 }
  return { id, playerCode, kind, points: [{ x: round(end.x), y: round(end.y) }], bends: [null] }
}

/** Adds a pivot partway along a segment. Both halves start out straight. */
export function insertPivot(line: PlayLine, segment: number, point: FieldPoint): PlayLine {
  const points = [...line.points]
  const bends = [...line.bends]
  points.splice(segment, 0, { x: round(point.x), y: round(point.y) })
  bends.splice(segment, 1, null, null)
  return { ...line, points, bends }
}

/** Takes a pivot out, joining its two segments into one straight one. The end stays. */
export function removePivot(line: PlayLine, index: number): PlayLine {
  if (index < 0 || index >= line.points.length - 1) return line
  const points = [...line.points]
  const bends = [...line.bends]
  points.splice(index, 1)
  bends.splice(index, 2, null)
  return { ...line, points, bends }
}

/** Moves one point; the segments either side keep their curve's shape relative to it. */
export function movePoint(line: PlayLine, index: number, point: FieldPoint): PlayLine {
  return { ...line, points: line.points.map((item, at) => (at === index ? { x: round(point.x), y: round(point.y) } : item)) }
}

export function setBend(line: PlayLine, segment: number, bend: FieldPoint | null): PlayLine {
  return { ...line, bends: line.bends.map((item, at) => (at === segment ? bend : item)) }
}

/** Lines saved with a missing or mismatched bend list get one straight bend per segment. */
export function normalizeLine(line: PlayLine): PlayLine {
  const points = Array.isArray(line.points) ? line.points.filter((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y)) : []
  const bends = points.map((_, index) => (Array.isArray(line.bends) ? line.bends[index] || null : null))
  return { ...line, points, bends }
}
