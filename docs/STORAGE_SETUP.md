# Storage Setup (Uploads)

YourHome supports two upload modes:

- `local` (default): files stored on API host disk
- `s3`: presigned direct upload to S3-compatible object storage (AWS S3, Cloudflare R2, MinIO, etc.)

## 1) Local Mode (fastest for demo)

In `apps/api/.env`:

```env
STORAGE_PROVIDER="local"
```

Behavior:
- reviewer-web uploads file via API
- API stores to local `uploads/` directory
- API serves files at `/uploads/*`

---

## 2) S3-Compatible Mode (production path)

In `apps/api/.env`:

```env
STORAGE_PROVIDER="s3"
S3_BUCKET="yourhome-uploads"
S3_REGION="us-east-1"
S3_ENDPOINT=""
S3_PUBLIC_BASE_URL=""
```

### Required fields
- `S3_BUCKET`: bucket/container name
- `S3_REGION`: region label expected by provider SDK

### Optional fields
- `S3_ENDPOINT`: needed for S3-compatible non-AWS providers (R2/MinIO)
- `S3_PUBLIC_BASE_URL`: preferred public base URL (CDN/custom domain)
  - if unset, API falls back to standard AWS-style URL format

---

## AWS S3 Example

```env
STORAGE_PROVIDER="s3"
S3_BUCKET="yourhome-prod-uploads"
S3_REGION="us-east-1"
S3_ENDPOINT=""
S3_PUBLIC_BASE_URL="https://yourhome-prod-uploads.s3.us-east-1.amazonaws.com"
```

Notes:
- ensure bucket CORS allows PUT from your reviewer-web origin
- credentials come from runtime env (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`)

---

## Cloudflare R2 Example

```env
STORAGE_PROVIDER="s3"
S3_BUCKET="yourhome-uploads"
S3_REGION="auto"
S3_ENDPOINT="https://<accountid>.r2.cloudflarestorage.com"
S3_PUBLIC_BASE_URL="https://pub-<token>.r2.dev"
```

Notes:
- use R2 Access Key + Secret as AWS-compatible env vars
- if using custom domain, set that as `S3_PUBLIC_BASE_URL`

---

## Verify Setup

1. Start API + reviewer-web
2. Log in as homeowner
3. In Homeowner Resubmission, upload a document
4. Confirm `Document URL` is populated
5. Open the URL in browser:
   - local mode: should resolve to your API host `/uploads/...`
   - s3 mode: should resolve to your configured public storage URL

---

## Security Recommendations

- Keep upload max size strict (currently 10MB)
- Restrict accepted MIME types
- Prefer private bucket + signed access for sensitive docs (future hardening)
- Add antivirus/malware scanning in production pipeline (future hardening)
