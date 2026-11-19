import {
  startOAuth as startOAuthCore,
  type OAuthProvider,
  type OAuthPlatform,
  type StartOAuthInput,
  type StartOAuthResult,
} from "../src/auth/startOAuth";

export type { OAuthProvider, OAuthPlatform, StartOAuthInput, StartOAuthResult };

// Legacy route-level export bridge used by app code.
export function startOAuth(input: StartOAuthInput): Promise<StartOAuthResult> {
  return startOAuthCore(input);
}

// Expo Router file route placeholder.
export default function OAuthRoutePlaceholder() {
  return null;
}
