<script lang="ts">
  import { untrack } from 'svelte'
  import { workbenchState } from '../state/workbenchState.svelte'
  import { siteList } from '../state/siteList.svelte'
  import X from '@lucide/svelte/icons/x'
  import Trash2 from '@lucide/svelte/icons/trash-2'
  import ChevronRight from '@lucide/svelte/icons/chevron-right'
  import CircleHelp from '@lucide/svelte/icons/circle-help'
  import * as Tooltip from '$lib/components/ui/tooltip'
  import Input from '$lib/components/ui/input/input.svelte'
  import Textarea from '$lib/components/ui/textarea/textarea.svelte'
  import CountermeasureLibrary from './CountermeasureLibrary.svelte'
  import { partCountLabel, siteBadgeLabel, siteCrashProfile, type SiteCrashProfile } from '../services/siteHelpers'
  import { calculateSiteAlternatives, resolveChosenAlternative } from '../services/sitePlan'
  import { MAX_SERVICE_LIFE } from '../services/calculateSII'
  import { projectState } from '../state/projectState.svelte'
  import { currencyMask } from '$lib/hooks/currencyMask'
  import AppraisalTable from './AppraisalTable.svelte'
  import * as Dialog from '$lib/components/ui/dialog'
  import siiFormulaImg from '../assets/sii-formula.png'

  const SECTIONS = [
    { id: 'site', step: '1', title: 'Site Information', sub: 'Identity and traffic assumptions used across all alternatives' },
    { id: 'lib', step: '2', title: 'Choose Countermeasures', sub: 'Browse the TxDOT work-code library, ranked by expected benefit at this site' },
    { id: 'alts', step: '3', title: 'Countermeasure Costs', sub: 'Enter cost, maintenance, and notes for each selected countermeasure' },
    { id: 'appraisal', step: '4', title: 'Economic Appraisal', sub: 'Benefit, cost, and B/C ratio side by side' },
  ] as const

  const CONTINUE_LABELS: Record<string, string> = {
    site: 'Continue to countermeasures',
    lib: 'Continue to your alternatives',
    alts: 'Continue to appraisal',
    appraisal: 'Finish & close',
  }

  const site = $derived(
    workbenchState.siteId
      ? siteList.get().find((s) => s.id === workbenchState.siteId) ?? null
      : null,
  )

  let crashProfile = $state<SiteCrashProfile | null>(null)

  $effect(() => {
    const s = site
    if (!s) { crashProfile = null; return }
    let cancelled = false
    siteCrashProfile(s).then((c) => { if (!cancelled) crashProfile = c })
    return () => { cancelled = true }
  })

  const computedAlts = $derived.by(() => {
    if (!site) return []
    return calculateSiteAlternatives(
      site,
      projectState.getAlternatives(site.id),
      crashProfile,
    )
  })

  // Materialize the resolved chosen alternative for the open site into
  // projectState, so the project crash-reduction bar (and later the report)
  // can read it without recomputing SII. This effect refreshes it when this
  // site's alternatives, costs, or pin change. Buffer edits use the same pure
  // calculation helpers to refresh it outside the workbench.
  //
  // The write is wrapped in untrack(): setChosen/clearChosen read chosenBySite
  // (object spread / `in` check) to merge, and dependency tracking follows the
  // call stack into them. Without untrack, this effect would subscribe to the
  // very state it writes and loop forever. We compute the value in the tracked
  // scope (so cost/pin changes still trigger re-runs) and write it untracked.
  // See docs/06-contracts.md "Chosen alternative".
  $effect(() => {
    const s = site
    if (!s) return
    const rows = computedAlts
    const chosen = resolveChosenAlternative(rows, projectState.getPin(s.id))

    untrack(() => {
      if (chosen) projectState.setChosen(s.id, chosen)
      else projectState.clearChosen(s.id)
    })
  })

  let openSections = $state<Record<string, boolean>>({ site: true })

  function toggle(id: string) {
    openSections = { ...openSections, [id]: !openSections[id] }
  }

  function scrollParent(): HTMLElement | null {
    const el = document.getElementById('wb-section-site')
    return el?.closest('[data-wb-scroll]') as HTMLElement | null
  }

  function advance(currentId: string) {
    const idx = SECTIONS.findIndex((s) => s.id === currentId)
    const nextId = SECTIONS[idx + 1]?.id

    if (!nextId) {
      workbenchState.close()
      return
    }

    openSections = { ...openSections, [currentId]: false, [nextId]: true }

    requestAnimationFrame(() => {
      const el = document.getElementById(`wb-section-${nextId}`)
      const container = scrollParent()
      const header = document.getElementById('wb-header')
      if (el && container) {
        const headerH = header?.offsetHeight ?? 0
        const elRect = el.getBoundingClientRect()
        const containerRect = container.getBoundingClientRect()
        container.scrollTo({ top: container.scrollTop + elRect.top - containerRect.top - headerH - 8, behavior: 'smooth' })
      }
    })
  }
