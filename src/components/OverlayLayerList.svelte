<script lang="ts">
  // The Layers panel: one row per overlay declared in config/overlays.yaml,
  // in config order, so the client controls ordering by moving YAML entries.
  //
  // Two levels of collapse. The panel folds to a single header so a long layer
  // list cannot cover the map, and each layer folds away its own legend. Each
  // layer collapses independently, so two legends can stay open for comparison.
  //
  // Legend rows come from overlayStyle.legendRows, the same function that feeds
  // the paint and the filter, so a swatch here always matches what is drawn and
  // switching a row off removes exactly that colour.
  //
  // The checkbox is the layer-level control only. A class row is a toggle
  // button instead: clicking the swatch and label switches that class, and
  // whether it is on shows in the swatch and label rather than a box.
  //
  // A switched-off layer reads as all-classes-off: every row shows dimmed and
  // greyed, and the rows are disabled. The per-class selection is still held
  // in overlayState, so switching the layer back on restores exactly the
  // classes that were on before, minus any the user had cleared.

  import { Collapsible } from 'bits-ui'
  import { Checkbox } from '$lib/components/ui/checkbox'
  import ChevronDown from '@lucide/svelte/icons/chevron-down'
  import ChevronRight from '@lucide/svelte/icons/chevron-right'
  import * as overlayConfig from '../data/overlayConfig'
  import { dataManifest } from '../state/dataManifest.svelte'
  import { overlayState } from '../state/overlayState.svelte'
  import { legendRows } from '../services/overlayStyle'

  // Derived rather than computed once, because the manifest arrives after this
  // panel mounts and decides which layers have data behind them. A layer the
  // published data no longer carries stays listed but inert: dropping the row
  // would hide a config/data mismatch, and leaving it live would give a
  // checkbox that does nothing.
  const layers = $derived(
    overlayConfig.all().map((def) => ({
      def,
      rows: legendRows(def),
      missing: dataManifest.current !== null && dataManifest.overlay(def.source) === undefined,
    })),
  )

  // Bound rather than passed as a static `open`, which bits-ui would treat as
  // a controlled value and never change.
  let panelOpen = $state(true)
  let expanded = $state<Record<string, boolean>>({})

  // Square with a small radius, and with the component's 8px vertical hit slop
  // removed: the slop would overlap the row above and below now that rows sit
  // this close together.
  const boxClass = 'size-4 rounded-[4px] after:inset-0'

  // Switching a layer on opens its legend, switching it off folds it away, so
  // the panel only spends height on layers that are actually drawing. The
  // chevron still overrides this per layer.
  function setLayerVisible(id: string, on: boolean): void {
    overlayState.setVisible(id, on)
    expanded[id] = on
  }
</script>

{#if layers.length > 0}
  <Collapsible.Root bind:open={panelOpen}>
    <div class="flex max-h-full w-64 flex-col rounded-md border bg-background shadow-sm">
      <Collapsible.Trigger
        class="flex w-full items-center gap-1.5 px-3 py-2 text-[13px] font-medium text-foreground"
      >
        {#if panelOpen}
          <ChevronDown size={14} class="text-muted-foreground" />
        {:else}
          <ChevronRight size={14} class="text-muted-foreground" />
        {/if}
        <span>Map Overlays</span>
      </Collapsible.Trigger>

      <!-- The panel is capped by its parent's height, so a long layer list
           scrolls here instead of running off the bottom of the map. min-h-0
           is what lets a flex child shrink below its content height. -->
      <Collapsible.Content class="min-h-0 overflow-y-auto">
        <div class="flex flex-col gap-2 border-t px-3 py-2.5">
          {#each layers as { def, rows, missing } (def.id)}
            {@const entry = overlayState.entry(def.id)}
            <div class="flex flex-col gap-2">
              <div class="flex items-center gap-2">
                <!-- A simple style has no classes, so it gets no expander. The
                     spacer keeps its checkbox aligned with the others. -->
                {#if rows.length > 0 && !missing}
                  <button
                    type="button"
                    class="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                    aria-label={expanded[def.id]
                      ? `Hide ${def.label} legend`
                      : `Show ${def.label} legend`}
                    aria-expanded={expanded[def.id] ?? false}
                    onclick={() => (expanded[def.id] = !expanded[def.id])}
                  >
                    {#if expanded[def.id] && !missing}
                      <ChevronDown size={14} />
                    {:else}
                      <ChevronRight size={14} />
                    {/if}
                  </button>
                {:else}
                  <span class="size-3.5 shrink-0"></span>
                {/if}

                <Checkbox
                  checked={entry.on && !missing}
                  disabled={missing}
                  onCheckedChange={(on) => setLayerVisible(def.id, on)}
                  aria-label={def.label}
                  class={boxClass}
                />
                <span
                  class="truncate text-[13px] {entry.on && !missing
                    ? 'text-foreground'
                    : 'text-muted-foreground'}"
                >
                  {def.label}
                </span>
                {#if missing}
                  <span class="shrink-0 text-[11px] text-destructive">unavailable</span>
                {/if}
              </div>

              {#if expanded[def.id] && !missing}
                <div class="flex flex-col gap-2 pl-6">
                  {#each rows as row (row.key)}
                    {@const shown = entry.on && entry.classes.includes(row.key)}
                    <!-- The row is the control: no checkbox, click the swatch
                         and label to toggle the class. A real button rather
                         than a clickable div, so Tab focus and Space/Enter
                         come from the platform, and aria-pressed is what tells
                         a screen reader the class is on. -->
                    <button
                      type="button"
                      aria-pressed={shown}
                      disabled={!entry.on}
                      onclick={() => overlayState.toggleClass(def.id, row.key)}
                      class="-mx-1 flex items-center gap-2 rounded px-1 py-0.5 text-left text-[13px]
                             enabled:cursor-pointer enabled:hover:bg-muted
                             focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      <!-- Thickness comes from a border, not a filled box: the
                           browser snaps border widths to whole device pixels,
                           where a 3px-tall background box lands on whatever
                           fraction its row happens to sit at and renders
                           thicker or thinner per row. Same fix as the
                           BreakdownView tick marks. -->
                      {#if def.draw === 'line'}
                        <span
                          class="h-0 w-7 shrink-0 border-t-[3px] {shown ? '' : 'opacity-25'}"
                          style="border-top-color:{row.color}"
                        ></span>
                      {:else}
                        <span
                          class="size-3 shrink-0 rounded-sm {shown ? '' : 'opacity-25'}"
                          style="background:{row.color}"
                        ></span>
                      {/if}
                      <span class="truncate {shown ? 'text-foreground' : 'text-muted-foreground'}">
                        {row.label}
                      </span>
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      </Collapsible.Content>
    </div>
  </Collapsible.Root>
{/if}
