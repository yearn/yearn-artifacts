import { isAuthorized, parseKeys } from "./auth";
import { renderLandingPage } from "./lander";
import { renderMarkdown } from "./render";

export interface Env {
  BUCKET: R2Bucket;
  BROWSER: BrowserRun;
  PUBLISH_KEYS?: string;
}

const CACHE_CONTROL = "public, max-age=86400";
const MARKDOWN_TYPE = "text/markdown; charset=utf-8";

export const RETENTION_TIERS = {
  "1d": 1,
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "1y": 365,
  archive: null
} as const;

export type RetentionTier = keyof typeof RETENTION_TIERS;
export const DEFAULT_TIER: RetentionTier = "30d";

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
    || parts[0] === DEFAULT_TIER
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
  if (lowerName.endsWith(".html") || lowerName.endsWith(".htm")) return "text/html; charset=utf-8";
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
const RENDER_VERSION = "15";

// The Cache API rejects non-GET keys, so HEAD and GET share one normalized
// entry rather than HEAD throwing inside waitUntil.
export function cacheKeyFor(url: string): Request {
  const keyUrl = new URL(url);
  keyUrl.searchParams.set("v", RENDER_VERSION);
  return new Request(keyUrl.toString(), { method: "GET" });
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

  const internalKey = storedKey(route.tier, route.key);
  // Temporary compatibility for reports published before retention prefixes
  // were introduced. Remove after the one-time migration has been verified.
  const object = await env.BUCKET.get(internalKey)
    ?? (route.tier === DEFAULT_TIER ? await env.BUCKET.get(route.key) : null);
  if (!object) return text("not found", 404);

  const contentType = contentTypeForName(route.key);
  const thumbnail = object.customMetadata?.thumbnail;
  const thumbnailUrl = thumbnail
    ? `${new URL(request.url).origin}${publicPath(route.tier, thumbnail.split("/").at(-1)!)}`
    : "";
  const response = contentType === MARKDOWN_TYPE
    ? html(renderMarkdown(
      await object.text(),
      route.key,
      object.customMetadata ?? {},
      thumbnailUrl,
      createdDate(object.uploaded),
      expirationDate(object.uploaded, route.tier)
    ))
    : new Response(object.body, {
      headers: {
        "content-type": contentType,
        "cache-control": CACHE_CONTROL,
        "x-robots-tag": "noindex",
        etag: object.httpEtag
      }
    });

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

// Stored names are random, so listing the bucket says nothing about what a
// report is. Provenance rides along as object metadata instead.
const METADATA_FIELDS = ["repository", "scanner", "ref", "commit", "name", "confidential"] as const;
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

async function handlePublish(request: Request, env: Env, route: ReportRoute): Promise<Response> {
  if (!isAuthorized(request.headers.get("authorization"), parseKeys(env.PUBLISH_KEYS))) {
    return text("unauthorized", 401);
  }
  if (!request.body) return text("empty body", 400);

  const extension = extensionOf(route.key);
  const stored = randomName(extension);
  const internal = storedKey(route.tier, stored);
  const url = new URL(request.url);
  const metadata = metadataFromHeaders(request.headers, route.key);

  if (extension === "md") {
    const source = await request.text();
    const thumbnail = thumbnailName(stored);
    const internalThumbnail = storedKey(route.tier, thumbnail);
    const thumbnailUrl = `${url.origin}${publicPath(route.tier, thumbnail)}`;
    const created = new Date();
    const rendered = renderMarkdown(
      source,
      stored,
      metadata,
      thumbnailUrl,
      createdDate(created),
      expirationDate(created, route.tier),
      { screenshot: true }
    );
    const screenshot = await env.BROWSER.quickAction("screenshot", {
      html: rendered,
      viewport: { width: 1200, height: 630 },
      waitForTimeout: 500,
      rejectRequestPattern: [".*"],
      screenshotOptions: { type: "png", encoding: "binary", fullPage: false }
    });
    if (!screenshot.ok) return text("thumbnail generation failed", 502);

    const image = await screenshot.arrayBuffer();
    await Promise.all([
      env.BUCKET.put(internal, source, {
        httpMetadata: { contentType: MARKDOWN_TYPE, cacheControl: CACHE_CONTROL },
        customMetadata: { ...metadata, thumbnail }
      }),
      env.BUCKET.put(internalThumbnail, image, {
        httpMetadata: { contentType: "image/png", cacheControl: CACHE_CONTROL }
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
  if (!isAuthorized(request.headers.get("authorization"), parseKeys(env.PUBLISH_KEYS))) {
    return text("unauthorized", 401);
  }

  const keys = route.key.endsWith(".md") ? [route.key, thumbnailName(route.key)] : [route.key];
  const internalKeys = keys.map((key) => storedKey(route.tier, key));
  const legacyKeys = route.tier === DEFAULT_TIER ? keys : [];
  await Promise.all([...internalKeys, ...legacyKeys].map((key) => env.BUCKET.delete(key)));
  await Promise.all(keys.map((key) => {
    const url = new URL(request.url);
    url.pathname = publicPath(route.tier, key);
    return caches.default.delete(cacheKeyFor(url.toString()));
  }));
  return new Response(JSON.stringify({ key: route.key, deleted: true }) + "\n", {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

// Temporary authenticated migration for objects published before retention
// prefixes existed. It deliberately returns counts rather than object names so
// it cannot become a report listing endpoint. Remove after migration succeeds.
async function handleMigration(request: Request, env: Env): Promise<Response> {
  if (!isAuthorized(request.headers.get("authorization"), parseKeys(env.PUBLISH_KEYS))) {
    return text("unauthorized", 401);
  }

  const cursor = new URL(request.url).searchParams.get("cursor") ?? undefined;
  const page = await env.BUCKET.list({ delimiter: "/", cursor, limit: 100 });
  let migrated = 0;
  for (const listed of page.objects) {
    if (!isValidKey(listed.key)) continue;
    const object = await env.BUCKET.get(listed.key);
    if (!object) continue;
    await env.BUCKET.put(storedKey(DEFAULT_TIER, listed.key), object.body, {
      httpMetadata: object.httpMetadata,
      customMetadata: object.customMetadata
    });
    await env.BUCKET.delete(listed.key);
    migrated += 1;
  }

  return new Response(JSON.stringify({
    migrated,
    done: !page.truncated,
    ...(page.truncated ? { cursor: page.cursor } : {})
  }) + "\n", {
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

    if (url.pathname === "/_migrate-retention-prefixes") {
      return request.method === "POST"
        ? handleMigration(request, env)
        : text("method not allowed", 405);
    }

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
        .filter((tier) => tier !== DEFAULT_TIER)
        .map((tier) => `/${tier}/<name>`)
        .join(", ");
      return route
        ? handlePublish(request, env, route)
        : text(`invalid path: publish to /<name> (${DEFAULT_TIER} default) or ${tiers}`, 400);
    }
    return text("method not allowed", 405);
  }
} satisfies ExportedHandler<Env>;
