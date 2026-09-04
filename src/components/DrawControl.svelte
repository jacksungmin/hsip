<script lang="ts">
  import { getContext } from 'svelte'
  import maplibregl from 'maplibre-gl'
  import { TerraDraw, TerraDrawPolygonMode, TerraDrawLineStringMode, TerraDrawPointMode } from 'terra-draw'
  import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter'
  import type { Polygon, LineString, Point } from 'geojson'
  import { drawingState, type DrawingTool } from '../state/drawingState.svelte'
  import type { DrawResult } from '../types'

  type Props = {
    onDrawComplete: (result: DrawResult) => void
  }

  let { onDrawComplete }: Props = $props()

  const map = getContext<() => maplibregl.Map>('map')()

  let draw: TerraDraw | null = null

  const TOOL_TO_MODE: Record<NonNullable<DrawingTool>, string> = {
    'region-polygon': 'polygon',
    'roadway-line': 'linestring',
    'intersection-point': 'point',
  }

  function createDraw(): TerraDraw {
    const td = new TerraDraw({
      adapter: new TerraDrawMapLibreGLAdapter({ map }),
      modes: [
        new TerraDrawPolygonMode({ pointerDistance: 15 }),
        new TerraDrawLineStringMode({ pointerDistance: 15 }),
        new TerraDrawPointMode({ pointerDistance: 15 }),
      ],
    })
    td.start()
    td.on('finish', (id) => {
      const feature = td.getSnapshotFeature(id)
      if (!feature) return
      const geomType = feature.geometry.type
      if (geomType === 'Polygon') {
        onDrawComplete({ type: 'region', geometry: feature.geometry as Polygon })
      } else if (geomType === 'LineString') {
        onDrawComplete({ type: 'roadway', geometry: feature.geometry as LineString })
      } else if (geomType === 'Point') {
        onDrawComplete({ type: 'intersection', geometry: feature.geometry as Point })
      }
      td.removeFeatures([id])
      drawingState.setTool(null)
    })
    return td
  }

  $effect(() => {
    const tool = drawingState.get()

    if (tool) {
      if (!draw) draw = createDraw()
      draw.setMode(TOOL_TO_MODE[tool])
    } else {
      if (draw) {
        draw.clear()
        draw.stop()
        draw = null
        map.getCanvas().style.cursor = ''
      }
    }
  })

  drawingState.registerInProgressCheck(() => {
    if (!draw) return false
    return draw.getSnapshot().some(
      (f) => f.properties?.currentlyDrawing === true,
    )
  })

  $effect(() => {
    return () => {
      if (draw) {
        draw.clear()
        draw.stop()
        draw = null
        map.getCanvas().style.cursor = ''
      }
    }
  })
</script>
