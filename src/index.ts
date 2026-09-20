import { authenticatedClientId, parseKeys } from "./auth";
import { renderLandingPage } from "./lander";
import { hasMermaid, MERMAID_URL, renderMarkdown, socialMeta } from "./render";

export interface Env {
  BUCKET: R2Bucket;
  BROWSER: BrowserRun;
  PUBLISH_KEYS?: string;
}

const CACHE_CONTROL = "public, max-age=86400";
const MARKDOWN_TYPE = "text/markdown; charset=utf-8";
const HTML_TYPE = "text/html; charset=utf-8";

export const RETENTION_TIERS = {
  "1d": 1,
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "1y": 365,
  archive: null
} as const;

export type RetentionTier = keyof typeof RETENTION_TIERS;
export const DEFAULT_TIER: RetentionTier = "archive";

export function createdDate(uploaded: Date): string {
  return uploaded.toISOString().slice(0, 10);
}

export function expirationDate(uploaded: Date, tier: RetentionTier = DEFAULT_TIER): string {
  const days = RETENTION_TIERS[tier];
  if (days === null) return "Never";
  const expires = new Date(uploaded.getTime() + days * 24 * 60 * 60 * 1000);
  return expires.toISOString().slice(0, 10);
}

export type ReportRoute = { tier: RetentionTier; key: string };

export function reportRoute(pathname: string): ReportRoute | null {
  const path = keyFromPathname(pathname);
  const parts = path.split("/");
  if (parts.length === 1 && parts[0]) return { tier: DEFAULT_TIER, key: parts[0] };
  if (
    parts.length !== 2
    || !parts[1]
    // Object.hasOwn, not `in`: inherited names like "toString" must not pass
    // as tiers, or a report lands under a prefix no lifecycle rule deletes.
    || !Object.hasOwn(RETENTION_TIERS, parts[0])
  ) return null;
  return { tier: parts[0] as RetentionTier, key: parts[1] };
}

export function storedKey(tier: RetentionTier, key: string): string {
  return `${tier}/${key}`;
}

export function publicPath(tier: RetentionTier, key: string): string {
  return tier === DEFAULT_TIER ? `/${key}` : `/${tier}/${key}`;
}

export function contentTypeForName(name: string): string {
  const lowerName = name.toLowerCase();
  if (lowerName.endsWith(".html") || lowerName.endsWith(".htm")) return HTML_TYPE;
  if (lowerName.endsWith(".json")) return "application/json; charset=utf-8";
  if (lowerName.endsWith(".sarif")) return "application/sarif+json";
  if (lowerName.endsWith(".md")) return MARKDOWN_TYPE;
  if (lowerName.endsWith(".txt")) return "text/plain; charset=utf-8";
  if (lowerName.endsWith(".svg")) return "image/svg+xml";
  if (lowerName.endsWith(".png")) return "image/png";
  if (lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

export function keyFromPathname(pathname: string): string {
  return decodeURIComponent(pathname.replace(/^\/+/, ""));
}

// The report-name component is always <32 hex>.<ext>; the retention prefix is
// parsed separately before this validation.
export function isValidKey(key: string): boolean {
  return /^[0-9a-f]{32}\.[a-z0-9]{1,16}$/.test(key);
}

// The posted path is only read for its extension, which is what decides the
// content type on the way back out.
export function extensionOf(name: string): string {
  const match = /\.([A-Za-z0-9]{1,16})$/.exec(name);
  return match ? match[1].toLowerCase() : "bin";
}

function text(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex" }
  });
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": CACHE_CONTROL,
      "x-robots-tag": "noindex"
    }
  });
}

// Report bytes never change, but the template that renders them does. Cached
// entries are scoped to this value so a rendering change takes effect on
// existing reports instead of waiting out the day-long TTL. Bump it whenever
// the rendered output changes.
const RENDER_VERSION = "23";

// The Cache API rejects non-GET keys, so HEAD and GET share one normalized
// entry rather than HEAD throwing inside waitUntil.
export function cacheKeyFor(url: string): Request {
  const keyUrl = new URL(url);
  keyUrl.searchParams.set("v", RENDER_VERSION);
  return new Request(keyUrl.toString(), { method: "GET" });
}

function isUnprefixed(request: Request): boolean {
  return !keyFromPathname(new URL(request.url).pathname).includes("/");
}

