<!-- One printable site section. Pure presentation over ReportSiteBlock. -->
<script lang="ts">
  import turfLength from '@turf/length'
  import type { LineString } from 'geojson'
  import { EA_IDS, EA_LABELS } from '../../data/emphasisAreas'
  import type { ReportAssets, ReportSiteBlock, Severity, SeverityTriplet } from '../../types'
  import { compareBySII } from '../../services/sitePlan'
  import ReportMapMeta from './ReportMapMeta.svelte'

  let {
    block,
    index,
    assets,
  }: {
    block: ReportSiteBlock
    index: number
    assets?: ReportAssets
  } = $props()

  const SEVERITIES: Severity[] = ['K', 'A', 'B']
  const effectiveGrowthRate = $derived(block.site.growthRatePercent ?? 2)
  const siteMap = $derived(assets?.siteMaps[block.site.id])

  const eaRows = $derived.by(() =>
    EA_IDS
      .map((eaId) => {
        const counts = block.crashCounts.byEmphasisArea[eaId] ?? { K: 0, A: 0, B: 0 }
        const total = counts.K + counts.A + counts.B
        return { eaId, counts, total }
      })
      .filter((row) => row.total > 0)
      .sort((a, b) => b.total - a.total),
  )

  const columnMax = $derived.by(() => {
    const max = { K: 1, A: 1, B: 1, total: 1 }
    for (const row of eaRows) {
      for (const severity of SEVERITIES) {
        max[severity] = Math.max(max[severity], row.counts[severity])
      }
      max.total = Math.max(max.total, row.total)
    }
    return max
  })

  const sortedAlternatives = $derived(
    [...block.alternatives].sort((a, b) => compareBySII(a.SII, b.SII)),
  )

  const bufferText = $derived.by(() => {
    const values = block.site.parts.map((part) => part.bufferFeet)
    const min = Math.min(...values)
    const max = Math.max(...values)
    return min === max ? `${min}` : `${min}–${max}`
  })

  const roadwayMiles = $derived.by(() => {
    if (block.site.type !== 'roadway') return null
    return block.site.parts.reduce(
      (sum, part) => sum + turfLength(
        {
          type: 'Feature',
          geometry: part.drawnGeometry as LineString,
          properties: {},
        },
        { units: 'miles' },
      ),
      0,
    )
  })

  const siteSummary = $derived.by(() => {
    const counts = block.crashCounts.bySeverity
    const crashSummary = `${block.crashCounts.total} KAB crashes (${counts.K + counts.A} K+A)`
    const partCount = block.site.parts.length

    if (block.site.type === 'roadway') {
      const length = roadwayMiles === null
        ? ''
        : roadwayMiles < 0.01 ? '<0.01 mi' : `${roadwayMiles.toFixed(2)} mi`
      const extent = partCount === 1
        ? length
        : `${partCount} segments · ${length} total`
      return `${crashSummary} · ${extent} · ${bufferText} ft buffer`
    }

    const extent = partCount === 1
      ? `${bufferText} ft radius`
      : `${partCount} intersections · ${bufferText} ft buffers`
    return `${crashSummary} · ${extent}`
  })

  const siteBadge = $derived(
    `${block.site.type === 'intersection' ? 'INTERSECTION' : 'ROADWAY'}${block.site.parts.length > 1 ? ' GROUP' : ''}`,
  )

  const partMapRows = $derived.by(() => {
    const partsPerRow = block.site.type === 'intersection' ? 2 : 1
    const indexedParts = block.site.parts.map((part, partIndex) => ({ part, partIndex }))
    return Array.from(
      { length: Math.ceil(indexedParts.length / partsPerRow) },
      (_, rowIndex) => indexedParts.slice(
        rowIndex * partsPerRow,
        (rowIndex + 1) * partsPerRow,
      ),
    )
  })

  function heatBackground(count: number, max: number): string {
    if (count === 0) return '#ffffff'
    const intensity = Math.min(1, count / max)
    return `hsl(0 0% ${(97 - intensity * 27).toFixed(1)}%)`
  }

  function formatCurrency(value: number | null | undefined): string {
    if (value == null) return '--'
    return value.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    })
  }

  function formatReduction(counts: SeverityTriplet): string {
    return SEVERITIES
      .map((severity) => counts[severity].toLocaleString('en-US', { maximumFractionDigits: 2 }))
      .join(' / ')
  }

  function formatSII(value: number | null): string {
    return value == null ? '--' : value.toFixed(2)
  }
</script>

