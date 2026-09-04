// Pins the ProjectState removal invariant from docs/06 "Chosen alternative":
// the chosen reference is resolved output pointing at an alternative that
// exists. Removing that alternative by any route must leave no dangling
// reference, independent of whether the workbench effect happens to re-run.

import { beforeEach, describe, expect, it } from 'vitest'
import { projectState } from './projectState.svelte'
import type { ChosenAlt } from '../types'

function chosenFor(altId: string): ChosenAlt {
  return { altId, source: 'explicit', prevented: { K: 1, A: 0, B: 0 } }
}

beforeEach(() => {
  projectState.applySnapshot({ alternatives: [], pinnedBySite: {}, chosenBySite: {} })
})

// '101' and '110' are real catalog workcodes; addAlternative rejects unknown ones.
function seedSite(siteId: string): string[] {
  projectState.addAlternative(siteId, '101')
  projectState.addAlternative(siteId, '110')
  return projectState.getAlternatives(siteId).map((a) => a.id)
}

describe('removeAlternative', () => {
  it('clears the chosen reference when the removed alternative was chosen', () => {
    const [first] = seedSite('s1')
    projectState.setChosen('s1', chosenFor(first))

    projectState.removeAlternative('s1', first)

    expect(projectState.getChosen('s1')).toBeNull()
  })

  it('leaves the chosen reference alone when a different alternative is removed', () => {
    const [first, second] = seedSite('s1')
    projectState.setChosen('s1', chosenFor(first))

    projectState.removeAlternative('s1', second)

    expect(projectState.getChosen('s1')?.altId).toBe(first)
  })

  it('does not disturb another site that chose an alternative of its own', () => {
    const [aFirst] = seedSite('sA')
    const [bFirst] = seedSite('sB')
    projectState.setChosen('sA', chosenFor(aFirst))
    projectState.setChosen('sB', chosenFor(bFirst))

    projectState.removeAlternative('sA', aFirst)

    expect(projectState.getChosen('sA')).toBeNull()
    expect(projectState.getChosen('sB')?.altId).toBe(bFirst)
  })

  it('clears both the pin and the chosen reference together', () => {
    const [first] = seedSite('s1')
    projectState.pin('s1', first)
    projectState.setChosen('s1', chosenFor(first))

    projectState.removeAlternative('s1', first)

    expect(projectState.getPin('s1')).toBeNull()
    expect(projectState.getChosen('s1')).toBeNull()
  })
})

describe('removeByWorkcode', () => {
  it('clears the chosen reference when the removed workcode was chosen', () => {
    const [first] = seedSite('s1')
    projectState.setChosen('s1', chosenFor(first))

    projectState.removeByWorkcode('s1', '101')

    expect(projectState.getAlternatives('s1')).toHaveLength(1)
    expect(projectState.getChosen('s1')).toBeNull()
  })

  it('leaves the chosen reference alone when a different workcode is removed', () => {
    const [first] = seedSite('s1')
    projectState.setChosen('s1', chosenFor(first))

    projectState.removeByWorkcode('s1', '110')

    expect(projectState.getChosen('s1')?.altId).toBe(first)
  })
})

describe('removeBySite', () => {
  it('clears the chosen reference for that site only', () => {
    const [aFirst] = seedSite('sA')
    const [bFirst] = seedSite('sB')
    projectState.setChosen('sA', chosenFor(aFirst))
    projectState.setChosen('sB', chosenFor(bFirst))

    projectState.removeBySite('sA')

    expect(projectState.getChosen('sA')).toBeNull()
    expect(projectState.getChosen('sB')?.altId).toBe(bFirst)
  })
})
