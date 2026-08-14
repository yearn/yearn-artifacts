import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

// caches.default and R2 are ambient in the Workers runtime. Stub them before
// importing the handler so the routing logic can be exercised under node.
const cacheStore = new Map<string, Response>();
(globalThis as Record<string, unknown>).caches = {
  default: {
    async match(request: Request) {
      const hit = cacheStore.get(request.url);
      return hit ? hit.clone() : undefined;
    },
    async put(request: Request, response: Response) {
      cacheStore.set(request.url, response.clone());
    },
    async delete(request: Request) {
      return cacheStore.delete(request.url);
    }
  }
};

type Stored = { body: string; options?: unknown };

function browser(response = new Response(new Uint8Array([137, 80, 78, 71]), {
  status: 200,
  headers: { "content-type": "image/png" }
})) {
  const calls: Array<{ action: string; options: Record<string, unknown> }> = [];
  return {
    calls,
    async quickAction(action: string, options: Record<string, unknown>) {
      calls.push({ action, options });
      return response.clone();
    }
  };
}

function bucket(
  objects: Record<string, string> = {},
  metadata: Record<string, Record<string, string>> = {}
) {
  const puts: Record<string, Stored> = {};
  const deletes: string[] = [];
  return {
    puts,
    deletes,
    async get(key: string) {
      if (!(key in objects)) return null;
      const body = objects[key];
      return {
        httpEtag: `"${key}"`,
        body,
        uploaded: new Date("2026-08-09T12:00:00Z"),
        customMetadata: metadata[key],
        async text() {
          return body;
        }
      };
    },
    async put(key: string, body: unknown, options: unknown) {
      const text = body instanceof ReadableStream
        ? await new Response(body).text()
        : String(body);
      puts[key] = { body: text, options };
    },
    async delete(key: string) {
      deletes.push(key);
      delete objects[key];
    },
    async list(options: { cursor?: string; delimiter?: string; limit?: number } = {}) {
      const rootObjects = Object.keys(objects)
        .filter((key) => !options.delimiter || !key.includes(options.delimiter))
        .map((key) => ({ key }));
      return { objects: rootObjects, truncated: false };
    }
  };
}

const ctx = { waitUntil() {}, passThroughOnException() {} };

let worker: {
  fetch(request: Request, env: unknown, ctx: unknown): Promise<Response>;
};
let isValidKey: (key: string) => boolean;
let keyFromPathname: (pathname: string) => string;
let contentTypeForName: (name: string) => string;
let randomName: (extension: string) => string;
let extensionOf: (name: string) => string;
let metadataFromHeaders: (headers: Headers, originalName: string) => Record<string, string>;
let cacheKeyFor: (url: string) => Request;
let createdDate: (uploaded: Date) => string;
let expirationDate: (
  uploaded: Date,
  tier?: "1d" | "7d" | "30d" | "90d" | "1y" | "archive"
) => string;
let reportRoute: (pathname: string) => { tier: string; key: string } | null;
let storedKey: (tier: "1d" | "7d" | "30d" | "90d" | "1y" | "archive", key: string) => string;

before(async () => {
  const module = await import("../src/index.ts");
  worker = module.default;
  isValidKey = module.isValidKey;
  keyFromPathname = module.keyFromPathname;
  contentTypeForName = module.contentTypeForName;
  randomName = module.randomName;
  extensionOf = module.extensionOf;
  metadataFromHeaders = module.metadataFromHeaders;
  cacheKeyFor = module.cacheKeyFor;
  createdDate = module.createdDate;
  expirationDate = module.expirationDate;
  reportRoute = module.reportRoute;
  storedKey = module.storedKey;
});

describe("report expiration", () => {
  it("formats the upload date plus 30 days", () => {
    assert.equal(createdDate(new Date("2026-08-09T12:00:00Z")), "2026-08-09");
    assert.equal(expirationDate(new Date("2026-08-09T12:00:00Z")), "2026-09-08");
  });

  it("formats each tier and leaves archive reports without an expiry", () => {
    const uploaded = new Date("2026-08-09T12:00:00Z");
    assert.equal(expirationDate(uploaded, "1d"), "2026-08-10");
    assert.equal(expirationDate(uploaded, "7d"), "2026-08-16");
    assert.equal(expirationDate(uploaded, "90d"), "2026-11-07");
    assert.equal(expirationDate(uploaded, "1y"), "2027-08-09");
    assert.equal(expirationDate(uploaded, "archive"), "Never");
  });
});

