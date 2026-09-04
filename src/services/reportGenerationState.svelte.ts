// Reactive state for report generation. Shared by ExportDialog (user
// path) and debug menu (fixture path) so both exercise the identical
// code path: preparePrintableReport → captureReportMaps → printReport.

import {
  preparePrintableReport,
  printReport,
  type ReportGenerationProgress,
} from './generateReport'

let generating = $state(false)
let progress = $state<ReportGenerationProgress | null>(null)
let error = $state<string | null>(null)

export const reportGeneration = {
  get generating() { return generating },
  get progress() { return progress },
  get error() { return error },

  get progressPercent(): number | null {
    if (!progress?.total) return null
    return Math.round(((progress.completed ?? 0) / progress.total) * 100)
  },

  clearError() { error = null },

  async generateAndPrint(): Promise<void> {
    generating = true
    error = null
    try {
      const prepared = await preparePrintableReport((next) => {
        progress = next
      })
      progress = {
        phase: 'ready',
        message: 'Opening print preview',
        completed: progress?.total,
        total: progress?.total,
      }
      await printReport(prepared.payload, prepared.assets)
    } catch (err) {
      error = 'Could not generate the report. Try again, or reload if the problem persists.'
      throw err
    } finally {
      generating = false
      progress = null
    }
  },
}
