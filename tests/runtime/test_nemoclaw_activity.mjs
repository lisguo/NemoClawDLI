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
  resolveActivityBaseUrl,
} from '../../web/nemoclaw/scripts/_activity.js';

function createFixture({ progressPercent = 10 } = {}) {
  const calls = [];
  const facade = {
    progress: async (...args) => { calls.push(['progress', ...args]); },
    referral: async (...args) => { calls.push(['referral', ...args]); },
    getState: async () => {
      calls.push(['getState']);
      return { progressPercent, completedAt: null };
    },
    complete: async (...args) => {
      calls.push(['complete', ...args]);
      return progressPercent === 100 ? { written: true } : { written: false };
    },
  };
  const activity = createNemoClawActivity({
    initialize: async options => {
      calls.push(['initialize', options]);
      return facade;
    },
  });
  return { activity, calls };
}

test('NemoClaw imports only the public activity facade and contains no non-production hostnames', () => {
  const source = fs.readFileSync('web/nemoclaw/scripts/_activity.js', 'utf8');
  const publicSource = fs.readFileSync('web/nemoclaw/scripts/_activity_runtime.js', 'utf8')
    + fs.readFileSync('web/nemoclaw/04c-going-further.html', 'utf8') + source;

  assert.match(source, /import \{ DLIActivity \}/);
  assert.doesNotMatch(source, /createActivityClient/);
  assert.doesNotMatch(publicSource, /activity-api\.(?:dev|stage)\.learn\.nvidia\.com/);
});

test('the base URL resolver accepts explicit local injection and otherwise uses production', () => {
  assert.equal(resolveActivityBaseUrl({ __DLI_ACTIVITY_BASE_URL__: 'http://localhost:8787' }), 'http://localhost:8787');
  assert.equal(resolveActivityBaseUrl({}), 'https://activity-api.learn.nvidia.com');
});

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

test('start initializes the NemoClaw proof-of-concept activity once', async () => {
  const { activity, calls } = createFixture();

  await activity.start();
  await activity.start();

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'initialize');
  assert.equal(calls[0][1].baseUrl, 'https://activity-api.learn.nvidia.com');
  assert.deepEqual(calls[0][1].artifact, {
    artifact_id: 'artifact_nemoclaw_web',
    artifact_version: 'dev-local',
    artifact_digest: `sha256:${'0'.repeat(64)}`,
  });
  assert.equal('activity' in calls[0][1], false);
  assert.equal(typeof calls[0][1].storage.load, 'function');
});

test('failed initialization is retried while concurrent and successful attempts remain shared', async () => {
  const attempts = [];
  const activity = createNemoClawActivity({
    initialize: () => new Promise((resolve, reject) => attempts.push({ resolve, reject })),
  });

  const firstStart = activity.start();
  const concurrentStart = activity.start();
  await Promise.resolve();
  assert.equal(attempts.length, 1);

  attempts[0].reject(new Error('temporarily unavailable'));
  assert.equal(await firstStart, false);
  assert.equal(await concurrentStart, false);

  const retryStart = activity.start();
  const concurrentRetry = activity.start();
  await Promise.resolve();
  assert.equal(attempts.length, 2);

  attempts[1].resolve({});
  assert.equal(await retryStart, true);
  assert.equal(await concurrentRetry, true);
  assert.equal(await activity.start(), true);
  assert.equal(attempts.length, 2);
});

test('the approved NVIDIA Build destination records one referral', async () => {
  const { activity, calls } = createFixture();

  await activity.trackBuildReferral(BUILD_SIGNUP_URL);

  assert.deepEqual(calls.at(-1), ['referral', {
    referenceId: 'build:nvidia-api-key',
    destinationUrl: BUILD_SIGNUP_URL,
    idempotencyKey: 'nemoclaw:referral:build:nvidia-api-key',
  }]);
});

test('an unapproved destination is not recorded as a referral', async () => {
  const { activity, calls } = createFixture();

  assert.equal(await activity.trackBuildReferral('https://attacker.example'), false);
  assert.equal(calls.filter(call => call[0] === 'referral').length, 0);
});

test('a named milestone sends its cumulative progress with a stable idempotency key', async () => {
  const { activity, calls } = createFixture();

  assert.equal(await activity.recordMilestone('02b:grounded-answer-complete'), true);

  assert.deepEqual(calls.at(-1), ['progress', 45, {
    idempotencyKey: 'nemoclaw:milestone:02b:grounded-answer-complete',
  }]);
});

test('course completion is blocked below 100 percent', async () => {
  const { activity, calls } = createFixture({ progressPercent: 90 });

  assert.equal(await activity.recordCompletion(), false);
  assert.deepEqual(calls.at(-1), ['complete', { idempotencyKey: 'nemoclaw:course:completed' }]);
});

test('course completion is sent once state reaches 100 percent', async () => {
  const { activity, calls } = createFixture({ progressPercent: 100 });

  assert.equal(await activity.recordCompletion(), true);

  assert.deepEqual(calls.at(-1), ['complete', { idempotencyKey: 'nemoclaw:course:completed' }]);
});

test('course state is read through the facade', async () => {
  const { activity, calls } = createFixture({ progressPercent: 70 });

  assert.deepEqual(await activity.getCourseActivityState(), { progressPercent: 70, completedAt: null });
  assert.deepEqual(calls.at(-1), ['getState']);
});

test('facade failures remain contained and retryable at the lesson boundary', async () => {
  let attempts = 0;
  const activity = createNemoClawActivity({
    initialize: async () => ({
      complete: async () => {
        attempts += 1;
        throw new Error('temporarily unavailable');
      },
    }),
  });

  assert.equal(await activity.recordCompletion(), false);
  assert.equal(await activity.recordCompletion(), false);
  assert.equal(attempts, 2);
});

test('Module 1a explicitly wires session, referral, and verified progress events', () => {
  const page = fs.readFileSync('web/nemoclaw/01a-loop.html', 'utf8');

  assert.match(page, /nemoclaw:api-key-verified/);
  assert.doesNotMatch(page, /recordApiKeyVerified/);
});
