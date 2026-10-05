/**
 * CampusOS Studio - Admin CMS Application Controller
 * High-performance, offline-first dashboard for managing buildings, room allocations,
 * staff directory, and outdoor entrance doorway pins.
 * 
 * Architecture:
 * - Immediate state hydration from window.CAMPUS_SEED_DATA
 * - Synchronous window action methods for 100% reliable click handling
 * - Global document event delegation (never misses dynamic button clicks or modal events)
 * - Safe lifecycle runner (runs immediately if document is ready, or on DOMContentLoaded)
 */

// =============================================================================
// GLOBAL STATE & DATA CACHES
// =============================================================================

function getInitialData(key, storeName) {
    const raw = (typeof window !== 'undefined' && window.CAMPUS_SEED_DATA && window.CAMPUS_SEED_DATA[key])
        ? [...window.CAMPUS_SEED_DATA[key]]
        : [];
    try {
        const tombstonesRaw = typeof localStorage !== 'undefined' ? localStorage.getItem('campusos_tombstones') : null;
        if (tombstonesRaw) {
            const tombstones = JSON.parse(tombstonesRaw);
            const tableTombstones = tombstones[storeName];
            if (tableTombstones) {
                return raw.filter(item => !tableTombstones[String(item.id)]);
            }
        }
    } catch (e) {}
    return raw;
}

let buildings = getInitialData('buildings', 'buildings');
let rooms = getInitialData('rooms', 'rooms');
let staff = getInitialData('staff', 'staff_directory');
let activeTab = 'buildings';

// Helper for safe HTML escaping in popups and lists
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
window.escapeHtml = escapeHtml;

// Multi-Entrance schema normalizer (supports legacy [lng, lat] and multi-entrance object array)
function normalizeEntrances(raw) {
    if (!raw) return [];
    // Legacy format: [lng, lat]
    if (Array.isArray(raw) && raw.length === 2 && typeof raw[0] === 'number' && typeof raw[1] === 'number') {
        return [{
            id: 'ent-1',
            label: 'Main Entrance',
            coords: [raw[0], raw[1]],
            isPrimary: true
        }];
    }
    // Multi format: array of objects or coordinate pairs
    if (Array.isArray(raw)) {
        let hasPrimary = false;
        const normalized = raw.map((item, idx) => {
            if (!item) return null;
            if (Array.isArray(item.coords) && item.coords.length >= 2) {
                const isPrimary = item.isPrimary === true;
                if (isPrimary && !hasPrimary) hasPrimary = true;
                return {
                    id: String(item.id || `ent-${idx + 1}`),
                    label: String(item.label || (idx === 0 ? 'Main Entrance' : `Entrance ${idx + 1}`)),
                    coords: [Number(item.coords[0]), Number(item.coords[1])],
                    isPrimary: isPrimary
                };
            } else if (Array.isArray(item) && item.length >= 2 && typeof item[0] === 'number') {
                return {
                    id: `ent-${idx + 1}`,
                    label: idx === 0 ? 'Main Entrance' : `Entrance ${idx + 1}`,
                    coords: [Number(item[0]), Number(item[1])],
                    isPrimary: idx === 0
                };
            }
            return null;
        }).filter(Boolean);

        if (normalized.length > 0 && !hasPrimary) {
            normalized[0].isPrimary = true;
        }
        return normalized;
    }
    return [];
}
window.normalizeEntrances = normalizeEntrances;

// Entrance editor state
let editorMap = null;
let selectedBuildingId = null;
let buildingMarker = null;
let buildingPolygonLayer = null;
let entranceMarkers = []; // Array of L.marker instances
let editingEntrances = []; // Array of normalized entrance objects [{ id, label, coords: [lng, lat], isPrimary }]
let isAddingEntrance = false;

// =============================================================================
// TOAST NOTIFICATIONS HELPER
// =============================================================================

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    const color = type === 'success' ? 'bg-emerald-950 border-emerald-500/50 text-emerald-200' :
                  type === 'error' ? 'bg-rose-950 border-rose-500/50 text-rose-200' :
                  'bg-slate-900 border-slate-700 text-slate-200';
    toast.className = `px-4 py-3 rounded-xl border shadow-2xl text-xs font-medium transition duration-300 transform translate-y-2 opacity-0 pointer-events-auto ${color}`;
    toast.textContent = message;
    container.appendChild(toast);

    requestAnimationFrame(() => {
        toast.classList.remove('translate-y-2', 'opacity-0');
    });

    setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-y-2');
        setTimeout(() => toast.remove(), 300);
    }, 3200);
}
window.showToast = showToast;

// =============================================================================
// MODAL CONTROLS
// =============================================================================

function closeAllModals() {
    ['modal-building', 'modal-room', 'modal-staff'].forEach(mId => {
        const modal = document.getElementById(mId);
        if (modal) {
            modal.classList.add('hidden', 'pointer-events-none');
            modal.classList.remove('pointer-events-auto');
            const backdrop = modal.querySelector ? modal.querySelector('.modal-backdrop') : null;
            if (backdrop) {
                backdrop.classList.add('pointer-events-none');
                backdrop.classList.remove('pointer-events-auto');
            }
        }
    });
    // Also close any open combobox dropdowns
    document.querySelectorAll('[id^="dropdown-"][id$="-combobox"]').forEach(d => d.classList.add('hidden'));
}
window.closeAllModals = closeAllModals;

function openModal(modalId) {
    closeAllModals();
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.classList.remove('hidden', 'pointer-events-none');
    modal.classList.add('pointer-events-auto');
    const backdrop = modal.querySelector ? modal.querySelector('.modal-backdrop') : null;
    if (backdrop) {
        backdrop.classList.remove('pointer-events-none');
        backdrop.classList.add('pointer-events-auto');
    }
}
window.openModal = openModal;

function openAddBuildingModal() {
    const form = document.getElementById('form-building');
    const title = document.getElementById('modal-building-title');
    const bId = document.getElementById('building-id');
    if (title) title.textContent = 'Add Campus Building';
    if (form) form.reset();
    if (bId) bId.value = '';
    openModal('modal-building');
}
window.openAddBuildingModal = openAddBuildingModal;

function setRoomPurpose(purpose = 'lecturer_office') {
    const inputPurpose = document.getElementById('room-purpose');
    if (inputPurpose) inputPurpose.value = purpose;

    const descInput = document.getElementById('room-description');
    if (descInput) {
        if (purpose === 'service_desk' || purpose === 'admin_office') {
            descInput.placeholder = 'e.g. Faculty Officer, FBE';
        } else if (purpose === 'lecture_room') {
            descInput.placeholder = 'e.g. Lecture Hall 1, Computer Lab';
        } else {
            descInput.placeholder = 'e.g. Lecturer Office, Staff Suite';
        }
    }

    document.querySelectorAll('.room-purpose-btn').forEach(btn => {
        const btnP = btn.getAttribute('data-purpose');
        const isActive = (btnP === purpose) ||
                         (purpose === 'admin_office' && btnP === 'service_desk') ||
                         (purpose === 'service_desk' && btnP === 'admin_office');
        btn.classList.toggle('bg-brand-600', isActive);
        btn.classList.toggle('text-white', isActive);
        btn.classList.toggle('shadow-sm', isActive);
        btn.classList.toggle('font-semibold', isActive);
        btn.classList.toggle('text-slate-400', !isActive);
        btn.classList.toggle('font-medium', !isActive);
    });
}
window.setRoomPurpose = setRoomPurpose;

function openAddRoomModal() {
    const form = document.getElementById('form-room');
    const title = document.getElementById('modal-room-title');
    const rId = document.getElementById('room-id');
    const rWing = document.getElementById('room-wing');
    if (title) title.textContent = 'Add Room Allocation';
    if (form) form.reset();
    if (rId) rId.value = '';
    if (rWing) rWing.value = '';
    setRoomPurpose('lecturer_office');
    populateDropdowns();
    if (typeof syncBuildingComboboxes === 'function') syncBuildingComboboxes();
    openModal('modal-room');
}
window.openAddRoomModal = openAddRoomModal;

function openAddStaffModal() {
    const form = document.getElementById('form-staff');
    const title = document.getElementById('modal-staff-title');
    const sId = document.getElementById('staff-id');
    if (title) title.textContent = 'Add Staff Member';
    if (form) form.reset();
    if (sId) sId.value = '';
    populateDropdowns();
    const defaultBldgId = buildings.length > 0 ? String(buildings[0].id) : '';
    const staffBuildingSelect = document.getElementById('staff-building-select');
    if (staffBuildingSelect && defaultBldgId) {
        staffBuildingSelect.value = defaultBldgId;
    }
    updateStaffRoomDropdown(defaultBldgId);
    if (typeof syncBuildingComboboxes === 'function') syncBuildingComboboxes();
    openModal('modal-staff');
}
window.openAddStaffModal = openAddStaffModal;

// =============================================================================
// SETTINGS DRAWER CONTROLS
// =============================================================================

function openSettings() {
    const settingsDrawer = document.getElementById('settings-drawer');
    const drawerBackdrop = document.getElementById('drawer-backdrop');
    const inputOrgId = document.getElementById('input-org-id');
    const inputSupabaseUrl = document.getElementById('input-supabase-url');
    const inputSupabaseKey = document.getElementById('input-supabase-key');

    const env = (typeof window !== 'undefined' && window.ENV) ||
                (typeof globalThis !== 'undefined' && globalThis.ENV) || null;
    const cfg = (typeof CampusSync !== 'undefined' && CampusSync.getConfig) ? CampusSync.getConfig() : {};

    if (inputOrgId) inputOrgId.value = cfg.orgId || (env?.orgId) || 'usted-ksi';
    if (inputSupabaseUrl) inputSupabaseUrl.value = cfg.supabaseUrl || (env?.supabaseUrl) || '';
    if (inputSupabaseKey) inputSupabaseKey.value = cfg.supabaseAnonKey || (env?.supabaseKey) || '';

    if (settingsDrawer) {
        settingsDrawer.classList.remove('hidden', 'pointer-events-none');
        settingsDrawer.classList.add('pointer-events-auto');
        if (typeof requestAnimationFrame !== 'undefined') {
            requestAnimationFrame(() => settingsDrawer.classList.remove('opacity-0'));
        } else {
            settingsDrawer.classList.remove('opacity-0');
        }
    }
    if (drawerBackdrop) {
        drawerBackdrop.classList.remove('pointer-events-none');
        drawerBackdrop.classList.add('pointer-events-auto');
    }
}
window.openSettings = openSettings;

function closeSettings() {
    const settingsDrawer = document.getElementById('settings-drawer');
    const drawerBackdrop = document.getElementById('drawer-backdrop');
    if (settingsDrawer) {
        settingsDrawer.classList.add('opacity-0', 'pointer-events-none');
        settingsDrawer.classList.remove('pointer-events-auto');
        setTimeout(() => {
            if (settingsDrawer && settingsDrawer.classList.contains('opacity-0')) {
                settingsDrawer.classList.add('hidden');
            }
        }, 300);
    }
    if (drawerBackdrop) {
        drawerBackdrop.classList.add('pointer-events-none');
        drawerBackdrop.classList.remove('pointer-events-auto');
    }
}
window.closeSettings = closeSettings;

// =============================================================================
// SIDEBAR CONTROLS (MOBILE)
// =============================================================================

function openMobileSidebar() {
    const appSidebar = document.getElementById('app-sidebar');
    const mobileBackdrop = document.getElementById('mobile-sidebar-backdrop');
    if (appSidebar) appSidebar.classList.remove('-translate-x-full');
    if (mobileBackdrop) {
        mobileBackdrop.classList.remove('hidden', 'pointer-events-none');
        mobileBackdrop.classList.add('pointer-events-auto');
    }
}
window.openMobileSidebar = openMobileSidebar;

function closeMobileSidebar() {
    const appSidebar = document.getElementById('app-sidebar');
    const mobileBackdrop = document.getElementById('mobile-sidebar-backdrop');
    if (appSidebar) appSidebar.classList.add('-translate-x-full');
    if (mobileBackdrop) {
        mobileBackdrop.classList.add('hidden', 'pointer-events-none');
        mobileBackdrop.classList.remove('pointer-events-auto');
    }
}
window.closeMobileSidebar = closeMobileSidebar;

// =============================================================================
// TAB SWITCHING
// =============================================================================

function switchTab(tabName) {
    if (!tabName) return;
    activeTab = tabName;

    // 1. Update Desktop Sidebar Buttons
    document.querySelectorAll('.nav-tab-btn').forEach(b => {
        const isMatch = b.getAttribute('data-tab') === tabName;
        b.classList.toggle('active', isMatch);
        b.classList.toggle('bg-brand-600/20', isMatch);
        b.classList.toggle('text-brand-300', isMatch);
        b.classList.toggle('border-brand-500/30', isMatch);
        b.classList.toggle('text-slate-400', !isMatch);
    });

    // 2. Update Mobile Bottom Nav Buttons
    document.querySelectorAll('.mobile-nav-btn').forEach(b => {
        const isMatch = b.getAttribute('data-tab') === tabName;
        b.classList.toggle('text-brand-400', isMatch);
        b.classList.toggle('text-slate-400', !isMatch);
    });

    // 3. Toggle View Panels
    const viewMap = {
        buildings: document.getElementById('view-buildings'),
        rooms: document.getElementById('view-rooms'),
        staff: document.getElementById('view-staff'),
        'entrance-editor': document.getElementById('view-entrance-editor'),
        'sync-queue': document.getElementById('view-sync-queue'),
        analytics: document.getElementById('view-analytics')
    };

    Object.keys(viewMap).forEach(vKey => {
        if (viewMap[vKey]) {
            viewMap[vKey].classList.toggle('hidden', vKey !== tabName);
        }
    });

    // 4. Trigger Map Resize if entering editor
    if (tabName === 'entrance-editor') {
        setTimeout(initOrResizeEditorMap, 150);
    }

    renderCurrentTab();
}
window.switchTab = switchTab;

