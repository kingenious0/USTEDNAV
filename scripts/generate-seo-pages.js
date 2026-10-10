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

/* ── shared page chrome ──────────────────────────────────────────── */

const PAGE_CSS = `
:root{--bg:#090d16;--surface:#0f1524;--surface2:#131b2e;--border:#1e293b;--text:#e2e8f0;--muted:#94a3b8;--accent:#6366f1;--accent2:#4f46e5}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.65;-webkit-font-smoothing:antialiased}
a{color:#a5b4fc;text-decoration:none}
a:hover{text-decoration:underline}
.wrap{max-width:860px;margin:0 auto;padding:0 20px}
.top{border-bottom:1px solid var(--border);background:rgba(9,13,22,.92);position:sticky;top:0;z-index:5}
.top .wrap{display:flex;align-items:center;justify-content:space-between;height:56px}
.brand{font-weight:800;letter-spacing:.04em;color:var(--text);font-size:15px}
.brand span{color:var(--accent)}
.top a.map-btn{background:var(--accent2);color:#fff;padding:8px 16px;border-radius:10px;font-size:13px;font-weight:600}
.top a.map-btn:hover{text-decoration:none;background:var(--accent)}
.crumbs{font-size:12.5px;color:var(--muted);padding:18px 0 0}
.crumbs a{color:var(--muted)}
.crumbs a:hover{color:#a5b4fc}
h1{font-size:clamp(26px,5vw,38px);line-height:1.2;margin:14px 0 6px;font-weight:800;letter-spacing:-.02em}
.sub{color:var(--muted);font-size:15px;margin-bottom:22px}
.chip{display:inline-block;background:var(--surface2);border:1px solid var(--border);color:#a5b4fc;font-size:11.5px;font-weight:700;padding:3px 10px;border-radius:999px;text-transform:uppercase;letter-spacing:.06em;margin-right:8px;vertical-align:middle}
.card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:20px 22px;margin:18px 0}
.lead{font-size:16.5px;color:#cbd5e1}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:18px 0}
.fact{background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:12px 14px}
.fact b{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:700;margin-bottom:3px}
.fact span{font-size:14.5px;color:var(--text)}
h2{font-size:21px;margin:34px 0 12px;font-weight:700;letter-spacing:-.01em}
h3{font-size:15px;margin:16px 0 8px;color:#cbd5e1}
ul.list{list-style:none}
ul.list li{padding:9px 0;border-bottom:1px solid rgba(30,41,59,.6);font-size:14.5px}
ul.list li:last-child{border-bottom:none}
ul.list li .muted,.muted{color:var(--muted);font-size:13px}
.rooms-floor{font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:var(--accent);margin:18px 0 6px}
.room{display:flex;gap:10px;align-items:baseline;padding:7px 0;border-bottom:1px solid rgba(30,41,59,.6);font-size:14.5px}
.room b{color:var(--text);min-width:86px;font-weight:700}
.room span{color:var(--muted)}
details.faq{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px 18px;margin:10px 0}
details.faq summary{cursor:pointer;font-weight:600;font-size:15px;list-style:none;display:flex;justify-content:space-between;align-items:center}
details.faq summary::-webkit-details-marker{display:none}
details.faq summary::after{content:'+';color:var(--accent);font-size:20px;font-weight:400}
details.faq[open] summary::after{content:'–'}
details.faq p{margin-top:10px;color:#cbd5e1;font-size:14.5px}
.cta{display:flex;flex-wrap:wrap;gap:14px;align-items:center;background:linear-gradient(135deg,#1d2450,#0f1524);border:1px solid #3730a3;border-radius:16px;padding:22px;margin:26px 0}
.cta .txt{flex:1;min-width:220px}
.cta b{font-size:17px;display:block;margin-bottom:4px}
.cta p{color:var(--muted);font-size:13.5px}
.cta a.go{background:var(--accent2);color:#fff;padding:12px 22px;border-radius:11px;font-weight:700;font-size:14.5px;white-space:nowrap}
.cta a.go:hover{text-decoration:none;background:var(--accent)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px;margin-top:14px}
.grid a{display:block;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:13px 15px;color:var(--text);font-size:14.5px;font-weight:600}
.grid a:hover{border-color:var(--accent);text-decoration:none}
.grid a .muted{display:block;font-weight:400;font-size:12.5px;margin-top:2px}
footer{border-top:1px solid var(--border);margin-top:48px;padding:26px 0 40px;color:var(--muted);font-size:13px}
footer .fl{display:flex;flex-wrap:wrap;gap:16px;margin-bottom:10px}
footer a{color:var(--muted)}
.legal{font-size:11.5px;color:#475569}
`;

