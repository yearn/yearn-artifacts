# Agent Notes

This package owns the Cloudflare Worker that publishes and renders private
security scan reports.

Keep the R2 bucket private. The Worker reaches it through a binding, not S3
credentials; do not reintroduce access keys, presigned URLs, public bucket
domains, or R2 dev URLs.

Publishers authenticate with a bearer key from the `PUBLISH_KEYS` secret,
parsed as a comma-separated list. Compare keys in constant time and without
short-circuiting on the first match.

Reads are currently unauthenticated. Do not add an index, listing, or search
endpoint while that is true — the absence of an index is the only thing keeping
one leaked URL from exposing every report. If reads get gated by Cloudflare
Access, revisit that.

The Worker names every report randomly on publish and reads the posted path
only for its extension. Anything a caller could derive a name from is public,
so a derived name would be a guessable URL. Do not let a caller supply the
stored name, and do not make it a function of the request.

Provenance travels as R2 custom metadata from optional `X-Report-*` request
headers, never in the key. Only the documented fields are stored, so adding one
means adding it to the allowed list rather than copying arbitrary headers.

Reports expire after 30 days under the `expire-reports` lifecycle rule. Reads
are unauthenticated, so a retained report is standing exposure; do not lengthen
the window to make this bucket serve as an archive.

Report content comes from repositories we do not control. Render it with raw
HTML disabled and escape any value interpolated into a page.

The stored R2 object key format is:

```text
<32 hex characters>.<ext>
```

Markdown reports also have a `<same 32 hex characters>.png` thumbnail. Its key
is stored in the report's custom metadata and it must be removed with the
report.

A stored key is never reused, so a published report never changes. That is what
makes the 24 hour cache safe.

The cache outlives both object deletion and deploys. Unpublish through the
Worker's DELETE route rather than deleting from R2, or the edge keeps serving
the report for up to a day. When the rendered output changes, bump
`RENDER_VERSION` in `src/index.ts`, or existing reports keep their old
rendering until the cache expires.

Verify cache behaviour on the real URL. A query string makes a different cache
key, so a cache-busted request proves nothing about what a reader sees.
