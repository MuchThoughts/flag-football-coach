import type { Formation, PlayArea, PlaybookPlay, PlayStep, PlayType } from './types'

/**
 * A play is written as a sequence of components rather than drawn: pick the
 * formation, then stack up what happens — a fake, a motion, a run, a concept.
 * The name falls out of the sequence, which is how the coach already says them
 * out loud ("Fake HB Stretch Right, Fake 4 Sweep, QB Keeper").
 */

export type ComponentGroup = 'backfield' | 'quarterback' | 'carries' | 'motion' | 'concepts' | 'routes'

export interface PlayComponent {
  id: string
  /** What the button says. Receiver components leave the number off. */
  label: string
  group: ComponentGroup
  /** The words this component adds to the play name. */
  phrase: string
  /** Other ways the coach writes the same component, for reading old calls back. */
  aliases?: string[]
  /** True when the component belongs to a numbered receiver. */
  needsReceiver?: boolean
  /** True when left or right can be added. */
  hasDirection?: boolean
  type: PlayType
  area: PlayArea
}

export const COMPONENT_GROUPS: Array<{ id: ComponentGroup; label: string }> = [
  { id: 'backfield', label: 'Backfield' },
  { id: 'quarterback', label: 'Quarterback' },
  { id: 'carries', label: 'Receiver runs' },
  { id: 'motion', label: 'Motion' },
  { id: 'concepts', label: 'Pass concepts' },
  { id: 'routes', label: 'Single routes' }
]

/** Who can carry or run a route: the four numbers, plus the center and the back. */
export const RECEIVER_CODES = ['1', '2', '3', '4', 'C', 'RB']

