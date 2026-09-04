export type ViewModeValue = 'diagnosis' | 'planning'

export interface ViewMode {
  get(): ViewModeValue
  set(mode: ViewModeValue): void
}

class ViewModeImpl implements ViewMode {
  #mode = $state<ViewModeValue>('diagnosis')

  get(): ViewModeValue {
    return this.#mode
  }

  set(mode: ViewModeValue): void {
    if (this.#mode === mode) return
    this.#mode = mode
  }
}

export const viewMode: ViewMode = new ViewModeImpl()
