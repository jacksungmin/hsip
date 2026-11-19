<!-- Map search, top-left of the map: zoom to a city or county by name, or
     fly to typed coordinates and mark them, so an analyst adding a site by
     hand can find the location first. No outside service: names come from
     the jurisdiction boundaries already loaded (services/mapSearch.ts). -->
<script lang="ts">
  import { getContext, onDestroy } from 'svelte'
  import maplibregl from 'maplibre-gl'
  import turfBbox from '@turf/bbox'
  import Search from '@lucide/svelte/icons/search'
  import X from '@lucide/svelte/icons/x'
  import { jurisdictionStore } from '../state/jurisdictionStore.svelte'
  import { parseCoordinates, searchPlaces, type PlaceMatch } from '../services/mapSearch'
  import { inBbox, regionBbox } from '../services/regionBounds'
  import type { Jurisdiction } from '../types'

  const map = getContext<() => maplibregl.Map>('map')()

  let query = $state('')
  let places = $state<Jurisdiction[]>([])
  let open = $state(false)
  let highlighted = $state(0)
  let notice = $state<string | null>(null)
  let marker = $state<maplibregl.Marker | null>(null)

  jurisdictionStore.list().then((list) => { places = list }).catch(() => { places = [] })

  const coords = $derived(parseCoordinates(query))
  const matches = $derived<PlaceMatch[]>(coords ? [] : searchPlaces(query, places))

  // Bounding box of the counties: the area the crash data covers.
  const regionBox = $derived(regionBbox(places))

  function clearMarker() {
    marker?.remove()
    marker = null
  }

  function goToPlace(j: Jurisdiction) {
    clearMarker()
    const [minX, minY, maxX, maxY] = turfBbox(j.geometry)
    map.fitBounds([[minX, minY], [maxX, maxY]], { padding: 40, duration: 800 })
    query = j.name
    notice = null
    open = false
  }

  function goToCoordinates(c: { lon: number; lat: number }) {
    clearMarker()
    const pin = new maplibregl.Marker({ color: '#c6093b' }).setLngLat([c.lon, c.lat])
    // The marker shows where to draw; clicks must pass through it to the map,
    // or placing a site exactly at the marker would do nothing.
    pin.getElement().style.pointerEvents = 'none'
    marker = pin.addTo(map)
    map.flyTo({ center: [c.lon, c.lat], zoom: 17, duration: 800 })
    const box = regionBox
    const outside = box && !inBbox(box, c.lon, c.lat)
    notice = outside
      ? 'This point is outside the H-GAC region, so there is no crash data there.'
      : 'Marked. To add a site here, choose Intersection or Roadway and draw at the marker.'
    open = false
  }

  function submit() {
    if (coords) goToCoordinates(coords)
    else if (matches.length > 0) goToPlace(matches[Math.min(highlighted, matches.length - 1)].jurisdiction)
    else if (query.trim()) notice = 'No matching city or county. Try a place name, or coordinates like 29.76, -95.37.'
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' && matches.length > 0) {
      e.preventDefault()
      open = true
      highlighted = (highlighted + 1) % matches.length
    } else if (e.key === 'ArrowUp' && matches.length > 0) {
      e.preventDefault()
      highlighted = (highlighted - 1 + matches.length) % matches.length
    } else if (e.key === 'Enter') {
      e.preventDefault()
      submit()
    } else if (e.key === 'Escape') {
      open = false
    }
  }

  function clear() {
    query = ''
    notice = null
    open = false
    clearMarker()
  }

  onDestroy(clearMarker)
</script>

<div class="absolute left-3 top-3 z-10 w-80 max-w-[calc(100%-1.5rem)]">
  <div class="flex items-center gap-2 rounded-md border bg-background px-2.5 shadow-sm">
    <Search size={14} class="shrink-0 text-muted-foreground" />
    <input
      type="search"
      class="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      placeholder="City, county, or coordinates"
      aria-label="Search the map for a city, county, or coordinates"
      role="combobox"
      aria-expanded={open && matches.length > 0}
      aria-controls="map-search-results"
      aria-autocomplete="list"
      bind:value={query}
      oninput={() => { open = true; highlighted = 0; notice = null }}
      onfocus={() => { open = true }}
      onkeydown={onKeydown}
    />
    {#if query || marker}
      <button class="rounded p-1 text-muted-foreground hover:text-foreground" aria-label="Clear search" onclick={clear}>
        <X size={14} />
      </button>
    {/if}
  </div>

  {#if open && matches.length > 0}
    <ul id="map-search-results" role="listbox" class="mt-1 overflow-hidden rounded-md border bg-background text-sm shadow-md">
      {#each matches as m, i (m.jurisdiction.type + m.jurisdiction.id)}
        <li role="option" aria-selected={i === highlighted}>
          <button
            class="flex w-full items-center justify-between px-3 py-1.5 text-left {i === highlighted ? 'bg-muted' : 'hover:bg-muted/60'}"
            onmousedown={(e) => { e.preventDefault(); goToPlace(m.jurisdiction) }}
          >
            <span>{m.jurisdiction.name}</span>
            <span class="text-xs text-muted-foreground">{m.label}</span>
          </button>
        </li>
      {/each}
    </ul>
  {:else if open && coords}
    <button
      class="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-left text-sm shadow-md hover:bg-muted/60"
      onmousedown={(e) => { e.preventDefault(); goToCoordinates(coords) }}
    >
      Go to {coords.lat.toFixed(5)}, {coords.lon.toFixed(5)}
    </button>
  {/if}

  {#if notice}
    <p class="mt-1 rounded-md border bg-background/95 px-3 py-1.5 text-xs text-muted-foreground shadow-sm" role="status">{notice}</p>
  {/if}
</div>
