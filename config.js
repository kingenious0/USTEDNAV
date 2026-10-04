/**
 * CampusOS / USTED Nav - Global Application Configuration
 * Copyright (c) 2026 KINGENIOUS. All Rights Reserved.
 * Proprietary software of KINGENIOUS (Ghana).
 * Baked-in project defaults with localStorage override support.
 */

const APP_CONFIG = {
  SUPABASE_URL: 'https://mzxmbkulgrehujpvwadt.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16eG1ia3VsZ3JlaHVqcHZ3YWR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ1Njk5NjQsImV4cCI6MjEwMDE0NTk2NH0.PQMuAN1Hr82re8sgIJCbwwU09u6594UC3oIdTGoJfaE',
  DEFAULT_SCHEMA: 'usted_nav',
  DEFAULT_ORG_ID: 'usted-ksi',
  NAVI_CLOUD_URL: ''
};

const rootObj = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : global);

function getSafeStorageItem(key) {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(key);
    }
  } catch (e) {
    // LocalStorage might be restricted/unavailable in private browsing or iframe
  }
  return null;
}

rootObj.APP_CONFIG = APP_CONFIG;

rootObj.ENV = {
  get supabaseUrl() {
    return (getSafeStorageItem('supabase_url') || APP_CONFIG.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  },
  get supabaseKey() {
    return (getSafeStorageItem('supabase_anon_key') || APP_CONFIG.SUPABASE_ANON_KEY || '').trim();
  },
  get schema() {
    return (getSafeStorageItem('supabase_schema') || APP_CONFIG.DEFAULT_SCHEMA || '').trim();
  },
  get orgId() {
    return (getSafeStorageItem('campus_org_id') || APP_CONFIG.DEFAULT_ORG_ID || '').trim();
  },
  get naviCloudUrl() {
    return (getSafeStorageItem('navi_cloud_url') || APP_CONFIG.NAVI_CLOUD_URL || '').trim().replace(/\/+$/, '');
  },
  resetDefaults() {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('supabase_url');
        localStorage.removeItem('supabase_anon_key');
        localStorage.removeItem('supabase_schema');
        localStorage.removeItem('campus_org_id');
        localStorage.removeItem('campusos_supabase_config');
      }
    } catch (e) {
      console.warn('[Config] Reset defaults notice:', e);
    }
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { APP_CONFIG, ENV: rootObj.ENV };
}
