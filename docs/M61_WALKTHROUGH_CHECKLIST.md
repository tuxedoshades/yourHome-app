# M61 Mobile Walkthrough Checklist (iOS + Android)

Use this for live walkthrough with the owner after M61 polish.

## Setup
1. Start API: `pnpm --filter api dev`
2. Start mobile: `pnpm --filter mobile dev -- --clear`
3. Confirm login works on iOS + Android.

## Flow checks
1. Login -> onboarding -> Enter yourHome
2. Home tab
   - Listing chip opens listing details
   - Verification chip opens verification request
3. Listing details
   - Title/description editable
   - Resubmit disabled/error unless status is `needs_more_info`
4. Verification request
   - Doc type selector works
   - Use today button fills date
   - Upload placeholder button fills URL
   - Validation catches missing/invalid fields
5. Manager tab
   - Premium lock + upgrade action visible when free plan
6. Feed tab
   - Lifecycle/feed state visible

## UX notes to capture
- Any confusing labels
- Any tap-target misses
- Any state/message that feels too technical

## Exit criteria
- No broken navigation in Home/Feed/Manager
- Resubmit actions show clear success/failure feedback
- The owner signs off on overall clarity for consumer users
