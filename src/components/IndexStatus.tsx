import { categoryName, formatDate, relativeDate } from '@/app/format'
import { useManifest } from '@/app/useManifest'

/** Refreshes happen in CI, so how stale the data is has to be visible here. */
const STALE_AFTER_HOURS = 12

export function IndexStatus() {
  const manifest = useManifest()

  if (manifest === undefined) {
    return <p className="text-sm text-muted">Checking the search index…</p>
  }

  if (manifest === null) {
    return (
      <p className="text-sm text-muted">
        No search index is deployed. It is built by the{' '}
        <strong>Build index and deploy to Pages</strong> workflow — or locally with{' '}
        <code className="font-mono text-xs">npm run refresh</code>.
      </p>
    )
  }

  const builtAt = Date.parse(manifest.builtAt)
  const ageHours = (Date.now() - builtAt) / 3_600_000
  const stale = Number.isFinite(ageHours) && ageHours > STALE_AFTER_HOURS

  return (
    <div className="space-y-3 text-sm">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
        <dt className="text-muted">Last refreshed</dt>
        <dd className={stale ? 'text-accent' : ''}>
          {Number.isFinite(builtAt) ? relativeDate(builtAt) : 'unknown'}
          {stale && ' — the scheduled refresh may not be running'}
        </dd>

        <dt className="text-muted">Papers indexed</dt>
        <dd className="tabular-nums">{manifest.docCount.toLocaleString()}</dd>

        <dt className="text-muted">Covering</dt>
        <dd>
          {formatDate(manifest.oldestPublished)} – {formatDate(manifest.newestPublished)}
        </dd>

        <dt className="text-muted">Searchable terms</dt>
        <dd className="tabular-nums">{manifest.stats.termCount.toLocaleString()}</dd>
      </dl>

      <div>
        <p className="mb-1.5 text-muted">Categories</p>
        <div className="flex flex-wrap gap-1.5">
          {manifest.categories.map((category) => (
            <span key={category} className="chip" title={categoryName(category)}>
              {category}
            </span>
          ))}
        </div>
      </div>

      <p className="text-xs text-faint">
        The index rebuilds automatically every 6 hours. To refresh it now, run the{' '}
        <strong>Build index and deploy to Pages</strong> workflow from the repository&rsquo;s
        Actions tab.
      </p>
    </div>
  )
}
