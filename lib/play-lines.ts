import type { FieldPoint, PlayDefender, PlayLine, PlayLineKind, PlayView, SlotPositions } from './types'

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
  end: 'arrow' | 'tee' | 'x' | 'none'
  label: string
  /** True when the player can do something else from where this line ends. */
  follow: boolean
  /** A pale edge under the line so it reads on the grass. */
  halo?: boolean
}

export const RUN_BLUE = '#1d5fe0'
export const FAKE_RED = '#c2412d'
export const HALO = 'rgba(246,242,223,0.6)'

export const LINE_STYLES: Record<PlayLineKind, LineStyle> = {
  route: { color: '#10201a', width: 1.1, end: 'arrow', label: 'Route', follow: false },
  run: { color: RUN_BLUE, width: 2.2, end: 'arrow', label: 'Run', follow: false, halo: true },
  fake: { color: FAKE_RED, width: 2.2, end: 'arrow', label: 'Fake', follow: false },
  block: { color: '#10201a', width: 1.4, end: 'tee', label: 'Block', follow: false },
  motion: { color: '#10201a', width: 1, dash: '2 1.6', end: 'none', label: 'Motion', follow: true },
  handoff: { color: RUN_BLUE, width: 1.2, end: 'x', label: 'Handoff', follow: true, halo: true },
  fakeHandoff: { color: FAKE_RED, width: 1.2, end: 'x', label: 'Fake Handoff', follow: true }
}

/** The order the player menu offers them in. */
export const LINE_KINDS: PlayLineKind[] = ['block', 'motion', 'route', 'run', 'fake', 'handoff', 'fakeHandoff']

/** Plays saved from here on say which line each line follows. */
export const LINE_VERSION = 2

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

/** Where a line ends. */
export function lineTip(line: PlayLine): FieldPoint | undefined {
  return line.points[line.points.length - 1]
}

/** Where a line starts: where the line it follows ends, or else at its player. */
export function lineStart(line: PlayLine, spots: SlotPositions, lines: PlayLine[]): FieldPoint | undefined {
  if (line.fromLineId) {
    const from = lines.find((item) => item.id === line.fromLineId)
    const tip = from && from.id !== line.id ? lineTip(from) : undefined
    if (tip) return tip
  }
  return spots[line.playerCode]
}

/** Every line that carries on from this one, and from those, and so on. */
export function followers(lines: PlayLine[], lineId: string): PlayLine[] {
  const found: PlayLine[] = []
  const seen = new Set([lineId])
  let frontier = [lineId]
  while (frontier.length > 0) {
    const next = lines.filter((item) => item.fromLineId && frontier.includes(item.fromLineId) && !seen.has(item.id))
    next.forEach((item) => seen.add(item.id))
    found.push(...next)
    frontier = next.map((item) => item.id)
  }
  return found
}

/**
 * Takes a line out. Anything that followed it now follows whatever it
 * followed, or starts back at the player.
 */
export function removeLine(lines: PlayLine[], lineId: string): PlayLine[] {
  const removed = lines.find((item) => item.id === lineId)
  return lines
    .filter((item) => item.id !== lineId)
    .map((item) => (item.fromLineId === lineId ? { ...item, fromLineId: removed?.fromLineId } : item))
}

function shiftLine(line: PlayLine, dx: number, dy: number): PlayLine {
  const shift = (point: FieldPoint) => ({ x: round(point.x + dx), y: round(point.y + dy) })
  return { ...line, points: line.points.map(shift), bends: line.bends.map((bend) => (bend ? shift(bend) : null)) }
}

/**
 * Moves one point of a line. Moving a line's end takes everything that
 * follows it along too, so a route after a motion keeps its shape.
 */
export function moveLinePoint(lines: PlayLine[], lineId: string, index: number, point: FieldPoint): PlayLine[] {
  const line = lines.find((item) => item.id === lineId)
  if (!line || !line.points[index]) return lines
  const isEnd = index === line.points.length - 1
  const dx = point.x - line.points[index].x
  const dy = point.y - line.points[index].y
  const moving = new Set(isEnd ? followers(lines, lineId).map((item) => item.id) : [])
  return lines.map((item) => (item.id === lineId ? movePoint(item, index, point) : moving.has(item.id) ? shiftLine(item, dx, dy) : item))
}

/**
 * Before lines said what they follow, every line a player had after a motion
 * started where that motion ended. Old plays are read that way.
 */
export function chainLegacyLines(lines: PlayLine[]): PlayLine[] {
  return lines.map((line) => {
    if (line.kind === 'motion' || line.fromLineId) return line
    const motion = lines.find((item) => item.kind === 'motion' && item.playerCode === line.playerCode)
    return motion ? { ...line, fromLineId: motion.id } : line
  })
}

