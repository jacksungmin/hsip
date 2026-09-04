<!-- The non-blocking surface, per docs/07 "Error handling". Shown for failures
     that leave every figure on screen intact, e.g. an overlay the published
     data no longer contains.

     Bottom-centre over the map rather than over either side panel, so a notice
     never covers a control someone is using. -->
<script lang="ts">
  import { onDestroy } from 'svelte'
  import X from '@lucide/svelte/icons/x'
  import Copy from '@lucide/svelte/icons/copy'
  import Check from '@lucide/svelte/icons/check'
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert'
  import { errorState } from '../state/errorState.svelte'
  import { formatEnvelope } from '../services/errorReporter'

  // Which notice's copy button was last pressed, so the tick shows on that row
  // only.
  let copiedId = $state<number | null>(null)
  let copiedTimer: ReturnType<typeof setTimeout> | undefined

  onDestroy(() => clearTimeout(copiedTimer))

  async function copyDetails(id: number, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      copiedId = id
      clearTimeout(copiedTimer)
      copiedTimer = setTimeout(() => {
        if (copiedId === id) copiedId = null
      }, 2000)
    } catch {
      // No room for a fallback instruction here, and the failure is recorded.
    }
  }
</script>

{#if errorState.notices.length > 0}
  <div
    class="fixed bottom-3 left-1/2 z-50 flex w-full max-w-md -translate-x-1/2 flex-col gap-2 print:hidden"
    role="status"
    aria-live="polite"
  >
    {#each errorState.notices as notice (notice.envelope.id)}
      <div
        class="flex items-start gap-2.5 rounded-md border border-destructive/30 bg-background px-3 py-2.5 shadow-md"
      >
        <TriangleAlert size={15} class="mt-0.5 shrink-0 text-destructive" />

        <div class="min-w-0 flex-1">
          <p class="text-[13px] leading-snug text-foreground">
            {notice.envelope.advice ?? notice.envelope.message}
          </p>
          {#if notice.repeats > 1}
            <p class="mt-1 text-[10px] text-muted-foreground">{notice.repeats} times</p>
          {/if}
        </div>

        <button
          class="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
          title="Copy details"
          aria-label="Copy error details"
          onclick={() => copyDetails(notice.envelope.id, formatEnvelope(notice.envelope))}
        >
          {#if copiedId === notice.envelope.id}
            <Check size={13} />
          {:else}
            <Copy size={13} />
          {/if}
        </button>
        <button
          class="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
          title="Dismiss"
          aria-label="Dismiss notice"
          onclick={() => errorState.dismiss(notice.envelope.id)}
        >
          <X size={13} />
        </button>
      </div>
    {/each}
  </div>
{/if}
