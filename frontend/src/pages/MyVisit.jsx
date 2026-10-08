import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import API from '../api';
import {
  Card,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
  AlertBanner,
  LoadingState,
  EmptyState,
  Icon,
  Modal,
  DataTable,
  formatHumanDate,
  formatHumanTime
} from '../components/design-system';
import { useI18n, getLanguage, setLanguage } from '../i18n';

const JOURNEY_STEPS = [
  { key: 'Confirmed', labelKey: 'stepConfirmed', descEn: 'Slot confirmed & bay allocated', descTa: 'முன்பதிவு உறுதியானது' },
  { key: 'On The Way', labelKey: 'stepTransit', descEn: 'Transit notified to centre gate', descTa: 'புறப்பட்ட தகவல் நிலையத்திற்கு சென்றது' },
  { key: 'Checked-In', labelKey: 'stepArrived', descEn: 'Physical check-in at gate', descTa: 'நுழைவாயில் வருகை பதிவானது' },
  { key: 'In Queue', labelKey: 'stepQueue', descEn: 'Token called forward to scale', descTa: 'எடை மேடைக்கு அழைக்கப்படுகிறார்' },
  { key: 'Grading', labelKey: 'stepGrading', descEn: 'Testing moisture & grain quality', descTa: 'ஈரப்பதம் மற்றும் தரம் சரிபார்ப்பு' },
  { key: 'Weighing', labelKey: 'stepWeighing', descEn: 'Tare & net bag weighment', descTa: 'நெல் மூட்டைகள் எடை போடுதல்' },
  { key: 'Procured', labelKey: 'stepAccepted', descEn: 'Crop accepted & voucher issued', descTa: 'கொள்முதல் ஏற்கப்பட்டு ரசீது உருவானது' },
  { key: 'Payment Completed', labelKey: 'stepPaid', descEn: 'DBT funds sent to bank account', descTa: 'வங்கி கணக்கில் பணம் வரவானது' }
];

const cleanCentreName = (name, id) => {
  let clean = name || id || 'Procurement Centre';
  clean = clean.replace(/TN_DPC_\d+\s*[-–:]\s*/gi, '').replace(/\s*\(TN_DPC_\d+\)/gi, '');
  if (/^TN_DPC_\d+$/i.test(clean.trim())) {
    return 'Kattathur DPC';
  }
  return clean.trim();
};

