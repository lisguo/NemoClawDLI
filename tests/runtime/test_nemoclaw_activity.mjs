// Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  BUILD_SIGNUP_URL,
  createNemoClawActivity,
} from '../../web/nemoclaw/scripts/_activity.js';

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function fakeSessionStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
}

function createFixture() {
  const calls = [];
  const activity = createNemoClawActivity({
    storageTarget: fakeSessionStorage(),
    now: () => new Date('2026-08-19T20:00:00Z'),
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith('/v1/activity-sessions')) {
        return jsonResponse(201, {
          activity_id: 'act_0198f100-0000-7000-8000-000000000001',
          session_token: 'opaque-session-token-with-safe-length',
          expires_at: '2026-08-19T21:00:00Z',
        });
      }
      if (url.endsWith('/referrals')) {
        return jsonResponse(201, { referral_id: 'referral-1', received_at: '2026-08-19T20:00:01Z' });
      }
      return jsonResponse(201, {
        update_id: 'update-1',
        received_at: '2026-08-19T20:00:02Z',
        state: { progress_percent: 10 },
      });
    },
  });
  return { activity, calls };
}

test('start creates the NemoClaw proof-of-concept activity session', async () => {
  const { activity, calls } = createFixture();

  await activity.start();

  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    artifact_id: 'artifact_nemoclaw_web',
    artifact_version: 'dev-local',
    artifact_digest: `sha256:${'0'.repeat(64)}`,
  });
});

test('the approved NVIDIA Build destination records one referral', async () => {
  const { activity, calls } = createFixture();

  await activity.trackBuildReferral(BUILD_SIGNUP_URL);

  const referral = calls.find(call => call.url.endsWith('/referrals'));
  assert.ok(referral);
  assert.deepEqual(JSON.parse(referral.init.body), {
    reference_id: 'build:nvidia-api-key',
    destination_url: BUILD_SIGNUP_URL,
  });
  assert.equal(referral.init.headers['Idempotency-Key'], 'nemoclaw:01a:build-signup');
});

test('an unapproved destination is not recorded as a referral', async () => {
  const { activity, calls } = createFixture();

  assert.equal(await activity.trackBuildReferral('https://attacker.example'), false);
  assert.equal(calls.length, 0);
});

test('verified API key records the provisional 10 percent milestone', async () => {
  const { activity, calls } = createFixture();

  await activity.recordApiKeyVerified();

  const update = calls.find(call => call.url.endsWith('/updates'));
  assert.ok(update);
  assert.deepEqual(JSON.parse(update.init.body), {
    type: 'progress',
    payload: { progress_percent: 10 },
  });
  assert.equal(update.init.headers['Idempotency-Key'], 'nemoclaw:01a:api-key-verified');
});

test('session state is reused from the injected browser storage', async () => {
  const storageTarget = fakeSessionStorage();
  let sessionRequests = 0;
  const fetchImpl = async url => {
    if (url.endsWith('/v1/activity-sessions')) sessionRequests += 1;
    return jsonResponse(201, {
      activity_id: 'act_0198f100-0000-7000-8000-000000000001',
      session_token: 'opaque-session-token-with-safe-length',
      expires_at: '2026-08-19T21:00:00Z',
    });
  };
  const options = { storageTarget, fetchImpl, now: () => new Date('2026-08-19T20:00:00Z') };

  await createNemoClawActivity(options).start();
  await createNemoClawActivity(options).start();

  assert.equal(sessionRequests, 1);
});

test('Module 1a explicitly wires session, referral, and verified progress events', () => {
  const page = fs.readFileSync('web/nemoclaw/01a-loop.html', 'utf8');

  assert.match(page, /createNemoClawActivity/);
  assert.match(page, /activity\.start\(\)/);
  assert.match(page, /activity\.trackBuildReferral\(anchor\.href\)/);
  assert.match(page, /activity\.recordApiKeyVerified\(\)/);
  assert.match(page, /onSave:[^}]+recordApiKeyVerified/s);
});
