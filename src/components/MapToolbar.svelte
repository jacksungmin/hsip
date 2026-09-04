<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { DrawResult } from '../types'
  import type { EaFlagKey } from '../data/emphasisAreas'
  import CrashLayerControl from './CrashLayerControl.svelte'
  import CrashPointLegend from './CrashPointLegend.svelte'
  import OverlayLayerList from './OverlayLayerList.svelte'

  type Props = {
    children: Snippet<[{ onDrawComplete: (result: DrawResult) => void }]>
    onDrawComplete: (result: DrawResult) => void
    crashVisible: boolean
    crashSelectedEAs: EaFlagKey[]
  }

  let { children, onDrawComplete, crashVisible = $bindable(), crashSelectedEAs = $bindable() }: Props = $props()

</script>

<section class="relative h-full min-h-0 min-w-0 bg-muted" aria-label="Map workspace">
  {@render children({ onDrawComplete })}
  <!-- Full-height column so the overlay panel knows how much room it has to
       scroll within; pointer-events-none keeps the empty part of the column
       from swallowing map drags, and each panel opts back in. -->
  <div class="pointer-events-none absolute inset-y-3 right-3 z-10 flex flex-col items-end gap-1">
    <div class="pointer-events-auto">
      <CrashLayerControl bind:visible={crashVisible} bind:selectedEAs={crashSelectedEAs} />
    </div>
    <div class="pointer-events-auto flex min-h-0">
      <OverlayLayerList />
    </div>
  </div>
  {#if crashVisible}
    <div class="absolute bottom-3 left-3 z-10">
      <CrashPointLegend />
    </div>
  {/if}
</section>
