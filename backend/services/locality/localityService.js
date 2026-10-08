/**
 * Authoritative Locality Service
 * Provides local database-backed geographic master resolution for Tamil Nadu.
 * 
 * Rules:
 * 1. ZERO runtime external web requests: ground truth is PostgreSQL master tables.
 * 2. Strict district containment: a locality MUST belong to the farmer's district.
 * 3. Exact spatial calculations using Haversine formula (km).
 */

// Haversine formula for exact distance between two coordinates in kilometers
function haversineDistanceKm(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return null;
  const numLat1 = Number(lat1);
  const numLon1 = Number(lon1);
  const numLat2 = Number(lat2);
  const numLon2 = Number(lon2);
  if (isNaN(numLat1) || isNaN(numLon1) || isNaN(numLat2) || isNaN(numLon2)) return null;

  const R = 6371; // Earth radius in km
  const dLat = (numLat2 - numLat1) * Math.PI / 180;
  const dLon = (numLon2 - numLon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(numLat1 * Math.PI / 180) * Math.cos(numLat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((R * c).toFixed(2));
}

class LocalityService {
  constructor({ pool }) {
    this.pool = pool;
  }

  /**
   * Get all active districts
   */
  async getDistricts() {
    const res = await this.pool.query(`
      SELECT DISTINCT district 
      FROM localities 
      WHERE district IS NOT NULL 
      ORDER BY district ASC
    `);
    return res.rows.map(r => r.district);
  }

  /**
   * Get taluks for a specific district
   */
  async getTaluks(district) {
    if (!district) return [];
    const res = await this.pool.query(`
      SELECT taluk_id, taluk_name 
      FROM taluks 
      WHERE LOWER(district) = LOWER($1)
      ORDER BY taluk_name ASC
    `, [district.trim()]);
    return res.rows;
  }

  /**
   * Get localities for a district and optional taluk
   */
  async getLocalities({ district, taluk = null, search = null, limit = 100 }) {
    if (!district) return [];
    let query = `
      SELECT locality_id, district, taluk_name, locality_name, type, latitude, longitude
      FROM localities
      WHERE LOWER(district) = LOWER($1) AND status = 'ACTIVE'
    `;
    const params = [district.trim()];
    let pIdx = 2;

    if (taluk) {
      query += ` AND LOWER(taluk_name) = LOWER($${pIdx++})`;
      params.push(taluk.trim());
    }

    if (search && search.trim().length > 0) {
      query += ` AND locality_name ILIKE $${pIdx++}`;
      params.push(`%${search.trim()}%`);
    }

    query += ` ORDER BY locality_name ASC LIMIT $${pIdx}`;
    params.push(limit);

    const res = await this.pool.query(query, params);
    return res.rows;
  }

  /**
   * Validate that a locality strictly belongs to the specified district
   */
  async validateLocalityDistrict(district, localityIdentifier) {
    if (!district || !localityIdentifier) return { valid: false, error: 'Missing district or locality' };

    const cleanDist = district.trim().toLowerCase();
    const cleanLoc = String(localityIdentifier).trim();

    const res = await this.pool.query(`
      SELECT locality_id, district, taluk_name, locality_name, latitude, longitude
      FROM localities
      WHERE (locality_id = $1 OR LOWER(locality_name) = LOWER($1))
      LIMIT 1
    `, [cleanLoc]);

    if (res.rows.length === 0) {
      return {
        valid: false,
        error: `Locality '${localityIdentifier}' not found in authoritative master dataset.`
      };
    }

    const matched = res.rows[0];
    if (matched.district.trim().toLowerCase() !== cleanDist) {
      return {
        valid: false,
        error: `Integrity violation: Locality '${matched.locality_name}' belongs to district '${matched.district}', not '${district}'.`,
        matched
      };
    }

    return {
      valid: true,
      locality: matched
    };
  }

  /**
   * Resolve best matching locality from free-text name within district
   */
  async resolveLocality(district, inputName) {
    if (!district || !inputName) return null;
    const cleanInput = String(inputName).trim().toLowerCase();

    // 1. Exact match in district
    const exact = await this.pool.query(`
      SELECT locality_id, district, taluk_name, locality_name, latitude, longitude
      FROM localities
      WHERE LOWER(district) = LOWER($1) AND LOWER(locality_name) = LOWER($2)
      LIMIT 1
    `, [district.trim(), cleanInput]);
    if (exact.rows.length > 0) return exact.rows[0];

    // 2. Substring match
    const sub = await this.pool.query(`
      SELECT locality_id, district, taluk_name, locality_name, latitude, longitude
      FROM localities
      WHERE LOWER(district) = LOWER($1) AND locality_name ILIKE $2
      ORDER BY LENGTH(locality_name) ASC
      LIMIT 1
    `, [district.trim(), `%${cleanInput}%`]);
    if (sub.rows.length > 0) return sub.rows[0];

    return null;
  }
}

module.exports = {
  LocalityService,
  haversineDistanceKm
};
