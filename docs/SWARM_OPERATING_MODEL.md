# YourHome Swarm Operating Model

Purpose: run YourHome like a production software org with parallel lanes and strict handoffs.

## Lanes

1. Product/PM lane (main)
- Owns scope, acceptance criteria, and priority.
- Inputs: objective + constraints.
- Outputs: clear task briefs for each lane.

2. Frontend lane (frontend-gemini)
- Owns mobile/web UI, UX polish, cross-platform parity.
- Outputs: changed files + visual notes + build proof.

3. Backend lane (main)
- Owns API, data models, auth, storage, infra logic.
- Outputs: changed files + migration/contract notes + build proof.

4. QA lane (main)
- Owns test plans, regression checks, release risk flags.
- Outputs: pass/fail matrix + blockers + reproduction steps.

5. Release/Docs lane (main)
- Owns docs, runbooks, release checklist, evidence links.
- Outputs: updated docs + ship/no-ship summary.

## Operating Rules

- One objective per cycle; multiple lanes execute in parallel.
- Every lane returns:
  - What changed
  - Proof (build/test/verification)
  - Risks/open questions
- No "done" claim without file-level evidence.
- Merge order: backend/frontend -> QA -> docs/release.

## Swarm Cycle (default)

1. Plan (PM lane)
2. Execute (frontend + backend in parallel)
3. Verify (QA lane)
4. Ship notes (release/docs lane)
5. Human decision: ship / revise

## Command Phrases (for the owner)

Use short prompts in chat:
- "Run YourHome swarm for: <objective>"
- "Frontend lane only: <task>"
- "Backend lane only: <task>"
- "QA this milestone"
- "Prepare release notes for this"

## Definition of Done (DoD)

A swarm cycle is complete only when all are true:
- Relevant builds pass
- Key flow is verified
- Risks are called out explicitly
- Docs updated for operator continuity
