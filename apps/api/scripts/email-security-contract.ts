import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Socket } from "node:net";
import path from "node:path";
import tls from "node:tls";
import nodemailer from "nodemailer";

const timeoutMs = 10_000;
const fixtureDirectory = path.resolve(process.cwd(), "scripts", "fixtures");
const certificate = readFileSync(path.join(fixtureDirectory, "email-security-test-cert.pem"));
const privateKey = readFileSync(path.join(fixtureDirectory, "email-security-test-key.pem"));
const sender = `verification-${randomBytes(6).toString("hex")}@yourhome.test`;
const recipient = `user-${randomBytes(6).toString("hex")}@example.test`;
const smtpUser = `smtp-${randomBytes(8).toString("hex")}`;
const smtpPassword = randomBytes(24).toString("base64url");
const subject = "YourHome verification code";
const verificationCode = "482731";
const text = `YourHome verification code: ${verificationCode}\n\nThis code expires in 10 minutes.`;
const html = `<p>YourHome verification code:</p><p style="font-size:32px;font-weight:700;letter-spacing:4px;">${verificationCode}</p><p>This code expires in 10 minutes.</p>`;

const sockets = new Set<Socket>();
const transports: Array<ReturnType<typeof nodemailer.createTransport>> = [];
let envelopeFrom = "";
const envelopeRecipients: string[] = [];
let rawMessage = "";
let authenticatedDelivery = false;
let negotiatedProtocol: string | null = null;
let settleMessage: ((error?: Error) => void) | undefined;

const settleActiveMessage = (error?: Error) => {
  const settle = settleMessage;
  settleMessage = undefined;
  settle?.(error);
};

const smtpServer = tls.createServer(
  {
    cert: certificate,
    key: privateKey,
    minVersion: "TLSv1.2",
  },
  (socket) => {
    negotiatedProtocol = socket.getProtocol();
    socket.setEncoding("utf8");
    socket.on("error", settleActiveMessage);
    socket.once("close", () => socket.removeListener("error", settleActiveMessage));
    socket.write("220 localhost YourHome disposable SMTPS\r\n");

    let buffer = "";
    let dataMode = false;
    let socketAuthenticated = false;

    socket.on("data", (chunk: string) => {
      buffer += chunk;
      while (buffer.length > 0) {
        if (dataMode) {
          const terminatorIndex = buffer.indexOf("\r\n.\r\n");
          if (terminatorIndex < 0) return;
          const messageBuffer = buffer.slice(0, terminatorIndex);
          buffer = buffer.slice(terminatorIndex + 5);
          rawMessage = messageBuffer.replaceAll("\r\n..", "\r\n.");
          dataMode = false;
          socket.write("250 2.0.0 queued as yourhome-contract\r\n");
          settleActiveMessage();
          continue;
        }

        const lineEnd = buffer.indexOf("\r\n");
        if (lineEnd < 0) return;
        const line = buffer.slice(0, lineEnd);
        buffer = buffer.slice(lineEnd + 2);

        if (/^EHLO\s/i.test(line)) {
          socket.write("250-localhost\r\n250-AUTH PLAIN\r\n250 SIZE 1048576\r\n");
        } else if (/^HELO\s/i.test(line)) {
          socket.write("250 localhost\r\n");
        } else if (/^AUTH PLAIN\s+/i.test(line)) {
          const encoded = line.replace(/^AUTH PLAIN\s+/i, "");
          const [, username, password] = Buffer.from(encoded, "base64").toString("utf8").split("\0");
          socketAuthenticated = username === smtpUser && password === smtpPassword;
          authenticatedDelivery ||= socketAuthenticated;
          socket.write(
            socketAuthenticated ? "235 2.7.0 authentication successful\r\n" : "535 5.7.8 authentication failed\r\n",
          );
        } else if (/^MAIL FROM:/i.test(line)) {
          if (!socketAuthenticated) {
            socket.write("530 5.7.0 authentication required\r\n");
            continue;
          }
          envelopeFrom = line.replace(/^MAIL FROM:\s*</i, "").replace(/>.*$/, "");
          socket.write("250 2.1.0 sender accepted\r\n");
        } else if (/^RCPT TO:/i.test(line)) {
          if (!socketAuthenticated) {
            socket.write("530 5.7.0 authentication required\r\n");
            continue;
          }
          envelopeRecipients.push(line.replace(/^RCPT TO:\s*</i, "").replace(/>.*$/, ""));
          socket.write("250 2.1.5 recipient accepted\r\n");
        } else if (line === "DATA") {
          if (!socketAuthenticated) {
            socket.write("530 5.7.0 authentication required\r\n");
            continue;
          }
          dataMode = true;
          socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
        } else if (line === "QUIT") {
          socket.end("221 2.0.0 goodbye\r\n");
        } else {
          socket.write("250 2.0.0 ok\r\n");
        }
      }
    });
  },
);

