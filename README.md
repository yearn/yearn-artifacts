# Artifacts

Cloudflare Worker that publishes and renders reports
stored in the `artifacts` R2 bucket.

Markdown is rendered as HTML and published with a 1200×630 social preview
image. Everything else is served as stored bytes.

## Architecture

- R2 bucket: `artifacts`, private, reached through a Worker binding
- Browser Run: renders a 1200×630 PNG for every Markdown report
- Publisher authentication: bearer key from the `PUBLISH_KEYS` secret
- Report access: by URL
- Hostnames: `https://artifacts.yearn.dev` (custom domain) and
  `https://yearn-artifacts.<account>.workers.dev` (kept enabled alongside it,
  since existing report URLs on that domain must keep working)

The Worker is the only thing holding bucket access, so publishers never see S3
credentials. Revoking a publisher means dropping its key from `PUBLISH_KEYS`.
The generated PNG is exposed through the report's `og:image` and Twitter Card
metadata.

## Names

Post to any file name. Only the extension is read, and it decides the content
type the report is served with. The report is stored under a retention prefix
and a random name:

```text
<retention>/<32 hex characters>.<ext>
```

The default public URL omits its internal `30d/` prefix.

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

Reports expire 30 days after publish by default. A path prefix selects another
retention tier:

```text
/1d/<name>        1 day
/7d/<name>        7 days
/<name>           30 days (default)
/90d/<name>       90 days
/1y/<name>        1 year
/archive/<name>   no automatic expiration
```

R2 lifecycle rules apply to matching internal object prefixes and perform the
deletion automatically. Lifecycle deletion is asynchronous and may take about
24 hours after the displayed expiration date. Archive reports remain removable
through the authenticated DELETE endpoint.

The lifecycle configuration also aborts incomplete multipart uploads after
seven days. The Worker never starts multipart uploads, so that rule is
defensive hygiene for the bucket, not part of report retention.

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

### One-time retention migration

The retention-tier rollout moves reports published before tier prefixes were
introduced from the bucket root into `30d/`. Deploy the tier-aware Worker, run
the authenticated migration, then install the prefix lifecycle configuration:

```bash
pnpm deploy
pnpm migrate
pnpm provision
```

`pnpm migrate` uses `ARTIFACTS_URL` and `ARTIFACTS_API_KEY`, processes root
objects in bounded pages, and reports counts without exposing object names.
Existing public report URLs do not change. Copying resets the R2 upload date,
so migrated reports receive 30 days from migration. Once migration is verified,
remove the temporary migration route and legacy root-key fallback from
`src/index.ts`, along with this script.

## Publish a Report

```bash
curl -X POST "$ARTIFACTS_URL/REPORT.md" \
  -H "Authorization: Bearer $PUBLISH_KEY" \
  -H "Content-Type: text/markdown" \
  -H "X-Report-Repository: owner/repo" \
  -H "X-Report-Scanner: socket" \
  -H "X-Report-Ref: main" \
  -H "X-Report-Commit: $GITHUB_SHA" \
  -H "X-Report-Confidential: true" \
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

To select another retention tier, include it before the posted name:

```bash
curl -X POST "$ARTIFACTS_URL/7d/REPORT.md" \
  -H "Authorization: Bearer $PUBLISH_KEY" \
  -H "Content-Type: text/markdown" \
  --data-binary @REPORT.md
```

The returned read and delete URL will include the same `/7d/` tier.

## Unpublish a Report

```bash
curl -X DELETE "$ARTIFACTS_URL/9f2c41d7ab3e5806d1f4c92b7e0a5643.md" \
  -H "Authorization: Bearer $PUBLISH_KEY"
```

This removes the object and its cached copy. Deleting straight from R2 would
leave the edge serving the report for up to a day.

## Provenance

Stored names are random, so listing the bucket says nothing about what a report
is. The optional `X-Report-*` headers are stored as R2 custom metadata:

```text
repository  scanner  ref  commit  name  confidential
```

`name` defaults to the posted file name. Values are trimmed to 512 characters,
and unknown `X-Report-*` headers are ignored. The rendered report shows this
line in its footer, falling back to the stored name when no metadata was sent.
When `confidential` is exactly `true`, rendered Markdown and its social preview
show a `Yearn Confidential — Do Not Distribute` notice. Unset, `false`, and
other values do not show the notice. This is a visual label, not access control.

## Access

Writes require a bearer key. **Reads are not authenticated** — anyone with a
report URL can read it. There is no index, and report names are
random, so a report is only reachable by the URL the publish returned. Treat report URLs as secrets.

To gate reads later, put a Cloudflare Access application in front of
`artifacts.yearn.dev`.
