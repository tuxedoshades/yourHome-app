# yourHome Cross-Platform UX Contract (v1)

## Purpose
This contract defines the **must-match product behavior** across iOS, Android, and Web.
It is the source of truth for alignment checks before milestone sign-off.

## Product Principles (Non-Negotiable)
1. Consumer-first clarity (plain language, no technical jargon).
2. Mobile-first interaction design (works on small screens first).
3. Trust + safety visible in flow (verification + moderation context is clear).
4. Parity where it matters; native differences only where platform conventions improve UX.

## Core Journey Parity Matrix

| Flow | iOS | Android | Web | Notes |
|---|---|---|---|---|
| Auth (register/login/logout) | Must match | Must match | Must match | Same field requirements + error semantics |
| Homeowner verification submit/resubmit | Must match | Must match | Must match | Required docs + consent behavior identical |
| Listing submit/resubmit | Must match | Must match | Must match | Validation and status states identical |
| Property Manager entitlement lock/unlock | Must match | Must match | Must match | Premium-required gate text and actions aligned |
| Upgrade intent submit + status lifecycle visibility | Must match | Must match | Must match | new/contacted/converted semantics identical |
| Reviewer moderation decisions + timeline | Must match | Must match | Must match | Decision outcomes and history semantics identical |

## Allowed Platform-Native Differences
- Navigation shell pattern (tab bar, drawer, sidebar).
- OS-specific picker controls (date/time/file where applicable).
- System typography and spacing nuances.
- Platform-native permission prompts.

These differences must **not** change business logic, required fields, validation rules, or state transitions.

## UX Acceptance Gates (Per Milestone)
A milestone touching user flows is not complete until:
1. API build passes.
2. Reviewer web build passes.
3. Mobile export/build check passes.
4. Contract impact is reviewed and updated in this file when behavior changes.

## Alignment Check Cadence
Before shipping major UX changes:
- Provide quick screenshot/demo summary for iOS/Android/Web behavior equivalence.
- Explicitly ask the owner for alignment on look/behavior deltas.
- Log approved direction in memory and build log.

## Current Priority Direction
- Stabilize parity for homeowner + premium upgrade lifecycle across all platforms.
- Keep reviewer operations strong while preventing web-only drift.
