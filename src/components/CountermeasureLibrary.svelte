<script lang="ts">
  import { list } from '../data/countermeasureCatalog'
  import { get as getCrashCost } from '../data/crashCostTable'
  import { projectState } from '../state/projectState.svelte'
  import type { SiteCrashProfile } from '../services/siteHelpers'
  import type { Countermeasure } from '../types'
  import Plus from '@lucide/svelte/icons/plus'
  import Check from '@lucide/svelte/icons/check'
  import CircleHelp from '@lucide/svelte/icons/circle-help'

  type Props = { siteId: string; crashProfile: SiteCrashProfile | null }
  let { siteId, crashProfile }: Props = $props()

  const allCMs = list()

  // Extract filter dimensions from catalog data
  const WORK_TYPES = [...new Set(allCMs.map((c) => c.typeOfWork))].sort()
  const EA_ALL = '0. All'
  const ALL_EAS = [...new Set(allCMs.flatMap((c) => c.emphasisAreas))].filter((ea) => ea !== EA_ALL).sort()

  // Parse subGroup "Prefix - Suffix" into sections
  type SubGroupSection = { prefix: string; suffixes: string[] }
  const SUBGROUP_SECTIONS: SubGroupSection[] = (() => {
    const map = new Map<string, Set<string>>()
    for (const cm of allCMs) {
      const dash = cm.subGroup.indexOf(' - ')
      if (dash === -1) continue
      const prefix = cm.subGroup.slice(0, dash)
      const suffix = cm.subGroup.slice(dash + 3)
      if (!map.has(prefix)) map.set(prefix, new Set())
      map.get(prefix)!.add(suffix)
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([prefix, suffixes]) => ({
        prefix,
        suffixes: [...suffixes].sort(),
      }))
  })()

  // Filter state: null means "All" (no filter applied)
  let selectedWorkTypes = $state<Set<string> | null>(null)
  let selectedEAs = $state<Set<string> | null>(null)
  // Flat subgroup selection: full "Prefix - Suffix" strings, null means All
  let selectedSubGroups = $state<Set<string> | null>(null)

  let sortBy = $state<'benefit' | 'wc'>('benefit')

  function passesFilters(cm: Countermeasure, skipSection?: string): boolean {
    if (skipSection !== 'workType' && selectedWorkTypes && !selectedWorkTypes.has(cm.typeOfWork)) return false
    if (skipSection !== 'ea' && selectedEAs && !cm.emphasisAreas.includes(EA_ALL) && !cm.emphasisAreas.some((ea) => selectedEAs!.has(ea))) return false
    if (skipSection !== 'subGroup' && selectedSubGroups && !selectedSubGroups.has(cm.subGroup)) return false

    return true
  }

  function matchesFilters(cm: Countermeasure): boolean {
    return passesFilters(cm)
  }

  function countWithout(section: string, value: string): number {
    return allCMs.filter((cm) => {
      if (!passesFilters(cm, section)) return false
      if (section === 'workType') return cm.typeOfWork === value
      if (section === 'ea') return cm.emphasisAreas.includes(value)
      if (section === 'subGroup') return cm.subGroup === value
      return false
    }).length
  }

  function toggleWorkType(val: string) {
    if (!selectedWorkTypes) {
      selectedWorkTypes = new Set([val])
    } else if (selectedWorkTypes.has(val)) {
      selectedWorkTypes.delete(val)
      selectedWorkTypes = selectedWorkTypes.size === 0 ? null : new Set(selectedWorkTypes)
    } else {
      selectedWorkTypes = new Set([...selectedWorkTypes, val])
    }
  }

  function toggleEA(val: string) {
    if (!selectedEAs) {
      selectedEAs = new Set([val])
    } else if (selectedEAs.has(val)) {
      selectedEAs.delete(val)
      selectedEAs = selectedEAs.size === 0 ? null : new Set(selectedEAs)
    } else {
      selectedEAs = new Set([...selectedEAs, val])
    }
  }

  function toggleSubGroup(val: string) {
    if (!selectedSubGroups) {
      selectedSubGroups = new Set([val])
    } else if (selectedSubGroups.has(val)) {
      selectedSubGroups.delete(val)
      selectedSubGroups = selectedSubGroups.size === 0 ? null : new Set(selectedSubGroups)
    } else {
      selectedSubGroups = new Set([...selectedSubGroups, val])
    }
  }

  function annualBenefit(cm: Countermeasure): number | null {
    if (!crashProfile || cm.reductionFactor === null) return null
    const counts = crashProfile.byWorkcode[cm.workcode]
    if (!counts) return 0
    const weighted =
      getCrashCost('K') * counts.K +
      getCrashCost('A') * counts.A +
      getCrashCost('B') * counts.B
    return (cm.reductionFactor * weighted) / crashProfile.dataYears
  }

  function formatMoney(n: number): string {
    if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(1) + 'M'
    if (n >= 1_000) return '$' + Math.round(n / 1_000) + 'k'
    return '$' + Math.round(n)
  }

  const filtered = $derived(allCMs.filter(matchesFilters))
  const sorted = $derived(
    [...filtered].sort((a, b) => {
      if (sortBy === 'wc') return a.workcode.localeCompare(b.workcode, undefined, { numeric: true })
      const ba = annualBenefit(a) ?? -1
      const bb = annualBenefit(b) ?? -1
      return bb - ba
    }),
  )

  const addedWorkcodes = $derived(projectState.getAddedWorkcodes(siteId))
