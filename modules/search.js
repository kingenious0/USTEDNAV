/**
 * Search Module - Smart campus location & staff search for USTED
 */
const SearchModule = (() => {
    let searchInput, searchResults;
    let buildingsData = [];
    let peopleData = [];
    let debounceTimer;

    const typeLabels = {
        staff: 'Academic Staff',
        faculty: 'Faculty',
        lecture_hall: 'Lecture Hall / Lab',
        hostel: 'Hall of Residence',
        administration: 'Administration',
        facility: 'Facility',
        service: 'Service',
        room: 'Room'
    };

    const typeColors = {
        staff: '#4f46e5',
        faculty: '#4f46e5',
        lecture_hall: '#f59e0b',
        hostel: '#10b981',
        administration: '#ef4444',
        facility: '#8b5cf6',
        service: '#06b6d4',
        room: '#84cc16'
    };

    const SYNONYMS = {
        "lr": ["lecture room", "lecture hall", "classroom"],
        "lecture room": ["lr", "classroom"],
        "lab": ["laboratory", "workshop"],
        "work shop": ["workshop"],
        "library": ["lib"],
        "lib": ["library"],
        "mosque": ["masjid"],
        "clinic": ["medical", "hospital", "health"],
        "admin": ["administration", "registry"],
        "fbe": ["faculty of business education", "business", "rob"],
        "fas": ["faculty of applied sciences", "fasme"],
        "fasme": ["faculty of applied sciences and mathematics education", "fas", "adb"],
        "fte": ["faculty of technical education", "technical", "fbr"],
        "fbr": ["faculty block", "faculty of technical education", "fte"],
        "fve": ["faculty of vocational education", "vocational", "cbt"],
        "cbt": ["competency based training", "vocational", "fve", "fashion", "hospitality"],
        "fet": ["faculty of engineering and technology", "engineering"],
        "sgs": ["school of graduate studies", "graduate"],
        "dis": ["department of interdisciplinary studies", "interdisciplinary", "ids"],
        "dhte": ["department of hospitality and tourism education", "hospitality", "tourism", "catering"],
        "dfdte": ["department of fashion design and textiles education", "fashion", "textiles"],
        "esa": ["executive students association", "executive students association lecture block", "esa block", "esa lecture block"],
        "odsa": ["dean of students", "office of the dean of student affairs", "dean of student affairs", "student affairs", "odsa lib"],
        "dosa": ["dean of students", "office of the dean of student affairs", "odsa"],
        "ite": ["department of information technology education", "fasme", "adb", "information technology"],
        "ow": ["opoku ware"],
        "wc": ["washroom", "toilet", "restroom"],
        "washroom": ["wc", "toilet", "restroom"],
        "toilet": ["wc", "washroom", "restroom"],
        "restroom": ["wc", "washroom", "toilet"]
    };

    const DEPT_MAP = {
        "dis": "Department of Interdisciplinary Studies",
        "dhte": "Department of Hospitality and Tourism Education",
        "dfdte": "Department of Fashion Design and Textiles Education",
        "del": "Department of Educational Leadership",
        "sgs": "School of Graduate Studies"
    };

    const tryRequireDataLoader = () => {
        try {
            if (typeof require !== 'undefined') return require('./data-loader.js');
        } catch (e) {}
        return null;
    };

    const init = async () => {
        searchInput = document.getElementById('searchInput');
        searchResults = document.getElementById('searchResults');

        // Stale-While-Revalidate Data Loading via DataLoader
        const loader = (typeof DataLoader !== 'undefined') ? DataLoader : tryRequireDataLoader();

        if (loader && typeof loader.loadCampusData === 'function') {
            try {
                const res = await loader.loadCampusData((updated) => {
                    buildingsData = updated.buildingsData;
                    peopleData = updated.peopleData;
                    if (searchInput && searchInput.value && searchInput.value.trim().length > 0) {
                        handleSearch(searchInput.value.trim());
                    }
                });
                if (res) {
                    buildingsData = res.buildingsData || [];
                    peopleData = res.peopleData || [];
                }
            } catch (loadErr) {
                console.warn('[SearchModule] DataLoader notice:', loadErr);
            }
        }

        // Bundled fallback if DataLoader was unavailable or returned empty
        if (!buildingsData || buildingsData.length === 0) {
            if (typeof MapModule !== 'undefined' && MapModule.getBuildingsData) {
                buildingsData = MapModule.getBuildingsData() || [];
            }
            if (!buildingsData || buildingsData.length === 0) {
                try {
                    const res = await fetch('data/buildings.json');
                    buildingsData = await res.json();
                } catch (err) {
                    console.warn('SearchModule: Failed to fetch bundled data/buildings.json', err);
                }
            }
        }

        if (!peopleData || peopleData.length === 0) {
            try {
                const res = await fetch('data/people.json');
                peopleData = await res.json();
            } catch (err) {
                console.warn('SearchModule: Failed to fetch bundled data/people.json', err);
            }
        }

        // Listen for global data updates (e.g. from map or studio sync)
        if (typeof window !== 'undefined') {
            window.addEventListener('campusos:data-updated', (e) => {
                if (e.detail) {
                    if (e.detail.buildingsData) buildingsData = e.detail.buildingsData;
                    if (e.detail.peopleData) peopleData = e.detail.peopleData;
                    if (searchInput && searchInput.value && searchInput.value.trim().length > 0) {
                        handleSearch(searchInput.value.trim());
                    }
                }
            });
        }

        // Recent searches helper
        const getRecentSearches = () => {
            try {
                const raw = localStorage.getItem('ustednav_recent_searches');
                return raw ? JSON.parse(raw) : [];
            } catch (e) {
                return [];
            }
        };

        const saveRecentSearch = (label, query) => {
            if (!label || !query) return;
            try {
                let recents = getRecentSearches();
                recents = recents.filter(r => r.label.toLowerCase() !== label.toLowerCase() && r.query.toLowerCase() !== query.toLowerCase());
                recents.unshift({ label, query, time: Date.now() });
                if (recents.length > 6) recents = recents.slice(0, 6);
                localStorage.setItem('ustednav_recent_searches', JSON.stringify(recents));
            } catch (e) {}
        };

        const removeRecentSearch = (label) => {
            try {
                let recents = getRecentSearches().filter(r => r.label.toLowerCase() !== label.toLowerCase());
                localStorage.setItem('ustednav_recent_searches', JSON.stringify(recents));
            } catch (e) {}
        };

        const renderRecentSearches = () => {
            if (!searchResults) return;
            const recents = getRecentSearches();
            if (!recents || recents.length === 0) {
                searchResults.innerHTML = '';
                if (searchResults.classList) searchResults.classList.remove('open');
                return;
            }

            searchResults.innerHTML = `
                <div class="recent-searches-box">
                    <div class="recent-searches-header">
                        <span><i class="fas fa-clock-rotate-left" style="margin-right:4px"></i> Recent Searches</span>
                        <button type="button" class="recent-clear-btn" id="recentClearBtn">Clear all</button>
                    </div>
                    <div class="recent-chips-wrap">
                        ${recents.map(r => `
                            <div class="recent-search-chip" data-query="${escapeHtml(r.query)}">
                                <span class="chip-text">${escapeHtml(r.label)}</span>
                                <span class="chip-delete" data-label="${escapeHtml(r.label)}" title="Remove">✕</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;

            // Clear all event
            const clearBtn = searchResults.querySelector('#recentClearBtn');
            if (clearBtn) {
                clearBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    try { localStorage.removeItem('ustednav_recent_searches'); } catch (err) {}
                    renderRecentSearches();
                });
            }

            // Chip click events
            searchResults.querySelectorAll('.recent-search-chip').forEach(chip => {
                chip.addEventListener('click', (e) => {
                    const del = e.target.closest('.chip-delete');
                    if (del) {
                        e.stopPropagation();
                        removeRecentSearch(del.getAttribute('data-label'));
                        renderRecentSearches();
                        return;
                    }
                    const q = chip.getAttribute('data-query');
                    if (q && searchInput) {
                        searchInput.value = q;
                        handleSearch(q);
                        setTimeout(() => {
                            const firstItem = searchResults.querySelector('.result-item');
                            if (firstItem) {
                                firstItem.click();
                            } else if (searchResults.classList) {
                                searchResults.classList.add('open');
                            }
                        }, 50);
                    }
                });
            });

            if (searchResults.classList) searchResults.classList.add('open');
        };

        // Keyboard navigation state
        let currentSelectedIndex = -1;

        const updateKeyboardSelection = (items, index) => {
            items.forEach((item, idx) => {
                if (idx === index) {
                    item.classList.add('is-selected');
                    item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                } else {
                    item.classList.remove('is-selected');
                }
            });
        };

        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                clearTimeout(debounceTimer);
                currentSelectedIndex = -1;
                const val = e.target.value.trim();
                if (val.length === 0) {
                    renderRecentSearches();
                } else {
                    debounceTimer = setTimeout(() => handleSearch(val), 180);
                }
            });

            searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    clearSearch();
                    return;
                }

                if (!searchResults || !searchResults.classList.contains('open')) return;
                const items = Array.from(searchResults.querySelectorAll('.result-item'));
                if (items.length === 0) return;

                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    currentSelectedIndex = (currentSelectedIndex + 1) % items.length;
                    updateKeyboardSelection(items, currentSelectedIndex);
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    currentSelectedIndex = (currentSelectedIndex - 1 + items.length) % items.length;
                    updateKeyboardSelection(items, currentSelectedIndex);
                } else if (e.key === 'Enter') {
                    if (currentSelectedIndex >= 0 && currentSelectedIndex < items.length) {
                        e.preventDefault();
                        items[currentSelectedIndex].click();
                    }
                }
            });

            searchInput.addEventListener('focus', () => {
                if (typeof document !== 'undefined' && document.body) {
                    document.body.classList.add('search-focused');
                }
                if (!searchInput.value || searchInput.value.trim().length === 0) {
                    renderRecentSearches();
                }
            });
        }

        if (searchResults) {
            // Dismiss soft keyboard when user begins scrolling search results
            searchResults.addEventListener('scroll', () => {
                if (searchInput && document.activeElement === searchInput) {
                    searchInput.blur();
                }
            }, { passive: true });
        }

        // Close results on outside click
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.search-section') && !e.target.closest('.search-bar')) {
                clearSearch();
            }
        });

        // Trigger search if URL has query parameter (e.g., from landing page quick-search)
        if (typeof window !== 'undefined' && window.location) {
            const urlParams = new URLSearchParams(window.location.search);
            const initialQuery = urlParams.get('q') || urlParams.get('search');
            if (initialQuery && searchInput) {
                searchInput.value = initialQuery;
                setTimeout(() => {
                    handleSearch(initialQuery);
                }, 100);
            }
        }
    };

    const CODE_TO_BUILDING_ID = {
        'ROB': 25,
        'ESA': 21,
        'NFB': 22,
        'NLB': 23,
        'CBT': 35,
        'FBR': 13,
        'FTE': 13,
        'ADB': 28,
        'FASME': 28,
        'FSE': 28,
        'ADMIN': 26,
        'LIBRARY': 1,
        'ODSA': 30,
        'DEAN': 30
    };

    const getBuildingForCode = (code, customBData) => {
        const pool = customBData || buildingsData;
        if (!code || !pool) return null;
        const c = String(code).toUpperCase().trim();
        if (CODE_TO_BUILDING_ID[c]) {
            const b = pool.find(x => x.id === CODE_TO_BUILDING_ID[c] || String(x.id) === String(CODE_TO_BUILDING_ID[c]));
            if (b) return b;
        }
        const direct = pool.find(x => String(x.id) === c);
        if (direct) return direct;
        return pool.find(b => {
            const s = (b.shortName || '').toUpperCase();
            const n = (b.name || '').toUpperCase();
            const kws = (b.keywords || []).map(x => (x || '').toUpperCase());
            return s === c || n === c || s.includes(c) || kws.includes(c);
        }) || null;
    };

    const sanitizeRoomTitle = (str) => {
        if (!str) return '';
        let s = String(str).trim();
        s = s.replace(/^Room\s+(Rm|Room)\.?\s*/i, 'Room ');
        s = s.replace(/^Rm\.?\s+/i, 'Room ');
        s = s.replace(/^Room\s*-\s*Room\s+/i, 'Room ');
        s = s.replace(/^(Room|Rm)\.?\s*[-–—]?\s*(Department|Dept\.?|Faculty|Centre|Center|Directorate|Unit|Division)\b/i, '$2');
        return s;
    };

    const formatRoomNumber = (num) => {
        if (!num) return '';
        let s = sanitizeRoomTitle(num);
        if (/^(Department|Dept\.?|Faculty|Centre|Center|Directorate|Unit|Division|Library|Auditorium|Hall|Lecture|Lab|Office|Room)/i.test(s)) {
            return s.replace(/^Room\s+((Department|Dept\.?|Faculty|Centre|Center|Directorate|Unit|Division)\b)/i, '$1');
        }
        if (!/^(Room|Lecture|Hall|Lab|Auditorium|Office)/i.test(s)) {
            s = `Room ${s}`;
        }
        return sanitizeRoomTitle(s);
    };

    const formatStaffSubtitle = (p) => {
        if (!p) return '';
        if (p.id === 'dr-theresa-dede-lawer' || (p.department && p.department.includes('DIS') && p.specialRole)) {
            return `${p.position || 'Senior Lecturer'} • Interdisciplinary Studies / CDSC`;
        }
        if (p.id === 'prof-stephen-baffour-adjei' || (p.name && p.name.includes('Stephen Baffour Adjei'))) {
            return 'Associate Professor • Department of Interdisciplinary Studies (DIS)';
        }
        if (p.specialRole) {
            const deptShort = p.department ? p.department.replace(/^Department of\s+/i, '') : '';
            return `${p.position || 'Academic Staff'} • ${deptShort ? deptShort + ' / ' : ''}${p.specialRole}`;
        }
        const parts = [p.position, p.department, p.faculty].filter(Boolean);
        if (parts.length >= 2) {
            return `${parts[0]} • ${parts[1]}`;
        }
        return parts[0] || p.department || 'Academic Staff';
    };

    const formatOutdoorHandoff = (itemOrPerson, buildingObj) => {
        const loc = itemOrPerson?.location || itemOrPerson || {};
        if (loc.status === 'building_only' || (!loc.room && !loc.floor && !itemOrPerson?.number && !itemOrPerson?.room)) {
            return '🚶 Routes directly to building entrance';
        }
        const floor = loc.floor || itemOrPerson?.floor || 'Ground Floor';
        const flStr = (floor === 0 || floor === '0') ? 'Ground Floor' : (String(floor).toLowerCase().includes('floor') ? floor : `${floor} Floor`);
        const rawRoom = loc.room || itemOrPerson?.number || itemOrPerson?.room || '';
        const rmStr = formatRoomNumber(rawRoom);
        const wing = loc.wing || itemOrPerson?.metadata?.wing || itemOrPerson?.wing;
        const wingStr = wing ? (String(wing).toLowerCase().includes('wing') ? wing : `${wing} Wing`) : '';
        if (rmStr) {
            const insidePart = [flStr, wingStr, rmStr].filter(Boolean).join(', ');
            return `🚶 Routes to main entrance • Head inside for ${insidePart}`;
        }
        return '🚶 Routes directly to building entrance';
    };

    const formatLocationPill = (personOrLoc, buildingObj) => {
        const loc = personOrLoc?.location || personOrLoc || {};
        if (personOrLoc?.id === 'dr-theresa-dede-lawer' || (personOrLoc?.name && personOrLoc.name.includes('Theresa Dede Lawer'))) {
            return '📍 Main Administration Block';
        }
        if (personOrLoc?.id === 'prof-stephen-baffour-adjei' || (personOrLoc?.name && personOrLoc.name.includes('Stephen Baffour Adjei'))) {
            return '📍 ROB Block';
        }
        const bCode = loc.building || (buildingObj ? (buildingObj.shortName || buildingObj.name) : '') || 'Campus';
        const bName = buildingObj ? (buildingObj.shortName || buildingObj.name) : bCode;
        const floor = loc.floor;
        const room = loc.room;

        if (loc.status === 'building_only') {
            return `${bName}`;
        }
        if (loc.status === 'exact' && room) {
            const roomStr = formatRoomNumber(room);
            if (floor) {
                return `${bName} — ${floor}, ${roomStr}`;
            }
            return `${bName} — ${roomStr}`;
        } else if (bName) {
            return `${bName}`;
        }
        return 'Campus Office Unresolved';
    };

    const formatBreadcrumb = (buildingObjOrPerson, personOrBuilding) => {
        let b = buildingObjOrPerson;
        let p = personOrBuilding;
        if (buildingObjOrPerson && (buildingObjOrPerson.type === 'staff' || buildingObjOrPerson.data?.department !== undefined || (buildingObjOrPerson.department !== undefined && buildingObjOrPerson.faculty !== undefined))) {
            p = buildingObjOrPerson.data || buildingObjOrPerson;
            b = personOrBuilding || buildingObjOrPerson.building;
        } else if (personOrBuilding && (personOrBuilding.type === 'staff' || personOrBuilding.data?.department !== undefined)) {
            p = personOrBuilding.data || personOrBuilding;
            b = buildingObjOrPerson || personOrBuilding.building;
        }
        const bName = b ? b.name : (p?.location?.building ? `${p.location.building} Building` : 'Campus Building');
        const floor = p?.location?.floor;
        const room = p?.location?.room;
        const cleanName = p ? (p.title && !p.name.startsWith(p.title) ? `${p.title} ${p.name}` : p.name) : '';
        const roomStr = room ? formatRoomNumber(room) : '';

        if (p?.location?.status === 'building_only' || !roomStr) {
            return `${bName} (${cleanName})`;
        }

        if (floor && roomStr) {
            return `${bName} — ${floor}, ${roomStr} (${cleanName})`;
        } else if (roomStr) {
            return `${bName} — ${roomStr} (${cleanName})`;
        } else if (floor) {
            return `${bName} — ${floor} (${cleanName})`;
        }
        return `${bName} (${cleanName})`;
    };

    const formatRoomBreadcrumb = (roomOrB, buildingObjOrR) => {
        let r = roomOrB;
        let b = buildingObjOrR;
        if (roomOrB && (roomOrB.rooms !== undefined || (roomOrB.type && !roomOrB.number))) {
            b = roomOrB;
            r = buildingObjOrR;
        }
        const bName = b ? b.name : 'Campus Building';
        const roomStr = r?.number ? formatRoomNumber(r.number) : '';
        const floorVal = r?.floor;
        const floorStr = (floorVal === 0 || floorVal === '0') ? 'Ground Floor' : (floorVal ? (String(floorVal).match(/floor/i) ? floorVal : `${floorVal} Floor`) : 'Ground Floor');
        const occupant = r?.occupant || (r?.staff && r.staff[0]);
        if (occupant) {
            const cleanOcc = String(occupant).trim();
            const cleanRoom = roomStr.replace(/^Room\s+/i, '').trim();
            if (cleanOcc && cleanOcc !== roomStr && cleanOcc !== cleanRoom && !cleanOcc.toLowerCase().includes(roomStr.toLowerCase())) {
                return `${bName} — ${floorStr}, ${roomStr} (${cleanOcc})`;
            }
        }
        return `${bName} — ${floorStr}, ${roomStr}`;
    };

    const formatServiceBreadcrumb = (b, s) => {
        const bName = b ? b.name : 'Campus Building';
        const floorStr = s.floor ? (String(s.floor).toLowerCase().includes('floor') ? s.floor : `${s.floor} Floor`) : '';
        const roomStr = s.room ? formatRoomNumber(s.room) : '';
        const locParts = [floorStr, roomStr].filter(Boolean).join(', ');
        if (locParts) {
            return `${bName} — ${locParts} (${s.name})`;
        }
        return `${bName} (${s.name})`;
    };

    const formatDist = (meters) => {
        if (typeof window !== 'undefined' && typeof window.formatDist === 'function') {
            return window.formatDist(meters);
        }
        if (!meters || isNaN(meters)) return '';
        if (meters < 1000) return `${Math.round(meters)}m`;
        return `${(meters / 1000).toFixed(1)}km`;
    };

    const getOriginCoord = () => {
        if (typeof window !== 'undefined') {
            if (window.userLatLng) return window.userLatLng;
            if (window.CAMPUS) return { lat: window.CAMPUS.lat, lng: window.CAMPUS.lng };
        }
        return { lat: 6.6975, lng: -1.6811 };
    };

    const haversineDist = (lat1, lon1, lat2, lon2) => {
        if (!lat1 || !lon1 || !lat2 || !lon2) return 0;
        const R = 6371000;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    const fuzzyMatchScore = (text, token) => {
        if (!text || token.length < 2) return 0;
        let textIdx = 0;
        let tokenIdx = 0;
        let score = 0;
        let matches = 0;

        while (textIdx < text.length && tokenIdx < token.length) {
            if (text[textIdx] === token[tokenIdx]) {
                tokenIdx++;
                matches++;
                score += 5;
                if (textIdx > 0 && text[textIdx - 1] === token[tokenIdx - 2]) {
                    score += 5;
                }
            } else {
                score -= 1;
            }
            textIdx++;
        }

        if (tokenIdx === token.length || matches >= token.length * 0.7) {
            return Math.max(5, score);
        }
        return 0;
    };

    const getMatchScore = (text, queryTokens, queryExpanded) => {
        if (!text) return 0;
        const normalized = text.toLowerCase();
        let totalScore = 0;
        let matchedAny = false;

        queryExpanded.forEach(token => {
            if (normalized.includes(token)) {
                matchedAny = true;
                totalScore += 30;
                if (normalized.startsWith(token)) {
                    totalScore += 15;
                }
            } else {
                const fuzzy = fuzzyMatchScore(normalized, token);
                if (fuzzy > 0) {
                    matchedAny = true;
                    totalScore += fuzzy;
                }
            }
        });

        const fullQuery = queryTokens.join(' ');
        if (normalized.includes(fullQuery)) {
            totalScore += 50;
            if (normalized === fullQuery) {
                totalScore += 100;
            }
        }

        return matchedAny ? totalScore : 0;
    };

    const search = (query, customBuildings, customPeople) => {
        const rawQ = (query || '').toLowerCase().trim();
        if (rawQ.length < 1) return [];

        const bData = customBuildings || buildingsData || [];
        const pData = customPeople || peopleData || [];

        // Split query into tokens and expand with synonyms
        const queryTokens = rawQ.split(/\s+/).filter(t => t.length > 0);
        const queryExpanded = [...queryTokens];
        queryTokens.forEach(token => {
            if (SYNONYMS[token]) {
                queryExpanded.push(...SYNONYMS[token]);
            }
        });

        let results = [];

        // 1. Score People / Staff
        pData.forEach(p => {
            let score = 0;
            const fullName = (p.name || '').toLowerCase();
            const position = (p.position || '').toLowerCase();
            const department = (p.department || '').toLowerCase();
            const faculty = (p.faculty || '').toLowerCase();
            const building = (p.location?.building || '').toLowerCase();
            const room = (p.location?.room || '').toLowerCase();
            const floor = (p.location?.floor || '').toLowerCase();
            const combinedLocation = `${building} ${room}`.toLowerCase();
            const searchableBlob = `${fullName} ${position} ${department} ${faculty} ${combinedLocation} ${floor}`;

            // Check full query match
            if (fullName === rawQ) score += 250;
            else if (fullName.startsWith(rawQ)) score += 150;
            else if (fullName.includes(rawQ)) score += 100;

            if (combinedLocation === rawQ || (room && room === rawQ)) score += 180;
            else if (combinedLocation.includes(rawQ)) score += 120;

            // Multi-token evaluation
            let tokensMatched = 0;
            queryTokens.forEach(tok => {
                let tokenHit = false;
                if (fullName.includes(tok)) { score += 50; tokenHit = true; }
                if (combinedLocation.includes(tok) || (room && room.includes(tok))) { score += 40; tokenHit = true; }
                if (department.includes(tok) || faculty.includes(tok)) { score += 35; tokenHit = true; }
                if (position.includes(tok)) { score += 20; tokenHit = true; }

                // Check acronyms
                if (SYNONYMS[tok]) {
                    SYNONYMS[tok].forEach(syn => {
                        if (searchableBlob.includes(syn)) { score += 30; tokenHit = true; }
                    });
                }
                if (tokenHit) tokensMatched++;
            });

            // Reward queries where all tokens matched
            if (tokensMatched === queryTokens.length && queryTokens.length > 1) {
                score += 80;
            }

            if (score > 0) {
                const bObj = (p.location?.targetBuildingId ? bData.find(b => b.id === p.location.targetBuildingId) : null) || getBuildingForCode(p.location?.building, bData);
                results.push({
                    type: 'staff',
                    id: p.id,
                    data: p,
                    name: p.name,
                    building: bObj,
                    buildingCode: p.location?.building,
                    location: p.location,
                    matchScore: score,
                    score: score,
                    locationPill: formatLocationPill(p, bObj),
                    breadcrumb: formatBreadcrumb(p, bObj)
                });
            }
        });

        // 2. Score Buildings
        bData.forEach(b => {
            let maxScore = 0;
            const nameScore = getMatchScore(b.name, queryTokens, queryExpanded) * 2.5;
            const shortNameScore = getMatchScore(b.shortName, queryTokens, queryExpanded) * 2.0;
            const descScore = getMatchScore(b.description, queryTokens, queryExpanded) * 1.0;
            const deptScore = getMatchScore(b.department, queryTokens, queryExpanded) * 1.5;

            maxScore = Math.max(nameScore, shortNameScore, descScore, deptScore);

            // Score keywords
            if (b.keywords) {
                b.keywords.forEach(kw => {
                    const kwScore = getMatchScore(kw, queryTokens, queryExpanded) * 1.6;
                    maxScore = Math.max(maxScore, kwScore);
                });
            }

            if (maxScore > 0) {
                results.push({
                    type: 'building',
                    id: b.id,
                    data: b,
                    name: b.name,
                    building: b,
                    buildingCode: b.shortName,
                    matchScore: maxScore,
                    score: maxScore,
                    locationPill: b.shortName || b.name,
                    breadcrumb: b.name
                });
            }
        });

        // 3. Score Services
        bData.filter(b => b.services).forEach(b => {
            b.services.forEach(s => {
                const sScore = getMatchScore(s.name, queryTokens, queryExpanded) * 2.0;
                if (sScore > 0) {
                    results.push({
                        type: 'service',
                        id: s.id || `${b.id}-${s.name}`,
                        data: s,
                        name: s.name,
                        building: b,
                        buildingCode: b.shortName,
                        matchScore: sScore,
                        score: sScore,
                        locationPill: b.shortName || b.name,
                        breadcrumb: `${b.name} — ${s.name}`
                    });
                }
            });
        });

        // 4. Score Rooms
        bData.filter(b => b.rooms).forEach(b => {
            b.rooms.forEach(r => {
                let rScore = getMatchScore(r.number, queryTokens, queryExpanded) * 2.2;
                if (r.room) {
                    const rmScore = getMatchScore(r.room, queryTokens, queryExpanded) * 2.5;
                    rScore = Math.max(rScore, rmScore);
                }
                if (r.description) {
                    const descScore = getMatchScore(r.description, queryTokens, queryExpanded) * 2.2;
                    rScore = Math.max(rScore, descScore);
                }
                if (r.name && r.name !== r.number) {
                    const nameScore = getMatchScore(r.name, queryTokens, queryExpanded) * 2.0;
                    rScore = Math.max(rScore, nameScore);
                }
                if (r.metadata) {
                    if (r.metadata.purpose) {
                        const purpScore = getMatchScore(r.metadata.purpose.replace(/_/g, ' '), queryTokens, queryExpanded) * 1.5;
                        rScore = Math.max(rScore, purpScore);
                    }
                    if (r.metadata.wing) {
                        const wingScore = getMatchScore(r.metadata.wing, queryTokens, queryExpanded) * 1.5;
                        rScore = Math.max(rScore, wingScore);
                    }
                }
                if (r.wing) {
                    const wingScore = getMatchScore(r.wing, queryTokens, queryExpanded) * 1.5;
                    rScore = Math.max(rScore, wingScore);
                }
                if (r.keywords) {
                    r.keywords.forEach(kw => {
                        const kwScore = getMatchScore(kw, queryTokens, queryExpanded) * 1.8;
                        rScore = Math.max(rScore, kwScore);
                    });
                }
                if (rScore > 0) {
                    const floorStr = (r.floor === 0 || r.floor === '0') ? 'Ground Floor' : (r.floor ? (String(r.floor).match(/floor/i) ? r.floor : `${r.floor} Floor`) : 'Ground Floor');
                    const wing = r.wing || r.metadata?.wing;
                    const wingStr = wing ? (String(wing).match(/wing/i) ? wing : `${wing} Wing`) : '';
                    const roomStr = formatRoomNumber(r.number);

                    results.push({
                        type: 'room',
                        id: r.id || `${b.id}-${r.number}`,
                        data: r,
                        name: r.number,
                        building: b,
                        buildingCode: b.shortName,
                        room: r.number,
                        matchScore: rScore,
                        score: rScore,
                        locationPill: `${b.shortName || b.name} — ${floorStr}${wingStr ? ', ' + wingStr : ''}, ${roomStr}`,
                        breadcrumb: formatRoomBreadcrumb(r, b)
                    });
                }
            });
        });

        // Sort by match score descending
        results.sort((a, b) => b.matchScore - a.matchScore);

        // De-duplicate
        const uniqueResults = [];
        const seen = new Set();
        results.forEach(r => {
            const key = r.type === 'staff' ? `staff-${r.data.id}` :
                        r.type === 'service' ? `s-${r.building.id}-${r.data.name}` :
                        r.type === 'room' ? `r-${r.building.id}-${r.data.number}` : `b-${r.data.id}`;
            if (!seen.has(key)) {
                seen.add(key);
                uniqueResults.push(r);
            }
        });

        return uniqueResults;
    };

    const handleSearch = (query) => {
        const rawQ = (query || '').toLowerCase().trim();
        if (!searchResults) return;
        searchResults.innerHTML = '';

        if (rawQ.length < 1) return;

        const results = search(rawQ);
        displayResults(results.slice(0, 15), rawQ);
    };

    const closeSearchUI = (value) => {
        if (searchResults && searchResults.classList) {
            searchResults.classList.remove('open');
        }
        if (typeof document !== 'undefined' && document.body) {
            document.body.classList.remove('search-focused');
        }
        if (searchInput) {
            if (value !== undefined) searchInput.value = value;
            searchInput.blur();
        }
        const clearBtn = document.getElementById('searchClear');
        const searchBtn = document.getElementById('searchSearchBtn');
        if (clearBtn) clearBtn.style.display = 'block';
        if (searchBtn) searchBtn.style.display = 'none';
    };

    const triggerRoute = (lat, lng, breadcrumb) => {
        if (typeof window !== 'undefined') {
            if (typeof window.startRoute === 'function') {
                window.startRoute(lat, lng, breadcrumb);
                return;
            }
            if (typeof RouteModule !== 'undefined' && typeof RouteModule.calculateRoute === 'function') {
                RouteModule.calculateRoute(lat, lng, breadcrumb);
                return;
            }
            window.dispatchEvent(new CustomEvent('campusos:start-route', {
                detail: { lat, lng, destinationName: breadcrumb }
            }));
        }
    };

    let activeSearchFilter = 'all';

    const displayResults = (results, query) => {
        if (!searchResults) return;
        searchResults.innerHTML = '';

        if (!results || results.length === 0) {
            searchResults.innerHTML = `
                <div class="no-results" style="padding: 18px 16px; text-align: center; color: var(--muted, #64748b); font-size: 13px;">
                    <i class="fas fa-location-crosshairs" style="font-size: 20px; display: block; margin-bottom: 8px; opacity: 0.6;"></i>
                    <span style="font-weight: 500;">No matching campus location or staff found</span>
                </div>`;
            if (searchResults.classList) searchResults.classList.add('open');
            return;
        }

        const categorized = {
            building: [],
            room: [],
            service: [],
            staff: []
        };

        results.forEach(r => {
            if (categorized[r.type]) {
                categorized[r.type].push(r);
            } else {
                categorized.building.push(r);
            }
        });

        // 1. Mobile Filter Pills Row
        const availableTabs = [
            { key: 'all', label: 'All', count: results.length, icon: 'fa-layer-group' }
        ];

        if (categorized.building.length > 0) availableTabs.push({ key: 'building', label: 'Buildings', count: categorized.building.length, icon: 'fa-building' });
        if (categorized.room.length > 0) availableTabs.push({ key: 'room', label: 'Rooms & Halls', count: categorized.room.length, icon: 'fa-door-open' });
        if (categorized.service.length > 0) availableTabs.push({ key: 'service', label: 'Services', count: categorized.service.length, icon: 'fa-concierge-bell' });
        if (categorized.staff.length > 0) availableTabs.push({ key: 'staff', label: 'Staff', count: categorized.staff.length, icon: 'fa-user-tie' });

        if (availableTabs.length > 2) {
            const tabsRow = document.createElement('div');
            tabsRow.className = 'search-filter-pills-row';
            tabsRow.innerHTML = availableTabs.map(t => `
                <button type="button" class="search-tab-pill ${activeSearchFilter === t.key ? 'active' : ''}" data-cat="${t.key}">
                    <i class="fas ${t.icon}"></i>
                    <span>${t.label}</span>
                    <span class="pill-count">${t.count}</span>
                </button>
            `).join('');

            tabsRow.querySelectorAll('.search-tab-pill').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    activeSearchFilter = btn.getAttribute('data-cat');
                    displayResults(results, query);
                });
            });
            searchResults.appendChild(tabsRow);
        } else {
            activeSearchFilter = 'all';
        }

        const CATEGORY_CONFIG = [
            { key: 'building', label: 'Buildings', icon: 'fa-building', color: '#2563eb' },
            { key: 'room', label: 'Rooms & Lecture Halls', icon: 'fa-door-open', color: '#10b981' },
            { key: 'service', label: 'Services & Offices', icon: 'fa-concierge-bell', color: '#0284c7' },
            { key: 'staff', label: 'Staff & Lecturers', icon: 'fa-user-tie', color: '#4f46e5' }
        ];

        const origin = getOriginCoord();

        CATEGORY_CONFIG.forEach(cat => {
            if (activeSearchFilter !== 'all' && activeSearchFilter !== cat.key) return;
            const items = categorized[cat.key];
            if (!items || items.length === 0) return;

            // Category Header
            const header = document.createElement('div');
            header.className = 'search-category-header';
            header.innerHTML = `
                <span class="search-category-title">
                    <i class="fas ${cat.icon}" style="color:${cat.color}"></i> ${cat.label}
                </span>
                <span class="search-category-count">${items.length}</span>
            `;
            searchResults.appendChild(header);

            // Group Rooms by Floor if looking at rooms
            let lastFloor = null;

            items.forEach(r => {
                const b = r.building || (r.type === 'building' ? r.data : null);
                const bDist = (b && b.lat && b.lng) ? haversineDist(origin.lat, origin.lng, b.lat, b.lng) : 0;
                const dStr = bDist > 0 ? formatDist(bDist) : '';

                if (r.type === 'room') {
                    const rData = r.data;
                    const bObj = b || buildingsData[0];
                    const bPrefix = bObj.shortName || bObj.name;
                    const currentFloor = (rData.floor === 0 || rData.floor === '0') ? 'Ground Floor' : (rData.floor ? (String(rData.floor).match(/floor/i) ? rData.floor : `${rData.floor} Floor`) : 'Ground Floor');

                    // If floor changes and we have multiple rooms, show a subtle floor divider
                    if (items.length > 2 && currentFloor !== lastFloor) {
                        lastFloor = currentFloor;
                        const floorSubHeader = document.createElement('div');
                        floorSubHeader.className = 'floor-group-header';
                        floorSubHeader.innerHTML = `<i class="fas fa-layer-group"></i> ${currentFloor}`;
                        searchResults.appendChild(floorSubHeader);
                    }

                    const roomStr = formatRoomNumber(rData.number);
                    const wing = rData.wing || rData.metadata?.wing;
                    const wingStr = wing ? (String(wing).match(/wing/i) ? wing : `${wing} Wing`) : '';
                    const pillText = `${bPrefix} — ${currentFloor}${wingStr ? ', ' + wingStr : ''}`;
                    const breadcrumb = formatRoomBreadcrumb(rData, bObj);

                    const purpose = rData.metadata?.purpose;
                    let tagText = 'Room';
                    if (purpose === 'service_desk' || purpose === 'admin_office') tagText = 'Admin Office';
                    else if (purpose === 'lecture_room') tagText = 'Lecture Hall';
                    else if (purpose === 'lecturer_office') tagText = 'Staff Office';
                    else if (/Department|Dept\.?/i.test(roomStr)) tagText = 'Department';
                    else if (/Lab/i.test(roomStr)) tagText = 'Lab';
                    else if (/Exam|Officer|Secretariat/i.test(rData.description || '')) tagText = 'Admin Office';

                    const titleText = (rData.description && !roomStr.toLowerCase().includes(rData.description.toLowerCase())) ? 
                        `${rData.description} (${roomStr})` : `${bPrefix} - ${roomStr}`;
                    const occupants = rData.occupant ? `Occupant: ${rData.occupant}` : (rData.staff && rData.staff.length ? `Staff: ${rData.staff.join(', ')}` : (rData.description ? `${bObj.name} • ${currentFloor}` : `Located in ${bObj.name}`));

                    const el = document.createElement('div');
                    el.tabIndex = 0;
                    el.className = 'result-item room-result';
                    el.innerHTML = `
                        <div class="result-dot" style="background:#10b981;margin-top:2px"><i class="fas fa-door-open" style="font-size:10px;color:#fff"></i></div>
                        <div class="result-name" style="width:100%;min-width:0">
                            <!-- Line 1: Room code & tag -->
                            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                                <strong style="font-size:14px;color:var(--text, #0f172a);font-weight:700">${highlightMatch(titleText, query)}</strong>
                                <span class="staff-pos-tag" style="color:#059669;background:rgba(16,185,129,0.1)">${tagText}</span>
                            </div>
                            <!-- Line 2: Occupant or building -->
                            <div style="font-size:12px;color:var(--muted, #64748b);margin-top:2px;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${highlightMatch(occupants, query)}</div>
                            <!-- Line 3: Location pill + walking distance -->
                            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:5px;gap:8px">
                                <span class="location-pill room-pill">
                                    <i class="fas fa-location-dot"></i>
                                    ${pillText}
                                </span>
                                <span class="result-dist">${dStr}</span>
                            </div>
                        </div>
                        <button class="quick-route-btn" title="Navigate to ${escapeHtml(roomStr)}" aria-label="Navigate to ${escapeHtml(roomStr)}">
                            <i class="fas fa-diamond-turn-right"></i>
                        </button>
                    `;

                    // Quick Route
                    const qBtn = el.querySelector('.quick-route-btn');
                    qBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        saveRecentSearch(titleText, query);
                        closeSearchUI(`${bPrefix} - ${roomStr}`);
                        triggerRoute(bObj.lat, bObj.lng, breadcrumb);
                    });

                    // Row tap
                    el.addEventListener('click', () => {
                        saveRecentSearch(titleText, query);
                        closeSearchUI(`${bPrefix} - ${roomStr}`);
                        if (typeof window !== 'undefined' && window.ViewControllerModule && window.ViewControllerModule.getMode() === '3D') {
                            window.CesiumViewerModule?.syncCameraFrom2D(bObj.lng, bObj.lat, 18);
                        }
                        if (typeof window !== 'undefined' && typeof window.showRoom === 'function') {
                            if (window.map && bObj) window.map.flyTo({ center: [bObj.lng, bObj.lat], zoom: 19, duration: 800, essential: true });
                            setTimeout(() => window.showRoom(rData, bObj), 850);
                        } else if (typeof BuildingModule !== 'undefined' && BuildingModule.displayServiceOrRoom) {
                            if (typeof MapModule !== 'undefined' && MapModule.centerOnBuilding) MapModule.centerOnBuilding(bObj);
                            BuildingModule.displayServiceOrRoom(bObj, rData);
                        }
                    });

                    searchResults.appendChild(el);

                } else if (r.type === 'building') {
                    const bObj = r.building || r.data;
                    const name = bObj.name;
                    const subtitle = bObj.description || `${bObj.shortName ? bObj.shortName + ' · ' : ''}${typeLabels[bObj.type] || 'Building'}`;

                    const el = document.createElement('div');
                    el.tabIndex = 0;
                    el.className = 'result-item building-result';
                    el.innerHTML = `
                        <div class="result-dot" style="background:${typeColors[bObj.type] || '#2563eb'};margin-top:2px"><i class="fas fa-building" style="font-size:10px;color:#fff"></i></div>
                        <div class="result-name" style="width:100%;min-width:0">
                            <!-- Line 1: Building Name + Short tag -->
                            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                                <strong style="font-size:14px;color:var(--text, #0f172a);font-weight:700">${highlightMatch(name, query)}</strong>
                                ${bObj.shortName ? `<span class="staff-pos-tag" style="color:#2563eb;background:rgba(37,99,235,0.1)">${bObj.shortName}</span>` : ''}
                            </div>
                            <!-- Line 2: Category and description -->
                            <div style="font-size:12px;color:var(--muted, #64748b);margin-top:2px;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${highlightMatch(subtitle, query)}</div>
                            <!-- Line 3: Location pill + walking distance -->
                            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:5px;gap:8px">
                                <span class="location-pill">
                                    <i class="fas fa-location-dot"></i>
                                    ${bObj.name}
                                </span>
                                <span class="result-dist">${dStr}</span>
                            </div>
                        </div>
                        <button class="quick-route-btn" title="Navigate to ${escapeHtml(name)}" aria-label="Navigate to ${escapeHtml(name)}">
                            <i class="fas fa-diamond-turn-right"></i>
                        </button>
                    `;

                    // Quick Route
                    const qBtn = el.querySelector('.quick-route-btn');
                    qBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        saveRecentSearch(name, query);
                        closeSearchUI(name);
                        triggerRoute(bObj.lat, bObj.lng, name);
                    });

                    // Row tap
                    el.addEventListener('click', () => {
                        saveRecentSearch(name, query);
                        closeSearchUI(name);
                        if (typeof window !== 'undefined' && window.ViewControllerModule && window.ViewControllerModule.getMode() === '3D') {
                            window.CesiumViewerModule?.syncCameraFrom2D(bObj.lng, bObj.lat, 18);
                        }
                        if (typeof window !== 'undefined' && typeof window.showBuilding === 'function') {
                            if (window.map && bObj) window.map.flyTo({ center: [bObj.lng, bObj.lat], zoom: 19, duration: 800, essential: true });
                            setTimeout(() => window.showBuilding(bObj), 850);
                        } else if (typeof BuildingModule !== 'undefined' && BuildingModule.displayInfo) {
                            if (typeof MapModule !== 'undefined' && MapModule.centerOnBuilding) MapModule.centerOnBuilding(bObj);
                            BuildingModule.displayInfo(bObj);
                        }
                    });

                    searchResults.appendChild(el);

                } else if (r.type === 'staff') {
                    const p = r.data;
                    const bObj = b || getBuildingForCode(p.location?.building) || buildingsData[0];
                    const pillText = r.locationPill || formatLocationPill(p, bObj);
                    const breadcrumb = r.breadcrumb || formatBreadcrumb(p, bObj);
                    const subtitle = formatStaffSubtitle(p);

                    const el = document.createElement('div');
                    el.tabIndex = 0;
                    el.className = 'result-item staff-result';
                    el.innerHTML = `
                        <div class="result-dot" style="background:#4f46e5;margin-top:2px"><i class="fas fa-user-tie" style="font-size:10px;color:#fff"></i></div>
                        <div class="result-name" style="width:100%;min-width:0">
                            <!-- Line 1: Name + Position Badge -->
                            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                                <strong style="font-size:14px;color:var(--text, #0f172a);font-weight:700">${highlightMatch(p.name, query)}</strong>
                                ${p.position ? `<span class="staff-pos-tag" style="color:#4f46e5;background:rgba(79,70,229,0.1)">${highlightMatch(p.position, query)}</span>` : ''}
                            </div>
                            <!-- Line 2: Department & Faculty -->
                            <div style="font-size:12px;color:var(--muted, #64748b);margin-top:2px;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${highlightMatch(subtitle, query)}</div>
                            <!-- Line 3: Location pill + walking distance -->
                            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:5px;gap:8px">
                                <span class="location-pill">
                                    <i class="fas fa-location-dot"></i>
                                    ${pillText}
                                </span>
                                <span class="result-dist">${dStr}</span>
                            </div>
                        </div>
                        <button class="quick-route-btn" title="Navigate to ${escapeHtml(p.name)}" aria-label="Navigate to ${escapeHtml(p.name)}">
                            <i class="fas fa-diamond-turn-right"></i>
                        </button>
                    `;

                    // Quick Route
                    const qBtn = el.querySelector('.quick-route-btn');
                    qBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        saveRecentSearch(p.name, query);
                        closeSearchUI(p.name);
                        triggerRoute(bObj.lat, bObj.lng, breadcrumb);
                    });

                    // Row tap
                    el.addEventListener('click', () => {
                        saveRecentSearch(p.name, query);
                        closeSearchUI(p.name);
                        if (typeof window !== 'undefined' && window.ViewControllerModule && window.ViewControllerModule.getMode() === '3D') {
                            window.CesiumViewerModule?.syncCameraFrom2D(bObj.lng, bObj.lat, 18);
                        }
                        if (typeof window !== 'undefined' && typeof window.showStaff === 'function') {
                            if (window.map && bObj) window.map.flyTo({ center: [bObj.lng, bObj.lat], zoom: 19, duration: 800, essential: true });
                            setTimeout(() => window.showStaff(p, bObj), 850);
                        } else if (typeof BuildingModule !== 'undefined' && BuildingModule.displayStaff) {
                            if (typeof MapModule !== 'undefined' && MapModule.centerOnBuilding) MapModule.centerOnBuilding(bObj);
                            BuildingModule.displayStaff(bObj, p);
                        }
                    });

                    searchResults.appendChild(el);

                } else if (r.type === 'service') {
                    const s = r.data;
                    const bObj = b || buildingsData[0];
                    const breadcrumb = formatServiceBreadcrumb(bObj, s);
                    const pillText = `${bObj.shortName || bObj.name}${s.floor ? ' · ' + s.floor : ''}`;
                    const subtitle = s.description || ('Service at ' + bObj.name);

                    const el = document.createElement('div');
                    el.tabIndex = 0;
                    el.className = 'result-item service-result';
                    el.innerHTML = `
                        <div class="result-dot" style="background:#0284c7;margin-top:2px"><i class="fas fa-concierge-bell" style="font-size:10px;color:#fff"></i></div>
                        <div class="result-name" style="width:100%;min-width:0">
                            <!-- Line 1: Service Name + Category -->
                            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                                <strong style="font-size:14px;color:var(--text, #0f172a);font-weight:700">${highlightMatch(s.name, query)}</strong>
                                <span class="staff-pos-tag" style="color:#0284c7;background:rgba(2,132,199,0.1)">${escapeHtml(s.category || 'Service')}</span>
                            </div>
                            <!-- Line 2: Description or details -->
                            <div style="font-size:12px;color:var(--muted, #64748b);margin-top:2px;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${highlightMatch(subtitle, query)}</div>
                            <!-- Line 3: Location pill + walking distance -->
                            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:5px;gap:8px">
                                <span class="location-pill service-pill">
                                    <i class="fas fa-location-dot"></i>
                                    ${pillText}
                                </span>
                                <span class="result-dist">${dStr}</span>
                            </div>
                        </div>
                        <button class="quick-route-btn" title="Navigate to ${escapeHtml(s.name)}" aria-label="Navigate to ${escapeHtml(s.name)}">
                            <i class="fas fa-diamond-turn-right"></i>
                        </button>
                    `;

                    // Quick Route
                    const qBtn = el.querySelector('.quick-route-btn');
                    qBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        saveRecentSearch(s.name, query);
                        closeSearchUI(s.name);
                        triggerRoute(bObj.lat, bObj.lng, breadcrumb);
                    });

                    // Row tap
                    el.addEventListener('click', () => {
                        saveRecentSearch(s.name, query);
                        closeSearchUI(s.name);
                        if (typeof window !== 'undefined' && window.ViewControllerModule && window.ViewControllerModule.getMode() === '3D') {
                            window.CesiumViewerModule?.syncCameraFrom2D(bObj.lng, bObj.lat, 18);
                        }
                        if (typeof window !== 'undefined' && typeof window.showService === 'function') {
                            if (window.map && bObj) window.map.flyTo({ center: [bObj.lng, bObj.lat], zoom: 19, duration: 800, essential: true });
                            setTimeout(() => window.showService(s, bObj), 850);
                        } else if (typeof BuildingModule !== 'undefined' && BuildingModule.displayServiceOrRoom) {
                            if (typeof MapModule !== 'undefined' && MapModule.centerOnBuilding) MapModule.centerOnBuilding(bObj);
                            BuildingModule.displayServiceOrRoom(bObj, s);
                        }
                    });

                    searchResults.appendChild(el);
                }
            });
        });

        if (searchResults.classList) searchResults.classList.add('open');
    };

    const highlightMatch = (text, query) => {
        if (!text) return '';
        if (!query) return escapeHtml(text);

        const escapedText = escapeHtml(text);
        const tokens = query.toLowerCase().split(/\s+/).filter(t => t.length > 0);
        let highlighted = escapedText;

        tokens.forEach(tok => {
            const regex = new RegExp(`(${escapeRegex(tok)})`, 'gi');
            highlighted = highlighted.replace(regex, '<mark style="background: rgba(79, 70, 229, 0.15); color: #4f46e5; border-radius: 2px; padding: 0 2px;">$1</mark>');
        });

        return highlighted;
    };

    const escapeHtml = (str) => {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    };

    const escapeRegex = (str) => {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    };

    const clearSearch = () => {
        if (searchResults) {
            searchResults.innerHTML = '';
            if (searchResults.classList) searchResults.classList.remove('open');
        }
        if (typeof document !== 'undefined' && document.body) {
            document.body.classList.remove('search-focused');
        }
    };

    class SearchEngine {
        constructor(buildings = [], people = []) {
            this.buildings = buildings;
            this.people = people;
        }
        search(query) {
            return search(query, this.buildings, this.people);
        }
    }

    return {
        init,
        search,
        SearchEngine,
        formatLocationPill,
        formatBreadcrumb,
        formatRoomBreadcrumb,
        formatServiceBreadcrumb,
        sanitizeRoomTitle,
        formatRoomNumber,
        formatStaffSubtitle,
        formatOutdoorHandoff,
        getPeopleData: () => peopleData,
        getBuildingsData: () => buildingsData,
        updateData: (b, p) => {
            if (b) buildingsData = b;
            if (p) peopleData = p;
        },
        DataLoader: (typeof DataLoader !== 'undefined') ? DataLoader : tryRequireDataLoader(),
        getBuildingForCode,
        SYNONYMS,
        typeLabels
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = SearchModule;
    module.exports.SearchModule = SearchModule;
    module.exports.SearchEngine = SearchModule.SearchEngine;
}
if (typeof window !== 'undefined') {
    window.SearchModule = SearchModule;
    window.Search = SearchModule;
}