/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { read, write } from './uiPrefs'

afterEach(() => {
  // Unstub first: the throwing stub below has no clear().
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('view preferences', () => {
  it('round-trips a stored preference', () => {
    write('continue-reading', true)
    expect(read('continue-reading', false)).toBe(true)

    write('continue-reading', false)
    expect(read('continue-reading', true)).toBe(false)
  })

  it('uses the fallback when nothing is stored', () => {
    expect(read('never-set', true)).toBe(true)
    expect(read('never-set', false)).toBe(false)
  })

  it('namespaces its keys', () => {
    write('continue-reading', true)
    expect(localStorage.getItem('continue-reading')).toBeNull()
    expect(localStorage.getItem('arxiv-reader:ui:continue-reading')).toBe('1')
  })

  it('survives storage that throws instead of answering', () => {
    // Safari in private mode throws on access rather than returning null, and
    // this runs during render — an uncaught throw here is a blank page, not a
    // lost preference.
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new DOMException('denied')
      },
      setItem: () => {
        throw new DOMException('quota')
      },
    })

    expect(() => write('continue-reading', true)).not.toThrow()
    expect(read('continue-reading', true)).toBe(true)
  })
})
