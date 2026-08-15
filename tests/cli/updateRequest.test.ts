import test from 'node:test'
import assert from 'node:assert/strict'
import { hasExternalUpdateRequest, TIDECODE_INSTALL_UPDATE_ARGUMENT } from '../../src/lib/updateRequest'

test('desktop recognizes an update request relayed by the CLI', () => {
  assert.equal(hasExternalUpdateRequest(['TideCode.exe', TIDECODE_INSTALL_UPDATE_ARGUMENT]), true)
  assert.equal(hasExternalUpdateRequest(['TideCode.exe']), false)
})
