// Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { DLIActivity } from '../../shared/activity-sdk.js';

export const BUILD_SIGNUP_URL = 'https://build.nvidia.com/?ncid=ref-dli-146986';
const PRODUCTION_ACTIVITY_BASE_URL = 'https://activity-api.learn.nvidia.com';

const STORAGE_KEY = 'dli_activity:nemoclaw:dev-local';
const ARTIFACT = Object.freeze({
  artifact_id: 'artifact_nemoclaw_web',
  artifact_version: 'dev-local',
  artifact_digest: `sha256:${'0'.repeat(64)}`,
});

export const ACTIVITY_MILESTONES = Object.freeze({
  '01a:model-call-verified': Object.freeze({ progressPercent: 10 }),
  '01b:react-loop-complete': Object.freeze({ progressPercent: 15 }),
  '01c:tool-roundtrip-complete': Object.freeze({ progressPercent: 25 }),
  '02a:routed-workflow-complete': Object.freeze({ progressPercent: 35 }),
  '02b:grounded-answer-complete': Object.freeze({ progressPercent: 45 }),
  '02c:deep-research-complete': Object.freeze({ progressPercent: 50 }),
  '03a:nemoclaw-connected': Object.freeze({ progressPercent: 60 }),
  '03b:workspace-inspected': Object.freeze({ progressPercent: 70 }),
  '03c:scheduled-run-complete': Object.freeze({ progressPercent: 80 }),
  '04a:policy-boundary-verified': Object.freeze({ progressPercent: 90 }),
  '04b:live-agent-operated': Object.freeze({ progressPercent: 100 }),
});

export const ACTIVITY_REFERRALS = Object.freeze({
  [BUILD_SIGNUP_URL]: 'build:nvidia-api-key',
  'https://brev.nvidia.com/launchable/deploy/now?launchableID=env-3Azt0aYgVNFEuz7opyx3gscmowS&ncid=ref-dli-759990': 'brev:nemoclaw-launchable',
  'https://build.nvidia.com/spark/nemoclaw-applications?ncid=ref-dli-146986': 'build:nemoclaw-applications',
  'https://build.nvidia.com/nvidia/nemoclaw-for-openclaw/nemoclawcard?ncid=ref-dli-146986': 'build:nemoclaw-card',
  'https://build.nvidia.com/blueprints?ncid=ref-dli-146986': 'build:ai-blueprints',
  'https://build.nvidia.com/nvidia/aiq?ncid=ref-dli-146986': 'build:aiq-blueprint',
  'https://developer.nvidia.com/topics/ai/agentic-ai-learning-path/how-to-build-an-ai-agent': 'developer:agentic-learning-path:build-agent',
  'https://developer.nvidia.com/topics/ai/agentic-ai-learning-path/how-to-build-agentic-ai-rag': 'developer:agentic-learning-path:agentic-rag',
  'https://developer.nvidia.com/topics/ai/agentic-ai-learning-path/how-to-evaluate-ai-agents': 'developer:agentic-learning-path:evaluate-agents',
  'https://developer.nvidia.com/topics/ai/agentic-ai-learning-path/how-to-customize-ai-agents': 'developer:agentic-learning-path:customize-agents',
  'https://developer.nvidia.com/topics/ai/agentic-ai-learning-path/how-to-build-deep-ai-agents': 'developer:agentic-learning-path:deep-agents',
  'https://developer.nvidia.com/topics/ai/agentic-ai-learning-path/how-to-build-safer-autonomous-agent-using-openclaw': 'developer:agentic-learning-path:safer-openclaw',
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

export function resolveActivityBaseUrl(windowTarget = globalThis.window) {
  return windowTarget?.__DLI_ACTIVITY_BASE_URL__ || PRODUCTION_ACTIVITY_BASE_URL;
}

export function createNemoClawActivity({
  windowTarget = globalThis.window,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  storageTarget = globalThis.sessionStorage,
  now,
  onDiagnostic = () => {},
  initialize = options => DLIActivity.initialize(options),
} = {}) {
  let initializedActivity;

  function initializeActivity() {
    if (initializedActivity) return initializedActivity;

    const attempt = Promise.resolve().then(() => initialize({
      baseUrl: resolveActivityBaseUrl(windowTarget),
      artifact: ARTIFACT,
      storage: createSessionStorageAdapter(storageTarget),
      fetchImpl,
      now,
      onDiagnostic,
    }));
    initializedActivity = attempt;
    attempt.catch(() => {
      if (initializedActivity === attempt) initializedActivity = undefined;
    });
    return attempt;
  }

  async function attempt(operation, failureValue = false) {
    try {
      const activity = await initializeActivity();
      return await operation(activity);
    } catch (_) {
      return failureValue;
    }
  }

  return {
    start() {
      return attempt(() => true);
    },
    trackBuildReferral(destinationUrl) {
      return this.trackReferral(destinationUrl);
    },
    trackReferral(destinationUrl) {
      const referenceId = ACTIVITY_REFERRALS[destinationUrl];
      if (!referenceId) return Promise.resolve(false);
      return attempt(async activity => {
        await activity.referral({
          referenceId,
          destinationUrl,
          idempotencyKey: `nemoclaw:referral:${referenceId}`,
        });
        return true;
      });
    },
    recordMilestone(milestoneRef) {
      const milestone = ACTIVITY_MILESTONES[milestoneRef];
      if (!milestone) return Promise.resolve(false);
      return attempt(async activity => {
        await activity.progress(milestone.progressPercent, {
          idempotencyKey: `nemoclaw:milestone:${milestoneRef}`,
        });
        return true;
      });
    },
    getCourseActivityState() {
      return attempt(activity => activity.getState(), null);
    },
    recordCompletion() {
      return attempt(async activity => {
        const result = await activity.complete({ idempotencyKey: 'nemoclaw:course:completed' });
        return result?.written !== false;
      });
    },
  };
}
