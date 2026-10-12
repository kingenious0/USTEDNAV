/**
 * CampusOS / USTED NAV — Programmatic SEO Page Generator
 * Copyright (c) 2026 KINGENIOUS. All Rights Reserved.
 *
 * Generates static, indexable HTML pages from the campus datasets:
 *   place/<slug>/index.html   — one page per building (47)
 *   staff/<slug>/index.html   — one page per staff member (96)
 *   directory/index.html      — hub listing every building & staff member
 *   sitemap.xml               — regenerated with every generated URL
 *
 * Run: npm run seo:gen   (output is committed to git — there is no build step)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ORIGIN = 'https://www.ustednav.app';
const GA_ID = 'G-31FQCEXNWK';
const TODAY = new Date().toISOString().slice(0, 10);

const buildings = require(path.join(ROOT, 'data', 'buildings.json'));
const people = require(path.join(ROOT, 'data', 'people.json'));

/* ── helpers ─────────────────────────────────────────────────────── */

function slugify(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'page';
}

function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function jld(obj) {
  return JSON.stringify(obj, null, 0).replace(/</g, '\\u003c');
}

function uniqSlug(base, taken) {
  let slug = base;
  let n = 2;
  while (taken.has(slug)) slug = `${base}-${n++}`;
  taken.add(slug);
  return slug;
}

