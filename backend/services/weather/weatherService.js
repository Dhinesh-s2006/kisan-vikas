/**
 * Canonical Weather Service for Kisan Vikas
 * Provides unified, cached weather advisories across Web, CSC, and Admin dashboards.
 * 
 * Rules:
 * 1. Weather is purely INFORMATIONAL: never blocks or determines slot booking.
 * 2. Strict fail-safe guarantee: errors return graceful fallback without failing callers.
 * 3. In-memory caching per district to avoid repeated external calls.
 * 4. Grounded in meteorological telemetry (Open-Meteo) with fallback coordinates for all 38 TN districts.
 */

const DISTRICT_COORDINATES = {
  'ariyalur': { lat: 11.1401, lon: 79.0786 },
  'chengalpattu': { lat: 12.6841, lon: 79.9836 },
  'chennai': { lat: 13.0827, lon: 80.2707 },
  'coimbatore': { lat: 11.0168, lon: 76.9558 },
  'cuddalore': { lat: 11.7480, lon: 79.7714 },
  'dharmapuri': { lat: 12.1357, lon: 78.1592 },
  'dindigul': { lat: 10.3673, lon: 77.9803 },
  'erode': { lat: 11.3410, lon: 77.7172 },
  'kallakurichi': { lat: 11.7383, lon: 78.9639 },
  'kanchipuram': { lat: 12.8342, lon: 79.7036 },
  'kanyakumari': { lat: 8.0883, lon: 77.5385 },
  'karur': { lat: 10.9601, lon: 78.0766 },
  'krishnagiri': { lat: 12.5186, lon: 78.2137 },
  'madurai': { lat: 9.9252, lon: 78.1198 },
  'mayiladuthurai': { lat: 11.1075, lon: 79.6524 },
  'nagapattinam': { lat: 10.7656, lon: 79.8424 },
  'namakkal': { lat: 11.2189, lon: 78.1674 },
  'nilgiris': { lat: 11.4102, lon: 76.6950 },
  'perambalur': { lat: 11.2342, lon: 78.8820 },
  'pudukkottai': { lat: 10.3797, lon: 78.8208 },
  'ramanathapuram': { lat: 9.3639, lon: 78.8395 },
  'ranipet': { lat: 12.9224, lon: 79.3326 },
  'salem': { lat: 11.6643, lon: 78.1460 },
  'sivaganga': { lat: 9.8433, lon: 78.4809 },
  'tenkasi': { lat: 8.9594, lon: 77.3161 },
  'thanjavur': { lat: 10.7870, lon: 79.1378 },
  'theni': { lat: 10.0104, lon: 77.4768 },
  'thoothukudi': { lat: 8.7642, lon: 78.1348 },
  'tiruchirappalli': { lat: 10.7905, lon: 78.7047 },
  'thiruchirappalli': { lat: 10.7905, lon: 78.7047 },
  'tirunelveli': { lat: 8.7139, lon: 77.7567 },
  'tirupathur': { lat: 12.4925, lon: 78.5678 },
  'tiruppur': { lat: 11.1085, lon: 77.3411 },
  'tiruvallur': { lat: 13.1432, lon: 79.9083 },
  'tiruvannamalai': { lat: 12.2253, lon: 79.0747 },
  'tiruvarur': { lat: 10.7725, lon: 79.6365 },
  'vellore': { lat: 12.9165, lon: 79.1325 },
  'viluppuram': { lat: 11.9401, lon: 79.4861 },
  'virudhunagar': { lat: 9.5680, lon: 77.9624 }
};

// 1-hour in-memory cache
const weatherCache = new Map();
const WEATHER_CACHE_TTL_MS = 60 * 60 * 1000;

class WeatherService {
  constructor({ timeoutMs = 5000 } = {}) {
    this.timeoutMs = timeoutMs;
  }

  clearCache() {
    weatherCache.clear();
  }

