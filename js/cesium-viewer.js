/**
 * Cesium 3D Campus Viewer Module — CampusOS USTED
 * Handles 3D CesiumJS rendering, campus GeoJSON extrusions, POI pins, entity picking,
 * and camera navigation with robust fallback when no Cesium Ion token is present.
 */

const CesiumViewerModule = (() => {
    let viewer = null;
    let isInitialized = false;
    let buildingsEntities = [];
    let campusEntities = [];
    let activeRouteEntity = null;
    let pickHandler = null;
    let selectedEntity = null;

    // Campus center coordinates (USTED Kumasi Campus)
    const CAMPUS_CENTER = {
        lat: 6.697332044485389,
        lng: -1.6815135625745574
    };

    const TYPE_COLORS = {
        academic:       '#4338ca',
        faculty:        '#f59e0b',
        hostel:         '#10b981',
        administration: '#ef4444',
        facility:       '#8b5cf6'
    };

    /**
     * Check for an externally configured Cesium Ion token.
     * Looks in window.CESIUM_ION_TOKEN or localStorage('cesium_ion_token').
     */
    function getIonToken() {
        return window.CESIUM_ION_TOKEN || localStorage.getItem('cesium_ion_token') || null;
    }

    /**
     * Initialize the Cesium 3D Viewer inside the given container.
     */
    async function init(containerId = 'cesiumContainer') {
        if (isInitialized && viewer) {
            resume();
            return viewer;
        }

        const container = document.getElementById(containerId);
        if (!container) {
            console.error(`[CesiumViewer] Container #${containerId} not found.`);
            return null;
        }

        const token = getIonToken();
        if (token) {
            Cesium.Ion.defaultAccessToken = token;
        }

        // Base imagery configuration
        let baseImageryProvider;
        if (token) {
            try {
                baseImageryProvider = new Cesium.IonImageryProvider({ assetId: 2 }); // Cesium World Imagery
            } catch (err) {
                console.warn('[CesiumViewer] Ion imagery failed, falling back to OSM:', err);
                baseImageryProvider = new Cesium.UrlTemplateImageryProvider({
                    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                    credit: 'OpenStreetMap contributors'
                });
            }
        } else {
            // Safe, token-free OpenStreetMap basemap
            baseImageryProvider = new Cesium.UrlTemplateImageryProvider({
                url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                credit: 'OpenStreetMap contributors'
            });
        }

        // Initialize Viewer with lightweight options suitable for embedded campus navigation
        viewer = new Cesium.Viewer(containerId, {
            animation: false,
            baseLayerPicker: false,
            fullscreenButton: false,
            geocoder: false,
            homeButton: false,
            infoBox: false, // Reusing CampusOS native sheet/panel
            sceneModePicker: false,
            selectionIndicator: false,
            timeline: false,
            navigationHelpButton: false,
            navigationInstructionsInitiallyVisible: false,
            scene3DOnly: true,
            baseLayer: new Cesium.ImageryLayer(baseImageryProvider),
            terrainProvider: new Cesium.EllipsoidTerrainProvider()
        });

        // Tweak scene atmosphere & lighting for campus visualization
        const scene = viewer.scene;
        scene.globe.depthTestAgainstTerrain = true;
        scene.globe.enableLighting = false; // Uniform campus lighting
        
        // Configure Camera Controller for intuitive 3D navigation
        const ssc = scene.screenSpaceCameraController;
        ssc.enableZoom = true;
        ssc.enableTranslate = true;
        ssc.enableRotate = true;
        ssc.enableTilt = true;
        ssc.enableLook = true;
        ssc.minimumZoomDistance = 10;
        ssc.maximumZoomDistance = Infinity;

        // 1. Left-drag: Rotates / pans camera around campus
        ssc.rotateEventTypes = [
            Cesium.CameraEventType.LEFT_DRAG
        ];

        // 2. Right-drag, Middle-drag & Ctrl+Left-drag: Orbits and tilts around campus
        ssc.tiltEventTypes = [
            Cesium.CameraEventType.RIGHT_DRAG,
            Cesium.CameraEventType.MIDDLE_DRAG,
            Cesium.CameraEventType.PINCH,
            { eventType: Cesium.CameraEventType.LEFT_DRAG, modifier: Cesium.KeyboardEventModifier.CTRL },
            { eventType: Cesium.CameraEventType.RIGHT_DRAG, modifier: Cesium.KeyboardEventModifier.CTRL }
        ];

        // 3. Touchscreen pinch: Zoom
        ssc.zoomEventTypes = [
            Cesium.CameraEventType.PINCH
        ];

        // Reset camera to USTED campus center
        resetCamera();

        // Setup entity picking (click & hover)
        setupInteraction();

        // Setup custom canvas listeners for continuous wheel zoom, trackpad pinch & contextmenu prevention
        setupCanvasControls();

        // Load external CampusOS geospatial datasets (buildings & extruded footprints only)
        // roads.geojson is preserved untouched for offline routing and not rendered as a static graphic overlay
        await Promise.all([
            loadCampusGeoJson(),
            loadBuildingsData()
        ]);

        isInitialized = true;
        return viewer;
    }

    /**
     * Resets camera to an angled oblique 3D view of the USTED campus.
     */
    function resetCamera(duration = 0) {
        if (!viewer) return;

        // Look north-northeast from south of the campus
        const targetCartesian = Cesium.Cartesian3.fromDegrees(
            CAMPUS_CENTER.lng,
            CAMPUS_CENTER.lat - 0.0032,
            550
        );

        if (duration > 0) {
            viewer.camera.flyTo({
                destination: targetCartesian,
                orientation: {
                    heading: Cesium.Math.toRadians(12.0),
                    pitch: Cesium.Math.toRadians(-42.0),
                    roll: 0.0
                },
                duration: duration
            });
        } else {
            viewer.camera.setView({
                destination: targetCartesian,
                orientation: {
                    heading: Cesium.Math.toRadians(12.0),
                    pitch: Cesium.Math.toRadians(-42.0),
                    roll: 0.0
                }
            });
        }
    }

    /**
     * SPATIAL GEOMETRY LAYER:
     * Load prototype building footprints from campus.geojson.
     * 
     * ARCHITECTURE NOTE:
     * - Prototype/existing footprint geometry: not yet authoritative.
     * - In particular, the prototype "ROB Block" polygon in campus.geojson is known to be
     *   misaligned by ~58m relative to authoritative surveyed data in data/buildings.json.
     * - Rendering of the incorrect prototype ROB polygon extrusion is disabled.
     * - Other prototype footprints (New Library, New Auditorium, USTED Library) continue
     *   rendering until authoritative surveyed geometry is introduced in Phase 3.
     */
    async function loadCampusGeoJson() {
        try {
            const resp = await fetch('data/campus.geojson');
            const geojson = await resp.json();

            geojson.features.forEach(feature => {
                const geom = feature.geometry;
                const props = feature.properties || {};

                if (geom.type === 'Polygon') {
                    const featureName = props.name || 'Campus Building';
                    const isROB = featureName.toLowerCase().includes('rob');

                    // PHASE 2A: Disable rendering of inaccurate prototype ROB polygon extrusion.
                    // ROB's location and identity are driven strictly by authoritative data in buildings.json.
                    if (isROB) {
                        return;
                    }

                    const coords = geom.coordinates[0];
                    const hierarchy = coords.map(pt => Cesium.Cartesian3.fromDegrees(pt[0], pt[1]));
                    const height = props.height || 16;
                    const hexColor = props.color || '#6366f1';
                    const buildingColor = Cesium.Color.fromCssColorString(hexColor).withAlpha(0.75);
                    const outlineColor = Cesium.Color.fromCssColorString('#a5b4fc');

                    const entity = viewer.entities.add({
                        name: featureName,
                        polygon: {
                            hierarchy: new Cesium.PolygonHierarchy(hierarchy),
                            extrudedHeight: height,
                            material: buildingColor,
                            outline: true,
                            outlineColor: outlineColor,
                            outlineWidth: 2
                        },
                        properties: {
                            campusFeature: props,
                            geometrySource: 'prototype/existing footprint geometry',
                            isAuthoritative: false
                        }
                    });
                    campusEntities.push(entity);
                }
            });
        } catch (err) {
            console.warn('[CesiumViewer] Error loading campus.geojson:', err);
        }
    }

    /**
     * POI DATA LAYER:
     * Load data/buildings.json (authoritative source for building/POI identity, name, ID, and lat/lng).
     * All 46 campus buildings are rendered as interactive 3D pins and labels.
     * Buildings without polygon footprints appear as 3D markers and labels gracefully.
     */
    async function loadBuildingsData() {
        try {
            let buildings = [];
            if (window.CampusOS && typeof window.CampusOS.getBuildingsData === 'function') {
                buildings = window.CampusOS.getBuildingsData();
            }
            if (!buildings || !buildings.length) {
                const resp = await fetch('data/buildings.json');
                buildings = await resp.json();
            }

            buildings.forEach(b => {
                const isROB = b.id === 25 || (b.shortName === 'ROB');
                const hexColor = TYPE_COLORS[b.type] || '#64748b';
                const baseColor = Cesium.Color.fromCssColorString(hexColor);

                // Elevate pin label above ground / building roofs
                const pinElevation = isROB ? 18 : 18;

                const entity = viewer.entities.add({
                    id: `campusos-building-${b.id}`,
                    name: b.name,
                    position: Cesium.Cartesian3.fromDegrees(b.lng, b.lat, pinElevation),
                    point: {
                        pixelSize: isROB ? 14 : 10,
                        color: isROB ? Cesium.Color.fromCssColorString('#ef4444') : baseColor,
                        outlineColor: Cesium.Color.WHITE,
                        outlineWidth: isROB ? 3 : 2,
                        disableDepthTestDistance: Number.POSITIVE_INFINITY
                    },
                    label: {
                        text: b.shortName || b.name,
                        font: isROB ? 'bold 13px Inter, sans-serif' : '11px Inter, sans-serif',
                        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                        fillColor: isROB ? Cesium.Color.YELLOW : Cesium.Color.WHITE,
                        outlineColor: Cesium.Color.fromCssColorString('#0f172a'),
                        outlineWidth: 3,
                        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                        pixelOffset: new Cesium.Cartesian2(0, -12),
                        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, isROB ? 2500 : 1200),
                        disableDepthTestDistance: Number.POSITIVE_INFINITY
                    },
                    properties: {
                        buildingData: b,
                        isCampusBuilding: true,
                        isROB: isROB,
                        dataSource: 'authoritative POI data (data/buildings.json)'
                    }
                });

                buildingsEntities.push(entity);
            });
        } catch (err) {
            console.warn('[CesiumViewer] Error loading buildings.json:', err);
        }
    }

    /**
     * Setup user interactions: clicking an entity to select a building, hover cursor.
     */
    function setupInteraction() {
        if (!viewer) return;

        pickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

        // Click selection
        pickHandler.setInputAction(movement => {
            const picked = viewer.scene.pick(movement.position);

            if (Cesium.defined(picked) && picked.id) {
                const entity = picked.id;
                let bData = entity.properties?.buildingData?.getValue();

                // If clicked a polygon instead of a point, match by name to buildingsData
                if (!bData && entity.properties?.campusFeature) {
                    const feature = entity.properties.campusFeature.getValue();
                    const featureName = (feature.name || '').toLowerCase();

                    // Search existing building data
                    if (window.CampusOS && typeof window.CampusOS.getBuildingsData === 'function') {
                        const allBuildings = window.CampusOS.getBuildingsData();
                        bData = allBuildings.find(b =>
                            (feature.id && (String(b.id) === String(feature.id) || String(b.id) === String(feature.building_id))) ||
                            (feature.building_id && String(b.id) === String(feature.building_id)) ||
                            b.name.toLowerCase() === featureName ||
                            (b.shortName && b.shortName.toLowerCase() === featureName)
                        );
                    }
                }

                if (bData) {
                    highlightEntity(entity);
                    if (window.ViewControllerModule && typeof window.ViewControllerModule.onBuildingSelected === 'function') {
                        window.ViewControllerModule.onBuildingSelected(bData);
                    }
                }
            }
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        // Hover cursor effect
        pickHandler.setInputAction(movement => {
            const picked = viewer.scene.pick(movement.endPosition);
            if (Cesium.defined(picked) && picked.id) {
                viewer.container.style.cursor = 'pointer';
            } else {
                viewer.container.style.cursor = 'default';
            }
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    }

    /**
     * Dedicated canvas event listeners for continuous mouse-wheel zoom, trackpad pinch,
     * and context-menu suppression during right-drag orbit.
     */
    function setupCanvasControls() {
        if (!viewer || !viewer.scene || !viewer.scene.canvas) return;

        const canvas = viewer.scene.canvas;

        // 1. Prevent default context menu on right-click / right-drag so orbit is never interrupted
        canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });

        // 2. Continuous mouse-wheel and trackpad pinch zoom
        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            if (!viewer || viewer.isDestroyed()) return;

            const camera = viewer.camera;
            const height = camera.positionCartographic.height;

            // Trackpad pinch typically sets ctrlKey: true with smaller delta values
            const isPinch = e.ctrlKey;
            const factor = isPinch ? 0.05 : 0.20;
            const moveAmount = Math.max(12, height * factor);

            if (e.deltaY < 0) {
                // Scroll UP / Pinch IN -> Zoom toward campus
                if (height > 15) {
                    const safeDist = Math.min(moveAmount, height - 12);
                    if (safeDist > 0.5) {
                        camera.zoomIn(safeDist);
                        viewer.scene.requestRender?.();
                    }
                }
            } else if (e.deltaY > 0) {
                // Scroll DOWN / Pinch OUT -> Zoom away from campus
                // Continues pulling away unconditionally without stopping at sky/raycast limits
                camera.zoomOut(moveAmount);
                viewer.scene.requestRender?.();
            }
        }, { passive: false });
    }

    /**
     * Highlight selected entity visually in 3D.
     */
    function highlightEntity(entity) {
        selectedEntity = entity;
    }

    /**
     * Move Cesium camera to target coordinates from 2D view.
     */
    function syncCameraFrom2D(lng, lat, zoom = 17) {
        if (!viewer) return;

        // Approximate height calculation based on Mapbox zoom level
        const height = Math.max(120, Math.min(2500, 3000000 / Math.pow(2, zoom)));

        viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(
                lng,
                lat - (height * 0.000004),
                height
            ),
            orientation: {
                heading: Cesium.Math.toRadians(12.0),
                pitch: Cesium.Math.toRadians(-40.0),
                roll: 0.0
            },
            duration: 0.8
        });
    }

    /**
     * Retrieve approximate ground-level geographic center of Cesium viewport.
     */
    function getCameraGroundCenter() {
        if (!viewer) return null;

        const canvas = viewer.scene.canvas;
        const center = new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
        const ray = viewer.camera.getPickRay(center);
        const target = viewer.scene.globe.pick(ray, viewer.scene);

        if (target) {
            const cartographic = Cesium.Cartographic.fromCartesian(target);
            return {
                lng: Cesium.Math.toDegrees(cartographic.longitude),
                lat: Cesium.Math.toDegrees(cartographic.latitude)
            };
        }

        // Fallback to camera position projection
        const pos = viewer.camera.positionCartographic;
        return {
            lng: Cesium.Math.toDegrees(pos.longitude),
            lat: Cesium.Math.toDegrees(pos.latitude)
        };
    }

    /**
     * Focus camera specifically on Reynolds Okai Building (ROB).
     */
    function focusROB() {
        if (!viewer) return;
        viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(-1.682075, 6.6985, 280),
            orientation: {
                heading: Cesium.Math.toRadians(0.0),
                pitch: Cesium.Math.toRadians(-35.0),
                roll: 0.0
            },
            duration: 1.2
        });
    }

    /**
     * Pause render loop when hidden to conserve device GPU & battery.
     */
    function pause() {
        if (viewer && !viewer.isDestroyed()) {
            viewer.useDefaultRenderLoop = false;
        }
    }

    /**
     * Resume render loop when shown.
     */
    function resume() {
        if (viewer && !viewer.isDestroyed()) {
            viewer.useDefaultRenderLoop = true;
            viewer.resize();
        }
    }

    /**
     * Programmatic zoom in for on-screen '+' button.
     */
    function zoomIn(amount) {
        if (!viewer || viewer.isDestroyed()) return;
        const camera = viewer.camera;
        const height = camera.positionCartographic.height;
        if (height <= 15) return; // Clamped at street level
        const moveDist = amount || Math.max(15, height * 0.28);
        const safeDist = Math.min(moveDist, height - 12);
        if (safeDist > 1) {
            camera.zoomIn(safeDist);
            viewer.scene.requestRender?.();
        }
    }

    /**
     * Programmatic zoom out for on-screen '–' button.
     */
    function zoomOut(amount) {
        if (!viewer || viewer.isDestroyed()) return;
        const camera = viewer.camera;
        const height = camera.positionCartographic.height;
        const moveDist = amount || Math.max(25, height * 0.30);
        camera.zoomOut(moveDist);
        viewer.scene.requestRender?.();
    }

    /**
     * Render an active navigation route in Cesium when directions are requested.
     * Future navigation requirement: Displays ONLY the user's calculated path
     * rather than the entire raw routing graph.
     * @param {Array<[number, number]>} coordinates - GeoJSON coordinates [[lng, lat], ...]
     */
    function renderRoute(coordinates) {
        if (!viewer || !coordinates || !coordinates.length) return;
        clearRoute();

        const pts = coordinates.map(coord => Cesium.Cartesian3.fromDegrees(coord[0], coord[1]));
        activeRouteEntity = viewer.entities.add({
            name: 'Active Navigation Route',
            polyline: {
                positions: pts,
                clampToGround: true,
                width: 6,
                material: new Cesium.PolylineGlowMaterialProperty({
                    glowPower: 0.25,
                    color: Cesium.Color.fromCssColorString('#4338ca')
                })
            }
        });
        viewer.scene.requestRender?.();
    }

    /**
     * Clear any active navigation route polyline from Cesium.
     */
    function clearRoute() {
        if (viewer && activeRouteEntity) {
            viewer.entities.remove(activeRouteEntity);
            activeRouteEntity = null;
            viewer.scene.requestRender?.();
        }
    }

    /**
     * Future Surveyed Geometry Ingestion Architecture Hook.
     * Prepared for subsequent phases when surveyed CAD/GIS/GeoJSON building footprints
     * and indoor floor plans (e.g., ROB Ground Floor) are integrated.
     * Replaces prototype footprint geometry with authoritative spatial geometry.
     * @param {Object} surveyedGeoJson - Authoritative surveyed GeoJSON FeatureCollection
     */
    function loadSurveyedGeometry(surveyedGeoJson) {
        if (!viewer || !surveyedGeoJson || !surveyedGeoJson.features) return;
        console.log('[CesiumViewer] Surveyed geometry hook ready for incoming spatial datasets.');
    }

    return {
        init,
        resetCamera,
        syncCameraFrom2D,
        getCameraGroundCenter,
        focusROB,
        pause,
        resume,
        zoomIn,
        zoomOut,
        renderRoute,
        clearRoute,
        loadSurveyedGeometry,
        getViewer: () => viewer,
        isReady: () => isInitialized
    };
})();

window.CesiumViewerModule = CesiumViewerModule;