function writePage(relDir, html) {
  const dir = path.join(ROOT, relDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
  return `${ORIGIN}/${relDir.replace(/\\/g, '/')}/`;
}

function truncate(str, n) {
  const s = String(str || '').trim();
  if (s.length <= n) return s;
  return s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…';
}

function stripDept(dept) {
  return String(dept || '')
    .replace(/^Department of\s+/i, '')
    .replace(/^Faculty of\s+/i, 'Faculty of ')
    .trim();
}

const PAGE_CSS = `
:root {
    --bg: #090d16;
    --surface: #0f1524;
    --surface2: #131b2e;
    --border: #1e293b;
    --border-highlight: rgba(99, 102, 241, 0.25);
    --text: #e2e8f0;
    --muted: #94a3b8;
    --accent: #f59e0b;
    --accent-glow: rgba(245, 158, 11, 0.2);
    --primary: #6366f1;
    --primary-gradient: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
    background: var(--bg);
    color: var(--text);
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    line-height: 1.7;
    -webkit-font-smoothing: antialiased;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    position: relative;
    overflow-x: hidden;
}
.ambient-glow {
    position: fixed;
    top: -120px;
    left: 50%;
    transform: translateX(-50%);
    width: 700px;
    height: 380px;
    background: radial-gradient(circle, rgba(99, 102, 241, 0.18) 0%, rgba(245, 158, 11, 0.08) 50%, transparent 70%);
    filter: blur(60px);
    pointer-events: none;
    z-index: 0;
}
a { color: #a5b4fc; text-decoration: none; transition: all 0.2s ease; }
a:hover { color: #c7d2fe; text-decoration: underline; }
.wrap { max-width: 860px; width: 100%; margin: 0 auto; padding: 0 24px; position: relative; z-index: 1; }

/* Top Navigation Bar */
.top {
    border-bottom: 1px solid var(--border);
    background: rgba(9, 13, 22, 0.88);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    position: sticky;
    top: 0;
    z-index: 50;
}
.top .wrap {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 64px;
}
.brand-link {
    display: flex;
    align-items: center;
    gap: 10px;
    color: #fff;
    text-decoration: none;
    font-weight: 800;
    font-size: 16px;
    letter-spacing: -0.02em;
}
.brand-link:hover { text-decoration: none; }
.brand-logo {
    width: 32px;
    height: 32px;
    border-radius: 9px;
    border: 1px solid rgba(245, 158, 11, 0.4);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    object-fit: cover;
}
.brand-link span { color: var(--accent); }
.top-nav-links {
    display: flex;
    align-items: center;
    gap: 14px;
}
.top-nav-links a.active {
    color: #fbbf24;
    font-weight: 600;
}
.nav-link-sub {
    color: #94a3b8;
    font-size: 13.5px;
    font-weight: 500;
}
.nav-link-sub:hover {
    color: #f8fafc;
    text-decoration: none;
}
.map-btn {
    background: var(--primary-gradient);
    color: #090d16 !important;
    padding: 8px 18px;
    border-radius: 9999px;
    font-size: 13px;
    font-weight: 700;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    box-shadow: 0 4px 14px rgba(245, 158, 11, 0.3);
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
.map-btn:hover {
    color: #090d16 !important;
    text-decoration: none !important;
    transform: translateY(-1px);
    box-shadow: 0 6px 18px rgba(245, 158, 11, 0.4);
}

/* Header & Breadcrumbs */
.crumbs { font-size: 12.5px; color: var(--muted); padding: 24px 0 0; }
.crumbs a { color: var(--muted); }
.crumbs a:hover { color: #a5b4fc; }

.header-title-section {
    margin: 20px 0 32px;
    padding-bottom: 24px;
    border-bottom: 1px solid var(--border);
}
.hero-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #38bdf8;
    background: rgba(14, 165, 233, 0.12);
    border: 1px solid rgba(14, 165, 233, 0.28);
    padding: 4px 12px;
    border-radius: 9999px;
    margin-bottom: 12px;
}
.hero-badge.badge-amber {
    color: #fbbf24;
    background: rgba(245, 158, 11, 0.12);
    border-color: rgba(245, 158, 11, 0.28);
}
h1 {
    font-family: 'Plus Jakarta Sans', 'Inter', sans-serif;
    font-size: clamp(28px, 5.5vw, 42px);
    font-weight: 800;
    line-height: 1.15;
    letter-spacing: -0.03em;
    color: #ffffff;
    margin-bottom: 10px;
}
.sub {
    color: var(--muted);
    font-size: 16px;
    font-weight: 400;
    max-width: 680px;
    line-height: 1.6;
}
.chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: var(--surface2);
    border: 1px solid var(--border);
    color: #a5b4fc;
    font-size: 11.5px;
    font-weight: 700;
    padding: 4px 12px;
    border-radius: 999px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-right: 8px;
    vertical-align: middle;
}
.lead {
    font-size: 16.5px;
    color: #cbd5e1;
    line-height: 1.75;
    margin-bottom: 24px;
}

/* Quick Navigation Index / Card */
.toc-card {
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 18px 22px;
    margin-bottom: 32px;
}
.toc-title {
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
    font-weight: 700;
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
}
.toc-list {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 8px 16px;
    list-style: none;
}
.toc-list a {
    color: #cbd5e1;
    font-size: 13.5px;
    display: inline-flex;
    align-items: center;
    gap: 8px;
}
.toc-list a:hover {
    color: #fbbf24;
    text-decoration: none;
}
.toc-count {
    font-size: 11px;
    background: rgba(245, 158, 11, 0.15);
    color: #fbbf24;
    padding: 2px 7px;
    border-radius: 999px;
    font-weight: 700;
    margin-left: auto;
}

/* Section styling */
.guide-section {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 18px;
    padding: 28px;
    margin-bottom: 28px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.25);
    transition: border-color 0.2s ease;
}
.guide-section:hover {
    border-color: var(--border-highlight);
}
.section-header {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 18px;
}
.section-num {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: rgba(99, 102, 241, 0.15);
    border: 1px solid rgba(99, 102, 241, 0.3);
    display: flex;
    align-items: center;
    justify-content: center;
    color: #a5b4fc;
    font-weight: 800;
    font-size: 15px;
    flex-shrink: 0;
}
.section-header h2 {
    margin: 0;
}

h2 {
    font-size: 21px;
    font-weight: 700;
    color: #ffffff;
    letter-spacing: -0.02em;
    margin: 32px 0 14px;
    display: flex;
    align-items: center;
    gap: 10px;
}
h3 {
    font-size: 15px;
    margin: 20px 0 10px;
    color: #e2e8f0;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 8px;
}
p {
    color: #cbd5e1;
    font-size: 15px;
    margin-bottom: 14px;
    line-height: 1.75;
}
p:last-child { margin-bottom: 0; }

.tip-callout {
    background: rgba(245, 158, 11, 0.08);
    border-left: 3px solid var(--accent);
    padding: 12px 16px;
    border-radius: 0 10px 10px 0;
    margin-top: 14px;
    font-size: 13.5px;
    color: #fef3c7;
}
.tip-callout strong {
    color: #fbbf24;
}

/* Facts Grid */
.facts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px;
    margin: 20px 0;
}
.fact {
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 14px 16px;
}
.fact b {
    display: block;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
    font-weight: 700;
    margin-bottom: 4px;
}
.fact span {
    font-size: 14.5px;
    color: var(--text);
    font-weight: 600;
}

/* Lists */
ul.list { list-style: none; }
ul.list li {
    padding: 11px 0;
    border-bottom: 1px solid rgba(30, 41, 59, 0.6);
    font-size: 14.5px;
}
ul.list li:last-child { border-bottom: none; }
ul.list li .muted, .muted { color: var(--muted); font-size: 13px; }

.rooms-floor {
    font-size: 12px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--accent);
    margin: 20px 0 8px;
}
.room {
    display: flex;
    gap: 12px;
    align-items: baseline;
    padding: 9px 0;
    border-bottom: 1px solid rgba(30, 41, 59, 0.6);
    font-size: 14.5px;
}
.room b { color: var(--text); min-width: 90px; font-weight: 700; }
.room span { color: var(--muted); }

/* FAQ Collapsibles */
details.faq {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 16px 20px;
    margin: 12px 0;
    transition: border-color 0.2s ease;
}
details.faq:hover {
    border-color: var(--border-highlight);
}
details.faq summary {
    cursor: pointer;
    font-weight: 600;
    font-size: 15px;
    list-style: none;
    display: flex;
    justify-content: space-between;
    align-items: center;
    color: #fff;
}
details.faq summary::-webkit-details-marker { display: none; }
details.faq summary::after {
    content: '+';
    color: var(--accent);
    font-size: 20px;
    font-weight: 600;
    transition: transform 0.2s;
}
details.faq[open] summary::after {
    content: '–';
}
details.faq p {
    margin-top: 12px;
    color: #cbd5e1;
    font-size: 14.5px;
}

/* Map CTA Card */
.map-cta-card, .cta {
    background: linear-gradient(135deg, #1e1b4b 0%, #0f1524 100%);
    border: 1px solid #4338ca;
    border-radius: 18px;
    padding: 24px 28px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    flex-wrap: wrap;
    margin: 32px 0;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
}
.map-cta-card .txt, .cta .txt { flex: 1; min-width: 240px; }
.map-cta-card h3, .cta b {
    font-size: 18px;
    color: #fff;
    margin-bottom: 6px;
    font-weight: 700;
    display: block;
}
.map-cta-card p, .cta p {
    color: #c7d2fe;
    font-size: 14px;
    margin: 0;
    line-height: 1.6;
}
.map-cta-card a.map-btn, .cta a.go {
    background: var(--primary-gradient);
    color: #090d16 !important;
    padding: 10px 22px;
    border-radius: 9999px;
    font-weight: 700;
    font-size: 14px;
    white-space: nowrap;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    box-shadow: 0 4px 14px rgba(245, 158, 11, 0.3);
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
.map-cta-card a.map-btn:hover, .cta a.go:hover {
    text-decoration: none !important;
    transform: translateY(-1px);
    box-shadow: 0 6px 18px rgba(245, 158, 11, 0.4);
}

/* Card Directory Grid */
.grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
    gap: 12px;
    margin-top: 14px;
    margin-bottom: 20px;
}
.grid a {
    display: block;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 16px 18px;
    color: var(--text);
    font-size: 14.5px;
    font-weight: 600;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
    transition: all 0.2s ease;
}
.grid a:hover {
    border-color: rgba(245, 158, 11, 0.45);
    background: var(--surface2);
    transform: translateY(-2px);
    text-decoration: none;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}
.grid a .muted {
    display: block;
    font-weight: 400;
    font-size: 12.5px;
    margin-top: 6px;
    line-height: 1.5;
}

/* Footer */
footer {
    border-top: 1px solid var(--border);
    margin-top: auto;
    padding: 36px 0 44px;
    color: var(--muted);
    font-size: 13px;
    background: rgba(9, 13, 22, 0.6);
}
.footer-nav {
    display: flex;
    flex-wrap: wrap;
    gap: 18px;
    margin-bottom: 14px;
}
.footer-nav a {
    color: #94a3b8;
    font-size: 13.5px;
    font-weight: 500;
}
.footer-nav a:hover { color: #f8fafc; text-decoration: underline; }
.legal { font-size: 12px; color: #64748b; line-height: 1.6; }

@media (max-width: 640px) {
    .wrap { padding: 0 16px; }
    .guide-section { padding: 20px; }
    .top-nav-links a.nav-link-sub { display: none; }
    .map-cta-card, .cta { padding: 20px; flex-direction: column; align-items: flex-start; }
}
`;

const GA_SNIPPET = `<!-- Google tag (gtag.js) -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', '${GA_ID}');
    </script>`;

function page({ title, desc, canonical, crumbs, body, jsonld, activeNav }) {
  const crumbHtml = crumbs
    .map((c, i) =>
      i === crumbs.length - 1
        ? `<span>${esc(c.label)}</span>`
        : `<a href="${esc(c.href)}">${esc(c.label)}</a> › `
    )
    .join('');
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(desc)}">
    <meta name="author" content="KINGENIOUS">
    <link rel="canonical" href="${esc(canonical)}">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="USTED NAV | AAMUSTED Kumasi Campus">
    <meta property="og:title" content="${esc(title)}">
    <meta property="og:description" content="${esc(desc)}">
    <meta property="og:url" content="${esc(canonical)}">
    <meta property="og:image" content="${ORIGIN}/icons/icon-512.png">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="theme-color" content="#090d16">
    <link rel="icon" type="image/png" href="/icons/icon-192.png">
    <link rel="apple-touch-icon" href="/icons/icon-192.png">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Plus+Jakarta+Sans:wght@700;800&display=swap">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    ${GA_SNIPPET}
    <script defer src="/_vercel/insights/script.js"></script>
    <style>${PAGE_CSS}</style>
    ${jsonld.map(o => `<script type="application/ld+json">${jld(o)}</script>`).join('\n    ')}
</head>
<body>
    <div class="ambient-glow"></div>

    <!-- Sticky Top Navigation -->
    <header class="top">
        <div class="wrap">
            <a href="/" class="brand-link" aria-label="USTED NAV Home">
                <img src="/logo.png" alt="USTED Logo" class="brand-logo">
                <div>USTED<span>NAV</span></div>
            </a>
            <nav class="top-nav-links" aria-label="Page navigation">
                <a href="/guide.html" class="nav-link-sub${activeNav === 'guide' ? ' active' : ''}">Campus Guide</a>
                ${activeNav === 'directory' ? '<a href="/directory/" class="nav-link-sub active">Directory</a>' : ''}
                <a href="/about.html" class="nav-link-sub${activeNav === 'about' ? ' active' : ''}">About</a>
                <a href="/map.html" class="map-btn">
                    <i class="fas fa-location-arrow"></i>
                    <span>Campus Map</span>
                </a>
            </nav>
        </div>
    </header>

    <main class="wrap">
        <nav class="crumbs" aria-label="Breadcrumb">${crumbHtml}</nav>
${body}
    </main>

    <!-- Footer -->
    <footer>
        <div class="wrap">
            <nav class="footer-nav" aria-label="Footer Navigation">
                <a href="/">← Open Interactive Map</a>
                <a href="/guide.html">Campus Guide</a>
                ${activeNav === 'directory' ? '<a href="/directory/">Campus Directory</a>' : ''}
                <a href="/about.html">About Platform</a>
                <a href="/privacy/">Privacy Policy</a>
            </nav>
            <div class="legal">
                USTED NAV • Powered by CampusOS™ • Offline campus navigation for AAMUSTED Kumasi. © 2026 KINGENIOUS. All Rights Reserved.
            </div>
        </div>
    </footer>
</body>
</html>
`;
}

/* ── FAQ builders ────────────────────────────────────────────────── */

function faqBlock(items) {
  return items
    .map(([q, a]) => `<details class="faq"><summary>${esc(q)}</summary><p>${a}</p></details>`)
    .join('\n');
}

function faqJsonld(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map(([q, a]) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a.replace(/<[^>]+>/g, '') }
    }))
  };
}

function breadcrumbJsonld(crumbs) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.label,
      item: ORIGIN + (c.href || '/')
    }))
  };
}

/* ── data linking ────────────────────────────────────────────────── */

function matchBuilding(label, list) {
  const L = String(label || '').trim().toUpperCase();
  if (!L) return null;
  let hit = list.find(b => (b.shortName || '').toUpperCase() === L);
  if (hit) return hit;
  hit = list.find(b => (b.name || '').toUpperCase() === L);
  if (hit) return hit;
  hit = list.find(b =>
    (b.name || '').toUpperCase().includes(L) ||
    ((b.shortName || '').length >= 3 && L.includes((b.shortName || '').toUpperCase()))
  );
  if (hit) return hit;
  return (
    list.find(b => {
      const blob = JSON.stringify([b.keywords || [], b.rooms || [], b.services || []]).toUpperCase();
      return new RegExp(`(^|[^A-Z0-9])${L.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Z0-9]|$)`).test(blob);
    }) || null
  );
}

const TYPE_LABELS = {
  academic: 'Academic Building',
  facility: 'Campus Facility',
  hostel: 'Student Hostel',
  faculty: 'Faculty Building',
  administration: 'Administration Building'
};

const TYPE_PLURALS = {
  academic: 'Academic Buildings',
  facility: 'Campus Facilities',
  hostel: 'Student Hostels',
  faculty: 'Faculty Buildings',
  administration: 'Administration Buildings'
};

const TYPE_INTROS = {
  academic: [
    'Lecture halls, tutorial rooms and teaching spaces sit inside this building, making it one of the places students pass through every week at AAMUSTED Kumasi.',
    'This academic building hosts classes, departmental activities and student services for the AAMUSTED (USTED) Kumasi community.'
  ],
  facility: [
    'A day-to-day campus facility used by students and staff of AAMUSTED Kumasi.',
    'Part of the everyday campus life at AAMUSTED Kumasi — open to students and staff.'
  ],
  hostel: [
    'Student accommodation on the AAMUSTED Kumasi campus, home to residents across multiple levels.',
    'A student residence hall on the AAMUSTED (USTED) Kumasi campus.'
  ],
  faculty: [
    'Home to faculty offices, teaching rooms and administrative desks of AAMUSTED Kumasi.',
    'A faculty base at AAMUSTED Kumasi where lectures, offices and student services come together.'
  ],
  administration: [
    'Administrative hub of AAMUSTED Kumasi, hosting registries, offices and official student services.',
    'Where the day-to-day administration of AAMUSTED (USTED) Kumasi happens.'
  ]
};

/* ── building pages ──────────────────────────────────────────────── */

function roomLabel(r) {
  const num = String(r.number || '').trim();
  if (/room|hall|lab|lecture/i.test(num)) return num;
  return num ? `Room ${num}` : 'Room';
}

function generateBuildingPage(b, ctx) {
  const slug = ctx.buildingSlug.get(b.id);
  const canonical = `${ORIGIN}/place/${slug}/`;
  const staff = ctx.peopleByBuilding.get(b.id) || [];
  const typeLabel = TYPE_LABELS[b.type] || 'Campus Building';
  const intro = (TYPE_INTROS[b.type] || TYPE_INTROS.facility)[b.id % 2];
  const desc = truncate(
    `${b.description || `${b.name} (${b.shortName}) on the AAMUSTED Kumasi campus.`} Find rooms, services, opening hours and walking directions on the USTED NAV campus map.`,
    155
  );
  const title = `${b.name} — Map, Rooms & Directions | USTED NAV AAMUSTED`;
  const crumbs = [
    { label: 'Home', href: '/' },
    { label: b.name, href: `/place/${slug}/` }
  ];
  const mapCta = `/map.html?q=${encodeURIComponent(b.name)}`;

  const faqs = [
    [
      `Where is ${b.name} on the AAMUSTED campus?`,
      `${esc(b.description || `${b.name} is located on the AAMUSTED (USTED) Kumasi campus.`)}${b.shortName && b.shortName !== b.name ? ` It is commonly known as <b>${esc(b.shortName)}</b>.` : ''} Open it on the <a href="${mapCta}">USTED NAV interactive campus map</a> for walking directions from anywhere on campus.`
    ],
    ...(b.hours
      ? [[`What are ${b.name} opening hours?`, `${esc(b.name)} is open <b>${esc(b.hours)}</b>. Hours may change during exams and holidays — check notices at the building.`]]
      : []),
    ...(b.rooms && b.rooms.length
      ? [[`What rooms are inside ${b.name}?`, `${b.name} contains <b>${b.rooms.length}</b> listed room${b.rooms.length > 1 ? 's' : ''}, including ${b.rooms.slice(0, 6).map(r => esc(roomLabel(r))).join(', ')}${b.rooms.length > 6 ? ` and ${b.rooms.length - 6} more` : ''}.`]]
      : []),
    ...(b.services && b.services.length
      ? [[`What services are available at ${b.name}?`, esc(b.services.map(s => s.name).join(', ')) + '.']]
      : []),
    [
      `How do I get to ${b.name}?`,
      `Use the <a href="${mapCta}">USTED NAV map</a> — it shows ${b.name} with turn-by-turn walking directions across the AAMUSTED Kumasi campus, and works completely offline once loaded.`
    ]
  ];

  let facts = `<div class="facts">
        <div class="fact"><b>Building type</b><span>${esc(typeLabel)}</span></div>
        <div class="fact"><b>Short name</b><span>${esc(b.shortName || '—')}</span></div>
        ${b.hours ? `<div class="fact"><b>Opening hours</b><span>${esc(b.hours)}</span></div>` : ''}
        <div class="fact"><b>Rooms listed</b><span>${b.rooms ? b.rooms.length : 0}</span></div>
        ${b.lat && b.lng ? `<div class="fact"><b>GPS coordinates</b><span>${Number(b.lat).toFixed(5)}, ${Number(b.lng).toFixed(5)}</span></div>` : ''}
      </div>`;

  let services = '';
  if (b.services && b.services.length) {
    services = `<h2>Services at ${esc(b.name)}</h2>
      <ul class="list">${b.services.map(s => `<li><b>${esc(s.name)}</b> — ${esc(s.description || '')}${s.requirements ? ` <span class="muted">(Requirements: ${esc(s.requirements)})</span>` : ''}${s.hours ? ` <span class="muted">• ${esc(s.hours)}</span>` : ''}</li>`).join('')}</ul>`;
  }

  let rooms = '';
  if (b.rooms && b.rooms.length) {
    const floors = new Map();
    b.rooms.forEach(r => {
      const f = (r.floor || '').trim() || 'Floors not listed';
      if (!floors.has(f)) floors.set(f, []);
      floors.get(f).push(r);
    });
    rooms = `<h2>Rooms in ${esc(b.name)}</h2>` + [...floors.entries()].map(([f, rs]) => `
      <div class="rooms-floor">${esc(/ground/i.test(f) ? 'Ground Floor' : f)}</div>
      ${rs.map(r => `<div class="room"><b>${esc(roomLabel(r))}</b><span>${esc(r.description || (r.occupant ? `Occupied by ${r.occupant}` : ''))}</span></div>`).join('')}`).join('');
  }

  const staffSection = staff.length
    ? `<h2>Staff based in ${esc(b.name)}</h2>
      <ul class="list">${staff.slice(0, 30).map(p => `<li><a href="/staff/${ctx.peopleSlug.get(p.id)}/">${esc([p.title, p.name].filter(Boolean).join(' '))}</a> <span class="muted">— ${esc(p.position || '')}${p.department ? ', ' + esc(stripDept(p.department)) : ''}</span></li>`).join('')}</ul>`
    : '';

  const related = ctx.buildings
    .filter(x => x.id !== b.id && x.type === b.type)
    .slice(0, 6);
  const relatedSection = related.length
    ? `<h2>More ${esc((TYPE_PLURALS[b.type] || 'Campus Places').toLowerCase())} on campus</h2>
      <div class="grid">${related.map(x => `<a href="/place/${ctx.buildingSlug.get(x.id)}/">${esc(x.name)}<span class="muted">${esc(truncate(x.description || x.shortName || '', 70))}</span></a>`).join('')}</div>`
    : '';

  const body = `        <span class="chip">${esc(typeLabel)}</span>${b.shortName ? `<span class="chip">${esc(b.shortName)}</span>` : ''}
        <h1>${esc(b.name)} — AAMUSTED Kumasi Campus Map</h1>
        <p class="sub">Rooms, services, staff and directions for ${esc(b.name)} at AAMUSTED (USTED) Kumasi.</p>
        <p class="lead">${esc(b.description || '')} ${intro}</p>
        ${facts}
        ${services}
        ${rooms}
        ${staffSection}
        ${relatedSection}
        <h2>Frequently asked questions</h2>
        ${faqBlock(faqs)}
        <div class="cta">
          <div class="txt"><b>See ${esc(b.name)} on the live campus map</b><p>Turn-by-turn walking directions across AAMUSTED Kumasi — works 100% offline.</p></div>
          <a class="go" href="${mapCta}">Open in USTED NAV →</a>
        </div>`;

  const jsonld = [
    breadcrumbJsonld(crumbs),
    {
      '@context': 'https://schema.org',
      '@type': b.type === 'academic' || b.type === 'faculty' ? 'EducationalOrganization' : 'Place',
      name: b.name,
      description: b.description || `${b.name} on the AAMUSTED Kumasi campus.`,
      url: canonical,
      ...(b.lat && b.lng
        ? { geo: { '@type': 'GeoCoordinates', latitude: Number(b.lat), longitude: Number(b.lng) } }
        : {}),
      address: { '@type': 'PostalAddress', addressLocality: 'Kumasi', addressCountry: 'GH' }
    },
    faqJsonld(faqs)
  ];

  return writePage(path.join('place', slug), page({ title, desc, canonical, crumbs, body, jsonld }));
}

/* ── staff pages ─────────────────────────────────────────────────── */

function generatePersonPage(p, ctx) {
  const slug = ctx.peopleSlug.get(p.id);
  const canonical = `${ORIGIN}/staff/${slug}/`;
  const building = p.location && p.location.building ? matchBuilding(p.location.building, ctx.buildings) : null;
  const officeBits = [];
  if (p.location && p.location.building) officeBits.push(p.location.building);
  if (p.location && p.location.room) officeBits.push(p.location.room);
  if (p.location && p.location.floor) officeBits.push(p.location.floor);
  const office = officeBits.join(', ');
  const shortPos = truncate(p.position || 'Staff', 40);
  const shortDept = truncate(stripDept(p.department) || 'AAMUSTED', 45);
  const title = `${p.title ? p.title + ' ' : ''}${p.name} — ${shortPos}, ${shortDept} | AAMUSTED`;
  const desc = truncate(
    `${p.title ? p.title + ' ' : ''}${p.name} is ${p.position ? p.position + ' in the ' : 'based at '}${p.department || 'AAMUSTED'}. ${office ? `Office: ${office}. ` : ''}Find the office on the USTED NAV AAMUSTED Kumasi map.`,
    155
  );
  const crumbs = [
    { label: 'Home', href: '/' },
    { label: p.name, href: `/staff/${slug}/` }
  ];
  const mapQ = building ? building.name : (p.location && p.location.building) || p.name;
  const mapCta = `/map.html?q=${encodeURIComponent(mapQ)}`;

  const faqs = [
    [
      `What does ${p.name} do at AAMUSTED?`,
      `${esc(p.title ? p.title + ' ' : '')}${esc(p.name)} is ${p.position ? `<b>${esc(p.position)}</b> ${p.department ? `in the ${esc(p.department)}` : ''}` : 'staff at AAMUSTED Kumasi'}${p.faculty ? `, ${esc(p.faculty)}` : ''}.`
    ],
    ...(office
      ? [[
          `Where is ${p.name}'s office?`,
          `${esc(p.name)}'s office is at <b>${esc(office)}</b>${building ? ` in <a href="/place/${ctx.buildingSlug.get(building.id)}/">${esc(building.name)}</a>` : ''} on the AAMUSTED Kumasi campus. <a href="${mapCta}">View the location on the campus map →</a>`
        ]]
      : []),
    ...(p.department
      ? [[`Which department is ${p.name} in?`, `${esc(p.name)} belongs to the <b>${esc(p.department)}</b>${p.faculty ? ` under the ${esc(p.faculty)}` : ''}.`]]
      : [])
  ];

  const sameDept = ctx.people.filter(
    x => x.id !== p.id && p.department && x.department === p.department
  ).slice(0, 8);

  const body = `        <span class="chip">Staff Directory</span>
        <h1>${esc((p.title ? p.title + ' ' : '') + p.name)}</h1>
        <p class="sub">${esc(p.position || 'Staff')} ${p.department ? '• ' + esc(p.department) : ''} ${p.faculty ? '• ' + esc(p.faculty) : ''}</p>
        <p class="lead">${esc(p.title ? p.title + ' ' : '')}${esc(p.name)} is part of the AAMUSTED (USTED) Kumasi community. This page shows the office location, department and faculty details published in the USTED NAV campus directory.</p>
        <div class="facts">
          <div class="fact"><b>Position</b><span>${esc(p.position || '—')}</span></div>
          <div class="fact"><b>Department</b><span>${esc(p.department || '—')}</span></div>
          <div class="fact"><b>Faculty</b><span>${esc(p.faculty || '—')}</span></div>
          <div class="fact"><b>Office</b><span>${office ? esc(office) : 'Not listed'}</span></div>
        </div>
        ${building ? `<div class="cta"><div class="txt"><b>Office in ${esc(building.name)}</b><p>${office ? esc(office) + ' — ' : ''}walking directions from anywhere on campus.</p></div><a class="go" href="/place/${ctx.buildingSlug.get(building.id)}/">View building →</a></div>` : ''}
        ${sameDept.length ? `<h2>Colleagues in ${esc(stripDept(p.department))}</h2>
        <div class="grid">${sameDept.map(x => `<a href="/staff/${ctx.peopleSlug.get(x.id)}/">${esc((x.title ? x.title + ' ' : '') + x.name)}<span class="muted">${esc(x.position || '')}</span></a>`).join('')}</div>` : ''}
        <h2>Frequently asked questions</h2>
        ${faqBlock(faqs)}
        <div class="cta">
          <div class="txt"><b>Find this office on the campus map</b><p>USTED NAV shows every building and room at AAMUSTED Kumasi — offline, for free.</p></div>
          <a class="go" href="${mapCta}">Open in USTED NAV →</a>
        </div>`;

  const jsonld = [
    breadcrumbJsonld(crumbs),
    {
      '@context': 'https://schema.org',
      '@type': 'Person',
      name: p.name,
      honorificPrefix: p.title || undefined,
      jobTitle: p.position || undefined,
      url: canonical,
      worksFor: {
        '@type': 'EducationalOrganization',
        name: p.faculty || 'AAMUSTED Kumasi',
        department: p.department || undefined
      }
    },
    faqJsonld(faqs)
  ];

  return writePage(path.join('staff', slug), page({ title, desc, canonical, crumbs, body, jsonld }));
}

