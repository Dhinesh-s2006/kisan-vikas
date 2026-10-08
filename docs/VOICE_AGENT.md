# Kisan Voice AI Agent — Architecture & Integration Guide

The **Kisan Voice AI Agent** (Uzhavarsethu Voice Assistant) is an isolated, production-grade, voice-first accessibility layer enabling Tamil Nadu farmers to reserve harvest procurement weighment appointments, inspect queue waiting times, track Direct Benefit Transfer (DBT) payments, retrieve digital passes, and submit grievances via natural conversational speech or text in **Tamil (`ta-IN`)** and **English (`en-IN`)**.

---

## 1. Architectural Overview & System Flow

```
┌────────────────────────────────────────────────────────────────────────┐
│                        FARMER USER INTERFACE                           │
│  - Browser Microphone (MediaRecorder, WebM/WAV)                        │
│  - Real-time Visual Audio Indicator (Listening / Processing / Speaking)│
│  - Independent Chat Log (ARIA live="polite", WCAG 2.1 AA compliant)    │
│  - Full Text Chat Fallback (Never disabled or replaced)                │
└──────────────────┬─────────────────────────────────▲───────────────────┘
                   │ Audio Stream                    │ Assistant Audio
                   ▼                                 │ (Browser TTS)
┌──────────────────────────────────────┐             │
│ POST /api/voice-agent/transcribe     │             │
│  - Sarvam STT Speech-to-Text         │             │
│  - 400-byte Credit Protection Guard  │             │
│  - voiceRequestId Idempotency Cache  │             │
└──────────────────┬───────────────────┘             │
                   │ Transcript                      │
                   ▼                                 │
┌──────────────────────────────────────┐             │
│ POST /api/voice-agent/understand     │             │
│  - Authenticated via Farmer JWT      │             │
│  - Strict Multi-Tenant Isolation     │             │
└──────────┬───────────────────────────┘             │
           │                                         │
     ┌─────┴───────────────────────┐                 │
     ▼                             ▼                 │
┌───────────────────────┐ ┌───────────────────────┐  │
│ Primary: Gemini NLU   │ │ Offline Fallback:     │  │
│  - Structured JSON    │ │ FallbackRuleProvider  │  │
│  - Context-anchored   │ │  - Deterministic      │  │
│  - 15s Spike Timeout  │ │  - Zero-API Demo Mode │  │
└──────────┬────────────┘ └──────────┬────────────┘  │
           │                         │               │
           └───────────┬─────────────┘               │
                       │ Extracted Intent & Entities │
                       ▼                             │
┌──────────────────────────────────────────────────┐ │
│ Kisan Queue Backend Verification & Data Grounding│ │
│  - Active Booking Lookup (bookings table)        │ │
│  - Real Slots Availability (slots table)         │ │
│  - Dynamic Queue Wait Time (current_date queue)  │ │
│  - DBT Payments Records (procurement_payments)   │ │
│  - Grievance Redressal (grievances table)        │ │
│  - Operational Centre Details (centres table)    │ │
│  - ZERO unconfirmed DB mutations during queries  │ │
└──────────────────────┬───────────────────────────┘ │
                       │ Verified Grounded Reply     │
                       └─────────────────────────────┘
```

---

## 2. Architectural Principles & Safety Guarantees

1. **Zero Database Regressions & Mutation Safety**:
   - The AI agent **never** writes directly to PostgreSQL during informational queries or intent processing.
   - All appointment reservations go through the existing, ACID-compliant booking engine (`POST /api/bookings`) with advisory concurrency locking (`pg_advisory_xact_lock`), fair-access quotas, and token assignment (`QXXX`).
2. **Strict Farmer Isolation & Identity Derivation**:
   - The farmer's identity is derived **strictly from the verified JWT** (`req.user.farmerId`), completely preventing tenant cross-talk or identity spoofing.
   - Farmer A cannot query, view, or modify Farmer B's bookings, payment records, or grievances.
3. **Credit Protection & Idempotent Deduplication**:
   - Pre-flight audio validation drops silent, corrupted, or micro-recordings (< 400 bytes) immediately with HTTP 400 before consuming Sarvam STT credits.
   - The `SpeechService` deduplication cache tracks in-flight and completed `voiceRequestId` keys, guaranteeing that network retries never burn external credits.
4. **Resilient Multi-Tier Provider Fallback**:
   - Primary: Google Gemini (`gemini-2.5-flash-lite`).
   - Offline / Emergency: `FallbackRuleProvider` (100% deterministic regex rule engine).
   - Upstream API spikes or timeouts (15s) fail over to offline rules seamlessly with zero user-facing 500 errors.
5. **Universal Accessibility (WCAG 2.1 AA Compliant)**:
   - High color contrast ratio (minimum 4.5:1 for normal text, 3:1 for large controls).
   - Generous touch targets (minimum 44x44px for microphone and primary buttons).
   - Native browser Text-to-Speech (TTS) with language-aware speech cleansing and instant interrupt cancellation.
   - Screen-reader friendly ARIA live regions (`role="log"`, `aria-live="polite"`).

---

## 3. Endpoints Specification

### 1. `GET /api/voice-agent/health`
- **Access**: Public
- **Description**: Returns operational status of configured speech and NLU engines without leaking credentials.
- **Sample Response**:
```json
{
  "status": "ok",
  "service": "Kisan Voice AI Agent",
  "voiceAgent": true,
  "speechProvider": "sarvam",
  "speechConfigured": true,
  "speechModel": "saarika:v2",
  "nluProvider": "gemini",
  "fallbackAvailable": true
}
```