export const PLAY_COMPONENTS: PlayComponent[] = [
  { id: 'hb-dive', label: 'HB Dive', group: 'backfield', phrase: 'HB Dive', aliases: ['RB Dive', 'Dive'], hasDirection: true, type: 'run', area: 'middle' },
  { id: 'hb-stretch', label: 'HB Stretch', group: 'backfield', phrase: 'HB Stretch', aliases: ['RB Stretch', 'Stretch'], hasDirection: true, type: 'run', area: 'sidelines' },
  { id: 'hb-toss', label: 'HB Toss', group: 'backfield', phrase: 'HB Toss', aliases: ['RB Toss'], hasDirection: true, type: 'run', area: 'sidelines' },
  { id: 'rb-swing', label: 'RB Swing', group: 'backfield', phrase: 'RB Swing', aliases: ['HB Swing', 'Swing'], type: 'pass', area: 'sidelines' },
  { id: 'rb-screen', label: 'RB Screen', group: 'backfield', phrase: 'RB Screen', aliases: ['HB Screen'], type: 'pass', area: 'sidelines' },
  { id: 'rb-flat', label: 'RB Flat', group: 'backfield', phrase: 'RB Flat', type: 'pass', area: 'sidelines' },

  { id: 'qb-keeper', label: 'QB Keeper', group: 'quarterback', phrase: 'QB Keeper', type: 'run', area: 'middle' },
  { id: 'qb-sneak', label: 'QB Sneak', group: 'quarterback', phrase: 'QB Sneak', aliases: ['Quick Sneak', 'Sneak'], type: 'run', area: 'middle' },
  { id: 'qb-draw', label: 'QB Draw', group: 'quarterback', phrase: 'QB Draw', type: 'run', area: 'middle' },
  { id: 'qb-bootleg', label: 'QB Bootleg', group: 'quarterback', phrase: 'QB Bootleg', aliases: ['QB Boot', 'Bootleg', 'Boot'], hasDirection: true, type: 'run', area: 'sidelines' },
  { id: 'bootleg-pass', label: 'Bootleg Pass', group: 'quarterback', phrase: 'Bootleg Pass', hasDirection: true, type: 'pass', area: 'sidelines' },
  { id: 'pass', label: 'Pass', group: 'quarterback', phrase: 'Pass', aliases: ['Pass Back'], type: 'pass', area: 'middle' },

  { id: 'carry-dive', label: 'Dive', group: 'carries', phrase: 'Dive', needsReceiver: true, hasDirection: true, type: 'run', area: 'middle' },
  { id: 'sweep', label: 'Sweep', group: 'carries', phrase: 'Sweep', needsReceiver: true, type: 'run', area: 'sidelines' },
  { id: 'reverse', label: 'Reverse', group: 'carries', phrase: 'Reverse', needsReceiver: true, type: 'run', area: 'sidelines' },
  { id: 'toss', label: 'Toss', group: 'carries', phrase: 'Toss', needsReceiver: true, hasDirection: true, type: 'run', area: 'sidelines' },
  { id: 'screen', label: 'Screen', group: 'carries', phrase: 'Screen', needsReceiver: true, type: 'pass', area: 'sidelines' },
  { id: 'end-around', label: 'End Around', group: 'carries', phrase: 'End Around', needsReceiver: true, type: 'run', area: 'sidelines' },

  { id: 'motion', label: 'Motion', group: 'motion', phrase: 'Motion', needsReceiver: true, hasDirection: true, type: 'run', area: 'sidelines' },
  { id: 'motion-sweep', label: 'Motion Sweep', group: 'motion', phrase: 'Motion Sweep', needsReceiver: true, type: 'run', area: 'sidelines' },
  { id: 'shift', label: 'Shift', group: 'motion', phrase: 'Shift', needsReceiver: true, hasDirection: true, type: 'run', area: 'middle' },

  { id: 'wr-slants', label: 'WR Slants', group: 'concepts', phrase: 'WR Slants', type: 'pass', area: 'middle' },
  { id: 'wr-gos', label: 'WR Gos', group: 'concepts', phrase: 'WR Go', aliases: ['WR Gos'], type: 'pass', area: 'deep' },
  { id: 'wr-ins', label: 'WR Ins', group: 'concepts', phrase: 'WR Ins', type: 'pass', area: 'middle' },
  { id: 'wings-flats', label: 'Wings Flats', group: 'concepts', phrase: 'Wings Flats', aliases: ['Wings Flat', 'Flats'], type: 'pass', area: 'sidelines' },
  { id: 'wings-corner', label: 'Wings Corner', group: 'concepts', phrase: 'Wings Corner', type: 'pass', area: 'deep' },
  { id: 'wings-in', label: 'Wings In', group: 'concepts', phrase: 'Wings In', type: 'pass', area: 'middle' },
  { id: 'wings-out', label: 'Wings Out', group: 'concepts', phrase: 'Wings Out', type: 'pass', area: 'sidelines' },
  { id: 'wings-wheel', label: 'Wings Wheel', group: 'concepts', phrase: 'Wings Wheel', aliases: ['Wings Wheels'], type: 'pass', area: 'deep' },
  { id: 'center-go', label: 'Center Go', group: 'concepts', phrase: 'Center Go', type: 'pass', area: 'deep' },
  { id: 'center-corner', label: 'Center Corner', group: 'concepts', phrase: 'Center Corner', type: 'pass', area: 'deep' },
  { id: 'center-out', label: 'Center Out', group: 'concepts', phrase: 'Center Out', type: 'pass', area: 'sidelines' },
  { id: 'crossing', label: 'Crossing Route', group: 'concepts', phrase: 'Crossing Route', aliases: ['Center Cross', 'Crossing'], type: 'pass', area: 'middle' },
  { id: 'explosion', label: 'Explosion', group: 'concepts', phrase: 'Explosion', type: 'pass', area: 'deep' },
  { id: 'flood', label: 'Flood', group: 'concepts', phrase: 'Flood', hasDirection: true, type: 'pass', area: 'sidelines' },
  { id: 'high-low', label: 'High Low', group: 'concepts', phrase: 'High Low', type: 'pass', area: 'middle' },
  { id: 'slant-wheel', label: 'Slant Wheel', group: 'concepts', phrase: 'Slant Wheel', type: 'pass', area: 'deep' },
  { id: 'slant-go', label: 'Slant Go', group: 'concepts', phrase: 'Slant Go', type: 'pass', area: 'deep' },
  { id: 'slow-wheel', label: 'Slow Wheel', group: 'concepts', phrase: 'Slow Wheel', type: 'pass', area: 'deep' },
  { id: 'chaos', label: 'Chaos', group: 'concepts', phrase: 'Chaos', type: 'pass', area: 'deep' },
  { id: 'jail-break', label: 'Jail Break', group: 'concepts', phrase: 'Jail Break', type: 'pass', area: 'sidelines' },
  { id: 'throwback', label: 'Throwback', group: 'concepts', phrase: 'Throwback', aliases: ['Flat Throwback'], type: 'pass', area: 'sidelines' },

  { id: 'route-go', label: 'Go', group: 'routes', phrase: 'Go', needsReceiver: true, type: 'pass', area: 'deep' },
  { id: 'route-slant', label: 'Slant', group: 'routes', phrase: 'Slant', needsReceiver: true, type: 'pass', area: 'middle' },
  { id: 'route-corner', label: 'Corner', group: 'routes', phrase: 'Corner', needsReceiver: true, type: 'pass', area: 'deep' },
  { id: 'route-wheel', label: 'Wheel', group: 'routes', phrase: 'Wheel', needsReceiver: true, type: 'pass', area: 'deep' },
  { id: 'route-flat', label: 'Flat', group: 'routes', phrase: 'Flat', needsReceiver: true, type: 'pass', area: 'sidelines' },
  { id: 'route-out', label: 'Out', group: 'routes', phrase: 'Out', needsReceiver: true, type: 'pass', area: 'sidelines' },
  { id: 'route-in', label: 'In', group: 'routes', phrase: 'In', needsReceiver: true, type: 'pass', area: 'middle' },
  { id: 'route-hook', label: 'Hook', group: 'routes', phrase: 'Hook', needsReceiver: true, type: 'pass', area: 'middle' },
  { id: 'route-cross', label: 'Cross', group: 'routes', phrase: 'Cross', needsReceiver: true, type: 'pass', area: 'middle' }
]

