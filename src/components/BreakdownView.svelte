<script lang="ts">
  import * as ToggleGroup from '$lib/components/ui/toggle-group'
  import * as Tooltip from '$lib/components/ui/tooltip'

  type Series = {
    name: string
    total: number
    counts: Record<string, number>
  }

  type Mode = 'absolute' | 'relative'

  type Props = {
    currentSeries: Series | null
    baselineSeries: Series | null
    peerSeries?: Series | null
    labels: Record<string, string>
    title?: string
  }

  let {
    currentSeries,
    baselineSeries,
    peerSeries = null,
    labels,
    title,
  }: Props = $props()

  let mode = $state<Mode>('absolute')

  function setMode(value: string): void {
    if (value === 'absolute' || value === 'relative') mode = value
  }

  function share(series: Series | null, eaId: string): number {
    if (!series || series.total === 0) return 0
    return ((series.counts[eaId] ?? 0) / series.total) * 100
  }

  function difference(series: Series | null, eaId: string): number {
    if (!series || !baselineSeries) return 0
    return share(series, eaId) - share(baselineSeries, eaId)
  }

  const eaIds = $derived.by(() => {
    const orderingSeries = currentSeries ?? baselineSeries ?? peerSeries
    const ids = Object.keys(orderingSeries?.counts ?? labels)
    return ids.sort(
      (a, b) => share(orderingSeries, b) - share(orderingSeries, a),
    )
  })

  const absoluteScaleMax = $derived.by(() => {
    const series = [currentSeries, baselineSeries, peerSeries].filter(
      (item): item is Series => item !== null,
    )
    const maxShare = Math.max(
      0,
      ...series.flatMap((item) => eaIds.map((eaId) => share(item, eaId))),
    )
    return Math.max(5, Math.ceil(maxShare / 5) * 5)
  })

  const relativeScaleMax = $derived.by(() => {
    const compared = [currentSeries, peerSeries].filter(
      (item): item is Series => item !== null,
    )
    const maxDifference = Math.max(
      0,
      ...compared.flatMap((item) =>
        eaIds.map((eaId) => Math.abs(difference(item, eaId))),
      ),
    )
    return Math.max(1, Math.ceil(maxDifference))
  })

  function absoluteWidthPercent(value: number): number {
    return Math.min(100, Math.max(0, (value / absoluteScaleMax) * 100))
  }

  function absoluteBarStyle(value: number): string {
    const minWidth = value > 0 ? 'min-width:2px;' : ''
    return `width:${absoluteWidthPercent(value)}%;${minWidth}`
  }

  function absoluteTickStyle(value: number): string {
    const position = `calc(${absoluteWidthPercent(value)}% - 1.5px)`
    return `left:${position};left:round(nearest, ${position}, 1px);`
  }

  function relativeBarStyle(value: number): string {
    const width = Math.min(50, (Math.abs(value) / relativeScaleMax) * 50)
    const left = value >= 0 ? 50 : 50 - width
    const minWidth = value !== 0 ? 'min-width:2px;' : ''
    return `left:${left}%;width:${width}%;${minWidth}`
  }

  function centerTickStyle(): string {
    const position = 'calc(50% - 1.5px)'
    return `left:${position};left:round(nearest, ${position}, 1px);`
  }

  function count(series: Series | null, eaId: string): string {
    return (series?.counts[eaId] ?? 0).toLocaleString()
  }

  function signedDifference(value: number): string {
    return `${value > 0 ? '+' : ''}${value.toFixed(1)} %pt`
  }

  function triggerLabel(eaId: string, label: string): string {
    const values = [currentSeries, baselineSeries, peerSeries]
      .filter((series): series is Series => series !== null)
      .map((series) => {
        const absolute = `${series.name} ${share(series, eaId).toFixed(1)} percent`
        if (mode === 'absolute' || series === baselineSeries) return absolute
        return `${absolute}, ${signedDifference(difference(series, eaId))}`
      })
    return values.length > 0 ? `${label}: ${values.join(', ')}` : label
  }
</script>

