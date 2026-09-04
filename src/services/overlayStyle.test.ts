// Verifies the overlay style compiler: one style declaration in
// config/overlays.yaml must produce the MapLibre paint, the legend rows, and
// the class filter that all agree with each other. Drift between those three
// is the failure mode this contract exists to prevent, so the tests assert
// them against the same declarations rather than checking internals.
//
// The load-bearing rule: a categorical style hides values it does not list
// unless `other` is declared. That is what keeps HIN segments with no tier
// off the map without a second filter in the config.

import { describe, it, expect } from 'vitest'
import {
  compilePaint,
  compileFilter,
  legendRows,
  maplibreType,
  OTHER_KEY,
} from './overlayStyle'
import type { OverlayLayerDef } from '../types'

function layer(overrides: Partial<OverlayLayerDef> = {}): OverlayLayerDef {
  return {
    id: 'test',
    label: 'Test',
    source: 'roads',
    draw: 'line',
    visible: false,
    width: 1,
    opacity: 1,
    style: { type: 'simple', color: '#123456' },
    ...overrides,
  }
}

const tiers: OverlayLayerDef['style'] = {
  type: 'categorical',
  column: 'tier_all',
  categories: [
    { value: 'Top 5%', label: 'Top 5%', color: '#54278f' },
    { value: 'Top 10%', label: 'Top 10%', color: '#756bb1' },
  ],
}

const allKeys = new Set(['Top 5%', 'Top 10%'])

// The shipped roads layer keys on a numeric column, so the stringify-out /
// typed-value-in round-trip is the real-world path, not the string one above.
const fclass: OverlayLayerDef['style'] = {
  type: 'categorical',
  column: 'f_system',
  categories: [
    { value: 1, label: 'Interstate', color: '#08306b' },
    { value: 7, label: 'Local', color: '#c6dbef' },
  ],
}

describe('maplibreType', () => {
  it('maps config draw kinds to MapLibre layer types', () => {
    expect(maplibreType('line')).toBe('line')
    expect(maplibreType('point')).toBe('circle')
    expect(maplibreType('polygon')).toBe('fill')
  })
})

describe('compilePaint', () => {
  it('uses the single colour for a simple style', () => {
    const paint = compilePaint(layer())
    expect(paint['line-color']).toBe('#123456')
  })

  it('builds a match expression in declared order for a categorical style', () => {
    const paint = compilePaint(layer({ style: tiers }))
    expect(paint['line-color']).toEqual([
      'match',
      ['get', 'tier_all'],
      'Top 5%',
      '#54278f',
      'Top 10%',
      '#756bb1',
      expect.any(String),
    ])
  })

  it('uses the other colour as the match fallback when other is declared', () => {
    const style = { ...tiers, other: { label: 'Untiered', color: '#eeeeee' } }
    const paint = compilePaint(layer({ style }))
    expect((paint['line-color'] as unknown[]).at(-1)).toBe('#eeeeee')
  })

  it('builds a zoom ramp for width, scaled by the multiplier', () => {
    // Asserted concretely rather than by re-deriving from the actual, so a
    // malformed interpolate expression cannot pass.
    expect(compilePaint(layer({ width: 1 }))['line-width']).toEqual([
      'interpolate', ['linear'], ['zoom'], 8, 0.7, 12, 1, 16, 1.8,
    ])
    expect(compilePaint(layer({ width: 2 }))['line-width']).toEqual([
      'interpolate', ['linear'], ['zoom'], 8, 1.4, 12, 2, 16, 3.6,
    ])
  })

  it('applies opacity and picks paint keys matching the draw kind', () => {
    expect(compilePaint(layer({ opacity: 0.5 }))['line-opacity']).toBe(0.5)
    expect(compilePaint(layer({ draw: 'point' }))).toHaveProperty('circle-radius')
    expect(compilePaint(layer({ draw: 'polygon' }))).toHaveProperty('fill-color')
    // Polygons have no width knob, so the ramp must not leak into fill paint.
    expect(Object.keys(compilePaint(layer({ draw: 'polygon' })))).toEqual([
      'fill-color',
      'fill-opacity',
    ])
  })

  it('carries the categorical colour into every draw kind', () => {
    const match = ['match', ['get', 'f_system'], 1, '#08306b', 7, '#c6dbef', expect.any(String)]
    expect(compilePaint(layer({ style: fclass, draw: 'point' }))['circle-color']).toEqual(match)
    expect(compilePaint(layer({ style: fclass, draw: 'polygon' }))['fill-color']).toEqual(match)
  })
})

