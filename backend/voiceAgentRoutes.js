/**
 * Voice Agent API Routes
 * Isolated endpoints for conversational procurement slot booking.
 * 
 * Endpoints:
 * - GET  /api/voice-agent/health     (Public: status & configured providers)
 * - POST /api/voice-agent/understand (Authenticated: strictly extracts farmerId from JWT)
 */

const express = require('express');
const { authenticateToken, requireRole } = require('./auth');
const { defaultFactory } = require('./services/ai/providerFactory');
const { defaultSpeechService } = require('./services/speech/speechService');
const { defaultSpeechAdapters } = require('./services/speech/speechAdapters');
const { AIDataGateway } = require('./services/ai/aiDataGateway');
const { BookingRequestService } = require('./services/booking/bookingRequestService');
const { normalizeDateStr } = require('./services/common/timeService');

function isOutOfScope(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.toLowerCase().trim();
  const outOfScopePatterns = [
    /\b(weather|rain|temperature|climate)\b/,
    /\b(capital of|who is the president|who is the prime minister|who won|score of|cricket|ipl|football|match)\b/,
    /\b(python|javascript|code|coding|software|algorithm|compile|debug|programming)\b/,
    /\b(recipe|cook|cooking|movie|cinema|actor|actress|song|lyrics|joke|entertainment)\b/,
    /\b(france|germany|usa|america|russia|china|delhi|mumbai|paris|london)\b/
  ];
  return outOfScopePatterns.some(p => p.test(t));
}