function renderCurrentTab() {
    if (activeTab === 'buildings') renderBuildings();
    else if (activeTab === 'rooms') renderRooms();
    else if (activeTab === 'staff') renderStaff();
    else if (activeTab === 'entrance-editor') renderEditorBuildingList();
    else if (activeTab === 'sync-queue') renderSyncQueue();
    else if (activeTab === 'analytics') renderAnalyticsDashboard();
}
window.renderCurrentTab = renderCurrentTab;

// =============================================================================
// 1. BUILDINGS CONTROLLER
// =============================================================================

function renderBuildings() {
    const tableBody = document.getElementById('buildings-table-body');
    const mobileCards = document.getElementById('buildings-mobile-cards');
    const searchInput = document.getElementById('search-buildings');
    const query = (searchInput ? searchInput.value : '').trim().toLowerCase();

    const filtered = buildings.filter(b => {
        return (b.name && b.name.toLowerCase().includes(query)) ||
               (b.code && b.code.toLowerCase().includes(query)) ||
               (b.type && b.type.toLowerCase().includes(query));
    });

    // Update count badge
    const badge = document.getElementById('badge-buildings-count');
    if (badge) badge.textContent = buildings.length;

    // Render Desktop Table
    if (tableBody) {
        if (filtered.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="7" class="p-6 text-center text-slate-500 italic">No buildings match your search.</td></tr>`;
        } else {
            tableBody.innerHTML = filtered.map(b => {
                const hasEntrance = Array.isArray(b.entrance) && b.entrance.length >= 2;
                const entranceBadge = hasEntrance ?
                    `<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1 w-fit">
                        <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> Set [${b.entrance[1].toFixed(5)}, ${b.entrance[0].toFixed(5)}]
                     </span>` :
                    `<span class="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-800 text-slate-400 border border-slate-700/60">Not Set</span>`;

                const latFormatted = typeof b.lat === 'number' ? b.lat.toFixed(5) : b.lat;
                const lngFormatted = typeof b.lng === 'number' ? b.lng.toFixed(5) : b.lng;

                return `
                    <tr class="hover:bg-slate-800/30 transition">
                        <td class="p-3.5 font-mono font-semibold text-slate-200">${b.code || b.id}</td>
                        <td class="p-3.5 font-medium text-white">${b.name}</td>
                        <td class="p-3.5 capitalize text-slate-400"><span class="px-2 py-0.5 rounded bg-slate-800 text-slate-300">${b.type || 'academic'}</span></td>
                        <td class="p-3.5 font-mono text-slate-400">${latFormatted}, ${lngFormatted}</td>
                        <td class="p-3.5">${entranceBadge}</td>
                        <td class="p-3.5 text-slate-400">${b.hours || '—'}</td>
                        <td class="p-3.5 text-right space-x-1.5 whitespace-nowrap">
                            <button data-action="edit-building" data-id="${b.id}" onclick="event.stopPropagation(); window.editBuilding('${b.id}')" class="px-2.5 py-1 rounded-lg text-xs font-medium text-brand-400 hover:bg-brand-500/10 transition cursor-pointer">Edit</button>
                            <button data-action="pin-building" data-id="${b.id}" onclick="event.stopPropagation(); window.jumpToEntranceEditor('${b.id}')" class="px-2.5 py-1 rounded-lg text-xs font-medium text-emerald-400 hover:bg-emerald-500/10 transition cursor-pointer">Pin Doorway</button>
                            <button data-action="delete-building" data-id="${b.id}" onclick="event.stopPropagation(); window.deleteBuilding('${b.id}')" class="px-2.5 py-1 rounded-lg text-xs font-medium text-rose-400 hover:bg-rose-500/10 transition cursor-pointer">Delete</button>
                        </td>
                    </tr>
                `;
            }).join('');
        }
    }

    // Render Mobile Responsive Cards
    if (mobileCards) {
        if (filtered.length === 0) {
            mobileCards.innerHTML = `<div class="p-6 text-center text-slate-500 italic">No buildings found.</div>`;
        } else {
            mobileCards.innerHTML = filtered.map(b => {
                const hasEntrance = Array.isArray(b.entrance) && b.entrance.length >= 2;
                const latFormatted = typeof b.lat === 'number' ? b.lat.toFixed(5) : b.lat;
                const lngFormatted = typeof b.lng === 'number' ? b.lng.toFixed(5) : b.lng;

                return `
                    <div class="p-4 rounded-2xl bg-slate-900 border border-slate-800/80 shadow-sm space-y-2.5">
                        <div class="flex items-start justify-between gap-2">
                            <div>
                                <div class="font-bold text-white text-sm">${b.name}</div>
                                <div class="text-[11px] text-slate-400 font-mono mt-0.5">Code: ${b.code || b.id} • <span class="capitalize text-slate-300">${b.type || 'academic'}</span></div>
                            </div>
                            ${hasEntrance ? 
                                `<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0">Doorway Pin Set</span>` : 
                                `<span class="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-800 text-slate-400 shrink-0">Centroid Only</span>`
                            }
                        </div>
                        <div class="text-[11px] text-slate-400 font-mono">Coords: ${latFormatted}, ${lngFormatted}</div>
                        <div class="flex items-center justify-end gap-2 pt-1 border-t border-slate-800/60">
                            <button data-action="edit-building" data-id="${b.id}" onclick="event.stopPropagation(); window.editBuilding('${b.id}')" class="px-3 py-1.5 rounded-xl text-xs font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 touch-btn cursor-pointer">Edit</button>
                            <button data-action="pin-building" data-id="${b.id}" onclick="event.stopPropagation(); window.jumpToEntranceEditor('${b.id}')" class="px-3 py-1.5 rounded-xl text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 touch-btn cursor-pointer">Pin Doorway</button>
                            <button data-action="delete-building" data-id="${b.id}" onclick="event.stopPropagation(); window.deleteBuilding('${b.id}')" class="px-3 py-1.5 rounded-xl text-xs font-medium text-rose-400 hover:bg-rose-500/10 touch-btn cursor-pointer">Delete</button>
                        </div>
                    </div>
                `;
            }).join('');
        }
    }
}
window.renderBuildings = renderBuildings;

function editBuilding(id) {
    const b = buildings.find(x => x.id === id);
    if (!b) return;
    const title = document.getElementById('modal-building-title');
    if (title) title.textContent = 'Edit Building';
    const bId = document.getElementById('building-id');
    if (bId) bId.value = b.id;
    const bName = document.getElementById('building-name');
    if (bName) bName.value = b.name || '';
    const bCode = document.getElementById('building-code');
    if (bCode) bCode.value = b.code || '';
    const bType = document.getElementById('building-type');
    if (bType) bType.value = b.type || 'academic';
    const bLat = document.getElementById('building-lat');
    if (bLat) bLat.value = b.lat;
    const bLng = document.getElementById('building-lng');
    if (bLng) bLng.value = b.lng;
    const bDesc = document.getElementById('building-description');
    if (bDesc) bDesc.value = b.description || '';
    openModal('modal-building');
}
window.editBuilding = editBuilding;

async function deleteBuilding(id) {
    if (!confirm('Are you sure you want to delete this building? Connected rooms and staff links may be affected.')) return;
    try {
        if (typeof CampusSync !== 'undefined' && CampusSync.deleteRecord) {
            await CampusSync.deleteRecord('buildings', id);
        }
        buildings = buildings.filter(b => String(b.id) !== String(id));
        if (typeof window !== 'undefined' && window.CAMPUS_SEED_DATA && window.CAMPUS_SEED_DATA.buildings) {
            window.CAMPUS_SEED_DATA.buildings = window.CAMPUS_SEED_DATA.buildings.filter(b => String(b.id) !== String(id));
        }
        showToast('Building deleted', 'success');
        await refreshData();
    } catch (err) {
        showToast('Error deleting building: ' + err.message, 'error');
    }
}
window.deleteBuilding = deleteBuilding;

// =============================================================================
// 2. ROOMS CONTROLLER
// =============================================================================

function renderRooms() {
    const tableBody = document.getElementById('rooms-table-body');
    const mobileCards = document.getElementById('rooms-mobile-cards');
    const searchInput = document.getElementById('search-rooms');
    const filterBldg = document.getElementById('filter-rooms-building');

    const query = (searchInput ? searchInput.value : '').trim().toLowerCase();
    const bFilter = filterBldg ? filterBldg.value : '';

    const bldgMap = new Map(buildings.map(b => [b.id, b]));

    const filtered = rooms.filter(r => {
        const matchesBldg = !bFilter || r.building_id === bFilter;
        const bName = bldgMap.get(r.building_id)?.name || '';
        const matchesQuery = !query ||
            (r.room_number && r.room_number.toLowerCase().includes(query)) ||
            (r.description && r.description.toLowerCase().includes(query)) ||
            bName.toLowerCase().includes(query) ||
            (r.keywords && r.keywords.some(k => k.toLowerCase().includes(query)));
        return matchesBldg && matchesQuery;
    });

    // Update count badge
    const badge = document.getElementById('badge-rooms-count');
    if (badge) badge.textContent = rooms.length;

    // Desktop Table
    if (tableBody) {
        if (filtered.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-slate-500 italic">No room allocations match your criteria.</td></tr>`;
        } else {
            tableBody.innerHTML = filtered.map(r => {
                const bldg = bldgMap.get(r.building_id);
                const bldgName = bldg ? `${bldg.name} (${bldg.code || bldg.id})` : (r.building_id || 'Unknown Block');
                const floorText = r.floor === 0 ? 'Ground' : (r.floor === 1 ? '1st Floor' : (r.floor === 2 ? '2nd Floor' : `Floor ${r.floor}`));
                const meta = r.metadata || {};
                const wingText = meta.wing ? (String(meta.wing).endsWith('Wing') ? meta.wing : `${meta.wing} Wing`) : '';
                const floorWingDisplay = wingText ? `${floorText} · ${wingText}` : floorText;

                const purp = meta.purpose;
                let purpBadge = '';
                if (purp === 'service_desk' || purp === 'admin_office') {
                    purpBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/20">Admin Office</span>';
                } else if (purp === 'lecture_room') {
                    purpBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/10 text-blue-300 border border-blue-500/20">Lecture / Lab</span>';
                } else if (purp === 'lecturer_office') {
                    purpBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">Lecturer Office</span>';
                }

                return `
                    <tr class="hover:bg-slate-800/30 transition">
                        <td class="p-3.5 font-bold font-mono text-white">
                            <div class="flex items-center gap-1.5">
                                <span>${r.room_number}</span>
                                ${purpBadge}
                            </div>
                        </td>
                        <td class="p-3.5 text-slate-300 font-medium">${bldgName}</td>
                        <td class="p-3.5"><span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">${floorWingDisplay}</span></td>
                        <td class="p-3.5 text-slate-400">${r.description || '—'}</td>
                        <td class="p-3.5 text-slate-500 font-mono text-[11px]">${(r.keywords || []).slice(0, 3).join(', ')}</td>
                        <td class="p-3.5 text-right space-x-2 whitespace-nowrap">
                            <button data-action="edit-room" data-id="${r.id}" onclick="event.stopPropagation(); window.editRoom('${r.id}')" class="px-2.5 py-1 rounded-lg text-xs font-medium text-brand-400 hover:bg-brand-500/10 transition cursor-pointer">Edit</button>
                            <button data-action="delete-room" data-id="${r.id}" onclick="event.stopPropagation(); window.deleteRoom('${r.id}')" class="px-2.5 py-1 rounded-lg text-xs font-medium text-rose-400 hover:bg-rose-500/10 transition cursor-pointer">Delete</button>
                        </td>
                    </tr>
                `;
            }).join('');
        }
    }

    // Mobile Cards
    if (mobileCards) {
        if (filtered.length === 0) {
            mobileCards.innerHTML = `<div class="p-6 text-center text-slate-500 italic">No room allocations found.</div>`;
        } else {
            mobileCards.innerHTML = filtered.map(r => {
                const bldg = bldgMap.get(r.building_id);
                const bldgName = bldg ? `${bldg.name}` : (r.building_id || 'Unknown Block');
                const floorText = r.floor === 0 ? 'Ground Floor' : (r.floor === 1 ? '1st Floor' : (r.floor === 2 ? '2nd Floor' : `Floor ${r.floor}`));
                const meta = r.metadata || {};
                const wingText = meta.wing ? (String(meta.wing).endsWith('Wing') ? meta.wing : `${meta.wing} Wing`) : '';
                const floorWingDisplay = wingText ? `${floorText} · ${wingText}` : floorText;

                const purp = meta.purpose;
                let purpBadge = '';
                if (purp === 'service_desk' || purp === 'admin_office') {
                    purpBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/20">Admin Office</span>';
                } else if (purp === 'lecture_room') {
                    purpBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/10 text-blue-300 border border-blue-500/20">Lecture / Lab</span>';
                } else if (purp === 'lecturer_office') {
                    purpBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">Lecturer Office</span>';
                }

                return `
                    <div class="p-4 rounded-2xl bg-slate-900 border border-slate-800/80 shadow-sm space-y-2">
                        <div class="flex items-start justify-between gap-2">
                            <div>
                                <div class="flex items-center gap-1.5">
                                    <span class="font-bold text-white text-sm">Room ${r.room_number}</span>
                                    ${purpBadge}
                                </div>
                                <div class="text-xs text-slate-400 mt-0.5 font-medium">${bldgName}</div>
                            </div>
                            <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 shrink-0">${floorWingDisplay}</span>
                        </div>
                        ${r.description ? `<div class="text-xs text-slate-300">${r.description}</div>` : ''}
                        <div class="flex items-center justify-end gap-2 pt-1 border-t border-slate-800/60">
                            <button data-action="edit-room" data-id="${r.id}" onclick="event.stopPropagation(); window.editRoom('${r.id}')" class="px-3 py-1.5 rounded-xl text-xs font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 touch-btn cursor-pointer">Edit</button>
                            <button data-action="delete-room" data-id="${r.id}" onclick="event.stopPropagation(); window.deleteRoom('${r.id}')" class="px-3 py-1.5 rounded-xl text-xs font-medium text-rose-400 hover:bg-rose-500/10 touch-btn cursor-pointer">Delete</button>
                        </div>
                    </div>
                `;
            }).join('');
        }
    }
}
window.renderRooms = renderRooms;

