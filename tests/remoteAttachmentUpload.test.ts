import assert from 'node:assert/strict'
import test from 'node:test'
import { uploadRemoteAttachmentSelection } from '../src/remote/remoteAttachmentUpload'

test('remote binary files upload without using the text-only attachment fallback', async () => {
  const originalFetch = globalThis.fetch
  const requests: Array<{ method: string; url: string }> = []
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    requests.push({ method, url })
    if (url.endsWith('/remote/attachments/start')) {
      return new Response(JSON.stringify({ uploadId: 'upload-1' }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      })
    }
    if (url.endsWith('/remote/attachments/upload-1/complete')) {
      return new Response(JSON.stringify({
        attachment: {
          fileName: 'spec.pdf',
          kind: 'file',
          mimeType: 'application/pdf',
          path: '@attachments/spec.pdf',
          sizeBytes: 8,
        },
      }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      })
    }
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    })
  }

  try {
    const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2, 3, 4])], 'spec.pdf', {
      type: 'application/pdf',
    })
    const attachment = await uploadRemoteAttachmentSelection({ file, kind: 'file' }, 'conversation-1')
    assert.equal(attachment.kind, 'file')
    assert.equal(attachment.path, '@attachments/spec.pdf')
    assert.equal(attachment.mimeType, 'application/pdf')
    assert.deepEqual(requests, [
      { method: 'POST', url: '/remote/attachments/start' },
      { method: 'PUT', url: '/remote/attachments/upload-1' },
      { method: 'POST', url: '/remote/attachments/upload-1/complete' },
    ])
  } finally {
    globalThis.fetch = originalFetch
  }
})
