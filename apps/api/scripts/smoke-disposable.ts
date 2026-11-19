import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code !== "EPIPE") throw error;
  });
}

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(apiRoot, "../..");
const pnpmCli = process.env.npm_execpath;
const databaseName = `yourhome_prisma7_smoke_${Date.now()}_${process.pid}`;
const databasePattern = /^yourhome_prisma7_smoke_[0-9]+_[0-9]+$/;
const smokeCapability = randomBytes(32).toString("hex");
const port = Number(process.env.SMOKE_API_PORT ?? "3100");
const stopTimeoutMs = 10_000;
const testPauseAfterDatabaseCreateMs = Number(process.env.SMOKE_TEST_PAUSE_AFTER_DATABASE_CREATE_MS ?? "0");
const testInterruptAfterChildStartMs = Number(process.env.SMOKE_TEST_INTERRUPT_AFTER_CHILD_START_MS ?? "0");
const disposableArgs = process.argv.slice(2);
const prismaContractOnly = disposableArgs.includes("--prisma-contract-only");
const supervisedWorker = disposableArgs.includes("--supervised-worker");
assert.deepEqual(
  disposableArgs.filter((argument) => argument !== "--prisma-contract-only" && argument !== "--supervised-worker"),
  [],
  "unsupported disposable smoke argument",
);

const supervisorParentPid = Number(process.env.SMOKE_SUPERVISOR_PARENT_PID ?? "0");
const supervisorControlRoot = path.resolve(repoRoot, ".tmp", "smoke-supervisor");
const supervisorInterruptFile = process.env.SMOKE_SUPERVISOR_INTERRUPT_FILE
  ? path.resolve(process.env.SMOKE_SUPERVISOR_INTERRUPT_FILE)
  : undefined;

assert.match(databaseName, databasePattern, "disposable database name must use the guarded prefix");
assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535, "SMOKE_API_PORT must be an unprivileged TCP port");
assert.ok(
  Number.isInteger(testPauseAfterDatabaseCreateMs) &&
    testPauseAfterDatabaseCreateMs >= 0 &&
    testPauseAfterDatabaseCreateMs <= 60_000,
  "SMOKE_TEST_PAUSE_AFTER_DATABASE_CREATE_MS must be between 0 and 60000",
);
assert.ok(
  Number.isInteger(testInterruptAfterChildStartMs) &&
    testInterruptAfterChildStartMs >= 0 &&
    testInterruptAfterChildStartMs <= 60_000,
  "SMOKE_TEST_INTERRUPT_AFTER_CHILD_START_MS must be between 0 and 60000",
);
assert.ok(
  testInterruptAfterChildStartMs === 0 || prismaContractOnly,
  "child-start interruption hook requires Prisma-contract-only mode",
);
assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required");
assert.ok(pnpmCli, "npm_execpath is required to invoke pnpm without a shell");
assert.ok(
  process.platform !== "win32" || supervisedWorker,
  "Windows disposable smoke worker requires its detached supervisor",
);
if (supervisedWorker) {
  assert.ok(Number.isInteger(supervisorParentPid) && supervisorParentPid > 0, "supervisor parent PID is required");
  assert.ok(supervisorInterruptFile, "supervisor interrupt file is required");
  assert.equal(
    path.dirname(supervisorInterruptFile).toLowerCase(),
    supervisorControlRoot.toLowerCase(),
    "supervisor interrupt file must remain inside the repository control directory",
  );
}

const baseUrl = new URL(process.env.DATABASE_URL);
const adminUrl = new URL(baseUrl);
adminUrl.pathname = "/postgres";
const disposableUrl = new URL(baseUrl);
disposableUrl.pathname = `/${databaseName}`;

const quoteIdentifier = (identifier: string) => {
  assert.match(identifier, databasePattern, "refusing unsafe disposable database identifier");
  return `"${identifier}"`;
};

const activeChildren = new Set<ChildProcess>();
const childErrors = new WeakMap<ChildProcess, Error>();
const stopPromises = new WeakMap<ChildProcess, Promise<void>>();

const observeChild = (child: ChildProcess) => {
  activeChildren.add(child);
  child.once("error", (error) => childErrors.set(child, error));
  child.once("exit", () => activeChildren.delete(child));
  return child;
};

const waitForChildExit = (child: ChildProcess, timeoutMs: number) => {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (exited: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off("exit", onExit);
      child.off("error", onError);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const onError = () => finish(false);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once("exit", onExit);
    child.once("error", onError);
  });
};

const waitForProcessGroupExit = async (pid: number, timeoutMs: number) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(-pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return true;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
};

const runTaskkill = (pid: number) =>
  new Promise<void>((resolve, reject) => {
    const killer = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => {
      killer.kill("SIGKILL");
      finish(new Error(`taskkill timed out for PID ${pid}`));
    }, stopTimeoutMs);
    killer.once("error", finish);
    killer.once("exit", (code) => {
      if (code === 0 || code === 128) finish();
      else finish(new Error(`taskkill exited with code ${code ?? "null"} for PID ${pid}`));
    });
  });

