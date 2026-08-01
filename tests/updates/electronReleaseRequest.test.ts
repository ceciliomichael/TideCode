import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildLatestReleaseRequestUrl,
  TIDECODE_LATEST_RELEASE_API_URL,
} from '../../electron/updates/githubReleaseService'

test('latest release requests include a cache-busting query value', () => {
  const requestUrl = buildLatestReleaseRequestUrl(123456789)

  assert.equal(requestUrl, `${TIDECODE_LATEST_RELEASE_API_URL}?_=123456789`)
})