</script>

{#if site}
  <header id="wb-header" class="sticky top-0 z-10 flex items-center gap-3 border-y bg-background px-4 py-2.5">
    <span class="rounded bg-primary px-1.5 py-0.5 text-xs font-bold text-primary-foreground">
      {siteBadgeLabel(site.type, site.parts.length)}
    </span>
    <h2 class="truncate text-sm font-semibold">{site.name}</h2>
    {#if site.parts.length > 1}
      <span class="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
        {partCountLabel(site.type, site.parts.length)}
      </span>
    {/if}
    <span class="flex-1"></span>
    <button
      class="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
      onclick={() => workbenchState.close()}
      aria-label="Close workbench"
    >
      <X size={16} />
    </button>
  </header>

  <div class="mx-auto flex w-full max-w-4xl flex-col gap-2 px-4 py-3">
    {#each SECTIONS as sec (sec.id)}
      {@const isOpen = openSections[sec.id] ?? false}
      <div
        id="wb-section-{sec.id}"
        class="rounded-lg border border-border bg-background shadow-sm"
      >
        <button
          class="flex w-full items-center gap-3 px-4 py-3 text-left"
          onclick={() => toggle(sec.id)}
        >
          <span class="grid size-6 shrink-0 place-items-center rounded-md text-xs font-bold text-background {isOpen ? 'bg-primary' : 'bg-primary/40'}">
            {sec.step}
          </span>
          <div class="min-w-0 flex-1">
            <div class="text-sm font-medium">{sec.title}</div>
            {#if !isOpen && sec.sub}
              <div class="mt-0.5 truncate text-xs text-muted-foreground">{sec.sub}</div>
            {/if}
          </div>
          <ChevronRight
            size={16}
            class="shrink-0 text-muted-foreground transition-transform duration-200 {isOpen ? 'rotate-90' : ''}"
          />
        </button>

        {#if isOpen}
          <div class="border-t px-4 py-3">
            {#if sec.sub}
              <p class="mb-3 text-xs text-muted-foreground">{sec.sub}</p>
            {/if}

            {#if sec.id === 'site'}
              <div class="flex flex-col gap-3">
                <div>
                  <label class="text-xs font-medium" for="wb-site-name">
                    Site name <span class="text-destructive">*</span>
                    <span class="font-normal text-muted-foreground">(required)</span>
                  </label>
                  <Input
                    id="wb-site-name"
                    value={site.name}
                    oninput={(e) => siteList.updateSite(site.id, { name: e.currentTarget.value })}
                    placeholder="e.g. Main St near 14th"
                    class="mt-1 h-8 text-xs"
                  />
                </div>

                <div>
                  <label class="text-xs font-medium text-muted-foreground" for="wb-site-desc">Description <span class="font-normal">(optional)</span></label>
                  <Textarea
                    id="wb-site-desc"
                    value={site.description ?? ''}
                    oninput={(e) => siteList.updateSite(site.id, { description: e.currentTarget.value })}
                    placeholder="Context, observed conditions, why this site was selected..."
                    class="mt-1 min-h-16 text-xs"
                    rows={2}
                  />
                </div>

                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <label class="text-xs font-medium text-muted-foreground" for="wb-site-owner">Road owner <span class="font-normal">(optional)</span></label>
                    <Input
                      id="wb-site-owner"
                      value={site.owner ?? ''}
                      oninput={(e) => siteList.updateSite(site.id, { owner: e.currentTarget.value })}
                      placeholder="e.g. City of Houston"
                      class="mt-1 h-8 text-xs"
                    />
                  </div>
                  <div>
                    <label class="text-xs font-medium text-muted-foreground" for="wb-site-fclass">Functional class <span class="font-normal">(optional)</span></label>
                    <Input
                      id="wb-site-fclass"
                      value={site.functionalClass ?? ''}
                      oninput={(e) => siteList.updateSite(site.id, { functionalClass: e.currentTarget.value })}
                      placeholder="e.g. Urban arterial"
                      class="mt-1 h-8 text-xs"
                    />
                  </div>
                </div>

                <div>
                  <label class="flex items-center gap-1 text-xs font-medium" for="wb-site-growth">
                    AADT growth rate <span class="text-destructive">*</span>
                    <span class="font-normal text-muted-foreground">(required)</span>
                    <span class="group relative">
                      <CircleHelp size={12} class="text-muted-foreground" />
                      <span class="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 w-48 -translate-x-1/2 rounded bg-foreground px-2 py-1.5 text-xs text-background opacity-0 shadow-md transition-opacity group-hover:opacity-100">
                        Site-level assumption applied to every alternative countermeasure's benefit projection over its service life.
                      </span>
                    </span>
                  </label>
                  <div class="mt-1 flex items-center gap-2">
                    <Input
                      id="wb-site-growth"
                      type="number"
                      step="0.1"
                      min="0"
                      value={site.growthRatePercent ?? 2}
                      oninput={(e) => {
                        const v = parseFloat(e.currentTarget.value)
                        siteList.updateSite(site.id, { growthRatePercent: isNaN(v) ? 0 : v })
                      }}
                      class="h-8 w-20 text-xs tabular-nums"
                    />
                    <span class="text-xs text-muted-foreground">% / yr</span>
                  </div>
                </div>
              </div>
            {:else if sec.id === 'lib'}
              <CountermeasureLibrary siteId={site.id} {crashProfile} />
            {:else if sec.id === 'alts'}
              {#if computedAlts.length === 0}
                <div class="text-xs text-muted-foreground italic">
                  Nothing selected yet. Add countermeasures from the library above.
                </div>
              {:else}
                <div class="flex flex-col gap-4">
                  {#each computedAlts as { alt, cmName, maintenanceRef, sii } (alt.id)}
                    <div class="rounded-lg border-2 border-border bg-background shadow-sm">
                      <div class="flex items-center gap-2 rounded-t-lg border-b bg-muted/50 px-3 py-2.5">
                        <div class="min-w-0 flex-1">
                          <div class="text-sm font-semibold">{cmName}</div>
                          <div class="text-xs text-muted-foreground">WC {alt.workcode}</div>
                        </div>
                        {#if sii}
                          <Dialog.Root>
                            <Tooltip.Provider>
                              <Tooltip.Root>
                                <Tooltip.Trigger>
                                  <Dialog.Trigger class="flex items-center gap-1 text-right cursor-help">
                                    <div>
                                      <div class="text-xs text-muted-foreground underline decoration-dotted underline-offset-2">Safety Investment Index (SII)</div>
                                      <div class="text-sm font-semibold tabular-nums {sii.SII !== null && sii.SII >= 1 ? 'text-emerald-600' : ''}">
                                        {sii.SII !== null ? sii.SII.toFixed(2) : '--'}
                                      </div>
                                    </div>
                                    <CircleHelp size={13} class="text-muted-foreground" />
                                  </Dialog.Trigger>
                                </Tooltip.Trigger>
                                <Tooltip.Content class="max-w-48 text-center">Benefit-cost ratio. Higher is better. Click to see formula.</Tooltip.Content>
                              </Tooltip.Root>
                            </Tooltip.Provider>
                            <Dialog.Content class="sm:max-w-[85vw] lg:max-w-3xl">
                              <Dialog.Header>
                                <Dialog.Title>How Safety Investment Index (SII) is Calculated</Dialog.Title>
                                <Dialog.Description>TxDOT HSIP benefit-to-cost methodology</Dialog.Description>
                              </Dialog.Header>
                              <img src={siiFormulaImg} alt="SII formula: SII = B/C where B is the present value of total benefit over service life and C is total project cost" class="w-full" />
                            </Dialog.Content>
                          </Dialog.Root>
                        {/if}
                        <Tooltip.Provider>
                          <Tooltip.Root>
                            <Tooltip.Trigger>
                              <button
                                class="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                onclick={() => projectState.removeAlternative(site.id, alt.id)}
                              >
                                <Trash2 size={14} />
                              </button>
                            </Tooltip.Trigger>
                            <Tooltip.Content>Remove alternative</Tooltip.Content>
                          </Tooltip.Root>
                        </Tooltip.Provider>
                      </div>

                      <div class="flex flex-col gap-3 p-3">
                        <div class="grid grid-cols-2 gap-3">
                          <div>
                            <label class="text-xs font-medium" for="wb-alt-cost-{alt.id}">Estimated cost</label>
                            <div class="mt-1 flex items-center gap-1">
                              <span class="text-xs text-muted-foreground">$</span>
                              <input
                                id="wb-alt-cost-{alt.id}"
                                inputmode="numeric"
                                placeholder="0"
                                data-slot="input"
                                class="dark:bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 h-8 max-w-48 rounded-md border bg-transparent px-2.5 py-1 text-right text-xs tabular-nums shadow-xs transition-[color,box-shadow] focus-visible:ring-3 placeholder:text-muted-foreground w-full min-w-0 outline-none disabled:pointer-events-none disabled:opacity-50"
                                use:currencyMask={{ value: alt.constructionCost, onAccept: (v) => projectState.updateAlternative(alt.id, { constructionCost: v }) }}
                              />
                            </div>
                          </div>

                          <div>
                            <label class="text-xs font-medium" for="wb-alt-life-{alt.id}">Service life</label>
                            <div class="mt-1 flex items-center gap-1">
                              <Input
                                id="wb-alt-life-{alt.id}"
                                type="number"
                                min="1"
                                max={MAX_SERVICE_LIFE}
                                value={alt.serviceLife}
                                oninput={(e) => {
                                  // Clamp rather than reject: type="number" lets any
                                  // digits through, and the SII present-value loop runs
                                  // once per year of service life.
                                  const v = parseInt(e.currentTarget.value)
                                  if (isNaN(v) || v < 1) return
                                  const clamped = Math.min(v, MAX_SERVICE_LIFE)
                                  if (clamped !== v) e.currentTarget.value = String(clamped)
                                  projectState.updateAlternative(alt.id, { serviceLife: clamped })
                                }}
                                class="h-8 w-16 text-xs tabular-nums"
                              />
                              <span class="text-xs text-muted-foreground">yrs</span>
                            </div>
                          </div>
                        </div>

                        <div>
                          <label class="text-xs font-medium" for="wb-alt-maint-{alt.id}">Annual maintenance</label>
                          <div class="mt-1 flex items-center gap-1">
                            <span class="text-xs text-muted-foreground">$</span>
                            <input
                              id="wb-alt-maint-{alt.id}"
                              inputmode="numeric"
                              placeholder="0"
                              data-slot="input"
                              class="dark:bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 h-8 max-w-48 rounded-md border bg-transparent px-2.5 py-1 text-right text-xs tabular-nums shadow-xs transition-[color,box-shadow] focus-visible:ring-3 placeholder:text-muted-foreground w-full min-w-0 outline-none disabled:pointer-events-none disabled:opacity-50"
                              use:currencyMask={{ value: alt.annualMaintenance, onAccept: (v) => projectState.updateAlternative(alt.id, { annualMaintenance: v }) }}
                            />
                          </div>
                          {#if maintenanceRef}
                            <div class="mt-1 text-xs text-muted-foreground">Reference maintenance cost (from HSIP Guide): <span class="font-medium">{maintenanceRef}</span></div>
                          {/if}
                        </div>

                        <div>
                          <label class="text-xs font-medium text-muted-foreground" for="wb-alt-note-{alt.id}">
                            Application note <span class="font-normal">(optional)</span>
                          </label>
                          <Textarea
                            id="wb-alt-note-{alt.id}"
                            value={alt.note ?? ''}
                            oninput={(e) => projectState.updateAlternative(alt.id, { note: e.currentTarget.value })}
                            placeholder="How it would be applied, or why it's warranted..."
                            class="mt-1 min-h-14 text-xs"
                            rows={2}
                          />
                        </div>
                      </div>
                    </div>
                  {/each}
                </div>
              {/if}
            {:else}
              <AppraisalTable siteId={site.id} rows={computedAlts.map(({ alt, cmName, crf, preventable, sii }) => ({ alt, name: cmName, crf, preventable, sii }))} />
            {/if}

            <div class="mt-4 flex justify-end border-t pt-3">
              <button
                class="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                onclick={() => advance(sec.id)}
              >
                {CONTINUE_LABELS[sec.id]}
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/if}
