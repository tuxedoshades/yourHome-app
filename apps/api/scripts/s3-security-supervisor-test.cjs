const assert = require("node:assert/strict");
const { execFile, spawn } = require("node:child_process");
const path = require("node:path");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const apiRoot = path.resolve(__dirname, "..");
const supervisor = path.join(__dirname, "s3-security-supervisor.cjs");
const interruptionCases = [
  "S3_SECURITY_TEST_INTERRUPT_DURING_DOCKER_RUN",
  "S3_SECURITY_TEST_INTERRUPT_AFTER_WORKER_START",
];
const timeoutCase = "S3_SECURITY_TEST_HANG_AFTER_CONTAINER_START";
const minioImage = "cgr.dev/chainguard/minio@sha256:e9cf6b99c226e9539ed0f14b6f00e37b07da153c7ba1f4f8709c807574b471ec";
const disposableNamePattern = /^yourhome-s3-security-[0-9]+-[a-f0-9]{8}$/;
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const parseDisposableContainerRows = (dockerOutput) => {
  if (dockerOutput === "") return [];
  const withoutTerminalNewline = dockerOutput.endsWith("\r\n")
    ? dockerOutput.slice(0, -2)
    : dockerOutput.endsWith("\n")
      ? dockerOutput.slice(0, -1)
      : dockerOutput;
  if (withoutTerminalNewline === "") return [];
  return withoutTerminalNewline.split(/\r?\n/).map((line) => {
    const [id, name, ...unexpected] = line.split("\t");
    if (!id || !name || unexpected.length > 0) {
      throw new Error("Docker returned a malformed disposable-container row");
    }
    return { id, name };
  });
};

const listDisposableContainers = async () => {
  const result = await execFileAsync(
    "docker",
    ["ps", "--all", "--filter", "name=^/yourhome-s3-security-", "--format", "{{.ID}}\t{{.Names}}"],
    { windowsHide: true },
  );
  return parseDisposableContainerRows(result.stdout);
};

const isMissingContainerError = (error) => {
  const stderr = typeof error?.stderr === "string" ? error.stderr.toLowerCase() : "";
  return stderr.includes("no such object") || stderr.includes("no such container");
};

const removeDecoyContainer = async (name) => {
  let removalError;
  try {
    await execFileAsync("docker", ["rm", "--force", name], { windowsHide: true });
  } catch (error) {
    removalError = error;
  }

  let stillPresent = false;
  let verificationError;
  try {
    await execFileAsync("docker", ["inspect", name], { windowsHide: true });
    stillPresent = true;
  } catch (error) {
    if (!isMissingContainerError(error)) verificationError = error;
  }

  if (removalError && (stillPresent || verificationError)) {
    throw new AggregateError(
      [removalError, verificationError].filter(Boolean),
      "decoy removal and final-absence verification both failed",
    );
  }
  if (removalError) throw new Error("decoy removal reported a failure", { cause: removalError });
  if (verificationError) throw new Error("unable to verify decoy-container absence", { cause: verificationError });
  if (stillPresent) throw new Error("decoy container remained after explicit cleanup");
};

const removeDisposableContainers = async () => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const listed = await listDisposableContainers();
    if (listed.length > 0) {
      assert.ok(
        listed.every(({ id, name }) => /^[a-f0-9]{12,64}$/.test(id) && disposableNamePattern.test(name)),
        "Docker fallback removal requires a valid ID and an exact disposable-container name",
      );
      try {
        await execFileAsync("docker", ["rm", "--force", ...listed.map(({ id }) => id)], { windowsHide: true });
      } catch {
        // Final absence verification below remains authoritative.
      }
    }
    await delay(200);
  }
  if ((await listDisposableContainers()).length > 0) {
    throw new Error("timed-out lifecycle fallback failed to remove every disposable S3 container");
  }
};

const terminateProcessTree = async (child, exited) => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    try {
      await execFileAsync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
    } catch {
      child.kill("SIGKILL");
    }
  } else {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
  await Promise.race([exited, delay(5_000)]);
  if (child.exitCode === null && child.signalCode === null) {
    throw new Error("timed-out lifecycle supervisor process tree did not terminate");
  }
};

