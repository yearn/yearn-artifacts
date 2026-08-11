import MarkdownIt from "markdown-it";
import { BASE_STYLE, FONT_LINKS, footerNav, themeBootScript, themeToggleScript } from "./theme";

// html: false escapes raw HTML in the source. Reports quote dependency names,
// finding titles, and code from repositories we do not control, so the
// markdown is treated as untrusted input.
const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false
});

const REPORT_STYLE = `
main { line-height: 1.7; font-size: 1rem; }
h1, h2, h3, h4 { line-height: 1.3; margin: 2rem 0 1rem; font-weight: 700; }
h1 { font-size: 1.875rem; margin-top: 0; }
h2 { font-size: 1.375rem; }
h3 { font-size: 1.125rem; }
p, ul, ol, blockquote, table { margin: 0 0 1rem; }
code, pre { font-size: 0.875rem; }
code { background: var(--surface); border-radius: 0.25rem; padding: 0.125rem 0.375rem; }
pre { background: var(--surface); border-radius: 0.5rem; padding: 1rem; overflow-x: auto; }
pre code { background: none; padding: 0; }
blockquote { border-left: 2px solid var(--border); margin-left: 0; padding-left: 1rem; color: var(--fg-muted); }
table { border-collapse: collapse; width: 100%; display: block; overflow-x: auto; }
th, td { border: 1px solid var(--border); padding: 0.5rem 0.75rem; text-align: left; }
th { background: var(--surface); font-weight: 700; }
hr { border: 0; border-top: 1px solid var(--border); margin: 2rem 0; }
img { max-width: 100%; height: auto; }
.footer-info { text-align: right; }
.footer-info div + div { margin-top: 0.25rem; }
`;

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export type LayoutOptions = {
  header?: string;
  // Extra CSS appended after the shared base/report styles, for callers that need page-specific
  // rules (e.g. the landing page's step list).
  extraStyle?: string;
  // Set only for the OG-thumbnail screenshot pass: the theme is hardcoded (no boot script needed,
  // and headless rendering has no real localStorage/media-query state worth reading), and the
  // theme-toggle control is left out of the capture.
  screenshot?: boolean;
};

export function layout(
  title: string,
  body: string,
  footer = "",
  ogImage = "",
  opts: LayoutOptions = {}
): string {
  const social = ogImage
    ? `<meta property="og:image" content="${escapeHtml(ogImage)}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${escapeHtml(ogImage)}">`
    : "";
  const htmlClass = opts.screenshot ? ' class="dark"' : "";
  // The boot script runs in <head>, before first paint, so the page never flashes the wrong
  // theme. The toggle script runs at the end of <body>, since it needs the footer button to
  // exist first. Screenshots skip both: the theme is hardcoded via htmlClass instead.
  const bootScript = opts.screenshot ? "" : themeBootScript();
  const toggleScript = opts.screenshot ? "" : themeToggleScript();
  return `<!DOCTYPE html>
<html lang="en"${htmlClass}>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)}</title>
<link rel="icon" href="https://yearn.fi/favicon.ico">
${social}
${FONT_LINKS}
<style>${BASE_STYLE}${opts.extraStyle ?? ""}</style>
${bootScript}
</head>
<body>
<div class="page">
${opts.header ? `<header class="page-header">${opts.header}</header>` : ""}
<main>
${body}
</main>
${footer ? `<footer class="page-footer">${footer}</footer>` : ""}
</div>
${toggleScript}
</body>
</html>`;
}

// A stored name is random, so it tells a reader nothing. Show whatever
// provenance the publisher supplied instead, falling back to the name.
export function provenanceLine(key: string, metadata: Record<string, string> = {}): string {
  const parts = [metadata.repository, metadata.scanner, metadata.ref, metadata.commit]
    .filter(Boolean)
    .map((part) => escapeHtml(part as string));
  return parts.length ? parts.join(" &middot; ") : escapeHtml(key);
}

export function reportFooter(
  key: string,
  metadata: Record<string, string> = {},
  created = "",
  expires = ""
): string {
  return `<div>Provenance: ${provenanceLine(key, metadata)}</div>
<div>Created: ${escapeHtml(created)}</div>
<div>Expires: ${escapeHtml(expires)}</div>`;
}

// A report's own first heading names it better than the posted file name does.
export function headingOf(source: string): string {
  const match = /^[ \t]{0,3}#{1,2}[ \t]+(.+?)[ \t]*#*[ \t]*$/m.exec(source);
  return match ? match[1].trim() : "";
}

export function pageTitle(
  source: string,
  key: string,
  metadata: Record<string, string> = {}
): string {
  const heading = headingOf(source);
  const scope = metadata.repository || metadata.scanner;
  if (heading && scope) return `${heading} · ${scope}`;
  return heading || scope || metadata.name || key;
}

const FOOTER_LINKS = [
  { href: "https://github.com/yearn/yearn-artifacts", label: "github" },
  { href: "https://yearn.fi", label: "yearn.fi" }
];

export function renderMarkdown(
  source: string,
  key: string,
  metadata: Record<string, string> = {},
  ogImage = "",
  created = "",
  expires = "",
  opts: { screenshot?: boolean } = {}
): string {
  // No Yearn logo here (see AGENTS.md): report content is untrusted, and this page is rendered
  // for third parties who followed a report link, not for Yearn-branded navigation.
  const footerInfo = `<div class="footer-info">${reportFooter(key, metadata, created, expires)}</div>`;
  const footer = opts.screenshot ? footerInfo : `${footerNav(FOOTER_LINKS)}${footerInfo}`;
  return layout(
    pageTitle(source, key, metadata),
    markdown.render(source),
    footer,
    ogImage,
    { ...opts, extraStyle: REPORT_STYLE }
  );
}
