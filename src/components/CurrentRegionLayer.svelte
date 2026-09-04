<script lang="ts">
  import { getContext } from 'svelte'
  import maplibregl from 'maplibre-gl'
  import type { FeatureCollection } from 'geojson'
  import { regionState } from '../state/regionState.svelte'

  const map = getContext<() => maplibregl.Map>('map')()

  const SOURCE_ID = 'region'
  const FILL_ID = 'region-fill'
  const LINE_ID = 'region-line'

  const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] }

  $effect(() => {
    const region = regionState.get().current

    const geojson: FeatureCollection = region
      ? {
          type: 'FeatureCollection',
          features: [
            { type: 'Feature', geometry: region.geometry, properties: {} },
          ],
        }
      : EMPTY_FC

    const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined
    if (source) {
      source.setData(geojson)
    } else {
      map.addSource(SOURCE_ID, { type: 'geojson', data: geojson })
      // Fill layer kept with zero opacity — adjust fill-color/fill-opacity here if needed
      map.addLayer({
        id: FILL_ID,
        type: 'fill',
        source: SOURCE_ID,
        paint: { 'fill-color': '#374151', 'fill-opacity': 0 },
      }, 'slot-region')
      map.addLayer({
        id: LINE_ID,
        type: 'line',
        source: SOURCE_ID,
        paint: { 'line-color': '#374151', 'line-width': 2, 'line-dasharray': [4, 3] },
      }, 'slot-region')
    }

    if (region) {
      const bounds = new maplibregl.LngLatBounds()
      // Polygon: coordinates is ring[]. MultiPolygon: coordinates is polygon[],
      // each polygon is ring[]. Flatten to one ring[] either way.
      const rings =
        region.geometry.type === 'Polygon'
          ? region.geometry.coordinates
          : region.geometry.coordinates.flat()
      for (const ring of rings) {
        for (const coord of ring) {
          bounds.extend(coord as [number, number])
        }
      }
      map.fitBounds(bounds, { padding: 40 })
    }
  })

  $effect(() => {
    return () => {
      if (map.getLayer(LINE_ID)) map.removeLayer(LINE_ID)
      if (map.getLayer(FILL_ID)) map.removeLayer(FILL_ID)
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID)
    }
  })
</script>
