/**
 * ==============================================================================
 * CampusOS™ Indoor Navigator Engine — V2.0 (Walk-With-Me Live Nav)
 * Features: Room-as-Origin • Device Orientation Heading Cone •
 * Pedestrian Dead Reckoning (PDR) • Dynamic Turn Angles • Active Maneuver Card
 * Pure JavaScript • Zero Dependencies • Clean & Responsive
 * Copyright (c) 2026 KINGENIOUS. All Rights Reserved.
 * ==============================================================================
 */

class IndoorNavigator {
  constructor() {
    this.floorData = null;
    this.graph = {};
    this.nodeMap = {};
    this.roomMap = {};
    this.entranceMap = {};

    // Navigation Origin & Destination State
    this.originNodeId = 'entrance_main';
    this.destinationId = null;
    this.activeRoute = null; // { path, totalMeters }
    this.activeManeuvers = [];
    this.currentManeuverIndex = 0;
    this.distAlongCurrentManeuver = 0;
    this.isNavigating = false;

    // Pedestrian Dead Reckoning & Orientation State
    this.userPosition = { x: 510, y: 810 };
    this.userHeading = 0; // degrees
    this.deviceOrientationActive = false;
    this.lastStepTime = 0;
    this.isAutoWalking = false;
    this.autoWalkTimer = null;

    // Viewport Transform State (Pan & Zoom)
    this.scale = 1;
    this.minScale = 0.4;
    this.maxScale = 3.5;
    this.translateX = 0;
    this.translateY = 0;
    this.isDragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.initialPinchDistance = null;
    this.initialPinchScale = 1;

    // DOM Elements
    this.viewportEl = document.getElementById('mapViewport');
    this.svgContainer = document.getElementById('mapSvgContainer');
    this.svgEl = document.getElementById('indoorSvg');
    this.searchInput = document.getElementById('indoorSearchInput');
    this.autocompleteList = document.getElementById('autocompleteDropdown');
    this.searchClearBtn = document.getElementById('searchClearBtn');
    this.detailSheet = document.getElementById('detailSheet');
    this.entranceTabsContainer = document.getElementById('entranceBar');

    // Live Maneuver Card Elements
    this.maneuverCard = document.getElementById('activeManeuverCard');
    this.maneuverIcon = document.getElementById('maneuverIcon');
    this.maneuverIconWrap = document.getElementById('maneuverIconWrap');
    this.maneuverPrimary = document.getElementById('maneuverPrimary');
    this.maneuverSecondary = document.getElementById('maneuverSecondary');
    this.maneuverProgressFill = document.getElementById('maneuverProgressFill');
    this.btnStepSimulate = document.getElementById('btnStepSimulate');
    this.btnWalkToggle = document.getElementById('btnWalkToggle');
    this.walkToggleIcon = document.getElementById('walkToggleIcon');

    // Origin Selector Chip & Bottom Sheet Action Buttons
    this.originChip = document.getElementById('originChip');
    this.originChipLabel = document.getElementById('originChipLabel');
    this.btnSetAsOrigin = document.getElementById('btnSetAsOrigin');
    this.btnSetAsDest = document.getElementById('btnSetAsDest');

    // Currently viewed room in detail sheet (can be different from destination)
    this.inspectedRoomId = null;

    // SVG Layer Groups
    this.layers = {
      base: null,
      corridors: null,
      route: null,
      rooms: null,
      entrances: null,
      user: null,
      overlay: null
    };

    // User pin elements
    this.userMarkerEl = null;
    this.headingConeRotator = null;

    this.init();
  }

  async init() {
    this.syncTheme();
    this.setupSvgLayers();
    this.setupEventListeners();
    this.setupMotionAndOrientation();
    await this.loadFloorData();
    this.buildGraph();
    this.renderFloor();
    this.renderEntranceTabs();
    this.initUserMarker();
    this.fitToScreen();
    this.handleUrlParams();
  }

  syncTheme() {
    try {
      const savedTheme = localStorage.getItem('theme');
      if (savedTheme === 'dark') {
        document.body.classList.add('dark-theme');
      } else {
        document.body.classList.remove('dark-theme');
      }
    } catch (e) {}
  }

  setupSvgLayers() {
    this.svgEl.innerHTML = '';

    // Create SVG Defs for Heading Cone Gradient
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.innerHTML = `
      <linearGradient id="headingConeGrad" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0%" stop-color="#33449b" stop-opacity="0" />
        <stop offset="45%" stop-color="#f8b511" stop-opacity="0.32" />
        <stop offset="100%" stop-color="#f8b511" stop-opacity="0.75" />
      </linearGradient>
    `;
    this.svgEl.appendChild(defs);

    const layerNames = ['base', 'corridors', 'route', 'rooms', 'entrances', 'user', 'overlay'];
    layerNames.forEach(name => {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('id', `layer-${name}`);
      this.svgEl.appendChild(g);
      this.layers[name] = g;
    });
  }

  async loadFloorData() {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const floorFile = urlParams.get('floor') || 'rob_ground';
      const response = await fetch(`indoor/floors/${floorFile}.json?v=1.2.1`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      this.floorData = await response.json();
    } catch (err) {
      console.warn('Fallback loading rob_ground.json...', err);
      const response = await fetch(`floors/rob_ground.json?v=1.2.1`);
      this.floorData = await response.json();
    }

    const w = this.floorData._meta.imageWidth || 1040;
    const h = this.floorData._meta.imageHeight || 870;
    this.svgContainer.style.width = `${w}px`;
    this.svgContainer.style.height = `${h}px`;
    this.svgEl.setAttribute('width', `${w}`);
    this.svgEl.setAttribute('height', `${h}`);
    this.svgEl.setAttribute('viewBox', `0 0 ${w} ${h}`);

    this.floorData.nodes.forEach(n => this.nodeMap[n.id] = n);
    this.floorData.rooms.forEach(r => this.roomMap[r.id] = r);
    this.floorData.entrances.forEach(e => {
      this.entranceMap[e.id] = e;
      if (e.isDefault) this.originNodeId = e.id;
    });
  }

