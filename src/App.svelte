<script lang="ts">
  import SplashDialog from './components/SplashDialog.svelte'
  import MapView from './components/MapView.svelte'
  import CurrentRegionLayer from './components/CurrentRegionLayer.svelte'
  import CrashHeatmapLayer from './components/CrashHeatmapLayer.svelte'
  import OverlayLayer from './components/OverlayLayer.svelte'
  import DrawControl from './components/DrawControl.svelte'
  import SiteBufferLayer from './components/SiteBufferLayer.svelte'
  import MapToolbar from './components/MapToolbar.svelte'
  import RegionAnalysisPanel from './components/RegionAnalysisPanel.svelte'
  import SitePlanningPanel from './components/SitePlanningPanel.svelte'
  import SiteWorkflowPanel from './components/SiteWorkflowPanel.svelte'
  import WorkbenchPanel from './components/WorkbenchPanel.svelte'
  import { crashStore } from './state/crashStore.svelte'
  import { EA_IDS, type EaFlagKey } from './data/emphasisAreas'
  import { handleRegionDraw } from './region'
  import { drawingState } from './state/drawingState.svelte'
  import { mapInteraction } from './state/mapInteraction.svelte'
  import { loadingState, type LoadingStep } from './state/loadingState.svelte'
  import { dataManifest } from './state/dataManifest.svelte'
  import { identity, support } from './data/appConfig'
  import * as overlayConfig from './data/overlayConfig'
  import { init as initDb } from './services/db/sqliteClient'
  import { jurisdictionStore } from './state/jurisdictionStore.svelte'
  import { viewMode } from './state/viewMode.svelte'
  import { workbenchState } from './state/workbenchState.svelte'
  import CircleArrowLeft from '@lucide/svelte/icons/circle-arrow-left'
  import type { DrawResult } from './types'
  import Button from '$lib/components/ui/button/button.svelte'
  import * as Tooltip from '$lib/components/ui/tooltip'
  import hgacLogo from '../config/assets/logo.png'
  import type { Component } from 'svelte'
  import ReportGenerationOverlay from './components/ReportGenerationOverlay.svelte'
  import ErrorScreen from './components/ErrorScreen.svelte'
  import ErrorNotices from './components/ErrorNotices.svelte'
  import { errorState } from './state/errorState.svelte'
  import { reportError } from './services/errorReporter'

  // Dev-only debug menu. import.meta.env.DEV is a compile-time constant,
  // so this branch (and everything under src/dev/) is dead code the
  // production build drops entirely.
  let DebugMenu = $state<Component | null>(null)
  if (import.meta.env.DEV) {
    import('./dev/DebugMenu.svelte').then((m) => (DebugMenu = m.default))
  }

  // What to tell someone when boot fails, per step. Written for whoever is
  // looking at the screen, not for whoever will fix it: the diagnostic detail
  // is already in the copyable report.
  const BOOT_ADVICE: Record<LoadingStep, string> = {
    'fetch-manifest':
      `The application could not load its data. Check your network connection and reload. If this keeps happening, contact support at ${support.email}.`,
    'init-db':
      `The application could not start its local storage. Make sure your browser is up-to-date. Chrome or Edge is recommended. If this keeps happening, contact support at ${support.email}.`,
    'download-crashes':
      `The application could not load its data. Check your network connection and reload. If this keeps happening, contact support at ${support.email}.`,
    'load-jurisdictions':
      `The application could not load its data. Check your network connection and reload. If this keeps happening, contact support at ${support.email}.`,
    ready: `The application could not finish starting up. Try reloading. If this keeps happening, contact support at ${support.email}.`,
  }

  // The manifest names every data artifact, so it loads before
  // anything else. Jurisdictions then have no SQLite dependency, so
  // their fetch starts immediately and rides alongside the crash-db
  // download; the await at the end is usually already resolved.
  async function boot() {
    await dataManifest.load()
    loadingState.advance('init-db')

    const jurisdictionsReady = jurisdictionStore.list()

    await initDb()
    loadingState.advance('download-crashes')

    await crashStore.load({
      onDownloadProgress(loaded, total) {
        if (total) loadingState.setProgress(loaded / total)
      },
    })
    // The downloading stores record failures on their own `error` field and
    // resolve anyway. Boot has to look: a resolved load with no data opens the
    // app showing zero crashes everywhere, indistinguishable from a real answer.
    const crashError = crashStore.error.get()
    if (crashError) throw new Error(crashError)

    loadingState.advance('load-jurisdictions')

    await jurisdictionsReady
    const jurisdictionError = jurisdictionStore.error.get()
    if (jurisdictionError) throw new Error(jurisdictionError)

    loadingState.advance('ready')
  }

  boot().catch((err) =>
    reportError(err, {
      where: `boot / ${loadingState.step}`,
      fatal: true,
      advice: BOOT_ADVICE[loadingState.step],
    }),
  )

  let crashVisible = $state(false)
  let crashSelectedEAs = $state<EaFlagKey[]>([...EA_IDS])

  const mode = $derived(viewMode.get())
  $effect(() => {
    if (mode === 'diagnosis') workbenchState.close()
  })

  let drawError = $state<string | null>(null)
  let sitePanel: SiteWorkflowPanel = undefined!

  $effect(() => {
    if (drawingState.get()) {
      mapInteraction.lock()
    } else {
      // Delay unlock so the completing click event doesn't reach map layers.
      // Point draw completes on the same click that could hit a crash circle.
      const id = setTimeout(() => mapInteraction.unlock(), 0)
      return () => clearTimeout(id)
    }
  })

  function handleDrawComplete(result: DrawResult) {
    if (result.type === 'region') {
      drawError = handleRegionDraw(result.geometry)
    } else {
      sitePanel.receiveSiteGeometry(result.geometry)
    }
  }

  // Svelte boundaries catch errors thrown while drawing or inside an effect
  // they own — not event handlers or background tasks, which main.ts covers.
  function handleRenderError(error: unknown) {
    reportError(error, {
      where: 'page rendering',
      fatal: true,
      advice: 'The page stopped displaying correctly. Try reloading.',
    })
  }