  /**
   * Resolves coordinates from district name or explicit lat/lon.
   */
  _resolveCoordinates(district, lat, lon) {
    if (lat != null && lon != null && !isNaN(Number(lat)) && !isNaN(Number(lon))) {
      return { lat: Number(lat), lon: Number(lon) };
    }
    if (district) {
      const clean = district.trim().toLowerCase();
      if (DISTRICT_COORDINATES[clean]) {
        return DISTRICT_COORDINATES[clean];
      }
    }
    // Default Tamil Nadu central point (Tiruchirappalli)
    return { lat: 10.7905, lon: 78.7047 };
  }

  /**
   * Fetches weather advisory for a given district or coordinates.
   * Grounded in meteorological telemetry from Open-Meteo.
   * If offline or unavailable, returns honest unavailable response.
   */
  async getWeatherAdvisory(district, lat = null, lon = null) {
    const timestamp = new Date().toISOString();
    const coords = this._resolveCoordinates(district, lat, lon);
    const cacheKey = `${coords.lat.toFixed(2)},${coords.lon.toFixed(2)}`;

    const cached = weatherCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      const ageMs = Date.now() - (cached.fetchedAt || Date.now());
      const isStale = ageMs > (30 * 60 * 1000); // Stale if older than 30 mins
      return {
        ...cached.data,
        timestamp,
        from_cache: true,
        cache_age_seconds: Math.round(ageMs / 1000),
        is_stale: isStale
      };
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&current=temperature_2m,precipitation,weather_code&hourly=precipitation_probability`;
      const resp = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);

      if (!resp.ok) {
        throw new Error(`Weather API returned HTTP ${resp.status}`);
      }

      const data = await resp.json();
      const tempC = data.current?.temperature_2m != null ? Math.round(data.current.temperature_2m * 10) / 10 : null;
      const precipMm = Number(data.current?.precipitation || 0);
      const rainProb = Number(data.hourly?.precipitation_probability?.[0] || 0);

      const isInclement = (precipMm > 0.5 || rainProb > 40);

      let condition = 'Clear / Favorable';
      let advisory = 'Favorable weather conditions reported. Unloading and moisture inspection proceeding normally.';
      let warning = null;

      if (precipMm > 1.0 || rainProb > 60) {
        condition = 'Rain / High Moisture Risk';
        advisory = 'Rainfall / elevated moisture forecasted. Please ensure grain is securely covered with tarpaulins during transit.';
        warning = 'High moisture risk: Grain drying may be delayed if exposed to rainfall.';
      } else if (rainProb > 30) {
        condition = 'Partly Cloudy / Minor Precipitation Risk';
        advisory = 'Moderate cloud cover reported with low chance of scattered showers. Keep transport covers ready.';
      }

      const observationTime = data.current?.time ? `${data.current.time}Z` : timestamp;

      const result = {
        available: true,
        condition,
        temperature_c: tempC,
        rain_probability_percent: rainProb,
        precipitation_mm: precipMm,
        is_inclement: isInclement,
        advisory,
        warning,
        observation_time: observationTime,
        source_label: 'Live Open-Meteo Telemetry',
        forecast_source: 'Open-Meteo WMO Numerical Model',
        timestamp,
        is_synthetic: false,
        is_stale: false,
        provider: 'OPEN_METEO_TELEMETRY'
      };

      weatherCache.set(cacheKey, {
        data: result,
        fetchedAt: Date.now(),
        expiresAt: Date.now() + WEATHER_CACHE_TTL_MS
      });
      return result;

    } catch (err) {
      // Strict honest fallback: report unavailable rather than fabricating weather
      return {
        available: false,
        condition: 'Weather Temporarily Unavailable',
        temperature_c: null,
        rain_probability_percent: null,
        precipitation_mm: null,
        is_inclement: false,
        advisory: 'Weather advisory service is temporarily unavailable. Procurement operations continue normally.',
        warning: null,
        observation_time: null,
        source_label: 'Weather Service Offline',
        forecast_source: null,
        timestamp,
        is_synthetic: true,
        is_stale: true,
        provider: 'FALLBACK_OFFLINE',
        error_message: err.name === 'AbortError' ? 'Weather request timed out' : (err.message || 'Offline')
      };
    }
  }
}

// Singleton export
const defaultWeatherService = new WeatherService();

module.exports = {
  WeatherService,
  defaultWeatherService
};
