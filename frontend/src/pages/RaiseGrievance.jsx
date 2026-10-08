import React, { useState, useEffect } from 'react';
import API from '../api';
import {
  Card,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
  AlertBanner,
  PageHeader,
  FormField,
  EmptyState,
  Icon,
  Modal,
  formatHumanDate
} from '../components/design-system';

export default function RaiseGrievance() {
  const urlFarmerId = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('farmer_id') : null;
  const storedFarmerId = urlFarmerId || localStorage.getItem('kisan_farmer_id') || localStorage.getItem('farmer_id') || '';
  const [farmerId, setFarmerId] = useState(storedFarmerId);
  const [bookingId, setBookingId] = useState('');
  const [centreId, setCentreId] = useState('');
  const [issueType, setIssueType] = useState('Payment Delay');
  const [description, setDescription] = useState('');

  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('info');
  const [grievances, setGrievances] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fetchingList, setFetchingList] = useState(false);

  // Resolution confirmation and reopen modal states
  const [confirmModalGrievance, setConfirmModalGrievance] = useState(null);
  const [confirmError, setConfirmError] = useState('');
  const [reopenModalGrievance, setReopenModalGrievance] = useState(null);
  const [reopenFeedback, setReopenFeedback] = useState('');
  const [reopenError, setReopenError] = useState('');
  const [actionSubmitting, setActionSubmitting] = useState(false);

  useEffect(() => {
    if (storedFarmerId) {
      // Ensure the farmer session token is active for storedFarmerId on the farmer grievance portal
      API.get(`/farmers/${encodeURIComponent(storedFarmerId)}`, { skipAuth: true })
        .then(res => {
          if (res.data?.token) {
            localStorage.setItem('kisan_token', res.data.token);
            localStorage.setItem('kisan_farmer_id', storedFarmerId);
            localStorage.setItem('kisan_role', 'FARMER');
            if (res.data.name) localStorage.setItem('kisan_farmer_name', res.data.name);
            if (res.data.district) localStorage.setItem('kisan_district', res.data.district);
          }
        })
        .catch(() => {});
      fetchGrievances(storedFarmerId);
    }
  }, []);

  const handleConfirmResolution = async () => {
    console.log('[GRIEVANCE] Confirm button clicked');
    if (!confirmModalGrievance) {
      console.log('[GRIEVANCE] No grievance selected for confirmation.');
      return;
    }
    const gId = confirmModalGrievance.grievance_id;
    const fId = confirmModalGrievance.farmer_id || farmerId;
    console.log('[GRIEVANCE] grievanceId:', gId);
    console.log('[GRIEVANCE] farmerId:', fId);
    console.log('[GRIEVANCE] currentStatus:', confirmModalGrievance.status);

    try {
      setActionSubmitting(true);
      setConfirmError('');

      // Ensure active farmer token is set for this farmer (prevent officer/admin token contamination)
      let token = localStorage.getItem('kisan_token');
      const currentRole = localStorage.getItem('kisan_role');
      const currentFarmerId = localStorage.getItem('kisan_farmer_id');
      if (!token || currentRole !== 'FARMER' || currentFarmerId !== fId) {
        try {
          const authRes = await API.get(`/farmers/${encodeURIComponent(fId)}`, { skipAuth: true });
          if (authRes.data?.token) {
            token = authRes.data.token;
            localStorage.setItem('kisan_token', token);
            localStorage.setItem('kisan_farmer_id', fId);
            localStorage.setItem('kisan_role', 'FARMER');
            if (authRes.data.name) localStorage.setItem('kisan_farmer_name', authRes.data.name);
            if (authRes.data.district) localStorage.setItem('kisan_district', authRes.data.district);
          }
        } catch (e) {
          console.error('[GRIEVANCE] Farmer token synchronization error:', e);
        }
      }

      console.log('[GRIEVANCE] calling confirmation API');
      const res = await API.patch(`/grievances/${gId}/confirm`, {
        confirmation: 'YES'
      });
      console.log('[GRIEVANCE] confirmation API response:', res.status, res.data);
      if (res.data?.success) {
        setMessageType('success');
        setMessage('Resolution confirmed successfully.');
        setConfirmModalGrievance(null);
        await fetchGrievances(fId);
        console.log('[GRIEVANCE] refreshed grievance status:\nVERIFIED_RESOLVED');
      } else {
        setConfirmError(res.data?.message || 'Resolution confirmation could not be verified.');
      }
    } catch (err) {
      console.error('[GRIEVANCE] confirmation API error:', err);
      const errMsg = err.response?.data?.message || err.message || 'Unable to confirm resolution.';
      setConfirmError(errMsg);
      setMessage(errMsg);
      setMessageType('error');
    } finally {
      setActionSubmitting(false);
    }
  };

  const handleReopenGrievance = async () => {
    console.log('[GRIEVANCE] Reopen button clicked');
    if (!reopenModalGrievance) return;
    const gId = reopenModalGrievance.grievance_id;
    const fId = reopenModalGrievance.farmer_id || farmerId;
    console.log('[GRIEVANCE] grievanceId:', gId);
    console.log('[GRIEVANCE] farmerId:', fId);
    console.log('[GRIEVANCE] currentStatus:', reopenModalGrievance.status);

    if (!reopenFeedback.trim()) {
      setReopenError('Please tell us why the issue is still unresolved before submitting.');
      return;
    }

    try {
      setActionSubmitting(true);
      setReopenError('');

      // Ensure active farmer token is set for this farmer (prevent officer/admin token contamination)
      let token = localStorage.getItem('kisan_token');
      const currentRole = localStorage.getItem('kisan_role');
      const currentFarmerId = localStorage.getItem('kisan_farmer_id');
      if (!token || currentRole !== 'FARMER' || currentFarmerId !== fId) {
        try {
          const authRes = await API.get(`/farmers/${encodeURIComponent(fId)}`, { skipAuth: true });
          if (authRes.data?.token) {
            token = authRes.data.token;
            localStorage.setItem('kisan_token', token);
            localStorage.setItem('kisan_farmer_id', fId);
            localStorage.setItem('kisan_role', 'FARMER');
            if (authRes.data.name) localStorage.setItem('kisan_farmer_name', authRes.data.name);
            if (authRes.data.district) localStorage.setItem('kisan_district', authRes.data.district);
          }
        } catch (e) {
          console.error('[GRIEVANCE] Farmer token synchronization error:', e);
        }
      }

      console.log('[GRIEVANCE] calling confirmation API');
      const res = await API.patch(`/grievances/${gId}/confirm`, {
        confirmation: 'NO',
        feedback: reopenFeedback.trim()
      });
      console.log('[GRIEVANCE] confirmation API response:', res.status, res.data);
      setMessageType('info');
      setMessage('Grievance reopened. The officer will review your response.');
      setReopenModalGrievance(null);
      setReopenFeedback('');
      await fetchGrievances(fId);
      console.log('[GRIEVANCE] refreshed grievance status:\nREOPENED');
    } catch (err) {
      console.error('[GRIEVANCE] Reopening grievance failed:', err);
      setReopenError(err.response?.data?.message || 'Unable to reopen grievance.');
    } finally {
      setActionSubmitting(false);
    }
  };

  const submitGrievance = async (e) => {
    e.preventDefault();

    try {
      setLoading(true);
      setMessage('');

      const res = await API.post('/grievances', {
        farmer_id: farmerId,
        booking_id: bookingId || null,
        centre_id: centreId,
        issue_type: issueType,
        description
      });

      setMessageType('success');
      setMessage(
        `Grievance registered successfully! Ticket ID: ${res.data.grievance_id}. Resolution SLA: ${res.data.sla_hours} hours.`
      );

      setDescription('');
      setBookingId('');

      fetchGrievances(farmerId);
    } catch (err) {
      console.error(err);
      setMessageType('error');
      setMessage(
        err.response?.data?.message || 'Unable to submit grievance. Please verify centre and farmer ID.'
      );
    } finally {
      setLoading(false);
    }
  };

  const fetchGrievances = async (idToFetch) => {
    const targetId = idToFetch || farmerId;
    if (!targetId) {
      setMessage('Please enter your Farmer ID first.');
      setMessageType('warning');
      return;
    }

    try {
      setFetchingList(true);
      const res = await API.get(`/grievances/${targetId}`);
      setGrievances(res.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setFetchingList(false);
    }
  };

  return (
    <div style={{ maxWidth: 1040, margin: '24px auto', padding: '0 16px' }}>
      
      <PageHeader
        title="Grievance Redressal & Disputes"
        subtitle="Report any concern regarding slot scheduling, crop grading, weighbridge records, or DBT payment disbursement."
        action={
          <SecondaryButton
            onClick={() => fetchGrievances(farmerId)}
            disabled={fetchingList}
            style={{ fontSize: 13, gap: 6 }}
          >
            <Icon name="refresh-cw" size={14} className={fetchingList ? 'kq-spin' : ''} />
            Refresh Tickets
          </SecondaryButton>
        }
      />

      {message && (
        <AlertBanner
          type={messageType}
          title={messageType === 'success' ? 'Submitted' : undefined}
          message={message}
          onClose={() => setMessage('')}
          style={{ marginBottom: 20 }}
        />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 24, alignItems: 'start' }}>
        
        {/* Left Column: Form Card */}
        <Card style={{ padding: 24 }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 16, color: 'var(--kq-text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="message-square" size={18} color="var(--kq-green-700)" />
            Raise a New Ticket
          </h3>

          <form onSubmit={submitGrievance}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <FormField label="Farmer ID" required>
                <input
                  className="kq-input"
                  placeholder="e.g. F0001"
                  value={farmerId}
                  onChange={e => setFarmerId(e.target.value)}
                  onBlur={() => farmerId && fetchGrievances(farmerId)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (farmerId) fetchGrievances(farmerId);
                    }
                  }}
                  required
                />
              </FormField>

              <FormField label="Centre ID" required>
                <input
                  className="kq-input"
                  placeholder="e.g. C0001 or TN_DPC_0859"
                  value={centreId}
                  onChange={e => setCentreId(e.target.value)}
                  required
                />
              </FormField>
            </div>

            <div style={{ marginTop: 14 }}>
              <FormField label="Booking ID (Optional)" hint="Link this grievance directly to an appointment">
                <input
                  className="kq-input"
                  placeholder="e.g. B00001"
                  value={bookingId}
                  onChange={e => setBookingId(e.target.value)}
                />
              </FormField>
            </div>

            <div style={{ marginTop: 14 }}>
              <FormField label="Issue Category" required>
                <select
                  className="kq-select"
                  value={issueType}
                  onChange={e => setIssueType(e.target.value)}
                >
                  <option value="Payment Delay">Payment Delay / DBT Discrepancy (48h SLA)</option>
                  <option value="Grading Dispute">Quality / Moisture Assessment Dispute (24h SLA)</option>
                  <option value="Staff Conduct">Staff Conduct / Unfair Queue Bypass (72h SLA)</option>
                  <option value="Weighment Discrepancy">Weighment / Tare Deduction Discrepancy (24h SLA)</option>
                  <option value="Other">Other Operational Concern</option>
                </select>
              </FormField>
            </div>

            <div style={{ marginTop: 14 }}>
              <FormField label="Describe Your Issue" required hint="Provide relevant details such as truck number, vehicle scale slip, or officer involved">
                <textarea
                  className="kq-textarea"
                  placeholder="Explain clearly what happened..."
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  rows="4"
                  required
                />
              </FormField>
            </div>

            <div style={{ marginTop: 20 }}>
              <PrimaryButton
                type="submit"
                disabled={loading}
                style={{ width: '100%', gap: 8 }}
              >
                <Icon name="check" size={16} color="#ffffff" />
                {loading ? 'Submitting Dispute...' : 'Submit Grievance Ticket'}
              </PrimaryButton>
            </div>
          </form>
        </Card>

        {/* Right Column: Existing Tickets */}
        <div>
          <Card style={{ padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 16, color: 'var(--kq-text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon name="clipboard-check" size={18} color="var(--kq-green-700)" />
                My Registered Grievances ({grievances.length})
              </h3>
              <span style={{ fontSize: 12, color: 'var(--kq-text-muted)' }}>
                Farmer: <strong>{farmerId}</strong>
              </span>
            </div>

            {grievances.length === 0 ? (
              <EmptyState
                icon="message-square"
                title="No grievances on record"
                description="You have no open or resolved grievance tickets under this Farmer ID."
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {grievances.map(g => (
                  <div
                    key={g.grievance_id}
                    style={{
                      border: '1px solid var(--kq-border-light)',
                      borderRadius: 'var(--kq-radius-md)',
                      padding: 14,
                      background: 'var(--kq-bg-surface)'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--kq-text-primary)' }}>
                          Ticket #{g.grievance_id} • {g.issue_type}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--kq-text-muted)', marginTop: 2 }}>
                          Centre: {g.centre_id} {g.booking_id ? `• Booking: ${g.booking_id}` : ''}
                        </div>
                      </div>
                      <StatusBadge status={g.status || g.sla_status} size="sm" />
                    </div>

                    <div style={{ fontSize: 13, color: 'var(--kq-text-secondary)', marginTop: 8, lineHeight: 1.4 }}>
                      {g.description}
                    </div>

                    {g.sla_deadline && g.sla_status !== 'Resolved' && (
                      <div style={{ marginTop: 8, fontSize: 11, color: 'var(--kq-amber-800)', background: 'var(--kq-amber-50)', padding: '4px 8px', borderRadius: 4, display: 'inline-block' }}>
                        ⏰ Resolution SLA Deadline: {formatHumanDate(g.sla_deadline)}
                      </div>
                    )}

                    {g.resolution_notes && (
                      <div
                        style={{
                          marginTop: 10,
                          padding: '10px 12px',
                          background: 'var(--kq-green-50)',
                          borderRadius: 'var(--kq-radius-sm)',
                          borderLeft: '3px solid var(--kq-green-700)',
                          fontSize: 13,
                          color: 'var(--kq-green-900)',
                          lineHeight: 1.45
                        }}
                      >
                        <strong>Officer Resolution:</strong> &quot;{g.resolution_notes}&quot;
                      </div>
                    )}

                    {/* AWAITING_FARMER_CONFIRMATION: Farmer Confirmation Action Box */}
                    {g.status === 'AWAITING_FARMER_CONFIRMATION' && (
                      <div
                        style={{
                          marginTop: 12,
                          padding: '12px 14px',
                          backgroundColor: '#ffffff',
                          borderRadius: 'var(--kq-radius-md)',
                          border: '1px solid var(--kq-amber-300, #fcd34d)',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                          <Icon name="help-circle" size={16} color="var(--kq-amber-700, #b45309)" />
                          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--kq-text-primary)' }}>
                            Has your issue been resolved?
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <PrimaryButton
                            type="button"
                            onClick={() => setConfirmModalGrievance(g)}
                            style={{ height: 32, fontSize: 12, padding: '0 12px', gap: 6 }}
                          >
                            <Icon name="check" size={14} color="#ffffff" />
                            Confirm Resolution
                          </PrimaryButton>
                          <SecondaryButton
                            type="button"
                            onClick={() => {
                              setReopenModalGrievance(g);
                              setReopenFeedback('');
                              setReopenError('');
                            }}
                            style={{
                              height: 32,
                              fontSize: 12,
                              padding: '0 12px',
                              gap: 6,
                              color: 'var(--kq-danger-text)',
                              borderColor: 'var(--kq-danger-border)'
                            }}
                          >
                            <Icon name="rotate-ccw" size={14} />
                            Not Resolved / Reopen
                          </SecondaryButton>
                        </div>
                      </div>
                    )}

                    {/* VERIFIED_RESOLVED State */}
                    {g.status === 'VERIFIED_RESOLVED' && (
                      <div
                        style={{
                          marginTop: 10,
                          padding: '8px 12px',
                          background: 'var(--kq-green-50)',
                          borderRadius: 'var(--kq-radius-sm)',
                          border: '1px solid var(--kq-green-300, #86efac)',
                          fontSize: 12,
                          color: 'var(--kq-green-900)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6
                        }}
                      >
                        <Icon name="check-circle" size={14} color="var(--kq-green-700)" />
                        <span>
                          <strong>✓ Resolution confirmed:</strong> Thank you. This grievance has been closed.
                        </span>
                      </div>
                    )}

                    {/* REOPENED State */}
                    {g.status === 'REOPENED' && (
                      <div
                        style={{
                          marginTop: 10,
                          padding: '8px 12px',
                          background: 'var(--kq-amber-50)',
                          borderRadius: 'var(--kq-radius-sm)',
                          border: '1px solid var(--kq-amber-300, #fcd34d)',
                          fontSize: 12,
                          color: 'var(--kq-amber-900)',
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: 6
                        }}
                      >
                        <Icon name="alert-triangle" size={14} color="var(--kq-amber-700)" style={{ marginTop: 2 }} />
                        <div>
                          <div>
                            <strong>Grievance reopened:</strong> Your response has been sent for further review.
                          </div>
                          {g.farmer_feedback && (
                            <div style={{ marginTop: 4, fontSize: 11, color: 'var(--kq-text-secondary)' }}>
                              Farmer Note: &quot;{g.farmer_feedback}&quot;
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Help box */}
          <div style={{
            marginTop: 16,
            padding: 14,
            background: 'var(--kq-bg-subtle)',
            borderRadius: 'var(--kq-radius-md)',
            border: '1px solid var(--kq-border-light)',
            display: 'flex',
            alignItems: 'center',
            gap: 12
          }}>
            <Icon name="phone" size={18} color="var(--kq-green-700)" />
            <div style={{ fontSize: 12, color: 'var(--kq-text-secondary)' }}>
              Need urgent assistance? Call the toll-free procurement helpline: <strong style={{ color: 'var(--kq-green-800)' }}>1800-425-4444</strong> (Mon–Sat, 8 AM–6 PM).
            </div>
          </div>
        </div>

      </div>

      {/* Confirm Resolution Modal */}
      <Modal
        isOpen={!!confirmModalGrievance}
        onClose={() => !actionSubmitting && setConfirmModalGrievance(null)}
        title="Confirm Resolution"
        subtitle={confirmModalGrievance ? `Ticket #${confirmModalGrievance.grievance_id} • ${confirmModalGrievance.issue_type}` : ''}
        footer={
          <>
            <SecondaryButton
              onClick={() => setConfirmModalGrievance(null)}
              disabled={actionSubmitting}
            >
              Cancel
            </SecondaryButton>
            <PrimaryButton
              id="confirm-resolution-final-btn"
              data-testid="confirm-resolution-final-btn"
              onClick={handleConfirmResolution}
              disabled={actionSubmitting}
              style={{ gap: 6 }}
            >
              <Icon name="check" size={14} color="#ffffff" style={{ pointerEvents: 'none' }} />
              <span style={{ pointerEvents: 'none' }}>
                {actionSubmitting ? 'Confirming...' : 'Yes, Confirm Resolution'}
              </span>
            </PrimaryButton>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p className="kq-text-body" style={{ margin: 0, fontSize: 14, color: 'var(--kq-text-primary)' }}>
            Are you satisfied that this grievance has been resolved?
          </p>

          {confirmError && (
            <AlertBanner
              type="error"
              message={confirmError}
              onClose={() => setConfirmError('')}
            />
          )}

          {confirmModalGrievance?.resolution_notes && (
            <div
              style={{
                padding: '10px 12px',
                background: 'var(--kq-bg-subtle)',
                borderRadius: 'var(--kq-radius-sm)',
                borderLeft: '3px solid var(--kq-green-700)',
                fontSize: 13,
                color: 'var(--kq-text-secondary)'
              }}
            >
              <strong style={{ color: 'var(--kq-text-primary)' }}>Officer's recorded resolution:</strong>
              <div style={{ marginTop: 4 }}>&quot;{confirmModalGrievance.resolution_notes}&quot;</div>
            </div>
          )}

          <p className="kq-text-muted" style={{ margin: 0, fontSize: 12 }}>
            Confirming will mark this ticket as verified and closed.
          </p>
        </div>
      </Modal>

      {/* Reopen Grievance Modal */}
      <Modal
        isOpen={!!reopenModalGrievance}
        onClose={() => !actionSubmitting && setReopenModalGrievance(null)}
        title="Reopen Grievance"
        subtitle={reopenModalGrievance ? `Ticket #${reopenModalGrievance.grievance_id} • ${reopenModalGrievance.issue_type}` : ''}
        footer={
          <>
            <SecondaryButton
              onClick={() => {
                setReopenModalGrievance(null);
                setReopenFeedback('');
                setReopenError('');
              }}
              disabled={actionSubmitting}
            >
              Cancel
            </SecondaryButton>
            <PrimaryButton
              id="reopen-grievance-final-btn"
              data-testid="reopen-grievance-final-btn"
              onClick={handleReopenGrievance}
              disabled={actionSubmitting || !reopenFeedback.trim()}
              style={{
                gap: 6,
                backgroundColor: 'var(--kq-danger, #dc2626)',
                borderColor: 'var(--kq-danger, #dc2626)'
              }}
            >
              <Icon name="rotate-ccw" size={14} color="#ffffff" style={{ pointerEvents: 'none' }} />
              <span style={{ pointerEvents: 'none' }}>
                {actionSubmitting ? 'Reopening...' : 'Reopen Grievance'}
              </span>
            </PrimaryButton>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p className="kq-text-body" style={{ margin: 0, fontSize: 14, color: 'var(--kq-text-primary)' }}>
            Please tell us why the issue is still unresolved.
          </p>

          {reopenError && (
            <AlertBanner
              type="error"
              message={reopenError}
              onClose={() => setReopenError('')}
            />
          )}

          <FormField
            label="Reason for Reopening"
            required
            hint="Describe what remains unaddressed so the district officer can take further action."
          >
            <textarea
              id="reopen-reason-textarea"
              data-testid="reopen-reason-textarea"
              className="kq-textarea"
              placeholder="e.g. Moisture deduction was not recalculated / Payment has still not reached my bank account..."
              value={reopenFeedback}
              onChange={e => {
                setReopenFeedback(e.target.value);
                if (reopenError) setReopenError('');
              }}
              rows="4"
              autoFocus
              required
            />
          </FormField>
        </div>
      </Modal>

    </div>
  );
}