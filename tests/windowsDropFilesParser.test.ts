import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseDropFilesBuffer,
  parseFileNameBuffer,
  parseFileNameWBuffer,
  parseUriList,
  readClipboardFilesDirect,
} from '../electron/clipboard/windowsDropFilesParser.ts'

function createDropFilesBuffer(paths: string[], isWide = true): Buffer {
  const headerSize = 20
  if (isWide) {
    const encoded = Buffer.concat([
      ...paths.map((p) => Buffer.from(p + '\0', 'utf16le')),
      Buffer.from('\0', 'utf16le'),
    ])
    const buf = Buffer.alloc(headerSize + encoded.length)
    buf.writeUInt32LE(headerSize, 0) // pFiles
    buf.writeInt32LE(0, 4) // pt.x
    buf.writeInt32LE(0, 8) // pt.y
    buf.writeInt32LE(0, 12) // fNC
    buf.writeInt32LE(1, 16) // fWide = 1
    encoded.copy(buf, headerSize)
    return buf
  } else {
    const encoded = Buffer.concat([
      ...paths.map((p) => Buffer.from(p + '\0', 'utf8')),
      Buffer.from('\0', 'utf8'),
    ])
    const buf = Buffer.alloc(headerSize + encoded.length)
    buf.writeUInt32LE(headerSize, 0) // pFiles
    buf.writeInt32LE(0, 4) // pt.x
    buf.writeInt32LE(0, 8) // pt.y
    buf.writeInt32LE(0, 12) // fNC
    buf.writeInt32LE(0, 16) // fWide = 0
    encoded.copy(buf, headerSize)
    return buf
  }
}

test('parseDropFilesBuffer decodes single and multiple UTF-16LE file paths', () => {
  const paths = ['C:\\Users\\Admin\\file1.txt', 'D:\\Projects\\app\\index.ts']
  const buf = createDropFilesBuffer(paths, true)
  const result = parseDropFilesBuffer(buf)
  assert.deepEqual(result, paths)
})

test('parseDropFilesBuffer decodes ANSI file paths when fWide is 0', () => {
  const paths = ['C:\\temp\\file.txt']
  const buf = createDropFilesBuffer(paths, false)
  const result = parseDropFilesBuffer(buf)
  assert.deepEqual(result, paths)
})

test('parseDropFilesBuffer returns empty on invalid or truncated buffer', () => {
  assert.deepEqual(parseDropFilesBuffer(null), [])
  assert.deepEqual(parseDropFilesBuffer(Buffer.alloc(10)), [])
  const shortBuf = Buffer.alloc(24)
  shortBuf.writeUInt32LE(50, 0) // pFiles beyond buffer length
  assert.deepEqual(parseDropFilesBuffer(shortBuf), [])
})

test('parseFileNameWBuffer decodes null-terminated UTF-16LE strings', () => {
  const buf = Buffer.from('C:\\work\\file.png\0', 'utf16le')
  assert.deepEqual(parseFileNameWBuffer(buf), ['C:\\work\\file.png'])
})

test('parseFileNameBuffer decodes null-terminated UTF-8 strings', () => {
  const buf = Buffer.from('C:\\work\\file.png\0', 'utf8')
  assert.deepEqual(parseFileNameBuffer(buf), ['C:\\work\\file.png'])
})

test('parseUriList decodes file:// URLs to valid file paths', () => {
  const uriList = 'file:///C:/Users/Admin/Document.pdf\r\n# Comment\r\nfile:///D:/Images/photo.jpg'
  const result = parseUriList(uriList)
  assert.equal(result.length, 2)
  assert.ok(result[0].includes('Document.pdf'))
  assert.ok(result[1].includes('photo.jpg'))
})

test('readClipboardFilesDirect extracts paths from CF_HDROP buffer with priority', () => {
  const paths = ['C:\\test\\a.txt', 'C:\\test\\b.txt']
  const buf = createDropFilesBuffer(paths, true)
  const mockClipboard = {
    has: (format: string) => format === 'CF_HDROP',
    read: () => '',
    readBuffer: (format: string) => (format === 'CF_HDROP' ? buf : Buffer.alloc(0)),
  }
  const result = readClipboardFilesDirect(mockClipboard)
  assert.deepEqual(result, paths)
})

test('readClipboardFilesDirect falls back to FileNameW if CF_HDROP is absent', () => {
  const fileNameWBuf = Buffer.from('C:\\work\\single-file.txt\0', 'utf16le')
  const mockClipboard = {
    has: (format: string) => format === 'FileNameW',
    read: () => '',
    readBuffer: (format: string) => (format === 'FileNameW' ? fileNameWBuf : Buffer.alloc(0)),
  }
  const result = readClipboardFilesDirect(mockClipboard)
  assert.deepEqual(result, ['C:\\work\\single-file.txt'])
})