describe("cache key", () => {
  // Report bytes are immutable but the template is not, so a cached entry has
  // to be scoped to the rendering that produced it.
  it("is scoped to a render version", () => {
    const key = cacheKeyFor("https://x.test/abc.md");
    assert.match(key.url, /[?&]v=\d+$/);
    assert.equal(key.method, "GET");
  });
});

describe("DELETE /<key>", () => {
  const env = () => ({ BUCKET: bucket({ [KEY]: "# Findings\n" }), PUBLISH_KEYS: "key-one" });

  it("removes the object and its cached copy", async () => {
    const target = env();

    const first = await worker.fetch(new Request(`https://x.test/${KEY}`), target, ctx);
    assert.equal(first.status, 200);

    const response = await worker.fetch(
      new Request(`https://x.test/${KEY}`, {
        method: "DELETE",
        headers: { authorization: "Bearer key-one" }
      }),
      target,
      ctx
    );
    assert.equal(response.status, 200);
    assert.deepEqual(target.BUCKET.deletes, [
      `30d/${KEY}`,
      "30d/0123456789abcdef0123456789abcdef.png",
      KEY,
      "0123456789abcdef0123456789abcdef.png"
    ]);

    const after = await worker.fetch(new Request(`https://x.test/${KEY}`), target, ctx);
    assert.equal(after.status, 404);
  });

  it("rejects an unauthorized delete without touching the bucket", async () => {
    const target = env();
    const response = await worker.fetch(
      new Request(`https://x.test/${KEY}`, { method: "DELETE" }),
      target,
      ctx
    );
    assert.equal(response.status, 401);
    assert.deepEqual(target.BUCKET.deletes, []);
  });
});

describe("provenance metadata", () => {
  it("collects the report headers and keeps the posted name", () => {
    const headers = new Headers({
      "x-report-repository": "yearn/section9",
      "x-report-scanner": "socket",
      "x-report-ref": "main",
      "x-report-commit": "a1b2c3d"
    });
    assert.deepEqual(metadataFromHeaders(headers, "REPORT.md"), {
      repository: "yearn/section9",
      scanner: "socket",
      ref: "main",
      commit: "a1b2c3d",
      name: "REPORT.md"
    });
  });

  it("omits absent fields and ignores unknown headers", () => {
    const headers = new Headers({ "x-report-scanner": "glasswing", "x-report-secret": "nope" });
    assert.deepEqual(metadataFromHeaders(headers, "R.md"), { scanner: "glasswing", name: "R.md" });
  });

  it("truncates an oversized value", () => {
    const headers = new Headers({ "x-report-commit": "c".repeat(900) });
    assert.equal(metadataFromHeaders(headers, "R.md").commit.length, 512);
  });
});

describe("unguessable report names", () => {
  it("produces 128 bits of hex plus the extension", () => {
    assert.match(randomName("md"), /^[0-9a-f]{32}\.md$/);
    assert.notEqual(randomName("md"), randomName("md"));
  });

  it("reads the extension off the posted name", () => {
    assert.equal(extensionOf("REPORT.md"), "md");
    assert.equal(extensionOf("scan.SARIF"), "sarif");
    assert.equal(extensionOf("noextension"), "bin");
  });
});

const KEY = "0123456789abcdef0123456789abcdef.md";
const POST_NAME = "REPORT.md";

