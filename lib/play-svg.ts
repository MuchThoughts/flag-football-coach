import { DEFAULT_POSITIONS, placeAll } from './playbook'
import { LINE_OF_SCRIMMAGE } from './positions'
import { defenderMark, endTrim, frameScale, HALO, lineEnd, validDefenders, LINE_STYLES, lineStart, pathData, playLines, viewBox, viewOrDefault } from './play-lines'
import type { Formation, PlaybookPlay, PlaybookPosition } from './types'

/**
 * A play as a standalone SVG, for printing and saving as an image. The live field
 * is built from HTML markers on top of an SVG, which neither prints reliably nor
 * turns into a picture, so exports draw the whole play here instead.
 */

export type PlayDiagramTheme = 'paper' | 'turf'

/** Same world as the live field: twice as wide as tall, positions in percentages. */
const width = 200
const height = 100

const themes: Record<PlayDiagramTheme, { field: string; yardLine: string; scrimmage: string; route: string; marker: string; markerText: string }> = {
  // Light enough to print without soaking the page in ink.
  paper: { field: '#ffffff', yardLine: '#d8ded5', scrimmage: '#53665c', route: '#10201a', marker: '#ffffff', markerText: '#10201a' },
  turf: { field: '#1f7a4d', yardLine: 'rgba(246,242,223,0.28)', scrimmage: 'rgba(246,242,223,0.75)', route: '#10201a', marker: '#ffffff', markerText: '#10201a' }
}

