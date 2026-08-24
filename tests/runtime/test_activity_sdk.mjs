// Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ActivitySdkError,
  DLIActivity,
  DLIActivityError,
  createActivityClient,
  createMemoryActivityStorage,
} from '../../web/shared/activity-sdk.js';

const artifact = {
  artifact_id: 'artifact_nemoclaw_web',
  artifact_version: 'dev-local',
  artifact_digest: `sha256:${'0'.repeat(64)}`,
};

const ACTIVITY = artifact;

function fakeStorage() {
  return createMemoryActivityStorage();
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function sessionResponse(overrides = {}) {
  return {
    session_id: '0198f100-0000-7000-8000-000000000001',
    session_token: 'opaque-session-token-with-safe-length',
    expires_at: '2026-08-19T21:00:00Z',
    ...overrides,
  };
}

test('public initialization creates one activity session', async () => {
  let sessionCreateCalls = 0;
  const now = () => new Date('2026-08-19T20:00:00Z');
  const fetchImpl = async () => {
    sessionCreateCalls += 1;
    return jsonResponse(201, sessionResponse());
  };

  const activity = await DLIActivity.initialize({
    baseUrl: 'https://activity-api.example.test',
    activity: ACTIVITY,
    storage: fakeStorage(),
    fetchImpl,
    now,
  });

  assert.equal(activity instanceof DLIActivity, true);
  assert.equal(sessionCreateCalls, 1);
});

test('public initialization rejects unsafe activity API base URLs', async () => {
  const unsafeBaseUrls = [
    'https://user:secret@activity-api.example.test',
    'https://activity-api.example.test?mode=test',
    'https://activity-api.example.test#fragment',
    'http://activity-api.example.test',
  ];

  for (const baseUrl of unsafeBaseUrls) {
    await assert.rejects(
      DLIActivity.initialize({ baseUrl, activity: ACTIVITY }),
      error => error instanceof DLIActivityError,
    );
  }
});

test('public progress records a monotonic integer percentage', async () => {
  const calls = [];
  const responses = [
    jsonResponse(201, sessionResponse()),
    jsonResponse(201, { update_id: 'progress-50', state: { progress_percent: 75 } }),
  ];
  const activity = await DLIActivity.initialize({
    baseUrl: 'https://activity-api.example.test',
    activity: ACTIVITY,
    storage: fakeStorage(),
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return responses.shift();
    },
    now: () => new Date('2026-08-19T20:00:00Z'),
  });

  await activity.progress(50);
  await activity.progress(70);

  assert.equal(calls.length, 2);
  assert.equal(calls[1].init.headers['Idempotency-Key'], 'dli-activity:progress:50');
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    type: 'progress',
    payload: { progress_percent: 50 },
  });
});

test('public progress preserves a caller idempotency key', async () => {
  const calls = [];
  const activity = await DLIActivity.initialize({
    baseUrl: 'https://activity-api.example.test',
    activity: ACTIVITY,
    storage: fakeStorage(),
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return calls.length === 1
        ? jsonResponse(201, sessionResponse())
        : jsonResponse(201, { update_id: 'progress-25', state: { progress_percent: 25 } });
    },
    now: () => new Date('2026-08-19T20:00:00Z'),
  });

  await activity.progress(25, { idempotencyKey: 'course:checkpoint:25' });

  assert.equal(calls[1].init.headers['Idempotency-Key'], 'course:checkpoint:25');
});

test('public progress rejects invalid percentages before fetch', async () => {
  const activity = new DLIActivity({
    baseUrl: 'https://activity-api.example.test',
    activity: ACTIVITY,
    storage: fakeStorage(),
    fetchImpl: async () => assert.fail('fetch must not run'),
  });

  for (const progressPercent of [-1, 101, 50.5, '50']) {
    await assert.rejects(
      activity.progress(progressPercent),
      error => error instanceof DLIActivityError && error.code === 'invalid_progress',
    );
  }
});

test('public referral records a portable destination', async () => {
  const calls = [];
  const activity = await DLIActivity.initialize({
    baseUrl: 'https://activity-api.example.test',
    activity: ACTIVITY,
    storage: fakeStorage(),
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return calls.length === 1
        ? jsonResponse(201, sessionResponse())
        : jsonResponse(201, { referral_id: 'referral-1' });
    },
    now: () => new Date('2026-08-19T20:00:00Z'),
  });

  await activity.referral({
    referenceId: 'brev:nemoclaw-lab',
    destinationUrl: 'https://brev.nvidia.com/',
  });

  assert.equal(calls[1].init.headers['Idempotency-Key'], 'dli-activity:referral:brev:nemoclaw-lab');
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    reference_id: 'brev:nemoclaw-lab',
    destination_url: 'https://brev.nvidia.com/',
  });
});