/** A play's lines, cleaned up and read the way they were drawn. */
export function playLines(play: { lines?: PlayLine[]; lineVersion?: number }): PlayLine[] {
  const lines = (play.lines || []).map(normalizeLine)
  return (play.lineVersion || 0) >= LINE_VERSION ? lines : chainLegacyLines(lines)
}

export function linePath(line: PlayLine, start: FieldPoint): FieldPoint[] {
  return [start, ...line.points]
}

/** The point on a straight or curved segment a given fraction of the way along. */
function along(a: FieldPoint, b: FieldPoint, control: FieldPoint | null, t: number): FieldPoint {
  if (!control) return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
  const u = 1 - t
  return { x: u * u * a.x + 2 * u * t * control.x + t * t * b.x, y: u * u * a.y + 2 * u * t * control.y + t * t * b.y }
}

/**
 * The last segment cut short by a distance, so an arrowhead can sit on the
 * end without the line poking out past its tip. Works in world units.
 */
function trimSegment(a: FieldPoint, b: FieldPoint, control: FieldPoint | null, trim: number) {
  const length = Math.hypot(b.x - a.x, b.y - a.y)
  if (trim <= 0 || length < 0.001) return { end: b, control }
  // Never cut a short segment away entirely.
  const cut = Math.min(trim, length * 0.8)
  let low = 0
  let high = 1
  for (let step = 0; step < 24; step += 1) {
    const middle = (low + high) / 2
    const point = along(a, b, control, middle)
    if (Math.hypot(b.x - point.x, b.y - point.y) > cut) low = middle
    else high = middle
  }
  const t = low
  const end = along(a, b, control, t)
  // The first part of a curve is a curve with its control pulled in the same fraction.
  return { end, control: control ? { x: a.x + (control.x - a.x) * t, y: a.y + (control.y - a.y) * t } : null }
}

/** The arrowhead's length and half its width, in world units. */
export function arrowSize(width: number, scale: number) {
  const length = (2.6 + width * 1.4) * scale
  return { length, half: length * 0.5 }
}

/** How far short of its tip a line's stroke stops, so its end marker covers it cleanly. */
export function endTrim(line: PlayLine, scale: number) {
  const style = LINE_STYLES[line.kind]
  return style.end === 'arrow' ? arrowSize(style.width, scale).length * 0.6 : 0
}

/**
 * The SVG path, in world units, through the start and every point, curving
 * where a bend is set. A trim stops it short of the end.
 */
