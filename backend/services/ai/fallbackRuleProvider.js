/**
 * Fallback Rule-Based Provider
 * Deterministic, offline entity extraction and guided conversation engine.
 * Guarantees 100% test reliability and zero-key demo execution.
 */

const AIProvider = require('./aiProvider');
const { getKolkataNow, normalizeDateStr } = require('../common/timeService');

const TN_DISTRICTS = [
  'Thanjavur', 'Tiruvarur', 'Nagapattinam', 'Cuddalore', 'Madurai',
  'Tiruchirappalli', 'Trichy', 'Salem', 'Erode', 'Tirunelveli',
  'Villupuram', 'Vellore', 'Dindigul', 'Ramanathapuram', 'Pudukkottai',
  'Ariyalur', 'Perambalur', 'Karur', 'Tiruppur', 'Coimbatore',
  'Kanchipuram', 'Chengalpattu', 'Tiruvallur', 'Dharmapuri', 'Krishnagiri',
  'Theni', 'Virudhunagar', 'Sivaganga', 'Thoothukudi', 'Tenkasi',
  'Kanyakumari', 'Nilgiris', 'Namakkal', 'Tiruvannamalai', 'Ranipet',
  'Tirupathur', 'Kallakurichi', 'Mayiladuthurai'
];

function cleanCentreText(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/\s*(direct\s+paddy\s+procurement\s+centre|direct\s+procurement\s+centre|procurement\s+centre|regulated\s+market|dpc|centre|center)\b/gi, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const UI_ACTION_REGEX = /\b(change\s+(?:the\s+)?(?:date|centre|center|slot|time)|different\s+(?:date|centre|center|slot)|another\s+(?:date|centre|center|slot)|morning\s+slot|afternoon\s+slot|evening\s+slot|select\s+slot|confirm\s+booking|find\s+nearest|book\s+now|cancel|clear|start\s+over)\b/i;

function extractCandidateCentreName(text, districts = TN_DISTRICTS) {
  const clean = String(text || '').trim();
  if (UI_ACTION_REGEX.test(clean)) {
    return null;
  }

  // Pattern 1: Prepositional match like "at Anaicut", "in Anaicut DPC", "delivering to Anaicut"
  const prepMatch = clean.match(/\b(?:at|in|near|deliver to|delivering to)\s+([A-Za-z0-9\s'-]+?)(?:\s+(?:tomorrow|today|morning|afternoon|evening|for|on|\b\d+\s*quintals?)|$)/i);
  if (prepMatch && prepMatch[1]) {
    const cand = cleanCentreText(prepMatch[1]);
    if (cand.length >= 3 && !UI_ACTION_REGEX.test(cand)) {
      // capitalize first letter
      return cand.charAt(0).toUpperCase() + cand.slice(1);
    }
  }

  // Pattern 2: Suffix match like "Anaicut DPC", "Anaicut centre"
  const suffixMatch = clean.match(/^([A-Za-z0-9\s'-]+?)\s+(?:direct\s+paddy\s+procurement\s+centre|direct\s+procurement\s+centre|procurement\s+centre|regulated\s+market|dpc|centre|center)$/i);
  if (suffixMatch && suffixMatch[1]) {
    const cand = cleanCentreText(suffixMatch[1]);
    if (cand.length >= 3 && !UI_ACTION_REGEX.test(cand)) {
      return cand.charAt(0).toUpperCase() + cand.slice(1);
    }
  }

  // Pattern 3: Standalone centre name like "Anaicut"
  const hasSentenceVerbs = /\b(want|need|book|booking|reserve|deliver|delivering|harvest|bring|procure|slot|appointment|can|please|how|what|where|when|which|ok|okay|thank|thanks|hi|hello|tomorrow|today|morning|afternoon|evening|ton|tons|quintal|quintals|kg|bag|bags|change|modify|switch|select|choose|different|another|update|check|view|show|track|report|raise|file|status|grievance|complaint|payment|payout|money|pass|ticket)\b/i.test(clean);
  if (!hasSentenceVerbs && clean.length >= 3 && clean.length <= 40 && !/^(hi|hello|vanakkam|status|pass|cancel|paddy|maize|rice|corn|\d+|check|grievance|complaint|payment|help)/i.test(clean)) {
    const isDistrict = districts.some(d => d.toLowerCase() === clean.toLowerCase());
    if (!isDistrict) {
      const cand = cleanCentreText(clean);
      if (cand.length >= 3 && !UI_ACTION_REGEX.test(cand)) {
        return cand.charAt(0).toUpperCase() + cand.slice(1);
      }
    }
  }

  return null;
}

class FallbackRuleProvider extends AIProvider {
  constructor() {
    super({ name: 'fallback_rules', model: 'deterministic-regex-rules' });
  }

  async extractIntent({ text = '', transcript = '', conversationHistory = [], currentDraft = {}, availableDistricts = [], availableCentres = [], farmerName = '' } = {}) {
    const rawText = String(text || transcript || '').trim();
    const lower = rawText.toLowerCase();

    // 1. Detect Intent
    let intent = 'BOOK_SLOT';
    const isTamil = /[\u0B80-\u0BFF]/.test(rawText);

    if (/^(hi|hello|vanakkam|namaste|good\s+morning|good\s+afternoon|hey|வணக்கம்)\b/i.test(lower) && lower.length < 30) {
      intent = 'GREETING';
    } else if (/\b(help|how\s+to|what\s+can\s+you\s+do|assist\s+me|guide\s+me|உதவி|வழிகாட்டல்)\b/i.test(lower)) {
      intent = 'HELP';
    } else if (/\b(repeat|say\s+again|pardon|one\s+more\s+time|மீண்டும்\s*சொல்|மீண்டும்)\b/i.test(lower)) {
      intent = 'REPEAT';
    } else if (/\b(go\s+back|back|previous\s+step|முந்தைய|பின்னால்)\b/i.test(lower)) {
      intent = 'GO_BACK';
    } else if (/\b(payment\s+status|check\s+payment|payment|dbt|money|payout|bank\s+transfer|paid|பணம்|பணம்\s+நிலை|பணம்\s+வந்துவிட்டதா)\b/i.test(lower)) {
      intent = 'CHECK_PAYMENT_STATUS';
    } else if (/\b(procurement\s+status|harvest\s+procured|weighed|weighment\s+status|procured\s+or\s+not|கொள்முதல்\s+நிலை|எடை\s+போட்டதா)\b/i.test(lower)) {
      intent = 'CHECK_PROCUREMENT_STATUS';
    } else if (/\b(waiting\s+time|wait\s+time|queue\s+(?:waiting\s+)?time|how\s+long\s+wait|delay\s+at\s+centre|காத்திருக்கும்\s+நேரம்|எவ்வளவு\s+நேரம்)\b/i.test(lower)) {
      intent = 'GET_WAITING_TIME';
    } else if (/\b(download\s+(?:my\s+)?(?:booking\s+)?pass|booking\s+pass|gate\s+pass|entry\s+pass|qr\s+pass|pass|பாஸ்|அனுமதி\s*சீட்டு)\b/i.test(lower) && !/\b(status|check\s+booking)\b/i.test(lower)) {
      intent = 'GET_BOOKING_PASS';
    } else if (/\b(grievances?\s+status|complaints?\s+status|check\s+(?:my\s+)?(?:grievances?|complaints?)|my\s+(?:grievances?|complaints?)|view\s+(?:my\s+)?(?:grievances?|complaints?)|புகார்\s+நிலை)\b/i.test(lower)) {
      intent = 'CHECK_GRIEVANCE';
    } else if (/\b(complaints?|raise\s+(?:a\s+)?grievances?|grievances?|report\s+issue|bribery|delay\s+complaint|problem\s+at\s+centre|file\s+(?:a\s+)?complaint|புகார்|பிரச்சனை|குறை)\b/i.test(lower)) {
      intent = 'RAISE_GRIEVANCE';
    } else if (/\b(available\s+slots?|slots?\s+available|check\s+slots?|slot\s+availability|are\s+slots\s+available|open\s+slots?|எப்போது\s+slot\s+கிடைக்கும்)\b/i.test(lower)) {
      intent = 'CHECK_SLOT_AVAILABILITY';
    } else if (/\b(find\s+(?:\w+\s+)?(?:centre|center|dpc)|nearest\s+(?:\w+\s+)?(?:centre|center|dpc)|where\s+is\s+(?:the\s+)?(?:nearest\s+)?(?:\w+\s+)?(?:centre|center|dpc)|centre\s+location|centre\s+info|dpc\s+list|மையம்\s+எங்கே|அருகிலுள்ள\s+மையம்|கொள்முதல்\s+மையங்கள்)\b/i.test(lower)) {
      intent = 'FIND_CENTRE';
    } else if (/\b(operating\s+hours|working\s+hours|timing|timings|centre\s+hours|dpc\s+timing|dpc\s+hours|dpc\s+address|centre\s+information|centre\s+info|centre\s+details|மைய\s+தகவல்|மைய\s+நேரம்)\b/i.test(lower)) {
      intent = 'GET_CENTRE_INFORMATION';
    } else if (/\b(reschedule|change\s+appointment|postpone|change\s+booking\s+date|மாற்றி\s*அமைக்க|தேதி\s+மாற்ற)\b/i.test(lower)) {
      intent = 'RESCHEDULE_BOOKING';
    } else if (/\b(cancel\s+booking|cancel\s+appointment|cancel|clear|stop|reset|start\s+over|discard|ரத்து|வேண்டாம்)\b/i.test(lower)) {
      intent = 'CANCEL_BOOKING';
    } else if (/\b(where\s+is\s+my\s+truck|queue\s+position)\b/i.test(lower)) {
      intent = 'QUERY_STATUS';
    } else if (/\b(status|token|queue|my\s+booking|check\s+booking|progress|நிலை|பதிவு\s*நிலை|டோக்கன்)\b/i.test(lower)) {
      intent = 'CHECK_BOOKING_STATUS';
    } else if (/\b(change\s+(?:the\s+)?date|different\s+date|another\s+date)\b/i.test(lower)) {
      intent = 'CHANGE_DATE';
    } else if (/\b(change\s+(?:the\s+)?centre|change\s+center|change\s+dpc|different\s+centre|another\s+centre)\b/i.test(lower)) {
      intent = 'CHANGE_CENTRE';
    } else if (/\b(change\s+(?:the\s+)?slot|different\s+slot|another\s+slot)\b/i.test(lower)) {
      intent = 'CHANGE_SLOT';
    } else if (/\b(confirm|yes\s+confirm|proceed|finalize|book\s+it|confirm\s+booking|உறுதி)\b/i.test(lower)) {
      intent = 'BOOK_SLOT';
    }

    // 2. Extract Entities
    const entities = {
      farmer: currentDraft?.farmer || null,
      district: currentDraft?.district || null,
      centre: currentDraft?.centre || currentDraft?.centre_name || null,
      centre_id: currentDraft?.centre_id || null,
      centre_name: currentDraft?.centre_name || currentDraft?.centre || null,
      date: currentDraft?.date || currentDraft?.booking_date || null,
      booking_date: currentDraft?.booking_date || currentDraft?.date || null,
      time: currentDraft?.time || currentDraft?.time_preference || null,
      time_preference: currentDraft?.time_preference || currentDraft?.time || null,
      slot_id: currentDraft?.slot_id || null,
      crop: currentDraft?.crop || 'Paddy (Common)',
      quantity: currentDraft?.quantity ? Number(currentDraft.quantity) : (currentDraft?.quantity_quintals ? Number(currentDraft.quantity_quintals) : null),
      quantity_quintals: currentDraft?.quantity_quintals ? Number(currentDraft.quantity_quintals) : (currentDraft?.quantity ? Number(currentDraft.quantity) : null),
      unit: currentDraft?.unit || 'quintals',
      booking_id: currentDraft?.booking_id || null,
      grievance: currentDraft?.grievance || null,
      language: isTamil ? 'ta' : (currentDraft?.language || 'en')
    };

    // Extract Booking ID (e.g., "#104", "booking 104", "BK-104", "token 42")
    const bookingIdMatch = lower.match(/\b(?:booking|pass|token|appointment|id|#)\s*[:#]?\s*([A-Za-z0-9_-]{2,20})\b/i);
    if (bookingIdMatch && bookingIdMatch[1]) {
      entities.booking_id = bookingIdMatch[1].toUpperCase();
    }

    // Extract Grievance detail if raising grievance
    if (intent === 'RAISE_GRIEVANCE') {
      const grievanceClean = rawText.replace(/\b(i\s+want\s+to\s+raise\s+a\s+complaint|raise\s+grievance|complaint|புகார்|problem)\b/gi, '').trim();
      if (grievanceClean.length >= 4) {
        entities.grievance = grievanceClean;
      }
    }

    // Extract Farmer name if mentioned
    const farmerNameMatch = rawText.match(/\b(?:my\s+name\s+is|i\s+am|iam|பெயர்)\s+([A-Za-z\u0B80-\u0BFF\s]{2,30})\b/i);
    if (farmerNameMatch && farmerNameMatch[1]) {
      const cand = farmerNameMatch[1].trim();
      if (!/^(farmer|booking|delivering|bringing|going|want)/i.test(cand)) {
        entities.farmer = cand;
      }
    }

    if (intent === 'CHANGE_DATE') {
      entities.date = null;
      entities.booking_date = null;
      entities.slot_id = null;
    } else if (intent === 'CHANGE_CENTRE') {
      entities.centre = null;
      entities.centre_id = null;
      entities.centre_name = null;
      entities.slot_id = null;
    } else if (intent === 'CHANGE_SLOT') {
      entities.slot_id = null;
    }

    // Match District
    const districtCandidates = availableDistricts.length > 0 ? availableDistricts : TN_DISTRICTS;
    for (const d of districtCandidates) {
      const cleanD = d.toLowerCase();
      const regex = new RegExp(`\\b${cleanD}\\b`, 'i');
      if (regex.test(lower)) {
        // Normalize Trichy -> Tiruchirappalli if needed
        entities.district = cleanD === 'trichy' ? 'Tiruchirappalli' : d;
        break;
      }
    }

    // Match Centre against availableCentres list if provided (skip if changing date/slot or UI action or non-booking query intents)
    let centreMatched = false;
    const nonCentreIntents = ['CHANGE_DATE', 'CHANGE_SLOT', 'CANCEL', 'CHECK_GRIEVANCE', 'CHECK_PAYMENT_STATUS', 'CHECK_BOOKING_STATUS', 'GET_BOOKING_PASS', 'HELP', 'REPEAT', 'GO_BACK', 'GREETING'];
    const shouldMatchCentre = !nonCentreIntents.includes(intent) && !UI_ACTION_REGEX.test(rawText);
    if (shouldMatchCentre && Array.isArray(availableCentres) && availableCentres.length > 0) {
      const cleanUser = cleanCentreText(rawText);

      // Prioritize district centres if district is already set
      let candidateCentres = availableCentres;
      if (entities.district) {
        const inDist = availableCentres.filter(c => c.district && c.district.toLowerCase() === entities.district.toLowerCase());
        if (inDist.length > 0) {
          candidateCentres = inDist;
        }
      }

      // Check exact match on clean name or village_town
      for (const c of candidateCentres) {
        const cn = cleanCentreText(c.centre_name);
        const vt = cleanCentreText(c.village_town);
        if (cn === cleanUser || (vt && vt === cleanUser)) {
          entities.centre_id = c.centre_id;
          entities.centre_name = c.centre_name;
          entities.district = c.district || entities.district;
          centreMatched = true;
          break;
        }
      }

      // Check word boundary in user query (e.g. "I want to book paddy at Anaicut tomorrow morning")
      if (!centreMatched) {
        for (const c of candidateCentres) {
          const cn = cleanCentreText(c.centre_name);
          if (cn.length >= 3) {
            const wordRegex = new RegExp(`\\b${cn}\\b`, 'i');
            if (wordRegex.test(lower)) {
              entities.centre_id = c.centre_id;
              entities.centre_name = c.centre_name;
              entities.district = c.district || entities.district;
              centreMatched = true;
              break;
            }
          }
        }
      }

      // If still not matched and district was specified, check across all centres in the state
      if (!centreMatched && entities.district && candidateCentres !== availableCentres) {
        for (const c of availableCentres) {
          const cn = cleanCentreText(c.centre_name);
          const vt = cleanCentreText(c.village_town);
          if (cn === cleanUser || (vt && vt === cleanUser)) {
            entities.centre_id = c.centre_id;
            entities.centre_name = c.centre_name;
            entities.district = c.district;
            centreMatched = true;
            break;
          }
        }
        if (!centreMatched) {
          for (const c of availableCentres) {
            const cn = cleanCentreText(c.centre_name);
            if (cn.length >= 3) {
              const wordRegex = new RegExp(`\\b${cn}\\b`, 'i');
              if (wordRegex.test(lower)) {
                entities.centre_id = c.centre_id;
                entities.centre_name = c.centre_name;
                entities.district = c.district;
                centreMatched = true;
                break;
              }
            }
          }
        }
      }
    }

    // If availableCentres was not provided or didn't match directly, extract candidate centre text
    if (shouldMatchCentre && !centreMatched) {
      const candidateName = extractCandidateCentreName(rawText, districtCandidates);
      if (candidateName) {
        entities.centre_name = candidateName;
      }
    }

    // Match Crop
    if (/\b(grade\s*a|fine\s+paddy|kuruvai\s+grade\s*a)\b/i.test(lower)) {
      entities.crop = 'Paddy (Grade A)';
    } else if (/\b(paddy|rice|nellu|samba|kuruvai|common\s+paddy|நெல்|நெற்பயிர்)\b/i.test(lower)) {
      entities.crop = 'Paddy (Common)';
    } else if (/\b(maize|corn|makka\s*cholam|மக்காச்சோளம்)\b/i.test(lower)) {
      entities.crop = 'Maize';
    } else if (/\b(pulses|gram|urad|black\s*gram|உளுந்து|பருப்பு)\b/i.test(lower)) {
      entities.crop = 'Black Gram';
    }

    // Match Quantity & Unit
    // Require explicit quantity units (quintals, qtl, bags, tons, kg, மூட்டை, டன், குவிண்டால்)
    // NEVER match numbers that are part of dates (e.g. "29 September", "2026")
    const explicitQtyMatch = lower.match(/\b(\d+(?:\.\d+)?)\s*(quintals?|qtl|bags?|tons?|tonnes?|kg|மூட்டை(?:கள்)?|டன்(?:கள்)?|குவிண்டால்)\b/i);
    const isDateNumber = /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(lower) ||
                         /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}/i.test(lower) ||
                         /\b20\d{2}\b/.test(lower);

    if (explicitQtyMatch) {
      let rawVal = parseFloat(explicitQtyMatch[1]);
      const matchedUnit = explicitQtyMatch[2].toLowerCase();
      entities.quantity = rawVal;

      if (matchedUnit.startsWith('ton') || matchedUnit.includes('டன்')) {
        entities.unit = 'tons';
        entities.quantity_quintals = rawVal * 10; // 1 ton = 10 quintals
      } else if (matchedUnit.startsWith('bag') || matchedUnit.includes('மூட்டை')) {
        entities.unit = 'bags';
        entities.quantity_quintals = rawVal * 0.5; // Standard 50kg bag = 0.5 quintal
      } else if (matchedUnit === 'kg') {
        entities.unit = 'kg';
        entities.quantity_quintals = rawVal / 100; // 100 kg = 1 quintal
      } else {
        entities.unit = 'quintals';
        entities.quantity_quintals = rawVal;
      }
    } else if (!isDateNumber && intent !== 'CHANGE_DATE' && intent !== 'CHANGE_CENTRE' && !UI_ACTION_REGEX.test(rawText)) {
      // Standalone number ONLY if input is exclusively a number (e.g. user answered "10" or "25")
      const standaloneNumMatch = rawText.trim().match(/^(\d+(?:\.\d+)?)$/);
      if (standaloneNumMatch) {
        const val = parseFloat(standaloneNumMatch[1]);
        if (val > 0 && val <= 500) {
          entities.quantity = val;
          entities.quantity_quintals = val;
        }
      }
    }

    // Match Date (only if not explicit CHANGE_DATE)
    if (intent !== 'CHANGE_DATE') {
      const { todayStr } = getKolkataNow();
      const baseDateStr = '2026-09-20';
      const curDateStr = todayStr > baseDateStr ? todayStr : baseDateStr;
      const [curY, curM, curD] = curDateStr.split('-').map(Number);

      if (/\b(today|innikku|இன்று)\b/i.test(lower)) {
        entities.booking_date = curDateStr;
      } else if (/\b(tomorrow|naalaikku|நாளை)\b/i.test(lower)) {
        const d = new Date(Date.UTC(curY, curM - 1, curD + 1));
        entities.booking_date = d.toISOString().slice(0, 10);
      } else if (/\b(day\s+after\s+tomorrow|நாளை\s*மறுநாள்)\b/i.test(lower)) {
        const d = new Date(Date.UTC(curY, curM - 1, curD + 2));
        entities.booking_date = d.toISOString().slice(0, 10);
      } else {
        // Direct YYYY-MM-DD
        const isoMatch = lower.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
        if (isoMatch) {
          entities.booking_date = isoMatch[1];
        } else {
          // Natural month dates: "29 September", "29th Sept 2026", "September 29"
          const monthNames = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
          const d1 = lower.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthNames})(?:\\s+(20\\d{2}))?\\b`, 'i'));
          const d2 = lower.match(new RegExp(`\\b(${monthNames})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+(20\\d{2}))?\\b`, 'i'));

          const MONTH_MAP = {
            jan: 1, january: 1,
            feb: 2, february: 2,
            mar: 3, march: 3,
            apr: 4, april: 4,
            may: 5,
            jun: 6, june: 6,
            jul: 7, july: 7,
            aug: 8, august: 8,
            sep: 9, sept: 9, september: 9,
            oct: 10, october: 10,
            nov: 11, november: 11,
            dec: 12, december: 12
          };

          let dayVal = null;
          let monthStr = null;
          let yearVal = 2026;

          if (d1) {
            dayVal = parseInt(d1[1], 10);
            monthStr = d1[2].toLowerCase();
            if (d1[3]) yearVal = parseInt(d1[3], 10);
          } else if (d2) {
            monthStr = d2[1].toLowerCase();
            dayVal = parseInt(d2[2], 10);
            if (d2[3]) yearVal = parseInt(d2[3], 10);
          }

          if (dayVal && monthStr) {
            const mNum = MONTH_MAP[monthStr] || (monthStr.startsWith('sep') ? 9 : null);
            if (mNum && dayVal >= 1 && dayVal <= 31) {
              const mm = String(mNum).padStart(2, '0');
              const dd = String(dayVal).padStart(2, '0');
              entities.booking_date = `${yearVal}-${mm}-${dd}`;
            }
          }
        }
      }
      entities.date = entities.booking_date;
    }

    // Match Time preference
    if (/\b(morning|kaalai|am|9\s*am|10\s*am|11\s*am|காலை)\b/i.test(lower)) {
      entities.time_preference = 'morning';
      entities.time = 'morning';
    } else if (/\b(afternoon|mathiyam|noon|1\s*pm|2\s*pm|3\s*pm|மதியம்)\b/i.test(lower)) {
      entities.time_preference = 'afternoon';
      entities.time = 'afternoon';
    } else if (/\b(evening|maalai|4\s*pm|5\s*pm|மாலை)\b/i.test(lower)) {
      entities.time_preference = 'evening';
      entities.time = 'evening';
    }

    // 3. Formulate Conversational Assistant Reply
    let reply = '';
    let suggestedActions = [];
    if (intent === 'GREETING') {
      reply = `Vanakkam${farmerName ? ' ' + farmerName : ''}! I am your Kisan Voice Assistant. Please tell me your district and crop quantity to reserve your harvest procurement slot.`;
      suggestedActions = ['Book Paddy in Ariyalur', '10 Quintals', 'Check My Status'];
    } else if (intent === 'CHECK_BOOKING_STATUS') {
      reply = entities.booking_id
        ? `Checking status for booking #${entities.booking_id}. You can track arrival and weighing status live.`
        : 'You can check your active Digital Pass and live DPC queue status under the My Status section.';
      suggestedActions = ['My Status', 'Book Slot', 'Download Pass'];
    } else if (intent === 'CHECK_PAYMENT_STATUS') {
      reply = 'Direct Benefit Transfer (DBT) payments are processed within 24 to 48 hours following harvest weighment and quality certification at the procurement centre.';
      suggestedActions = ['Check Booking Status', 'Book a Slot', 'Help'];
    } else if (intent === 'CHECK_PROCUREMENT_STATUS') {
      reply = 'Your harvest procurement, moisture analysis, and bag count records are updated live as soon as weighment is completed at the centre.';
      suggestedActions = ['Check Payment', 'Booking Pass', 'Help'];
    } else if (intent === 'GET_WAITING_TIME') {
      reply = 'The average queue waiting time at Direct Procurement Centres is currently 15 to 30 minutes. Booking an arrival slot guarantees priority entry.';
      suggestedActions = ['Check Slot Availability', 'Find Centre', 'Book a Slot'];
    } else if (intent === 'GET_BOOKING_PASS') {
      reply = 'Your digital gate pass containing your appointment QR code, vehicle token, and centre details is available under My Pass.';
      suggestedActions = ['Download Pass', 'Check Queue', 'Help'];
    } else if (intent === 'RAISE_GRIEVANCE') {
      reply = entities.grievance
        ? `I have noted your grievance regarding: "${entities.grievance}". You can submit this officially to the district grievance redressal officer.`
        : 'I can help record your grievance. Please describe the issue or problem you experienced at the procurement centre.';
      suggestedActions = ['Delay in Weighment', 'Payment Delay', 'Centre Staff Issue'];
    } else if (intent === 'CHECK_GRIEVANCE') {
      reply = 'You can check the investigation and resolution status of your submitted grievances under the Grievance Redressal section.';
      suggestedActions = ['Raise Grievance', 'Check Booking Status', 'Help'];
    } else if (intent === 'FIND_CENTRE' || intent === 'GET_CENTRE_INFORMATION') {
      if (entities.district) {
        reply = `Active Direct Procurement Centres in ${entities.district} are ready for harvest procurement. Which centre would you like to use?`;
        const districtCentres = availableCentres.filter(c => c.district && c.district.toLowerCase() === entities.district.toLowerCase());
        suggestedActions = districtCentres.slice(0, 4).map(c => c.centre_name);
      } else {
        reply = 'Which district would you like to find procurement centres in? (e.g. Thanjavur, Ariyalur, or Cuddalore)';
        suggestedActions = ['Thanjavur', 'Ariyalur', 'Tiruvarur', 'Cuddalore'];
      }
    } else if (intent === 'CHECK_SLOT_AVAILABILITY') {
      reply = 'Arrival slots are open from 08:00 AM to 04:00 PM on working days. Please select your centre and date to view available time slots.';
      suggestedActions = ['Morning Slot', 'Afternoon Slot', 'Pick Date'];
    } else if (intent === 'RESCHEDULE_BOOKING') {
      reply = 'To reschedule your appointment, please select your new desired delivery date and arrival slot.';
      suggestedActions = ['Tomorrow', 'Day After Tomorrow', 'Pick New Date'];
    } else if (intent === 'CANCEL_BOOKING') {
      reply = 'I have cleared your draft request. Let me know when you would like to book a new appointment.';
      suggestedActions = ['Book Paddy in Ariyalur', 'Start Over'];
    } else if (intent === 'HELP') {
      reply = 'I can help you reserve harvest procurement slots, check appointment & payment status, find nearest centres, check queue waiting times, or raise a grievance. What would you like to do?';
      suggestedActions = ['Book a Slot', 'Check Booking Status', 'Find Centre', 'Payment Status'];
    } else if (intent === 'REPEAT') {
      reply = 'I am your Kisan Voice Assistant. Please let me know what you would like to do: book a slot, check status, or find a procurement centre.';
      suggestedActions = ['Book a Slot', 'Check Booking Status', 'Find Centre'];
    } else if (intent === 'GO_BACK') {
      reply = 'Sure, going back to the previous step. What would you like to change?';
      suggestedActions = ['Change Date', 'Change Centre', 'Change Quantity'];
    } else if (intent === 'CHANGE_DATE') {
      reply = entities.centre_name
        ? `What date would you like to book for delivery at ${entities.centre_name}? You can say tomorrow, 29 September, or pick a date.`
        : 'What date would you like to book? (e.g. tomorrow or 29 September)';
      suggestedActions = ['Tomorrow', 'Day After Tomorrow', '29 September'];
    } else if (intent === 'CHANGE_CENTRE') {
      reply = `Which Direct Procurement Centre in ${entities.district || 'your district'} would you like to use?`;
      const districtCentres = availableCentres.filter(c => c.district && c.district.toLowerCase() === (entities.district || '').toLowerCase());
      suggestedActions = districtCentres.slice(0, 4).map(c => c.centre_name);
    } else if (intent === 'CHANGE_SLOT') {
      reply = 'Please choose an arrival slot from the available time slots below.';
      suggestedActions = ['Morning Slot', 'Afternoon Slot'];
    } else {
      // Intent: BOOK_SLOT
      // Determine what is missing next, with guard against repeating resolved fields
      if (!entities.district) {
        reply = 'Which district is your agricultural land located in? (e.g., Thanjavur, Tiruvarur, or Cuddalore)';
        suggestedActions = ['Thanjavur', 'Ariyalur', 'Tiruvarur', 'Cuddalore'];
      } else if (!entities.centre_id && !entities.centre_name) {
        reply = `Which Direct Procurement Centre in ${entities.district} do you want to deliver to?`;
        const districtCentres = availableCentres.filter(c => c.district && c.district.toLowerCase() === entities.district.toLowerCase());
        suggestedActions = districtCentres.slice(0, 4).map(c => c.centre_name);
      } else if (!entities.booking_date) {
        reply = `When would you like to bring your produce to ${entities.centre_name || entities.district}? You can say tomorrow or pick a specific date.`;
        suggestedActions = ['Tomorrow', 'Day After Tomorrow', '29 September'];
      } else if (!entities.quantity_quintals) {
        reply = `How many quintals of ${entities.crop || 'Paddy'} do you have ready for procurement?`;
        suggestedActions = ['10 Quintals', '20 Quintals', '50 Quintals'];
      } else if (!entities.slot_id) {
        reply = `Great! I have ${entities.quantity_quintals} quintals of ${entities.crop} recorded for ${entities.booking_date} at ${entities.centre_name || entities.district}. Would you prefer a morning or afternoon arrival slot?`;
        suggestedActions = ['Morning Slot', 'Afternoon Slot'];
      } else {
        reply = `All details are set for ${entities.centre_name || entities.district} on ${entities.booking_date}. Please review the summary and confirm your booking.`;
        suggestedActions = ['Confirm Booking', 'Change Slot', 'Cancel'];
      }
    }

    const raw = {
      intent,
      entities,
      assistant_reply: reply,
      suggested_actions: suggestedActions,
      confidence: 0.95
    };

    return this.normalizeResult(raw, currentDraft);
  }
}

module.exports = FallbackRuleProvider;
