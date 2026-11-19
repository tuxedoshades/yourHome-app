# OAuth Dev Setup Checklist (SDK 55 Development Client)

1. **Set mobile env** (`apps/mobile/.env`)
   - `EXPO_PUBLIC_API_BASE_URL=http://<LAN-IP>:3000`
   - `EXPO_PUBLIC_OAUTH_NATIVE_REDIRECT_URI=yourhome://oauth/callback`
   - Enable providers:
     - `EXPO_PUBLIC_OAUTH_GOOGLE_ENABLED=true`
     - `EXPO_PUBLIC_OAUTH_APPLE_ENABLED=true`
     - `EXPO_PUBLIC_OAUTH_FACEBOOK_ENABLED=true`

2. **Set API env** (`apps/api/.env`)
   - `AUTH_OAUTH_DEV_MODE=false`
   - `OAUTH_ALLOWED_REDIRECT_URIS=yourhome://oauth/callback,http://localhost:8082/oauth/callback`
   - Provider toggles + creds:
     - Google: `OAUTH_GOOGLE_ENABLED=true`, client id/secret
     - Apple: `OAUTH_APPLE_ENABLED=true`, client id/secret
     - Facebook: `OAUTH_FACEBOOK_ENABLED=true`, client id/secret

3. **Provider console callbacks**
   - Register the exact native callback `yourhome://oauth/callback` where the provider/client type supports custom-scheme callbacks.
   - If a provider requires an HTTPS callback, provision and allow-list that callback before claiming the provider is ready; do not substitute Expo's proxy URL for development-client acceptance.

4. **Run locally**
   - `pnpm install`
   - Run `pnpm test:run` from the repository root.
   - Open the installed YourHome development client and test each enabled OAuth button.

5. **Expected results**
   - A provider is marked ready only after its registered native/HTTPS callback completes and returns the expected token + refresh token.
   - Apple/Facebook currently return explicit scaffold status unless full provider credentials/integration is completed.
