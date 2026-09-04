<script lang="ts">
  import { getContext } from 'svelte'
  import maplibregl from 'maplibre-gl'
  import turfBbox from '@turf/bbox'
  import type { FeatureCollection, Feature } from 'geojson'
  import { draftSiteState } from '../state/draftSiteState.svelte'
  import { siteList } from '../state/siteList.svelte'
  import { activeSite } from '../state/activeSite.svelte'
  import { workbenchState } from '../state/workbenchState.svelte'
  import type { Site } from '../types'

  // Bbox spanning every part buffer, for zoom-to-site.
  function siteBbox(site: Site) {
    const fc: FeatureCollection = {
      type: 'FeatureCollection',
      features: site.parts.map((p) => ({ type: 'Feature', geometry: p.bufferedGeometry, properties: {} })),
    }
    return turfBbox(fc)
  }

  const map = getContext<() => maplibregl.Map>('map')()

  // Experimental: zoom to site buffer. Easy to disable.
  const FIT_TO_SITE = true
  let prevActiveId: string | null = null
  let prevActivePartId: string | null = null
  let prevEditingKey: string | null = null

  const SOURCE_ID = 'site-buffer'
  const FILL_ID = 'site-buffer-fill'
  const LINE_ID = 'site-buffer-line'
  const GEOM_POINT_ID = 'site-drawn-point'
  const GEOM_LINE_ID = 'site-drawn-line'

  const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] }

  const ACCENT = '#025773'
  const MUTED = '#9ca3af'

  const statusColor = ['match', ['get', 'status'], 'active', ACCENT, MUTED]

  $effect(() => {
    const draft = draftSiteState.value
    const sites = siteList.get()
    const activeId = activeSite.get()

    const features: Feature[] = []

    const editingId = draft?.editingSiteId
    const editingPartId = draft?.editingPartId
    const hidden = draftSiteState.hiddenPart
    const activePartId = activeSite.getPart()
    const sbPreview = draftSiteState.siteBufferPreview
    for (const site of sites) {
      const siteActive = site.id === activeId
      for (const part of site.parts) {
        if (site.id === editingId && (!editingPartId || part.id === editingPartId)) continue
        if (hidden && site.id === hidden.siteId && part.id === hidden.partId) continue
        const status = siteActive && (!activePartId || part.id === activePartId) ? 'active' : 'inactive'
        const previewGeom = sbPreview?.siteId === site.id ? sbPreview.previews.get(part.id) : undefined
        features.push({ type: 'Feature', geometry: previewGeom ?? part.bufferedGeometry, properties: { layer: 'buffer', status } })
        features.push({ type: 'Feature', geometry: part.drawnGeometry, properties: { layer: 'geom', status } })
      }
    }

    if (draft) {
      features.push({ type: 'Feature', geometry: draft.bufferPolygon, properties: { layer: 'buffer', status: 'active' } })
      features.push({ type: 'Feature', geometry: draft.geometry, properties: { layer: 'geom', status: 'active' } })
    }

    const geojson: FeatureCollection = features.length
      ? { type: 'FeatureCollection', features }
      : EMPTY_FC

    if (FIT_TO_SITE) {
      if (activeId && activeId !== prevActiveId) {
        const site = sites.find((s) => s.id === activeId)
        if (site) {
          const [minX, minY, maxX, maxY] = siteBbox(site)
          map.fitBounds([[minX, minY], [maxX, maxY]], { padding: 80 })
        }
      }
      prevActiveId = activeId

      // Selecting a part frames it; deselecting (back to whole-site
      // selection) stays put rather than zooming back out.
      if (activePartId && activePartId !== prevActivePartId) {
        const part = sites.find((s) => s.id === activeId)?.parts.find((p) => p.id === activePartId)
        if (part) {
          const [minX, minY, maxX, maxY] = turfBbox(part.bufferedGeometry)
          map.fitBounds([[minX, minY], [maxX, maxY]], { padding: 80 })
        }
      }
      prevActivePartId = activePartId

      const editingKey = editingId ? `${editingId}/${editingPartId ?? ''}` : null
      if (editingKey && editingKey !== prevEditingKey && draft) {
        const [minX, minY, maxX, maxY] = turfBbox(draft.bufferPolygon)
        map.fitBounds([[minX, minY], [maxX, maxY]], { padding: 80 })
      }
      prevEditingKey = editingKey
    }

    const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined
    if (source) {
      source.setData(geojson)
    } else {
      map.addSource(SOURCE_ID, { type: 'geojson', data: geojson })
      map.addLayer({
        id: FILL_ID,
        type: 'fill',
        source: SOURCE_ID,
        filter: ['==', ['get', 'layer'], 'buffer'],
        paint: {
          'fill-color': statusColor as any,
          'fill-opacity': ['match', ['get', 'status'], 'active', 0.15, 0.08],
        },
      }, 'slot-site')
      map.addLayer({
        id: LINE_ID,
        type: 'line',
        source: SOURCE_ID,
        filter: ['==', ['get', 'layer'], 'buffer'],
        paint: {
          'line-color': statusColor as any,
          'line-width': ['match', ['get', 'status'], 'active', 2, 1.5],
          'line-dasharray': [3, 2],
        },
      }, 'slot-site')
      map.addLayer({
        id: GEOM_LINE_ID,
        type: 'line',
        source: SOURCE_ID,
        filter: ['all', ['==', ['get', 'layer'], 'geom'], ['==', ['geometry-type'], 'LineString']],
        paint: {
          'line-color': statusColor as any,
          'line-width': ['match', ['get', 'status'], 'active', 3, 2],
        },
      }, 'slot-site')
      map.addLayer({
        id: GEOM_POINT_ID,
        type: 'circle',
        source: SOURCE_ID,
        filter: ['all', ['==', ['get', 'layer'], 'geom'], ['==', ['geometry-type'], 'Point']],
        paint: {
          'circle-radius': ['match', ['get', 'status'], 'active', 5, 4],
          'circle-color': statusColor as any,
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 2,
        },
      }, 'slot-site')
    }
  })

  let prevWbSiteId: string | null = null

  $effect(() => {
    const wbSiteId = workbenchState.siteId
    if (wbSiteId === prevWbSiteId) return
    prevWbSiteId = wbSiteId

    const targetId = wbSiteId ?? activeSite.get()
    if (!targetId) return
    const site = siteList.get().find((s) => s.id === targetId)
    if (!site) return

    const [minX, minY, maxX, maxY] = siteBbox(site)
    requestAnimationFrame(() => {
      map.resize()
      map.fitBounds([[minX, minY], [maxX, maxY]], { padding: 80 })
    })
  })

  $effect(() => {
    return () => {
      if (map.getLayer(GEOM_POINT_ID)) map.removeLayer(GEOM_POINT_ID)
      if (map.getLayer(GEOM_LINE_ID)) map.removeLayer(GEOM_LINE_ID)
      if (map.getLayer(LINE_ID)) map.removeLayer(LINE_ID)
      if (map.getLayer(FILL_ID)) map.removeLayer(FILL_ID)
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID)
    }
  })
</script>
