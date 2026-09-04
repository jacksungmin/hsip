<script lang="ts">
  // Renders one overlay layer described by config/overlays.yaml. Generic on
  // purpose: everything specific to a layer — which tileset, which column,
  // which colours — comes from the config, so adding a layer is a config
  // edit rather than a new component.
  //
  // Overlays sit in the lowest slot, under the region and crash layers, since
  // they are reference context the user consults while drawing.

  import { getContext } from 'svelte'
  import maplibregl from 'maplibre-gl'
  import { dataManifest } from '../state/dataManifest.svelte'
  import { overlayState } from '../state/overlayState.svelte'
  import { compilePaint, compileFilter, maplibreType } from '../services/overlayStyle'
  import { acquireSource, releaseSource, overlaySourceId } from '../map/overlaySource'
  import { reportError } from '../services/errorReporter'
  import type { OverlayLayerDef } from '../types'

  let { def }: { def: OverlayLayerDef } = $props()

  const map = getContext<() => maplibregl.Map>('map')()

  // Runs once at init. `def` is fixed for this component's lifetime — App keys
  // the each-block by def.id, so a config change mounts a new instance rather
  // than mutating this one — and reading a prop at init would otherwise warn
  // that it captures only the initial value. Any function wrapper silences
  // that, which is the only reason this is a function.
  const { layerId, known } = createLayer()

  function createLayer() {
    const layerId = `overlay-${def.id}`

    // The build already fails on a `source` no published tileset provides, so
    // this only catches data deployed after the app was built — an overlay
    // retired from build-config, say. Without it MapLibre would get a URL
    // ending in "undefined" and every tile fetch would 404.
    const tileset = dataManifest.overlay(def.source)
    const known = tileset !== undefined
    if (!tileset) {
      reportError(
        new Error(`no published overlay named "${def.source}" for layer "${def.id}"`),
        {
          where: `map overlay "${def.id}"`,
          fatal: false,
          advice: `The "${def.label}" layer is not available.`,
        },
      )
      return { layerId, known }
    }

    acquireSource(map, def.source, tileset.url)

    map.addLayer(
      {
        id: layerId,
        type: maplibreType(def.draw),
        source: overlaySourceId(def.source),
        // From the manifest, not the config: the data build is what named the
        // layer inside the tileset, so the config never restates it.
        'source-layer': tileset.sourceLayer,
        layout:
          def.draw === 'line'
            ? { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' }
            : { visibility: 'none' },
        paint: compilePaint(def),
      } as maplibregl.AddLayerObject,
      // Each overlay inserts directly below this slot, so a later config
      // entry lands above an earlier one: file order is draw order.
      'slot-roads',
    )

    return { layerId, known }
  }

  // Visibility and the class filter both come from overlayState, so the layer
  // switch and a legend checkbox drive the layer through one path.
  $effect(() => {
    if (!known) return
    const entry = overlayState.entry(def.id)
    map.setLayoutProperty(layerId, 'visibility', entry.on ? 'visible' : 'none')
    map.setFilter(
      layerId,
      compileFilter(def, new Set(entry.classes)) as maplibregl.FilterSpecification | undefined,
    )
  })

  $effect(() => {
    return () => {
      if (!known) return
      if (map.getLayer(layerId)) map.removeLayer(layerId)
      releaseSource(map, def.source)
    }
  })
</script>
