/**
 * Map Module - USTED NAV Kumasi Campus
 */
const MapModule = (() => {
    let map;
    let markers = {};
    let buildingsData = [];
    let userMarker = null;
    let userLocation = null;

    // USTED campus centre — Google Maps verified
    const CAMPUS_CENTER = [6.697332044485389, -1.6815135625745574];
    const DEFAULT_ZOOM = 17;

    const typeConfig = {
        faculty:        { color: '#6366f1', icon: 'fa-university',    label: 'Faculty' },
        lecture_hall:   { color: '#f59e0b', icon: 'fa-chalkboard',    label: 'Lecture Hall / Lab' },
        hostel:         { color: '#10b981', icon: 'fa-bed',           label: 'Hall of Residence' },
        administration: { color: '#ef4444', icon: 'fa-building',      label: 'Administration' },
        facility:       { color: '#8b5cf6', icon: 'fa-circle-info',   label: 'Facility' }
    };

    let tileLayer = null;

    const init = async () => {
        map = L.map('map', { zoomControl: false }).setView(CAMPUS_CENTER, DEFAULT_ZOOM);

        // Check if dark mode is active on page load
        const isDark = document.body.classList.contains('dark-theme');
        updateTileLayer(isDark);

        await loadBuildingsData();
        await loadRoadsData();
        addMarkers();
        requestUserLocation();

        // Campus boundary ring — 800m covers all campus buildings
        L.circle(CAMPUS_CENTER, {
            radius: 800,
            color: '#6366f1',
            fillColor: '#6366f1',
            fillOpacity: 0.04,
            weight: 2,
            dashArray: '6 4'
        }).addTo(map).bindTooltip('USTED Kumasi Campus', { permanent: false });
    };

    const updateTileLayer = (isDark) => {
        if (!map) return;
        if (tileLayer) {
            map.removeLayer(tileLayer);
        }

        const url = isDark
            ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
            : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

        tileLayer = L.tileLayer(url, {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            maxZoom: 22,
            maxNativeZoom: 19
        }).addTo(map);
    };

    const loadRoadsData = async () => {
        try {
            const response = await fetch('data/roads.geojson');
            const data = await response.json();
            
            // Modern "Tarred Road" Style - Thick Asphalt
            L.geoJSON(data, {
                style: (feature) => ({
                    color: '#1e293b', // Deep Charcoal
                    weight: 12,       // Thicker for visibility
                    opacity: 1,
                    lineJoin: 'round'
                })
            }).addTo(map);

            // Bright Centerline for "Highway" effect
            L.geoJSON(data, {
                style: (feature) => ({
                    color: '#cbd5e1', // Light Slate
                    weight: 2,
                    dashArray: '10, 15',
                    opacity: 0.8
                })
            }).addTo(map);

        } catch (error) {
            console.warn('Roads data not found or failed to load:', error);
        }
    };

    const loadBuildingsData = async () => {
        try {
            const loader = (typeof DataLoader !== 'undefined') ? DataLoader : null;
            if (loader && typeof loader.loadCampusData === 'function') {
                const initial = await loader.loadCampusData((updated) => {
                    buildingsData = updated.buildingsData || [];
                    if (map) {
                        Object.values(markers).forEach(m => {
                            if (map.hasLayer(m)) map.removeLayer(m);
                        });
                        markers = {};
                        addMarkers();
                    }
                });
                buildingsData = initial.buildingsData || [];
            } else {
                const response = await fetch('data/buildings.json');
                buildingsData = await response.json();
            }
        } catch (error) {
            console.error('Error loading buildings data:', error);
            showMapError('Could not load campus data. Please refresh.');
        }
    };

    const addMarkers = () => {
        buildingsData.forEach(b => addMarker(b));
    };

    const addMarker = (building) => {
        const cfg = typeConfig[building.type] || typeConfig.facility;
        const icon = L.divIcon({
            html: `
                <div class="campus-marker" style="background:${cfg.color}">
                    <i class="fas ${cfg.icon}"></i>
                </div>`,
            iconSize: [36, 36],
            iconAnchor: [18, 18],
            popupAnchor: [0, -20],
            className: ''
        });

        const marker = L.marker([building.lat, building.lng], { icon })
            .addTo(map)
            .bindPopup(`
                <div class="map-popup">
                    <strong>${building.name}</strong>
                    <span class="popup-type" style="color:${cfg.color}">${cfg.label}</span>
                </div>
            `, { maxWidth: 220 });

        marker.on('click', () => {
            BuildingModule.displayInfo(building);
            // highlight active marker
            document.querySelectorAll('.campus-marker').forEach(el => el.classList.remove('active'));
            marker.getElement()?.querySelector('.campus-marker')?.classList.add('active');
        });

        markers[building.id] = marker;
    };

    const requestUserLocation = () => {
        if (!navigator.geolocation) return;
        navigator.geolocation.watchPosition(
            (pos) => {
                const { latitude: lat, longitude: lng } = pos.coords;
                userLocation = { lat, lng };

                if (userMarker) {
                    userMarker.setLatLng([lat, lng]);
                } else {
                    userMarker = L.marker([lat, lng], {
                        icon: L.divIcon({
                            html: `<div class="user-marker"><i class="fas fa-person-walking"></i></div>`,
                            iconSize: [36, 36],
                            iconAnchor: [18, 18],
                            className: ''
                        }),
                        zIndexOffset: 1000
                    }).addTo(map).bindTooltip('You are here', { permanent: false });
                }
            },
            (err) => {
                console.warn('Geolocation unavailable:', err.message);
                // use campus center as fallback
                userLocation = { lat: CAMPUS_CENTER[0], lng: CAMPUS_CENTER[1] };
            },
            { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
        );
    };

    const filterMarkers = (filters) => {
        buildingsData.forEach(building => {
            const marker = markers[building.id];
            if (!marker) return;
            if (filters.includes(building.type)) {
                if (!map.hasLayer(marker)) marker.addTo(map);
            } else {
                if (map.hasLayer(marker)) map.removeLayer(marker);
            }
        });
    };

    const centerOnBuilding = (building) => {
        map.flyTo([building.lat, building.lng], 19, { duration: 1 });
        setTimeout(() => {
            if (markers[building.id]) markers[building.id].openPopup();
        }, 1100);
    };

    const showMapError = (msg) => {
        const el = document.getElementById('mapError');
        if (el) { el.textContent = msg; el.style.display = 'block'; }
    };

    const getMap = () => map;
    const getBuildingsData = () => buildingsData;
    const getUserLocation = () => userLocation || { lat: CAMPUS_CENTER[0], lng: CAMPUS_CENTER[1] };

    return { init, filterMarkers, centerOnBuilding, getBuildingsData, getMap, getUserLocation, updateTileLayer };
})();