function editRoom(id) {
    const r = rooms.find(x => x.id === id);
    if (!r) return;
    populateDropdowns();
    const title = document.getElementById('modal-room-title');
    if (title) title.textContent = 'Edit Room Allocation';
    const rId = document.getElementById('room-id');
    if (rId) rId.value = r.id;
    const roomBuildingSelect = document.getElementById('room-building-select');
    if (roomBuildingSelect) roomBuildingSelect.value = r.building_id;
    const rNum = document.getElementById('room-number');
    if (rNum) rNum.value = r.room_number;
    const rFloor = document.getElementById('room-floor');
    if (rFloor) rFloor.value = r.floor;
    const rWing = document.getElementById('room-wing');
    const meta = r.metadata || {};
    if (rWing) rWing.value = meta.wing || '';
    const rDesc = document.getElementById('room-description');
    if (rDesc) rDesc.value = r.description || '';
    const rKeywords = document.getElementById('room-keywords');
    if (rKeywords) rKeywords.value = (r.keywords || []).join(', ');

    // Hydrate purpose toggle
    const purpose = meta.purpose || (
        /exam|officer|secretariat|service desk|admin office|dean/i.test(r.description || '') ? 'service_desk' :
        /lecture|lab|hall|theatre|auditorium|classroom/i.test(r.description || '') ? 'lecture_room' : 'lecturer_office'
    );
    setRoomPurpose(purpose);
    if (typeof syncBuildingComboboxes === 'function') syncBuildingComboboxes();

    openModal('modal-room');
}
window.editRoom = editRoom;

async function deleteRoom(id) {
    if (!confirm('Are you sure you want to delete this room allocation?')) return;
    try {
        if (typeof CampusSync !== 'undefined' && CampusSync.deleteRecord) {
            await CampusSync.deleteRecord('rooms', id);
        }
        rooms = rooms.filter(r => String(r.id) !== String(id));
        if (typeof window !== 'undefined' && window.CAMPUS_SEED_DATA && window.CAMPUS_SEED_DATA.rooms) {
            window.CAMPUS_SEED_DATA.rooms = window.CAMPUS_SEED_DATA.rooms.filter(r => String(r.id) !== String(id));
        }
        showToast('Room deleted', 'success');
        await refreshData();
    } catch (err) {
        showToast('Error deleting room: ' + err.message, 'error');
    }
}
window.deleteRoom = deleteRoom;

// =============================================================================
// 3. STAFF DIRECTORY CONTROLLER
// =============================================================================

function renderStaff() {
    const tableBody = document.getElementById('staff-table-body');
    const mobileCards = document.getElementById('staff-mobile-cards');
    const searchInput = document.getElementById('search-staff');
    const filterDept = document.getElementById('filter-staff-department');

    const query = (searchInput ? searchInput.value : '').trim().toLowerCase();
    const deptFilter = filterDept ? filterDept.value : '';

    const bldgMap = new Map(buildings.map(b => [b.id, b]));
    const roomMap = new Map(rooms.map(r => [r.id, r]));

    const filtered = staff.filter(s => {
        const matchesDept = !deptFilter || s.department === deptFilter;
        const matchesQuery = !query ||
            (s.name && s.name.toLowerCase().includes(query)) ||
            (s.department && s.department.toLowerCase().includes(query)) ||
            (s.position && s.position.toLowerCase().includes(query)) ||
            (s.email && s.email.toLowerCase().includes(query));
        return matchesDept && matchesQuery;
    });

    // Update count badge
    const badge = document.getElementById('badge-staff-count');
    if (badge) badge.textContent = staff.length;

    // Desktop Table
    if (tableBody) {
        if (filtered.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-slate-500 italic">No staff records match your criteria.</td></tr>`;
        } else {
            tableBody.innerHTML = filtered.map(s => {
                const bldg = bldgMap.get(s.building_id);
                const room = roomMap.get(s.room_id);

                let locPill = `<span class="text-slate-500 italic text-[11px]">Unassigned</span>`;
                if (bldg && room) {
                    locPill = `<span class="px-2 py-0.5 rounded-md text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">📍 ${bldg.code || bldg.short_name || bldg.name} — Rm ${room.room_number}</span>`;
                } else if (bldg) {
                    locPill = `<span class="px-2 py-0.5 rounded-md text-[11px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">📍 ${bldg.code || bldg.short_name || bldg.name} (Block Only)</span>`;
                }

                return `
                    <tr class="hover:bg-slate-800/30 transition">
                        <td class="p-3.5">
                            <div class="font-bold text-white">${s.title ? s.title + ' ' : ''}${s.name}</div>
                        </td>
                        <td class="p-3.5 text-slate-300">${s.position || 'Lecturer'}</td>
                        <td class="p-3.5 text-slate-400">
                            <div class="font-medium text-slate-300">${s.department || '—'}</div>
                            <div class="text-[10px] text-slate-500">${s.faculty || ''}</div>
                        </td>
                        <td class="p-3.5">${locPill}</td>
                        <td class="p-3.5 font-mono text-[11px] text-slate-400">
                            <div>${s.email || '—'}</div>
                            <div class="text-slate-500">${s.phone || ''}</div>
                        </td>
                        <td class="p-3.5 text-right space-x-2 whitespace-nowrap">
                            <button data-action="edit-staff" data-id="${s.id}" onclick="event.stopPropagation(); window.editStaff('${s.id}')" class="px-2.5 py-1 rounded-lg text-xs font-medium text-brand-400 hover:bg-brand-500/10 transition cursor-pointer">Edit</button>
                            <button data-action="delete-staff" data-id="${s.id}" onclick="event.stopPropagation(); window.deleteStaff('${s.id}')" class="px-2.5 py-1 rounded-lg text-xs font-medium text-rose-400 hover:bg-rose-500/10 transition cursor-pointer">Delete</button>
                        </td>
                    </tr>
                `;
            }).join('');
        }
    }

    // Mobile Cards
    if (mobileCards) {
        if (filtered.length === 0) {
            mobileCards.innerHTML = `<div class="p-6 text-center text-slate-500 italic">No staff members found.</div>`;
        } else {
            mobileCards.innerHTML = filtered.map(s => {
                const bldg = bldgMap.get(s.building_id);
                const room = roomMap.get(s.room_id);

                let locText = 'No Office Assigned';
                if (bldg && room) locText = `📍 ${bldg.code || bldg.short_name || bldg.name} — Rm ${room.room_number}`;
                else if (bldg) locText = `📍 ${bldg.code || bldg.short_name || bldg.name} (Block Only)`;

                return `
                    <div class="p-4 rounded-2xl bg-slate-900 border border-slate-800/80 shadow-sm space-y-2">
                        <div class="flex items-start justify-between gap-2">
                            <div>
                                <div class="font-bold text-white text-sm">${s.title ? s.title + ' ' : ''}${s.name}</div>
                                <div class="text-xs text-slate-400 mt-0.5">${s.position || 'Lecturer'} • ${s.department || ''}</div>
                            </div>
                        </div>
                        <div class="text-xs font-medium text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-lg w-fit border border-emerald-500/20">${locText}</div>
                        ${s.email ? `<div class="text-[11px] text-slate-400 font-mono">${s.email}</div>` : ''}
                        <div class="flex items-center justify-end gap-2 pt-1 border-t border-slate-800/60">
                            <button data-action="edit-staff" data-id="${s.id}" onclick="event.stopPropagation(); window.editStaff('${s.id}')" class="px-3 py-1.5 rounded-xl text-xs font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 touch-btn cursor-pointer">Edit</button>
                            <button data-action="delete-staff" data-id="${s.id}" onclick="event.stopPropagation(); window.deleteStaff('${s.id}')" class="px-3 py-1.5 rounded-xl text-xs font-medium text-rose-400 hover:bg-rose-500/10 touch-btn cursor-pointer">Delete</button>
                        </div>
                    </div>
                `;
            }).join('');
        }
    }
}
window.renderStaff = renderStaff;

function updateStaffRoomDropdown(buildingId, selectedRoomId = '') {
    const staffRoomSelect = document.getElementById('staff-room-select');
    if (!staffRoomSelect) return;
    staffRoomSelect.innerHTML = '<option value="">(No Room Assigned)</option>';
    if (!buildingId) {
        if (typeof syncStaffRoomCombobox === 'function') {
            syncStaffRoomCombobox('', '', []);
        }
        return;
    }

    // Filter to only display rooms assigned to academic staff (lecturer offices)
    // Exclude designated service desks / admin offices (e.g. Faculty Officer, Exams Office) and lecture halls
    const bldgRooms = rooms.filter(r => {
        const isBldg = r.building_id === buildingId || String(r.building_id) === String(buildingId);
        if (!isBldg) return false;

        // Retain currently assigned room for editing continuity
        if (selectedRoomId && (r.id === selectedRoomId || String(r.id) === String(selectedRoomId))) {
            return true;
        }

        const meta = r.metadata || {};
        const purpose = meta.purpose || '';

        // If explicitly tagged as lecturer_office, include it
        if (purpose === 'lecturer_office') return true;

        // If explicitly tagged as service desk / admin office or lecture room, exclude it
        if (purpose === 'service_desk' || purpose === 'admin_office' || purpose === 'lecture_room' || purpose === 'lecture_hall') {
            return false;
        }

        // For untagged/legacy rooms, keep independent service desks & lecture halls out of lecturer assignment
        const desc = (r.description || '').toLowerCase();
        const isExcludedDeskOrHall = /exam|faculty officer|secretariat|service desk|dean'?s office|hall|lab|lecture|auditorium|theatre/i.test(desc);
        return !isExcludedDeskOrHall;
    });

    bldgRooms.forEach(room => {
        const opt = document.createElement('option');
        opt.value = room.id;

        const floorStr = room.floor === 0 ? 'Ground' : `Floor ${room.floor}`;
        let cleanRoomNo = String(room.room_number || '').trim();
        if (/^room\s+/i.test(cleanRoomNo)) {
            cleanRoomNo = cleanRoomNo.replace(/^room\s+/i, '').trim();
        }
        const roomTitle = cleanRoomNo ? `Room ${cleanRoomNo}` : 'Room';
        const meta = room.metadata;

        if (meta && (meta.wing || meta.type)) {
            const wingStr = meta.wing ? (String(meta.wing).endsWith('Wing') ? meta.wing : `${meta.wing} Wing`) : '';
            const typeStr = meta.type || room.description || '';
            const parts = [floorStr, wingStr, typeStr].filter(Boolean);
            opt.textContent = `${roomTitle} (${parts.join(' · ')})`;
        } else {
            opt.textContent = `${roomTitle} (${floorStr} - ${room.description || 'Room'})`;
        }

        if (room.id === selectedRoomId || String(room.id) === String(selectedRoomId)) opt.selected = true;
        staffRoomSelect.appendChild(opt);
    });

    if (typeof syncStaffRoomCombobox === 'function') {
        syncStaffRoomCombobox(buildingId, selectedRoomId, bldgRooms);
    }
}
window.updateStaffRoomDropdown = updateStaffRoomDropdown;

