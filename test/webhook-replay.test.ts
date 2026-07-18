import { describe, test, beforeEach } from 'node:test'
import * as assert from 'node:assert/strict'
import './setup-env'
import { replayMockEvent, resetMockData } from '../lib/api/mock'
import { WebhookEventLog } from '../lib/api/types'
import { config } from '../lib/config'

const BASE_EVENT: WebhookEventLog = {
  id: 'wh_test_01',
  eventType: 'membership.created',
  status: 'success',
  timestamp: new Date('2026-07-01T00:00:00Z').toISOString(),
  affectedIdentifier: '0xABCDEF1234567890ABCDEF1234567890ABCDEF12',
  payloadSummary: { network: 'ethereum', txHash: '0xdead...beef', tier: 'pro' },
}

// ── replayMockEvent behaviour ────────────────────────────────────────────────

describe('replayMockEvent', () => {
  beforeEach(() => resetMockData())

  test('returns a copy with replay-prefixed id and pending status', () => {
    const result = replayMockEvent(BASE_EVENT)
    assert.ok(result.id.startsWith('replay_wh_test_01_'))
    assert.equal(result.status, 'pending')
    assert.notEqual(result.timestamp, BASE_EVENT.timestamp)
  })

  test('does not mutate the original event', () => {
    const originalId = BASE_EVENT.id
    const originalStatus = BASE_EVENT.status
    replayMockEvent(BASE_EVENT)
    assert.equal(BASE_EVENT.id, originalId)
    assert.equal(BASE_EVENT.status, originalStatus)
  })

  test('prepends the replayed event so it appears first in the feed', async () => {
    const { MockAccessApi } = require('../lib/api/mock')
    replayMockEvent(BASE_EVENT)
    const api = new MockAccessApi('0x1234567890123456789012345678901234567890')
    const events = await api.listWebhookEvents()
    assert.ok(events[0].id.startsWith('replay_wh_test_01_'))
    assert.equal(events[0].status, 'pending')
  })

  test('applies side effects: membership.created seeds the member store', async () => {
    const { MockAccessApi } = require('../lib/api/mock')
    replayMockEvent({
      ...BASE_EVENT,
      eventType: 'membership.created',
      affectedIdentifier: '0x0000000000000000000000000000000000000042',
      payloadSummary: { tier: 'pro' },
    })
    const api = new MockAccessApi('0x0000000000000000000000000000000000000042')
    const session = await api.getSession()
    assert.equal(session.membership?.tier, 'pro')
    assert.equal(session.membership?.active, true)
  })

  test('applies side effects: membership.expired deactivates the member', async () => {
    const { MockAccessApi } = require('../lib/api/mock')
    const addr = '0x0000000000000000000000000000000000000043'
    // Seed an active member first
    replayMockEvent({
      ...BASE_EVENT,
      eventType: 'membership.created',
      affectedIdentifier: addr,
      payloadSummary: { tier: 'standard' },
    })
    // Then expire
    replayMockEvent({
      ...BASE_EVENT,
      eventType: 'membership.expired',
      affectedIdentifier: addr,
      payloadSummary: { reason: 'timeout' },
    })
    const api = new MockAccessApi(addr)
    const session = await api.getSession()
    assert.equal(session.membership?.active, false)
  })

  test('applies side effects: tier.upgraded promotes the member', async () => {
    const { MockAccessApi } = require('../lib/api/mock')
    const addr = '0x0000000000000000000000000000000000000044'
    replayMockEvent({
      ...BASE_EVENT,
      eventType: 'membership.created',
      affectedIdentifier: addr,
      payloadSummary: { tier: 'free' },
    })
    replayMockEvent({
      ...BASE_EVENT,
      eventType: 'tier.upgraded',
      affectedIdentifier: addr,
      payloadSummary: { tier: 'pro' },
    })
    const api = new MockAccessApi(addr)
    const session = await api.getSession()
    assert.equal(session.membership?.tier, 'pro')
  })
})

// ── Mock-mode gating ─────────────────────────────────────────────────────────

describe('replay gating', () => {
  test('config.apiMode is mock in test environment', () => {
    assert.equal(config.apiMode, 'mock')
  })

  test('replayMockEvent is a no-op safety note: callers must check apiMode', () => {
    // The function itself does not check apiMode — callers are responsible.
    // This test codifies the contract: replayMockEvent always mutates the mock
    // store regardless of config.  The UI and any future live callers MUST
    // gate on `config.apiMode === 'mock'` before calling.
    const result = replayMockEvent(BASE_EVENT)
    assert.ok(result.id.startsWith('replay_'))
  })
})

// ── Replayed event visual distinction ────────────────────────────────────────

describe('replayed event identification', () => {
  beforeEach(() => resetMockData())

  test('replayed events have a distinct replay_ id prefix', () => {
    const result = replayMockEvent(BASE_EVENT)
    assert.ok(result.id.startsWith('replay_'))
    assert.ok(result.id.includes('wh_test_01'))
    // Contains a timestamp suffix for uniqueness
    assert.ok(/\d{13}/.test(result.id.split('_').pop()!))
  })

  test('non-replayed events do not have the replay_ prefix', () => {
    assert.equal(BASE_EVENT.id.startsWith('replay_'), false)
  })

  test('isReplayedEvent helper identifies replayed events correctly', () => {
    const isReplayed = (id: string) => id.startsWith('replay_')
    assert.equal(isReplayed('replay_wh_test_01_1234567890'), true)
    assert.equal(isReplayed('wh_test_01'), false)
    assert.equal(isReplayed('membership.created'), false)
  })
})
