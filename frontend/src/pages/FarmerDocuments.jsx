import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import API from '../api';
import {
  StatusBadge,
  PrimaryButton,
  SecondaryButton,
  Icon,
  LoadingState,
  EmptyState,
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

export default function FarmerDocuments() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryBookingId = searchParams.get('bookingId');
  const { t } = useI18n();
  const [currentLang, setCurrentLang] = useState(getLanguage());

  const [farmerId, setFarmerId] = useState(localStorage.getItem('kisan_farmer_id') || '');
  const [farmerName, setFarmerName] = useState(localStorage.getItem('kisan_farmer_name') || '');
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);

  const [selectedBookingId, setSelectedBookingId] = useState(queryBookingId || null);
  const [docsPage, setDocsPage] = useState(1);
  const RECORDS_PER_PAGE = 5;

  useEffect(() => {
    const handleLangChange = () => setCurrentLang(getLanguage());
    window.addEventListener('kq_language_changed', handleLangChange);
    return () => window.removeEventListener('kq_language_changed', handleLangChange);
  }, []);

  useEffect(() => {
    if (queryBookingId) {
      setSelectedBookingId(queryBookingId);
    }
  }, [queryBookingId]);

  useEffect(() => {
    if (!farmerId) {
      setLoading(false);
      return;
    }

    const loadData = async () => {
      try {
        setLoading(true);
        // Ensure auth token
        if (!localStorage.getItem('kisan_token')) {
          try {
            const pRes = await API.get(`/farmers/${encodeURIComponent(farmerId)}`, { skipAuth: true });
            if (pRes.data?.token) {
              localStorage.setItem('kisan_token', pRes.data.token);
              localStorage.setItem('kisan_role', 'FARMER');
            }
          } catch (_) {}
        }

        const res = await API.get(`/bookings/${encodeURIComponent(farmerId)}`);
        const allBookings = Array.isArray(res.data) ? res.data : [];
        setBookings(allBookings);
      } catch (err) {
        console.error('Documents load error:', err);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [farmerId]);

  if (!farmerId) {
    return (
      <div style={{ maxWidth: 640, margin: '60px auto', padding: '0 16px' }}>
        <EmptyState
          icon="file-text"
          title={currentLang === 'ta' ? 'உழவர் உள்நுழைவு தேவை' : 'Farmer Access Required'}
          description={currentLang === 'ta' ? 'உங்கள் அதிகாரப்பூர்வ அரசு கொள்முதல் ஆவணங்களைக் காண உழவர் எண்ணை உள்ளிடவும்.' : 'Please sign in with your Farmer ID to access your official procurement documents.'}
          action={<PrimaryButton onClick={() => navigate('/farmer')}>{currentLang === 'ta' ? 'உள்நுழைக' : 'Go to Sign In'}</PrimaryButton>}
        />
      </div>
    );
  }

  // Selected single booking if drilling down into Procurement Record
  const selectedBooking = selectedBookingId ? bookings.find(b => b.booking_id === selectedBookingId) : null;
  const activeBooking = bookings[0] || null;

  // Build the 3 official records for a selected visit
  const getOfficialRecordsForBooking = (b) => {
    if (!b) return [];
    const status = (b.status || '').toLowerCase();
    const hasScale = ['weighing', 'procured', 'payment pending', 'paid', 'payment completed'].includes(status);
    const hasCert = ['procured', 'payment pending', 'paid', 'payment completed'].includes(status);
    const hasPayment = ['paid', 'payment completed'].includes(status);

    return [
      {
        key: 'cert',
        title: currentLang === 'ta' ? 'கொள்முதல் சான்றிதழ்' : 'Procurement Certificate',
        desc: currentLang === 'ta' ? 'அரசு குறைந்தபட்ச ஆதரவு விலை (MSP) ஒப்புதல் சான்றிதழ்' : 'Official MSP crop acceptance voucher & transaction record',
        link: `/farmer/procurement-record/${b.booking_id}`,
        statusLabel: hasCert ? (currentLang === 'ta' ? 'உருவாக்கப்பட்டது' : 'Issued') : (currentLang === 'ta' ? 'சரிபார்ப்பில் உள்ளது' : 'Pending Acceptance'),
        actionLabel: t('viewBtn') || (currentLang === 'ta' ? 'காண்க' : 'View')
      },
      {
        key: 'scale',
        title: currentLang === 'ta' ? 'எடை மேடை ரசீது' : 'Scale / Weighment Slip',
        desc: currentLang === 'ta' ? 'சான்றளிக்கப்பட்ட மொத்த மற்றும் நிகர மூட்டை எடை ரசீது' : 'Certified gross, tare & net bag weighment receipt',
        link: `/farmer/procurement-record/${b.booking_id}`,
        statusLabel: hasScale ? (currentLang === 'ta' ? 'எடை பதிவானது' : 'Recorded') : (currentLang === 'ta' ? 'எடைக்கு காத்திருக்கிறது' : 'Pending Weighment'),
        actionLabel: t('viewBtn') || (currentLang === 'ta' ? 'காண்க' : 'View')
      },
      {
        key: 'payment',
        title: currentLang === 'ta' ? 'வங்கி வரவு ரசீது' : 'Payment Receipt',
        desc: currentLang === 'ta' ? 'வங்கிக் கணக்கில் நேரடி பண வரவு (DBT) அறிக்கை' : 'Direct Benefit Transfer (DBT) bank credit confirmation',
        link: `/farmer/procurement-record/${b.booking_id}`,
        statusLabel: hasPayment ? (currentLang === 'ta' ? 'வரவு வைக்கப்பட்டது' : 'Completed') : (currentLang === 'ta' ? 'வங்கி வரவு செயல்முறையில்' : 'In Processing'),
        actionLabel: t('viewBtn') || (currentLang === 'ta' ? 'காண்க' : 'View')
      }
    ];
  };

  return (
    <div style={{ maxWidth: 760, margin: '20px auto', padding: '0 16px 80px' }}>
      
      {/* ===================================================================== */}
      {/* VIEW A: SINGLE PROCUREMENT RECORD VIEW (When Record Is Opened)        */}
      {/* ===================================================================== */}
      {selectedBooking ? (() => {
        const token = selectedBooking.token || (selectedBooking.queue_position_at_booking ? `Q${String(selectedBooking.queue_position_at_booking).padStart(3, '0')}` : selectedBooking.booking_id.slice(-5));
        const centreTitle = cleanCentreName(selectedBooking.centre_name, selectedBooking.centre_id);
        const cropDisplay = `${selectedBooking.crop || 'Paddy'} — ${selectedBooking.quantity_quintals || selectedBooking.quantity || 50} Qtl`;
        const timeSlot = selectedBooking.slot_time ? formatHumanTime(selectedBooking.slot_time) : '';
        const officialDocs = getOfficialRecordsForBooking(selectedBooking);

        return (
          <div>
            {/* Back to all records link button */}
            <div style={{ marginBottom: 18 }}>
              <button
                type="button"
                onClick={() => {
                  setSelectedBookingId(null);
                  setSearchParams({});
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className="kq-btn kq-btn-secondary"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 14px',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                <Icon name="arrow-left" size={15} />
                <span>{t('backToAllRecords')}</span>
              </button>
            </div>

            {/* Record Header Card */}
            <div style={{
              background: '#ffffff',
              border: '1.5px solid var(--kq-green-700)',
              borderRadius: 'var(--kq-radius-lg)',
              padding: '22px',
              boxShadow: 'var(--kq-shadow-sm)',
              marginBottom: 20
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--kq-green-800)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {t('procurementRecordTitle')}
                  </div>
                  <h1 style={{ margin: '4px 0 2px', fontSize: 24, fontWeight: 900, color: 'var(--kq-text-primary)' }}>
                    {token}
                  </h1>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--kq-text-primary)', marginTop: 2 }}>
                    {centreTitle}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--kq-text-secondary)', marginTop: 2 }}>
                    {formatHumanDate(selectedBooking.booking_date)}{timeSlot ? ` • ${timeSlot}` : ''}
                  </div>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--kq-green-900)', marginTop: 4 }}>
                    {cropDisplay}
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <StatusBadge status={selectedBooking.status} size="normal" />
                  <div style={{ fontSize: 11, color: 'var(--kq-text-muted)', marginTop: 6, fontFamily: 'monospace' }}>
                    Ref: {selectedBooking.booking_id}
                  </div>
                </div>
              </div>
            </div>

            {/* OFFICIAL RECORDS Container (Certificate, Weighment, Payment) */}
            <div style={{
              background: '#ffffff',
              border: '1px solid var(--kq-border-medium)',
              borderRadius: 'var(--kq-radius-lg)',
              padding: '20px',
              boxShadow: 'var(--kq-shadow-xs)'
            }}>
              <div style={{
                fontSize: 12,
                fontWeight: 800,
                color: 'var(--kq-text-primary)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                marginBottom: 14,
                display: 'flex',
                alignItems: 'center',
                gap: 6
              }}>
                <Icon name="folder" size={16} color="var(--kq-green-800)" />
                <span>{t('officialRecordsTitle')}</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {officialDocs.map(doc => (
                  <div
                    key={doc.key}
                    style={{
                      background: 'var(--kq-bg-subtle)',
                      border: '1px solid var(--kq-border-light)',
                      borderRadius: 'var(--kq-radius-md)',
                      padding: '14px 16px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: 12
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 240, flex: 1 }}>
                      <div style={{
                        width: 36,
                        height: 36,
                        borderRadius: 'var(--kq-radius-sm)',
                        background: '#ffffff',
                        color: 'var(--kq-green-800)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        border: '1px solid var(--kq-border-medium)',
                        flexShrink: 0
                      }}>
                        <Icon name="file-text" size={18} />
                      </div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--kq-text-primary)' }}>
                          {doc.title}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--kq-text-secondary)', marginTop: 2 }}>
                          {doc.desc}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{
                        fontSize: 11,
                        fontWeight: 700,
                        padding: '3px 8px',
                        borderRadius: 4,
                        background: '#ffffff',
                        border: '1px solid var(--kq-border-medium)',
                        color: 'var(--kq-text-secondary)'
                      }}>
                        {doc.statusLabel}
                      </span>

                      <Link
                        to={doc.link}
                        className="kq-btn kq-btn-secondary"
                        style={{
                          fontSize: 12.5,
                          fontWeight: 700,
                          padding: '6px 14px',
                          textDecoration: 'none',
                          color: 'var(--kq-green-900)',
                          background: '#ffffff',
                          border: '1.5px solid var(--kq-green-700)',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {doc.actionLabel} →
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })() : (
        /* ===================================================================== */
        /* VIEW B: MAIN DOCUMENTS PAGE (ONLY 2 PRIMARY ITEMS AT FIRST LEVEL)     */
        /* 1. DIGITAL PROCUREMENT PASS                                           */
        /* 2. PROCUREMENT RECORD (Certificate • Weighment • Payment)             */
        /* ===================================================================== */
        <div>
          {/* Top Header */}
          <div style={{ marginBottom: 22, borderBottom: '1px solid var(--kq-border-light)', paddingBottom: 14 }}>
            <h1 style={{ margin: '0 0 4px', fontSize: 24, fontWeight: 900, color: 'var(--kq-text-primary)' }}>
              {currentLang === 'ta' ? 'எனது ஆவணங்கள்' : 'MY DOCUMENTS'}
            </h1>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--kq-text-secondary)' }}>
              {currentLang === 'ta' ? 'உங்கள் அதிகாரப்பூர்வ அரசு கொள்முதல் ஆவணங்கள்' : 'Your official procurement records'}
            </p>
          </div>

          {loading ? (
            <div style={{ padding: '60px 0' }}>
              <LoadingState message={currentLang === 'ta' ? 'ஆவணங்கள் ஏற்றப்படுகின்றன...' : 'Loading official records...'} />
            </div>
          ) : bookings.length === 0 ? (
            <EmptyState
              icon="file-text"
              title={currentLang === 'ta' ? 'ஆவணங்கள் எதுவும் இல்லை' : 'No Documents Available'}
              description={currentLang === 'ta' ? 'நீங்கள் இன்னும் எந்த கொள்முதல் பதிவையும் மேற்கொள்ளவில்லை.' : 'You do not have any registered procurement bookings yet.'}
              action={<PrimaryButton onClick={() => navigate('/farmer/book')}>{currentLang === 'ta' ? 'கொள்முதல் பதிவு செய்' : 'Book a Visit'}</PrimaryButton>}
            />
          ) : (() => {
            const totalRecords = bookings.length;
            const totalPages = Math.ceil(totalRecords / RECORDS_PER_PAGE);
            const startIndex = (docsPage - 1) * RECORDS_PER_PAGE;
            const endIndex = Math.min(startIndex + RECORDS_PER_PAGE, totalRecords);
            const pagedRecords = bookings.slice(startIndex, endIndex);

            const upcomingActiveStatuses = ['Confirmed', 'Booked', 'On The Way', 'Checked-In', 'In Queue', 'Grading', 'Weighing'];
            const activePassBooking = bookings.find(b => upcomingActiveStatuses.includes(b.status)) || null;
            const activeToken = activePassBooking?.token || (activePassBooking?.queue_position_at_booking ? `Q${String(activePassBooking.queue_position_at_booking).padStart(3, '0')}` : activePassBooking?.booking_id?.slice(-5) || 'Q001');
            const activeCentre = activePassBooking ? cleanCentreName(activePassBooking.centre_name, activePassBooking.centre_id) : '';

            const completedStatuses = ['Payment Completed', 'Procured', 'Payment Pending'];
            const latestCompleted = bookings.find(b => completedStatuses.includes(b.status)) || null;

            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                
                {/* ------------------------------------------------------------- */}
                {/* 1. DIGITAL PROCUREMENT PASS CARD (ONLY IF ACTIVE APPOINTMENT) */}
                {/* ------------------------------------------------------------- */}
                {activePassBooking && (
                  <div style={{
                    background: '#ffffff',
                    border: '1.5px solid var(--kq-green-700)',
                    borderRadius: 'var(--kq-radius-lg)',
                    padding: '18px 20px',
                    boxShadow: 'var(--kq-shadow-sm)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 16
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                      <div style={{
                        width: 44,
                        height: 44,
                        borderRadius: 'var(--kq-radius-sm)',
                        background: 'var(--kq-green-50)',
                        color: 'var(--kq-green-800)',
                        border: '1.5px solid var(--kq-green-300)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0
                      }}>
                        <Icon name="qr-code" size={24} />
                      </div>
                      <div>
                        <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--kq-text-primary)' }}>
                          {t('digitalGatePass')}
                        </div>
                        <div style={{ fontSize: 12.5, color: 'var(--kq-text-secondary)', marginTop: 2 }}>
                          {t('gateVerification')} • Token <strong>{activeToken}</strong> • {activeCentre}
                        </div>
                      </div>
                    </div>

                    <Link
                      to={`/pass/${activePassBooking.booking_id}`}
                      className="kq-btn kq-btn-primary"
                      style={{
                        padding: '8px 18px',
                        fontSize: 13,
                        fontWeight: 700,
                        textDecoration: 'none',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {t('viewDigitalPassBtn')} →
                    </Link>
                  </div>
                )}

                {/* ------------------------------------------------------------- */}
                {/* 2. LATEST COMPLETED PROCUREMENT SUMMARY (FROM REAL DB)        */}
                {/* ------------------------------------------------------------- */}
                {latestCompleted && (
                  <div style={{
                    background: '#ffffff',
                    border: '2px solid var(--kq-green-700)',
                    borderRadius: 'var(--kq-radius-lg)',
                    padding: '22px 24px',
                    boxShadow: 'var(--kq-shadow-sm)'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{
                          fontSize: 12,
                          fontWeight: 800,
                          textTransform: 'uppercase',
                          letterSpacing: '0.06em',
                          color: 'var(--kq-green-800)'
                        }}>
                          {currentLang === 'ta' ? 'சமீபத்திய நிறைவு செய்யப்பட்ட கொள்முதல்' : 'LATEST COMPLETED PROCUREMENT'}
                        </span>
                        <span style={{ color: 'var(--kq-border-medium)' }}>•</span>
                        <span style={{ fontSize: 12, color: 'var(--kq-text-secondary)', fontFamily: 'monospace' }}>
                          REF: {latestCompleted.booking_id}
                        </span>
                      </div>
                      <StatusBadge status={latestCompleted.status} size="normal" />
                    </div>

                    <h2 style={{ margin: '0 0 6px', fontSize: 19, fontWeight: 800, color: 'var(--kq-text-primary)' }}>
                      {cleanCentreName(latestCompleted.centre_name, latestCompleted.centre_id)}
                    </h2>
                    <div style={{ fontSize: 13.5, color: 'var(--kq-text-secondary)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Icon name="calendar" size={14} color="var(--kq-green-700)" />
                        {formatHumanDate(latestCompleted.booking_date)}
                      </span>
                      <span style={{ color: 'var(--kq-border-medium)' }}>•</span>
                      <span style={{ fontWeight: 600 }}>{latestCompleted.crop} · {latestCompleted.procured_quantity_quintals || latestCompleted.quantity_quintals || 50} Quintals</span>
                      {latestCompleted.grading_result && (
                        <>
                          <span style={{ color: 'var(--kq-border-medium)' }}>•</span>
                          <span style={{ color: 'var(--kq-green-800)', fontWeight: 700 }}>{latestCompleted.grading_result}</span>
                        </>
                      )}
                    </div>

                    {/* Financial & Weight Summary Box */}
                    <div style={{
                      background: 'var(--kq-bg-subtle)',
                      border: '1px solid var(--kq-border-light)',
                      borderRadius: 'var(--kq-radius-md)',
                      padding: '16px 20px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: 16,
                      marginBottom: 18
                    }}>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--kq-text-muted)', textTransform: 'uppercase' }}>
                          {currentLang === 'ta' ? 'அரசு MSP வரவுத் தொகை' : 'MSP Payment Amount'}
                        </div>
                        <div style={{ fontSize: 32, fontWeight: 900, color: 'var(--kq-green-800)', lineHeight: 1.1, margin: '2px 0 0' }}>
                          ₹{Number(latestCompleted.payment_amount_inr || ((latestCompleted.procured_quantity_quintals || latestCompleted.quantity_quintals || 50) * (latestCompleted.msp_rate_inr || 2275))).toLocaleString('en-IN')}
                        </div>
                        <div style={{ fontSize: 11.5, color: 'var(--kq-text-secondary)', marginTop: 4 }}>
                          MSP Rate: ₹{latestCompleted.msp_rate_inr || 2275} / Qtl · {latestCompleted.payment_status || 'Completed'}
                        </div>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 200 }}>
                        <div style={{ fontSize: 12.5, color: 'var(--kq-text-primary)' }}>
                          <strong>{currentLang === 'ta' ? 'ஏற்றுக்கொள்ளப்பட்ட எடை:' : 'Accepted Quantity:'}</strong> {latestCompleted.procured_quantity_quintals || latestCompleted.quantity_quintals || 50} Qtl
                        </div>
                        <div style={{ fontSize: 12.5, color: 'var(--kq-text-primary)' }}>
                          <strong>{currentLang === 'ta' ? 'பரிவர்த்தனை குறிப்பு:' : 'Transaction Ref:'}</strong> {latestCompleted.transaction_reference || `TXN-${latestCompleted.booking_id}`}
                        </div>
                      </div>
                    </div>

                    {/* Official Verified Documents Grid */}
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                      gap: 10,
                      marginBottom: 16
                    }}>
                      <Link
                        to={`/farmer/procurement-record/${latestCompleted.booking_id}`}
                        style={{
                          textDecoration: 'none',
                          background: '#ffffff',
                          border: '1px solid var(--kq-border-medium)',
                          borderRadius: 'var(--kq-radius-md)',
                          padding: '12px 14px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10
                        }}
                      >
                        <div style={{ color: 'var(--kq-green-700)', display: 'flex' }}>
                          <Icon name="file-text" size={20} />
                        </div>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--kq-text-primary)' }}>
                            {currentLang === 'ta' ? 'கொள்முதல் சான்றிதழ்' : 'Procurement Certificate'}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--kq-green-800)', fontWeight: 600 }}>
                            {currentLang === 'ta' ? 'சான்றளிக்கப்பட்டது ✓' : 'Issued ✓'}
                          </div>
                        </div>
                      </Link>

                      <Link
                        to={`/farmer/procurement-record/${latestCompleted.booking_id}`}
                        style={{
                          textDecoration: 'none',
                          background: '#ffffff',
                          border: '1px solid var(--kq-border-medium)',
                          borderRadius: 'var(--kq-radius-md)',
                          padding: '12px 14px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10
                        }}
                      >
                        <div style={{ color: 'var(--kq-green-700)', display: 'flex' }}>
                          <Icon name="check-circle" size={20} />
                        </div>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--kq-text-primary)' }}>
                            {currentLang === 'ta' ? 'எடை மேடை ரசீது' : 'Scale / Weighment Slip'}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--kq-green-800)', fontWeight: 600 }}>
                            {currentLang === 'ta' ? 'பதிவானது ✓' : 'Recorded ✓'}
                          </div>
                        </div>
                      </Link>

                      <Link
                        to={`/farmer/procurement-record/${latestCompleted.booking_id}`}
                        style={{
                          textDecoration: 'none',
                          background: '#ffffff',
                          border: '1px solid var(--kq-border-medium)',
                          borderRadius: 'var(--kq-radius-md)',
                          padding: '12px 14px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10
                        }}
                      >
                        <div style={{ color: 'var(--kq-green-700)', display: 'flex' }}>
                          <Icon name="credit-card" size={20} />
                        </div>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--kq-text-primary)' }}>
                            {currentLang === 'ta' ? 'வங்கி வரவு ரசீது' : 'Payment Receipt (DBT)'}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--kq-green-800)', fontWeight: 600 }}>
                            {latestCompleted.status === 'Payment Completed' ? (currentLang === 'ta' ? 'வரவு வைக்கப்பட்டது ✓' : 'Completed ✓') : (currentLang === 'ta' ? 'செயல்முறையில்...' : 'Processing...')}
                          </div>
                        </div>
                      </Link>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <PrimaryButton
                        onClick={() => navigate(`/farmer/procurement-record/${latestCompleted.booking_id}`)}
                        style={{ padding: '8px 20px', fontSize: 13, fontWeight: 700 }}
                      >
                        <span>{currentLang === 'ta' ? 'முழு கொள்முதல் பதிவைக் காண்க →' : 'View Full Procurement Record →'}</span>
                      </PrimaryButton>
                    </div>
                  </div>
                )}

                {/* Divider between top cards and historical records */}
                <div style={{ borderBottom: '1px solid var(--kq-border-light)' }} />

                {/* ------------------------------------------------------------- */}
                {/* 2. PROCUREMENT RECORD (Certificate • Weighment • Payment)     */}
                {/* ------------------------------------------------------------- */}
                <div>
                  <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
                    <div>
                      <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: 'var(--kq-text-primary)' }}>
                        {t('procurementRecordTitle')}
                      </h2>
                      <div style={{ fontSize: 12.5, color: 'var(--kq-text-muted)', marginTop: 2 }}>
                        {t('certificateWeighmentPayment')}
                      </div>
                    </div>
                  </div>

                  {/* List of Visits under Procurement Record */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {pagedRecords.map((b) => {
                      const token = b.token || (b.queue_position_at_booking ? `Q${String(b.queue_position_at_booking).padStart(3, '0')}` : b.booking_id.slice(-5));
                      const centreTitle = cleanCentreName(b.centre_name, b.centre_id);
                      const cropDisplay = `${b.crop || 'Paddy'} — ${b.quantity_quintals || b.quantity || 50} Qtl`;
                      const timeSlot = b.slot_time ? formatHumanTime(b.slot_time) : '';

                      return (
                        <div
                          key={b.booking_id}
                          style={{
                            background: '#ffffff',
                            border: '1px solid var(--kq-border-medium)',
                            borderRadius: 'var(--kq-radius-md)',
                            padding: '14px 18px',
                            boxShadow: 'var(--kq-shadow-xs)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            flexWrap: 'wrap',
                            gap: 14
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                            <div style={{
                              minWidth: 54,
                              height: 40,
                              borderRadius: 'var(--kq-radius-sm)',
                              background: 'var(--kq-bg-subtle)',
                              color: 'var(--kq-green-900)',
                              fontWeight: 800,
                              fontSize: 14,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              border: '1px solid var(--kq-border-medium)'
                            }}>
                              {token}
                            </div>

                            <div>
                              <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--kq-text-primary)' }}>
                                {centreTitle}
                              </div>
                              <div style={{ fontSize: 12.5, color: 'var(--kq-text-secondary)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                <span>{formatHumanDate(b.booking_date)}{timeSlot ? ` • ${timeSlot}` : ''}</span>
                                <span>•</span>
                                <span style={{ fontWeight: 600 }}>{cropDisplay}</span>
                              </div>
                            </div>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <StatusBadge status={b.status} size="small" />

                            <button
                              type="button"
                              onClick={() => {
                                setSelectedBookingId(b.booking_id);
                                window.scrollTo({ top: 0, behavior: 'smooth' });
                              }}
                              className="kq-btn kq-btn-secondary"
                              style={{
                                padding: '6px 14px',
                                fontSize: 12.5,
                                fontWeight: 700,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 6,
                                color: 'var(--kq-green-900)',
                                border: '1.5px solid var(--kq-green-700)',
                                background: '#ffffff',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              <span>{t('viewProcurementRecordBtn')}</span>
                              <Icon name="arrow-right" size={13} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Pagination Controls (Max 5 per page) */}
                  {totalPages > 1 && (
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginTop: 16,
                      paddingTop: 12,
                      borderTop: '1px solid var(--kq-border-light)',
                      fontSize: 12.5,
                      color: 'var(--kq-text-secondary)',
                      flexWrap: 'wrap',
                      gap: 8
                    }}>
                      <div>
                        {currentLang === 'ta'
                          ? `${totalRecords}-ல் ${startIndex + 1}–${endIndex} பதிவுகள்`
                          : `Showing ${startIndex + 1}–${endIndex} of ${totalRecords} records`}
                      </div>

                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          type="button"
                          disabled={docsPage <= 1}
                          onClick={() => setDocsPage(p => Math.max(1, p - 1))}
                          className="kq-btn kq-btn-secondary"
                          style={{
                            height: 28,
                            padding: '2px 10px',
                            fontSize: 12,
                            opacity: docsPage <= 1 ? 0.5 : 1,
                            cursor: docsPage <= 1 ? 'not-allowed' : 'pointer'
                          }}
                        >
                          {t('previousBtn')}
                        </button>
                        <button
                          type="button"
                          disabled={docsPage >= totalPages}
                          onClick={() => setDocsPage(p => Math.min(totalPages, p + 1))}
                          className="kq-btn kq-btn-secondary"
                          style={{
                            height: 28,
                            padding: '2px 10px',
                            fontSize: 12,
                            opacity: docsPage >= totalPages ? 0.5 : 1,
                            cursor: docsPage >= totalPages ? 'not-allowed' : 'pointer'
                          }}
                        >
                          {t('nextBtn')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

              </div>
            );
          })()}
        </div>
      )}

    </div>
  );
}
