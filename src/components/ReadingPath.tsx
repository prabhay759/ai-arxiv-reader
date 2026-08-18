import type { ReadingUnit } from '@/reader/units'
import type { ReadingUnitState, UnitRating } from '@/types'
import { totalMinutes } from '@/reader/units'

const RATINGS: Array<{ value: UnitRating; label: string; short: string }> = [
  { value: 'got', label: 'Got it', short: 'Got' },
  { value: 'fuzzy', label: 'Fuzzy — worth another pass', short: 'Fuzzy' },
  { value: 'lost', label: 'Lost me', short: 'Lost' },
]

interface ReadingPathProps {
  units: ReadingUnit[]
  states: Map<string, ReadingUnitState>
  currentKey?: string
  onJump: (unit: ReadingUnit) => void
  onRate: (unit: ReadingUnit, rating: UnitRating | undefined) => void
}

/**
 * The reading path: what this paper is made of, and how far through it you are.
 *
 * Rating is deliberately passive. It never blocks, never appears as a modal and
 * never gates progress — a unit is marked read by scrolling past it, and the
 * buttons are an optional aside. The failure mode this is built against is the
 * one every "how did that go?" prompt eventually hits: it becomes something to
 * dismiss, everything gets marked fine, and the signal is worthless.
 */
export function ReadingPath({ units, states, currentKey, onJump, onRate }: ReadingPathProps) {
  if (units.length === 0) return null

  const body = units.filter((unit) => !unit.appendix)
  const doneCount = body.filter((unit) => states.get(unit.key)?.done).length
  const remaining = totalMinutes(body.filter((unit) => !states.get(unit.key)?.done))
  const hasAppendix = units.some((unit) => unit.appendix)

  return (
    <section aria-labelledby="path-heading" className="text-sm">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 id="path-heading" className="text-sm font-semibold">
          Reading path
        </h2>
        <span className="text-xs tabular-nums text-faint">
          {doneCount}/{body.length}
        </span>
      </div>

      {/* The header above shows a whole-document estimate from scroll
          position; this one counts unread units and leaves out the optional
          appendix. Two different numbers a few inches apart need saying which
          is which. */}
      <p
        className="mb-2 text-xs text-faint"
        title={
          hasAppendix
            ? 'Unread units in the path, not counting the optional appendix'
            : 'Unread units in the path'
        }
      >
        {remaining > 0 ? `~${remaining} min left in the path` : 'Path complete'}
      </p>

      <ol className="space-y-0.5">
        {units.map((unit) => {
          const state = states.get(unit.key)
          const current = unit.key === currentKey

          return (
            <li key={unit.key}>
              <div
                className={`group rounded-md px-1.5 py-1 transition-colors ${
                  current ? 'bg-raised' : 'hover:bg-raised/60'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onJump(unit)}
                  aria-current={current ? 'true' : undefined}
                  className="flex w-full items-start gap-2 text-left"
                  style={{ paddingLeft: `${(unit.level - 1) * 0.6}rem` }}
                >
                  <StatusDot done={!!state?.done} current={current} rating={state?.rating} />
                  <span className={`min-w-0 flex-1 ${state?.done ? 'text-muted' : ''}`}>
                    <span className="block truncate">{unit.label}</span>
                    <span className="text-xs text-faint">
                      {unit.appendix ? 'optional · ' : ''}
                      {unit.minutes} min
                      {unit.mergedCount ? ` · +${unit.mergedCount} more` : ''}
                    </span>
                  </span>
                </button>

                {/* Only offer a judgement on something actually read. Shown on
                    hover or keyboard focus so the path stays a path. */}
                {state?.done && (
                  <div
                    className={`mt-1 flex gap-1 ${
                      state.rating ? '' : 'opacity-0 focus-within:opacity-100 group-hover:opacity-100'
                    }`}
                  >
                    {RATINGS.map((rating) => {
                      const active = state.rating === rating.value
                      return (
                        <button
                          key={rating.value}
                          type="button"
                          title={rating.label}
                          aria-label={`${rating.label}: ${unit.label}`}
                          aria-pressed={active}
                          onClick={() => onRate(unit, active ? undefined : rating.value)}
                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                            active
                              ? RATING_ACTIVE[rating.value]
                              : 'bg-raised text-faint hover:text-ink'
                          }`}
                        >
                          {rating.short}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

const RATING_ACTIVE: Record<UnitRating, string> = {
  got: 'bg-accent text-accent-ink',
  fuzzy: 'bg-amber-500/20 text-amber-600 dark:text-amber-400',
  lost: 'bg-rose-500/20 text-rose-600 dark:text-rose-400',
}

function StatusDot({
  done,
  current,
  rating,
}: {
  done: boolean
  current: boolean
  rating?: UnitRating
}) {
  const flagged = rating === 'fuzzy' || rating === 'lost'
  const className = flagged
    ? 'border-amber-500 bg-amber-500/40'
    : done
      ? 'border-accent bg-accent'
      : current
        ? 'border-accent bg-transparent'
        : 'border-edge bg-transparent'

  return (
    <span
      aria-hidden="true"
      className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full border-2 ${className}`}
    />
  )
}
