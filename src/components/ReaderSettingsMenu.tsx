import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/app/store'
import type { ReaderMode } from '@/types'

/** Typography and view controls, scoped to whichever reader is active. */
export function ReaderSettingsMenu({ mode }: { mode: ReaderMode }) {
  const [open, setOpen] = useState(false)
  const reader = useAppStore((s) => s.reader)
  const setReader = useAppStore((s) => s.setReader)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        className="btn px-2"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Display settings"
      >
        <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
          <path d="M4 6h12M4 10h12M4 14h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <span className="sr-only">Display settings</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Display settings"
          className="absolute right-0 top-full z-40 mt-1 w-64 animate-fade-in space-y-4 rounded-xl border border-edge bg-surface p-4 shadow-lg"
        >
          {mode === 'html' ? (
            <>
              <Slider
                label="Text size"
                value={reader.fontSize}
                min={14}
                max={26}
                step={1}
                suffix="px"
                onChange={(fontSize) => setReader({ fontSize })}
              />
              <Slider
                label="Line height"
                value={reader.lineHeight}
                min={1.3}
                max={2.2}
                step={0.1}
                onChange={(lineHeight) => setReader({ lineHeight })}
              />
              <Slider
                label="Line width"
                value={reader.measure}
                min={45}
                max={100}
                step={1}
                suffix="ch"
                onChange={(measure) => setReader({ measure })}
              />

              <fieldset>
                <legend className="mb-1.5 text-xs font-medium text-muted">Typeface</legend>
                <div className="flex gap-1">
                  {(['serif', 'sans'] as const).map((family) => (
                    <button
                      key={family}
                      type="button"
                      onClick={() => setReader({ family })}
                      aria-pressed={reader.family === family}
                      className={`flex-1 rounded-lg px-2 py-1 text-sm capitalize ${
                        reader.family === family
                          ? 'bg-accent text-accent-ink'
                          : 'bg-raised text-muted hover:text-ink'
                      } ${family === 'serif' ? 'font-serif' : 'font-sans'}`}
                    >
                      {family}
                    </button>
                  ))}
                </div>
              </fieldset>
            </>
          ) : (
            <label className="flex items-center justify-between gap-2 text-sm">
              <span>Dim PDF in dark mode</span>
              <input
                type="checkbox"
                checked={reader.pdfInvertInDark}
                onChange={(event) => setReader({ pdfInvertInDark: event.target.checked })}
                className="accent-[rgb(var(--c-accent))]"
              />
            </label>
          )}
        </div>
      )}
    </div>
  )
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  suffix = '',
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix?: string
  onChange: (value: number) => void
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center justify-between text-xs font-medium text-muted">
        {label}
        <span className="tabular-nums text-faint">
          {Math.round(value * 10) / 10}
          {suffix}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-[rgb(var(--c-accent))]"
      />
    </label>
  )
}
