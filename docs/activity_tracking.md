# NemoClaw activity tracking

The NemoClaw browser course records anonymous learner activity through the shared Activity SDK.
This catalog describes the records the course can send and the course-owned evidence required for
each progress update. It does not describe service deployment, database access, or non-production
configuration.

Tracking failures do not block course navigation or exercises. The SDK manages the activity
session credential, and the course does not place learner prompts, model responses, API keys, or
tool output in activity records.

## Lifecycle records

| Course action | API operation | Activity record | Condition | Idempotency key |
| --- | --- | --- | --- | --- |
| Open an instrumented course page | Create an activity session | None | The first page in a browser tab initializes the Activity SDK. The session is reused within that tab while it remains valid. | Not applicable |
| Finish the course | Write an update with type `completed` | `completed` | The learner selects **Finish Course** after the server state reports 100% progress. | `nemoclaw:course:completed` |
| Reconcile course state | Read session state | None | The course reads the current progress and completion state before enabling or accepting completion. | Not applicable |

The course currently sends `progress`, `referral`, and `completed` activity records. Grade records
are not part of this integration.

## Progress records

Progress is cumulative. Evidence can arrive out of order, but the course sends only the highest
contiguous milestone. A later milestone cannot skip an earlier one.

| Progress | Milestone reference | Page | Acceptance criteria | Idempotency key |
| --- | --- | --- | --- | --- |
| 10% | `01a:model-call-verified` | `01a-loop.html` | The NVIDIA API key passes verification, then the learner successfully runs the one-call JavaScript exercise and it returns content. | `nemoclaw:milestone:01a:model-call-verified` |
| 15% | `01b:react-loop-complete` | `01b-react.html` | The ReAct exercise completes at least one successful interaction and produces an answer. | `nemoclaw:milestone:01b:react-loop-complete` |
| 25% | `01c:tool-roundtrip-complete` | `01c-tools.html` | The tool-use exercise completes at least one successful interaction and produces an answer. | `nemoclaw:milestone:01c:tool-roundtrip-complete` |
| 35% | `02a:routed-workflow-complete` | `02a-routing.html` | The routing exercise completes at least one successful interaction and produces an answer. | `nemoclaw:milestone:02a:routed-workflow-complete` |
| 45% | `02b:grounded-answer-complete` | `02b-rag.html` | The retrieval exercise completes at least one successful interaction and produces a grounded answer. | `nemoclaw:milestone:02b:grounded-answer-complete` |
| 50% | `02c:deep-research-complete` | `02c-deep.html` | The deep-research exercise completes at least one successful interaction and produces an answer. | `nemoclaw:milestone:02c:deep-research-complete` |
| 60% | `03a:nemoclaw-connected` | `03a-kickstart.html` | The NemoClaw connection audit passes. | `nemoclaw:milestone:03a:nemoclaw-connected` |
| 70% | `03b:workspace-inspected` | `03b-openclaw.html` | Both the agent introspection command and workspace terminal command run successfully. | `nemoclaw:milestone:03b:workspace-inspected` |
| 80% | `03c:scheduled-run-complete` | `03c-always-on.html` | The scheduled run is observed, then its cleanup step succeeds. | `nemoclaw:milestone:03c:scheduled-run-complete` |
| 90% | `04a:policy-boundary-verified` | `04a-safety.html` | The live policy exercise runs with an agent, then the prediction comparison confirms that the observed result agrees with the policy. | `nemoclaw:milestone:04a:policy-boundary-verified` |
| 100% | `04b:live-agent-operated` | `04b-modern-clis.html` | The learner successfully operates the live agent through the course interface. | `nemoclaw:milestone:04b:live-agent-operated` |

Each progress record contains only the cumulative percentage:

```json
{
  "type": "progress",
  "payload": {
    "progress_percent": 45
  }
}
```

## Referral records

A referral is recorded when a learner selects an approved course link. Links that are not in this
allowlist, including general citations and blog references, do not create referral records.

