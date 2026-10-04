# USTED NAV: Digital Campus Navigation System

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![Build](https://img.shields.io/badge/build-passing-brightgreen.svg)
![PWA](https://img.shields.io/badge/PWA-Ready-success.svg)

**USTED NAV** is a custom, web-based digital campus navigation and room identification system developed specifically for the University of Skills Training and Entrepreneurial Development (USTED) Kumasi Campus. 

It was built to address the critical challenges of student disorientation, lateness, and the limitations of generic mapping applications by providing deep, room-level metadata, offline functionality, and a Progressive Web App (PWA) architecture.

---

## 🚀 Key Features

*   **Deep Room-Level Metadata:** Search for specific locations like "Lecture Room 001" or "Guidance and Counselling Centre." The system provides the exact building, floor, wing, and service details.
*   **Offline Routing Engine:** Features a custom client-side Dijkstra algorithm that calculates walking paths using an embedded GeoJSON campus road network. It works perfectly even without an internet connection.
*   **PWA Architecture:** Can be installed directly to the home screen on iOS, Android, or Desktop. Uses Service Workers and Cache API to operate offline.
*   **Live Navigation HUD:** Provides a GPS-tracked, turn-by-turn Heads-Up Display (HUD) with distance metrics and dynamic re-routing if the user steps off the path.
*   **Hardware-Accelerated 3D Maps:** Utilizes Mapbox GL JS and WebGL for smooth, 3D extruded buildings and high-performance camera animations on mobile devices.

---

## 🛠️ Technology Stack

This project was intentionally built using a "Vanilla" frontend stack to eliminate heavy framework bundles, ensuring the application loads rapidly even on poor campus Wi-Fi networks.

*   **Core:** HTML5, CSS3, Vanilla JavaScript (ES6+)
*   **Mapping Library:** Mapbox GL JS (v3.1.2)
*   **Geospatial Data:** GeoJSON (for the custom road network and path routing)
*   **Offline Support:** Service Workers & Cache Storage API
*   **Icons & Fonts:** Font Awesome, Google Fonts (Inter)

---

## 📂 File Structure

```text
CampusOS/
├── index.html           # The splash screen and PWA entry point
├── map.html             # The core application logic (map, routing, UI)
├── sw.js                # The Service Worker controlling the offline caching
├── manifest.json        # Web App Manifest for PWA installation
├── package.json         # Project metadata
├── logo.png             # Application logo
├── data/                # Local data files consumed by the application
│   ├── buildings.json   # 46 location objects with nested room/service arrays
│   ├── campus.geojson   # Primary road network nodes/edges for Dijkstra
│   └── roads.geojson    # Supplementary paths
└── css/
    └── styles.css       # Global stylesheet (if separated from map.html)
```

---

## ⚙️ Installation & Setup (Local Development)

Because USTED NAV is a client-side serverless application, running it locally is very straightforward. You only need a local HTTP server (to prevent CORS errors when fetching the JSON data and registering the Service Worker).

### Method 1: Using VS Code Live Server (Recommended)
1. Open the `CampusOS` directory in Visual Studio Code.
2. Install the **Live Server** extension (by Ritwick Dey).
3. Right-click on `index.html` and select **"Open with Live Server"**.
4. The application will open automatically in your browser at `http://127.0.0.1:5500`.

### Method 2: Using Python
If you have Python installed on your system:
1. Open your terminal/command prompt.
2. Navigate to the `CampusOS` directory: `cd path/to/CampusOS`
3. Run the following command:
   * **Python 3:** `python -m http.server 8000`
4. Open your browser and navigate to `http://localhost:8000`.

---

## 🌐 Testing the PWA and Offline Mode

To evaluate the offline capabilities of the application:

1. **First Load:** Open the application while connected to the internet. The Service Worker (`sw.js`) will automatically install in the background and cache the application shell, map tiles, and `buildings.json` data.
2. **Go Offline:** Open your browser's Developer Tools (F12) -> Go to the **Network** tab -> Change throttling to **"Offline"**. (Alternatively, disconnect your Wi-Fi).
3. **Test:** 
   * Refresh the page. The app will load instantly from the cache.
   * Search for a building (e.g., "ROB") and click **Directions**.
   * The custom Dijkstra engine will intercept the request and calculate a route entirely locally.

---

## 📜 Notice for Evaluators / Examiners

This codebase is submitted as the technical artefact for the Design Science Research (DSR) project. All data within `buildings.json` has been ground-truthed using GPS devices on the Kumasi Campus. The offline routing graph has been hand-digitized for accuracy.

**Mapbox Token Warning:** The Mapbox API token embedded in the application is tied to a development account and may have rate limits. If map tiles fail to load, ensure you have an active internet connection for the initial cache build.

---

## ⚖️ Intellectual Property & Ownership Notice

**CampusOS™** (and its deployment instance **USTED NAV**) is the exclusive proprietary intellectual property of **KINGENIOUS** (Ghana).

* **Proprietor & Architecture:** KINGENIOUS
* **Copyright:** © 2026 KINGENIOUS. All Rights Reserved.
* **Institutional Deployment:** Akenten Appiah-Menka University of Skills Training and Entrepreneurial Development (AAMUSTED / USTED Kumasi).
* **Usage Rights:** AAMUSTED holds an institutional end-user operational license for campus navigation and room guidance. All underlying software source code, spatial graph engines, route-solving algorithms, 3D rendering pipelines, and platform architecture remain the sole intellectual property of KINGENIOUS.
* **License:** UNLICENSED (Proprietary). No unauthorized reproduction, white-labeling, modification, or redistribution permitted without prior written consent from KINGENIOUS.

---
*Architected & Engineered by KINGENIOUS.*
