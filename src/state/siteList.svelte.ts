import type { Site, SitePart } from '../types'
import { withSiteParts } from '../services/crashUnion'
import { register } from './sessionRegistry'

export type SiteListValue = Site[]

// Includes drawnGeometry so redraw (replace a part's geometry) routes
// through the same mutation as a buffer edit: either way the part's
// geometry package changed and the crash set + site union follow.
export type PartBufferFields = Pick<SitePart, 'drawnGeometry' | 'bufferFeet' | 'bufferedGeometry' | 'crashes'>

export interface SiteList {
  get(): SiteListValue
  add(site: Site): void
  remove(siteId: string): void
  addPart(siteId: string, part: SitePart): void
  removePart(siteId: string, partId: string): void
  updatePartBuffer(siteId: string, partId: string, fields: PartBufferFields): void
  updateSiteBuffer(siteId: string, allPartFields: PartBufferFields[]): void
  updatePart(siteId: string, partId: string, fields: Partial<Pick<SitePart, 'name'>>): void
  updateSite(siteId: string, fields: Partial<Pick<Site, 'name' | 'description' | 'owner' | 'growthRatePercent' | 'functionalClass'>>): void
  // SessionStore opt-in (docs/06): snapshot is a plain deep copy,
  // apply replaces the whole list with the given snapshot.
  getSnapshot(): SiteListValue
  applySnapshot(sites: SiteListValue): void
}

class SiteListImpl implements SiteList {
  #sites = $state<Site[]>([])

  get(): SiteListValue {
    return this.#sites
  }

  add(site: Site): void {
    this.#sites = [site, ...this.#sites]
  }

  remove(siteId: string): void {
    this.#sites = this.#sites.filter((s) => s.id !== siteId)
  }

  addPart(siteId: string, part: SitePart): void {
    this.#sites = this.#sites.map((s) =>
      s.id === siteId ? withSiteParts(s, [...s.parts, part]) : s,
    )
  }

  removePart(siteId: string, partId: string): void {
    this.#sites = this.#sites.map((s) => {
      if (s.id !== siteId) return s
      // Min-1 invariant: a site never drops to zero parts. Deleting the
      // last part is a site delete, escalated in the UI, not here.
      if (s.parts.length <= 1) return s
      if (!s.parts.some((p) => p.id === partId)) return s
      return withSiteParts(s, s.parts.filter((p) => p.id !== partId))
    })
  }

  updatePartBuffer(siteId: string, partId: string, fields: PartBufferFields): void {
    this.#sites = this.#sites.map((s) => {
      if (s.id !== siteId) return s
      if (!s.parts.some((p) => p.id === partId)) return s
      return withSiteParts(s, s.parts.map((p) => (p.id === partId ? { ...p, ...fields } : p)))
    })
  }

  updateSiteBuffer(siteId: string, allPartFields: PartBufferFields[]): void {
    this.#sites = this.#sites.map((s) => {
      if (s.id !== siteId) return s
      if (allPartFields.length !== s.parts.length) return s
      const parts = s.parts.map((p, i) => ({ ...p, ...allPartFields[i] }))
      return withSiteParts(s, parts)
    })
  }

  updatePart(siteId: string, partId: string, fields: Partial<Pick<SitePart, 'name'>>): void {
    this.#sites = this.#sites.map((s) =>
      s.id === siteId
        ? { ...s, parts: s.parts.map((p) => (p.id === partId ? { ...p, ...fields } : p)) }
        : s,
    )
  }

  updateSite(siteId: string, fields: Partial<Pick<Site, 'name' | 'description' | 'owner' | 'growthRatePercent' | 'functionalClass'>>): void {
    this.#sites = this.#sites.map((s) =>
      s.id === siteId ? { ...s, ...fields } : s,
    )
  }

  getSnapshot(): SiteListValue {
    return $state.snapshot(this.#sites) as SiteListValue
  }

  applySnapshot(sites: SiteListValue): void {
    this.#sites = sites
  }
}

export const siteList: SiteList = new SiteListImpl()

register(
  'siteList',
  () => siteList.getSnapshot(),
  (v) => siteList.applySnapshot(v as SiteListValue),
)
