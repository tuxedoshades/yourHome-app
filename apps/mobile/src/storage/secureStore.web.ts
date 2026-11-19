const storage = () => (typeof window === "undefined" ? null : window.localStorage);
const memoryOnlyValues = new Map<string, string>();
const AUTH_KEY_PREFIX = "yourhome.auth.";

function purgePersistedAuthValue(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
}

export async function getItemAsync(key: string): Promise<string | null> {
  if (key.startsWith(AUTH_KEY_PREFIX)) {
    purgePersistedAuthValue(key);
    return memoryOnlyValues.get(key) ?? null;
  }
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  if (key.startsWith(AUTH_KEY_PREFIX)) {
    purgePersistedAuthValue(key);
    memoryOnlyValues.set(key, value);
    return;
  }
  try {
    storage()?.setItem(key, value);
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
}

export async function deleteItemAsync(key: string): Promise<void> {
  if (key.startsWith(AUTH_KEY_PREFIX)) {
    purgePersistedAuthValue(key);
    memoryOnlyValues.delete(key);
    return;
  }
  try {
    storage()?.removeItem(key);
  } catch {
    // Keep logout and preference resets safe when browser storage is blocked.
  }
}
