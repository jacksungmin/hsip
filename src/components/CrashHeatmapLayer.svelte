<script lang="ts">
  import { getContext } from 'svelte'
  import maplibregl from 'maplibre-gl'
  import type { Region } from '../types'
  import { regionState } from '../state/regionState.svelte'
  import { EA_IDS, type EaFlagKey } from '../data/emphasisAreas'
  import { SEVERITY_LABELS, SEVERITY_MAP_COLORS } from '../data/severityMeta'
  import { mapInteraction } from '../state/mapInteraction.svelte'
  import { dataManifest } from '../state/dataManifest.svelte'

  let { visible, selectedEAs }: {
    visible: boolean
    selectedEAs: EaFlagKey[]
  } = $props()

  const map = getContext<() => maplibregl.Map>('map')()

  const SOURCE_ID = 'crash-points'
  const SOURCE_LAYER = 'crashes'
  const HEATMAP_ID = 'crash-heatmap'
  const CIRCLE_ID = 'crash-circles'

  const CROSSFADE_START = 13
  const CROSSFADE_END = 14

  // --- Source and layer setup (runs once at mount) ---
  // Layers start hidden; the visibility effect below sets them
  // based on the current reactive `visible` prop.

  // promoteId lifts the Crash_ID tile property into the feature id so
  // setFeatureState (hover highlight) can address individual features.
  // The URL comes from the data manifest; App gates this component on
  // manifest presence, so it is resolved by the time we mount.
  map.addSource(SOURCE_ID, {
    type: 'vector',
    url: `pmtiles://${dataManifest.artifactUrl('crashTiles')}`,
    promoteId: 'Crash_ID',
  })

  map.addLayer({
    id: HEATMAP_ID,
    type: 'heatmap',
    source: SOURCE_ID,
    'source-layer': SOURCE_LAYER,
    layout: { visibility: 'none' },
    paint: {
      'heatmap-weight': [
        'match', ['get', 'kabco'],
        'K', 3,
        'A', 3,
        'B', 2,
        0,
      ],
      'heatmap-radius': [
        'interpolate', ['linear'], ['zoom'],
        5, 1,
        9, 3,
        CROSSFADE_END, 8,
      ],
      'heatmap-intensity': [
        'interpolate', ['linear'], ['zoom'],
        5, 0.3,
        9, 1,
        CROSSFADE_END, 3,
      ],
      'heatmap-color': [
        'interpolate', ['linear'], ['heatmap-density'],
        0,   'rgba(0,0,0,0)',
        0.2, '#2166ac',
        0.4, '#67a9cf',
        0.6, '#fddbc7',
        0.8, '#ef8a62',
        1.0, '#b2182b',
      ],
      'heatmap-opacity': [
        'interpolate', ['linear'], ['zoom'],
        CROSSFADE_START, 0.75,
        CROSSFADE_END, 0,
      ],
    },
  }, 'slot-heatmap')

  map.addLayer({
    id: CIRCLE_ID,
    type: 'circle',
    source: SOURCE_ID,
    'source-layer': SOURCE_LAYER,
    minzoom: CROSSFADE_START,
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': [
        'interpolate', ['linear'], ['zoom'],
        CROSSFADE_START, ['case', ['boolean', ['feature-state', 'hover'], false], 4.5, 3],
        CROSSFADE_END, ['case', ['boolean', ['feature-state', 'hover'], false], 7.5, 5],
        16, ['case', ['boolean', ['feature-state', 'hover'], false], 7.5, 5],
      ],
      'circle-color': [
        'match', ['get', 'kabco'],
        'K', SEVERITY_MAP_COLORS.K,
        'A', SEVERITY_MAP_COLORS.A,
        'B', SEVERITY_MAP_COLORS.B,
        SEVERITY_MAP_COLORS.B,
      ],
      'circle-opacity': [
        'interpolate', ['linear'], ['zoom'],
        CROSSFADE_START, 0,
        CROSSFADE_END, 0.8,
      ],
      'circle-stroke-width': [
        'interpolate', ['linear'], ['zoom'],
        CROSSFADE_END, 0,
        CROSSFADE_END + 2, 0.5,
      ],
      'circle-stroke-color': '#ffffff',
    },
  }, 'slot-interaction')

  // --- Reactive effects ---

  function buildEAFilter(eas: EaFlagKey[]): maplibregl.FilterSpecification | null {
    if (eas.length === EA_IDS.length) return null
    if (eas.length === 0) return false
    const clauses = eas.map(ea => ['==', ['get', ea], 1])
    return ['any', ...clauses] as unknown as maplibregl.FilterSpecification
  }

  function buildRegionFilter(region: Region | null): maplibregl.FilterSpecification | null {
    if (!region) return null
    if (region.source === 'jurisdiction') {
      // Tile county_id/city_id are numeric; app jurisdictionId is a string.
      // MapLibre == does not type-coerce, so cast the tile value.
      if (region.jurisdictionType === 'county') {
        return ['==', ['to-string', ['get', 'county_id']], region.jurisdictionId] as unknown as maplibregl.FilterSpecification
      }
      if (region.jurisdictionType === 'city') {
        return ['==', ['to-string', ['get', 'city_id']], region.jurisdictionId] as unknown as maplibregl.FilterSpecification
      }
      return null
    }
    return ['within', { type: 'Feature', geometry: region.geometry, properties: {} }]
  }

  $effect(() => {
    const eaFilter = buildEAFilter(selectedEAs)
    const regionFilter = buildRegionFilter(regionState.get().current)
    const parts = [eaFilter, regionFilter].filter((f): f is maplibregl.FilterSpecification => f !== null)
    const combined: maplibregl.FilterSpecification | null =
      parts.length === 0 ? null : parts.length === 1 ? parts[0] : ['all', ...parts] as unknown as maplibregl.FilterSpecification
    map.setFilter(HEATMAP_ID, combined)
    map.setFilter(CIRCLE_ID, combined)
  })

  $effect(() => {
    const vis = visible ? 'visible' : 'none'
    map.setLayoutProperty(HEATMAP_ID, 'visibility', vis)
    map.setLayoutProperty(CIRCLE_ID, 'visibility', vis)
  })

  // --- Popup ---

  const popup = new maplibregl.Popup({ closeButton: true, closeOnClick: true, offset: 8 })
  let hoveredId: string | number | null = null

  function onCircleClick(e: maplibregl.MapLayerMouseEvent) {
    if (mapInteraction.locked) return
    const f = e.features?.[0]
    if (!f) return
    const p = f.properties as Record<string, unknown>
    const id = p.Crash_ID ?? p.crash_id ?? ''
    const sev = String(p.kabco ?? '') as keyof typeof SEVERITY_LABELS
    const label = SEVERITY_LABELS[sev] ?? sev
    const color = SEVERITY_MAP_COLORS[sev] ?? '#888'
    popup
      .setLngLat(e.lngLat)
      .setHTML(
        `<div class="crash-popup-title">Crash ${id}</div>` +
        `<div class="crash-popup-severity">` +
          `<span class="crash-popup-dot" style="background:${color}"></span>${label} (${sev})` +
        `</div>`,
      )
      .addTo(map)
  }

  function onCircleMove(e: maplibregl.MapLayerMouseEvent) {
    if (mapInteraction.locked) return
    map.getCanvas().style.cursor = 'pointer'
    const f = e.features?.[0]
    if (!f || f.id === undefined || f.id === hoveredId) return
    if (hoveredId !== null) {
      map.setFeatureState({ source: SOURCE_ID, sourceLayer: SOURCE_LAYER, id: hoveredId }, { hover: false })
    }
    hoveredId = f.id
    map.setFeatureState({ source: SOURCE_ID, sourceLayer: SOURCE_LAYER, id: hoveredId }, { hover: true })
  }

  function onCircleLeave() {
    if (mapInteraction.locked) return
    map.getCanvas().style.cursor = ''
    if (hoveredId !== null) {
      map.setFeatureState({ source: SOURCE_ID, sourceLayer: SOURCE_LAYER, id: hoveredId }, { hover: false })
      hoveredId = null
    }
  }

  $effect(() => {
    map.on('click', CIRCLE_ID, onCircleClick)
    map.on('mousemove', CIRCLE_ID, onCircleMove)
    map.on('mouseleave', CIRCLE_ID, onCircleLeave)
    return () => {
      map.off('click', CIRCLE_ID, onCircleClick)
      map.off('mousemove', CIRCLE_ID, onCircleMove)
      map.off('mouseleave', CIRCLE_ID, onCircleLeave)
      popup.remove()
    }
  })

  // --- Cleanup ---

  $effect(() => {
    return () => {
      if (map.getLayer(CIRCLE_ID)) map.removeLayer(CIRCLE_ID)
      if (map.getLayer(HEATMAP_ID)) map.removeLayer(HEATMAP_ID)
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID)
    }
  })
</script>

<!-- :global() because the popup DOM is built by MapLibre via setHTML,
     outside this component's tree, so scoped selectors would not match.
     Font and text color inherit from body; only the deltas are set here. -->
<style>
  :global(.maplibregl-popup-content) {
    padding: 0.5rem 0.625rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: 0 2px 8px rgb(0 0 0 / 0.12);
    font-size: 0.8125rem;
    line-height: 1.4;
  }

  :global(.maplibregl-popup-close-button) {
    padding-inline: 0.375rem;
    color: var(--muted-foreground);
  }

  :global(.maplibregl-popup-close-button:hover) {
    background: var(--accent);
    color: var(--foreground);
  }

  :global(.crash-popup-title) {
    font-weight: 600;
  }

  :global(.crash-popup-severity) {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    color: var(--muted-foreground);
    font-size: 0.75rem;
  }

  :global(.crash-popup-dot) {
    width: 0.5rem;
    height: 0.5rem;
    flex-shrink: 0;
    border-radius: 50%;
  }
</style>
