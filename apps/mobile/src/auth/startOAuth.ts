export type OAuthProvider = "google" | "apple" | "facebook";
export type OAuthPlatform = "ios" | "android" | "web";

export interface StartOAuthInput {
  provider: OAuthProvider;
  platform: OAuthPlatform;
  redirectUri: string;
}

export interface StartOAuthResult {
  authorizationUrl: string;
  flowId?: string;
  state?: string;
  codeChallenge?: string;
}

function getApiBaseUrl(platform: OAuthPlatform): string {
  const base =
    (platform === "android" ? process.env.EXPO_PUBLIC_API_BASE_URL_ANDROID : undefined) ??
    (platform === "ios" ? process.env.EXPO_PUBLIC_API_BASE_URL_IOS : undefined) ??
    process.env.EXPO_PUBLIC_API_BASE_URL;

  if (!base) throw new Error("Missing EXPO_PUBLIC_API_BASE_URL");
  return base.replace(/\/$/, "");
}

function rand(len = 40): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i += 1) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

/**
 * Provider-agnostic OAuth start call.
 * Calls provider endpoint directly.
 */
export async function startOAuth(input: StartOAuthInput): Promise<StartOAuthResult> {
  const apiBase = getApiBaseUrl(input.platform);

  const provider = input?.provider;
  if (!provider || !["google", "apple", "facebook"].includes(provider)) {
    throw new Error(`Invalid OAuth provider: ${String(provider)}`);
  }

  const payload = {
    provider,
    platform: input.platform,
    redirectUri: input.redirectUri,
    state: rand(32),
    nonce: rand(32),
    codeChallenge: rand(48),
    codeChallengeMethod: "S256",
  };

  const res = await fetch(`${apiBase}/auth/oauth/${provider}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `OAuth start failed: ${res.status}`);
  }

  return res.json() as Promise<StartOAuthResult>;
}