function editStaff(id) {
    const s = staff.find(x => x.id === id);
    if (!s) return;
    populateDropdowns();
    const title = document.getElementById('modal-staff-title');
    if (title) title.textContent = 'Edit Staff Member';
    const sId = document.getElementById('staff-id');
    if (sId) sId.value = s.id;
    const sTitle = document.getElementById('staff-title');
    if (sTitle) sTitle.value = s.title || '';
    const sName = document.getElementById('staff-name');
    if (sName) sName.value = s.name;
    const sPos = document.getElementById('staff-position');
    if (sPos) sPos.value = s.position || '';
    const sDept = document.getElementById('staff-department');
    if (sDept) sDept.value = s.department || '';
    const staffBuildingSelect = document.getElementById('staff-building-select');
    if (staffBuildingSelect) staffBuildingSelect.value = s.building_id || '';
    updateStaffRoomDropdown(s.building_id || '', s.room_id || '');
    const sEmail = document.getElementById('staff-email');
    if (sEmail) sEmail.value = s.email || '';
    const sPhone = document.getElementById('staff-phone');
    if (sPhone) sPhone.value = s.phone || '';
    if (typeof syncBuildingComboboxes === 'function') syncBuildingComboboxes();
    openModal('modal-staff');
}
window.editStaff = editStaff;

async function deleteStaff(id) {
    if (!confirm('Are you sure you want to delete this staff record?')) return;
    try {
        if (typeof CampusSync !== 'undefined' && CampusSync.deleteRecord) {
            await CampusSync.deleteRecord('staff_directory', id);
        }
        staff = staff.filter(s => String(s.id) !== String(id));
        if (typeof window !== 'undefined' && window.CAMPUS_SEED_DATA && window.CAMPUS_SEED_DATA.staff) {
            window.CAMPUS_SEED_DATA.staff = window.CAMPUS_SEED_DATA.staff.filter(s => String(s.id) !== String(id));
        }
        showToast('Staff member deleted', 'success');
        await refreshData();
    } catch (err) {
        showToast('Error deleting staff: ' + err.message, 'error');
    }
}
window.deleteStaff = deleteStaff;

// =============================================================================
// 4. OUTDOOR ENTRANCE SPATIAL EDITOR (LEAFLET)
// =============================================================================

function initOrResizeEditorMap() {
    const mapEl = document.getElementById('editor-map');
    if (!mapEl) return;

    if (typeof L === 'undefined') {
        console.warn('[Editor] Leaflet library not loaded.');
        return;
    }

    if (!editorMap) {
        editorMap = L.map('editor-map', {
            center: [6.6985, -1.6815],
            zoom: 17,
            maxZoom: 22
        });

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 22,         // Allows zooming right into doorways
            maxNativeZoom: 19,   // Tells Leaflet that tiles stop at 19 and to scale/stretch them rather than requesting 404 tiles
            attribution: '&copy; OpenStreetMap contributors'
        }).addTo(editorMap);

        editorMap.on('click', (e) => {
            if (!selectedBuildingId) {
                showToast('Please select a building from the list first', 'info');
                return;
            }
            const lat = e.latlng.lat;
            const lng = e.latlng.lng;

            // If in Add Entrance mode OR if there are currently no entrances
            if (isAddingEntrance || editingEntrances.length === 0) {
                const isFirst = editingEntrances.length === 0;
                const newEnt = {
                    id: 'ent-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
                    label: isFirst ? 'Main Entrance' : `Entrance ${editingEntrances.length + 1}`,
                    coords: [Number(lng.toFixed(6)), Number(lat.toFixed(6))],
                    isPrimary: isFirst
                };
                editingEntrances.push(newEnt);
                isAddingEntrance = false;
                updateAddEntranceButtonUI();
                renderEntranceMarkers();
                markEntranceDirty();

                // Auto-open popup on newly created marker
                const lastMarker = entranceMarkers[entranceMarkers.length - 1];
                if (lastMarker) lastMarker.openPopup();
                showToast(`Placed ${newEnt.label}. Click the pin to edit label or set as primary.`, 'success');
            } else {
                showToast('Click "Add Another Entrance" to place a new doorway, or drag existing pins to reposition.', 'info');
            }
        });
    }

    setTimeout(() => {
        if (editorMap) editorMap.invalidateSize();
    }, 200);
}
window.initOrResizeEditorMap = initOrResizeEditorMap;

function updateAddEntranceButtonUI() {
    const btn = document.getElementById('btn-add-entrance');
    const textEl = document.getElementById('btn-add-entrance-text');
    if (!btn) return;

    if (!selectedBuildingId) {
        btn.disabled = true;
        btn.className = 'px-3 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 border border-slate-700 transition flex items-center justify-center gap-1.5 shrink-0 touch-btn cursor-pointer';
        if (textEl) textEl.textContent = 'Add Another Entrance';
        return;
    }

    btn.disabled = false;
    if (isAddingEntrance) {
        btn.className = 'px-3 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white ring-2 ring-emerald-400 transition flex items-center justify-center gap-1.5 shrink-0 touch-btn cursor-pointer animate-pulse';
        if (textEl) textEl.textContent = 'Cancel Adding';
    } else {
        btn.className = 'px-3 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition flex items-center justify-center gap-1.5 shrink-0 touch-btn cursor-pointer';
        if (textEl) textEl.textContent = 'Add Another Entrance';
    }
}
window.updateAddEntranceButtonUI = updateAddEntranceButtonUI;

function updateInstructionPill() {
    const pill = document.getElementById('editor-instruction-pill');
    if (!pill) return;
    const inner = pill.firstElementChild;
    if (!inner) return;

    if (!selectedBuildingId) {
        inner.textContent = 'Select a building from the list to view or edit doorway pins.';
        return;
    }

    const b = buildings.find(x => x.id === selectedBuildingId);
    const bName = b ? b.name : 'Selected Building';

    if (isAddingEntrance) {
        inner.innerHTML = `<span class="text-emerald-400 font-semibold">📍 Click anywhere on the map</span> to place Entrance #${editingEntrances.length + 1} for <strong>${escapeHtml(bName)}</strong>.`;
    } else if (editingEntrances.length === 0) {
        inner.innerHTML = `No doorway set for <strong>${escapeHtml(bName)}</strong>. Click map to place its first entrance pin.`;
    } else {
        const count = editingEntrances.length;
        inner.innerHTML = `<strong>${escapeHtml(bName)}</strong>: ${count} entrance${count === 1 ? '' : 's'} configured. Click a pin to edit, drag to reposition, or click "Add Another Entrance".`;
    }
}
window.updateInstructionPill = updateInstructionPill;

function markEntranceDirty() {
    const btnSaveEntrance = document.getElementById('btn-save-entrance');
    if (btnSaveEntrance) btnSaveEntrance.disabled = false;
    updateInstructionPill();
}
window.markEntranceDirty = markEntranceDirty;

function clearEntranceMarkers() {
    if (!editorMap) return;
    entranceMarkers.forEach(m => {
        try { editorMap.removeLayer(m); } catch (e) {}
    });
    entranceMarkers = [];
}
window.clearEntranceMarkers = clearEntranceMarkers;

function getEntrancePopupHtml(ent, badgeNumber) {
    const isPrimary = ent.isPrimary === true;
    return `
        <div class="p-2 min-w-[220px] text-slate-800 text-xs">
            <div class="flex items-center justify-between gap-2 mb-2 pb-1.5 border-b border-slate-200">
                <span class="font-bold text-slate-900 text-sm">Doorway #${badgeNumber}</span>
                ${isPrimary ? '<span class="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-1.5 py-0.5 rounded-full border border-emerald-300">★ Primary</span>' : ''}
            </div>
            <div class="mb-2">
                <label class="block text-[10px] font-semibold text-slate-500 mb-1">Entrance Name / Label</label>
                <input type="text"
                    id="ent-input-${ent.id}"
                    value="${escapeHtml(ent.label)}"
                    placeholder="e.g. Main Entrance, Car Park Gate"
                    class="w-full px-2 py-1 text-xs border border-slate-300 rounded focus:border-emerald-500 focus:outline-none"
                    oninput="window.updateEntranceLabel('${ent.id}', this.value)"
                />
            </div>
            <div class="mb-2.5">
                <label class="flex items-center gap-1.5 text-[11px] text-slate-700 cursor-pointer select-none">
                    <input type="radio"
                        name="primary-entrance"
                        ${isPrimary ? 'checked' : ''}
                        onchange="window.setPrimaryEntrance('${ent.id}')"
                        class="text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                    />
                    <span class="font-medium">Primary / Default Doorway</span>
                </label>
            </div>
            <div class="text-[10px] text-slate-400 font-mono mb-2.5">
                Coords: [${ent.coords[1].toFixed(6)}, ${ent.coords[0].toFixed(6)}]
            </div>
            <div class="flex items-center gap-2 pt-1 border-t border-slate-100">
                <button type="button"
                    onclick="window.deleteEntrance('${ent.id}')"
                    class="w-full py-1.5 px-2 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 text-[11px] font-semibold flex items-center justify-center gap-1 transition cursor-pointer">
                    <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                    </svg>
                    Delete Entrance
                </button>
            </div>
        </div>
    `;
}
window.getEntrancePopupHtml = getEntrancePopupHtml;

function updateEntranceLabel(id, val) {
    const ent = editingEntrances.find(x => x.id === id);
    if (!ent) return;
    ent.label = val.trim() || 'Entrance';
    markEntranceDirty();
}
window.updateEntranceLabel = updateEntranceLabel;

function setPrimaryEntrance(id) {
    editingEntrances.forEach(ent => {
        ent.isPrimary = (ent.id === id);
    });
    markEntranceDirty();
    renderEntranceMarkers();
    // Reopen popup for this entrance
    const idx = editingEntrances.findIndex(x => x.id === id);
    if (idx > -1 && entranceMarkers[idx]) {
        entranceMarkers[idx].openPopup();
    }
}
window.setPrimaryEntrance = setPrimaryEntrance;

function deleteEntrance(id) {
    const idx = editingEntrances.findIndex(x => x.id === id);
    if (idx === -1) return;
    const deleted = editingEntrances.splice(idx, 1)[0];
    if (deleted.isPrimary && editingEntrances.length > 0) {
        editingEntrances[0].isPrimary = true;
    }
    markEntranceDirty();
    renderEntranceMarkers();
    showToast(`Deleted ${deleted.label || 'entrance pin'}.`, 'info');
    updateInstructionPill();
}
window.deleteEntrance = deleteEntrance;

function renderEntranceMarkers() {
    if (!editorMap || typeof L === 'undefined') return;
    clearEntranceMarkers();

    editingEntrances.forEach((ent, idx) => {
        const badgeNumber = idx + 1;
        const isPrimary = ent.isPrimary === true;

        const pinHtml = `
            <div class="relative flex items-center justify-center cursor-pointer group">
                <div class="w-8 h-8 rounded-full ${isPrimary ? 'bg-emerald-600 ring-2 ring-emerald-300 shadow-emerald-500/50' : 'bg-teal-700 ring-2 ring-teal-400 shadow-teal-700/50'} border-2 border-white flex items-center justify-center text-xs font-black text-white shadow-xl transition-transform group-hover:scale-110">
                    ${badgeNumber}
                </div>
                ${isPrimary ? '<span class="absolute -top-1 -right-1 flex h-3 w-3"><span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span><span class="relative inline-flex rounded-full h-3 w-3 bg-emerald-400"></span></span>' : ''}
            </div>
        `;

        const marker = L.marker([ent.coords[1], ent.coords[0]], {
            draggable: true,
            zIndexOffset: isPrimary ? 1000 : 500,
            icon: L.divIcon({
                className: 'custom-entrance-pin',
                html: pinHtml,
                iconSize: [32, 32],
                iconAnchor: [16, 16]
            })
        }).addTo(editorMap);

        marker.bindPopup(() => getEntrancePopupHtml(ent, badgeNumber));

        marker.on('dragend', (e) => {
            const pos = e.target.getLatLng();
            ent.coords = [Number(pos.lng.toFixed(6)), Number(pos.lat.toFixed(6))];
            marker.setPopupContent(getEntrancePopupHtml(ent, badgeNumber));
            markEntranceDirty();
            showToast(`Moved ${ent.label} to [${ent.coords[1].toFixed(5)}, ${ent.coords[0].toFixed(5)}]`, 'info');
        });

        entranceMarkers.push(marker);
    });
}
window.renderEntranceMarkers = renderEntranceMarkers;

function renderEditorBuildingList() {
    const listEl = document.getElementById('editor-building-list');
    const searchInput = document.getElementById('search-editor-building');
    const mobileSelect = document.getElementById('mobile-editor-building-select');
    const query = (searchInput ? searchInput.value : '').trim().toLowerCase();

    const filtered = buildings.filter(b => {
        return (b.name && b.name.toLowerCase().includes(query)) ||
               (b.code && b.code.toLowerCase().includes(query));
    });

    if (listEl) {
        if (filtered.length === 0) {
            listEl.innerHTML = `<div class="p-4 text-center text-slate-500 italic text-xs">No buildings found.</div>`;
        } else {
            listEl.innerHTML = filtered.map(b => {
                const isSelected = b.id === selectedBuildingId;
                const norm = normalizeEntrances(b.entrance);
                const count = norm.length;
                const hasEntrance = count > 0;
                const statusText = count > 1 ? `${count} Entrances` : (count === 1 ? (norm[0].label || '1 Entrance') : 'Centroid only');

                return `
                    <div data-action="select-editor-building" data-id="${b.id}" onclick="window.selectEditorBuilding('${b.id}')" class="p-2.5 rounded-xl cursor-pointer transition border ${isSelected ? 'bg-brand-600/20 border-brand-500 text-white' : 'bg-slate-950/60 border-slate-800/80 hover:bg-slate-800/50 text-slate-300'}">
                        <div class="flex items-center justify-between">
                            <span class="font-bold text-xs">${escapeHtml(b.name)}</span>
                            ${hasEntrance ? `<span class="px-1.5 py-0.5 rounded-full text-[9px] font-bold ${count > 1 ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' : 'bg-emerald-400 w-2 h-2 rounded-full'}" title="${count} doorway pin(s) set">${count > 1 ? count : ''}</span>` : '<span class="w-2 h-2 rounded-full bg-slate-600" title="No entrance set"></span>'}
                        </div>
                        <div class="flex items-center justify-between text-[10px] text-slate-400 mt-1">
                            <span class="font-mono">${escapeHtml(b.code || b.id)}</span>
                            <span class="${count > 0 ? 'text-emerald-400 font-medium' : 'text-slate-500'}">${statusText}</span>
                        </div>
                    </div>
                `;
            }).join('');
        }
    }

    if (mobileSelect) {
        mobileSelect.innerHTML = '<option value="">Select Building to Pin...</option>' + 
            buildings.map(b => `<option value="${b.id}" ${b.id === selectedBuildingId ? 'selected' : ''}>${escapeHtml(b.name)} (${escapeHtml(b.code || b.id)})</option>`).join('');
    }
}
window.renderEditorBuildingList = renderEditorBuildingList;