### 2. `POST /api/voice-agent/transcribe`
- **Access**: Authenticated (`Authorization: Bearer <jwt_token>`, Role: `FARMER`)
- **Headers**: `Content-Type: application/json`
- **Request Body**:
```json
{
  "audio": "data:audio/webm;base64,GkXfo59ChoEBQveBAULygQ8...",
  "mimeType": "audio/webm",
  "language": "ta-IN",
  "voiceRequestId": "VR-1790262144-abc123"
}
```
- **Response**:
```json
{
  "success": true,
  "transcript": "எனக்கு 20 குவிண்டால் நெல் உள்ளது அரியலூர் அய்யூர் மையத்தில் முன்பதிவு செய்ய வேண்டும்",
  "language": "ta",
  "voiceRequestId": "VR-1790262144-abc123",
  "is_cached": false
}
```

### 3. `POST /api/voice-agent/understand`
- **Access**: Authenticated (`Authorization: Bearer <jwt_token>`, Role: `FARMER`)
- **Headers**: `Content-Type: application/json`
- **Request Body**:
```json
{
  "text": "What is the payment status of my paddy procurement?",
  "conversationHistory": [
    { "role": "user", "content": "Vanakkam" },
    { "role": "assistant", "content": "Vanakkam! I am your Kisan Voice Assistant..." }
  ],
  "currentBookingState": {}
}
```
- **Response**:
```json
{
  "status": "success",
  "intent": "CHECK_PAYMENT_STATUS",
  "entities": {
    "farmer": null,
    "crop": "Paddy (Grade A)",
    "quantity_quintals": 10,
    "district": null,
    "centre_id": null
  },
  "assistant_reply": "For booking #B323933: Your payment of ₹22,750 for 10 quintals of Paddy (Grade A) is under process (COMPLETED) via Direct Benefit Transfer.",
  "suggested_actions": ["Download Pass", "Check Booking Status", "Help"],
  "payment_data": {
    "payment_id": "PAY-585613VXK",
    "booking_id": "B323933",
    "payment_status": "COMPLETED",
    "net_payable_inr": 22750,
    "payable_quantity_quintals": 10,
    "transaction_reference": "SIM_TXN_B323933_585613",
    "payment_method": "DBT_SIMULATED"
  },
  "farmer_id": "F219265",
  "provider_used": "gemini",
  "confidence": 0.95
}
```

---

## 4. Intent Spectrum Supported

The Voice Agent implements 17 distinct conversational intents:

| Intent | Description | Connected Data Source |
| :--- | :--- | :--- |
| `BOOK_SLOT` | Reserve an arrival slot for harvest delivery | `centres`, `slots`, `bookings` |
| `CHECK_BOOKING_STATUS` | Check active or historical booking status & token | `bookings`, `centres`, `slots` |
| `QUERY_STATUS` | General queue position and truck tracking | `bookings`, live queue count |
| `GET_BOOKING_PASS` | Access digital entry pass with QR code & token | `bookings` join with token |
| `CHECK_PAYMENT_STATUS` | Check net payable amount, DBT status, and transaction ID | `procurement_payments` |
| `CHECK_PROCUREMENT_STATUS` | Check moisture %, quality grade, net weight, receipt | `procurement_weighments`, `procurement_quality` |
| `GET_WAITING_TIME` | Check live queue count and wait time in minutes | Dynamic calculation from active bookings |
| `CHECK_SLOT_AVAILABILITY` | View available vs total slots for a centre and date | `slots` table |
| `FIND_CENTRE` | Find Direct Procurement Centres in a district | `centres` table |
| `GET_CENTRE_INFORMATION` | Check operational status, operating hours, capacity | `centres` table |
| `RAISE_GRIEVANCE` | File a complaint (weighment delay, payment, staff, facility) | `grievances` schema |
| `CHECK_GRIEVANCE` | Track resolution status of submitted grievance tickets | `grievances` table |
| `RESCHEDULE_BOOKING` | Reschedule active appointment to a new date/slot | `bookings`, `slots` |
| `CANCEL_BOOKING` | Cancel active appointment to free slot for other farmers | `bookings` |
| `HELP` | Provide guided instructions on what the assistant can do | Static guide |
| `REPEAT` | Repeat the last spoken prompt or assistant reply | In-memory turn buffer |
| `GO_BACK` | Undo the last turn and edit previous fields | Conversation draft |

---

## 5. Master Regression Test Matrix

All 188 automated test assertions pass with 100% green:

| Test Suite | File | Tests | Status |
| :--- | :--- | :---: | :---: |
| **Phase 3**: Frontend Voice Client & STT Service | `backend/scripts/test_phase3_voice_frontend.js` | 18 | **PASSED** |
| **Phase 4**: STT Transcript to Gemini NLU | `backend/scripts/test_phase4_transcript_to_nlu.js` | 15 | **PASSED** |
| **Phase 5**: Intent Spectrum & Multi-Turn State Retention | `backend/scripts/test_phase5_intents_state.js` | 46 | **PASSED** |
| **Phase 6**: Database & Backend API Connections | `backend/scripts/test_phase6_api_connections.js` | 54 | **PASSED** |
| **Phase 7**: Backend Grounding & Browser TTS | `backend/scripts/test_phase7_tts_grounding.js` | 21 | **PASSED** |
| **Phase 9**: Fallback, Deduplication & Isolation | `backend/scripts/test_phase9_fallback_dedup.js` | 34 | **PASSED** |
| **GRAND TOTAL** | `backend/scripts/run_all_voice_agent_tests.js` | **188** | **100% PASSED** |

### Execution Commands:

Run the master test runner across all phases:
```powershell
node backend/scripts/run_all_voice_agent_tests.js
```

Verify frontend build:
```powershell
cd frontend && npm run build
```
