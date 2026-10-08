import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import API from '../api';
import {
  Card,
  PrimaryButton,
  SecondaryButton,
  AlertBanner,
  StatusBadge,
  Icon,
  formatHumanDate,
  formatHumanTime
} from '../components/design-system';

function getSupportedAudioMimeType() {
  if (typeof window === 'undefined' || typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/mp4',
    'audio/wav'
  ];
  for (const t of candidates) {
    if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) {
      return t;
    }
  }
  return '';
}

// Native Web Audio Float32 to standard 16kHz 16-bit Mono PCM WAV Blob encoder
function encodeWavBlob(samples, sampleRate) {
  let finalSamples = samples;
  const targetRate = 16000;
  if (sampleRate !== targetRate) {
    const ratio = sampleRate / targetRate;
    const newLength = Math.round(samples.length / ratio);
    finalSamples = new Float32Array(newLength);
    for (let i = 0; i < newLength; i++) {
      const srcIdx = i * ratio;
      const lo = Math.floor(srcIdx);
      const hi = Math.min(lo + 1, samples.length - 1);
      const weight = srcIdx - lo;
      finalSamples[i] = samples[lo] * (1 - weight) + samples[hi] * weight;
    }
  }

  const numChannels = 1;
  const bytesPerSample = 2; // 16-bit
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = targetRate * blockAlign;
  const dataSize = finalSamples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  function writeString(v, offset, str) {
    for (let i = 0; i < str.length; i++) {
      v.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, targetRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // 16-bit
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < finalSamples.length; i++) {
    const s = Math.max(-1, Math.min(1, finalSamples[i]));
    const int16 = s < 0 ? s * 0x8000 : s * 0x7FFF;
    view.setInt16(offset, int16, true);
    offset += 2;
  }

  return new Blob([view], { type: 'audio/wav' });
}

const UI_ACTION_REGEX = /\b(change\s+(?:the\s+)?(?:date|centre|center|slot|time)|different\s+(?:date|centre|center|slot)|another\s+(?:date|centre|center|slot)|morning\s+slot|afternoon\s+slot|evening\s+slot|select\s+slot|confirm\s+booking|find\s+nearest|book\s+now|cancel|clear|start\s+over)\b/i;

function mergeValidEntities(prevDraft, newEntities, rawInput = '') {
  const merged = { ...prevDraft };

  // 1. District
  if (newEntities?.district && typeof newEntities.district === 'string') {
    merged.district = newEntities.district;
  }

  // 2. Centre: Never allow UI action labels into centre_name or centre_id
  if (newEntities?.centre_id && typeof newEntities.centre_id === 'string' && newEntities.centre_id.startsWith('TN_DPC_')) {
    merged.centre_id = newEntities.centre_id;
    merged.centre_name = newEntities.centre_name || merged.centre_name;
    if (newEntities.district) merged.district = newEntities.district;
  } else if (newEntities?.centre_name) {
    if (!UI_ACTION_REGEX.test(newEntities.centre_name) && !merged.centre_id) {
      merged.centre_name = newEntities.centre_name;
    }
  }

  // 3. Date: Only update if a valid date is returned AND user actually intended a date
  const candidateDate = newEntities?.booking_date || newEntities?.date;
  if (candidateDate && typeof candidateDate === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(candidateDate)) {
      if (merged.booking_date !== candidateDate) {
        merged.booking_date = candidateDate;
        merged.date = candidateDate;
        if (!newEntities.slot_id) {
          merged.slot_id = '';
          merged.slot_time = '';
        }
      }
    }
  }

  // 4. Crop
  if (newEntities?.crop && typeof newEntities.crop === 'string') {
    merged.crop = newEntities.crop;
  }

  // 5. Quantity & Unit: Only update if valid positive number
  if (newEntities?.quantity_quintals !== undefined && newEntities.quantity_quintals !== null) {
    const q = parseFloat(newEntities.quantity_quintals);
    if (!isNaN(q) && q > 0 && q <= 500) {
      merged.quantity_quintals = q;
      merged.quantity = newEntities.quantity !== undefined ? parseFloat(newEntities.quantity) : q;
    }
  }
  if (newEntities?.unit && typeof newEntities.unit === 'string') {
    merged.unit = newEntities.unit;
  }

  // 6. Slot & Time
  if (newEntities?.slot_id) {
    merged.slot_id = newEntities.slot_id;
  }
  if (newEntities?.time_preference || newEntities?.time) {
    merged.time_preference = newEntities.time_preference || newEntities.time;
    merged.time = merged.time_preference;
  }

  // 7. Contextual metadata
  if (newEntities?.booking_id) {
    merged.booking_id = newEntities.booking_id;
  }
  if (newEntities?.grievance) {
    merged.grievance = newEntities.grievance;
  }
  if (newEntities?.language) {
    merged.language = newEntities.language;
  }
  if (newEntities?.farmer) {
    merged.farmer = newEntities.farmer;
  }

  return merged;
}