const stopChild = (child: ChildProcess | undefined): Promise<void> => {
  if (!child || child.exitCode !== null || child.signalCode !== null || child.pid === undefined)
    return Promise.resolve();
  const pid = child.pid;
  const existing = stopPromises.get(child);
  if (existing) return existing;

  const stopping = (async () => {
    if (process.platform === "win32") {
      await runTaskkill(pid);
      if (!(await waitForChildExit(child, stopTimeoutMs))) {
        throw new Error(`child PID ${pid} did not exit after bounded Windows tree termination`);
      }
      return;
    }

    try {
      process.kill(-pid, "SIGTERM");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
    if (await waitForProcessGroupExit(pid, stopTimeoutMs)) return;

    try {
      process.kill(-pid, "SIGKILL");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
    if (!(await waitForProcessGroupExit(pid, stopTimeoutMs))) {
      throw new Error(`child process group ${pid} did not exit after bounded termination`);
    }
  })();
  stopPromises.set(child, stopping);
  return stopping;
};

const stopActiveChildren = async () => {
  const results = await Promise.allSettled([...activeChildren].map((child) => stopChild(child)));
  const errors = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
  if (errors.length > 0)
    throw new AggregateError(errors, "one or more disposable smoke child processes failed to stop");
};

let testInterruptScheduled = false;
const scheduleTestInterrupt = (args: string[]) => {
  if (testInterruptAfterChildStartMs === 0 || testInterruptScheduled || args[0] !== "test:prisma:worker")
    return undefined;
  testInterruptScheduled = true;
  return setTimeout(() => onSignal("SIGINT"), testInterruptAfterChildStartMs);
};

const runCommand = (args: string[], env: NodeJS.ProcessEnv) =>
  new Promise<void>((resolve, reject) => {
    const child = observeChild(
      spawn(process.execPath, [pnpmCli, ...args], {
        cwd: apiRoot,
        env,
        stdio: "inherit",
        windowsHide: true,
        detached: process.platform !== "win32",
      }),
    );
    const testInterruptTimer = scheduleTestInterrupt(args);
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (testInterruptTimer) clearTimeout(testInterruptTimer);
      if (error) reject(error);
      else resolve();
    };
    child.once("error", finish);
    child.once("exit", (code, signal) => {
      if (code === 0) finish();
      else finish(new Error(`pnpm ${args.join(" ")} exited with code ${code ?? "null"} signal ${signal ?? "none"}`));
    });
  });

const assertPortAvailable = () =>
  new Promise<void>((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", (error) =>
      reject(new Error(`isolated smoke port ${port} is already in use`, { cause: error })),
    );
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  });

const waitForHealth = async (child: ChildProcess, baseApiUrl: string) => {
  for (let attempt = 1; attempt <= 120; attempt += 1) {
    const childError = childErrors.get(child);
    if (childError) throw new Error("isolated API failed to start", { cause: childError });
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `isolated API exited before health check with code ${child.exitCode ?? "null"} signal ${child.signalCode ?? "none"}`,
      );
    }
    try {
      const response = await fetch(`${baseApiUrl}/health`, { signal: AbortSignal.timeout(1000) });
      const body = (await response.json()) as { ok?: unknown };
      if (response.ok && body.ok === true) return;
    } catch {
      // Readiness failures are retried until the bounded deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("isolated API health check timed out");
};

const admin = new Client({
  connectionString: adminUrl.toString(),
  application_name: "yourhome-disposable-smoke-admin",
});
let api: ChildProcess | undefined;
let databaseCreated = false;
let interruptedSignal: NodeJS.Signals | undefined;
let cleanupPromise: Promise<void> | undefined;
let signalChildStopPromise: Promise<void> | undefined;
let wakeTestPause: (() => void) | undefined;

const throwIfInterrupted = () => {
  if (interruptedSignal) throw new Error(`disposable smoke interrupted by ${interruptedSignal}`);
};

const pauseAfterDatabaseCreateForTest = () => {
  if (testPauseAfterDatabaseCreateMs === 0) return Promise.resolve();
  console.log(`[smoke-disposable] test pause active after creating ${databaseName}`);
  return new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      wakeTestPause = undefined;
      resolve();
    };
    const timer = setTimeout(finish, testPauseAfterDatabaseCreateMs);
    wakeTestPause = finish;
  });
};

