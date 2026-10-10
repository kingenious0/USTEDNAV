/**
 * Automated Test Suite for the Share Loop (viral usage engine)
 * Validates:
 * 1. shareLocation() deep-links recipients into USTED NAV (not openstreetmap.org)
 * 2. Shared links carry UTM attribution parameters
 * 3. map.html records a shared_visit telemetry event on inbound share links
 * 4. Homepage offers a one-tap WhatsApp share entry point
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('=== RUNNING SHARE LOOP TESTS ===\n');

const ROOT = path.join(__dirname, '..');
const mapHtml = fs.readFileSync(path.join(ROOT, 'map.html'), 'utf8');
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// 1. Share links must land inside USTED NAV with a ?q= deep link
assert(!mapHtml.includes('openstreetmap.org/?mlat='), 'shareLocation must no longer send users to OpenStreetMap');
assert(mapHtml.includes('https://www.ustednav.app/map.html?q='), 'shareLocation must deep-link into USTED NAV search');
console.log('✓ PASS: shareLocation deep-links recipients into USTED NAV (no OSM detour)');

// 2. UTM attribution on shared links
assert(
    /map\.html\?q=\$\{encodeURIComponent\(q\)\}&utm_source=share&utm_medium=share&utm_campaign=share_loop/.test(mapHtml),
    'shared links must carry utm_source/medium/campaign for GA attribution'
);
console.log('✓ PASS: shared links carry utm_source=share attribution');

// 3. Breadcrumb extraction: first segment before " - " or " (" becomes the search query
assert(
    mapHtml.includes("String(name || '').split(/\\s*[-–(]\\s*/)[0].trim()"),
    'shareLocation must reduce breadcrumbs like "CBT Building - Ground Floor, Room 20" to a resolvable query'
);
console.log('✓ PASS: breadcrumbs are reduced to a searchable building query');

// 4. Inbound attribution is tracked as a telemetry/GA event
assert(mapHtml.includes("track('shared_visit'"), 'map.html must track shared_visit on inbound share links');
assert(mapHtml.includes("utm_source") && mapHtml.includes('urlParams.get'), 'map.html must read utm_source from the URL');
console.log('✓ PASS: inbound shared visits emit a shared_visit event (Supabase + GA)');

// 5. Homepage WhatsApp share entry point
assert(indexHtml.includes('https://wa.me/?text='), 'index.html footer must offer a WhatsApp share link');
assert(indexHtml.includes('utm_source%3Dwhatsapp'), 'WhatsApp share text must embed utm_source=whatsapp attribution');
assert(indexHtml.includes('www.ustednav.app'), 'WhatsApp share text must include the app URL');
console.log('✓ PASS: homepage provides one-tap WhatsApp app sharing with attribution');

console.log('\n================================================');
console.log('ALL SHARE LOOP TESTS PASSED (100%)!');
console.log('================================================');
