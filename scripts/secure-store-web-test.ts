import assert from "node:assert/strict";

async function main() {
  const persisted = new Map<string, string>();
  (globalThis as typeof globalThis & { window: unknown }).window = {
    localStorage: {
      getItem: (key: string) => persisted.get(key) ?? null,
      setItem: (key: string, value: string) => persisted.set(key, value),
      removeItem: (key: string) => persisted.delete(key),
    },
  };

  const store = await import("../apps/mobile/src/storage/secureStore.web");

  persisted.set("yourhome.auth.token", "legacy-access-token");
  persisted.set("yourhome.auth.refresh", "legacy-refresh-token");
  assert.equal(await store.getItemAsync("yourhome.auth.token"), null, "legacy access tokens must not be restored");
  assert.equal(await store.getItemAsync("yourhome.auth.refresh"), null, "legacy refresh tokens must not be restored");
  assert.equal(persisted.has("yourhome.auth.token"), false, "legacy access tokens must be purged from localStorage");
  assert.equal(persisted.has("yourhome.auth.refresh"), false, "legacy refresh tokens must be purged from localStorage");

  await store.setItemAsync("yourhome.auth.token", "sensitive-access-token");
  await store.setItemAsync("yourhome.auth.refresh", "sensitive-refresh-token");
  assert.equal(persisted.has("yourhome.auth.token"), false, "access token must not be persisted in localStorage");
  assert.equal(persisted.has("yourhome.auth.refresh"), false, "refresh token must not be persisted in localStorage");
  assert.equal(await store.getItemAsync("yourhome.auth.token"), "sensitive-access-token");
  await store.deleteItemAsync("yourhome.auth.token");
  assert.equal(await store.getItemAsync("yourhome.auth.token"), null);

  await store.setItemAsync("yourhome.language", "es");
  assert.equal(persisted.get("yourhome.language"), "es", "non-sensitive preferences should remain persistent");
  assert.equal(await store.getItemAsync("yourhome.language"), "es");
  await store.deleteItemAsync("yourhome.language");
  assert.equal(persisted.has("yourhome.language"), false);

  console.log("[secure-store-web-test] PASS: auth data is memory-only and preferences remain persistent.");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
