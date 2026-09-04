<script lang="ts">
  import { marked } from 'marked'
  import * as Dialog from '$lib/components/ui/dialog'
  import { Button } from '$lib/components/ui/button'
  import { loadingState } from '../state/loadingState.svelte'
  import { identity } from '../data/appConfig'
  import hgacLogo from '../../config/assets/logo.png'
  import splashMarkdown from '../../config/splash.md?raw'
  import ArrowRightIcon from '@lucide/svelte/icons/arrow-right'
  import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle'
  import CheckIcon from '@lucide/svelte/icons/check'

  let open = $state(true)

  function dismiss() {
    open = false
  }

  // Same treatment as the report cover page (ReportAbout.svelte): strip the
  // file's editing-guidance comment, then render. No token substitution here —
  // nothing on the splash depends on the data, which has not loaded yet.
  const splashHtml = marked.parse(splashMarkdown.replace(/<!--[\s\S]*?-->/g, ''), {
    async: false,
  })
</script>

<Dialog.Root bind:open>
  <Dialog.Content
    showCloseButton={false}
    class="sm:max-w-xl gap-0 p-0 overflow-hidden"
    onInteractOutside={(e) => e.preventDefault()}
    onEscapeKeydown={(e) => { if (!loadingState.done) e.preventDefault() }}
  >
    <div class="border-b px-6 py-4">
      <h2 class="text-lg leading-snug font-semibold tracking-tight">
        Welcome to {identity.fullName}
      </h2>
    </div>

    <div class="px-6 pt-5 pb-4">
      <!-- overflow-hidden makes this div a block formatting context so it
           contains the floated logo; without it the float escapes the div's
           height and can overlap the workflow cards below. -->
      <div class="overflow-hidden">
        <!-- Decorative: the agency name is in the heading directly above, so
             alt text here would repeat it, and a swappable logo should not
             carry one agency's name in the markup. -->
        <img src={hgacLogo} alt="" class="float-left mr-4 mb-1 size-22 rounded" />
        <div class="splash-prose">
          {@html splashHtml}
        </div>
      </div>

      <div class="mt-5 grid grid-cols-[1fr_auto_1fr] items-stretch gap-3">
        <div class="flex items-start gap-3 rounded-lg border p-3">
          <span class="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-primary">01</span>
          <div class="min-w-0">
            <div class="text-sm font-semibold">Diagnose</div>
            <div class="mt-0.5 text-xs text-muted-foreground leading-snug">
              Select candidate sites, review crash history and breakdown.
            </div>
          </div>
        </div>

        <div class="grid place-items-center text-muted-foreground/50">
          <ArrowRightIcon size={14} />
        </div>

        <div class="flex items-start gap-3 rounded-lg border p-3">
          <span class="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-primary">02</span>
          <div class="min-w-0">
            <div class="text-sm font-semibold">Plan</div>
            <div class="mt-0.5 text-xs text-muted-foreground leading-snug">
              Compare potential improvement alternatives, export countermeasure report.
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="border-t bg-muted/30 px-6 py-4">
      <div class="mb-2 flex items-center gap-2">
        {#if loadingState.done}
          <CheckIcon size={14} class="text-primary" />
        {:else}
          <LoaderCircleIcon size={14} class="animate-spin text-muted-foreground" />
        {/if}
        <span class="text-sm text-muted-foreground">{loadingState.label}</span>
      </div>

      <div class="h-1.5 overflow-hidden rounded-full bg-border">
        <div
          class="h-full rounded-full transition-[width] duration-150 ease-linear {loadingState.done ? 'bg-primary' : 'bg-primary/70'}"
          style:width="{(loadingState.overall * 100).toFixed(1)}%"
        ></div>
      </div>

      <div class="mt-2 flex items-center justify-between">
        <span class="font-mono text-xs text-muted-foreground tabular-nums">
          {Math.round(loadingState.overall * 100)}%
        </span>

        {#if loadingState.done}
          <Button size="sm" onclick={dismiss}>
            Enter workspace
            <ArrowRightIcon size={14} />
          </Button>
        {/if}
      </div>
    </div>
  </Dialog.Content>
</Dialog.Root>

<style>
  /* The prose is injected as raw HTML at runtime, so Svelte's compiler never
     sees those <p> and <strong> elements and cannot add its scoping class to
     them. :global() opts these rules out of scoping; the .splash-prose prefix
     keeps them from leaking to the rest of the dialog.

     This replaces per-paragraph utility classes that could not survive the
     move to markdown, and reproduces what they did: the opening paragraph at
     full contrast, later ones muted, and bold text pulled back to full
     contrast so the two phase names stand out of the muted paragraph. */
  .splash-prose :global(p) {
    font-size: 0.875rem;
    line-height: 1.625;
    color: var(--muted-foreground);
  }

  .splash-prose :global(p:first-child) {
    color: var(--foreground);
  }

  .splash-prose :global(p + p) {
    margin-top: 0.75rem;
  }

  .splash-prose :global(strong) {
    font-weight: 600;
    color: var(--foreground);
  }

  .splash-prose :global(a) {
    color: var(--primary);
    text-decoration: underline;
  }
</style>
