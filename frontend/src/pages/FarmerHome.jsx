import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import API from '../api';
import FarmerEntry from './Register';
import {
  Card,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
  Icon,
  LoadingState,
  AlertBanner,
  formatHumanDate,
  formatHumanTime
} from '../components/design-system';
import { useI18n, getLanguage } from '../i18n';

export default function FarmerHome() {
  const navigate = useNavigate();
  const { t } = useI18n();

  const [farmerId, setFarmerId] = useState(localStorage.getItem('kisan_farmer_id') || '');
  const [farmerName, setFarmerName] = useState(localStorage.getItem('kisan_farmer_name') || '');
  const [district, setDistrict] = useState(localStorage.getItem('kisan_district') || '');
  const [village, setVillage] = useState('');

  const [activeBooking, setActiveBooking] = useState(null);
  const [pendingProcurement, setPendingProcurement] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentLang, setCurrentLang] = useState(getLanguage());

  // Listen for global language changes
  useEffect(() => {
    const handleLangChange = () => setCurrentLang(getLanguage());
    window.addEventListener('kq_language_changed', handleLangChange);
    return () => window.removeEventListener('kq_language_changed', handleLangChange);
  }, []);

  // Fetch farmer profile and active bookings
  const loadFarmerHomeData = async () => {
    if (!farmerId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError('');

      // Ensure token
      if (!localStorage.getItem('kisan_token')) {
        try {
          const profileRes = await API.get(`/farmers/${encodeURIComponent(farmerId)}`, { skipAuth: true });
          if (profileRes.data) {
            if (profileRes.data.name && !farmerName) {
              setFarmerName(profileRes.data.name);
              localStorage.setItem('kisan_farmer_name', profileRes.data.name);
            }
            if (profileRes.data.district && !district) {
              setDistrict(profileRes.data.district);
              localStorage.setItem('kisan_district', profileRes.data.district);
            }
            if (profileRes.data.village) {
              setVillage(profileRes.data.village);
            }
            if (profileRes.data.token) {
              localStorage.setItem('kisan_token', profileRes.data.token);
              localStorage.setItem('kisan_role', 'FARMER');
            }
          }
        } catch (_) {}
      }

      // Fetch bookings for this farmer
      const bookingsRes = await API.get(`/bookings/${encodeURIComponent(farmerId)}`);
      const allBookings = Array.isArray(bookingsRes.data) ? bookingsRes.data : [];

      // Authoritative active booking check
      let active = null;
      try {
        const activeRes = await API.get(`/farmers/${encodeURIComponent(farmerId)}/active-booking`);
        if (activeRes.data?.has_active_booking && activeRes.data?.active_booking) {
          active = activeRes.data.active_booking;
        }
      } catch (_) {}

      // Fallback verification using strict canonical lifecycle rules
      if (!active) {
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

        const inYardStatuses = ['Checked-In', 'Grading', 'Weighing'];
        const upcomingStatuses = ['Confirmed', 'Booked', 'On The Way'];

        // 1. Physically checked-in visit in yard
        active = allBookings.find(b => inYardStatuses.includes(b.status)) || null;

        // 2. Valid upcoming appointment on today or future date
        if (!active) {
          const upcoming = allBookings
            .filter(b => upcomingStatuses.includes(b.status) && (normalizeDate(b.booking_date) >= todayStr))
            .sort((a, b) => normalizeDate(a.booking_date).localeCompare(normalizeDate(b.booking_date)));
          active = upcoming[0] || null;
        }
      }

      // Check if there is an in-progress post-yard visit: Procured or Payment Pending
      const inProgress = allBookings.find(b => b.status === 'Procured' || b.status === 'Payment Pending') || null;
      setPendingProcurement(inProgress);

      if (active && active.booking_id) {
        try {
          const passRes = await API.get(`/bookings/pass/${active.booking_id}`);
          if (passRes.data?.pass) {
            setActiveBooking({
              ...active,
              ...passRes.data.pass
            });
          } else {
            setActiveBooking(active);
          }
        } catch (_) {
          setActiveBooking(active);
        }
      } else {
        setActiveBooking(null);
      }
    } catch (err) {
      console.error('Home load error:', err);
      setError(err.response?.data?.message || 'Unable to load your latest procurement status.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFarmerHomeData();
  }, [farmerId]);

  // Open task-based help modal
  const handleOpenHelp = () => {
    window.dispatchEvent(new CustomEvent('kq_open_help'));
  };

  // 1. Single Unified Farmer Entry Screen (Zero duplicate sign-in screens)
  if (!farmerId) {
    return (
      <FarmerEntry
        onLoginSuccess={() => {
          const storedId = localStorage.getItem('kisan_farmer_id') || '';
          setFarmerId(storedId);
          setFarmerName(localStorage.getItem('kisan_farmer_name') || '');
          setDistrict(localStorage.getItem('kisan_district') || '');
        }}
      />
    );
  }

  // 2. Authenticated Farmer Home: Calm, Focused Digital Assistant
  const timeString = activeBooking?.start_time
    ? `${activeBooking.start_time} - ${activeBooking.end_time || ''}`
    : (activeBooking?.slot_time || '08:00 - 09:00');

  return (
    <div style={{ maxWidth: 840, margin: '20px auto', padding: '0 16px 80px' }}>
      
      {/* 1. Calm Greeting Header */}
      <div style={{
        marginBottom: 24,
        paddingBottom: 14,
        borderBottom: '1px solid var(--kq-border-light)'
      }}>
        <h1 style={{ margin: '0 0 4px', fontSize: 24, fontWeight: 900, color: 'var(--kq-text-primary)' }}>
          {currentLang === 'ta' ? `வணக்கம், ${farmerName || farmerId}!` : `Hello, ${farmerName || farmerId}!`}
        </h1>
        <div style={{ fontSize: 13, color: 'var(--kq-text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon name="map-pin" size={14} color="var(--kq-green-700)" />
          <span>{village ? `${village}, ` : ''}{district || 'Ariyalur'}</span>
        </div>
      </div>

      {error && (
        <AlertBanner
          type="error"
          message={error}
          onDismiss={() => setError('')}
          style={{ marginBottom: 20 }}
        />
      )}

      {/* 2. Primary Focused Hero: YOUR ACTIVE VISIT (Summary Only) */}
      {loading ? (
        <div style={{ padding: '40px 0' }}>
          <LoadingState message={currentLang === 'ta' ? 'வருகை விவரங்கள் ஏற்றப்படுகின்றன...' : 'Loading your appointment...'} />
        </div>
      ) : activeBooking ? (
        <div style={{
          background: '#ffffff',
          border: '2px solid var(--kq-green-700)',
          borderRadius: 'var(--kq-radius-lg)',
          boxShadow: 'var(--kq-shadow-sm)',
          padding: '24px',
          marginBottom: 32,
          position: 'relative'
        }}>
          {/* Subtle status tag */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{
              fontSize: 12,
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--kq-green-800)'
            }}>
              {currentLang === 'ta' ? 'செயலில் உள்ள கொள்முதல் வருகை' : 'YOUR ACTIVE VISIT'}
            </span>
            <StatusBadge status={activeBooking.status} size="normal" />
          </div>

          {/* Centre Name */}
          <h2 style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 800, color: 'var(--kq-text-primary)' }}>
            {activeBooking.centre_name || 'Kattathur Direct Paddy Procurement Centre'}
          </h2>

          {/* Date & Time Window */}
          <div style={{ fontSize: 14, color: 'var(--kq-text-secondary)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Icon name="calendar" size={15} color="var(--kq-green-700)" />
              {formatHumanDate(activeBooking.booking_date)}
            </span>
            <span style={{ color: 'var(--kq-border-medium)' }}>•</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Icon name="clock" size={15} color="var(--kq-green-700)" />
              {formatHumanTime(timeString)}
            </span>
            <span style={{ color: 'var(--kq-border-medium)' }}>•</span>
            <span>{activeBooking.crop} · {activeBooking.quantity_quintals || activeBooking.quantity} quintals</span>
          </div>

          {/* Token & Queue Highlight */}
          <div style={{
            background: 'var(--kq-bg-subtle)',
            border: '1px solid var(--kq-border-light)',
            borderRadius: 'var(--kq-radius-md)',
            padding: '16px 20px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 14,
            marginBottom: 20
          }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--kq-text-muted)', textTransform: 'uppercase' }}>
                {t('tokenLabel')}
              </div>
              <div style={{ fontSize: 44, fontWeight: 900, color: 'var(--kq-green-800)', lineHeight: 1.1, margin: '2px 0 0' }}>
                {activeBooking.token || activeBooking.booking_id}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--kq-green-900)' }}>
                {activeBooking.farmers_ahead === 0
                  ? (currentLang === 'ta' ? 'நீங்கள் வரிசையில் #1 இடத்தில் உள்ளீர்கள்' : 'You are #1 in the queue')
                  : (currentLang === 'ta' ? `${activeBooking.farmers_ahead} உழவர்கள் உங்களுக்கு முன் உள்ளனர்` : `${activeBooking.farmers_ahead} farmers ahead of you`)}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--kq-text-muted)', marginTop: 2 }}>
                {currentLang === 'ta' ? 'காத்திருப்பு: < 5 நிமிடங்கள்' : 'Est. wait: < 5 min wait'}
              </div>
            </div>
          </div>

          {/* Strictly TWO Buttons: Open My Visit and View Pass (NO "I'm On My Way" on Home!) */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <PrimaryButton
              onClick={() => navigate('/farmer/visit')}
              style={{
                flex: '1 1 200px',
                padding: '12px 18px',
                fontSize: 14,
                fontWeight: 800,
                justifyContent: 'center'
              }}
            >
              <span>{currentLang === 'ta' ? 'எனது வருகையைத் திறக்கவும் →' : 'Open My Visit →'}</span>
            </PrimaryButton>

            <SecondaryButton
              onClick={() => navigate(`/pass/${activeBooking.booking_id}`)}
              style={{
                flex: '1 1 140px',
                padding: '12px 18px',
                fontSize: 14,
                fontWeight: 700,
                justifyContent: 'center'
              }}
            >
              <Icon name="file-text" size={16} />
              <span>{currentLang === 'ta' ? 'பாஸ் பார்க்க' : 'View Pass'}</span>
            </SecondaryButton>
          </div>
        </div>
      ) : pendingProcurement ? (
        /* Procurement Completed / Payment Pending Card */
        <div style={{
          background: '#ffffff',
          border: '2px solid var(--kq-green-600)',
          borderRadius: 'var(--kq-radius-lg)',
          boxShadow: 'var(--kq-shadow-sm)',
          padding: '24px',
          marginBottom: 32,
          position: 'relative'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{
              fontSize: 12,
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--kq-green-800)'
            }}>
              {currentLang === 'ta' ? 'கொள்முதல் முடிந்தது · வங்கி வரவு செயல்முறையில்' : 'PROCUREMENT COMPLETED · PAYMENT IN PROGRESS'}
            </span>
            <StatusBadge status={pendingProcurement.status} size="normal" />
          </div>

          <h2 style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 800, color: 'var(--kq-text-primary)' }}>
            {pendingProcurement.centre_name || 'Direct Paddy Procurement Centre'}
          </h2>

          <div style={{ fontSize: 14, color: 'var(--kq-text-secondary)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Icon name="calendar" size={15} color="var(--kq-green-700)" />
              {formatHumanDate(pendingProcurement.booking_date)}
            </span>
            <span style={{ color: 'var(--kq-border-medium)' }}>•</span>
            <span>{pendingProcurement.crop} · {pendingProcurement.procured_quantity_quintals || pendingProcurement.quantity_quintals || 50} quintals</span>
          </div>

          <div style={{
            background: 'var(--kq-bg-subtle)',
            border: '1px solid var(--kq-border-light)',
            borderRadius: 'var(--kq-radius-md)',
            padding: '16px 20px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 14,
            marginBottom: 20
          }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--kq-text-muted)', textTransform: 'uppercase' }}>
                {currentLang === 'ta' ? 'மொத்த வரவுத் தொகை' : 'Payment Amount'}
              </div>
              <div style={{ fontSize: 32, fontWeight: 900, color: 'var(--kq-green-800)', lineHeight: 1.1, margin: '4px 0 0' }}>
                ₹{Number(pendingProcurement.payment_amount_inr || ((pendingProcurement.procured_quantity_quintals || pendingProcurement.quantity_quintals || 50) * (pendingProcurement.msp_rate_inr || 2275))).toLocaleString('en-IN')}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--kq-text-primary)' }}>
                {pendingProcurement.status === 'Procured'
                  ? (currentLang === 'ta' ? 'கொள்முதல் ஏற்கப்பட்டது • வங்கி ஒப்புதலுக்கு அனுப்பப்படுகிறது' : 'Crop Accepted • Submitting for DBT Payment')
                  : (currentLang === 'ta' ? 'வங்கி வரவு செயல்முறையில் உள்ளது (DBT)' : 'DBT Bank Transfer Processing')}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--kq-text-secondary)', marginTop: 2 }}>
                {currentLang === 'ta' ? 'அரசு MSP வரவு உங்கள் வங்கிக் கணக்கில் வரவு வைக்கப்படும்' : 'MSP funds will be credited directly to your bank account'}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <PrimaryButton
              onClick={() => navigate(`/farmer/documents?bookingId=${pendingProcurement.booking_id}`)}
              style={{
                flex: '1 1 200px',
                padding: '12px 18px',
                fontSize: 14,
                fontWeight: 800,
                justifyContent: 'center'
              }}
            >
              <span>{currentLang === 'ta' ? 'கொள்முதல் ரசீது & ஆவணங்கள் காண்க →' : 'View Procurement Documents →'}</span>
            </PrimaryButton>

            <SecondaryButton
              onClick={() => navigate('/farmer/book')}
              style={{
                flex: '1 1 160px',
                padding: '12px 18px',
                fontSize: 14,
                fontWeight: 700,
                justifyContent: 'center'
              }}
            >
              <Icon name="calendar" size={16} />
              <span>{currentLang === 'ta' ? 'அடுத்த முன்பதிவு செய்க' : 'Book Next Visit'}</span>
            </SecondaryButton>
          </div>
        </div>
      ) : (
        /* Empty State: Invitation to Book */
        <div style={{
          background: 'var(--kq-bg-subtle)',
          border: '1px solid var(--kq-border-medium)',
          borderRadius: 'var(--kq-radius-lg)',
          padding: '36px 24px',
          textAlign: 'center',
          marginBottom: 32
        }}>
          <div style={{
            width: 50,
            height: 50,
            borderRadius: '50%',
            background: 'var(--kq-green-100)',
            color: 'var(--kq-green-800)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 12px'
          }}>
            <Icon name="calendar" size={24} />
          </div>
          <h3 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 800, color: 'var(--kq-text-primary)' }}>
            {currentLang === 'ta' ? 'அடுத்த வருகை எதுவும் இல்லை' : 'No upcoming visit'}
          </h3>
          <p style={{ margin: '0 auto 20px', fontSize: 14, color: 'var(--kq-text-secondary)', maxWidth: 480, lineHeight: 1.5 }}>
            {currentLang === 'ta'
              ? 'உங்கள் அறுவடை தயாரானதும், அருகிலுள்ள நேரடி கொள்முதல் நிலையத்தில் நேரம் முன்பதிவு செய்யுங்கள்.'
              : 'When your harvest is ready, reserve an arrival slot at your nearest direct procurement centre.'}
          </p>
          <PrimaryButton
            onClick={() => navigate('/farmer/book')}
            style={{ padding: '12px 28px', fontSize: 14, fontWeight: 700 }}
          >
            {currentLang === 'ta' ? 'முன்பதிவு செய்க' : 'Book a Slot'}
          </PrimaryButton>
        </div>
      )}

      {/* 3. WHAT DO YOU NEED? (3 Primary Actions: Book a Visit, Documents, Report a Problem) */}
      <div style={{ marginBottom: 32 }}>
        <h2 style={{
          fontSize: 13,
          fontWeight: 800,
          color: 'var(--kq-text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          margin: '0 0 14px'
        }}>
          {currentLang === 'ta' ? 'உங்களுக்கு என்ன தேவை?' : 'WHAT DO YOU NEED?'}
        </h2>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
          
          {/* Action 1: Book a Visit */}
          <Link to="/farmer/book" style={{ textDecoration: 'none', color: 'inherit' }}>
            <Card style={{ padding: '18px 16px', display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer', border: '1px solid var(--kq-border-medium)', height: '100%' }}>
              <div style={{ width: 42, height: 42, borderRadius: 'var(--kq-radius-sm)', background: '#eff6ff', color: '#1e40af', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon name="calendar" size={22} />
              </div>
              <div>
                <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--kq-text-primary)' }}>
                  {currentLang === 'ta' ? 'பதிவு செய்க' : 'Book a Visit'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--kq-text-muted)', marginTop: 2 }}>
                  {currentLang === 'ta' ? 'நேரம் முன்பதிவு' : 'Reserve a procurement slot'}
                </div>
              </div>
            </Card>
          </Link>

          {/* Action 2: Documents */}
          <Link to="/farmer/documents" style={{ textDecoration: 'none', color: 'inherit' }}>
            <Card style={{ padding: '18px 16px', display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer', border: '1px solid var(--kq-border-medium)', height: '100%' }}>
              <div style={{ width: 42, height: 42, borderRadius: 'var(--kq-radius-sm)', background: '#f3e8ff', color: '#6b21a8', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon name="file-text" size={22} />
              </div>
              <div>
                <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--kq-text-primary)' }}>
                  {currentLang === 'ta' ? 'ஆவணங்கள்' : 'Documents'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--kq-text-muted)', marginTop: 2 }}>
                  {currentLang === 'ta' ? 'அரசு ஆவணங்கள் காண்க' : 'View official records'}
                </div>
              </div>
            </Card>
          </Link>

          {/* Action 3: Report a Problem */}
          <Link to="/farmer/grievance" style={{ textDecoration: 'none', color: 'inherit' }}>
            <Card style={{ padding: '18px 16px', display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer', border: '1px solid var(--kq-border-medium)', height: '100%' }}>
              <div style={{ width: 42, height: 42, borderRadius: 'var(--kq-radius-sm)', background: '#fef2f2', color: '#b91c1c', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon name="alert-triangle" size={22} />
              </div>
              <div>
                <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--kq-text-primary)' }}>
                  {currentLang === 'ta' ? 'பிரச்சனை புகார்' : 'Report a Problem'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--kq-text-muted)', marginTop: 2 }}>
                  {currentLang === 'ta' ? 'புகார் அல்லது உதவி' : 'Raise a grievance'}
                </div>
              </div>
            </Card>
          </Link>

        </div>
      </div>

      {/* 4. USEFUL SERVICES (3 Compact Secondary Cards: Ask Kisan, Plan My Harvest, Get Help) */}
      <div>
        <h2 style={{
          fontSize: 13,
          fontWeight: 800,
          color: 'var(--kq-text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          margin: '0 0 14px'
        }}>
          {currentLang === 'ta' ? 'பயனுள்ள சேவைகள்' : 'USEFUL SERVICES'}
        </h2>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
          
          {/* Service 1: Ask Kisan */}
          <Link to="/farmer/voice-booking" style={{ textDecoration: 'none', color: 'inherit' }}>
            <Card style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', border: '1px solid var(--kq-border-light)', height: '100%', background: 'var(--kq-bg-subtle)' }}>
              <div style={{ width: 38, height: 38, borderRadius: 'var(--kq-radius-sm)', background: 'var(--kq-green-100)', color: 'var(--kq-green-800)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon name="mic" size={20} />
              </div>
              <div>
                <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--kq-text-primary)' }}>
                  {currentLang === 'ta' ? 'கிசான் உதவி' : 'Ask Kisan'}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--kq-text-muted)', marginTop: 2 }}>
                  {currentLang === 'ta' ? 'தமிழில் பேசி அறிய' : 'Speak in Tamil or English'}
                </div>
              </div>
            </Card>
          </Link>

          {/* Service 2: Plan My Harvest */}
          <Link to="/farmer/crop-plan" style={{ textDecoration: 'none', color: 'inherit' }}>
            <Card style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', border: '1px solid var(--kq-border-light)', height: '100%', background: 'var(--kq-bg-subtle)' }}>
              <div style={{ width: 38, height: 38, borderRadius: 'var(--kq-radius-sm)', background: '#eff6ff', color: '#1e40af', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon name="wheat" size={20} />
              </div>
              <div>
                <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--kq-text-primary)' }}>
                  {currentLang === 'ta' ? 'பயிர் திட்டம்' : 'Plan My Harvest'}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--kq-text-muted)', marginTop: 2 }}>
                  {currentLang === 'ta' ? 'அறுவடை திட்டமிடல்' : 'Plan your crop delivery'}
                </div>
              </div>
            </Card>
          </Link>

          {/* Service 3: Get Help */}
          <div onClick={handleOpenHelp} style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}>
            <Card style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: 12, border: '1px solid var(--kq-border-light)', height: '100%', background: 'var(--kq-bg-subtle)' }}>
              <div style={{ width: 38, height: 38, borderRadius: 'var(--kq-radius-sm)', background: '#fef3c7', color: '#92400e', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon name="help-circle" size={20} />
              </div>
              <div>
                <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--kq-text-primary)' }}>
                  {currentLang === 'ta' ? 'உதவி பெற' : 'Get Help'}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--kq-text-muted)', marginTop: 2 }}>
                  {currentLang === 'ta' ? 'கட்டணம் அல்லது நிலைய சிக்கல்கள்' : 'Payment, centre or problem'}
                </div>
              </div>
            </Card>
          </div>

        </div>
      </div>

    </div>
  );
}