smtpServer.on("connection", (socket) => {
  sockets.add(socket);
  socket.setTimeout(timeoutMs, () => socket.destroy(new Error("SMTP contract socket timed out")));
  const onError = () => {
    // Secure SMTP socket errors are routed to the active delivery by the secureConnection listener.
  };
  socket.on("error", onError);
  socket.once("close", () => {
    socket.removeListener("error", onError);
    sockets.delete(socket);
  });
});
smtpServer.on("tlsClientError", (_error, socket) => {
  socket.on("error", () => {
    // The intentional untrusted-certificate probe can reset after its client has already rejected it.
  });
  socket.destroy();
});
smtpServer.on("error", settleActiveMessage);

const withTimeout = async <T>(operation: Promise<T>, message: string): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const listen = async () => {
  const abortController = new AbortController();
  const operation = new Promise<number>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, port?: number) => {
      if (settled) return;
      settled = true;
      smtpServer.removeListener("error", onError);
      if (error) reject(error);
      else resolve(port as number);
    };
    const onError = (error: Error) => finish(error);
    smtpServer.once("error", onError);
    smtpServer.listen({ port: 0, host: "127.0.0.1", signal: abortController.signal }, () => {
      const address = smtpServer.address();
      if (!address || typeof address !== "object") {
        finish(new Error("SMTPS server must bind a loopback port"));
        return;
      }
      finish(undefined, address.port);
    });
  });

  try {
    return await withTimeout(operation, "SMTPS server listen exceeded its hard timeout");
  } catch (error) {
    abortController.abort();
    throw error;
  }
};

const closeServer = async () => {
  for (const socket of sockets) socket.destroy();
  if (!smtpServer.listening) return;
  try {
    await withTimeout(
      new Promise<void>((resolve, reject) => smtpServer.close((error) => (error ? reject(error) : resolve()))),
      "SMTPS server shutdown exceeded its hard timeout",
    );
  } catch (error) {
    for (const socket of sockets) socket.destroy();
    throw error;
  }
};

type Headers = Map<string, string[]>;

const splitEntity = (value: string, context: string) => {
  const separatorIndex = value.indexOf("\n\n");
  assert.notEqual(separatorIndex, -1, `${context} must contain a header/body separator`);
  return {
    headerBlock: value.slice(0, separatorIndex),
    body: value.slice(separatorIndex + 2),
  };
};

