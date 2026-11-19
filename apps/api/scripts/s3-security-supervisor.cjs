const assert = require("node:assert/strict");
const { spawn, execFile } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const net = require("node:net");
const path = require("node:path");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const apiRoot = path.resolve(__dirname, "..");
// The historical minio/minio Docker Hub image was removed, and quay.io/minio/minio
// no longer allows anonymous pulls. This public image's entrypoint is the MinIO
// server binary. /tmp/minio is writable by its non-root user.
const minioImage = "cgr.dev/chainguard/minio@sha256:e9cf6b99c226e9539ed0f14b6f00e37b07da153c7ba1f4f8709c807574b471ec";
const containerName = `yourhome-s3-security-${process.pid}-${randomBytes(4).toString("hex")}`;
const accessKeyId = `yh${randomBytes(8).toString("hex")}`;
const secretAccessKey = randomBytes(32).toString("base64url");
const signalExitCodes = { SIGINT: 130, SIGTERM: 143, SIGBREAK: 131 };
const interruptDuringDockerRun = process.env.S3_SECURITY_TEST_INTERRUPT_DURING_DOCKER_RUN;
const interruptAfterWorkerStart = process.env.S3_SECURITY_TEST_INTERRUPT_AFTER_WORKER_START;
const hangAfterContainerStart = process.env.S3_SECURITY_TEST_HANG_AFTER_CONTAINER_START;

assert.match(containerName, /^yourhome-s3-security-[0-9]+-[a-f0-9]{8}$/);
assert.ok(
  interruptDuringDockerRun === undefined || interruptDuringDockerRun === "1",
  "S3_SECURITY_TEST_INTERRUPT_DURING_DOCKER_RUN must be 1 when set",
);
assert.ok(
  interruptAfterWorkerStart === undefined || interruptAfterWorkerStart === "1",
  "S3_SECURITY_TEST_INTERRUPT_AFTER_WORKER_START must be 1 when set",
);
assert.ok(
  hangAfterContainerStart === undefined || hangAfterContainerStart === "1",
  "S3_SECURITY_TEST_HANG_AFTER_CONTAINER_START must be 1 when set",
);
assert.ok(
  [interruptDuringDockerRun, interruptAfterWorkerStart, hangAfterContainerStart].filter(Boolean).length <= 1,
  "only one S3 security interruption hook may be enabled",
);

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const sanitizedMessage = (error) => {
  const message = error instanceof Error ? error.message : "unknown error";
  return message.replaceAll(accessKeyId, "[REDACTED]").replaceAll(secretAccessKey, "[REDACTED]");
};
const isMissingContainerError = (error) => {
  const stderr = typeof error?.stderr === "string" ? error.stderr.toLowerCase() : "";
  return stderr.includes("no such object") || stderr.includes("no such container");
};

const getOpenPort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });

let dockerRunChild;
let workerChild;
let requestedSignal;

