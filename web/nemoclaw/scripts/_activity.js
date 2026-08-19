// Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { createActivityClient } from '../../shared/activity-sdk.js';

export const BUILD_SIGNUP_URL = 'https://build.nvidia.com/?ncid=ref-dli-146986';
export const ACTIVITY_API_BASE_URL = 'https://activity-api.dev.learn.nvidia.com';

const STORAGE_KEY = 'dli_activity:nemoclaw:dev-local';
const ARTIFACT = Object.freeze({
  artifact_id: 'artifact_nemoclaw_web',
  artifact_version: 'dev-local',
  artifact_digest: `sha256:${'0'.repeat(64)}`,
});

function createSessionStorageAdapter(target) {
  return {
    load() {
      try {
        const raw = target?.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (_) { return null; }
    },
    save(value) {
      target?.setItem(STORAGE_KEY, JSON.stringify(value));
    },
    clear() {
      try { target?.removeItem(STORAGE_KEY); } catch (_) {}
    },
  };
}

export function createNemoClawActivity({
  fetchImpl = globalThis.fetch?.bind(globalThis),
  storageTarget = globalThis.sessionStorage,
  now,
  onDiagnostic = () => {},
} = {}) {
  const client = createActivityClient({
    baseUrl: ACTIVITY_API_BASE_URL,
    artifact: ARTIFACT,
    storage: createSessionStorageAdapter(storageTarget),
    fetchImpl,
    now,
    onDiagnostic,
  });

  async function attempt(operation) {
    try {
      await operation();
      return true;
    } catch (_) {
      return false;
    }
  }

  return {
    start() {
      return attempt(() => client.ensureSession());
    },
    trackBuildReferral(destinationUrl) {
      if (destinationUrl !== BUILD_SIGNUP_URL) return Promise.resolve(false);
      return attempt(() => client.recordReferral({
        referenceId: 'build:nvidia-api-key',
        destinationUrl: BUILD_SIGNUP_URL,
        idempotencyKey: 'nemoclaw:01a:build-signup',
      }));
    },
    recordApiKeyVerified() {
      return attempt(() => client.recordProgress({
        progressPercent: 10,
        idempotencyKey: 'nemoclaw:01a:api-key-verified',
      }));
    },
  };
}
