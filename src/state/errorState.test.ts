// Verifies the error surface rules from docs/07 "Error handling": the first
// fatal failure is the one kept (later ones are usually its consequences), and
// repeats of the same non-fatal failure count up in one notice rather than
// stacking, so a failing map tile cannot bury the screen.

import { beforeEach, describe, expect, it } from 'vitest'
import { errorState } from './errorState.svelte'
import type { ErrorEnvelope } from '../services/errorReporter'

let nextId = 0

function envelope(overrides: Partial<ErrorEnvelope> = {}): ErrorEnvelope {
  nextId++
  return {
    id: nextId,
    at: '2026-09-01T00:00:00.000Z',
    appBuild: 'a3f9c21',
    dataBuild: 'build-1',
    where: 'somewhere',
    advice: null,
    message: 'Error: boom',
    stack: null,
    browser: 'TestBrowser/1.0',
    recent: [],
    fatal: false,
    ...overrides,
  }
}

beforeEach(() => {
  errorState.reset()
  nextId = 0
})

describe('fatal failures', () => {
  it('keeps the first one, because later failures are usually its consequence', () => {
    const first = envelope({ fatal: true, message: 'Error: manifest missing' })
    const second = envelope({ fatal: true, message: 'Error: no data' })

    errorState.report(first)
    errorState.report(second)

    expect(errorState.fatal?.message).toBe('Error: manifest missing')
  })

  it('does not appear among the notices', () => {
    errorState.report(envelope({ fatal: true }))

    expect(errorState.notices).toHaveLength(0)
  })
})

describe('notices', () => {
  it('counts a repeat of the same failure in place', () => {
    errorState.report(envelope({ where: 'basemap', message: 'Error: tile 404' }))
    errorState.report(envelope({ where: 'basemap', message: 'Error: tile 404' }))
    errorState.report(envelope({ where: 'basemap', message: 'Error: tile 404' }))

    expect(errorState.notices).toHaveLength(1)
    expect(errorState.notices[0].repeats).toBe(3)
  })

  it('keeps the first envelope of a repeat, whose log lines cover the start', () => {
    errorState.report(
      envelope({ id: 1, where: 'basemap', message: 'Error: tile 404', recent: ['first'] }),
    )
    errorState.report(
      envelope({ id: 2, where: 'basemap', message: 'Error: tile 404', recent: ['later'] }),
    )

    expect(errorState.notices[0].envelope.id).toBe(1)
    expect(errorState.notices[0].envelope.recent).toEqual(['first'])
  })

  it('treats the same message from a different place as a different failure', () => {
    errorState.report(envelope({ where: 'basemap', message: 'Error: tile 404' }))
    errorState.report(envelope({ where: 'overlay', message: 'Error: tile 404' }))

    expect(errorState.notices).toHaveLength(2)
  })

  it('drops the oldest once the screen is full', () => {
    for (let i = 0; i < 6; i++) {
      errorState.report(envelope({ where: `place ${i}` }))
    }

    expect(errorState.notices).toHaveLength(4)
    expect(errorState.notices[0].envelope.where).toBe('place 2')
    expect(errorState.notices[3].envelope.where).toBe('place 5')
  })

  it('dismisses by id', () => {
    errorState.report(envelope({ id: 1, where: 'one' }))
    errorState.report(envelope({ id: 2, where: 'two' }))

    errorState.dismiss(1)

    expect(errorState.notices).toHaveLength(1)
    expect(errorState.notices[0].envelope.id).toBe(2)
  })
})
