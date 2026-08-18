import assert from 'node:assert/strict'
import test from 'node:test'
import {
  REMOTE_PROTOCOL_VERSION,
  isRemoteRpcNamespace,
  isRemoteRpcRequest,
} from '../src/remote/protocol'

test('remote RPC protocol accepts a valid request envelope', () => {
  assert.equal(isRemoteRpcRequest({
    args: [{ conversationId: 'conversation-1' }],
    id: 'request-1',
    kind: 'rpc',
    method: 'getConversation',
    namespace: 'tidecodeHistory',
    protocolVersion: REMOTE_PROTOCOL_VERSION,
  }), true)
})

test('remote RPC protocol rejects version mismatches', () => {
  assert.equal(isRemoteRpcRequest({
    args: [],
    id: 'request-1',
    kind: 'rpc',
    method: 'listConversations',
    namespace: 'tidecodeHistory',
    protocolVersion: REMOTE_PROTOCOL_VERSION + 1,
  }), false)
})

test('remote RPC protocol rejects unknown namespaces and malformed arguments', () => {
  assert.equal(isRemoteRpcNamespace('tidecodeHistory'), true)
  assert.equal(isRemoteRpcNamespace('ipcRenderer'), false)
  assert.equal(isRemoteRpcNamespace('tidecodeRemoteHost'), false)
  assert.equal(isRemoteRpcRequest({
    args: 'not-an-array',
    id: 'request-1',
    kind: 'rpc',
    method: 'invoke',
    namespace: 'ipcRenderer',
    protocolVersion: REMOTE_PROTOCOL_VERSION,
  }), false)
})

test('remote RPC protocol requires non-empty request ids and method names', () => {
  assert.equal(isRemoteRpcRequest({
    args: [],
    id: '',
    kind: 'rpc',
    method: '',
    namespace: 'tidecodeChat',
    protocolVersion: REMOTE_PROTOCOL_VERSION,
  }), false)
})
