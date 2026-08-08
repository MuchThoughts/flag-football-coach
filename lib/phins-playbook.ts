import { defaultFormationPositions } from './playbook'
import type { FieldPoint, Formation, PlayArea, PlaybookPlay, PlayFootball, PlayRoute, PlayType, SlotPositions } from './types'

/**
 * The team's formations, traced from the Phins formation sheet, and the plays
 * they have run over the last few seasons. Routes are drawn from the play name
 * so every play opens with something on the field to adjust.
 */

const seedTime = '2026-08-01T00:00:00.000Z'

function positions(spots: Record<string, [number, number]>): SlotPositions {
  return Object.entries(spots).reduce<SlotPositions>((next, [code, [x, y]]) => {
    next[code] = { x, y }
    return next
  }, defaultFormationPositions())
}

interface FormationSpec {
  id: string
  name: string
  spots: Record<string, [number, number]>
}

const formationSpecs: FormationSpec[] = [
  {
    id: 'formation-base',
    name: 'Base',
    spots: { '1': [6, 52], '2': [40, 52], C: [50, 52], '3': [60, 52], '4': [94, 52], QB: [50, 72], RB: [50, 92] }
  },
  {
    id: 'formation-twins',
    name: 'Twins',
    spots: { '1': [6, 52], '2': [20, 52], C: [50, 52], '3': [84, 52], '4': [96, 52], QB: [50, 72], RB: [50, 92] }
  },
  {
    id: 'formation-bunch',
    name: 'Bunch',
    spots: { '1': [30, 52], '2': [40, 52], C: [50, 52], '3': [60, 52], '4': [70, 52], QB: [50, 72], RB: [50, 92] }
  },
  {
    id: 'formation-trips-right',
    name: 'Trips Right',
    spots: { '1': [8, 52], C: [50, 52], '2': [84, 52], '3': [90, 72], '4': [96, 52], QB: [50, 72], RB: [50, 92] }
  },
  {
    id: 'formation-trips-left',
    name: 'Trips Left',
    spots: { '1': [6, 52], '2': [16, 52], '3': [10, 72], '4': [86, 52], C: [50, 52], QB: [50, 72], RB: [50, 92] }
  },
  {
    id: 'formation-empty-left',
    name: 'Empty Left',
    spots: { '1': [6, 52], '2': [20, 52], C: [50, 52], '3': [80, 52], '4': [94, 52], QB: [50, 72], RB: [16, 72] }
  },
  {
    id: 'formation-empty-right',
    name: 'Empty Right',
    spots: { '1': [6, 52], '2': [20, 52], C: [50, 52], '3': [80, 52], '4': [94, 52], QB: [50, 72], RB: [84, 72] }
  },
  {
    id: 'formation-splitback-twins-right',
    name: 'Splitback Twins Right',
    spots: { '1': [40, 52], C: [50, 52], '2': [60, 52], '4': [94, 52], QB: [50, 72], RB: [40, 90], '3': [60, 90] }
  },
  {
    id: 'formation-splitback-twins-left',
    name: 'Splitback Twins Left',
    spots: { '1': [6, 52], '2': [18, 52], C: [50, 52], '4': [60, 52], QB: [50, 72], RB: [40, 90], '3': [62, 90] }
  }
]

const baseFormations: Formation[] = formationSpecs.map((spec) => ({
  id: spec.id,
  teamId: '',
  name: spec.name,
  positions: positions(spec.spots),
  createdAt: seedTime,
  updatedAt: seedTime
}))

// ---- Route drawing -------------------------------------------------------

const goalLine = 10
const shortDepth = 40
const midDepth = 30

function point(x: number, y: number): FieldPoint {
  return { x: Math.max(3, Math.min(97, Math.round(x))), y: Math.max(6, Math.min(96, Math.round(y))) }
}

/** Which way a player breaks: toward the near sideline. */
function outward(from: FieldPoint) {
  return from.x < 50 ? -1 : 1
}

type RouteShape = 'go' | 'slant' | 'flat' | 'corner' | 'wheel' | 'hook' | 'in' | 'out' | 'cross' | 'screen'

