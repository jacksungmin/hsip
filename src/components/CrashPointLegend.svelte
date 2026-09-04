<script lang="ts">
  import { SEVERITY_LABELS, SEVERITY_MAP_COLORS } from '../data/severityMeta'
  import type { Severity } from '../types'

  const SEVERITIES: Severity[] = ['K', 'A', 'B']
</script>

<div class="rounded-md border bg-background/95 px-3 py-2 shadow-sm backdrop-blur-sm">
  <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Crash Severity</span>
  <div class="mt-1.5 flex flex-col gap-1">
    {#each SEVERITIES as sev}
      <div class="flex items-center gap-2">
        <span
          class="inline-block size-2.5 shrink-0 rounded-full"
          style="background-color: {SEVERITY_MAP_COLORS[sev]}"
        ></span>
        <span class="text-xs text-foreground">{SEVERITY_LABELS[sev]}</span>
      </div>
    {/each}
  </div>
</div>
