import { escapeHtml, layout } from "./render";

const REPO_URL = "https://github.com/yearn/section9";

function codeBlock(id: string, content: string): string {
  return `<div style="position:relative">
<pre id="${id}">${escapeHtml(content)}</pre>
<button
  onclick="navigator.clipboard.writeText(document.getElementById('${id}').textContent).then(() => { this.textContent = 'Copied'; setTimeout(() => this.textContent = 'Copy', 1500) })"
  style="position:absolute;top:0.5rem;right:0.5rem;padding:0.25rem 0.5rem;font-size:0.75rem;background:#27272a;color:#a1a1aa;border:0;border-radius:0.25rem;cursor:pointer"
>Copy</button>
</div>`;
}

export function renderLandingPage(baseUrl: string): string {
  const key = "9f2c41d7ab3e5806d1f4c92b7e0a5643.md";

  const body = `
<h1>Section9 Artifacts</h1>
<p>Publishes and renders private security scan reports. Markdown is rendered as
HTML with an automatically generated social preview; everything else is served
as-is.</p>

<h2>Endpoints</h2>
<pre>GET    /&lt;name&gt;             read a report
POST   /&lt;anything&gt;.&lt;ext&gt;   publish a report (requires a key)
DELETE /&lt;name&gt;             unpublish a report (requires a key)</pre>

<h2>Publish</h2>
<p>Post to any name. Only the extension is read, and it decides how the report
is served back.</p>
${codeBlock("publish", `curl -X POST ${baseUrl}/REPORT.md \\
  -H "Authorization: Bearer $SECTION9_PUBLISH_KEY" \\
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
  -H "Authorization: Bearer $SECTION9_PUBLISH_KEY"`)}
<p>Removes the report and its cached copy, so it stops being served
immediately.</p>
`;

  return layout(
    "Section9 Artifacts",
    body,
    `<a href="${REPO_URL}">GitHub</a>`
  );
}
