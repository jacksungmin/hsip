<script lang="ts">
  import { jurisdictionStore } from '../state/jurisdictionStore.svelte'
  import { regionState } from '../state/regionState.svelte'
  import { jurisdictionToRegion } from '../region'
  import type { Jurisdiction } from '../types'
  import { Button } from '$lib/components/ui/button'
  import * as Command from '$lib/components/ui/command'
  import * as Popover from '$lib/components/ui/popover'
  import CheckIcon from '@lucide/svelte/icons/check'
  import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down'

  type Props = {
    comparisonOverride?: string | null
  }

  let { comparisonOverride = null }: Props = $props()

  let jurisdictions = $state<Jurisdiction[]>([])
  let open = $state(false)

  jurisdictionStore
    .list()
    .then((result) => {
      jurisdictions = result
    })

  const isLoading = $derived(jurisdictionStore.isLoading.get())
  const loadError = $derived(jurisdictionStore.error.get())
  const currentRegion = $derived(regionState.get().current)
  const presentedReference = $derived(regionState.get().references[0] ?? null)

  const available = $derived(
    jurisdictions.filter((jurisdiction) =>
      jurisdictionToRegion(jurisdiction).id !== currentRegion?.id
    ),
  )
  const counties = $derived(available.filter((jurisdiction) => jurisdiction.type === 'county'))
  const cities = $derived(available.filter((jurisdiction) => jurisdiction.type === 'city'))

  function clearReferences(): void {
    for (const reference of [...regionState.get().references]) {
      regionState.removeReference(reference.id)
    }
  }

  function pick(jurisdiction: Jurisdiction): void {
    clearReferences()
    regionState.addReference(jurisdictionToRegion(jurisdiction))
    open = false
  }

  function clear(): void {
    clearReferences()
    open = false
  }
</script>

<div class="space-y-1.5">
  <div class="text-xs font-medium text-muted-foreground">Select A Peer Reference Region To Compare</div>
  <Popover.Root bind:open>
    <Popover.Trigger>
      {#snippet child({ props })}
        <Button
          {...props}
          variant="outline"
          size="sm"
          disabled={comparisonOverride !== null || isLoading || jurisdictions.length === 0}
          class="w-full justify-between font-normal"
          aria-label={comparisonOverride ?? 'Select peer reference'}
        >
          {#if comparisonOverride}
            {comparisonOverride}
          {:else if loadError}
            Could not load regions
          {:else if isLoading}
            Loading jurisdictions...
          {:else}
            {presentedReference?.name ?? 'No peer reference'}
          {/if}
          <ChevronsUpDownIcon class="opacity-50" />
        </Button>
      {/snippet}
    </Popover.Trigger>
    <Popover.Content align="start" class="w-80 p-0">
      <Command.Root class="[&_.cn-command-item-indicator]:hidden">
        <Command.Input placeholder="Search county or city..." autofocus />
        <Command.List>
          <Command.Empty>No jurisdiction found.</Command.Empty>
          <Command.Group heading="Comparison">
            <Command.Item
              value="No peer reference"
              onSelect={clear}
            >
              No peer reference
              {#if !presentedReference}
                <CheckIcon class="ml-auto" />
              {/if}
            </Command.Item>
          </Command.Group>
          <Command.Group heading="County">
            {#each counties as jurisdiction (jurisdiction.id)}
              {@const region = jurisdictionToRegion(jurisdiction)}
              <Command.Item
                value={`${jurisdiction.name} county ${jurisdiction.id}`}
                onSelect={() => pick(jurisdiction)}
              >
                {jurisdiction.name}
                {#if presentedReference?.id === region.id}
                  <CheckIcon class="ml-auto" />
                {/if}
              </Command.Item>
            {/each}
          </Command.Group>
          <Command.Group heading="City">
            {#each cities as jurisdiction (jurisdiction.id)}
              {@const region = jurisdictionToRegion(jurisdiction)}
              <Command.Item
                value={`${jurisdiction.name} city ${jurisdiction.id}`}
                onSelect={() => pick(jurisdiction)}
              >
                {jurisdiction.name}
                {#if presentedReference?.id === region.id}
                  <CheckIcon class="ml-auto" />
                {/if}
              </Command.Item>
            {/each}
          </Command.Group>
        </Command.List>
      </Command.Root>
    </Popover.Content>
  </Popover.Root>
  {#if loadError}
    <p class="text-xs text-red-600">Could not load regions</p>
  {/if}
</div>
