# Ownership Security Flow (Step-Up + KYC + Transfer)

## Policy decisions (approved)
- Risky events require **both email and phone verified**.
- Property claim requires **selfie + ID check**.
- Ownership transfer requires a dedicated multi-step flow with auditability.

## Risky events
- Claiming a property candidate
- Changing legal owner profile details
- Initiating ownership transfer
- Suspicious auth signals (new device/location, velocity anomalies)

## Step-up verification sequence
1. Verify email channel status.
2. Verify phone channel status.
3. If not verified, force OTP verification for missing channel(s).
4. Issue short-lived `step_up_token` (10-15 min, action-scoped).
5. Start KYC (selfie + government ID).
6. Allow action completion only if all checks pass.

## Property claim state machine
- `candidate_found`
- `claim_requested`
- `contact_verification_required`
- `step_up_verified`
- `kyc_pending`
- `kyc_passed` | `kyc_failed`
- `claim_approved`
- `linked_to_profile`

Hard rule: `linked_to_profile` only after `step_up_verified` + `kyc_passed`.

## Ownership transfer flow
1. **Initiate transfer** by current owner (`transfer_pending`).
2. Current owner step-up re-auth (email+phone verified + fresh OTP).
3. Recipient accepts transfer invitation.
4. Recipient completes step-up + (optional/required) KYC based on risk score.
5. Cooling-off window (recommended: 24h) with notifications to both parties.
6. Final confirm by current owner.
7. System finalizes transfer and writes immutable audit event.

## Audit/event requirements
Each critical event logs:
- actor user id
- action type
- reason/risk trigger
- verification methods used
- result
- timestamp
- device/session fingerprint

## UX requirements
- Explain clearly why extra verification is required.
- Show progress steps (Verify contact -> Verify identity -> Complete action).
- On failure, provide retry/support path.

## Abuse prevention
- OTP attempt limits + cooldown
- KYC retry limits
- Transfer frequency limits per property
- Manual review queue for high-risk anomalies