</script>

<!-- Filter bar -->
<div class="flex flex-col gap-2">
  <!-- Work type -->
  <div class="flex items-baseline gap-1.5">
    <span class="w-20 shrink-0 text-xs font-medium text-muted-foreground">Work type</span>
    <div class="flex flex-wrap gap-1.5">
      <button
        class="rounded-full border px-2.5 py-0.5 text-xs transition-colors {!selectedWorkTypes ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:border-foreground/30'}"
        onclick={() => (selectedWorkTypes = null)}
      >All</button>
      {#each WORK_TYPES as wt}
        {@const count = countWithout('workType', wt)}
        <button
          class="rounded-full border px-2.5 py-0.5 text-xs transition-colors {selectedWorkTypes?.has(wt) ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:border-foreground/30'} {count === 0 ? 'opacity-30 pointer-events-none' : ''}"
          onclick={() => toggleWorkType(wt)}
          disabled={count === 0}
        >{wt}</button>
      {/each}
    </div>
  </div>

  <!-- EA -->
  <div class="flex items-baseline gap-1.5">
    <span class="group relative w-20 shrink-0 text-xs font-medium text-muted-foreground">
      EA
      <CircleHelp size={11} class="ml-0.5 inline text-muted-foreground/60" />
      <span class="pointer-events-none absolute bottom-full left-0 z-20 mb-1.5 w-40 rounded bg-foreground px-2 py-1.5 text-xs font-normal text-background opacity-0 shadow-md transition-opacity group-hover:opacity-100">
        HSIP Emphasis Areas
      </span>
    </span>
    <div class="flex flex-wrap gap-1.5">
      <button
        class="rounded-full border px-2.5 py-0.5 text-xs transition-colors {!selectedEAs ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:border-foreground/30'}"
        onclick={() => (selectedEAs = null)}
      >All</button>
      {#each ALL_EAS as ea}
        {@const label = ea.replace(/^\d+\.\s*/, '')}
        {@const count = countWithout('ea', ea)}
        <button
          class="rounded-full border px-2.5 py-0.5 text-xs transition-colors {selectedEAs?.has(ea) ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:border-foreground/30'} {count === 0 ? 'opacity-30 pointer-events-none' : ''}"
          onclick={() => toggleEA(ea)}
          disabled={count === 0}
        >{label}</button>
      {/each}
    </div>
  </div>

  <!-- SubGroup heading with global All -->
  <div class="flex items-baseline gap-1.5">
    <span class="w-24 shrink-0 text-xs font-medium text-muted-foreground">EA Subgroups</span>
    <button
      class="rounded-full border px-2.5 py-0.5 text-xs transition-colors {!selectedSubGroups ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:border-foreground/30'}"
      onclick={() => (selectedSubGroups = null)}
    >All</button>
  </div>
  {#each SUBGROUP_SECTIONS as sec}
    <div class="flex items-baseline gap-1.5 pl-5">
      <span class="w-19 shrink-0 text-xs text-muted-foreground">{sec.prefix}</span>
      <div class="flex flex-wrap gap-1.5">
        {#each sec.suffixes as suffix}
          {@const full = `${sec.prefix} - ${suffix}`}
          {@const count = countWithout('subGroup', full)}
          <button
            class="rounded-full border px-2.5 py-0.5 text-xs transition-colors {selectedSubGroups?.has(full) ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:border-foreground/30'} {count === 0 ? 'opacity-30 pointer-events-none' : ''}"
            onclick={() => toggleSubGroup(full)}
            disabled={count === 0}
          >{suffix}</button>
        {/each}
      </div>
    </div>
  {/each}
</div>

<!-- Count + sort -->
<div class="mt-3 flex items-center justify-between">
  <span class="text-xs text-muted-foreground">{filtered.length} countermeasure{filtered.length !== 1 ? 's' : ''}</span>
  <div class="flex items-center gap-1 text-xs text-muted-foreground">
    Sort
    <span class="ml-1 inline-flex overflow-hidden rounded-md border border-border">
      <button
        class="px-2 py-0.5 {sortBy === 'benefit' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}"
        onclick={() => (sortBy = 'benefit')}
      >Benefit</button>
      <button
        class="border-l border-border px-2 py-0.5 {sortBy === 'wc' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}"
        onclick={() => (sortBy = 'wc')}
      >WC #</button>
    </span>
  </div>
</div>

<!-- Library cards -->
<div class="mt-2 flex max-h-80 flex-col gap-1.5 overflow-y-auto">
  {#each sorted as cm (cm.workcode)}
    {@const added = addedWorkcodes.has(cm.workcode)}
    {@const benefit = annualBenefit(cm)}
    <div class="rounded-md border {added ? 'border-primary/20 bg-muted/50' : 'border-border'} p-3">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span class="text-xs font-medium">{cm.name}</span>
            <span class="shrink-0 text-xs text-muted-foreground">WC {cm.workcode}</span>
          </div>
          {#if cm.definition}
            <p class="mt-1 line-clamp-2 text-xs text-muted-foreground">{cm.definition}</p>
          {/if}
          <div class="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span><span class="font-medium">CRF</span> {cm.reductionFactor !== null ? Math.round(cm.reductionFactor * 100) + '%' : 'TBD'}</span>
            <span><span class="font-medium">Service Life</span> {cm.serviceLife} yr</span>
            {#if cm.facilitySubset}
              <span><span class="font-medium">Facility</span> {cm.facilitySubset}</span>
            {/if}
            <span class="ml-auto text-right"><span class="font-medium">Benefit from Crash Reduction</span> <span class="text-green-600">{benefit !== null ? '~' + formatMoney(benefit) + '/yr' : '—'}</span></span>
          </div>
          {#if cm.emphasisAreas.length > 0}
            <div class="mt-1.5 flex flex-wrap gap-1">
              {#each cm.emphasisAreas as ea}
                <span class="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {ea.replace(/^\d+\.\s*/, '')}
                </span>
              {/each}
            </div>
          {/if}
        </div>
        <button
          class="shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors {added ? 'border-primary/20 bg-primary text-primary-foreground' : 'border-border hover:border-foreground/30 hover:bg-muted'}"
          onclick={() => added ? projectState.removeByWorkcode(siteId, cm.workcode) : projectState.addAlternative(siteId, cm.workcode)}
        >
          <span class="grid [&>span]:col-start-1 [&>span]:row-start-1">
            <span class="invisible flex items-center gap-1"><Plus size={12} /> Compare as alternative</span>
            <span class="invisible flex items-center gap-1"><Plus size={12} /> Add this countermeasure</span>
            <span class="visible flex items-center justify-center gap-1">
              {#if added}
                <Check size={12} /> Added
              {:else}
                <Plus size={12} /> {addedWorkcodes.size > 0 ? 'Compare as alternative' : 'Add this countermeasure'}
              {/if}
            </span>
          </span>
        </button>
      </div>
    </div>
  {/each}
</div>