/* ── directory hub ───────────────────────────────────────────────── */

function generateDirectory(ctx) {
  const typeOrder = ['academic', 'faculty', 'administration', 'hostel', 'facility'];
  const byType = new Map();
  ctx.buildings.forEach(b => {
    const t = TYPE_LABELS[b.type] ? b.type : 'facility';
    if (!byType.has(t)) byType.set(t, []);
    byType.get(t).push(b);
  });

  const typeIcons = {
    academic: 'fa-book-open',
    faculty: 'fa-landmark',
    administration: 'fa-briefcase',
    hostel: 'fa-hotel',
    facility: 'fa-map-pin'
  };

  const buildingSections = typeOrder
    .filter(t => byType.has(t))
    .map(t => `
        <div class="guide-section" id="${t}">
            <div class="section-header">
                <div class="section-num"><i class="fas ${typeIcons[t] || 'fa-building'}"></i></div>
                <div>
                    <h2>${esc(TYPE_PLURALS[t] || 'Buildings')}</h2>
                    <span class="muted" style="font-size:13px;">${byType.get(t).length} location${byType.get(t).length === 1 ? '' : 's'} on campus</span>
                </div>
            </div>
            <div class="grid">${byType.get(t).map(b => `<a href="/place/${ctx.buildingSlug.get(b.id)}/">${esc(b.name)}<span class="muted">${esc(truncate(b.description || b.shortName || '', 72))}</span></a>`).join('')}</div>
        </div>`)
    .join('');

  const byFaculty = new Map();
  ctx.people.forEach(p => {
    const f = p.faculty || 'Other';
    if (!byFaculty.has(f)) byFaculty.set(f, new Map());
    const deptMap = byFaculty.get(f);
    const d = p.department || 'Unassigned';
    if (!deptMap.has(d)) deptMap.set(d, []);
    deptMap.get(d).push(p);
  });

  const staffSections = [...byFaculty.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([faculty, deptMap]) => {
      const totalStaff = [...deptMap.values()].reduce((acc, l) => acc + l.length, 0);
      return `
        <div class="guide-section" id="${slugify(faculty)}">
            <div class="section-header">
                <div class="section-num"><i class="fas fa-users-rectangle"></i></div>
                <div>
                    <h2>${esc(faculty)}</h2>
                    <span class="muted" style="font-size:13px;">${totalStaff} staff profile${totalStaff === 1 ? '' : 's'}</span>
                </div>
            </div>
            ${[...deptMap.entries()].map(([dept, list]) => `
            <h3><i class="fas fa-folder-tree" style="color:var(--accent);font-size:13px;"></i> ${esc(dept)} <span class="muted">(${list.length})</span></h3>
            <div class="grid">${list.map(p => `<a href="/staff/${ctx.peopleSlug.get(p.id)}/">${esc((p.title ? p.title + ' ' : '') + p.name)}<span class="muted">${esc(p.position || '')}${p.location && p.location.building ? ' • ' + esc(p.location.building) : ''}</span></a>`).join('')}</div>`).join('')}
        </div>`;
    })
    .join('');

  const canonical = `${ORIGIN}/directory/`;
  const title = 'USTED NAV Campus Directory — Buildings & Staff | AAMUSTED Kumasi';
  const desc = `Every building, lecture hall, facility and staff office at AAMUSTED (USTED) Kumasi campus — searchable directory powered by the USTED NAV offline campus map.`;
  const crumbs = [
    { label: 'Home', href: '/' },
    { label: 'Campus Directory', href: '/directory/' }
  ];

  const body = `        <!-- Header -->
        <div class="header-title-section">
            <span class="hero-badge badge-amber">
                <i class="fas fa-compass"></i> Campus Index &amp; Directory
            </span>
            <h1>USTED NAV Campus Directory</h1>
            <p class="sub">Every building, faculty hall, department and staff office at AAMUSTED (USTED) Kumasi — one tap away from walking directions.</p>
        </div>

        <p class="lead">Browse <b>${ctx.buildings.length} campus landmarks</b> (lecture blocks, faculty complexes, hostels, laboratories and amenities) and <b>${ctx.people.length} faculty and staff members</b> with verified office locations. Tap any entry to inspect room schedules, opening hours, or launch real-time directions on the offline interactive map.</p>

        <!-- Guide-styled Overview Index / Quick Jump -->
        <div class="toc-card">
            <div class="toc-title">
                <i class="fas fa-list-check"></i> Directory Quick Jump
            </div>
            <ul class="toc-list">
                ${typeOrder.filter(t => byType.has(t)).map(t => `<li><a href="#${t}"><i class="fas fa-chevron-right" style="font-size:11px;"></i> ${esc(TYPE_PLURALS[t] || 'Buildings')} <span class="toc-count">${byType.get(t).length}</span></a></li>`).join('')}
                <li><a href="#staff-directory"><i class="fas fa-chevron-right" style="font-size:11px;"></i> Staff Faculties (${[...byFaculty.keys()].length}) <span class="toc-count">${ctx.people.length}</span></a></li>
            </ul>
        </div>

        <div class="map-cta-card">
          <div class="txt">
            <h3>Looking for a specific room or lecturer?</h3>
            <p>Use the campus-wide instant search on the interactive 2D &amp; 3D offline map.</p>
          </div>
          <a class="map-btn" href="/map.html">
            <i class="fas fa-diamond-turn-right"></i>
            <span>Launch Campus Map</span>
          </a>
        </div>

        <div style="margin: 36px 0 18px; display: flex; align-items: baseline; justify-content: space-between;">
            <h2 id="buildings" style="margin:0;"><i class="fas fa-building-columns" style="color:var(--accent);"></i> Campus Places &amp; Buildings (${ctx.buildings.length})</h2>
        </div>
        ${buildingSections}

        <div id="staff-directory" style="margin: 48px 0 18px; display: flex; align-items: baseline; justify-content: space-between;">
            <h2 id="staff" style="margin:0;"><i class="fas fa-id-badge" style="color:var(--accent);"></i> Staff &amp; Faculty Directory (${ctx.people.length})</h2>
        </div>
        ${staffSections}

        <div class="map-cta-card">
          <div class="txt">
            <h3>Ready to navigate in person?</h3>
            <p>Get GPS turn-by-turn guidance to any building or staff office on campus without using your internet data.</p>
          </div>
          <a class="map-btn" href="/map.html">
            <i class="fas fa-location-arrow"></i>
            <span>Open Interactive Map</span>
          </a>
        </div>`;

  const jsonld = [
    breadcrumbJsonld(crumbs),
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: title,
      description: desc,
      url: canonical
    }
  ];

  return writePage('directory', page({ title, desc, canonical, crumbs, body, jsonld, activeNav: 'directory' }));
}

