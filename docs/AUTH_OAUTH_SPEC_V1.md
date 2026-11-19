# AUTH_OAUTH_SPEC_V1

## Overview
OAuth providers are wired through a provider-agnostic contract on mobile:
- `startOAuth(provider)` where `provider ∈ {google, apple, facebook}`
- Backend endpoints:
  - `POST /auth/oauth/:provider/start`
  - `POST /auth/oauth/:provider/callback`

PKCE (`S256`), `state`, and `nonce` are required in both start/callback.

## SDK 55 development-client redirects
YourHome mobile acceptance uses the installed SDK 55 development client, not Expo Go. The current frontend sends an explicit native redirect URI and does not construct an Expo AuthSession proxy redirect.

### Frontend behavior
- Native: `EXPO_PUBLIC_OAUTH_NATIVE_REDIRECT_URI`, falling back to `yourhome://oauth/callback`.
- Web: `EXPO_PUBLIC_OAUTH_WEB_REDIRECT_URI`, falling back to the current web origin plus `/oauth/callback`.

### Backend behavior
- `AUTH_OAUTH_DEV_MODE=true` allows both:
  - `OAUTH_ALLOWED_REDIRECT_URIS` (prod)
  - `OAUTH_ALLOWED_DEV_REDIRECT_URIS` (optional development callbacks used by isolated tooling)
- `AUTH_OAUTH_DEV_MODE=false` allows only `OAUTH_ALLOWED_REDIRECT_URIS`.

### Provider callback registration
- Register the exact callback sent by the app and allow-list the same value in the API.
- Native development defaults to `yourhome://oauth/callback`; use it only with provider/client types that support custom schemes.
- Providers that require HTTPS need a provisioned HTTPS callback before they can be marked ready.
- Expo proxy callbacks are not a substitute for YourHome development-client acceptance.

## Provider status
- Google: implemented end-to-end token exchange + profile fetch.
- Apple: scaffolded with validated start/callback and actionable credential errors.
- Facebook: scaffolded with validated start/callback and actionable credential errors.

## Safety baseline
- PKCE `code_challenge` (`S256`) required at start and `code_verifier` required at callback.
- `state` is stored server-side and single-use.
- `nonce` must match start transaction.
- Redirect URI must be explicitly allow-listed.
