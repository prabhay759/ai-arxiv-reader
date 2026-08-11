import { describe, expect, it } from 'vitest'
import { explainAuthError } from './auth'

describe('explainAuthError', () => {
  it('names the exact origin to authorise when Google rejects it', () => {
    // The most common setup mistake, and the one Google reports most opaquely.
    for (const code of [
      'idpiframe_initialization_failed',
      'invalid_client',
      'unauthorized_client',
      'origin_mismatch',
    ]) {
      const message = explainAuthError(code).message
      expect(message).toMatch(/Authorised JavaScript origins/)
      // jsdom/node both resolve to some origin string; the point is that the
      // message quotes one for the user to copy.
      expect(message).toMatch(/Add exactly "/)
    }
  })

  it('catches an origin complaint that arrives only in the description', () => {
    const message = explainAuthError('some_new_code', 'The given origin is not allowed').message
    expect(message).toMatch(/origin/i)
    expect(message).toMatch(/Authorised JavaScript origins/)
  })

  it('does not blame the user for cancelling', () => {
    expect(explainAuthError('access_denied').message).toMatch(/cancelled/i)
    expect(explainAuthError('popup_closed').message).toMatch(/closed/i)
  })

  it('explains a blocked pop-up as something fixable', () => {
    expect(explainAuthError('popup_failed_to_open').message).toMatch(/pop-ups/i)
  })

  it('calls out an admin policy block rather than implying a bug', () => {
    expect(explainAuthError('admin_policy_enforced').message).toMatch(/administrator/i)
  })

  it('falls back to whatever Google said', () => {
    expect(explainAuthError('weird_code').message).toBe('weird_code')
    expect(explainAuthError(undefined, 'something specific').message).toBe('something specific')
    expect(explainAuthError().message).toMatch(/failed/i)
  })
})