const GA_SNIPPET = `<!-- Google tag (gtag.js) -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', '${GA_ID}');
    </script>`;

function page({ title, desc, canonical, crumbs, body, jsonld }) {
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
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap">
    ${GA_SNIPPET}
    <script defer src="/_vercel/insights/script.js"></script>
    <style>${PAGE_CSS}</style>
    ${jsonld.map(o => `<script type="application/ld+json">${jld(o)}</script>`).join('\n    ')}
</head>
<body>
    <header class="top"><div class="wrap">
        <a class="brand" href="/">USTED<span>NAV</span></a>
        <a class="map-btn" href="/map.html">Open Campus Map</a>
    </div></header>
    <main class="wrap">
        <nav class="crumbs" aria-label="Breadcrumb">${crumbHtml}</nav>
${body}
    </main>
    <footer><div class="wrap">
        <div class="fl">
            <a href="/">Home</a>
            <a href="/map.html">Campus Map</a>
            <a href="/directory/">Campus Directory</a>
            <a href="/directory/#buildings">Buildings</a>
            <a href="/directory/#staff">Staff Directory</a>
            <a href="/privacy/">Privacy</a>
        </div>
        <div class="legal">USTED NAV • Powered by CampusOS™ — Offline campus navigation for AAMUSTED (USTED) Kumasi. © 2026 KINGENIOUS. All Rights Reserved.</div>
    </div></footer>
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
    { label: 'Places', href: '/directory/#buildings' },
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
    { label: 'Staff Directory', href: '/directory/#staff' },
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

  const buildingSections = typeOrder
    .filter(t => byType.has(t))
    .map(t => `
        <h2 id="${t}">${esc(TYPE_PLURALS[t] || 'Buildings')}</h2>
        <div class="grid">${byType.get(t).map(b => `<a href="/place/${ctx.buildingSlug.get(b.id)}/">${esc(b.name)}<span class="muted">${esc(truncate(b.description || b.shortName || '', 72))}</span></a>`).join('')}</div>`)
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
    .map(([faculty, deptMap]) => `
        <h2 id="${slugify(faculty)}">${esc(faculty)}</h2>
        ${[...deptMap.entries()].map(([dept, list]) => `
        <h3>${esc(dept)} <span class="muted">(${list.length})</span></h3>
        <div class="grid">${list.map(p => `<a href="/staff/${ctx.peopleSlug.get(p.id)}/">${esc((p.title ? p.title + ' ' : '') + p.name)}<span class="muted">${esc(p.position || '')}${p.location && p.location.building ? ' • ' + esc(p.location.building) : ''}</span></a>`).join('')}</div>`).join('')}`)
    .join('');

  const canonical = `${ORIGIN}/directory/`;
  const title = 'USTED NAV Campus Directory — Buildings & Staff | AAMUSTED Kumasi';
  const desc = `Every building, lecture hall, facility and staff office at AAMUSTED (USTED) Kumasi campus — searchable directory powered by the USTED NAV offline campus map.`;
  const crumbs = [
    { label: 'Home', href: '/' },
    { label: 'Campus Directory', href: '/directory/' }
  ];

  const body = `        <span class="chip">Directory</span>
        <h1>USTED NAV Campus Directory</h1>
        <p class="sub">Every building and staff office at AAMUSTED (USTED) Kumasi — one click from walking directions.</p>
        <p class="lead">Browse <b>${ctx.buildings.length} buildings</b> — lecture blocks, faculties, hostels, workshops and facilities — and <b>${ctx.people.length} staff members</b> with office locations. Each entry links to a detailed page with rooms, opening hours and an interactive map that works completely offline on your phone.</p>
        <div class="cta">
          <div class="txt"><b>Looking for a room or lecturer?</b><p>Search instantly across the whole campus instead.</p></div>
          <a class="go" href="/map.html">Open Campus Map →</a>
        </div>
        <h2 id="buildings">Buildings &amp; Places (${ctx.buildings.length})</h2>
        ${buildingSections}
        <h2 id="staff">Staff Directory (${ctx.people.length})</h2>
        ${staffSections}`;

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

  return writePage('directory', page({ title, desc, canonical, crumbs, body, jsonld }));
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
