import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderLandingPage } from "../src/lander.ts";
import { escapeHtml, headingOf, pageTitle, renderMarkdown } from "../src/render.ts";

describe("html escaping", () => {
  it("escapes the characters that break out of markup", () => {
    assert.equal(escapeHtml(`<a href="x">&</a>`), "&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
  });
});

describe("markdown rendering", () => {
  it("renders standard markdown structures", () => {
    const page = renderMarkdown("# Title\n\n- one\n- two\n", "reports/x/REPORT.md");
    assert.match(page, /<h1>Title<\/h1>/);
    assert.match(page, /<li>one<\/li>/);
  });

  it("does not pass raw html through from report content", () => {
    const page = renderMarkdown("<script>alert(1)</script>\n", "reports/x/REPORT.md");
    assert.doesNotMatch(page, /<script>alert/);
    assert.match(page, /&lt;script&gt;/);
  });

  it("marks pages noindex and shows the object key", () => {
    const page = renderMarkdown("hi\n", "reports/x/REPORT.md");
    assert.match(page, /name="robots" content="noindex/);
    assert.match(page, /reports\/x\/REPORT\.md/);
  });

  it("shows expiration in the footer", () => {
    const page = renderMarkdown("hi\n", "abc.md", {}, "", "2026-08-09", "2026-09-08");
    assert.match(page, /<div>Provenance: abc\.md<\/div>/);
    assert.match(page, /<div>Created: 2026-08-09<\/div>/);
    assert.match(page, /<div>Expires: 2026-09-08<\/div>/);
  });

  it("shows the confidentiality notice at the head and foot", () => {
    const page = renderMarkdown("hi\n", "abc.md");
    const notices = page.match(/Yearn Confidential &mdash; Do Not Distribute/g);
    assert.equal(notices?.length, 2);
    assert.match(page, /<header class="page-header"><div class="confidentiality-notice"/);
    assert.match(page, /<footer class="page-footer"><div class="confidentiality-notice"/);
  });

  it("escapes a key that contains markup", () => {
    const page = renderMarkdown("hi\n", "reports/<script>/REPORT.md");
    assert.doesNotMatch(page, /<script>\/REPORT/);
  });
});

describe("page title", () => {
  it("reads the first heading", () => {
    assert.equal(headingOf("# Supply Chain Scan\n\nbody\n"), "Supply Chain Scan");
    assert.equal(headingOf("intro\n\n## Findings\n"), "Findings");
    assert.equal(headingOf("no heading here\n"), "");
  });

  it("ignores trailing hashes and indentation", () => {
    assert.equal(headingOf("  # Title #\n"), "Title");
  });

  it("pairs the heading with the repository so tabs stay distinct", () => {
    assert.equal(
      pageTitle("# Findings\n", "abc.md", { repository: "yearn/section9" }),
      "Findings · yearn/section9"
    );
  });

  it("falls back through scope, posted name, then key", () => {
    assert.equal(pageTitle("body\n", "abc.md", { scanner: "socket" }), "socket");
    assert.equal(pageTitle("body\n", "abc.md", { name: "REPORT.md" }), "REPORT.md");
    assert.equal(pageTitle("body\n", "abc.md"), "abc.md");
  });

  it("uses the title in the rendered page", () => {
    const page = renderMarkdown("# Scan Results\n", "abc.md", { repository: "yearn/x" });
    assert.match(page, /<title>Scan Results · yearn\/x<\/title>/);
  });

  it("includes social image metadata when a thumbnail exists", () => {
    const page = renderMarkdown("# Scan Results\n", "abc.md", {}, "https://x.test/abc.png");
    assert.match(page, /property="og:image" content="https:\/\/x\.test\/abc\.png"/);
    assert.match(page, /property="og:image:width" content="1200"/);
    assert.match(page, /property="og:image:height" content="630"/);
    assert.match(page, /name="twitter:card" content="summary_large_image"/);
  });
});

describe("landing page", () => {
  it("builds examples from the request origin", () => {
    const page = renderLandingPage("https://artifacts.example.com");
    assert.match(page, /https:\/\/artifacts\.example\.com\/REPORT\.md/);
    assert.match(page, /Authorization: Bearer/);
  });

  it("documents every endpoint", () => {
    const page = renderLandingPage("https://x.test");
    assert.match(page, /GET {4}\/&lt;name&gt;/);
    assert.match(page, /POST {3}\/&lt;anything&gt;/);
    assert.match(page, /DELETE \/&lt;name&gt;/);
  });

  it("documents retention tiers and archive deletion", () => {
    const page = renderLandingPage("https://x.test");
    assert.match(page, /\/7d\/&lt;name&gt;/);
    assert.match(page, /30 days \(default\)/);
    assert.match(page, /\/archive\/&lt;name&gt;/);
    assert.match(page, /Archive reports remain removable/);
  });
});
