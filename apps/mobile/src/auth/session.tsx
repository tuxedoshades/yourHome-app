import Constants from "expo-constants";
import * as SecureStore from "../storage/secureStore";
import { router } from "expo-router";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { Platform } from "react-native";
import { DEFAULT_LANGUAGE, isSupportedLanguage, type AppLanguage } from "../i18n/config";

const STORE_TOKEN = "yourhome.auth.token";
const STORE_REFRESH = "yourhome.auth.refresh";
const STORE_USER = "yourhome.auth.user";

export type AuthUser = {
  id: string;
  email: string;
  role: string;
  verificationStatus: string;
  emailVerifiedAt?: string | null;
  createdAt?: string;
  preferredLanguage?: AppLanguage;
};

type AuthConfig = {
  methods?: {
    googleOAuth?: { supported?: boolean; ready?: boolean; enabled?: boolean; implemented?: boolean };
    appleOAuth?: { supported?: boolean; ready?: boolean };
    facebookOAuth?: { supported?: boolean; ready?: boolean };
    password?: { supported?: boolean };
    emailOtpVerification?: { supportedForAuth?: boolean; status?: string };
    phoneOtpVerification?: { supportedForAuth?: boolean; status?: string };
  };
};

type AuthResponse = {
  token: string;
  refreshToken: string;
  user: AuthUser;
};

