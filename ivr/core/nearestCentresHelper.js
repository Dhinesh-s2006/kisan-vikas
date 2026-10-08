/**
 * Nearest Centres & Date Window Helper
 * Handles Haversine distance, village matching, operational status filtering,
 * and 7-day calendar window calculation for simplified IVR booking.
 */

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

/**
 * Calculates great-circle distance between two points using the Haversine formula.
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number} distance in kilometers
 */
function haversineDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Generates the valid 7-day booking window starting from today (today + next 6 days).
 * @param {Date} [baseDate]
 * @returns {Array<{ dateStr: string, dayNumber: number, monthName: string, label: string }>}
 */
function getValidBookingDates(baseDate = new Date()) {
  const dates = [];
  const start = new Date(baseDate);
  // Ensure we compare based on local date
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);

    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;
    const dayNumber = d.getDate();
    const monthName = MONTH_NAMES[d.getMonth()];

    dates.push({
      dateStr,
      dayNumber,
      monthName,
      label: `${dayNumber} ${monthName}`
    });
  }
  return dates;
}

/**
 * Validates and converts user day-of-month DTMF input into a valid YYYY-MM-DD date.
 * If input is valid within the 7-day window, returns the date object. Otherwise returns null.
 * @param {string|number} inputDay
 * @param {Date} [baseDate]
 * @returns {{ dateStr: string, label: string } | null}
 */
function resolveDateFromDay(inputDay, baseDate = new Date()) {
  if (!inputDay) return null;
  const dayInt = parseInt(String(inputDay).trim(), 10);
  if (isNaN(dayInt) || dayInt < 1 || dayInt > 31) return null;

  const validDates = getValidBookingDates(baseDate);
  const match = validDates.find(d => d.dayNumber === dayInt);
  if (match) {
    return {
      dateStr: match.dateStr,
      label: match.label
    };
  }
  return null;
}

/**
 * Finds the top 3 nearest operational/open centres for a farmer without inventing synthetic data.
 * Rules:
 * 1. Filter only open/operational centres (not 'Closed' or 'Retired').
 * 2. If farmer coordinates and centre coordinates exist, sort by real Haversine distance.
 * 3. If farmer coordinates are missing, match village/town first, then sort by capacity/name.
 * 4. Return at most 3 centres.
 * 
 * @param {object} farmer
 * @param {Array<object>} centres
 * @returns {Array<object>} Up to 3 nearest operational centres
 */
function findNearestCentres(farmer, centres = []) {
  if (!centres || centres.length === 0) return [];

  // Filter only operational/open centres
  const operationalCentres = centres.filter(c => {
    const status = (c.operational_status || '').toLowerCase();
    return status !== 'closed' && status !== 'retired';
  });

  if (operationalCentres.length === 0) return [];

  const farmerLat = parseFloat(farmer.latitude);
  const farmerLng = parseFloat(farmer.longitude);
  const hasFarmerCoords = !isNaN(farmerLat) && !isNaN(farmerLng) && (farmerLat !== 0 || farmerLng !== 0);

  const farmerVillage = (farmer.village || '').trim().toLowerCase();

  const scoredCentres = operationalCentres.map(c => {
    const cLat = parseFloat(c.latitude);
    const cLng = parseFloat(c.longitude);
    const hasCentreCoords = !isNaN(cLat) && !isNaN(cLng) && (cLat !== 0 || cLng !== 0);

    let distanceKm = null;
    let matchScore = 0;

    if (hasFarmerCoords && hasCentreCoords) {
      distanceKm = haversineDistanceKm(farmerLat, farmerLng, cLat, cLng);
    }

    if (farmerVillage && c.village_town && c.village_town.trim().toLowerCase() === farmerVillage) {
      matchScore += 100;
    }

    return {
      ...c,
      distanceKm,
      matchScore
    };
  });

  scoredCentres.sort((a, b) => {
    // If both have real distance, sort by distance ascending
    if (a.distanceKm !== null && b.distanceKm !== null) {
      return a.distanceKm - b.distanceKm;
    }
    // If only one has distance, prefer it
    if (a.distanceKm !== null) return -1;
    if (b.distanceKm !== null) return 1;

    // Otherwise sort by village match score descending
    if (b.matchScore !== a.matchScore) {
      return b.matchScore - a.matchScore;
    }

    // Fallback: sort by daily capacity descending, then name
    const capA = a.daily_capacity_slots || 0;
    const capB = b.daily_capacity_slots || 0;
    if (capB !== capA) return capB - capA;

    return (a.centre_name || '').localeCompare(b.centre_name || '');
  });

  return scoredCentres.slice(0, 3);
}

module.exports = {
  haversineDistanceKm,
  getValidBookingDates,
  resolveDateFromDay,
  findNearestCentres
};
