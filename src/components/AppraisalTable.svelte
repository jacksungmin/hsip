<script lang="ts">
  import type { Alternative } from '../types'
  import { projectState } from '../state/projectState.svelte'
  import { compareBySII } from '../services/sitePlan'
  import * as Tooltip from '$lib/components/ui/tooltip'
  import Pin from '@lucide/svelte/icons/pin'

  type SIIValues = { S: number; Q: number; B: number; C: number; SII: number | null }

  type Row = {
    alt: Alternative
    name: string
    crf: number | null
    // Raw historical crash counts at the site for this countermeasure's
    // workcode. The reduction effect lives in S/Q/B, not here.
    preventable: { K: number; A: number; B: number } | null
    sii: SIIValues | null
  }

  type Props = { rows: Row[]; siteId: string }
  let { rows, siteId }: Props = $props()

  const sorted = $derived(
    [...rows].sort((a, b) => compareBySII(a.sii?.SII ?? null, b.sii?.SII ?? null)),
  )

  // Highest-SII alternative (only if SII is positive). This is the auto-pick.
  const bestId = $derived.by(() => {
    const first = sorted[0]
    return first?.sii?.SII != null && first.sii.SII > 0 ? first.alt.id : null
  })

  // The user's explicit pin, but only if that alternative still exists here.
  const userPinnedId = $derived.by(() => {
    const id = projectState.getPin(siteId)
    return id && sorted.some((r) => r.alt.id === id) ? id : null
  })

  function togglePin(altId: string) {
    if (projectState.getPin(siteId) === altId) projectState.unpin(siteId)
    else projectState.pin(siteId, altId)
  }

  function money(n: number | null | undefined): string {
    if (n == null) return '--'
    const sign = n < 0 ? '-' : ''
    const abs = Math.abs(n)
    if (abs >= 1_000_000) return sign + '$' + (abs / 1_000_000).toFixed(1) + 'M'
    if (abs >= 10_000) return sign + '$' + Math.round(abs / 1_000) + 'K'
    return sign + '$' + Math.round(abs).toLocaleString('en-US')
  }
</script>

