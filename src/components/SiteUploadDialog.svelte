<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog'
  import { Button } from '$lib/components/ui/button'
  import { Input } from '$lib/components/ui/input'
  import * as Select from '$lib/components/ui/select'
  import { parseUploadedFile, applyNameColumn, type ParseResult, type ParseError } from '../services/parseUploadedFile'
  import UploadIcon from '@lucide/svelte/icons/upload'
  import FileIcon from '@lucide/svelte/icons/file'
  import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle'
  import AlertCircleIcon from '@lucide/svelte/icons/alert-circle'

  type SiteType = 'roadway' | 'intersection'

  let {
    open = $bindable(false),
    siteType,
    onConfirm,
  }: {
    open: boolean
    siteType: SiteType
    onConfirm: (config: { result: ParseResult; siteName: string; nameColumn: string | null }) => void
  } = $props()

  let step = $state<'drop' | 'configure'>('drop')
  let parsing = $state(false)
  let creating = $state(false)
  let error = $state<ParseError | null>(null)
  let parseResult = $state<ParseResult | null>(null)
  let fileName = $state('')
  let siteName = $state('')
  let nameColumn = $state<string | null>(null)
  let dragOver = $state(false)

  const COMMON_NAME_FIELDS = ['name', 'Name', 'NAME', 'label', 'Label', 'LABEL']

  function reset() {
    step = 'drop'
    parsing = false
    creating = false
    error = null
    parseResult = null
    fileName = ''
    siteName = ''
    nameColumn = null
    dragOver = false
  }

  $effect(() => {
    if (open) reset()
  })

  async function handleFile(file: File) {
    error = null
    parsing = true
    const result = await parseUploadedFile(file, siteType)
    parsing = false

    if (!result.ok) {
      error = result.error
      return
    }

    parseResult = result.result
    fileName = file.name
    siteName = file.name.replace(/\.[^.]+$/, '')
    nameColumn = result.result.columns.find((c) => COMMON_NAME_FIELDS.includes(c)) ?? null
    step = 'configure'
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    dragOver = false
    const file = e.dataTransfer?.files[0]
    if (file) handleFile(file)
  }

  function onDragOver(e: DragEvent) {
    e.preventDefault()
    dragOver = true
  }

  function onDragLeave() {
    dragOver = false
  }

  function onFileInput(e: Event) {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    if (file) handleFile(file)
    input.value = ''
  }

  function confirm() {
    if (!parseResult) return
    creating = true

    let finalResult = parseResult
    if (nameColumn) {
      finalResult = { ...parseResult, features: applyNameColumn(parseResult.features, nameColumn) }
    }

    onConfirm({ result: finalResult, siteName, nameColumn })
  }

  const geomLabel = $derived(siteType === 'roadway' ? 'line' : 'point')
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>
        Import {siteType === 'roadway' ? 'roadway' : 'intersection'} site from file
      </Dialog.Title>
    </Dialog.Header>

    {#if step === 'drop'}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="mt-2 flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-colors
          {dragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'}"
        ondrop={onDrop}
        ondragover={onDragOver}
        ondragleave={onDragLeave}
      >
        {#if parsing}
          <LoaderCircleIcon class="h-8 w-8 animate-spin text-muted-foreground" />
          <p class="mt-2 text-sm text-muted-foreground">Parsing file...</p>
        {:else}
          <UploadIcon class="h-8 w-8 text-muted-foreground" />
          <p class="mt-2 text-sm text-muted-foreground">
            Drag and drop a file here, or click to browse
          </p>
          <p class="mt-1 text-xs text-muted-foreground/70">
            .geojson, .json, or .zip (shapefile) &middot; Max 10 MB
          </p>
          <label class="mt-3">
            <input type="file" class="hidden" accept=".geojson,.json,.zip" onchange={onFileInput} />
            <Button variant="outline" size="sm" class="pointer-events-none">Browse files</Button>
          </label>
        {/if}
      </div>

      {#if error}
        <div class="mt-3 flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircleIcon class="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error.message}</span>
        </div>
      {/if}

    {:else if step === 'configure' && parseResult}
      <div class="mt-2 space-y-4">
        <div class="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm">
          <FileIcon class="h-4 w-4 shrink-0 text-muted-foreground" />
          <span class="truncate">{fileName}</span>
          <span class="ml-auto shrink-0 text-muted-foreground">
            {parseResult.features.length} {geomLabel} feature{parseResult.features.length === 1 ? '' : 's'}
          </span>
        </div>

        {#if parseResult.crs}
          <p class="text-xs text-muted-foreground">
            Coordinates reprojected from source CRS to WGS 84.
          </p>
        {/if}

        <div>
          <label for="upload-site-name" class="text-sm font-medium">Site name</label>
          <Input id="upload-site-name" bind:value={siteName} class="mt-1" />
        </div>

        <div>
          <label class="text-sm font-medium">
            {siteType === 'roadway' ? 'Segment' : 'Intersection'} name column
          </label>
          <p class="mt-0.5 text-xs text-muted-foreground">
            Attribute to use for part names. Leave as "None" to auto-generate.
          </p>
          <Select.Root type="single" value={nameColumn ?? ''} onValueChange={(v) => { nameColumn = v || null }}>
            <Select.Trigger class="mt-1 w-full">
              {nameColumn || 'None — auto-generate'}
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="">None — auto-generate</Select.Item>
              {#each parseResult.columns as col}
                <Select.Item value={col}>{col}</Select.Item>
              {/each}
            </Select.Content>
          </Select.Root>
        </div>
      </div>
    {/if}

    <Dialog.Footer class="mt-4">
      <Button variant="outline" onclick={() => { open = false }}>Cancel</Button>
      {#if step === 'configure'}
        <Button onclick={confirm} disabled={!siteName.trim() || creating}>
          {#if creating}
            <LoaderCircleIcon class="mr-1.5 h-4 w-4 animate-spin" />
          {/if}
          Create site
        </Button>
      {/if}
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
