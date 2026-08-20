// Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ActivitySdkError,
  createActivityClient,
  createMemoryActivityStorage,
} from '../../web/shared/activity-sdk.js';

const artifact = {
  artifact_id: 'artifact_nemoclaw_web',
  artifact_version: 'dev-local',
  artifact_digest: `sha256:${'0'.repeat(64)}`,
};

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
