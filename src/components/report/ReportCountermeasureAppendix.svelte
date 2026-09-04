<!-- Appendix A: catalog details for countermeasures referenced by the report. -->
<script lang="ts">
  import type { Countermeasure } from '../../types'
  import { catalogFieldValue } from '../../data/countermeasureCatalog'

  let { countermeasures }: { countermeasures: Countermeasure[] } = $props()

  function reductionFactorText(value: number | null): string {
    if (value === null) return 'TBD'
    return `${value.toFixed(2)} (${(value * 100).toLocaleString('en-US', { maximumFractionDigits: 1 })}%)`
  }

  function catalogText(value: string): string {
    return catalogFieldValue(value) ?? 'Not listed'
  }
</script>

<section class="report-appendix">
  <h2>Appendix A — Countermeasure Details</h2>
  <p class="report-appendix-intro">
    Catalog details for the {countermeasures.length} countermeasure{countermeasures.length === 1 ? '' : 's'}
    evaluated in this report. Entries follow their first appearance in the site sections.
  </p>

  {#if countermeasures.length === 0}
    <p class="report-empty">No countermeasures are referenced by this report.</p>
  {:else}
    <div class="report-countermeasure-list">
      {#each countermeasures as countermeasure (countermeasure.workcode)}
        <article class="report-countermeasure-card">
          <header>
            <span>Work code {countermeasure.workcode}</span>
            <h3>{countermeasure.name}</h3>
          </header>

          <p class="report-countermeasure-definition">{countermeasure.definition}</p>

          <dl class="report-countermeasure-details">
            <div>
              <dt>Type of work</dt>
              <dd>{catalogText(countermeasure.typeOfWork)}</dd>
            </div>
            {#if countermeasure.facilitySubset}
              <div>
                <dt>Facility subset</dt>
                <dd>{countermeasure.facilitySubset}</dd>
              </div>
            {/if}
            <div>
              <dt>Emphasis areas addressed</dt>
              <dd>{countermeasure.emphasisAreas.length > 0 ? countermeasure.emphasisAreas.join(', ') : 'Not listed'}</dd>
            </div>
            <div>
              <dt>Crash reduction factor</dt>
              <dd>{reductionFactorText(countermeasure.reductionFactor)}</dd>
            </div>
            <div>
              <dt>Catalog service life</dt>
              <dd>{countermeasure.serviceLife} years</dd>
            </div>
            <div>
              <dt>Maintenance cost reference</dt>
              <dd>{catalogText(countermeasure.maintenanceCostRef)}</dd>
            </div>
          </dl>

          <div class="report-additional-docs">
            <strong>Additional documents required</strong>
            <span>{countermeasure.additionalDocs ?? 'None.'}</span>
          </div>
        </article>
      {/each}
    </div>
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

  .report-countermeasure-card {
    break-inside: avoid;
    border: 0.75pt solid #bbb;
    border-radius: 4pt;
    overflow: hidden;
  }

  .report-countermeasure-card + .report-countermeasure-card {
    margin-top: 8pt;
  }

  .report-countermeasure-card header {
    display: flex;
    align-items: baseline;
    gap: 8pt;
    padding: 6pt 8pt;
    background: #e9ecef;
  }

  .report-countermeasure-card header span {
    flex: none;
    border-radius: 2pt;
    background: #333;
    padding: 1.5pt 4pt;
    color: #fff;
    font-size: 6.5pt;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .report-countermeasure-card h3 {
    margin: 0;
    font-size: 10.5pt;
    line-height: 1.25;
  }

  .report-countermeasure-definition {
    margin: 0;
    padding: 7pt 8pt;
    border-bottom: 0.5pt solid #ddd;
    font-size: 8.5pt;
    line-height: 1.35;
  }

  .report-countermeasure-details {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    margin: 0;
    padding: 6pt 8pt;
    gap: 5pt 14pt;
  }

  .report-countermeasure-details div {
    min-width: 0;
  }

  .report-countermeasure-details dt {
    color: #68717d;
    font-size: 6.5pt;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .report-countermeasure-details dd {
    margin: 1pt 0 0;
    overflow-wrap: anywhere;
    font-size: 8pt;
    line-height: 1.3;
  }

  .report-additional-docs {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 6pt;
    padding: 5pt 8pt;
    border-top: 0.5pt solid #ddd;
    background: #f5f5f5;
    font-size: 7.5pt;
    line-height: 1.3;
  }

  .report-additional-docs strong {
    font-size: 6.5pt;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
</style>
