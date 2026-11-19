# M49 Visual Parity Capture

## Delivered in M49
- Added automated web evidence capture command:
  - `pnpm evidence:web`
  - script: `scripts/capture-web-parity-evidence.ps1`
- Output location:
  - `evidence/m49/web/reviewer-login.png`

## Why this matters
- Turns visual evidence from ad-hoc/manual into repeatable capture for the web surface.
- Keeps parity evidence pipeline moving while iOS/Android device captures are queued.

## Pending (mobile visual proof)
- iOS screenshot set for checklist rows.
- Android screenshot set for checklist rows.
- Optional short clips for end-to-end flow evidence.

## Next step (M50)
- Add guided mobile capture runbook + file naming convention and link all captures into `docs/CROSS_PLATFORM_PARITY_CHECKLIST.md`.