  buildGraph() {
    this.graph = {};
    const scale = this.floorData._meta.scaleMetersPerPixel || 0.05;

    // 1. Initialize node graph
    this.floorData.nodes.forEach(n => this.graph[n.id] = []);

    // 2. Add corridor edges
    this.floorData.edges.forEach(e => {
      this.graph[e.from] = this.graph[e.from] || [];
      this.graph[e.to] = this.graph[e.to] || [];
      this.graph[e.from].push({ node: e.to, meters: e.meters });
      this.graph[e.to].push({ node: e.from, meters: e.meters });
    });

    // 3. Connect rooms to their designated entrance junction
    this.floorData.rooms.forEach(r => {
      this.graph[r.id] = [];
      const parentNode = this.nodeMap[r.entranceNodeId];
      if (parentNode) {
        const pixelDist = Math.hypot(r.x - parentNode.x, r.y - parentNode.y);
        const meters = Math.max(Math.round(pixelDist * scale * 10) / 10, 1.2);
        this.graph[r.id].push({ node: r.entranceNodeId, meters });
        this.graph[r.entranceNodeId].push({ node: r.id, meters });
      }
    });
  }

  renderFloor() {
    const meta = this.floorData._meta;

    // 1. Clean Floor Blueprint Image
    let imgHref = meta.imageRef || 'indoor/assets/rob_ground_plan.png';
    if (imgHref.startsWith('../')) {
      imgHref = imgHref.replace('../', 'indoor/');
    }

    const bgImage = document.createElementNS('http://www.w3.org/2000/svg', 'image');
    bgImage.setAttribute('href', imgHref);
    bgImage.setAttribute('x', '0');
    bgImage.setAttribute('y', '0');
    bgImage.setAttribute('width', meta.imageWidth || 1040);
    bgImage.setAttribute('height', meta.imageHeight || 870);
    bgImage.setAttribute('class', 'floor-blueprint');
    this.layers.base.appendChild(bgImage);

    // 2. Subtle Corridor Network Guidelines
    this.floorData.edges.forEach(edge => {
      const fromNode = this.nodeMap[edge.from];
      const toNode = this.nodeMap[edge.to];
      if (!fromNode || !toNode) return;

      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', fromNode.x);
      line.setAttribute('y1', fromNode.y);
      line.setAttribute('x2', toNode.x);
      line.setAttribute('y2', toNode.y);
      line.setAttribute('class', 'corridor-edge');
      this.layers.corridors.appendChild(line);
    });

    // 3. Interactive Room Touch Targets (No permanent clutter dots)
    this.renderRoomPins();

    // 4. Render Entrance Pins
    this.renderEntrancePins();
  }

