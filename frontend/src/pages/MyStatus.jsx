import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import API from '../api';
import {
  Card,
  StatCard,
  StatusBadge,
  AlertBanner,
  PrimaryButton,
  SecondaryButton,
  DataTable,
  formatHumanDate,
  formatHumanTime,
  Timeline,
  Modal,
  Icon,
  EmptyState,
  LoadingState
} from '../components/design-system';

export default function MyStatus() {
  const navigate = useNavigate();

  const [farmerId, setFarmerId] = useState(localStorage.getItem('kisan_farmer_id') || '');
  const [farmerName, setFarmerName] = useState(localStorage.getItem('kisan_farmer_name') || '');
  const [bookings, setBookings] = useState([]);
  const [grievances, setGrievances] = useState([]);
  const [fairness, setFairness] = useState(null);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState({});

  // Operational details modal ("Why am I seeing this?")
  const [detailsModalBooking, setDetailsModalBooking] = useState(null);

  // Status message
  const [actionMsg, setActionMsg] = useState('');
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    if (farmerId && farmerId.trim()) {
      fetchStatus(farmerId);
    }
  }, []);

  const fetchStatus = async (fId = farmerId) => {
    const idToUse = (fId || '').trim();
    if (!idToUse) return;

    try {
      setLoading(true);
      setActionError('');

      // Fetch Bookings
      const bookingRes = await API.get(`/bookings/${encodeURIComponent(idToUse)}`);
      setBookings(Array.isArray(bookingRes.data) ? bookingRes.data : []);

      // Fetch Fairness summary
      try {
        const fairnessRes = await API.get(`/farmers/${encodeURIComponent(idToUse)}/fairness`);
        setFairness(fairnessRes.data);
      } catch (fErr) {
        setFairness(null);
      }

      // Fetch Grievances
      try {
        const grievanceRes = await API.get(`/grievances/${encodeURIComponent(idToUse)}`);
        setGrievances(Array.isArray(grievanceRes.data) ? grievanceRes.data : []);
      } catch (gErr) {
        setGrievances([]);
      }
    } catch (err) {
      console.error('Error fetching status:', err);
      setActionError(err.response?.data?.message || 'Unable to load booking records for this farmer.');
    } finally {
      setLoading(false);
    }
  };

  const handleLookupSubmit = (e) => {
    e.preventDefault();
    if (farmerId.trim()) {
      localStorage.setItem('kisan_farmer_id', farmerId.trim());
      fetchStatus(farmerId.trim());
    }
  };

  const handleOnMyWay = async (bookingId) => {
    try {
      setActionMsg('');
      setActionError('');
      const res = await API.post(`/bookings/${bookingId}/on-my-way`);
      setActionMsg(res.data.message || 'Transit confirmed: Centre staff have been notified that you are on your way.');
      await fetchStatus();
    } catch (err) {
      console.error('On-my-way error:', err);
      setActionError(err.response?.data?.message || 'Failed to update transit status.');
    }
  };

  const handleAcknowledgePacing = async (bookingId, fId) => {
    try {
      setActionMsg('');
      setActionError('');
      const res = await API.post(`/bookings/${bookingId}/acknowledge-pacing`, {
        farmer_id: fId
      });
      setActionMsg(res.data.message || 'Centre pacing advisory acknowledged.');
      await fetchStatus();
    } catch (err) {
      console.error('Pacing ack error:', err);
      setActionError(err.response?.data?.message || 'Failed to acknowledge pacing advisory.');
    }
  };

  const confirmResolution = async (grievanceId, confirmation) => {
    try {
      setActionMsg('');
      setActionError('');
      await API.patch(`/grievances/${grievanceId}/confirm`, {
        confirmation,
        feedback: feedback[grievanceId] || ''
      });

      if (confirmation === 'YES') {
        setActionMsg('Thank you. The grievance has been verified as resolved.');
      } else {
        setActionMsg('The grievance has been reopened for district review.');
      }
      await fetchStatus();
    } catch (err) {
      console.error('Confirmation error:', err);
      setActionError(err.response?.data?.message || 'Unable to submit your response.');
    }
  };

  // Find the primary active booking (next activity for farmer)
  const activeStatuses = ['Confirmed', 'Booked', 'On The Way', 'Checked-In', 'Grading', 'Weighing', 'Payment Pending'];
  const nextBooking = bookings.find(b => activeStatuses.includes(b.status)) || bookings[0];

  // Resolve current procurement timeline stage from booking status
  const getTimelineStage = (status) => {
    switch (status) {
      case 'Booked':
      case 'Confirmed':
        return 'booking';
      case 'On The Way':
      case 'Checked-In':
        return 'arrival';
      case 'Grading':
        return 'quality';
      case 'Weighing':
        return 'weighment';
      case 'Procured':
        return 'acceptance';
      case 'Payment Pending':
        return 'receipt';
      case 'Payment Completed':
        return 'payment';
      default:
        return 'booking';
    }
  };

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto' }}>
      {/* Top Banner if farmer not set */}
      {!farmerId && (
        <Card style={{ marginBottom: 20, padding: 20, border: '2px dashed var(--kq-green-600)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14 }}>
            <div>
              <h3 className="kq-title-card" style={{ fontSize: 16 }}>Lookup Your Bookings</h3>
              <p className="kq-text-muted" style={{ margin: '2px 0 0 0', fontSize: 13 }}>
                Enter your Farmer ID (e.g. F0001, F399715) to view your active appointment and pass.
              </p>
            </div>
            <form onSubmit={handleLookupSubmit} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input
                type="text"
                className="kq-input"
                value={farmerId}
                onChange={e => setFarmerId(e.target.value)}
                placeholder="Farmer ID (e.g. F0001)"
                style={{ width: 180, height: 36 }}
                required
              />
              <PrimaryButton type="submit" loading={loading}>
                View Status
              </PrimaryButton>
            </form>
          </div>
        </Card>
      )}

      {/* Action alerts */}
      {actionMsg && (
        <AlertBanner
          type="positive"
          message={actionMsg}
          onDismiss={() => setActionMsg('')}
          style={{ marginBottom: 18 }}
        />
      )}
      {actionError && (
        <AlertBanner
          type="danger"
          message={actionError}
          onDismiss={() => setActionError('')}
          style={{ marginBottom: 18 }}
        />
      )}

      {loading ? (
        <LoadingState message="Retrieving your booking status & centre updates..." minHeight={240} />
      ) : bookings.length === 0 && farmerId ? (
        <EmptyState
          icon="calendar"
          title="No Active Bookings Found"
          description={`No slot appointments are currently registered for Farmer ID: ${farmerId}. You can book your harvest slot now.`}
          action={
            <div style={{ display: 'flex', gap: 10 }}>
              <PrimaryButton onClick={() => navigate('/farmer/book')} icon="calendar">
                Book a Slot Now
              </PrimaryButton>
              <SecondaryButton onClick={() => navigate('/farmer')}>
                Switch Farmer
              </SecondaryButton>
            </div>
          }
        />
      ) : nextBooking ? (
        <>
          {/* ================================================================= */}
          {/* PRIMARY HERO CARD: "WHAT DO I NEED TO DO NEXT?"                  */}
          {/* ================================================================= */}
          <Card
            style={{
              padding: 24,
              border: '2px solid var(--kq-green-700)',
              boxShadow: 'var(--kq-shadow-sm)',
              marginBottom: 24,
              backgroundColor: '#ffffff'
            }}
          >
            {/* Header: Next Activity */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 12,
              borderBottom: '1px solid var(--kq-border-subtle)',
              paddingBottom: 14,
              marginBottom: 16
            }}>
              <div>
                <span style={{
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: 0.5,
                  textTransform: 'uppercase',
                  color: 'var(--kq-green-700)'
                }}>
                  Next Appointment / அடுத்த நிகழ்வு
                </span>
                <h2 className="kq-title-section" style={{ fontSize: 22, margin: '2px 0 0 0' }}>
                  {nextBooking.status === 'Payment Completed'
                    ? 'Procurement Completed & Paid'
                    : nextBooking.status === 'On The Way'
                    ? 'En Route to Procurement Centre'
                    : nextBooking.status === 'Checked-In'
                    ? 'Checked In at Centre — Awaiting Grading'
                    : 'Scheduled Harvest Delivery'}
                </h2>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <StatusBadge status={nextBooking.status} size="normal" />
                <span style={{
                  fontSize: 13,
                  fontWeight: 700,
                  backgroundColor: 'var(--kq-bg-subtle)',
                  padding: '4px 10px',
                  borderRadius: 'var(--kq-radius-xs)',
                  border: '1px solid var(--kq-border-subtle)'
                }}>
                  Token: <strong>{nextBooking.token || `#${nextBooking.booking_id.slice(-4)}`}</strong>
                </span>
              </div>
            </div>

            {/* Core Appointment Details Grid */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 16,
              marginBottom: 20
            }}>
              <div style={{ padding: '12px', backgroundColor: 'var(--kq-bg-subtle)', borderRadius: 'var(--kq-radius-sm)' }}>
                <span className="kq-text-muted" style={{ fontSize: 12, display: 'block', marginBottom: 2 }}>
                  Procurement Centre
                </span>
                <strong style={{ fontSize: 15, color: 'var(--kq-text-primary)' }}>
                  {nextBooking.centre_name || nextBooking.centre_id}
                </strong>
                <span className="kq-text-muted" style={{ fontSize: 12, display: 'block', marginTop: 2 }}>
                  {nextBooking.district || 'Tamil Nadu'}
                </span>
              </div>

              <div style={{ padding: '12px', backgroundColor: 'var(--kq-bg-subtle)', borderRadius: 'var(--kq-radius-sm)' }}>
                <span className="kq-text-muted" style={{ fontSize: 12, display: 'block', marginBottom: 2 }}>
                  Scheduled Date
                </span>
                <strong style={{ fontSize: 15, color: 'var(--kq-text-primary)' }}>
                  {formatHumanDate(nextBooking.booking_date)}
                </strong>
                <span className="kq-text-muted" style={{ fontSize: 12, display: 'block', marginTop: 2 }}>
                  Slot: {formatHumanTime(nextBooking.slot_time || `${nextBooking.start_time || '08:00'}–${nextBooking.end_time || '09:00'}`)}
                </span>
              </div>

              <div style={{ padding: '12px', backgroundColor: 'var(--kq-bg-subtle)', borderRadius: 'var(--kq-radius-sm)' }}>
                <span className="kq-text-muted" style={{ fontSize: 12, display: 'block', marginBottom: 2 }}>
                  Crop & Quantity
                </span>
                <strong style={{ fontSize: 15, color: 'var(--kq-text-primary)' }}>
                  {nextBooking.crop || 'Paddy (Common)'}
                </strong>
                <span className="kq-text-muted" style={{ fontSize: 12, display: 'block', marginTop: 2 }}>
                  {nextBooking.quantity_quintals || nextBooking.quantity} Quintals
                </span>
              </div>

              <div style={{ padding: '12px', backgroundColor: 'var(--kq-bg-subtle)', borderRadius: 'var(--kq-radius-sm)' }}>
                <span className="kq-text-muted" style={{ fontSize: 12, display: 'block', marginBottom: 2 }}>
                  Queue Position
                </span>
                <strong style={{ fontSize: 18, color: 'var(--kq-green-800)' }}>
                  #{nextBooking.queue_position || nextBooking.queue_position_at_booking || '1'}
                </strong>
                <span className="kq-text-muted" style={{ fontSize: 12, display: 'block', marginTop: 2 }}>
                  Est. Wait: ~{nextBooking.estimated_wait_minutes || 10} mins
                </span>
              </div>
            </div>

            {/* ============================================================= */}
            {/* PLAIN LANGUAGE CENTRE UPDATE (PACING)                         */}
            {/* ============================================================= */}
            {(nextBooking.pacing_status === 'SLOW' || nextBooking.pacing_status === 'PAUSED' || nextBooking.recommended_delay_minutes > 0) ? (
              <div style={{
                padding: '12px 16px',
                backgroundColor: 'var(--kq-warning-bg)',
                border: '1px solid var(--kq-warning-border)',
                borderRadius: 'var(--kq-radius-md)',
                marginBottom: 20,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 12
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Icon name="clock" size={20} color="var(--kq-warning-text)" />
                  <div>
                    <strong style={{ color: 'var(--kq-warning-text)', fontSize: 14 }}>
                      Centre update: Processing is slower than usual today.
                    </strong>
                    <div style={{ fontSize: 13, color: 'var(--kq-text-secondary)', marginTop: 2 }}>
                      Recommended arrival: <strong>{nextBooking.recommended_arrival_time || '10:30 AM'}</strong> (+{nextBooking.recommended_delay_minutes || 15} mins buffer to prevent gate waiting).
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => setDetailsModalBooking(nextBooking)}
                    className="kq-btn kq-btn-secondary"
                    style={{ height: 30, padding: '2px 10px', fontSize: 12 }}
                  >
                    Why am I seeing this?
                  </button>

                  {!nextBooking.pacing_acknowledged_at && (
                    <button
                      type="button"
                      onClick={() => handleAcknowledgePacing(nextBooking.booking_id, farmerId)}
                      className="kq-btn kq-btn-primary"
                      style={{ height: 30, padding: '2px 12px', fontSize: 12 }}
                    >
                      Acknowledge Delay
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div style={{
                padding: '10px 14px',
                backgroundColor: 'var(--kq-positive-bg)',
                border: '1px solid var(--kq-positive-border)',
                borderRadius: 'var(--kq-radius-sm)',
                marginBottom: 20,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 13,
                color: 'var(--kq-positive-text)'
              }}>
                <Icon name="check-circle" size={16} />
                <span>Centre is operating normally. Please arrive during your scheduled time window.</span>
              </div>
            )}

            {/* ============================================================= */}
            {/* FAIRNESS & DISRUPTION RECOVERY (PLAIN LANGUAGE)               */}
            {/* ============================================================= */}
            {(fairness?.is_disrupted || (nextBooking.disruption_count && nextBooking.disruption_count > 0)) && (
              <div style={{
                padding: '10px 14px',
                backgroundColor: 'var(--kq-green-50)',
                border: '1px solid var(--kq-green-200)',
                borderRadius: 'var(--kq-radius-sm)',
                marginBottom: 20,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 13
              }}>
                <Icon name="shield" size={18} color="var(--kq-green-700)" />
                <span style={{ color: 'var(--kq-green-900)' }}>
                  <strong>Queue Protection Active:</strong> You have been prioritized for faster check-in due to an earlier system-directed rescheduling.
                </span>
              </div>
            )}

            {/* ============================================================= */}
            {/* PROCUREMENT TIMELINE FOR THIS BOOKING                         */}
            {/* ============================================================= */}
            <div style={{
              borderTop: '1px solid var(--kq-border-subtle)',
              paddingTop: 16,
              marginBottom: 16
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--kq-text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>
                Procurement Progress Pipeline
              </div>
              <Timeline
                currentStep={getTimelineStage(nextBooking.status)}
                stepDetails={{
                  [getTimelineStage(nextBooking.status)]: nextBooking.status
                }}
              />
            </div>

            {/* Primary Action Buttons */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 10,
              paddingTop: 14,
              borderTop: '1px solid var(--kq-border-subtle)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {(nextBooking.status === 'Confirmed' || nextBooking.status === 'Booked') && (
                  <PrimaryButton
                    onClick={() => handleOnMyWay(nextBooking.booking_id)}
                    icon="truck"
                  >
                    I'm On My Way
                  </PrimaryButton>
                )}

                <Link
                  to={`/pass/${nextBooking.booking_id}`}
                  className="kq-btn kq-btn-secondary"
                  style={{ textDecoration: 'none' }}
                >
                  <Icon name="file-text" size={15} />
                  <span>Digital Pass (QR)</span>
                </Link>

                <Link
                  to={`/procurement-record/${nextBooking.booking_id}`}
                  className="kq-btn kq-btn-secondary"
                  style={{ textDecoration: 'none' }}
                >
                  <Icon name="clipboard-check" size={15} />
                  <span>Procurement Certificate</span>
                </Link>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <Link
                  to="/farmer/grievance"
                  className="kq-btn kq-btn-secondary"
                  style={{ textDecoration: 'none', color: 'var(--kq-text-muted)' }}
                >
                  <Icon name="message-square" size={14} />
                  <span>Raise Dispute</span>
                </Link>
              </div>
            </div>
          </Card>

          {/* ================================================================= */}
          {/* ALL BOOKINGS & HISTORY TABLE                                      */}
          {/* ================================================================= */}
          <Card
            title="All Scheduled Bookings & History"
            subtitle="Complete record of all appointments made under this Farmer ID"
            style={{ marginBottom: 24 }}
          >
            <DataTable
              columns={[
                { key: 'token', header: 'Token', render: (val, row) => <strong>{val || row.booking_id.slice(-5)}</strong> },
                { key: 'centre_name', header: 'Procurement Centre', render: (val, row) => val || row.centre_id },
                { key: 'booking_date', header: 'Date', render: val => formatHumanDate(val) },
                { key: 'crop', header: 'Crop', render: (val, row) => `${val || 'Paddy'} (${row.quantity_quintals || row.quantity} Qtl)` },
                { key: 'status', header: 'Status', render: val => <StatusBadge status={val} size="small" /> },
                {
                  key: 'actions',
                  header: 'Action',
                  align: 'right',
                  render: (_, row) => (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                      <Link
                        to={`/pass/${row.booking_id}`}
                        className="kq-btn kq-btn-secondary"
                        style={{ height: 26, padding: '2px 8px', fontSize: 11, textDecoration: 'none' }}
                      >
                        Pass
                      </Link>
                      <Link
                        to={`/procurement-record/${row.booking_id}`}
                        className="kq-btn kq-btn-secondary"
                        style={{ height: 26, padding: '2px 8px', fontSize: 11, textDecoration: 'none' }}
                      >
                        Record
                      </Link>
                    </div>
                  )
                }
              ]}
              data={bookings}
              keyField="booking_id"
            />
          </Card>

          {/* ================================================================= */}
          {/* ACTIVE GRIEVANCES & CONFIRMATION                                 */}
          {/* ================================================================= */}
          {grievances.length > 0 && (
            <Card
              title="Disputes & Grievance Resolutions"
              subtitle="Track ticket status and verify officer resolution satisfaction"
              style={{ marginBottom: 24 }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {grievances.map(g => (
                  <div
                    key={g.grievance_id}
                    style={{
                      padding: 16,
                      backgroundColor: 'var(--kq-bg-subtle)',
                      borderRadius: 'var(--kq-radius-md)',
                      border: '1px solid var(--kq-border-subtle)'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                      <div>
                        <strong>Ticket #{g.grievance_id}</strong> • <span className="kq-text-muted">{g.issue_type}</span>
                        <div style={{ fontSize: 13, color: 'var(--kq-text-secondary)', marginTop: 4 }}>
                          {g.description}
                        </div>
                      </div>
                      <StatusBadge status={g.status} size="small" />
                    </div>

                    {g.resolution_notes && (
                      <div style={{
                        padding: '10px 12px',
                        backgroundColor: '#ffffff',
                        borderLeft: '3px solid var(--kq-green-700)',
                        borderRadius: 'var(--kq-radius-xs)',
                        fontSize: 13,
                        margin: '10px 0'
                      }}>
                        <strong>Officer Resolution:</strong> {g.resolution_notes}
                      </div>
                    )}

                    {/* Farmer verification confirmation buttons */}
                    {(g.status === 'AWAITING_FARMER_CONFIRMATION' || (g.status === 'RESOLVED' && !g.farmer_confirmation)) && (
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: 10,
                        paddingTop: 10,
                        borderTop: '1px solid var(--kq-border-subtle)',
                        marginTop: 10
                      }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--kq-green-900)' }}>
                          Did this resolve your dispute satisfactorily?
                        </span>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <PrimaryButton
                            onClick={() => confirmResolution(g.grievance_id, 'YES')}
                            style={{ height: 28, padding: '2px 12px', fontSize: 12 }}
                          >
                            Yes, Verified Resolved
                          </PrimaryButton>
                          <SecondaryButton
                            onClick={() => confirmResolution(g.grievance_id, 'NO')}
                            style={{ height: 28, padding: '2px 12px', fontSize: 12, color: 'var(--kq-danger-text)' }}
                          >
                            No, Re-open
                          </SecondaryButton>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      ) : null}

      {/* "Why Am I Seeing This?" Operational Explanation Modal */}
      <Modal
        isOpen={!!detailsModalBooking}
        onClose={() => setDetailsModalBooking(null)}
        title="Centre Queue Pacing Advisory"
        subtitle="Operational transparency details"
        footer={
          <PrimaryButton onClick={() => setDetailsModalBooking(null)}>
            Understood
          </PrimaryButton>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p className="kq-text-body" style={{ margin: 0 }}>
            To prevent trucks and tractor-trolleys from waiting in long queues in extreme weather,
            Kisan Vikas continuously monitors unloading speed at each Direct Procurement Centre.
          </p>

          <div style={{
            padding: '12px 14px',
            backgroundColor: 'var(--kq-bg-subtle)',
            borderRadius: 'var(--kq-radius-sm)',
            fontSize: 13
          }}>
            <div><strong>Centre:</strong> {detailsModalBooking?.centre_name || detailsModalBooking?.centre_id}</div>
            <div><strong>Current Advisory:</strong> {detailsModalBooking?.pacing_status || 'NORMAL'}</div>
            <div><strong>Reason:</strong> {detailsModalBooking?.pacing_reason || 'Rain showers / temporary weighbridge unloading backlog'}</div>
            <div><strong>Recommended Delay:</strong> +{detailsModalBooking?.recommended_delay_minutes || 15} minutes</div>
          </div>

          <p className="kq-text-muted" style={{ margin: 0, fontSize: 12.5 }}>
            Your guaranteed slot and token order will remain fully protected even if you arrive at the recommended later time.
          </p>
        </div>
      </Modal>
    </div>
  );
}