/**
 * NEW Kisan Queue FastAGI Server (Extension 2000 / Dedicated Port 4574)
 * 
 * COMPLETE REPLICATION OF OLD IVR USER EXPERIENCE:
 * 1. Initial Language Selection:
 *    "தமிழுக்கு 1 அழுத்தவும். Press 2 for English. हिंदी के लिए 3 दबाएं."
 * 2. Farmer Identification:
 *    - Reads NEW_IVR_TEST_PHONE from backend/.env for development/MicroSIP callers
 *    - Looks up registered farmer in PostgreSQL
 *    - Unregistered callers -> speaks not_registered in chosen language and hangs up
 * 3. Farmer Identity Details & Confirmation:
 *    - Speaks Farmer Name and Farmer ID in the chosen language:
 *      Tamil:   "வணக்கம் [Name]. உழவர் எண் [ID]. தொடர 1 அழுத்தவும். தவறென்றால் 2 அழுத்தவும்."
 *      English: "Welcome [Name]. Farmer ID [ID]. Press 1 to continue. Press 2 if this is incorrect."
 *      Hindi:   "नमस्ते [Name]। किसान आईडी [ID]। आगे बढ़ने के लिए 1 दबाएं। गलत होने पर 2 दबाएं।"
 *    - Press 1 -> Confirms identity, proceeds to Main Menu
 *    - Press 2 -> Rejects identity, speaks goodbye and hangs up
 * 4. Main Menu (Exact OLD IVR 9-option menu in chosen language):
 *    1 -> Book Visit (ONE-PRESS BOOKING using OLD IVR slot/centre logic)
 *    2 -> Status (Booking status & digital pass details)
 *    3 -> Centre Status (Open/busy/paused status & active queue count)
 *    4 -> Reschedule (Alternative slots and acceptance)
 *    5 -> Grievance (Categories 1-4 and ticket generation)
 *    6 -> Payment (MSP payment amount, status, DBT method)
 *    7 -> Digital Pass (Pass token, QR advisory, wait time)
 *    8 -> Repeat Menu
 *    9 -> End Call
 * 
 * Architecture & Operational Characteristics:
 * - Extension: 2000 (Port 4574)
 * - Development identity: NEW_IVR_TEST_PHONE from backend/.env
 * - Booking: One-press automatic allocation
 */

const path = require('path');
const fs = require('fs');
const net = require('net');

// Resolve IVR directory: prioritize C:/KisanQueue-IVR if present, otherwise fallback to repo ivr/
const localIvrDir = path.resolve(__dirname, '../../../ivr');
const FASTAGI_DIR = process.env.FASTAGI_DIR || (fs.existsSync('C:/KisanQueue-IVR') ? 'C:/KisanQueue-IVR' : localIvrDir);
const LanguageManager = require(`${FASTAGI_DIR}/prompts/languageManager`);
const FarmerService = require(`${FASTAGI_DIR}/core/farmerService`);
const BookingService = require(`${FASTAGI_DIR}/core/bookingService`);
const StatusService = require(`${FASTAGI_DIR}/core/statusService`);
const CentreService = require(`${FASTAGI_DIR}/core/centreService`);
const RescheduleService = require(`${FASTAGI_DIR}/core/rescheduleService`);
const GrievanceService = require(`${FASTAGI_DIR}/core/grievanceService`);
const PaymentService = require(`${FASTAGI_DIR}/core/paymentService`);
const AsteriskAdapter = require(`${FASTAGI_DIR}/telephony/asterisk/AsteriskAdapter`);
const {
  resolveDateFromDay,
  findNearestCentres,
  getValidBookingDates
} = require(`${FASTAGI_DIR}/core/nearestCentresHelper`);
const {
  isSlotExpired,
  isSlotBookable,
  getKolkataNow
} = require('../booking/slotValidation');

const ENV_PATH = path.resolve(__dirname, '../../.env');

