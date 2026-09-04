<!-- Draft card stays inline here rather than extracted into a SiteCard component.
     Draft and confirmed-site cards share only the buffer control (extracted as
     BufferControl). The rest differs enough (name input vs label, draw hint,
     redraw button, no crash data) that a shared component would be mostly conditionals. -->
<script lang="ts">
  import type { LineString, Point, Polygon } from 'geojson'
  import turfBuffer from '@turf/buffer'
  import turfLength from '@turf/length'
  import { drawingState } from '../state/drawingState.svelte'
  import { draftSiteState } from '../state/draftSiteState.svelte'
  import { siteList } from '../state/siteList.svelte'
  import { activeSite } from '../state/activeSite.svelte'
  import { viewMode } from '../state/viewMode.svelte'
  import { workbenchState } from '../state/workbenchState.svelte'
  import { bufferRange, createPart, createSite, demoteRenames, isAutoName, nextGroupName, nextPartName, partCountLabel, partNameBase, partNoun, singleSitePromotionRenames, replacePartGeometry, requeryPartBuffer, requerySiteBuffer, siteBadgeLabel, siteCrashProfile } from '../services/siteHelpers'
  import { calculateSiteAlternatives, resolveChosenAlternative } from '../services/sitePlan'
  import { dedupeCrashUnion, withSiteParts } from '../services/crashUnion'
  import { projectState } from '../state/projectState.svelte'
  import { get as getCrashCost } from '../data/crashCostTable'
  import type { Site, SitePart } from '../types'
  import Button from '$lib/components/ui/button/button.svelte'
  import Input from '$lib/components/ui/input/input.svelte'
  import BufferControl from './BufferControl.svelte'
  import Route from '@lucide/svelte/icons/route'
  import CircleDot from '@lucide/svelte/icons/circle-dot'
  import LoaderCircle from '@lucide/svelte/icons/loader-circle'
  import Download from '@lucide/svelte/icons/download'
  import CircleArrowRight from '@lucide/svelte/icons/circle-arrow-right'
  import Pencil from '@lucide/svelte/icons/pencil'
  import Layers from '@lucide/svelte/icons/layers'
  import * as Tooltip from '$lib/components/ui/tooltip'
  import * as AlertDialog from '$lib/components/ui/alert-dialog'
  import SiteUploadDialog from './SiteUploadDialog.svelte'
  import ExportDialog from './ExportDialog.svelte'
  import Upload from '@lucide/svelte/icons/upload'
  import type { ParseResult } from '../services/parseUploadedFile'

  type SiteType = 'roadway' | 'intersection'

  const DEFAULTS: Record<SiteType, { buffer: number; sliderMin: number; sliderMax: number; step: number; inputMax: number }> = {
    roadway: { buffer: 100, sliderMin: 25, sliderMax: 250, step: 25, inputMax: 500 },
    intersection: { buffer: 150, sliderMin: 50, sliderMax: 500, step: 10, inputMax: 1000 },
  }

  type WorkflowMode = 'idle' | 'drafting' | 'editing-buffer'

  // Where the next confirmed geometry goes, set by entry point (toolbar
  // = new site, card "+ Add" = append, part row
  // "Redraw" = replace).
  // Never picked in the draw UI.
  type DraftTarget =
    | { mode: 'new' }
    | { mode: 'append'; siteId: string }
    | { mode: 'replace'; siteId: string; partId: string }

  let draftTarget = $state<DraftTarget>({ mode: 'new' })
  let draftType = $state<SiteType | null>(null)
  let draftName = $state('')
  let draftPartName = $state('')
  let draftSiteName = $state('')
  let nameEdited = $state(false)
  let partNameEdited = $state(false)
  let siteNameEdited = $state(false)
  let draftBuffer = $state(50)
  let draftGeometry = $state<LineString | Point | null>(null)
  let groupDraft = $state(false)
  let groupNaming = $state(false)
  let typeChoice = $state<SiteType | null>(null)
  let uploadOpen = $state(false)
  let uploadType = $state<SiteType>('roadway')
  let exportOpen = $state(false)
  const hasPlannedSites = $derived(siteList.get().some((s) => projectState.getChosen(s.id) != null))

  const appendTargetSite = $derived.by(() => {
    const t = draftTarget
    if (t.mode !== 'append') return null
    return siteList.get().find((s) => s.id === t.siteId) ?? null
  })

  const replaceTargetPart = $derived.by(() => {
    const t = draftTarget
    if (t.mode !== 'replace') return null
    const site = siteList.get().find((s) => s.id === t.siteId)
    const part = site?.parts.find((p) => p.id === t.partId)
    return site && part ? { site, part } : null
  })

  function startDraw(type: SiteType) {
    activeSite.set(null)
    const seq = String(siteList.get().length + 1).padStart(2, '0')
    draftTarget = { mode: 'new' }
    draftType = type
    draftName = type === 'intersection' ? `Intersection ${seq}` : `Roadway Segment ${seq}`
    nameEdited = false
    groupDraft = false
    typeChoice = null
    draftBuffer = DEFAULTS[type].buffer
    draftGeometry = null
    drawingState.setTool(type === 'roadway' ? 'roadway-line' : 'intersection-point')
  }

  function startGroupDraw(type: SiteType) {
    activeSite.set(null)
    draftTarget = { mode: 'new' }
    draftType = type
    draftName = nextGroupName(siteList.get(), type)
    nameEdited = false
    groupDraft = true
    groupNaming = true
    typeChoice = null
    draftPartName = `${partNameBase(type)} 1`
    partNameEdited = false
    draftBuffer = DEFAULTS[type].buffer
    draftGeometry = null
  }

  function continueGroupDraw() {
    if (!draftType) return
    groupNaming = false
    drawingState.setTool(draftType === 'roadway' ? 'roadway-line' : 'intersection-point')
  }

  function startUpload(type: SiteType) {
    uploadType = type
    uploadOpen = true
    typeChoice = null
  }

  async function handleUploadConfirm(config: { result: ParseResult; siteName: string; nameColumn: string | null }) {
    const { result, siteName } = config
    const base = partNameBase(uploadType)
    const parts = await Promise.all(
      result.features.map(async (f, i) => {
        return createPart({
          name: f.name ?? `${base} ${i + 1}`,
          drawnGeometry: f.geometry,
          bufferFeet: DEFAULTS[uploadType].buffer,
        })
      }),
    )
    const { crashIds, crashSeverity } = dedupeCrashUnion(parts.map((p) => p.crashes))
    const site: Site = {
      id: `site:${crypto.randomUUID()}`,
      name: siteName,
      type: uploadType,
      source: 'upload',
      parts,
      crashIds,
      crashSeverity,
      growthRatePercent: 2,
    }
    siteList.add(site)
    activeSite.set(site.id)
    uploadOpen = false
  }

  // Whether this append is the 1→2 transition (shows the site-name field).
  const is1to2 = $derived.by(() => {
    if (groupDraft) return false
    const target = appendTargetSite
    return target !== null && target.parts.length === 1 && isAutoName(target.parts[0].name)
  })

  function startAddPart(site: Site) {
    draftTarget = { mode: 'append', siteId: site.id }
    draftType = site.type
    draftPartName = nextPartName(site.parts, partNameBase(site.type))
    partNameEdited = false
    draftSiteName = site.parts.length === 1 && isAutoName(site.parts[0].name)
      ? nextGroupName(siteList.get(), site.type)
      : ''
    siteNameEdited = false
    draftBuffer = site.parts[site.parts.length - 1].bufferFeet
    draftGeometry = null
    drawingState.setTool(site.type === 'roadway' ? 'roadway-line' : 'intersection-point')
  }

  // Redraw keeps the part's buffer and identity; only the geometry (and
  // therefore its crash set) changes on confirm. The part hides from
  // the map for the whole redraw, not just once a preview exists.
  function startRedrawPart(site: Site, part: SitePart) {
    editingPartBuffer = null
    draftTarget = { mode: 'replace', siteId: site.id, partId: part.id }
    draftType = site.type
    draftBuffer = part.bufferFeet
    draftGeometry = null
    draftSiteState.setHiddenPart({ siteId: site.id, partId: part.id })
    drawingState.setTool(site.type === 'roadway' ? 'roadway-line' : 'intersection-point')
  }

  function cancelDraft() {
    // Group draw flow ending at one part: demote to single so the
    // group name doesn't linger (a later append re-promotes cleanly).
    if (groupDraft && draftTarget.mode === 'append') {
      const targetId = draftTarget.siteId
      const target = siteList.get().find((s) => s.id === targetId)
      if (target && target.parts.length === 1) {
        const renames = demoteRenames(target, target.parts[0].id)
        if (renames) {
          siteList.updateSite(target.id, { name: renames.siteName })
          siteList.updatePart(target.id, target.parts[0].id, { name: renames.partName })
        }
      }
    }
    draftTarget = { mode: 'new' }
    draftType = null
    draftGeometry = null
    groupDraft = false
    groupNaming = false
    typeChoice = null
    draftSiteState.clear()
    draftSiteState.setHiddenPart(null)
    drawingState.setTool(null)
  }

  function redraw() {
    if (!draftType) return
    draftGeometry = null
    drawingState.setTool(draftType === 'roadway' ? 'roadway-line' : 'intersection-point')
  }

  export function receiveSiteGeometry(geometry: LineString | Point) {
    draftGeometry = geometry
  }

  let confirming = $state(false)
  const canConfirm = $derived(draftGeometry !== null && !confirming)

  async function resolveChoiceForCrashChange(site: Site) {
    const alternatives = projectState.getAlternatives(site.id)
    if (alternatives.length === 0) return null
    const profile = await siteCrashProfile(site)
    return resolveChosenAlternative(
      calculateSiteAlternatives(site, alternatives, profile),
      projectState.getPin(site.id),
    )
  }

  function storeResolvedChoice(siteId: string, chosen: Awaited<ReturnType<typeof resolveChoiceForCrashChange>>) {
    if (chosen) projectState.setChosen(siteId, chosen)
    else projectState.clearChosen(siteId)
  }

  async function confirmSite() {
    if (!draftType || !draftGeometry) return
    confirming = true
    try {
      if (draftTarget.mode === 'append') {
        const target = appendTargetSite
        if (!target) return
        const renames = groupDraft
          ? null
          : singleSitePromotionRenames(target, siteList.get())
        const part = await createPart({
          name: draftPartName,
          drawnGeometry: draftGeometry,
          bufferFeet: draftBuffer,
        })
        const nextSite = withSiteParts(target, [...target.parts, part])
        const chosen = await resolveChoiceForCrashChange(nextSite)
        if (renames) {
          siteList.updatePart(target.id, target.parts[0].id, { name: renames.partName })
          siteList.updateSite(target.id, { name: draftSiteName || renames.siteName })
        }
        siteList.addPart(target.id, part)
        storeResolvedChoice(target.id, chosen)
      } else if (draftTarget.mode === 'replace') {
        const target = replaceTargetPart
        if (!target) return
        const fields = await replacePartGeometry(target.part, draftGeometry)
        const nextSite = withSiteParts(
          target.site,
          target.site.parts.map((part) => (
            part.id === target.part.id ? { ...part, ...fields } : part
          )),
        )
        const chosen = await resolveChoiceForCrashChange(nextSite)
        siteList.updatePartBuffer(target.site.id, target.part.id, fields)
        storeResolvedChoice(target.site.id, chosen)
      } else {
        const site = await createSite({
          siteName: draftName,
          partName: groupDraft
            ? draftPartName
            : `${partNameBase(draftType)} 1`,
          type: draftType,
          drawnGeometry: draftGeometry,
          bufferFeet: draftBuffer,
        })
        siteList.add(site)
        if (groupDraft) {
          // Re-arm into append mode on the newly created site.
          draftTarget = { mode: 'append', siteId: site.id }
          draftPartName = nextPartName(site.parts, partNameBase(draftType))
          partNameEdited = false
          draftGeometry = null
          draftSiteState.clear()
          draftSiteState.setHiddenPart(null)
          drawingState.setTool(draftType === 'roadway' ? 'roadway-line' : 'intersection-point')
          return
        }
      }
      // Re-arm for group append mode (organic "+ Add" flow).
      if (groupDraft && draftTarget.mode === 'append') {
        const targetId = draftTarget.siteId
        const target = siteList.get().find((s) => s.id === targetId)
        if (target) {
          draftPartName = nextPartName(target.parts, partNameBase(draftType))
          partNameEdited = false
          draftGeometry = null
          draftSiteState.clear()
          draftSiteState.setHiddenPart(null)
          drawingState.setTool(draftType === 'roadway' ? 'roadway-line' : 'intersection-point')
          return
        }
      }
      draftTarget = { mode: 'new' }
      draftType = null
      draftGeometry = null
      groupDraft = false
      draftSiteState.clear()
      draftSiteState.setHiddenPart(null)
    } finally {
      confirming = false
    }
  }

  function toggleSite(siteId: string) {
    if (activeSite.get() === siteId && workbenchState.siteId) return
    editingSiteName = null
    activeSite.set(activeSite.get() === siteId ? null : siteId)
  }

  // Site rename is its own lightweight session (name only, no buffer
  // coupling): header swaps to an input, footer swaps to Cancel/Confirm.
  let editingSiteName = $state<string | null>(null)
  let siteNameValue = $state('')

  function startSiteRename(site: Site) {
    editingSiteName = site.id
    siteNameValue = site.name
  }

  function confirmSiteRename() {
    const name = siteNameValue.trim()
    if (editingSiteName && name) siteList.updateSite(editingSiteName, { name })
    editingSiteName = null
  }

  let removalCandidate = $state<Site | null>(null)

  function doRemoveSite(site: Site) {
    siteList.remove(site.id)
    projectState.removeBySite(site.id)
    if (activeSite.get() === site.id) activeSite.set(null)
  }

  // Two independent reasons a removal warrants a confirm: it discards
  // planning work (evaluated alternatives cascade out via projectState),
  // or it deletes more geometry than a single "Remove" click implies
  // (a multi-part site). A single-part site with no alternatives is
  // cheap and re-drawable, so it deletes straight.
  function requestRemoveSite(site: Site) {
    const hasPlanningWork = projectState.getAlternatives(site.id).length > 0
    if (site.parts.length > 1 || hasPlanningWork) {
      removalCandidate = site
    } else {
      doRemoveSite(site)
    }
  }

  function confirmRemoveSite() {
    if (removalCandidate) doRemoveSite(removalCandidate)
    removalCandidate = null
  }

  // Part rows only render at 2+ parts, so this never sees the last part;
  // the guard mirrors the store's min-1 invariant anyway.
  async function deletePart(site: Site, partId: string) {
    if (site.parts.length <= 1) return
    const survivorId = site.parts.find((p) => p.id !== partId)?.id
    const renames = survivorId && site.parts.length === 2 ? demoteRenames(site, survivorId) : null
    const nextSite = withSiteParts(site, site.parts.filter((part) => part.id !== partId))
    const chosen = await resolveChoiceForCrashChange(nextSite)
    siteList.removePart(site.id, partId)
    if (renames && survivorId) {
      siteList.updateSite(site.id, { name: renames.siteName })
      siteList.updatePart(site.id, survivorId, { name: renames.partName })
    }
    storeResolvedChoice(site.id, chosen)
    if (activeSite.getPart() === partId) activeSite.setPart(null)
  }

  let editingPartBuffer = $state<{ siteId: string; partId: string } | null>(null)
  let editingSiteBuffer = $state<string | null>(null)
  let siteBufferValue = $state(0)
  let siteBufferRequeueing = $state(false)

  const workflowMode = $derived<WorkflowMode>(
    draftType !== null ? 'drafting'
    : editingPartBuffer !== null ? 'editing-buffer'
    : editingSiteBuffer !== null ? 'editing-buffer'
    : 'idle'
  )

  const costK = getCrashCost('K')
  const costA = getCrashCost('A')
  const costB = getCrashCost('B')

  type ReductionUnit = 'count' | 'cost'
  let reductionUnit = $state<ReductionUnit>('count')

  const crashReduction = $derived.by(() => {
    const sites = siteList.get()
    let countTotal = 0
    let countPrevented = 0
    let costTotal = 0
    let costPrevented = 0
    let planned = 0
    for (const s of sites) {
      countTotal += s.crashIds.length
      const sev = s.crashSeverity
      costTotal += sev.K * costK + sev.A * costA + sev.B * costB
      const chosen = projectState.getChosen(s.id)
      if (chosen) {
        planned += 1
        const p = chosen.prevented
        countPrevented += p.K + p.A + p.B
        costPrevented += p.K * costK + p.A * costA + p.B * costB
      }
    }
    return {
      count: {
        total: countTotal,
        prevented: countPrevented,
        pct: countTotal > 0 ? (countPrevented / countTotal) * 100 : 0,
      },
      cost: {
        total: costTotal,
        prevented: costPrevented,
        pct: costTotal > 0 ? (costPrevented / costTotal) * 100 : 0,
      },
      planned,
      siteCount: sites.length,
    }
  })

  let partBufferValue = $state(0)
  let partNameValue = $state('')
  let requeueing = $state(false)
  let pendingBufferChange = $state<'part' | 'site' | null>(null)

  // Measured height of the selected part's expanded region. The scroll
  // list grows by this so the expanded card is fully visible without
  // eating into the ~5 rows the base height shows. offsetHeight is a
  // Svelte readonly dimension binding (ResizeObserver under the hood),
  // so it stays in sync as the region switches between the Edit/Delete
  // buttons and the taller edit form.
  const PART_LIST_BASE_MAX = 144
  let expandedPartH = $state(0)

  const editingBufferPart = $derived.by(() => {
    const t = editingPartBuffer
    if (!t) return null
    const site = siteList.get().find((s) => s.id === t.siteId)
    const part = site?.parts.find((p) => p.id === t.partId)
    return site && part ? { site, part } : null
  })

  // One edit session for both entry points: the card-level "Edit site"
  // on single-part sites (edits parts[0], no rename) and the per-part
  // row Edit. Same state, same live preview, same confirm; Cancel
  // discards the name along with the buffer.
  function startPartEdit(site: Site, part: SitePart) {
    editingPartBuffer = { siteId: site.id, partId: part.id }
    partBufferValue = part.bufferFeet
    partNameValue = part.name
  }

  function updatePartName(site: Site, part: SitePart) {
    const name = partNameValue.trim()
    if (name && name !== part.name) {
      siteList.updatePart(site.id, part.id, { name })
    }
  }

  function confirmPartEdit() {
    const target = editingBufferPart
    if (!target) {
      editingPartBuffer = null
      return
    }
    if (partBufferValue === target.part.bufferFeet) {
      updatePartName(target.site, target.part)
      editingPartBuffer = null
      return
    }
    if (projectState.getAlternatives(target.site.id).length > 0) {
      pendingBufferChange = 'part'
      return
    }
    void applyPartEdit()
  }

  async function applyPartEdit() {
    const target = editingBufferPart
    if (!target) return
    requeueing = true
    try {
      const fields = await requeryPartBuffer(target.part, partBufferValue)
      const nextSite = withSiteParts(
        target.site,
        target.site.parts.map((part) => (
          part.id === target.part.id ? { ...part, ...fields } : part
        )),
      )
      const chosen = await resolveChoiceForCrashChange(nextSite)
      updatePartName(target.site, target.part)
      siteList.updatePartBuffer(target.site.id, target.part.id, fields)
      storeResolvedChoice(target.site.id, chosen)
      editingPartBuffer = null
    } finally {
      requeueing = false
    }
  }

  $effect(() => {
    const target = editingBufferPart
    if (!target) return
    const buffered = turfBuffer(target.part.drawnGeometry, partBufferValue, { units: 'feet' })
    if (buffered) {
      draftSiteState.set({
        type: target.site.type,
        geometry: target.part.drawnGeometry,
        bufferFeet: partBufferValue,
        bufferPolygon: buffered.geometry as Polygon,
        editingSiteId: target.site.id,
        editingPartId: target.part.id,
      })
    }
    return () => { draftSiteState.clear() }
  })

  const editingSiteBufferSite = $derived.by(() => {
    if (!editingSiteBuffer) return null
    return siteList.get().find((s) => s.id === editingSiteBuffer) ?? null
  })

  function startSiteBufferEdit(site: Site) {
    editingSiteBuffer = site.id
    siteBufferValue = site.parts[0].bufferFeet
    activeSite.setPart(null)
  }

  function requestSiteBufferConfirmation() {
    const site = editingSiteBufferSite
    if (!site) { editingSiteBuffer = null; return }
    if (siteBufferValue === site.parts[0].bufferFeet && site.parts.every((p) => p.bufferFeet === siteBufferValue)) {
      editingSiteBuffer = null
      draftSiteState.setSiteBufferPreview(null)
      return
    }
    if (projectState.getAlternatives(site.id).length > 0) {
      pendingBufferChange = 'site'
      return
    }
    void applySiteBufferEdit()
  }

  async function applySiteBufferEdit() {
    const site = editingSiteBufferSite
    if (!site) return
    siteBufferRequeueing = true
    try {
      const allFields = await requerySiteBuffer(site.parts, siteBufferValue)
      const nextSite = withSiteParts(
        site,
        site.parts.map((part, index) => ({ ...part, ...allFields[index] })),
      )
      const chosen = await resolveChoiceForCrashChange(nextSite)
      siteList.updateSiteBuffer(site.id, allFields)
      storeResolvedChoice(site.id, chosen)
      editingSiteBuffer = null
      draftSiteState.setSiteBufferPreview(null)
    } finally {
      siteBufferRequeueing = false
    }
  }

  async function confirmPendingBufferChange() {
    const change = pendingBufferChange
    pendingBufferChange = null
    if (change === 'part') await applyPartEdit()
    else if (change === 'site') await applySiteBufferEdit()
  }

  function cancelSiteBufferEdit() {
    editingSiteBuffer = null
    draftSiteState.setSiteBufferPreview(null)
  }

  $effect(() => {
    const site = editingSiteBufferSite
    if (!site) return
    const previews = new Map<string, Polygon>()
    for (const part of site.parts) {
      const buffered = turfBuffer(part.drawnGeometry, siteBufferValue, { units: 'feet' })
      if (buffered) previews.set(part.id, buffered.geometry as Polygon)
    }
    draftSiteState.setSiteBufferPreview({ siteId: site.id, previews })
    return () => { draftSiteState.setSiteBufferPreview(null) }
  })

  function siteLength(site: Site): string | null {
    if (site.type !== 'roadway') return null
    let mi = 0
    for (const p of site.parts) {
      mi += turfLength({ type: 'Feature', geometry: p.drawnGeometry, properties: {} }, { units: 'miles' })
    }
    return mi.toFixed(2)
  }

  function partLengthMi(part: SitePart): string {
    return turfLength({ type: 'Feature', geometry: part.drawnGeometry, properties: {} }, { units: 'miles' }).toFixed(2)
  }

  $effect(() => {
    if (draftType && draftGeometry) {
      const buffered = turfBuffer(draftGeometry, draftBuffer, { units: 'feet' })
      if (buffered) {
        draftSiteState.set({
          type: draftType,
          geometry: draftGeometry,
          bufferFeet: draftBuffer,
          bufferPolygon: buffered.geometry as Polygon,
        })
      }
    } else {
      draftSiteState.clear()
    }
  })

  function handleKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape') return
    if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return
    if (typeChoice && !draftType) { typeChoice = null; return }
    if (!draftType) return
    if (groupNaming) { cancelDraft(); return }
    if (drawingState.hasInProgressDraw()) return
    cancelDraft()
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="flex h-full flex-col">
  {#if viewMode.get() === 'diagnosis'}
  <div class="shrink-0 border-b px-4 py-3">
    <span class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {#if draftType && draftTarget.mode === 'append'}Add {draftType === 'intersection' ? 'an intersection' : 'a segment'}
      {:else if draftType && draftTarget.mode === 'replace'}Redraw {draftType === 'intersection' ? 'an intersection' : 'a segment'}
      {:else if draftType && groupDraft}Add a {draftType === 'intersection' ? 'intersection' : 'roadway'} group
      {:else}Add a site{/if}
    </span>

    {#if !draftType}
      <div class="mt-2 flex flex-col gap-2">
        {#if !typeChoice}
          <div class="grid grid-cols-2 gap-2">
            <button
              class="flex flex-col items-center gap-1 rounded-md border border-border bg-background px-3 py-2.5 hover:border-foreground/30 hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
              onclick={() => { typeChoice = 'roadway' }}
              disabled={workflowMode !== 'idle'}
            >
              <Route size={18} class="text-muted-foreground" />
              <span class="text-sm font-medium">Roadway</span>
              <span class="text-xs text-muted-foreground">line along a corridor</span>
            </button>
            <button
              class="flex flex-col items-center gap-1 rounded-md border border-border bg-background px-3 py-2.5 hover:border-foreground/30 hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
              onclick={() => { typeChoice = 'intersection' }}
              disabled={workflowMode !== 'idle'}
            >
              <CircleDot size={18} class="text-muted-foreground" />
              <span class="text-sm font-medium">Intersection</span>
              <span class="text-xs text-muted-foreground">point at a node</span>
            </button>
          </div>
        {:else}
          <div class="flex items-center gap-2 text-xs text-muted-foreground">
            <span class="rounded bg-primary px-1.5 py-0.5 font-bold text-primary-foreground">
              {typeChoice === 'intersection' ? 'INT' : 'RDWY'}
            </span>
            <span class="font-medium text-foreground">{typeChoice === 'intersection' ? 'Intersection' : 'Roadway'}</span>
            <button class="ml-auto text-xs text-muted-foreground hover:text-foreground" onclick={() => { typeChoice = null }}>Change</button>
          </div>
          <div class="grid grid-cols-3 gap-2">
            <button
              class="flex flex-col items-center gap-1 rounded-md border border-border bg-background px-3 py-2.5 hover:border-foreground/30 hover:bg-muted"
              onclick={() => startDraw(typeChoice!)}
            >
              {#if typeChoice === 'roadway'}
                <Route size={18} class="text-muted-foreground" />
              {:else}
                <CircleDot size={18} class="text-muted-foreground" />
              {/if}
              <span class="text-sm font-medium">Single</span>
              <span class="text-xs text-muted-foreground">draw one</span>
            </button>
            <button
              class="flex flex-col items-center gap-1 rounded-md border border-border bg-background px-3 py-2.5 hover:border-foreground/30 hover:bg-muted"
              onclick={() => startGroupDraw(typeChoice!)}
            >
              <Layers size={18} class="text-muted-foreground" />
              <span class="text-sm font-medium">Group</span>
              <span class="text-xs text-muted-foreground">draw several</span>
            </button>
            <button
              class="flex flex-col items-center gap-1 rounded-md border border-border bg-background px-3 py-2.5 hover:border-foreground/30 hover:bg-muted"
              onclick={() => startUpload(typeChoice!)}
            >
              <Upload size={18} class="text-muted-foreground" />
              <span class="text-sm font-medium">From file</span>
              <span class="text-xs text-muted-foreground">.shp, .geojson</span>
            </button>
          </div>
        {/if}
      </div>
    {:else if groupNaming}
      <div class="relative mt-2 rounded-md border border-border bg-muted/50 p-3">
        <div class="absolute top-2 right-2">
          <Button variant="destructive" size="xs" class="text-xs" onclick={cancelDraft}>Cancel</Button>
        </div>
        <div class="mt-1">
          <label class="text-xs font-medium text-muted-foreground" for="draft-group-name">Group name</label>
          <Input
            id="draft-group-name"
            bind:value={draftName}
            oninput={() => { nameEdited = true }}
            onfocus={(e) => { if (!nameEdited) e.currentTarget.select() }}
            class="mt-1 h-7 text-xs"
          />
        </div>
        <div class="mt-3">
          <Button size="sm" class="w-full text-xs" disabled={!draftName.trim()} onclick={continueGroupDraw}>
            Continue to draw first {draftType === 'intersection' ? 'intersection' : 'segment'}
          </Button>
        </div>
      </div>
    {:else}
      {@const cfg = DEFAULTS[draftType]}
      <div class="relative mt-2 rounded-md border border-border bg-muted/50 p-3">
        <div class="absolute top-2 right-2">
          <Button variant={groupDraft && !draftGeometry ? 'outline' : 'destructive'} size="xs" class="text-xs" onclick={cancelDraft}>
            {groupDraft && !draftGeometry ? 'Done' : 'Cancel'}
          </Button>
        </div>
        <div class="flex items-center gap-2">
          <span class="rounded bg-primary px-1.5 py-0.5 text-xs font-bold text-primary-foreground">
            {draftType === 'intersection' ? 'INT' : 'RDWY'}
          </span>
          {#if !draftGeometry}
            <span class="flex items-center gap-1.5 pr-16 text-xs text-muted-foreground">
              <span class="inline-block size-1.5 animate-pulse rounded-full bg-primary"></span>
              {draftType === 'intersection' ? 'click the map to place' : 'click to draw, double-click to finish'}
            </span>
          {:else}
            <span class="text-xs text-green-600">Geometry drawn</span>
          {/if}
        </div>

        {#if draftTarget.mode === 'append' && appendTargetSite}
          {#if is1to2}
            <div class="mt-3">
              <label class="text-xs font-medium text-muted-foreground" for="draft-site-name">Site name</label>
              <Input
                id="draft-site-name"
                bind:value={draftSiteName}
                oninput={() => { siteNameEdited = true }}
                onfocus={(e) => { if (!siteNameEdited) e.currentTarget.select() }}
                class="mt-1 h-7 text-xs"
              />
            </div>
            <p class="mt-1.5 text-[10px] leading-snug text-muted-foreground">
              "{appendTargetSite.name}" becomes the first {partNoun(appendTargetSite.type)}.
            </p>
          {/if}
          <div class="mt-3">
            <label class="text-xs font-medium text-muted-foreground" for="draft-part-name">{draftType === 'intersection' ? 'Intersection' : 'Segment'} name</label>
            <Input
              id="draft-part-name"
              bind:value={draftPartName}
              oninput={() => { partNameEdited = true }}
              onfocus={(e) => { if (!partNameEdited) e.currentTarget.select() }}
              class="mt-1 h-7 text-xs"
            />
          </div>
          <p class="mt-1.5 text-[10px] leading-snug text-muted-foreground">
            {#if is1to2}
              Grouped {partNoun(appendTargetSite.type)}s are analyzed together: one crash set, one countermeasure plan.
            {:else}
              Added to {appendTargetSite.name}. Grouped {partNoun(appendTargetSite.type)}s are analyzed together: one crash set, one countermeasure plan. Crashes in overlapping buffers count once.
            {/if}
          </p>
        {:else if draftTarget.mode === 'replace' && replaceTargetPart}
          <p class="mt-3 text-[10px] leading-snug text-muted-foreground">
            Redrawing <span class="font-medium text-foreground">{replaceTargetPart.part.name}</span> of {replaceTargetPart.site.name}.
            It keeps its {replaceTargetPart.part.bufferFeet} ft buffer; its crash set updates on confirm.
          </p>
        {:else if groupDraft}
          <div class="mt-3">
            <label class="text-xs font-medium text-muted-foreground" for="draft-group-part-name">{draftType === 'intersection' ? 'Intersection' : 'Segment'} name</label>
            <Input
              id="draft-group-part-name"
              bind:value={draftPartName}
              oninput={() => { partNameEdited = true }}
              onfocus={(e) => { if (!partNameEdited) e.currentTarget.select() }}
              class="mt-1 h-7 text-xs"
            />
          </div>
        {:else}
          <div class="mt-3">
            <label class="text-xs font-medium text-muted-foreground" for="draft-name">Site name</label>
            <Input
              id="draft-name"
              bind:value={draftName}
              oninput={() => { nameEdited = true }}
              onfocus={(e) => { if (!nameEdited) e.currentTarget.select() }}
              placeholder="e.g. Main St near 14th"
              class="mt-1 h-7 text-xs"
            />
          </div>
        {/if}

        {#if draftTarget.mode !== 'replace'}
          <div class="mt-3">
            <label class="text-xs font-medium text-muted-foreground" for="draft-buffer">Buffer</label>
            <BufferControl
              id="draft-buffer"
              bind:value={draftBuffer}
              min={cfg.sliderMin}
              max={cfg.sliderMax}
              step={cfg.step}
              inputMax={cfg.inputMax}
              class="mt-1"
            />
          </div>
        {/if}

        <div class="mt-3 flex gap-2">
          {#if draftGeometry}
            <Button variant="outline" size="sm" class="flex-1 text-xs" onclick={redraw}>
              Redraw
            </Button>
          {/if}
          <Button
            size="sm"
            class="flex-1 text-xs"
            disabled={!canConfirm}
            onclick={confirmSite}
          >
            {#if confirming}
              <LoaderCircle size={14} class="animate-spin" />
            {:else if !draftGeometry}
              Draw on map
            {:else if draftTarget.mode === 'append'}
              Confirm {draftType === 'intersection' ? 'intersection' : 'segment'}
            {:else if draftTarget.mode === 'replace'}
              Confirm redraw
            {:else}
              Confirm site
            {/if}
          </Button>
        </div>
      </div>
    {/if}
  </div>
  {/if}

  <div class="min-h-0 flex-1 overflow-auto border-b px-4 py-3">
    {#if siteList.get().length > 0}
      <div class="flex items-center justify-between">
        <span class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Sites</span>
        <span class="text-xs text-muted-foreground">
            {siteList.get().length} Site(s)
        </span>
      </div>

      {#if viewMode.get() === 'planning'}
        {@const r = crashReduction[reductionUnit]}
        {@const isCost = reductionUnit === 'cost'}
        {@const fmtCost = (v: number) => v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : `$${(v / 1_000).toFixed(0)}K`}
        {@const fmt = (v: number, int = false) => isCost
          ? fmtCost(v)
          : int ? String(Math.round(v)) : v < 0.05 ? '0' : v.toFixed(1)}
        <div class="mt-2 rounded-md border bg-muted/30 px-3 py-2.5">
          <div class="flex items-baseline justify-between">
            <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Potential Crash reduction across all sites
            </span>
            <span class="font-mono text-base font-bold tabular-nums text-emerald-600">
              {r.pct < 0.05 ? '0' : r.pct.toFixed(1)}%
            </span>
          </div>
          <Tooltip.Provider>
            <Tooltip.Root>
              <Tooltip.Trigger class="w-full">
                <div
                  class="relative mt-1.5 h-4 overflow-hidden rounded border border-red-300 bg-red-200"
                >
                  <div
                    class="absolute inset-y-0 right-0 min-w-0.5 border-l-2 border-emerald-600 transition-[width] duration-300"
                    style="width: {Math.min(100, r.pct)}%; background-image: repeating-linear-gradient(45deg, #7ab66f 0, #7ab66f 5px, #a6d4a0 5px, #a6d4a0 10px);"
                  ></div>
                </div>
              </Tooltip.Trigger>
              <Tooltip.Content class="max-w-62 text-center">
                {fmt(r.prevented)} of {fmt(r.total, true)} KAB {isCost ? 'crash cost' : 'crashes'} potentially prevented across {crashReduction.planned} planned site{crashReduction.planned === 1 ? '' : 's'}
              </Tooltip.Content>
            </Tooltip.Root>
          </Tooltip.Provider>
          <div class="mt-1.5 flex items-center justify-between">
            <div class="font-mono text-xs tabular-nums text-muted-foreground">
              <div>
                Total <b class="font-bold text-foreground">{fmt(r.total, true)}</b>
                <b class="font-bold text-emerald-600">({r.prevented < 0.05 ? '−0' : '−' + fmt(r.prevented)})</b>
                KAB {isCost ? 'crash cost' : 'crashes'}
              </div>
              <div class="mt-0.5">
                {crashReduction.planned}/{crashReduction.siteCount} sites planned
              </div>
            </div>
            <div class="inline-flex shrink-0 rounded-full border bg-muted/50 p-0.5 text-[11px] font-semibold">
              <button
                class="rounded-full px-2.5 py-0.5 transition-colors {reductionUnit === 'count' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}"
                onclick={() => reductionUnit = 'count'}
              >Crashes</button>
              <button
                class="rounded-full px-2.5 py-0.5 transition-colors {reductionUnit === 'cost' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}"
                onclick={() => reductionUnit = 'cost'}
              >Cost</button>
            </div>
          </div>
        </div>
      {/if}

      <div class="mt-2 flex flex-col gap-1">
        {#each siteList.get() as site (site.id)}
          {@const isActive = activeSite.get() === site.id}
          {@const dimmed = !!workbenchState.siteId && !isActive}
          {@const len = siteLength(site)}
          {@const cfg = DEFAULTS[site.type]}
          {@const siteAlts = projectState.getAlternatives(site.id)}
          {@const altCount = siteAlts.filter((a) => a.constructionCost != null).length}
          {@const chosen = projectState.getChosen(site.id)}
          <div class="relative rounded-md border text-xs transition-colors {isActive ? 'border-primary bg-muted' : 'border-border bg-background'} {dimmed ? 'opacity-40' : ''}">
            {#if editingSiteName === site.id}
              <div class="flex items-center gap-2 px-3 py-3">
                <span class="rounded bg-primary px-1.5 py-0.5 text-xs font-bold text-primary-foreground">
                  {siteBadgeLabel(site.type, site.parts.length)}
                </span>
                {#if site.source === 'upload'}
                  <span class="rounded border border-muted-foreground/30 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">UPLOADED</span>
                {/if}
                <Input
                  bind:value={siteNameValue}
                  class="h-7 flex-1 text-xs"
                  aria-label="Site name"
                  onkeydown={(e) => { if (e.key === 'Enter') confirmSiteRename(); else if (e.key === 'Escape') editingSiteName = null }}
                />
                <Pencil size={12} class="shrink-0 text-muted-foreground" />
              </div>
            {:else}
            {@const showPencil = isActive && workflowMode === 'idle' && !dimmed}
            <button
              class="w-full px-3 py-3 text-left hover:bg-muted/50 disabled:pointer-events-none disabled:opacity-50"
              onclick={() => toggleSite(site.id)}
              disabled={workflowMode !== 'idle' || dimmed}
            >
              <div class="flex items-center gap-2 {showPencil ? 'pr-6' : ''}">
                <span class="rounded bg-primary px-1.5 py-0.5 text-xs font-bold text-primary-foreground">
                  {siteBadgeLabel(site.type, site.parts.length)}
                </span>
                {#if site.source === 'upload'}
                  <span class="rounded border border-muted-foreground/30 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">UPLOADED</span>
                {/if}
                <span class="flex-1 truncate text-sm font-medium">{site.name}</span>
              </div>
              <div class="mt-1 flex items-center gap-3 text-xs pt-1 text-muted-foreground">
                <span>{site.crashIds.length} crashes</span>
                {#if len}
                  <span>{len} mi · {bufferRange(site)} ft</span>
                {:else}
                  <span>{bufferRange(site)} ft radius</span>
                {/if}
                {#if site.parts.length > 1}
                  <span class="ml-auto shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-semibold">
                    {partCountLabel(site.type, site.parts.length)}
                  </span>
                {/if}
              </div>
              {#if viewMode.get() === 'planning'}
                <div class="mt-1 pt-0.5 text-xs font-medium">
                  {#if chosen}
                    <span class="text-emerald-600">{altCount} countermeasure{altCount === 1 ? '' : 's'} evaluated</span>
                  {:else}
                    <span class="text-amber-600">Not yet planned</span>
                  {/if}
                </div>
              {/if}
            </button>
            {#if showPencil}
              <button
                class="absolute top-3 right-3 rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
                aria-label="Rename site"
                onclick={() => startSiteRename(site)}
              >
                <Pencil size={12} />
              </button>
            {/if}
            {/if}

            {#if isActive}
              <div class="border-t border-border px-3 py-2">
                {#if site.parts.length > 1}
                  <div class="mb-2">
                    <p class="text-[10px] leading-snug text-muted-foreground">
                      Grouped {partNoun(site.type)}s are analyzed together: one crash set, one countermeasure plan.
                    </p>
                    <div
                      class="mt-1.5 flex flex-col gap-1 overflow-y-auto"
                      style="max-height: {PART_LIST_BASE_MAX + (activeSite.getPart() ? expandedPartH : 0)}px"
                    >
                      {#each site.parts as part (part.id)}
                        {@const isPartSelected = activeSite.getPart() === part.id}
                        {@const isRowEditing = editingPartBuffer?.siteId === site.id && editingPartBuffer?.partId === part.id}
                        <div class="rounded border text-xs {isPartSelected ? 'border-primary bg-muted' : 'border-border/60 bg-background'}">
                          {#if isRowEditing}
                            <div class="flex items-center gap-1.5 px-2 py-1">
                              <Input bind:value={partNameValue} class="h-7 flex-1 text-xs" aria-label="{partNoun(site.type)} name" />
                              <Pencil size={12} class="shrink-0 text-muted-foreground" />
                            </div>
                          {:else}
                            <button
                              class="w-full px-2 py-1 text-left hover:bg-muted/50 disabled:pointer-events-none"
                              onclick={() => activeSite.setPart(isPartSelected ? null : part.id)}
                              disabled={workflowMode !== 'idle'}
                            >
                              <div class="flex items-center gap-2">
                                <span class="min-w-0 flex-1 truncate text-xs font-medium">{part.name}</span>
                                <span class="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                                  {#if site.type === 'roadway'}{partLengthMi(part)} mi · {/if}{part.bufferFeet} ft
                                </span>
                              </div>
                            </button>
                          {/if}
                          {#if isPartSelected && viewMode.get() === 'diagnosis'}
                            <div class="border-t border-border/60 px-2 py-1.5" bind:offsetHeight={expandedPartH}>
                              {#if isRowEditing}
                                <label class="text-xs font-medium text-muted-foreground" for="part-buffer-{part.id}">Buffer</label>
                                <BufferControl
                                  id="part-buffer-{part.id}"
                                  bind:value={partBufferValue}
                                  min={cfg.sliderMin}
                                  max={cfg.sliderMax}
                                  step={cfg.step}
                                  inputMax={cfg.inputMax}
                                  class="mt-1"
                                />
                                <div class="mt-2 flex gap-1.5">
                                  {#if site.source !== 'upload'}
                                  <Button variant="outline" size="xs" class="flex-1 text-xs" onclick={() => startRedrawPart(site, part)}>
                                    Redraw
                                  </Button>
                                  {/if}
                                  <Button variant="outline" size="xs" class="flex-1 text-xs" onclick={() => { editingPartBuffer = null }}>
                                    Cancel
                                  </Button>
                                  <Button size="xs" class="flex-1 text-xs" disabled={requeueing} onclick={confirmPartEdit}>
                                    {#if requeueing}
                                      <LoaderCircle size={12} class="animate-spin" />
                                    {:else}
                                      Confirm
                                    {/if}
                                  </Button>
                                </div>
                              {:else}
                                <div class="flex gap-1.5">
                                  <Button variant="outline" size="xs" class="flex-1 text-xs" disabled={workflowMode !== 'idle'} onclick={() => startPartEdit(site, part)}>
                                    Edit
                                  </Button>
                                  <Button variant="outline" size="xs" class="flex-1 text-xs text-destructive hover:text-destructive" disabled={workflowMode !== 'idle'} onclick={() => deletePart(site, part.id)}>
                                    Delete
                                  </Button>
                                </div>
                              {/if}
                            </div>
                          {/if}
                        </div>
                      {/each}
                    </div>
                  </div>
                {/if}
                {#if editingSiteName === site.id}
                  <div class="flex gap-2">
                    <Button variant="outline" size="xs" class="flex-1 text-xs" onclick={() => { editingSiteName = null }}>
                      Cancel
                    </Button>
                    <Button size="xs" class="flex-1 text-xs" disabled={!siteNameValue.trim()} onclick={confirmSiteRename}>
                      Confirm
                    </Button>
                  </div>
                {:else if workbenchState.siteId === site.id}
                  <span class="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span class="inline-block size-1.5 animate-pulse rounded-full bg-primary"></span>
                    Planning in progress
                  </span>
                {:else if viewMode.get() === 'planning'}
                  <Button size="sm" class="w-full text-xs" onclick={() => workbenchState.open(site.id)}>
                    Plan Improvements <CircleArrowRight size={14} />
                  </Button>
                {:else if editingPartBuffer?.siteId === site.id && site.parts.length === 1}
                  <label class="text-xs font-medium text-muted-foreground" for="site-buffer-{site.id}">Buffer</label>
                  <BufferControl
                    id="site-buffer-{site.id}"
                    bind:value={partBufferValue}
                    min={cfg.sliderMin}
                    max={cfg.sliderMax}
                    step={cfg.step}
                    inputMax={cfg.inputMax}
                    class="mt-1"
                  />
                  <div class="mt-2 flex gap-2">
                    {#if site.source !== 'upload'}
                    <Button variant="outline" size="xs" class="flex-1 text-xs" onclick={() => startRedrawPart(site, site.parts[0])}>
                      Redraw
                    </Button>
                    {/if}
                    <Button variant="outline" size="xs" class="flex-1 text-xs" onclick={() => { editingPartBuffer = null }}>
                      Cancel
                    </Button>
                    <Button size="xs" class="flex-1 text-xs" disabled={requeueing} onclick={confirmPartEdit}>
                      {#if requeueing}
                        <LoaderCircle size={12} class="animate-spin" />
                      {:else}
                        Confirm
                      {/if}
                    </Button>
                  </div>
                {:else if editingSiteBuffer === site.id && site.parts.length > 1}
                  <label class="text-xs font-medium text-muted-foreground" for="site-buffer-all-{site.id}">Buffer</label>
                  <BufferControl
                    id="site-buffer-all-{site.id}"
                    bind:value={siteBufferValue}
                    min={cfg.sliderMin}
                    max={cfg.sliderMax}
                    step={cfg.step}
                    inputMax={cfg.inputMax}
                    class="mt-1"
                  />
                  <p class="mt-1 text-[10px] text-destructive">
                    Changes buffer for all {partCountLabel(site.type, site.parts.length)}
                  </p>
                  <div class="mt-2 flex gap-2">
                    <Button variant="outline" size="xs" class="flex-1 text-xs" onclick={cancelSiteBufferEdit}>
                      Cancel
                    </Button>
                    <Button size="xs" class="flex-1 text-xs" disabled={siteBufferRequeueing} onclick={requestSiteBufferConfirmation}>
                      {#if siteBufferRequeueing}
                        <LoaderCircle size={12} class="animate-spin" />
                      {:else}
                        Confirm
                      {/if}
                    </Button>
                  </div>
                {:else}
                  <div class="flex gap-2">
                    {#if site.source !== 'upload'}
                    <Button variant="outline" size="xs" class="flex-1 text-xs" disabled={workflowMode !== 'idle'} onclick={() => startAddPart(site)}>
                      + Add
                    </Button>
                    {/if}
                    {#if site.parts.length === 1}
                      <Button variant="outline" size="xs" class="flex-1 text-xs" disabled={workflowMode !== 'idle'} onclick={() => startPartEdit(site, site.parts[0])}>
                        Edit site
                      </Button>
                    {/if}
                    {#if site.parts.length > 1}
                      <Button variant="outline" size="xs" class="flex-1 text-xs" disabled={workflowMode !== 'idle'} onclick={() => startSiteBufferEdit(site)}>
                        Change buffer for all
                      </Button>
                    {/if}
                    <Button variant="destructive" size="xs" class="text-xs" disabled={workflowMode !== 'idle'} onclick={() => requestRemoveSite(site)}>
                      Remove {site.parts.length > 1 ? 'group' : 'site'}
                    </Button>
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>

  {#if viewMode.get() === 'diagnosis'}
    <div class="shrink-0 border-t px-4 py-3">
      <Button
        class="w-full text-xs"
        disabled={siteList.get().length === 0}
        onclick={() => viewMode.set('planning')}
      >
        Plan Countermeasures <CircleArrowRight size={14} />
      </Button>
    </div>
  {:else}
    <div class="shrink-0 border-t px-4 py-3">
      {#if hasPlannedSites && !workbenchState.siteId}
        <Button class="w-full text-xs" onclick={() => (exportOpen = true)}>
          <Download size={14} />
          Export Planning Report
        </Button>
      {:else}
        <Tooltip.Provider>
          <Tooltip.Root>
            <Tooltip.Trigger class="w-full">
              <Button class="w-full text-xs" disabled>
                <Download size={14} />
                Export Planning Report
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content>{workbenchState.siteId ? 'Close the workbench first' : 'No sites have a selected countermeasure yet'}</Tooltip.Content>
          </Tooltip.Root>
        </Tooltip.Provider>
      {/if}
    </div>
  {/if}
</div>

<AlertDialog.Root open={pendingBufferChange !== null} onOpenChange={(open) => { if (!open) pendingBufferChange = null }}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Recalculate this planned site?</AlertDialog.Title>
      <AlertDialog.Description>
        Changing the buffer will recalculate crash data, SII, prevented crashes, and the recommended alternative.
        Your alternatives, costs, notes, and preferred pin will be kept. Review the site plan after recalculation.
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
      <AlertDialog.Action onclick={confirmPendingBufferChange}>Recalculate results</AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root open={removalCandidate !== null} onOpenChange={(open) => { if (!open) removalCandidate = null }}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Remove {removalCandidate?.name}?</AlertDialog.Title>
      <AlertDialog.Description>
        {#if removalCandidate}
          {@const altCount = projectState.getAlternatives(removalCandidate.id).length}
          This deletes the site{removalCandidate.parts.length > 1 ? ` and its ${partCountLabel(removalCandidate.type, removalCandidate.parts.length)}` : ''}.
          {#if altCount > 0}
            Its {altCount} evaluated alternative{altCount === 1 ? '' : 's'} will be discarded.
          {/if}
        {/if}
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
      <AlertDialog.Action onclick={confirmRemoveSite}>Remove {removalCandidate && removalCandidate.parts.length > 1 ? 'group' : 'site'}</AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

<SiteUploadDialog bind:open={uploadOpen} siteType={uploadType} onConfirm={handleUploadConfirm} />
<ExportDialog bind:open={exportOpen} />