</script>

<!-- Outside the boundary: it has to survive whatever the boundary just caught,
     and it is the surface that reports it. -->
{#if errorState.fatal}
  <ErrorScreen envelope={errorState.fatal} />
{/if}

<svelte:boundary onerror={handleRenderError}>
<SplashDialog />

<div class="grid h-screen grid-rows-[56px_minmax(0,1fr)] overflow-hidden bg-muted text-foreground" data-mode={mode}>
  <header class="z-10 flex items-center border-b bg-primary px-4 text-primary-foreground transition-colors duration-300">
    <div class="flex w-[clamp(300px,22vw,420px)] shrink-0 items-center gap-2.5">
      <!-- Decorative: the app name sits next to it, so alt text here would
           only make a screen reader say the same thing twice. It also avoids
           hardcoding one agency's name beside a swappable logo. -->
      <img src={hgacLogo} alt="" class="size-9 shrink-0 rounded" />
      <div class="min-w-0">
        <h1 class="text-sm leading-none font-semibold">{identity.appName}</h1>
        <p class="mt-1 text-[11px] leading-none text-primary-foreground/70">{identity.subtitle}</p>
      </div>
    </div>

    {#if mode === 'planning'}
      <Tooltip.Provider>
        <Tooltip.Root disabled={!workbenchState.siteId}>
          <Tooltip.Trigger>
            <Button
              class="gap-1.5 text-xs bg-primary-foreground/20 text-primary-foreground hover:bg-primary-foreground/30 border-transparent"
              variant="secondary"
              disabled={!!workbenchState.siteId}
              onclick={() => viewMode.set('diagnosis')}
            >
              <CircleArrowLeft size={14} />
              Go Back to Site Selection
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content>Exit Countermeasure Planning to Go Back</Tooltip.Content>
        </Tooltip.Root>
      </Tooltip.Provider>
    {/if}
  </header>

  <main class="relative grid min-h-0 grid-cols-[clamp(300px,22vw,420px)_minmax(0,1fr)_clamp(380px,28vw,520px)]">
    <aside class="flex min-h-0 flex-col overflow-hidden border-r bg-background" aria-label="Location workflow">
      <SiteWorkflowPanel bind:this={sitePanel} />
    </aside>

    <div class="flex min-h-0 min-w-0 flex-col {workbenchState.siteId ? 'overflow-y-auto' : ''}" data-wb-scroll>
      <div class="relative {workbenchState.siteId ? 'h-70 shrink-0' : 'min-h-0 flex-1'}">
        <MapToolbar onDrawComplete={handleDrawComplete} bind:crashVisible bind:crashSelectedEAs>
          {#snippet children({ onDrawComplete })}
            <MapView>
              <!-- Tile layers read artifact URLs from the manifest, so
                   they mount once it arrives (one-time gate, never
                   reverts; no tile refetch churn). -->
              {#if dataManifest.current}
                {#each overlayConfig.all() as def (def.id)}
                  <OverlayLayer {def} />
                {/each}
                <CrashHeatmapLayer visible={crashVisible} selectedEAs={crashSelectedEAs} />
              {/if}
              <CurrentRegionLayer />
              <SiteBufferLayer />
              <DrawControl {onDrawComplete} />
            </MapView>
          {/snippet}
        </MapToolbar>
        {#if drawError}
          <div class="absolute top-14 left-1/2 z-30 -translate-x-1/2 rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-xs text-red-700 shadow-sm">
            {drawError}
          </div>
        {/if}
      </div>
      {#if workbenchState.siteId}
        <WorkbenchPanel />
      {/if}
    </div>

    {#if mode === 'diagnosis'}
      <RegionAnalysisPanel />
    {:else}
      <SitePlanningPanel />
    {/if}
  </main>

  {#if DebugMenu}
    <DebugMenu />
  {/if}
  <ReportGenerationOverlay />
</div>
</svelte:boundary>

<ErrorNotices />

