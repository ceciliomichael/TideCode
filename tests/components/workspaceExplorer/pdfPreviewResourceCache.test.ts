import assert from 'node:assert/strict'
import test from 'node:test'
import { PdfPreviewResourceCache } from '../../../src/lib/pdfPreviewResourceCache'

test('PDF documents stay pinned while a view owns them and are destroyed after release', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const disposed: string[] = []
  const cache = new PdfPreviewResourceCache((key) => ({
    promise: Promise.resolve(key), dispose: () => { disposed.push(key) },
  }))
  const first = cache.acquire('first')
  for (let index = 0; index < 6; index += 1) {
    cache.acquire(`other-${index}`).release()
  }
  assert.equal(disposed.includes('first'), false)
  first.release()
  first.release()
  t.mock.timers.tick(1_000)
  assert.equal(disposed.filter((key) => key === 'first').length, 1)
})

test('PDF reacquisition cancels expiry and clear defers destruction of active documents', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let created = 0
  let destroyed = 0
  const cache = new PdfPreviewResourceCache(() => ({
    promise: Promise.resolve(++created), dispose: () => { destroyed += 1 },
  }))
  const first = cache.acquire('document')
  first.release()
  const second = cache.acquire('document')
  assert.equal(await first.promise, await second.promise)
  t.mock.timers.tick(2_000)
  assert.equal(destroyed, 0)
  cache.clear()
  assert.equal(destroyed, 0)
  const third = cache.acquire('document')
  assert.equal(await third.promise, 2)
  second.release()
  assert.equal(destroyed, 1)
  third.release()
  t.mock.timers.tick(1_000)
  assert.equal(destroyed, 2)
})

test('failed PDF load releases its worker and cannot delete a replacement entry', async () => {
  let reject!: (reason: Error) => void
  let created = 0
  let destroyed = 0
  const cache = new PdfPreviewResourceCache(() => ({
    promise: ++created === 1 ? new Promise<number>((_, fail) => { reject = fail }) : Promise.resolve(2),
    dispose: () => { destroyed += 1 },
  }))
  const first = cache.acquire('document')
  cache.clear()
  const second = cache.acquire('document')
  reject(new Error('load failed'))
  await assert.rejects(first.promise, /load failed/)
  first.release()
  const third = cache.acquire('document')
  assert.equal(await third.promise, 2)
  assert.equal(created, 2)
  assert.equal(destroyed, 1)
  cache.clear()
  second.release()
  third.release()
})

test('PDF source byte budget releases inactive oversized documents immediately', () => {
  let destroyed = 0
  const cache = new PdfPreviewResourceCache(() => ({ promise: Promise.resolve(1), dispose: () => { destroyed += 1 } }), 1_000, 4)
  const lease = cache.acquire('oversized')
  assert.equal(destroyed, 0)
  lease.release()
  assert.equal(destroyed, 1)
})
