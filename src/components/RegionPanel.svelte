<script lang="ts">
  import { regionState } from '../state/regionState.svelte'
  import { jurisdictionStore } from '../state/jurisdictionStore.svelte'
  import { drawingState } from '../state/drawingState.svelte'
  import { jurisdictionToRegion } from '../region'
  import type { Jurisdiction } from '../types'
  import { Button } from '$lib/components/ui/button'
  import * as Dialog from '$lib/components/ui/dialog'
  import * as Command from '$lib/components/ui/command'
  import * as Tabs from '$lib/components/ui/tabs'
  import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down'
  import PentagonIcon from '@lucide/svelte/icons/pentagon'

  // Async store hydration: kick off on mount, hold result in $state so
  // the template re-renders when it lands. Using $state + .then rather
  // than {#await} keeps the rest of the panel mounted while loading
  // (the trigger button stays visible, just disabled).
  let jurisdictions = $state<Jurisdiction[]>([])
  let loadError = $state<string | null>(null)
  jurisdictionStore
    .list()
    .then((js) => {
      jurisdictions = js
    })
    .catch((err) => {
      loadError = err instanceof Error ? err.message : String(err)
    })

  const isLoading = $derived(jurisdictionStore.isLoading.get())

  const counties = $derived(jurisdictions.filter((j) => j.type === 'county'))
  const cities = $derived(jurisdictions.filter((j) => j.type === 'city'))

  const selectedName = $derived(regionState.get().current?.name ?? null)

  let open = $state(false)

  function pick(j: Jurisdiction): void {
    regionState.setCurrent(jurisdictionToRegion(j))
    open = false
  }

  function startDraw(): void {
    open = false
    drawingState.setTool('region-polygon')
  }
</script>

<div class="space-y-2">
  <div class="text-xs font-medium text-muted-foreground">Current A Region As Study Area</div>
  <Dialog.Root bind:open>
    <Dialog.Trigger>
      {#snippet child({ props })}
        <Button
          {...props}
          variant="outline"
          disabled={isLoading || jurisdictions.length === 0}
          class="w-full justify-between"
        >
          {#if loadError}
            Could not load regions
          {:else if isLoading}
            Loading...
          {:else}
            {selectedName ?? 'Select region...'}
          {/if}
          <ChevronsUpDownIcon class="opacity-50" />
        </Button>
      {/snippet}
    </Dialog.Trigger>
    <Dialog.Content class="max-w-md gap-2 p-0">
      <Dialog.Header class="border-b px-4 pt-4 pb-3">
        <Dialog.Title>Select Region</Dialog.Title>
        <Dialog.Description>Scopes crash for emphasis area breakdown.</Dialog.Description>
      </Dialog.Header>
      <Tabs.Root value="jurisdiction" class="gap-0">
        <Tabs.List class="w-full rounded-none">
          <Tabs.Trigger value="jurisdiction" class="flex-1">Jurisdiction</Tabs.Trigger>
          <Tabs.Trigger value="draw" class="flex-1">Draw on map</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="jurisdiction" class="mt-0">
          <Command.Root>
            <Command.Input placeholder="Search jurisdiction..." autofocus />
            <Command.List>
              <Command.Empty>No jurisdiction found.</Command.Empty>
              <Command.Group heading="County">
                {#each counties as j (j.id)}
                  <Command.Item value={j.name} onSelect={() => pick(j)}>
                    {j.name}
                  </Command.Item>
                {/each}
              </Command.Group>
              <Command.Group heading="City">
                {#each cities as j (j.id)}
                  <Command.Item value={j.name} onSelect={() => pick(j)}>
                    {j.name}
                  </Command.Item>
                {/each}
              </Command.Group>
            </Command.List>
          </Command.Root>
        </Tabs.Content>
        <Tabs.Content value="draw" class="mt-0 p-4">
          <Button variant="outline" class="w-full gap-2" onclick={startDraw}>
            <PentagonIcon size={16} />
            Draw polygon on map
          </Button>
        </Tabs.Content>
      </Tabs.Root>
    </Dialog.Content>
  </Dialog.Root>
  {#if loadError}
    <div class="text-xs text-red-600">Could not load regions</div>
  {/if}
</div>
