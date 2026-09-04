// Loads jurisdictions from the static GeoJSON file produced by
// tools/data-build (feature properties: id, name, jurisdictionType).
// Replaces the runtime ESRI fetch that predated pre-built artifacts.
//
// Geometry retains the source boundary detail, with invalid source ring
// topology normalized by the pipeline, so the same in-memory collection
// can support map display, region picking, and client-side
// site-to-jurisdiction spatial lookup.
//
// The pure mapper is exported separately from the fetch so the
// mapping contract is testable without network mocking.

import type { Feature, FeatureCollection, Polygon, MultiPolygon } from 'geojson'
import type { Jurisdiction } from '../types'

type JurisdictionFC = FeatureCollection<Polygon | MultiPolygon>

export async function loadJurisdictions(url: string): Promise<Jurisdiction[]> {
  const resp = await fetch(url)
  if (!resp.ok) {
    throw new Error(`jurisdictions fetch failed: HTTP ${resp.status}`)
  }
  const fc = (await resp.json()) as JurisdictionFC
  if (fc?.type !== 'FeatureCollection' || !Array.isArray(fc.features)) {
    throw new Error('jurisdictions file is not a GeoJSON FeatureCollection')
  }
  return mapJurisdictions(fc)
}

export function mapJurisdictions(fc: JurisdictionFC): Jurisdiction[] {
  const all = fc.features.map(featureToJurisdiction)
  const counties = all.filter((j) => j.type === 'county')
  const cities = all.filter((j) => j.type === 'city')
  counties.sort((a, b) => a.name.localeCompare(b.name))
  cities.sort((a, b) => a.name.localeCompare(b.name))
  return [...counties, ...cities]
}

function featureToJurisdiction(f: Feature<Polygon | MultiPolygon>): Jurisdiction {
  const props = f.properties ?? {}
  const { id, name, jurisdictionType } = props
  if (typeof id !== 'string' && typeof id !== 'number') {
    throw new Error(`feature missing id: ${JSON.stringify(props)}`)
  }
  if (typeof name !== 'string') {
    throw new Error(`feature missing name: ${JSON.stringify(props)}`)
  }
  if (jurisdictionType !== 'county' && jurisdictionType !== 'city') {
    throw new Error(`feature has unknown jurisdictionType: ${JSON.stringify(props)}`)
  }
  if (!f.geometry) {
    throw new Error(`feature ${name} (${id}) missing geometry`)
  }
  return {
    id: String(id),
    name,
    type: jurisdictionType,
    geometry: f.geometry,
  }
}