function jumpToEntranceEditor(buildingId) {
    switchTab('entrance-editor');
    selectEditorBuilding(buildingId);
}
window.jumpToEntranceEditor = jumpToEntranceEditor;

function selectEditorBuilding(id) {
    selectedBuildingId = id;
    renderEditorBuildingList();
    const b = buildings.find(x => x.id === id);
    if (!b) return;

    initOrResizeEditorMap();
    if (!editorMap) return;

    // Reset entrance editor state
    isAddingEntrance = false;
    updateAddEntranceButtonUI();

    // Clear existing markers & polygons
    if (buildingMarker) {
        editorMap.removeLayer(buildingMarker);
        buildingMarker = null;
    }
    if (buildingPolygonLayer) {
        editorMap.removeLayer(buildingPolygonLayer);
        buildingPolygonLayer = null;
    }
    clearEntranceMarkers();

    // Parse entrances using schema normalizer
    editingEntrances = normalizeEntrances(b.entrance);

    const btnSaveEntrance = document.getElementById('btn-save-entrance');
    if (btnSaveEntrance) btnSaveEntrance.disabled = true;

    // Render building polygon footprint if present
    const polyCoords = b.polygon || (b.metadata && b.metadata.polygon);
    if (polyCoords && Array.isArray(polyCoords) && polyCoords.length > 0 && typeof L !== 'undefined') {
        try {
            // Support GeoJSON [[[lng, lat], ...]] -> Leaflet [[lat, lng], ...]
            const rings = Array.isArray(polyCoords[0][0]) ? polyCoords[0] : polyCoords;
            const latLngRings = rings.map(pt => [pt[1], pt[0]]);
            buildingPolygonLayer = L.polygon(latLngRings, {
                color: '#6366f1',
                fillColor: '#818cf8',
                fillOpacity: 0.25,
                weight: 2,
                dashArray: '4, 4'
            }).addTo(editorMap).bindPopup(`<b>${escapeHtml(b.name)}</b><br><span class="text-slate-500 text-xs">Surveyed Roofline Boundary</span>`);
        } catch (polyErr) {
            console.warn('Error rendering building polygon on editor map:', polyErr);
        }
    }

    // Centroid marker (Blue pin)
    if (typeof L !== 'undefined') {
        buildingMarker = L.marker([b.lat, b.lng], {
            icon: L.divIcon({
                className: 'custom-centroid-pin',
                html: `<div class="w-6 h-6 rounded-full bg-indigo-600 border-2 border-white flex items-center justify-center text-[10px] font-bold text-white shadow-lg">🏢</div>`,
                iconSize: [24, 24],
                iconAnchor: [12, 12]
            })
        }).addTo(editorMap).bindPopup(`<b>${escapeHtml(b.name)}</b><br><span class="text-slate-500 text-xs">Geometric Centroid</span>`);

        // Render all entrance doorway pins
        renderEntranceMarkers();

        editorMap.flyTo([b.lat, b.lng], 18, { duration: 0.8 });
    }

    updateInstructionPill();
}
window.selectEditorBuilding = selectEditorBuilding;

// =============================================================================
// 5. SYNC QUEUE VIEW
// =============================================================================

async function renderSyncQueue() {
    const queueList = document.getElementById('queue-list');
    if (!queueList) return;

    let pending = [];
    if (typeof CampusSync !== 'undefined' && CampusSync.getPendingMutations) {
        pending = await CampusSync.getPendingMutations();
    }

    if (pending.length === 0) {
        queueList.innerHTML = `
            <div class="p-8 text-center text-slate-500">
                <svg class="w-12 h-12 mx-auto text-slate-600 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                </svg>
                <div class="font-medium text-slate-300">All Changes Fully Synced</div>
                <div class="text-xs mt-1">There are no pending local mutations in IndexedDB.</div>
            </div>
        `;
        return;
    }

    queueList.innerHTML = pending.map(item => `
        <div class="p-3.5 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between text-xs">
            <div class="flex items-center gap-3">
                <span class="px-2 py-0.5 rounded font-mono font-bold uppercase text-[10px] ${item.action === 'DELETE' ? 'bg-rose-500/20 text-rose-400' : 'bg-brand-500/20 text-brand-300'}">${item.action}</span>
                <div>
                    <div class="font-semibold text-slate-200">${item.table} &rarr; <span class="font-mono text-slate-400">${item.record_id}</span></div>
                    <div class="text-[10px] text-slate-500">${new Date(item.timestamp).toLocaleString()}</div>
                </div>
            </div>
            <div class="text-right">
                <span class="px-2 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">Queued in IndexedDB</span>
            </div>
        </div>
    `).join('');
}
window.renderSyncQueue = renderSyncQueue;

// =============================================================================
// REFRESH DATA & DROPDOWNS
// =============================================================================

function populateDropdowns() {
    const roomBuildingSelect = document.getElementById('room-building-select');
    const filterRoomsBuilding = document.getElementById('filter-rooms-building');
    const staffBuildingSelect = document.getElementById('staff-building-select');
    const filterStaffDept = document.getElementById('filter-staff-department');
    const mobileEditorBuildingSelect = document.getElementById('mobile-editor-building-select');

    if (roomBuildingSelect) {
        roomBuildingSelect.innerHTML = buildings.map(b => `<option value="${b.id}">${b.name} (${b.code || b.id})</option>`).join('');
    }
    if (filterRoomsBuilding) {
        filterRoomsBuilding.innerHTML = '<option value="">All Buildings</option>' + buildings.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
    }
    if (staffBuildingSelect) {
        staffBuildingSelect.innerHTML = '<option value="">(No Building Assigned)</option>' + buildings.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
    }

    if (filterStaffDept) {
        const depts = Array.from(new Set(staff.map(s => s.department).filter(Boolean))).sort();
        filterStaffDept.innerHTML = '<option value="">All Departments</option>' + depts.map(d => `<option value="${d}">${d}</option>`).join('');
    }

    if (mobileEditorBuildingSelect) {
        mobileEditorBuildingSelect.innerHTML = '<option value="">Select Building to Pin...</option>' + 
            buildings.map(b => `<option value="${b.id}" ${b.id === selectedBuildingId ? 'selected' : ''}>${b.name} (${b.code || b.id})</option>`).join('');
    }

    if (typeof syncBuildingComboboxes === 'function') {
        syncBuildingComboboxes();
    }
}

