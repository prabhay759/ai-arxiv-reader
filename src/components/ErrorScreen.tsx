import { Link, isRouteErrorResponse, useRouteError } from 'react-router-dom'

export function ErrorScreen({ notFound = false }: { notFound?: boolean }) {
  const error = useRouteError()

  const title = notFound
    ? 'Page not found'
    : isRouteErrorResponse(error)
      ? `${error.status} ${error.statusText}`
      : 'Something went wrong'

  const detail = notFound
    ? "That route doesn't exist. It may have been a mistyped link."
    : error instanceof Error
      ? error.message
      : 'An unexpected error occurred while rendering this page.'

  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-3 text-sm text-muted">{detail}</p>
      <div className="mt-6 flex justify-center gap-2">
        <Link to="/" className="btn btn-primary">
          Go home
        </Link>
        <button type="button" className="btn" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    </div>
  )
}
