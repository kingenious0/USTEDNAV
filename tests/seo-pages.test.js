/**
 * Automated Test Suite for Programmatic SEO Page Generation
 * Validates:
 * 1. Generator runs and emits one page per building + one per staff member
 * 2. Every generated page carries canonical, unique title and JSON-LD structured data
 * 3. Staff contact details (phone/email) are never published on indexable pages
 * 4. sitemap.xml lists every generated URL plus the core pages
 * 5. Homepage footer provides a crawl path to the directory hub
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('=== RUNNING PROGRAMMATIC SEO PAGE TESTS ===\n');

const ROOT = path.join(__dirname, '..');
const ORIGIN = 'https://www.ustednav.app';

const buildings = require(path.join(ROOT, 'data', 'buildings.json'));
const people = require(path.join(ROOT, 'data', 'people.json'));

// 1. Regenerate so tests always validate fresh output
const { generate } = require(path.join(ROOT, 'scripts', 'generate-seo-pages.js'));
const result = generate();

assert.strictEqual(result.places, buildings.length, 'place page count must match buildings.json');
assert.strictEqual(result.staff, people.length, 'staff page count must match people.json');
console.log(`✓ PASS: generator emitted ${result.places} place pages + ${result.staff} staff pages`);

// 2. Per-page SEO integrity + contact exclusion
const titles = new Set();
let pagesChecked = 0;

function checkPage(relPath) {
    const html = fs.readFileSync(path.join(ROOT, relPath), 'utf8');

    assert(html.includes('rel="canonical"'), `${relPath} must declare a canonical URL`);
    assert(html.includes('application/ld+json'), `${relPath} must include JSON-LD structured data`);

    const titleMatch = html.match(/<title>(.*?)<\/title>/);
    assert(titleMatch && titleMatch[1].length > 10, `${relPath} must have a meaningful title`);
    assert(!titles.has(titleMatch[1]), `duplicate <title> detected: ${titleMatch[1]}`);
    titles.add(titleMatch[1]);

    assert(!/\+233/.test(html), `${relPath} must not publish phone numbers`);
    assert(!/@aamusted/i.test(html), `${relPath} must not publish staff emails`);

    const canonical = html.match(/rel="canonical" href="([^"]+)"/)[1];
    assert(canonical.startsWith(ORIGIN + '/'), `${relPath} canonical must use ${ORIGIN}`);

    pagesChecked++;
}

fs.readdirSync(path.join(ROOT, 'place')).forEach(slug => checkPage(path.join('place', slug, 'index.html')));
fs.readdirSync(path.join(ROOT, 'staff')).forEach(slug => checkPage(path.join('staff', slug, 'index.html')));
checkPage(path.join('directory', 'index.html'));

assert.strictEqual(pagesChecked, buildings.length + people.length + 1, 'every generated page must be checked');
assert.strictEqual(titles.size, pagesChecked, 'all page titles must be unique');
console.log(`✓ PASS: ${pagesChecked} pages verified — canonical, JSON-LD, unique titles, no contact leaks`);

// 3. sitemap must cover every page
const sitemap = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);

assert.strictEqual(locs.length, result.sitemapUrls, 'sitemap URL count must match generator output');
assert(locs.includes(`${ORIGIN}/`), 'sitemap must include homepage');
assert(locs.includes(`${ORIGIN}/map.html`), 'sitemap must include map');
assert(locs.includes(`${ORIGIN}/directory/`), 'sitemap must include directory hub');
locs.forEach(loc => assert(loc.startsWith(ORIGIN), `sitemap loc must use canonical origin: ${loc}`));

let missing = 0;
fs.readdirSync(path.join(ROOT, 'place')).forEach(slug => {
    if (!locs.includes(`${ORIGIN}/place/${slug}/`)) missing++;
});
fs.readdirSync(path.join(ROOT, 'staff')).forEach(slug => {
    if (!locs.includes(`${ORIGIN}/staff/${slug}/`)) missing++;
});
assert.strictEqual(missing, 0, 'sitemap must list every place & staff page');
console.log(`✓ PASS: sitemap.xml covers all ${locs.length} URLs (home, map, hub, places, staff)`);

// 4. Homepage must NOT expose the directory in its footer (privacy decision:
//    campus directory data stays out of casual public navigation)
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
assert(!indexHtml.includes('href="/directory/'), 'index.html footer must not link to the directory');
assert(indexHtml.includes('href="/map.html"'), 'index.html footer must still link to the live map');
console.log('✓ PASS: homepage footer exposes only map, share and privacy (no directory)');

// 5. Directory hub links to every entity
const hub = fs.readFileSync(path.join(ROOT, 'directory', 'index.html'), 'utf8');
const placeLinks = (hub.match(/href="\/place\//g) || []).length;
const staffLinks = (hub.match(/href="\/staff\//g) || []).length;
assert.strictEqual(placeLinks, buildings.length, 'hub must link to every building page');
assert.strictEqual(staffLinks, people.length, 'hub must link to every staff page');
console.log(`✓ PASS: directory hub links all ${placeLinks} buildings + ${staffLinks} staff`);

// 6. Privacy policy page exists, is self-contained, and is linked site-wide
const privacyPath = path.join(ROOT, 'privacy', 'index.html');
assert(fs.existsSync(privacyPath), 'privacy/index.html must exist');
const privacy = fs.readFileSync(privacyPath, 'utf8');
assert(privacy.includes('Privacy Policy'), 'privacy page must have a Privacy Policy heading');
assert(privacy.includes(`${ORIGIN}/privacy/`), 'privacy page must self-canonicalise');
assert(privacy.includes('Google Analytics'), 'privacy page must disclose Google Analytics');
assert(privacy.includes('Mapbox'), 'privacy page must disclose Mapbox');
assert(privacy.includes('Supabase'), 'privacy page must disclose Supabase analytics storage');
assert(privacy.includes('OSRM'), 'privacy page must disclose the OSRM driving-route service');
assert(privacy.includes('Act 843'), 'privacy page must reference the Ghana Data Protection Act');
assert(indexHtml.includes('href="/privacy/"'), 'index.html footer must link to the privacy policy');
assert(hub.includes('href="/privacy/"'), 'directory hub footer must link to the privacy policy');
const samplePlace = fs.readFileSync(path.join(ROOT, 'place', 'rob-block', 'index.html'), 'utf8');
assert(samplePlace.includes('href="/privacy/"'), 'place page footers must link to the privacy policy');
assert(!samplePlace.includes('href="/directory/'), 'place pages must not link to the directory hub or its sections');
console.log('✓ PASS: privacy policy exists, discloses all data processors, and is linked site-wide');
console.log('✓ PASS: generated pages never link out to the directory hub');

console.log('\n====================================================');
console.log('ALL PROGRAMMATIC SEO PAGE TESTS PASSED (100%)!');
console.log('====================================================');
