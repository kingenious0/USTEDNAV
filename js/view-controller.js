/**
 * View Controller Module — CampusOS USTED
 * Copyright (c) 2026 KINGENIOUS. All Rights Reserved.
 * Proprietary software of KINGENIOUS (Ghana).
 * Manages 2D Mapbox vs 3D Cesium mode transitions, camera synchronization,
 * visibility state, and building selection bridging.
 */

const ViewControllerModule = (() => {
    let currentMode = '2D';
    let isTransitioning = false;
    let toggleBtn = null;
    let toggleLabel = null;

    /**
     * Initialize the View Controller and bind UI triggers.
     */
    function init() {
        toggleBtn = document.getElementById('btnDimToggle');
        toggleLabel = document.getElementById('dimToggleLabel');

        if (toggleBtn) {
            toggleBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                toggleMode();
            });
        }
    }

    /**
     * Toggles between 2D (Mapbox) and 3D (Cesium).
     */
    async function toggleMode() {
        if (isTransitioning) return;
        const targetMode = currentMode === '2D' ? '3D' : '2D';
        await setMode(targetMode);
    }

    /**
     * Sets the active viewing mode ('2D' or '3D').
     */
    async function setMode(mode) {
        if (mode === currentMode && mode !== '2D') return;
        isTransitioning = true;

        const mapEl = document.getElementById('map');
        const cesiumEl = document.getElementById('cesiumContainer');

        if (mode === '3D') {
            await enter3D(mapEl, cesiumEl);
        } else {
            await enter2D(mapEl, cesiumEl);
        }

        currentMode = mode;
        updateUI();
        isTransitioning = false;
    }

    /**
     * Transition from 2D Mapbox into 3D Cesium.
     */
    async function enter3D(mapEl, cesiumEl) {
        const mapboxMap = window.CampusOS?.getMap();
        let center = null;
        let zoom = 17;

        if (mapboxMap) {
            try {
                center = mapboxMap.getCenter();
                zoom = mapboxMap.getZoom();
            } catch (err) {
                console.warn('[ViewController] Could not get Mapbox center:', err);
            }
        }

        // Hide Mapbox canvas, display Cesium container
        if (mapEl) mapEl.style.display = 'none';
        if (cesiumEl) cesiumEl.style.display = 'block';

        // Lazy-initialize Cesium viewer on first 3D activation
        if (!window.CesiumViewerModule.isReady()) {
            if (window.CampusOS?.showToast) {
                window.CampusOS.showToast('🚀 Loading 3D Campus View…');
            }
            await window.CesiumViewerModule.init('cesiumContainer');
        } else {
            window.CesiumViewerModule.resume();
        }

        // Sync camera position if Mapbox center was recorded
        if (center && typeof center.lng === 'number') {
            window.CesiumViewerModule.syncCameraFrom2D(center.lng, center.lat, zoom);
        } else {
            window.CesiumViewerModule.resetCamera(0.8);
        }

        // Bridge active navigation route to 3D Cesium terrain if active
        const activeRoute = window.CampusOS?.getActiveRoute ? window.CampusOS.getActiveRoute() : window._route;
        if (activeRoute && activeRoute.geometry && Array.isArray(activeRoute.geometry.coordinates) && activeRoute.geometry.coordinates.length > 0) {
            window.CesiumViewerModule?.renderRoute(activeRoute.geometry.coordinates);
        }

        if (window.CampusOS?.showToast) {
            window.CampusOS.showToast('🌐 3D Campus Mode');
        }
    }

    /**
     * Transition from 3D Cesium back into 2D Mapbox.
     */
    async function enter2D(mapEl, cesiumEl) {
        // Retrieve ground center coordinate from Cesium camera before pausing
        let groundCenter = null;
        if (window.CesiumViewerModule?.isReady()) {
            groundCenter = window.CesiumViewerModule.getCameraGroundCenter();
            window.CesiumViewerModule.pause();
        }

        // Hide Cesium container, restore Mapbox canvas
        if (cesiumEl) cesiumEl.style.display = 'none';
        if (mapEl) mapEl.style.display = 'block';

        // CRITICAL: Force Mapbox GL JS to recalculate canvas dimensions
        const mapboxMap = window.CampusOS?.getMap();
        if (mapboxMap) {
            mapboxMap.resize();

            if (groundCenter && typeof groundCenter.lng === 'number') {
                mapboxMap.flyTo({
                    center: [groundCenter.lng, groundCenter.lat],
                    duration: 600,
                    essential: true
                });
            }
        }

        if (window.CampusOS?.showToast) {
            window.CampusOS.showToast('🗺️ 2D Street Map');
        }
    }

    /**
     * Update 2D/3D toggle button styling and aria attributes.
     */
    function updateUI() {
        if (!toggleBtn) return;

        if (currentMode === '3D') {
            toggleBtn.classList.add('active-3d');
            toggleBtn.title = 'Switch to 2D Street Map';
            if (toggleLabel) {
                toggleLabel.textContent = '2D';
            }
        } else {
            toggleBtn.classList.remove('active-3d');
            toggleBtn.title = 'Switch to 3D Campus View';
            if (toggleLabel) {
                toggleLabel.textContent = '3D';
            }
        }
    }

    /**
     * Bridge method invoked when a building is picked in Cesium 3D mode.
     * Reuses the existing CampusOS building sheet/panel without any duplicate UI.
     */
    function onBuildingSelected(buildingData) {
        if (!buildingData) return;

        // Trigger existing CampusOS native display logic
        if (window.CampusOS && typeof window.CampusOS.showBuilding === 'function') {
            window.CampusOS.showBuilding(buildingData);
        }
    }

    return {
        init,
        toggleMode,
        setMode,
        getMode: () => currentMode,
        onBuildingSelected
    };
})();

window.ViewControllerModule = ViewControllerModule;
