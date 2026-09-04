export type DrawingTool = 'region-polygon' | 'roadway-line' | 'intersection-point' | null

class DrawingStateImpl {
  #value = $state<DrawingTool>(null)
  #inProgressCheck: (() => boolean) | null = null

  get(): DrawingTool {
    return this.#value
  }

  setTool(tool: DrawingTool): void {
    if (this.#value === tool) return
    this.#value = tool
  }

  registerInProgressCheck(fn: () => boolean): void {
    this.#inProgressCheck = fn
  }

  hasInProgressDraw(): boolean {
    return this.#inProgressCheck?.() ?? false
  }
}

export const drawingState = new DrawingStateImpl()