// Searchable Building Combobox Engine
function renderBuildingCombobox({
    selectId,
    btnId,
    labelId,
    dropdownId,
    searchId,
    clearId,
    listId,
    allowNone = false,
    noneLabel = '(No Building Assigned)'
}) {
    const select = document.getElementById(selectId);
    const btn = document.getElementById(btnId);
    const label = document.getElementById(labelId);
    const dropdown = document.getElementById(dropdownId);
    const search = document.getElementById(searchId);
    const clearBtn = document.getElementById(clearId);
    const list = document.getElementById(listId);

    if (!select || !btn || !label || !dropdown || !list) return;

    function syncLabel() {
        const currentVal = select.value;
        if (!currentVal && allowNone) {
            label.textContent = noneLabel;
            label.classList.add('text-slate-400');
            label.classList.remove('text-slate-200');
            return;
        }
        const b = buildings.find(x => String(x.id) === String(currentVal));
        if (b) {
            label.textContent = `${b.name} (${b.code || b.id})`;
            label.classList.remove('text-slate-400');
            label.classList.add('text-slate-200');
        } else if (allowNone) {
            label.textContent = noneLabel;
            label.classList.add('text-slate-400');
            label.classList.remove('text-slate-200');
        } else if (buildings.length > 0) {
            label.textContent = `${buildings[0].name} (${buildings[0].code || buildings[0].id})`;
            label.classList.remove('text-slate-400');
            label.classList.add('text-slate-200');
        } else {
            label.textContent = 'Select Building...';
        }
    }

    function renderOptions(query = '') {
        const q = query.trim().toLowerCase();
        let itemsHtml = '';

        if (allowNone && (!q || noneLabel.toLowerCase().includes(q))) {
            const isSelected = !select.value;
            itemsHtml += `
                <div data-value="" role="option" aria-selected="${isSelected}"
                     class="combobox-item flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs cursor-pointer transition touch-btn min-h-[42px] bg-[#0b1120] ${isSelected ? 'bg-brand-600/20 text-brand-300 font-semibold' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}">
                    <span class="truncate">${noneLabel}</span>
                    ${isSelected ? '<svg class="w-4 h-4 text-brand-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>' : ''}
                </div>
            `;
        }

        const filtered = buildings.filter(b => {
            if (!q) return true;
            const name = (b.name || '').toLowerCase();
            const code = (b.code || '').toLowerCase();
            const id = String(b.id || '').toLowerCase();
            return name.includes(q) || code.includes(q) || id.includes(q);
        });

        if (filtered.length === 0 && (!allowNone || (q && !noneLabel.toLowerCase().includes(q)))) {
            itemsHtml += `
                <div class="px-3 py-6 text-center text-xs text-slate-500 bg-[#0b1120] rounded-xl">
                    <div class="text-base mb-1">🔍</div>
                    No campus buildings matching "<span class="text-slate-300 font-medium">${escapeHtml(query)}</span>"
                </div>
            `;
        } else {
            filtered.forEach(b => {
                const isSelected = String(select.value) === String(b.id);
                itemsHtml += `
                    <div data-value="${b.id}" role="option" aria-selected="${isSelected}"
                         class="combobox-item flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs cursor-pointer transition touch-btn min-h-[42px] bg-[#0b1120] ${isSelected ? 'bg-brand-600/20 text-brand-300 font-semibold' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}">
                        <div class="flex items-center gap-2 truncate">
                            <span class="text-xs">🏢</span>
                            <span class="truncate font-medium">${escapeHtml(b.name)}</span>
                        </div>
                        <div class="flex items-center gap-1.5 shrink-0 ml-2">
                            ${b.code ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-300 border border-slate-700/80">${escapeHtml(b.code)}</span>` : ''}
                            ${isSelected ? '<svg class="w-4 h-4 text-brand-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>' : ''}
                        </div>
                    </div>
                `;
            });
        }

        list.innerHTML = itemsHtml;
    }

    function openDropdown() {
        document.querySelectorAll('[id^="dropdown-"][id$="-combobox"]').forEach(d => {
            if (d !== dropdown) {
                d.classList.add('hidden');
                const rel = d.closest('.relative');
                if (rel) {
                    rel.classList.remove('z-40');
                    const arr = rel.querySelector('svg.rotate-180');
                    if (arr) arr.classList.remove('rotate-180');
                }
            }
        });
        dropdown.classList.remove('hidden');
        btn.setAttribute('aria-expanded', 'true');
        const parentRel = dropdown.closest('.relative');
        if (parentRel) parentRel.classList.add('z-40');
        const arrow = btn.querySelector('svg');
        if (arrow) arrow.classList.add('rotate-180');
        if (search) {
            search.value = '';
            if (clearBtn) clearBtn.classList.add('hidden');
            renderOptions('');
            setTimeout(() => search.focus(), 60);
        } else {
            renderOptions('');
        }
    }

    function closeDropdown() {
        dropdown.classList.add('hidden');
        btn.setAttribute('aria-expanded', 'false');
        const parentRel = dropdown.closest('.relative');
        if (parentRel) parentRel.classList.remove('z-40');
        const arrow = btn.querySelector('svg');
        if (arrow) arrow.classList.remove('rotate-180');
    }

    if (!btn._comboboxInitialized) {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (dropdown.classList.contains('hidden')) {
                openDropdown();
            } else {
                closeDropdown();
            }
        });

        if (search) {
            search.addEventListener('input', (e) => {
                const val = e.target.value;
                if (clearBtn) clearBtn.classList.toggle('hidden', !val);
                renderOptions(val);
            });
            search.addEventListener('click', (e) => e.stopPropagation());
            search.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    closeDropdown();
                    btn.focus();
                }
            });
        }

        if (clearBtn) {
            clearBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                search.value = '';
                clearBtn.classList.add('hidden');
                renderOptions('');
                search.focus();
            });
        }

        list.addEventListener('click', (e) => {
            const item = e.target.closest('.combobox-item');
            if (!item) return;
            e.stopPropagation();
            const val = item.getAttribute('data-value');
            select.value = val;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            syncLabel();
            closeDropdown();
            btn.focus();
        });

        select.addEventListener('change', () => {
            syncLabel();
        });

        btn._comboboxInitialized = true;
    }

    syncLabel();
    renderOptions(search ? search.value : '');
}

function syncBuildingComboboxes() {
    renderBuildingCombobox({
        selectId: 'room-building-select',
        btnId: 'btn-room-building-combobox',
        labelId: 'label-room-building-combobox',
        dropdownId: 'dropdown-room-building-combobox',
        searchId: 'search-room-building-combobox',
        clearId: 'clear-room-building-search',
        listId: 'list-room-building-combobox',
        allowNone: false
    });

    renderBuildingCombobox({
        selectId: 'staff-building-select',
        btnId: 'btn-staff-building-combobox',
        labelId: 'label-staff-building-combobox',
        dropdownId: 'dropdown-staff-building-combobox',
        searchId: 'search-staff-building-combobox',
        clearId: 'clear-staff-building-search',
        listId: 'list-staff-building-combobox',
        allowNone: true,
        noneLabel: '(No Building Assigned)'
    });
}
window.syncBuildingComboboxes = syncBuildingComboboxes;

// Searchable Staff Room Combobox Engine
function getAvailableStaffRooms(buildingId, selectedRoomId = '') {
    if (!buildingId) return [];
    return rooms.filter(r => {
        const isBldg = r.building_id === buildingId || String(r.building_id) === String(buildingId);
        if (!isBldg) return false;

        // Retain currently assigned room for editing continuity
        if (selectedRoomId && (r.id === selectedRoomId || String(r.id) === String(selectedRoomId))) {
            return true;
        }

        const meta = r.metadata || {};
        const purpose = meta.purpose || '';

        // If explicitly tagged as lecturer_office, include it
        if (purpose === 'lecturer_office') return true;

        // If explicitly tagged as service desk / admin office or lecture room, exclude it
        if (purpose === 'service_desk' || purpose === 'admin_office' || purpose === 'lecture_room' || purpose === 'lecture_hall') {
            return false;
        }

        // For untagged/legacy rooms, keep independent service desks & lecture halls out of lecturer assignment
        const desc = (r.description || '').toLowerCase();
        const isExcludedDeskOrHall = /exam|faculty officer|secretariat|service desk|dean'?s office|hall|lab|lecture|auditorium|theatre/i.test(desc);
        return !isExcludedDeskOrHall;
    });
}
window.getAvailableStaffRooms = getAvailableStaffRooms;

function syncStaffRoomCombobox(buildingId, selectedRoomId = '', prefilteredRooms = null) {
    const select = document.getElementById('staff-room-select');
    const btn = document.getElementById('btn-staff-room-combobox');
    const label = document.getElementById('label-staff-room-combobox');
    const dropdown = document.getElementById('dropdown-staff-room-combobox');
    const search = document.getElementById('search-staff-room-combobox');
    const clearBtn = document.getElementById('clear-staff-room-search');
    const list = document.getElementById('list-staff-room-combobox');

    if (!select || !btn || !label || !dropdown || !list) return;

    if (buildingId !== undefined && buildingId !== null) btn._currentBuildingId = String(buildingId);
    if (selectedRoomId !== undefined && selectedRoomId !== null) btn._currentSelectedRoomId = String(selectedRoomId);
    if (prefilteredRooms !== null) btn._prefilteredRooms = prefilteredRooms;
    else if (buildingId) delete btn._prefilteredRooms;

    function getCurrentBuildingId() {
        const staffBuildingSelect = document.getElementById('staff-building-select');
        return (staffBuildingSelect && staffBuildingSelect.value) || btn._currentBuildingId || '';
    }

    function getRoomsList() {
        if (btn._prefilteredRooms && Array.isArray(btn._prefilteredRooms) && btn._prefilteredRooms.length > 0) {
            return btn._prefilteredRooms;
        }
        const bId = getCurrentBuildingId();
        return getAvailableStaffRooms(bId, select.value || btn._currentSelectedRoomId || '');
    }

    function formatRoomItem(room) {
        let cleanRoomNo = String(room.room_number || '').trim();
        if (/^room\s+/i.test(cleanRoomNo)) {
            cleanRoomNo = cleanRoomNo.replace(/^room\s+/i, '').trim();
        }
        const roomTitle = cleanRoomNo ? `Room ${cleanRoomNo}` : 'Room';
        const floorStr = room.floor === 0 ? 'Ground' : `Floor ${room.floor}`;
        const meta = room.metadata || {};
        const wingStr = meta.wing ? (String(meta.wing).endsWith('Wing') ? meta.wing : `${meta.wing} Wing`) : '';
        const desc = room.description || meta.type || '';
        return { cleanRoomNo, roomTitle, floorStr, wingStr, desc };
    }

    function syncLabel() {
        const curVal = select.value;
        const bId = getCurrentBuildingId();
        if (!curVal) {
            label.textContent = bId ? '(No Room Assigned)' : '(Select building first)';
            label.classList.add('text-slate-400');
            label.classList.remove('text-slate-200');
            return;
        }

        const rm = rooms.find(r => String(r.id) === String(curVal));
        if (rm) {
            const { roomTitle, floorStr, wingStr } = formatRoomItem(rm);
            const extra = [floorStr, wingStr].filter(Boolean).join(' · ');
            label.textContent = extra ? `${roomTitle} (${extra})` : roomTitle;
            label.classList.remove('text-slate-400');
            label.classList.add('text-slate-200');
        } else {
            label.textContent = '(No Room Assigned)';
            label.classList.add('text-slate-400');
            label.classList.remove('text-slate-200');
        }
    }

    function renderOptions(query = '') {
        const q = (query || '').trim().toLowerCase();
        const bId = getCurrentBuildingId();
        const availableRooms = getRoomsList();
        let itemsHtml = '';

        // Option: "(No Room Assigned)"
        if (!q || '(no room assigned)'.includes(q) || 'none'.includes(q)) {
            const isSelected = !select.value;
            itemsHtml += `
                <div data-value="" role="option" aria-selected="${isSelected}"
                     class="combobox-item flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs cursor-pointer transition touch-btn min-h-[42px] bg-[#0b1120] ${isSelected ? 'bg-brand-600/20 text-brand-300 font-semibold' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}">
                    <span class="truncate font-medium text-slate-300">(No Room Assigned)</span>
                    ${isSelected ? '<svg class="w-4 h-4 text-brand-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>' : ''}
                </div>
            `;
        }

        if (!bId) {
            itemsHtml += `
                <div class="px-3 py-6 text-center text-xs text-slate-500 bg-[#0b1120] rounded-xl">
                    <div class="text-base mb-1">🏢</div>
                    Please select a building above to choose an office.
                </div>
            `;
            list.innerHTML = itemsHtml;
            return;
        }

        if (availableRooms.length === 0) {
            itemsHtml += `
                <div class="px-3 py-6 text-center text-xs text-slate-500 bg-[#0b1120] rounded-xl">
                    <div class="text-base mb-1">🚪</div>
                    No lecturer offices found in this building.
                </div>
            `;
            list.innerHTML = itemsHtml;
            return;
        }

        const filtered = availableRooms.filter(r => {
            if (!q) return true;
            const { cleanRoomNo, roomTitle, floorStr, wingStr, desc } = formatRoomItem(r);
            const num = (r.room_number || '').toLowerCase();
            const id = String(r.id || '').toLowerCase();
            return cleanRoomNo.toLowerCase().includes(q) ||
                   roomTitle.toLowerCase().includes(q) ||
                   num.includes(q) ||
                   id.includes(q) ||
                   floorStr.toLowerCase().includes(q) ||
                   wingStr.toLowerCase().includes(q) ||
                   desc.toLowerCase().includes(q);
        });

        if (filtered.length === 0) {
            itemsHtml += `
                <div class="px-3 py-6 text-center text-xs text-slate-500 bg-[#0b1120] rounded-xl">
                    <div class="text-base mb-1">🔍</div>
                    No staff offices matching "<span class="text-slate-300 font-medium">${escapeHtml(query)}</span>"
                </div>
            `;
        } else {
            filtered.forEach(room => {
                const isSelected = String(select.value) === String(room.id);
                const { roomTitle, floorStr, wingStr, desc } = formatRoomItem(room);

                itemsHtml += `
                    <div data-value="${room.id}" role="option" aria-selected="${isSelected}"
                         class="combobox-item flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs cursor-pointer transition touch-btn min-h-[46px] bg-[#0b1120] ${isSelected ? 'bg-brand-600/20 text-brand-300 font-semibold' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}">
                        <div class="flex flex-col min-w-0 pr-2">
                            <div class="flex items-center gap-1.5 flex-wrap">
                                <span class="font-semibold text-slate-100">${escapeHtml(roomTitle)}</span>
                                <span class="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-300 border border-slate-700/80">${escapeHtml(floorStr)}</span>
                                ${wingStr ? `<span class="px-1.5 py-0.5 rounded text-[10px] bg-indigo-950/70 text-indigo-300 border border-indigo-800/60">${escapeHtml(wingStr)}</span>` : ''}
                            </div>
                            ${desc ? `<span class="text-[11px] text-slate-400 truncate mt-0.5">${escapeHtml(desc)}</span>` : ''}
                        </div>
                        <div class="shrink-0 ml-2 flex items-center">
                            ${isSelected ? '<svg class="w-4 h-4 text-brand-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>' : ''}
                        </div>
                    </div>
                `;
            });
        }

        list.innerHTML = itemsHtml;
    }

    btn._openStaffRoomDropdown = function() {
        document.querySelectorAll('[id^="dropdown-"][id$="-combobox"]').forEach(d => {
            if (d !== dropdown) {
                d.classList.add('hidden');
                const rel = d.closest('.relative');
                if (rel) {
                    rel.classList.remove('z-40');
                    const arr = rel.querySelector('svg.rotate-180');
                    if (arr) arr.classList.remove('rotate-180');
                }
            }
        });
        dropdown.classList.remove('hidden');
        btn.setAttribute('aria-expanded', 'true');
        const parentRel = dropdown.closest('.relative');
        if (parentRel) parentRel.classList.add('z-40');
        const arrow = btn.querySelector('svg');
        if (arrow) arrow.classList.add('rotate-180');
        if (search) {
            search.value = '';
            if (clearBtn) clearBtn.classList.add('hidden');
            renderOptions('');
            setTimeout(() => search.focus(), 60);
        } else {
            renderOptions('');
        }
    };

    btn._closeStaffRoomDropdown = function() {
        dropdown.classList.add('hidden');
        btn.setAttribute('aria-expanded', 'false');
        const parentRel = dropdown.closest('.relative');
        if (parentRel) parentRel.classList.remove('z-40');
        const arrow = btn.querySelector('svg');
        if (arrow) arrow.classList.remove('rotate-180');
    };

    if (!btn._comboboxInitialized) {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (dropdown.classList.contains('hidden')) {
                btn._openStaffRoomDropdown();
            } else {
                btn._closeStaffRoomDropdown();
            }
        });

        if (search) {
            search.addEventListener('input', (e) => {
                const val = e.target.value;
                if (clearBtn) clearBtn.classList.toggle('hidden', !val);
                renderOptions(val);
            });
            search.addEventListener('click', (e) => e.stopPropagation());
            search.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    btn._closeStaffRoomDropdown();
                    btn.focus();
                }
            });
        }

        if (clearBtn) {
            clearBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                search.value = '';
                clearBtn.classList.add('hidden');
                renderOptions('');
                search.focus();
            });
        }

        list.addEventListener('click', (e) => {
            const item = e.target.closest('.combobox-item');
            if (!item) return;
            e.stopPropagation();
            const val = item.getAttribute('data-value') || '';
            select.value = val;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            syncLabel();
            btn._closeStaffRoomDropdown();
            btn.focus();
        });

        select.addEventListener('change', () => {
            syncLabel();
        });

        btn._comboboxInitialized = true;
    }

    syncLabel();
    renderOptions(search ? search.value : '');
}
window.syncStaffRoomCombobox = syncStaffRoomCombobox;

async function refreshData() {
    try {
        if (typeof CampusSync !== 'undefined' && CampusSync.getAll) {
            const b = await CampusSync.getAll('buildings');
            const r = await CampusSync.getAll('rooms');
            const s = await CampusSync.getAll('staff_directory');
            if (Array.isArray(b)) buildings = b;
            if (Array.isArray(r)) rooms = r;
            if (Array.isArray(s)) staff = s;
        }
    } catch (e) {
        console.warn('[App] Error in CampusSync.getAll, keeping cached data:', e);
    }

    populateDropdowns();
    renderCurrentTab();
}
window.refreshData = refreshData;

// =============================================================================
// GLOBAL EVENT DELEGATION (Clicks, Inputs, Changes, Form Submits)
// =============================================================================

document.addEventListener('click', (e) => {
    // 0. Combobox outside click dismissal
    if (!e.target.closest('#combobox-room-building') && !e.target.closest('#combobox-staff-building') && !e.target.closest('#combobox-staff-room')) {
        document.querySelectorAll('[id^="dropdown-"][id$="-combobox"]').forEach(d => {
            d.classList.add('hidden');
            const rel = d.closest('.relative');
            if (rel) {
                rel.classList.remove('z-40');
                const arr = rel.querySelector('svg.rotate-180');
                if (arr) arr.classList.remove('rotate-180');
            }
        });
    }

    // 1. Modals cancel or backdrop click
    if (e.target.closest('.btn-close-modal') || e.target.classList.contains('modal-backdrop')) {
        closeAllModals();
        return;
    }

    // 2. Tab switching
    const tabBtn = e.target.closest('[data-tab]');
    if (tabBtn) {
        const tab = tabBtn.getAttribute('data-tab');
        if (tab) {
            switchTab(tab);
            closeMobileSidebar();
        }
        return;
    }

    // 3. Settings Drawer Open / Close
    if (e.target.closest('#btn-settings, #btn-open-settings, [data-action="open-settings"]')) {
        openSettings();
        return;
    }
    if (e.target.closest('#btn-close-settings') || e.target.closest('#drawer-backdrop')) {
        closeSettings();
        return;
    }

    // 4. Mobile Sidebar Hamburger & Close
    if (e.target.closest('#btn-toggle-sidebar')) {
        openMobileSidebar();
        return;
    }
    if (e.target.closest('#btn-close-sidebar') || e.target.closest('#mobile-sidebar-backdrop')) {
        closeMobileSidebar();
        return;
    }

    // 5. Add Record Buttons
    if (e.target.closest('#btn-add-building')) {
        openAddBuildingModal();
        return;
    }
    if (e.target.closest('#btn-add-room')) {
        openAddRoomModal();
        return;
    }
    if (e.target.closest('#btn-add-staff')) {
        openAddStaffModal();
        return;
    }

    // 5b. Room Purpose Selector Toggle Buttons
    const purposeBtn = e.target.closest('.room-purpose-btn');
    if (purposeBtn) {
        e.preventDefault();
        const purpose = purposeBtn.getAttribute('data-purpose');
        if (purpose && typeof setRoomPurpose === 'function') {
            setRoomPurpose(purpose);
        }
        return;
    }

    // 6. Action Buttons in Table / Cards (Delegated)
    const actionBtn = e.target.closest('[data-action]');
    if (actionBtn) {
        e.stopPropagation();
        const action = actionBtn.getAttribute('data-action');
        const id = actionBtn.getAttribute('data-id');
        if (action === 'open-settings') openSettings();
        else if (action === 'close-settings') closeSettings();
        else if (action === 'close-modal') closeAllModals();
        else if (action === 'edit-building') editBuilding(id);
        else if (action === 'delete-building') deleteBuilding(id);
        else if (action === 'pin-building') jumpToEntranceEditor(id);
        else if (action === 'edit-room') editRoom(id);
        else if (action === 'delete-room') deleteRoom(id);
        else if (action === 'edit-staff') editStaff(id);
        else if (action === 'delete-staff') deleteStaff(id);
        else if (action === 'select-editor-building') selectEditorBuilding(id);
        return;
    }

    // 7. Doorway Add / Save Buttons
    if (e.target.closest('#btn-add-entrance')) {
        if (!selectedBuildingId) {
            showToast('Please select a building from the list first', 'info');
            return;
        }
        isAddingEntrance = !isAddingEntrance;
        updateAddEntranceButtonUI();
        updateInstructionPill();
        if (isAddingEntrance) {
            showToast(`Click anywhere on map near doorway to place Entrance #${editingEntrances.length + 1}`, 'info');
        }
        return;
    }

    if (e.target.closest('#btn-save-entrance')) {
        (async () => {
            if (!selectedBuildingId) return;
            const b = buildings.find(x => x.id === selectedBuildingId);
            if (!b) return;

            // Ensure at least one entrance is primary if entrances exist
            if (editingEntrances.length > 0 && !editingEntrances.some(x => x.isPrimary)) {
                editingEntrances[0].isPrimary = true;
            }

            const updated = {
                ...b,
                entrance: editingEntrances
            };

            if (typeof CampusSync !== 'undefined' && CampusSync.saveRecord) {
                await CampusSync.saveRecord('buildings', updated);
            }
            const idx = buildings.findIndex(x => x.id === selectedBuildingId);
            if (idx > -1) buildings[idx] = updated;

            const btnSave = document.getElementById('btn-save-entrance');
            if (btnSave) btnSave.disabled = true;
            showToast(`Saved ${editingEntrances.length} entrance pin(s) for ${b.name}!`, 'success');
            renderEditorBuildingList();
            renderEntranceMarkers();
            updateInstructionPill();
            await refreshData();
        })();
        return;
    }

    // 8. Sync Triggers
    if (e.target.closest('#btn-force-sync') || e.target.closest('#btn-sync-trigger')) {
        if (typeof CampusSync !== 'undefined' && CampusSync.triggerSync) {
            CampusSync.triggerSync();
            showToast('Sync initiated...', 'info');
        }
        return;
    }

    // 9. Save Connection in Drawer
    if (e.target.closest('#btn-save-connection')) {
        const inputOrgId = document.getElementById('input-org-id');
        const inputSupabaseUrl = document.getElementById('input-supabase-url');
        const inputSupabaseKey = document.getElementById('input-supabase-key');
        const cleanUrl = inputSupabaseUrl ? inputSupabaseUrl.value.trim().replace(/\/+$/, '') : '';
        const cleanKey = inputSupabaseKey ? inputSupabaseKey.value.trim() : '';
        const cleanOrg = inputOrgId ? inputOrgId.value.trim() || 'usted-ksi' : 'usted-ksi';

        if (typeof CampusSync !== 'undefined' && CampusSync.saveConfig) {
            CampusSync.saveConfig({
                orgId: cleanOrg,
                supabaseUrl: cleanUrl,
                supabaseAnonKey: cleanKey
            });
            showToast('Connection settings saved', 'success');
            if (typeof CampusSync.processPendingQueue === 'function') {
                CampusSync.processPendingQueue();
            } else if (typeof CampusSync.triggerSync === 'function') {
                CampusSync.triggerSync();
            }
        }
        closeSettings();
        return;
    }

    // 9b. Reset Connection to Defaults in Drawer
    if (e.target.closest('#btn-reset-connection-defaults')) {
        if (typeof window !== 'undefined' && window.ENV && typeof window.ENV.resetDefaults === 'function') {
            window.ENV.resetDefaults();
        } else {
            try {
                localStorage.removeItem('supabase_url');
                localStorage.removeItem('supabase_anon_key');
                localStorage.removeItem('supabase_schema');
                localStorage.removeItem('campus_org_id');
                localStorage.removeItem('campusos_supabase_config');
            } catch (err) {}
        }
        const appCfg = (typeof APP_CONFIG !== 'undefined') ? APP_CONFIG : {};
        if (typeof CampusSync !== 'undefined' && CampusSync.saveConfig) {
            CampusSync.saveConfig({
                orgId: appCfg.DEFAULT_ORG_ID || 'usted-ksi',
                supabaseUrl: appCfg.SUPABASE_URL || '',
                supabaseAnonKey: appCfg.SUPABASE_ANON_KEY || ''
            });
        }
        const inputOrgId = document.getElementById('input-org-id');
        const inputSupabaseUrl = document.getElementById('input-supabase-url');
        const inputSupabaseKey = document.getElementById('input-supabase-key');
        const env = (typeof window !== 'undefined' && window.ENV) || null;
        if (inputOrgId) inputOrgId.value = env?.orgId || appCfg.DEFAULT_ORG_ID || 'usted-ksi';
        if (inputSupabaseUrl) inputSupabaseUrl.value = env?.supabaseUrl || appCfg.SUPABASE_URL || '';
        if (inputSupabaseKey) inputSupabaseKey.value = env?.supabaseKey || appCfg.SUPABASE_ANON_KEY || '';
        showToast('Reset connection to default project credentials', 'info');
        if (typeof CampusSync !== 'undefined' && CampusSync.processPendingQueue) {
            CampusSync.processPendingQueue();
        }
        return;
    }

    // 10. Auth Sign In
    if (e.target.closest('#btn-auth-login')) {
        const authEmail = document.getElementById('auth-email');
        const authPassword = document.getElementById('auth-password');
        if (!authEmail || !authPassword) return;
        (async () => {
            try {
                if (typeof CampusSync !== 'undefined' && CampusSync.login) {
                    await CampusSync.login(authEmail.value.trim(), authPassword.value);
                    showToast('Signed in successfully', 'success');
                }
            } catch (err) {
                showToast(err.message, 'error');
            }
        })();
        return;
    }

    // 11. Auth Sign Out
    if (e.target.closest('#btn-auth-logout')) {
        if (typeof CampusSync !== 'undefined' && CampusSync.logout) {
            CampusSync.logout();
            showToast('Signed out', 'info');
        }
        return;
    }

    // 12. Reset Database to Default Seed Data
    if (e.target.closest('#btn-reset-seed')) {
        if (!confirm('This will reset your local database and restore the default seed dataset. Proceed?')) return;
        (async () => {
            try {
                let data = (typeof window !== 'undefined' && window.CAMPUS_SEED_DATA) ? window.CAMPUS_SEED_DATA : null;
                if (!data) {
                    let res = await fetch('/admin/seed_data.json').catch(() => null);
                    if (!res || !res.ok) res = await fetch('seed_data.json').catch(() => null);
                    if (res && res.ok) data = await res.json();
                }
                if (data && typeof CampusSync !== 'undefined' && CampusSync.bulkPut) {
                    await CampusSync.bulkPut('buildings', data.buildings || []);
                    await CampusSync.bulkPut('rooms', data.rooms || []);
                    await CampusSync.bulkPut('staff_directory', data.staff || []);
                    buildings = [...(data.buildings || [])];
                    rooms = [...(data.rooms || [])];
                    staff = [...(data.staff || [])];
                    showToast('Database reset to clean seed data', 'success');
                    await refreshData();
                    closeSettings();
                }
            } catch (err) {
                showToast('Failed to reset: ' + err.message, 'error');
            }
        })();
        return;
    }

    // 13. Export JSON Snapshot
    if (e.target.closest('#btn-export-backup')) {
        const orgId = (typeof CampusSync !== 'undefined' && CampusSync.getConfig) ? CampusSync.getConfig().orgId : 'usted-ksi';
        const snapshot = {
            exported_at: new Date().toISOString(),
            org_id: orgId,
            buildings,
            rooms,
            staff
        };
        const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `campusos_snapshot_${Date.now()}.json`;
        a.click();
        return;
    }
});

