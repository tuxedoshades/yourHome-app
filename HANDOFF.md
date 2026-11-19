# HANDOFF.md (Agent Anti-Drift)

## Mission (do not optimize away from this)
Build YourHome into a demo-ready, user-friendly product for non-technical homeowners while maintaining strong backend/security quality.

## Current North-Star Metrics
- Primary: % runs accepted without manual edits
- Secondary: delivery success rate, rollback/regression count

## Current Focus (update each batch)
- [ ] Improve agent eval loop reliability
- [ ] Reduce repeat failures in top 3 buckets
- [ ] Keep lane outputs concise and actionable

## Constraints / Guardrails
- Do not ship unapproved behavior changes to public channels.
- Prefer measurable wins over broad rewrites.
- If confidence is low, stop and ask.
- Separate quality issues from delivery/infrastructure issues.

## Definition of Done (for each change)
1. Problem tied to a failure bucket.
2. Fix implemented with minimal scope.
3. Evidence recorded (before/after metric or report output).
4. No regression in critical workflows.

## Next Tasks (short queue)
1. Review top failure reasons from eval report.
2. Pick one bucket and implement one targeted fix.
3. Run checkpoint report and post summary.

## Checkpoint Template
- Goal worked on:
- What changed:
- Metric impact:
- Risks/unknowns:
- Next step:
