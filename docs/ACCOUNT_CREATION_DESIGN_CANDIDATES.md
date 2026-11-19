# Account Creation Page - Design Candidates

## Candidate 1 (Locked Baseline)
Status: **active baseline for iteration**
Date locked: 2026-02-23

### Flow position
Auth/Login -> Sign up -> **Account Creation (this page)** -> Verify Code -> Property Discovery intake -> Property Discovery results

### Route
- `apps/mobile/app/signup.tsx`

### Visual style
- Dark theme container (`#050d1a`) with centered panel
- Panel background `#081424`, rounded corners, subtle border
- White headline and white supporting subtitle
- Primary CTA in blue (`#3663E6`)

### Current copy/content
- Title: **Create your account**
- Subtitle: **Start yourHome with transparency, control, and decentralization.**
- Inputs:
  - Full name
  - Email/Phone Number (combined input)
  - Password
  - Confirm password
- Consent row:
  - checkbox + text agreement
  - **Terms of Use** link (clickable)
  - **Privacy Policy** link (clickable)
- Primary CTA: **Create account**
- Secondary link: **Back**

### Interaction behavior
- Create account currently routes to `/verify-code`
- Legal links open URLs from centralized constants:
  - `apps/mobile/src/legal.ts`
- Input placeholders are white per current design pass

### Design intent (why this candidate)
- Keep onboarding simple and linear
- Keep legal consent visible at point of account creation
- Keep visual consistency with auth/login screen

### Known limitations (to iterate next)
- Field validation messaging is minimal
- No password visibility toggle yet
- No explicit inline error states yet
- Combined Email/Phone input may need clearer helper text
- Accessibility pass still needed (touch targets/contrast/focus order)

### Iteration guardrails
When iterating Candidate 1:
1. Keep route and flow order unchanged unless explicitly approved.
2. Keep Terms/Privacy links present and clickable.
3. Preserve simple one-screen completion (no modal sprawl).
4. Document any copy change in this file under candidate notes.

### Candidate 1 change log (today)
- Added signup page route and structure.
- Switched to combined **Email/Phone Number** field.
- Removed separate standalone phone input.
- Wired Terms/Privacy links to shared legal constants.
- Routed Create Account to Verify Code page.