<div aria-label="Emphasis area crash share comparison">
  <div class="mb-3 flex items-start justify-between gap-3">
    <div class="min-w-0">
      {#if title}
        <div class="mb-1 truncate text-sm font-semibold" title={title}>{title}</div>
      {/if}
      <p class="text-xs text-muted-foreground">
        {mode === 'absolute'
          ? 'Share of crashes tagged to each emphasis area'
          : 'Percentage-point difference from the H-GAC region'}
      </p>
    </div>

    <ToggleGroup.Root
      type="single"
      value={mode}
      onValueChange={setMode}
      variant="outline"
      size="sm"
      class="shrink-0"
    >
      <ToggleGroup.Item
        value="absolute"
        aria-label="Show absolute crash shares"
        class="h-6 px-2 text-xs data-[state=on]:bg-foreground data-[state=on]:text-background"
      >
        Absolute
      </ToggleGroup.Item>
      <ToggleGroup.Item
        value="relative"
        aria-label="Show differences from H-GAC"
        class="h-6 px-2 text-xs data-[state=on]:bg-foreground data-[state=on]:text-background"
      >
        Relative
      </ToggleGroup.Item>
    </ToggleGroup.Root>
  </div>

  <Tooltip.Provider delayDuration={500} skipDelayDuration={0}>
    <div class="space-y-0.5">
      {#each eaIds as eaId (eaId)}
        {@const label = labels[eaId] ?? eaId}
        {@const currentShare = share(currentSeries, eaId)}
        {@const baselineShare = share(baselineSeries, eaId)}
        {@const peerShare = share(peerSeries, eaId)}
        {@const currentDifference = difference(currentSeries, eaId)}
        {@const peerDifference = difference(peerSeries, eaId)}
        <div class="grid grid-cols-[minmax(90px,130px)_minmax(80px,1fr)_110px] items-center gap-2 py-1.5">
          <div class="truncate text-xs" title={label}>{label}</div>

          <Tooltip.Root>
            <Tooltip.Trigger
              class="relative block h-4 w-full overflow-hidden rounded-sm bg-muted p-0 text-left"
              aria-label={triggerLabel(eaId, label)}
            >
              {#if mode === 'absolute'}
                {#if peerSeries}
                  <span
                    class="absolute inset-y-0 left-0 rounded-sm bg-primary/20"
                    style={absoluteBarStyle(peerShare)}
                  ></span>
                {/if}
                {#if currentSeries}
                  <span
                    class="absolute top-1 left-0 h-2 rounded-[2px] bg-primary shadow-[0_0_0_1px_var(--background)]"
                    style={absoluteBarStyle(currentShare)}
                  ></span>
                {/if}
                {#if baselineSeries}
                  <span
                    class="absolute inset-y-0 w-0 border-l-[3px] border-foreground shadow-[0_0_0_1px_var(--background)]"
                    style={absoluteTickStyle(baselineShare)}
                  ></span>
                {/if}
              {:else}
                {#if peerSeries && baselineSeries}
                  <span
                    class="absolute inset-y-0 rounded-sm bg-primary/20"
                    style={relativeBarStyle(peerDifference)}
                  ></span>
                {/if}
                {#if currentSeries && baselineSeries}
                  <span
                    class="absolute top-1 h-2 rounded-[2px] bg-primary shadow-[0_0_0_1px_var(--background)]"
                    style={relativeBarStyle(currentDifference)}
                  ></span>
                {/if}
                {#if baselineSeries}
                  <span
                    class="absolute inset-y-0 w-0 border-l-[3px] border-foreground shadow-[0_0_0_1px_var(--background)]"
                    style={centerTickStyle()}
                  ></span>
                {/if}
              {/if}
            </Tooltip.Trigger>
            <Tooltip.Content class="block">
              <div class="mb-1 font-semibold">{label}</div>
              {#if currentSeries}
                <div>
                  {currentSeries.name}: {currentShare.toFixed(1)}%
                  ({count(currentSeries, eaId)})
                  {#if mode === 'relative'} · {signedDifference(currentDifference)}{/if}
                </div>
              {/if}
              {#if baselineSeries}
                <div>
                  {baselineSeries.name}: {baselineShare.toFixed(1)}%
                  ({count(baselineSeries, eaId)})
                </div>
              {/if}
              {#if peerSeries}
                <div>
                  {peerSeries.name}: {peerShare.toFixed(1)}%
                  ({count(peerSeries, eaId)})
                  {#if mode === 'relative'} · {signedDifference(peerDifference)}{/if}
                </div>
              {/if}
            </Tooltip.Content>
          </Tooltip.Root>

          <div class="flex items-center justify-start gap-1 whitespace-nowrap text-left text-[11px] font-medium tabular-nums">
            {#if currentSeries}
              <span>
                {mode === 'absolute'
                  ? `${currentShare.toFixed(1)}%`
                  : signedDifference(currentDifference)}
              </span>
            {/if}
            {#if peerSeries}
              {#if currentSeries}<span class="text-muted-foreground">·</span>{/if}
              <span class="text-primary/60">
                {mode === 'absolute'
                  ? `${peerShare.toFixed(1)}%`
                  : signedDifference(peerDifference)}
              </span>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  </Tooltip.Provider>

  <div
    class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-dashed pt-2 text-[10px] text-muted-foreground"
  >
    {#if currentSeries}
      <span class="flex items-center gap-1.5">
        <span class="h-1.5 w-3 rounded-[2px] bg-primary"></span>
        {currentSeries.name}
      </span>
    {/if}
    {#if baselineSeries}
      <span class="flex items-center gap-1.5">
        <span class="h-3 w-0 border-l-[3px] border-foreground"></span>
        {baselineSeries.name}
      </span>
    {/if}
    {#if peerSeries}
      <span class="flex items-center gap-1.5">
        <span class="h-2.5 w-3 rounded-sm bg-primary/20"></span>
        {peerSeries.name}
      </span>
    {/if}
  </div>
</div>