function receiverRoute(from: FieldPoint, shape: RouteShape): FieldPoint[] {
  const out = outward(from)
  const inward = -out

  switch (shape) {
    case 'go':
      return [from, point(from.x, goalLine)]
    case 'slant':
      return [from, point(from.x + inward * 18, midDepth)]
    case 'flat':
      return [from, point(from.x + out * 16, shortDepth + 4)]
    case 'corner':
      return [from, point(from.x, midDepth + 4), point(from.x + out * 14, goalLine + 4)]
    case 'wheel':
      return [from, point(from.x + out * 10, shortDepth + 6), point(from.x + out * 12, goalLine + 2)]
    case 'hook':
      return [from, point(from.x, midDepth + 2), point(from.x, midDepth + 10)]
    case 'in':
      return [from, point(from.x, midDepth + 4), point(from.x + inward * 22, midDepth + 4)]
    case 'out':
      return [from, point(from.x, midDepth + 6), point(from.x + out * 18, midDepth + 6)]
    case 'cross':
      return [from, point(from.x + inward * 20, shortDepth), point(from.x + inward * 44, midDepth + 2)]
    case 'screen':
    default: {
      // A bubble behind the line, breaking whichever way the receiver has room.
      const lane = Math.abs(from.x - 50) > 25 ? inward : out
      return [from, point(from.x + lane * 6, from.y + 8), point(from.x + lane * 12, midDepth + 10)]
    }
  }
}

/**
 * The back running downhill. The lane sits just off the center so the line does
 * not disappear underneath the quarterback and center.
 */
function diveRoute(rb: FieldPoint, center: FieldPoint): FieldPoint[] {
  const lane = center.x + 5
  return [rb, point(lane, center.y + 12), point(lane, midDepth - 4)]
}

/** The back taking it wide before turning up. */
function stretchRoute(rb: FieldPoint, direction: 1 | -1): FieldPoint[] {
  return [rb, point(rb.x + direction * 20, rb.y - 4), point(rb.x + direction * 30, midDepth + 2)]
}

/** A receiver coming around behind the line and getting outside. */
function sweepRoute(from: FieldPoint, qb: FieldPoint, direction: 1 | -1): FieldPoint[] {
  return [
    from,
    point(qb.x + direction * 4, qb.y + 4),
    point(qb.x + direction * 26, qb.y - 6),
    point(qb.x + direction * 34, midDepth - 4)
  ]
}

function bootlegRoute(qb: FieldPoint, direction: 1 | -1): FieldPoint[] {
  return [qb, point(qb.x + direction * 20, qb.y - 2), point(qb.x + direction * 32, midDepth + 6)]
}

/** The quarterback keeping it, in the lane opposite the dive. */
function keeperRoute(qb: FieldPoint, center: FieldPoint): FieldPoint[] {
  const lane = center.x - 5
  return [qb, point(lane, center.y - 6), point(lane, midDepth - 2)]
}

/** A short toss out of the backfield, drawn as a pass. */
function tossRoute(qb: FieldPoint, target: FieldPoint): FieldPoint[] {
  return [qb, target]
}

interface DrawContext {
  spots: Record<string, FieldPoint>
  name: string
  routes: PlayRoute[]
  footballs: PlayFootball[]
}

let routeSeq = 0
function addRoute(context: DrawContext, points: FieldPoint[], style: PlayRoute['style'] = 'solid') {
  if (points.length < 2) return
  routeSeq += 1
  context.routes.push({ id: `route-seed-${routeSeq}`, points, style })
}

function addFootball(context: DrawContext, at: FieldPoint) {
  routeSeq += 1
  context.footballs.push({ id: `ball-seed-${routeSeq}`, ...at })
}

/** The first receiver number named in the play, e.g. "3 Sweep" or "2 / 3 Sweep". */
function firstNumber(name: string, after: RegExp) {
  const match = name.match(after)
  return match?.[1]
}

function sideOf(spot: FieldPoint | undefined): 1 | -1 {
  if (!spot) return 1
  return spot.x >= 50 ? 1 : -1
}

/**
 * Draws a play from its name. Anything it does not recognise simply comes out
 * as a formation with no lines, ready to be drawn by hand.
 */
