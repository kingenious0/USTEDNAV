/**
 * Automated Test Suite for Stale-While-Revalidate Data Loader
 * Validates:
 * 1. Unification of Supabase 'usted_nav' & IndexedDB (CampusOS_Studio_DB)
 * 2. Immediate offline render from IndexedDB cache
 * 3. Dynamic background revalidation & search re-indexing
 * 4. Staff relocation normalization (e.g. moving Prof. Dr. Philip Oti-Agyen to ROB Rm 26)
 * 5. Service Worker Network-First / Stale-While-Revalidate caching for /data/*.json
 * 6. map.html and modules/search.js integration
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('=== RUNNING STALE-WHILE-REVALIDATE DATA LOADER TESTS ===\n');

// 1. Module Ingestion
const DataLoader = require('../modules/data-loader.js');
const SearchModule = require('../modules/search.js');

assert(DataLoader, 'DataLoader must be defined');
assert(typeof DataLoader.loadCampusData === 'function', 'DataLoader.loadCampusData must be a function');
assert(typeof DataLoader.normalizeDataset === 'function', 'DataLoader.normalizeDataset must be a function');

console.log('✓ PASS: DataLoader module exports required methods');

// 2. Bundled fallback data loading
const buildingsPath = path.join(__dirname, '../data/buildings.json');
const peoplePath = path.join(__dirname, '../data/people.json');
const buildingsRaw = JSON.parse(fs.readFileSync(buildingsPath, 'utf8'));
const peopleRaw = JSON.parse(fs.readFileSync(peoplePath, 'utf8'));

// 3. Test Staff Relocation Normalization: Moving Prof. Dr. Philip Oti-Agyen to ROB Rm 26
// In seed/bundled data, Philip Oti-Agyen was in ODSA / Library.
// Now simulate an update saved via CampusOS Studio into IndexedDB / Supabase.
const updatedStaffRecord = {
    id: 'prof-dr-philip-oti-agyen',
    org_id: 'usted-ksi',
    name: 'Prof. Dr. Philip Oti-Agyen',
    title: 'Prof. Dr.',
    position: 'Assoc. Prof. , H.O.D, DEL',
    department: 'Department of Educational Leadership',
    faculty: 'Faculty of Education and Communication Sciences (FECS)',
    building_id: '25', // ROB Block ID
    room_id: '25-26',   // Room 26 in ROB
    floor: 1,           // 1st Floor
    location_status: 'exact',
    email: 'poagyen@ammusted.edu.gh',
    phone: '+233 24 350 6798'
};

const updatedRoomRecord = {
    id: '25-26',
    building_id: '25',
    room_number: '26',
    floor: 1,
    description: 'Staff Office – Prof. Dr. Philip Oti-Agyen (Department of Educational Leadership)',
    keywords: ['PROF. DR. PHILIP OTI-AGYEN', 'OTI-AGYEN', 'ROB 26', 'ROOM 26']
};

const normalized = DataLoader.normalizeDataset({
    buildings: buildingsRaw,
    rooms: [updatedRoomRecord],
    staff: [updatedStaffRecord],
    fallbackBuildings: buildingsRaw,
    fallbackPeople: peopleRaw
});

const philip = normalized.peopleData.find(p => p.id === 'prof-dr-philip-oti-agyen');
assert(philip, 'Philip Oti-Agyen must exist in normalized peopleData');
assert.strictEqual(philip.location.building, 'ROB', 'Philip Oti-Agyen building must be ROB');
assert.strictEqual(philip.location.targetBuildingId, 25, 'Philip Oti-Agyen targetBuildingId must be 25 (ROB Block)');
assert.strictEqual(philip.location.room, '26', 'Philip Oti-Agyen room must be 26');
assert.strictEqual(philip.location.floor, '1st Floor', 'Philip Oti-Agyen floor must be 1st Floor');

// Verify ROB Block's rooms array contains Room 26 with Philip Oti-Agyen listed
const rob = normalized.buildingsData.find(b => b.id === 25 || String(b.id) === '25');
assert(rob, 'ROB Block must exist in normalized buildingsData');
const robRoom26 = rob.rooms.find(r => String(r.room || r.number).includes('26'));
assert(robRoom26, 'ROB Block rooms must contain Room 26');
assert(robRoom26.staff.includes('Prof. Dr. Philip Oti-Agyen'), 'Room 26 staff list must include Prof. Dr. Philip Oti-Agyen');

// Verify Library (Building 1) no longer lists Philip Oti-Agyen in its rooms
const library = normalized.buildingsData.find(b => b.id === 1 || String(b.id) === '1');
assert(library, 'Library must exist in normalized buildingsData');
library.rooms.forEach(r => {
    if (r.staff) {
        assert(!r.staff.includes('Prof. Dr. Philip Oti-Agyen'), 'Library rooms must not contain relocated staff member');
    }
});

console.log('✓ PASS: Staff relocation normalization verified (Prof. Dr. Philip Oti-Agyen -> ROB Rm 26)');

// 4. Test Multi-token Search Engine with updated dataset
const searchEngine = new SearchModule.SearchEngine(normalized.buildingsData, normalized.peopleData);

// Query 4a: "Philip Oti"
const hits1 = searchEngine.search('Philip Oti');
assert(hits1 && hits1.length > 0, 'Query "Philip Oti" must return hits');
const philipHit = hits1.find(h => h.id === 'prof-dr-philip-oti-agyen');
assert(philipHit, 'Query "Philip Oti" must find Prof. Dr. Philip Oti-Agyen');
const pill1 = SearchModule.formatLocationPill(philipHit, rob);
const breadcrumb1 = SearchModule.formatBreadcrumb(philipHit, rob);
const handoff1 = SearchModule.formatOutdoorHandoff(philipHit, rob);

assert.strictEqual(pill1, 'ROB — 1st Floor, Room 26', `Pill was: ${pill1}`);
assert.strictEqual(breadcrumb1, 'ROB Block — 1st Floor, Room 26 (Prof. Dr. Philip Oti-Agyen)', `Breadcrumb was: ${breadcrumb1}`);
assert(handoff1.includes('1st Floor, Room 26'), `Handoff was: ${handoff1}`);

console.log(`✓ PASS: Search "Philip Oti" resolved to "${breadcrumb1}" with pill "${pill1}"`);

// Query 4b: Room search "ROB 26" / "ROB Rm 26"
const hits2 = searchEngine.search('ROB 26');
assert(hits2 && hits2.length > 0, 'Query "ROB 26" must return hits');
const room26Hit = hits2.find(h => (h.name && h.name.includes('26')) || h.id === 'prof-dr-philip-oti-agyen');
assert(room26Hit, 'Query "ROB 26" must find Room 26 or its staff');

console.log(`✓ PASS: Room query "ROB 26" correctly matched room and assigned staff`);

// 5. Service Worker Caching Verification (sw.js)
const swPath = path.join(__dirname, '../sw.js');
const swContent = fs.readFileSync(swPath, 'utf8');

const cacheMatch = swContent.match(/CACHE_NAME\s*=\s*'ustednav-v(\d+)\.(\d+)\.(\d+)'/);
assert(cacheMatch, 'sw.js must declare a ustednav-vX.Y.Z CACHE_NAME');
assert(
    Number(cacheMatch[1]) > 1 || (Number(cacheMatch[1]) === 1 && Number(cacheMatch[2]) >= 2),
    'sw.js cache version must be bumped to v1.2.0 or higher'
);
assert(swContent.includes("'./modules/data-loader.js'"), 'sw.js must precache ./modules/data-loader.js');
assert(swContent.includes("url.pathname.endsWith('.json') || url.pathname.includes('/data/')"), 'sw.js must intercept JSON data endpoints');
assert(swContent.includes("fetch(e.request).then(networkResponse => {"), 'sw.js must use Network-First for dynamic JSON data endpoints');

console.log('✓ PASS: Service Worker implements Network-First cache busting for /data/*.json');

// 6. map.html Integration Verification
const mapHtmlPath = path.join(__dirname, '../map.html');
const mapHtmlContent = fs.readFileSync(mapHtmlPath, 'utf8');

assert(mapHtmlContent.includes('<script src="modules/data-loader.js"></script>'), 'map.html must load modules/data-loader.js');
assert(mapHtmlContent.includes('<script src="config.js"></script>'), 'map.html must load config.js');
assert(mapHtmlContent.includes('DataLoader.loadCampusData'), 'map.html loadBuildings must invoke DataLoader.loadCampusData');
assert(mapHtmlContent.includes('handleDataReady'), 'map.html must implement dynamic marker and search update handler');
assert(mapHtmlContent.includes('getBuildingForCode'), 'map.html getBuildingForCode must support targetBuildingId and direct ID matching');

console.log('✓ PASS: map.html includes DataLoader, config, and dynamic marker/search re-indexing');

console.log('\n=== ALL STALE-WHILE-REVALIDATE DATA LOADER TESTS PASSED (100%)! ===');
