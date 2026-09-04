import type { Alternative, ChosenAlt } from '../types'
import { getByWorkcode } from '../data/countermeasureCatalog'
import { register } from './sessionRegistry'

// chosenBySite is included even though the workbench refreshes it:
// it is stored state, not derived on read, and without it a restored
// session (or loaded fixture) would show zero report-includable sites
// until the user revisits every site's workbench.
export type ProjectStateSnapshot = {
  alternatives: Alternative[]
  pinnedBySite: Record<string, string>
  chosenBySite: Record<string, ChosenAlt>
}

let alternatives = $state<Alternative[]>([])
// siteId -> the user-pinned (preferred) alternative id for that site.
let pinnedBySite = $state<Record<string, string>>({})
// siteId -> the resolved chosen alternative for that site. Distinct from
// pinnedBySite: pinnedBySite is the user's explicit input; chosenBySite is the
// resolved output (explicit pin, else SII auto-pick) plus its prevented-crash
// count. The workbench refreshes it after planning input changes, and buffer
// confirmation refreshes it after the site's crash set changes.
let chosenBySite = $state<Record<string, ChosenAlt>>({})

export const projectState = {
  getAlternatives(siteId: string): Alternative[] {
    return alternatives.filter((a) => a.siteId === siteId)
  },

  getAddedWorkcodes(siteId: string): Set<string> {
    return new Set(
      alternatives.filter((a) => a.siteId === siteId).map((a) => a.workcode),
    )
  },

  addAlternative(siteId: string, workcode: string): void {
    if (alternatives.some((a) => a.siteId === siteId && a.workcode === workcode)) return
    const cm = getByWorkcode(workcode)
    if (!cm) return
    alternatives = [
      ...alternatives,
      {
        id: `alt:${crypto.randomUUID()}`,
        siteId,
        workcode,
        constructionCost: null,
        annualMaintenance: null,
        serviceLife: cm.serviceLife,
      },
    ]
  },

  // Removal clears both references that can point at the deleted alternative.
  // The workbench effect re-resolves chosen after its own edits, but the store
  // must not depend on that: a dangling chosenBySite entry keeps the site in
  // the report (assembleReport includes any site with a chosen alt) with no
  // alternative flagged as chosen.
  removeAlternative(siteId: string, alternativeId: string): void {
    alternatives = alternatives.filter(
      (a) => !(a.siteId === siteId && a.id === alternativeId),
    )
    if (pinnedBySite[siteId] === alternativeId) this.unpin(siteId)
    if (chosenBySite[siteId]?.altId === alternativeId) this.clearChosen(siteId)
  },

  removeByWorkcode(siteId: string, workcode: string): void {
    const removedIds = new Set(
      alternatives
        .filter((a) => a.siteId === siteId && a.workcode === workcode)
        .map((a) => a.id),
    )
    alternatives = alternatives.filter(
      (a) => !(a.siteId === siteId && a.workcode === workcode),
    )
    if (removedIds.has(pinnedBySite[siteId])) this.unpin(siteId)
    const chosenId = chosenBySite[siteId]?.altId
    if (chosenId !== undefined && removedIds.has(chosenId)) this.clearChosen(siteId)
  },

  removeBySite(siteId: string): void {
    alternatives = alternatives.filter((a) => a.siteId !== siteId)
    this.unpin(siteId)
    this.clearChosen(siteId)
  },

  updateAlternative(
    alternativeId: string,
    fields: Partial<Pick<Alternative, 'constructionCost' | 'annualMaintenance' | 'serviceLife' | 'note'>>,
  ): void {
    alternatives = alternatives.map((a) =>
      a.id === alternativeId ? { ...a, ...fields } : a,
    )
  },

  // Pinning: at most one preferred alternative per site. Pinning a new
  // one replaces the prior pin for that site.
  pin(siteId: string, alternativeId: string): void {
    pinnedBySite = { ...pinnedBySite, [siteId]: alternativeId }
  },

  unpin(siteId: string): void {
    if (!(siteId in pinnedBySite)) return
    const { [siteId]: _removed, ...rest } = pinnedBySite
    pinnedBySite = rest
  },

  getPin(siteId: string): string | null {
    return pinnedBySite[siteId] ?? null
  },

  // Materialized chosen-alternative resolution. The bar and report consume
  // this; they never compute SII themselves.
  setChosen(siteId: string, chosen: ChosenAlt): void {
    chosenBySite = { ...chosenBySite, [siteId]: chosen }
  },

  clearChosen(siteId: string): void {
    if (!(siteId in chosenBySite)) return
    const { [siteId]: _removed, ...rest } = chosenBySite
    chosenBySite = rest
  },

  getChosen(siteId: string): ChosenAlt | null {
    return chosenBySite[siteId] ?? null
  },

  // SessionStore opt-in (docs/06): snapshot is a plain deep copy,
  // apply replaces all three slices wholesale.
  getSnapshot(): ProjectStateSnapshot {
    return $state.snapshot({ alternatives, pinnedBySite, chosenBySite }) as ProjectStateSnapshot
  },

  applySnapshot(snap: ProjectStateSnapshot): void {
    alternatives = snap.alternatives
    pinnedBySite = snap.pinnedBySite
    chosenBySite = snap.chosenBySite
  },
}

register(
  'projectState',
  () => projectState.getSnapshot(),
  (v) => projectState.applySnapshot(v as ProjectStateSnapshot),
)
