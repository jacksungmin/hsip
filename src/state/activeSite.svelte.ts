export type ActiveSiteValue = string | null

export interface ActiveSite {
  get(): ActiveSiteValue
  set(siteId: string | null): void
  // Part-level selection within the active site: null means the whole
  // site is selected (all parts highlight). Deselecting a part falls
  // back to the site selection, never to nothing.
  getPart(): string | null
  setPart(partId: string | null): void
}

class ActiveSiteImpl implements ActiveSite {
  #value = $state<ActiveSiteValue>(null)
  #part = $state<string | null>(null)

  get(): ActiveSiteValue {
    return this.#value
  }

  set(siteId: string | null): void {
    this.#part = null
    if (this.#value === siteId) return
    this.#value = siteId
  }

  getPart(): string | null {
    return this.#part
  }

  setPart(partId: string | null): void {
    if (this.#value === null) return
    this.#part = partId
  }
}

export const activeSite: ActiveSite = new ActiveSiteImpl()
