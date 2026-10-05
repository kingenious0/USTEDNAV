/**
 * CampusOS Telemetry & Usage Analytics
 * Copyright (c) 2026 KINGENIOUS. All Rights Reserved.
 *
 * Ultra-lightweight, non-blocking telemetry engine for tracking:
 * - Page views & unique visitors
 * - APK downloads & PWA home-screen installations
 * - Search queries and routing usage
 *
 * Operates offline-safely with zero performance impact.
 */

(function(root) {
  'use strict';

  const STORAGE_DID_KEY = 'cpos_device_id';
  const STORAGE_SID_KEY = 'cpos_session_id';

  function getOrSetDeviceId() {
    try {
      let did = localStorage.getItem(STORAGE_DID_KEY);
      if (!did) {
        did = 'did_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now().toString(36);
        localStorage.setItem(STORAGE_DID_KEY, did);
      }
      return did;
    } catch (_) {
      return 'anonymous_device';
    }
  }

  function getOrSetSessionId() {
    try {
      let sid = sessionStorage.getItem(STORAGE_SID_KEY);
      if (!sid) {
        sid = 'sid_' + Math.random().toString(36).slice(2, 8) + '_' + Date.now().toString(36);
        sessionStorage.setItem(STORAGE_SID_KEY, sid);
      }
      return sid;
    } catch (_) {
      return 'anonymous_session';
    }
  }

  function detectOS() {
    if (typeof navigator === 'undefined') return 'unknown';
    const ua = navigator.userAgent || '';
    if (/android/i.test(ua)) return 'Android';
    if (/iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'iOS';
    if (/Windows/i.test(ua)) return 'Windows';
    if (/Macintosh|Mac OS X/i.test(ua)) return 'macOS';
    if (/Linux/i.test(ua)) return 'Linux';
    return 'Other';
  }

  function isStandalone() {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(display-mode: standalone)').matches ||
           window.matchMedia('(display-mode: fullscreen)').matches ||
           window.navigator.standalone === true;
  }

  const CampusTelemetry = {
    deviceId: getOrSetDeviceId(),
    sessionId: getOrSetSessionId(),
    os: detectOS(),

    track: function(eventName, customMetadata) {
      if (!eventName) return;

      const appCfg = root.APP_CONFIG || {};
      const env = root.ENV || {};
      const supabaseUrl = (env.supabaseUrl || appCfg.SUPABASE_URL || '').trim().replace(/\/+$/, '');
      const supabaseKey = (env.supabaseKey || appCfg.SUPABASE_ANON_KEY || '').trim();

      const payload = {
        event_name: String(eventName).slice(0, 64),
        device_id: this.deviceId,
        session_id: this.sessionId,
        device_os: this.os,
        is_pwa: isStandalone(),
        path: typeof window !== 'undefined' ? window.location.pathname : '/',
        screen_size: typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : 'unknown',
        metadata: customMetadata || {},
        created_at: new Date().toISOString()
      };

      // 1. Send to Supabase analytics_events table
      if (supabaseUrl && supabaseKey && typeof fetch !== 'undefined') {
        const endpoint = `${supabaseUrl}/rest/v1/analytics_events`;
        fetch(endpoint, {
          method: 'POST',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify(payload),
          keepalive: true
        }).catch(function() {
          // Silent catch: network drop or offline mode should never crash or warn
        });
      }

      // 2. Vercel Web Analytics custom event forwarder if available
      try {
        if (root.va && typeof root.va === 'function') {
          root.va('event', { name: eventName, data: customMetadata });
        }
      } catch (_) {}
    }
  };

  // Auto-track on load
  if (typeof window !== 'undefined') {
    window.addEventListener('load', function() {
      setTimeout(function() {
        CampusTelemetry.track('page_view', {
          referrer: document.referrer || 'direct',
          title: document.title
        });
      }, 500);
    });

    // Auto-track PWA installation
    window.addEventListener('appinstalled', function() {
      CampusTelemetry.track('pwa_installed', {
        installed_at: new Date().toISOString()
      });
    });
  }

  root.CampusTelemetry = CampusTelemetry;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CampusTelemetry;
  }
})(typeof window !== 'undefined' ? window : globalThis);
