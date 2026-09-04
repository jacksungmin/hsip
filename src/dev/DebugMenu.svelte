<!-- Dev-only debug menu, mounted from App behind import.meta.env.DEV so
     nothing under src/dev/ reaches the production bundle. Manual test
     harness for eyeball checks, four sections:
       1. Capture the current session as a fixture JSON (download).
       2. Load a session from a JSON file (developer-local fixtures).
       3. Helpers: one-click scenarios backed by committed fixtures in
          ./fixtures/ (e.g. report layout: load fixture, open print).
       4. Preview error messages: shows each user-facing message.
     Anything whose assertion is DOM/text/state belongs in vitest with
     the same fixtures, not here. Capture workflow: ./fixtures/README.md. -->
<script lang="ts">
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu'
  import Bug from '@lucide/svelte/icons/bug'
  import { captureAll } from '../state/sessionRegistry'
  import { dataManifest } from '../state/dataManifest.svelte'
  import { reportGeneration } from '../services/reportGenerationState.svelte'
  import { version as appVersion } from '../../package.json'
  import { isSessionFixture, loadSession } from './loadSession'
  import { reportError } from '../services/errorReporter'
  import { errorState } from '../state/errorState.svelte'
  import { support } from '../data/appConfig'
  import type { SessionFixture } from './fixture'

  type Helper = { label: string; run: () => Promise<void> }

  // One-click scenarios. Each owns its fixture import (literal path, so
  // the fixture ships with the code that uses it); adding a helper means
  // adding an entry here plus its committed fixture in ./fixtures/.
  const helpers: Helper[] = [
    {
      label: 'Report layout: load fixture + print',
      run: async () => {
        const fixture = (await import('./fixtures/report-layout.json'))
          .default as unknown as SessionFixture
        loadSession(fixture, 'report-layout')
        await reportGeneration.generateAndPrint()
      },
    },
  ]

  type ErrorPreview = { label: string; run: () => void }

  const fatals: ErrorPreview[] = [
    {
      label: 'Data unavailable',
      run: () =>
        reportError(new Error('simulated: manifest fetch failed'), {
          where: 'boot / fetch-manifest',
          fatal: true,
          advice: `The application could not load its data. Check your network connection and reload. If this keeps happening, contact support at ${support.email}.`,
        }),
    },
    {
      label: 'Browser storage',
      run: () =>
        reportError(new Error('simulated: OPFS init failed'), {
          where: 'boot / init-db',
          fatal: true,
          advice: `The application could not start its local storage. Make sure your browser is up-to-date. Chrome or Edge is recommended. If this keeps happening, contact support at ${support.email}.`,
        }),
    },
    {
      label: 'Crash data query',
      run: () =>
        reportError(new Error('simulated: worker crashed'), {
          where: 'crash database worker',
          fatal: true,
          advice: 'Something went wrong with crash data query. Try reloading.',
        }),
    },
    {
      label: 'Unexpected (generic)',
      run: () =>
        reportError(new Error('simulated: unexpected failure'), {
          where: 'unhandled error',
          fatal: true,
        }),
    },
    {
      label: 'Render error',
      run: () => (renderBoom = true),
    },
  ]

  const notices: ErrorPreview[] = [
    {
      label: 'Map layer',
      run: () =>
        reportError(new Error('simulated: tile 404'), {
          where: 'map layer "crashes"',
          fatal: false,
          advice: 'A map layer could not be loaded.',
        }),
    },
    {
      label: 'Basemap',
      run: () =>
        reportError(new Error('simulated: basemap unreachable'), {
          where: 'basemap',
          fatal: false,
          advice: 'The background map could not be loaded.',
        }),
    },
    {
      label: 'Background task',
      run: () =>
        reportError(new Error('simulated: unhandled rejection'), {
          where: 'background task',
          fatal: false,
          advice: 'Something went wrong in the background. If the problem persists, try reloading the page.',
        }),
    },
    {
      label: 'Same notice 3×',
      run: () => {
        for (let i = 0; i < 3; i++) {
          reportError(new Error('simulated repeating failure'), {
            where: 'debug menu (repeat test)',
            fatal: false,
            advice: 'Something went wrong in the background. If the problem persists, try reloading the page.',
          })
        }
      },
    },
  ]

  let renderBoom = $state(false)

  function explodeNow(): never {
    throw new Error('simulated rendering failure')
  }

  let busy = $state(false)
  let fileInput: HTMLInputElement = undefined!

  function captureSession() {
    const fixture: SessionFixture = {
      meta: {
        description: '',
        capturedAt: new Date().toISOString(),
        buildId: dataManifest.current?.buildId ?? 'unknown',
        appVersion,
      },
      snapshot: captureAll(),
    }
    const blob = new Blob([JSON.stringify(fixture, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `session-fixture-${fixture.meta.capturedAt.replace(/[:.]/g, '-')}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleFileChosen(e: Event) {
    const input = e.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    input.value = '' // so picking the same file again re-fires change
    if (!file) return
    try {
      const parsed: unknown = JSON.parse(await file.text())
      if (!isSessionFixture(parsed)) {
        console.error(`[debug] ${file.name} is not a session fixture (expected { meta, snapshot: { version, stores } })`)
        return
      }
      loadSession(parsed, file.name)
    } catch (err) {
      console.error(`[debug] failed to load ${file.name}:`, err)
    }
  }

  async function runHelper(helper: Helper) {
    busy = true
    try {
      await helper.run()
    } finally {
      busy = false
    }
  }
</script>

<div class="fixed right-3 bottom-3 z-50 print:hidden">
  <input
    bind:this={fileInput}
    type="file"
    accept=".json,application/json"
    class="hidden"
    onchange={handleFileChosen}
  />
  <DropdownMenu.Root>
    <DropdownMenu.Trigger
      class="flex size-9 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-md transition-colors hover:text-foreground"
      title="Debug menu (dev only)"
    >
      <Bug size={16} />
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="end" class="w-72">
      <DropdownMenu.Label>Debug (dev only)</DropdownMenu.Label>
      <DropdownMenu.Item onSelect={captureSession}>
        Capture session as fixture JSON
      </DropdownMenu.Item>
      <DropdownMenu.Item onSelect={() => fileInput.click()}>
        Load session from JSON…
      </DropdownMenu.Item>
      <DropdownMenu.Separator />
      <DropdownMenu.Label>Helpers</DropdownMenu.Label>
      {#each helpers as helper (helper.label)}
        <DropdownMenu.Item disabled={busy} onSelect={() => runHelper(helper)}>
          {helper.label}
        </DropdownMenu.Item>
      {/each}
      <DropdownMenu.Separator />
      <DropdownMenu.Label>Preview error messages</DropdownMenu.Label>
      <DropdownMenu.Sub>
        <DropdownMenu.SubTrigger>Fatal errors</DropdownMenu.SubTrigger>
        <DropdownMenu.SubContent>
          {#each fatals as f (f.label)}
            <DropdownMenu.Item onSelect={f.run}>{f.label}</DropdownMenu.Item>
          {/each}
        </DropdownMenu.SubContent>
      </DropdownMenu.Sub>
      <DropdownMenu.Sub>
        <DropdownMenu.SubTrigger>Notices</DropdownMenu.SubTrigger>
        <DropdownMenu.SubContent>
          {#each notices as n (n.label)}
            <DropdownMenu.Item onSelect={n.run}>{n.label}</DropdownMenu.Item>
          {/each}
        </DropdownMenu.SubContent>
      </DropdownMenu.Sub>
      <DropdownMenu.Item onSelect={() => errorState.clearNotices()}>
        Clear notices
      </DropdownMenu.Item>
    </DropdownMenu.Content>
  </DropdownMenu.Root>
</div>

{#if renderBoom}
  {@const _boom = explodeNow()}
{/if}
