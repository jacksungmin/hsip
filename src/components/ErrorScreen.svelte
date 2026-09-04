<!-- The blocking surface, per docs/07 "Error handling".

     Plain elements and one Button on purpose: it has to render at the moment
     the rest of the app has just failed, so it depends on no map, no data, and
     no store beyond the envelope it is handed. -->
<script lang="ts">
  import { Button } from '$lib/components/ui/button'
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert'
  import Copy from '@lucide/svelte/icons/copy'
  import Check from '@lucide/svelte/icons/check'
  import RotateCw from '@lucide/svelte/icons/rotate-cw'
  import { formatEnvelope, type ErrorEnvelope } from '../services/errorReporter'
  import { support } from '../data/appConfig'

  let { envelope }: { envelope: ErrorEnvelope } = $props()

  const details = $derived(formatEnvelope(envelope))

  let copied = $state<'idle' | 'done' | 'failed'>('idle')

  async function copyDetails() {
    try {
      await navigator.clipboard.writeText(details)
      copied = 'done'
      setTimeout(() => (copied = 'idle'), 2000)
    } catch {
      // Clipboard access can be refused (insecure origin, browser policy).
      copied = 'failed'
    }
  }
</script>

<div
  class="fixed inset-0 z-100 grid place-items-center overflow-y-auto bg-background/95 p-6"
  role="alertdialog"
  aria-modal="true"
  aria-labelledby="error-screen-heading"
>
  <div class="w-full max-w-2xl rounded-lg border bg-background p-6 shadow-lg">
    <div class="flex items-start gap-3">
      <TriangleAlert size={20} class="mt-0.5 shrink-0 text-destructive" />
      <div class="min-w-0">
        <h2 id="error-screen-heading" class="text-lg leading-snug font-semibold tracking-tight">
          The application ran into a problem and stopped
        </h2>
        <p class="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          {envelope.advice ?? `Something unexpected went wrong. Try reloading. If this keeps happening, contact support at ${support.email}.`}
        </p>
      </div>
    </div>

    <p class="mt-5 text-sm leading-relaxed">
      If you contact support, include the details below.
    </p>

    <div class="mt-3 flex flex-wrap items-center gap-2">
      <Button size="sm" onclick={copyDetails}>
        {#if copied === 'done'}
          <Check size={14} />
          Copied
        {:else}
          <Copy size={14} />
          Copy details
        {/if}
      </Button>
      <Button size="sm" variant="outline" onclick={() => location.reload()}>
        <RotateCw size={14} />
        Reload the page
      </Button>
      {#if copied === 'failed'}
        <span class="text-xs text-destructive">
          Could not reach the clipboard. Copy the text below, or send a screenshot.
        </span>
      {/if}
    </div>

    <details class="mt-4 rounded-md border" open={copied === 'failed'}>
      <summary class="cursor-pointer px-3 py-2 text-sm font-medium select-none">
        Technical details
      </summary>
      <!-- Own horizontal scroll: a long stack frame must not stretch the dialog. -->
      <pre class="max-h-72 overflow-auto border-t px-3 py-2 font-mono text-[11px] leading-relaxed">{details}</pre>
    </details>
  </div>
</div>
