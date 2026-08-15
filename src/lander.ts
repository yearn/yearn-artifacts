import { escapeHtml, layout } from "./render";
import { YEARN_SYMBOL, footerNav } from "./theme";

const REPO_URL = "https://github.com/yearn/yearn-artifacts";

const LANDING_STYLE = `
.hero h1 { display: flex; align-items: center; gap: 0.75rem; font-size: 1.875rem; font-weight: 700; margin: 0; }
.logo { width: 2rem; height: auto; }
.hero p { color: var(--fg-muted); margin: 0.75rem 0 0; max-width: 34rem; }
h2 { font-size: 1.25rem; font-weight: 700; margin: 2.5rem 0 1rem; }
p { margin: 0 0 1rem; line-height: 1.6; }
.steps { margin: 0 0 1rem; padding-left: 1.25rem; line-height: 1.7; }
.steps strong { font-weight: 700; }
pre { font-size: 0.8125rem; line-height: 1.6; background: var(--surface); border-radius: 0.5rem; padding: 1rem; overflow-x: auto; margin: 0 0 1rem; }
code { font-size: 0.8125rem; background: var(--surface); border-radius: 0.25rem; padding: 0.125rem 0.375rem; }
pre code { background: none; padding: 0; }
.code-wrap { position: relative; }
.copy-btn {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  padding: 0.25rem 0.5rem;
  font: inherit;
  font-size: 0.75rem;
  background: var(--border);
  color: var(--fg-muted);
  border: 0;
  border-radius: 0.25rem;
  cursor: pointer;
}
.copy-btn:hover { color: var(--fg); }
.endpoints, .tiers { font-size: 0.8125rem; }
`;

function codeBlock(id: string, content: string): string {
  return `<div class="code-wrap">
<pre id="${id}">${escapeHtml(content)}</pre>
<button
  type="button"
  class="copy-btn"
  onclick="navigator.clipboard.writeText(document.getElementById('${id}').textContent).then(() => { this.textContent = 'Copied'; setTimeout(() => this.textContent = 'Copy', 1500) })"
>Copy</button>
</div>`;
}

function step(title: string, description: string): string {
  return `<li><strong>${title}</strong> — ${description}</li>`;
}

const FOOTER_LINKS = [
  { href: REPO_URL, label: "github" },
  { href: "https://yearn.fi", label: "yearn.fi" }
];

export function renderLandingPage(baseUrl: string): string {
  const key = "9f2c41d7ab3e5806d1f4c92b7e0a5643.md";

  const header = `<div class="hero">
<h1>${YEARN_SYMBOL}Yearn Artifacts</h1>
<p>Publishes private reports as URLs. Markdown becomes a styled page with an
automatically generated social preview; everything else is served as-is.</p>
</div>`;

  const body = `
<h2>How it works</h2>
<ul class="steps">
${step("Publish", "a publisher POSTs a file with a bearer key")}
${step("Store", "the report is saved under a random 32-character name")}
${step("Render", "Markdown is rendered to HTML and cached on read")}
${step("Expire", "reports are deleted automatically after 30 days")}
</ul>

<h2>Endpoints</h2>
<pre class="endpoints">GET    /&lt;name&gt;             read a report
POST   /&lt;anything&gt;.&lt;ext&gt;   publish a report (requires a key)
DELETE /&lt;name&gt;             unpublish a report (requires a key)</pre>

<h2>Retention</h2>
<p>Reports expire after 30 days by default. Put a retention tier before the
name to choose a different lifetime:</p>
<pre class="tiers">/1d/&lt;name&gt;        1 day
/7d/&lt;name&gt;        7 days
/&lt;name&gt;           30 days (default)
/90d/&lt;name&gt;       90 days
/1y/&lt;name&gt;        1 year
/archive/&lt;name&gt;   no automatic expiration</pre>
<p>Archive reports remain removable through the authenticated DELETE endpoint.</p>

<h2>Publish</h2>
<p>Post to any single-segment name, optionally preceded by one of the retention
tiers above. Only the extension is read, and it decides how the report is served
back; any other path shape is rejected with a 400.</p>
${codeBlock("publish", `curl -X POST ${baseUrl}/REPORT.md \\
  -H "Authorization: Bearer $ARTIFACTS_API_KEY" \\
  -H "Content-Type: text/markdown" \\
  -H "X-Report-Repository: yearn/section9" \\
  -H "X-Report-Scanner: socket" \\
  -H "X-Report-Ref: main" \\
  -H "X-Report-Commit: $GITHUB_SHA" \\
  -H "X-Report-Confidential: true" \\
  --data-binary @REPORT.md`)}
<p>The optional <code>X-Report-*</code> headers are stored as object metadata and
shown at the foot of the rendered report.</p>
<p>Set <code>X-Report-Confidential: true</code> to show a confidentiality notice
on rendered Markdown and its social preview. This is a visual label, not access
control.</p>
<p>The report is stored under a random name, returned in the response. That URL
is the only handle on it, so keep it.</p>
${codeBlock("response", `{"key":"${key}","url":"${baseUrl}/${key}"}`)}
<p>For example, publish a seven-day report at
<code>${baseUrl}/7d/REPORT.md</code>. Its returned read and delete URL will also
start with <code>/7d/</code>.</p>

<h2>Read</h2>
${codeBlock("read", `curl ${baseUrl}/${key}`)}
<p>Or open the same URL in a browser to get the rendered report.</p>

<h2>Unpublish</h2>
${codeBlock("delete", `curl -X DELETE ${baseUrl}/${key} \\
  -H "Authorization: Bearer $ARTIFACTS_API_KEY"`)}
<p>Removes the report and its cached copy, so it stops being served
immediately.</p>
`;

  return layout(
    "Yearn Artifacts",
    body,
    footerNav(FOOTER_LINKS),
    "",
    { header, extraStyle: LANDING_STYLE }
  );
}
