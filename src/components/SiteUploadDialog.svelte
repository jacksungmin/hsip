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
  import { jurisdictionStore } from '../state/jurisdictionStore.svelte'
  import { inBbox, regionBbox, type Bbox } from '../services/regionBounds'

  type SiteType = 'roadway' | 'intersection'

  let {
    open = $bindable(false),
    siteType,
    onConfirm,
  }: {
    open: boolean
    siteType: SiteType
    onConfirm: (config: {
      result: ParseResult
      siteName: string
      nameColumn: string | null
      createAs: 'separate' | 'group'
    }) => void
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
  // A file with several locations becomes one site per location by default:
  // agencies typically load all their project locations at once and review
  // each separately. A group (one crash set, one plan) remains an option.
  let createAs = $state<'separate' | 'group'>('separate')

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
    createAs = 'separate'
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

    const multiple = finalResult.features.length > 1
    onConfirm({ result: finalResult, siteName, nameColumn, createAs: multiple ? createAs : 'group' })
  }

  const geomLabel = $derived(siteType === 'roadway' ? 'line' : 'point')
  const featureCount = $derived(parseResult?.features.length ?? 0)

  // Locations outside the region have no crash data. A wrong coordinate
  // system that still yields valid longitudes and latitudes ends up here
  // too, so say how many before the sites are created.
  let region = $state<Bbox | null>(null)
  jurisdictionStore.list().then((list) => { region = regionBbox(list) }).catch(() => { region = null })
  const outsideCount = $derived.by(() => {
    if (!parseResult || !region) return 0
    const box = region
    return parseResult.features.filter((f) => {
      const coords = f.geometry.type === 'Point' ? [f.geometry.coordinates] : (f.geometry.coordinates as number[][])
      return coords.some((p) => !inBbox(box, p[0], p[1]))
    }).length
  })
  const separate = $derived(featureCount > 1 && createAs === 'separate')
  const noun = $derived(siteType === 'roadway' ? 'segment' : 'intersection')
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>
        Import {siteType === 'roadway' ? 'roadway segments' : 'intersections'} from file
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
            Coordinates converted from {parseResult.crs} to WGS 84{parseResult.nad27 ? ', including the NAD27 to NAD83 datum shift' : ''}.
          </p>
        {/if}

        {#if outsideCount > 0}
          <div class="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status">
            <AlertCircleIcon class="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {outsideCount === featureCount ? 'All' : `${outsideCount} of ${featureCount}`}
              {featureCount === 1 ? 'location falls' : 'locations fall'} outside the H-GAC region, so
              {outsideCount === 1 ? 'it' : 'they'} will have no crash data. If they should be in the region, check
              the file's coordinate system.
            </span>
          </div>
        {/if}

        {#if featureCount > 1}
          <fieldset>
            <legend class="text-sm font-medium">Create as</legend>
            <div class="mt-1 grid gap-2">
              <label class="flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm {createAs === 'separate' ? 'border-primary bg-primary/5' : ''}">
                <input type="radio" name="upload-create-as" value="separate" bind:group={createAs} class="mt-1" />
                <span>
                  <span class="font-medium">{featureCount} separate sites</span>
                  <span class="block text-xs text-muted-foreground">One site per {noun}, each with its own crashes and countermeasures.</span>
                </span>
              </label>
              <label class="flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm {createAs === 'group' ? 'border-primary bg-primary/5' : ''}">
                <input type="radio" name="upload-create-as" value="group" bind:group={createAs} class="mt-1" />
                <span>
                  <span class="font-medium">One group site</span>
                  <span class="block text-xs text-muted-foreground">All {featureCount} {noun}s analyzed together, with one countermeasure plan.</span>
                </span>
              </label>
            </div>
          </fieldset>
        {/if}

        <div>
          <label for="upload-site-name" class="text-sm font-medium">{separate ? 'Site name prefix' : 'Site name'}</label>
          {#if separate}
            <p class="mt-0.5 text-xs text-muted-foreground">
              Optional. Locations without a name from the column below are named "{siteName.trim() || noun.charAt(0).toUpperCase() + noun.slice(1)} 1", "{siteName.trim() || noun.charAt(0).toUpperCase() + noun.slice(1)} 2"…
            </p>
          {/if}
          <Input id="upload-site-name" bind:value={siteName} class="mt-1" />
        </div>

        <div>
          <p class="text-sm font-medium" id="upload-name-column-label">
            {siteType === 'roadway' ? 'Segment' : 'Intersection'} name column
          </p>
          <p class="mt-0.5 text-xs text-muted-foreground">
            {separate ? 'Attribute to use for site names.' : 'Attribute to use for part names.'} Leave as "None" to auto-generate.
          </p>
          <Select.Root type="single" value={nameColumn ?? ''} onValueChange={(v) => { nameColumn = v || null }}>
            <Select.Trigger class="mt-1 w-full" aria-labelledby="upload-name-column-label">
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
        <!-- A group needs a name; separate sites are named from the file, so a
             prefix is optional (unnamed locations fall back to "Intersection 1"). -->
        <Button onclick={confirm} disabled={(!separate && !siteName.trim()) || creating}>
          {#if creating}
            <LoaderCircleIcon class="mr-1.5 h-4 w-4 animate-spin" />
          {/if}
          {separate ? `Create ${featureCount} sites` : 'Create site'}
        </Button>
      {/if}
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
