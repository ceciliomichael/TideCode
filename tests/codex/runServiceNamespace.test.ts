import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import {
  configureDevelopmentRunServiceNamespace,
  createDevelopmentRunServiceNamespace,
  resolveRunServiceNamespace,
  RUN_SERVICE_NAMESPACE_ENV,
} from '../../electron/runService/namespace'
import {
  getRunServiceDirectory,
  getRunServiceEndpoint,
} from '../../electron/runService/paths'
import { RUN_SERVICE_PROTOCOL_VERSION } from '../../electron/runService/protocol'

test('development run-service namespaces are stable per runtime root and separate workspaces', () => {
  const first = createDevelopmentRunServiceNamespace('C:\\work\\tidecode', 'win32')
  const equivalent = createDevelopmentRunServiceNamespace('c:\\work\\tidecode', 'win32')
  const second = createDevelopmentRunServiceNamespace('C:\\work\\tidecode-two', 'win32')

  assert.equal(first, equivalent)
  assert.notEqual(first, second)
  assert.match(first, /^dev-[a-f0-9]{16}$/u)
})

test('an explicit valid run-service namespace is preserved', () => {
  const environment: NodeJS.ProcessEnv = {
    [RUN_SERVICE_NAMESPACE_ENV]: 'feature_test-7',
  }

  assert.equal(
    configureDevelopmentRunServiceNamespace('C:\\work\\tidecode', environment, 'win32'),
    'feature_test-7',
  )
  assert.equal(environment[RUN_SERVICE_NAMESPACE_ENV], 'feature_test-7')
})

test('invalid run-service namespaces fail before constructing filesystem or pipe paths', () => {
  assert.throws(
    () => resolveRunServiceNamespace({ [RUN_SERVICE_NAMESPACE_ENV]: '../production' }),
    /TIDECODE_RUN_SERVICE_NAMESPACE/u,
  )
})

test('production and development services use different directories and Windows pipes', () => {
  const homeDirectory = 'C:\\Users\\tester'
  const productionEnvironment: NodeJS.ProcessEnv = {}
  const developmentEnvironment: NodeJS.ProcessEnv = {
    [RUN_SERVICE_NAMESPACE_ENV]: 'dev-0123456789abcdef',
  }

  const productionDirectory = getRunServiceDirectory({
    environment: productionEnvironment,
    homeDirectory,
    platform: 'win32',
  })
  const developmentDirectory = getRunServiceDirectory({
    environment: developmentEnvironment,
    homeDirectory,
    platform: 'win32',
  })
  const productionEndpoint = getRunServiceEndpoint({
    environment: productionEnvironment,
    homeDirectory,
    platform: 'win32',
  })
  const developmentEndpoint = getRunServiceEndpoint({
    environment: developmentEnvironment,
    homeDirectory,
    platform: 'win32',
    windowsIntegrityLevel: 8192,
  })

  assert.equal(productionDirectory, path.join(homeDirectory, '.tidecode', 'run-service'))
  assert.equal(
    developmentDirectory,
    path.join(homeDirectory, '.tidecode', 'run-service', 'dev-0123456789abcdef'),
  )
  assert.notEqual(productionEndpoint, developmentEndpoint)
  assert.match(developmentEndpoint, /-dev-0123456789abcdef-il-8192$/u)
})

test('Windows development pipes separate security levels without changing saved data paths', () => {
  const options = {
    environment: { [RUN_SERVICE_NAMESPACE_ENV]: 'dev-0123456789abcdef' },
    homeDirectory: 'C:\\Users\\tester',
    platform: 'win32' as const,
  }
  const normalOptions = { ...options, windowsIntegrityLevel: 8192 }
  const elevatedOptions = { ...options, windowsIntegrityLevel: 12288 }

  assert.notEqual(getRunServiceEndpoint(normalOptions), getRunServiceEndpoint(elevatedOptions))
  assert.equal(getRunServiceEndpoint(normalOptions), getRunServiceEndpoint({ ...normalOptions }))
  assert.equal(getRunServiceDirectory(normalOptions), getRunServiceDirectory(elevatedOptions))
  assert.throws(() => getRunServiceEndpoint({ ...options, windowsIntegrityLevel: NaN }), /Windows security level/u)
})

test('production and explicit non-development endpoints do not depend on Windows integrity', () => {
  for (const environment of [{}, { [RUN_SERVICE_NAMESPACE_ENV]: 'feature_test-7' }]) {
    const options = { environment, homeDirectory: 'C:\\Users\\tester', platform: 'win32' as const }
    assert.equal(
      getRunServiceEndpoint({ ...options, windowsIntegrityLevel: 8192 }),
      getRunServiceEndpoint({ ...options, windowsIntegrityLevel: 12288 }),
    )
  }
})

test('Unix development sockets live inside the namespaced service directory', () => {
  const environment: NodeJS.ProcessEnv = {
    [RUN_SERVICE_NAMESPACE_ENV]: 'dev-0123456789abcdef',
  }
  const endpoint = getRunServiceEndpoint({
    environment,
    homeDirectory: '/home/tester',
    platform: 'linux',
  })

  assert.equal(
    endpoint,
    path.join(
      '/home/tester',
      '.tidecode',
      'run-service',
      'dev-0123456789abcdef',
      `service-v${RUN_SERVICE_PROTOCOL_VERSION}.sock`,
    ),
  )
})