// Keyboard Shortcuts (Escape dismissal)
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const openCombobox = document.querySelector('[id^="dropdown-"][id$="-combobox"]:not(.hidden)');
        if (openCombobox) {
            openCombobox.classList.add('hidden');
            const rel = openCombobox.closest('.relative');
            if (rel) {
                const arr = rel.querySelector('svg.rotate-180');
                if (arr) arr.classList.remove('rotate-180');
            }
            return;
        }
        closeAllModals();
        closeSettings();
        closeMobileSidebar();
    }
});

// Input Search delegation
document.addEventListener('input', (e) => {
    if (e.target.id === 'search-buildings') renderBuildings();
    else if (e.target.id === 'search-rooms') renderRooms();
    else if (e.target.id === 'search-staff') renderStaff();
    else if (e.target.id === 'search-editor-building') renderEditorBuildingList();
});

// Dropdown Change delegation
document.addEventListener('change', (e) => {
    if (e.target.id === 'filter-rooms-building') renderRooms();
    else if (e.target.id === 'filter-staff-department') renderStaff();
    else if (e.target.id === 'staff-building-select') updateStaffRoomDropdown(e.target.value);
    else if (e.target.id === 'mobile-editor-building-select') {
        if (e.target.value) selectEditorBuilding(e.target.value);
    }
});

