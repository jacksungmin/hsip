<script lang="ts">
  import BreakdownView from './BreakdownView.svelte'
  import ReferenceRegionPicker from './ReferenceRegionPicker.svelte'
  import RegionPanel from './RegionPanel.svelte'
  import { regionState } from '../state/regionState.svelte'
  import { crashStore } from '../state/crashStore.svelte'
  import { activeSite } from '../state/activeSite.svelte'
  import { siteList } from '../state/siteList.svelte'
  import { siteBreakdownByEA } from '../services/siteHelpers'
  import { EA_LABELS } from '../data/emphasisAreas'
  import { reportError } from '../services/errorReporter'
  import type { BreakdownResult } from '../types'

  type BreakdownSeries = {
    name: string
    total: number
    counts: Record<string, number>
  }

  // Client-demo experiment. When enabled, selecting a site uses the
  // comparison-bar slot until that site is deselected. The peer choice
  // remains stored and returns automatically.
  const SHOW_ACTIVE_SITE_AS_COMPARISON = true

  const crashesLoading = $derived(crashStore.isLoading.get())
  const crashLoadError = $derived(crashStore.error.get())

  let breakdown = $state<BreakdownResult | null>(null)
  let hgacBreakdown = $state<BreakdownResult | null>(null)
  let peerBreakdown = $state<BreakdownResult | null>(null)
  let siteBreakdown = $state<BreakdownResult | null>(null)
  let peerQueryError = $state<string | null>(null)
  let siteQueryError = $state<string | null>(null)
  let queryingPeer = $state(false)
  let queryingSite = $state(false)
  let queryingBreakdown = $state(false)
  // Separate from the peer and site errors: this one is the chosen area's own
  // figures, so its failure empties the chart rather than one comparison bar.
  let breakdownError = $state<string | null>(null)

  const presentedReference = $derived(regionState.get().references[0] ?? null)
  const comparisonSite = $derived.by(() => {
    if (!SHOW_ACTIVE_SITE_AS_COMPARISON) return null
    const siteId = activeSite.get()
    return siteId ? siteList.get().find((site) => site.id === siteId) ?? null : null
  })

  $effect(() => {
    if (crashesLoading) { hgacBreakdown = null; return }
    let cancelled = false
    crashStore.countByEA(null).then((r) => { if (!cancelled) hgacBreakdown = r })
    return () => { cancelled = true }
  })

  $effect(() => {
    const region = regionState.get().current
    if (!region || crashesLoading) { breakdown = null; queryingBreakdown = false; breakdownError = null; return }

    breakdown = null
    breakdownError = null
    queryingBreakdown = true
    let cancelled = false
    crashStore.countByEA(region).then((r) => {
      if (!cancelled) { breakdown = r; queryingBreakdown = false }
    }).catch((err) => {
      if (cancelled) return
      queryingBreakdown = false
      breakdownError = reportError(err, {
        where: 'emphasis area breakdown',
        fatal: false,
        advice: 'Could not load the crash data for this area. Try selecting the area again.',
      }).advice!
    })
    return () => { cancelled = true }
  })

  $effect(() => {
    const reference = presentedReference
    if (!reference || comparisonSite || crashesLoading) {
      peerBreakdown = null
      peerQueryError = null
      queryingPeer = false
      return
    }

    peerBreakdown = null
    peerQueryError = null
    queryingPeer = true
    let cancelled = false
    crashStore.countByEA(reference).then((result) => {
      if (!cancelled) {
        peerBreakdown = result
        queryingPeer = false
      }
    }).catch((err) => {
      if (!cancelled) {
        peerQueryError = reportError(err, {
          where: 'comparison area breakdown',
          fatal: false,
          advice: 'Could not load the comparison data.',
        }).advice!
        queryingPeer = false
      }
    })
    return () => { cancelled = true }
  })

  $effect(() => {
    const site = comparisonSite
    if (!site || crashesLoading) {
      siteBreakdown = null
      siteQueryError = null
      queryingSite = false
      return
    }

    siteBreakdown = null
    siteQueryError = null
    queryingSite = true
    let cancelled = false
    siteBreakdownByEA(site).then((result) => {
      if (!cancelled) {
        siteBreakdown = result
        queryingSite = false
      }
    }).catch((err) => {
      if (!cancelled) {
        siteQueryError = reportError(err, {
          where: 'site comparison breakdown',
          fatal: false,
          advice: 'Could not load the crash data.',
        }).advice!
        queryingSite = false
      }
    })
    return () => { cancelled = true }
  })

  const currentSeries = $derived.by((): BreakdownSeries | null => {
    const region = regionState.get().current
    if (!region || !breakdown) return null
    return {
      name: region.name,
      total: breakdown.totalCrashes,
      counts: breakdown.counts,
    }
  })

  const baselineSeries = $derived.by((): BreakdownSeries | null =>
    hgacBreakdown
      ? {
          name: 'H-GAC region',
          total: hgacBreakdown.totalCrashes,
          counts: hgacBreakdown.counts,
        }
      : null
  )

  const peerSeries = $derived.by((): BreakdownSeries | null =>
    presentedReference && peerBreakdown
      ? {
          name: presentedReference.name,
          total: peerBreakdown.totalCrashes,
          counts: peerBreakdown.counts,
        }
      : null
  )

  const siteSeries = $derived.by((): BreakdownSeries | null =>
    comparisonSite && siteBreakdown
      ? {
          name: comparisonSite.name,
          total: siteBreakdown.totalCrashes,
          counts: siteBreakdown.counts,
        }
      : null
  )

  const comparisonSeries = $derived(
    comparisonSite ? siteSeries : peerSeries,
  )

  const regionBreakdownTitle = $derived.by(() => {
    const titleSeries = currentSeries ?? comparisonSeries
    return titleSeries
      ? `${titleSeries.name}: ${titleSeries.total.toLocaleString()} crashes`
      : undefined
  })
