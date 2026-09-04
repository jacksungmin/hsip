<script lang="ts">
  import { activeSite } from '../state/activeSite.svelte'
  import { siteList } from '../state/siteList.svelte'
  import { crashStore } from '../state/crashStore.svelte'
  import { EA_LABELS, EA_IDS } from '../data/emphasisAreas'
  import { SEVERITY_LABELS, SEVERITY_COLORS, SEVERITY_HEAT_RGBA } from '../data/severityMeta'
  import { projectState } from '../state/projectState.svelte'
  import { calculateSiteAlternatives, compareBySII, type ComputedAlternative } from '../services/sitePlan'
  import { bufferRange, querySiteCrashes, siteBadgeLabel, siteCrashProfile, type SiteCrashProfile } from '../services/siteHelpers'
  import Pin from '@lucide/svelte/icons/pin'
  import * as ToggleGroup from '$lib/components/ui/toggle-group'
  import * as Tooltip from '$lib/components/ui/tooltip'
  import type { Severity } from '../types'

  const SEVS: Severity[] = ['K', 'A', 'B']

  let severityCounts = $state<Record<Severity, number> | null>(null)
  let eaSevCounts = $state<Record<string, Record<Severity, number>> | null>(null)
  let totalCrashes = $state(0)

  const activeId = $derived(activeSite.get())
  const site = $derived(activeId ? siteList.get().find((s) => s.id === activeId) ?? null : null)

  $effect(() => {
    if (!site || crashStore.isLoading.get()) {
      severityCounts = null
      eaSevCounts = null
      totalCrashes = 0
      return
    }

    let cancelled = false
    querySiteCrashes(site).then((crashes) => {
      if (cancelled) return
      const sev: Record<string, number> = { K: 0, A: 0, B: 0 }
      const eaSev: Record<string, Record<string, number>> = {}
      for (const eaId of EA_IDS) eaSev[eaId] = { K: 0, A: 0, B: 0 }
      for (const c of crashes) {
        sev[c.severity] = (sev[c.severity] ?? 0) + 1
        for (const eaId of EA_IDS) {
          if ((c as Record<string, unknown>)[eaId] === 1) {
            eaSev[eaId][c.severity] = (eaSev[eaId][c.severity] ?? 0) + 1
          }
        }
      }
      severityCounts = sev as Record<Severity, number>
      eaSevCounts = eaSev as Record<string, Record<Severity, number>>
      totalCrashes = crashes.length
    })
    return () => { cancelled = true }
  })

  // Heatmap rows: EAs with at least one crash, sorted by row total descending
  const heatRows = $derived.by(() => {
    if (!eaSevCounts) return []
    return EA_IDS
      .map((eaId) => {
        const cells = eaSevCounts![eaId]
        const rowTotal = SEVS.reduce((sum, s) => sum + (cells[s] ?? 0), 0)
        return { eaId, cells, rowTotal }
      })
      .filter((r) => r.rowTotal > 0)
      .sort((a, b) => b.rowTotal - a.rowTotal)
  })

  const colMax = $derived.by(() => {
    const m: Record<string, number> = { Σ: 1 }
    for (const s of SEVS) m[s] = 1
    for (const r of heatRows) {
      for (const s of SEVS) m[s] = Math.max(m[s], r.cells[s] ?? 0)
      m['Σ'] = Math.max(m['Σ'], r.rowTotal)
    }
    return m
  })

  function heatBg(count: number, sev: Severity | 'Σ'): string {
    const intensity = Math.min(1, count / colMax[sev])
    const base = sev === 'Σ'
      ? SEVERITY_HEAT_RGBA.B
      : (SEVERITY_HEAT_RGBA[sev] ?? SEVERITY_HEAT_RGBA.B)
    if (sev === 'K') return `${base}${(0.05 + intensity * 0.60).toFixed(2)})`
    if (sev === 'A') return `${base}${(0.04 + intensity * 0.54).toFixed(2)})`
    return `${base}${(0.03 + intensity * 0.43).toFixed(2)})`
  }

  let crashProfile = $state<SiteCrashProfile | null>(null)

  $effect(() => {
    const s = site
    if (!s) { crashProfile = null; return }
    let cancelled = false
    siteCrashProfile(s).then((p) => { if (!cancelled) crashProfile = p })
    return () => { cancelled = true }
  })

  // Read-only summary scoreboard (right panel). The full appraisal table
  // lives in the workbench center panel; here we show a compact ranked
  // list with bars, matching the design ref WBSummary. Both read the same
  // evaluation service, so the scoreboard and the table cannot disagree.
  let rankBy = $state<'bc' | 'benefit'>('bc')

  function setRankBy(value: string): void {
    if (value === 'bc' || value === 'benefit') rankBy = value
  }

  const scored = $derived(
    site ? calculateSiteAlternatives(site, projectState.getAlternatives(site.id), crashProfile) : [],
  )

  // null means "not rankable" (no computable SII), which sorts last.
  function rankValue(s: ComputedAlternative): number | null {
    if (!s.sii) return null
    return rankBy === 'bc' ? s.sii.SII : s.sii.B
  }

  const chosenAlt = $derived(site ? projectState.getChosen(site.id) : null)

  const ranked = $derived([...scored].sort((a, b) => compareBySII(rankValue(a), rankValue(b))))

  const rankMax = $derived(
    Math.max(0.0001, ...ranked.map((s) => Math.max(0, rankValue(s) ?? 0))),
  )

  function barWidth(s: ComputedAlternative): number {
    const v = rankValue(s)
    if (v === null || v <= 0) return 0
    return Math.min(100, (v / rankMax) * 100)
  }

  function rankDisplay(s: ComputedAlternative): string {
    if (!s.sii) return '--'
    if (rankBy === 'bc') return s.sii.SII != null ? s.sii.SII.toFixed(2) : '--'
    return money(s.sii.B)
  }

  function money(n: number): string {
    const abs = Math.abs(n)
    if (abs >= 1_000_000) return '$' + (n / 1_000_000).toFixed(1) + 'M'
    if (abs >= 10_000) return '$' + Math.round(n / 1_000) + 'K'
    return '$' + Math.round(n).toLocaleString('en-US')
  }

