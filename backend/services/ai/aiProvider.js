/**
 * Base AI Provider Interface & Schema Normalizer
 * Standardizes intent extraction and entity recognition for Kisan Queue Voice Agent.
 */

class AIProvider {
  /**
   * @param {Object} config
   * @param {string} config.name - Provider identifier (e.g. 'gemini', 'openai', 'fallback_rules')
   * @param {string} [config.model] - Model name (e.g. 'gemini-2.5-flash-lite', 'gpt-4o-mini')
   * @param {string} [config.apiKey] - Provider API key
   * @param {string} [config.baseUrl] - Custom base URL
   * @param {number} [config.timeoutMs=8000] - Request timeout in milliseconds
   */
  constructor({ name, model = '', apiKey = '', baseUrl = '', timeoutMs = 8000 } = {}) {
    this.name = name;
    this.model = model;
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Extract intent and entities from farmer query.
   * Must be overridden by subclasses.
   * @param {Object} params
   * @param {string} params.text - The farmer spoken or typed query
   * @param {Array} [params.conversationHistory] - Previous conversation messages [{role, content}]
   * @param {Object} [params.currentDraft] - Current booking draft state
   * @param {Array} [params.availableDistricts] - Valid districts list
   * @param {Array} [params.availableCentres] - Available centres list
   * @returns {Promise<Object>} Normalized intent object
   */
  async extractIntent(params) {
    throw new Error(`extractIntent() not implemented in provider: ${this.name}`);
  }

  /**
   * Generates the system prompt grounding the LLM in Tamil Nadu procurement operations.
   */
  buildSystemPrompt({ availableDistricts = [], availableCentres = [], currentDraft = {}, farmerName = '' } = {}) {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const currentDateStr = `${yyyy}-${mm}-${dd}`;
    const currentYear = yyyy;

    const districtsList = availableDistricts.length > 0
      ? availableDistricts.slice(0, 38).join(', ')
      : 'Thanjavur, Tiruvarur, Nagapattinam, Cuddalore, Madurai, Tiruchirappalli, Salem, Erode, Tirunelveli, Ariyalur';

    const centresSample = availableCentres.length > 0
      ? availableCentres.slice(0, 20).map(c => `${c.centre_name} (ID: ${c.centre_id}, District: ${c.district})`).join('; ')
      : 'Thanjavur Regulated Market (ID: C101), Kumbakonam DPC (ID: C102), Tiruvarur Main DPC (ID: C103), Aiyyur (Ariyalur)';

    return `You are "Kisan Voice Assistant" (உழவர் குரல் உதவியாளர்), an intelligent, courteous agricultural voice assistant for Tamil Nadu Direct Procurement Centres (DPCs).
Your job is to assist farmers in reserving arrival & weighment slots for harvest procurement, checking booking & payment statuses, finding centres, checking queue wait times, and addressing grievances.

Temporal & Calendar Context:
- CURRENT DATE (Today): ${currentDateStr}
- CURRENT YEAR: ${currentYear}

Operational Context:
- Current conversation / draft state: ${JSON.stringify(currentDraft || {})}
- Authenticated Farmer: ${farmerName || 'Verified Farmer'}
- Available Districts: ${districtsList}
- Sample Active Centres: ${centresSample}
- Supported Crops: Paddy (Common), Paddy (Grade A), Maize / Corn, Pulses.
- Standard MSP rate: ₹2,275 / quintal (Paddy Common).
- Slot preferences: Morning (09:00 - 11:00 or 11:00 - 13:00), Afternoon (14:00 - 16:00), Evening (16:00 - 18:00).

Supported Intents:
1. BOOK_SLOT: Reserving a new arrival or weighment slot for harvest procurement.
2. CHECK_BOOKING_STATUS: Checking current queue status, appointment token, or booking progress.
3. FIND_CENTRE: Locating or searching for procurement centres (DPCs) in a district.
4. CHECK_SLOT_AVAILABILITY: Asking about available open slots or dates at a centre.
5. RESCHEDULE_BOOKING: Rescheduling an existing booking to another date or time.
6. CANCEL_BOOKING: Cancelling an active booking or appointment.
7. CHECK_PROCUREMENT_STATUS: Checking if produce was inspected, weighed, or accepted.
8. CHECK_PAYMENT_STATUS: Checking payment status, DBT transfer, or bank disbursement for procured harvest.
9. RAISE_GRIEVANCE: Submitting a complaint, reporting bribery, delays, unfair weighment, or mistreatment.
10. CHECK_GRIEVANCE: Inquiring about the resolution of an existing grievance or complaint.
11. GET_CENTRE_INFORMATION: Inquiring about centre address, operating hours, capacity, or facilities.
12. GET_WAITING_TIME: Asking how long the queue wait time is at a centre.
13. GET_BOOKING_PASS: Requesting booking token pass, QR receipt, or entry gate slip.
14. HELP: Asking for general instructions or what the assistant can do.
15. REPEAT: Asking to repeat the last response.
16. GO_BACK: Asking to return to a previous step or start over.
17. GREETING: Standard greetings (e.g. Vanakkam, Hello).
18. UNKNOWN: Irrelevant or unintelligible utterances.

Date Interpretation Rules:
1. Interpret relative dates such as "today", "tomorrow", "day after tomorrow", and weekdays strictly relative to CURRENT DATE (${currentDateStr}).
2. When a farmer specifies a month and day without a year (e.g., "September 29" or "29 September"), resolve it to the current or next upcoming occurrence in CURRENT YEAR (${currentYear}) relative to CURRENT DATE. NEVER default to a past or historical year (like 2024 or 2023).
3. If the farmer explicitly specifies a year (e.g., "September 29, 2026" or "2027"), preserve that explicitly stated year.
4. Format date and booking_date strictly in ISO YYYY-MM-DD format.

Language & Multilingual Grounding:
- Farmers may speak in Tamil (தமிழ்), English, or mixed Tamil-English (Tanglish).
- Standard Tamil agricultural term mappings:
  * "நெல்" or "நெற்பயிர்" -> crop: "Paddy (Common)"
  * "மக்காச்சோளம்" -> crop: "Maize"
  * "பருப்பு" or "உளுந்து" -> crop: "Pulses"
  * "மூட்டை" or "மூட்டைகள்" -> unit: "bags" (1 bag = 0.5 quintal / 50kg)
  * "டன்" or "டன்கள்" -> unit: "tons" (1 ton = 10 quintals)
  * "குவிண்டால்" -> unit: "quintals"
  * "இன்று" -> today (${currentDateStr})
  * "நாளை" -> tomorrow
  * "நாளை மறுநாள்" -> day after tomorrow
  * "காலை" -> morning
  * "மதியம்" -> afternoon
  * "மாலை" -> evening
  * "நிலை" or "பதிவு நிலை" or "டோக்கன்" -> intent: "CHECK_BOOKING_STATUS"
  * "கொள்முதல் நிலை" -> intent: "CHECK_PROCUREMENT_STATUS"
  * "பணம்" or "பணம் நிலை" or "பணம் வந்துவிட்டதா" -> intent: "CHECK_PAYMENT_STATUS"
  * "புகார்" or "பிரச்சனை" -> intent: "RAISE_GRIEVANCE"
  * "புகார் நிலை" -> intent: "CHECK_GRIEVANCE"
  * "மையம்" or "மையம் எங்கே" -> intent: "FIND_CENTRE"
  * "நேரம்" or "காத்திருக்கும் நேரம்" -> intent: "GET_WAITING_TIME"
  * "பாஸ்" or "அனுமதி சீட்டு" -> intent: "GET_BOOKING_PASS"
  * "உதவி" -> intent: "HELP"
  * "ரத்து" -> intent: "CANCEL_BOOKING"
  * "மாற்று" or "தேதி மாற்று" -> intent: "RESCHEDULE_BOOKING"
- Standardize all extracted entities to standard English values (e.g. crop "Paddy (Common)").
- In assistant_reply: If the farmer spoke primarily in Tamil, provide a courteous Tamil reply suitable for voice text-to-speech. If in English, reply in English.

STRICT INSTRUCTIONS:
1. Always extract the structured information the farmer mentions.
2. Return ONLY a valid JSON object matching the required schema. Do not add markdown backticks or explanations outside the JSON.
3. Be conversational, polite, clear, and reassuring in assistant_reply. Provide short answers ideal for text-to-speech reading.
4. If details are missing, politely ask for the next required piece of information.
5. Never invent or hallucinate slot IDs, booking numbers, or dates that the farmer did not mention.
6. Retain existing details from conversation state if the farmer did not change them.`;
  }

  /**
   * Normalized schema definition required from all providers.
   */
  getSchemaInstruction() {
    return `Output MUST strictly adhere to this JSON format:
{
  "intent": "BOOK_SLOT" | "CHECK_BOOKING_STATUS" | "FIND_CENTRE" | "CHECK_SLOT_AVAILABILITY" | "RESCHEDULE_BOOKING" | "CANCEL_BOOKING" | "CHECK_PROCUREMENT_STATUS" | "CHECK_PAYMENT_STATUS" | "RAISE_GRIEVANCE" | "CHECK_GRIEVANCE" | "GET_CENTRE_INFORMATION" | "GET_WAITING_TIME" | "GET_BOOKING_PASS" | "HELP" | "REPEAT" | "GO_BACK" | "GREETING" | "UNKNOWN",
  "entities": {
    "farmer": string | null,
    "crop": string | null,
    "quantity": number | null,
    "quantity_quintals": number | null,
    "unit": "quintals" | "bags" | "tons" | "kg" | string | null,
    "district": string | null,
    "centre": string | null,
    "centre_id": string | null,
    "centre_name": string | null,
    "date": string | null,
    "booking_date": string | null,
    "time": string | null,
    "time_preference": "morning" | "afternoon" | "evening" | string | null,
    "slot_id": string | null,
    "booking_id": string | null,
    "grievance": string | null,
    "language": "ta" | "en" | string | null
  },
  "assistant_reply": string,
  "confidence": number
}`;
  }

  /**
   * Normalizes raw LLM output or rule result to ensure consistent contract.
   * @param {Object} raw
   * @param {Object} currentDraft
   * @returns {Object}
   */
  normalizeResult(raw, currentDraft = {}) {
    const validIntents = [
      'BOOK_SLOT',
      'CHECK_BOOKING_STATUS',
      'QUERY_STATUS',
      'FIND_CENTRE',
      'CHECK_SLOT_AVAILABILITY',
      'RESCHEDULE_BOOKING',
      'CANCEL_BOOKING',
      'CANCEL',
      'CHECK_PROCUREMENT_STATUS',
      'CHECK_PAYMENT_STATUS',
      'RAISE_GRIEVANCE',
      'CHECK_GRIEVANCE',
      'GET_CENTRE_INFORMATION',
      'GET_WAITING_TIME',
      'GET_BOOKING_PASS',
      'HELP',
      'REPEAT',
      'GO_BACK',
      'GREETING',
      'CHANGE_DATE',
      'CHANGE_CENTRE',
      'CHANGE_SLOT',
      'UNKNOWN'
    ];

    let intent = validIntents.includes(raw?.intent) ? raw.intent : 'BOOK_SLOT';
    // Backwards-compatible canonicalization
    if (intent === 'CANCEL') {
      intent = 'CANCEL_BOOKING';
    }

    // Harmonize quantity and unit:
    const unit = raw?.entities?.unit || currentDraft?.unit || 'quintals';
    let rawQty = (raw?.entities?.quantity !== undefined && raw?.entities?.quantity !== null)
      ? Number(raw.entities.quantity)
      : ((raw?.entities?.quantity_quintals !== undefined && raw?.entities?.quantity_quintals !== null)
          ? Number(raw.entities.quantity_quintals)
          : (currentDraft?.quantity !== undefined && currentDraft?.quantity !== null
              ? Number(currentDraft.quantity)
              : (currentDraft?.quantity_quintals ? Number(currentDraft.quantity_quintals) : null)));

    if (isNaN(rawQty)) rawQty = null;

    let quantityQuintals = rawQty;
    if (rawQty !== null && !isNaN(rawQty)) {
      const lowerUnit = String(unit).toLowerCase();
      if (lowerUnit.includes('bag') || lowerUnit.includes('மூட்டை')) {
        quantityQuintals = rawQty * 0.5;
      } else if (lowerUnit.includes('ton') || lowerUnit.includes('டன்')) {
        quantityQuintals = rawQty * 10;
      }
    }

    const centreValue = raw?.entities?.centre || raw?.entities?.centre_name || currentDraft?.centre || currentDraft?.centre_name || null;
    const dateValue = raw?.entities?.date || raw?.entities?.booking_date || currentDraft?.date || currentDraft?.booking_date || null;
    const timeValue = raw?.entities?.time || raw?.entities?.time_preference || currentDraft?.time || currentDraft?.time_preference || null;

    const entities = {
      // 1. Farmer
      farmer: raw?.entities?.farmer || currentDraft?.farmer || null,

      // 2. Crop
      crop: raw?.entities?.crop || currentDraft?.crop || 'Paddy (Common)',

      // 3. Quantity & Unit
      quantity: rawQty,
      quantity_quintals: quantityQuintals,
      unit: unit,

      // 4. District
      district: raw?.entities?.district || currentDraft?.district || null,

      // 5. Centre
      centre: centreValue,
      centre_id: raw?.entities?.centre_id || currentDraft?.centre_id || null,
      centre_name: centreValue,

      // 6. Date
      date: dateValue,
      booking_date: dateValue,

      // 7. Time
      time: timeValue,
      time_preference: timeValue,
      slot_id: raw?.entities?.slot_id || currentDraft?.slot_id || null,

      // 8. Booking ID
      booking_id: raw?.entities?.booking_id || currentDraft?.booking_id || null,

      // 9. Grievance
      grievance: raw?.entities?.grievance || currentDraft?.grievance || null,

      // 10. Language
      language: raw?.entities?.language || currentDraft?.language || 'en'
    };

    // Calculate missing fields according to intent
    const missing_fields = [];
    let suggested_actions = raw?.suggested_actions || [];

    if (intent === 'BOOK_SLOT') {
      if (!entities.district) missing_fields.push('district');
      if (!entities.centre_id && !entities.centre_name) missing_fields.push('centre');
      if (!entities.booking_date) missing_fields.push('booking_date');
      if (!entities.crop) missing_fields.push('crop');
      if (!entities.quantity_quintals || entities.quantity_quintals <= 0) missing_fields.push('quantity_quintals');
      if (!entities.slot_id) missing_fields.push('slot_id');

      if (suggested_actions.length === 0) {
        if (missing_fields.length === 0) {
          suggested_actions = ['Confirm Booking', 'Change Slot', 'Start Over'];
        } else if (missing_fields.includes('district')) {
          suggested_actions = ['Thanjavur', 'Ariyalur', 'Tiruvarur', 'Cuddalore'];
        } else if (missing_fields.includes('centre')) {
          suggested_actions = ['Find Nearest Centre', 'Change District'];
        } else if (missing_fields.includes('booking_date')) {
          suggested_actions = ['Tomorrow', 'Day After Tomorrow', 'Pick Date'];
        } else if (missing_fields.includes('quantity_quintals')) {
          suggested_actions = ['10 Quintals', '20 Quintals', '50 Quintals'];
        } else if (missing_fields.includes('slot_id')) {
          suggested_actions = ['Morning Slot', 'Afternoon Slot'];
        }
      }
    } else if (intent === 'FIND_CENTRE' || intent === 'GET_CENTRE_INFORMATION') {
      if (!entities.district) missing_fields.push('district');
      if (suggested_actions.length === 0) {
        suggested_actions = ['Thanjavur', 'Ariyalur', 'Tiruvarur', 'Nagapattinam'];
      }
    } else if (intent === 'CHECK_BOOKING_STATUS' || intent === 'GET_BOOKING_PASS') {
      if (suggested_actions.length === 0) {
        suggested_actions = ['Check Queue', 'Download Pass', 'Book a Slot'];
      }
    } else if (intent === 'CHECK_PAYMENT_STATUS') {
      if (suggested_actions.length === 0) {
        suggested_actions = ['Check Booking Status', 'Book a Slot', 'Help'];
      }
    } else if (intent === 'CHECK_PROCUREMENT_STATUS') {
      if (suggested_actions.length === 0) {
        suggested_actions = ['Check Payment', 'Booking Pass', 'Help'];
      }
    } else if (intent === 'GET_WAITING_TIME') {
      if (suggested_actions.length === 0) {
        suggested_actions = ['Check Slot Availability', 'Find Centre', 'Book a Slot'];
      }
    } else if (intent === 'RAISE_GRIEVANCE') {
      if (!entities.grievance) missing_fields.push('grievance');
      if (suggested_actions.length === 0) {
        suggested_actions = ['Delay in Weighment', 'Payment Delay', 'Centre Staff Issue'];
      }
    } else if (intent === 'CHECK_GRIEVANCE') {
      if (suggested_actions.length === 0) {
        suggested_actions = ['Raise Grievance', 'Check Booking Status', 'Help'];
      }
    } else if (intent === 'RESCHEDULE_BOOKING') {
      if (suggested_actions.length === 0) {
        suggested_actions = ['Tomorrow', 'Day After Tomorrow', 'Pick New Date'];
      }
    } else if (intent === 'CANCEL_BOOKING') {
      if (suggested_actions.length === 0) {
        suggested_actions = ['Confirm Cancellation', 'Keep My Booking'];
      }
    } else if (intent === 'HELP') {
      if (suggested_actions.length === 0) {
        suggested_actions = ['Book a Slot', 'Check Booking Status', 'Find Centre', 'Payment Status'];
      }
    }

    return {
      intent,
      entities,
      missing_fields,
      assistant_reply: raw?.assistant_reply || 'Vanakkam! How can I help you with your procurement booking today?',
      suggested_actions,
      confidence: typeof raw?.confidence === 'number' ? raw.confidence : 0.9,
      provider_used: this.name,
      model_used: this.model || 'rule-engine'
    };
  }
}

module.exports = AIProvider;
