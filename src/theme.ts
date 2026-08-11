// Visual language shared with yearn-uptime-kuma-status (monitor.yearn.dev): Aeonik + JetBrains
// Mono, the same oklch light/dark palette, and a device/light/dark toggle — reimplemented as
// self-contained CSS instead of that repo's Tailwind CDN script. The report page in this Worker
// is also rendered headless for its OG thumbnail with every network request blocked
// (BROWSER.quickAction screenshot, rejectRequestPattern: [".*"]), so a runtime CSS framework would
// never produce any styles for that pass. No background texture here, unlike the source page.

export const YEARN_SYMBOL = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 306.8 359.68" class="logo" aria-hidden="true"><path fill="currentColor" d="M288.19,138.27l-46.65,45.56c2.56,8.33,3.89,17.07,3.89,26.01,0,24.01-9.57,46.59-26.96,63.57-17.38,16.98-40.5,26.33-65.08,26.33s-47.7-9.35-65.08-26.33c-17.38-16.98-26.96-39.55-26.96-63.57,0-8.94,1.33-17.68,3.89-26.01l-46.65-45.56C6.74,159.54,0,183.93,0,209.85c0,82.75,68.68,149.83,153.4,149.83s153.4-67.08,153.4-149.83c0-25.92-6.74-50.31-18.6-71.57Z"/><polygon fill="currentColor" points="122.72 239.82 184.08 239.82 184.08 144.46 288.53 42.4 245.13 .02 153.43 89.63 61.66 0 18.27 42.38 122.72 144.4 122.72 239.82"/></svg>`;

const THEME_ICON_ATTRS = `xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="theme-icon"`;
export const ICON_SUN = `<svg ${THEME_ICON_ATTRS}><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>`;
export const ICON_MOON = `<svg ${THEME_ICON_ATTRS}><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>`;
export const ICON_DEVICE = `<svg ${THEME_ICON_ATTRS}><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/></svg>`;

// Applied before first paint so the page never flashes the wrong theme.
export function themeBootScript(): string {
  return `<script>
(function () {
  function apply() {
    var stored = localStorage.getItem("theme");
    var dark = stored === "dark" || (!stored && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
  }
  apply();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", apply);
  window.__applyTheme = apply;
})();
<\/script>`;
}

export function themeToggleScript(): string {
  return `<script>
(function () {
  var ICONS = { light: ${JSON.stringify(ICON_SUN)}, dark: ${JSON.stringify(ICON_MOON)}, device: ${JSON.stringify(ICON_DEVICE)} };
  var btn = document.getElementById("theme-toggle");
  if (!btn) return;
  var icon = document.getElementById("theme-icon");
  var label = document.getElementById("theme-label");
  var inner = document.getElementById("theme-toggle-inner");
  function mode() { return localStorage.getItem("theme") || "device"; }
  function render(animate) {
    var m = mode();
    icon.innerHTML = ICONS[m];
    label.textContent = m;
    if (animate && inner) {
      inner.classList.remove("rise-in");
      void inner.offsetWidth;
      inner.classList.add("rise-in");
    }
  }
  btn.addEventListener("click", function () {
    var order = ["device", "light", "dark"];
    var next = order[(order.indexOf(mode()) + 1) % order.length];
    if (next === "device") localStorage.removeItem("theme"); else localStorage.setItem("theme", next);
    window.__applyTheme();
    render(true);
  });
  render(false);
})();
<\/script>`;
}

function themeToggleButton(): string {
  return `<button id="theme-toggle" type="button" class="theme-toggle" title="Toggle theme" aria-label="Toggle theme"><span id="theme-toggle-inner" class="theme-toggle-inner"><span id="theme-icon" class="theme-icon-wrap">${ICON_DEVICE}</span><span id="theme-label">device</span></span></button>`;
}

export type FooterLink = { href: string; label: string };

// The shared footer shape: theme toggle, then "//"-separated links. No subscribe link and no
// background texture here, unlike yearn-uptime-kuma-status.
export function footerNav(links: FooterLink[]): string {
  const parts = [
    themeToggleButton(),
    ...links.map((link) => `<a href="${link.href}">${escapeAttr(link.label)}</a>`)
  ];
  return `<div class="footer-nav">${parts.join('<span class="sep">//</span>')}</div>`;
}

function escapeAttr(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

// Font declarations for the <head>: Aeonik (Yearn's primary typeface, served by yearn.fi) plus
// JetBrains Mono from Google Fonts, matching yearn-uptime-kuma-status's stack. Both fail closed to
// system fonts when blocked (e.g. during the OG-thumbnail screenshot pass), by design.
export const FONT_LINKS = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap">`;

// Same oklch light/dark backgrounds as yearn-uptime-kuma-status, without its background-texture
// image or the text-shadow that was tuned to sit on top of that texture.
export const BASE_STYLE = `
@font-face {
  font-family: "Aeonik";
  src: url("https://yearn.fi/fonts/Aeonik-Regular.woff2") format("woff2");
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: "Aeonik";
  src: url("https://yearn.fi/fonts/Aeonik-Bold.woff2") format("woff2");
  font-weight: 700;
  font-style: normal;
  font-display: swap;
}
:root {
  color-scheme: light;
  --bg: oklch(96% 0 0);
  --fg: #18181b;
  --fg-muted: #52525b;
  --fg-faint: #71717a;
  --border: #e4e4e7;
  --surface: #f4f4f5;
  --link: #2563eb;
  --link-hover: #1d4ed8;
}
:root.dark {
  color-scheme: dark;
  --bg: oklch(12% 0 0);
  --fg: #f4f4f5;
  --fg-muted: #a1a1aa;
  --fg-faint: #71717a;
  --border: #27272a;
  --surface: #18181b;
  --link: #93c5fd;
  --link-hover: #bfdbfe;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font-family: "Aeonik", Helvetica, Arial, system-ui, sans-serif;
}
a { color: var(--link); text-decoration: none; }
a:hover { color: var(--link-hover); text-decoration: underline; }
code, pre {
  font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, monospace;
}
.page { max-width: 48rem; margin: 0 auto; padding: 3rem 1.5rem 4rem; }
.page-header { margin-bottom: 2.5rem; }
.page-footer {
  margin-top: 3rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--border);
  color: var(--fg-faint);
  font-size: 0.875rem;
  display: flex;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 1rem;
}
.theme-toggle {
  display: inline-flex;
  align-items: center;
  overflow: hidden;
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
  color: var(--fg-muted);
  font: inherit;
  font-size: 0.8125rem;
}
.theme-toggle:hover { color: var(--fg); }
.theme-toggle-inner { display: inline-flex; align-items: center; gap: 0.375rem; }
.theme-icon-wrap { display: inline-flex; }
.theme-icon { width: 0.875rem; height: 0.875rem; }
@keyframes rise-in { from { transform: translateY(1.1em); } to { transform: translateY(0); } }
.rise-in { animation: rise-in 180ms cubic-bezier(0.22, 1, 0.36, 1); }
// margin-left: auto pushes this to the right edge of .page-footer whether it's the only child
// (landing page) or sits alongside .footer-info (report page) — no per-page override needed.
.footer-nav { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; margin-left: auto; }
.footer-nav a { color: var(--fg-muted); }
.footer-nav a:hover { color: var(--fg); text-decoration: none; }
.footer-nav .sep { color: var(--border); }
`;