</script>

<aside class="min-h-0 overflow-auto border-l bg-background" aria-label="Site planning">
  {#if !site}
    <div class="flex h-full items-center justify-center p-6">
      <div class="text-center text-sm text-muted-foreground">
        Select a site to see crash details
      </div>
    </div>
  {:else}
    <section class="border-b p-4">
      <div class="flex items-center gap-2">
        <span class="rounded bg-primary px-1.5 py-0.5 text-xs font-bold text-primary-foreground">
          {siteBadgeLabel(site.type, site.parts.length)}
        </span>
        <h2 class="text-sm font-semibold">{site.name}</h2>
      </div>
      <p class="mt-1 text-xs text-muted-foreground">
        {site.crashIds.length} crashes in buffer · {bufferRange(site)} ft
      </p>
    </section>

    <section class="border-b p-4">
      <h3 class="mb-3 text-sm font-semibold">
        Crash history <span class="font-normal text-muted-foreground">{totalCrashes} total</span>
      </h3>
      {#if severityCounts}
        <div class="flex gap-3">
          {#each SEVS as sev}
            {@const count = severityCounts[sev] ?? 0}
            <div class="flex-1 rounded-md border border-border p-2 text-center">
              <div class="text-xl font-semibold tabular-nums" style="color:{SEVERITY_COLORS[sev]}">{count}</div>
              <div class="text-xs text-muted-foreground">{SEVERITY_LABELS[sev]}</div>
            </div>
          {/each}
        </div>
      {:else}
        <div class="text-xs text-muted-foreground">Loading...</div>
      {/if}
    </section>

    <section class="border-b p-4">
      {#if eaSevCounts && heatRows.length > 0}
        <div class="overflow-x-auto">
          <table class="w-full border-collapse text-xs">
            <thead>
              <tr>
                <th class="pb-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Emphasis area</th>
                {#each SEVS as sev}
                  <th class="w-12 pb-2 text-center text-xs font-semibold text-muted-foreground">
                    <span class="mr-0.5 inline-block size-2 rounded-sm" style="background:{SEVERITY_COLORS[sev]}"></span>{sev}
                  </th>
                {/each}
                <th class="w-12 pb-2 text-center text-xs font-semibold text-muted-foreground">Σ</th>
              </tr>
            </thead>
            <tbody>
              {#each heatRows as { eaId, cells, rowTotal }}
                <tr>
                  <td class="max-w-36 py-1 pr-2">
                    <Tooltip.Provider >
                      <Tooltip.Root >
                        <Tooltip.Trigger class="block max-w-full truncate text-left">{EA_LABELS[eaId]}</Tooltip.Trigger>
                        <Tooltip.Content>{EA_LABELS[eaId]}</Tooltip.Content>
                      </Tooltip.Root>
                    </Tooltip.Provider>
                  </td>
                  {#each SEVS as sev}
                    {@const count = cells[sev] ?? 0}
                    <td class="py-1 text-center tabular-nums" style="background:{heatBg(count, sev)}">{count}</td>
                  {/each}
                  <td class="py-1 text-center font-medium tabular-nums" style="background:{heatBg(rowTotal, 'Σ')}">{rowTotal}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <p class="mt-2 text-xs leading-snug text-muted-foreground">A crash can appear in multiple emphasis areas. Column totals may exceed the crash count above.</p>
      {:else if eaSevCounts}
        <div class="text-xs text-muted-foreground">No emphasis area crashes at this site</div>
      {:else}
        <div class="text-xs text-muted-foreground">Loading...</div>
      {/if}
    </section>

    <section class="p-4">
      <h3 class="text-sm font-semibold">
        Countermeasure alternatives
        {#if scored.length > 0}
          <span class="ml-1 font-normal text-muted-foreground">{scored.length}</span>
        {/if}
      </h3>

      {#if scored.length === 0}
        <div class="mt-3 text-xs text-muted-foreground">
          No alternatives yet. Plan improvements for this site to choose countermeasures and enter costs.
        </div>
      {:else}
        <div class="mt-2 flex items-center justify-end gap-2 text-xs">
          <span class="text-muted-foreground">Rank by</span>
          <ToggleGroup.Root
            type="single"
            value={rankBy}
            onValueChange={setRankBy}
            variant="outline"
            size="sm"
          >
            <ToggleGroup.Item
              value="bc"
              class="h-6 px-2 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
            >
              B/C Ratio
            </ToggleGroup.Item>
            <ToggleGroup.Item
              value="benefit"
              class="h-6 px-2 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
            >
              Lifetime Benefit
            </ToggleGroup.Item>
          </ToggleGroup.Root>
        </div>

        <div class="mt-3 flex flex-col gap-2">
          {#each ranked as s, i (s.alt.id)}
            {@const isChosen = chosenAlt?.altId === s.alt.id}
            <div class="rounded-md border p-2 {isChosen ? 'border-emerald-500/60 bg-emerald-50/50' : 'border-border'}">
              <div class="flex items-center gap-2">
                <span class="grid size-5 shrink-0 place-items-center rounded bg-muted text-xs font-semibold tabular-nums">{i + 1}</span>
                <span class="min-w-0 flex-1 truncate text-left text-xs font-medium">{s.cmName}</span>
                {#if isChosen}
                  <span class="flex shrink-0 items-center gap-1 text-xs font-medium {chosenAlt?.source === 'explicit' ? 'text-amber-600' : 'text-emerald-600'}">
                    <Pin size={11} class={chosenAlt?.source === 'explicit' ? 'text-amber-500' : 'text-emerald-500'} fill="currentColor" />
                    Selected
                  </span>
                {/if}
                <span class="shrink-0 text-xs font-semibold tabular-nums">{rankDisplay(s)}</span>
              </div>
              <div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  class="h-full rounded-full {isChosen ? 'bg-emerald-500' : 'bg-foreground/70'}"
                  style="width:{barWidth(s)}%"
                ></div>
              </div>
            </div>
          {/each}
        </div>
        <p class="mt-2 text-xs leading-snug text-muted-foreground">
          Open Plan improvements for the full benefit/cost appraisal.
        </p>
      {/if}
    </section>
  {/if}
</aside>
