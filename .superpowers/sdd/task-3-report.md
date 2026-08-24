# Task 3 report: NemoClaw facade integration

## Status

Implemented the approved Task 3 facade refactor. NemoClaw now imports `DLIActivity`, shares one initialization promise across all tracking operations, and no longer invokes `createActivityClient` directly.

## Changes

- Replaced the centralized low-level client construction in `web/nemoclaw/scripts/_activity.js` with `DLIActivity.initialize`.
- Added a shared base URL resolver with the production default and explicit `window.__DLI_ACTIVITY_BASE_URL__` override for local development.
- Preserved the centralized NemoClaw artifact identity and session-scoped storage adapter.
- Mapped lesson operations to:
  - `activity.progress(progressPercent, { idempotencyKey })`
  - `activity.referral({ referenceId, destinationUrl, idempotencyKey })`
  - `activity.getState()`
  - `activity.complete({ idempotencyKey })`
- Contained facade failures at the adapter boundary; completion failures continue to return `false`, so the Finish Course action remains retryable.
- Kept checkpoint order, milestone percentages, success predicates, referral allowlist, and boolean-only evidence storage unchanged.
- Updated the 04c Finish Course consumer to normalized facade state fields `progressPercent` and `completedAt`.
- Marked intentionally ignored tracking promises explicitly in the runtime without changing event behavior.

## TDD evidence

RED command:

```sh
node --test tests/runtime/test_nemoclaw_activity.mjs tests/runtime/test_activity_checkpoint_wiring.mjs
```

Observed result before implementation: exit 1, 6 passed / 2 failed. Failures were the missing `resolveActivityBaseUrl` facade contract and the still-snake-case 04c state consumer.

GREEN command:

```sh
node --test tests/runtime/test_activity_sdk.mjs tests/runtime/test_nemoclaw_activity.mjs tests/runtime/test_activity_checkpoint_wiring.mjs
```

Observed result after implementation: exit 0, 41 passed / 0 failed.

Additional checks:

```sh
git diff --check
rg -n "activity-api\.(dev|stage)\.learn\.nvidia\.com" web/nemoclaw
```

Observed result: clean diff; hostname search produced no matches.

## Scope and invariants

Only the five Task 3 public-safe files were changed for the commit:

- `tests/runtime/test_nemoclaw_activity.mjs`
- `tests/runtime/test_activity_checkpoint_wiring.mjs`
- `web/nemoclaw/scripts/_activity.js`
- `web/nemoclaw/scripts/_activity_runtime.js`
- `web/nemoclaw/04c-going-further.html`

No checkpoint ordering, percentage, predicate, evidence, or referral registry entries changed.

## Concerns

None identified. The production Activity API hostname follows the approved production-safe naming convention; local HTTP overrides still pass through facade URL validation, which permits loopback only.

## Review fix: retry rejected initialization

Added a regression test covering the initialization promise lifecycle: concurrent callers share the first in-flight attempt, rejection clears that attempt, concurrent retry callers share one replacement attempt, and the fulfilled replacement remains shared.

RED command:

```sh
node --test tests/runtime/test_nemoclaw_activity.mjs
```

Observed result before the fix: exit 1, 13 passed / 1 failed. The regression test failed at `assert.equal(attempts.length, 2)` with `1 !== 2`, proving the rejected initialization promise remained memoized.

GREEN command:

```sh
node --test tests/runtime/test_nemoclaw_activity.mjs
```

Observed result after the fix: exit 0, 14 passed / 0 failed.

Adjacent verification:

```sh
node --test tests/runtime/test_activity_sdk.mjs tests/runtime/test_nemoclaw_activity.mjs tests/runtime/test_activity_checkpoint_wiring.mjs
git diff --check
rg -n "activity-api\.(dev|stage)\.learn\.nvidia\.com" web/nemoclaw
```

Observed result: runtime tests exited 0 with 42 passed / 0 failed; `git diff --check` was clean; the hostname search produced no matches.