| Reference ID | Destination |
| --- | --- |
| `build:nvidia-api-key` | [NVIDIA Build](https://build.nvidia.com/?ncid=ref-dli-146986) |
| `brev:nemoclaw-launchable` | [NemoClaw Brev launchable](https://brev.nvidia.com/launchable/deploy/now?launchableID=env-3Azt0aYgVNFEuz7opyx3gscmowS&ncid=ref-dli-759990) |
| `build:nemoclaw-applications` | [NemoClaw applications](https://build.nvidia.com/spark/nemoclaw-applications?ncid=ref-dli-146986) |
| `build:nemoclaw-card` | [NemoClaw blueprint card](https://build.nvidia.com/nvidia/nemoclaw-for-openclaw/nemoclawcard?ncid=ref-dli-146986) |
| `build:ai-blueprints` | [NVIDIA AI Blueprints](https://build.nvidia.com/blueprints?ncid=ref-dli-146986) |
| `build:aiq-blueprint` | [AI-Q blueprint](https://build.nvidia.com/nvidia/aiq?ncid=ref-dli-146986) |
| `developer:agentic-learning-path:build-agent` | [How to Build an AI Agent](https://developer.nvidia.com/topics/ai/agentic-ai-learning-path/how-to-build-an-ai-agent) |
| `developer:agentic-learning-path:agentic-rag` | [How to Build Agentic AI RAG](https://developer.nvidia.com/topics/ai/agentic-ai-learning-path/how-to-build-agentic-ai-rag) |
| `developer:agentic-learning-path:evaluate-agents` | [How to Evaluate AI Agents](https://developer.nvidia.com/topics/ai/agentic-ai-learning-path/how-to-evaluate-ai-agents) |
| `developer:agentic-learning-path:customize-agents` | [How to Customize AI Agents](https://developer.nvidia.com/topics/ai/agentic-ai-learning-path/how-to-customize-ai-agents) |
| `developer:agentic-learning-path:deep-agents` | [How to Build Deep AI Agents](https://developer.nvidia.com/topics/ai/agentic-ai-learning-path/how-to-build-deep-ai-agents) |
| `developer:agentic-learning-path:safer-openclaw` | [How to Build a Safer Autonomous Agent Using OpenClaw](https://developer.nvidia.com/topics/ai/agentic-ai-learning-path/how-to-build-safer-autonomous-agent-using-openclaw) |
| `nvidia:agentic-ai-learning-path` | [Agentic AI Learning Path](https://developer.nvidia.com/topics/ai/agentic-ai-learning-path) |
| `nvidia:nemoclaw` | [NVIDIA NemoClaw](https://www.nvidia.com/en-us/ai/nemoclaw/) |
| `nvidia:nemoclaw-prerequisites` | [NemoClaw prerequisites](https://docs.nvidia.com/nemoclaw/latest/get-started/prerequisites) |
| `nvidia:nim` | [NVIDIA NIM documentation](https://docs.nvidia.com/nim/) |
| `nvidia:nemo-retriever` | [NeMo Retriever](https://developer.nvidia.com/nemo-retriever) |
| `nvidia:github:nemoclaw` | [NVIDIA/NemoClaw](https://github.com/NVIDIA/NemoClaw) |
| `nvidia:github:openshell` | [NVIDIA/OpenShell](https://github.com/NVIDIA/OpenShell) |
| `nvidia:github:nemo-guardrails` | [NVIDIA/NeMo-Guardrails](https://github.com/NVIDIA/NeMo-Guardrails) |
| `nvidia:github:nemo-curator` | [NVIDIA/NeMo-Curator](https://github.com/NVIDIA/NeMo-Curator) |

Each referral record contains the stable reference ID and approved destination URL. The SDK uses
`nemoclaw:referral:<reference-id>` as the idempotency key so repeated selections do not create
duplicate records.

## Source of truth

The browser integration is defined in
[`web/nemoclaw/scripts/_activity.js`](../web/nemoclaw/scripts/_activity.js). The acceptance-criteria
event wiring is defined in
[`web/nemoclaw/scripts/_activity_runtime.js`](../web/nemoclaw/scripts/_activity_runtime.js). The
public SDK facade is defined in [`web/shared/activity-sdk.js`](../web/shared/activity-sdk.js).

The activity catalog test in
[`tests/runtime/test_nemoclaw_activity.mjs`](../tests/runtime/test_nemoclaw_activity.mjs) verifies
that every configured milestone and referral appears in this document.