const collectChild = (command, args, options, assignChild) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    assignChild(child);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", (error) => {
      assignChild(undefined);
      reject(error);
    });
    if (command === "docker" && interruptDuringDockerRun === "1") {
      setImmediate(() => process.emit("SIGTERM"));
    }
    child.once("exit", (code, signal) => {
      assignChild(undefined);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited with ${code ?? signal ?? "unknown status"}: ${stderr.trim()}`));
    });
  });

const runWorker = (endpoint) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "scripts/s3-security-contract.ts"], {
      cwd: apiRoot,
      env: {
        ...process.env,
        S3_SECURITY_ENDPOINT: endpoint,
        S3_SECURITY_ACCESS_KEY_ID: accessKeyId,
        S3_SECURITY_SECRET_ACCESS_KEY: secretAccessKey,
      },
      stdio: "inherit",
      windowsHide: true,
    });
    workerChild = child;
    child.once("error", (error) => {
      workerChild = undefined;
      reject(error);
    });
    child.once("exit", (code, signal) => {
      workerChild = undefined;
      if (code === 0) resolve();
      else reject(new Error(`S3 security worker exited with ${code ?? signal ?? "unknown status"}`));
    });
    if (interruptAfterWorkerStart === "1") {
      setImmediate(() => process.emit("SIGTERM"));
    }
  });

const terminateChild = async (child) => {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await Promise.race([exited, delay(5_000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await exited;
  }
};

let containerId;
let cleanupPromise;
const cleanup = () => {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    await terminateChild(workerChild);
    await terminateChild(dockerRunChild);

    const target = containerId ?? containerName;
    try {
      await execFileAsync("docker", ["rm", "--force", target], { windowsHide: true });
    } catch {
      // The name is allocated before launch so absence is an acceptable first cleanup result.
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await execFileAsync("docker", ["inspect", target], { windowsHide: true });
        await execFileAsync("docker", ["rm", "--force", target], { windowsHide: true });
      } catch (error) {
        if (isMissingContainerError(error)) {
          await delay(200);
          continue;
        }
        throw new Error(`unable to verify disposable MinIO cleanup: ${sanitizedMessage(error)}`, { cause: error });
      }
      await delay(200);
    }

    try {
      await execFileAsync("docker", ["inspect", target], { windowsHide: true });
      throw new Error("the disposable MinIO container still exists after cleanup");
    } catch (error) {
      if (error instanceof Error && error.message === "the disposable MinIO container still exists after cleanup") {
        throw error;
      }
      if (!isMissingContainerError(error)) {
        throw new Error(`unable to prove disposable MinIO cleanup: ${sanitizedMessage(error)}`, { cause: error });
      }
    }
    containerId = undefined;
  })();
  return cleanupPromise;
};

for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK"]) {
  process.once(signal, () => {
    if (requestedSignal) return;
    requestedSignal = signal;
    void cleanup().then(
      () => process.exit(signalExitCodes[signal] ?? 1),
      (error) => {
        console.error(`[s3-security-supervisor] cleanup failed after ${signal}: ${sanitizedMessage(error)}`);
        process.exit(1);
      },
    );
  });
}

(async () => {
  let executionError;
  let cleanupError;
  try {
    await execFileAsync("docker", ["version", "--format", "{{.Server.Version}}"], { windowsHide: true });
    const port = await getOpenPort();
    assert.ok(Number.isInteger(port) && port > 0, "a disposable MinIO port must be allocated");
    if (requestedSignal) throw new Error(`interrupted by ${requestedSignal}`);

    const runResult = await collectChild(
      "docker",
      [
        "run",
        "--detach",
        "--rm",
        "--name",
        containerName,
        "--publish",
        `127.0.0.1:${port}:9000`,
        "--env",
        "MINIO_ROOT_USER",
        "--env",
        "MINIO_ROOT_PASSWORD",
        minioImage,
        "server",
        "/tmp/minio",
        "--address",
        ":9000",
        "--console-address",
        ":9001",
      ],
      { env: { ...process.env, MINIO_ROOT_USER: accessKeyId, MINIO_ROOT_PASSWORD: secretAccessKey } },
      (child) => {
        dockerRunChild = child;
      },
    );
    containerId = runResult.stdout.trim();
    assert.match(containerId, /^[a-f0-9]{64}$/, "docker run must return the exact disposable container ID");
    if (hangAfterContainerStart === "1") {
      await delay(60_000);
    }
    if (requestedSignal) throw new Error(`interrupted by ${requestedSignal}`);

    const endpoint = `http://127.0.0.1:${port}`;
    let healthy = false;
    const startupDeadline = Date.now() + 30_000;
    while (Date.now() < startupDeadline && !requestedSignal) {
      const requestTimeout = Math.max(1, Math.min(2_000, startupDeadline - Date.now()));
      try {
        const response = await fetch(`${endpoint}/minio/health/live`, {
          signal: AbortSignal.timeout(requestTimeout),
        });
        if (response.ok) {
          healthy = true;
          break;
        }
      } catch {
        // MinIO is still starting.
      }
      await delay(Math.min(500, Math.max(0, startupDeadline - Date.now())));
    }
    if (requestedSignal) throw new Error(`interrupted by ${requestedSignal}`);
    assert.equal(healthy, true, "the disposable MinIO service must become healthy");

    if (requestedSignal) throw new Error(`interrupted by ${requestedSignal}`);
    await runWorker(endpoint);
    console.log("[s3-security-supervisor] PASS: disposable MinIO contract completed; container cleanup follows.");
  } catch (error) {
    executionError = error;
  }

  try {
    await cleanup();
  } catch (error) {
    cleanupError = error;
  }

  if (requestedSignal) return;
  if (executionError && cleanupError) {
    throw new AggregateError([executionError, cleanupError], "S3 security execution and cleanup both failed");
  }
  if (executionError) throw executionError;
  if (cleanupError) throw cleanupError;
})().catch((error) => {
  console.error(`[s3-security-supervisor] FAIL: ${sanitizedMessage(error)}`);
  process.exitCode = 1;
});