/* ── sitemap ─────────────────────────────────────────────────────── */

function generateSitemap(urls) {
  const entries = urls
    .map(u => `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${u.lastmod || TODAY}</lastmod>\n    <changefreq>${u.changefreq || 'monthly'}</changefreq>\n    <priority>${u.priority || '0.6'}</priority>\n  </url>`)
    .join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
  fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), xml, 'utf8');
}

/* ── main ────────────────────────────────────────────────────────── */

function generate() {
  const buildingSlug = new Map();
  const peopleSlug = new Map();
  const takenBuildings = new Set();
  const takenPeople = new Set();

  buildings.forEach(b => {
    buildingSlug.set(b.id, uniqSlug(slugify(b.name), takenBuildings));
  });
  people.forEach(p => {
    peopleSlug.set(p.id, uniqSlug(slugify(p.id || p.name), takenPeople));
  });

  const peopleByBuilding = new Map();
  people.forEach(p => {
    const target = p.location && p.location.building ? matchBuilding(p.location.building, buildings) : null;
    if (target) {
      if (!peopleByBuilding.has(target.id)) peopleByBuilding.set(target.id, []);
      peopleByBuilding.get(target.id).push(p);
    }
  });

  const ctx = { buildings, people, buildingSlug, peopleSlug, peopleByBuilding };

  const urls = [
    { loc: `${ORIGIN}/`, changefreq: 'weekly', priority: '1.0' },
    { loc: `${ORIGIN}/map.html`, changefreq: 'daily', priority: '0.9' },
    { loc: `${ORIGIN}/about.html`, changefreq: 'monthly', priority: '0.8' },
    { loc: `${ORIGIN}/guide.html`, changefreq: 'weekly', priority: '0.8' },
    { loc: `${ORIGIN}/directory/`, changefreq: 'weekly', priority: '0.8' }
  ];

  buildings.forEach(b => {
    urls.push({ loc: generateBuildingPage(b, ctx), changefreq: 'monthly', priority: '0.7' });
  });
  people.forEach(p => {
    urls.push({ loc: generatePersonPage(p, ctx), changefreq: 'monthly', priority: '0.6' });
  });

  generateDirectory(ctx);
  generateSitemap(urls);

  console.log(`[seo] generated ${buildings.length} place pages, ${people.length} staff pages, 1 directory hub`);
  console.log(`[seo] sitemap.xml updated with ${urls.length} URLs`);
  return { places: buildings.length, staff: people.length, sitemapUrls: urls.length };
}

if (require.main === module) generate();

module.exports = { generate, slugify, matchBuilding };
