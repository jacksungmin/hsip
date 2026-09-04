// Shared vector sources for overlay layers.
//
// Several overlay layers may draw from one tileset — the HIN tileset backs a
// layer per network, for instance — so the source is added once and reference
// counted. Without the count, the first layer to unmount would remove the
// source out from under its siblings.
//
// Counts are keyed per map instance. Only one map mounts overlays today, but
// keying by map is the shape that stays correct if a second one ever does, and
// costs a WeakMap lookup.

import type maplibregl from 'maplibre-gl'

const refCounts = new WeakMap<maplibregl.Map, Map<string, number>>()

export function overlaySourceId(source: string): string {
  return `overlay-src-${source}`
}

export function acquireSource(map: maplibregl.Map, source: string, url: string): string {
  const id = overlaySourceId(source)
  let counts = refCounts.get(map)
  if (!counts) {
    counts = new Map()
    refCounts.set(map, counts)
  }

  if (!map.getSource(id)) {
    map.addSource(id, { type: 'vector', url: `pmtiles://${url}` })
  }
  counts.set(id, (counts.get(id) ?? 0) + 1)
  return id
}

// Only ever called after a matching acquireSource, so the count exists.
export function releaseSource(map: maplibregl.Map, source: string): void {
  const id = overlaySourceId(source)
  const counts = refCounts.get(map)
  if (!counts) return

  const remaining = (counts.get(id) ?? 0) - 1
  if (remaining > 0) {
    counts.set(id, remaining)
    return
  }
  counts.delete(id)
  if (map.getSource(id)) map.removeSource(id)
}
