# Legal Links + Document Maintenance Process

## Source of truth
- Mobile link constants: `apps/mobile/src/legal.ts`
- Docs drafts:
  - `docs/PRIVACY_POLICY.md`
  - `docs/TERMS_OF_USE.md`

## Where links should point
Production URLs (recommended):
- `https://yourhome.app/legal/privacy`
- `https://yourhome.app/legal/terms`

These URLs should render the current approved legal docs.

## Update workflow (every feature batch)
1. During PR planning, check if feature changes data collection, auth flows, sharing, or risk surface.
2. If yes, update one or both legal docs in the same batch PR.
3. Bump `Last updated` date.
4. Keep app links stable; only content behind URLs changes.
5. Add a short note in release notes: `Legal: updated Privacy/Terms for <feature>`.

## Governance rule
No feature that materially changes data handling should ship without legal doc review/update.

## Property Discovery specific checklist
Before beta/public release, verify all are true:
- Privacy section for Property Discovery is up to date.
- Terms section for Property Discovery is up to date.
- Consent text in-app matches policy language.
- Match results labeled as candidates (not ownership facts).
- Deletion/opt-out path is documented and operational.

## Later hardening
- Add legal pages in web app route `/legal/privacy` and `/legal/terms`
- Add version banner + archive of previous versions
- Add in-app modal fallback when external URL fails