/** Labels are typed by the coach, so they are escaped before going into markup. */
function escapeXml(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function round(value: number) {
  return Math.round(value * 100) / 100
}

function toWorld(point: { x: number; y: number }) {
  return { x: round(point.x * 2), y: round(point.y) }
}

/** The tip of a route, pointing the way the last segment travels. */
function arrowHead(points: { x: number; y: number }[], color: string) {
  const tip = points[points.length - 1]
  // Hand-drawn routes end in tiny jitters, so aim from a point a little way back.
  let from = points[points.length - 2]
  for (let index = points.length - 2; index >= 0; index -= 1) {
    from = points[index]
    if (Math.hypot(tip.x - from.x, tip.y - from.y) >= 3) break
  }
  const angle = Math.atan2(tip.y - from.y, tip.x - from.x)
  const size = 3.2
  const left = { x: tip.x - size * Math.cos(angle - 0.45), y: tip.y - size * Math.sin(angle - 0.45) }
  const right = { x: tip.x - size * Math.cos(angle + 0.45), y: tip.y - size * Math.sin(angle + 0.45) }
  return `<polygon points="${round(tip.x)},${round(tip.y)} ${round(left.x)},${round(left.y)} ${round(right.x)},${round(right.y)}" fill="${color}"/>`
}

function football(point: { x: number; y: number }) {
  const { x, y } = toWorld(point)
  return (
    `<g transform="translate(${x} ${y}) rotate(-20) scale(0.42)">` +
    '<ellipse rx="9" ry="5.6" fill="#8a4b23" stroke="#2f1b0d" stroke-width="1.4"/>' +
    '<line x1="-5.2" y1="0" x2="5.2" y2="0" stroke="#f7f5ee" stroke-width="1.4"/>' +
    '<line x1="-2.8" y1="-1.8" x2="-2.8" y2="1.8" stroke="#f7f5ee" stroke-width="1.2"/>' +
    '<line x1="0" y1="-2.2" x2="0" y2="2.2" stroke="#f7f5ee" stroke-width="1.2"/>' +
    '<line x1="2.8" y1="-1.8" x2="2.8" y2="1.8" stroke="#f7f5ee" stroke-width="1.2"/>' +
    '</g>'
  )
}

/** Grass, yard lines and the line of scrimmage reach well past the field, for zoomed-out views. */
const reach = { x: -500, y: -400, w: 1200, h: 900 }

export function playDiagramSvg(
  play: Pick<PlaybookPlay, 'routes' | 'footballs'> & Partial<Pick<PlaybookPlay, 'lines' | 'view' | 'lineVersion' | 'defenders'>>,
  formation: Formation | undefined,
  positions: PlaybookPosition[] = DEFAULT_POSITIONS,
  theme: PlayDiagramTheme = 'paper',
  /** Thumbnails leave the labels off; everything scales with the field either way. */
  { labels = true }: { labels?: boolean } = {}
) {
  const colors = themes[theme]
  const parts: string[] = []
  const view = viewOrDefault(play.view)
  const box = viewBox(view)
  // Strokes keep the same weight on the page whatever the zoom; the field and players scale.
  const scale = frameScale(view)

  const line = formation?.lineOfScrimmage ?? LINE_OF_SCRIMMAGE
  parts.push(`<rect x="${reach.x}" y="${reach.y}" width="${reach.w}" height="${reach.h}" fill="${colors.field}"/>`)
  for (let x = reach.x; x <= reach.x + reach.w; x += 20) {
    parts.push(`<line x1="${x}" y1="${reach.y}" x2="${x}" y2="${reach.y + reach.h}" stroke="${colors.yardLine}" stroke-width="${round(0.4 * scale)}"/>`)
  }
  parts.push(
    `<line x1="${reach.x}" y1="${line}" x2="${reach.x + reach.w}" y2="${line}" stroke="${colors.scrimmage}" stroke-width="${round(0.5 * scale)}"/>`
  )

  play.routes.forEach((route) => {
    if (route.points.length < 2) return
    const points = route.points.map(toWorld)
    const dash = route.style === 'dashed' ? ' stroke-dasharray="3 2.2"' : ''
    parts.push(
      `<polyline points="${points.map((point) => `${point.x},${point.y}`).join(' ')}" fill="none" stroke="${colors.route}" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"${dash}/>`
    )
    parts.push(arrowHead(points, colors.route))
  })

  const spots = placeAll(formation?.positions || {}, positions)
  const drawn = playLines(play).filter((item) => item.points.length > 0)
  const ends: string[] = []
  drawn.forEach((item) => {
    const start = lineStart(item, spots, drawn)
    if (!start) return
    const style = LINE_STYLES[item.kind]
    const dash = style.dash ? ` stroke-dasharray="${style.dash.split(' ').map((part) => round(Number(part) * scale)).join(' ')}"` : ''
    const d = pathData(item, start, endTrim(item, scale))
    // An arrowhead covers the cut end, so the stroke stops square under it.
    const cap = style.end === 'arrow' ? 'butt' : 'round'
    // Blue on turf needs a pale edge to read.
    const halo = Boolean(style.halo) && theme === 'turf'
    if (halo) {
      parts.push(`<path d="${d}" fill="none" stroke="${HALO}" stroke-width="${round((style.width + 0.9) * scale)}" stroke-linecap="${cap}" stroke-linejoin="round"/>`)
    }
    parts.push(`<path d="${d}" fill="none" stroke="${style.color}" stroke-width="${round(style.width * scale)}" stroke-linecap="${cap}" stroke-linejoin="round"${dash}/>`)
    ends.push(lineEnd(item, start, scale, { halo }))
  })
  // Ends go over every line, so a bootleg leaving a fake handoff never covers its X.
  parts.push(...ends)

  const fontSizeFor = (label: string) => (label.length > 2 ? 2.7 : label.length > 1 ? 3.4 : 4.2)
  positions.forEach((slot) => {
    const { x, y } = toWorld(spots[slot.code])
    parts.push(
      `<circle cx="${x}" cy="${y}" r="${labels ? 4.4 : 4}" fill="${colors.marker}" stroke="${colors.markerText}" stroke-width="0.8"/>` +
        (labels ? `<text x="${x}" y="${y}" dy="0.36em" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="900" font-size="${fontSizeFor(slot.label)}" fill="${colors.markerText}">${escapeXml(slot.label)}</text>` : '')
    )
  })

  // Where a motion ends, a dashed outline of the player shows where they will be at the snap.
  drawn
    .filter((item) => item.kind === 'motion')
    .forEach((item) => {
      const slot = positions.find((position) => position.code === item.playerCode)
      if (!slot || !spots[slot.code]) return
      const { x, y } = toWorld(item.points[item.points.length - 1])
      parts.push(
        `<circle cx="${x}" cy="${y}" r="${labels ? 4.4 : 4}" fill="${colors.marker}" fill-opacity="0.75" stroke="${colors.markerText}" stroke-width="0.7" stroke-dasharray="1.6 1.2"/>` +
          (labels ? `<text x="${x}" y="${y}" dy="0.36em" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="900" font-size="${fontSizeFor(slot.label)}" fill="${colors.markerText}" fill-opacity="0.75">${escapeXml(slot.label)}</text>` : '')
      )
    })

  // Black on turf needs a pale edge to read.
  validDefenders(play.defenders).forEach((item) => parts.push(defenderMark(item, { halo: theme === 'turf' })))

  play.footballs.forEach((item) => parts.push(football(item)))

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box.x} ${box.y} ${box.w} ${box.h}" width="${width * 6}" height="${height * 6}">${parts.join('')}</svg>`
}

/** File names stay readable but safe on every platform. */
export function playFileName(name: string, extension: string) {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${base || 'play'}.${extension}`
}
