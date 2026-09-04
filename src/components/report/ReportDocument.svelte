<!-- Report document rendered screen-hidden, visible only in @media print.
     Takes an assembled ReportPayload and renders the printable report.
     R4: cover, site sections, and appendices use assembled report data. -->
<script lang="ts">
  import type { ReportAssets, ReportPayload } from '../../types'
  import hgacLogo from '../../../config/assets/logo.png'
  import ReportAbout from './ReportAbout.svelte'
  import ReportCalculationAppendix from './ReportCalculationAppendix.svelte'
  import ReportCountermeasureAppendix from './ReportCountermeasureAppendix.svelte'
  import ReportMapMeta from './ReportMapMeta.svelte'
  import ReportSiteSection from './ReportSiteSection.svelte'

  let { payload, assets }: { payload: ReportPayload; assets?: ReportAssets } = $props()

  const totalCrashes = $derived(
    payload.sites.reduce((sum, s) => sum + s.crashCounts.total, 0),
  )
  const totalBySeverity = $derived(
    payload.sites.reduce(
      (acc, s) => ({
        K: acc.K + s.crashCounts.bySeverity.K,
        A: acc.A + s.crashCounts.bySeverity.A,
        B: acc.B + s.crashCounts.bySeverity.B,
      }),
      { K: 0, A: 0, B: 0 },
    ),
  )

  function formatCurrency(n: number): string {
    return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  }
</script>