const dropDatabase = async () => {
  if (!databaseCreated) return;
  await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)} WITH (FORCE)`);
  databaseCreated = false;
};

const cleanup = () => {
  cleanupPromise ??= (async () => {
    const errors: unknown[] = [];
    try {
      if (signalChildStopPromise) await signalChildStopPromise;
      else await stopActiveChildren();
    } catch (error) {
      errors.push(error);
    }
    try {
      await dropDatabase();
    } catch (error) {
      errors.push(error);
    }
    try {
      await admin.end();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length > 0) throw new AggregateError(errors, "disposable smoke cleanup failed");
  })();
  return cleanupPromise;
};

const signalExitCodes: Partial<Record<NodeJS.Signals, number>> = { SIGINT: 130, SIGTERM: 143, SIGBREAK: 131 };
const onSignal = (signal: NodeJS.Signals) => {
  if (interruptedSignal) return;
  interruptedSignal = signal;
  process.exitCode = signalExitCodes[signal] ?? 1;
  wakeTestPause?.();
  signalChildStopPromise ??= stopActiveChildren();
  void signalChildStopPromise.catch((error) => console.error("[smoke-disposable] signal child-stop failed:", error));
};
const signalHandlers = (["SIGINT", "SIGTERM", "SIGBREAK"] as const).map((signal) => {
  const handler = () => onSignal(signal);
  process.once(signal, handler);
  return { signal, handler };
});

const monitorSupervisor = () => {
  if (!supervisedWorker || !supervisorInterruptFile) return undefined;
  const check = () => {
    try {
      const requestedSignal = readFileSync(supervisorInterruptFile, "utf8").trim();
      if (requestedSignal === "SIGINT" || requestedSignal === "SIGTERM" || requestedSignal === "SIGBREAK") {
        onSignal(requestedSignal);
        return;
      }
      console.error(`[smoke-disposable] invalid supervisor interrupt request: ${requestedSignal}`);
      onSignal("SIGTERM");
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error("[smoke-disposable] failed to read supervisor interrupt request:", error);
        onSignal("SIGTERM");
        return;
      }
    }

    try {
      process.kill(supervisorParentPid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") {
        console.error(`[smoke-disposable] supervisor PID ${supervisorParentPid} exited; interrupting guarded work.`);
        onSignal("SIGINT");
      }
    }
  };
  const timer = setInterval(check, 100);
  timer.unref();
  check();
  return timer;
};
const supervisorMonitor = monitorSupervisor();

let failure: unknown;
try {
  await assertPortAvailable();
  throwIfInterrupted();
  await admin.connect();
  throwIfInterrupted();
  const collision = await admin.query<{ exists: boolean }>(
    "SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1) AS exists",
    [databaseName],
  );
  throwIfInterrupted();
  assert.equal(collision.rows[0]?.exists, false, "refusing disposable database collision");
  await admin.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
  databaseCreated = true;
  await pauseAfterDatabaseCreateForTest();
  throwIfInterrupted();

  const apiBaseUrl = `http://127.0.0.1:${port}`;
  const isolatedEnv: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: disposableUrl.toString(),
    DATABASE_APPLICATION_NAME: "yourhome-api-disposable-smoke",
    SMOKE_DISPOSABLE_DATABASE_NAME: databaseName,
    SMOKE_DISPOSABLE_CAPABILITY: smokeCapability,
    PRISMA_CONTRACT_DISPOSABLE_DATABASE_NAME: databaseName,
    HOST: "127.0.0.1",
    PORT: String(port),
    STORAGE_PROVIDER: "local",
    S3_BUCKET: "",
    S3_REGION: "",
    S3_ENDPOINT: "",
    S3_PUBLIC_BASE_URL: "",
    AWS_ACCESS_KEY_ID: "",
    AWS_SECRET_ACCESS_KEY: "",
    AWS_SESSION_TOKEN: "",
    SMTP_URL: "",
    SMTP_HOST: "",
    SMTP_USER: "",
    SMTP_PASS: "",
  };

  await runCommand(["prisma:deploy"], isolatedEnv);
  throwIfInterrupted();
  if (prismaContractOnly) {
    await runCommand(["test:prisma:worker"], isolatedEnv);
    throwIfInterrupted();
    console.log(`[smoke-disposable] PASS: isolated Prisma contract completed; database cleanup follows.`);
  } else {
    await assertPortAvailable();
    throwIfInterrupted();
    api = observeChild(
      spawn(process.execPath, ["--env-file=.env", "dist/index.js"], {
        cwd: apiRoot,
        env: isolatedEnv,
        stdio: "inherit",
        windowsHide: true,
        detached: process.platform !== "win32",
      }),
    );
    await waitForHealth(api, apiBaseUrl);
    throwIfInterrupted();
    await runCommand(["smoke"], { ...isolatedEnv, API_BASE_URL: apiBaseUrl });
    throwIfInterrupted();
    console.log(`[smoke-disposable] PASS: isolated API smoke completed on port ${port}; database cleanup follows.`);
  }
} catch (error) {
  failure = error;
  if (process.exitCode === undefined) process.exitCode = 1;
} finally {
  try {
    await cleanup();
  } catch (error) {
    failure = failure ? new AggregateError([failure, error], "disposable smoke execution and cleanup failed") : error;
    process.exitCode = 1;
  }
  if (supervisorMonitor) clearInterval(supervisorMonitor);
  if (supervisorInterruptFile) rmSync(supervisorInterruptFile, { force: true });
  for (const { signal, handler } of signalHandlers) process.off(signal, handler);
}

if (failure) console.error("[smoke-disposable] FAIL:", failure);
