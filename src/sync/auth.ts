import type { GoogleUser } from '@/types'
import { GOOGLE_CLIENT_ID, SYNC_AVAILABLE } from '@/app/services'

/**
 * Google sign-in, entirely in the browser.
 *
 * Uses Google Identity Services' OAuth token flow with `drive.appdata`, so the
 * app can store a sync document in the user's own Drive without any server:
 * no backend, no database, no credentials to keep, and data the user fully
 * controls (and can delete by revoking access).
 *
 * `drive.appdata` is a sensitive scope, so until the OAuth app passes Google
 * verification users see an "unverified app" interstitial on first consent.
 * That is a Google review step, not a defect — see README.
 */

const GSI_SRC = 'https://accounts.google.com/gsi/client'
const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/drive.appdata',
].join(' ')

/** Refresh a bit early so a sync never starts with an almost-dead token. */
const EXPIRY_MARGIN_MS = 60_000

interface TokenResponse {
  access_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

interface TokenClient {
  requestAccessToken: (options?: { prompt?: string }) => void
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string
            scope: string
            callback: (response: TokenResponse) => void
            error_callback?: (error: { type?: string }) => void
          }) => TokenClient
          revoke: (token: string, done: () => void) => void
        }
      }
    }
  }
}

let scriptPromise: Promise<void> | undefined

function loadGsi(): Promise<void> {
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) {
      resolve()
      return
    }
    const script = document.createElement('script')
    script.src = GSI_SRC
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => {
      scriptPromise = undefined
      reject(new Error('Could not load Google sign-in. Check your connection or blockers.'))
    }
    document.head.appendChild(script)
  })
  return scriptPromise
}

let accessToken: string | undefined
let expiresAt = 0
let client: TokenClient | undefined
/** Resolvers for the in-flight token request; GIS reports back via callback. */
let pending: Array<{ resolve: (token: string) => void; reject: (error: Error) => void }> = []

async function ensureClient(): Promise<TokenClient> {
  if (client) return client
  await loadGsi()

  const oauth2 = window.google?.accounts?.oauth2
  if (!oauth2) throw new Error('Google sign-in unavailable.')

  client = oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: SCOPES,
    callback: (response) => {
      const waiting = pending
      pending = []

      if (response.error || !response.access_token) {
        waiting.forEach((p) => p.reject(explainAuthError(response.error, response.error_description)))
        return
      }

      accessToken = response.access_token
      expiresAt = Date.now() + (response.expires_in ?? 3600) * 1000
      waiting.forEach((p) => p.resolve(response.access_token as string))
    },
    error_callback: (error) => {
      const waiting = pending
      pending = []
      waiting.forEach((p) => p.reject(explainAuthError(error.type)))
    },
  })
  return client
}

/**
 * Turn Google's error codes into something a person can act on.
 *
 * This matters more than it looks. By far the most common setup mistake is
 * forgetting to list the site's origin under "Authorised JavaScript origins",
 * and Google reports that as `idpiframe_initialization_failed` or a bare
 * "not allowed" — which tells the user nothing, and is invisible in the
 * network tab because the failure happens inside Google's iframe. Naming the
 * exact origin to paste turns a dead end into a one-line fix.
 */
export function explainAuthError(code?: string, description?: string): Error {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'this site'

  switch (code) {
    case 'access_denied':
      return new Error('Google sign-in was cancelled.')

    case 'popup_closed':
    case 'popup_closed_by_user':
      return new Error('The sign-in window was closed before finishing.')

    case 'popup_failed_to_open':
      return new Error('The browser blocked the sign-in window. Allow pop-ups for this site and try again.')

    case 'idpiframe_initialization_failed':
    case 'invalid_client':
    case 'unauthorized_client':
    case 'origin_mismatch':
      return new Error(
        `Google rejected this site's origin. Add exactly "${origin}" to ` +
          '"Authorised JavaScript origins" on your OAuth client in the Google Cloud console, ' +
          'then reload. (Origins must match scheme, host and port, with no trailing slash.)'
      )

    case 'admin_policy_enforced':
      return new Error('Your Google Workspace administrator has blocked this app.')

    default:
      break
  }

  // Google sometimes puts the origin complaint in the description instead of
  // using a distinct code, so check the text too before giving up.
  if (description && /origin|redirect_uri/i.test(description)) {
    return new Error(
      `Google rejected this site's origin: ${description}. Add exactly "${origin}" to ` +
        '"Authorised JavaScript origins" on your OAuth client.'
    )
  }

  return new Error(description ?? code ?? 'Google sign-in failed.')
}

/**
 * Raised when a token is needed but only a user gesture can obtain one.
 * The UI turns this into a "Sign in again" prompt rather than an error.
 */
export class ReauthRequiredError extends Error {
  constructor() {
    super('Sign in again to resume syncing.')
    this.name = 'ReauthRequiredError'
  }
}

/**
 * Get a usable access token.
 *
 * Google's token client can only open its window from a user gesture —
 * browsers block popups otherwise. So background syncs never attempt to
 * re-authenticate: they throw ReauthRequiredError and the UI asks the user to
 * click, which is both more reliable and less startling than a window
 * appearing on its own.
 *
 * @param interactive true only when called directly from a click.
 */
export async function getAccessToken(interactive: boolean): Promise<string> {
  if (!SYNC_AVAILABLE) throw new Error('Sync is not configured for this deployment.')

  if (accessToken && Date.now() < expiresAt - EXPIRY_MARGIN_MS) return accessToken
  if (!interactive) throw new ReauthRequiredError()

  const tokenClient = await ensureClient()
  return new Promise<string>((resolve, reject) => {
    pending.push({ resolve, reject })
    // Empty prompt reuses an existing Google session where possible, so a
    // returning user usually sees no consent screen at all.
    tokenClient.requestAccessToken({ prompt: '' })
  })
}

export async function signIn(): Promise<GoogleUser> {
  const token = await getAccessToken(true)
  return fetchUserInfo(token)
}

export function signOut(): void {
  const token = accessToken
  accessToken = undefined
  expiresAt = 0
  if (token) window.google?.accounts.oauth2.revoke(token, () => undefined)
}

export function hasLiveToken(): boolean {
  return Boolean(accessToken && Date.now() < expiresAt)
}

export async function fetchUserInfo(token: string): Promise<GoogleUser> {
  const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new Error('Could not read your Google profile.')

  const data = (await response.json()) as { email?: string; name?: string; picture?: string }
  return {
    email: data.email ?? '',
    name: data.name ?? data.email ?? 'Signed in',
    picture: data.picture,
  }
}
