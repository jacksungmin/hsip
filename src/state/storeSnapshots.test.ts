// Pins the getSnapshot/applySnapshot opt-in each persisted store makes
// under the docs/06 SessionStore contract: a captured snapshot is plain
// serializable data decoupled from live store state, and applying it
// restores externally observable behavior (get(), getters) exactly.

import { beforeEach, describe, expect, it } from 'vitest'
import type { Point, Polygon } from 'geojson'
import { siteList } from './siteList.svelte'
import { projectState } from './projectState.svelte'
import { projectInfoState } from './projectInfoState.svelte'
import type { Alternative, ChosenAlt, Site } from '../types'

const square: Polygon = {
  type: 'Polygon',
  coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
}
const point: Point = { type: 'Point', coordinates: [0.5, 0.5] }

function makeSite(id: string): Site {
  return {
    id,
    name: id,
    type: 'intersection',
    source: 'draw',
    parts: [{
      id: `${id}:p1`,
      name: 'p1',
      drawnGeometry: point,
      bufferFeet: 150,
      bufferedGeometry: square,
      crashes: [{ id: 'c1', severity: 'K' }],
    }],
    crashIds: ['c1'],
    crashSeverity: { K: 1, A: 0, B: 0 },
  }
}

function makeAlt(id: string, siteId: string): Alternative {
  return {
    id,
    siteId,
    workcode: '101',
    constructionCost: 100000,
    annualMaintenance: 500,
    serviceLife: 15,
  }
}

const chosen: ChosenAlt = {
  altId: 'alt1',
  source: 'explicit',
  prevented: { K: 1, A: 0, B: 2 },
}

beforeEach(() => {
  siteList.applySnapshot([])
  projectState.applySnapshot({ alternatives: [], pinnedBySite: {}, chosenBySite: {} })
  projectInfoState.applySnapshot({
    projectName: '',
    organization: '',
    analyst: '',
    countyLocality: '',
    notes: '',
  })
})

describe('siteList snapshot', () => {
  it('applySnapshot(getSnapshot()) round-trips through mutations', () => {
    siteList.add(makeSite('s1'))
    siteList.add(makeSite('s2'))
    const snap = siteList.getSnapshot()

    siteList.remove('s1')
    siteList.updateSite('s2', { name: 'renamed' })
    expect(siteList.get()).toHaveLength(1)

    siteList.applySnapshot(snap)
    expect(siteList.get().map((s) => s.id)).toEqual(['s2', 's1'])
    expect(siteList.get().find((s) => s.id === 's2')!.name).toBe('s2')
  })

  it('getSnapshot() returns plain data decoupled from live state', () => {
    siteList.add(makeSite('s1'))
    const snap = siteList.getSnapshot()
    snap[0].name = 'mutated copy'
    expect(siteList.get()[0].name).toBe('s1')
  })
})

describe('projectState snapshot', () => {
  it('applySnapshot() seeds alternatives, pins, and chosen for the getters', () => {
    projectState.applySnapshot({
      alternatives: [makeAlt('alt1', 's1'), makeAlt('alt2', 's2')],
      pinnedBySite: { s1: 'alt1' },
      chosenBySite: { s1: chosen },
    })
    expect(projectState.getAlternatives('s1').map((a) => a.id)).toEqual(['alt1'])
    expect(projectState.getPin('s1')).toBe('alt1')
    expect(projectState.getPin('s2')).toBeNull()
    expect(projectState.getChosen('s1')).toEqual(chosen)
  })

  it('applySnapshot(getSnapshot()) round-trips through mutations', () => {
    projectState.applySnapshot({
      alternatives: [makeAlt('alt1', 's1')],
      pinnedBySite: { s1: 'alt1' },
      chosenBySite: { s1: chosen },
    })
    const snap = projectState.getSnapshot()

    projectState.updateAlternative('alt1', { constructionCost: 999 })
    projectState.unpin('s1')
    projectState.clearChosen('s1')

    projectState.applySnapshot(snap)
    expect(projectState.getAlternatives('s1')[0].constructionCost).toBe(100000)
    expect(projectState.getPin('s1')).toBe('alt1')
    expect(projectState.getChosen('s1')).toEqual(chosen)
  })
})

describe('projectInfoState snapshot', () => {
  it('applySnapshot(getSnapshot()) round-trips through updates', () => {
    projectInfoState.update({ projectName: 'FM 1960 Corridor', analyst: 'LY' })
    const snap = projectInfoState.getSnapshot()

    projectInfoState.update({ projectName: 'overwritten', notes: 'scratch' })

    projectInfoState.applySnapshot(snap)
    expect(projectInfoState.value.projectName).toBe('FM 1960 Corridor')
    expect(projectInfoState.value.analyst).toBe('LY')
    expect(projectInfoState.value.notes).toBe('')
  })
})
