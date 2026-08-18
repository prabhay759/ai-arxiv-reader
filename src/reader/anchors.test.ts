/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProgressSaver } from './anchors'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('saving the reading position', () => {
  it('waits for scrolling to settle before writing', () => {
    const save = vi.fn()
    const saver = createProgressSaver(save, 900)

    saver.schedule()
    vi.advanceTimersByTime(500)
    expect(save).not.toHaveBeenCalled()

    vi.advanceTimersByTime(500)
    expect(save).toHaveBeenCalledTimes(1)
    saver.dispose()
  })

  it('still writes during scrolling that never settles', () => {
    // The bug this guards: figures load, the layout shifts, that fires another
    // scroll event and restarts the timer. A pure debounce never fires, and a
    // reader who scrolls then reloads comes back to the top of the paper.
    const save = vi.fn()
    const saver = createProgressSaver(save, 900, 2200)

    for (let elapsed = 0; elapsed < 3000; elapsed += 100) {
      saver.schedule()
      vi.advanceTimersByTime(100)
    }

    expect(save.mock.calls.length).toBeGreaterThan(0)
    saver.dispose()
  })

  it('writes at least once per ceiling under sustained scrolling', () => {
    const save = vi.fn()
    const saver = createProgressSaver(save, 900, 2000)

    for (let elapsed = 0; elapsed < 6000; elapsed += 100) {
      saver.schedule()
      vi.advanceTimersByTime(100)
    }

    // Six seconds of unbroken scrolling, a two-second ceiling: at least two.
    expect(save.mock.calls.length).toBeGreaterThanOrEqual(2)
    saver.dispose()
  })

  it('flushes on demand without waiting', () => {
    const save = vi.fn()
    const saver = createProgressSaver(save, 900)

    saver.schedule()
    saver.flush()
    expect(save).toHaveBeenCalledTimes(1)

    // The pending timer must not fire a second, redundant write.
    vi.advanceTimersByTime(2000)
    expect(save).toHaveBeenCalledTimes(1)
    saver.dispose()
  })

  it('restarts the ceiling after a quiet period', () => {
    const save = vi.fn()
    const saver = createProgressSaver(save, 900, 2000)

    saver.schedule()
    vi.advanceTimersByTime(1000)
    expect(save).toHaveBeenCalledTimes(1)

    saver.schedule()
    vi.advanceTimersByTime(1000)
    expect(save).toHaveBeenCalledTimes(2)
    saver.dispose()
  })
})
