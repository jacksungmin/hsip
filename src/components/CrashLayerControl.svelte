<script lang="ts">
  import { Switch } from '$lib/components/ui/switch'
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu'
  import ChevronDown from '@lucide/svelte/icons/chevron-down'
  import { EA_LABELS, EA_IDS, type EaFlagKey } from '../data/emphasisAreas'

  type Props = {
    visible: boolean
    selectedEAs: EaFlagKey[]
  }

  let { visible = $bindable(), selectedEAs = $bindable() }: Props = $props()

  const allSelected = $derived(selectedEAs.length === EA_IDS.length)
  const noneSelected = $derived(selectedEAs.length === 0)

  function toggleAll() {
    selectedEAs = allSelected ? [] : [...EA_IDS]
  }
</script>

<div class="flex items-center gap-2 rounded-md border bg-background px-2.5 py-1.5 shadow-sm">
  <Switch bind:checked={visible} class="scale-75" />
  <span class="text-[13px] {visible ? 'text-foreground' : 'text-muted-foreground'}">Crash Heatmap</span>

  <DropdownMenu.Root>
    <DropdownMenu.Trigger class="flex items-center text-muted-foreground transition-colors hover:text-foreground">
      <ChevronDown size={14} />
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="end" class="w-56">
      <DropdownMenu.CheckboxItem
        checked={allSelected}
        indeterminate={!allSelected && !noneSelected}
        onCheckedChange={toggleAll}
        closeOnSelect={false}
      >
        All emphasis areas
      </DropdownMenu.CheckboxItem>
      <DropdownMenu.Separator />
      <DropdownMenu.CheckboxGroup bind:value={selectedEAs}>
        {#each EA_IDS as ea}
          <DropdownMenu.CheckboxItem value={ea} closeOnSelect={false}>
            {EA_LABELS[ea]}
          </DropdownMenu.CheckboxItem>
        {/each}
      </DropdownMenu.CheckboxGroup>
    </DropdownMenu.Content>
  </DropdownMenu.Root>
</div>
