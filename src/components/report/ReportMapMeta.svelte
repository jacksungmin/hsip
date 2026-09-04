<!-- Compact print legend, scale, and attribution shared by report maps. -->
<script lang="ts">
  import { BASEMAP_ATTRIBUTION } from '../../map/baseMapStyle'
  import { SEVERITY_MAP_COLORS } from '../../data/severityMeta'
  import type { ReportMapAsset, Severity } from '../../types'

  let {
    asset,
    showSeverity = true,
  }: {
    asset: ReportMapAsset
    showSeverity?: boolean
  } = $props()

  const severities: Severity[] = ['K', 'A', 'B']
</script>

<div class="report-map-meta">
  {#if showSeverity}
    <div class="report-map-legend" aria-label="Crash severity legend">
      {#each severities as severity}
        <span>
          <i style:background-color={SEVERITY_MAP_COLORS[severity]}></i>
          {severity}
        </span>
      {/each}
    </div>
  {/if}

  <div class="report-map-scale" style:width={`${asset.scaleWidthPercent}%`}>
    <i></i>
    <span>{asset.scaleLabel}</span>
  </div>

  <span class="report-map-attribution">{BASEMAP_ATTRIBUTION}</span>
</div>

<style>
  .report-map-meta {
    display: flex;
    min-height: 13pt;
    align-items: center;
    gap: 7pt;
    padding: 2pt 5pt;
    border-top: 0.5pt solid #ddd;
    background: #fff;
    color: #666;
    font-size: 5.5pt;
    line-height: 1;
  }

  .report-map-legend {
    display: flex;
    flex: none;
    gap: 4pt;
  }

  .report-map-legend span {
    display: flex;
    align-items: center;
    gap: 1.5pt;
  }

  .report-map-legend i {
    display: block;
    width: 5pt;
    height: 5pt;
    border: 0.4pt solid #fff;
    border-radius: 50%;
    box-shadow: 0 0 0 0.4pt #888;
  }

  .report-map-scale {
    min-width: 24pt;
    max-width: 72pt;
    flex: none;
    text-align: center;
  }

  .report-map-scale i {
    display: block;
    height: 3pt;
    border-right: 0.6pt solid #555;
    border-bottom: 0.6pt solid #555;
    border-left: 0.6pt solid #555;
  }

  .report-map-scale span {
    display: block;
    margin-top: 1pt;
  }

  .report-map-attribution {
    min-width: 0;
    margin-left: auto;
    overflow: hidden;
    text-align: right;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
