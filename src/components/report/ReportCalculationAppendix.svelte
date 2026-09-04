<!-- Appendix B: fixed SII method plus report-specific cost and data inputs. -->
<script lang="ts">
  import siiFormulaImg from '../../assets/sii-formula-only.png'
  import type { ReportPayload } from '../../types'

  let { methods }: { methods: ReportPayload['methods'] } = $props()

  function formatCurrency(value: number): string {
    return value.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    })
  }
</script>

<section class="report-appendix">
  <h2>Appendix B — Calculation Basis</h2>
  <p class="report-appendix-intro">
    The report applies the TxDOT HSIP Safety Investment Index (SII) method to
    {methods.dataRange} crash data ({methods.dataYears} years).
  </p>

  <section class="report-method-block">
    <h3>Safety Investment Index formula</h3>
    <img
      class="report-formula-image"
      src={siiFormulaImg}
      alt="Safety Investment Index formulas for annual savings, traffic growth adjustment, present benefit, and SII"
    />
    <p class="report-method-note">The 6% annual discount rate is fixed by the calculation method.</p>
  </section>

  <section class="report-method-block">
    <h3>Symbols and report inputs</h3>
    <dl class="report-symbol-grid">
      <div><dt>F</dt><dd>K+A site crashes carrying the alternative's workcode tag</dd></div>
      <div><dt>I</dt><dd>B site crashes carrying the alternative's workcode tag</dd></div>
      <div><dt>R</dt><dd>Countermeasure crash reduction factor (CRF)</dd></div>
      <div><dt>C<sub>f</sub></dt><dd>Crash cost for the K+A severity group</dd></div>
      <div><dt>C<sub>i</sub></dt><dd>Crash cost for the B severity group</dd></div>
      <div><dt>Y</dt><dd>Years in the crash data period ({methods.dataYears})</dd></div>
      <div><dt>M</dt><dd>User-entered annual maintenance cost</dd></div>
      <div><dt>A<sub>a</sub> / A<sub>b</sub></dt><dd>Projected-to-baseline AADT ratio, calculated as (1 + g)<sup>L</sup></dd></div>
      <div><dt>g</dt><dd>Site annual traffic growth rate expressed as a decimal</dd></div>
      <div><dt>L</dt><dd>User-entered countermeasure service life in years</dd></div>
      <div><dt>C</dt><dd>User-entered construction cost</dd></div>
      <div><dt>1.06</dt><dd>Discount factor from the fixed 6% annual rate</dd></div>
      <div><dt>S</dt><dd>Annual crash-cost savings after maintenance</dd></div>
      <div><dt>Q</dt><dd>Annual change in crash-cost savings from traffic growth</dd></div>
      <div><dt>B</dt><dd>Present value of benefits over the service life</dd></div>
      <div><dt>SII</dt><dd>Benefit-to-cost ratio, B ÷ C</dd></div>
    </dl>
  </section>

  <section class="report-method-block">
    <h3>Crash cost table</h3>
    <table class="report-cost-table">
      <thead>
        <tr>
          <th>Severity</th>
          <th>Description</th>
          <th>Cost per crash</th>
        </tr>
      </thead>
      <tbody>
        {#each methods.crashCostTable as entry (entry.severity)}
          <tr>
            <td>{entry.severity}</td>
            <td>{entry.label}</td>
            <td>{formatCurrency(entry.dollarValue)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>

</section>

<style>
  .report-appendix {
    break-before: page;
    color: #1a1a1a;
  }

  .report-appendix > h2 {
    margin: 0 0 8pt;
    padding-bottom: 4pt;
    border-bottom: 1.5pt solid #333;
    font-size: 16pt;
    break-after: avoid;
  }

  .report-appendix-intro {
    margin: 0 0 12pt;
    color: #555;
    font-size: 8.5pt;
  }

  .report-method-block {
    margin-top: 12pt;
    break-inside: avoid;
  }

  .report-method-block h3 {
    margin: 0 0 5pt;
    padding-bottom: 2pt;
    border-bottom: 0.75pt solid #aaa;
    font-size: 10.5pt;
  }

  .report-formula-image {
    display: block;
    width: 3in;
    max-width: 100%;
    height: auto;
    margin: 0 auto;
  }

  .report-method-note {
    margin: 3pt 0 0;
    color: #666;
    font-size: 7.5pt;
    font-style: italic;
  }

  .report-symbol-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    margin: 0;
    border: 0.5pt solid #bbb;
  }

  .report-symbol-grid div {
    display: grid;
    grid-template-columns: 40pt minmax(0, 1fr);
    gap: 4pt;
    padding: 3pt 5pt;
    border-bottom: 0.5pt solid #ddd;
  }

  .report-symbol-grid div:nth-child(odd) {
    border-right: 0.5pt solid #ddd;
  }

  .report-symbol-grid dt {
    font-weight: 700;
  }

  .report-symbol-grid dd {
    margin: 0;
    font-size: 7.5pt;
    line-height: 1.3;
  }

  .report-cost-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 8pt;
  }

  .report-cost-table th,
  .report-cost-table td {
    border: 0.5pt solid #bbb;
    padding: 3pt 5pt;
    text-align: left;
  }

  .report-cost-table th {
    background: #eee;
  }

  .report-cost-table th:last-child,
  .report-cost-table td:last-child {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

</style>