  renderRoomPins() {
    this.layers.rooms.innerHTML = '';

    this.floorData.rooms.forEach(room => {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'room-node');
      g.setAttribute('data-id', room.id);
      g.setAttribute('transform', `translate(${room.x}, ${room.y})`);

      // Generous invisible hit-box for easy mobile touch and desktop click
      const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      hitArea.setAttribute('r', '24');
      hitArea.setAttribute('fill', 'transparent');
      hitArea.setAttribute('pointer-events', 'all');
      hitArea.setAttribute('cursor', 'pointer');
      
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = room.label;
      hitArea.appendChild(title);
      g.appendChild(hitArea);

      g.addEventListener('click', (e) => {
        e.stopPropagation();
        this.inspectRoom(room.id);
      });

      this.layers.rooms.appendChild(g);
    });
  }

  renderEntrancePins() {
    this.layers.entrances.innerHTML = '';

    this.floorData.entrances.forEach(ent => {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'entrance-node');
      g.setAttribute('transform', `translate(${ent.x}, ${ent.y})`);

      const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      hitArea.setAttribute('r', '26');
      hitArea.setAttribute('fill', 'transparent');
      hitArea.setAttribute('pointer-events', 'all');
      hitArea.setAttribute('cursor', 'pointer');
      g.appendChild(hitArea);

      const isOrigin = (ent.id === this.originNodeId);

      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('r', isOrigin ? '11' : '8');
      circle.setAttribute('fill', isOrigin ? '#10b981' : '#64748b');
      circle.setAttribute('stroke', '#ffffff');
      circle.setAttribute('stroke-width', '2');
      circle.setAttribute('filter', 'drop-shadow(0px 2px 4px rgba(0,0,0,0.4))');
      g.appendChild(circle);

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('y', '3');
      text.setAttribute('font-family', 'Inter, sans-serif');
      text.setAttribute('font-size', '7.5');
      text.setAttribute('font-weight', '700');
      text.setAttribute('fill', '#ffffff');
      text.setAttribute('text-anchor', 'middle');
      text.textContent = 'IN';
      g.appendChild(text);

      g.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setOrigin(ent.id);
      });

      this.layers.entrances.appendChild(g);
    });
  }

  renderEntranceTabs() {
    if (!this.entranceTabsContainer) return;
    this.entranceTabsContainer.innerHTML = '';

    this.floorData.entrances.forEach(ent => {
      const btn = document.createElement('button');
      btn.className = `chip entrance-tab ${ent.id === this.originNodeId ? 'active' : ''}`;
      btn.innerHTML = `<i class="fas fa-door-open"></i> <span>${ent.label}</span>`;
      btn.addEventListener('click', () => {
        this.setOrigin(ent.id);
      });
      this.entranceTabsContainer.appendChild(btn);
    });

    this.updateOriginChip();
  }

  updateOriginChip() {
    if (!this.originChipLabel) return;
    const originLabel = this.getNodeLabel(this.originNodeId);
    this.originChipLabel.textContent = `From: ${originLabel}`;
  }

  getNodeLabel(nodeId) {
    if (this.entranceMap[nodeId]) return this.entranceMap[nodeId].label;
    if (this.roomMap[nodeId]) return this.roomMap[nodeId].label;
    if (this.nodeMap[nodeId]) return this.nodeMap[nodeId].label;
    return nodeId;
  }

  getNodeCoords(nodeId) {
    if (this.entranceMap[nodeId]) return { x: this.entranceMap[nodeId].x, y: this.entranceMap[nodeId].y };
    if (this.roomMap[nodeId]) return { x: this.roomMap[nodeId].x, y: this.roomMap[nodeId].y };
    if (this.nodeMap[nodeId]) return { x: this.nodeMap[nodeId].x, y: this.nodeMap[nodeId].y };
    return { x: 510, y: 810 };
  }

  // ─── USER LOCATION PIN & HEADING CONE ─────────────────────────

  initUserMarker() {
    this.layers.user.innerHTML = '';

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('id', 'userLocationGroup');
    g.setAttribute('class', 'user-location-marker');

    // Directional Cone Rotator (Rotates with Compass / Corridor Bearing)
    const coneRotator = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    coneRotator.setAttribute('id', 'userHeadingRotator');

    // SVG Heading Cone Arc
    const conePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    conePath.setAttribute('d', 'M 0 0 L -22 -52 A 58 58 0 0 1 22 -52 Z');
    conePath.setAttribute('fill', 'url(#headingConeGrad)');
    conePath.setAttribute('class', 'user-heading-cone');
    coneRotator.appendChild(conePath);
    g.appendChild(coneRotator);

    // Subtle Pulsing Halo
    const pulseRing = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    pulseRing.setAttribute('class', 'user-pulse-ring');
    pulseRing.setAttribute('fill', 'none');
    pulseRing.setAttribute('stroke', '#33449b');
    pulseRing.setAttribute('stroke-width', '2');
    g.appendChild(pulseRing);

    // Outer Circle (USTED Royal Navy)
    const pin = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    pin.setAttribute('r', '8.5');
    pin.setAttribute('fill', '#10b981');
    pin.setAttribute('stroke', '#ffffff');
    pin.setAttribute('stroke-width', '2.5');
    pin.setAttribute('filter', 'drop-shadow(0 2px 6px rgba(0,0,0,0.35))');
    g.appendChild(pin);

    // Inner White Dot
    const innerDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    innerDot.setAttribute('r', '3');
    innerDot.setAttribute('fill', '#ffffff');
    g.appendChild(innerDot);

    this.layers.user.appendChild(g);
    this.userMarkerEl = g;
    this.headingConeRotator = coneRotator;

    const coords = this.getNodeCoords(this.originNodeId);
    this.setUserPosition(coords.x, coords.y, 0);
  }

  setUserPosition(x, y, heading = null) {
    this.userPosition = { x, y };
    if (this.userMarkerEl) {
      this.userMarkerEl.setAttribute('transform', `translate(${x}, ${y})`);
    }
    if (heading !== null && !this.deviceOrientationActive) {
      this.updateHeadingCone(heading);
    }
  }

  updateHeadingCone(angle) {
    this.userHeading = angle;
    if (this.headingConeRotator) {
      this.headingConeRotator.setAttribute('transform', `rotate(${angle})`);
    }
  }

  // ─── SENSORS: DEVICE ORIENTATION & PEDOMETER ──────────────────

  setupMotionAndOrientation() {
    // iOS 13+ requires explicit user gesture to allow accelerometer/compass
    const requestSensorPermissions = async () => {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        try {
          await DeviceOrientationEvent.requestPermission();
        } catch (e) {}
      }
      if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        try {
          await DeviceMotionEvent.requestPermission();
        } catch (e) {}
      }
    };
    window.addEventListener('click', requestSensorPermissions, { once: true });
    window.addEventListener('touchend', requestSensorPermissions, { once: true });

    // 1. Device Orientation (Compass)
    if (typeof window !== 'undefined' && window.DeviceOrientationEvent) {
      window.addEventListener('deviceorientation', (e) => {
        let heading = null;
        if (typeof e.webkitCompassHeading === 'number') {
          // iOS Safari native compass heading
          heading = e.webkitCompassHeading;
        } else if (typeof e.alpha === 'number') {
          // Android counter-clockwise alpha
          heading = (360 - e.alpha) % 360;
        }

        if (heading !== null && !isNaN(heading)) {
          this.deviceOrientationActive = true;
          this.updateHeadingCone(heading);
        }
      }, { passive: true });
    }

    // 2. Pedestrian Dead Reckoning (Step Counter via DeviceMotion)
    if (typeof window !== 'undefined' && window.DeviceMotionEvent) {
      let lastMag = 9.8;
      let peakDetected = false;

      window.addEventListener('devicemotion', (e) => {
        if (!this.destinationId || !this.activeRoute) return;
        const acc = e.accelerationIncludingGravity || e.acceleration;
        if (!acc) return;

        const mag = Math.hypot(acc.x || 0, acc.y || 0, acc.z || 0);
        const now = performance.now();

        // Human walking step peak threshold
        if (mag > 12.8 && lastMag <= 12.8) {
          peakDetected = true;
        } else if (peakDetected && mag < 10.8 && (now - this.lastStepTime > 340)) {
          peakDetected = false;
          this.lastStepTime = now;
          this.advanceStep(0.7);
        }
        lastMag = mag;
      }, { passive: true });
    }
  }

  // ─── STEP 1: ROOM-AS-ORIGIN & DESTINATION SELECTION ───────────

  inspectRoom(roomId) {
    const room = this.roomMap[roomId];
    if (!room) return;

    this.inspectedRoomId = roomId;

    // If no route exists yet, default destination to this room
    if (!this.destinationId && roomId !== this.originNodeId) {
      this.setDestination(roomId, false);
      return;
    }

    // Otherwise show details and let user choose [Start From Here] or [Directions Here]
    this.showDetailSheet(room);
  }

  setOrigin(nodeId, recalculate = true) {
    this.originNodeId = nodeId;
    this.renderEntrancePins();
    this.renderEntranceTabs();

    const coords = this.getNodeCoords(nodeId);
    this.setUserPosition(coords.x, coords.y, 0);

    // Update bottom sheet button state if open
    if (this.inspectedRoomId) {
      this.updateSheetActionButtons(this.inspectedRoomId);
    }

    if (recalculate && this.destinationId && this.destinationId !== this.originNodeId) {
      this.calculateAndDrawRoute(this.destinationId);
    }
  }

  setDestination(roomId, flyTo = true) {
    const room = this.roomMap[roomId];
    if (!room) return;

    this.destinationId = roomId;
    this.inspectedRoomId = roomId;

    if (this.searchInput) {
      this.searchInput.value = room.label;
      this.searchClearBtn?.classList.add('visible');
    }

    // Place user at origin if not currently placed
    const startCoords = this.getNodeCoords(this.originNodeId);
    this.setUserPosition(startCoords.x, startCoords.y, 0);

    // Calculate Route and Maneuvers
    this.calculateAndDrawRoute(roomId);

    // Update Bottom Sheet & Maneuver Card
    this.showDetailSheet(room);

    if (flyTo) {
      this.flyToPoint(room.x, room.y, 1.25);
    }
  }

  // ─── STEP 4: ROUTING & RELATIVE BEARING CALCULATION (Δθ) ───────

  calculateAndDrawRoute(destRoomId) {
    const startNodeId = this.originNodeId;
    const destRoom = this.roomMap[destRoomId];
    if (!destRoom) return;

    const routeResult = this.findShortestPath(startNodeId, destRoomId);
    this.layers.route.innerHTML = '';
    this.layers.overlay.innerHTML = '';

    if (!routeResult || !routeResult.path || routeResult.path.length < 2) {
      this.activeRoute = null;
      this.activeManeuvers = [];
      this.hideManeuverCard();
      return;
    }

    this.activeRoute = routeResult;

    // 1. Compute Turn Maneuvers with Bearings
    this.activeManeuvers = this.computeRouteManeuvers(routeResult.path);
    this.currentManeuverIndex = 0;
    this.distAlongCurrentManeuver = 0;
    this.isNavigating = true;

    // 2. Draw Route Geometry
    const points = routeResult.path.map(id => {
      const item = this.nodeMap[id] || this.roomMap[id];
      return `${item.x},${item.y}`;
    });
    const d = `M ${points.join(' L ')}`;

    // Soft Background Glow
    const glowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    glowPath.setAttribute('d', d);
    glowPath.setAttribute('fill', 'none');
    glowPath.setAttribute('class', 'active-nav-glow');
    this.layers.route.appendChild(glowPath);

    // Animated Directional Walking Line
    const activePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    activePath.setAttribute('d', d);
    activePath.setAttribute('fill', 'none');
    activePath.setAttribute('class', 'active-nav-line');
    this.layers.route.appendChild(activePath);

    // 3. Destination Pulsing Pin Overlay (USTED Navy & Gold)
    const pulseG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    pulseG.setAttribute('transform', `translate(${destRoom.x}, ${destRoom.y})`);

    const pulseRing = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    pulseRing.setAttribute('class', 'dest-pulse-ring');
    pulseRing.setAttribute('fill', 'none');
    pulseG.appendChild(pulseRing);

    const pin = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    pin.setAttribute('r', '7.5');
    pin.setAttribute('fill', '#33449b');
    pin.setAttribute('stroke', '#f8b511');
    pin.setAttribute('stroke-width', '2.5');
    pin.setAttribute('class', 'target-room-pin');
    pulseG.appendChild(pin);

    const centerDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    centerDot.setAttribute('r', '2.5');
    centerDot.setAttribute('fill', '#ffffff');
    pulseG.appendChild(centerDot);

    this.layers.overlay.appendChild(pulseG);

    // 4. Update UI Metrics and Floating Active Maneuver Card
    const walkingSecs = Math.round(routeResult.totalMeters / 1.1);
    this.updateRouteMetrics(routeResult.totalMeters, walkingSecs, routeResult.path);
    this.updateManeuverCard();
  }

  computeRouteManeuvers(path) {
    if (!path || path.length < 2) return [];
    const maneuvers = [];
    const nodes = path.map(id => this.nodeMap[id] || this.roomMap[id]);
    const scale = this.floorData._meta.scaleMetersPerPixel || 0.05;

    for (let i = 0; i < nodes.length - 1; i++) {
      const curr = nodes[i];
      const next = nodes[i + 1];
      const pixelDist = Math.hypot(next.x - curr.x, next.y - curr.y);
      const meters = Math.max(0.5, Math.round(pixelDist * scale * 10) / 10);
      const bearing = Math.atan2(next.y - curr.y, next.x - curr.x) * (180 / Math.PI);

      let turnType = 'straight';
      let icon = 'fa-arrow-up';
      let turnText = `Continue straight toward ${next.label || 'corridor'}`;

      if (i === 0) {
        turnType = 'depart';
        icon = 'fa-person-walking';
        turnText = `Start at ${curr.label || 'Origin'}, head toward ${next.label || 'corridor'}`;
      } else {
        const prev = nodes[i - 1];
        const prevBearing = Math.atan2(curr.y - prev.y, curr.x - prev.x) * (180 / Math.PI);
        let dTheta = bearing - prevBearing;
        while (dTheta > 180) dTheta -= 360;
        while (dTheta < -180) dTheta += 360;

        if (Math.abs(dTheta) <= 35) {
          turnType = 'straight';
          icon = 'fa-arrow-up';
          turnText = `Continue straight past ${curr.label || 'corridor'}`;
        } else if (dTheta > 35 && dTheta <= 120) {
          turnType = 'right';
          icon = 'fa-turn-right';
          turnText = `Turn right into ${next.label || 'corridor'}`;
        } else if (dTheta > 120) {
          turnType = 'sharp-right';
          icon = 'fa-arrow-rotate-right';
          turnText = `Make a sharp right into ${next.label || 'corridor'}`;
        } else if (dTheta < -35 && dTheta >= -120) {
          turnType = 'left';
          icon = 'fa-turn-left';
          turnText = `Turn left into ${next.label || 'corridor'}`;
        } else {
          turnType = 'sharp-left';
          icon = 'fa-arrow-rotate-left';
          turnText = `Make a sharp left into ${next.label || 'corridor'}`;
        }
      }

      maneuvers.push({
        fromId: path[i],
        toId: path[i + 1],
        from: curr,
        to: next,
        meters,
        bearing,
        turnType,
        icon,
        turnText,
        targetName: next.label || 'corridor'
      });
    }

    // Final Arrival Maneuver
    const dest = nodes[nodes.length - 1];
    maneuvers.push({
      fromId: path[path.length - 1],
      toId: path[path.length - 1],
      from: dest,
      to: dest,
      meters: 0,
      bearing: maneuvers.length ? maneuvers[maneuvers.length - 1].bearing : 0,
      turnType: 'arrive',
      icon: 'fa-flag-checkered',
      turnText: `Arrive at ${dest.label || 'Destination'}`,
      targetName: dest.label || 'Destination'
    });

    return maneuvers;
  }

  // ─── STEP 3: PEDESTRIAN DEAD RECKONING & VECTOR SNAPPING ───────

  advanceStep(stepLengthMeters = 0.7) {
    if (!this.activeManeuvers || this.activeManeuvers.length === 0) return;

    const totalLegs = this.activeManeuvers.length - 1; // last is arrival

    // If already arrived
    if (this.currentManeuverIndex >= totalLegs) {
      this.onArrival();
      return;
    }

    this.distAlongCurrentManeuver += stepLengthMeters;
    let curr = this.activeManeuvers[this.currentManeuverIndex];

    // Transition across junctions when step passes segment length
    while (curr && this.distAlongCurrentManeuver >= curr.meters && this.currentManeuverIndex < totalLegs) {
      this.distAlongCurrentManeuver -= curr.meters;
      this.currentManeuverIndex++;
      curr = this.activeManeuvers[this.currentManeuverIndex];

      if (this.currentManeuverIndex >= totalLegs) {
        this.onArrival();
        return;
      }
    }

    // Corridor Vector Snapping Interpolation
    if (curr && curr.meters > 0) {
      const ratio = Math.min(1, Math.max(0, this.distAlongCurrentManeuver / curr.meters));
      const userX = curr.from.x + ratio * (curr.to.x - curr.from.x);
      const userY = curr.from.y + ratio * (curr.to.y - curr.from.y);

      // Default heading matches corridor vector (bearing + 90 for SVG cone pointing up)
      this.setUserPosition(userX, userY, curr.bearing + 90);
    }

    this.updateManeuverCard();
    this.updateTurnStepsHighlight();
  }

  onArrival() {
    this.stopAutoWalk();
    const dest = this.roomMap[this.destinationId];
    if (dest) {
      this.setUserPosition(dest.x, dest.y, 0);
    }

    if (this.maneuverCard) {
      this.maneuverIcon.className = 'fas fa-flag-checkered';
      this.maneuverIconWrap.classList.add('arrived');
      this.maneuverPrimary.textContent = 'You have arrived!';
      this.maneuverSecondary.textContent = dest ? dest.label : 'Destination reached';
      this.maneuverProgressFill.style.width = '100%';
    }
  }

  toggleAutoWalk() {
    if (this.isAutoWalking) {
      this.stopAutoWalk();
    } else {
      this.startAutoWalk();
    }
  }

  startAutoWalk() {
    if (!this.destinationId) return;
    this.isAutoWalking = true;
    this.btnWalkToggle?.classList.add('active');
    if (this.walkToggleIcon) this.walkToggleIcon.className = 'fas fa-pause';

    this.autoWalkTimer = setInterval(() => {
      this.advanceStep(0.7);
    }, 600);
  }

  stopAutoWalk() {
    this.isAutoWalking = false;
    this.btnWalkToggle?.classList.remove('active');
    if (this.walkToggleIcon) this.walkToggleIcon.className = 'fas fa-play';

    if (this.autoWalkTimer) {
      clearInterval(this.autoWalkTimer);
      this.autoWalkTimer = null;
    }
  }

  updateManeuverCard() {
    if (!this.maneuverCard || !this.activeManeuvers.length) return;

    const curr = this.activeManeuvers[this.currentManeuverIndex];
    if (!curr) return;

    this.maneuverCard.classList.add('visible');
    this.maneuverIconWrap.classList.remove('arrived');
    this.maneuverIcon.className = `fas ${curr.icon}`;

    const distRemaining = Math.max(0, Math.round((curr.meters - this.distAlongCurrentManeuver) * 10) / 10);
    const ratio = curr.meters > 0 ? (this.distAlongCurrentManeuver / curr.meters) : 1;

    if (curr.turnType === 'depart') {
      this.maneuverPrimary.textContent = `Head straight for ${distRemaining}m`;
      this.maneuverSecondary.textContent = curr.turnText;
    } else if (curr.turnType === 'arrive') {
      this.maneuverPrimary.textContent = `Arrive at ${curr.targetName}`;
      this.maneuverSecondary.textContent = `Destination is right ahead`;
    } else {
      this.maneuverPrimary.textContent = `In ${distRemaining}m, ${curr.turnText.toLowerCase()}`;
      const next = this.activeManeuvers[this.currentManeuverIndex + 1];
      this.maneuverSecondary.textContent = next ? `Then ${next.turnText.toLowerCase()}` : `Approaching destination`;
    }

    this.maneuverProgressFill.style.width = `${Math.min(100, Math.round(ratio * 100))}%`;
  }

  hideManeuverCard() {
    if (this.maneuverCard) {
      this.maneuverCard.classList.remove('visible');
    }
  }

  updateTurnStepsHighlight() {
    const stepRows = document.querySelectorAll('#turnStepsList .step-row');
    stepRows.forEach((row, idx) => {
      if (idx === this.currentManeuverIndex) {
        row.classList.add('active');
        row.classList.remove('passed');
      } else if (idx < this.currentManeuverIndex) {
        row.classList.remove('active');
        row.classList.add('passed');
      } else {
        row.classList.remove('active');
        row.classList.remove('passed');
      }
    });
  }

  findShortestPath(startId, endId) {
    const dist = {};
    const prev = {};
    const pq = [{ node: startId, cost: 0 }];

    for (let k in this.graph) dist[k] = Infinity;
    dist[startId] = 0;

    while (pq.length > 0) {
      pq.sort((a, b) => a.cost - b.cost);
      const curr = pq.shift();

      if (curr.node === endId) break;
      if (curr.cost > dist[curr.node]) continue;

      const neighbors = this.graph[curr.node] || [];
      for (let neighbor of neighbors) {
        const alt = curr.cost + neighbor.meters;
        if (alt < dist[neighbor.node]) {
          dist[neighbor.node] = alt;
          prev[neighbor.node] = curr.node;
          pq.push({ node: neighbor.node, cost: alt });
        }
      }
    }

    if (dist[endId] === Infinity) return null;

    const path = [];
    let curr = endId;
    while (curr) {
      path.unshift(curr);
      curr = prev[curr];
    }

    return { path, totalMeters: Math.round(dist[endId] * 10) / 10 };
  }

  showDetailSheet(room) {
    if (!this.detailSheet) return;

    let iconClass = 'fa-door-open';
    let typeName = 'Room';
    if (room.type === 'lecture') {
      iconClass = 'fa-chalkboard-user';
      typeName = 'Lecture Hall';
    } else if (room.type === 'office') {
      iconClass = 'fa-briefcase';
      typeName = 'Faculty Office';
    } else if (room.type === 'washroom') {
      iconClass = 'fa-restroom';
      typeName = 'Washroom Facility';
    }

    document.getElementById('sheetTitle').textContent = room.label;
    document.getElementById('sheetSubtitle').textContent = `${typeName} • Ground Floor`;
    document.getElementById('sheetIcon').innerHTML = `<i class="fas ${iconClass}"></i>`;

    this.updateSheetActionButtons(room.id);

    this.detailSheet.classList.add('open');
    document.body.classList.add('sheet-active');
  }

  updateSheetActionButtons(roomId) {
    if (this.btnSetAsOrigin) {
      const isCurrentOrigin = (roomId === this.originNodeId);
      this.btnSetAsOrigin.className = `btn-sheet-origin ${isCurrentOrigin ? 'is-current' : ''}`;
      this.btnSetAsOrigin.innerHTML = `
        <i class="fas fa-location-crosshairs"></i>
        <span>${isCurrentOrigin ? 'Starting Point' : 'Start From Here'}</span>
      `;
    }

    if (this.btnSetAsDest) {
      const isCurrentDest = (roomId === this.destinationId);
      this.btnSetAsDest.innerHTML = `
        <i class="fas fa-diamond-turn-right"></i>
        <span>${isCurrentDest ? 'Active Target' : 'Directions Here'}</span>
      `;
    }
  }

  updateRouteMetrics(meters, seconds, path) {
    const distanceEl = document.getElementById('metricDistance');
    const timeEl = document.getElementById('metricTime');
    const stepsListEl = document.getElementById('turnStepsList');

    if (distanceEl) distanceEl.textContent = `${meters} m`;
    if (timeEl) timeEl.textContent = seconds < 60 ? `~${seconds}s` : `~${Math.round(seconds / 60)} min`;

    if (!stepsListEl || !this.activeManeuvers) return;

    stepsListEl.innerHTML = this.activeManeuvers.map((m, idx) => `
      <div class="step-row ${idx === this.currentManeuverIndex ? 'active' : ''}">
        <div class="step-num"><i class="fas ${m.icon}"></i></div>
        <div class="step-text">
          <div style="font-weight: 600;">${m.turnText}</div>
          <div style="font-size: 11px; color: var(--muted);">${m.meters > 0 ? `${m.meters} m` : 'Destination'}</div>
        </div>
      </div>
    `).join('');
  }

  // ─── GESTURES & VIEWPORT CONTROLS ─────────────────────────────

  setupEventListeners() {
    // 1. Dual Bottom Sheet Buttons
    if (this.btnSetAsOrigin) {
      this.btnSetAsOrigin.addEventListener('click', () => {
        if (this.inspectedRoomId) {
          this.setOrigin(this.inspectedRoomId, true);
        }
      });
    }

    if (this.btnSetAsDest) {
      this.btnSetAsDest.addEventListener('click', () => {
        if (this.inspectedRoomId) {
          this.setDestination(this.inspectedRoomId, true);
        }
      });
    }

    // 2. Active Maneuver Card Controls
    if (this.btnStepSimulate) {
      this.btnStepSimulate.addEventListener('click', () => {
        this.advanceStep(0.7);
      });
    }

    if (this.btnWalkToggle) {
      this.btnWalkToggle.addEventListener('click', () => {
        this.toggleAutoWalk();
      });
    }

    // 3. Origin Chip Click (Quick cycle / reset to entrances)
    if (this.originChip) {
      this.originChip.addEventListener('click', () => {
        const entrances = this.floorData?.entrances || [];
        if (!entrances.length) return;
        const currentIdx = entrances.findIndex(e => e.id === this.originNodeId);
        const nextEntrance = entrances[(currentIdx + 1) % entrances.length];
        this.setOrigin(nextEntrance.id, true);
      });
    }

    // 4. Zoom Buttons
    document.getElementById('zoomInBtn')?.addEventListener('click', () => this.zoomBy(1.25));
    document.getElementById('zoomOutBtn')?.addEventListener('click', () => this.zoomBy(0.8));

    // 5. Recenter Button
    document.getElementById('recenterBtn')?.addEventListener('click', () => this.fitToScreen(true));

    // 6. Close Sheet Button
    document.getElementById('sheetCloseBtn')?.addEventListener('click', () => {
      this.detailSheet?.classList.remove('open');
      document.body.classList.remove('sheet-active');
    });

    // 7. Pan & Drag Gestures (Mouse & Touch)
    this.viewportEl.addEventListener('mousedown', (e) => this.onDragStart(e));
    window.addEventListener('mousemove', (e) => this.onDragMove(e));
    window.addEventListener('mouseup', () => this.onDragEnd());

    this.viewportEl.addEventListener('touchstart', (e) => this.onTouchStart(e), { passive: false });
    window.addEventListener('touchmove', (e) => this.onTouchMove(e), { passive: false });
    window.addEventListener('touchend', (e) => this.onTouchEnd(e));

    // 8. Mouse Wheel Zoom
    this.viewportEl.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });

    // 9. Search Bar Controls
    this.setupSearchAndAutocomplete();
  }

  setupSearchAndAutocomplete() {
    if (!this.searchInput) return;

    this.searchInput.addEventListener('input', () => this.onSearchInput());
    this.searchInput.addEventListener('focus', () => {
      if (this.searchInput.value.trim().length > 0) {
        this.autocompleteList?.classList.add('open');
      }
    });

    this.searchClearBtn?.addEventListener('click', () => {
      this.searchInput.value = '';
      this.searchClearBtn.classList.remove('visible');
      this.autocompleteList?.classList.remove('open');
      this.layers.route.innerHTML = '';
      this.layers.overlay.innerHTML = '';
      this.destinationId = null;
      this.hideManeuverCard();
      this.stopAutoWalk();
      this.detailSheet?.classList.remove('open');
      document.body.classList.remove('sheet-active');
    });

    document.addEventListener('click', (e) => {
      if (!this.searchInput.contains(e.target) && !this.autocompleteList?.contains(e.target)) {
        this.autocompleteList?.classList.remove('open');
      }
    });
  }

  onDragStart(e) {
    if (e.target.closest('.room-node') || e.target.closest('.entrance-node') || e.target.closest('.fab')) {
      return;
    }
    this.isDragging = true;
    this.dragStartX = e.clientX - this.translateX;
    this.dragStartY = e.clientY - this.translateY;
    this.viewportEl.style.cursor = 'grabbing';
  }

  onDragMove(e) {
    if (!this.isDragging) return;
    this.translateX = e.clientX - this.dragStartX;
    this.translateY = e.clientY - this.dragStartY;
    this.updateTransform();
  }

  onDragEnd() {
    this.isDragging = false;
    this.viewportEl.style.cursor = 'grab';
  }

  onTouchStart(e) {
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      this.isDragging = true;
      this.dragStartX = touch.clientX - this.translateX;
      this.dragStartY = touch.clientY - this.translateY;
    } else if (e.touches.length === 2) {
      this.isDragging = false;
      this.initialPinchDistance = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      this.initialPinchScale = this.scale;
    }
  }

  onTouchMove(e) {
    if (e.touches.length === 1 && this.isDragging) {
      e.preventDefault();
      const touch = e.touches[0];
      this.translateX = touch.clientX - this.dragStartX;
      this.translateY = touch.clientY - this.dragStartY;
      this.updateTransform();
    } else if (e.touches.length === 2 && this.initialPinchDistance) {
      e.preventDefault();
      const currentDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const factor = currentDist / this.initialPinchDistance;
      const targetScale = Math.min(this.maxScale, Math.max(this.minScale, this.initialPinchScale * factor));
      this.scale = targetScale;
      this.updateTransform();
    }
  }

  onTouchEnd(e) {
    if (e.touches.length < 2) {
      this.initialPinchDistance = null;
    }
    if (e.touches.length === 0) {
      this.isDragging = false;
    }
  }

  onWheel(e) {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 0.88;
    this.zoomBy(factor, e.clientX, e.clientY);
  }

  zoomBy(factor, originX = null, originY = null) {
    const vpW = this.viewportEl.clientWidth;
    const vpH = this.viewportEl.clientHeight;

    const ox = (originX !== null) ? originX : vpW / 2;
    const oy = (originY !== null) ? originY : vpH / 2;

    const newScale = Math.min(this.maxScale, Math.max(this.minScale, this.scale * factor));
    if (newScale === this.scale) return;

    this.translateX = ox - (ox - this.translateX) * (newScale / this.scale);
    this.translateY = oy - (oy - this.translateY) * (newScale / this.scale);
    this.scale = newScale;

    this.updateTransform();
  }

  fitToScreen(animated = false) {
    const meta = this.floorData._meta;
    const vpW = this.viewportEl.clientWidth;
    const vpH = this.viewportEl.clientHeight;

    const mapW = meta.imageWidth || 1040;
    const mapH = meta.imageHeight || 870;

    const padTop = 135;
    const padBottom = 80;
    const padHoriz = 30;

    const availW = vpW - padHoriz;
    const availH = vpH - (padTop + padBottom);

    const fitScale = Math.min(availW / mapW, availH / mapH, 1.15);
    const targetScale = Math.max(this.minScale, fitScale);

    const targetX = (vpW - mapW * targetScale) / 2;
    const targetY = padTop + (availH - mapH * targetScale) / 2;

    if (animated) {
      this.animateTo(targetScale, targetX, targetY);
    } else {
      this.scale = targetScale;
      this.translateX = targetX;
      this.translateY = targetY;
      this.updateTransform();
    }
  }

  flyToPoint(pointX, pointY, targetScale = 1.35) {
    const vpW = this.viewportEl.clientWidth;
    const vpH = this.viewportEl.clientHeight;

    const cx = vpW / 2;
    const cy = window.innerWidth <= 640 ? (vpH * 0.36) : (vpH / 2);

    const targetX = cx - (pointX * targetScale);
    const targetY = cy - (pointY * targetScale);

    this.animateTo(targetScale, targetX, targetY);
  }

  animateTo(destScale, destX, destY, duration = 350) {
    const startScale = this.scale;
    const startX = this.translateX;
    const startY = this.translateY;
    const startTime = performance.now();

    const step = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 3);

      this.scale = startScale + (destScale - startScale) * ease;
      this.translateX = startX + (destX - startX) * ease;
      this.translateY = startY + (destY - startY) * ease;
      this.updateTransform();

      if (progress < 1) {
        requestAnimationFrame(step);
      }
    };
    requestAnimationFrame(step);
  }

  updateTransform() {
    this.svgContainer.style.transform = `translate3d(${this.translateX}px, ${this.translateY}px, 0) scale(${this.scale})`;
  }

  // ─── SEARCH & AUTOCOMPLETE ───────────────────────────────────

  onSearchInput() {
    const query = this.searchInput.value.trim().toLowerCase();
    this.searchClearBtn.classList.toggle('visible', query.length > 0);

    if (!query) {
      this.autocompleteList.classList.remove('open');
      return;
    }

    const matches = this.floorData.rooms.filter(room => {
      return room.label.toLowerCase().includes(query) ||
             room.id.toLowerCase().includes(query) ||
             room.type.toLowerCase().includes(query);
    });

    if (matches.length === 0) {
      this.autocompleteList.innerHTML = `
        <div style="padding: 10px; color: var(--text-muted); font-size: 12px; text-align: center;">
          No matching rooms found
        </div>
      `;
      this.autocompleteList.classList.add('open');
      return;
    }

    this.autocompleteList.innerHTML = matches.map(m => {
      let icon = 'fa-door-open';
      let bg = 'rgba(37,99,235,0.2)';
      let col = '#60a5fa';

      if (m.type === 'lecture') {
        icon = 'fa-chalkboard-user';
        bg = 'rgba(245,158,11,0.2)';
        col = '#fbbf24';
      } else if (m.type === 'washroom') {
        icon = 'fa-restroom';
        bg = 'rgba(16,185,129,0.2)';
        col = '#34d399';
      }

      return `
        <div class="autocomplete-item" data-id="${m.id}">
          <div class="ac-left">
            <div class="ac-icon" style="background:${bg}; color:${col};">
              <i class="fas ${icon}"></i>
            </div>
            <div class="ac-text">
              <span class="ac-title">${m.label}</span>
              <span class="ac-sub">${m.type.toUpperCase()} • Ground Floor</span>
            </div>
          </div>
        </div>
      `;
    }).join('');

    this.autocompleteList.querySelectorAll('.autocomplete-item').forEach(item => {
      item.addEventListener('click', () => {
        const id = item.getAttribute('data-id');
        this.setDestination(id, true);
        this.searchInput.value = this.roomMap[id]?.label || '';
        this.autocompleteList.classList.remove('open');
      });
    });

    this.autocompleteList.classList.add('open');
  }

  // ─── STEP 5: QR ENTRANCE & DEEP LINK HANDOFF ─────────────────

  handleUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const fromParam = params.get('from');
    const toParam = params.get('to') || params.get('target');

    if (fromParam) {
      if (this.entranceMap[fromParam] || this.roomMap[fromParam] || this.nodeMap[fromParam]) {
        this.setOrigin(fromParam, false);
      }
    }

    if (toParam && this.roomMap[toParam]) {
      setTimeout(() => {
        this.setDestination(toParam, true);
      }, 250);
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.indoorNav = new IndoorNavigator();
});