describe("key handling", () => {
  it("strips leading slashes and decodes", () => {
    assert.equal(keyFromPathname("/a%20b.md"), "a b.md");
  });

  it("accepts only a random name with an extension", () => {
    assert.equal(isValidKey("0123456789abcdef0123456789abcdef.md"), true);
    assert.equal(isValidKey("REPORT.md"), false);
    assert.equal(isValidKey("reports/a/b.md"), false);
    assert.equal(isValidKey("0123456789abcdef0123456789abcdef"), false);
    assert.equal(isValidKey(""), false);
  });

  it("maps extensions to content types", () => {
    assert.equal(contentTypeForName("a.md"), "text/markdown; charset=utf-8");
    assert.equal(contentTypeForName("a.sarif"), "application/sarif+json");
    assert.equal(contentTypeForName("a.bin"), "application/octet-stream");
  });

  it("maps root paths to 30 days and recognizes explicit tiers", () => {
    assert.deepEqual(reportRoute(`/${KEY}`), { tier: "30d", key: KEY });
    assert.deepEqual(reportRoute(`/7d/${KEY}`), { tier: "7d", key: KEY });
    assert.deepEqual(reportRoute(`/archive/${KEY}`), { tier: "archive", key: KEY });
    assert.equal(reportRoute(`/30d/${KEY}`), null);
    assert.equal(reportRoute(`/unknown/${KEY}`), null);
    assert.equal(reportRoute(`/7d/nested/${KEY}`), null);
    assert.equal(storedKey("30d", KEY), `30d/${KEY}`);
  });
});

describe("GET /", () => {
  it("serves the landing page", async () => {
    const response = await worker.fetch(new Request("https://x.test/"), { BUCKET: bucket() }, ctx);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Yearn Artifacts/);
  });

  it("rejects non-GET at the root", async () => {
    const response = await worker.fetch(
      new Request("https://x.test/", { method: "POST" }),
      { BUCKET: bucket() },
      ctx
    );
    assert.equal(response.status, 405);
  });
});

describe("POST /_migrate-retention-prefixes", () => {
  it("moves legacy root reports without exposing their names", async () => {
    const target = {
      BUCKET: bucket({ [KEY]: "# Findings\n" }),
      PUBLISH_KEYS: "key-one"
    };
    const response = await worker.fetch(
      new Request("https://x.test/_migrate-retention-prefixes", {
        method: "POST",
        headers: { authorization: "Bearer key-one" }
      }),
      target,
      ctx
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { migrated: 1, done: true });
    assert.equal(target.BUCKET.puts[`30d/${KEY}`].body, "# Findings\n");
    assert.deepEqual(target.BUCKET.deletes, [KEY]);
  });

  it("requires publisher authentication", async () => {
    const target = { BUCKET: bucket({ [KEY]: "# Findings\n" }), PUBLISH_KEYS: "key-one" };
    const response = await worker.fetch(
      new Request("https://x.test/_migrate-retention-prefixes", { method: "POST" }),
      target,
      ctx
    );
    assert.equal(response.status, 401);
    assert.deepEqual(target.BUCKET.puts, {});
    assert.deepEqual(target.BUCKET.deletes, []);
  });
});

