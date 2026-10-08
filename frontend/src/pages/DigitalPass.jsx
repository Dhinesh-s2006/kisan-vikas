import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import API from '../api';
import {
  StatusBadge,
  PrimaryButton,
  LoadingState,
  ErrorState,
  Icon,
  formatHumanDate,
  formatHumanTime
} from '../components/design-system';
import { useI18n, getLanguage } from '../i18n';

const cleanCentreName = (name, id) => {
  let clean = name || id || 'Procurement Centre';
  clean = clean.replace(/TN_DPC_\d+\s*[-–:]\s*/gi, '').replace(/\s*\(TN_DPC_\d+\)/gi, '');
  if (/^TN_DPC_\d+$/i.test(clean.trim())) {
    return 'Kattathur DPC';
  }
  return clean.trim();
};

export default function DigitalPass() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const [currentLang, setCurrentLang] = useState(getLanguage());

  const [pass, setPass] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [qrDataUrl, setQrDataUrl] = useState('');

  useEffect(() => {
    const handleLangChange = () => setCurrentLang(getLanguage());
    window.addEventListener('kq_language_changed', handleLangChange);
    return () => window.removeEventListener('kq_language_changed', handleLangChange);
  }, []);

  useEffect(() => {
    const loadPass = async () => {
      try {
        setLoading(true);
        setError(null);

        let targetBookingId = id || searchParams.get('id') || searchParams.get('bookingId');
        if (!targetBookingId) {
          const farmerId = localStorage.getItem('kisan_farmer_id');
          if (farmerId) {
            const bookingsRes = await API.get(`/bookings/${encodeURIComponent(farmerId)}`);
            if (Array.isArray(bookingsRes.data) && bookingsRes.data.length > 0) {
              const activeStatuses = ['Confirmed', 'Booked', 'On The Way', 'Checked-In', 'In Queue', 'Grading', 'Weighing'];
              const found = bookingsRes.data.find(b => activeStatuses.includes(b.status)) || bookingsRes.data[0];
              targetBookingId = found.booking_id;
            }
          }
        }

        if (!targetBookingId) {
          setError(currentLang === 'ta' ? 'பதிவு எண் எதுவும் காணப்படவில்லை.' : 'No booking reference specified.');
          setLoading(false);
          return;
        }

        const res = await API.get(`/bookings/pass/${targetBookingId}`);
        if (res.data?.pass) {
          const passData = res.data.pass;
          setPass(passData);

          const payloadStr = JSON.stringify(passData.qr_payload || {
            booking_id: passData.booking_id,
            token: passData.token,
            farmer_id: passData.farmer_id,
            centre_id: passData.centre_id,
            hash: passData.verification_hash
          });

          const url = await QRCode.toDataURL(payloadStr, {
            width: 220,
            margin: 1,
            color: {
              dark: '#14532d',
              light: '#ffffff'
            }
          });
          setQrDataUrl(url);
        } else {
          setError(currentLang === 'ta' ? 'பாஸ் விவரங்கள் கிடைக்கவில்லை.' : 'Digital pass details not found.');
        }
      } catch (err) {
        console.error('Pass load error:', err);
        setError(err.response?.data?.message || (currentLang === 'ta' ? 'டிஜிட்டல் பாஸை ஏற்றுவதில் பிழை.' : 'Unable to load digital procurement pass.'));
      } finally {
        setLoading(false);
      }
    };

    loadPass();
  }, [id, searchParams, currentLang]);

  if (loading) {
    return (
      <div style={{ maxWidth: 600, margin: '60px auto', padding: '0 16px' }}>
        <LoadingState
          message={currentLang === 'ta' ? 'டிஜிட்டல் பாஸ் ஏற்றப்படுகிறது...' : 'Loading Digital Procurement Pass...'}
          description={currentLang === 'ta' ? 'அரசு கொள்முதல் பதிவேட்டில் இருந்து சரிபார்க்கப்பட்ட பாஸ் பெறப்படுகிறது...' : 'Retrieving official verified gate pass from registry...'}
        />
      </div>
    );
  }

  if (error || !pass) {
    return (
      <div style={{ maxWidth: 600, margin: '60px auto', padding: '0 16px' }}>
        <ErrorState
          title={currentLang === 'ta' ? 'டிஜிட்டல் பாஸ் கிடைக்கவில்லை' : 'Digital Pass Not Available'}
          message={error || (currentLang === 'ta' ? 'இந்த பதிவிற்கான பாஸ் விவரங்கள் கிடைக்கவில்லை.' : 'Could not find a valid pass for this booking reference.')}
          actionLabel={currentLang === 'ta' ? 'எனது வருகை பக்கத்திற்கு திரும்பு' : 'Back to My Visit'}
          onAction={() => navigate('/farmer/visit')}
        />
      </div>
    );
  }

  const tokenDisplay = pass.token || ('Q' + String(pass.queue_position_at_booking || 1).padStart(3, '0'));
  const centreName = cleanCentreName(pass.centre_name, pass.centre_id);
  const timeDisplay = pass.start_time
    ? formatHumanTime(`${pass.start_time} - ${pass.end_time || ''}`)
    : (pass.slot_time || '08:00 AM - 09:00 AM');

  return (
    <div style={{ maxWidth: 640, margin: '24px auto', padding: '0 16px 60px' }}>
      
      {/* Top Controls: Single Arrow Back + Print (Hidden on Print) */}
      <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18, gap: 12 }}>
        <Link
          to="/farmer/visit"
          style={{
            textDecoration: 'none',
            color: 'var(--kq-green-800)',
            fontWeight: 700,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 14
          }}
        >
          <Icon name="arrow-left" size={16} />
          <span>{currentLang === 'ta' ? 'எனது வருகை' : 'Back to My Visit'}</span>
        </Link>

        <PrimaryButton
          onClick={() => window.print()}
          style={{ padding: '6px 14px', fontSize: 13, gap: 6 }}
        >
          <Icon name="printer" size={15} />
          <span>{currentLang === 'ta' ? 'அச்சிடு' : 'Print Pass'}</span>
        </PrimaryButton>
      </div>

      {/* Official Digital Procurement Pass Card */}
      <div
        className="digital-pass-card"
        style={{
          background: '#ffffff',
          border: '2px solid var(--kq-green-800)',
          borderRadius: 'var(--kq-radius-lg)',
          overflow: 'hidden',
          boxShadow: 'var(--kq-shadow-md)'
        }}
      >
        {/* Pass Header */}
        <div style={{
          background: 'var(--kq-green-900)',
          color: '#ffffff',
          padding: '20px 24px',
          borderBottom: '3px solid var(--kq-green-600)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.9, fontWeight: 700 }}>
                {currentLang === 'ta' ? 'தமிழ்நாடு அரசு • உழவர்சேது' : 'Govt of Tamil Nadu • Kisan Vikas'}
              </div>
              <h1 style={{ margin: '4px 0 2px', fontSize: 22, fontWeight: 800, color: '#ffffff', letterSpacing: '-0.01em' }}>
                {currentLang === 'ta' ? 'டிஜிட்டல் கொள்முதல் பாஸ்' : 'Digital Procurement Pass'}
              </h1>
              <div style={{ fontSize: 12, opacity: 0.85 }}>
                {currentLang === 'ta' ? 'அதிகாரப்பூர்வ நுழைவு & எடை டோக்கன்' : 'Official Gate Verification Pass'}
              </div>
            </div>

            <div style={{ textAlign: 'right' }}>
              <StatusBadge status={pass.status} size="normal" />
            </div>
          </div>
        </div>

        {/* Priority Hero: Token + QR Code */}
        <div style={{
          padding: '24px',
          background: 'var(--kq-bg-subtle)',
          borderBottom: '1px solid var(--kq-border-medium)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 20
        }}>
          {/* Left: Queue Token */}
          <div style={{ flex: '1 1 200px' }}>
            <div style={{ fontSize: 12, color: 'var(--kq-text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {t('tokenLabel')}
            </div>
            <div style={{ fontSize: 56, fontWeight: 900, color: 'var(--kq-green-900)', lineHeight: 1.05, margin: '4px 0 8px', letterSpacing: '-0.03em' }}>
              {tokenDisplay}
            </div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: 'var(--kq-green-800)', background: 'var(--kq-green-100)', padding: '4px 10px', borderRadius: 20 }}>
              <Icon name="check" size={13} />
              <span>{pass.status === 'Confirmed' ? (currentLang === 'ta' ? 'உறுதி செய்யப்பட்டது' : 'Verified Appointment') : pass.status}</span>
            </div>
          </div>

          {/* Right: QR Code for Gate Scanning */}
          <div style={{
            textAlign: 'center',
            background: '#ffffff',
            padding: '12px 14px',
            borderRadius: 'var(--kq-radius-md)',
            border: '1.5px solid var(--kq-border-medium)',
            boxShadow: 'var(--kq-shadow-xs)'
          }}>
            {qrDataUrl ? (
              <img src={qrDataUrl} alt="Pass QR Code" style={{ width: 140, height: 140, display: 'block', margin: '0 auto' }} />
            ) : (
              <div style={{ width: 140, height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f5f4', color: 'var(--kq-text-muted)', fontSize: 11 }}>
                Generating QR...
              </div>
            )}
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--kq-green-900)', marginTop: 6 }}>
              {t('scanAtGate')}
            </div>
          </div>
        </div>

        {/* Pass Details Table (Clean, Compact, Scannable) */}
        <div style={{ padding: '24px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px 24px' }}>
            
            {/* Farmer Name */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--kq-text-muted)', textTransform: 'uppercase' }}>
                {currentLang === 'ta' ? 'உழவர் பெயர்' : 'Farmer Name'}
              </div>
              <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--kq-text-primary)', marginTop: 2 }}>
                {pass.farmer_name || localStorage.getItem('kisan_farmer_name') || 'Farmer'}
              </div>
            </div>

            {/* Procurement Centre */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--kq-text-muted)', textTransform: 'uppercase' }}>
                {t('centreLabel')}
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--kq-text-primary)', marginTop: 2 }}>
                {centreName}
              </div>
            </div>

            {/* Date */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--kq-text-muted)', textTransform: 'uppercase' }}>
                {currentLang === 'ta' ? 'கொள்முதல் தேதி' : 'Visit Date'}
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--kq-text-primary)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon name="calendar" size={15} color="var(--kq-green-800)" />
                <span>{formatHumanDate(pass.booking_date)}</span>
              </div>
            </div>

            {/* Time Window */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--kq-text-muted)', textTransform: 'uppercase' }}>
                {t('slotLabel')}
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--kq-text-primary)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon name="clock" size={15} color="var(--kq-green-800)" />
                <span>{timeDisplay}</span>
              </div>
            </div>

            {/* Crop & Quantity */}
            <div style={{ gridColumn: '1 / -1', paddingTop: 12, borderTop: '1px solid var(--kq-border-light)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--kq-text-muted)', textTransform: 'uppercase' }}>
                {currentLang === 'ta' ? 'பயிர் மற்றும் அளவு' : 'Crop & Quantity'}
              </div>
              <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--kq-green-900)', marginTop: 2 }}>
                {pass.crop || 'Paddy (Common)'} — {pass.quantity_quintals || pass.quantity || 50} {currentLang === 'ta' ? 'குவிண்டால்' : 'quintals'}
              </div>
            </div>

          </div>

          {/* Minimal Official Verification Seal */}
          <div style={{
            marginTop: 20,
            paddingTop: 14,
            borderTop: '1px dashed var(--kq-border-medium)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 8,
            fontSize: 11,
            color: 'var(--kq-text-muted)'
          }}>
            <div>
              <span>SEAL: </span>
              <strong style={{ fontFamily: 'monospace', color: 'var(--kq-text-secondary)' }}>
                {pass.verification_hash ? pass.verification_hash.slice(0, 16) : 'VERIFIED'}
              </strong>
            </div>
            <div>
              Ref: <span style={{ fontFamily: 'monospace' }}>{pass.booking_id}</span>
            </div>
          </div>
        </div>

      </div>

    </div>
  );
}
