// Map search without an outside service: city and county names from the
// jurisdiction boundaries the app already loads, and typed coordinates.
// Address search would need a geocoding service, which the app does not
// use (no interaction hits the network once the data is downloaded); see
// docs/08-future-ideas.md.

import type { Jurisdiction } from '../types'

export type Coordinates = { lon: number; lat: number }

// A coordinate pair in decimal degrees, separated by a comma and/or spaces:
// "29.7604, -95.3698" (latitude first, as map sites show it) or
// "-95.3698, 29.7604". When one value is beyond ±90 it can only be the
// longitude, so either order works for Texas; otherwise latitude comes first.
export function parseCoordinates(text: string): Coordinates | null {
  const m = text.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)$/)
  if (!m) return null
  const a = Number(m[1])
  const b = Number(m[2])
  let lat: number
  let lon: number
  if (Math.abs(a) <= 90 && Math.abs(b) > 90) [lat, lon] = [a, b]
  else if (Math.abs(b) <= 90 && Math.abs(a) > 90) [lat, lon] = [b, a]
  else [lat, lon] = [a, b]
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  return { lon, lat }
}

export type PlaceMatch = { jurisdiction: Jurisdiction; label: string }

const TYPE_LABEL: Record<string, string> = { county: 'County', city: 'City', 'hgac-region': 'Region' }

// Cities and counties whose name matches the query: names starting with it
// first, then names containing it, each alphabetical. Case-insensitive.
export function searchPlaces(query: string, places: Jurisdiction[], limit = 8): PlaceMatch[] {
  const q = query.trim().toLowerCase()
  if (q.length < 2) return []
  const starts: Jurisdiction[] = []
  const contains: Jurisdiction[] = []
  for (const j of places) {
    if (j.type !== 'county' && j.type !== 'city') continue
    const name = j.name.toLowerCase()
    if (name.startsWith(q)) starts.push(j)
    else if (name.includes(q)) contains.push(j)
  }
  const byName = (x: Jurisdiction, y: Jurisdiction) => x.name.localeCompare(y.name)
  return [...starts.sort(byName), ...contains.sort(byName)]
    .slice(0, limit)
    .map((jurisdiction) => ({ jurisdiction, label: TYPE_LABEL[jurisdiction.type] ?? '' }))
}
