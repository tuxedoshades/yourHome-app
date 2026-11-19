import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const requiredEnvironment = (name: string) => {
  const value = process.env[name];
  assert.ok(value, `${name} is required for the disposable S3 security contract`);
  return value;
};

const endpoint = requiredEnvironment("S3_SECURITY_ENDPOINT");
const accessKeyId = requiredEnvironment("S3_SECURITY_ACCESS_KEY_ID");
const secretAccessKey = requiredEnvironment("S3_SECURITY_SECRET_ACCESS_KEY");
const region = "us-east-1";
const bucket = `yourhome-s3-security-${randomUUID()}`;
const keyPrefix = `security-contract/${randomUUID()}`;
const directKey = `${keyPrefix}/direct.txt`;
const presignedKey = `${keyPrefix}/presigned.txt`;
const directBody = "direct S3 security fixture";
const presignedBody = "presigned S3 security fixture";
const contentType = "text/plain";

assert.match(bucket, /^yourhome-s3-security-[a-f0-9-]{36}$/);
assert.ok(bucket.length <= 63, "the disposable bucket name must satisfy S3 length limits");
assert.match(directKey, /^security-contract\/[a-f0-9-]{36}\/direct\.txt$/);

const client = new S3Client({
  endpoint,
  region,
  forcePathStyle: true,
  credentials: { accessKeyId, secretAccessKey },
});

const bodyText = async (body: { transformToString?: () => Promise<string> } | undefined) => {
  assert.ok(body?.transformToString, "S3 object response must expose a readable body");
  return body.transformToString();
};

const hasHttpStatus = (error: unknown, status: number) =>
  typeof error === "object" &&
  error !== null &&
  "$metadata" in error &&
  (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === status;

let bucketCreated = false;
let testError: unknown;
let cleanupError: unknown;

try {
  await client.send(new CreateBucketCommand({ Bucket: bucket }));
  bucketCreated = true;

  const directPut = await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: directKey,
      Body: directBody,
      ContentType: contentType,
    }),
  );
  assert.ok(directPut.ETag, "direct PutObject must return an entity tag");

  const directHead = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: directKey }));
  assert.equal(directHead.ContentType, contentType, "direct upload must preserve content type");
  const directGet = await client.send(new GetObjectCommand({ Bucket: bucket, Key: directKey }));
  assert.equal(await bodyText(directGet.Body), directBody, "direct upload must preserve object bytes");

  const uploadUrl = await getSignedUrl(
    client,
    new PutObjectCommand({ Bucket: bucket, Key: presignedKey, ContentType: contentType }),
    { expiresIn: 300 },
  );
  const parsedUploadUrl = new URL(uploadUrl);
  assert.equal(
    parsedUploadUrl.searchParams.get("X-Amz-Expires"),
    "300",
    "presigned PUT must expire after five minutes",
  );
  assert.ok(parsedUploadUrl.searchParams.has("X-Amz-Signature"), "presigned PUT must contain a signature");

  const uploadResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "content-type": contentType },
    body: presignedBody,
  });
  assert.equal(uploadResponse.status, 200, "presigned PUT must be accepted by the S3-compatible service");

  const presignedHead = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: presignedKey }));
  assert.equal(presignedHead.ContentType, contentType, "presigned upload must preserve content type");
  const presignedGet = await client.send(new GetObjectCommand({ Bucket: bucket, Key: presignedKey }));
  assert.equal(await bodyText(presignedGet.Body), presignedBody, "presigned upload must preserve object bytes");

  const listed = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: keyPrefix }));
  assert.deepEqual(
    (listed.Contents ?? []).map((entry) => entry.Key).sort(),
    [directKey, presignedKey].sort(),
    "XML-backed object listing must preserve both generated object keys",
  );

  await assert.rejects(
    client.send(new GetObjectCommand({ Bucket: bucket, Key: `${keyPrefix}/missing.txt` })),
    (error: unknown) => hasHttpStatus(error, 404),
    "XML-backed missing-object responses must remain parseable as HTTP 404 errors",
  );
} catch (error) {
  testError = error;
} finally {
  if (bucketCreated) {
    try {
      await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: [{ Key: directKey }, { Key: presignedKey }], Quiet: true },
        }),
      );
      await client.send(new DeleteBucketCommand({ Bucket: bucket }));
      await assert.rejects(
        client.send(new HeadBucketCommand({ Bucket: bucket })),
        (error: unknown) => hasHttpStatus(error, 404),
        "the disposable bucket cleanup must produce an HTTP 404 absence response",
      );
    } catch (error) {
      cleanupError = error;
    }
  }
  client.destroy();
}

if (testError && cleanupError) {
  throw new AggregateError([testError, cleanupError], "S3 security contract and bucket cleanup both failed");
}
if (testError) throw testError;
if (cleanupError) throw cleanupError;

console.log(
  "[s3-security-contract] PASS: direct and presigned uploads, XML-backed responses, generated keys, and cleanup are compatible.",
);