type AuthContextValue = {
  booting: boolean;
  user: AuthUser | null;
  token: string | null;
  refreshToken: string | null;
  config: AuthConfig | null;
  configLoaded: boolean;
  isAuthenticated: boolean;
  isPublicDemo: boolean;
  setPublicDemo: (value: boolean) => void;
  login: (input: { email: string; password: string }) => Promise<AuthResponse>;
  register: (input: { email: string; password: string; phone?: string }) => Promise<AuthResponse>;
  logout: (allDevices?: boolean) => Promise<void>;
  restoreSession: () => Promise<void>;
  refreshSession: () => Promise<boolean>;
  fetchWithAuth: (path: string, init?: RequestInit, options?: { retryOn401?: boolean }) => Promise<Response>;
  updateLanguagePreference: (language: AppLanguage) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function getApiBaseUrl() {
  const envBase =
    (Platform.OS === "android" ? process.env.EXPO_PUBLIC_API_BASE_URL_ANDROID : undefined) ??
    (Platform.OS === "ios" ? process.env.EXPO_PUBLIC_API_BASE_URL_IOS : undefined) ??
    process.env.EXPO_PUBLIC_API_BASE_URL;

  if (envBase) return envBase.replace(/\/$/, "");

  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants as any)?.manifest?.debuggerHost ??
    (Constants as any)?.manifest2?.extra?.expoGo?.developer?.tool ??
    "";

  const host = String(hostUri)
    .replace(/^[a-zA-Z]+:\/\//, "")
    .split("/")[0]
    .split(":")[0]
    .trim();
  if (host) return `http://${host}:3000`;

  return Platform.OS === "android" ? "http://10.0.2.2:3000" : "http://127.0.0.1:3000";
}

const API_BASE = getApiBaseUrl();

async function parseJson<T>(res: Response): Promise<T | null> {
  const text = await res.text();
  if (!text) return null;
  return JSON.parse(text) as T;
}

function errorMessageFromPayload(payload: any, fallback: string) {
  if (!payload) return fallback;
  if (typeof payload?.error === "string") return payload.error.replaceAll("_", " ");
  if (typeof payload?.message === "string") return payload.message;
  return fallback;
}

function normalizeUser(user: AuthUser): AuthUser {
  return {
    ...user,
    preferredLanguage: isSupportedLanguage(user.preferredLanguage) ? user.preferredLanguage : DEFAULT_LANGUAGE,
  };
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [isPublicDemo, setIsPublicDemo] = useState(false);

  const persistSession = useCallback(async (session: AuthResponse) => {
    const normalizedUser = normalizeUser(session.user);
    setUser(normalizedUser);
    setToken(session.token);
    setRefreshToken(session.refreshToken);
    await Promise.all([
      SecureStore.setItemAsync(STORE_TOKEN, session.token),
      SecureStore.setItemAsync(STORE_REFRESH, session.refreshToken),
      SecureStore.setItemAsync(STORE_USER, JSON.stringify(normalizedUser)),
    ]);
  }, []);

  const clearSession = useCallback(async () => {
    setUser(null);
    setToken(null);
    setRefreshToken(null);
    await Promise.allSettled([
      SecureStore.deleteItemAsync(STORE_TOKEN),
      SecureStore.deleteItemAsync(STORE_REFRESH),
      SecureStore.deleteItemAsync(STORE_USER),
    ]);
  }, []);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/config`);
      const payload = await parseJson<{ auth?: AuthConfig }>(res);
      if (res.ok && payload?.auth) setConfig(payload.auth);
    } catch {
      // leave null; UI will default to safest copy
    } finally {
      setConfigLoaded(true);
    }
  }, []);

  const refreshSession = useCallback(async () => {
    const storedRefresh = refreshToken ?? (await SecureStore.getItemAsync(STORE_REFRESH));
    if (!storedRefresh) {
      await clearSession();
      return false;
    }

    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: storedRefresh }),
      });
      const payload = await parseJson<AuthResponse & { error?: string }>(res);
      if (!res.ok || !payload?.token || !payload?.refreshToken || !payload?.user) {
        await clearSession();
        return false;
      }
      await persistSession(payload);
      return true;
    } catch {
      await clearSession();
      return false;
    }
  }, [clearSession, persistSession, refreshToken]);

  const restoreSession = useCallback(async () => {
    const storedToken = await SecureStore.getItemAsync(STORE_TOKEN);
    const storedRefresh = await SecureStore.getItemAsync(STORE_REFRESH);
    const storedUser = await SecureStore.getItemAsync(STORE_USER);

    if (storedToken) setToken(storedToken);
    if (storedRefresh) setRefreshToken(storedRefresh);
    if (storedUser) {
      try {
        setUser(normalizeUser(JSON.parse(storedUser) as AuthUser));
      } catch {
        // ignore bad cache
      }
    }

    if (!storedToken) {
      await clearSession();
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/auth/me`, {
        headers: { authorization: `Bearer ${storedToken}` },
      });

      if (res.ok) {
        const payload = await parseJson<{ user?: AuthUser | null }>(res);
        if (payload?.user) {
          const normalizedUser = normalizeUser(payload.user);
          setUser(normalizedUser);
          await SecureStore.setItemAsync(STORE_USER, JSON.stringify(normalizedUser));
          return;
        }
      }

      if (res.status === 401 && storedRefresh) {
        await refreshSession();
        return;
      }

      await clearSession();
    } catch {
      if (storedRefresh) {
        await refreshSession();
      }
    }
  }, [clearSession, refreshSession]);

  useEffect(() => {
    void fetchConfig();
    void (async () => {
      try {
        await restoreSession();
      } finally {
        setBooting(false);
      }
    })();
  }, [fetchConfig, restoreSession]);

  const submitAuth = useCallback(
    async (path: "/auth/login" | "/auth/register", body: Record<string, unknown>) => {
      const res = await fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await parseJson<AuthResponse & { error?: string }>(res);
      if (!res.ok || !payload?.token || !payload?.refreshToken || !payload?.user) {
        throw new Error(
          errorMessageFromPayload(payload, path === "/auth/login" ? "login failed" : "account creation failed"),
        );
      }
      await persistSession(payload);
      setIsPublicDemo(false);
      return payload;
    },
    [persistSession],
  );

  const login = useCallback(
    (input: { email: string; password: string }) => {
      return submitAuth("/auth/login", { email: input.email.trim().toLowerCase(), password: input.password });
    },
    [submitAuth],
  );

  const register = useCallback(
    (input: { email: string; password: string; phone?: string }) => {
      return submitAuth("/auth/register", {
        email: input.email.trim().toLowerCase(),
        password: input.password,
        ...(input.phone ? { phone: input.phone } : {}),
      });
    },
    [submitAuth],
  );

  const logout = useCallback(
    async (allDevices = false) => {
      const currentToken = token ?? (await SecureStore.getItemAsync(STORE_TOKEN));
      const currentRefresh = refreshToken ?? (await SecureStore.getItemAsync(STORE_REFRESH));

      try {
        if (currentToken) {
          await fetch(`${API_BASE}/auth/logout`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${currentToken}`,
            },
            body: JSON.stringify(
              allDevices
                ? { allDevices: true }
                : currentRefresh
                  ? { refreshToken: currentRefresh, allDevices: false }
                  : { allDevices: false },
            ),
          });
        }
      } finally {
        await clearSession();
        setIsPublicDemo(false);
        router.replace("/auth");
      }
    },
    [clearSession, refreshToken, token],
  );

  const fetchWithAuth = useCallback(
    async (path: string, init?: RequestInit, options?: { retryOn401?: boolean }) => {
      const retryOn401 = options?.retryOn401 !== false;
      const currentToken = token ?? (await SecureStore.getItemAsync(STORE_TOKEN));

      const doFetch = async (bearer: string | null) =>
        fetch(`${API_BASE}${path}`, {
          ...init,
          headers: {
            ...(init?.headers ?? {}),
            ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
          },
        });

      let res = await doFetch(currentToken);
      if (res.status === 401 && retryOn401 && (refreshToken ?? (await SecureStore.getItemAsync(STORE_REFRESH)))) {
        const refreshed = await refreshSession();
        if (refreshed) {
          const nextToken = (await SecureStore.getItemAsync(STORE_TOKEN)) ?? token;
          res = await doFetch(nextToken ?? null);
        }
      }
      return res;
    },
    [refreshSession, refreshToken, token],
  );

  const updateLanguagePreference = useCallback(
    async (language: AppLanguage) => {
      if (!isSupportedLanguage(language)) return;

      setUser((current) => {
        const next = current ? { ...current, preferredLanguage: language } : current;
        if (next) {
          void SecureStore.setItemAsync(STORE_USER, JSON.stringify(next));
        }
        return next;
      });

      if (!token && !(await SecureStore.getItemAsync(STORE_TOKEN))) return;

      const res = await fetchWithAuth("/user/preferences/language", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ language }),
      });

      const payload = await parseJson<{ user?: AuthUser; error?: string }>(res);
      if (!res.ok) {
        throw new Error(errorMessageFromPayload(payload, "language preference update failed"));
      }

      if (payload?.user) {
        const normalizedUser = normalizeUser(payload.user);
        setUser(normalizedUser);
        await SecureStore.setItemAsync(STORE_USER, JSON.stringify(normalizedUser));
      }
    },
    [fetchWithAuth, token],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      booting,
      user,
      token,
      refreshToken,
      config,
      configLoaded,
      isAuthenticated: Boolean(user && token),
      isPublicDemo,
      setPublicDemo: setIsPublicDemo,
      login,
      register,
      logout,
      restoreSession,
      refreshSession,
      fetchWithAuth,
      updateLanguagePreference,
    }),
    [
      booting,
      config,
      configLoaded,
      fetchWithAuth,
      isPublicDemo,
      login,
      logout,
      refreshSession,
      refreshToken,
      register,
      restoreSession,
      token,
      updateLanguagePreference,
      user,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

export { API_BASE };