describe("GET /<key>", () => {
  it("shows provenance in the footer instead of the random name", async () => {
    const response = await worker.fetch(
      new Request(`https://x.test/${KEY}`),
      {
        BUCKET: bucket(
          { [KEY]: "# Findings\n" },
          { [KEY]: { repository: "yearn/section9", scanner: "socket", commit: "a1b2c3d" } }
        )
      },
      ctx
    );
    const page = await response.text();
    assert.match(page, /yearn\/section9/);
    assert.match(page, /socket/);
    assert.match(page, /a1b2c3d/);
  });

  it("renders stored markdown", async () => {
    cacheStore.clear();
    const response = await worker.fetch(
      new Request(`https://x.test/${KEY}`),
      { BUCKET: bucket({ [KEY]: "# Findings\n" }) },
      ctx
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "public, max-age=86400");
    assert.equal(response.headers.get("x-robots-tag"), "noindex");
    const page = await response.text();
    assert.match(page, /<h1>Findings<\/h1>/);
    assert.match(page, /Provenance: 0123456789abcdef0123456789abcdef\.md/);
    assert.match(page, /Created: 2026-08-09/);
    assert.match(page, /Expires: 2026-09-08/);
  });

  it("links the stored thumbnail in social metadata", async () => {
    cacheStore.clear();
    const thumbnail = "0123456789abcdef0123456789abcdef.png";
    const response = await worker.fetch(
      new Request(`https://x.test/${KEY}`),
      { BUCKET: bucket({ [KEY]: "# Findings\n" }, { [KEY]: { thumbnail } }) },
      ctx
    );
    assert.match(
      await response.text(),
      /property="og:image" content="https:\/\/x\.test\/0123456789abcdef0123456789abcdef\.png"/
    );
  });

  it("serves non-markdown as stored bytes", async () => {
    const key = "0123456789abcdef0123456789abcdef.json";
    const response = await worker.fetch(
      new Request(`https://x.test/${key}`),
      { BUCKET: bucket({ [key]: '{"ok":true}' }) },
      ctx
    );
    assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  });

  it("serves HEAD like GET so link checks and monitors work", async () => {
    const response = await worker.fetch(
      new Request(`https://x.test/${KEY}`, { method: "HEAD" }),
      { BUCKET: bucket({ [KEY]: "# Findings\n" }) },
      ctx
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "public, max-age=86400");
  });

  it("404s on a missing object", async () => {
    const response = await worker.fetch(
      new Request("https://x.test/ffffffffffffffffffffffffffffffff.md"),
      { BUCKET: bucket() },
      ctx
    );
    assert.equal(response.status, 404);
  });

  it("400s on a key that is not a stored report name", async () => {
    const response = await worker.fetch(
      new Request("https://x.test/reports/a/b.md"),
      { BUCKET: bucket() },
      ctx
    );
    assert.equal(response.status, 400);
  });
});