<section class="report-site-section">
  <header class="report-site-header">
    <div class="report-site-heading">
      <h2>Site {index + 1}: {block.site.name}</h2>
      <span class="report-type-badge">{siteBadge}</span>
    </div>
    {#if block.site.description?.trim()}
      <p class="report-site-description">{block.site.description}</p>
    {/if}
    <p class="report-site-summary">{siteSummary}</p>

    <div class="report-site-metadata">
      {#if block.site.owner?.trim()}
        <span><strong>Road owner:</strong> {block.site.owner}</span>
      {/if}
      {#if block.site.functionalClass?.trim()}
        <span><strong>Functional class:</strong> {block.site.functionalClass}</span>
      {/if}
      <span><strong>Traffic growth:</strong> {effectiveGrowthRate}% annually</span>
    </div>

    {#if block.site.parts.length > 1}
      <p class="report-parts"><strong>Parts:</strong> {block.site.parts.map((part) => part.name).join(', ')}</p>
    {/if}
  </header>

  <figure
    class="report-map-placeholder report-site-map-placeholder"
    class:report-map-rendered={siteMap !== undefined}
    data-report-map="site"
    data-site-id={block.site.id}
  >
    {#if siteMap}
      <img
        class="report-site-map-image"
        src={siteMap.src}
        alt={`Map of ${block.site.name} and its KAB crashes`}
      />
      <ReportMapMeta asset={siteMap} />
    {:else}
      <div class="report-site-map-empty">Site map will be rendered here.</div>
    {/if}
  </figure>

  <section class="report-site-block">
    <h3>Crash History by Emphasis Area</h3>
    {#if eaRows.length === 0}
      <p class="report-empty">No emphasis-area-tagged crashes at this site.</p>
    {:else}
      <table class="report-ea-table">
        <thead>
          <tr>
            <th>Emphasis area</th>
            {#each SEVERITIES as severity}
              <th>{severity}</th>
            {/each}
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {#each eaRows as row}
            <tr>
              <td>{EA_LABELS[row.eaId]}</td>
              {#each SEVERITIES as severity}
                <td style:background-color={heatBackground(row.counts[severity], columnMax[severity])}>
                  {row.counts[severity]}
                </td>
              {/each}
              <td
                class="report-total-cell"
                style:background-color={heatBackground(row.total, columnMax.total)}
              >
                {row.total}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
      <p class="report-table-note">
        A crash can appear in multiple emphasis areas. Column totals may exceed the site crash count.
      </p>
    {/if}
  </section>

  <section class="report-site-block report-alternatives-block">
    <h3>Countermeasure Alternatives</h3>
    {#if sortedAlternatives.length === 0}
      <p class="report-empty">No reportable alternatives for this site.</p>
    {:else}
      <p class="report-section-caption">Ranked by Safety Investment Index (SII), highest first.</p>
      <div class="report-alternative-list">
        {#each sortedAlternatives as row, rank (row.alternative.id)}
          <article class="report-alternative-card" class:report-selected-card={row.isChosen}>
            <div class="report-alternative-main">
              <div class="report-alt-heading">
                <span class="report-alt-rank">{rank + 1}</span>
                <div class="report-alt-title">
                  <strong>{row.countermeasure.name}</strong>
                  {#if row.isChosen}<span class="report-selected-badge">Selected</span>{/if}
                  <span class="report-alt-workcode">Work code {row.countermeasure.workcode}</span>
                </div>
              </div>

              <div class="report-alt-metrics">
                <div class="report-alt-metric">
                  <span>Reduced K/A/B</span>
                  <strong>{row.countermeasure.reductionFactor === null ? '--' : formatReduction(row.expectedReduction)}</strong>
                </div>
                <div class="report-alt-metric">
                  <span>Construction cost</span>
                  <strong>{formatCurrency(row.alternative.constructionCost)}</strong>
                </div>
                <div class="report-alt-metric">
                  <span>Annual savings</span>
                  <strong>{row.countermeasure.reductionFactor === null ? '--' : formatCurrency(row.S)}</strong>
                </div>
                <div class="report-alt-metric">
                  <span>Lifetime benefit</span>
                  <strong>{row.countermeasure.reductionFactor === null ? '--' : formatCurrency(row.B)}</strong>
                </div>
                <div class="report-alt-metric">
                  <span>Service life</span>
                  <strong>{row.alternative.serviceLife} yrs</strong>
                </div>
              </div>

              <div class="report-alt-details">
                <span><strong>CRF</strong> {row.countermeasure.reductionFactor?.toFixed(2) ?? '--'}</span>
                <span><strong>Annual maintenance</strong> {formatCurrency(row.alternative.annualMaintenance)}</span>
                <span><strong>Growth adjustment (Q)</strong> {row.countermeasure.reductionFactor === null ? '--' : formatCurrency(row.Q)}</span>
              </div>

              {#if row.alternative.note?.trim()}
                <div class="report-alt-note">
                  <strong>Application note</strong>
                  <span>{row.alternative.note}</span>
                </div>
              {/if}
            </div>

            <div class="report-sii-panel">
              <strong>{formatSII(row.SII)}</strong>
              <span>SII · B / C</span>
            </div>
          </article>
        {/each}
      </div>
    {/if}
  </section>

  {#if block.site.parts.length > 1}
    <section class="report-site-block report-part-maps-block">
      <h3>Site Part Maps</h3>
      <p class="report-section-caption">
        Each map is framed to the individual site part.
      </p>
      <div class="report-part-map-list">
        {#each partMapRows as row}
          <div
            class="report-part-map-row"
            class:report-roadway-part-map-row={block.site.type === 'roadway'}
          >
            {#each row as { part, partIndex } (part.id)}
              {@const partMap = assets?.partMaps[block.site.id]?.[part.id]}
              <figure
                class="report-part-map"
                class:report-roadway-part-map={block.site.type === 'roadway'}
                data-report-map="site-part"
                data-site-id={block.site.id}
                data-part-id={part.id}
              >
                <figcaption>
                  <strong>Part {partIndex + 1}: {part.name}</strong>
                  <span>{part.crashes.length} KAB crashes · {part.bufferFeet} ft buffer</span>
                </figcaption>
                {#if partMap}
                  <img
                    class="report-part-map-image"
                    src={partMap.src}
                    alt={`Map of ${part.name} and its KAB crashes`}
                  />
                  <ReportMapMeta asset={partMap} />
                {:else}
                  <div class="report-part-map-placeholder">
                    Part map will be rendered here.
                  </div>
                {/if}
              </figure>
            {/each}
          </div>
        {/each}
      </div>
    </section>
  {/if}
</section>

<style>
  .report-site-section {
    break-before: page;
    color: #1a1a1a;
  }

  .report-site-header {
    border-bottom: 1.5pt solid #333;
    padding-bottom: 8pt;
  }

  .report-site-heading {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12pt;
  }

  .report-site-heading h2 {
    margin: 0;
    font-size: 16pt;
    line-height: 1.2;
  }

  .report-type-badge {
    flex: none;
    border: 0.75pt solid #777;
    border-radius: 2pt;
    padding: 1.5pt 5pt;
    font-size: 7.5pt;
    font-weight: 700;
    letter-spacing: 0.04em;
  }

  .report-site-description {
    margin: 5pt 0 0;
    color: #444;
  }

  .report-site-summary {
    margin: 4pt 0 0;
    font-weight: 600;
  }

  .report-site-metadata {
    display: flex;
    flex-wrap: wrap;
    gap: 3pt 14pt;
    margin-top: 4pt;
    color: #555;
    font-size: 9pt;
  }

  .report-parts {
    margin: 4pt 0 0;
    color: #555;
    font-size: 9pt;
  }

  .report-map-placeholder {
    display: grid;
    place-items: center;
    break-inside: avoid;
    border: 0.75pt dashed #aaa;
    border-radius: 3pt;
    background: #f7f7f7;
    color: #888;
    font-style: italic;
  }

  .report-site-map-placeholder {
    margin: 12pt 0;
    overflow: hidden;
  }

  .report-site-map-empty,
  .report-site-map-image {
    width: 100%;
    aspect-ratio: 4 / 3;
  }

  .report-site-map-empty {
    display: grid;
    place-items: center;
  }

  .report-site-map-image {
    display: block;
    height: auto;
  }

  .report-map-rendered {
    display: block;
    border-style: solid;
    font-style: normal;
  }

  .report-site-block {
    margin-top: 12pt;
    break-inside: avoid;
  }

  .report-alternatives-block,
  .report-part-maps-block {
    break-inside: auto;
  }

  .report-part-maps-block {
    break-before: page;
  }

  .report-site-block h3 {
    margin: 0 0 5pt;
    padding-bottom: 2pt;
    border-bottom: 0.75pt solid #aaa;
    font-size: 11pt;
  }

  .report-empty,
  .report-section-caption,
  .report-table-note {
    margin: 3pt 0;
    color: #666;
    font-size: 8pt;
  }

  .report-table-note {
    font-style: italic;
  }

  .report-part-map-list {
    margin-top: 6pt;
  }

  .report-part-map-row {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8pt;
    break-inside: avoid;
  }

  .report-part-map-row + .report-part-map-row {
    margin-top: 8pt;
  }

  .report-roadway-part-map-row {
    grid-template-columns: 1fr;
  }

  .report-roadway-part-map-row:nth-child(2n + 3) {
    margin-top: 0;
    break-before: page;
  }

  .report-part-map {
    margin: 0;
    break-inside: avoid;
    border: 0.75pt solid #bbb;
    border-radius: 3pt;
    overflow: hidden;
  }

  .report-part-map figcaption {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 6pt;
    padding: 4pt 6pt;
    background: #eee;
    font-size: 8pt;
  }

  .report-part-map figcaption span {
    color: #666;
    font-size: 7pt;
    white-space: nowrap;
  }

  .report-part-map-placeholder {
    display: grid;
    height: 104pt;
    place-items: center;
    background: #f7f7f7;
    color: #888;
    font-size: 8pt;
    font-style: italic;
  }

  .report-part-map-image {
    display: block;
    width: 100%;
    height: 104pt;
    object-fit: cover;
  }

  .report-roadway-part-map .report-part-map-placeholder,
  .report-roadway-part-map .report-part-map-image {
    width: 100%;
    height: auto;
    aspect-ratio: 2 / 1;
  }

  .report-ea-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 8.5pt;
  }

  .report-ea-table th,
  .report-ea-table td {
    border: 0.5pt solid #bbb;
    padding: 2.5pt 5pt;
  }

  .report-ea-table th:first-child,
  .report-ea-table td:first-child {
    width: 55%;
    text-align: left;
  }

  .report-ea-table th:not(:first-child),
  .report-ea-table td:not(:first-child) {
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  .report-ea-table th {
    background: #eee;
    font-weight: 700;
  }

  .report-total-cell {
    font-weight: 700;
  }

  .report-alternative-list {
    margin-top: 6pt;
  }

  .report-alternative-card + .report-alternative-card {
    margin-top: 7pt;
  }

  .report-alternative-card {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 94pt;
    break-inside: avoid;
    border: 0.75pt solid #c9c9c9;
    border-radius: 4pt;
    overflow: hidden;
    font-variant-numeric: tabular-nums;
  }

  .report-selected-card {
    border-color: #2865a7;
    border-left-width: 2pt;
    background: #f4f8fc;
  }

  .report-alternative-main {
    min-width: 0;
    padding: 8pt 9pt;
  }

  .report-alt-heading {
    display: flex;
    align-items: center;
    gap: 7pt;
  }

  .report-alt-rank {
    display: grid;
    width: 19pt;
    height: 19pt;
    flex: none;
    place-items: center;
    border-radius: 3pt;
    background: #e9ecef;
    font-size: 9pt;
    font-weight: 700;
  }

  .report-selected-card .report-alt-rank {
    background: #2865a7;
    color: #fff;
  }

  .report-alt-title {
    display: flex;
    min-width: 0;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 7pt;
  }

  .report-alt-title > strong {
    font-size: 10.5pt;
    line-height: 1.2;
  }

  .report-selected-badge {
    flex: none;
    border: 0.5pt solid #2865a7;
    border-radius: 2pt;
    padding: 0.5pt 2.5pt;
    background: #2865a7;
    color: #fff;
    font-size: 5.8pt;
    font-weight: 700;
    letter-spacing: 0.03em;
    text-transform: uppercase;
  }

  .report-alt-workcode {
    color: #666;
    font-size: 7pt;
    white-space: nowrap;
  }

  .report-alt-metrics {
    display: grid;
    grid-template-columns: 1.05fr 1fr 1.1fr 1.1fr 0.75fr;
    gap: 8pt;
    margin-top: 9pt;
  }

  .report-alt-metric {
    min-width: 0;
  }

  .report-alt-metric span {
    display: block;
    margin-bottom: 1pt;
    color: #68717d;
    font-size: 6.5pt;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .report-alt-metric strong {
    display: block;
    overflow-wrap: anywhere;
    font-size: 8.5pt;
    line-height: 1.2;
  }

  .report-alt-details {
    display: flex;
    flex-wrap: wrap;
    gap: 3pt 12pt;
    margin-top: 7pt;
    padding-top: 5pt;
    border-top: 0.5pt solid #ddd;
    color: #68717d;
    font-size: 7pt;
  }

  .report-alt-details strong {
    color: #555;
  }

  .report-alt-note {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 5pt;
    margin-top: 6pt;
    padding: 4pt 6pt;
    border-left: 1.5pt solid #888;
    background: #f1f1f1;
    color: #444;
    font-size: 7.5pt;
    line-height: 1.3;
  }

  .report-alt-note strong {
    font-size: 6.5pt;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .report-sii-panel {
    display: grid;
    align-content: center;
    justify-items: center;
    border-left: 0.75pt solid #d5dbe2;
    padding: 8pt;
    text-align: center;
  }

  .report-sii-panel strong {
    font-size: 21pt;
    line-height: 1;
  }

  .report-selected-card .report-sii-panel strong {
    color: #2865a7;
  }

  .report-sii-panel span {
    margin-top: 3pt;
    color: #68717d;
    font-size: 6.5pt;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
</style>
