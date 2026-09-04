import type { Region } from '../types'

export type RegionStateValue = {
  current: Region | null
  references: Region[]
}

class RegionStateImpl {
  #value = $state<RegionStateValue>({ current: null, references: [] })

  get(): RegionStateValue {
    return this.#value
  }

  setCurrent(region: Region | null): void {
    const references = region
      ? this.#value.references.filter((reference) => reference.id !== region.id)
      : this.#value.references
    this.#value = { current: region, references }
  }

  addReference(region: Region): void {
    if (this.#value.current?.id === region.id) return
    if (this.#value.references.some((reference) => reference.id === region.id)) return
    this.#value = {
      ...this.#value,
      references: [...this.#value.references, region],
    }
  }

  removeReference(regionId: string): void {
    const references = this.#value.references.filter(
      (reference) => reference.id !== regionId,
    )
    if (references.length === this.#value.references.length) return
    this.#value = { ...this.#value, references }
  }
}

export const regionState = new RegionStateImpl()
