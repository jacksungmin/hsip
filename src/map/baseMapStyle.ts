// Shared basemap for the interactive map and transient report captures.
// Keeping this in one place prevents tile settings and attribution from
// drifting between the two.
//
// The basemap is one URL in config/app.yaml, and which kind it is is read off
// the URL rather than declared. MapLibre only ever accepts a style document —
// a list of sources and layers — so the two cases differ in who writes that
// document, not in what MapLibre is given:
//
//   vector: the URL *is* a style document, listing its own tile source and the
//           paint rules for it. Hand MapLibre the URL and it fetches the rest.
//   raster: the URL is a bare tile address. We wrap it in a minimal document
//           with one source and one layer. There are no paint rules to write,
//           because raster tiles arrive already drawn.
//
// So a raster basemap needs a few more values (how deep the tiles go, how big
// they are, who to credit) only because a bare URL carries no metadata, while
// a vector style carries all of it inside. Those values have defaults that
// suit OpenStreetMap-derived sources, so in practice both cases are one URL.

import type { Map as MaplibreMap, StyleSpecification } from 'maplibre-gl'
import { basemap } from '../data/appConfig'
import type { AppConfig } from '../types'

export const BASEMAP_ATTRIBUTION = basemap.attribution

// Kept in sync with the same check in vite-plugin-app-config.ts, which rejects
// a URL carrying only some of the three placeholders — the one malformed case
// this test would silently read as a vector style.
export function isRasterTemplate(url: string): boolean {
  return url.includes('{z}') && url.includes('{x}') && url.includes('{y}')
}

// MapLibre's `style` option takes a URL or a style object, so both cases are
// returned from one function and callers do not branch.
//
// The config is a defaulted parameter so tests can exercise both branches
// without the answer depending on whatever config/app.yaml currently says.
export function baseMapStyle(
  config: AppConfig['basemap'] = basemap,
): string | StyleSpecification {
  if (!isRasterTemplate(config.url)) return config.url

  return {
    version: 8,
    sources: {
      basemap: {
        type: 'raster',
        tiles: [config.url],
        tileSize: config.tileSize,
        // Declaring this is what makes deep zoom work: MapLibre stretches the
        // deepest real tile to fill closer zooms. Without it, it requests
        // tiles the provider does not have and the map goes blank.
        maxzoom: config.maxZoom,
        attribution: config.attribution,
      },
    },
    layers: [{ id: 'basemap', type: 'raster', source: 'basemap' }],
  }
}

const SLOT_LAYERS = [
  'slot-roads',
  'slot-region',
  'slot-site',
  'slot-heatmap',
  'slot-interaction',
] as const

// Empty layers at fixed positions, so app layers can be inserted at a known
// depth without naming any layer inside the basemap. That is what makes the
// basemap swappable: no app code refers to a basemap layer id, and none of
// these names appears in a normal style.
export function addSlotLayers(map: MaplibreMap): void {
  for (const id of SLOT_LAYERS) {
    map.addLayer({ id, type: 'background', paint: { 'background-opacity': 0 } })
  }
}
