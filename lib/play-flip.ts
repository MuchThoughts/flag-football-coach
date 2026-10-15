import { centerX, flipFormation, flipName } from './formation-edit'
import { placeAll } from './playbook'
import { LINE_VERSION, playLines } from './play-lines'
import type { FieldPoint, Formation, PlaybookPlay, PlaybookPosition, PlayDefender, PlayLine, PlaySide, PlayStep, PlayView, SlotPositions } from './types'

/**
 * Every play has a right and a left: the same play as a mirror image. One is
 * drawn; the other is worked out from it. Everyone mirrors across the center
 * except the linemen, who keep their spots (a left guard stays on the left)
 * and mirror their own assignments in place.
 */

function round(value: number) {
  return Math.round(value * 100) / 100
}

/** Which side a play is on: as set, or read from its name when it only says one way. */
export function playSide(play: { side?: PlaySide; name: string }): PlaySide {
  if (play.side === 'left' || play.side === 'right') return play.side
  return /\bleft\b/i.test(play.name) && !/\bright\b/i.test(play.name) ? 'left' : 'right'
}

export function otherSide(side: PlaySide): PlaySide {
  return side === 'right' ? 'left' : 'right'
}

/** Where the players stand for a play: the formation's spots, mirrored when the play is. */
export function playSpots(play: { mirrored?: boolean }, formation: Pick<Formation, 'positions'> | undefined, positions: PlaybookPosition[]): SlotPositions {
  const spots = placeAll(formation?.positions || {}, positions)
  return play.mirrored ? flipFormation(spots, positions) : spots
}

/** The parts of a play that have a left and a right. */
export interface MirrorParts {
  lines?: PlayLine[]
  lineVersion?: number
  defenders?: PlayDefender[]
  view?: PlayView
  steps?: PlayStep[]
  routes: PlaybookPlay['routes']
  footballs: PlaybookPlay['footballs']
}

/**
 * The same parts as their mirror image. Spots are the formation as saved;
 * linemen never move, so the center and their spots are the same either way.
 */
export function mirrorParts<T extends MirrorParts>(parts: T, spots: SlotPositions, positions: PlaybookPosition[]): T {
  const axis = centerX(spots, positions)
  const linemen = new Set(positions.filter((position) => position.type === 'OL').map((position) => position.code))
  const across = (point: FieldPoint, around = axis) => ({ ...point, x: round(2 * around - point.x) })
  // A lineman's lines turn the other way from where he stands; everyone else's mirror across the center.
  const lineAxis = (line: PlayLine) => (linemen.has(line.playerCode) && spots[line.playerCode] ? spots[line.playerCode].x : axis)

  return {
    ...parts,
    lines: playLines(parts).map((line) => {
      const around = lineAxis(line)
      return { ...line, points: line.points.map((point) => across(point, around)), bends: line.bends.map((bend) => (bend ? across(bend, around) : null)) }
    }),
    lineVersion: LINE_VERSION,
    defenders: parts.defenders?.map((item) => across(item)),
    view: parts.view ? across(parts.view) : parts.view,
    steps: parts.steps?.map((step) =>
      step.direction ? { ...step, direction: step.direction === 'left' ? ('right' as const) : ('left' as const) } : step
    ),
    routes: parts.routes.map((route) => ({ ...route, points: route.points.map((point) => across(point)) })),
    footballs: parts.footballs.map((ball) => across(ball))
  }
}

type FlippablePlay = MirrorParts & { name: string; side?: PlaySide; mirrored?: boolean }

/** A play as its other side: mirrored, renamed ("Right" for "Left"), and marked as the other side. */
export function mirrorPlay<T extends FlippablePlay>(play: T, formation: Pick<Formation, 'positions'> | undefined, positions: PlaybookPosition[]): T & { side: PlaySide; mirrored: boolean } {
  const spots = placeAll(formation?.positions || {}, positions)
  return {
    ...mirrorParts(play, spots, positions),
    name: flipName(play.name),
    side: otherSide(playSide(play)),
    mirrored: !play.mirrored
  }
}

/** Both sides of a play, right first, for exports. */
export function bothSides<T extends FlippablePlay>(play: T, formation: Pick<Formation, 'positions'> | undefined, positions: PlaybookPosition[]): (T & { side: PlaySide })[] {
  const drawn = { ...play, side: playSide(play) }
  const mirror = mirrorPlay(drawn, formation, positions)
  return drawn.side === 'right' ? [drawn, mirror] : [mirror, drawn]
}

/** A play's name for one side. When the name never says which way, the side is added. */
export function sideTitle(play: { name: string; side?: PlaySide }) {
  if (/\b(left|right)\b/i.test(play.name)) return play.name
  return `${play.name} (${playSide(play) === 'right' ? 'Right' : 'Left'})`
}

/** A formation's name as a play uses it: Trips Right drawn mirrored is Trips Left. */
export function formationTitle(name: string, mirrored?: boolean) {
  if (!mirrored) return name
  const flipped = flipName(name)
  return flipped !== name ? flipped : `${name} (flipped)`
}
