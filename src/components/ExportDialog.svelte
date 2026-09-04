<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog'
  import { Button } from '$lib/components/ui/button'
  import { Input } from '$lib/components/ui/input'
  import { Textarea } from '$lib/components/ui/textarea'
  import { projectInfoState } from '../state/projectInfoState.svelte'
  import { siteList } from '../state/siteList.svelte'
  import { projectState } from '../state/projectState.svelte'
  import { reportGeneration } from '../services/reportGenerationState.svelte'
  import FileText from '@lucide/svelte/icons/file-text'

  let {
    open = $bindable(false),
  }: {
    open: boolean
  } = $props()

  const info = $derived(projectInfoState.value)

  const sites = $derived(siteList.get())
  const includedCount = $derived(
    sites.filter((s) => projectState.getChosen(s.id) != null).length,
  )
  const totalCount = $derived(sites.length)

  async function generate() {
    open = false
    try {
      await reportGeneration.generateAndPrint()
    } catch {
      open = true
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-md" portalProps={{ to: '#app' }}>
    <Dialog.Header>
      <Dialog.Title>Export Planning Report</Dialog.Title>
      <Dialog.Description>
        {includedCount} of {totalCount} site{totalCount === 1 ? '' : 's'} will be included
        (sites with a selected countermeasure).
      </Dialog.Description>
    </Dialog.Header>

    {#if reportGeneration.error}
      <div class="border-destructive/30 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm" role="alert">
        {reportGeneration.error}
      </div>
    {/if}

    <div class="grid gap-3 py-2">
      <div class="grid gap-1">
        <label class="text-sm font-medium" for="export-project-name">Project name</label>
        <Input
          id="export-project-name"
          value={info.projectName}
          oninput={(e) => projectInfoState.update({ projectName: e.currentTarget.value })}
          placeholder="HSIP Sketch Planning Report"
        />
      </div>
      <div class="grid gap-1">
        <label class="text-sm font-medium" for="export-org">Organization</label>
        <Input
          id="export-org"
          value={info.organization}
          oninput={(e) => projectInfoState.update({ organization: e.currentTarget.value })}
        />
      </div>
      <div class="grid gap-1">
        <label class="text-sm font-medium" for="export-analyst">Analyst</label>
        <Input
          id="export-analyst"
          value={info.analyst}
          oninput={(e) => projectInfoState.update({ analyst: e.currentTarget.value })}
        />
      </div>
      <div class="grid gap-1">
        <label class="text-sm font-medium" for="export-county">County / Locality</label>
        <Input
          id="export-county"
          value={info.countyLocality}
          oninput={(e) => projectInfoState.update({ countyLocality: e.currentTarget.value })}
        />
      </div>
      <div class="grid gap-1">
        <label class="text-sm font-medium" for="export-notes">Notes</label>
        <Textarea
          id="export-notes"
          value={info.notes}
          oninput={(e) => projectInfoState.update({ notes: e.currentTarget.value })}
          rows={2}
          placeholder="Optional notes for the report cover"
        />
      </div>
    </div>

    <Dialog.Footer>
      <Button
        variant="outline"
        onclick={() => (open = false)}
      >
        Cancel
      </Button>
      <Button onclick={generate}>
        <FileText size={14} />
        Generate Report
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
