# Section 9 Artifacts

Cloudflare Worker that publishes and renders private security scan reports
stored in the `section9` R2 bucket.

Markdown is rendered as HTML and published with a 1200×630 social preview
image. Everything else is served as stored bytes.

## Architecture

- R2 bucket: `section9`, private, reached through a Worker binding
- Browser Run: renders a 1200×630 PNG for every Markdown report
- Publisher authentication: bearer key from the `PUBLISH_KEYS` secret
- Report access: unauthenticated, by URL
- Hostnames: `https://artifacts.yearn.dev` (custom domain) and
  `https://yearn-artifacts.<account>.workers.dev` (kept enabled alongside it,
  since existing report URLs on that domain must keep working)

The Worker is the only thing holding bucket access, so publishers never see S3
credentials. Revoking a publisher means dropping its key from `PUBLISH_KEYS`.
The generated PNG is exposed through the report's `og:image` and Twitter Card
metadata.

## Names

Post to any file name. Only the extension is read, and it decides the content
type the report is served with. The report is stored under a random name:

```text
<32 hex characters>.<ext>
```

Anything a publisher could derive a name from is public, so a derived name
would be a guessable URL. The publish response carries the real URL and is the
only handle on the report. Two publishes produce two reports, so a report can
never be silently overwritten.

## Endpoints

```text
GET    /                  read the landing page
GET    /<name>            read a report
POST   /<anything>.<ext>  publish a report
DELETE /<name>            unpublish a report
```

Reads are cached for 24 hours. A stored name is never reused, so a published
report never changes.

Cache entries are scoped to a render version, so a change to the report
template takes effect on existing reports rather than waiting out the cache.
Bump `RENDER_VERSION` in `src/index.ts` when the rendered output changes.

## Retention

Reports expire 30 days after publish, via an R2 lifecycle rule on the bucket:

```bash
pnpm exec wrangler r2 bucket lifecycle add section9 \
  expire-reports "" --expire-days 30
```

A report URL is the only handle on it, and those live in CI logs and chat
messages that age out sooner than that. Anything worth keeping longer belongs
in a deliberate archive, not in this bucket.

## Setup

Install dependencies:

```bash
corepack enable
pnpm install
```

Create the private R2 bucket:

```bash
pnpm provision
```

Set one or more publish keys, comma-separated:

```bash
pnpm exec wrangler secret put PUBLISH_KEYS
```

Deploy:

```bash
pnpm deploy
```

## Publish a Report

```bash
curl -X POST "$ARTIFACTS_URL/REPORT.md" \
  -H "Authorization: Bearer $SECTION9_PUBLISH_KEY" \
  -H "Content-Type: text/markdown" \
  -H "X-Report-Repository: owner/repo" \
  -H "X-Report-Scanner: socket" \
  -H "X-Report-Ref: main" \
  -H "X-Report-Commit: $GITHUB_SHA" \
  --data-binary @REPORT.md
```

The command prints JSON:

```json
{
  "key": "9f2c41d7ab3e5806d1f4c92b7e0a5643.md",
  "url": "https://<worker>/9f2c41d7ab3e5806d1f4c92b7e0a5643.md"
}
```

Open that URL to read the rendered report.

## Unpublish a Report

```bash
curl -X DELETE "$ARTIFACTS_URL/9f2c41d7ab3e5806d1f4c92b7e0a5643.md" \
  -H "Authorization: Bearer $SECTION9_PUBLISH_KEY"
```

This removes the object and its cached copy. Deleting straight from R2 would
leave the edge serving the report for up to a day.

## Provenance

Stored names are random, so listing the bucket says nothing about what a report
is. The optional `X-Report-*` headers are stored as R2 custom metadata:

```text
repository  scanner  ref  commit  name
```

`name` defaults to the posted file name. Values are trimmed to 512 characters,
and unknown `X-Report-*` headers are ignored. The rendered report shows this
line in its footer, falling back to the stored name when no metadata was sent.

## Access

Writes require a bearer key. **Reads are not authenticated** — anyone with a
report URL can read it. There is no index, and report names are
random, so a report is only reachable by the URL the publish returned. Treat report URLs as secrets.

To gate reads later, put a Cloudflare Access application in front of
`artifacts.yearn.dev`.
