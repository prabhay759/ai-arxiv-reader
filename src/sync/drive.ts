import type { SyncDocument } from '@/types'

/**
 * Storage for the sync document, in the user's own Google Drive.
 *
 * `appDataFolder` is a hidden per-app folder: invisible in the Drive UI, not
 * shareable, and readable only by this app for this user. It costs nothing to
 * run, needs no database, and the user can revoke or wipe it at any time from
 * their Google account. That combination is what makes cross-device sync
 * possible with no backend at all.
 */

const FILE_NAME = 'arxiv-reader-sync.json'
const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files'
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files'

export interface RemoteState {
  fileId: string
  /** Drive's version counter, used to detect a concurrent write. */
  version: string
  document: SyncDocument
}

export class ConcurrentWriteError extends Error {
  constructor() {
    super('Your data changed on another device during this sync.')
    this.name = 'ConcurrentWriteError'
  }
}

async function driveFetch(token: string, url: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    headers: { ...init?.headers, Authorization: `Bearer ${token}` },
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    if (response.status === 401 || response.status === 403) {
      throw new Error('Google Drive access was denied. Try signing in again.')
    }
    throw new Error(`Google Drive error ${response.status}: ${body.slice(0, 180)}`)
  }
  return response
}

/** Locate the sync file, if this account has one yet. */
async function findFile(token: string): Promise<{ id: string; version: string } | null> {
  const params = new URLSearchParams({
    spaces: 'appDataFolder',
    fields: 'files(id,name,version,modifiedTime)',
    q: `name = '${FILE_NAME}' and trashed = false`,
    pageSize: '10',
  })

  const response = await driveFetch(token, `${DRIVE_FILES}?${params}`)
  const data = (await response.json()) as {
    files?: Array<{ id: string; version: string }>
  }
  const file = data.files?.[0]
  return file ? { id: file.id, version: file.version } : null
}

export async function readRemote(token: string): Promise<RemoteState | null> {
  const file = await findFile(token)
  if (!file) return null

  const response = await driveFetch(token, `${DRIVE_FILES}/${file.id}?alt=media`)
  const text = await response.text()

  let document: SyncDocument
  try {
    document = JSON.parse(text) as SyncDocument
  } catch {
    // A corrupt remote file must not wedge sync forever. Treat it as absent;
    // the next write replaces it with a valid document.
    return null
  }
  return { fileId: file.id, version: file.version, document }
}

/**
 * Write the sync document.
 *
 * When `expectedVersion` is given and Drive's current version differs, another
 * device wrote in between — we abort rather than overwrite, and the caller
 * re-reads, re-merges and retries. Without this check a slow sync could
 * silently discard a change made on another device.
 */
export async function writeRemote(
  token: string,
  document: SyncDocument,
  existing?: { fileId: string; expectedVersion: string }
): Promise<{ fileId: string; version: string }> {
  const body = JSON.stringify(document)

  if (!existing) {
    // Multipart create: metadata part (naming it into appDataFolder) + content.
    const boundary = `boundary${Math.random().toString(36).slice(2)}`
    const metadata = JSON.stringify({ name: FILE_NAME, parents: ['appDataFolder'] })
    const payload =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${body}\r\n` +
      `--${boundary}--`

    const response = await driveFetch(token, `${DRIVE_UPLOAD}?uploadType=multipart&fields=id,version`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: payload,
    })
    const created = (await response.json()) as { id: string; version: string }
    return { fileId: created.id, version: created.version }
  }

  const current = await findFile(token)
  if (current && current.version !== existing.expectedVersion) throw new ConcurrentWriteError()

  const response = await driveFetch(
    token,
    `${DRIVE_UPLOAD}/${existing.fileId}?uploadType=media&fields=id,version`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body,
    }
  )
  const data = (await response.json()) as { id: string; version: string }
  return { fileId: data.id, version: data.version }
}