</script>

<aside class="min-h-0 overflow-auto border-l bg-background" aria-label="Region analysis">
  <section class="border-b p-4">
    <div class="mb-3 flex items-baseline justify-between gap-3">
      <h2 class="m-0 text-[13px] font-semibold">Region</h2>
    </div>
    <RegionPanel />
  </section>

  <section class="border-b p-4">
    <div class="mb-3 flex items-baseline justify-between gap-3">
      <h2 class="m-0 text-[13px] font-semibold">Crash Breakdown By Emphasis Areas</h2>
    </div>
    <div class="mb-3">
      <ReferenceRegionPicker
        comparisonOverride={comparisonSite ? `Site: ${comparisonSite.name}` : null}
      />
      {#if queryingSite}
        <p class="mt-1 text-xs text-muted-foreground">Loading site comparison...</p>
      {:else if siteQueryError}
        <p class="mt-1 text-xs text-red-600">{siteQueryError}</p>
      {:else if queryingPeer}
        <p class="mt-1 text-xs text-muted-foreground">Loading peer comparison...</p>
      {:else if peerQueryError}
        <p class="mt-1 text-xs text-red-600">{peerQueryError}</p>
      {/if}
    </div>
    {#if crashLoadError}
      <div class="rounded-md border border-dashed border-red-300 bg-red-50 p-4 text-xs text-red-700">
        <strong class="font-semibold">Could not load crash data</strong>
      </div>
    {:else if crashesLoading}
      <div class="rounded-md border border-dashed bg-muted p-4 text-xs text-muted-foreground">
        <strong class="font-semibold text-foreground">Loading crash data...</strong>
      </div>
    {:else if breakdownError}
      <div class="rounded-md border border-dashed border-red-300 bg-red-50 p-4 text-xs text-red-700">
        <strong class="font-semibold">Could not load crash breakdown for this area</strong>
      </div>
    {:else}
      <BreakdownView
        {currentSeries}
        {baselineSeries}
        peerSeries={comparisonSeries}
        labels={EA_LABELS}
        title={regionBreakdownTitle}
      />
    {/if}
  </section>
</aside>

{#if queryingBreakdown}
  <div class="fixed inset-0 z-50 grid place-items-center bg-black/30">
    <div class="flex flex-col items-center gap-3 rounded-lg bg-background px-8 py-6 shadow-lg">
      <div class="size-7 rounded-full border-3 border-muted border-t-primary animate-spin"></div>
      <span class="text-sm text-muted-foreground">Querying Crashes...</span>
    </div>
  </div>
{/if}