function drawPlay(name: string, spots: Record<string, FieldPoint>): { routes: PlayRoute[]; footballs: PlayFootball[] } {
  const context: DrawContext = { spots, name, routes: [], footballs: [] }
  const lower = name.toLowerCase()
  const qb = spots.QB
  const rb = spots.RB
  const center = spots.C
  if (!qb || !rb || !center) return { routes: [], footballs: [] }

  const handoff = point((qb.x + rb.x) / 2, (qb.y + rb.y) / 2 - 2)
  const leftward = /left/.test(lower) ? -1 : /right/.test(lower) ? 1 : 0

  // --- the back
  if (/dive/.test(lower)) {
    addRoute(context, diveRoute(rb, center))
    addFootball(context, handoff)
  } else if (/stretch/.test(lower)) {
    const direction = (leftward || 1) as 1 | -1
    addRoute(context, stretchRoute(rb, direction))
    addFootball(context, handoff)
  } else if (/swing/.test(lower)) {
    addRoute(context, receiverRoute(rb, 'flat'), 'dashed')
  }

  // --- a receiver carrying it around
  const sweeper = firstNumber(lower, /(\d)\s*(?:\/\s*\d\s*)?(?:motion\s+)?sweep/)
  if (sweeper && spots[sweeper]) {
    const direction = sideOf(spots[sweeper]) * -1
    addRoute(context, sweepRoute(spots[sweeper], qb, direction as 1 | -1))
    addFootball(context, point(qb.x + (direction as number) * 4, qb.y + 2))
  } else if (/sweep/.test(lower)) {
    addRoute(context, sweepRoute(spots['3'] || rb, qb, 1))
  }

  const reverser = firstNumber(lower, /(\d)\s*(?:\/\s*\d\s*)?reverse/)
  if (reverser && spots[reverser]) {
    const direction = sideOf(spots[reverser]) * -1
    addRoute(context, sweepRoute(spots[reverser], qb, direction as 1 | -1), 'dashed')
  }

  // --- the quarterback
  if (/bootleg|boot\b/.test(lower)) {
    addRoute(context, bootlegRoute(qb, (leftward || 1) as 1 | -1))
  } else if (/sneak|keeper|draw/.test(lower)) {
    addRoute(context, keeperRoute(qb, center))
  }

  if (/toss/.test(lower)) {
    const target = spots[firstNumber(lower, /(\d)\s*toss/) || '3'] || rb
    addRoute(context, tossRoute(qb, target), 'dashed')
  }

  // --- receivers
  const wideOuts = ['1', '4'].filter((code) => spots[code])
  const wings = ['2', '3'].filter((code) => spots[code])

  if (/wr\s*slants|slants/.test(lower)) wideOuts.forEach((code) => addRoute(context, receiverRoute(spots[code], 'slant')))
  if (/wr\s*(gos|go\b)|wr go/.test(lower)) wideOuts.forEach((code) => addRoute(context, receiverRoute(spots[code], 'go')))
  if (/wr\s*ins/.test(lower)) wideOuts.forEach((code) => addRoute(context, receiverRoute(spots[code], 'in')))
  if (/wings?\s*flats?|flats\b/.test(lower)) wings.forEach((code) => addRoute(context, receiverRoute(spots[code], 'flat')))
  if (/wings?\s*in\b/.test(lower)) wings.forEach((code) => addRoute(context, receiverRoute(spots[code], 'in')))
  if (/wings?\s*out\b/.test(lower)) wings.forEach((code) => addRoute(context, receiverRoute(spots[code], 'out')))
  if (/wings?\s*corner/.test(lower)) wings.forEach((code) => addRoute(context, receiverRoute(spots[code], 'corner')))
  if (/wings?\s*wheels?/.test(lower)) wings.forEach((code) => addRoute(context, receiverRoute(spots[code], 'wheel')))
  if (/center\s*go/.test(lower)) addRoute(context, receiverRoute(center, 'go'))
  if (/center\s*corner/.test(lower)) addRoute(context, receiverRoute(center, 'corner'))
  if (/center\s*out/.test(lower)) addRoute(context, receiverRoute(center, 'out'))
  if (/center\s*cross|crossing/.test(lower)) addRoute(context, receiverRoute(center, 'cross'))

  if (/explosion/.test(lower)) {
    // Everybody deep.
    ;[...wideOuts, ...wings].forEach((code) => addRoute(context, receiverRoute(spots[code], 'go')))
  }

  if (/high\s*low/.test(lower)) {
    if (spots['1']) addRoute(context, receiverRoute(spots['1'], 'go'))
    if (spots['2']) addRoute(context, receiverRoute(spots['2'], 'hook'))
  }

  if (/slant\s*wheel/.test(lower)) {
    if (spots['1']) addRoute(context, receiverRoute(spots['1'], 'slant'))
    if (spots['2']) addRoute(context, receiverRoute(spots['2'], 'wheel'))
  }

  if (/slant\s*go/.test(lower)) {
    if (spots['1']) addRoute(context, receiverRoute(spots['1'], 'slant'))
    if (spots['4']) addRoute(context, receiverRoute(spots['4'], 'go'))
  }

  if (/flood/.test(lower)) {
    const direction = (leftward || 1) as 1 | -1
    const deep = direction === 1 ? spots['4'] : spots['1']
    const mid = direction === 1 ? spots['3'] : spots['2']
    if (deep) addRoute(context, receiverRoute(deep, 'go'))
    if (mid) addRoute(context, receiverRoute(mid, 'out'))
    addRoute(context, receiverRoute(center, 'corner'))
  }

  if (/chaos/.test(lower)) {
    if (spots['1']) addRoute(context, receiverRoute(spots['1'], 'slant'))
    if (spots['4']) addRoute(context, receiverRoute(spots['4'], 'wheel'))
    if (spots['3']) addRoute(context, receiverRoute(spots['3'], 'hook'))
    addRoute(context, receiverRoute(center, 'go'))
  }

  if (/jail\s*break/.test(lower)) {
    ;[...wideOuts, ...wings].forEach((code) => addRoute(context, receiverRoute(spots[code], 'screen')))
  }

  const screener = firstNumber(lower, /(\d)\s*(?:\/\s*\d\s*)?screen/)
  if (screener && spots[screener]) {
    addRoute(context, receiverRoute(spots[screener], 'screen'))
    addRoute(context, tossRoute(qb, spots[screener]), 'dashed')
  } else if (/rb\s*screen/.test(lower)) {
    addRoute(context, receiverRoute(rb, 'screen'))
    addRoute(context, tossRoute(qb, rb), 'dashed')
  }

  if (/throwback/.test(lower)) {
    addRoute(context, receiverRoute(rb, 'flat'))
    addRoute(context, tossRoute(qb, point(rb.x - 20, rb.y - 8)), 'dashed')
  }

  return { routes: context.routes, footballs: context.footballs }
}

