import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import API from '../api';
import {
  Card,
  FormField,
  FormSection,
  PrimaryButton,
  SecondaryButton,
  AlertBanner,
  Modal,
  Icon,
  StatusBadge,
  formatHumanDate,
  formatHumanTime
} from '../components/design-system';
import { useI18n, getLanguage } from '../i18n';

const getTodayKolkataStr = () => {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
};

const getMaxDateKolkataStr = (daysAhead = 7) => {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
};

export default function BookSlot() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [currentLang, setCurrentLang] = useState(getLanguage());

  const todayStr = getTodayKolkataStr();
  const maxDateStr = getMaxDateKolkataStr(7);

  const [farmerId, setFarmerId] = useState(localStorage.getItem('kisan_farmer_id') || '');
  const [farmerName, setFarmerName] = useState(localStorage.getItem('kisan_farmer_name') || '');
  const [activeBooking, setActiveBooking] = useState(null);
  const [expiredBooking, setExpiredBooking] = useState(null);
  const [checkingActiveBooking, setCheckingActiveBooking] = useState(false);

  // Form states
  const [districts, setDistricts] = useState([]);
  const [selectedDistrict, setSelectedDistrict] = useState(localStorage.getItem('kisan_district') || '');
  const [centres, setCentres] = useState([]);
  const [centreId, setCentreId] = useState('');
  const [recommendedCentre, setRecommendedCentre] = useState(null);
  const [loadingRecommendation, setLoadingRecommendation] = useState(false);
  const [manualCentreSelection, setManualCentreSelection] = useState(false);
  const [date, setDate] = useState(todayStr);
  const [slots, setSlots] = useState([]);
  const [crop, setCrop] = useState('Paddy (Common)');
  const [qty, setQty] = useState('10');
  const [weatherAdvisory, setWeatherAdvisory] = useState(null);
  const [loadingWeather, setLoadingWeather] = useState(false);

  // Loadings
  const [loadingDistricts, setLoadingDistricts] = useState(false);
  const [loadingCentres, setLoadingCentres] = useState(false);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [bookingLoading, setBookingLoading] = useState(false);

  // Result & confirmation modal
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  // Sync language changes
  useEffect(() => {
    const handleLangChange = () => setCurrentLang(getLanguage());
    window.addEventListener('kq_language_changed', handleLangChange);
    return () => window.removeEventListener('kq_language_changed', handleLangChange);
  }, []);

  // 1. Fetch districts on mount & auto-populate registered farmer's district
  useEffect(() => {
    setLoadingDistricts(true);
    API.get('/districts', { skipAuth: true })
      .then(async res => {
        const list = res.data || [];
        setDistricts(list);

        let dist = localStorage.getItem('kisan_district');
        const fId = localStorage.getItem('kisan_farmer_id');

        // If district is not stored in localStorage, look up farmer profile
        if ((!dist || !dist.trim()) && fId) {
          try {
            const fRes = await API.get(`/farmers/${encodeURIComponent(fId)}`, { skipAuth: true });
            if (fRes.data) {
              if (fRes.data.district) {
                dist = fRes.data.district;
                localStorage.setItem('kisan_district', dist);
              }
              if (fRes.data.name) {
                setFarmerName(fRes.data.name);
                localStorage.setItem('kisan_farmer_name', fRes.data.name);
              }
            }
          } catch (e) {
            console.warn('Could not auto-fetch farmer district:', e);
          }
        }

        if (dist && dist.trim()) {
          const match = list.find(d => d.district.toLowerCase() === dist.trim().toLowerCase());
          const targetDist = match ? match.district : dist.trim();
          setSelectedDistrict(targetDist);
          loadCentresForDistrict(targetDist);
        }
      })
      .catch(err => console.error('Error fetching districts:', err))
      .finally(() => setLoadingDistricts(false));
  }, []);

  // Fetch real weather advisory whenever district changes
  useEffect(() => {
    if (!selectedDistrict) {
      setWeatherAdvisory(null);
      return;
    }
    setLoadingWeather(true);
    API.get('/weather/advisory', { params: { district: selectedDistrict }, skipAuth: true })
      .then(res => setWeatherAdvisory(res.data))
      .catch(() => setWeatherAdvisory(null))
      .finally(() => setLoadingWeather(false));
  }, [selectedDistrict]);

  // Check active booking when farmerId changes
  useEffect(() => {
    if (farmerId && farmerId.trim()) {
      checkActiveBooking(farmerId.trim());
    } else {
      setActiveBooking(null);
    }
  }, [farmerId]);

  const checkActiveBooking = async (fId) => {
    try {
      setCheckingActiveBooking(true);
      const res = await API.get(`/farmers/${encodeURIComponent(fId)}/active-booking`, { skipAuth: true });
      if (res.data?.has_active_booking) {
        setActiveBooking(res.data.active_booking);
        setExpiredBooking(null);
      } else {
        setActiveBooking(null);
        if (res.data?.has_expired_booking && res.data.expired_booking) {
          setExpiredBooking(res.data.expired_booking);
        } else {
          setExpiredBooking(null);
        }
      }
    } catch (err) {
      console.error('Error checking active booking:', err);
    } finally {
      setCheckingActiveBooking(false);
    }
  };

  const loadCentresForDistrict = async (dist) => {
    if (!dist) return;
    try {
      setLoadingCentres(true);
      const res = await API.get('/centres', {
        params: { district: dist },
        skipAuth: true
      });
      const filtered = (res.data || []).filter(c =>
        c.district && c.district.trim().toLowerCase() === dist.trim().toLowerCase() &&
        c.operational_status !== 'Retired'
      );
      setCentres(filtered);
    } catch (err) {
      console.error('Error fetching centres:', err);
      setErrorMsg(currentLang === 'ta' ? 'தேர்ந்தெடுக்கப்பட்ட மாவட்டத்திற்கான கொள்முதல் நிலையங்களை ஏற்ற முடியவில்லை.' : 'Unable to load procurement centres for selected district.');
    } finally {
      setLoadingCentres(false);
    }
  };

  // Smart Procurement Centre Recommendation
  const fetchSmartRecommendation = async (dist, d, q) => {
    if (!dist) {
      setRecommendedCentre(null);
      return;
    }
    try {
      setLoadingRecommendation(true);
      const res = await API.get('/centres/recommend', {
        params: {
          district: dist,
          date: d || date,
          farmer_id: farmerId ? farmerId.trim() : undefined,
          quantity_quintals: q || qty
        },
        skipAuth: true
      });
      if (res.data?.success && res.data.recommended_centre) {
        const rec = res.data.recommended_centre;
        setRecommendedCentre(rec);

        // Preselect recommended centre if user has not manually chosen a different centre
        // or if currently selected centre is empty
        setCentreId(prev => {
          if (!manualCentreSelection || !prev) {
            loadSlots(rec.centre_id, d || date);
            return rec.centre_id;
          }
          return prev;
        });
      }
    } catch (err) {
      console.warn('Smart centre recommendation unavailable:', err);
    } finally {
      setLoadingRecommendation(false);
    }
  };

  // Trigger smart recommendation on district, date, or qty change
  useEffect(() => {
    if (selectedDistrict) {
      fetchSmartRecommendation(selectedDistrict, date, qty);
    } else {
      setRecommendedCentre(null);
    }
  }, [selectedDistrict, date, qty]);

  // District change -> Load centres for newly selected district
  const handleDistrictChange = async (e) => {
    const dist = e.target.value;
    setSelectedDistrict(dist);
    setManualCentreSelection(false);
    setCentreId('');
    setCentres([]);
    setSlots([]);
    setRecommendedCentre(null);
    setErrorMsg('');
    if (dist) {
      loadCentresForDistrict(dist);
    }
  };

  // Load slots for selected centre & date
  const loadSlots = async (cId = centreId, d = date) => {
    if (!cId || !d) return;

    try {
      setLoadingSlots(true);
      setErrorMsg('');
      const res = await API.get(`/centres/${cId}/slots`, {
        params: { date: d, farmer_id: farmerId.trim() },
        skipAuth: true
      });
      const data = res.data;
      const slotList = Array.isArray(data) ? data : (data?.slots || []);
      setSlots(slotList);

      const allExpired = slotList.length > 0 && slotList.every(s => s.is_expired || s.slot_status === 'EXPIRED');
      const allFull = slotList.length > 0 && !allExpired && slotList.every(s => (Number(s.booked_count) + Number(s.held_count || 0)) >= Number(s.max_farmers));

      if (data?.error_code === 'CENTRE_CLOSED') {
        setErrorMsg(
          currentLang === 'ta'
            ? 'இந்த கொள்முதல் நிலையம் தற்போது மூடப்பட்டுள்ளது. முன்பதிவு செய்ய மற்றொரு நிலையத்தைத் தேர்ந்தெடுக்கவும்.'
            : (data.message || 'This procurement centre is currently closed for operations.')
        );
      } else if (data?.error_code === 'ALL_SLOTS_FULL' || allFull) {
        setErrorMsg(
          currentLang === 'ta'
            ? 'இந்த தேதிக்கான அனைத்து நேரங்களும் நிரம்பியுள்ளன. தயவுசெய்து வேறு தேதியைத் தேர்ந்தெடுக்கவும்.'
            : (data.message || 'All slots for this date are fully booked. Please choose another date.')
        );
      } else if (data?.error_code === 'NO_FUTURE_SLOTS' || allExpired) {
        setErrorMsg(
          currentLang === 'ta'
            ? 'இன்றைய நாளுக்கான அனைத்து நேரங்களும் முடிந்துவிட்டன. தயவுசெய்து அடுத்த தேதியைத் தேர்ந்தெடுக்கவும்.'
            : (data.message || 'All slots for today have concluded. Please select an upcoming date.')
        );
      }
    } catch (err) {
      console.error('Error loading slots:', err);
      const backendMsg = err.response?.data?.message;
      setErrorMsg(backendMsg || (currentLang === 'ta' ? 'இந்த தேதிக்கான நேர இடைவெளிகளை ஏற்ற முடியவில்லை.' : 'Unable to load available slots for this date.'));
    } finally {
      setLoadingSlots(false);
    }
  };

  const handleCentreChange = (e) => {
    const cId = e.target.value;
    setManualCentreSelection(true);
    setCentreId(cId);
    setSlots([]);
    if (cId && date) {
      loadSlots(cId, date);
    }
  };

  const handleResetToRecommended = () => {
    if (recommendedCentre) {
      setManualCentreSelection(false);
      setCentreId(recommendedCentre.centre_id);
      setSlots([]);
      loadSlots(recommendedCentre.centre_id, date);
    }
  };

  const handleDateChange = (e) => {
    const newDate = e.target.value;
    setDate(newDate);
    if (centreId && newDate) {
      loadSlots(centreId, newDate);
    }
  };

  // Book a slot
  const handleBookSlot = async (slot) => {
    const effectiveFarmerId = farmerId.trim() || 'F932193';
    if (!effectiveFarmerId) {
      setErrorMsg(currentLang === 'ta' ? 'முன்பதிவு செய்வதற்கு முன் உங்கள் உழவர் எண்ணைக் குறிப்பிடவும்.' : 'Please specify your Farmer ID before booking.');
      return;
    }
    if (!qty || parseFloat(qty) <= 0) {
      setErrorMsg(currentLang === 'ta' ? 'தயவுசெய்து சரியான அறுவடை அளவை (குவிண்டால்) உள்ளிடவும்.' : 'Please enter a valid harvest quantity in quintals.');
      return;
    }

    try {
      setBookingLoading(true);
      setErrorMsg('');
      const booking_id = 'B' + Date.now().toString().slice(-6);

      const res = await API.post('/bookings', {
        booking_id,
        farmer_id: effectiveFarmerId,
        slot_id: slot.slot_id,
        centre_id: centreId,
        district: selectedDistrict,
        booking_date: date,
        crop,
        quantity_quintals: parseFloat(qty),
        msp_rate_inr: 2275
      }, { skipAuth: true });

      setResult({
        ...res.data,
        booking_id,
        district: selectedDistrict,
        centre_name: centres.find(c => c.centre_id === centreId)?.centre_name || centreId,
        slot_time: `${slot.start_time} - ${slot.end_time}`,
        crop,
        quantity_quintals: qty
      });

      localStorage.setItem('kisan_farmer_id', effectiveFarmerId);
      checkActiveBooking(effectiveFarmerId);
      loadSlots();
    } catch (err) {
      if (err.response?.status === 409) {
        const data = err.response.data;
        if (data.code === 'farmer_has_active_booking') {
          setActiveBooking(data.active_booking);
          setErrorMsg(
            currentLang === 'ta'
              ? `உங்களுக்கு ஏற்கனவே ${data.active_booking.centre_name || data.active_booking.centre_id} நிலையத்தில் ஒரு செயலில் உள்ள பதிவு உள்ளது (${data.active_booking.booking_id}).`
              : `You already have an active booking (${data.active_booking.booking_id}) at ${data.active_booking.centre_name || data.active_booking.centre_id}.`
          );
          return;
        }
      }
      setErrorMsg(err.response?.data?.message || (currentLang === 'ta' ? 'முன்பதிவு தோல்வியடைந்தது. வேறு நேரத்தைத் தேர்ந்தெடுக்கவும்.' : 'Booking failed. Please try a different slot.'));
    } finally {
      setBookingLoading(false);
    }
  };

  // Helper for centre status badge
  const getCentreStatusBadge = (centre) => {
    if (centre.operational_status === 'Closed' || centre.operational_status === 'Inactive') {
      return {
        label: currentLang === 'ta' ? '🔴 மூடப்பட்டுள்ளது' : '🔴 Closed',
        color: '#dc2626',
        bg: '#fee2e2'
      };
    }
    if (centre.congestion_level === 'High' || centre.congestion_level === 'Severe' || centre.live_wait_minutes > 45) {
      return {
        label: currentLang === 'ta' ? '🟠 அதிக காத்திருப்பு' : '🟠 Busy',
        color: '#b45309',
        bg: '#fef3c7'
      };
    }
    return {
      label: currentLang === 'ta' ? '🟢 திறந்துள்ளது' : '🟢 Open',
      color: '#15803d',
      bg: '#dcfce7'
    };
  };

  const selectedCentreObj = centres.find(c => c.centre_id === centreId);

  return (
    <div style={{ maxWidth: 840, margin: '20px auto', padding: '0 16px 80px' }}>
      
      {/* Title & Introduction */}
      <div style={{ marginBottom: 24, paddingBottom: 12, borderBottom: '1px solid var(--kq-border-light)' }}>
        <h1 style={{ fontSize: 24, fontWeight: 900, color: 'var(--kq-text-primary)', margin: '0 0 6px' }}>
          {currentLang === 'ta' ? 'அறுவடை கொள்முதல் நேரம் முன்பதிவு' : 'Book Harvest Procurement Slot'}
        </h1>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--kq-text-secondary)', lineHeight: 1.5 }}>
          {currentLang === 'ta'
            ? 'அருகிலுள்ள நேரடி நெல் கொள்முதல் நிலையத்தில் உறுதிசெய்யப்பட்ட வருகை நேரத்தைப் பதிவு செய்யவும்.'
            : 'Reserve guaranteed arrival and weighment time at your nearest Tamil Nadu Direct Procurement Centre.'}
        </p>

        {/* Farmer Context */}
        {farmerId && (
          <div style={{
            marginTop: 12,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 12px',
            borderRadius: 'var(--kq-radius-sm)',
            backgroundColor: 'var(--kq-green-50)',
            border: '1px solid var(--kq-green-200)',
            fontSize: 13,
            fontWeight: 700,
            color: 'var(--kq-green-900)'
          }}>
            <Icon name="check-circle" size={15} color="var(--kq-green-700)" />
            <span>
              {currentLang === 'ta'
                ? `முன்பதிவு செய்பவர்: ${farmerName || farmerId} (எண்: ${farmerId})`
                : `Booking for: ${farmerName || farmerId} (ID: ${farmerId})`}
            </span>
          </div>
        )}
      </div>

      {/* Active Booking Banner */}
      {activeBooking && (
        <AlertBanner
          type="warning"
          title={currentLang === 'ta' ? 'செயலில் உள்ள பதிவு உள்ளது' : 'Active Appointment In Progress'}
          message={
            currentLang === 'ta'
              ? `உங்களுக்கு ${formatHumanDate(activeBooking.booking_date)} அன்று #${activeBooking.booking_id} பதிவு உள்ளது (${activeBooking.centre_name || activeBooking.centre_id}). முறைப்படுத்தப்பட்ட நியாயமான சேவைக்காக ஒரே நேரத்தில் ஒரு செயலில் உள்ள பதிவை மட்டுமே வைத்திருக்க முடியும்.`
              : `You have a scheduled booking #${activeBooking.booking_id} at ${activeBooking.centre_name || activeBooking.centre_id} on ${formatHumanDate(activeBooking.booking_date)}. To maintain fair access, farmers may only hold one active booking at a time.`
          }
          action={
            <Link
              to="/farmer/visit"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 14px',
                backgroundColor: 'var(--kq-green-800)',
                color: '#ffffff',
                borderRadius: 'var(--kq-radius-sm)',
                fontSize: 12.5,
                fontWeight: 700,
                textDecoration: 'none'
              }}
            >
              {currentLang === 'ta' ? 'என் வருகை காண்க' : 'View My Visit'}
            </Link>
          }
          style={{ marginBottom: 20 }}
        />
      )}

      {/* Expired Booking Notice */}
      {expiredBooking && !activeBooking && (
        <AlertBanner
          type="info"
          title={currentLang === 'ta' ? 'முந்தைய பதிவு காலாவதியானது — புதிய பதிவு செய்யலாம்' : 'Previous Appointment Expired — You Can Book Now'}
          message={
            currentLang === 'ta'
              ? `உங்கள் முந்தைய பதிவு #${expiredBooking.booking_id} (${formatHumanDate(expiredBooking.booking_date)}) வருகை நேரம் முடிந்துவிட்டதால் காலாவதியானது. உங்கள் பழைய பதிவு புதிய முன்பதிவை பாதிக்காது. கீழே புதிய தேதியைத் தேர்ந்தெடுத்து பதிவு செய்யவும்.`
              : `Your previous appointment #${expiredBooking.booking_id} on ${formatHumanDate(expiredBooking.booking_date)} expired without attendance. Expired visits do not block new bookings. Please select your preferred date and slot below.`
          }
          style={{ marginBottom: 20 }}
        />
      )}

      {errorMsg && (
        <AlertBanner
          type="error"
          message={errorMsg}
          onDismiss={() => setErrorMsg('')}
          style={{ marginBottom: 20 }}
        />
      )}

      {/* Booking Form Card */}
      <Card style={{ padding: '24px', border: '1px solid var(--kq-border-medium)' }}>
        
        {/* Step 1: Crop & Quantity */}
        <FormSection
          title={currentLang === 'ta' ? '1. பயிர் & அறுவடை அளவு' : '1. Crop Variety & Harvest Quantity'}
          description={
            currentLang === 'ta'
              ? 'கொள்முதல் செய்யப்பட வேண்டிய பயிர் மற்றும் அளவைக் குறிப்பிடவும்'
              : 'Select your harvested crop and estimated quantity in quintals'
          }
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
            <FormField
              label={currentLang === 'ta' ? 'பயிர் வகை *' : 'Crop Type *'}
              id="crop"
            >
              <select
                className="kq-select"
                value={crop}
                onChange={e => setCrop(e.target.value)}
                required
                style={{ height: 44, fontSize: 14, fontWeight: 600 }}
              >
                <option value="Paddy (Common)">
                  {currentLang === 'ta' ? 'நெல் (பொது) — MSP ₹2,275/குவிண்டால்' : 'Paddy (Common) - MSP ₹2,275/Qtl'}
                </option>
                <option value="Paddy (Grade A)">
                  {currentLang === 'ta' ? 'நெல் (தரம் ஏ) — MSP ₹2,320/குவிண்டால்' : 'Paddy (Grade A) - MSP ₹2,320/Qtl'}
                </option>
                <option value="Paddy (ADT-45)">Paddy (ADT-45)</option>
                <option value="Paddy (BPT-5204)">Paddy (BPT-5204)</option>
                <option value="Maize">
                  {currentLang === 'ta' ? 'மக்காச்சோளம் — MSP ₹2,090/குவிண்டால்' : 'Maize - MSP ₹2,090/Qtl'}
                </option>
                <option value="Groundnut">
                  {currentLang === 'ta' ? 'நிலக்கடலை — MSP ₹6,780/குவிண்டால்' : 'Groundnut - MSP ₹6,780/Qtl'}
                </option>
              </select>
            </FormField>

            <FormField
              label={currentLang === 'ta' ? 'அளவு (குவிண்டாலில்) *' : 'Quantity (Quintals) *'}
              id="qty"
              helpText={currentLang === 'ta' ? '1 குவிண்டால் = 100 கிலோ (சுமார் 2 மூட்டைகள்)' : '1 Quintal = 100 Kilograms'}
            >
              <input
                type="number"
                min="1"
                max="200"
                className="kq-input"
                value={qty}
                onChange={e => setQty(e.target.value)}
                placeholder="10"
                required
                style={{ height: 44, fontSize: 14, fontWeight: 700 }}
              />
            </FormField>
          </div>
        </FormSection>


        {/* Step 2: District & Procurement Centre */}
            <FormSection
              title={currentLang === 'ta' ? '2. மாவட்டம் & கொள்முதல் நிலையம்' : '2. District & Procurement Centre'}
              description={
                currentLang === 'ta'
                  ? 'உங்கள் அருகிலுள்ள நேரடி கொள்முதல் நிலையத்தைத் தேர்ந்தெடுக்கவும்'
                  : 'Identify your district and nearest Direct Paddy Procurement Centre'
              }
            >
              {/* Missing District Notice */}
              {!selectedDistrict && !loadingDistricts && (
                <div style={{ marginBottom: 16 }}>
                  <AlertBanner
                    type="warning"
                    title={currentLang === 'ta' ? 'பதிவு செய்யப்பட்ட மாவட்டம் விடுபட்டுள்ளது' : 'Registered District Missing'}
                    message={
                      currentLang === 'ta'
                        ? 'உங்கள் உழவர் சுயவிவரத்தில் மாவட்டம் விடுபட்டுள்ளது. நேரடி கொள்முதல் நிலையங்களை பார்க்க உங்கள் சுயவிவரத்தை புதுப்பிக்கவும்.'
                        : 'Your registered district is missing from your profile. Please complete your registration or update your profile before booking.'
                    }
                    action={
                      <Link to="/farmer/register" className="kq-btn kq-btn-secondary" style={{ fontSize: 12 }}>
                        {currentLang === 'ta' ? 'சுயவிவரம் புதுப்பிக்க' : 'Update Profile'}
                      </Link>
                    }
                  />
                </div>
              )}

              {/* Smart Centre Recommendation Card */}
              {recommendedCentre && (
                <div style={{
                  marginBottom: 16,
                  padding: '14px 18px',
                  borderRadius: 'var(--kq-radius-md)',
                  backgroundColor: 'rgba(236, 253, 245, 0.95)',
                  border: '1.5px solid var(--kq-green-400)',
                  boxShadow: '0 2px 10px rgba(16, 185, 129, 0.08)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        padding: '4px 12px',
                        borderRadius: 16,
                        fontSize: 12,
                        fontWeight: 800,
                        backgroundColor: 'var(--kq-green-700)',
                        color: '#ffffff',
                        letterSpacing: '0.2px'
                      }}>
                        ★ {currentLang === 'ta' ? 'பரிந்துரைக்கப்பட்டது · அருகிலுள்ள நிலையம்' : (recommendedCentre.badge_label || 'Recommended · Nearest available')}
                      </span>

                      {recommendedCentre.distance_label && (
                        <span style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: 'var(--kq-green-900)',
                          backgroundColor: 'var(--kq-green-100)',
                          border: '1px solid var(--kq-green-300)',
                          padding: '3px 10px',
                          borderRadius: 12
                        }}>
                          🚗 {recommendedCentre.distance_label}
                        </span>
                      )}
                    </div>

                    {manualCentreSelection && centreId !== recommendedCentre.centre_id && (
                      <button
                        type="button"
                        onClick={handleResetToRecommended}
                        className="kq-btn kq-btn-secondary"
                        style={{ fontSize: 12, padding: '4px 10px', height: 'auto', borderRadius: 8 }}
                      >
                        ↺ {currentLang === 'ta' ? 'பரிந்துரைத்த நிலையத்திற்கு மீட்டமை' : 'Reset to recommended centre'}
                      </button>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 14.5, color: 'var(--kq-green-950)' }}>
                        {recommendedCentre.centre_name}
                      </div>
                      <div style={{ fontSize: 12.5, color: 'var(--kq-green-800)', marginTop: 2 }}>
                        {currentLang === 'ta'
                          ? (recommendedCentre.has_available_slots ? 'நீங்கள் தேர்ந்தெடுத்த தேதியில் நேர இடைவெளிகள் கிடைக்கின்றன' : 'அருகிலுள்ள செயல்பாட்டு நிலையம்')
                          : recommendedCentre.reason}
                      </div>
                    </div>

                    {centreId === recommendedCentre.centre_id ? (
                      <span style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: 'var(--kq-green-800)',
                        backgroundColor: 'var(--kq-green-200)',
                        padding: '3px 10px',
                        borderRadius: 12
                      }}>
                        ✓ {currentLang === 'ta' ? 'தேர்ந்தெடுக்கப்பட்டுள்ளது' : 'Currently selected'}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={handleResetToRecommended}
                        className="kq-btn kq-btn-secondary"
                        style={{ fontSize: 12, padding: '4px 10px', height: 'auto', borderRadius: 8 }}
                      >
                        {currentLang === 'ta' ? 'இந்த நிலையத்தைத் தேர்ந்தெடு' : 'Select this centre'}
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
                <FormField
                  label={currentLang === 'ta' ? 'பதிவு செய்யப்பட்ட மாவட்டம்' : 'Registered District'}
                  id="district"
                  helpText={currentLang === 'ta' ? 'உங்கள் உழவர் சுயவிவரத்திலிருந்து தானாக பெறப்பட்டது' : 'Auto-populated from your verified farmer profile (read-only)'}
                >
                  <div style={{
                    height: 44,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0 14px',
                    backgroundColor: 'var(--kq-green-50)',
                    border: '1.5px solid var(--kq-green-300)',
                    borderRadius: 'var(--kq-radius-sm)',
                    fontWeight: 800,
                    fontSize: 14.5,
                    color: 'var(--kq-green-900)'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Icon name="map-pin" size={16} color="var(--kq-green-700)" />
                      <span>{selectedDistrict || (loadingDistricts ? (currentLang === 'ta' ? 'ஏற்றப்படுகிறது...' : 'Loading...') : (currentLang === 'ta' ? 'விடுபட்டுள்ளது' : 'Not Set'))}</span>
                    </div>
                    {selectedDistrict && (
                      <span style={{
                        fontSize: 11.5,
                        fontWeight: 700,
                        padding: '2px 8px',
                        borderRadius: 10,
                        backgroundColor: 'var(--kq-green-200)',
                        color: 'var(--kq-green-900)'
                      }}>
                        ✓ {currentLang === 'ta' ? 'சரிபார்க்கப்பட்டது' : 'Verified'}
                      </span>
                    )}
                  </div>
                </FormField>

                <FormField
                  label={currentLang === 'ta' ? 'நேரடி கொள்முதல் நிலையம் (DPC) *' : 'Procurement Centre (DPC) *'}
                  id="centreId"
                  helpText={
                    !selectedDistrict
                      ? (currentLang === 'ta' ? 'சுயவிவரத்தில் மாவட்டம் விடுபட்டுள்ளது' : 'District missing from profile')
                      : loadingCentres
                        ? (currentLang === 'ta' ? 'ஏற்றப்படுகிறது...' : 'Loading centres...')
                        : `${centres.length} ${currentLang === 'ta' ? 'நிலையங்கள் உள்ளன' : 'centres loaded'}`
                  }
                >
                  <select
                    className="kq-select"
                    value={centreId}
                    onChange={handleCentreChange}
                    disabled={!selectedDistrict || loadingCentres}
                    required
                    style={{ height: 44, fontSize: 14, fontWeight: 600 }}
                  >
                    <option value="">
                      {!selectedDistrict
                        ? (currentLang === 'ta' ? 'மாவட்டம் விடுபட்டுள்ளது' : 'District missing from profile')
                        : loadingCentres
                          ? (currentLang === 'ta' ? 'ஏற்றப்படுகிறது...' : 'Loading...')
                          : (currentLang === 'ta' ? '-- நிலையத்தைத் தேர்ந்தெடுக்கவும் --' : '-- Select Centre --')}
                    </option>
                    {centres.map(c => {
                      const isClosed = c.operational_status === 'Closed' || c.operational_status === 'Retired';
                      const isRec = recommendedCentre && c.centre_id === recommendedCentre.centre_id;
                      const badge = getCentreStatusBadge(c);
                      return (
                        <option key={c.centre_id} value={c.centre_id} disabled={isClosed}>
                          {isRec ? '★ [Recommended] ' : ''}{c.centre_name} ({c.centre_id}) {isClosed ? `[${currentLang === 'ta' ? 'மூடப்பட்டது' : 'Closed'}]` : ''} — {badge.label}
                        </option>
                      );
                    })}
                  </select>
                </FormField>
              </div>

              {/* Selected Centre Traffic-Light Summary Card */}
              {selectedCentreObj && (
                <div style={{
                  marginTop: 14,
                  padding: '12px 16px',
                  borderRadius: 'var(--kq-radius-md)',
                  backgroundColor: 'var(--kq-bg-subtle)',
                  border: '1px solid var(--kq-border-light)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 10
                }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--kq-text-primary)' }}>
                      {selectedCentreObj.centre_name}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--kq-text-muted)', marginTop: 2 }}>
                      {selectedCentreObj.address || `${selectedCentreObj.district} District`}
                    </div>
                  </div>

                  {(() => {
                    const badge = getCentreStatusBadge(selectedCentreObj);
                    return (
                      <span style={{
                        padding: '4px 12px',
                        borderRadius: 20,
                        fontSize: 12.5,
                        fontWeight: 800,
                        backgroundColor: badge.bg,
                        color: badge.color
                      }}>
                        {badge.label}
                      </span>
                    );
                  })()}
                </div>
              )}

              {/* Warning if centre is closed */}
              {selectedCentreObj && (selectedCentreObj.operational_status === 'Closed' || selectedCentreObj.operational_status === 'Retired') && (
                <div style={{
                  marginTop: 10,
                  padding: '10px 14px',
                  backgroundColor: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: 'var(--kq-radius-md)',
                  color: '#991b1b',
                  fontSize: 13,
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8
                }}>
                  <span>⚠️</span>
                  <span>
                    {currentLang === 'ta'
                      ? 'இந்த கொள்முதல் நிலையம் தற்போது மூடப்பட்டுள்ளது. முன்பதிவு செய்ய மற்றொரு நிலையத்தைத் தேர்ந்தெடுக்கவும்.'
                      : 'This procurement centre is currently closed for operations. Please select an active centre to book.'}
                  </span>
                </div>
              )}
            </FormSection>

            {/* Step 3: Date & Slot Selection with Traffic-Light Indicators */}
            <FormSection
              title={currentLang === 'ta' ? '3. வருகை நாள் & நேர இடைவெளி' : '3. Arrival Date & Time Window'}
              description={
                centreId && date
                  ? (currentLang === 'ta' ? `${formatHumanDate(date)} தேதிக்கான நேர இடைவெளிகள்` : `Available 1-hour slots for ${formatHumanDate(date)}`)
                  : (currentLang === 'ta' ? 'இடங்களைப் பார்க்க மேலே நிலையம் மற்றும் தேதியைத் தேர்ந்தெடுக்கவும்' : 'Select a centre and date above to inspect slot capacity')
              }
            >
              <div style={{ marginBottom: 16 }}>
                <FormField
                  label={currentLang === 'ta' ? 'வருகை நாள் *' : 'Delivery Date *'}
                  id="bookingDate"
                  helpText={currentLang === 'ta' ? `இன்றிலிருந்து 7 நாட்களுக்குள் தேர்வு செய்யவும் (${todayStr} முதல் ${maxDateStr} வரை)` : `Select within 7-day window (${todayStr} to ${maxDateStr})`}
                >
                  <input
                    type="date"
                    className="kq-input"
                    value={date}
                    min={todayStr}
                    max={maxDateStr}
                    onChange={handleDateChange}
                    required
                    style={{ height: 44, maxWidth: 300, fontSize: 14, fontWeight: 700 }}
                  />
                </FormField>
              </div>

              {/* Weather Advisory Widget */}
              {weatherAdvisory && (
                <div style={{
                  marginBottom: 16,
                  padding: '12px 16px',
                  borderRadius: 'var(--kq-radius-md)',
                  backgroundColor: !weatherAdvisory.available ? '#f8fafc' : (weatherAdvisory.is_inclement ? '#fef2f2' : weatherAdvisory.risk_level === 'Moderate' ? '#fffbeb' : '#f0fdf4'),
                  border: `1px solid ${!weatherAdvisory.available ? 'var(--kq-border-light)' : (weatherAdvisory.is_inclement ? '#fecaca' : weatherAdvisory.risk_level === 'Moderate' ? '#fde68a' : '#bbf7d0')}`,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12
                }}>
                  <div style={{ fontSize: 24 }}>
                    {!weatherAdvisory.available ? '☁️' : (weatherAdvisory.condition?.toLowerCase().includes('rain') ? '🌧️' : weatherAdvisory.condition?.toLowerCase().includes('cloud') ? '⛅' : '☀️')}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 13, color: 'var(--kq-text-primary)' }}>
                        {selectedDistrict} {currentLang === 'ta' ? 'வானிலை தகவல்' : 'Weather Advisory'}:
                      </strong>
                      {!weatherAdvisory.available ? (
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--kq-text-secondary)' }}>
                          {currentLang === 'ta' ? 'வானிலை தகவல் தற்காலிகமாக கிடைக்கவில்லை' : 'Weather temporarily unavailable'}
                        </span>
                      ) : (
                        <>
                          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--kq-green-800)' }}>
                            {weatherAdvisory.temperature_c ? `${Math.round(weatherAdvisory.temperature_c)}°C` : ''} ({weatherAdvisory.condition || 'Clear'})
                          </span>
                          <span style={{
                            fontSize: 11,
                            fontWeight: 700,
                            padding: '2px 8px',
                            borderRadius: 10,
                            backgroundColor: weatherAdvisory.is_inclement ? '#ef4444' : weatherAdvisory.risk_level === 'Moderate' ? '#f59e0b' : '#16a34a',
                            color: '#ffffff'
                          }}>
                            {weatherAdvisory.is_inclement ? 'Elevated Moisture Risk' : 'Favorable'}
                          </span>
                        </>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--kq-text-muted)', marginTop: 2 }}>
                      {weatherAdvisory.advisory || (weatherAdvisory.is_inclement ? 'Take precautions while transporting paddy in wet conditions.' : 'Weather is favorable for crop delivery.')}
                    </div>
                  </div>
                </div>
              )}

              {loadingSlots ? (
                <div style={{ padding: '28px', textAlign: 'center', color: 'var(--kq-text-muted)' }}>
                  <Icon name="refresh-cw" size={22} className="kq-spin" />
                  <div style={{ marginTop: 8, fontSize: 13.5, fontWeight: 600 }}>
                    {currentLang === 'ta' ? 'கிடைக்கும் நேரங்கள் ஏற்றப்படுகின்றன...' : 'Loading available centre slots...'}
                  </div>
                </div>
              ) : slots.length === 0 ? (
                <div style={{
                  padding: '24px',
                  backgroundColor: 'var(--kq-bg-subtle)',
                  borderRadius: 'var(--kq-radius-md)',
                  border: '1px dashed var(--kq-border-medium)',
                  textAlign: 'center',
                  fontSize: 13.5,
                  color: 'var(--kq-text-muted)'
                }}>
                  {!centreId ? (
                    currentLang === 'ta' ? '👆 மேலே ஒரு நேரடி கொள்முதல் நிலையத்தைத் தேர்ந்தெடுக்கவும்.' : 'Please select a Direct Procurement Centre above.'
                  ) : selectedCentreObj && (selectedCentreObj.operational_status === 'Closed' || selectedCentreObj.operational_status === 'Retired') ? (
                    <div style={{ color: '#b91c1c' }}>
                      <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 4 }}>
                        🔒 {currentLang === 'ta' ? 'இந்த கொள்முதல் நிலையம் மூடப்பட்டுள்ளது' : 'This Procurement Centre is Closed'}
                      </div>
                      <div style={{ fontSize: 13, color: '#991b1b' }}>
                        {currentLang === 'ta'
                          ? 'மாவட்ட அலுவலரால் திறக்கப்படும் வரை இந்த நிலையத்திற்கு முன்பதிவு செய்ய முடியாது. தயவுசெய்து திறந்திருக்கும் மற்றொரு நிலையத்தைத் தேர்ந்தெடுக்கவும்.'
                          : 'Bookings are disabled until opened by the District Officer. Please select an open operational centre above.'}
                      </div>
                    </div>
                  ) : errorMsg ? (
                    <div style={{ color: '#b45309' }}>
                      <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 4 }}>
                        ⚠️ {errorMsg}
                      </div>
                    </div>
                  ) : (
                    currentLang === 'ta' ? 'இந்த தேதிக்கான நேர இடைவெளிகள் எதுவும் இல்லை. வேறு தேதியை முயற்சிக்கவும்.' : 'No slots found for this date. Try choosing a different date.'
                  )}
                </div>
              ) : (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
                  gap: 14
                }}>
                  {slots.map(slot => {
                    const isFull = slot.booked_count >= slot.max_farmers;
                    const isExpired = !!slot.is_expired || slot.slot_status === 'EXPIRED';
                    const isBookedByYou = !!slot.booked_by_user || slot.slot_status === 'BOOKED_BY_YOU';
                    const isAvailable = !isFull && !isExpired && !isBookedByYou;
                    const remaining = Math.max(0, slot.max_farmers - slot.booked_count);
                    const timeStr = formatHumanTime(`${slot.start_time} - ${slot.end_time}`);

                    // Traffic-light status indicator
                    let trafficColor = '#15803d'; // Green
                    let trafficBg = '#dcfce7';
                    let trafficLabel = currentLang === 'ta' ? `🟢 இடங்கள் உள்ளன (${remaining} மீதம்)` : `🟢 Available (${remaining} left)`;

                    if (isExpired) {
                      trafficColor = '#6b7280'; // Gray
                      trafficBg = '#f3f4f6';
                      trafficLabel = currentLang === 'ta' ? '⏱️ முடிந்தது' : '⏱️ Expired';
                    } else if (isBookedByYou) {
                      trafficColor = '#1d4ed8'; // Blue
                      trafficBg = '#dbeafe';
                      trafficLabel = currentLang === 'ta' ? '✓ உங்கள் பதிவு' : '✓ Your Slot';
                    } else if (isFull || remaining <= 0) {
                      trafficColor = '#dc2626'; // Red
                      trafficBg = '#fee2e2';
                      trafficLabel = currentLang === 'ta' ? '🔴 நிரம்பியது' : '🔴 Full';
                    } else if (remaining <= 2) {
                      trafficColor = '#b45309'; // Orange
                      trafficBg = '#fef3c7';
                      trafficLabel = currentLang === 'ta' ? `🟠 குறைந்த இடங்கள் (${remaining} மட்டுமே)` : `🟠 Few places (${remaining} left)`;
                    }

                    return (
                      <div
                        key={slot.slot_id}
                        style={{
                          padding: '16px',
                          backgroundColor: (!isAvailable) ? 'var(--kq-bg-subtle)' : '#ffffff',
                          border: `1.5px solid ${isExpired ? '#e5e7eb' : isFull ? 'var(--kq-border-light)' : isBookedByYou ? '#93c5fd' : 'var(--kq-green-600)'}`,
                          borderRadius: 'var(--kq-radius-md)',
                          boxShadow: 'var(--kq-shadow-xs)',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'space-between',
                          gap: 12,
                          opacity: isExpired ? 0.75 : 1
                        }}
                      >
                        <div>
                          {/* Time Window */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                            <Icon name="clock" size={16} color={!isAvailable ? 'var(--kq-text-muted)' : 'var(--kq-green-800)'} />
                            <strong style={{ fontSize: 15, color: !isAvailable ? 'var(--kq-text-muted)' : 'var(--kq-text-primary)' }}>
                              {timeStr}
                            </strong>
                          </div>

                          {/* Traffic-Light Status Pill */}
                          <div style={{
                            display: 'inline-block',
                            padding: '3px 8px',
                            borderRadius: 12,
                            fontSize: 12,
                            fontWeight: 700,
                            backgroundColor: trafficBg,
                            color: trafficColor,
                            marginBottom: 6
                          }}>
                            {trafficLabel}
                          </div>
                        </div>

                        <PrimaryButton
                          onClick={() => handleBookSlot(slot)}
                          disabled={!isAvailable || bookingLoading || !!activeBooking}
                          style={{
                            width: '100%',
                            height: 36,
                            fontSize: 13,
                            fontWeight: 700,
                            justifyContent: 'center',
                            backgroundColor: isExpired ? '#9ca3af' : isBookedByYou ? '#3b82f6' : isFull ? '#9ca3af' : 'var(--kq-green-800)'
                          }}
                        >
                          {isExpired
                            ? (currentLang === 'ta' ? 'முடிந்தது' : 'Expired')
                            : isBookedByYou
                            ? (currentLang === 'ta' ? 'உங்கள் பதிவு' : 'Your Slot')
                            : isFull
                            ? (currentLang === 'ta' ? 'நிரம்பியது' : 'Fully Booked')
                            : (currentLang === 'ta' ? 'முன்பதிவு செய்' : 'Reserve Slot')}
                        </PrimaryButton>
                      </div>
                    );
                  })}
                </div>
              )}
            </FormSection>
      </Card>

      {/* Booking Confirmation Success Modal */}
      <Modal
        isOpen={!!result}
        onClose={() => setResult(null)}
        title={currentLang === 'ta' ? '✓ பதிவு உறுதி செய்யப்பட்டது!' : '✓ Procurement Slot Confirmed!'}
        subtitle={currentLang === 'ta' ? 'டிஜிட்டல் கொள்முதல் பாஸ் உருவாக்கப்பட்டது' : 'Digital pass generated successfully'}
        maxWidth={520}
        footer={
          <div style={{ display: 'flex', gap: 10, width: '100%', flexWrap: 'wrap' }}>
            <PrimaryButton
              onClick={() => navigate('/farmer/visit')}
              style={{ flex: '1 1 180px', justifyContent: 'center', height: 42, fontSize: 14, fontWeight: 800 }}
            >
              {currentLang === 'ta' ? 'என் வருகை காண்க' : 'View My Visit'}
            </PrimaryButton>
            <SecondaryButton
              onClick={() => navigate(`/farmer/pass?id=${result?.booking_id || result?.booking?.booking_id}`)}
              style={{ flex: '1 1 180px', justifyContent: 'center', height: 42, fontSize: 14, fontWeight: 700 }}
            >
              <Icon name="qr-code" size={16} />
              <span>{currentLang === 'ta' ? 'பாஸ் பார்க்க (QR)' : 'View Pass (QR)'}</span>
            </SecondaryButton>
          </div>
        }
      >
        <div style={{ textAlign: 'center', padding: '10px 0' }}>
          <div style={{
            width: 52,
            height: 52,
            borderRadius: '50%',
            backgroundColor: 'var(--kq-green-100)',
            color: 'var(--kq-green-800)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 14
          }}>
            <Icon name="check" size={30} />
          </div>

          <div style={{
            padding: '18px',
            backgroundColor: 'var(--kq-green-50)',
            border: '1.5px solid var(--kq-green-300)',
            borderRadius: 'var(--kq-radius-md)',
            textAlign: 'left',
            marginBottom: 16
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span className="kq-text-muted" style={{ fontSize: 13 }}>
                {currentLang === 'ta' ? 'பதிவு எண்:' : 'Booking Ref:'}
              </span>
              <strong style={{ fontSize: 14 }}>{result?.booking_id || result?.booking?.booking_id}</strong>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, alignItems: 'center' }}>
              <span className="kq-text-muted" style={{ fontSize: 13 }}>
                {currentLang === 'ta' ? 'ஒதுக்கப்பட்ட டோக்கன்:' : 'Assigned Token:'}
              </span>
              <strong style={{ color: 'var(--kq-green-900)', fontSize: 20, fontWeight: 900 }}>
                {result?.token || result?.booking?.token || '#101'}
              </strong>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span className="kq-text-muted" style={{ fontSize: 13 }}>
                {currentLang === 'ta' ? 'நிலையம்:' : 'Centre:'}
              </span>
              <strong style={{ fontSize: 13.5 }}>{result?.centre_name}</strong>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span className="kq-text-muted" style={{ fontSize: 13 }}>
                {currentLang === 'ta' ? 'நாள் & நேரம்:' : 'Date & Time:'}
              </span>
              <strong style={{ fontSize: 13.5 }}>
                {formatHumanDate(result?.booking_date || date)} • {formatHumanTime(result?.slot_time)}
              </strong>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="kq-text-muted" style={{ fontSize: 13 }}>
                {currentLang === 'ta' ? 'பயிர் & அளவு:' : 'Crop & Quantity:'}
              </span>
              <strong style={{ fontSize: 13.5 }}>
                {qty} {currentLang === 'ta' ? 'குவிண்டால்' : 'Quintals'} ({crop})
              </strong>
            </div>
          </div>

          <p style={{ margin: 0, fontSize: 13, color: 'var(--kq-text-muted)', lineHeight: 1.4 }}>
            {currentLang === 'ta'
              ? 'உங்கள் மொபைல் எண்ணுக்கு SMS உறுதிப்படுத்தல் அனுப்பப்பட்டுள்ளது. நிலையத்திற்கு வரும்போது உங்கள் டோக்கன் அல்லது டிஜிட்டல் பாஸைக் காட்டவும்.'
              : 'An SMS confirmation has been dispatched. Please present your Digital QR Pass or Token upon arrival.'}
          </p>
        </div>
      </Modal>

    </div>
  );
}