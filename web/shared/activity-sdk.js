// Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

const ACTIVITY_ID_PATTERN = /^act_[0-9a-f-]{36}$/;

export class ActivitySdkError extends Error {
  constructor(message, { operation, category, status } = {}) {
    super(message);
    this.name = 'ActivitySdkError';
    this.operation = operation;
    this.category = category || 'configuration';
    if (status !== undefined) this.status = status;
  }
}

export function createMemoryActivityStorage(initialValue = null) {
  let value = initialValue;
  return {
    load: () => value,
    save: nextValue => { value = nextValue; },
    clear: () => { value = null; },
  };
}

function normalizeBaseUrl(raw) {
  let url;
  try { url = new URL(String(raw || '').trim()); }
  catch (_) { throw new ActivitySdkError('Activity API base URL is invalid'); }
  const loopback = url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !loopback) {
    throw new ActivitySdkError('Activity API base URL must use HTTPS');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new ActivitySdkError('Activity API base URL cannot contain credentials, query, or fragment');
  }
  return url.href.replace(/\/+$/, '');
}

function validateArtifact(artifact) {
  const digest = artifact?.artifact_digest;
  if (!artifact?.artifact_id || !artifact?.artifact_version || !/^sha256:[0-9a-f]{64}$/.test(digest || '')) {
    throw new ActivitySdkError('Activity artifact identity is invalid');
  }
  return {
    artifact_id: artifact.artifact_id,
    artifact_version: artifact.artifact_version,
    artifact_digest: digest,
  };
}

function validateSession(value) {
  const expiresAt = Date.parse(value?.expires_at || '');
  if (!ACTIVITY_ID_PATTERN.test(value?.activity_id || '') ||
      typeof value?.session_token !== 'string' || value.session_token.length < 16 ||
      !Number.isFinite(expiresAt)) {
    throw new ActivitySdkError('Activity session response is invalid', {
      operation: 'session', category: 'validation',
    });
  }
  return {
    activity_id: value.activity_id,
    session_token: value.session_token,
    expires_at: value.expires_at,
  };
}

function categoryForStatus(status) {
  if (status === 401 || status === 403) return 'authentication';
  if (status === 409) return 'idempotency-conflict';
  if (status === 422) return 'validation';
  return status >= 500 ? 'server' : 'request';
}

export function createActivityClient({
  baseUrl,
  artifact,
  storage = createMemoryActivityStorage(),
  fetchImpl = globalThis.fetch?.bind(globalThis),
  now = () => new Date(),
  onDiagnostic = () => {},
} = {}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const normalizedArtifact = validateArtifact(artifact);
  if (typeof fetchImpl !== 'function') throw new ActivitySdkError('Fetch API is unavailable');
  if (!storage || typeof storage.load !== 'function' || typeof storage.save !== 'function') {
    throw new ActivitySdkError('Activity storage adapter is invalid');
  }

  let initializing = null;

  function diagnostic(operation, category, status) {
    const event = { operation, category };
    if (status !== undefined) event.status = status;
    try { onDiagnostic(event); } catch (_) {}
  }

  async function requestJson(operation, path, { body, session, idempotencyKey } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (session) headers.Authorization = `Bearer ${session.session_token}`;
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    let response;
    try {
      response = await fetchImpl(`${normalizedBaseUrl}${path}`, {
        method: 'POST', headers, body: JSON.stringify(body), keepalive: operation === 'referral',
      });
    } catch (_) {
      diagnostic(operation, 'network');
      throw new ActivitySdkError('Activity request failed', { operation, category: 'network' });
    }
    if (!response.ok) {
      const category = categoryForStatus(response.status);
      diagnostic(operation, category, response.status);
      throw new ActivitySdkError('Activity request was rejected', {
        operation, category, status: response.status,
      });
    }
    let result;
    try { result = await response.json(); }
    catch (_) {
      diagnostic(operation, 'validation', response.status);
      throw new ActivitySdkError('Activity response is invalid', {
        operation, category: 'validation', status: response.status,
      });
    }
    return { result, replayed: response.status === 200 };
  }

  async function createSession() {
    const { result } = await requestJson('session', '/v1/activity-sessions', {
      body: normalizedArtifact,
    });
    const session = validateSession(result);
    storage.save(session);
    return session;
  }

  async function ensureSession() {
    const stored = storage.load();
    if (stored) {
      try {
        const session = validateSession(stored);
        if (Date.parse(session.expires_at) > now().getTime()) return session;
      } catch (_) {}
      if (typeof storage.clear === 'function') storage.clear();
    }
    if (!initializing) {
      initializing = createSession().finally(() => { initializing = null; });
    }
    return initializing;
  }

  function requireIdempotencyKey(value) {
    const key = String(value || '').trim();
    if (!key || key.length > 255) {
      throw new ActivitySdkError('Activity idempotency key is invalid');
    }
    return key;
  }

  async function authenticatedWrite(operation, suffix, body, idempotencyKey) {
    const session = await ensureSession();
    return requestJson(operation, `/v1/activities/${encodeURIComponent(session.activity_id)}/${suffix}`, {
      body,
      session,
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
    });
  }

  return {
    ensureSession,
    recordReferral({ referenceId, destinationUrl, idempotencyKey }) {
      return authenticatedWrite('referral', 'referrals', {
        reference_id: referenceId,
        destination_url: destinationUrl,
      }, idempotencyKey);
    },
    recordProgress({ progressPercent, idempotencyKey }) {
      return authenticatedWrite('progress', 'updates', {
        type: 'progress', payload: { progress_percent: progressPercent },
      }, idempotencyKey);
    },
  };
}
