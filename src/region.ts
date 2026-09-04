import type { Polygon, MultiPolygon } from 'geojson'
import turfBbox from '@turf/bbox'
import type { CustomRegion, Jurisdiction, Region } from './types'
import { customRegionStore } from './state/customRegionStore.svelte'
import { regionState } from './state/regionState.svelte'

const MAX_BBOX_SQ_DEG = 4 // sq degrees

export type BoundsCheck = { valid: true } | { valid: false; reason: string }

export function validateRegionBounds(geometry: Polygon | MultiPolygon): BoundsCheck {
  const [minX, minY, maxX, maxY] = turfBbox(geometry)
  const area = (maxX - minX) * (maxY - minY)
  if (area > MAX_BBOX_SQ_DEG) {
    return { valid: false, reason: 'Region too large. Draw a smaller area.' }
  }
  return { valid: true }
}

let drawCount = 0

export function handleRegionDraw(geometry: Polygon): string | null {
  const check = validateRegionBounds(geometry)
  if (!check.valid) return check.reason
  drawCount++
  const region: CustomRegion = {
    id: `draw:${crypto.randomUUID()}`,
    name: `Custom Region ${drawCount}`,
    source: 'draw',
    geometry,
  }
  customRegionStore.add(region)
  regionState.setCurrent(region)
  return null
}

export function jurisdictionToRegion(j: Jurisdiction): Region {
  return {
    id: `jurisdiction:${j.type}:${j.id}`,
    name: j.name,
    source: 'jurisdiction',
    jurisdictionType: j.type,
    jurisdictionId: j.id,
    geometry: j.geometry,
  }
}