export default function MyVisit() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryBookingId = searchParams.get('bookingId');
  const { t } = useI18n();

  const [farmerId, setFarmerId] = useState(localStorage.getItem('kisan_farmer_id') || '');
  const [farmerName, setFarmerName] = useState(localStorage.getItem('kisan_farmer_name') || '');
  const [currentLang, setCurrentLang] = useState(getLanguage());

  const [bookings, setBookings] = useState([]);
  const [activeBooking, setActiveBooking] = useState(null);
  const [passData, setPassData] = useState(null);
  const [rescheduleData, setRescheduleData] = useState(null);
  const [rescheduleHistory, setRescheduleHistory] = useState([]);

  const [historyPage, setHistoryPage] = useState(1);
  const VISITS_PER_PAGE = 5;

  const [loading, setLoading] = useState(true);
  const [transitLoading, setTransitLoading] = useState(false);
  const [pacingAckLoading, setPacingAckLoading] = useState(false);
  const [rescheduleLoading, setRescheduleLoading] = useState(false);

  const [bannerMsg, setBannerMsg] = useState('');
  const [bannerError, setBannerError] = useState('');
  const [showExplanationModal, setShowExplanationModal] = useState(false);
  const [selectedWhyAlternative, setSelectedWhyAlternative] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showAlternatives, setShowAlternatives] = useState(false);
  const [showJourney, setShowJourney] = useState(false);

  // Sync language changes
  useEffect(() => {
    const handleLangChange = () => setCurrentLang(getLanguage());
    window.addEventListener('kq_language_changed', handleLangChange);
    return () => window.removeEventListener('kq_language_changed', handleLangChange);
  }, []);

  // Fetch farmer visits
  const fetchVisits = async (fId = farmerId) => {
    if (!fId) {
      setLoading(false);
      return;
    }

    try {
      // Ensure valid auth token if missing
      if (!localStorage.getItem('kisan_token')) {
        try {
          const profileRes = await API.get(`/farmers/${encodeURIComponent(fId)}`, { skipAuth: true });
          if (profileRes.data?.token) {
            localStorage.setItem('kisan_token', profileRes.data.token);
            localStorage.setItem('kisan_role', 'FARMER');
            if (profileRes.data.name && !farmerName) setFarmerName(profileRes.data.name);
          }
        } catch (_) {}
      }

      // Fetch all bookings
      const bookingsRes = await API.get(`/bookings/${encodeURIComponent(fId)}`);
      const all = Array.isArray(bookingsRes.data) ? bookingsRes.data : [];
      setBookings(all);

      // Determine active booking
      let selected = null;
      if (queryBookingId) {
        selected = all.find(b => b.booking_id === queryBookingId);
      }
      if (!selected) {
        const todayStr = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Kolkata',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }).format(new Date());

        const normalizeDate = (d) => {
          if (!d) return '';
          const s = String(d).trim();
          if (s.includes('T') || s.includes('Z')) {
            const dt = new Date(s);
            if (!isNaN(dt.getTime())) {
              return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(dt);
            }
          }
          return s.slice(0, 10);
        };

        const activeStatuses = ['Confirmed', 'Booked', 'On The Way', 'Checked-In', 'In Queue', 'Grading', 'Weighing'];
        
        // 1. Prioritize active booking scheduled for today or upcoming in the future
        const upcomingActive = all
          .filter(b => activeStatuses.includes(b.status) && (normalizeDate(b.booking_date) >= todayStr))
          .sort((a, b) => normalizeDate(a.booking_date).localeCompare(normalizeDate(b.booking_date)));

        if (upcomingActive.length > 0) {
          selected = upcomingActive[0];
        } else {
          // 2. Physical in-yard active visits ('Checked-In', 'Grading', 'Weighing')
          const inYard = all.find(b => ['Checked-In', 'Grading', 'Weighing'].includes(b.status));
          if (inYard) {
            selected = inYard;
          } else {
            // 3. Post-yard in-progress visit ('Procured', 'Payment Pending')
            const inProgress = all.find(b => b.status === 'Procured' || b.status === 'Payment Pending');
            if (inProgress) {
              selected = inProgress;
            } else {
              // No active appointment; strictly do not fallback to completed, expired, or cancelled visits!
              selected = null;
            }
          }
        }
      }

      setActiveBooking(selected);

      // If active booking found, fetch detailed pass metadata and reschedule options
      if (selected && selected.booking_id) {
        await loadBookingDetails(selected.booking_id);
      }
    } catch (err) {
      console.error('MyVisit fetch error:', err);
      setBannerError(err.response?.data?.message || 'Unable to load your visit information.');
    } finally {
      setLoading(false);
    }
  };

  const loadBookingDetails = async (bId) => {
    try {
      const [passRes, sugRes, histRes] = await Promise.all([
        API.get(`/bookings/pass/${bId}`).catch(() => ({ data: null })),
        API.get(`/bookings/${bId}/reschedule-suggestions`).catch(() => ({ data: null })),
        API.get(`/bookings/${bId}/reschedule-history`).catch(() => ({ data: null }))
      ]);

      if (passRes?.data?.pass) {
        setPassData(passRes.data.pass);
      }
      if (sugRes?.data?.success) {
        setRescheduleData(sugRes.data);
      }
      if (histRes?.data?.success) {
        setRescheduleHistory(histRes.data.events || []);
      }
    } catch (err) {
      console.warn('Error loading secondary visit details:', err);
    }
  };

  useEffect(() => {
    fetchVisits();
  }, [farmerId, queryBookingId]);

  // Handle "I'm On My Way"
  const handleOnMyWay = async () => {
    if (!activeBooking) return;
    try {
      setTransitLoading(true);
      setBannerMsg('');
      setBannerError('');
      const res = await API.post(`/bookings/${activeBooking.booking_id}/on-my-way`);
      setBannerMsg(res.data.message || (currentLang === 'ta' ? 'புறப்பட்ட தகவல் நிலைய ஊழியர்களுக்கு தெரிவிக்கப்பட்டது.' : 'Transit confirmed: Centre staff has been notified that you are on your way.'));
      await fetchVisits();
    } catch (err) {
      console.error('On-my-way error:', err);
      setBannerError(err.response?.data?.message || 'Failed to update transit status.');
    } finally {
      setTransitLoading(false);
    }
  };

  // Handle Pacing Acknowledgment
  const handleAcknowledgePacing = async () => {
    if (!activeBooking) return;
    try {
      setPacingAckLoading(true);
      setBannerMsg('');
      setBannerError('');
      const res = await API.post(`/bookings/${activeBooking.booking_id}/acknowledge-pacing`, {
        farmer_id: farmerId
      });
      setBannerMsg(res.data.message || (currentLang === 'ta' ? 'நிலைய வருகை பரிந்துரை ஏற்றுக்கொள்ளப்பட்டது.' : 'Arrival delay advisory acknowledged.'));
      await fetchVisits();
    } catch (err) {
      console.error('Pacing ack error:', err);
      setBannerError(err.response?.data?.message || 'Failed to acknowledge pacing advisory.');
    } finally {
      setPacingAckLoading(false);
    }
  };

  // Handle Alternative Slot Decision
  const handleRescheduleDecision = async (decision, option = null) => {
    if (!activeBooking) return;
    try {
      setRescheduleLoading(true);
      setBannerMsg('');
      setBannerError('');
      const body = {
        decision,
        new_slot_id: option?.slot_id,
        new_centre_id: option?.centre_id,
        reason: option ? option.explanation : 'Farmer chose to retain original confirmed booking slot'
      };
      const res = await API.post(`/bookings/${activeBooking.booking_id}/reschedule`, body);
      setBannerMsg(res.data.message || (decision === 'ACCEPT' ? 'Slot rescheduled successfully!' : 'Original schedule retained.'));
      setShowAlternatives(false);
      await fetchVisits();
    } catch (err) {
      console.error('Reschedule error:', err);
      setBannerError(err.response?.data?.message || 'Unable to update appointment slot.');
    } finally {
      setRescheduleLoading(false);
    }
  };

  // Determine current step index in the 8-stage sequence
  const currentStatus = (passData?.status || activeBooking?.status || 'Confirmed');
  let currentStepIdx = JOURNEY_STEPS.findIndex(
    s => s.key.toLowerCase() === currentStatus.toLowerCase()
  );
  if (currentStepIdx === -1) {
    if (currentStatus === 'Booked') currentStepIdx = 0;
    else if (currentStatus === 'Payment Pending') currentStepIdx = 6;
    else if (currentStatus === 'Payment Completed' || currentStatus === 'Paid') currentStepIdx = 7;
    else currentStepIdx = 0;
  }

  const getNextStepAdvice = (status) => {
    switch ((status || '').toLowerCase()) {
      case 'confirmed':
      case 'booked':
        return currentLang === 'ta'
          ? 'நீங்கள் இப்போது கொள்முதல் நிலையத்திற்கு புறப்படலாம். கிளம்பும்போது "நான் புறப்படுகிறேன்" என்பதை அழுத்தவும்.'
          : 'You can leave for the procurement centre now. Tap "I\'m On My Way" when you begin transit.';
      case 'on the way':
        return currentLang === 'ta'
          ? 'நிலையம் அடைந்ததும் நுழைவாயிலில் உங்கள் டிஜிட்டல் பாஸை (QR) காட்டவும்.'
          : 'Proceed to the centre gate upon arrival and show your Digital Pass.';
      case 'checked-in':
        return currentLang === 'ta'
          ? 'காத்திருப்பு பகுதியில் இருக்கவும். உங்கள் டோக்கன் எண் அழைக்கப்படும் போது எடை மேடைக்கு செல்லவும்.'
          : 'Wait in the staging area. Your token number will be called forward.';
      case 'in queue':
        return currentLang === 'ta'
          ? 'உங்கள் நெல் வாகனத்துடன் தர பரிசோதனை மற்றும் ஈரப்பதம் சோதனை மேடைக்கு செல்லவும்.'
          : 'Move your vehicle to the moisture testing and quality inspection counter.';
      case 'grading':
        return currentLang === 'ta'
          ? 'ஈரப்பதம் மற்றும் தரம் சரிபார்க்கப்படுகிறது. சான்றிதழ் கிடைத்ததும் எடை போடும் இடத்திற்கு செல்லவும்.'
          : 'Moisture test in progress. Move forward to weighment upon approval.';
      case 'weighing':
        return currentLang === 'ta'
          ? 'நெல் மூட்டைகள் எடை போடப்படுகின்றன. எடை ரசீது மற்றும் கொள்முதல் சான்றிதழைப் பெறவும்.'
          : 'Bags are being weighed. Collect your printed scale slip and voucher.';
      case 'procured':
      case 'payment pending':
        return currentLang === 'ta'
          ? 'கொள்முதல் ஏற்கப்பட்டது. நேரடி மானியப் பணம் (DBT) உங்கள் வங்கி கணக்கிற்கு அனுப்பப்பட்டு வருகிறது.'
          : 'Procurement voucher generated. Direct Benefit Transfer (DBT) is being processed.';
      case 'paid':
      case 'payment completed':
        return currentLang === 'ta'
          ? 'கொள்முதல் மற்றும் பணப்பட்டுவாடா நிறைவடைந்தது. வங்கி கணக்கில் பணம் வரவு வைக்கப்பட்டது.'
          : 'Procurement complete. Payment has been credited to your bank account.';
      default:
        return currentLang === 'ta'
          ? 'உங்கள் டோக்கன் வரிசை முறைப்படி அழைக்கப்படும்.'
          : 'Follow directions from centre staff as your token progresses.';
    }
  };

  const tokenText = passData?.token || activeBooking?.token || (activeBooking?.booking_id ? `Q#${activeBooking.booking_id.slice(-4)}` : 'Q001');
  const centreName = cleanCentreName(passData?.centre_name || activeBooking?.centre_name, passData?.centre_id || activeBooking?.centre_id);
  const queuePos = passData?.queue_position_at_booking || activeBooking?.queue_position_at_booking || 1;
  const activeCounters = passData?.active_counters || 2;
  const farmersAhead = passData?.farmers_ahead ?? activeBooking?.farmers_ahead ?? 0;

  const rawWait = passData?.live_estimated_wait_minutes ?? passData?.estimated_wait_minutes ?? activeBooking?.estimated_wait_minutes;
  const displayWait = (rawWait != null && rawWait > 0 && rawWait <= 180)
    ? `~${rawWait} min`
    : (farmersAhead === 0 ? '< 5 min' : `~${Math.max(5, (farmersAhead + 1) * 10)} min`);

  const startTime = passData?.start_time || activeBooking?.start_time;
  const endTime = passData?.end_time || activeBooking?.end_time;
  const timeString = startTime ? `${startTime} - ${endTime || ''}` : (activeBooking?.slot_time || '08:00 - 09:00');

  const weather = rescheduleData?.weather_advisory;
  const pacing = passData?.pacing || (activeBooking?.pacing_status === 'SLOW' ? {
    pacing_status: activeBooking.pacing_status,
    reason: activeBooking.pacing_reason,
    recommended_delay_minutes: activeBooking.recommended_delay_minutes,
    pacing_acknowledged: !!activeBooking.pacing_acknowledged_at
  } : null);

  // If no farmer ID is stored
  if (!farmerId) {
    return (
      <div style={{ maxWidth: 700, margin: '40px auto', padding: '0 16px' }}>
        <Card style={{ padding: '32px 24px', textAlign: 'center', border: '2px dashed var(--kq-green-600)' }}>
          <div style={{
            width: 50,
            height: 50,
            borderRadius: '50%',
            background: 'var(--kq-green-100)',
            color: 'var(--kq-green-800)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px'
          }}>
            <Icon name="user" size={24} />
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: 'var(--kq-text-primary)', margin: '0 0 8px' }}>
            {currentLang === 'ta' ? 'உழவர் வருகை விவரம் காண' : 'View Your Procurement Visit'}
          </h2>
          <p style={{ fontSize: 14, color: 'var(--kq-text-secondary)', maxWidth: 460, margin: '0 auto 20px', lineHeight: 1.5 }}>
            {currentLang === 'ta'
              ? 'உங்கள் முன்பதிவு நிலை, வரிசை எண் மற்றும் புறப்படும் தகவலை அறிய உழவர் எண்ணை உள்ளிடவும்.'
              : 'Please enter your Farmer ID to check your live queue token, scheduled window, and transit alerts.'}
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
            <PrimaryButton onClick={() => navigate('/farmer')} icon="arrow-right">
              {currentLang === 'ta' ? 'முகப்பில் உள்நுழைக' : 'Go to Login'}
            </PrimaryButton>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 960, margin: '20px auto', padding: '0 16px 80px' }}>
      
      {/* Top Breadcrumb Navigation */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Link
          to="/farmer"
          style={{
            textDecoration: 'none',
            color: 'var(--kq-green-800)',
            fontWeight: 700,
            fontSize: 14,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6
          }}
        >
          <Icon name="arrow-left" size={16} />
          <span>{t('backToHome')}</span>
        </Link>
        <span style={{ fontSize: 13, color: 'var(--kq-text-secondary)', fontWeight: 600 }}>
          {farmerName ? `${t('greeting')}, ${farmerName}` : ''}
        </span>
      </div>

      {/* Notification Banners */}
      {bannerMsg && (
        <AlertBanner
          type="positive"
          message={bannerMsg}
          onDismiss={() => setBannerMsg('')}
          style={{ marginBottom: 16 }}
        />
      )}
      {bannerError && (
        <AlertBanner
          type="danger"
          message={bannerError}
          onDismiss={() => setBannerError('')}
          style={{ marginBottom: 16 }}
        />
      )}

      {loading ? (
        <div style={{ padding: '60px 0' }}>
          <LoadingState message={currentLang === 'ta' ? 'உங்கள் வருகை விவரங்கள் ஏற்றப்படுகின்றன...' : 'Loading your active visit cockpit...'} />
        </div>
      ) : !activeBooking ? (
        <EmptyState
          icon="calendar"
          title={t('noVisitsFound')}
          description={t('noActiveVisitDesc')}
          action={
            <div style={{ display: 'flex', gap: 10 }}>
              <PrimaryButton onClick={() => navigate('/farmer/book')} icon="calendar">
                {t('bookFirstSlotBtn')}
              </PrimaryButton>
              <SecondaryButton onClick={() => navigate('/farmer')}>
                {t('backToHome')}
              </SecondaryButton>
            </div>
          }
        />
      ) : (
        <>
          {/* ================================================================= */}
          {/* 1. PRIMARY OPERATIONAL COCKPIT: GLANCEABLE STATUS IN ONE VIEW     */}
          {/* ================================================================= */}
          <div style={{
            background: '#ffffff',
            border: '2px solid var(--kq-green-700)',
            borderRadius: 'var(--kq-radius-lg)',
            boxShadow: 'var(--kq-shadow-md)',
            padding: '24px',
            marginBottom: 24,
            position: 'relative'
          }}>
            {/* Header: Token & Scheduled Time */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--kq-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {t('tokenLabel')}
                </div>
                <div style={{ fontSize: 50, fontWeight: 900, color: 'var(--kq-green-800)', lineHeight: 1.1, margin: '2px 0 6px' }}>
                  {tokenText}
                </div>
                <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--kq-text-primary)' }}>
                  {centreName}
                </div>
                <div style={{ fontSize: 13, color: 'var(--kq-text-secondary)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <Icon name="calendar" size={14} color="var(--kq-green-700)" />
                    {formatHumanDate(activeBooking.booking_date)}
                  </span>
                  <span style={{ color: 'var(--kq-border-medium)' }}>•</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <Icon name="clock" size={14} color="var(--kq-green-700)" />
                    {formatHumanTime(timeString)}
                  </span>
                  <span style={{ color: 'var(--kq-border-medium)' }}>•</span>
                  <span>{activeBooking.crop} ({activeBooking.quantity_quintals} q)</span>
                </div>
              </div>

              {/* Status Badge & Actions */}
              <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10 }}>
                <StatusBadge status={currentStatus} size="md" />
                <div style={{ fontSize: 11, color: 'var(--kq-text-muted)', fontFamily: 'monospace' }}>
                  REF: {activeBooking.booking_id}
                </div>
              </div>
            </div>

            {currentStatus === 'Payment Completed' ? (
              <div style={{ marginTop: 20 }}>
                {/* Completed Payment Summary */}
                <div style={{
                  padding: '18px 20px',
                  backgroundColor: 'var(--kq-green-50)',
                  borderRadius: 'var(--kq-radius-md)',
                  border: '1.5px solid var(--kq-green-200)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 16
                }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--kq-green-900)', textTransform: 'uppercase' }}>
                      {currentLang === 'ta' ? 'வங்கிக் கணக்கில் வரவான தொகை (DBT)' : 'Total Paid via DBT'}
                    </div>
                    <div style={{ fontSize: 32, fontWeight: 900, color: 'var(--kq-green-800)', marginTop: 2 }}>
                      ₹{Number(activeBooking.payment_amount_inr || ((activeBooking.procured_quantity_quintals || activeBooking.quantity_quintals || 50) * (activeBooking.msp_rate_inr || 2275))).toLocaleString('en-IN')}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--kq-green-900)' }}>
                      ✓ {currentLang === 'ta' ? 'அரசு கொள்முதல் மற்றும் வங்கி வரவு நிறைவடைந்தது' : 'Procurement & DBT Transfer Completed'}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--kq-text-secondary)', marginTop: 2 }}>
                      {currentLang === 'ta' ? 'அனைத்து அதிகாரப்பூர்வ சான்றிதழ்களும் பதிவாகியுள்ளன' : 'All official certificates and receipts are archived in your account'}
                    </div>
                  </div>
                </div>

                {/* Action Buttons for Completed Visit */}
                <div style={{ marginTop: 20, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <PrimaryButton
                    onClick={() => navigate(`/farmer/documents?bookingId=${activeBooking.booking_id}`)}
                    style={{ flex: '1 1 200px', justifyContent: 'center' }}
                  >
                    <Icon name="file-text" size={16} />
                    <span>{currentLang === 'ta' ? 'அதிகாரப்பூர்வ ஆவணங்கள் காண்க →' : 'View Official Documents →'}</span>
                  </PrimaryButton>
                  <SecondaryButton
                    onClick={() => navigate('/farmer/book')}
                    style={{ flex: '1 1 160px', justifyContent: 'center' }}
                  >
                    <Icon name="calendar" size={16} />
                    <span>{currentLang === 'ta' ? 'புதிய முன்பதிவு செய்க' : 'Book a New Slot'}</span>
                  </SecondaryButton>
                </div>
              </div>
            ) : (
              <>
                {/* Glanceable Queue Metrics Grid */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                  gap: 12,
                  marginTop: 20,
                  padding: '16px',
                  backgroundColor: 'var(--kq-bg-subtle)',
                  borderRadius: 'var(--kq-radius-md)',
                  border: '1px solid var(--kq-border-light)'
                }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--kq-text-muted)', textTransform: 'uppercase' }}>
                      {t('queuePosLabel')}
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--kq-green-800)', marginTop: 2 }}>
                      #{queuePos}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--kq-text-muted)', textTransform: 'uppercase' }}>
                      {t('estimatedWaitLabel')}
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--kq-green-800)', marginTop: 2 }}>
                      {displayWait}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--kq-text-muted)', textTransform: 'uppercase' }}>
                      {t('countersLabel')}
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--kq-green-800)', marginTop: 2 }}>
                      {activeCounters} {currentLang === 'ta' ? 'மேடைகள்' : 'Lanes'}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--kq-text-muted)', textTransform: 'uppercase' }}>
                      {currentLang === 'ta' ? 'முன்னே உள்ளவர்கள்' : 'Ahead of You'}
                    </div>
                    <div style={{
                      fontSize: farmersAhead > 0 ? 22 : 16,
                      fontWeight: 800,
                      color: farmersAhead > 0 ? 'var(--kq-text-primary)' : 'var(--kq-green-800)',
                      marginTop: farmersAhead > 0 ? 2 : 6,
                      lineHeight: 1.2
                    }}>
                      {farmersAhead > 0
                        ? `${farmersAhead} ${currentLang === 'ta' ? 'உழவர்கள்' : 'farmers'}`
                        : `✓ ${t('nextInLine')}`}
                    </div>
                  </div>
                </div>

                {/* ============================================================= */}
                {/* 2. ONE PRIMARY DYNAMIC ACTION (TRANSIT NOTIFICATION / GATE)   */}
                {/* ============================================================= */}
                <div style={{ marginTop: 20, paddingTop: 18, borderTop: '1px solid var(--kq-border-light)' }}>
                  {(currentStatus === 'Confirmed' || currentStatus === 'Booked') ? (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: 14,
                      backgroundColor: 'var(--kq-green-50)',
                      border: '1.5px solid var(--kq-green-300)',
                      borderRadius: 'var(--kq-radius-md)',
                      padding: '16px 20px'
                    }}>
                      <div style={{ flex: '1 1 340px' }}>
                        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--kq-green-900)', display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Icon name="truck" size={20} color="var(--kq-green-800)" />
                          {t('transitPromptTitle')}
                        </div>
                        <div style={{ fontSize: 12.5, color: 'var(--kq-green-800)', marginTop: 4, lineHeight: 1.4 }}>
                          {t('transitPromptDesc')}
                        </div>
                      </div>
                      <PrimaryButton
                        onClick={handleOnMyWay}
                        loading={transitLoading}
                        style={{
                          padding: '12px 24px',
                          fontSize: 14,
                          fontWeight: 700,
                          gap: 8,
                          boxShadow: 'var(--kq-shadow-sm)'
                        }}
                      >
                        <Icon name="truck" size={18} />
                        {transitLoading ? t('notifyingCentre') : t('onMyWayBtn')}
                      </PrimaryButton>
                    </div>
                  ) : currentStatus === 'On The Way' ? (
                    <div style={{
                      backgroundColor: '#fffbeb',
                      border: '1.5px solid #fde68a',
                      borderRadius: 'var(--kq-radius-md)',
                      padding: '16px 20px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12
                    }}>
                      <Icon name="truck" size={24} color="#b45309" />
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#92400e' }}>
                          {t('transitActiveTitle')}
                        </div>
                        <div style={{ fontSize: 12.5, color: '#78350f', marginTop: 2 }}>
                          {t('transitActiveDesc')}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div style={{
                      backgroundColor: 'var(--kq-green-50)',
                      border: '1px solid var(--kq-green-200)',
                      borderRadius: 'var(--kq-radius-sm)',
                      padding: '12px 16px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: 13,
                      color: 'var(--kq-green-900)'
                    }}>
                      <Icon name="check-circle" size={16} color="var(--kq-green-700)" />
                      <span>
                        {currentLang === 'ta'
                          ? `தற்போதைய நிலைய செயல்முறை: ${t('status' + currentStatus.replace(/[\s-]/g, '')) || currentStatus}`
                          : `Active Gate Stage: ${currentStatus}`}
                      </span>
                    </div>
                  )}
                </div>
              </>
            )}

          </div>

          {/* ================================================================= */}
          {/* 3. LIVE CONDITIONS: WEATHER & CENTRE CONGESTION STATUS             */}
          {/* ================================================================= */}
          <div style={{ marginBottom: 22 }}>
            <div style={{
              fontSize: 12,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: 'var(--kq-text-muted)',
              marginBottom: 10,
              display: 'flex',
              alignItems: 'center',
              gap: 6
            }}>
              <Icon name="activity" size={14} color="var(--kq-green-700)" />
              <span>{t('liveConditions')}</span>
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: 12
            }}>
              {/* Card 1: Weather Advisory */}
              <div style={{
                background: (!weather || !weather.available) ? '#f8fafc' : (weather.is_inclement ? '#fffbeb' : '#ffffff'),
                border: (!weather || !weather.available) ? '1px solid var(--kq-border-light)' : (weather.is_inclement ? '1.5px solid #fde68a' : '1px solid var(--kq-border-medium)'),
                borderRadius: 'var(--kq-radius-md)',
                padding: '14px 16px',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12,
                boxShadow: 'var(--kq-shadow-xs)'
              }}>
                <div style={{
                  width: 38,
                  height: 38,
                  borderRadius: 'var(--kq-radius-sm)',
                  background: (!weather || !weather.available) ? '#f1f5f9' : (weather.is_inclement ? '#fef3c7' : '#f0fdf4'),
                  color: (!weather || !weather.available) ? '#64748b' : (weather.is_inclement ? '#b45309' : '#15803d'),
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}>
                  <Icon name={(!weather || !weather.available) ? 'cloud' : (weather.is_inclement ? 'cloud-rain' : 'sun')} size={20} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--kq-text-secondary)', textTransform: 'uppercase' }}>
                      {t('weatherTitle')}
                    </span>
                    {weather?.available && weather?.temperature_c != null && (
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--kq-text-primary)' }}>
                        {Math.round(weather.temperature_c)}°C
                      </span>
                    )}
                  </div>
                  {(!weather || !weather.available) ? (
                    <>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--kq-text-secondary)', marginTop: 2 }}>
                        {currentLang === 'ta' ? 'வானிலை தகவல் தற்காலிகமாக கிடைக்கவில்லை' : 'Weather temporarily unavailable'}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--kq-text-muted)', marginTop: 2 }}>
                        {currentLang === 'ta' ? 'கொள்முதல் பணிகள் தடையின்றி தொடர்கின்றன' : 'Centre procurement operations proceeding normally'}
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: 14, fontWeight: 700, color: weather.is_inclement ? '#92400e' : 'var(--kq-green-900)', marginTop: 2 }}>
                        {weather.is_inclement ? `⚠ ${t('weatherRainExpected')}` : `✓ ${t('weatherGood')}`}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--kq-text-secondary)', marginTop: 2, lineHeight: 1.4 }}>
                        {weather.is_inclement
                          ? (weather.advisory || t('weatherRainExpected'))
                          : (currentLang === 'ta'
                              ? `${Math.round(weather.temperature_c)}°C · ${t('weatherNoRain')} · சீரான கொள்முதல்`
                              : `${Math.round(weather.temperature_c)}°C · ${t('weatherNoRain')} · Normal operations`)}
                      </div>
                      {weather.source_label && (
                        <div style={{ fontSize: 10.5, color: 'var(--kq-text-muted)', marginTop: 4 }}>
                          Source: {weather.source_label} {weather.observation_time ? `(${new Date(weather.observation_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})` : ''}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Card 2: Centre Congestion & Delay Status */}
              {(() => {
                const liveCongestion = passData?.live_metrics?.congestion_level || passData?.congestion_level || 'LOW';
                const isCritical = liveCongestion === 'PAUSED' || (pacing && (pacing.pacing_status === 'CRITICAL' || pacing.pacing_status === 'PAUSED'));
                const hasStagger = Boolean(pacing && pacing.recommended_delay_minutes > 0);
                
                const isHigh = !isCritical && (liveCongestion === 'HIGH' || liveCongestion === 'FULL');
                const isModerate = !isCritical && !isHigh && (liveCongestion === 'MODERATE' || liveCongestion === 'MEDIUM');
                const isLow = !isCritical && !isHigh && !isModerate;

                const effectiveDisplayWait = passData?.live_metrics?.display_wait || displayWait;
                
                const badgeColor = isCritical ? '#7c2d12' : (isHigh ? '#dc2626' : (isModerate ? '#d97706' : '#16a34a'));
                const bgCard = isCritical ? '#fff7ed' : (isHigh ? '#fef2f2' : (isModerate ? '#fffbeb' : '#ffffff'));
                const borderCard = isCritical ? '1.5px solid #fed7aa' : (isHigh ? '1.5px solid #fecaca' : (isModerate ? '1.5px solid #fde68a' : '1px solid var(--kq-border-medium)'));
                
                let statusTitle = '';
                if (isCritical) {
                  statusTitle = currentLang === 'ta' ? 'கொள்முதல் தற்காலிகமாக நிறுத்தப்பட்டுள்ளது' : 'Procurement Temporarily Paused';
                } else if (isHigh) {
                  statusTitle = currentLang === 'ta' ? `அதிக நெரிசல் · ${effectiveDisplayWait}` : `${t('highCongestion')} · ${effectiveDisplayWait}`;
                } else if (isModerate) {
                  statusTitle = currentLang === 'ta' ? `மிதமான நெரிசல் · ${effectiveDisplayWait}` : `${t('moderateCongestion')} · ${effectiveDisplayWait}`;
                } else {
                  statusTitle = currentLang === 'ta' ? `குறைவான நெரிசல் · ${effectiveDisplayWait}` : `${t('lowCongestion')} · ${effectiveDisplayWait}`;
                }

                return (
                  <div style={{
                    background: bgCard,
                    border: borderCard,
                    borderRadius: 'var(--kq-radius-md)',
                    padding: '14px 16px',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 12,
                    boxShadow: 'var(--kq-shadow-xs)'
                  }}>
                    <div style={{
                      width: 38,
                      height: 38,
                      borderRadius: 'var(--kq-radius-sm)',
                      background: isCritical ? '#ffedd5' : (isHigh ? '#fee2e2' : (isModerate ? '#fef3c7' : '#f0fdf4')),
                      color: badgeColor,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0
                    }}>
                      <Icon name={isCritical ? 'pause-circle' : (isHigh ? 'alert-triangle' : (isModerate ? 'clock' : 'check-circle'))} size={20} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--kq-text-secondary)', textTransform: 'uppercase' }}>
                          {t('centreStatusTitle')}
                        </span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: badgeColor }}>
                          {effectiveDisplayWait}
                        </span>
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: isCritical ? '#7c2d12' : (isHigh ? '#991b1b' : (isModerate ? '#92400e' : 'var(--kq-green-900)')), marginTop: 2 }}>
                        {statusTitle}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--kq-text-secondary)', marginTop: 2, lineHeight: 1.4 }}>
                        {farmersAhead > 0
                          ? `${farmersAhead} ${currentLang === 'ta' ? 'உழவர்கள் உங்கள் முன் வரிசையில் உள்ளனர்' : 'farmers ahead in queue'}`
                          : (currentLang === 'ta' ? 'நேரடியாக இறக்கலாம் · குறைந்தபட்ச காத்திருப்பு' : 'Direct unloading · minimal queue')}
                      </div>

                      {/* Stagger Delay recommendation if active */}
                      {hasStagger && (
                        <div style={{
                          marginTop: 10,
                          paddingTop: 8,
                          borderTop: '1px dashed #fecaca',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          gap: 6
                        }}>
                          <div style={{ fontSize: 11.5, fontWeight: 700, color: '#b91c1c' }}>
                            ➔ +{pacing.recommended_delay_minutes} min stagger recommended
                          </div>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              type="button"
                              onClick={() => setShowExplanationModal(true)}
                              className="kq-btn kq-btn-secondary"
                              style={{ height: 26, padding: '2px 8px', fontSize: 11 }}
                            >
                              {t('whyRecommended')}
                            </button>
                            {!pacing.pacing_acknowledged ? (
                              <PrimaryButton
                                onClick={handleAcknowledgePacing}
                                loading={pacingAckLoading}
                                style={{ height: 26, fontSize: 11, padding: '2px 10px' }}
                              >
                                {t('pacingAckBtn')}
                              </PrimaryButton>
                            ) : (
                              <span style={{ fontSize: 11, color: 'var(--kq-green-800)', fontWeight: 700 }}>
                                ✓ {t('pacingAckDone')}
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Faster Alternative Slots Drawer & Expiry Handling */}
          {(() => {
            const isOriginalExpired = Boolean(rescheduleData?.is_original_expired);
            const suggestions = rescheduleData?.suggestions || [];
            const hasSuggestions = suggestions.length > 0;

            // If appointment is expired and no suggestions, show clean notice
            if (isOriginalExpired && !hasSuggestions) {
              return (
                <div style={{
                  background: '#fef2f2',
                  border: '1.5px solid #fecaca',
                  borderRadius: 'var(--kq-radius-md)',
                  padding: '16px 20px',
                  marginBottom: 24
                }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#991b1b', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Icon name="alert-triangle" size={18} color="#dc2626" />
                    <span>{currentLang === 'ta' ? 'அசல் முன்பதிவு நேரம் காலாவதியானது' : 'Original Appointment Slot Expired'}</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: '#7f1d1d', marginTop: 4, lineHeight: 1.4 }}>
                    {currentLang === 'ta'
                      ? 'உங்கள் முன்பதிவு நேரம் முடிந்துவிட்டது. தற்போது உடனடி மாற்று நேரங்கள் எதுவும் காலியாக இல்லை. புதிய நேரத்தை முன்பதிவு செய்ய முகப்புப் பக்கத்திற்குச் செல்லவும் அல்லது நிலையத்தை அணுகவும்.'
                      : 'Your scheduled appointment slot has expired and no immediate slots are open in your district. Please check back later or contact your centre administrator to reschedule.'}
                  </div>
                </div>
              );
            }

            // If not expired and no suggestions, do not display empty box
            if (!hasSuggestions) return null;

            // Auto-expand if expired, else follow toggle state
            const effectiveExpanded = isOriginalExpired ? true : showAlternatives;

            return (
              <div style={{
                background: isOriginalExpired ? '#fff7ed' : '#fafaf9',
                border: isOriginalExpired ? '1.5px solid #fdba74' : '1px solid var(--kq-border-medium)',
                borderRadius: 'var(--kq-radius-md)',
                padding: '16px 20px',
                marginBottom: 24,
                boxShadow: 'var(--kq-shadow-xs)'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: isOriginalExpired ? '#9a3412' : 'var(--kq-text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Icon name={isOriginalExpired ? 'alert-circle' : 'refresh-cw'} size={18} color={isOriginalExpired ? '#ea580c' : 'var(--kq-green-700)'} />
                      <span>
                        {isOriginalExpired
                          ? (currentLang === 'ta' ? 'முன்பதிவு காலாவதியானது — மாற்று நேரங்கள்' : 'Appointment Expired — Select New Slot')
                          : t('alternativeSlotsTitle')}
                      </span>
                    </div>
                    <div style={{ fontSize: 12.5, color: isOriginalExpired ? '#9a3412' : 'var(--kq-text-secondary)', marginTop: 2 }}>
                      {isOriginalExpired
                        ? (currentLang === 'ta'
                            ? 'உங்கள் அசல் முன்பதிவு நேரம் முடிந்துவிட்டது. வரிசை இழப்பின்றி கீழே உள்ள புதிய நேரத்தை தேர்ந்தெடுக்கலாம்.'
                            : 'Your original appointment slot has elapsed. Select an upcoming operational slot below to rebook without penalty.')
                        : (currentLang === 'ta'
                            ? 'உங்கள் தற்போதைய முன்பதிவு செல்லுபடியாகும். விரும்பினால் மட்டுமே விரைவான மாற்று நேரத்தை தேர்வு செய்யலாம்.'
                            : 'Optional: Choose a slot with shorter queues. Your original slot remains 100% active.')}
                    </div>
                  </div>

                  {!isOriginalExpired && (
                    <button
                      type="button"
                      onClick={() => setShowAlternatives(!showAlternatives)}
                      className="kq-btn kq-btn-secondary"
                      style={{ fontSize: 12.5, height: 32, padding: '4px 12px' }}
                    >
                      {showAlternatives ? t('hideOptionsBtn') : t('viewOptionsBtn')}
                    </button>
                  )}
                </div>

                {effectiveExpanded && (
                  <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
                    {suggestions.slice(0, 4).map((opt, idx) => (
                      <Card key={idx} style={{ padding: 16, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: '#ffffff' }}>
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
                            <span style={{
                              fontSize: 10.5,
                              fontWeight: 700,
                              padding: '2px 8px',
                              borderRadius: 4,
                              background: opt.type === 'SAME_CENTRE_SLOT' ? '#eff6ff' : '#fef3c7',
                              color: opt.type === 'SAME_CENTRE_SLOT' ? '#1e40af' : '#92400e',
                              textTransform: 'uppercase'
                            }}>
                              {opt.type === 'SAME_CENTRE_SLOT' ? t('sameCentreFaster') : t('nearbyCentreOption')}
                            </span>
                            <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--kq-green-800)' }}>
                              ~{opt.estimated_wait_minutes} min {t('estWaitText')}
                            </span>
                          </div>

                          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--kq-text-primary)', marginTop: 8 }}>
                            {opt.centre_name}
                          </div>
                          
                          <div style={{ fontSize: 12.5, color: 'var(--kq-text-secondary)', marginTop: 4 }}>
                            Date & Slot: <strong>{opt.date_label || opt.date || 'Today'} · {formatHumanTime(`${opt.start_time || ''} - ${opt.end_time || ''}`)}</strong>
                          </div>

                          {/* Road distance transparency */}
                          <div style={{ fontSize: 12, color: 'var(--kq-text-muted)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Icon name="map-pin" size={12} color="var(--kq-green-700)" />
                            <span>
                              {opt.distance_km > 0
                                ? `${opt.distance_km} km ${opt.is_road_distance ? (currentLang === 'ta' ? 'சாலை தொலைவு' : 'verified road distance') : 'away'} (${opt.district})`
                                : (currentLang === 'ta' ? 'அதே கொள்முதல் நிலையம்' : 'Same procurement centre')}
                            </span>
                          </div>

                          {/* Available capacity */}
                          <div style={{ fontSize: 11.5, color: 'var(--kq-green-800)', marginTop: 3, fontWeight: 600 }}>
                            ✓ {opt.available_capacity != null ? `${opt.available_capacity} slots available` : 'Capacity available'}
                          </div>

                          {/* Collapsible Why recommended section */}
                          <details style={{ marginTop: 10, background: '#f8fafc', padding: '6px 10px', borderRadius: 4, border: '1px solid var(--kq-border-light)' }}>
                            <summary style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--kq-green-800)', cursor: 'pointer', outline: 'none' }}>
                              {currentLang === 'ta' ? 'ஏன் இந்த பரிந்துரை?' : 'Why recommended?'}
                            </summary>
                            <div style={{ fontSize: 11.5, color: 'var(--kq-text-secondary)', marginTop: 6, lineHeight: 1.4 }}>
                              {opt.explanation}
                            </div>
                          </details>
                        </div>

                        <div style={{ marginTop: 14 }}>
                          <PrimaryButton
                            onClick={() => handleRescheduleDecision('ACCEPT', opt)}
                            loading={rescheduleLoading}
                            style={{ width: '100%', fontSize: 13 }}
                          >
                            {t('chooseThisOptionBtn')}
                          </PrimaryButton>
                        </div>
                      </Card>
                    ))}

                    {!isOriginalExpired && (
                      <div style={{ gridColumn: '1 / -1', textAlign: 'center', marginTop: 6 }}>
                        <SecondaryButton
                          onClick={() => handleRescheduleDecision('REJECT')}
                          loading={rescheduleLoading}
                          style={{ fontSize: 13 }}
                        >
                          {t('keepOriginalBtn')}
                        </SecondaryButton>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

          {/* ================================================================= */}
          {/* 4. PROGRESSIVE 8-STAGE JOURNEY TRACKER                             */}
          {/* ================================================================= */}
          <div style={{
            background: '#ffffff',
            border: '1px solid var(--kq-border-medium)',
            borderRadius: 'var(--kq-radius-lg)',
            padding: '20px 24px',
            marginBottom: 24,
            boxShadow: 'var(--kq-shadow-xs)'
          }}>
            {/* Summary: Current Status + Next Step + Expand Button */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 16
            }}>
              <div style={{ flex: '1 1 320px' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--kq-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {t('currentStatusLabel')}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 24,
                    height: 24,
                    borderRadius: '50%',
                    background: 'var(--kq-green-700)',
                    color: '#ffffff',
                    fontSize: 12,
                    fontWeight: 800
                  }}>
                    ✓
                  </span>
                  <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--kq-green-900)' }}>
                    {t(JOURNEY_STEPS[currentStepIdx]?.labelKey) || currentStatus}
                  </span>
                </div>
                
                {/* Next Step Guidance */}
                <div style={{
                  marginTop: 10,
                  padding: '8px 12px',
                  background: 'var(--kq-bg-subtle)',
                  borderLeft: '3px solid var(--kq-green-700)',
                  borderRadius: 'var(--kq-radius-sm)',
                  fontSize: 13,
                  color: 'var(--kq-text-primary)',
                  lineHeight: 1.4
                }}>
                  <strong>{t('nextStepLabel')}:</strong> {getNextStepAdvice(currentStatus)}
                </div>
              </div>

              {/* Progressive Disclosure Toggle */}
              <div>
                <button
                  type="button"
                  onClick={() => setShowJourney(!showJourney)}
                  className="kq-btn kq-btn-secondary"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '8px 16px',
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  <span>{showJourney ? t('hideProgress') : t('viewProgress')}</span>
                </button>
              </div>
            </div>

            {/* Expandable 8-Stage Progress Steps */}
            {showJourney && (
              <div style={{
                marginTop: 20,
                paddingTop: 18,
                borderTop: '1px solid var(--kq-border-light)'
              }}>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  gap: 10
                }}>
                  {JOURNEY_STEPS.map((step, idx) => {
                    const isPast = currentStepIdx > idx;
                    const isCurrent = currentStepIdx === idx;

                    let bgColor = 'var(--kq-bg-subtle)';
                    let borderColor = 'var(--kq-border-light)';
                    let titleColor = 'var(--kq-text-muted)';
                    let badgeBg = 'var(--kq-border-strong)';

                    if (isPast) {
                      bgColor = 'var(--kq-green-50)';
                      borderColor = 'var(--kq-green-200)';
                      titleColor = 'var(--kq-green-800)';
                      badgeBg = 'var(--kq-green-700)';
                    } else if (isCurrent) {
                      bgColor = '#eff6ff';
                      borderColor = '#bfdbfe';
                      titleColor = '#1e40af';
                      badgeBg = '#2563eb';
                    }

                    return (
                      <div
                        key={step.key}
                        style={{
                          background: bgColor,
                          border: `1.5px solid ${borderColor}`,
                          borderRadius: 'var(--kq-radius-md)',
                          padding: '12px 10px',
                          position: 'relative'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              width: 20,
                              height: 20,
                              borderRadius: '50%',
                              background: badgeBg,
                              color: '#ffffff',
                              fontSize: 11,
                              fontWeight: 700
                            }}
                          >
                            {isPast ? '✓' : idx + 1}
                          </span>
                          <span style={{ fontSize: 12.5, fontWeight: 700, color: titleColor }}>
                            {t(step.labelKey)}
                          </span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--kq-text-muted)', lineHeight: 1.3 }}>
                          {currentLang === 'ta' ? step.descTa : step.descEn}
                        </div>
                        {isCurrent && (
                          <div style={{ marginTop: 6, display: 'inline-block', fontSize: 10, fontWeight: 700, background: '#2563eb', color: '#ffffff', padding: '2px 6px', borderRadius: 4 }}>
                            ● {currentLang === 'ta' ? 'நடப்பில் உள்ளது' : 'IN PROGRESS'}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* ================================================================= */}
          {/* 5. OFFICIAL DOCUMENT SHORTCUTS (COMPACT NAVIGATION ONLY)         */}
          {/* ================================================================= */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 12,
            padding: '14px 18px',
            background: '#ffffff',
            borderRadius: 'var(--kq-radius-md)',
            border: '1px solid var(--kq-border-medium)',
            marginBottom: 24
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 36,
                height: 36,
                borderRadius: 'var(--kq-radius-sm)',
                background: 'var(--kq-green-100)',
                color: 'var(--kq-green-900)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <Icon name="folder" size={18} />
              </div>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--kq-text-primary)' }}>
                  {t('officialDocumentsSection')}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--kq-text-secondary)' }}>
                  {t('certificateWeighmentPayment')}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Link
                to={`/pass/${activeBooking.booking_id}`}
                className="kq-btn kq-btn-secondary"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12.5,
                  fontWeight: 700,
                  textDecoration: 'none',
                  padding: '6px 14px',
                  color: 'var(--kq-green-900)'
                }}
              >
                <Icon name="file-text" size={14} color="var(--kq-green-800)" />
                <span>{t('viewDigitalPassBtn')}</span>
              </Link>

              <Link
                to={activeBooking?.booking_id ? `/farmer/documents?bookingId=${activeBooking.booking_id}` : '/farmer/documents'}
                className="kq-btn kq-btn-secondary"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12.5,
                  fontWeight: 700,
                  textDecoration: 'none',
                  padding: '6px 14px',
                  color: 'var(--kq-text-primary)'
                }}
              >
                <Icon name="folder" size={14} color="var(--kq-text-secondary)" />
                <span>{t('viewProcurementRecordBtn')}</span>
              </Link>
            </div>
          </div>

          {/* ================================================================= */}
          {/* 6. PROGRESSIVE DISCLOSURE: ALL BOOKINGS & HISTORY                  */}
          {/* ================================================================= */}
          {bookings.length > 0 && (() => {
            const totalVisits = bookings.length;
            const totalPages = Math.ceil(totalVisits / VISITS_PER_PAGE);
            const startIndex = (historyPage - 1) * VISITS_PER_PAGE;
            const endIndex = Math.min(startIndex + VISITS_PER_PAGE, totalVisits);
            const pagedBookings = bookings.slice(startIndex, endIndex);

            return (
              <Card
                title={t('viewAllBookings')}
                subtitle={currentLang === 'ta' ? 'உங்கள் உழவர் எண்ணில் உள்ள அனைத்து வருகைகள்' : 'All scheduled visits under this Farmer account'}
                style={{ marginBottom: 24 }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {pagedBookings.map((row) => {
                    const isCurrentActive = activeBooking && activeBooking.booking_id === row.booking_id;
                    const token = row.token || (row.queue_position_at_booking ? `Q${String(row.queue_position_at_booking).padStart(3, '0')}` : (row.booking_id ? row.booking_id.slice(-5) : 'Q001'));
                    const centreTitle = cleanCentreName(row.centre_name, row.centre_id);
                    const cropDisplay = `${row.crop || 'Paddy'} · ${row.quantity_quintals || row.quantity || 50} Qtl`;
                    const timeSlot = row.slot_time ? formatHumanTime(row.slot_time) : '';

                    return (
                      <div
                        key={row.booking_id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          flexWrap: 'wrap',
                          gap: 12,
                          padding: '12px 14px',
                          borderRadius: 'var(--kq-radius-md)',
                          border: isCurrentActive ? '1.5px solid var(--kq-green-700)' : '1px solid var(--kq-border-light)',
                          background: isCurrentActive ? 'var(--kq-green-50)' : '#ffffff',
                          boxShadow: 'var(--kq-shadow-xs)'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                          <div style={{
                            minWidth: 54,
                            height: 38,
                            borderRadius: 'var(--kq-radius-sm)',
                            background: isCurrentActive ? 'var(--kq-green-800)' : 'var(--kq-bg-subtle)',
                            color: isCurrentActive ? '#ffffff' : 'var(--kq-green-900)',
                            fontWeight: 800,
                            fontSize: 14,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            border: isCurrentActive ? 'none' : '1px solid var(--kq-border-medium)'
                          }}>
                            {token}
                          </div>

                          <div>
                            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--kq-text-primary)' }}>
                              {centreTitle}
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--kq-text-secondary)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              <span>{formatHumanDate(row.booking_date)}{timeSlot ? ` • ${timeSlot}` : ''}</span>
                              <span>•</span>
                              <span style={{ fontWeight: 600 }}>{cropDisplay}</span>
                            </div>
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <StatusBadge status={row.status} size="small" />
                          <button
                            type="button"
                            onClick={() => {
                              setActiveBooking(row);
                              loadBookingDetails(row.booking_id);
                              window.scrollTo({ top: 0, behavior: 'smooth' });
                            }}
                            className={`kq-btn ${isCurrentActive ? 'kq-btn-primary' : 'kq-btn-secondary'}`}
                            style={{ height: 30, padding: '4px 12px', fontSize: 12, fontWeight: 700 }}
                          >
                            {t('viewVisitBtn')}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Pagination Controls */}
                {totalPages > 1 && (
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginTop: 14,
                    paddingTop: 12,
                    borderTop: '1px solid var(--kq-border-light)',
                    fontSize: 12.5,
                    color: 'var(--kq-text-secondary)',
                    flexWrap: 'wrap',
                    gap: 8
                  }}>
                    <div>
                      {currentLang === 'ta'
                        ? `${totalVisits}-ல் ${startIndex + 1}–${endIndex} வருகைகள் காட்டப்படுகின்றன`
                        : `Showing ${startIndex + 1}–${endIndex} of ${totalVisits} visits`}
                    </div>

                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        disabled={historyPage <= 1}
                        onClick={() => setHistoryPage(p => Math.max(1, p - 1))}
                        className="kq-btn kq-btn-secondary"
                        style={{
                          height: 28,
                          padding: '2px 10px',
                          fontSize: 12,
                          opacity: historyPage <= 1 ? 0.5 : 1,
                          cursor: historyPage <= 1 ? 'not-allowed' : 'pointer'
                        }}
                      >
                        {t('previousBtn')}
                      </button>
                      <button
                        type="button"
                        disabled={historyPage >= totalPages}
                        onClick={() => setHistoryPage(p => Math.min(totalPages, p + 1))}
                        className="kq-btn kq-btn-secondary"
                        style={{
                          height: 28,
                          padding: '2px 10px',
                          fontSize: 12,
                          opacity: historyPage >= totalPages ? 0.5 : 1,
                          cursor: historyPage >= totalPages ? 'not-allowed' : 'pointer'
                        }}
                      >
                        {t('nextBtn')}
                      </button>
                    </div>
                  </div>
                )}
              </Card>
            );
          })()}

          {/* Rescheduling Audit Trail Toggle (Progressive Disclosure) */}
          {rescheduleHistory.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <button
                type="button"
                onClick={() => setShowHistory(!showHistory)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--kq-green-800)',
                  fontWeight: 600,
                  fontSize: 12.5,
                  cursor: 'pointer',
                  padding: 0,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6
                }}
              >
                <Icon name={showHistory ? 'chevron-down' : 'chevron-right'} size={14} />
                <span>{t('auditTrailTitle')} ({rescheduleHistory.length} events)</span>
              </button>

              {showHistory && (
                <div style={{ marginTop: 10, background: '#ffffff', border: '1px solid var(--kq-border-medium)', borderRadius: 'var(--kq-radius-md)', overflow: 'hidden' }}>
                  <DataTable
                    columns={[
                      { key: 'created_at', header: 'Timestamp', render: val => formatHumanDate(val) },
                      {
                        key: 'action',
                        header: 'Decision',
                        render: val => (
                          <span style={{
                            padding: '2px 6px',
                            borderRadius: 4,
                            fontWeight: 700,
                            fontSize: 11,
                            background: val === 'ACCEPTED' ? 'var(--kq-green-100)' : '#fee2e2',
                            color: val === 'ACCEPTED' ? 'var(--kq-green-800)' : '#991b1b'
                          }}>
                            {val}
                          </span>
                        )
                      },
                      { key: 'old_slot_id', header: 'From Slot' },
                      { key: 'new_slot_id', header: 'To Slot / Centre', render: (_, r) => `${cleanCentreName(r.new_centre_name, r.new_centre_id)} (${r.new_slot_id})` },
                      { key: 'reason', header: 'Reason' }
                    ]}
                    data={rescheduleHistory}
                  />
                </div>
              )}
            </div>
          )}

          {/* Explanation Modal ("Why am I seeing this?") */}
          <Modal
            isOpen={showExplanationModal}
            onClose={() => setShowExplanationModal(false)}
            title={t('pacingTitle')}
            subtitle="Operational Queue Pacing Transparency"
            footer={
              <PrimaryButton onClick={() => setShowExplanationModal(false)}>
                {currentLang === 'ta' ? 'புரிந்து கொண்டேன்' : 'Understood'}
              </PrimaryButton>
            }
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--kq-text-primary)' }}>
                {currentLang === 'ta'
                  ? 'விவசாயிகள் மற்றும் டிராக்டர்கள் வெயிலிலும் மழையிலும் நீண்ட நேரம் சாலையில் காத்திருப்பதைத் தவிர்க்க, கொள்முதல் நிலையத்தின் எடை வேகத்தைக் கணித்து கணினி தானாகவே வருகை நேரத்தை பரிந்துரைக்கிறது.'
                  : 'To protect tractors and carts from waiting in long road queues in harsh weather, Kisan Vikas calculates actual weighbridge speed and advises staggered arrivals.'}
              </p>
              <div style={{ padding: '12px 14px', backgroundColor: 'var(--kq-bg-subtle)', borderRadius: 'var(--kq-radius-sm)', fontSize: 13 }}>
                <div><strong>Centre:</strong> {centreName}</div>
                <div><strong>Advisory:</strong> {pacing?.pacing_status || 'DELAY'}</div>
                <div><strong>Reason:</strong> {pacing?.reason || 'Inclement weather / temporary scale backlog'}</div>
              </div>
              <p style={{ margin: 0, fontSize: 12.5, color: 'var(--kq-text-muted)' }}>
                {currentLang === 'ta'
                  ? 'உங்கள் முன்பதிவு 100% உறுதியானது. சிறிது நேரம் கழித்து வந்தாலும் உங்கள் டோக்கன் வரிசை பாதுகாக்கப்படும்.'
                  : 'Your booking remains 100% confirmed and protected. Even if you arrive at the recommended later time, your queue order is guaranteed.'}
              </p>
            </div>
          </Modal>

          {/* Alternative Option Explanation Modal */}
          {selectedWhyAlternative && (
            <Modal
              isOpen={!!selectedWhyAlternative}
              onClose={() => setSelectedWhyAlternative(null)}
              title={currentLang === 'ta' ? 'ஏன் இந்த மாற்று நேரம்?' : 'Why This Option?'}
              subtitle={cleanCentreName(selectedWhyAlternative.centre_name, selectedWhyAlternative.centre_id)}
              footer={
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', width: '100%' }}>
                  <SecondaryButton onClick={() => setSelectedWhyAlternative(null)}>
                    {currentLang === 'ta' ? 'மூடுக' : 'Close'}
                  </SecondaryButton>
                  <PrimaryButton onClick={() => {
                    const opt = selectedWhyAlternative;
                    setSelectedWhyAlternative(null);
                    handleRescheduleDecision('ACCEPT', opt);
                  }}>
                    {t('chooseThisOptionBtn')}
                  </PrimaryButton>
                </div>
              }
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 14px',
                  background: 'var(--kq-green-50)',
                  borderRadius: 'var(--kq-radius-sm)',
                  border: '1px solid var(--kq-green-200)'
                }}>
                  <div style={{
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    background: 'var(--kq-green-800)',
                    color: '#ffffff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}>
                    <Icon name="clock" size={18} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--kq-green-900)' }}>
                      ~{selectedWhyAlternative.estimated_wait_minutes} min {t('estWaitText')}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--kq-green-800)' }}>
                      {selectedWhyAlternative.distance_km > 0
                        ? `${selectedWhyAlternative.distance_km} km ${currentLang === 'ta' ? 'தொலைவு' : 'away'} (${selectedWhyAlternative.district})`
                        : (currentLang === 'ta' ? 'அதே கொள்முதல் நிலையம்' : 'Same procurement centre')}
                    </div>
                  </div>
                </div>

                <div style={{
                  padding: '12px 14px',
                  background: 'var(--kq-bg-subtle)',
                  borderRadius: 'var(--kq-radius-sm)',
                  fontSize: 13,
                  lineHeight: 1.5,
                  color: 'var(--kq-text-primary)'
                }}>
                  <strong style={{ color: 'var(--kq-green-800)', display: 'block', marginBottom: 4 }}>
                    {t('whyRecommended')}:
                  </strong>
                  {selectedWhyAlternative.explanation}
                </div>

                <p style={{ margin: 0, fontSize: 12, color: 'var(--kq-text-muted)', lineHeight: 1.4 }}>
                  {currentLang === 'ta'
                    ? 'குறிப்பு: நீங்கள் இந்த புதிய நேரத்தை தேர்வு செய்யும் வரை உங்கள் தற்போதைய முன்பதிவு எவ்வித மாற்றமும் இன்றி செல்லுபடியாகும்.'
                    : 'Note: Your current booking stays 100% active unless you choose this alternative option.'}
                </p>
              </div>
            </Modal>
          )}

        </>
      )}

    </div>
  );
}
