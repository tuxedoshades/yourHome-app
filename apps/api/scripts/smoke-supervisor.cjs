const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { mkdirSync, rmSync, writeFileSync } = require("node:fs");
const path = require("node:path");

const apiRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(apiRoot, "../..");
const pnpmCli = process.env.npm_execpath;
const args = process.argv.slice(2);
const testExitAfterDatabaseCreate = process.env.SMOKE_TEST_EXIT_SUPERVISOR_AFTER_DATABASE_CREATE;
assert.deepEqual(
  args.filter((argument) => argument !== "--prisma-contract-only"),
  [],
  "unsupported disposable smoke supervisor argument",
);
assert.ok(pnpmCli, "npm_execpath is required to launch the disposable smoke worker");
assert.ok(
  testExitAfterDatabaseCreate === undefined || testExitAfterDatabaseCreate === "1",
  "SMOKE_TEST_EXIT_SUPERVISOR_AFTER_DATABASE_CREATE must be 1 when set",
);

const controlDir = path.join(repoRoot, ".tmp", "smoke-supervisor");
const interruptFile = path.join(controlDir, `${Date.now()}-${process.pid}-${randomUUID()}.interrupt`);
mkdirSync(controlDir, { recursive: true });

const child = spawn(
  process.execPath,
  [pnpmCli, "exec", "tsx", "--env-file=.env", "scripts/smoke-disposable.ts", ...args, "--supervised-worker"],
  {
    cwd: apiRoot,
    env: {
      ...process.env,
      SMOKE_SUPERVISOR_PARENT_PID: String(process.pid),
      SMOKE_SUPERVISOR_INTERRUPT_FILE: interruptFile,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    detached: true,
  },
);
let testExitScheduled = false;
child.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
  if (
    testExitAfterDatabaseCreate === "1" &&
    !testExitScheduled &&
    chunk.toString().includes("test pause active after creating")
  ) {
    testExitScheduled = true;
    setImmediate(() => process.exit(130));
  }
});
child.stderr.pipe(process.stderr, { end: false });

const signalExitCodes = { SIGINT: 130, SIGTERM: 143, SIGBREAK: 131 };
let requestedSignal;
let settled = false;

const requestInterrupt = (signal) => {
  if (requestedSignal) return;
  requestedSignal = signal;
  process.exitCode = signalExitCodes[signal] ?? 1;
  try {
    writeFileSync(interruptFile, signal, { flag: "wx" });
  } catch (error) {
    if (error?.code !== "EEXIST") {
      console.error("[smoke-supervisor] failed to request worker interruption:", error);
      process.exitCode = 1;
    }
  }
};

const signalHandlers = ["SIGINT", "SIGTERM", "SIGBREAK"].map((signal) => {
  const handler = () => requestInterrupt(signal);
  process.on(signal, handler);
  return { signal, handler };
});

const finish = (code, signal, error) => {
  if (settled) return;
  settled = true;
  for (const entry of signalHandlers) process.off(entry.signal, entry.handler);
  rmSync(interruptFile, { force: true });

  if (error) {
    console.error("[smoke-supervisor] worker launch failed:", error);
    process.exitCode = 1;
    return;
  }
  if (requestedSignal && code !== 1) {
    process.exitCode = signalExitCodes[requestedSignal] ?? 1;
    return;
  }
  process.exitCode = code ?? (signal ? 1 : 0);
};

child.once("error", (error) => finish(undefined, undefined, error));
child.once("exit", (code, signal) => finish(code, signal));
