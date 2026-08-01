import assert from 'node:assert/strict'
import test from 'node:test'
import { createAuthorizationUrl } from '../../electron/providers/codex/oauth'

test('Codex authorize URL matches the OpenCode browser auth shape', () => {
  const url = new URL(createAuthorizationUrl('challenge-123', 'state-123'))

  assert.equal(url.origin, 'https://auth.openai.com')
  assert.equal(url.pathname, '/oauth/authorize')
  assert.equal(url.searchParams.get('client_id'), 'app_EMoamEEZ73f0CkXaXp7hrann')
  assert.equal(url.searchParams.get('code_challenge'), 'challenge-123')
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(url.searchParams.get('codex_cli_simplified_flow'), 'true')
  assert.equal(url.searchParams.get('id_token_add_organizations'), 'true')
  assert.equal(url.searchParams.get('originator'), 'tidecode')
  assert.equal(url.searchParams.get('prompt'), 'login')
  assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:1455/auth/callback')
  assert.equal(url.searchParams.get('response_type'), 'code')
  assert.equal(url.searchParams.get('scope'), 'openid email profile offline_access')
  assert.equal(url.searchParams.get('state'), 'state-123')
})
