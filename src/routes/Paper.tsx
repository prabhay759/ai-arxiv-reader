import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useParams, useSearchParams } from 'react-router-dom'
import type {
  HighlightAnchor,
  HighlightColor,
  PaperDetail,
  ReaderMode,
  ReadingAnchor,
  UnitRating,
} from '@/types'
import { ARXIV_ABS } from '@/app/services'
import { useAppStore } from '@/app/store'
import {
  cleanLatex,
  formatAuthors,
  formatDate,
  percentLabel,
  readingTimeRemaining,
} from '@/app/format'
import { ErrorNote, Spinner } from '@/components/EmptyState'
import { BookmarkButton } from '@/components/BookmarkButton'
import { PaperToolbar } from '@/components/PaperToolbar'
import { ReaderSidebar } from '@/components/ReaderSidebar'
import { ReadingPath } from '@/components/ReadingPath'
import { HtmlReader } from '@/reader/HtmlReader'
import type { ReadingUnit } from '@/reader/units'
import { PdfReader } from '@/reader/PdfReader'
import { resolvePaper } from '@/reader/resolvePaper'
import { getProgress, saveProgress } from '@/store/library'
import { createHighlight, listHighlights } from '@/store/highlights'
import { listUnitStates, markUnitsDone, rateUnit } from '@/store/readingUnits'