describe("POST /<key>", () => {
  const env = () => ({
    BUCKET: bucket(),
    BROWSER: browser(),
    PUBLISH_KEYS: "key-one,key-two"
  });

  it("stores the body under a random name and returns its URL", async () => {
    const target = env();
    const response = await worker.fetch(
      new Request(`https://x.test/${POST_NAME}`, {
        method: "POST",
        headers: { authorization: "Bearer key-one" },
        body: "# Findings\n"
      }),
      target,
      ctx
    );

    assert.equal(response.status, 201);
    const body = (await response.json()) as { key: string; url: string };

    // The posted name is public information, so it must not become the key.
    assert.match(body.key, /^[0-9a-f]{32}\.md$/);
    assert.equal(body.url, `https://x.test/${body.key}`);
    assert.equal(target.BUCKET.puts[`30d/${body.key}`].body, "# Findings\n");
    const thumbnail = `${body.key.slice(0, 32)}.png`;
    assert.equal(`30d/${thumbnail}` in target.BUCKET.puts, true);
    assert.equal(POST_NAME in target.BUCKET.puts, false);

    assert.equal(target.BROWSER.calls.length, 1);
    assert.equal(target.BROWSER.calls[0].action, "screenshot");
    assert.deepEqual(target.BROWSER.calls[0].options.viewport, { width: 1200, height: 630 });
    assert.deepEqual(target.BROWSER.calls[0].options.rejectRequestPattern, [".*"]);
    assert.match(
      target.BROWSER.calls[0].options.html as string,
      new RegExp(`property="og:image" content="https://x\\.test/${thumbnail}"`)
    );
  });

  it("stores provenance headers as object metadata", async () => {
    const target = env();
    const response = await worker.fetch(
      new Request(`https://x.test/${POST_NAME}`, {
        method: "POST",
        headers: {
          authorization: "Bearer key-one",
          "x-report-repository": "yearn/section9",
          "x-report-commit": "a1b2c3d"
        },
        body: "x"
      }),
      target,
      ctx
    );
    const { key } = (await response.json()) as { key: string };
    const options = target.BUCKET.puts[`30d/${key}`].options as {
      customMetadata: Record<string, string>
    };
    assert.deepEqual(options.customMetadata, {
      repository: "yearn/section9",
      commit: "a1b2c3d",
      name: POST_NAME,
      thumbnail: `${key.slice(0, 32)}.png`
    });
  });

  it("gives two publishes of the same name different keys", async () => {
    const publish = async () => {
      const target = env();
      const response = await worker.fetch(
        new Request(`https://x.test/${POST_NAME}`, {
          method: "POST",
          headers: { authorization: "Bearer key-one" },
          body: "x"
        }),
        target,
        ctx
      );
      return ((await response.json()) as { key: string }).key;
    };
    assert.notEqual(await publish(), await publish());
  });

  it("rejects a missing or wrong key without writing", async () => {
    const cases: Record<string, string>[] = [{}, { authorization: "Bearer nope" }];
    for (const headers of cases) {
      const target = env();
      const response = await worker.fetch(
        new Request(`https://x.test/${POST_NAME}`, { method: "POST", headers, body: "x" }),
        target,
        ctx
      );
      assert.equal(response.status, 401);
      assert.deepEqual(target.BUCKET.puts, {});
    }
  });

  it("rejects every publish when no keys are configured", async () => {
    const response = await worker.fetch(
      new Request(`https://x.test/${POST_NAME}`, {
        method: "POST",
        headers: { authorization: "Bearer key-one" },
        body: "x"
      }),
      { BUCKET: bucket() },
      ctx
    );
    assert.equal(response.status, 401);
  });

  it("does not publish when thumbnail generation fails", async () => {
    const target = {
      BUCKET: bucket(),
      BROWSER: browser(new Response("unavailable", { status: 503 })),
      PUBLISH_KEYS: "key-one"
    };
    const response = await worker.fetch(
      new Request(`https://x.test/${POST_NAME}`, {
        method: "POST",
        headers: { authorization: "Bearer key-one" },
        body: "# Findings\n"
      }),
      target,
      ctx
    );
    assert.equal(response.status, 502);
    assert.deepEqual(target.BUCKET.puts, {});
  });

  it("does not invoke the browser for non-markdown files", async () => {
    const target = env();
    const response = await worker.fetch(
      new Request("https://x.test/report.json", {
        method: "POST",
        headers: { authorization: "Bearer key-one" },
        body: '{"ok":true}'
      }),
      target,
      ctx
    );
    assert.equal(response.status, 201);
    assert.equal(target.BROWSER.calls.length, 0);
  });

  it("publishes, reads, and deletes an explicit retention tier", async () => {
    const target = env();
    const published = await worker.fetch(
      new Request("https://x.test/7d/REPORT.md", {
        method: "POST",
        headers: { authorization: "Bearer key-one" },
        body: "# Findings\n"
      }),
      target,
      ctx
    );
    const body = (await published.json()) as { key: string; url: string };
    assert.equal(body.url, `https://x.test/7d/${body.key}`);
    assert.equal(`7d/${body.key}` in target.BUCKET.puts, true);

    const objects = Object.fromEntries(
      Object.entries(target.BUCKET.puts).map(([key, value]) => [key, value.body])
    );
    const readable = { ...target, BUCKET: bucket(objects) };
    cacheStore.clear();
    const read = await worker.fetch(new Request(body.url), readable, ctx);
    assert.match(await read.text(), /Expires: 2026-08-16/);

    const removed = await worker.fetch(
      new Request(body.url, {
        method: "DELETE",
        headers: { authorization: "Bearer key-one" }
      }),
      readable,
      ctx
    );
    assert.equal(removed.status, 200);
    assert.deepEqual(readable.BUCKET.deletes, [
      `7d/${body.key}`,
      `7d/${body.key.slice(0, 32)}.png`
    ]);
  });

  it("renders archive reports without an expiration date", async () => {
    cacheStore.clear();
    const response = await worker.fetch(
      new Request(`https://x.test/archive/${KEY}`),
      { BUCKET: bucket({ [`archive/${KEY}`]: "# Findings\n" }) },
      ctx
    );
    assert.match(await response.text(), /Expires: Never/);
  });

  it("rejects unknown and nested retention paths", async () => {
    for (const path of [`unknown/${POST_NAME}`, `7d/nested/${POST_NAME}`]) {
      const target = env();
      const response = await worker.fetch(
        new Request(`https://x.test/${path}`, {
          method: "POST",
          headers: { authorization: "Bearer key-one" },
          body: "x"
        }),
        target,
        ctx
      );
      assert.equal(response.status, 400);
      assert.deepEqual(target.BUCKET.puts, {});
    }
  });
});
