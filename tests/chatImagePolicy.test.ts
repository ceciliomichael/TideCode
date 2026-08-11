import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculateContainedImageDimensions,
  CHAT_IMAGE_MAX_DIMENSION_PX,
  CHAT_IMAGE_TARGET_BYTES,
  isProviderNativeImageMimeType,
  shouldNormalizeChatImage,
} from '../src/lib/chatImagePolicy'

test('chat image dimensions fit within the shared multimodal bound without upscaling', () => {
  assert.deepEqual(calculateContainedImageDimensions(4_000, 2_000), {
    height: 784,
    width: CHAT_IMAGE_MAX_DIMENSION_PX,
  })
  assert.deepEqual(calculateContainedImageDimensions(800, 600), {
    height: 600,
    width: 800,
  })
})

test('provider-native MIME checks force unsupported image formats through conversion', () => {
  assert.equal(isProviderNativeImageMimeType('IMAGE/PNG'), true)
  assert.equal(isProviderNativeImageMimeType('image/webp'), true)
  assert.equal(isProviderNativeImageMimeType('image/svg+xml'), false)
  assert.equal(isProviderNativeImageMimeType('image/heic'), false)
})

test('chat images are normalized when either dimensions or encoded bytes are excessive', () => {
  assert.equal(shouldNormalizeChatImage({ height: 900, sizeBytes: 200_000, width: 1_200 }), false)
  assert.equal(shouldNormalizeChatImage({ height: 900, sizeBytes: CHAT_IMAGE_TARGET_BYTES + 1, width: 1_200 }), true)
  assert.equal(shouldNormalizeChatImage({ height: CHAT_IMAGE_MAX_DIMENSION_PX + 1, sizeBytes: 200_000, width: 900 }), true)
})