{#if sorted.length === 0}
  <p class="text-xs text-muted-foreground italic">
    Add and cost at least one alternative to see the appraisal.
  </p>
{:else}
  <Tooltip.Provider>
  <div class="overflow-x-auto rounded-md border">
    <table class="border-collapse text-xs">
      <thead>
        <tr class="border-b bg-muted align-bottom">
          <th class="sticky left-0 z-10 min-w-56 bg-muted py-2 pl-3 pr-2 text-center font-semibold shadow-[inset_-1px_0_0_0_var(--border)]">
            Countermeasure
            <div class="text-[10px] font-normal text-muted-foreground">Pin to mark as preferred for this site</div>
          </th>
          <th class="min-w-26 px-2 py-2 text-center font-semibold">
            <Tooltip.Root>
              <Tooltip.Trigger class="cursor-help underline decoration-dotted underline-offset-2">
                Preventable
              </Tooltip.Trigger>
              <Tooltip.Content class="max-w-52">
                Number of historical crashes that are preventable by this countermeasure
              </Tooltip.Content>
            </Tooltip.Root>
            <div class="text-[10px] font-normal text-muted-foreground">K / A / B</div>
          </th>
          <th class="min-w-16 px-2 py-2 text-right font-semibold">
            CRF
            <div class="text-[10px] font-normal text-muted-foreground">Reduction Factor</div>
          </th>
          <th class="min-w-24 px-2 py-2 text-right font-semibold">
            Estimated Cost
            <div class="text-[10px] font-normal text-muted-foreground">C</div>
          </th>
          <th class="min-w-20 px-2 py-2 text-right font-semibold">
            Service Life
            <div class="text-[10px] font-normal text-muted-foreground">L · yrs</div>
          </th>
          <th class="min-w-24 px-2 py-2 text-right font-semibold">
            Maintenance Cost
            <div class="text-[10px] font-normal text-muted-foreground">M · annual</div>
          </th>
          <th class="min-w-32 px-2 py-2 text-right font-semibold">
            Savings in Crash Reduction
            <div class="text-[10px] font-normal text-muted-foreground">S · annual</div>
          </th>
          <th class="min-w-40 px-2 py-2 text-right font-semibold">
            Change in Crash Reduction Savings
            <div class="text-[10px] font-normal text-muted-foreground">Q · annual</div>
          </th>
          <th class="min-w-32 px-2 py-2 text-right font-semibold">
            Total Benefit Over Service Life
            <div class="text-[10px] font-normal text-muted-foreground">B · present value</div>
          </th>
          <th class="sticky right-0 z-10 min-w-32 bg-muted px-3 py-2 text-right font-semibold shadow-[inset_1px_0_0_0_var(--border)]">
            Safety Investment Index
            <div class="text-[10px] font-normal text-muted-foreground">SII · B / C</div>
          </th>
        </tr>
      </thead>
      <tbody>
        {#each sorted as row (row.alt.id)}
          {@const isBest = row.alt.id === bestId}
          {@const isPinned = row.alt.id === userPinnedId}
          {@const pinFill = isPinned ? 'gold' : userPinnedId === null && isBest ? 'gray' : 'hollow'}
          {@const accentColor = isPinned ? '#f59e0b' : userPinnedId === null && isBest ? '#10b981' : 'transparent'}
          {@const cellBg = isPinned ? 'bg-amber-50' : 'bg-background'}
          <tr class="border-b last:border-b-0 {isPinned ? 'bg-amber-50' : ''}">
            <td class="sticky left-0 z-10 min-w-56 py-2 pl-3 pr-2 {cellBg}" style="box-shadow: inset 2px 0 0 0 {accentColor}, inset -1px 0 0 0 var(--border);">
              <div class="flex items-center gap-1.5">
                <span class="flex w-7 shrink-0 justify-center">
                  <Tooltip.Root>
                    <Tooltip.Trigger
                      class="rounded p-1 text-muted-foreground hover:bg-muted"
                      onclick={() => togglePin(row.alt.id)}
                      aria-label="Mark countermeasure as preferred for this site"
                      aria-pressed={isPinned}
                    >
                      {#if pinFill === 'gold'}
                        <Pin size={14} class="text-amber-500" fill="currentColor" />
                      {:else if pinFill === 'gray'}
                        <Pin size={14} class="text-muted-foreground" fill="currentColor" />
                      {:else}
                        <Pin size={14} class="text-muted-foreground/40" />
                      {/if}
                    </Tooltip.Trigger>
                    <Tooltip.Content side="right">
                      Mark countermeasure as preferred for this site
                    </Tooltip.Content>
                  </Tooltip.Root>
                </span>
                <div class="min-w-0">
                  <div class="font-medium">{row.name}</div>
                  <div class="text-muted-foreground">WC {row.alt.workcode}{isBest ? ' · best' : ''}</div>
                </div>
              </div>
            </td>
            <td class="whitespace-nowrap px-2 py-2 text-center tabular-nums">
              {#if row.preventable}
                {row.preventable.K} / {row.preventable.A} / {row.preventable.B}
              {:else}
                --
              {/if}
            </td>
            <td class="whitespace-nowrap px-2 py-2 text-right tabular-nums">
              {row.crf !== null ? row.crf.toFixed(2) : '--'}
            </td>
            <td class="whitespace-nowrap px-2 py-2 text-right tabular-nums">{money(row.alt.constructionCost)}</td>
            <td class="whitespace-nowrap px-2 py-2 text-right tabular-nums">{row.alt.serviceLife}</td>
            <td class="whitespace-nowrap px-2 py-2 text-right tabular-nums">{money(row.alt.annualMaintenance)}</td>
            <td class="whitespace-nowrap px-2 py-2 text-right tabular-nums">{row.sii ? money(row.sii.S) : '--'}</td>
            <td class="whitespace-nowrap px-2 py-2 text-right tabular-nums">{row.sii ? money(row.sii.Q) : '--'}</td>
            <td class="whitespace-nowrap px-2 py-2 text-right tabular-nums">{row.sii ? money(row.sii.B) : '--'}</td>
            <td class="sticky right-0 z-10 whitespace-nowrap {cellBg} px-3 py-2 text-right font-semibold tabular-nums shadow-[inset_1px_0_0_0_var(--border)] {row.sii?.SII != null && row.sii.SII >= 1 ? 'text-emerald-600' : ''}">
              {row.sii?.SII != null ? row.sii.SII.toFixed(2) : '--'}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  </Tooltip.Provider>
{/if}