export default function VoiceBooking() {
  const navigate = useNavigate();

  // Authentication & Farmer identity
  const [farmerId, setFarmerId] = useState(localStorage.getItem('kisan_farmer_id') || '');
  const [farmerName, setFarmerName] = useState(localStorage.getItem('kisan_farmer_name') || '');
  const [token, setToken] = useState(localStorage.getItem('kisan_token') || '');

  // Voice & Audio synthesis state
  const [voiceEnabled, setVoiceEnabled] = useState(() => {
    return localStorage.getItem('kq_voice_enabled') !== 'false';
  });
  // Voice states: 'IDLE' | 'LISTENING' | 'PROCESSING' | 'SUCCESS' | 'ERROR'
  const [voiceState, setVoiceState] = useState('IDLE');
  const isListening = voiceState === 'LISTENING';
  const [selectedLanguage, setSelectedLanguage] = useState('ta-IN');
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [availableVoices, setAvailableVoices] = useState([]);

  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordingStartTimeRef = useRef(0);
  const lastVoiceRequestIdRef = useRef('');
  const audioContextRef = useRef(null);
  const scriptProcessorRef = useRef(null);
  const pcmChunksRef = useRef([]);

  // Chat conversation history
  const [messages, setMessages] = useState([
    {
      id: 'm1',
      sender: 'assistant',
      text: 'Vanakkam! I am your Kisan Voice Assistant. Tell me your district and crop harvest quantity to reserve your procurement slot.',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      suggestedActions: ['Book Paddy in Ariyalur', '10 Quintals', 'Check My Status']
    }
  ]);
  const [inputText, setInputText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  // Accumulated booking draft (preserved across turns)
  const [draft, setDraft] = useState({
    district: localStorage.getItem('kisan_district') || '',
    centre_id: '',
    centre_name: '',
    booking_date: '2026-09-24',
    time_preference: '',
    slot_id: '',
    slot_time: '',
    crop: 'Paddy (Common)',
    quantity_quintals: 10
  });

  // Available slots for selected centre & date
  const [availableSlots, setAvailableSlots] = useState([]);
  const [activeBooking, setActiveBooking] = useState(null);
  const [bookingSuccess, setBookingSuccess] = useState(null);
  const [bookingSubmitting, setBookingSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Scroll & Chat refs
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const messagesContainerRef = useRef(null);
  const chatEndRef = useRef(null);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);

  // Scroll event listener to detect when user scrolls up
  const handleScroll = () => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setIsUserScrolledUp(!isNearBottom);
  };

  const scrollToBottom = () => {
    const el = messagesContainerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setIsUserScrolledUp(false);
  };

  // Smart auto-scroll: only scrolls to bottom if user is near bottom or user just sent a message
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.sender === 'farmer' || !isUserScrolledUp) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
  }, [messages, isProcessing, voiceState]);

  // Load and cache browser speech synthesis voices
  useEffect(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      const updateVoices = () => {
        try {
          const v = window.speechSynthesis.getVoices();
          if (v && v.length > 0) setAvailableVoices(v);
        } catch (_) {}
      };
      updateVoices();
      window.speechSynthesis.onvoiceschanged = updateVoices;
    }
  }, []);

  // Stop speech synthesis helper
  const stopSpeaking = () => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      try {
        window.speechSynthesis.cancel();
      } catch (_) {}
    }
    setIsSpeaking(false);
  };

  // Speech synthesis helper: clean spoken output, select best voice, update speaking state
  const speakText = (textToSpeak) => {
    if (!voiceEnabled || typeof window === 'undefined' || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);

      // Clean spoken output: remove Markdown symbols, hashtags, brackets, raw underscores
      const cleanSpeakText = String(textToSpeak || '')
        .replace(/[*#`~[\]]/g, '')
        .replace(/_/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (!cleanSpeakText) return;

      const utterance = new SpeechSynthesisUtterance(cleanSpeakText);
      const isTamil = /[\u0B80-\u0BFF]/.test(cleanSpeakText) || selectedLanguage === 'ta-IN';
      const targetLang = isTamil ? 'ta-IN' : 'en-IN';
      utterance.lang = targetLang;
      utterance.rate = 0.95;
      utterance.pitch = 1.0;

      // Find matching browser voice
      if (availableVoices && availableVoices.length > 0) {
        const matchedVoice = availableVoices.find(v => v.lang === targetLang) ||
          availableVoices.find(v => v.lang && v.lang.startsWith(targetLang.slice(0, 2))) ||
          null;
        if (matchedVoice) utterance.voice = matchedVoice;
      }

      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = (e) => {
        console.warn('TTS utterance error:', e);
        setIsSpeaking(false);
      };

      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.warn('Speech synthesis error:', err);
      setIsSpeaking(false);
    }
  };

  // Toggle voice audio output
  const toggleVoice = () => {
    const nextVal = !voiceEnabled;
    setVoiceEnabled(nextVal);
    localStorage.setItem('kq_voice_enabled', nextVal ? 'true' : 'false');
    if (!nextVal) {
      stopSpeaking();
    }
  };

  // Safe MediaStream & AudioContext cleanup helper
  const cleanupMediaStream = () => {
    if (scriptProcessorRef.current) {
      try {
        scriptProcessorRef.current.disconnect();
      } catch (_) {}
      scriptProcessorRef.current = null;
    }
    if (audioContextRef.current) {
      try {
        if (audioContextRef.current.state !== 'closed') {
          audioContextRef.current.close();
        }
      } catch (_) {}
      audioContextRef.current = null;
    }
    if (mediaStreamRef.current) {
      try {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
      } catch (_) {}
      mediaStreamRef.current = null;
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupMediaStream();
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        try { mediaRecorderRef.current.stop(); } catch (_) {}
      }
      stopSpeaking();
    };
  }, []);

  // Send encoded audio blob to /api/voice-agent/transcribe
  const sendAudioForTranscription = (audioBlob, mimeType) => {
    // Client-side credit protection: discard empty / too small audio recordings (<400 bytes)
    if (!audioBlob || audioBlob.size < 400) {
      setVoiceState('ERROR');
      setErrorMsg("I couldn't hear anything. Please try again.");
      return;
    }

    setVoiceState('PROCESSING');

    // Convert audioBlob to Base64 data URL
    const reader = new FileReader();
    reader.readAsDataURL(audioBlob);
    reader.onloadend = async () => {
      const base64Audio = reader.result;
      const voiceRequestId = `VR-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
      lastVoiceRequestIdRef.current = voiceRequestId;

      try {
        const res = await API.post('/voice-agent/transcribe', {
          audio: base64Audio,
          mimeType: (audioBlob.type || mimeType || 'audio/wav').split(';')[0].trim().toLowerCase(),
          language: selectedLanguage,
          voiceRequestId
        });

        if (res.data?.success && res.data?.transcript && res.data.transcript.trim()) {
          const transcript = res.data.transcript.trim();
          setVoiceState('SUCCESS');
          setVoiceTranscript(transcript);

          // Connect speech transcript to Gemini NLU (Primary: Bhashini ASR, Fallback: Sarvam STT)
          handleUserMessage(transcript);
        } else {
          setVoiceState('ERROR');
          setErrorMsg("I couldn't hear any speech. Please try again.");
        }
      } catch (apiErr) {
        setVoiceState('ERROR');
        if (apiErr.response?.status === 400) {
          setErrorMsg("I couldn't hear anything. Please try again.");
        } else if (apiErr.response?.status === 401 || apiErr.response?.status === 403) {
          setErrorMsg("Session expired or unauthorized. Please log in again.");
        } else if (apiErr.response?.status === 429) {
          setErrorMsg("Voice service is busy right now. Please try again or type below.");
        } else if (apiErr.code === 'ECONNABORTED' || apiErr.message?.includes('timeout') || apiErr.message?.includes('Network Error')) {
          setErrorMsg("I couldn't connect to the voice service. Please try again.");
        } else {
          setErrorMsg("Voice processing is temporarily unavailable. Please try again.");
        }
      }
    };
  };

  // Browser Microphone Recording using Web Audio API (PCM 16kHz WAV) -> POST /api/voice-agent/transcribe
  const startRecording = async () => {
    stopSpeaking();
    setErrorMsg('');
    if (typeof window === 'undefined' || !navigator?.mediaDevices?.getUserMedia) {
      setErrorMsg('Microphone recording is not supported in this browser. Please type your request below.');
      setVoiceState('ERROR');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      mediaStreamRef.current = stream;
      recordingStartTimeRef.current = Date.now();
      pcmChunksRef.current = [];

      // Primary recording path: Web Audio API for 16kHz 16-bit Mono PCM WAV (Bhashini native format)
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        const audioCtx = new AudioCtx();
        audioContextRef.current = audioCtx;
        if (audioCtx.state === 'suspended') {
          await audioCtx.resume();
        }

        const source = audioCtx.createMediaStreamSource(stream);
        // ScriptProcessor with bufferSize=4096, 1 input channel, 1 output channel
        const processor = audioCtx.createScriptProcessor(4096, 1, 1);
        scriptProcessorRef.current = processor;

        processor.onaudioprocess = (e) => {
          const inputData = e.inputBuffer.getChannelData(0);
          pcmChunksRef.current.push(new Float32Array(inputData));
        };

        // Mute node prevents acoustic loopback to speakers
        const muteNode = audioCtx.createGain();
        muteNode.gain.value = 0;

        source.connect(processor);
        processor.connect(muteNode);
        muteNode.connect(audioCtx.destination);

        setVoiceState('LISTENING');
        return;
      }

      // Secondary fallback recording path: MediaRecorder
      if (typeof MediaRecorder !== 'undefined') {
        const mimeType = getSupportedAudioMimeType();
        const options = mimeType ? { mimeType } : {};
        const recorder = new MediaRecorder(stream, options);
        mediaRecorderRef.current = recorder;
        audioChunksRef.current = [];

        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            audioChunksRef.current.push(event.data);
          }
        };

        recorder.onerror = (recErr) => {
          console.warn('MediaRecorder error:', recErr);
          cleanupMediaStream();
          setVoiceState('ERROR');
          setErrorMsg('Microphone recording error. Please try again.');
        };

        recorder.start(100);
        setVoiceState('LISTENING');
      } else {
        throw new Error('Neither Web Audio API nor MediaRecorder is supported.');
      }
    } catch (err) {
      cleanupMediaStream();
      setVoiceState('ERROR');
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setErrorMsg('Microphone access is required for voice input. Please allow microphone access and try again.');
      } else {
        setErrorMsg('Could not access microphone: ' + (err.message || 'Please try again.'));
      }
    }
  };

  const stopRecording = () => {
    const durationMs = Date.now() - recordingStartTimeRef.current;

    // 1. Web Audio API recording path
    if (audioContextRef.current && scriptProcessorRef.current) {
      setVoiceState('PROCESSING');
      const sampleRate = audioContextRef.current.sampleRate;
      const chunks = pcmChunksRef.current;
      cleanupMediaStream();

      // Client-side credit protection: discard accidental taps (<400ms duration)
      if (durationMs < 400 || chunks.length === 0) {
        setVoiceState('ERROR');
        setErrorMsg("I couldn't hear anything. Please try again.");
        return;
      }

      // Merge Float32Array PCM chunks
      const totalSamples = chunks.reduce((acc, c) => acc + c.length, 0);
      const mergedSamples = new Float32Array(totalSamples);
      let offset = 0;
      for (const c of chunks) {
        mergedSamples.set(c, offset);
        offset += c.length;
      }

      // Encode into standard 16kHz 16-bit Mono PCM WAV
      const wavBlob = encodeWavBlob(mergedSamples, sampleRate);
      sendAudioForTranscription(wavBlob, 'audio/wav');
      return;
    }

    // 2. MediaRecorder fallback path
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      setVoiceState('PROCESSING');
      mediaRecorderRef.current.onstop = () => {
        cleanupMediaStream();
        if (durationMs < 400) {
          setVoiceState('ERROR');
          setErrorMsg("I couldn't hear anything. Please try again.");
          return;
        }
        const mimeType = getSupportedAudioMimeType();
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType || 'audio/webm' });
        sendAudioForTranscription(audioBlob, mimeType || 'audio/webm');
      };
      try {
        mediaRecorderRef.current.stop();
      } catch (err) {
        console.warn('Error stopping MediaRecorder:', err);
        cleanupMediaStream();
        setVoiceState('ERROR');
      }
    }
  };

  const toggleListening = () => {
    if (voiceState === 'LISTENING') {
      stopRecording();
    } else if (voiceState !== 'PROCESSING') {
      startRecording();
    }
  };

  // Explicit UI Action Dispatcher
  const handleAction = async (actionType, payload = null) => {
    setErrorMsg('');

    if (actionType === 'CHANGE_DATE') {
      setDraft(prev => {
        const next = { ...prev, booking_date: '', slot_id: '', slot_time: '' };
        draftRef.current = next;
        return next;
      });
      setAvailableSlots([]);
      const reply = draftRef.current.centre_name
        ? `What date would you like to book for delivery at ${draftRef.current.centre_name}? You can say tomorrow, 29 September, or pick a date.`
        : 'What date would you like to book? (e.g. tomorrow or 29 September)';
      setMessages(prev => [
        ...prev,
        {
          id: 'act-' + Date.now(),
          sender: 'assistant',
          text: reply,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          suggestedActions: ['Tomorrow', 'Day After Tomorrow', '29 September']
        }
      ]);
      speakText(reply);
      return;
    }

    if (actionType === 'CHANGE_CENTRE') {
      setDraft(prev => {
        const next = { ...prev, centre_id: '', centre_name: '', slot_id: '', slot_time: '' };
        draftRef.current = next;
        return next;
      });
      setAvailableSlots([]);
      const reply = `Which Direct Procurement Centre in ${draftRef.current.district || 'your district'} would you like to use?`;
      setMessages(prev => [
        ...prev,
        {
          id: 'act-' + Date.now(),
          sender: 'assistant',
          text: reply,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          suggestedActions: ['Aiyyur', 'Anaicut', 'Thirumanur']
        }
      ]);
      speakText(reply);
      return;
    }

    if (actionType === 'CHANGE_SLOT') {
      setDraft(prev => {
        const next = { ...prev, slot_id: '', slot_time: '' };
        draftRef.current = next;
        return next;
      });
      const reply = 'Please choose an arrival slot from the available time slots below.';
      setMessages(prev => [
        ...prev,
        {
          id: 'act-' + Date.now(),
          sender: 'assistant',
          text: reply,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          suggestedActions: ['Morning Slot', 'Afternoon Slot']
        }
      ]);
      speakText(reply);
      return;
    }

    if (actionType === 'SELECT_SLOT') {
      const slot = payload;
      if (!slot) return;
      setDraft(prev => {
        const next = {
          ...prev,
          slot_id: slot.slot_id,
          slot_time: `${slot.start_time} - ${slot.end_time}`
        };
        draftRef.current = next;
        return next;
      });
      const ack = `Selected arrival slot: ${slot.start_time} - ${slot.end_time} at ${draftRef.current.centre_name || 'the centre'}. Review your appointment draft and click 'Confirm Booking' to finalize.`;
      setMessages(prev => [
        ...prev,
        {
          id: 'slot-ack-' + Date.now(),
          sender: 'assistant',
          text: ack,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          suggestedActions: ['Confirm Booking', 'Change Slot', 'Change Date']
        }
      ]);
      speakText(ack);
      return;
    }

    if (actionType === 'SELECT_TIME_PREFERENCE') {
      const pref = String(payload || '').toLowerCase();
      const matched = availableSlots.find(s => {
        if (!s.available) return false;
        const hr = parseInt(s.start_time.slice(0, 2), 10);
        return pref.includes('morning') ? hr < 12 : hr >= 12;
      });
      if (matched) {
        handleAction('SELECT_SLOT', matched);
      } else {
        setDraft(prev => {
          const next = { ...prev, time_preference: pref };
          draftRef.current = next;
          return next;
        });
        const msg = `Noted: ${pref} arrival preference. Please select one of the available slots below.`;
        setMessages(prev => [
          ...prev,
          {
            id: 'pref-' + Date.now(),
            sender: 'assistant',
            text: msg,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            suggestedActions: ['Change Slot', 'Change Date']
          }
        ]);
        speakText(msg);
      }
      return;
    }

    if (actionType === 'CONFIRM_BOOKING') {
      handleExecuteBooking();
      return;
    }
  };

  // Chip click router: separates UI actions from natural language
  const handleChipClick = (actionLabel) => {
    const lower = String(actionLabel || '').toLowerCase().trim();
    if (lower === 'change date' || lower.includes('change date')) {
      handleAction('CHANGE_DATE');
    } else if (lower === 'change centre' || lower === 'change center' || lower.includes('change centre') || lower.includes('change center')) {
      handleAction('CHANGE_CENTRE');
    } else if (lower === 'change slot' || lower.includes('change slot')) {
      handleAction('CHANGE_SLOT');
    } else if (lower === 'morning slot' || lower === 'morning') {
      handleAction('SELECT_TIME_PREFERENCE', 'morning');
    } else if (lower === 'afternoon slot' || lower === 'afternoon') {
      handleAction('SELECT_TIME_PREFERENCE', 'afternoon');
    } else if (lower === 'confirm booking' || lower === 'confirm') {
      handleAction('CONFIRM_BOOKING');
    } else if (lower === 'download pass' || lower === 'view pass' || lower === 'booking pass') {
      navigate('/farmer/pass');
    } else if (lower === 'raise grievance' || lower === 'file grievance' || lower === 'submit grievance') {
      navigate('/farmer/grievances');
    } else if (lower === 'check queue' || lower === 'queue status') {
      handleUserMessage('What is the queue waiting time at the centre?');
    } else if (lower === 'reschedule slot' || lower === 'reschedule') {
      handleUserMessage('I want to reschedule my procurement booking');
    } else if (lower === 'confirm cancellation' || lower === 'cancel booking') {
      handleUserMessage('Cancel my booking');
    } else if (lower === 'check booking status' || lower === 'check my status') {
      handleUserMessage('What is my booking status?');
    } else if (lower === 'check payment' || lower === 'payment status') {
      handleUserMessage('What is my payment status?');
    } else if (lower === 'book a slot' || lower === 'book now') {
      handleUserMessage('I want to book a slot for paddy procurement');
    } else if (lower === 'find centre') {
      handleUserMessage('Where is the nearest procurement centre?');
    } else {
      // Natural language / entity value chip (e.g. 'Ariyalur', 'Anaicut', '10 Quintals', 'Tomorrow', '29 September')
      handleUserMessage(actionLabel);
    }
  };

  // Send message to backend understanding engine
  const handleUserMessage = async (userText) => {
    if (!userText || !userText.trim()) return;
    stopSpeaking();

    const trimmed = userText.trim();
    const lower = trimmed.toLowerCase();

    // Intercept action phrases in free-text / voice
    if (/^(change\s+(?:the\s+)?date|different\s+date|another\s+date)$/i.test(lower)) {
      handleAction('CHANGE_DATE');
      return;
    }
    if (/^(change\s+(?:the\s+)?centre|change\s+center|change\s+dpc|different\s+centre|another\s+centre)$/i.test(lower)) {
      handleAction('CHANGE_CENTRE');
      return;
    }
    if (/^(change\s+(?:the\s+)?slot|different\s+slot|another\s+slot)$/i.test(lower)) {
      handleAction('CHANGE_SLOT');
      return;
    }
    if (/^(confirm|yes\s+confirm|proceed|finalize|book\s+now|confirm\s+booking)$/i.test(lower)) {
      handleAction('CONFIRM_BOOKING');
      return;
    }

    const userMsgId = 'u-' + Date.now();
    const newMessages = [
      ...messages,
      {
        id: userMsgId,
        sender: 'farmer',
        text: trimmed,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }
    ];
    setMessages(newMessages);
    setInputText('');
    setIsProcessing(true);
    setErrorMsg('');

    try {
      const currentDraft = draftRef.current || draft;
      const res = await API.post('/voice-agent/understand', {
        text: trimmed,
        conversationHistory: newMessages.slice(-6).map(m => ({
          role: m.sender === 'farmer' ? 'user' : 'assistant',
          content: m.text
        })),
        currentBookingState: currentDraft
      });

      const data = res.data;

      // Update draft safely with mergeValidEntities
      if (data.entities) {
        setDraft(prev => {
          const next = mergeValidEntities(prev, data.entities, trimmed);
          draftRef.current = next;
          return next;
        });
      }

      // Update slots if returned
      if (Array.isArray(data.available_slots) && data.available_slots.length > 0) {
        setAvailableSlots(data.available_slots);
        if (data.entities?.slot_id) {
          const matched = data.available_slots.find(s => s.slot_id === data.entities.slot_id);
          if (matched) {
            setDraft(prev => {
              const next = { ...prev, slot_time: `${matched.start_time} - ${matched.end_time}` };
              draftRef.current = next;
              return next;
            });
          }
        }
      }

      // Handle active booking conflict if reported
      if (data.has_active_booking && data.active_booking) {
        setActiveBooking(data.active_booking);
      }

      // Add assistant response
      const assistantText = data.assistant_reply || 'Understood. What else would you like to set?';
      setMessages(prev => [
        ...prev,
        {
          id: 'a-' + Date.now(),
          sender: 'assistant',
          text: assistantText,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          suggestedActions: data.suggested_actions || []
        }
      ]);

      // Speak aloud
      speakText(assistantText);
    } catch (err) {
      console.error('Error contacting voice agent backend:', err);
      const errMsg = err.response?.data?.message || 'Voice assistant could not process request. Please try again.';
      setErrorMsg(errMsg);
      setMessages(prev => [
        ...prev,
        {
          id: 'err-' + Date.now(),
          sender: 'assistant',
          text: 'I apologize, I had trouble processing that. Could you please specify your district, centre, or quantity again?',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      ]);
    } finally {
      setIsProcessing(false);
    }
  };

  // Slot selection handler: delegates to explicit action
  const handleSelectSlot = (slot) => {
    handleAction('SELECT_SLOT', slot);
  };

  // Final booking execution through existing standard POST /api/bookings
  const handleExecuteBooking = async () => {
    if (!draft.district || !draft.centre_id || !draft.booking_date || !draft.slot_id) {
      setErrorMsg('Please select a centre, date, and slot time before confirming.');
      return;
    }

    try {
      setBookingSubmitting(true);
      setErrorMsg('');
      const bookingId = 'B' + Date.now().toString().slice(-6);

      const payload = {
        booking_id: bookingId,
        farmer_id: farmerId || localStorage.getItem('kisan_farmer_id'),
        slot_id: draft.slot_id,
        centre_id: draft.centre_id,
        district: draft.district,
        booking_date: draft.booking_date,
        crop: draft.crop || 'Paddy (Common)',
        quantity_quintals: parseFloat(draft.quantity_quintals) || 10,
        msp_rate_inr: 2275,
        booking_source: 'VOICE_AGENT'
      };

      const res = await API.post('/bookings', payload);

      setBookingSuccess({
        ...res.data,
        district: draft.district,
        centre_name: draft.centre_name || draft.centre_id,
        slot_time: draft.slot_time,
        crop: draft.crop,
        quantity: draft.quantity_quintals
      });

      const successReply = `Congratulations! Your procurement slot is confirmed. Your queue token is ${res.data.token || res.data.queue_number || res.data.booking_id}. Your Digital Pass is ready.`;
      setMessages(prev => [
        ...prev,
        {
          id: 'success-' + Date.now(),
          sender: 'assistant',
          text: successReply,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      ]);
      speakText(successReply);
    } catch (err) {
      console.error('Booking confirmation failed:', err);
      if (err.response?.status === 409 && err.response?.data?.code === 'farmer_has_active_booking') {
        setActiveBooking(err.response.data.active_booking);
        setErrorMsg('You already hold an active booking. Farmers may only hold one active slot at a time.');
      } else {
        setErrorMsg(err.response?.data?.message || 'Failed to submit booking. Please try another slot.');
      }
    } finally {
      setBookingSubmitting(false);
    }
  };

  const estimatedPayout = (parseFloat(draft.quantity_quintals) || 0) * 2275;
  const isReadyToConfirm = Boolean(
    draft.district &&
    draft.centre_id &&
    draft.booking_date &&
    draft.slot_id &&
    draft.quantity_quintals > 0 &&
    !activeBooking &&
    !bookingSuccess
  );

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', paddingBottom: 40 }}>
      {/* Page Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 12,
        marginBottom: 20
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              display: 'inline-flex',
              padding: '4px 8px',
              backgroundColor: 'var(--kq-green-100)',
              color: 'var(--kq-green-900)',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 700
            }}>
              <Icon name="sparkles" size={14} style={{ marginRight: 4 }} />
              AI ASSISTANT
            </span>
            <h1 className="kq-title-page" style={{ fontSize: 24, margin: 0 }}>
              Kisan Voice Assistant
            </h1>
          </div>
          <p className="kq-text-muted" style={{ margin: '4px 0 0 0', fontSize: 13.5 }}>
            Reserve procurement weighment slots by speaking or typing naturally in English.
          </p>
        </div>

        {/* Language Selection & Audio Output Toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--kq-text-muted)' }}>Language:</span>
            <select
              value={selectedLanguage}
              onChange={(e) => setSelectedLanguage(e.target.value)}
              style={{
                height: 36,
                padding: '0 8px',
                borderRadius: 6,
                border: '1px solid var(--kq-border)',
                backgroundColor: '#ffffff',
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--kq-text-primary)',
                cursor: 'pointer'
              }}
              aria-label="Select voice language"
            >
              <option value="ta-IN">தமிழ் (Tamil)</option>
              <option value="en-IN">English</option>
            </select>
          </div>

          <button
            type="button"
            onClick={toggleVoice}
            className={`kq-btn ${voiceEnabled ? 'kq-btn-secondary' : 'kq-btn-ghost'}`}
            style={{
              height: 36,
              fontSize: 13,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6
            }}
            title={voiceEnabled ? 'Voice responses active (Click to mute)' : 'Voice responses muted (Click to unmute)'}
          >
            <Icon name={voiceEnabled ? 'volume-2' : 'volume-x'} size={16} color={voiceEnabled ? 'var(--kq-green-700)' : 'var(--kq-text-muted)'} />
            <span>{voiceEnabled ? 'Voice On' : 'Voice Off'}</span>
          </button>

          <Link to="/farmer/book" className="kq-btn kq-btn-ghost" style={{ height: 36, fontSize: 13, textDecoration: 'none' }}>
            Standard Form
          </Link>
        </div>
      </div>

      {/* Active Booking Banner Alert */}
      {activeBooking && (
        <AlertBanner
          type="warning"
          title="Active Booking Detected"
          message={`You have an active appointment #${activeBooking.booking_id} at ${activeBooking.centre_name || activeBooking.centre_id} on ${formatHumanDate(activeBooking.booking_date)}. To maintain fair access, only one active booking is permitted per farmer.`}
          action={
            <Link to="/farmer/status" className="kq-btn kq-btn-secondary" style={{ height: 32, fontSize: 12, textDecoration: 'none' }}>
              View My Pass
            </Link>
          }
          style={{ marginBottom: 20 }}
        />
      )}

      {/* General Error Banner */}
      {errorMsg && (
        <AlertBanner
          type="error"
          title="Notice"
          message={errorMsg}
          onClose={() => setErrorMsg('')}
          style={{ marginBottom: 20 }}
        />
      )}

      {/* Two Column Layout: Conversation on left, Live Draft on right (Stacks cleanly on mobile) */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
        gap: 20,
        alignItems: 'start'
      }}>

        {/* Left Column: Dedicated Scrollable Conversational Card */}
        <div
          className="kq-card"
          style={{
            padding: 0,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            height: 620,
            maxHeight: 'calc(100vh - 180px)',
            minHeight: 480,
            position: 'relative'
          }}
        >
          {/* Chat Header */}
          <div style={{
            padding: '12px 18px',
            backgroundColor: 'var(--kq-green-50)',
            borderBottom: '1px solid var(--kq-green-200)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                backgroundColor: 'var(--kq-green-700)',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <Icon name="mic" size={16} color="#fff" />
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--kq-green-900)' }}>
                  Uzhavarsethu Voice Assistant
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--kq-green-700)' }}>
                  {farmerName ? `Authenticated: ${farmerName} (${farmerId})` : 'Connected to Tamil Nadu DPC Network'}
                </div>
              </div>
            </div>

            {voiceState === 'LISTENING' && (
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                borderRadius: 20,
                backgroundColor: '#fee2e2',
                color: '#b91c1c',
                fontSize: 12,
                fontWeight: 600
              }}>
                <span style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  backgroundColor: '#ef4444',
                  animation: 'kq-pulse 1.2s infinite'
                }} />
                Listening...
              </span>
            )}

            {voiceState === 'PROCESSING' && (
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                borderRadius: 20,
                backgroundColor: '#fef3c7',
                color: '#92400e',
                fontSize: 12,
                fontWeight: 600
              }}>
                <Icon name="refresh-cw" size={12} className="kq-spin" />
                Processing your voice...
              </span>
            )}

            {voiceState === 'SUCCESS' && (
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                borderRadius: 20,
                backgroundColor: '#dcfce7',
                color: '#166534',
                fontSize: 12,
                fontWeight: 600
              }}>
                ✓ Transcript ready
              </span>
            )}

            {isSpeaking && (
              <button
                type="button"
                onClick={stopSpeaking}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 10px',
                  borderRadius: 20,
                  backgroundColor: 'var(--kq-green-100)',
                  color: 'var(--kq-green-900)',
                  border: '1px solid var(--kq-green-400)',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
                title="Click to stop voice output"
                aria-label="Stop speech output"
              >
                <Icon name="volume-2" size={13} color="var(--kq-green-800)" />
                Speaking... (Stop)
              </button>
            )}

            {voiceState === 'ERROR' && (
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                borderRadius: 20,
                backgroundColor: '#fee2e2',
                color: '#b91c1c',
                fontSize: 12,
                fontWeight: 600
              }}>
                ⚠️ Try again
              </span>
            )}
          </div>

          {/* Chat Messages Scrollable Area (Independent Scrolling & Screen Reader Accessible) */}
          <div
            ref={messagesContainerRef}
            onScroll={handleScroll}
            role="log"
            aria-live="polite"
            aria-relevant="additions text"
            aria-label="Conversation with voice assistant"
            style={{
              flex: '1 1 0%',
              minHeight: 0,
              overflowY: 'auto',
              overflowX: 'hidden',
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              backgroundColor: '#fafafa',
              WebkitOverflowScrolling: 'touch'
            }}
          >
            {messages.map(msg => {
              const isUser = msg.sender === 'farmer';
              return (
                <div
                  key={msg.id}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: isUser ? 'flex-end' : 'flex-start',
                    maxWidth: '85%',
                    alignSelf: isUser ? 'flex-end' : 'flex-start'
                  }}
                >
                  <div style={{
                    padding: '10px 14px',
                    borderRadius: 12,
                    fontSize: 14,
                    lineHeight: 1.5,
                    backgroundColor: isUser ? 'var(--kq-green-700)' : '#ffffff',
                    color: isUser ? '#ffffff' : 'var(--kq-text-primary)',
                    boxShadow: isUser ? 'var(--kq-shadow-sm)' : 'var(--kq-shadow-xs)',
                    border: isUser ? 'none' : '1px solid var(--kq-border-subtle)',
                    wordBreak: 'break-word'
                  }}>
                    {msg.text}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
                    <span style={{ fontSize: 11, color: 'var(--kq-text-muted)', padding: '0 4px' }}>
                      {msg.timestamp}
                    </span>
                    {!isUser && voiceEnabled && (
                      <button
                        type="button"
                        onClick={() => speakText(msg.text)}
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          padding: '0 4px',
                          color: 'var(--kq-green-700)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          fontSize: 11,
                          fontWeight: 500
                        }}
                        title="Listen to this message"
                        aria-label="Read message aloud"
                      >
                        <Icon name="volume-2" size={12} color="var(--kq-green-700)" />
                        Listen
                      </button>
                    )}
                  </div>

                  {/* Suggestion Chips */}
                  {!isUser && Array.isArray(msg.suggestedActions) && msg.suggestedActions.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                      {msg.suggestedActions.map((action, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => handleChipClick(action)}
                          style={{
                            minHeight: 36,
                            padding: '6px 14px',
                            backgroundColor: '#ffffff',
                            border: '1.5px solid var(--kq-green-600)',
                            borderRadius: 18,
                            fontSize: 12.5,
                            fontWeight: 600,
                            color: 'var(--kq-green-900)',
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                            display: 'inline-flex',
                            alignItems: 'center',
                            boxShadow: 'var(--kq-shadow-xs)'
                          }}
                        >
                          {action}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {voiceState === 'PROCESSING' && (
              <div style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', color: 'var(--kq-green-800)', backgroundColor: 'var(--kq-green-50)', borderRadius: 8, fontSize: 13 }}>
                <Icon name="refresh-cw" size={14} className="kq-spin" />
                <span>Processing your voice with Sarvam STT...</span>
              </div>
            )}

            {isProcessing && (
              <div style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', color: 'var(--kq-text-muted)', fontSize: 13 }}>
                <Icon name="refresh-cw" size={14} className="kq-spin" />
                <span>Assistant is thinking...</span>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* Floating "Scroll to Latest" indicator when scrolled up */}
          {isUserScrolledUp && (
            <button
              type="button"
              onClick={scrollToBottom}
              style={{
                position: 'absolute',
                bottom: 68,
                left: '50%',
                transform: 'translateX(-50%)',
                backgroundColor: 'var(--kq-green-700)',
                color: '#ffffff',
                border: 'none',
                borderRadius: 20,
                padding: '6px 14px',
                fontSize: 12,
                fontWeight: 600,
                boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                zIndex: 10
              }}
            >
              <Icon name="chevron-down" size={14} color="#fff" />
              <span>↓ New messages</span>
            </button>
          )}

          {/* Chat Input & Mic Bar (Pinned permanently at bottom) */}
          <div style={{
            padding: '12px 14px',
            backgroundColor: '#ffffff',
            borderTop: '1px solid var(--kq-border-subtle)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexShrink: 0
          }}>
            {/* Big Accessible Mic Button */}
            <button
              type="button"
              onClick={toggleListening}
              disabled={voiceState === 'PROCESSING'}
              aria-label={voiceState === 'LISTENING' ? 'Stop voice input' : (voiceState === 'PROCESSING' ? 'Processing voice' : 'Start voice input')}
              style={{
                width: 44,
                height: 44,
                borderRadius: '50%',
                border: 'none',
                backgroundColor: voiceState === 'LISTENING' ? '#dc2626' : (voiceState === 'PROCESSING' ? '#f59e0b' : 'var(--kq-green-700)'),
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: voiceState === 'PROCESSING' ? 'not-allowed' : 'pointer',
                boxShadow: voiceState === 'LISTENING' ? '0 0 0 4px rgba(220, 38, 38, 0.25)' : 'var(--kq-shadow-sm)',
                transition: 'all 0.2s ease',
                flexShrink: 0
              }}
              title={voiceState === 'LISTENING' ? 'Listening... Tap to stop' : (voiceState === 'PROCESSING' ? 'Processing your voice...' : 'Tap to speak')}
            >
              <Icon name={voiceState === 'LISTENING' ? 'mic-off' : (voiceState === 'PROCESSING' ? 'refresh-cw' : 'mic')} size={20} color="#fff" className={voiceState === 'PROCESSING' ? 'kq-spin' : ''} />
            </button>

            {/* Accessible Text Input */}
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleUserMessage(inputText);
                }
              }}
              placeholder={voiceState === 'LISTENING' ? 'Listening to your voice... (Tap mic to stop)' : 'Speak with mic or type your request (e.g., Anaicut or 10 quintals)'}
              style={{
                flex: 1,
                height: 42,
                borderRadius: 8,
                border: '1px solid var(--kq-border)',
                padding: '0 12px',
                fontSize: 13.5,
                outline: 'none',
                minWidth: 0
              }}
              disabled={isListening}
            />

            <PrimaryButton
              type="button"
              onClick={() => handleUserMessage(inputText)}
              disabled={!inputText.trim() || isProcessing}
              style={{ height: 42, padding: '0 16px', minHeight: 42, flexShrink: 0 }}
            >
              Send
            </PrimaryButton>
          </div>
        </div>

        {/* Right Column: Live Booking Draft Summary Card */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card title="Appointment Draft" subtitle="Extracted from conversation in real-time">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* District */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: 'var(--kq-text-secondary)' }}>District:</span>
                <span style={{ fontWeight: 600, fontSize: 13.5, color: draft.district ? 'var(--kq-text-primary)' : 'var(--kq-text-muted)' }}>
                  {draft.district || 'Not specified'}
                </span>
              </div>

              {/* Centre */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: 'var(--kq-text-secondary)' }}>Procurement Centre:</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontWeight: 600, fontSize: 13.5, color: draft.centre_name ? 'var(--kq-text-primary)' : 'var(--kq-text-muted)', textAlign: 'right', maxWidth: 150 }}>
                    {draft.centre_name || (draft.centre_id ? `Centre ${draft.centre_id}` : 'Not selected')}
                  </span>
                  {draft.centre_id && (
                    <button
                      type="button"
                      onClick={() => handleAction('CHANGE_CENTRE')}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--kq-green-700)',
                        fontSize: 11,
                        textDecoration: 'underline',
                        cursor: 'pointer',
                        padding: '0 2px'
                      }}
                      title="Select a different procurement centre"
                    >
                      Change
                    </button>
                  )}
                </div>
              </div>

              {/* Date */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: 'var(--kq-text-secondary)' }}>Arrival Date:</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontWeight: 600, fontSize: 13.5 }}>
                    {draft.booking_date ? formatHumanDate(draft.booking_date) : 'Not set'}
                  </span>
                  {draft.booking_date && (
                    <button
                      type="button"
                      onClick={() => handleAction('CHANGE_DATE')}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--kq-green-700)',
                        fontSize: 11,
                        textDecoration: 'underline',
                        cursor: 'pointer',
                        padding: '0 2px'
                      }}
                      title="Select a different date"
                    >
                      Change
                    </button>
                  )}
                </div>
              </div>

              {/* Crop & Quantity */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: 'var(--kq-text-secondary)' }}>Harvest Produce:</span>
                <span style={{ fontWeight: 600, fontSize: 13.5 }}>
                  {draft.crop} • {draft.quantity_quintals || 0} Quintals
                </span>
              </div>

              {/* Estimated Payout */}
              <div style={{
                padding: '10px 12px',
                backgroundColor: 'var(--kq-green-50)',
                border: '1px solid var(--kq-green-200)',
                borderRadius: 8,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <div>
                  <div style={{ fontSize: 11.5, color: 'var(--kq-green-800)', fontWeight: 600 }}>Estimated MSP Payout</div>
                  <div style={{ fontSize: 10.5, color: 'var(--kq-text-muted)' }}>@ ₹2,275 per quintal</div>
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--kq-green-900)' }}>
                  ₹{estimatedPayout.toLocaleString('en-IN')}
                </div>
              </div>

              {/* Slot Selection */}
              <div style={{ marginTop: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--kq-text-primary)' }}>
                    Select Arrival Slot:
                  </span>
                  {draft.slot_id && (
                    <button
                      type="button"
                      onClick={() => handleAction('CHANGE_SLOT')}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--kq-green-700)',
                        fontSize: 11,
                        textDecoration: 'underline',
                        cursor: 'pointer',
                        padding: '0 2px'
                      }}
                      title="Deselect slot and choose another"
                    >
                      Clear
                    </button>
                  )}
                </div>
                {availableSlots.length > 0 ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                    {availableSlots.map(s => {
                      const isSelected = draft.slot_id === s.slot_id;
                      return (
                        <button
                          key={s.slot_id}
                          type="button"
                          onClick={() => s.available && handleSelectSlot(s)}
                          disabled={!s.available}
                          aria-pressed={isSelected}
                          aria-label={`${s.start_time} to ${s.end_time}, ${s.available ? `${s.max_farmers - s.booked_count} slots available` : 'fully booked'}`}
                          style={{
                            padding: '10px 12px',
                            minHeight: 48,
                            borderRadius: 8,
                            border: isSelected ? '2px solid var(--kq-green-700)' : '1px solid var(--kq-border)',
                            backgroundColor: isSelected ? 'var(--kq-green-100)' : (s.available ? '#ffffff' : '#f3f4f6'),
                            cursor: s.available ? 'pointer' : 'not-allowed',
                            textAlign: 'left'
                          }}
                        >
                          <div style={{ fontSize: 12.5, fontWeight: 600, color: isSelected ? 'var(--kq-green-900)' : 'var(--kq-text-primary)' }}>
                            {s.start_time} - {s.end_time}
                          </div>
                          <div style={{ fontSize: 10.5, color: s.available ? 'var(--kq-green-700)' : '#dc2626' }}>
                            {s.available ? `${s.max_farmers - s.booked_count} slots left` : 'Full'}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: 'var(--kq-text-muted)', fontStyle: 'italic' }}>
                    Centres & date must be chosen to load available time slots.
                  </div>
                )}
              </div>

              {/* Confirm Booking Action Button */}
              <div style={{ marginTop: 12 }}>
                <PrimaryButton
                  type="button"
                  onClick={handleExecuteBooking}
                  disabled={!isReadyToConfirm || bookingSubmitting}
                  style={{ width: '100%', height: 44, justifyContent: 'center' }}
                >
                  {bookingSubmitting ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <Icon name="refresh-cw" size={16} className="kq-spin" />
                      Securing Slot...
                    </span>
                  ) : (
                    'Confirm Slot Booking'
                  )}
                </PrimaryButton>

                {!isReadyToConfirm && !bookingSuccess && (
                  <div style={{ fontSize: 11, color: 'var(--kq-text-muted)', textAlign: 'center', marginTop: 6 }}>
                    Provide all booking details by speaking or typing to confirm.
                  </div>
                )}
              </div>
            </div>
          </Card>

          {/* Booking Confirmation Success Card */}
          {bookingSuccess && (
            <Card style={{ backgroundColor: 'var(--kq-green-50)', borderColor: 'var(--kq-green-300)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div style={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  backgroundColor: 'var(--kq-green-700)',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}>
                  <Icon name="check" size={20} color="#fff" />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--kq-green-900)' }}>
                    Slot Reserved Successfully!
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--kq-green-800)', marginTop: 2 }}>
                    Booking ID: <strong>{bookingSuccess.booking_id}</strong>
                  </div>
                  {bookingSuccess.token && (
                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--kq-green-900)', marginTop: 4 }}>
                      Queue Token: <span style={{ padding: '2px 8px', backgroundColor: '#fff', borderRadius: 4, border: '1px solid var(--kq-green-400)' }}>{bookingSuccess.token}</span>
                    </div>
                  )}

                  <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
                    <Link
                      to="/farmer/status"
                      className="kq-btn kq-btn-primary"
                      style={{ height: 34, fontSize: 12.5, textDecoration: 'none' }}
                    >
                      View Digital Pass
                    </Link>
                    <button
                      type="button"
                      onClick={() => {
                        setBookingSuccess(null);
                        setDraft({
                          district: localStorage.getItem('kisan_district') || '',
                          centre_id: '',
                          centre_name: '',
                          booking_date: '2026-09-24',
                          time_preference: '',
                          slot_id: '',
                          slot_time: '',
                          crop: 'Paddy (Common)',
                          quantity_quintals: 10
                        });
                      }}
                      className="kq-btn kq-btn-secondary"
                      style={{ height: 34, fontSize: 12.5 }}
                    >
                      Book Another
                    </button>
                  </div>
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
