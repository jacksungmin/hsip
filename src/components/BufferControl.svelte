<!-- Buffer distance control: slider plus editable numeric readout.
     The slider covers the common range [min, max]; typing in the text
     field allows up to inputMax. Text commits clamp to [min, inputMax]. -->
<script lang="ts">
  let {
    value = $bindable(),
    id,
    min,
    max,
    step,
    inputMax,
    class: className = '',
  }: {
    value: number
    id?: string
    min: number
    max: number
    step: number
    inputMax: number
    class?: string
  } = $props()

  let editingText = $state(false)
  let textValue = $state('')

  function commitText() {
    const parsed = parseInt(textValue)
    if (!isNaN(parsed)) value = Math.max(min, Math.min(inputMax, parsed))
    editingText = false
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') commitText()
    if (e.key === 'Escape') editingText = false
  }

  function focusOnMount(node: HTMLElement) {
    node.focus()
  }
</script>

<div class="flex items-center gap-2 {className}">
  <input
    {id}
    type="range"
    {min}
    {max}
    {step}
    bind:value
    class="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-border accent-foreground"
  />
  {#if editingText}
    <input
      type="number"
      value={textValue}
      oninput={(e) => { textValue = e.currentTarget.value }}
      onblur={commitText}
      onkeydown={handleKeydown}
      class="h-6 w-16 rounded border border-border bg-background px-1.5 text-right text-xs tabular-nums"
      {min}
      max={inputMax}
      {step}
      use:focusOnMount
    />
  {:else}
    <button
      class="h-6 min-w-14 rounded px-1.5 text-right text-xs tabular-nums text-muted-foreground hover:bg-background hover:text-foreground"
      onclick={() => { editingText = true; textValue = String(value) }}
    >
      {value} ft
    </button>
  {/if}
</div>
