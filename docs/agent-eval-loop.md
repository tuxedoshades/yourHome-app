# Agent Eval Improvement Loop (YourHome)

## Why
Ship better agent behavior with less firefighting by fixing repeat failures first.

## Loop (daily)
1. **Track one north-star metric per workflow**
   - Example: `% accepted without manual edits`.
2. **Log every run** to `evals/runs/*.jsonl`.
3. **Tag failed runs with one reason code**
   - `bad-format`, `hallucinated-tool`, `weak-content`, `policy-miss`, `delivery-fail`.
4. **Review top 3 failure reasons daily**
   - Only work the biggest buckets.
5. **Turn each fix into a test case**
   - Keep one failing + one passing example.
6. **Roll out safely**
   - Shadow mode -> 10% canary -> full rollout only if metrics improve.

## Required run record fields
- `timestamp` (ISO string)
- `workflow` (string)
- `runId` (string)
- `accepted` (boolean)
- `reasonCode` (string or null)

Optional but useful:
- `latencyMs`, `model`, `notes`, `owner`

## Operating rule
No prompt/routing change rolls out unless it improves acceptance rate for the targeted failure bucket.