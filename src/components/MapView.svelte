<script lang="ts">
  import { setContext } from 'svelte'
  import type { Snippet } from 'svelte'
  import maplibregl from 'maplibre-gl'
  import 'maplibre-gl/dist/maplibre-gl.css'
  import { Protocol } from 'pmtiles'
  import { baseMapStyle, addSlotLayers } from '../map/baseMapStyle'
  import { basemap } from '../data/appConfig'
  import { reportError } from '../services/errorReporter'

  const pmtilesProtocol = new Protocol()
  maplibregl.addProtocol('pmtiles', pmtilesProtocol.tile)

  // MapLibre has no timeout of its own: a style URL that never answers leaves
  // the map blank for ever and reports nothing.
  const STYLE_TIMEOUT_MS = 15_000

  let { children }: { children?: Snippet } = $props()

  let container: HTMLDivElement
  let mapInstance = $state<maplibregl.Map | null>(null)
  let styleFailed = $state(false)

  setContext('map', () => mapInstance)

  $effect(() => {
    const map = new maplibregl.Map({
      container,
      style: baseMapStyle(),
      center: [-95.37, 29.76],
      zoom: 8,
      maxZoom: 18,
    })

    // So the timeout below does not report the same failure in different words.
    let basemapReported = false

    // MapLibre routes every style, source, and tile failure through this one
    // event, and with no listener writes only to the console. Non-fatal in
    // every case: a missing basemap or overlay leaves crash figures intact.
    map.on('error', (event) => {
      // MapLibre attaches the failing source's id for a source or tile
      // failure, and nothing for a style failure — but only the base event is
      // in its published types, so the field has to be read through a cast.
      const source = (event as { sourceId?: string }).sourceId
      if (!source) basemapReported = true
      reportError(event.error ?? new Error('map error with no detail'), {
        where: source ? `map layer "${source}"` : 'basemap',
        fatal: false,
        advice: source
          ? 'A map layer could not be loaded.'
          : 'The background map could not be loaded.',
      })
    })

    // A vector style that never arrives fires no 'load', so the map gate below
    // never opens. A raster basemap cannot reach here: its style document is
    // built locally, so 'load' always fires and only its tiles can fail.
    const styleTimeout = setTimeout(() => {
      if (mapInstance) return
      styleFailed = true
      if (basemapReported) return
      reportError(new Error(`basemap style did not load within ${STYLE_TIMEOUT_MS}ms: ${basemap.url}`), {
        where: 'basemap',
        fatal: false,
        advice: 'The background map is not responding.',
      })
    }, STYLE_TIMEOUT_MS)

    map.on('load', () => {
      clearTimeout(styleTimeout)
      addSlotLayers(map)
      mapInstance = map
    })

    return () => {
      clearTimeout(styleTimeout)
      mapInstance = null
      map.remove()
    }
  })
</script>

<div bind:this={container} class="map"></div>

<!-- Positioned against MapToolbar's section, which wraps this. Gated on the
     map too, so a style that arrives after the timeout clears the overlay
     rather than leaving an invisible sheet over a working map. -->
{#if styleFailed && !mapInstance}
  <div class="absolute inset-0 z-10 grid place-items-center p-6">
    <div class="max-w-sm rounded-md border border-destructive/30 bg-background px-4 py-3 text-center shadow-sm">
      <p class="text-sm font-medium">The background map is unavailable</p>
    </div>
  </div>
{/if}

{#if mapInstance}
  {@render children?.()}
{/if}

<style>
  .map {
    width: 100%;
    height: 100%;
    min-height: 0;
  }
</style>
