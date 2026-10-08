/**
 * Canonical Distance Service for Kisan Vikas
 * Provides unified road distance and travel time calculation between farmer location
 * and procurement centres.
 * 
 * Rules:
 * 1. Straight-line (Haversine) distance may be used for coarse candidate ranking,
 *    but farmer-facing road distance must be clearly differentiated.
 * 2. Pluggable routing provider with in-memory caching to prevent repeated external calls.
 * 3. Graceful fallback when external routing service is unavailable or unconfigured.
 * 4. Returns: { distance_km, duration_minutes, provider, is_estimated, timestamp }
 */

const { haversineDistanceKm } = require('../locality/localityService');

// In-memory cache with 24-hour TTL: key -> { data, expiresAt }
const distanceCache = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

class DistanceService {
  constructor({
    routingApiUrl = process.env.ROUTING_API_URL || 'https://router.project-osrm.org/route/v1/driving',
    timeoutMs = Number(process.env.ROUTING_TIMEOUT_MS) || 5000
  } = {}) {
    this.routingApiUrl = routingApiUrl;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Generates a stable cache key for coordinate pairs rounded to 4 decimals (~11m precision).
   */
  _getCacheKey(origin, destination) {
    const oLat = Number(origin.latitude).toFixed(4);
    const oLon = Number(origin.longitude).toFixed(4);
    const dLat = Number(destination.latitude).toFixed(4);
    const dLon = Number(destination.longitude).toFixed(4);
    return `${oLat},${oLon}->${dLat},${dLon}`;
  }

  /**
   * Invalidates routing cache (e.g. if centre coordinates are updated).
   */
  clearCache() {
    distanceCache.clear();
  }

  /**
   * Retrieves road distance and travel duration between origin and destination coordinates.
   * @param {{ latitude: number, longitude: number }} origin
   * @param {{ latitude: number, longitude: number }} destination
   * @returns {Promise<{ distance_km: number, duration_minutes: number, provider: string, is_estimated: boolean, timestamp: string }>}
   */
  async getRoadDistance(origin, destination) {
    const timestamp = new Date().toISOString();

    if (!origin || !destination || origin.latitude == null || origin.longitude == null || destination.latitude == null || destination.longitude == null) {
      return {
        distance_km: null,
        duration_minutes: null,
        provider: 'COORDINATES_UNAVAILABLE',
        is_estimated: true,
        timestamp,
        fallback_reason: 'Origin or destination coordinates are missing.'
      };
    }

    const oLat = Number(origin.latitude);
    const oLon = Number(origin.longitude);
    const dLat = Number(destination.latitude);
    const dLon = Number(destination.longitude);

    if (isNaN(oLat) || isNaN(oLon) || isNaN(dLat) || isNaN(dLon)) {
      return {
        distance_km: null,
        duration_minutes: null,
        provider: 'INVALID_COORDINATES',
        is_estimated: true,
        timestamp,
        fallback_reason: 'Coordinates contain NaN or non-numeric values.'
      };
    }

    const cacheKey = this._getCacheKey({ latitude: oLat, longitude: oLon }, { latitude: dLat, longitude: dLon });
    const cached = distanceCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { ...cached.data, timestamp, from_cache: true };
    }

    // 1. Attempt live routing provider if configured
    let routingError = null;
    if (this.routingApiUrl) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        // OSRM format: /route/v1/driving/{lon1},{lat1};{lon2},{lat2}?overview=false
        const cleanUrl = this.routingApiUrl.replace(/\/+$/, '');
        const endpoint = `${cleanUrl}/${oLon},${oLat};${dLon},${dLat}?overview=false`;

        const resp = await fetch(endpoint, { signal: controller.signal });
        clearTimeout(timer);

        if (resp.ok) {
          const body = await resp.json();
          if (body.routes && body.routes.length > 0) {
            const route = body.routes[0];
            const distKm = Number((route.distance / 1000).toFixed(2));
            const durMin = Math.round(route.duration / 60);

            const result = {
              distance_km: distKm,
              duration_minutes: durMin,
              provider: 'OSRM_ROAD_NETWORK',
              is_estimated: false,
              routing_source: 'live_osrm_api',
              timestamp
            };

            distanceCache.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
            return result;
          }
        } else {
          routingError = `Routing API returned HTTP ${resp.status}`;
        }
      } catch (err) {
        routingError = err.name === 'AbortError' ? 'Routing request timed out' : (err.message || 'Routing network error');
      }
    }

    // 2. Calibrated Tamil Nadu Road Network Factor fallback
    // Rural Tamil Nadu typically has a road detour index of 1.25x - 1.30x over geodesic distance.
    const straightLineKm = haversineDistanceKm(oLat, oLon, dLat, dLon);
    if (straightLineKm == null) {
      return {
        distance_km: null,
        duration_minutes: null,
        provider: 'DISTANCE_UNAVAILABLE',
        is_estimated: true,
        timestamp,
        fallback_reason: 'Unable to calculate straight-line distance.'
      };
    }

    // Road factor: 1.28x with average rural agricultural transit speed ~30 km/h (tractors/lorries)
    const roadDistanceKm = Number((straightLineKm * 1.28).toFixed(1));
    const estimatedMinutes = Math.max(5, Math.round((roadDistanceKm / 30) * 60));

    const result = {
      distance_km: roadDistanceKm,
      straight_line_km: straightLineKm,
      duration_minutes: estimatedMinutes,
      provider: 'CALIBRATED_ROAD_FACTOR_FALLBACK',
      is_estimated: true,
      routing_source: 'calibrated_detour_formula',
      fallback_reason: routingError || 'OSRM routing unavailable, using calibrated road network model',
      timestamp
    };

    distanceCache.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
    return result;
  }

  /**
   * Fast straight-line distance for candidate pre-filtering / ranking.
   */
  getStraightLineDistanceKm(lat1, lon1, lat2, lon2) {
    return haversineDistanceKm(lat1, lon1, lat2, lon2);
  }

  /**
   * Clears the in-memory distance routing cache.
   */
  clearCache() {
    distanceCache.clear();
  }
}

// Singleton export
const defaultDistanceService = new DistanceService();

module.exports = {
  DistanceService,
  defaultDistanceService,
  haversineDistanceKm
};
