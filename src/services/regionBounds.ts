// The area the crash data covers, as the bounding box of the region's
// counties. Used to warn when a searched point or an uploaded location falls
// outside it, where there are no crashes to analyze.

import turfBbox from '@turf/bbox'
import type { Jurisdiction } from '../types'

export type Bbox = [west: number, south: number, east: number, north: number]

export function regionBbox(places: Jurisdiction[]): Bbox | null {
  const counties = places.filter((p) => p.type === 'county')
  if (counties.length === 0) return null
  return turfBbox({
    type: 'FeatureCollection',
    features: counties.map((c) => ({ type: 'Feature', properties: {}, geometry: c.geometry })),
  }) as Bbox
}

export function inBbox(box: Bbox, lon: number, lat: number): boolean {
  return lon >= box[0] && lon <= box[2] && lat >= box[1] && lat <= box[3]
}
