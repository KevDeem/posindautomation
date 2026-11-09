/**
 * VMS Catalog Metadata Cache
 * 
 * Lightweight in-memory cache for VMS Service Catalog records.
 * - Stores catalog metadata: name, services, validity period, status, catalogId, detailUrl.
 * - Configurable TTL (default: 60 seconds).
 * - Thread-safe concurrent fetch deduplication (inflight promise sharing).
 * - Explicit invalidation and refresh support.
 * - Never caches authentication failures or incomplete records.
 * - Completely isolated from OMS.
 */

const DEFAULT_CACHE_TTL_MS = 60 * 1000; // 60 seconds

let _cacheTtlMs = DEFAULT_CACHE_TTL_MS;
let _cachedCatalogs = null;
let _cacheTimestamp = 0;
let _inflightPromise = null;

/**
 * Configure Cache TTL in milliseconds
 * @param {number} ttlMs TTL in milliseconds
 */
function setCatalogCacheTtl(ttlMs) {
  if (typeof ttlMs === 'number' && ttlMs > 0) {
    _cacheTtlMs = ttlMs;
  }
}

/**
 * Get current Cache TTL in milliseconds
 * @returns {number}
 */
function getCatalogCacheTtl() {
  return _cacheTtlMs;
}

/**
 * Get cached catalog records if still valid within TTL
 * @returns {{ catalogs: Array, ageSeconds: number, timestamp: number } | null}
 */
function getCachedCatalogs() {
  if (!_cachedCatalogs || _cacheTimestamp === 0) {
    return null;
  }
  const now = Date.now();
  const ageMs = now - _cacheTimestamp;
  if (ageMs > _cacheTtlMs) {
    return null; // Expired
  }
  return {
    catalogs: _cachedCatalogs.map(c => ({ ...c })),
    ageSeconds: Math.floor(ageMs / 1000),
    timestamp: _cacheTimestamp,
  };
}

/**
 * Store catalog records in cache
 * Sanitizes input to ensure only metadata is stored (no sensitive session data or credentials).
 * @param {Array} catalogs Array of catalog records
 */
function setCatalogCache(catalogs) {
  if (!Array.isArray(catalogs)) return;
  _cachedCatalogs = catalogs.map(c => ({
    name: c.name || '',
    services: c.services || '0',
    startDate: c.startDate || '',
    endDate: c.endDate || '',
    status: c.status || '',
    catalogId: c.catalogId || null,
    detailUrl: c.detailUrl || null,
    rowIndex: c.rowIndex !== undefined ? c.rowIndex : null,
    pageIndex: c.pageIndex || 1,
  }));
  _cacheTimestamp = Date.now();
}

/**
 * Invalidate catalog cache
 */
function invalidateCatalogCache() {
  _cachedCatalogs = null;
  _cacheTimestamp = 0;
  console.log('[VMS] Catalog cache invalidated.');
}

/**
 * Retrieve catalog list from cache if valid, otherwise execute headless fetch.
 * Handles concurrent retrieval requests by deduplicating calls with an active in-flight promise.
 * 
 * @param {Function} fetchFn Async function that retrieves catalogs via headless browser
 * @param {Object} options { refresh: boolean }
 * @returns {Promise<{ catalogs: Array, fromCache: boolean, ageSeconds: number }>}
 */
async function getOrFetchCatalogs(fetchFn, options = {}) {
  const forceRefresh = options.refresh === true;

  if (!forceRefresh) {
    const cached = getCachedCatalogs();
    if (cached) {
      console.log(`[VMS] Catalog list loaded from cache (age: ${cached.ageSeconds} seconds).`);
      return {
        catalogs: cached.catalogs,
        fromCache: true,
        ageSeconds: cached.ageSeconds,
      };
    }
  }

  // Deduplicate concurrent requests
  if (_inflightPromise) {
    console.log('[VMS] Concurrent catalog retrieval in progress, awaiting active fetch...');
    return await _inflightPromise;
  }

  _inflightPromise = (async () => {
    try {
      console.log('[VMS] Retrieving available catalogs (headless)...');
      const records = await fetchFn();
      if (Array.isArray(records)) {
        setCatalogCache(records);
      }
      return {
        catalogs: Array.isArray(records) ? records.map(c => ({ ...c })) : [],
        fromCache: false,
        ageSeconds: 0,
      };
    } finally {
      _inflightPromise = null;
    }
  })();

  return await _inflightPromise;
}

module.exports = {
  DEFAULT_CACHE_TTL_MS,
  setCatalogCacheTtl,
  getCatalogCacheTtl,
  getCachedCatalogs,
  setCatalogCache,
  invalidateCatalogCache,
  getOrFetchCatalogs,
};
