<!-- Appendix C: preventable crash IDs for each site's selected countermeasure.
     An HSIP application lists the crashes a proposed countermeasure is
     credited against, by severity; this is that list, from the same crashes
     and the same work-code flag the SII counted, so the IDs add up to the
     preventable K/A/B figures in the site section. -->
<script lang="ts">
  import type { ReportPayload, ReportSiteBlock, Severity } from '../../types'
  import { SEVERITY_LABELS } from '../../data/severityMeta'

  let { sites, methods }: { sites: ReportSiteBlock[]; methods: ReportPayload['methods'] } = $props()

  const SEVERITIES: Severity[] = ['K', 'A', 'B']

  const rows = $derived(
    sites.map((block) => {
      const chosen = block.alternatives.find((a) => a.isChosen) ?? null
      const ids: Record<Severity, string[]> = { K: [], A: [], B: [] }
      for (const crash of block.selectedPreventableCrashes) ids[crash.severity].push(crash.id)
      return { block, chosen, ids, total: block.selectedPreventableCrashes.length }
    }),
  )
</script>

<section class="report-appendix">
  <h2>Appendix C — Preventable Crashes by Selected Countermeasure</h2>
  <p class="report-appendix-intro">
    TxDOT CRIS crash IDs of the KAB crashes in the analysis period ({methods.analysisRange}) that each
    site's selected countermeasure is credited against, by severity. These are the crashes counted as
    preventable in that countermeasure's Safety Investment Index.
  </p>

  {#if rows.length === 0}
    <p class="report-empty">No sites with a selected countermeasure are included in this report.</p>
  {:else}
    {#each rows as row (row.block.site.id)}
      <article class="report-crash-card">
        <header>
          <h3>{row.block.site.name}</h3>
          {#if row.chosen}
            <p>
              Work code {row.chosen.countermeasure.workcode} · {row.chosen.countermeasure.name} ·
              {row.total} preventable crash{row.total === 1 ? '' : 'es'}
            </p>
          {/if}
        </header>
        {#if row.total === 0}
          <p class="report-empty report-crash-none">
            No KAB crashes at this site in {methods.analysisRange} are preventable by the selected countermeasure.
          </p>
        {:else}
          <table class="report-crash-table">
            <thead>
              <tr><th class="sev">Severity</th><th class="count">Crashes</th><th>CRIS crash IDs</th></tr>
            </thead>
            <tbody>
              {#each SEVERITIES as sev (sev)}
                <tr>
                  <td class="sev">{sev} · {SEVERITY_LABELS[sev]}</td>
                  <td class="count">{row.ids[sev].length}</td>
                  <td class="ids">{row.ids[sev].length > 0 ? row.ids[sev].join(', ') : 'None'}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </article>
    {/each}
  {/if}
</section>

<style>
  .report-appendix {
    break-before: page;
    color: #1a1a1a;
  }

  .report-appendix h2 {
    margin: 0 0 8pt;
    padding-bottom: 4pt;
    border-bottom: 1.5pt solid #333;
    font-size: 16pt;
    break-after: avoid;
  }

  .report-appendix-intro,
  .report-empty {
    margin: 0 0 10pt;
    color: #555;
    font-size: 8.5pt;
  }

  .report-appendix-intro {
    break-after: avoid;
  }

  .report-crash-card {
    border: 0.75pt solid #bbb;
    border-radius: 4pt;
    overflow: hidden;
  }

  .report-crash-card + .report-crash-card {
    margin-top: 8pt;
  }

  .report-crash-card header {
    padding: 6pt 8pt;
    background: #e9ecef;
    break-after: avoid;
  }

  .report-crash-card h3 {
    margin: 0;
    font-size: 10.5pt;
    line-height: 1.25;
  }

  .report-crash-card header p {
    margin: 2pt 0 0;
    color: #444;
    font-size: 8.5pt;
  }

  .report-crash-none {
    margin: 0;
    padding: 7pt 8pt;
  }

  .report-crash-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 8.5pt;
  }

  .report-crash-table th,
  .report-crash-table td {
    padding: 4pt 8pt;
    border-top: 0.5pt solid #ddd;
    text-align: left;
    vertical-align: top;
  }

  .report-crash-table th {
    color: #555;
    font-weight: 600;
  }

  .report-crash-table tr {
    break-inside: avoid;
  }

  .report-crash-table .sev {
    width: 26%;
    white-space: nowrap;
  }

  .report-crash-table .count {
    width: 10%;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  /* IDs wrap at the separators; tabular figures keep the list even. */
  .report-crash-table .ids {
    font-variant-numeric: tabular-nums;
    line-height: 1.5;
    word-spacing: 1pt;
  }
</style>