test('public referral rejects invalid input before fetch', async () => {
  const activity = new DLIActivity({
    baseUrl: 'https://activity-api.example.test',
    activity: ACTIVITY,
    storage: fakeStorage(),
    fetchImpl: async () => assert.fail('fetch must not run'),
  });

  for (const referral of [
    { referenceId: ' ', destinationUrl: 'https://brev.nvidia.com/' },
    { referenceId: 'brev:nemoclaw-lab', destinationUrl: 'not a URL' },
    { referenceId: 'brev:nemoclaw-lab', destinationUrl: 'javascript:alert(1)' },
  ]) {
    await assert.rejects(
      activity.referral(referral),
      error => error instanceof DLIActivityError && error.code === 'invalid_referral',
    );
  }
});

test('public state normalizes documented fields without authentication data', async () => {
  const responses = [
    jsonResponse(201, sessionResponse()),
    jsonResponse(200, {
      progress_percent: 50,
      completed_at: null,
      last_update: {
        update_id: 'update-50',
        checkpoint_items: [{ reference_id: 'module:02c' }],
      },
      session_token: 'must-not-escape',
      authorization: { bearer_token: 'must-not-escape' },
    }),
  ];
  const activity = await DLIActivity.initialize({
    baseUrl: 'https://activity-api.example.test',
    activity: ACTIVITY,
    storage: fakeStorage(),
    fetchImpl: async () => responses.shift(),
    now: () => new Date('2026-08-19T20:00:00Z'),
  });

  const state = await activity.getState();

  assert.deepEqual(state, {
    progressPercent: 50,
    completedAt: null,
    lastUpdate: {
      updateId: 'update-50',
      checkpointItems: [{ referenceId: 'module:02c' }],
    },
  });
  assert.equal('sessionToken' in state, false);
  assert.equal('authorization' in state, false);
});

test('public completion refreshes state and skips a premature write', async () => {
  const calls = [];
  const responses = [
    jsonResponse(201, sessionResponse()),
    jsonResponse(200, { progress_percent: 90, completed_at: null }),
  ];
  const activity = await DLIActivity.initialize({
    baseUrl: 'https://activity-api.example.test',
    activity: ACTIVITY,
    storage: fakeStorage(),
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return responses.shift();
    },
    now: () => new Date('2026-08-19T20:00:00Z'),
  });

  assert.deepEqual(await activity.complete(), {
    written: false,
    state: { progressPercent: 90, completedAt: null },
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].init.method, 'GET');
});

test('public completion records an eligible completed update', async () => {
  const calls = [];
  const responses = [
    jsonResponse(201, sessionResponse()),
    jsonResponse(200, { progress_percent: 100, completed_at: null }),
    jsonResponse(201, { update_id: 'completed-1', state: { progress_percent: 100 } }),
  ];
  const activity = await DLIActivity.initialize({
    baseUrl: 'https://activity-api.example.test',
    activity: ACTIVITY,
    storage: fakeStorage(),
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return responses.shift();
    },
    now: () => new Date('2026-08-19T20:00:00Z'),
  });

  await activity.complete();

  assert.equal(calls.length, 3);
  assert.equal(calls[2].init.headers['Idempotency-Key'], 'dli-activity:completed');
  assert.deepEqual(JSON.parse(calls[2].init.body), { type: 'completed', payload: {} });
});

test('public completion preserves a caller idempotency key', async () => {
  const calls = [];
  const responses = [
    jsonResponse(201, sessionResponse()),
    jsonResponse(200, { progress_percent: 100, completed_at: null }),
    jsonResponse(201, { update_id: 'completed-1' }),
  ];
  const activity = await DLIActivity.initialize({
    baseUrl: 'https://activity-api.example.test',
    activity: ACTIVITY,
    storage: fakeStorage(),
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return responses.shift();
    },
    now: () => new Date('2026-08-19T20:00:00Z'),
  });

  await activity.complete({ idempotencyKey: 'course:completed' });

  assert.equal(calls[2].init.headers['Idempotency-Key'], 'course:completed');
});

test('concurrent initialization creates and stores one activity session', async () => {
  const calls = [];
  const storage = createMemoryActivityStorage();
  const client = createActivityClient({
    baseUrl: 'https://activity.example.test',
    artifact,
    storage,
    now: () => new Date('2026-08-19T20:00:00Z'),
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse(201, sessionResponse());
    },
  });

  const [first, second] = await Promise.all([client.ensureSession(), client.ensureSession()]);

  assert.deepEqual(first, second);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://activity.example.test/v1/activity-sessions');
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), artifact);
  assert.equal(calls[0].init.headers.Authorization, undefined);
  assert.deepEqual(storage.load(), sessionResponse());
});

test('an unexpired stored session is reused without a request', async () => {
  const storage = createMemoryActivityStorage(sessionResponse());
  const client = createActivityClient({
    baseUrl: 'https://activity.example.test',
    artifact,
    storage,
    now: () => new Date('2026-08-19T20:00:00Z'),
    fetchImpl: async () => assert.fail('fetch must not run'),
  });

  assert.deepEqual(await client.ensureSession(), sessionResponse());
});