async function handleGet(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  route: ReportRoute
): Promise<Response> {
  const cacheKey = cacheKeyFor(request.url);
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  let tier = route.tier;
  let object = await env.BUCKET.get(storedKey(tier, route.key));
  // Unprefixed links issued before archive became the default still address 30d objects.
  if (!object && isUnprefixed(request)) {
    tier = "30d";
    object = await env.BUCKET.get(storedKey(tier, route.key));
  }
  if (!object) return text("not found", 404);

  const contentType = contentTypeForName(route.key);
  const thumbnail = object.customMetadata?.thumbnail;
  const thumbnailUrl = thumbnail
    ? `${new URL(request.url).origin}/${tier}/${thumbnail.split("/").at(-1)!}`
    : "";
  let response: Response;
  if (contentType === MARKDOWN_TYPE) {
    response = html(renderMarkdown(
      await object.text(),
      route.key,
      object.customMetadata ?? {},
      thumbnailUrl,
      createdDate(object.uploaded),
      expirationDate(object.uploaded, tier)
    ));
  } else {
    response = new Response(object.body, {
      headers: {
        "content-type": contentType,
        "cache-control": CACHE_CONTROL,
        "x-robots-tag": "noindex",
        etag: object.httpEtag
      }
    });
    // Published HTML documents are served as-is, apart from the social-preview tags for their
    // thumbnail, which are streamed into <head> so link unfurls show the capture. Appended, not
    // prepended: the document's own <meta charset> has to stay within the first 1024 bytes.
    if (contentType === HTML_TYPE && thumbnailUrl) {
      response = new HTMLRewriter()
        .on("head", { element(head) { head.append(socialMeta(thumbnailUrl), { html: true }); } })
        .transform(response);
    }
  }

  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

// A report name derived from the request would be guessable, since everything
// a publisher knows about a scan is public. The name is random instead, and the
// URL a publish returns is the only handle on the report.
export function randomName(extension: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${token}.${extension}`;
}

export function thumbnailName(reportKey: string): string {
  return `${reportKey.slice(0, 32)}.png`;
}

// Report types that get an OG thumbnail captured at publish time: markdown (rendered by this
// worker) and HTML documents (captured as published).
export function hasThumbnail(name: string): boolean {
  const type = contentTypeForName(name);
  return type === MARKDOWN_TYPE || type === HTML_TYPE;
}

// Stored names are random, so listing the bucket says nothing about what a
// report is. Provenance rides along as object metadata instead.
const METADATA_FIELDS = [
  "repository", "scanner", "ref", "commit", "model", "effort", "name", "confidential"
] as const;
const METADATA_LIMIT = 512;

export function metadataFromHeaders(
  headers: Headers,
  originalName: string
): Record<string, string> {
  const metadata: Record<string, string> = {};
  for (const field of METADATA_FIELDS) {
    const value = field === "name"
      ? headers.get(`x-report-${field}`) ?? originalName
      : headers.get(`x-report-${field}`);
    if (value) metadata[field] = value.trim().slice(0, METADATA_LIMIT);
  }
  return metadata;
}

// Regex for the screenshot pass's rejectRequestPattern: rejects every URL except those under the
// allowed prefixes (same-origin artifacts, plus the mermaid dist directory when needed).
export function screenshotRejectPattern(origin: string, withDiagrams: boolean): string {
  const prefixes = [`${origin}/`];
  if (withDiagrams) prefixes.push(MERMAID_URL.slice(0, MERMAID_URL.lastIndexOf("/") + 1));
  const escaped = prefixes.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return `^(?!${escaped.join("|")}).*`;
}

async function handlePublish(request: Request, env: Env, route: ReportRoute): Promise<Response> {
  const clientId = authenticatedClientId(request.headers.get("authorization"), parseKeys(env.PUBLISH_KEYS));
  if (!clientId) {
    return text("unauthorized", 401);
  }
  if (!request.body) return text("empty body", 400);

  const extension = extensionOf(route.key);
  const stored = randomName(extension);
  const internal = storedKey(route.tier, stored);
  const url = new URL(request.url);
  const metadata = { ...metadataFromHeaders(request.headers, route.key), publisherClientId: clientId };

  if (hasThumbnail(stored)) {
    const source = await request.text();
    const thumbnail = thumbnailName(stored);
    const internalThumbnail = storedKey(route.tier, thumbnail);
    const thumbnailUrl = `${url.origin}${publicPath(route.tier, thumbnail)}`;
    const created = new Date();
    // Markdown is rendered to the report page first; HTML documents are captured as published.
    const page = extension === "md"
      ? renderMarkdown(
        source,
        stored,
        metadata,
        thumbnailUrl,
        createdDate(created),
        expirationDate(created, route.tier),
        { screenshot: true }
      )
      : source;
    // The thumbnail page is allowed two kinds of request: images published here (reports embed
    // their own infographics as <img> artifacts on this origin) and, when the report has mermaid
    // diagrams, the pinned mermaid dist path (the ESM build lazy-loads chunks beside the entry
    // file). Everything else is rejected so the capture doesn't depend on third parties. With
    // diagrams, the capture also waits for the script's completion marker so they are drawn
    // before the screenshot. The marker is set even on CDN failure, degrading the thumbnail to
    // code blocks instead of a 502.
    const withDiagrams = extension === "md" && hasMermaid(page);
    const screenshot = await env.BROWSER.quickAction("screenshot", {
      html: page,
      viewport: { width: 1200, height: 630 },
      waitForTimeout: 500,
      rejectRequestPattern: [screenshotRejectPattern(url.origin, withDiagrams)],
      ...(withDiagrams
        ? { waitForSelector: { selector: "html[data-mermaid-done]", timeout: 10000 } }
        : {}),
      screenshotOptions: { type: "png", encoding: "binary", fullPage: false }
    });
    if (!screenshot.ok) return text("thumbnail generation failed", 502);

    const image = await screenshot.arrayBuffer();
    await Promise.all([
      env.BUCKET.put(internal, source, {
        httpMetadata: { contentType: contentTypeForName(stored), cacheControl: CACHE_CONTROL },
        customMetadata: { ...metadata, thumbnail }
      }),
      env.BUCKET.put(internalThumbnail, image, {
        httpMetadata: { contentType: "image/png", cacheControl: CACHE_CONTROL },
        customMetadata: { publisherClientId: clientId }
      })
    ]);
  } else {
    await env.BUCKET.put(internal, request.body, {
      httpMetadata: { contentType: contentTypeForName(stored), cacheControl: CACHE_CONTROL },
      customMetadata: metadata
    });
  }

  return new Response(JSON.stringify({
    key: stored,
    url: `${url.origin}${publicPath(route.tier, stored)}`
  }) + "\n", {
    status: 201,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

// Deleting the object alone would leave the edge serving the report for up to a
// day, so an unpublish has to drop the cached copy too.
async function handleDelete(request: Request, env: Env, route: ReportRoute): Promise<Response> {
  const clientId = authenticatedClientId(request.headers.get("authorization"), parseKeys(env.PUBLISH_KEYS));
  if (!clientId) {
    return text("unauthorized", 401);
  }

  const keys = hasThumbnail(route.key) ? [route.key, thumbnailName(route.key)] : [route.key];
  const tiers: RetentionTier[] = isUnprefixed(request) ? ["archive", "30d"] : [route.tier];
  const internalKeys = tiers.flatMap((tier) => keys.map((key) => storedKey(tier, key)));
  const objects = await Promise.all(internalKeys.map((key) => env.BUCKET.head(key)));
  // Authorize every existing object before mutating anything. This also guards
  // direct thumbnail deletes and prevents a fallback from bypassing ownership.
  if (objects.some((object) => object && object.customMetadata?.publisherClientId !== clientId)) {
    return text("forbidden", 403);
  }
  if (!objects.some(Boolean)) return text("not found", 404);
  await Promise.all(internalKeys.map((key) => env.BUCKET.delete(key)));
  // Both tiers can be read through an unprefixed URL; archive also has older
  // explicit URLs. Evict every alias, including thumbnails, whichever URL was deleted.
  const prefixes = new Set<string>(tiers);
  if (tiers.includes("archive") || tiers.includes("30d")) prefixes.add("");
  await Promise.all([...prefixes].flatMap((prefix) => keys.map((key) => {
    const url = new URL(request.url);
    url.pathname = prefix ? `/${prefix}/${key}` : `/${key}`;
    return caches.default.delete(cacheKeyFor(url.toString()));
  })));
  return new Response(JSON.stringify({ key: route.key, deleted: true }) + "\n", {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const key = keyFromPathname(url.pathname);
    const route = key === "" ? null : reportRoute(url.pathname);

    // The runtime strips the body from a HEAD response, so HEAD can share the
    // GET path and still report accurate status and headers.
    const isRead = request.method === "GET" || request.method === "HEAD";

    if (key === "") {
      return isRead ? html(renderLandingPage(url.origin)) : text("method not allowed", 405);
    }

    // A read names a stored report, so it must look like one. A publish only
    // supplies a file name for its extension, so it is not held to that shape.
    if (isRead) {
      return route && isValidKey(route.key)
        ? handleGet(request, env, ctx, route)
        : text("invalid key", 400);
    }
    if (request.method === "DELETE") {
      return route && isValidKey(route.key)
        ? handleDelete(request, env, route)
        : text("invalid key", 400);
    }
    if (request.method === "POST") {
      const tiers = Object.keys(RETENTION_TIERS)
        .map((tier) => `/${tier}/<name>`)
        .join(", ");
      return route
        ? handlePublish(request, env, route)
        : text(`invalid path: publish to /<name> (${DEFAULT_TIER} default) or ${tiers}`, 400);
    }
    return text("method not allowed", 405);
  }
} satisfies ExportedHandler<Env>;
