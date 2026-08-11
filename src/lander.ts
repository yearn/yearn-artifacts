import { escapeHtml, layout } from "./render";
import { YEARN_SYMBOL, footerNav } from "./theme";

const REPO_URL = "https://github.com/yearn/yearn-artifacts";

const LANDING_STYLE = `
.hero h1 { display: flex; align-items: center; gap: 0.75rem; font-size: 1.875rem; font-weight: 700; margin: 0; }
.logo { width: 2rem; height: auto; }
.hero p { color: var(--fg-muted); margin: 0.75rem 0 0; max-width: 34rem; }
h2 { font-size: 1.25rem; font-weight: 700; margin: 2.5rem 0 1rem; }
p { margin: 0 0 1rem; line-height: 1.6; }
.steps { display: grid; gap: 1rem; margin: 0 0 1rem; padding: 0; list-style: none; counter-reset: step; }
.steps li {
  counter-increment: step;
  display: flex;
  gap: 1rem;
  padding: 1rem 1.25rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.75rem;
}
.steps li::before {
  content: counter(step);
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 9999px;
  background: var(--border);
  color: var(--fg);
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 0.8125rem;
  font-weight: 700;
}
.steps strong { display: block; margin-bottom: 0.25rem; }
.steps span { color: var(--fg-muted); font-size: 0.9375rem; }
pre { font-size: 0.8125rem; line-height: 1.6; background: var(--surface); border: 1px solid var(--border); border-radius: 0.5rem; padding: 1rem; overflow-x: auto; margin: 0 0 1rem; }
code { font-size: 0.8125rem; background: var(--surface); border: 1px solid var(--border); border-radius: 0.25rem; padding: 0.125rem 0.375rem; }
pre code { background: none; border: 0; padding: 0; }
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
.endpoints { font-size: 0.8125rem; }
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
  return `<li><div><strong>${title}</strong><span>${description}</span></div></li>`;
}

const FOOTER_LINKS = [
  { href: REPO_URL, label: "github" },
  { href: "https://yearn.fi", label: "yearn.fi" }
];

export function renderLandingPage(baseUrl: string): string {
  const key = "9f2c41d7ab3e5806d1f4c92b7e0a5643.md";

  const header = `<div class="hero">
<h1>${YEARN_SYMBOL}Yearn Artifacts</h1>
<p>Publishes and renders private security scan reports. Markdown becomes a
styled page with an automatically generated social preview; everything else
is served as-is.</p>
</div>`;

  const body = `
<h2>How it works</h2>
<ol class="steps">
${step("Publish", "A publisher POSTs a file with a bearer key. Only the file's extension is read — it decides how the report is served back.")}
${step("Store", "The report is saved under a random 32-character name, never the posted one. A derived name would be a guessable URL, so the publish response is the only handle on the report.")}
${step("Render", "Markdown is rendered to HTML on read, and a 1200&times;630 social preview image is generated once, at publish time.")}
${step("Expire", "Reports are deleted automatically 30 days after publish. Nothing here is meant to be a permanent archive.")}
</ol>
<p>Reads are unauthenticated: anyone holding a report URL can open it. There is
no index and no listing, so a report is only reachable by the exact URL a
publish returned. Treat that URL as a secret.</p>

<h2>Endpoints</h2>
<pre class="endpoints">GET    /&lt;name&gt;             read a report
POST   /&lt;anything&gt;.&lt;ext&gt;   publish a report (requires a key)
DELETE /&lt;name&gt;             unpublish a report (requires a key)</pre>

<h2>Publish</h2>
<p>Post to any name. Only the extension is read, and it decides how the report
is served back.</p>
${codeBlock("publish", `curl -X POST ${baseUrl}/REPORT.md \\
  -H "Authorization: Bearer $ARTIFACTS_API_KEY" \\
  -H "Content-Type: text/markdown" \\
  -H "X-Report-Repository: yearn/section9" \\
  -H "X-Report-Scanner: socket" \\
  -H "X-Report-Ref: main" \\
  -H "X-Report-Commit: $GITHUB_SHA" \\
  --data-binary @REPORT.md`)}
<p>The optional <code>X-Report-*</code> headers are stored as object metadata and
shown at the foot of the rendered report.</p>
<p>The report is stored under a random name, returned in the response. That URL
is the only handle on it, so keep it.</p>
${codeBlock("response", `{"key":"${key}","url":"${baseUrl}/${key}"}`)}

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
