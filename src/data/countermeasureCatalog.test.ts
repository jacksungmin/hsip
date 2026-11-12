// Pins how the catalog's free-text reference columns are read. The source CSV
// encodes "no value" as the string "0", which is indistinguishable from a real
// figure once rendered, so callers go through catalogFieldValue rather than
// reading the raw field.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { load as loadYaml } from 'js-yaml'
import { catalogFieldValue, list } from './countermeasureCatalog'

describe('catalogFieldValue', () => {
  it('treats the "0" placeholder as no value', () => {
    expect(catalogFieldValue('0')).toBeNull()
    expect(catalogFieldValue(' 0 ')).toBeNull()
  })

  it('treats empty and missing as no value', () => {
    expect(catalogFieldValue('')).toBeNull()
    expect(catalogFieldValue('   ')).toBeNull()
    expect(catalogFieldValue(undefined)).toBeNull()
    expect(catalogFieldValue(null)).toBeNull()
  })

  it('preserves "TBD" — pending is information, not absence', () => {
    expect(catalogFieldValue('TBD')).toBe('TBD')
  })

  it('preserves real values, including ones that merely contain a zero', () => {
    expect(catalogFieldValue('$1,300 per approach')).toBe('$1,300 per approach')
    expect(catalogFieldValue('2100')).toBe('2100')
    expect(catalogFieldValue(' $300 per Luminaire ')).toBe('$300 per Luminaire')
  })

  it('leaves no bare "0" reachable from the shipped catalog', () => {
    const rendered = list().map((cm) => catalogFieldValue(cm.maintenanceCostRef))
    expect(rendered).not.toContain('0')
    expect(rendered.filter((v) => v !== null).length).toBeGreaterThan(0)
  })
})

// The "credits all crashes" caution must mark exactly the codes the data build
// tags on every crash, or the app would warn about the wrong countermeasures.
describe('creditsAllCrashes', () => {
  it('marks exactly the work codes whose rule is match_all in hsip_rules.yaml', () => {
    const rules = (loadYaml(readFileSync('config/hsip/hsip_rules.yaml', 'utf-8')) as {
      rules: { id: number; match_all?: boolean }[]
    }).rules
    const expected = rules.filter((r) => r.match_all === true).map((r) => String(r.id)).sort()
    const flagged = list().filter((cm) => cm.creditsAllCrashes).map((cm) => cm.workcode).sort()
    expect(flagged).toEqual(expected)
    // The eight codes the 2027 guidelines list as "All", among others.
    expect(flagged).toEqual(expect.arrayContaining(['101', '119', '132', '401', '505', '506', '509', '545']))
  })
})
