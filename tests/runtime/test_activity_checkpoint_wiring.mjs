// Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  getInstalledNemoClawActivity,
  highestContiguousMilestone,
  installNemoClawActivityTracking,
} from '../../web/nemoclaw/scripts/_activity_runtime.js';

const read = path => fs.readFileSync(path, 'utf8');

test('out-of-order outcomes advance only through contiguous checkpoints', () => {
  assert.equal(highestContiguousMilestone(new Set(['04b:live-agent-operated'])), null);
  assert.equal(highestContiguousMilestone(new Set([
    '01a:model-call-verified', '01b:react-loop-complete', '01c:tool-roundtrip-complete',
  ])), '01c:tool-roundtrip-complete');
  assert.equal(highestContiguousMilestone(new Set([
    '01a:model-call-verified', '01b:react-loop-complete', '01c:tool-roundtrip-complete',
    '02a:routed-workflow-complete', '02b:grounded-answer-complete',
    '02c:deep-research-complete', '03a:nemoclaw-connected',
    '03b:workspace-inspected', '03c:scheduled-run-complete',
    '04a:policy-boundary-verified', '04b:live-agent-operated',
  ])), '04b:live-agent-operated');
});

test('shared runtimes publish success-only activity signals', () => {
  const canvas = read('web/nemoclaw/scripts/_canvas.js');
  assert.match(canvas, /nemoclaw:run-succeeded/);
  assert.match(canvas, /nemoclaw:canvas-node-succeeded/);
  assert.doesNotMatch(canvas, /publishActivitySignal\([^;]+\bresult\s*[,}]/s);
  assert.match(read('web/nemoclaw/scripts/_chat.js'), /nemoclaw:chat-completed/);
  assert.match(read('web/nemoclaw/scripts/_openclaw.js'), /nemoclaw:connection-audit-passed/);
  assert.match(read('web/nemoclaw/scripts/_openclaw_cli.js'), /nemoclaw:live-agent-operated/);
});

test('checkpoint predicates require explicit successful evidence', () => {
  const source = read('web/nemoclaw/scripts/_activity_runtime.js');
  assert.match(source, /successCount < 1/);
  assert.match(source, /&& runObserved/);
  assert.match(source, /&& cleanupSucceeded/);
  assert.match(source, /&& policyAgreed/);
});

test('the activity runtime maps every approved checkpoint to evidence', () => {
  const source = read('web/nemoclaw/scripts/_activity_runtime.js');
  for (const milestone of [
    '01a:model-call-verified', '01b:react-loop-complete',
    '01c:tool-roundtrip-complete', '02a:routed-workflow-complete',
    '02b:grounded-answer-complete', '02c:deep-research-complete',
    '03a:nemoclaw-connected', '03b:workspace-inspected',
    '03c:scheduled-run-complete', '04a:policy-boundary-verified',
    '04b:live-agent-operated',
  ]) assert.match(source, new RegExp(milestone.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('the shared course entrypoint installs activity tracking', () => {
  const source = read('web/nemoclaw/scripts/_shared.js');
  assert.match(source, /installNemoClawActivityTracking/);
});

test('reinstalling the tracker returns the existing page activity client', () => {
  const listeners = new Map();
  const windowTarget = {
    addEventListener: (name, listener) => listeners.set(name, listener),
  };
  const documentTarget = { addEventListener() {} };
  const activity = { start() {}, recordMilestone() {} };

  assert.equal(installNemoClawActivityTracking({ windowTarget, documentTarget, activity }), activity);
  assert.equal(installNemoClawActivityTracking({ windowTarget, documentTarget }), activity);
  assert.equal(getInstalledNemoClawActivity(windowTarget), activity);
});

test('Going Further exposes an explicit gated Finish Course action', () => {
  const page = read('web/nemoclaw/04c-going-further.html');
  assert.match(page, /id="finish-course"/);
  assert.match(page, /getInstalledNemoClawActivity/);
  assert.doesNotMatch(page, /createNemoClawActivity/);
  assert.match(page, /getCourseActivityState/);
  assert.match(page, /recordCompletion/);
  assert.match(page, /Course completed/);
  assert.match(page, /state\.progressPercent/);
  assert.match(page, /state\.completedAt/);
  assert.doesNotMatch(page, /state\.(?:progress_percent|completed_at)/);
});
