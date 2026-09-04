// Verifies the error envelope from docs/07 "Error handling": that anything
// thrown becomes a readable report carrying the build stamps and the recent
// log lines, and that the copy text is plain and complete.
// The envelope builder takes its ambient values as an argument precisely so
// this can be checked without a browser or a loaded manifest.

import { beforeEach, describe, expect, it } from 'vitest'
import { buildEnvelope, formatEnvelope, logBuffer, type EnvelopeAmbient } from './errorReporter'

const ambient: EnvelopeAmbient = {
  id: 7,
  at: '2026-09-01T14:22:07.000Z',
  appBuild: 'a3f9c21',
  dataBuild: 'build-2026-08-14',
  browser: 'TestBrowser/1.0',
  recent: ['+12ms log [manifest] ok', '+840ms error [crashes] load failed'],
}

describe('buildEnvelope', () => {
  it('carries the ambient stamps and the context through unchanged', () => {
    const envelope = buildEnvelope(new Error('boom'), { where: 'boot', fatal: true }, ambient)

    expect(envelope.id).toBe(7)
    expect(envelope.appBuild).toBe('a3f9c21')
    expect(envelope.dataBuild).toBe('build-2026-08-14')
    expect(envelope.where).toBe('boot')
    expect(envelope.fatal).toBe(true)
    expect(envelope.recent).toEqual(ambient.recent)
  })

  it('names the error type alongside the message', () => {
    class NotFoundError extends Error {
      name = 'NotFoundError'
    }
    const envelope = buildEnvelope(
      new NotFoundError('no such county'),
      { where: 'lookup', fatal: false },
      ambient,
    )

    expect(envelope.message).toBe('NotFoundError: no such county')
    expect(envelope.stack).toBeTruthy()
  })

  it('reads a thrown string, which JavaScript allows', () => {
    const envelope = buildEnvelope('just a string', { where: 'somewhere', fatal: false }, ambient)

    expect(envelope.message).toBe('just a string')
    expect(envelope.stack).toBeNull()
  })

  it('reads a thrown object rather than rendering it as [object Object]', () => {
    const envelope = buildEnvelope({ status: 404 }, { where: 'fetch', fatal: false }, ambient)

    expect(envelope.message).toBe('{"status":404}')
  })

  it('falls back to something readable when nothing was thrown at all', () => {
    const envelope = buildEnvelope(undefined, { where: 'nowhere', fatal: false }, ambient)

    expect(envelope.message).toBe('undefined')
  })

  it('keeps advice optional and null when absent', () => {
    const withAdvice = buildEnvelope(
      new Error('x'),
      { where: 'w', fatal: false, advice: 'Check the basemap address.' },
      ambient,
    )
    const without = buildEnvelope(new Error('x'), { where: 'w', fatal: false }, ambient)

    expect(withAdvice.advice).toBe('Check the basemap address.')
    expect(without.advice).toBeNull()
  })
})

describe('formatEnvelope', () => {
  it('leads with what failed and includes every stamp the report needs', () => {
    const text = formatEnvelope(
      buildEnvelope(new Error('boom'), { where: 'boot / init-db', fatal: true }, ambient),
    )

    expect(text.split('\n')[0]).toContain('boot / init-db')
    expect(text).toContain('a3f9c21')
    expect(text).toContain('build-2026-08-14')
    expect(text).toContain('Error: boom')
    expect(text).toContain('TestBrowser/1.0')
  })

  it('includes the recent log lines, which are usually the useful part', () => {
    const text = formatEnvelope(
      buildEnvelope(new Error('boom'), { where: 'boot', fatal: true }, ambient),
    )

    expect(text).toContain('[crashes] load failed')
  })

  it('caps the stack so the report stays pasteable', () => {
    const error = new Error('deep')
    error.stack = ['Error: deep', ...Array.from({ length: 30 }, (_, i) => `    at frame${i} (a.ts:${i})`)].join('\n')

    const text = formatEnvelope(buildEnvelope(error, { where: 'w', fatal: true }, ambient))

    expect(text).toContain('at frame0')
    expect(text).toContain('at frame5')
    expect(text).not.toContain('at frame6')
  })

  it('keeps frames from browsers that do not write Chrome-style stacks', () => {
    // Firefox and Safari omit the message line and the "at" prefix. Filtering
    // for "at " would drop every frame and ship a report with no stack at all.
    const error = new Error('deep')
    error.stack = 'loadCrashDb@http://host/app.js:12:9\nboot@http://host/app.js:40:3'

    const text = formatEnvelope(buildEnvelope(error, { where: 'w', fatal: true }, ambient))

    expect(text).toContain('loadCrashDb@http://host/app.js:12:9')
    expect(text).toContain('boot@http://host/app.js:40:3')
  })
})

describe('logBuffer', () => {
  beforeEach(() => logBuffer.clear())

  it('keeps the newest lines and drops the oldest past its limit', () => {
    for (let i = 0; i < 60; i++) logBuffer.push('log', [`line ${i}`])

    const lines = logBuffer.snapshot()
    expect(lines).toHaveLength(50)
    expect(lines[0]).toContain('line 10')
    expect(lines[49]).toContain('line 59')
  })

  it('truncates a very long line rather than letting it fill the report', () => {
    logBuffer.push('log', ['x'.repeat(1000)])

    expect(logBuffer.snapshot()[0].length).toBeLessThanOrEqual(301)
  })

  it('renders errors and objects readably', () => {
    logBuffer.push('error', [new Error('nope')])
    logBuffer.push('log', [{ a: 1 }])

    const lines = logBuffer.snapshot()
    expect(lines[0]).toContain('Error: nope')
    expect(lines[1]).toContain('{"a":1}')
  })

  it('survives a circular object', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular

    expect(() => logBuffer.push('log', [circular])).not.toThrow()
    expect(logBuffer.snapshot()).toHaveLength(1)
  })
})
