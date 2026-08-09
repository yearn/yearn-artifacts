import MarkdownIt from "markdown-it";

// html: false escapes raw HTML in the source. Reports quote dependency names,
// finding titles, and code from repositories we do not control, so the
// markdown is treated as untrusted input.
const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false
});

const STYLE = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: #09090b;
    color: #e4e4e7;
    font: 16px/1.7 Inter, ui-sans-serif, system-ui, sans-serif;
  }
  main { max-width: 48rem; margin: 0 auto; padding: 4rem 1.5rem; }
  h1, h2, h3, h4 { line-height: 1.3; margin: 2rem 0 1rem; font-weight: 600; }
  h1 { font-size: 1.875rem; margin-top: 0; }
  h2 { font-size: 1.375rem; }
  h3 { font-size: 1.125rem; }
  p, ul, ol, blockquote, table { margin: 0 0 1rem; }
  a { color: #93c5fd; text-decoration: none; }
  a:hover { text-decoration: underline; }
  code, pre {
    font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, monospace;
    font-size: 0.875rem;
  }
  code { background: #18181b; border-radius: 0.25rem; padding: 0.125rem 0.375rem; }
  pre {
    background: #18181b;
    border-radius: 0.5rem;
    padding: 1rem;
    overflow-x: auto;
  }
  pre code { background: none; padding: 0; }
  blockquote {
    border-left: 2px solid #3f3f46;
    margin-left: 0;
    padding-left: 1rem;
    color: #a1a1aa;
  }
  table { border-collapse: collapse; width: 100%; display: block; overflow-x: auto; }
  th, td { border: 1px solid #27272a; padding: 0.5rem 0.75rem; text-align: left; }
  th { background: #18181b; font-weight: 600; }
  hr { border: 0; border-top: 1px solid #27272a; margin: 2rem 0; }
  img { max-width: 100%; height: auto; }
  footer {
    margin-top: 3rem;
    padding-top: 1.5rem;
    border-top: 1px solid #27272a;
    color: #71717a;
    font-size: 0.875rem;
  }
`;

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function layout(title: string, body: string, footer = "", ogImage = ""): string {
  const social = ogImage
    ? `<meta property="og:image" content="${escapeHtml(ogImage)}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${escapeHtml(ogImage)}">`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)}</title>
${social}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono&display=swap">
<style>${STYLE}</style>
</head>
<body>
<main>
${body}
${footer ? `<footer>${footer}</footer>` : ""}
</main>
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

export function renderMarkdown(
  source: string,
  key: string,
  metadata: Record<string, string> = {},
  ogImage = ""
): string {
  return layout(
    pageTitle(source, key, metadata),
    markdown.render(source),
    provenanceLine(key, metadata),
    ogImage
  );
}