export function findComponent(componentId: string) {
  return PLAY_COMPONENTS.find((component) => component.id === componentId)
}

export function componentsInGroup(group: ComponentGroup) {
  return PLAY_COMPONENTS.filter((component) => component.group === group)
}

/** One step written out, e.g. "Fake 2 / 3 Sweep" or "QB Bootleg Right". */
export function stepLabel(step: PlayStep): string {
  const component = findComponent(step.componentId)
  if (!component) return ''

  const words = [
    step.fake ? 'Fake' : '',
    component.needsReceiver ? (step.receivers || []).join(' / ') : '',
    component.phrase,
    component.hasDirection && step.direction ? (step.direction === 'left' ? 'Left' : 'Right') : ''
  ]

  return words.filter(Boolean).join(' ')
}

/**
 * The whole play read out in order — formation first, the way it gets called —
 * which is also its default name.
 */
export function playCallFromSteps(steps: PlayStep[], formationName?: string): string {
  return [formationName || '', ...steps.map(stepLabel)].filter(Boolean).join(' ')
}

/**
 * A play is classified by what actually happens, so fakes and motion are
 * ignored and the last real component wins.
 */
export function classifySteps(steps: PlayStep[]): { type: PlayType; area: PlayArea } {
  const real = steps
    .map((step) => ({ step, component: findComponent(step.componentId) }))
    .filter((entry) => entry.component && !entry.step.fake && entry.component.group !== 'motion')

  const last = real[real.length - 1]?.component
  return { type: last?.type || 'run', area: last?.area || 'middle' }
}

/** Every way a component can be written, longest first so "HB Dive" beats "Dive". */
const phraseIndex = PLAY_COMPONENTS.flatMap((component) =>
  [component.phrase, ...(component.aliases || [])].map((phrase) => ({
    component,
    words: phrase.toLowerCase().split(' ')
  }))
).sort((a, b) => b.words.length - a.words.length)

/** Filler the coach writes between components: "3 Sweep to 1 Reverse", "2 / 3 Sweep". */
const filler = ['to', '/', '&', 'and', 'then']

const receiverWords = new Map(RECEIVER_CODES.map((code) => [code.toLowerCase(), code]))

function matchesAt(words: string[], index: number, phrase: string[]) {
  return phrase.every((word, offset) => words[index + offset] === word)
}

function matchPhrase(words: string[], index: number, wantsReceiver: boolean) {
  return phraseIndex.find(
    (entry) => Boolean(entry.component.needsReceiver) === wantsReceiver && matchesAt(words, index, entry.words)
  )
}

/**
 * Reads a written play call back into steps, so plays that were never built
 * here can still be opened and edited. Returns null when any part of the call
 * is not something the builder knows how to say.
 */
export function parsePlayCall(call: string): PlayStep[] | null {
  const words = call.trim().toLowerCase().replace(/\s*\/\s*/g, ' / ').split(/\s+/).filter(Boolean)
  if (words.length === 0) return null

  const steps: PlayStep[] = []
  let index = 0
  let sequence = 0

  while (index < words.length) {
    if (filler.includes(words[index])) {
      index += 1
      continue
    }

    let fake = false
    if (words[index] === 'fake') {
      fake = true
      index += 1
    }

    // "RB Dive" names the back in the phrase itself, so try the phrase first.
    let receivers: string[] = []
    let match = matchPhrase(words, index, false)

    if (!match) {
      // "2 / 3 Sweep" is one carry either of them can take.
      let cursor = index
      const named: string[] = []
      while (receiverWords.has(words[cursor]) || filler.includes(words[cursor])) {
        const code = receiverWords.get(words[cursor])
        if (code && !named.includes(code)) {
          named.push(code)
        }
        cursor += 1
      }

      if (named.length > 0) {
        match = matchPhrase(words, cursor, true)
        if (match) {
          receivers = named
          index = cursor
        }
      }
    }

    // A carry written without anyone named still opens, waiting for a pick.
    if (!match) {
      match = matchPhrase(words, index, true)
    }

    if (!match) return null
    index += match.words.length

    let direction: PlayStep['direction']
    if (match.component.hasDirection && (words[index] === 'left' || words[index] === 'right')) {
      direction = words[index] as PlayStep['direction']
      index += 1
    }

    sequence += 1
    steps.push({
      id: `step-${sequence}`,
      componentId: match.component.id,
      receivers: receivers.length > 0 ? receivers : undefined,
      direction,
      fake
    })
  }

  return steps.length > 0 ? steps : null
}

/**
 * The components behind a play, whether it was written in the builder or is
 * being read back from its name. A leading formation name is part of the call,
 * not part of the play, so it comes off first.
 */
export function stepsFromPlay(play: PlaybookPlay, formations: Formation[]): PlayStep[] | null {
  if (play.steps && play.steps.length > 0) {
    return play.steps
  }

  const formationName = formations.find((item) => item.id === play.formationId)?.name || ''
  const call =
    formationName && play.name.toLowerCase().startsWith(formationName.toLowerCase())
      ? play.name.slice(formationName.length)
      : play.name

  return parsePlayCall(call)
}

/** True when the step still needs a receiver picked before it reads properly. */
export function stepIsComplete(step: PlayStep) {
  const component = findComponent(step.componentId)
  if (!component) return false
  return !component.needsReceiver || (step.receivers || []).length > 0
}