/**
 * Dynamically resolves the development test phone number from backend/.env.
 * Allows instant configuration changes without requiring server restart.
 */
function getTestPhone() {
  try {
    if (fs.existsSync(ENV_PATH)) {
      const content = fs.readFileSync(ENV_PATH, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('NEW_IVR_TEST_PHONE=')) {
          const val = trimmed.split('=')[1]?.replace(/["']/g, '').trim();
          if (val) return val;
        }
      }
    }
  } catch (_) {}
  return process.env.NEW_IVR_TEST_PHONE || '9000000016';
}

function maskPhone(p) {
  if (!p) return 'unknown';
  const str = String(p).trim();
  if (str.length <= 4) return str;
  return '******' + str.slice(-4);
}

class NewIvrApp {
  constructor({
    farmerService = new FarmerService(),
    bookingService = new BookingService(),
    statusService = new StatusService(),
    centreService = new CentreService(),
    rescheduleService = new RescheduleService(),
    grievanceService = new GrievanceService(),
    paymentService = new PaymentService()
  } = {}) {
    this.farmerService = farmerService;
    this.bookingService = bookingService;
    this.statusService = statusService;
    this.centreService = centreService;
    this.rescheduleService = rescheduleService;
    this.grievanceService = grievanceService;
    this.paymentService = paymentService;
  }

  /**
   * Helper to collect DTMF with 3-attempt retry loop and timeout handling.
   * Matches OLD IVR retry and validation logic exactly.
   */
  async promptWithRetries(telephony, text, langManager, { maxDigits = 1, validKeys = [], validateFn = null, timeoutMs = 6000, maxRetries = 3 } = {}) {
    let attempts = 0;
    while (attempts < maxRetries) {
      if (telephony.isEnded) return null;

      await telephony.speak(text, langManager.getLanguage());
      if (telephony.isEnded) return null;

      const key = await telephony.collectDTMF(maxDigits, timeoutMs);
      if (telephony.isEnded) return null;

      if (!key) {
        attempts++;
        if (attempts >= maxRetries) {
          await telephony.speak(langManager.get('max_retries_bye'), langManager.getLanguage());
          await telephony.hangup();
          return null;
        }
        await telephony.speak(langManager.get('no_input'), langManager.getLanguage());
        continue;
      }

      if (validKeys.length > 0 && !validKeys.includes(key)) {
        attempts++;
        if (attempts >= maxRetries) {
          await telephony.speak(langManager.get('max_retries_bye'), langManager.getLanguage());
          await telephony.hangup();
          return null;
        }
        await telephony.speak(langManager.get('invalid_option'), langManager.getLanguage());
        continue;
      }

      if (typeof validateFn === 'function') {
        const valResult = validateFn(key);
        if (!valResult) {
          attempts++;
          if (attempts >= maxRetries) {
            await telephony.speak(langManager.get('max_retries_bye'), langManager.getLanguage());
            await telephony.hangup();
            return null;
          }
          await telephony.speak(langManager.get('invalid_date'), langManager.getLanguage());
          continue;
        }
        return valResult;
      }

      return key;
    }
    return null;
  }

  /**
   * Main incoming call handler for Extension 2000.
   */
  async handleCall(telephony) {
    const lang = new LanguageManager('Tamil');

    try {
      await telephony.answerCall();
      if (telephony.isEnded) return;

      console.log('[IVR 2000] CALL ANSWERED');
      console.log('[IVR 2000] WELCOME PROMPT START');
      console.log('[IVR 2000] WELCOME PROMPT COMPLETE');

      // 1. Mandatory Initial Language Selection (Tamil 1, English 2, Hindi 3)
      console.log('[IVR 2000] LANGUAGE SELECTION START');
      const initialLangPrompt = 'தமிழுக்கு 1 அழுத்தவும். Press 2 for English. हिंदी के लिए 3 दबाएं.';

      let langChoice = null;
      let attempts = 0;
      while (attempts < 3) {
        if (telephony.isEnded) return;
        console.log('[IVR 2000] LANGUAGE PROMPT PLAYED');
        console.log('[IVR 2000] WAITING FOR LANGUAGE DTMF');

        await telephony.speak(initialLangPrompt, lang.getLanguage());
        if (telephony.isEnded) return;

        langChoice = await telephony.collectDTMF(1, 6000);
        if (telephony.isEnded) return;

        if (!langChoice) {
          attempts++;
          if (attempts >= 3) {
            await telephony.speak(lang.get('max_retries_bye'), lang.getLanguage());
            await telephony.hangup();
            return;
          }
          await telephony.speak(lang.get('no_input'), lang.getLanguage());
          continue;
        }

        if (!['1', '2', '3'].includes(langChoice)) {
          attempts++;
          if (attempts >= 3) {
            await telephony.speak(lang.get('max_retries_bye'), lang.getLanguage());
            await telephony.hangup();
            return;
          }
          await telephony.speak(lang.get('invalid_option'), lang.getLanguage());
          continue;
        }

        break;
      }

      if (!langChoice || telephony.isEnded) return;

      console.log(`[IVR 2000] LANGUAGE DTMF RECEIVED: ${langChoice}`);

      if (langChoice === '1') {
        lang.setLanguage('Tamil');
      } else if (langChoice === '2') {
        lang.setLanguage('English');
      } else if (langChoice === '3') {
        lang.setLanguage('Hindi');
      }
      console.log(`[IVR 2000] LANGUAGE SELECTED: ${lang.getLanguage()}`);

      // 2. Development Test Phone Resolution (Configured in ONE place: backend/.env)
      const testPhone = getTestPhone();
      let callerNumber = telephony.getCallerNumber();
      const isInternalTestCaller = (
        !callerNumber ||
        callerNumber === '1001' ||
        callerNumber === '1000' ||
        callerNumber === 'unknown' ||
        String(callerNumber).trim().length <= 4
      );

      let effectivePhone = null;
      if (testPhone && isInternalTestCaller) {
        console.log(`[IVR 2000] Test extension (${callerNumber}) mapped to NEW_IVR_TEST_PHONE: ${maskPhone(testPhone)}`);
        effectivePhone = testPhone;
      } else {
        effectivePhone = callerNumber;
      }

      const cleanPhone = String(effectivePhone).replace(/\D/g, '').slice(-10);

      // 3. Farmer Lookup & Unregistered Caller Gate
      console.log('[IVR 2000] FARMER LOOKUP START');
      let farmerLookup;
      try {
        farmerLookup = await this.farmerService.lookupByPhone(cleanPhone);
      } catch (err) {
        console.error('[IVR 2000] ERROR: Farmer lookup failed:', err);
        await telephony.speak(lang.get('service_error'), lang.getLanguage());
        await telephony.hangup();
        return;
      }

      if (!farmerLookup || !farmerLookup.registered || !farmerLookup.farmer) {
        console.log(`[IVR 2000] Caller ${maskPhone(cleanPhone)} is NOT registered.`);
        await telephony.speak(lang.get('not_registered'), lang.getLanguage());
        await telephony.hangup();
        return;
      }

      const farmer = farmerLookup.farmer;
      const sessionToken = farmerLookup.token;
      console.log(`[IVR 2000] FARMER FOUND: ${farmer.name} / ${farmer.farmer_id}`);

      // 4. Farmer Details Spoken & Identity Confirmation (Matches OLD IVR in Selected Language)
      // Tamil: "வணக்கம் [Name]. உழவர் எண் [ID]. தொடர 1 அழுத்தவும். தவறென்றால் 2 அழுத்தவும்."
      // English: "Welcome [Name]. Farmer ID [ID]. Press 1 to continue. Press 2 if this is incorrect."
      // Hindi: "नमस्ते [Name]। किसान आईडी [ID]। आगे बढ़ने के लिए 1 दबाएं। गलत होने पर 2 दबाएं।"
      console.log('[IVR 2000] IDENTITY PROMPT START');
      console.log('[IVR 2000] WAITING FOR IDENTITY CONFIRMATION');

      const confirmPrompt = lang.get('welcome_confirm', {
        name: farmer.name || 'Farmer',
        id: farmer.farmer_id
      });

      const confirmKey = await this.promptWithRetries(telephony, confirmPrompt, lang, {
        maxDigits: 1,
        validKeys: ['1', '2'],
        timeoutMs: 6000
      });

      if (!confirmKey || telephony.isEnded) return;

      console.log(`[IVR 2000] IDENTITY DTMF RECEIVED: ${confirmKey}`);

      if (confirmKey === '2') {
        console.log('[IVR 2000] Caller indicated identity mismatch (pressed 2). Terminating call.');
        await telephony.speak(lang.get('not_you_bye'), lang.getLanguage());
        await telephony.hangup();
        return;
      }

      console.log(`[IVR 2000] Identity confirmed by caller for farmer ${farmer.farmer_id}`);
      console.log('[IVR 2000] MAIN MENU START');

      // 5. Main Menu Loop (Exact OLD IVR 9-Option Menu in Selected Language)
      let inCall = true;
      while (inCall && !telephony.isEnded) {
        const menuKey = await this.promptWithRetries(telephony, lang.get('main_menu'), lang, {
          maxDigits: 1,
          validKeys: ['1', '2', '3', '4', '5', '6', '7', '8', '9'],
          timeoutMs: 6000
        });

        if (!menuKey || telephony.isEnded) break;

        console.log(`[IVR 2000] Main Menu selection received: ${menuKey}`);

        switch (menuKey) {
          case '1':
            // Difference 3: One-Press Booking using OLD IVR business logic
            await this.handleOnePressBooking(telephony, farmer, sessionToken, lang);
            break;
          case '2':
          case '7':
            // Booking Status & Digital Pass Details
            await this.handleBookingStatusAndPass(telephony, farmer, sessionToken, lang);
            break;
          case '3':
            // Centre Status
            await this.handleCentreStatus(telephony, farmer, sessionToken, lang);
            break;
          case '4':
            // Reschedule
            await this.handleReschedule(telephony, farmer, sessionToken, lang);
            break;
          case '5':
            // Grievance
            await this.handleGrievance(telephony, farmer, sessionToken, lang);
            break;
          case '6':
            // Payment Status
            await this.handlePaymentStatus(telephony, farmer, sessionToken, lang);
            break;
          case '8':
            // Repeat menu
            break;
          case '9':
            // End call
            inCall = false;
            await telephony.speak(lang.get('call_ended'), lang.getLanguage());
            await telephony.hangup();
            break;
        }
      }
    } catch (err) {
      console.error('[NEW-IVR] Unexpected call error:', err);
      try {
        if (!telephony.isEnded) {
          await telephony.speak(lang.get('service_error'), lang.getLanguage());
          await telephony.hangup();
        }
      } catch (_) {}
    }
  }

  /**
   * Menu 1: ONE-PRESS BOOKING
   * Uses the EXACT OLD IVR business rules:
   * 1. Single Active Booking Rule check
   * 2. Available centres in farmer's district (excluding Closed & Retired)
   * 3. Nearest centres ranking via Haversine distance, village match, capacity
   * 4. Available slots for target date (earliest open slot)
   * 5. Atomically creates booking and speaks confirmation in chosen language
   */
  async handleOnePressBooking(telephony, farmer, token, lang) {
    console.log(`[NEW-IVR] Executing One-Press Booking for farmer ${farmer.farmer_id} in ${farmer.district}...`);

    // Step A: One Active Booking Rule (With Canonical Expired Booking Exemption)
    const activeData = await this.bookingService.checkActiveBooking(farmer.farmer_id, token);
    if (activeData && activeData.has_active_booking && activeData.active_booking) {
      const b = activeData.active_booking;
      const bDate = b.booking_date ? String(b.booking_date).slice(0, 10) : '';

      console.log(`[NEW-IVR] Active booking detected for farmer ${farmer.farmer_id}: #${b.booking_id}`);
      await telephony.speak(lang.get('already_booked', {
        centre: b.centre_name || b.centre_id,
        date: bDate,
        status: b.status
      }), lang.getLanguage());

      const opt = await this.promptWithRetries(telephony, lang.get('already_booked_options'), lang, {
        maxDigits: 1,
        validKeys: ['1', '2', '3']
      });

      if (opt === '1') {
        await this.handleBookingStatusAndPass(telephony, farmer, token, lang);
      } else if (opt === '2') {
        await this.handleReschedule(telephony, farmer, token, lang);
      }
      return;
    } else if (activeData && activeData.has_expired_booking && activeData.expired_booking) {
      console.log(`[NEW-IVR] Farmer ${farmer.farmer_id} has expired booking #${activeData.expired_booking.booking_id}. Announcing expiry and proceeding with new booking.`);
      await telephony.speak(lang.get('booking_expired_notice'), lang.getLanguage());
    }

    // Step B & C & D: Find earliest valid slot across valid dates using Canonical Recommendation Logic
    const validDates = getValidBookingDates();
    let selectedCentre = null;
    let allocatedSlot = null;
    let chosenDateStr = null;
    let chosenDateLabel = null;

    // Search across candidate dates using the shared canonical recommendation service
    for (const dateObj of validDates) {
      try {
        const recData = await this.bookingService.getRecommendations({
          district: farmer.district,
          date: dateObj.dateStr,
          farmer_id: farmer.farmer_id
        }, token);

        if (recData && recData.recommended_centre && recData.recommended_centre.has_available_slots) {
          const rec = recData.recommended_centre;
          if (rec.available_slots && rec.available_slots.length > 0) {
            selectedCentre = rec;
            allocatedSlot = rec.available_slots[0];
            chosenDateStr = dateObj.dateStr;
            chosenDateLabel = dateObj.label;
            break;
          }
        }
      } catch (recErr) {
        console.warn(`[NEW-IVR] Recommendation lookup failed for ${dateObj.dateStr}:`, recErr.message);
      }
    }

    // Fallback: If no single recommended centre had open slots, check alternatives
    if (!allocatedSlot) {
      for (const dateObj of validDates) {
        try {
          const recData = await this.bookingService.getRecommendations({
            district: farmer.district,
            date: dateObj.dateStr,
            farmer_id: farmer.farmer_id
          }, token);

          if (recData && recData.alternatives && recData.alternatives.length > 0) {
            for (const alt of recData.alternatives) {
              if (alt.has_available_slots && alt.available_slots && alt.available_slots.length > 0) {
                selectedCentre = alt;
                allocatedSlot = alt.available_slots[0];
                chosenDateStr = dateObj.dateStr;
                chosenDateLabel = dateObj.label;
                break;
              }
            }
          }
          if (allocatedSlot) break;
        } catch (_) {}
      }
    }

    if (!allocatedSlot || !selectedCentre) {
      console.warn(`[NEW-IVR] No valid upcoming slots available in ${farmer.district}.`);
      await telephony.speak(lang.get('no_slots_available'), lang.getLanguage());
      return;
    }

    console.log(`[NEW-IVR] Canonical recommended centre selected: ${selectedCentre.centre_name} (${selectedCentre.centre_id}, distance: ${selectedCentre.road_distance_km} km) on ${chosenDateStr} (${chosenDateLabel})`);
    // Check if caller hung up before committing the booking
    if (telephony.isEnded) {
      console.log(`[NEW-IVR] Caller hung up before booking confirmation. Aborting booking.`);
      return;
    }

    // Step E: Create Booking via Authoritative Backend API with Unique Per-Call Idempotency Key
    const idempotencyKey = `IVR_2000_${farmer.farmer_id}_${chosenDateStr}_${Date.now()}`;
    const bookResult = await this.bookingService.createBooking({
      farmer_id: farmer.farmer_id,
      slot_id: allocatedSlot.slot_id,
      centre_id: selectedCentre.centre_id,
      district: farmer.district,
      booking_date: chosenDateStr,
      crop: farmer.primary_crop || 'Paddy (Common)',
      quantity_quintals: 50,
      idempotency_key: idempotencyKey,
      booking_source: 'IVR'
    }, token);

    // If caller hung up during API call, transaction safely committed in DB
    if (telephony.isEnded) {
      console.log(`[NEW-IVR] Caller disconnected during booking confirmation for farmer ${farmer.farmer_id}. Booking state safely preserved.`);
      return;
    }

    const createdBookingId = bookResult.data?.booking_id || bookResult.data?.booking?.booking_id;
    if (bookResult.ok && createdBookingId && !bookResult.data?.error) {
      console.log(`[NEW-IVR] Booking confirmed successfully! Booking ID: #${createdBookingId}`);
      // Speak confirmation in selected language!
      await telephony.speak(lang.get('booking_confirmed_sms', {
        date: chosenDateLabel,
        centre: selectedCentre.centre_name
      }), lang.getLanguage());
    } else {
      console.warn('[NEW-IVR] Booking creation failed:', bookResult.data);
      const errMsg = bookResult.data?.message || lang.get('service_error');
      await telephony.speak(errMsg, lang.getLanguage());
    }
  }

  /**
   * Menu 2 & 7: Booking Status & Digital Pass Details (Exact OLD IVR)
   */
  async handleBookingStatusAndPass(telephony, farmer, token, lang) {
    const activeData = await this.bookingService.checkActiveBooking(farmer.farmer_id, token);
    if (!activeData || !activeData.has_active_booking || !activeData.active_booking) {
      await telephony.speak(lang.get('no_active_booking'), lang.getLanguage());
      return;
    }

    const b = activeData.active_booking;
    const passResp = await this.statusService.getDigitalPass(b.booking_id, token);
    const pass = passResp.pass || passResp;

    const rawDate = pass.slot_date || pass.booking_date || b.booking_date;
    const bDate = rawDate ? String(rawDate).slice(0, 10) : 'scheduled date';
    const rawPacing = pass.pacing?.pacing_status || passResp.pacing?.pacing_status || pass.pacing_status || 'NORMAL';
    const wait = pass.live_estimated_wait_minutes || pass.estimated_wait_minutes || 15;

    let pacingAdvisory = 'Normal operations on time';
    if (rawPacing === 'BUSY' || rawPacing === 'SLOW') {
      pacingAdvisory = 'High volume, minor delay';
    } else if (rawPacing === 'PAUSED' || rawPacing === 'STOPPED') {
      pacingAdvisory = 'Temporarily paused';
    }

    await telephony.speak(lang.get('booking_status', {
      centre: pass.centre_name || pass.centre_id,
      date: bDate,
      token: pass.token || ('Q' + (pass.queue_position_at_booking || pass.queue_position || '1')),
      status: pass.status,
      wait: wait,
      pacing: pacingAdvisory
    }), lang.getLanguage());
  }

  /**
   * Menu 3: Centre Status (Exact OLD IVR)
   */
  async handleCentreStatus(telephony, farmer, token, lang) {
    const centres = await this.bookingService.getAvailableCentres(farmer.district, token);
    if (!centres || centres.length === 0) {
      await telephony.speak(lang.get('no_centres_available'), lang.getLanguage());
      return;
    }

    const targetCentre = centres[0];
    const pacing = await this.centreService.getCentrePacing(targetCentre.centre_id, token);
    const queue = pacing.active_queue_count || 0;
    const pStatus = (pacing.pacing_status || 'NORMAL').toUpperCase();

    if (pStatus === 'BUSY' || pStatus === 'SLOW') {
      await telephony.speak(lang.get('centre_status_busy', {
        centre: targetCentre.centre_name,
        queue
      }), lang.getLanguage());
    } else if (pStatus === 'PAUSED' || pStatus === 'STOPPED') {
      await telephony.speak(lang.get('centre_status_paused', {
        centre: targetCentre.centre_name,
        queue
      }), lang.getLanguage());
    } else {
      await telephony.speak(lang.get('centre_status_normal', {
        centre: targetCentre.centre_name,
        queue
      }), lang.getLanguage());
    }
  }

  /**
   * Menu 4: Reschedule Booking (Exact OLD IVR)
   */
  async handleReschedule(telephony, farmer, token, lang) {
    const activeData = await this.bookingService.checkActiveBooking(farmer.farmer_id, token);
    if (!activeData || !activeData.has_active_booking || !activeData.active_booking) {
      await telephony.speak(lang.get('no_active_booking'), lang.getLanguage());
      return;
    }

    const bookingId = activeData.active_booking.booking_id;
    const suggData = await this.rescheduleService.getSuggestions(bookingId, token);

    const alt = (suggData.alternative_slots && suggData.alternative_slots[0]) ||
                (suggData.nearby_centres && suggData.nearby_centres[0]?.slots && suggData.nearby_centres[0].slots[0]);

    if (!alt) {
      await telephony.speak(lang.get('no_reschedule_options'), lang.getLanguage());
      return;
    }

    const newDate = alt.date || String(alt.slot_date).slice(0, 10);
    const newSlotTime = alt.start_time ? `${alt.start_time.slice(0, 5)} - ${alt.end_time.slice(0, 5)}` : 'Standard';
    const newCentreName = alt.centre_name || activeData.active_booking.centre_name;
    const newCentreId = alt.centre_id || activeData.active_booking.centre_id;

    const opt = await this.promptWithRetries(telephony, lang.get('reschedule_intro', {
      centre: newCentreName,
      date: newDate,
      slot: newSlotTime
    }), lang, { maxDigits: 1, validKeys: ['1', '2'] });

    if (opt === '1') {
      const res = await this.rescheduleService.executeReschedule(bookingId, {
        decision: 'ACCEPT',
        new_slot_id: alt.slot_id,
        new_centre_id: newCentreId
      }, token);

      if (res.ok) {
        await telephony.speak(lang.get('reschedule_success', { date: newDate, slot: newSlotTime }), lang.getLanguage());
      } else {
        await telephony.speak(res.data?.message || lang.get('service_error'), lang.getLanguage());
      }
    } else {
      await this.rescheduleService.executeReschedule(bookingId, { decision: 'REJECT' }, token);
      await telephony.speak(lang.get('reschedule_rejected'), lang.getLanguage());
    }
  }

  /**
   * Menu 5: Raise Grievance (Exact OLD IVR)
   */
  async handleGrievance(telephony, farmer, token, lang) {
    const activeData = await this.bookingService.checkActiveBooking(farmer.farmer_id, token);
    const bookingId = activeData?.active_booking?.booking_id || null;
    const centreId = activeData?.active_booking?.centre_id || 'TN_DPC_0001';

    const catKey = await this.promptWithRetries(telephony, lang.get('grievance_menu'), lang, {
      maxDigits: 1,
      validKeys: ['1', '2', '3', '4']
    });
    if (!catKey || telephony.isEnded) return;

    const res = await this.grievanceService.submitGrievance({
      farmer_id: farmer.farmer_id,
      booking_id: bookingId,
      centre_id: centreId,
      categoryKey: catKey
    }, token);

    if (res.ok) {
      await telephony.speak(lang.get('grievance_success', { ticket: res.data?.grievance_id }), lang.getLanguage());
    } else {
      await telephony.speak(res.data?.message || lang.get('service_error'), lang.getLanguage());
    }
  }

  /**
   * Menu 6: Payment Status (Exact OLD IVR)
   */
  async handlePaymentStatus(telephony, farmer, token, lang) {
    const activeData = await this.bookingService.checkActiveBooking(farmer.farmer_id, token);
    if (!activeData || !activeData.has_active_booking || !activeData.active_booking) {
      await telephony.speak(lang.get('no_active_booking'), lang.getLanguage());
      return;
    }

    const bookingId = activeData.active_booking.booking_id;
    const payData = await this.paymentService.getPaymentStatus(bookingId, token);

    if (payData.available && payData.payment) {
      const p = payData.payment;
      await telephony.speak(lang.get('payment_status', {
        amount: p.net_payable_inr || p.gross_payable_inr || 0,
        status: p.payment_status || 'Pending',
        method: p.payment_method || 'DBT Bank Transfer'
      }), lang.getLanguage());
    } else {
      await telephony.speak(lang.get('payment_unavailable'), lang.getLanguage());
    }
  }
}

/**
 * FastAGI TCP Server for Extension 2000 on Port 4574
 */
class NewFastAgiServer {
  constructor({ port = 4574, host = '0.0.0.0' } = {}) {
    this.port = port;
    this.host = host;
    this.app = new NewIvrApp();
    this.server = null;
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        socket.on('error', (err) => {
          // Gracefully handle socket errors (ECONNRESET, EPIPE, etc.)
          console.warn('[IVR 2000] Socket error (ignored):', err.code || err.message);
        });

        let headersBuffer = '';
        let headersParsed = false;
        const headers = {};

        const onData = (chunk) => {
          if (headersParsed) return;
          headersBuffer += chunk.toString('utf8');

          const headerEnd = headersBuffer.indexOf('\n\n');
          if (headerEnd !== -1) {
            headersParsed = true;
            socket.removeListener('data', onData);

            const headerLines = headersBuffer.slice(0, headerEnd).split('\n');
            for (const line of headerLines) {
              const colon = line.indexOf(':');
              if (colon !== -1) {
                const key = line.slice(0, colon).trim();
                const val = line.slice(colon + 1).trim();
                headers[key] = val;
              }
            }

            const leftover = headersBuffer.slice(headerEnd + 2);
            console.log(`[IVR 2000] CALL RECEIVED from ${maskPhone(headers.agi_callerid || 'unknown')} (channel: ${headers.agi_channel || 'unknown'})`);

            const adapter = new AsteriskAdapter(socket, headers);
            if (leftover.length > 0) {
              adapter.buffer = leftover;
              adapter._processBuffer();
            }

            this.app.handleCall(adapter).catch((err) => {
              console.error('[IVR 2000] ERROR in handleCall:', err);
              adapter.hangup().catch(() => {});
            });
          }
        };

        socket.on('data', onData);
      });

      this.server.on('error', (err) => {
        console.error('[NEW-IVR] FastAGI Server error:', err);
        reject(err);
      });

      this.server.listen(this.port, this.host, () => {
        console.log(`[NEW-IVR] FastAGI Server listening on ${this.host}:${this.port}`);
        console.log(`[NEW-IVR] Extension 2000 is ready for MicroSIP calls`);
        resolve();
      });
    });
  }

  stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log('[NEW-IVR] FastAGI Server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

if (require.main === module) {
  const srv = new NewFastAgiServer({ port: 4574, host: '0.0.0.0' });
  srv.start().catch((err) => {
    console.error('[NEW-IVR] Fatal startup error:', err);
    process.exit(1);
  });
}

module.exports = { NewFastAgiServer, NewIvrApp, getTestPhone };
