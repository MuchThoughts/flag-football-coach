import { defaultFormationPositions } from './playbook'
import type { Formation, SlotPositions } from './types'

/**
 * The team's formations, traced from the Phins formation sheet. They seed a new
 * playbook; the plays that go with them get written in the play builder.
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

/** Prefixed so a seeded formation can never collide with one already saved. */
function formationId(specId: string) {
  return specId.replace('formation-', 'formation-phins-')
}

const baseFormations: Formation[] = formationSpecs.map((spec) => ({
  id: formationId(spec.id),
  teamId: '',
  name: spec.name,
  positions: positions(spec.spots),
  createdAt: seedTime,
  updatedAt: seedTime
}))

/** Bumped when the seeded playbook changes, so saved states pick the change up. */
export const PHINS_PLAYBOOK_SEED = 'phins-2'

/** The starting playbook: the sheet's formations, with no plays written yet. */
export function phinsPlaybook(teamId: string): { formations: Formation[] } {
  return { formations: baseFormations.map((formation) => ({ ...formation, teamId })) }
}
