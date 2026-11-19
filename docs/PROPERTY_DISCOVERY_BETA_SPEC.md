# Property Discovery (Beta) - Product + Compliance Spec

## Goal
Help users find likely U.S. properties tied to them, with explicit consent and user verification.

## Non-goals
- No automatic ownership claims.
- No hidden/background scraping without user opt-in.
- No guarantee of complete nationwide coverage.

## User flow
1. User taps **Find my properties (beta)**.
2. Consent screen explains sources, purpose, and limitations.
3. User submits matching inputs:
   - required: full legal name
   - recommended: current/prior addresses
   - optional: phone/email, month/year of birth (for disambiguation)
4. Backend runs candidate search.
5. App shows **Possible matches** with confidence + source note.
6. User marks each: **This is mine / Not mine / Unsure**.
7. Claim path requires step-up verification:
   - both email and phone verified for risky events
   - selfie + ID check (KYC) required before claim completion
8. Only verified/approved claims can be attached to the account profile.

## Data model (minimum)
- `property_discovery_runs`
  - `id`, `user_id`, `status`, `started_at`, `completed_at`, `consent_version`
- `property_match_candidates`
  - `id`, `run_id`, `source`, `county`, `state`, `parcel_ref`, `address`, `confidence`, `raw_ref`
- `property_match_decisions`
  - `id`, `candidate_id`, `user_id`, `decision` (claimed/rejected/unsure), `decided_at`
- `user_contact_verification`
  - `user_id`, `email_verified_at`, `phone_verified_at`, `last_step_up_at`
- `property_claim_verifications`
  - `id`, `candidate_id`, `user_id`, `kyc_provider`, `kyc_status`, `selfie_ref`, `id_doc_ref`, `verified_at`
- `ownership_transfer_requests`
  - `id`, `property_id`, `from_user_id`, `to_user_id`, `status`, `initiated_at`, `cooldown_ends_at`, `completed_at`

## API shape (draft)
- `POST /property-discovery/start`
  - body: matching inputs + explicit consent flag
- `GET /property-discovery/runs/:id`
  - returns run status + candidates
- `POST /property-discovery/candidates/:id/decision`
  - body: `decision`
- `POST /verification/email/start` + `POST /verification/email/confirm`
- `POST /verification/phone/start` + `POST /verification/phone/confirm`
- `POST /property-claims/:candidateId/step-up/start`
  - verifies both channels are verified, creates step-up session
- `POST /property-claims/:candidateId/kyc/start`
  - starts selfie + ID check
- `POST /property-claims/:candidateId/complete`
  - completes claim only when step-up + KYC are successful
- `POST /ownership-transfer/start`
- `POST /ownership-transfer/:id/confirm-from-owner`
- `POST /ownership-transfer/:id/confirm-recipient`
- `POST /ownership-transfer/:id/finalize`

## Compliance/guardrails
- Require explicit opt-in each time discovery is run.
- Log consent version per run.
- Do not show hidden confidence logic as certainty.
- Add abuse controls (rate limits, anomaly checks).
- Provide opt-out and candidate-data deletion request path.
- Property claim requires both email and phone verification for risky events.
- Property claim requires selfie + ID-check completion.
- Ownership transfer requires step-up checks for both sides and immutable audit logs.

## Legal dependencies before release
- Privacy Policy update (collection, sources, retention, rights).
- Terms update (disclaimer, verification responsibility, no guarantees).
- Legal links in app must point to current published pages.

## Rollout plan
1. Internal alpha with synthetic data.
2. Closed beta with manual review of edge cases.
3. Public beta with clear labeling and support playbook.