export default function Paper() {
  const { id: rawId } = useParams<{ id: string }>()
  const id = (rawId ?? '').replace(/v\d+$/, '')
  const [params, setParams] = useSearchParams()

  const preferredMode = useAppStore((s) => s.reader.preferredMode)
  const setReader = useAppStore((s) => s.setReader)

  const [paper, setPaper] = useState<PaperDetail>()
  const [loadError, setLoadError] = useState<string>()
  const [mode, setMode] = useState<ReaderMode>(
    (params.get('view') as ReaderMode) || preferredMode
  )
  const [toc, setToc] = useState<Array<{ id: string; label: string; level: number }>>([])
  const [outline, setOutline] = useState<Array<{ label: string; page: number }>>([])
  const [progressPercent, setProgressPercent] = useState(0)
  const [totalUnits, setTotalUnits] = useState<number>()
  const [units, setUnits] = useState<ReadingUnit[]>([])
  const [currentUnitKey, setCurrentUnitKey] = useState<string>()
  const unitsRef = useRef<ReadingUnit[]>([])
  unitsRef.current = units

  // The anchor to restore is read once, before the reader mounts — reading it
  // reactively would fight the reader's own scroll tracking.
  const [initialAnchor, setInitialAnchor] = useState<ReadingAnchor | undefined>()
  const [anchorReady, setAnchorReady] = useState(false)
  const modeRef = useRef(mode)
  modeRef.current = mode

  const highlights = useLiveQuery(
    async () => (id ? listHighlights(id) : []),
    [id]
  )

  const unitStates = useLiveQuery(
    async () => (id ? listUnitStates(id) : new Map()),
    [id]
  )

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    setPaper(undefined)
    setLoadError(undefined)
    setAnchorReady(false)

    resolvePaper(id, controller.signal)
      .then(async (resolved) => {
        if (cancelled) return
        setPaper(resolved)

        const progress = await getProgress(id)
        if (cancelled) return
        setInitialAnchor(progress?.anchor)
        setProgressPercent(progress?.anchor.percent ?? 0)
        setTotalUnits(progress?.total)

        // Resume in whichever view the position was recorded in, unless the
        // URL explicitly asked for one — reopening in the other view would
        // land you in the wrong place.
        if (!params.get('view') && progress?.anchor.mode) {
          setMode(progress.anchor.mode)
        }
        setAnchorReady(true)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : String(err))
      })

    return () => {
      cancelled = true
      controller.abort()
    }
    // `params` intentionally omitted: only the initial view choice matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const handleProgress = useCallback(
    (anchor: ReadingAnchor, total: number) => {
      if (!paper) return
      setProgressPercent(anchor.percent)
      setTotalUnits(total)
      void saveProgress(paper, anchor, total)
    },
    [paper]
  )

  const handleUnits = useCallback((next: ReadingUnit[]) => setUnits(next), [])

  const handleUnitProgress = useCallback(
    (doneKeys: string[], currentKey?: string) => {
      setCurrentUnitKey(currentKey)
      if (!paper || doneKeys.length === 0) return
      const done = unitsRef.current.filter((unit) => doneKeys.includes(unit.key))
      // markUnitsDone is a no-op when nothing is newly finished, which matters:
      // this fires on every scroll tick.
      void markUnitsDone(paper.id, done)
    },
    [paper]
  )

  const handleRate = useCallback(
    (unit: ReadingUnit, rating: UnitRating | undefined) => {
      if (!paper) return
      void rateUnit(paper, unit, rating)
    },
    [paper]
  )

  const scrollToUnit = useCallback((unit: ReadingUnit) => {
    const element = document.querySelector<HTMLElement>(`[id="${CSS.escape(unit.elementId)}"]`)
    if (!element) return
    window.scrollTo({
      top: window.scrollY + element.getBoundingClientRect().top - 96,
      behavior: 'smooth',
    })
  }, [])

  const handleCreateHighlight = useCallback(
    (anchor: HighlightAnchor | null, color: HighlightColor) => {
      if (!anchor || !paper) return
      void createHighlight(paper.id, anchor, color)
    },
    [paper]
  )

  function switchMode(next: ReaderMode) {
    setMode(next)
    setReader({ preferredMode: next })
    const updated = new URLSearchParams(params)
    updated.set('view', next)
    setParams(updated, { replace: true })
  }

  // `m` toggles between HTML and PDF.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      if (target instanceof HTMLElement) {
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable) {
          return
        }
      }
      if (event.key === 'm') {
        event.preventDefault()
        switchMode(modeRef.current === 'html' ? 'pdf' : 'html')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  // `?unit=<key>` opens the paper at a specific unit — how the revisit queue
  // sends you back to the part that did not land.
  const requestedUnit = params.get('unit')
  const jumpedRef = useRef<string>()
  useEffect(() => {
    if (!requestedUnit || units.length === 0 || jumpedRef.current === requestedUnit) return
    const target = units.find((unit) => unit.key === requestedUnit)
    if (!target) return
    jumpedRef.current = requestedUnit
    // One frame after layout, so the restored scroll position does not win.
    const timer = window.setTimeout(() => scrollToUnit(target), 100)
    return () => window.clearTimeout(timer)
  }, [requestedUnit, units, scrollToUnit])

  const handleUnavailable = useCallback(() => {
    // arXiv has no HTML for this paper — fall back without losing the place.
    // The path is derived from the HTML, so it goes with it; PDF mode has no
    // section structure to build one from.
    setUnits([])
    setMode('pdf')
  }, [])

  const timeRemaining = useMemo(
    () => readingTimeRemaining(progressPercent, mode === 'pdf' ? totalUnits : undefined),
    [progressPercent, totalUnits, mode]
  )

  if (loadError) return <ErrorNote message={loadError} />
  if (!paper || !anchorReady) return <Spinner label="Loading paper" />

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_16rem]">
      <div className="min-w-0">
        <header className="mb-5">
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-xl font-semibold leading-tight sm:text-2xl">
              {cleanLatex(paper.title)}
            </h1>
            <BookmarkButton paper={paper} showLabel />
          </div>

          <p className="mt-2 text-sm text-muted">{formatAuthors(paper.authors, 8)}</p>

          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-faint">
            <a className="chip hover:text-ink" href={ARXIV_ABS(paper.id)} target="_blank" rel="noreferrer">
              arXiv:{paper.id}
            </a>
            {paper.categories.slice(0, 4).map((category) => (
              <span key={category} className="chip">
                {category}
              </span>
            ))}
            <span>{formatDate(paper.published)}</span>
            {paper.journalRef && <span title="Journal reference">· {paper.journalRef}</span>}
          </div>

          {paper.abstract && (
            <details className="mt-4 rounded-lg border border-edge bg-surface p-3" open>
              <summary className="cursor-pointer text-sm font-medium">Abstract</summary>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                {cleanLatex(paper.abstract)}
              </p>
            </details>
          )}

          {paper.comment && (
            <p className="mt-2 text-xs italic text-faint">{cleanLatex(paper.comment)}</p>
          )}
        </header>

        <PaperToolbar
          paper={paper}
          mode={mode}
          onModeChange={switchMode}
          progressPercent={progressPercent}
        />

        <div
          className="sticky top-14 z-20 -mx-1 mb-4 h-1 overflow-hidden rounded-full bg-raised"
          role="progressbar"
          aria-valuenow={Math.round(progressPercent * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Reading progress"
        >
          <div
            className="h-full bg-accent transition-[width] duration-200"
            style={{ width: percentLabel(progressPercent) }}
          />
        </div>

        {mode === 'html' ? (
          <HtmlReader
            key={`html-${paper.id}`}
            paper={paper}
            initialAnchor={initialAnchor?.mode === 'html' ? initialAnchor : undefined}
            highlights={highlights ?? []}
            onProgress={handleProgress}
            onCreateHighlight={handleCreateHighlight}
            onSelectHighlight={() => undefined}
            onToc={setToc}
            onUnits={handleUnits}
            onUnitProgress={handleUnitProgress}
            onUnavailable={handleUnavailable}
          />
        ) : (
          <PdfReader
            key={`pdf-${paper.id}`}
            paper={paper}
            initialAnchor={initialAnchor?.mode === 'pdf' ? initialAnchor : undefined}
            highlights={highlights ?? []}
            onProgress={handleProgress}
            onCreateHighlight={handleCreateHighlight}
            onOutline={setOutline}
          />
        )}
      </div>

      <ReaderSidebar
        paper={paper}
        mode={mode}
        toc={toc}
        outline={outline}
        highlights={highlights ?? []}
        progressLabel={`${percentLabel(progressPercent)} · ${timeRemaining}`}
        path={
          mode === 'html' && units.length > 0 ? (
            <ReadingPath
              units={units}
              states={unitStates ?? new Map()}
              currentKey={currentUnitKey}
              onJump={scrollToUnit}
              onRate={handleRate}
            />
          ) : undefined
        }
      />
    </div>
  )
}
