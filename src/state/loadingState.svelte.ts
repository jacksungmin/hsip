export type LoadingStep =
  | 'fetch-manifest'
  | 'init-db'
  | 'download-crashes'
  | 'load-jurisdictions'
  | 'ready'

const STEPS: LoadingStep[] = [
  'fetch-manifest',
  'init-db',
  'download-crashes',
  'load-jurisdictions',
  'ready',
]

// Rough wall-time weights so the progress bar moves proportionally.
// download-crashes dominates on a cold cache (~75 MB); on a warm
// cache (manifest URL matches the stored copy) it is skipped without
// a request. The jurisdictions fetch runs in parallel with the crash
// download, so its own step is usually just an already-resolved await.
const WEIGHTS: Record<LoadingStep, number> = {
  'fetch-manifest': 1,
  'init-db': 1,
  'download-crashes': 6,
  'load-jurisdictions': 1,
  'ready': 0,
}

const TOTAL_WEIGHT = STEPS.reduce((sum, s) => sum + WEIGHTS[s], 0)

const LABELS: Record<LoadingStep, string> = {
  'fetch-manifest': 'Checking data version',
  'init-db': 'Initializing local database',
  'download-crashes': 'Loading crash database',
  'load-jurisdictions': 'Loading jurisdiction data',
  'ready': 'Ready',
}

let step = $state<LoadingStep>('fetch-manifest')
let progress = $state(0)

export const loadingState = {
  get step() { return step },
  get progress() { return progress },
  get label() { return LABELS[step] },

  get overall(): number {
    if (step === 'ready') return 1
    const idx = STEPS.indexOf(step)
    const completed = STEPS.slice(0, idx).reduce((s, st) => s + WEIGHTS[st], 0)
    const current = WEIGHTS[step] * progress
    return (completed + current) / TOTAL_WEIGHT
  },

  get done() { return step === 'ready' },

  advance(next: LoadingStep) {
    step = next
    progress = 0
  },

  setProgress(fraction: number) {
    progress = Math.min(1, Math.max(0, fraction))
  },
}