// Form Submissions delegation
document.addEventListener('submit', async (e) => {
    // 1. Building Form Submit
    if (e.target.id === 'form-building') {
        e.preventDefault();
        const id = document.getElementById('building-id').value || `bldg-${Date.now()}`;
        const existing = buildings.find(x => x.id === id) || {};

        const record = {
            ...existing,
            id,
            name: document.getElementById('building-name').value.trim(),
            code: (document.getElementById('building-code').value || '').trim().toUpperCase(),
            short_name: (document.getElementById('building-code').value || document.getElementById('building-name').value).trim(),
            type: document.getElementById('building-type').value,
            lat: parseFloat(document.getElementById('building-lat').value),
            lng: parseFloat(document.getElementById('building-lng').value),
            description: document.getElementById('building-description').value.trim()
        };

        if (typeof CampusSync !== 'undefined' && CampusSync.saveRecord) {
            await CampusSync.saveRecord('buildings', record);
        }
        const idx = buildings.findIndex(x => x.id === id);
        if (idx > -1) buildings[idx] = record;
        else buildings.push(record);

        closeAllModals();
        showToast('Building saved successfully', 'success');
        await refreshData();
        return;
    }

    // 2. Room Form Submit
    if (e.target.id === 'form-room') {
        e.preventDefault();
        const bId = document.getElementById('room-building-select').value;
        const num = document.getElementById('room-number').value.trim();
        const id = document.getElementById('room-id').value || `${bId}-${num.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
        const existing = rooms.find(x => x.id === id) || {};

        const rawKeywords = document.getElementById('room-keywords').value;
        const kwArray = rawKeywords.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

        const purposeVal = document.getElementById('room-purpose')?.value || 'lecturer_office';
        const wingVal = document.getElementById('room-wing')?.value?.trim() || '';

        const existingMeta = existing.metadata || {};
        const metadata = {
            ...existingMeta,
            purpose: purposeVal,
            wing: wingVal
        };

        const record = {
            ...existing,
            id,
            building_id: bId,
            room_number: num,
            floor: parseInt(document.getElementById('room-floor').value, 10),
            description: document.getElementById('room-description').value.trim(),
            keywords: kwArray,
            metadata
        };

        if (typeof CampusSync !== 'undefined' && CampusSync.saveRecord) {
            await CampusSync.saveRecord('rooms', record);
        }
        const idx = rooms.findIndex(x => x.id === id);
        if (idx > -1) rooms[idx] = record;
        else rooms.push(record);

        closeAllModals();
        showToast('Room allocation saved', 'success');
        await refreshData();
        return;
    }

    // 3. Staff Form Submit
    if (e.target.id === 'form-staff') {
        e.preventDefault();
        const name = document.getElementById('staff-name').value.trim();
        const id = document.getElementById('staff-id').value || `staff-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
        const existing = staff.find(x => x.id === id) || {};

        const staffBuildingSelect = document.getElementById('staff-building-select');
        const staffRoomSelect = document.getElementById('staff-room-select');
        const bId = staffBuildingSelect ? staffBuildingSelect.value || null : null;
        const rId = staffRoomSelect ? staffRoomSelect.value || null : null;
        const selRoom = rId ? rooms.find(r => r.id === rId || String(r.id) === String(rId)) : null;

        const record = {
            ...existing,
            id,
            title: document.getElementById('staff-title').value.trim(),
            name,
            position: document.getElementById('staff-position').value.trim(),
            department: document.getElementById('staff-department').value.trim(),
            building_id: bId,
            room_id: rId,
            floor: selRoom ? selRoom.floor : (existing.floor !== undefined ? existing.floor : null),
            email: document.getElementById('staff-email').value.trim(),
            phone: document.getElementById('staff-phone').value.trim(),
            location_status: (bId && rId) ? 'exact' : (bId ? 'building_only' : 'unresolved')
        };

        if (typeof CampusSync !== 'undefined' && CampusSync.saveRecord) {
            await CampusSync.saveRecord('staff_directory', record);
        }
        const idx = staff.findIndex(x => x.id === id);
        if (idx > -1) staff[idx] = record;
        else staff.push(record);

        closeAllModals();
        showToast('Staff record saved', 'success');
        await refreshData();
        return;
    }
});

// =============================================================================
// APPLICATION BOOTSTRAPPER
// =============================================================================

async function initApp() {
    console.log('[App] Initializing CampusOS Studio...');

    // Render immediately from initial seed state
    populateDropdowns();
    renderCurrentTab();

    // Subscribe to Sync Engine updates
    if (typeof CampusSync !== 'undefined' && CampusSync.subscribe) {
        const envBadge = document.getElementById('env-badge');
        const envText = document.getElementById('env-text');
        const syncCountText = document.getElementById('sync-count-text');
        const syncIcon = document.getElementById('sync-icon');
        const authUnlogged = document.getElementById('auth-unlogged');
        const authLogged = document.getElementById('auth-logged');
        const userDisplayEmail = document.getElementById('user-display-email');

        CampusSync.subscribe((status) => {
            if (envBadge) {
                if (status.isSandbox) {
                    envBadge.className = 'px-2 sm:px-2.5 py-1 rounded-full text-[11px] sm:text-xs font-medium flex items-center gap-1.5 bg-amber-500/10 text-amber-300 border border-amber-500/30';
                    envBadge.innerHTML = '<span class="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span><span id="env-text" class="hidden xs:inline">Local Sandbox Mode</span><span class="xs:hidden">Sandbox</span>';
                } else {
                    envBadge.className = 'px-2 sm:px-2.5 py-1 rounded-full text-[11px] sm:text-xs font-medium flex items-center gap-1.5 bg-emerald-500/10 text-emerald-300 border border-emerald-500/30';
                    envBadge.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-400"></span><span id="env-text" class="hidden xs:inline font-semibold">● Synced</span><span class="xs:hidden font-semibold">● Synced</span>';
                }
            }

            if (syncCountText) syncCountText.textContent = `${status.pendingCount} Pending`;
            if (syncIcon) {
                if (status.isSyncing) syncIcon.classList.add('animate-spin');
                else syncIcon.classList.remove('animate-spin');
            }

            if (authUnlogged && authLogged) {
                if (status.user) {
                    authUnlogged.classList.add('hidden');
                    authLogged.classList.remove('hidden');
                    if (userDisplayEmail) userDisplayEmail.textContent = status.user.email;
                } else {
                    authUnlogged.classList.remove('hidden');
                    authLogged.classList.add('hidden');
                }
            }

            if (activeTab === 'sync-queue') {
                renderSyncQueue();
            }
        });
    }

    // Standalone PWA Installation Support for CampusOS Studio
    let deferredStudioInstallPrompt = null;
    const btnInstallStudio = document.getElementById('btn-install-studio');

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('beforeinstallprompt', (e) => {
            if (e && typeof e.preventDefault === 'function') e.preventDefault();
            deferredStudioInstallPrompt = e;
            if (btnInstallStudio) {
                btnInstallStudio.classList.remove('hidden');
                btnInstallStudio.classList.add('flex');
            }
        });

        window.addEventListener('appinstalled', () => {
            console.log('[Studio PWA] CampusOS Studio installed successfully');
            if (btnInstallStudio) {
                btnInstallStudio.classList.add('hidden');
                btnInstallStudio.classList.remove('flex');
            }
            showToast('CampusOS Studio installed successfully', 'success');
        });
    }

    // Attach Analytics Refresh Button
    const btnRefreshAnalytics = document.getElementById('btn-refresh-analytics');
    if (btnRefreshAnalytics) {
        btnRefreshAnalytics.addEventListener('click', () => {
            showToast('Refreshing live metrics...', 'info');
            renderAnalyticsDashboard(true);
        });
    }

    // Initialize CampusSync database
    try {
        if (typeof CampusSync !== 'undefined' && CampusSync.init) {
            await CampusSync.init();
        }
        await refreshData();
    } catch (err) {
        console.warn('[App] CampusSync init notice:', err);
    }
}

// =============================================================================
// 6. ANALYTICS & TELEMETRY CONTROLLER (KINGENIOUS)
// =============================================================================

function formatTimeAgo(d) {
    if (!d || isNaN(d.getTime())) return 'recently';
    const sec = Math.floor((Date.now() - d.getTime()) / 1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    return `${Math.floor(hr / 24)}d ago`;
}

async function renderAnalyticsDashboard(notifySuccess = false) {
    const statVisitors = document.getElementById('stat-total-visitors');
    const statUnique = document.getElementById('stat-unique-devices');
    const statApk = document.getElementById('stat-apk-downloads');
    const statPwa = document.getElementById('stat-pwa-installs');
    const statMap = document.getElementById('stat-map-actions');
    const osContainer = document.getElementById('analytics-os-breakdown');
    const tableBody = document.getElementById('analytics-event-table');
    const lastSynced = document.getElementById('analytics-last-synced');

    const supabaseUrl = (window.ENV?.supabaseUrl || window.APP_CONFIG?.SUPABASE_URL || 'https://mzxmbkulgrehujpvwadt.supabase.co').replace(/\/+$/, '');
    const supabaseKey = window.ENV?.supabaseKey || window.APP_CONFIG?.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16eG1ia3VsZ3JlaHVqcHZ3YWR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ1Njk5NjQsImV4cCI6MjEwMDE0NTk2NH0.PQMuAN1Hr82re8sgIJCbwwU09u6594UC3oIdTGoJfaE';

    try {
        const res = await fetch(`${supabaseUrl}/rest/v1/analytics_events?select=*&order=created_at.desc&limit=500`, {
            headers: {
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json'
            }
        });

        if (!res.ok) {
            if (res.status === 404 || res.status === 400 || res.status === 401) {
                if (tableBody) {
                    tableBody.innerHTML = `<tr><td colspan="4" class="py-6 text-center text-slate-400">
                        <div class="font-semibold text-amber-400">Supabase table 'analytics_events' awaiting creation.</div>
                        <div class="text-xs text-slate-500 mt-1">Run <code class="text-slate-300">scripts/create_analytics_table.sql</code> in your Supabase SQL Editor to start logging live events.</div>
                    </td></tr>`;
                }
                if (statVisitors) statVisitors.textContent = '0';
                if (statUnique) statUnique.textContent = '0';
                if (statApk) statApk.textContent = '0';
                if (statPwa) statPwa.textContent = '0';
                if (statMap) statMap.textContent = '0';
                return;
            }
        }

        const events = await res.json();
        if (!Array.isArray(events)) return;

        let totalVisits = 0;
        const uniqueDevices = new Set();
        let apkDownloads = 0;
        let pwaInstalls = 0;
        let mapActions = 0;
        const osCount = {};

        events.forEach(e => {
            if (e.device_id) uniqueDevices.add(e.device_id);
            if (e.event_name === 'page_view') totalVisits++;
            else if (e.event_name === 'apk_download') apkDownloads++;
            else if (e.event_name === 'pwa_installed') pwaInstalls++;
            else if (e.event_name === 'direction_mode_click' || e.event_name === 'search') mapActions++;

            const os = e.device_os || 'Other';
            osCount[os] = (osCount[os] || 0) + 1;
        });

        if (statVisitors) statVisitors.textContent = totalVisits.toLocaleString();
        if (statUnique) statUnique.textContent = uniqueDevices.size.toLocaleString();
        if (statApk) statApk.textContent = apkDownloads.toLocaleString();
        if (statPwa) statPwa.textContent = pwaInstalls.toLocaleString();
        if (statMap) statMap.textContent = mapActions.toLocaleString();
        if (lastSynced) lastSynced.textContent = `Updated ${new Date().toLocaleTimeString()}`;

        // Render Platform Bars
        const totalOsEvents = events.length || 1;
        const sortedOs = Object.entries(osCount).sort((a,b) => b[1] - a[1]);
        if (osContainer) {
            if (sortedOs.length === 0) {
                osContainer.innerHTML = '<div class="text-xs text-slate-500">No events logged yet.</div>';
            } else {
                osContainer.innerHTML = sortedOs.map(([os, count]) => {
                    const pct = Math.round((count / totalOsEvents) * 100);
                    const color = os === 'Android' ? 'bg-emerald-500' : (os === 'iOS' ? 'bg-indigo-500' : 'bg-sky-500');
                    return `
                        <div>
                            <div class="flex justify-between text-xs mb-1">
                                <span class="font-medium text-slate-300">${os}</span>
                                <span class="text-slate-400">${count} (${pct}%)</span>
                            </div>
                            <div class="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                                <div class="h-full ${color} rounded-full" style="width: ${pct}%"></div>
                            </div>
                        </div>
                    `;
                }).join('');
            }
        }

        // Render Live Stream Table
        if (tableBody) {
            if (events.length === 0) {
                tableBody.innerHTML = '<tr><td colspan="4" class="py-6 text-center text-slate-500">No telemetry events logged yet.</td></tr>';
            } else {
                tableBody.innerHTML = events.slice(0, 30).map(e => {
                    let badge = 'bg-slate-800 text-slate-300';
                    let icon = '•';
                    if (e.event_name === 'apk_download') { badge = 'bg-emerald-950/80 text-emerald-400 border border-emerald-500/30'; icon = '📥 APK'; }
                    else if (e.event_name === 'pwa_installed') { badge = 'bg-amber-950/80 text-amber-400 border border-amber-500/30'; icon = '📱 PWA'; }
                    else if (e.event_name === 'page_view') { badge = 'bg-indigo-950/80 text-indigo-300 border border-indigo-500/30'; icon = '👀 View'; }
                    else { badge = 'bg-sky-950/80 text-sky-400 border border-sky-500/30'; icon = '🗺️ Action'; }

                    const timeAgo = formatTimeAgo(new Date(e.created_at));
                    return `
                        <tr class="hover:bg-slate-800/30 transition">
                            <td class="py-2.5">
                                <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold ${badge}">${icon} ${e.event_name}</span>
                            </td>
                            <td class="py-2.5 text-slate-400 font-mono text-[11px]">${e.device_os || 'Unknown'}</td>
                            <td class="py-2.5 text-slate-400 text-[11px] truncate max-w-[120px]">${e.path || '/'}</td>
                            <td class="py-2.5 text-right text-slate-500 text-[11px] whitespace-nowrap">${timeAgo}</td>
                        </tr>
                    `;
                }).join('');
            }
        }

        if (notifySuccess) {
            showToast('Analytics refreshed', 'success');
        }
    } catch (err) {
        console.error('[Analytics] Error rendering telemetry:', err);
        if (tableBody) {
            tableBody.innerHTML = `<tr><td colspan="4" class="py-4 text-center text-red-400">Failed to connect to Supabase: ${err.message}</td></tr>`;
        }
    }
}
window.renderAnalyticsDashboard = renderAnalyticsDashboard;

// Robust execution lifecycle
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