test('an expired stored session is replaced', async () => {
  const storage = createMemoryActivityStorage(sessionResponse({ expires_at: '2026-08-19T19:00:00Z' }));
  let requests = 0;
  const replacement = sessionResponse({ session_id: '0198f100-0000-7000-8000-000000000002' });
  const client = createActivityClient({
    baseUrl: 'https://activity.example.test',
    artifact,
    storage,
    now: () => new Date('2026-08-19T20:00:00Z'),
    fetchImpl: async () => {
      requests += 1;
      return jsonResponse(201, replacement);
    },
  });

  assert.deepEqual(await client.ensureSession(), replacement);
  assert.equal(requests, 1);
  assert.deepEqual(storage.load(), replacement);
});

test('referral and progress writes use bearer and idempotency headers', async () => {
  const calls = [];
  const client = createActivityClient({
    baseUrl: 'https://activity.example.test',
    artifact,
    storage: createMemoryActivityStorage(sessionResponse()),
    now: () => new Date('2026-08-19T20:00:00Z'),
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse(201, url.endsWith('/referrals')
        ? { referral_id: 'referral-1', received_at: '2026-08-19T20:00:01Z' }
        : { update_id: 'update-1', received_at: '2026-08-19T20:00:02Z', state: { progress_percent: 10 } });
    },
  });

  await client.recordReferral({
    referenceId: 'build:nvidia-api-key',
    destinationUrl: 'https://build.nvidia.com/?ncid=ref-dli-146986',
    idempotencyKey: 'referral-key',
  });
  await client.recordProgress({ progressPercent: 10, idempotencyKey: 'progress-key' });

  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/v1\/activity-sessions\/0198f100-0000-7000-8000-000000000001\/referrals$/);
  assert.match(calls[0].url, /\/referrals$/);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    reference_id: 'build:nvidia-api-key',
    destination_url: 'https://build.nvidia.com/?ncid=ref-dli-146986',
  });
  assert.match(calls[1].url, /\/updates$/);
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    type: 'progress',
    payload: { progress_percent: 10 },
  });
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${sessionResponse().session_token}`);
  assert.equal(calls[0].init.headers['Idempotency-Key'], 'referral-key');
  assert.equal(calls[1].init.headers['Idempotency-Key'], 'progress-key');
});

test('a 200 write response is identified as an idempotent replay', async () => {
  const client = createActivityClient({
    baseUrl: 'https://activity.example.test',
    artifact,
    storage: createMemoryActivityStorage(sessionResponse()),
    now: () => new Date('2026-08-19T20:00:00Z'),
    fetchImpl: async () => jsonResponse(200, { update_id: 'original' }),
  });

  assert.deepEqual(
    await client.recordProgress({ progressPercent: 10, idempotencyKey: 'progress-key' }),
    { result: { update_id: 'original' }, replayed: true },
  );
});

test('completion is an authenticated idempotent completed update', async () => {
  const calls = [];
  const client = createActivityClient({
    baseUrl: 'https://activity.example.test', artifact,
    storage: createMemoryActivityStorage(sessionResponse()),
    now: () => new Date('2026-08-19T20:00:00Z'),
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse(201, { update_id: 'completed-1', state: { progress_percent: 100 } });
    },
  });

  await client.recordCompleted({ idempotencyKey: 'course-completed' });

  assert.match(calls[0].url, /\/updates$/);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['Idempotency-Key'], 'course-completed');
  assert.deepEqual(JSON.parse(calls[0].init.body), { type: 'completed', payload: {} });
});

test('state is read with bearer authentication and no request body', async () => {
  const calls = [];
  const client = createActivityClient({
    baseUrl: 'https://activity.example.test', artifact,
    storage: createMemoryActivityStorage(sessionResponse()),
    now: () => new Date('2026-08-19T20:00:00Z'),
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse(200, { progress_percent: 100, completed_at: null });
    },
  });

  const state = await client.getState();

  assert.deepEqual(state, { progress_percent: 100, completed_at: null });
  assert.match(calls[0].url, /\/state$/);
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.body, undefined);
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${sessionResponse().session_token}`);
});

test('errors and diagnostics never expose bearer material', async () => {
  const diagnostics = [];
  const token = sessionResponse().session_token;
  const client = createActivityClient({
    baseUrl: 'https://activity.example.test',
    artifact,
    storage: createMemoryActivityStorage(sessionResponse()),
    now: () => new Date('2026-08-19T20:00:00Z'),
    onDiagnostic: event => diagnostics.push(event),
    fetchImpl: async () => jsonResponse(401, { detail: `rejected ${token}` }),
  });

  await assert.rejects(
    client.recordProgress({ progressPercent: 10, idempotencyKey: 'progress-key' }),
    error => error instanceof ActivitySdkError && error.category === 'authentication' && error.status === 401,
  );

  assert.equal(JSON.stringify(diagnostics).includes(token), false);
  assert.equal(diagnostics[0].operation, 'progress');
  assert.equal(diagnostics[0].category, 'authentication');
});