<div class="report-document">
  <!-- Cover page -->
  <section class="report-cover">
    <img class="report-cover-logo" src={hgacLogo} alt="Houston-Galveston Area Council" />
    <h1 class="report-title">HSIP Sketch Planning Report</h1>

    {#if payload.projectInfo.projectName}
      <p class="report-project-name">{payload.projectInfo.projectName}</p>
    {/if}

    <table class="report-info-table">
      <tbody>
        {#if payload.projectInfo.organization}
          <tr><td class="report-label">Organization</td><td>{payload.projectInfo.organization}</td></tr>
        {/if}
        {#if payload.projectInfo.analyst}
          <tr><td class="report-label">Analyst</td><td>{payload.projectInfo.analyst}</td></tr>
        {/if}
        {#if payload.projectInfo.countyLocality}
          <tr><td class="report-label">County / Locality</td><td>{payload.projectInfo.countyLocality}</td></tr>
        {/if}
        <tr><td class="report-label">Report generated</td><td>{formatDate(payload.generatedAt)}</td></tr>
      </tbody>
    </table>

    {#if payload.projectInfo.notes}
      <p class="report-notes">{payload.projectInfo.notes}</p>
    {/if}

    <ReportAbout methods={payload.methods} />
  </section>

  <!-- Front matter: overview, summary, site list, methods (page 2 onward) -->
  <section class="report-front-matter">
    <div class="report-overview-map">
      <h2>Project Overview</h2>
      <figure>
        {#if assets?.overviewMap}
          <img
            src={assets.overviewMap.src}
            alt="Overview map of all sites included in the report"
          />
          <ReportMapMeta asset={assets.overviewMap} showSeverity={false} />
        {:else}
          <div class="report-overview-placeholder">Project overview map will be rendered here.</div>
        {/if}
      </figure>
    </div>

    <!-- Project statistics -->
    <div class="report-stats">
      <h2>Project Summary</h2>
      <p>{payload.sites.length} site{payload.sites.length === 1 ? '' : 's'} included</p>
      <table class="report-stats-table">
        <thead>
          <tr>
            <th></th>
            <th>K</th>
            <th>A</th>
            <th>B</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="report-label">KAB crashes</td>
            <td>{totalBySeverity.K}</td>
            <td>{totalBySeverity.A}</td>
            <td>{totalBySeverity.B}</td>
            <td>{totalCrashes}</td>
          </tr>
        </tbody>
      </table>
      <p class="report-footnote">
        Totals sum per-site counts. Crashes within overlapping site buffers are counted at each site.
      </p>
    </div>

    <!-- Site list -->
    <div class="report-site-list">
      <h3>Sites</h3>
      <ol>
        {#each payload.sites as block}
          <li>
            <strong>{block.site.name}</strong>
            <span class="report-site-badge">{block.site.type === 'intersection' ? 'INT' : 'RDWY'}</span>
            — {block.crashCounts.total} crashes
          </li>
        {/each}
      </ol>
    </div>

    <!-- Data & methods -->
    <div class="report-methods">
      <h3>Data &amp; Methods</h3>
      <table class="report-info-table">
        <tbody>
          <tr><td class="report-label">Crash data</td><td>{payload.methods.dataRange} ({payload.methods.dataYears} years)</td></tr>
          {#each payload.methods.crashCostTable as cost}
            <tr><td class="report-label">Crash cost ({cost.severity})</td><td>{formatCurrency(cost.dollarValue)}</td></tr>
          {/each}
          <tr><td class="report-label">Discount rate</td><td>6% (TxDOT HSIP)</td></tr>
          <tr><td class="report-label">Method</td><td>TxDOT HSIP Safety Investment Index (SII). See Appendix B.</td></tr>
        </tbody>
      </table>
    </div>
  </section>

  <!-- Per-site sections -->
  {#each payload.sites as block, i}
    <ReportSiteSection {block} index={i} {assets} />
  {/each}

  <ReportCountermeasureAppendix countermeasures={payload.countermeasures} />
  <ReportCalculationAppendix methods={payload.methods} />

  <!-- Document footer (last page only; per-page footers need Paged.js) -->
  <div class="report-doc-footer">
    <span>{payload.projectInfo.projectName || 'HSIP Sketch Planning Report'}</span>
    <span>{formatDate(payload.generatedAt)}</span>
    <span class="report-fine-print">Data: {payload.metadata.buildId} · App: {payload.metadata.appVersion}</span>
  </div>
</div>

<style>
  .report-document {
    font-family: 'Inter', system-ui, sans-serif;
    font-size: 11pt;
    line-height: 1.4;
    color: #1a1a1a;
  }

  .report-cover-logo {
    width: 1.2in;
    height: auto;
    margin-bottom: 12pt;
  }

  .report-title {
    font-size: 22pt;
    font-weight: 700;
    margin-bottom: 4pt;
  }

  .report-project-name {
    font-size: 14pt;
    color: #444;
    margin-bottom: 16pt;
  }

  .report-info-table {
    border-collapse: collapse;
    margin-bottom: 12pt;
  }
  .report-info-table td {
    padding: 2pt 12pt 2pt 0;
    vertical-align: top;
  }

  .report-label {
    font-weight: 600;
    white-space: nowrap;
    color: #555;
  }

  .report-notes {
    font-style: italic;
    color: #555;
    margin-bottom: 16pt;
  }

  .report-overview-map, .report-stats, .report-site-list, .report-methods {
    margin-top: 16pt;
  }

  /* The cover carries the title block and the About framing alone; the
     overview map and everything after it start a fresh page. */
  .report-front-matter {
    break-before: page;
  }

  .report-front-matter > :first-child {
    margin-top: 0;
  }

  /* Overview map has page 2 to itself; the summary opens page 3. */
  .report-stats {
    break-before: page;
    margin-top: 0;
  }

  .report-overview-map h2, .report-stats h2, .report-site-list h3, .report-methods h3 {
    font-size: 13pt;
    font-weight: 600;
    margin-bottom: 6pt;
    border-bottom: 1px solid #ccc;
    padding-bottom: 3pt;
  }

  .report-overview-map figure {
    margin: 0;
    break-inside: avoid;
    overflow: hidden;
    border: 0.75pt solid #bbb;
    border-radius: 3pt;
  }

  /* 5:6 matches CAPTURE_SIZES.overview in captureMaps.ts. At the 7in printed
     column this is 8.4in tall, leaving the heading and scale bar room to sit
     on the same page rather than bumping the figure to the next one. */
  .report-overview-map img,
  .report-overview-placeholder {
    display: block;
    width: 100%;
    aspect-ratio: 5 / 6;
  }

  .report-overview-map img {
    height: auto;
  }

  .report-overview-placeholder {
    display: grid;
    place-items: center;
    background: #f7f7f7;
    color: #888;
    font-size: 8pt;
    font-style: italic;
  }

  .report-stats-table {
    border-collapse: collapse;
    margin-bottom: 4pt;
  }
  .report-stats-table th, .report-stats-table td {
    padding: 3pt 10pt;
    text-align: center;
    border: 1px solid #ccc;
  }
  .report-stats-table th {
    background: #f5f5f5;
    font-weight: 600;
  }
  .report-stats-table td:first-child {
    text-align: left;
  }

  .report-footnote {
    font-size: 9pt;
    color: #777;
    font-style: italic;
  }

  .report-site-badge {
    font-size: 8pt;
    font-weight: 700;
    background: #e8e8e8;
    padding: 1pt 4pt;
    border-radius: 2pt;
    vertical-align: middle;
    margin-left: 4pt;
  }

  .report-doc-footer {
    margin-top: 24pt;
    padding-top: 6pt;
    border-top: 0.5pt solid #ddd;
    display: flex;
    justify-content: space-between;
    font-size: 8pt;
    color: #999;
  }

  .report-fine-print {
    font-size: 7pt;
    color: #bbb;
  }
</style>
