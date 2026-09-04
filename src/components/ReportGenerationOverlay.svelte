<!-- Progress overlay for report generation. Reads from the shared
     reportGeneration state so any trigger (ExportDialog, debug menu)
     gets the same progress UI. Renders as a fixed centered card. -->
<script lang="ts">
  import { Progress } from 'bits-ui'
  import { reportGeneration } from '../services/reportGenerationState.svelte'
</script>

{#if reportGeneration.generating}
  <div class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 print:hidden">
    <div class="w-full max-w-sm rounded-lg border bg-background p-6 shadow-lg">
      <h3 class="text-lg font-semibold">Generating Planning Report</h3>
      <p class="mt-1 text-sm text-muted-foreground">
        {reportGeneration.progress?.message ?? 'Preparing report'}
      </p>

      <div class="mt-4 grid gap-3">
        <Progress.Root
          value={reportGeneration.progressPercent}
          max={100}
          class="bg-muted relative h-2 w-full overflow-hidden rounded-full"
        >
          <div
            class="bg-primary h-full rounded-full transition-[width] duration-300"
            class:animate-pulse={reportGeneration.progressPercent === null}
            style:width={reportGeneration.progressPercent === null ? '35%' : `${reportGeneration.progressPercent}%`}
          ></div>
        </Progress.Root>
        <div class="flex justify-between text-xs text-muted-foreground">
          <span>Please keep this tab open.</span>
          {#if reportGeneration.progress?.total}
            <span>{reportGeneration.progress.completed ?? 0} / {reportGeneration.progress.total} maps</span>
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}