const runInterruptionCase = async (environmentName) => {
  const child = spawn(process.execPath, [supervisor], {
    cwd: apiRoot,
    env: { ...process.env, [environmentName]: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    detached: process.platform !== "win32",
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const exited = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  let timeout;
  const timeoutMilliseconds = environmentName === timeoutCase ? 2_000 : 45_000;
  const timedOut = new Promise((resolve) => {
    timeout = setTimeout(() => resolve(true), timeoutMilliseconds);
    timeout.unref();
  });
  const result = await Promise.race([exited, timedOut]);
  clearTimeout(timeout);

  if (result === true) {
    let terminationError;
    let fallbackError;
    try {
      await terminateProcessTree(child, exited);
    } catch (error) {
      terminationError = error;
    }
    try {
      await removeDisposableContainers();
    } catch (error) {
      fallbackError = error;
    }
    if (terminationError && fallbackError) {
      throw new AggregateError(
        [terminationError, fallbackError],
        `${environmentName} timed out and process/container cleanup both failed`,
      );
    }
    if (terminationError) throw terminationError;
    if (fallbackError) throw fallbackError;
    throw new Error(`${environmentName} timed out; process-tree and container fallback cleanup succeeded`);
  }

  return { ...result, output: `${stdout}\n${stderr}` };
};

(async () => {
  assert.throws(
    () => parseDisposableContainerRows("abc123\tyourhome-s3-security-1-deadbeef\t\n"),
    /malformed disposable-container row/,
    "a trailing empty Docker field must not be normalized away",
  );
  assert.throws(
    () => parseDisposableContainerRows("\tabc123\tyourhome-s3-security-1-deadbeef\n"),
    /malformed disposable-container row/,
    "a leading empty Docker field must not be normalized away",
  );
  if ((await listDisposableContainers()).length > 0) {
    await removeDisposableContainers();
    throw new Error("a disposable S3 container predated lifecycle tests; fallback cleanup succeeded");
  }

  for (const environmentName of interruptionCases) {
    const result = await runInterruptionCase(environmentName);
    if ((await listDisposableContainers()).length > 0) {
      await removeDisposableContainers();
      throw new Error(`${environmentName} left a disposable container; fallback cleanup succeeded`);
    }
    assert.equal(result.code, 143, `${environmentName} must preserve the SIGTERM exit code after cleanup`);
    assert.equal(result.signal, null, `${environmentName} must exit through the tested cleanup handler`);
    if (/MINIO_ROOT_(?:USER|PASSWORD)=/.test(result.output)) {
      throw new Error(`${environmentName} exposed a generated Docker environment value`);
    }
  }

  const unrelatedName = `unrelated-yourhome-s3-security-${process.pid}-deadbeef-extra`;
  await execFileAsync("docker", ["create", "--name", unrelatedName, minioImage], { windowsHide: true });
  let timeoutMessage;
  let timeoutReturned = false;
  let decoyTestError;
  try {
    try {
      await runInterruptionCase(timeoutCase);
      timeoutReturned = true;
    } catch (error) {
      timeoutMessage = error instanceof Error ? error.message : "unknown timeout failure";
    }
    if ((await listDisposableContainers()).length > 0) {
      await removeDisposableContainers();
      if (!timeoutMessage) {
        timeoutMessage = `${timeoutCase} returned unexpectedly and left a container; fallback cleanup succeeded`;
      }
    }
    try {
      await execFileAsync("docker", ["inspect", unrelatedName], { windowsHide: true });
    } catch {
      throw new Error("timeout fallback removed an unrelated container whose name only contained the test token");
    }
  } catch (error) {
    decoyTestError = error;
  }
  let decoyCleanupError;
  try {
    await removeDecoyContainer(unrelatedName);
  } catch (error) {
    decoyCleanupError = error;
  }
  if (decoyTestError && decoyCleanupError) {
    throw new AggregateError(
      [decoyTestError, decoyCleanupError],
      "decoy-preservation regression and decoy cleanup both failed",
    );
  }
  if (decoyTestError) throw decoyTestError;
  if (decoyCleanupError) throw decoyCleanupError;
  if (timeoutReturned && !timeoutMessage) {
    timeoutMessage = `${timeoutCase} returned unexpectedly without exercising its timeout`;
  }
  assert.equal(
    timeoutMessage,
    `${timeoutCase} timed out; process-tree and container fallback cleanup succeeded`,
    "the lifecycle timeout must terminate the process tree and complete fallback container cleanup",
  );
  assert.equal(
    (await listDisposableContainers()).length,
    0,
    "the lifecycle timeout fallback must prove final container absence",
  );

  console.log(
    "[s3-security-supervisor-test] PASS: Docker-launch, active-worker, and timeout paths preserve cleanup and secrecy.",
  );
})().catch((error) => {
  const message = error instanceof Error ? error.message : "unknown lifecycle test failure";
  console.error(`[s3-security-supervisor-test] FAIL: ${message}`);
  process.exitCode = 1;
});
