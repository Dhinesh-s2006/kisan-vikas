import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import API from '../api';
import {
  Card,
  PrimaryButton,
  SecondaryButton,
  DangerButton,
  StatusBadge,
  AlertBanner,
  LoadingState,
  ErrorState,
  Modal,
  FormField,
  Icon,
  formatHumanDate,
  formatHumanTime
} from '../components/design-system';

export default function ProcurementRecord() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Dispute form state
  const [showDisputeModal, setShowDisputeModal] = useState(false);
  const [disputeForm, setDisputeForm] = useState({
    issue_type: 'QUALITY_DISPUTE',
    description: ''
  });
  const [disputeLoading, setDisputeLoading] = useState(false);
  const [disputeSuccess, setDisputeSuccess] = useState('');
  const [disputeError, setDisputeError] = useState('');

  useEffect(() => {
    loadRecord();
  }, [id]);

  const loadRecord = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await API.get(`/bookings/${id}/procurement-record`);
      setRecord(res.data.procurement_record);
    } catch (err) {
      console.error('Error loading procurement record:', err);
      setError(err.response?.data?.message || 'Unable to load procurement record.');
    } finally {
      setLoading(false);
    }
  };

  const handleRaiseDispute = async (e) => {
    e.preventDefault();
    if (!record) return;
    try {
      setDisputeLoading(true);
      setDisputeError('');
      setDisputeSuccess('');
      const res = await API.post('/grievances', {
        farmer_id: record.farmer.farmer_id,
        booking_id: record.booking.booking_id,
        centre_id: record.centre.centre_id,
        issue_type: disputeForm.issue_type,
        description: disputeForm.description
      });
      setDisputeSuccess(`Dispute registered successfully (Ticket #${res.data.grievance_id}). Resolution required within ${res.data.sla_hours} hours.`);
      setDisputeForm({ issue_type: 'QUALITY_DISPUTE', description: '' });
      setTimeout(() => {
        loadRecord();
      }, 1500);
    } catch (err) {
      console.error('Raise dispute error:', err);
      setDisputeError(err.response?.data?.message || 'Failed to submit dispute.');
    } finally {
      setDisputeLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={{ maxWidth: 960, margin: '40px auto', padding: '0 16px' }}>
        <LoadingState message="Loading Digital Procurement Record..." description="Fetching verified grading, weighment, receipt, and payment audit logs..." />
      </div>
    );
  }

  if (error || !record) {
    return (
      <div style={{ maxWidth: 640, margin: '40px auto', padding: '0 16px' }}>
        <ErrorState
          title="Procurement Record Unavailable"
          message={error || 'The requested procurement record could not be loaded.'}
          actionLabel="Back to My Status"
          onAction={() => navigate('/farmer/status')}
        />
      </div>
    );
  }

  const { booking, farmer, centre, quality_assessment: quality, weighment, receipt, payment, timeline, grievances, _notice } = record;

  return (
    <div style={{ maxWidth: 960, margin: '24px auto', padding: '0 16px' }}>
      
      {/* Top Navigation & Actions */}
      <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link
            to={`/pass/${booking.booking_id}`}
            style={{ textDecoration: 'none', color: 'var(--kq-green-800)', fontWeight: 600, fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            <Icon name="arrow-left" size={15} /> View Digital Pass
          </Link>
          <span style={{ color: 'var(--kq-border-medium)' }}>|</span>
          <Link
            to="/farmer/status"
            style={{ textDecoration: 'none', color: 'var(--kq-text-secondary)', fontSize: 13 }}
          >
            My Status
          </Link>
        </div>
        <SecondaryButton
          onClick={() => window.print()}
          style={{ fontSize: 13, padding: '6px 14px', gap: 6 }}
        >
          <Icon name="printer" size={15} /> Print Record
        </SecondaryButton>
      </div>

      {/* Main Header Banner */}
      <div style={{
        background: 'var(--kq-green-800)',
        color: '#ffffff',
        padding: '22px 26px',
        borderRadius: 'var(--kq-radius-lg)',
        marginBottom: 24,
        boxShadow: 'var(--kq-shadow-sm)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.9, fontWeight: 600 }}>
              KISAN VIKAS • Uzhavarsethu Platform
            </div>
            <h1 style={{ margin: '6px 0 2px', fontSize: 22, fontWeight: 700, color: '#ffffff' }}>
              🌾 Procurement Record & Audit Log
            </h1>
            <div style={{ fontSize: 13, opacity: 0.85 }}>
              Auditable Transaction Record for Produce Grading, Weighment, and Payment
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <StatusBadge status={booking.status} size="md" />
            <div style={{ fontSize: 11, opacity: 0.85, marginTop: 6, fontFamily: 'monospace' }}>
              Booking Ref: {booking.booking_id}
            </div>
          </div>
        </div>
      </div>

      {/* Quick Summary Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14, marginBottom: 24 }}>
        <Card style={{ padding: 14 }}>
          <div style={cardHeaderStyle}>FARMER DETAILS</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--kq-text-primary)' }}>{farmer.name}</div>
          <div style={{ fontSize: 12, color: 'var(--kq-text-muted)', marginTop: 2 }}>ID: {farmer.farmer_id}</div>
          <div style={{ fontSize: 12, color: 'var(--kq-text-secondary)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
            <Icon name="map-pin" size={12} color="var(--kq-text-muted)" />
            {farmer.village}, {farmer.district}
          </div>
        </Card>

        <Card style={{ padding: 14 }}>
          <div style={cardHeaderStyle}>PROCUREMENT CENTRE</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--kq-text-primary)' }}>{centre.name}</div>
          <div style={{ fontSize: 12, color: 'var(--kq-text-muted)', marginTop: 2 }}>ID: {centre.centre_id}</div>
          <div style={{ fontSize: 12, color: 'var(--kq-text-secondary)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
            <Icon name="map-pin" size={12} color="var(--kq-text-muted)" />
            {centre.village}, {centre.district}
          </div>
        </Card>

        <Card style={{ padding: 14 }}>
          <div style={cardHeaderStyle}>COMMODITY & SLOT</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--kq-green-800)' }}>{booking.crop}</div>
          <div style={{ fontSize: 12, color: 'var(--kq-text-secondary)', marginTop: 2 }}>Declared: <strong>{booking.declared_quantity_quintals} quintals</strong></div>
          <div style={{ fontSize: 12, color: 'var(--kq-text-muted)', marginTop: 2 }}>Token #{booking.queue_position} • {formatHumanTime(booking.slot_time)}</div>
        </Card>

        <Card style={{ padding: 14 }}>
          <div style={cardHeaderStyle}>PROCURED STATUS</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--kq-green-800)' }}>
            {booking.procured_quantity_quintals ? `${booking.procured_quantity_quintals} q` : 'Pending Acceptance'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--kq-text-muted)', marginTop: 2 }}>
            Receipt: {receipt ? receipt.receipt_number : 'Not Issued'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--kq-text-muted)', marginTop: 2 }}>
            Payment: {payment?.payment_status || 'NOT_READY'}
          </div>
        </Card>
      </div>

      {/* End-to-End Procurement Timeline */}
      <Card style={{ padding: '20px 24px', marginBottom: 24 }}>
        <h3 style={{ margin: '0 0 16px', fontSize: 16, color: 'var(--kq-text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="clock" size={18} color="var(--kq-green-700)" />
          Procurement Lifecycle Timeline
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {timeline.map((step) => {
            const isCompleted = step.status === 'COMPLETED';
            const isInProgress = step.status === 'IN_PROGRESS';
            return (
              <div key={step.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                <div style={{
                  width: 26,
                  height: 26,
                  borderRadius: '50%',
                  background: isCompleted ? 'var(--kq-green-100)' : isInProgress ? 'var(--kq-amber-50)' : 'var(--kq-bg-subtle)',
                  color: isCompleted ? 'var(--kq-green-800)' : isInProgress ? 'var(--kq-amber-800)' : 'var(--kq-text-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  fontWeight: 700,
                  flexShrink: 0,
                  border: `2px solid ${isCompleted ? 'var(--kq-green-600)' : isInProgress ? 'var(--kq-amber-400)' : 'var(--kq-border-medium)'}`
                }}>
                  {isCompleted ? '✓' : step.stage}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: isCompleted || isInProgress ? 700 : 500, color: isCompleted ? 'var(--kq-text-primary)' : isInProgress ? 'var(--kq-amber-900)' : 'var(--kq-text-muted)' }}>
                      {step.label}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--kq-text-muted)' }}>
                      {step.timestamp ? formatHumanDate(step.timestamp) + ' ' + formatHumanTime(step.timestamp) : '—'}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--kq-text-secondary)', marginTop: 2 }}>{step.details}</div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Operational Inspection & Transaction Details (2 Columns) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20, marginBottom: 24 }}>
        
        {/* Quality Assessment Card */}
        <Card style={{ padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3 style={{ margin: 0, fontSize: 15, color: 'var(--kq-text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="clipboard-check" size={17} color="var(--kq-green-700)" />
              Quality Assessment Record
            </h3>
            <span style={{
              fontSize: 11,
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: 12,
              background: quality ? 'var(--kq-green-100)' : 'var(--kq-bg-subtle)',
              color: quality ? 'var(--kq-green-800)' : 'var(--kq-text-muted)'
            }}>
              {quality?.quality_status || 'PENDING'}
            </span>
          </div>

          {quality ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--kq-border-light)', paddingBottom: 6 }}>
                <span style={{ color: 'var(--kq-text-muted)', fontSize: 13 }}>Assigned Grade:</span>
                <span style={{ fontWeight: 700, color: 'var(--kq-green-800)', fontSize: 14 }}>{quality.grade}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--kq-border-light)', paddingBottom: 6 }}>
                <span style={{ color: 'var(--kq-text-muted)', fontSize: 13 }}>Moisture Content:</span>
                <span style={{ fontWeight: 600, color: quality.moisture_percentage > 17 ? 'var(--kq-amber-700)' : 'var(--kq-text-primary)', fontSize: 13 }}>
                  {quality.moisture_percentage !== null ? `${quality.moisture_percentage}%` : 'Not recorded'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--kq-border-light)', paddingBottom: 6 }}>
                <span style={{ color: 'var(--kq-text-muted)', fontSize: 13 }}>Foreign Matter:</span>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{quality.foreign_matter_percentage !== null ? `${quality.foreign_matter_percentage}%` : 'Not recorded'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--kq-border-light)', paddingBottom: 6 }}>
                <span style={{ color: 'var(--kq-text-muted)', fontSize: 13 }}>Damaged Grain:</span>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{quality.damaged_grain_percentage !== null ? `${quality.damaged_grain_percentage}%` : 'Not recorded'}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--kq-text-secondary)', marginTop: 4 }}>
                <strong>Remarks:</strong> {quality.remarks || 'Standard visual & moisture inspection completed.'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--kq-text-muted)', marginTop: 4 }}>
                Assessed by {quality.assessed_by} on {formatHumanDate(quality.assessed_at)}
              </div>
            </div>
          ) : (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--kq-text-muted)', fontSize: 13 }}>
              Produce has not yet been inspected at the grading counter.
            </div>
          )}
        </Card>

        {/* Weighment Card */}
        <Card style={{ padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3 style={{ margin: 0, fontSize: 15, color: 'var(--kq-text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="scale" size={17} color="var(--kq-green-700)" />
              Gross & Tare Weighment Record
            </h3>
            <span style={{
              fontSize: 11,
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: 12,
              background: weighment ? '#eff6ff' : 'var(--kq-bg-subtle)',
              color: weighment ? '#1e40af' : 'var(--kq-text-muted)'
            }}>
              {weighment ? 'WEIGHED' : 'PENDING'}
            </span>
          </div>

          {weighment ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--kq-border-light)', paddingBottom: 6 }}>
                <span style={{ color: 'var(--kq-text-muted)', fontSize: 13 }}>Gross Weight:</span>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{weighment.gross_weight_kg} kg</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--kq-border-light)', paddingBottom: 6 }}>
                <span style={{ color: 'var(--kq-text-muted)', fontSize: 13 }}>Tare Weight (Vehicle/Bags):</span>
                <span style={{ fontWeight: 600, color: 'var(--kq-text-muted)', fontSize: 14 }}>- {weighment.tare_weight_kg} kg</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', background: 'var(--kq-green-50)', padding: '8px 12px', borderRadius: 'var(--kq-radius-sm)' }}>
                <span style={{ color: 'var(--kq-green-800)', fontWeight: 700, fontSize: 13 }}>Net Weight:</span>
                <span style={{ fontWeight: 800, color: 'var(--kq-green-800)', fontSize: 15 }}>
                  {weighment.net_weight_kg} kg (~{(weighment.net_weight_kg / 100).toFixed(2)} quintals)
                </span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--kq-green-800)', fontStyle: 'italic', marginTop: 2 }}>
                ✓ Certified: Net Weight = Gross ({weighment.gross_weight_kg} kg) - Tare ({weighment.tare_weight_kg} kg)
              </div>
              <div style={{ fontSize: 12, color: 'var(--kq-text-secondary)', marginTop: 4 }}>
                <strong>Method:</strong> {weighment.weighing_method} (Ref: {weighment.weighment_reference})
              </div>
              <div style={{ fontSize: 11, color: 'var(--kq-text-muted)', marginTop: 4 }}>
                Recorded by {weighment.recorded_by} on {formatHumanDate(weighment.recorded_at)}
              </div>
            </div>
          ) : (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--kq-text-muted)', fontSize: 13 }}>
              Weighment will be recorded upon vehicle gross weighment and tare deduction.
            </div>
          )}
        </Card>

      </div>

      {/* Acceptance, Receipt & Payment Cards (2 Columns) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20, marginBottom: 24 }}>
        
        {/* Digital Procurement Receipt */}
        <Card style={{ background: '#fffbeb', border: '1.5px dashed #d97706', padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="file-text" size={18} color="#b45309" />
              <h3 style={{ margin: 0, fontSize: 15, color: '#92400e' }}>
                Digital Procurement Receipt
              </h3>
            </div>
            {receipt && (
              <span style={{ fontSize: 11, fontWeight: 700, background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: 10 }}>
                {receipt.receipt_status}
              </span>
            )}
          </div>

          {receipt ? (
            <div>
              <div style={{ background: '#ffffff', padding: '10px 14px', borderRadius: 'var(--kq-radius-md)', border: '1px solid #fde68a', marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: '#92400e', fontWeight: 600 }}>RECEIPT IDENTIFIER</div>
                <div style={{ fontSize: 17, fontWeight: 800, color: '#78350f', letterSpacing: '0.05em', fontFamily: 'monospace' }}>{receipt.receipt_number}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#92400e' }}>Accepted Produce:</span>
                  <span style={{ fontWeight: 700 }}>{receipt.accepted_quantity_quintals} quintals ({receipt.net_weight_kg} kg)</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#92400e' }}>Assigned Grade:</span>
                  <span style={{ fontWeight: 600 }}>{receipt.grade || 'Standard'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#92400e' }}>Procurement Date:</span>
                  <span style={{ fontWeight: 600 }}>{formatHumanDate(receipt.procurement_date)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#92400e' }}>Certified Officer:</span>
                  <span style={{ fontWeight: 600 }}>{receipt.recorded_by}</span>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ padding: 24, textAlign: 'center', color: '#b45309', fontSize: 13 }}>
              Receipt voucher is automatically issued upon official procurement acceptance.
            </div>
          )}
        </Card>

        {/* Payment Tracking Card */}
        <Card style={{ padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3 style={{ margin: 0, fontSize: 15, color: 'var(--kq-text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="credit-card" size={17} color="var(--kq-green-700)" />
              Payment Status Tracking
            </h3>
            <span style={{
              fontSize: 11,
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: 12,
              background: payment?.payment_status === 'COMPLETED' ? 'var(--kq-green-100)' : payment?.payment_status === 'PROCESSING' ? 'var(--kq-amber-50)' : 'var(--kq-bg-subtle)',
              color: payment?.payment_status === 'COMPLETED' ? 'var(--kq-green-800)' : payment?.payment_status === 'PROCESSING' ? 'var(--kq-amber-800)' : 'var(--kq-text-muted)'
            }}>
              {payment?.payment_status || 'NOT_READY'}
            </span>
          </div>

          {payment ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--kq-border-light)', paddingBottom: 6 }}>
                <span style={{ color: 'var(--kq-text-muted)', fontSize: 13 }}>Payable Quantity:</span>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{payment.payable_quantity_quintals} quintals</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--kq-border-light)', paddingBottom: 6 }}>
                <span style={{ color: 'var(--kq-text-muted)', fontSize: 13 }}>Applicable Rate:</span>
                <span style={{ fontWeight: 600, fontSize: 13 }}>₹{payment.applicable_rate_inr} / quintal ({payment.rate_source})</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', background: 'var(--kq-bg-subtle)', padding: '8px 12px', borderRadius: 'var(--kq-radius-sm)' }}>
                <span style={{ color: 'var(--kq-text-primary)', fontWeight: 700, fontSize: 13 }}>Net Payable Amount:</span>
                <span style={{ fontWeight: 800, color: 'var(--kq-green-800)', fontSize: 16 }}>₹{parseFloat(payment.net_payable_inr).toLocaleString('en-IN')}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--kq-text-muted)' }}>
                <span>Transfer Mode:</span>
                <span>{payment.payment_method}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--kq-text-muted)' }}>
                <span>Ref Number:</span>
                <span style={{ fontFamily: 'monospace' }}>{payment.transaction_reference || 'Pending'}</span>
              </div>
              {payment.failure_reason && (
                <div style={{ background: 'var(--kq-red-50)', color: 'var(--kq-red-800)', padding: '6px 10px', borderRadius: 'var(--kq-radius-sm)', fontSize: 12 }}>
                  Failure Reason: {payment.failure_reason}
                </div>
              )}
              <div style={{ fontSize: 11, color: 'var(--kq-text-muted)', fontStyle: 'italic', marginTop: 4 }}>
                ℹ️ Direct Benefit Transfer (DBT) dispatch record.
              </div>
            </div>
          ) : (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--kq-text-muted)', fontSize: 13 }}>
              Payment calculation activates upon produce acceptance.
            </div>
          )}
        </Card>

      </div>

      {/* Dispute / Grievance Action Banner */}
      <div style={{
        background: 'var(--kq-red-50)',
        border: '1px solid var(--kq-red-200)',
        borderRadius: 'var(--kq-radius-md)',
        padding: 16,
        marginBottom: 24,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 12
      }}>
        <div>
          <div style={{ fontWeight: 700, color: 'var(--kq-red-900)', fontSize: 14 }}>
            Dispute Quality, Weighment or Payment Decision?
          </div>
          <div style={{ fontSize: 12, color: 'var(--kq-red-800)', marginTop: 2 }}>
            You have the right to register a formal dispute under the transparent grievance mechanism with defined SLA resolution.
          </div>
        </div>
        <DangerButton
          onClick={() => setShowDisputeModal(true)}
          style={{ fontSize: 13, padding: '7px 14px' }}
        >
          Raise Dispute / Issue →
        </DangerButton>
      </div>

      {/* Existing Linked Grievances */}
      {grievances && grievances.length > 0 && (
        <Card style={{ padding: 20, marginBottom: 24 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, color: 'var(--kq-text-primary)' }}>
            Registered Disputes for this Booking ({grievances.length})
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {grievances.map((g) => (
              <div key={g.grievance_id} style={{ padding: 12, background: 'var(--kq-bg-subtle)', border: '1px solid var(--kq-border-light)', borderRadius: 'var(--kq-radius-md)', fontSize: 13 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 700, color: 'var(--kq-text-primary)' }}>Ticket #{g.grievance_id} • {g.issue_type}</span>
                  <StatusBadge status={g.status} size="sm" />
                </div>
                <div style={{ color: 'var(--kq-text-secondary)', marginTop: 4 }}>{g.description}</div>
                {g.resolution_notes && (
                  <div style={{ marginTop: 4, color: 'var(--kq-green-800)', fontSize: 12 }}>
                    <strong>Resolution:</strong> {g.resolution_notes}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Dispute Modal */}
      <Modal
        isOpen={showDisputeModal}
        onClose={() => setShowDisputeModal(false)}
        title="Raise Procurement Dispute"
      >
        {disputeSuccess ? (
          <AlertBanner
            type="success"
            title="Dispute Submitted"
            message={disputeSuccess}
          />
        ) : (
          <form onSubmit={handleRaiseDispute}>
            {disputeError && (
              <AlertBanner
                type="error"
                message={disputeError}
                style={{ marginBottom: 14 }}
              />
            )}

            <FormField label="Dispute Category" required>
              <select
                className="kq-select"
                value={disputeForm.issue_type}
                onChange={(e) => setDisputeForm({ ...disputeForm, issue_type: e.target.value })}
              >
                <option value="QUALITY_DISPUTE">Quality / Moisture Assessment Dispute (24h SLA)</option>
                <option value="WEIGHT_DISPUTE">Weighment / Tare Deduction Dispute (24h SLA)</option>
                <option value="PROCUREMENT_DISPUTE">Procurement Acceptance / Quantity Dispute (48h SLA)</option>
                <option value="PAYMENT_DISPUTE">Payment Delay / Rate Calculation Dispute (48h SLA)</option>
                <option value="Staff Conduct">Staff Conduct / Unfair Process (72h SLA)</option>
              </select>
            </FormField>

            <FormField label="Description of Issue" required style={{ marginTop: 14 }}>
              <textarea
                className="kq-textarea"
                rows={4}
                value={disputeForm.description}
                onChange={(e) => setDisputeForm({ ...disputeForm, description: e.target.value })}
                placeholder="Describe why you disagree with the recorded quality, weight or procurement decision..."
                required
              />
            </FormField>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
              <SecondaryButton
                type="button"
                onClick={() => setShowDisputeModal(false)}
              >
                Cancel
              </SecondaryButton>
              <DangerButton
                type="submit"
                disabled={disputeLoading}
              >
                {disputeLoading ? 'Submitting...' : 'Submit Official Dispute'}
              </DangerButton>
            </div>
          </form>
        )}
      </Modal>

      {/* Audit Disclaimer Footer */}
      <div style={{ fontSize: 11, color: 'var(--kq-text-muted)', textAlign: 'center', marginTop: 24, borderTop: '1px solid var(--kq-border-light)', paddingTop: 14 }}>
        🛡️ {_notice || 'Official verifiable procurement record generated by Kisan Vikas Platform.'}
      </div>

    </div>
  );
}

const cardHeaderStyle = {
  fontSize: 11,
  color: 'var(--kq-text-muted)',
  fontWeight: 700,
  letterSpacing: '0.05em',
  marginBottom: 6
};