const parseHeaders = (headerBlock: string, context: string): Headers => {
  const unfolded: string[] = [];
  for (const line of headerBlock.split("\n")) {
    if (/^[ \t]/.test(line)) {
      assert.ok(unfolded.length > 0, `${context} must not start with a folded header`);
      unfolded[unfolded.length - 1] += ` ${line.trim()}`;
    } else {
      unfolded.push(line);
    }
  }

  const headers: Headers = new Map();
  for (const line of unfolded) {
    const colonIndex = line.indexOf(":");
    assert.ok(colonIndex > 0, `${context} contains a malformed header`);
    const name = line.slice(0, colonIndex).trim().toLowerCase();
    assert.match(name, /^[!#$%&'*+.^_`|~0-9a-z-]+$/, `${context} contains an invalid header name`);
    const values = headers.get(name) ?? [];
    values.push(line.slice(colonIndex + 1).trim());
    headers.set(name, values);
  }
  return headers;
};

const getSingleHeader = (headers: Headers, name: string, context: string) => {
  const values = headers.get(name.toLowerCase()) ?? [];
  assert.equal(values.length, 1, `${context} must contain exactly one ${name} header`);
  return values[0] as string;
};

const parseContentType = (value: string, context: string) => {
  const [rawMediaType, ...rawParameters] = value.split(";");
  const mediaType = rawMediaType?.trim().toLowerCase() ?? "";
  assert.match(mediaType, /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/, `${context} has an invalid media type`);
  const parameters = new Map<string, string>();
  for (const rawParameter of rawParameters) {
    const equalsIndex = rawParameter.indexOf("=");
    assert.ok(equalsIndex > 0, `${context} has a malformed Content-Type parameter`);
    const name = rawParameter.slice(0, equalsIndex).trim().toLowerCase();
    let parameterValue = rawParameter.slice(equalsIndex + 1).trim();
    if (parameterValue.startsWith('"') || parameterValue.endsWith('"')) {
      assert.ok(
        parameterValue.length >= 2 && parameterValue.startsWith('"') && parameterValue.endsWith('"'),
        `${context} has a malformed quoted Content-Type parameter`,
      );
      parameterValue = parameterValue.slice(1, -1).replace(/\\([\\"])/g, "$1");
    }
    assert.ok(name.length > 0 && parameterValue.length > 0, `${context} has an empty Content-Type parameter`);
    assert.equal(parameters.has(name), false, `${context} has a duplicate ${name} Content-Type parameter`);
    parameters.set(name, parameterValue);
  }
  return { mediaType, parameters };
};

const decodeQuotedPrintable = (value: string, context: string) => {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] as string;
    if (character === "=") {
      if (value[index + 1] === "\n") {
        index += 1;
        continue;
      }
      const hex = value.slice(index + 1, index + 3);
      assert.match(hex, /^[A-Fa-f0-9]{2}$/, `${context} contains malformed quoted-printable data`);
      bytes.push(Number.parseInt(hex, 16));
      index += 2;
      continue;
    }
    const codePoint = character.charCodeAt(0);
    assert.ok(codePoint <= 0x7f, `${context} contains non-ASCII quoted-printable transport data`);
    bytes.push(codePoint);
  }
  return Buffer.from(bytes);
};

const decodeTransferEncoding = (body: string, encoding: string, context: string) => {
  switch (encoding.trim().toLowerCase()) {
    case "quoted-printable":
      return decodeQuotedPrintable(body, context);
    case "base64": {
      const compact = body.replace(/[ \t\n]/g, "");
      assert.ok(
        compact.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(compact),
        `${context} contains malformed base64 data`,
      );
      const decoded = Buffer.from(compact, "base64");
      assert.equal(
        decoded.toString("base64").replace(/=+$/, ""),
        compact.replace(/=+$/, ""),
        `${context} contains non-canonical base64 data`,
      );
      return decoded;
    }
    case "7bit": {
      assert.ok(
        [...body].every((character) => character.charCodeAt(0) <= 0x7f),
        `${context} contains non-ASCII 7bit data`,
      );
      return Buffer.from(body, "ascii");
    }
    default:
      assert.fail(`${context} uses unsupported Content-Transfer-Encoding ${encoding}`);
  }
};

const decodeBody = (body: string, headers: Headers, charset: string, context: string) => {
  const encoding = getSingleHeader(headers, "content-transfer-encoding", context);
  const bytes = decodeTransferEncoding(body, encoding, context);
  const normalizedCharset = charset.toLowerCase().replace(/[^a-z0-9]/g, "");
  let decoded: string;
  if (normalizedCharset === "utf8") {
    decoded = bytes.toString("utf8");
    assert.deepEqual(Buffer.from(decoded, "utf8"), bytes, `${context} contains invalid UTF-8 data`);
  } else if (normalizedCharset === "ascii" || normalizedCharset === "usascii") {
    assert.ok(
      [...bytes].every((byte) => byte <= 0x7f),
      `${context} contains invalid ASCII data`,
    );
    decoded = bytes.toString("ascii");
  } else {
    assert.fail(`${context} uses unsupported charset ${charset}`);
  }
  return decoded.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
};

const assertMultipartAlternativeBodies = (message: string, expectedText: string, expectedHtml: string) => {
  const normalizedMessage = message.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const topLevel = splitEntity(normalizedMessage, "SMTP message");
  const topLevelHeaders = parseHeaders(topLevel.headerBlock, "SMTP message");
  const contentType = parseContentType(
    getSingleHeader(topLevelHeaders, "content-type", "SMTP message"),
    "SMTP message",
  );
  assert.equal(contentType.mediaType, "multipart/alternative", "SMTP message must be multipart/alternative");
  const boundary = contentType.parameters.get("boundary");
  assert.ok(boundary && !/[\r\n]/.test(boundary), "SMTP message must declare one valid MIME boundary");

  const delimiter = `--${boundary}`;
  const closingDelimiter = `${delimiter}--`;
  const lines = topLevel.body.split("\n");
  const parts: string[] = [];
  let lineIndex = 0;
  while (lines[lineIndex] === "") lineIndex += 1;
  assert.equal(lines[lineIndex], delimiter, "multipart/alternative body must begin with its MIME boundary");
  while (lines[lineIndex] === delimiter) {
    lineIndex += 1;
    const partStart = lineIndex;
    while (lineIndex < lines.length && lines[lineIndex] !== delimiter && lines[lineIndex] !== closingDelimiter) {
      lineIndex += 1;
    }
    assert.ok(lineIndex < lines.length, "multipart/alternative body must end with its closing MIME boundary");
    parts.push(lines.slice(partStart, lineIndex).join("\n"));
  }
  assert.equal(lines[lineIndex], closingDelimiter, "multipart/alternative body must have exactly one closing boundary");
  lineIndex += 1;
  assert.ok(
    lines.slice(lineIndex).every((line) => line === ""),
    "multipart/alternative body must not append data",
  );
  assert.equal(parts.length, 2, "SMTP message must contain exactly two multipart/alternative parts");

  const decodedBodies = new Map<string, string>();
  for (const [index, part] of parts.entries()) {
    const context = `MIME part ${index + 1}`;
    const entity = splitEntity(part, context);
    const headers = parseHeaders(entity.headerBlock, context);
    const partContentType = parseContentType(getSingleHeader(headers, "content-type", context), context);
    assert.ok(
      partContentType.mediaType === "text/plain" || partContentType.mediaType === "text/html",
      `${context} must be text/plain or text/html`,
    );
    assert.equal(
      decodedBodies.has(partContentType.mediaType),
      false,
      `SMTP message must not duplicate ${partContentType.mediaType}`,
    );
    const charset = partContentType.parameters.get("charset");
    assert.ok(charset, `${context} must declare a charset`);
    decodedBodies.set(partContentType.mediaType, decodeBody(entity.body, headers, charset, context));
  }

  assert.equal(decodedBodies.get("text/plain"), expectedText, "SMTP message must exactly preserve its text/plain body");
  assert.equal(decodedBodies.get("text/html"), expectedHtml, "SMTP message must exactly preserve its text/html body");
  return topLevelHeaders;
};

let executionError: unknown;

try {
  const port = await listen();
  const connectionOptions = {
    host: "127.0.0.1",
    port,
    secure: true,
    connectionTimeout: 3_000,
    greetingTimeout: 3_000,
    socketTimeout: 5_000,
  } as const;

  const untrustedTransport = nodemailer.createTransport(connectionOptions);
  transports.push(untrustedTransport);
  let untrustedConnectionError: unknown;
  try {
    await withTimeout(untrustedTransport.verify(), "Nodemailer untrusted SMTPS connection exceeded its hard timeout");
  } catch (error) {
    untrustedConnectionError = error;
  }
  const untrustedErrorCode =
    untrustedConnectionError instanceof Error ? (untrustedConnectionError as NodeJS.ErrnoException).code : undefined;
  const untrustedErrorCommand =
    untrustedConnectionError instanceof Error
      ? (untrustedConnectionError as Error & { command?: string }).command
      : undefined;
  assert.ok(
    untrustedConnectionError instanceof Error &&
      untrustedErrorCode === "ESOCKET" &&
      untrustedErrorCommand === "CONN" &&
      /^self-signed certificate(?:;|$)/i.test(untrustedConnectionError.message),
    "Nodemailer must reject the disposable SMTPS connection specifically because its certificate is untrusted",
  );

  const transport = nodemailer.createTransport({
    ...connectionOptions,
    auth: { user: smtpUser, pass: smtpPassword },
    tls: { ca: certificate, minVersion: "TLSv1.2" },
  });
  transports.push(transport);

  const messageReceived = new Promise<void>((resolve, reject) => {
    settleMessage = (error) => (error ? reject(error) : resolve());
  });
  const sendAndReceive = Promise.all([
    transport.sendMail({ from: sender, to: recipient, subject, text, html }),
    messageReceived,
  ]);
  const [sendResult] = await withTimeout(sendAndReceive, "Nodemailer SMTPS contract exceeded its hard timeout");

  assert.equal(authenticatedDelivery, true, "Nodemailer must authenticate before sending the verification message");
  assert.match(negotiatedProtocol ?? "", /^TLSv1\.[23]$/, "the SMTP message must use TLS 1.2 or newer");
  assert.equal(envelopeFrom, sender, "SMTP envelope sender must match YourHome's configured sender");
  assert.deepEqual(envelopeRecipients, [recipient], "SMTP envelope must contain only the intended recipient");
  assert.deepEqual(sendResult.accepted, [recipient], "Nodemailer must report the intended recipient as accepted");
  assert.deepEqual(sendResult.rejected, [], "Nodemailer must not report a rejected recipient");
  assert.match(sendResult.response, /^250 2\.0\.0 queued as yourhome-contract$/);
  assert.equal(sendResult.envelope.from, sender);
  assert.deepEqual(sendResult.envelope.to, [recipient]);
  const messageHeaders = assertMultipartAlternativeBodies(rawMessage, text, html);
  assert.equal(getSingleHeader(messageHeaders, "from", "SMTP message"), sender);
  assert.equal(getSingleHeader(messageHeaders, "to", "SMTP message"), recipient);
  assert.equal(getSingleHeader(messageHeaders, "subject", "SMTP message"), subject);

  const productionEmailSource = readFileSync(path.resolve(process.cwd(), "src", "index.ts"), "utf8");
  assert.ok(
    /nodemailer\.createTransport\(\s*smtpUrl\s*\?\s*smtpUrl\s*:\s*\{[\s\S]*?secure:\s*smtpSecure,/.test(
      productionEmailSource,
    ),
    "production email transport must preserve SMTP URL and explicit secure-mode configuration",
  );
  assert.ok(
    /emailTransport\.sendMail\(\{\s*from: emailFrom,\s*to: params\.email,\s*subject,\s*text,\s*html,/s.test(
      productionEmailSource,
    ),
    "production email delivery must preserve sender, recipient, subject, text, and HTML fields",
  );
  assert.ok(
    !/rejectUnauthorized\s*:\s*false/.test(productionEmailSource),
    "production email transport must retain strict TLS certificate verification",
  );

  console.log(
    "[email-security-contract] PASS: authenticated SMTPS content and strict certificate verification are compatible.",
  );
} catch (error) {
  executionError = error;
}

const cleanupErrors: unknown[] = [];
for (const transport of transports) {
  try {
    transport.close();
  } catch (error) {
    cleanupErrors.push(error);
  }
}
try {
  await closeServer();
} catch (error) {
  cleanupErrors.push(error);
}

const cleanupError =
  cleanupErrors.length === 0
    ? undefined
    : cleanupErrors.length === 1
      ? cleanupErrors[0]
      : new AggregateError(cleanupErrors, "multiple SMTP cleanup operations failed");
if (executionError && cleanupError) {
  throw new AggregateError([executionError, cleanupError], "email security contract and SMTP cleanup both failed");
}
if (executionError) throw executionError;
if (cleanupError) throw cleanupError;
