import { describe, it, beforeEach, after } from 'node:test'
import * as assert from 'node:assert/strict'
import { isGatewayConfigured, isGatewayDependencyAvailable } from '../lib/integration-client'

describe('Integration gateway health checks (#84)', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  after(() => {
    process.env = originalEnv
  })

  it('isGatewayConfigured returns true when INTEGRATION_API_KEY is set', () => {
    process.env.INTEGRATION_API_KEY = '***'
    assert.equal(isGatewayConfigured(), true)
  })

  it('isGatewayConfigured returns false when INTEGRATION_API_KEY is missing', () => {
    delete process.env.INTEGRATION_API_KEY
    assert.equal(isGatewayConfigured(), false)
  })

  it('isGatewayConfigured returns false when INTEGRATION_API_KEY is empty', () => {
    process.env.INTEGRATION_API_KEY = ''
    assert.equal(isGatewayConfigured(), false)
  })

  it('isGatewayConfigured returns true when INTEGRATION_API_KEY is whitespace', () => {
    process.env.INTEGRATION_API_KEY = '   '
    assert.equal(isGatewayConfigured(), true)
  })

  it('does not expose the API key value in return', () => {
    process.env.INTEGRATION_API_KEY = 'super-secret-live-key-12345'
    const result = isGatewayConfigured()
    assert.equal(result, true)
    assert.equal(typeof result, 'boolean')
    assert.equal(JSON.stringify(result).includes('super-secret-live-key-12345'), false)
  })

  it('isGatewayDependencyAvailable returns false when package is not installed', () => {
    assert.equal(isGatewayDependencyAvailable(), false)
  })
})