export function pathData(line: PlayLine, start: FieldPoint, trim = 0) {
  const path = linePath(line, start).map(toWorld)
  let d = `M${path[0].x},${path[0].y}`
  for (let index = 1; index < path.length; index += 1) {
    const bend = line.bends[index - 1]
    let control = bend ? toWorld(bend) : null
    let end = path[index]
    if (index === path.length - 1 && trim > 0) {
      const cut = trimSegment(path[index - 1], end, control, trim)
      end = { x: round(cut.end.x), y: round(cut.end.y) }
      control = cut.control ? { x: round(cut.control.x), y: round(cut.control.y) } : null
    }
    d += control ? ` Q${control.x},${control.y} ${end.x},${end.y}` : ` L${end.x},${end.y}`
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

/** The direction a line is travelling as it arrives at its end, in world units. */
function endDirection(path: FieldPoint[], bends: (FieldPoint | null)[], trim: number) {
  const world = path.map(toWorld)
  const tip = world[world.length - 1]
  const previous = world[world.length - 2]
  const bend = bends[path.length - 2]
  // Aim along the last stretch of the line itself, which follows a curve's turn.
  const from = trimSegment(previous, tip, bend ? toWorld(bend) : null, Math.max(trim, 0.5)).end
  const dx = tip.x - from.x
  const dy = tip.y - from.y
  const length = Math.hypot(dx, dy)
  return length < 0.001 ? { x: 0, y: -1, tip } : { x: dx / length, y: dy / length, tip }
}

/**
 * The marker at a line's end, as SVG markup in world units: an arrowhead, a
 * block's bar, or the big X where a handoff or fake handoff happens.
 */
export function lineEnd(line: PlayLine, start: FieldPoint, scale: number, { halo = false }: { halo?: boolean } = {}) {
  const style = LINE_STYLES[line.kind]
  const color = style.color
  const trim = endTrim(line, scale)
  const { x, y, tip } = endDirection(linePath(line, start), line.bends, trim)
  if (style.end === 'arrow') {
    const { length, half } = arrowSize(style.width, scale)
    const back = { x: tip.x - x * length, y: tip.y - y * length }
    const points = `${round(tip.x)},${round(tip.y)} ${round(back.x - y * half)},${round(back.y + x * half)} ${round(back.x + y * half)},${round(back.y - x * half)}`
    const edge = halo ? `<polygon points="${points}" fill="${HALO}" stroke="${HALO}" stroke-width="${round(0.9 * scale)}" stroke-linejoin="round"/>` : ''
    // A thin stroke in the same colour softens the corners.
    return `${edge}<polygon points="${points}" fill="${color}" stroke="${color}" stroke-width="${round(0.3 * scale)}" stroke-linejoin="round"/>`
  }
  if (style.end === 'tee') {
    const bar = 2.8 * scale
    return `<line x1="${round(tip.x - y * bar)}" y1="${round(tip.y + x * bar)}" x2="${round(tip.x + y * bar)}" y2="${round(tip.y - x * bar)}" stroke="${color}" stroke-width="${round(style.width * scale)}" stroke-linecap="round"/>`
  }
  if (style.end === 'x') {
    // Sized with the players, like a spot on the field.
    const arm = 3.2
    const cross = (stroke: string, width: number) =>
      `<path d="M${round(tip.x - arm)},${round(tip.y - arm)} L${round(tip.x + arm)},${round(tip.y + arm)} M${round(tip.x - arm)},${round(tip.y + arm)} L${round(tip.x + arm)},${round(tip.y - arm)}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" fill="none"/>`
    return (halo ? cross(HALO, 2.4) : '') + cross(color, 1.5)
  }
  return ''
}

/**
 * A new line for a player. Routes, runs and fakes head upfield, a block is a
 * short step forward, a motion goes sideways toward the middle, and a handoff
 * goes to the given spot, or a step back and across. Pass the line it follows
 * to start from where that one ends.
 */
export function newLine(id: string, kind: PlayLineKind, playerCode: string, start: FieldPoint, { end: given, from }: { end?: FieldPoint; from?: PlayLine } = {}): PlayLine {
  const end =
    given ||
    (kind === 'block'
      ? { x: start.x, y: start.y - 5 }
      : kind === 'motion'
        ? { x: start.x + (start.x < 50 ? 12 : -12), y: start.y }
        : kind === 'handoff' || kind === 'fakeHandoff'
          ? { x: start.x + (start.x < 50 ? 5 : -5), y: start.y + 5 }
          : { x: start.x, y: start.y - 18 })
  const line: PlayLine = { id, playerCode, kind, points: [{ x: round(end.x), y: round(end.y) }], bends: [null] }
  return from ? { ...line, fromLineId: from.id } : line
}

/**
 * Where a handoff to someone happens: just short of them, so the X sits
 * beside the player rather than on top. In field percent.
 */
export function handoffSpot(start: FieldPoint, target: FieldPoint): FieldPoint {
  const a = toWorld(start)
  const b = toWorld(target)
  const distance = Math.hypot(b.x - a.x, b.y - a.y)
  if (distance < 12) return { x: round((start.x + target.x) / 2), y: round((start.y + target.y) / 2) }
  const back = 6 / distance
  return { x: round((b.x - (b.x - a.x) * back) / 2), y: round(b.y - (b.y - a.y) * back) }
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

/** A defender as SVG markup in world units: a bold black X, sized with the players. */
export function defenderMark(point: FieldPoint, { halo = false }: { halo?: boolean } = {}) {
  const { x, y } = toWorld(point)
  const arm = 3
  const d = `M${round(x - arm)},${round(y - arm)} L${round(x + arm)},${round(y + arm)} M${round(x - arm)},${round(y + arm)} L${round(x + arm)},${round(y - arm)}`
  const edge = halo ? `<path d="${d}" stroke="${HALO}" stroke-width="3" stroke-linecap="round" fill="none"/>` : ''
  return `${edge}<path d="${d}" stroke="#000000" stroke-width="1.8" stroke-linecap="round" fill="none"/>`
}

/** Saved defenders, with anything damaged left out. */
export function validDefenders(defenders?: PlayDefender[]): PlayDefender[] {
  return (defenders || []).filter((item) => item && typeof item.id === 'string' && Number.isFinite(item.x) && Number.isFinite(item.y))
}

/**
 * Where a new defender goes: across the line from the offense, in the middle
 * of what is on screen, stepping aside from any defender already there.
 */
export function newDefenderSpot(defenders: PlayDefender[], view: PlayView, scrimmage: number): FieldPoint {
  const box = viewBox(view)
  const y = round(clamp(scrimmage - 8, box.y + 4, box.y + box.h - 4))
  const middle = round(clamp(view.x, box.x / 2 + 3, (box.x + box.w) / 2 - 3))
  const taken = (x: number) => defenders.some((item) => Math.abs(item.x - x) < 3 && Math.abs(item.y - y) < 3)
  // Try the middle, then a step right, a step left, two right, and so on.
  for (let step = 0; step < 21; step += 1) {
    const x = round(middle + (step % 2 === 1 ? 1 : -1) * 6 * Math.ceil(step / 2))
    if (!taken(x)) return { x, y }
  }
  return { x: middle, y }
}
