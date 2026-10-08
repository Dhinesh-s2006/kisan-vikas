const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function cleanCentreText(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/\s*(direct\s+paddy\s+procurement\s+centre|direct\s+procurement\s+centre|procurement\s+centre|regulated\s+market|dpc|centre|center)\b/gi, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveCentre(userInput, centres, districtHint = null) {
  const cleanInput = cleanCentreText(userInput);
  if (!cleanInput) return { match: null, status: 'empty' };

  // 1. If districtHint is provided, search within district centres first
  let candidates = centres;
  if (districtHint) {
    const districtCentres = centres.filter(c => c.district && c.district.toLowerCase() === districtHint.toLowerCase());
    if (districtCentres.length > 0) {
      candidates = districtCentres;
    }
  }

  // Exact match on cleaned name or village_town
  let matches = candidates.filter(c => {
    const cn = cleanCentreText(c.centre_name);
    const vt = cleanCentreText(c.village_town);
    return cn === cleanInput || vt === cleanInput;
  });

  // If no exact match, word boundary or substring match
  if (matches.length === 0) {
    matches = candidates.filter(c => {
      const cn = cleanCentreText(c.centre_name);
      if (cn.length >= 3 && cleanInput.includes(cn)) return true;
      if (cleanInput.length >= 3 && cn.includes(cleanInput)) return true;
      return false;
    });
  }

  // If still no match within districtHint, search across all centres in state
  if (matches.length === 0 && districtHint && candidates !== centres) {
    matches = centres.filter(c => {
      const cn = cleanCentreText(c.centre_name);
      const vt = cleanCentreText(c.village_town);
      return cn === cleanInput || vt === cleanInput;
    });
    if (matches.length === 0) {
      matches = centres.filter(c => {
        const cn = cleanCentreText(c.centre_name);
        if (cn.length >= 3 && cleanInput.includes(cn)) return true;
        if (cleanInput.length >= 3 && cn.includes(cleanInput)) return true;
        return false;
      });
    }
  }

  if (matches.length === 1) {
    return { match: matches[0], status: 'single' };
  } else if (matches.length > 1) {
    return { matches, status: 'multiple' };
  } else {
    return { match: null, status: 'none' };
  }
}

async function testResolution() {
  const centresRes = await pool.query(
    "SELECT centre_id, centre_name, village_town, district FROM centres WHERE operational_status != 'Retired'"
  );
  const centres = centresRes.rows;
  console.log(`Loaded ${centres.length} operational centres.\n`);

  const tests = [
    { input: 'Anaicut', district: 'Ariyalur' },
    { input: 'Anaicut DPC', district: 'Vellore' },
    { input: 'I want to book paddy at Anaicut', district: null },
    { input: 'I want to book paddy at Anaicut tomorrow morning', district: 'Ariyalur' },
    { input: 'Aiyyur', district: 'Ariyalur' },
    { input: 'Thirumanur', district: 'Ariyalur' },
    { input: 'Nonexistent DPC', district: 'Ariyalur' }
  ];

  for (const t of tests) {
    console.log(`Input: "${t.input}" (District hint: ${t.district})`);
    const res = resolveCentre(t.input, centres, t.district);
    if (res.status === 'single') {
      console.log(`  -> Matched: [${res.match.centre_id}] "${res.match.centre_name}" (${res.match.district})`);
    } else if (res.status === 'multiple') {
      console.log(`  -> Multiple matches (${res.matches.length}):`, res.matches.map(m => m.centre_name).slice(0, 3));
    } else {
      console.log(`  -> No match found.`);
    }
  }

  await pool.end();
}

testResolution();