function cleanCentreText(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/\s*(direct\s+paddy\s+procurement\s+centre|direct\s+procurement\s+centre|procurement\s+centre|regulated\s+market|dpc|centre|center)\b/gi, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolves farmer's centre input against live centres from database
 */
function resolveCentreAgainstDb(inputCandidate, centres, districtHint = null) {
  const cleanInput = cleanCentreText(inputCandidate);
  if (!cleanInput || cleanInput.length < 2) return { match: null, status: 'empty' };

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

  // If still no match within districtHint, search across all centres in the state
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

function createVoiceAgentRouter({ pool }) {
  const router = express.Router();
  const aiDataGateway = new AIDataGateway({ pool });
  const bookingRequestService = new BookingRequestService({ pool });

  /**
   * Safe Public Health Status Check
   * Returns active provider configuration status without revealing keys.
   */
  router.get('/health', (req, res) => {
    try {
      const aiHealth = defaultFactory.getHealth();
      const speechHealth = defaultSpeechAdapters.getHealth();

      res.json({
        ...aiHealth,
        status: 'ok',
        service: 'Kisan Voice AI Agent',
        voiceAgent: true,
        speechProvider: 'sarvam',
        speechPrimary: 'sarvam',
        speechFallback: 'bhashini',
        sarvamConfigured: speechHealth.sarvamSTTConfigured,
        bhashiniConfigured: speechHealth.bhashiniSTTConfigured,
        speechConfigured: speechHealth.sarvamSTTConfigured || speechHealth.bhashiniSTTConfigured,
        ttsConfigured: speechHealth.sarvamTTSConfigured,
        speechModel: 'saaras:v3',
        nluProvider: aiHealth.primary?.provider || 'gemini',
        fallbackAvailable: Boolean(aiHealth.offline_fallback?.enabled),
        speech: speechHealth
      });
    } catch (err) {
      res.status(500).json({
        status: 'error',
        message: 'Unable to retrieve AI provider status.',
        details: err.message
      });
    }
  });

  /**
   * Authenticated Text-to-Speech Endpoint (Sarvam TTS)
   */
  router.post('/tts', authenticateToken, async (req, res) => {
    try {
      const { text, language = 'ta-IN' } = req.body || {};
      if (!text) {
        return res.status(400).json({ error: 'missing_text', message: 'Text parameter is required for TTS.' });
      }
      const result = await defaultSpeechAdapters.synthesize({ text, languageCode: language });
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ error: 'tts_failed', message: err.message });
    }
  });

  /**
   * Authenticated Farmer Speech-to-Text Transcription Endpoint (Sarvam STT)
   * Receives recorded voice audio, validates it for silence/size to protect credits,
   * enforces duplicate protection, and returns normalized transcript.
   */
  router.post('/transcribe', authenticateToken, requireRole('FARMER'), async (req, res) => {
    const { audio, mimeType = 'audio/webm', language = 'ta-IN', voiceRequestId = null } = req.body || {};

    if (!audio) {
      return res.status(400).json({
        success: false,
        error: 'empty_audio',
        message: "I couldn't hear anything. Please try again."
      });
    }

    try {
      let audioBuffer;
      if (Buffer.isBuffer(audio)) {
        audioBuffer = audio;
      } else if (typeof audio === 'string') {
        // Strip data URI prefix if present (e.g., "data:audio/webm;codecs=opus;base64,..." or "data:audio/webm;base64,...")
        const base64Data = audio.replace(/^data:[^,]+,/, '');
        audioBuffer = Buffer.from(base64Data.trim(), 'base64');
      } else {
        return res.status(400).json({
          success: false,
          error: 'invalid_audio_payload',
          message: "I couldn't hear anything. Please try again."
        });
      }

      // Early credit protection check
      if (!audioBuffer || audioBuffer.length < 400) {
        return res.status(400).json({
          success: false,
          error: 'audio_too_short',
          message: "I couldn't hear anything. Please try again."
        });
      }

      const result = await defaultSpeechAdapters.transcribe({
        audioBuffer,
        mimeType,
        languageCode: language,
        voiceRequestId: voiceRequestId || `VR-${Date.now()}`
      });

      if (!result.transcript || result.transcript.trim().length === 0) {
        return res.json({
          success: true,
          transcript: '',
          language: result.language || 'ta',
          provider: result.provider || 'bhashini',
          fallbackFrom: result.fallbackFrom || null,
          voiceRequestId: voiceRequestId || null,
          is_cached: Boolean(result.is_cached),
          message: "I couldn't hear any speech. Please try again."
        });
      }

      res.json({
        success: true,
        transcript: result.transcript,
        language: result.language,
        provider: result.provider || 'bhashini',
        fallbackFrom: result.fallbackFrom || null,
        voiceRequestId: voiceRequestId || null,
        is_cached: Boolean(result.is_cached)
      });
    } catch (err) {
      // Credit protection rejection (silent, empty, or unreadable audio)
      if (['INVALID_AUDIO', 'AUDIO_TOO_SHORT', 'AUDIO_SILENT'].includes(err.code)) {
        return res.status(400).json({
          success: false,
          error: err.code.toLowerCase(),
          message: err.userMessage || "I couldn't hear anything. Please try again."
        });
      }

      console.error('[VoiceAgent] /transcribe error:', err.message);

      res.status(500).json({
        success: false,
        error: 'speech_transcription_failed',
        message: err.userMessage || 'Unable to process the voice input. Please try again or type below.'
      });
    }
  });

  /**
   * Authenticated Farmer Voice/Text Understanding Endpoint
   * Enforces JWT authentication and derives farmer identity strictly from req.user.farmerId.
   */
  router.post('/understand', authenticateToken, requireRole('FARMER'), async (req, res) => {
    try {
      const farmerId = req.user.farmerId;
      if (!farmerId) {
        return res.status(403).json({
          error: 'invalid_farmer_context',
          message: 'Authenticated user token does not contain a valid farmer identifier.'
        });
      }

      const { text, conversationHistory = [], currentBookingState = {} } = req.body;
      const cleanText = String(text || '').trim();

      // Early Out-of-Scope Detection (zero unnecessary database querying)
      if (isOutOfScope(cleanText)) {
        return res.json({
          status: 'success',
          intent: 'OUT_OF_SCOPE',
          entities: {},
          missing_fields: [],
          assistant_reply: 'I can help with your Kisan Queue services such as booking, procurement-centre status, booking status, payment status and grievances.',
          suggested_actions: ['Book a Slot', 'Check Booking Status', 'Payment Status', 'Help'],
          farmer_id: farmerId,
          confidence: 1.0
        });
      }

      // 1. Fetch live operational districts & centres from database
      const [districtsRes, centresRes] = await Promise.all([
        pool.query(`
          SELECT DISTINCT district
          FROM centres
          WHERE district IS NOT NULL AND operational_status != 'Retired'
          ORDER BY district ASC
        `),
        pool.query(`
          SELECT centre_id, centre_name, village_town, district, operational_status
          FROM centres
          WHERE operational_status != 'Retired'
          ORDER BY centre_name ASC
        `)
      ]);

      const availableDistricts = districtsRes.rows.map(r => r.district);
      const availableCentres = centresRes.rows;

      // 2. Concurrently check if farmer already has an active booking
      const activeBookingCheck = await pool.query(`
        SELECT b.booking_id, b.centre_id, b.slot_id, b.booking_date, b.status,
               b.crop, b.quantity_quintals, b.token, b.queue_position_at_booking,
               c.centre_name, c.district, s.start_time, s.end_time
        FROM bookings b
        LEFT JOIN centres c ON b.centre_id = c.centre_id
        LEFT JOIN slots s ON b.slot_id = s.slot_id
        WHERE b.farmer_id = $1
          AND b.booking_date >= CURRENT_DATE
          AND b.status NOT IN ('Procured', 'Payment Pending', 'Payment Completed', 'No-Show', 'Cancelled')
        LIMIT 1
      `, [farmerId]);

      const hasActiveBooking = activeBookingCheck.rows.length > 0;
      const activeBookingData = hasActiveBooking ? {
        booking_id: activeBookingCheck.rows[0].booking_id,
        centre_id: activeBookingCheck.rows[0].centre_id,
        centre_name: activeBookingCheck.rows[0].centre_name,
        district: activeBookingCheck.rows[0].district,
        booking_date: activeBookingCheck.rows[0].booking_date ? normalizeDateStr(activeBookingCheck.rows[0].booking_date) : null,
        slot_id: activeBookingCheck.rows[0].slot_id,
        slot_time: activeBookingCheck.rows[0].start_time ? `${activeBookingCheck.rows[0].start_time.slice(0, 5)} - ${activeBookingCheck.rows[0].end_time.slice(0, 5)}` : null,
        status: activeBookingCheck.rows[0].status,
        crop: activeBookingCheck.rows[0].crop,
        quantity_quintals: parseFloat(activeBookingCheck.rows[0].quantity_quintals) || 10,
        token: activeBookingCheck.rows[0].token || `TK-${activeBookingCheck.rows[0].booking_id}`,
        queue_number: activeBookingCheck.rows[0].queue_position_at_booking || 1
      } : null;

      // 3. Extract intent and entities using AI Provider Factory
      const extracted = await defaultFactory.extractIntent({
        text: cleanText,
        conversationHistory,
        currentDraft: currentBookingState,
        availableDistricts,
        availableCentres,
        farmerName: req.user.name || req.user.username || farmerId
      });

      // Deterministic canonicalization for unambiguous pass/token commands
      if (/(?:download|get|give|show|send|print|view).*(?:pass|token|slip)|(?:booking\s+pass|token\s+pass|பாஸ்|அனுமதி\s*சீட்டு)/i.test(cleanText)) {
        extracted.intent = 'GET_BOOKING_PASS';
      }

      // Deterministic canonicalization for queue waiting time queries
      if (/(?:wait(?:ing)?\s*time|queue\s*(?:wait|time|length|status|delay)|waiting\s+in\s+queue)/i.test(cleanText)) {
        extracted.intent = 'GET_WAITING_TIME';
      }

      const entities = extracted.entities || {};

      // 4. Server-side Entity Normalization & Cross-Referencing
      const action = req.body.action || null;
      const slotIdParam = req.body.slot_id || req.body.slotId || null;

      const isChangeDateAction = action === 'CHANGE_DATE' || /^change\s+(?:the\s+)?date$/i.test(cleanText);
      const isChangeCentreAction = action === 'CHANGE_CENTRE' || /^change\s+(?:the\s+)?centre$/i.test(cleanText);
      const isChangeSlotAction = action === 'CHANGE_SLOT' || /^change\s+(?:the\s+)?slot$/i.test(cleanText);
      const isSelectSlotAction = action === 'SELECT_SLOT' || Boolean(slotIdParam);

      if (isChangeDateAction) {
        entities.booking_date = null;
        entities.slot_id = null;
        if (currentBookingState.centre_id) {
          entities.centre_id = currentBookingState.centre_id;
          entities.centre_name = currentBookingState.centre_name;
        }
      } else if (isChangeCentreAction) {
        entities.centre_id = null;
        entities.centre_name = null;
        entities.slot_id = null;
        if (currentBookingState.booking_date) {
          entities.booking_date = currentBookingState.booking_date;
        }
      } else if (isChangeSlotAction) {
        entities.slot_id = null;
      } else if (isSelectSlotAction && slotIdParam) {
        entities.slot_id = slotIdParam;
      }

      // A. Normalize District
      if (entities.district) {
        const matchedDist = availableDistricts.find(
          d => d.toLowerCase() === entities.district.toLowerCase()
        );
        if (matchedDist) {
          entities.district = matchedDist;
        }
      }

      // B. Normalize & Resolve Centre against live Database
      const UI_ACTION_REGEX = /\b(change\s+(?:the\s+)?(?:date|centre|center|slot|time)|different\s+(?:date|centre|center|slot)|another\s+(?:date|centre|center|slot)|morning\s+slot|afternoon\s+slot|evening\s+slot|select\s+slot|confirm\s+booking|find\s+nearest|book\s+now|cancel|clear|start\s+over)\b/i;

      let centreResolutionStatus = 'not_attempted';
      let candidateCentreInput = null;
      let multipleMatchedCentres = [];

      // Determine if a new candidate centre is specified in this turn
      if (!isChangeDateAction && !isChangeSlotAction && !isSelectSlotAction) {
        if (entities.centre_name && entities.centre_name !== currentBookingState.centre_name) {
          candidateCentreInput = entities.centre_name;
        } else if (!currentBookingState.centre_id) {
          candidateCentreInput = entities.centre_name || entities.centre_id || null;
        }
      }

      // Discard UI action labels from being treated as candidate centres
      if (candidateCentreInput && UI_ACTION_REGEX.test(candidateCentreInput)) {
        candidateCentreInput = null;
        entities.centre_name = currentBookingState.centre_name || null;
      }

      // If user provided a standalone text during a turn where district was already known and centre was missing,
      // consider cleanText itself as a candidate centre input (guarding against sentence verbs and commands)
      const hasSentenceVerbs = /\b(want|need|book|booking|reserve|deliver|delivering|harvest|bring|procure|slot|appointment|can\s+i|please|check|view|show|track|report|raise|file|grievance|complaint|payment|money|status|pass|help)\b/i.test(cleanText);
      const isTemporalOrQuantity = /\b(tomorrow|today|yesterday|morning|afternoon|evening|night|ton|tons|quintal|quintals|kg|bag|bags|paddy|maize|crop)\b/i.test(cleanText);
      const isPureDistrict = availableDistricts.some(d => d.toLowerCase() === cleanText.toLowerCase());
      const isUiAction = UI_ACTION_REGEX.test(cleanText);

      if (!candidateCentreInput && !isChangeCentreAction && !isChangeDateAction && !isChangeSlotAction && !isSelectSlotAction && currentBookingState.district && !currentBookingState.centre_id && !hasSentenceVerbs && !isTemporalOrQuantity && !isPureDistrict && !isUiAction && cleanText.length >= 3) {
        candidateCentreInput = cleanText;
      }

      if (candidateCentreInput && !UI_ACTION_REGEX.test(candidateCentreInput)) {
        const resolution = resolveCentreAgainstDb(candidateCentreInput, availableCentres, entities.district || currentBookingState.district);
        centreResolutionStatus = resolution.status;

        if (resolution.status === 'single') {
          const matched = resolution.match;
          entities.centre_id = matched.centre_id;
          entities.centre_name = matched.centre_name;
          if (!entities.district) {
            entities.district = matched.district;
          }
        } else if (resolution.status === 'multiple') {
          multipleMatchedCentres = resolution.matches;
        }
      }

      // Preserve existing valid district if not specified in this turn
      if (!entities.district && currentBookingState.district) {
        entities.district = currentBookingState.district;
      }

      // Preserve existing valid centre unless user explicitly changed centre
      if (!entities.centre_id && currentBookingState.centre_id && !isChangeCentreAction) {
        if (!candidateCentreInput || centreResolutionStatus === 'not_attempted') {
          entities.centre_id = currentBookingState.centre_id;
          entities.centre_name = currentBookingState.centre_name;
        }
      }

      // Preserve existing valid date unless user explicitly changed date
      if (!entities.booking_date && currentBookingState.booking_date && !isChangeDateAction) {
        entities.booking_date = currentBookingState.booking_date;
      }

      // Preserve existing valid crop
      if (!entities.crop && currentBookingState.crop) {
        entities.crop = currentBookingState.crop;
      }

      // Preserve existing valid quantity & unit
      if ((!entities.quantity_quintals || entities.quantity_quintals <= 0) && currentBookingState.quantity_quintals > 0) {
        entities.quantity_quintals = currentBookingState.quantity_quintals;
      }
      if (!entities.quantity && currentBookingState.quantity) {
        entities.quantity = currentBookingState.quantity;
      }
      if (!entities.unit && currentBookingState.unit) {
        entities.unit = currentBookingState.unit;
      }
      if (!entities.farmer && currentBookingState.farmer) {
        entities.farmer = currentBookingState.farmer;
      }
      if (!entities.booking_id && currentBookingState.booking_id) {
        entities.booking_id = currentBookingState.booking_id;
      }
      if (!entities.grievance && currentBookingState.grievance) {
        entities.grievance = currentBookingState.grievance;
      }
      if (!entities.language && currentBookingState.language) {
        entities.language = currentBookingState.language;
      }

      // Clean up entities when explicit changes are requested
      if (isChangeDateAction) {
        entities.booking_date = null;
        entities.date = null;
        entities.slot_id = null;
      }
      if (isChangeCentreAction) {
        entities.centre_id = null;
        entities.centre_name = null;
        entities.centre = null;
        entities.slot_id = null;
      }
      if (isChangeSlotAction) {
        entities.slot_id = null;
      }

      // Sync date and booking_date
      if (!isChangeDateAction) {
        entities.date = entities.booking_date || entities.date || null;
        entities.booking_date = entities.date;
      } else {
        entities.date = null;
        entities.booking_date = null;
      }

      // Sync centre and centre_name
      if (!isChangeCentreAction) {
        entities.centre = entities.centre_name || entities.centre || null;
        entities.centre_name = entities.centre;
      } else {
        entities.centre = null;
        entities.centre_name = null;
      }

      // Sync time and time_preference
      entities.time = entities.time_preference || entities.time || null;
      entities.time_preference = entities.time;

      // C. Normalize Date: Ensure valid future/present date
      if (entities.booking_date) {
        const d = new Date(entities.booking_date);
        if (isNaN(d.getTime())) {
          entities.booking_date = null;
          entities.date = null;
        }
      }

      // 5. Look up real slots if centre and date are identified (matching GET /api/centres/:id/slots)
      let availableSlots = [];
      if (entities.centre_id && entities.booking_date) {
        try {
          // Check existing slots in slots table
          let slotsRes = await pool.query(`
            SELECT slot_id, start_time, end_time, max_farmers, booked_count
            FROM slots
            WHERE centre_id = $1 AND date = $2
            ORDER BY start_time ASC
          `, [entities.centre_id, entities.booking_date]);

          // If no slots exist for this centre & date yet, populate standard default daily slots
          if (slotsRes.rows.length === 0) {
            const timeSlots = [
              ['08:00', '09:00'],
              ['09:00', '10:00'],
              ['10:00', '11:00'],
              ['11:00', '12:00'],
              ['12:00', '13:00'],
              ['13:00', '14:00'],
              ['14:00', '15:00'],
              ['15:00', '16:00']
            ];

            for (let i = 0; i < timeSlots.length; i++) {
              const [startTime, endTime] = timeSlots[i];
              const slotId = `${entities.centre_id}_${entities.booking_date}_${i + 1}`;
              await pool.query(`
                INSERT INTO slots (slot_id, centre_id, date, start_time, end_time, max_farmers, booked_count)
                VALUES ($1, $2, $3, $4, $5, 10, 0)
                ON CONFLICT (slot_id) DO NOTHING
              `, [slotId, entities.centre_id, entities.booking_date, startTime, endTime]);
            }

            slotsRes = await pool.query(`
              SELECT slot_id, start_time, end_time, max_farmers, booked_count
              FROM slots
              WHERE centre_id = $1 AND date = $2
              ORDER BY start_time ASC
            `, [entities.centre_id, entities.booking_date]);
          }

          availableSlots = slotsRes.rows.map(slot => {
            const booked = parseInt(slot.booked_count, 10) || 0;
            const max = parseInt(slot.max_farmers, 10) || 10;
            const isFull = booked >= max;
            return {
              slot_id: slot.slot_id,
              start_time: slot.start_time ? String(slot.start_time).slice(0, 5) : '',
              end_time: slot.end_time ? String(slot.end_time).slice(0, 5) : '',
              booked_count: booked,
              max_farmers: max,
              available: !isFull
            };
          });

          // If farmer requested a time preference (e.g. morning/afternoon) and hasn't chosen slot_id yet
          if (!entities.slot_id && entities.time_preference && availableSlots.length > 0) {
            const pref = entities.time_preference.toLowerCase();
            const matchingSlot = availableSlots.find(s => {
              if (!s.available) return false;
              const hour = parseInt(s.start_time.slice(0, 2), 10);
              if (pref.includes('morning') && hour < 12) return true;
              if (pref.includes('afternoon') && hour >= 12 && hour < 16) return true;
              if (pref.includes('evening') && hour >= 16) return true;
              return false;
            });

            if (matchingSlot) {
              entities.slot_id = matchingSlot.slot_id;
            }
          }
        } catch (slotErr) {
          console.warn('[VoiceAgent] Could not retrieve slots:', slotErr.message);
        }
      }

      // Re-evaluate missing fields based on validated state
      const missing_fields = [];
      if (!entities.district) missing_fields.push('district');
      if (!entities.centre_id) missing_fields.push('centre');
      if (!entities.booking_date) missing_fields.push('booking_date');
      if (!entities.crop) missing_fields.push('crop');
      if (!entities.quantity_quintals || entities.quantity_quintals <= 0) missing_fields.push('quantity_quintals');
      if (!entities.slot_id) missing_fields.push('slot_id');

      // 6. Formulate intelligent, non-repeating Assistant Reply with strict intent routing
      const currentIntent = extracted.intent;
      let assistantReply = extracted.assistant_reply;
      let suggestedActions = extracted.suggested_actions || [];

      let bookingData = activeBookingData;
      let passData = null;
      let paymentData = null;
      let queueData = null;
      let availabilityData = null;
      let grievancesData = null;
      let grievanceData = null;
      let procurementData = null;
      let centreData = null;
      let matchingCentresList = [];
      let rescheduleData = null;
      let cancellationData = null;

      // Priority 1: Explicit UI Actions (Change Date, Change Centre, Change Slot)
      if (isChangeDateAction) {
        assistantReply = entities.centre_name
          ? `What date would you like to book for delivery at ${entities.centre_name}? You can say tomorrow, 29 September, or pick a date.`
          : 'What date would you like to book? (e.g. tomorrow or 29 September)';
        suggestedActions = ['Tomorrow', 'Day After Tomorrow', '29 September'];
      } else if (isChangeCentreAction) {
        assistantReply = `Which Direct Procurement Centre in ${entities.district || 'your district'} would you like to use?`;
        const districtCentres = availableCentres.filter(c => c.district && c.district.toLowerCase() === (entities.district || '').toLowerCase());
        suggestedActions = districtCentres.slice(0, 4).map(c => c.centre_name);
      } else if (isChangeSlotAction) {
        assistantReply = 'Please choose an arrival slot from the available time slots below.';
        suggestedActions = ['Morning Slot', 'Afternoon Slot'];
      // Priority 2: Centre Disambiguation or Not-Found error (only for booking or centre-related queries)
      } else if (centreResolutionStatus === 'multiple' && (currentIntent === 'BOOK_SLOT' || currentIntent === 'CHANGE_CENTRE' || currentIntent === 'FIND_CENTRE')) {
        assistantReply = `I found multiple procurement centres matching "${candidateCentreInput}": ${multipleMatchedCentres.slice(0, 3).map(m => m.centre_name).join(', ')}. Which one would you prefer?`;
        suggestedActions = multipleMatchedCentres.slice(0, 4).map(m => m.centre_name);
      } else if (centreResolutionStatus === 'none' && candidateCentreInput && candidateCentreInput.length >= 3 && !entities.centre_id && (currentIntent === 'BOOK_SLOT' || currentIntent === 'CHANGE_CENTRE')) {
        const distName = entities.district || currentBookingState.district || 'Ariyalur';
        assistantReply = `I couldn't find a procurement centre named ${candidateCentreInput} in ${distName}. Please choose from the available centres.`;
        const districtCentres = availableCentres.filter(c => c.district && c.district.toLowerCase() === distName.toLowerCase());
        suggestedActions = districtCentres.slice(0, 4).map(c => c.centre_name);
      // Priority 3: Non-booking informational queries & API-connected actions
      } else if (currentIntent === 'CHECK_BOOKING_STATUS' || currentIntent === 'QUERY_STATUS') {
        if (hasActiveBooking) {
          bookingData = activeBookingData;
          assistantReply = `Your active booking #${activeBookingData.booking_id} at ${activeBookingData.centre_name} is scheduled for ${activeBookingData.booking_date}${activeBookingData.slot_time ? ` (${activeBookingData.slot_time})` : ''}. Status: ${activeBookingData.status}. Token: #${activeBookingData.token}.`;
          suggestedActions = ['Download Pass', 'Check Queue', 'Reschedule Slot'];
        } else {
          const histRes = await pool.query(`
            SELECT b.booking_id, b.centre_id, b.slot_id, b.booking_date, b.status, b.crop, b.quantity_quintals, b.token, b.queue_position_at_booking,
                   c.centre_name, c.district, s.start_time, s.end_time
            FROM bookings b
            LEFT JOIN centres c ON b.centre_id = c.centre_id
            LEFT JOIN slots s ON b.slot_id = s.slot_id
            WHERE b.farmer_id = $1
            ORDER BY b.booking_date DESC, b.created_at DESC
            LIMIT 1
          `, [farmerId]);
          if (histRes.rows.length > 0) {
            const row = histRes.rows[0];
            bookingData = {
              booking_id: row.booking_id,
              centre_id: row.centre_id,
              centre_name: row.centre_name,
              district: row.district,
              booking_date: row.booking_date ? normalizeDateStr(row.booking_date) : null,
              slot_id: row.slot_id,
              slot_time: row.start_time ? `${row.start_time.slice(0, 5)} - ${row.end_time.slice(0, 5)}` : null,
              status: row.status,
              crop: row.crop,
              quantity_quintals: parseFloat(row.quantity_quintals) || 10,
              token: row.token || `TK-${row.booking_id}`,
              queue_number: row.queue_position_at_booking || 1,
              is_active: false
            };
            assistantReply = `Your past booking #${bookingData.booking_id} at ${bookingData.centre_name} for ${bookingData.crop || 'produce'} was on ${bookingData.booking_date}. Status: ${bookingData.status}. Would you like to book a new appointment?`;
            suggestedActions = ['Book a Slot', 'Find Centre', 'Check Payment'];
          } else {
            assistantReply = 'You do not have any active or past procurement appointments on record. Would you like to book a slot for your harvest?';
            suggestedActions = ['Book a Slot', 'Find Centre', 'Help'];
          }
        }
      } else if (currentIntent === 'GET_BOOKING_PASS') {
        if (hasActiveBooking) {
          passData = {
            booking_id: activeBookingData.booking_id,
            token: activeBookingData.token || `TK-${activeBookingData.booking_id}`,
            queue_number: activeBookingData.queue_number || 1,
            centre_id: activeBookingData.centre_id,
            centre_name: activeBookingData.centre_name,
            district: activeBookingData.district,
            booking_date: activeBookingData.booking_date,
            slot_time: activeBookingData.slot_time || 'Scheduled Slot',
            crop: activeBookingData.crop,
            pass_url: `/farmer/pass`
          };
          assistantReply = `Your digital entry pass for booking #${passData.booking_id} at ${passData.centre_name} on ${passData.booking_date} (${passData.slot_time}) is ready with token #${passData.token}. You can present this QR pass at the gate.`;
          suggestedActions = ['Download Pass', 'Check Queue', 'Help'];
        } else {
          assistantReply = 'You do not have an active booking pass. Would you like to book an arrival slot?';
          suggestedActions = ['Book a Slot', 'Find Centre'];
        }
      } else if (currentIntent === 'CHECK_PAYMENT_STATUS') {
        const payRes = await pool.query(`
          SELECT p.payment_id, p.booking_id, p.payment_status, p.net_payable_inr, p.payable_quantity_quintals,
                 p.applicable_rate_inr, p.payment_method, p.transaction_reference, p.completed_at,
                 b.crop, b.booking_date, c.centre_name
          FROM procurement_payments p
          JOIN bookings b ON p.booking_id = b.booking_id
          LEFT JOIN centres c ON b.centre_id = c.centre_id
          WHERE b.farmer_id = $1
          ORDER BY p.created_at DESC
          LIMIT 1
        `, [farmerId]);

        if (payRes.rows.length > 0) {
          const pRow = payRes.rows[0];
          paymentData = {
            payment_id: pRow.payment_id,
            booking_id: pRow.booking_id,
            payment_status: pRow.payment_status,
            net_payable_inr: parseFloat(pRow.net_payable_inr),
            payable_quantity_quintals: parseFloat(pRow.payable_quantity_quintals),
            applicable_rate_inr: parseFloat(pRow.applicable_rate_inr),
            transaction_reference: pRow.transaction_reference,
            payment_method: pRow.payment_method || 'DBT',
            centre_name: pRow.centre_name,
            crop: pRow.crop
          };
          const isPaid = pRow.payment_status === 'PAYMENT_COMPLETED' || pRow.payment_status === 'PAID';
          assistantReply = `For booking #${paymentData.booking_id}: Your payment of ₹${paymentData.net_payable_inr.toLocaleString('en-IN')} for ${paymentData.payable_quantity_quintals} quintals of ${paymentData.crop || 'crop'} is ${isPaid ? `credited to your bank account via Direct Benefit Transfer (DBT)` : `under process (${paymentData.payment_status.replace(/_/g, ' ')}) via Direct Benefit Transfer`}.`;
          suggestedActions = ['Check Booking Status', 'Raise Grievance', 'Help'];
        } else if (hasActiveBooking) {
          const estQty = activeBookingData.quantity_quintals || currentBookingState.quantity_quintals || 10;
          const estVal = estQty * 2275;
          paymentData = {
            booking_id: activeBookingData.booking_id,
            payment_status: 'PENDING_WEIGHMENT',
            estimated_payout_inr: estVal,
            centre_name: activeBookingData.centre_name
          };
          assistantReply = `For your upcoming booking #${activeBookingData.booking_id} at ${activeBookingData.centre_name}: Direct Benefit Transfer (DBT) payments (estimated payout approx. ₹${estVal.toLocaleString('en-IN')}) are credited to your bank account within 24 to 48 hours after harvest delivery and weighment.`;
          suggestedActions = ['Check Booking Status', 'Book a Slot', 'Help'];
        } else {
          assistantReply = 'Direct Benefit Transfer (DBT) payments are credited to your bank account within 24 to 48 hours following procurement weighment and quality certification at the centre.';
          suggestedActions = ['Book a Slot', 'Find Centre', 'Help'];
        }
      } else if (currentIntent === 'CHECK_PROCUREMENT_STATUS') {
        const procRes = await pool.query(`
          SELECT b.booking_id, b.status AS booking_status, b.crop, b.quantity_quintals, b.booking_date,
                 c.centre_name,
                 q.quality_status, q.grade, q.moisture_percentage,
                 w.net_weight_kg, w.gross_weight_kg,
                 r.receipt_number, r.receipt_status
          FROM bookings b
          LEFT JOIN centres c ON b.centre_id = c.centre_id
          LEFT JOIN procurement_quality q ON b.booking_id = q.booking_id
          LEFT JOIN procurement_weighments w ON b.booking_id = w.booking_id
          LEFT JOIN procurement_receipts r ON b.booking_id = r.booking_id
          WHERE b.farmer_id = $1
          ORDER BY b.booking_date DESC, b.created_at DESC
          LIMIT 1
        `, [farmerId]);

        if (procRes.rows.length > 0) {
          const pRec = procRes.rows[0];
          procurementData = {
            booking_id: pRec.booking_id,
            booking_status: pRec.booking_status,
            crop: pRec.crop,
            quantity_quintals: pRec.quantity_quintals,
            centre_name: pRec.centre_name,
            grade: pRec.grade,
            moisture_percentage: pRec.moisture_percentage,
            net_weight_kg: pRec.net_weight_kg,
            receipt_number: pRec.receipt_number
          };
          if (pRec.net_weight_kg || pRec.grade) {
            assistantReply = `For booking #${pRec.booking_id} at ${pRec.centre_name}: Procurement completed. Quality grade is ${pRec.grade || 'Standard'} (Moisture: ${pRec.moisture_percentage || '14'}%), Net weight: ${pRec.net_weight_kg} kg${pRec.receipt_number ? `, Receipt #${pRec.receipt_number}` : ''}.`;
            suggestedActions = ['Check Payment Status', 'Download Pass', 'Help'];
          } else {
            assistantReply = `For booking #${pRec.booking_id} at ${pRec.centre_name}: Current status is ${pRec.booking_status}. Produce inspection, moisture test, and weighment will take place when you arrive at the centre.`;
            suggestedActions = ['Check Booking Status', 'Booking Pass', 'Help'];
          }
        } else {
          assistantReply = 'Your harvest procurement, moisture analysis, and weighment records are updated live as soon as weighment is completed at the centre.';
          suggestedActions = ['Book a Slot', 'Check Booking Status', 'Help'];
        }
      } else if (currentIntent === 'GET_WAITING_TIME') {
        const waitCentreId = entities.centre_id || (hasActiveBooking ? activeBookingData.centre_id : null);
        if (waitCentreId) {
          const [qRes, cRes] = await Promise.all([
            pool.query(`
              SELECT COUNT(*) AS active_queue
              FROM bookings
              WHERE centre_id = $1
                AND booking_date = CURRENT_DATE
                AND status IN ('Confirmed', 'On The Way', 'Checked-In')
            `, [waitCentreId]),
            pool.query(`
              SELECT centre_id, centre_name, district, COALESCE(processing_rate_min, 12) AS processing_rate_min,
                     COALESCE(active_counters, 2) AS active_counters, operational_status
              FROM centres
              WHERE centre_id = $1
            `, [waitCentreId])
          ]);
          if (cRes.rows.length > 0) {
            const c = cRes.rows[0];
            const qCount = parseInt(qRes.rows[0]?.active_queue || '0', 10);
            const rate = parseInt(c.processing_rate_min, 10) || 12;
            const counters = parseInt(c.active_counters, 10) || 2;
            const waitMin = qCount === 0 ? 15 : Math.max(10, Math.round((qCount * rate) / counters));
            queueData = {
              centre_id: c.centre_id,
              centre_name: c.centre_name,
              district: c.district,
              active_queue_count: qCount,
              estimated_wait_minutes: waitMin,
              operational_status: c.operational_status
            };
            assistantReply = `The current queue at ${c.centre_name} has ${qCount} farmer${qCount === 1 ? '' : 's'}. Estimated waiting time is approximately ${waitMin} minutes. Having a confirmed arrival slot guarantees priority entry.`;
            suggestedActions = ['Check Slot Availability', 'Book a Slot', 'Help'];
          }
        }
        if (!queueData) {
          const centreTitle = entities.centre_name || (hasActiveBooking ? activeBookingData.centre_name : 'Direct Procurement Centres');
          assistantReply = `The current estimated queue waiting time at ${centreTitle} is approximately 15 to 30 minutes. Booking an arrival slot guarantees priority gate entry.`;
          suggestedActions = ['Check Slot Availability', 'Book a Slot', 'Help'];
        }
      } else if (currentIntent === 'CHECK_SLOT_AVAILABILITY') {
        if (entities.centre_id && entities.booking_date) {
          const totalSlots = availableSlots.length;
          const openSlots = availableSlots.filter(s => s.available).length;
          availabilityData = {
            centre_id: entities.centre_id,
            centre_name: entities.centre_name,
            booking_date: entities.booking_date,
            available_slots_count: openSlots,
            total_slots_count: totalSlots,
            slots: availableSlots
          };
          assistantReply = `At ${entities.centre_name} on ${entities.booking_date}, there are ${openSlots} available arrival slots out of ${totalSlots} total time windows. Would you prefer a morning or afternoon slot?`;
          suggestedActions = ['Morning Slot', 'Afternoon Slot', 'Change Date', 'Change Centre'];
        } else if (entities.district) {
          assistantReply = `Please choose which Direct Procurement Centre in ${entities.district} and what date you would like to check for slot availability.`;
          const distCentres = availableCentres.filter(c => c.district && c.district.toLowerCase() === entities.district.toLowerCase());
          suggestedActions = distCentres.slice(0, 4).map(c => c.centre_name);
        } else {
          assistantReply = 'Which procurement centre and date would you like to check slot availability for?';
          suggestedActions = ['Thanjavur', 'Ariyalur', 'Tiruvarur'];
        }
      } else if (currentIntent === 'FIND_CENTRE' || currentIntent === 'GET_CENTRE_INFORMATION') {
        if (entities.centre_id) {
          const cMatch = availableCentres.find(c => c.centre_id === entities.centre_id);
          if (cMatch) {
            centreData = cMatch;
            assistantReply = `${cMatch.centre_name} in ${cMatch.village_town || cMatch.district} (${cMatch.district}) is open and operational. Daily capacity is ${cMatch.daily_capacity_slots || 50} farmers. Operating hours are 8:00 AM to 5:00 PM.`;
            suggestedActions = ['Check Slot Availability', 'Book a Slot', 'Check Queue'];
          }
        } else if (entities.district) {
          const dCentres = availableCentres.filter(c => c.district && c.district.toLowerCase() === entities.district.toLowerCase());
          matchingCentresList = dCentres.slice(0, 5);
          assistantReply = `Here are Direct Procurement Centres located in ${entities.district}: ${matchingCentresList.map(c => c.centre_name).join(', ')}. Which one would you prefer?`;
          suggestedActions = matchingCentresList.map(c => c.centre_name);
        } else {
          assistantReply = 'Which district or centre would you like information for? (e.g. Ariyalur, Thanjavur, or Tiruvarur)';
          suggestedActions = ['Ariyalur', 'Thanjavur', 'Tiruvarur'];
        }
      } else if (currentIntent === 'RAISE_GRIEVANCE') {
        const gText = entities.grievance || (cleanText.length > 10 && !/^(raise\s+grievance|complain|file\s+complaint)$/i.test(cleanText) ? cleanText : null);
        const gCentreId = entities.centre_id || (hasActiveBooking ? activeBookingData.centre_id : null);
        const gCentreName = entities.centre_name || (hasActiveBooking ? activeBookingData.centre_name : null);

        let detectedIssueType = 'Other Issue';
        const lowerG = (cleanText + ' ' + (gText || '')).toLowerCase();
        if (lowerG.includes('weigh') || lowerG.includes('weight') || lowerG.includes('scale')) {
          detectedIssueType = 'Delay in Weighment';
        } else if (lowerG.includes('payment') || lowerG.includes('dbt') || lowerG.includes('money')) {
          detectedIssueType = 'Payment Delay';
        } else if (lowerG.includes('staff') || lowerG.includes('officer') || lowerG.includes('behavior')) {
          detectedIssueType = 'Staff Behaviour';
        } else if (lowerG.includes('facility') || lowerG.includes('water') || lowerG.includes('shed')) {
          detectedIssueType = 'Centre Facility';
        }

        if (gText) {
          grievanceData = {
            farmer_id: farmerId,
            centre_id: gCentreId,
            centre_name: gCentreName,
            issue_type: detectedIssueType,
            description: gText,
            ready_to_submit: Boolean(gCentreId)
          };
          assistantReply = `I have recorded your grievance: "${gText}" for ${gCentreName || 'the procurement centre'}. Category: ${detectedIssueType}. It will be forwarded to the District Procurement Officer for immediate resolution.`;
          suggestedActions = ['Submit Grievance', 'Delay in Weighment', 'Payment Delay', 'Cancel'];
        } else {
          assistantReply = 'I can help you file a grievance with the District Procurement Officer. Please describe the problem (such as weighment delays, payment issues, or centre facilities).';
          suggestedActions = ['Delay in Weighment', 'Payment Delay', 'Centre Staff Issue'];
        }
      } else if (currentIntent === 'CHECK_GRIEVANCE') {
        const gRes = await pool.query(`
          SELECT g.grievance_id, g.issue_type, g.description, g.centre_id, g.status, g.created_at, g.sla_deadline, g.resolved_at,
                 c.centre_name
          FROM grievances g
          LEFT JOIN centres c ON g.centre_id = c.centre_id
          WHERE g.farmer_id = $1
          ORDER BY g.created_at DESC
          LIMIT 5
        `, [farmerId]);

        if (gRes.rows.length > 0) {
          grievancesData = gRes.rows.map(r => ({
            grievance_id: r.grievance_id,
            issue_type: r.issue_type,
            description: r.description,
            centre_name: r.centre_name,
            status: r.status,
            created_at: r.created_at ? r.created_at.toISOString().slice(0, 10) : null
          }));
          const latest = grievancesData[0];
          assistantReply = `You have ${grievancesData.length} grievance${grievancesData.length === 1 ? '' : 's'} on record. Latest ticket #${latest.grievance_id} for "${latest.issue_type}" is currently ${latest.status}.`;
          suggestedActions = ['Raise Grievance', 'Check Booking Status', 'Help'];
        } else {
          assistantReply = 'You do not have any registered grievances. If you face any issues with weighment, payment, or centre facilities, I can help you submit a complaint.';
          suggestedActions = ['Raise Grievance', 'Book a Slot', 'Help'];
        }
      } else if (currentIntent === 'RESCHEDULE_BOOKING') {
        if (hasActiveBooking) {
          rescheduleData = {
            booking_id: activeBookingData.booking_id,
            current_date: activeBookingData.booking_date,
            current_centre: activeBookingData.centre_name,
            new_date: entities.booking_date || null,
            available_slots: availableSlots
          };
          if (entities.booking_date && availableSlots.length > 0) {
            assistantReply = `For booking #${activeBookingData.booking_id}, available arrival slots on ${entities.booking_date} at ${entities.centre_name || activeBookingData.centre_name} are ready below. Please choose your new time slot.`;
            suggestedActions = ['Morning Slot', 'Afternoon Slot', 'Keep Current Slot'];
          } else {
            assistantReply = `Your active booking #${activeBookingData.booking_id} at ${activeBookingData.centre_name} is on ${activeBookingData.booking_date}. What new date would you like to reschedule to?`;
            suggestedActions = ['Tomorrow', 'Day After Tomorrow', '29 September'];
          }
        } else {
          assistantReply = 'You do not have an active booking to reschedule. Would you like to reserve a new procurement slot?';
          suggestedActions = ['Book a Slot', 'Find Centre'];
        }
      } else if (currentIntent === 'CANCEL_BOOKING' || currentIntent === 'CANCEL') {
        if (hasActiveBooking) {
          cancellationData = {
            booking_id: activeBookingData.booking_id,
            centre_name: activeBookingData.centre_name,
            booking_date: activeBookingData.booking_date,
            status: activeBookingData.status
          };
          assistantReply = `Your booking #${activeBookingData.booking_id} at ${activeBookingData.centre_name} on ${activeBookingData.booking_date} is currently ${activeBookingData.status}. If you cannot make it, you can cancel or reschedule so another farmer can take the slot.`;
          suggestedActions = ['Confirm Cancellation', 'Reschedule Slot', 'Keep Booking'];
        } else {
          assistantReply = 'You do not have an active booking to cancel. How else may I assist you?';
          suggestedActions = ['Book a Slot', 'Help'];
        }
      } else if (currentIntent === 'HELP' && !candidateCentreInput && !entities.district) {
        assistantReply = 'I am your Kisan Voice Assistant. I can help you reserve arrival slots for harvest procurement, check booking & payment status, find centres, check queue waiting times, and submit grievances. How may I assist you?';
        suggestedActions = ['Book a Slot', 'Check Booking Status', 'Find Centre', 'Payment Status'];
      } else if (currentIntent === 'REPEAT' && !candidateCentreInput) {
        assistantReply = 'I am your Kisan Voice Assistant. Tell me your district and crop quantity to reserve your harvest procurement slot, or ask to check status.';
        suggestedActions = ['Book a Slot', 'Check Booking Status', 'Find Centre'];
      } else if (currentIntent === 'GO_BACK' && !candidateCentreInput) {
        assistantReply = 'Going back to the previous step. What details would you like to update?';
        suggestedActions = ['Change Date', 'Change Centre', 'Change Quantity'];
      } else if (hasActiveBooking && currentIntent === 'BOOK_SLOT') {
        assistantReply = `Notice: You already have an active procurement appointment #${activeBookingData.booking_id} at ${activeBookingData.centre_name || activeBookingData.centre_id} on ${activeBookingData.booking_date}. Under fair access rules, farmers may only hold one active booking at a time.`;
      // Priority 4: Centre is resolved -> Confirm or ask for slot/date/quantity
      } else if (entities.centre_id) {
        if (missing_fields.length === 0) {
          assistantReply = `All details are set for ${entities.centre_name} on ${entities.booking_date}. Please review the summary and confirm your booking.`;
          suggestedActions = ['Confirm Booking', 'Change Slot', 'Cancel'];
        } else if (availableSlots.length > 0 && !entities.slot_id) {
          assistantReply = `I have selected ${entities.centre_name}. For ${entities.booking_date}, available arrival slots are ready below. Would you prefer a morning or afternoon slot?`;
          suggestedActions = ['Morning Slot', 'Afternoon Slot', 'Change Centre'];
        } else if (!entities.booking_date) {
          assistantReply = `I have selected ${entities.centre_name}. When would you like to deliver your produce? You can say tomorrow or pick a specific date.`;
          suggestedActions = ['Tomorrow', 'Day After Tomorrow', '29 September'];
        } else if (!entities.quantity_quintals || entities.quantity_quintals <= 0) {
          assistantReply = `I have selected ${entities.centre_name}. How many quintals of ${entities.crop || 'Paddy'} do you have ready for procurement?`;
          suggestedActions = ['10 Quintals', '20 Quintals', '50 Quintals'];
        } else if (!entities.slot_id) {
          assistantReply = `I have selected ${entities.centre_name} for ${entities.booking_date}. Please choose your arrival slot.`;
          suggestedActions = ['Morning Slot', 'Afternoon Slot'];
        }
      // Priority 5: District is known, centre is missing -> Ask for centre
      } else if (entities.district) {
        assistantReply = `Which Direct Procurement Centre in ${entities.district} do you want to deliver to?`;
        const districtCentres = availableCentres.filter(c => c.district && c.district.toLowerCase() === entities.district.toLowerCase());
        suggestedActions = districtCentres.slice(0, 4).map(c => c.centre_name);
      // Priority 6: District is unknown -> Ask for district
      } else {
        assistantReply = 'Which district is your agricultural land located in? (e.g., Thanjavur, Ariyalur, or Cuddalore)';
        suggestedActions = ['Thanjavur', 'Ariyalur', 'Tiruvarur', 'Cuddalore'];
      }

      res.json({
        status: 'success',
        intent: extracted.intent,
        entities,
        missing_fields,
        assistant_reply: assistantReply,
        suggested_actions: suggestedActions,
        available_slots: availableSlots,
        has_active_booking: hasActiveBooking,
        active_booking: activeBookingData,
        booking_data: bookingData,
        pass_data: passData,
        payment_data: paymentData,
        queue_data: queueData,
        availability_data: availabilityData,
        grievances_data: grievancesData,
        grievance_data: grievanceData,
        procurement_data: procurementData,
        centre_data: centreData,
        matching_centres: matchingCentresList,
        reschedule_data: rescheduleData,
        cancellation_data: cancellationData,
        farmer_id: farmerId,
        provider_used: extracted.provider_used,
        confidence: extracted.confidence
      });
    } catch (err) {
      console.error('[VoiceAgent] /understand error:', err);
      res.status(500).json({
        error: 'understanding_failed',
        message: 'Could not process voice request. Please try again.',
        details: err.message
      });
    }
  });

  return router;
}

module.exports = {
  createVoiceAgentRouter
};
