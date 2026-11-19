# YourHome Mobile Resubmission UX Spec (Merged)

## UX goals
- Make rejection reasons obvious in plain language.
- Let users fix only what failed (no full re-entry).
- Reduce taps/time; target under 60 seconds for one-item fixes.
- Build confidence with reassuring copy and clear progress.
- Prevent repeat rejection via upload guidance + validation.

## Mobile flow
1. **Notification/deep link**: “Action needed: update one document.”
2. **What needs fixing** screen:
   - rejected item(s)
   - human reason (non-technical)
   - CTA: **Fix document**
3. **Upload/fix** screen:
   - instructions (lighting, corners visible, no glare)
   - CTAs: **Take a photo** / **Choose from library**
   - security line: “Your documents are encrypted and secure.”
4. **Review & submit** screen (if >1 item or edits): summary + **Resubmit application**.
5. **Success** screen: confirmation + expected review window.

## Core microcopy
- Header: **Please update your submission**
- Primary CTA: **Fix document**
- Upload header: **Upload a new [Document Name]**
- Buttons: **Take a photo**, **Choose from library**, **Confirm & Continue**, **Resubmit application**
- Success title: **We’ve received it!**
- Success body: **Your updated document has been submitted for review. We’ll notify you once it’s approved.**

### Error copy
- Invalid type: **Please upload a JPG, PNG, WEBP, or PDF file.**
- Too large: **This file is too large. Please upload a file under 10MB.**
- Missing required field: **Please complete this field before continuing.**
- Network: **Something went wrong. Check your connection and try again.**

## Mobile layout rules
- Single-column layout only.
- Primary CTA full width.
- Minimum target: 48x48 px.
- 16px+ vertical spacing between interactive blocks.
- Body text 16px minimum.
- High-contrast text/colors.

## Accessibility checklist
- WCAG AA contrast.
- Proper labels for all fields.
- Visible keyboard focus states.
- Semantic HTML structure.
- `aria-label` for icon-only controls.
- Descriptive action text (no vague “Next”).

## Implementation plan
### Quick wins
- Replace free-text reviewer rejection notes with structured reason presets.
- Map presets to homeowner-friendly reason text.
- Keep deep-link entry into resubmission context.
- Keep single-focus page structure on mobile.

### Deeper changes
- Build dedicated homeowner wizard screens.
- Add partial-update API path per rejected item.
- Add better upload hints and preflight checks.
- Add final confirmation screen with timeline expectation.