describe('legendRows', () => {
  it('is empty for a simple style, which has nothing to switch', () => {
    expect(legendRows(layer())).toEqual([])
  })

  it('returns one row per declared category, keyed by the column value', () => {
    expect(legendRows(layer({ style: tiers }))).toEqual([
      { key: 'Top 5%', label: 'Top 5%', color: '#54278f' },
      { key: 'Top 10%', label: 'Top 10%', color: '#756bb1' },
    ])
  })

  it('appends an other row only when other is declared', () => {
    const style = { ...tiers, other: { label: 'Untiered', color: '#eeeeee' } }
    const rows = legendRows(layer({ style }))
    expect(rows.at(-1)).toEqual({ key: OTHER_KEY, label: 'Untiered', color: '#eeeeee' })
  })
})

describe('compileFilter', () => {
  it('is undefined for a simple style with no where clause', () => {
    expect(compileFilter(layer(), new Set())).toBeUndefined()
  })

  it('is the where clause alone for a simple style', () => {
    const def = layer({ where: { column: 'network', equals: 'Access Controlled' } })
    expect(compileFilter(def, new Set())).toEqual([
      '==',
      ['get', 'network'],
      'Access Controlled',
    ])
  })

  it('hides values outside the declared categories when other is absent', () => {
    // The HIN case: every tier switched on still excludes null-tier segments,
    // because the filter lists values rather than negating them.
    const def = layer({ style: tiers })
    expect(compileFilter(def, allKeys)).toEqual([
      'in',
      ['get', 'tier_all'],
      ['literal', ['Top 5%', 'Top 10%']],
    ])
  })

  it('narrows to the switched-on categories', () => {
    const def = layer({ style: tiers })
    expect(compileFilter(def, new Set(['Top 10%']))).toEqual([
      'in',
      ['get', 'tier_all'],
      ['literal', ['Top 10%']],
    ])
  })

  it('matches nothing when every category is switched off', () => {
    const def = layer({ style: tiers })
    expect(compileFilter(def, new Set())).toEqual([
      'in',
      ['get', 'tier_all'],
      ['literal', []],
    ])
  })

  it('also admits unlisted values when the other row is switched on', () => {
    const style = { ...tiers, other: { label: 'Untiered', color: '#eeeeee' } }
    const def = layer({ style })
    expect(compileFilter(def, new Set([...allKeys, OTHER_KEY]))).toEqual([
      'any',
      ['in', ['get', 'tier_all'], ['literal', ['Top 5%', 'Top 10%']]],
      ['!', ['in', ['get', 'tier_all'], ['literal', ['Top 5%', 'Top 10%']]]],
    ])
  })

  it('drops unlisted values again when the other row is switched off', () => {
    const style = { ...tiers, other: { label: 'Untiered', color: '#eeeeee' } }
    const def = layer({ style })
    expect(compileFilter(def, allKeys)).toEqual([
      'in',
      ['get', 'tier_all'],
      ['literal', ['Top 5%', 'Top 10%']],
    ])
  })

  it('keeps numeric column values numeric across the legend key round-trip', () => {
    // Legend keys are strings because they index UI state, but the filter has
    // to emit the original number or the tile values never match.
    const def = layer({ style: fclass })
    expect(legendRows(def).map((row) => row.key)).toEqual(['1', '7'])
    expect(compileFilter(def, new Set(['1']))).toEqual([
      'in',
      ['get', 'f_system'],
      ['literal', [1]],
    ])
  })

  it('nests the class filter under where when other is also switched on', () => {
    const style = { ...tiers, other: { label: 'Untiered', color: '#eeeeee' } }
    const def = layer({
      style,
      where: { column: 'network', equals: 'Access Controlled' },
    })
    expect(compileFilter(def, new Set(['Top 5%', OTHER_KEY]))).toEqual([
      'all',
      ['==', ['get', 'network'], 'Access Controlled'],
      [
        'any',
        ['in', ['get', 'tier_all'], ['literal', ['Top 5%']]],
        ['!', ['in', ['get', 'tier_all'], ['literal', ['Top 5%', 'Top 10%']]]],
      ],
    ])
  })

  it('combines a where clause with the class filter', () => {
    const def = layer({
      style: tiers,
      where: { column: 'network', equals: 'Access Controlled' },
    })
    expect(compileFilter(def, new Set(['Top 5%']))).toEqual([
      'all',
      ['==', ['get', 'network'], 'Access Controlled'],
      ['in', ['get', 'tier_all'], ['literal', ['Top 5%']]],
    ])
  })
})
