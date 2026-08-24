// Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  ACTIVITY_MILESTONES,
  ACTIVITY_REFERRALS,
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

function createFixture({ progressPercent = 10 } = {}) {
  const calls = [];
  const activity = createNemoClawActivity({
    storageTarget: fakeSessionStorage(),
    now: () => new Date('2026-08-19T20:00:00Z'),
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith('/v1/activity-sessions')) {
        return jsonResponse(201, {
          session_id: '0198f100-0000-7000-8000-000000000001',
          session_token: 'opaque-session-token-with-safe-length',
          expires_at: '2026-08-19T21:00:00Z',
        });
      }
      if (url.endsWith('/referrals')) {
        return jsonResponse(201, { referral_id: 'referral-1', received_at: '2026-08-19T20:00:01Z' });
      }
      if (url.endsWith('/state')) {
        return jsonResponse(200, { progress_percent: progressPercent, completed_at: null });
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

test('the milestone registry defines the approved cumulative progress model', () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(ACTIVITY_MILESTONES).map(([key, value]) => [key, value.progressPercent])),
    {
      '01a:model-call-verified': 10,
      '01b:react-loop-complete': 15,
      '01c:tool-roundtrip-complete': 25,
      '02a:routed-workflow-complete': 35,
      '02b:grounded-answer-complete': 45,
      '02c:deep-research-complete': 50,
      '03a:nemoclaw-connected': 60,
      '03b:workspace-inspected': 70,
      '03c:scheduled-run-complete': 80,
      '04a:policy-boundary-verified': 90,
      '04b:live-agent-operated': 100,
    },
  );
});

test('the referral registry includes product adoption and learning-path destinations', () => {
  assert.equal(ACTIVITY_REFERRALS[BUILD_SIGNUP_URL], 'build:nvidia-api-key');
  assert.equal(
    ACTIVITY_REFERRALS['https://brev.nvidia.com/launchable/deploy/now?launchableID=env-3Azt0aYgVNFEuz7opyx3gscmowS&ncid=ref-dli-759990'],
    'brev:nemoclaw-launchable',
  );
  assert.equal(
    ACTIVITY_REFERRALS['https://developer.nvidia.com/topics/ai/agentic-ai-learning-path/how-to-build-an-ai-agent'],
    'developer:agentic-learning-path:build-agent',
  );
  assert.equal(
    ACTIVITY_REFERRALS['https://developer.nvidia.com/topics/ai/agentic-ai-learning-path/how-to-build-safer-autonomous-agent-using-openclaw'],
    'developer:agentic-learning-path:safer-openclaw',
  );
});

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
  assert.equal(referral.init.headers['Idempotency-Key'], 'nemoclaw:referral:build:nvidia-api-key');
});

test('an unapproved destination is not recorded as a referral', async () => {
  const { activity, calls } = createFixture();

  assert.equal(await activity.trackBuildReferral('https://attacker.example'), false);
  assert.equal(calls.length, 0);
});

test('a named milestone sends its cumulative progress with a stable idempotency key', async () => {
  const { activity, calls } = createFixture();

  assert.equal(await activity.recordMilestone('02b:grounded-answer-complete'), true);

  const update = calls.find(call => call.url.endsWith('/updates'));
  assert.deepEqual(JSON.parse(update.init.body), {
    type: 'progress', payload: { progress_percent: 45 },
  });
  assert.equal(update.init.headers['Idempotency-Key'], 'nemoclaw:milestone:02b:grounded-answer-complete');
});

test('course completion is blocked below 100 percent', async () => {
  const { activity, calls } = createFixture({ progressPercent: 90 });

  assert.equal(await activity.recordCompletion(), false);
  assert.equal(calls.filter(call => call.url.endsWith('/updates')).length, 0);
});

test('course completion is sent once state reaches 100 percent', async () => {
  const { activity, calls } = createFixture({ progressPercent: 100 });

  assert.equal(await activity.recordCompletion(), true);

  const update = calls.find(call => call.url.endsWith('/updates'));
  assert.deepEqual(JSON.parse(update.init.body), { type: 'completed', payload: {} });
  assert.equal(update.init.headers['Idempotency-Key'], 'nemoclaw:course:completed');
});

test('session state is reused from the injected browser storage', async () => {
  const storageTarget = fakeSessionStorage();
  let sessionRequests = 0;
  const fetchImpl = async url => {
    if (url.endsWith('/v1/activity-sessions')) sessionRequests += 1;
    return jsonResponse(201, {
      session_id: '0198f100-0000-7000-8000-000000000001',
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

  assert.match(page, /nemoclaw:api-key-verified/);
  assert.doesNotMatch(page, /recordApiKeyVerified/);
});