// ---- The play list -------------------------------------------------------

const runWords = /dive|stretch|sweep|reverse|keeper|sneak|draw|toss|swing/
const passWords = /pass|screen|go\b|gos|slant|corner|flood|high\s*low|wheel|explosion|chaos|jail|cross|flat|hook|in\b|ins\b|bootleg/

function playType(name: string): PlayType {
  const lower = name.toLowerCase()
  if (/pass|screen|flood|high\s*low|explosion|chaos|jail|crossing|throwback/.test(lower)) return 'pass'
  if (runWords.test(lower) && !passWords.test(lower.replace(runWords, ''))) return 'run'
  if (/go\b|slant|corner|wheel|hook|flat|cross/.test(lower)) return 'pass'
  return 'run'
}

function playArea(name: string): PlayArea {
  const lower = name.toLowerCase()
  if (/go\b|gos|corner|wheel|explosion|chaos|deep/.test(lower)) return 'deep'
  if (/sweep|stretch|toss|reverse|bootleg|boot\b|flat|out\b|screen|jail|swing|flood/.test(lower)) return 'sidelines'
  return 'middle'
}

/** Play names as the coach writes them, per formation. */
const playsByFormation: Record<string, string[]> = {
  'formation-base': [
    'HB Dive',
    'HB Stretch',
    'Fake HB Dive QB Sneak',
    'QB Keeper',
    '2 / 3 Sweep',
    '4 / 1 Reverse',
    '2 Sweep Fake HB Dive Left',
    'Fake 2 Sweep HB Dive Left',
    'Fake 2 Sweep HB Stretch Left',
    'Fake 2 Sweep Fake HB Stretch Left 1 Go Center Go',
    'HB Dive Fake 3 Sweep',
    'Fake HB Dive 2 Sweep',
    'Fake Dive 2 / 3 Sweep',
    'Fake Dive 3 Sweep to 1 Reverse',
    'Fake Dive 3 Sweep Fake 1 Reverse',
    'Fake Stretch 1 / 4 Sweep',
    'Fake Stretch 2 / 3 Sweep',
    '3 Sweep Fake Reverse',
    'Fake Stretch Fake 1 / 4 Sweep Pass',
    'Fake Dive 3 Sweep Pass',
    'Fake Dive WR Slants Wings Flat Center Go',
    'Fake Stretch Flood',
    'Fake HB Dive Center Go',
    'Fake HB Stretch Wings Corner WR Slants',
    'Fake Dive Explosion WR Ins',
    'Fake 3 Sweep QB Bootleg Wings In Center Corner WR Go',
    'Fake Dive Fake 3 Sweep QB Boot Right',
    'WR Go Center Go Wings Flats',
    'WR Slants Wings Flats',
    'Crossing Route',
    'Bootleg Pass',
    '3 Sweep Pass Back',
    'RB Flat Throwback'
  ],
  'formation-twins': [
    'HB Dive',
    'HB Stretch',
    'QB Sneak Fake HB Dive',
    'QB Keeper',
    '2 / 3 Sweep',
    '2 / 3 Motion Sweep',
    '4 / 1 Reverse',
    'Fake Dive 2 / 3 Sweep',
    '2 / 3 Motion Sweep Fake Dive',
    'Fake Dive QB Draw',
    'Fake Dive Slant Go Center Go',
    'Fake HB Dive WR Go Center Go',
    '2 / 3 Screen',
    'Jail Break',
    'Fake Stretch High Low',
    'Fake Stretch Slant Wheel Center Corner',
    'Slant Go'
  ],
  'formation-bunch': [
    'HB Dive',
    'HB Stretch',
    'HB Toss Right',
    'QB Keeper',
    '2 / 3 Sweep',
    '4 / 1 Reverse',
    'Fake HB Dive 3 Sweep',
    'Fake Dive 2 / 3 Sweep',
    'Fake Dive 3 Sweep to 1 Reverse',
    '2 / 3 Sweep Fake Dive Fake Bootleg',
    'Fake Dive Fake 2 / 3 Sweep QB Bootleg',
    'Fake Dive Fake 3 Sweep QB Bootleg Right',
    'Explosion Fake Dive Fake 2 / 3 Sweep Pass',
    'Explosion Fake Stretch Pass',
    'Explosion QB Draw',
    'Fake HB Dive Explosion',
    'Fake Dive Fake Sweep QB Bootleg Flood',
    '3 Sweep Pass'
  ],
  'formation-trips-right': [
    'HB Dive',
    'HB Stretch',
    'QB Sneak Fake HB Dive',
    'QB Keeper',
    'Quick Sneak',
    '1 / 4 / 3 Sweep',
    '3 Motion Sweep',
    '2 / 3 Motion Sweep',
    '4 / 1 Reverse',
    'Fake Stretch 1 / 4 Sweep 3 Reverse',
    'Fake 2 / 3 Sweep HB Swing',
    '3 Screen',
    '3 Screen Pass 2 Go 4 / 1 Corner Center Out',
    'Slant Go Slow Wheel',
    'Fake Stretch Chaos',
    'Fake Stretch QB Bootleg 1 / 4 Go'
  ],
  'formation-trips-left': ['HB Dive', 'HB Stretch', '3 Motion Sweep', '3 Screen', 'QB Keeper'],
  'formation-empty-right': [
    'QB Sneak',
    '2 / 3 Motion Sweep',
    'RB Motion Sweep',
    '2 / 3 Motion Sweep to 4 / 1 Reverse',
    'RB Screen',
    'Fake QB Sneak Center Go'
  ],
  'formation-empty-left': ['QB Sneak', '2 / 3 Motion Sweep', 'RB Screen'],
  'formation-splitback-twins-right': [
    'RB Dive Fake 3 Dive',
    'Fake RB Dive 3 Dive',
    'Fake RB Dive Fake 3 Dive 1 / 4 Sweep',
    'Fake HB Dive 3 Toss Right',
    'Fake HB Dive 3 Toss Right Flood Right',
    'Fake Dive 3 Toss Right Pass'
  ],
  'formation-splitback-twins-left': ['RB Dive Fake 3 Dive', 'Fake RB Dive 3 Dive', 'Fake HB Dive 3 Toss Left']
}

function toSpots(formation: Formation): Record<string, FieldPoint> {
  return Object.entries(formation.positions).reduce<Record<string, FieldPoint>>((next, [code, spot]) => {
    next[code] = spot
    return next
  }, {})
}

const basePlays: PlaybookPlay[] = baseFormations.flatMap((formation) => {
  const spots = toSpots(formation)
  return (playsByFormation[formation.id] || []).map((name, index) => {
    const drawn = drawPlay(name, spots)
    return {
      id: `play-${formation.id.replace('formation-', '')}-${index + 1}`,
      teamId: '',
      name,
      formationId: formation.id,
      type: playType(name),
      area: playArea(name),
      notes: '',
      routes: drawn.routes,
      footballs: drawn.footballs,
      createdAt: seedTime,
      updatedAt: seedTime
    }
  })
})

export const phinsFormationIds = baseFormations.map((formation) => formation.id)

/** The starting playbook: the sheet's formations and the plays run off them. */
export function phinsPlaybook(teamId: string): { formations: Formation[]; plays: PlaybookPlay[] } {
  return {
    formations: baseFormations.map((formation) => ({ ...formation, teamId })),
    plays: basePlays.map((play) => ({ ...play, teamId }))
  }
}
