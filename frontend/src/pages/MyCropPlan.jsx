import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../api';
import {
  Card,
  FormField,
  FormSection,
  PrimaryButton,
  SecondaryButton,
  Drawer,
  Modal,
  StatusBadge,
  AlertBanner,
  Icon,
  EmptyState,
  LoadingState,
  formatHumanDate
} from '../components/design-system';

export default function MyCropPlan() {
  const navigate = useNavigate();

  const [farmerId, setFarmerId] = useState(localStorage.getItem('kisan_farmer_id') || '');
  const [token, setToken] = useState(localStorage.getItem('kisan_token') || '');
  const [farmerProfile, setFarmerProfile] = useState(null);

  // Data states
  const [referenceYields, setReferenceYields] = useState([]);
  const [myPlans, setMyPlans] = useState([]);
  const [loadingPlans, setLoadingPlans] = useState(false);
  const [selectedPlanDetails, setSelectedPlanDetails] = useState(null);
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [planToEdit, setPlanToEdit] = useState(null);

  // Form State: New Declaration
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    crop: 'Paddy',
    cultivated_area: '3.5',
    area_unit: 'acres',
    sowing_date: '2026-07-15',
    expected_harvest_start: '2026-11-05',
    expected_harvest_end: '2026-11-20',
    irrigation_type: 'Canal',
    crop_variety: 'ADT 45',
    expected_procurement_quantity: '',
    dont_know_quantity: true
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');

  // Form State: Edit Declaration
  const [editForm, setEditForm] = useState({
    cultivated_area: '',
    crop: '',
    sowing_date: '',
    expected_harvest_start: '',
    expected_harvest_end: '',
    expected_procurement_quantity: '',
    irrigation_type: '',
    crop_variety: '',
    update_reason: ''
  });
  const [updating, setUpdating] = useState(false);
  const [editError, setEditError] = useState('');

  // Dynamic preview estimation
  const [previewForecast, setPreviewForecast] = useState(null);

  // 1. Fetch reference yields on mount
  useEffect(() => {
    API.get('/crop-plans/reference-yields', { skipAuth: true })
      .then(res => {
        if (res.data?.reference_yields) {
          setReferenceYields(res.data.reference_yields);
        }
      })
      .catch(err => console.error('Error fetching reference yields:', err));
  }, []);

  // 2. Load farmer plans
  useEffect(() => {
    if (farmerId) {
      loadFarmerPlans(farmerId);
    }
  }, [farmerId, token]);

  // 3. Dynamic yield estimation calculation
  useEffect(() => {
    if (!form.crop || !form.cultivated_area) {
      setPreviewForecast(null);
      return;
    }
    const area = parseFloat(form.cultivated_area);
    if (isNaN(area) || area <= 0) {
      setPreviewForecast(null);
      return;
    }

    const matchedBenchmark = referenceYields.find(b => b.crop.toLowerCase() === form.crop.toLowerCase()) || {
      min_yield_mt_per_acre: 1.6,
      max_yield_mt_per_acre: 2.0,
      min_procurement_ratio: 0.75,
      max_procurement_ratio: 0.85
    };

    const yMin = parseFloat(matchedBenchmark.min_yield_mt_per_acre ?? 1.6);
    const yMax = parseFloat(matchedBenchmark.max_yield_mt_per_acre ?? 2.0);
    const pFactorMin = parseFloat(matchedBenchmark.min_procurement_ratio ?? 0.75);
    const pFactorMax = parseFloat(matchedBenchmark.max_procurement_ratio ?? 0.85);

    const prodMin = parseFloat((area * yMin).toFixed(1));
    const prodMax = parseFloat((area * yMax).toFixed(1));
    const procMin = parseFloat((prodMin * pFactorMin).toFixed(1));
    const procMax = parseFloat((prodMax * pFactorMax).toFixed(1));

    setPreviewForecast({
      prodMin,
      prodMax,
      procMin,
      procMax
    });
  }, [form.crop, form.cultivated_area, referenceYields]);

  const loadFarmerPlans = async (fId) => {
    try {
      setLoadingPlans(true);
      const res = await API.get('/crop-plans/my', {
        params: { farmer_id: fId }
      });
      if (res.data?.crop_plans) {
        setMyPlans(res.data.crop_plans);
        if (res.data.crop_plans.length === 0) {
          setShowForm(true);
        }
      }
    } catch (err) {
      console.error('Failed to load farmer crop plans:', err);
    } finally {
      setLoadingPlans(false);
    }
  };

  const handleCreatePlan = async (e) => {
    e.preventDefault();
    setFormError('');
    setFormSuccess('');

    if (!farmerId) {
      setFormError('Please sign in with your Farmer ID first.');
      return;
    }
    if (new Date(form.expected_harvest_start) > new Date(form.expected_harvest_end)) {
      setFormError('Expected harvest end date must be on or after harvest start date.');
      return;
    }

    try {
      setSubmitting(true);
      const payload = {
        farmer_id: farmerId,
        crop: form.crop,
        cultivated_area: parseFloat(form.cultivated_area),
        area_unit: form.area_unit,
        sowing_date: form.sowing_date,
        expected_harvest_start: form.expected_harvest_start,
        expected_harvest_end: form.expected_harvest_end,
        irrigation_type: form.irrigation_type,
        crop_variety: form.crop_variety,
        farmer_estimated_procurement_qty: form.dont_know_quantity ? null : (parseFloat(form.expected_procurement_quantity) || null),
        created_via: 'FARMER_SELF'
      };

      const res = await API.post('/crop-plans', payload);
      setFormSuccess(`Crop declaration registered successfully (ID: ${res.data.plan.id}). Demand forecast has been recorded.`);
      setShowForm(false);
      loadFarmerPlans(farmerId);
    } catch (err) {
      console.error('Create plan error:', err);
      setFormError(err.response?.data?.message || 'Failed to submit crop declaration.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenEdit = (plan) => {
    setPlanToEdit(plan);
    setEditForm({
      cultivated_area: plan.cultivated_area,
      crop: plan.crop,
      sowing_date: plan.sowing_date ? plan.sowing_date.split('T')[0] : '',
      expected_harvest_start: plan.expected_harvest_start ? plan.expected_harvest_start.split('T')[0] : '',
      expected_harvest_end: plan.expected_harvest_end ? plan.expected_harvest_end.split('T')[0] : '',
      expected_procurement_quantity: plan.farmer_estimated_procurement_qty || '',
      irrigation_type: plan.irrigation_type || 'Canal',
      crop_variety: plan.crop_variety || '',
      update_reason: ''
    });
    setEditError('');
    setEditModalOpen(true);
  };

  const handleUpdatePlan = async (e) => {
    e.preventDefault();
    if (!editForm.update_reason.trim()) {
      setEditError('Please state the reason for updating this declaration (e.g. Pest damage, changed harvest date).');
      return;
    }
    if (new Date(editForm.expected_harvest_start) > new Date(editForm.expected_harvest_end)) {
      setEditError('Harvest end date must be after harvest start date.');
      return;
    }

    try {
      setUpdating(true);
      setEditError('');

      await API.put(`/crop-plans/${planToEdit.id}`, {
        ...editForm,
        cultivated_area: parseFloat(editForm.cultivated_area),
        farmer_estimated_procurement_qty: editForm.expected_procurement_quantity ? parseFloat(editForm.expected_procurement_quantity) : null
      });

      setEditModalOpen(false);
      loadFarmerPlans(farmerId);
    } catch (err) {
      console.error('Update plan error:', err);
      setEditError(err.response?.data?.message || 'Failed to update declaration.');
    } finally {
      setUpdating(false);
    }
  };

  const handleViewHistory = async (plan) => {
    try {
      const res = await API.get(`/crop-plans/${plan.id}`);
      setSelectedPlanDetails(res.data);
      setHistoryDrawerOpen(true);
    } catch (err) {
      console.error('Error fetching plan history:', err);
    }
  };

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 20,
        flexWrap: 'wrap',
        gap: 12
      }}>
        <div>
          <h1 className="kq-title-page" style={{ fontSize: 26 }}>My Advance Crop Plans</h1>
          <p className="kq-text-muted" style={{ margin: '2px 0 0 0', fontSize: 14 }}>
            Declare your cultivated area in advance to help procurement centres plan staff, bags, and storage capacity.
          </p>
        </div>

        <div>
          <PrimaryButton
            onClick={() => setShowForm(!showForm)}
            icon={showForm ? 'x' : 'wheat'}
          >
            {showForm ? 'Close Form' : 'Declare New Crop Plan'}
          </PrimaryButton>
        </div>
      </div>

      {formSuccess && (
        <AlertBanner
          type="positive"
          message={formSuccess}
          onDismiss={() => setFormSuccess('')}
          style={{ marginBottom: 18 }}
        />
      )}
      {formError && (
        <AlertBanner
          type="danger"
          message={formError}
          onDismiss={() => setFormError('')}
          style={{ marginBottom: 18 }}
        />
      )}

      {/* ========================================================================= */}
      {/* DECLARE NEW CROP PLAN ACCORDION / FORM                                     */}
      {/* ========================================================================= */}
      {showForm && (
        <Card style={{ padding: 24, marginBottom: 24, border: '2px solid var(--kq-green-700)' }}>
          <h3 className="kq-title-card" style={{ fontSize: 18, marginBottom: 4 }}>
            New Advance Crop Declaration
          </h3>
          <p className="kq-text-muted" style={{ fontSize: 13, marginBottom: 18 }}>
            Enter your sowing and expected harvest schedule. The system will automatically estimate production yield.
          </p>

          <form onSubmit={handleCreatePlan}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
              <FormField label="Crop Name *" id="formCrop">
                <select
                  className="kq-select"
                  value={form.crop}
                  onChange={e => setForm({ ...form, crop: e.target.value })}
                  required
                >
                  <option value="Paddy">Paddy / நெல்</option>
                  <option value="Maize">Maize / மக்காச்சோளம்</option>
                  <option value="Groundnut">Groundnut / வேர்க்கடலை</option>
                  <option value="Cotton">Cotton / பருத்தி</option>
                  <option value="Sugarcane">Sugarcane / கரும்பு</option>
                </select>
              </FormField>

              <FormField label="Crop Variety" id="formVariety">
                <input
                  className="kq-input"
                  placeholder="e.g. ADT 45, BPT 5204"
                  value={form.crop_variety}
                  onChange={e => setForm({ ...form, crop_variety: e.target.value })}
                />
              </FormField>

              <FormField label="Cultivated Area (Acres) *" id="formArea">
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  className="kq-input"
                  placeholder="3.5"
                  value={form.cultivated_area}
                  onChange={e => setForm({ ...form, cultivated_area: e.target.value })}
                  required
                />
              </FormField>

              <FormField label="Irrigation Method" id="formIrrigation">
                <select
                  className="kq-select"
                  value={form.irrigation_type}
                  onChange={e => setForm({ ...form, irrigation_type: e.target.value })}
                >
                  <option value="Canal">Canal / பாசனக் கால்வாய்</option>
                  <option value="Borewell">Borewell / ஆழ்துளைக் கிணறு</option>
                  <option value="Open Well">Open Well / கிணற்றுப் பாசனம்</option>
                  <option value="Rainfed">Rainfed / மானாவாரி</option>
                </select>
              </FormField>

              <FormField label="Sowing Date *" id="formSowing">
                <input
                  type="date"
                  className="kq-input"
                  value={form.sowing_date}
                  onChange={e => setForm({ ...form, sowing_date: e.target.value })}
                  required
                />
              </FormField>

              <FormField label="Expected Harvest Start *" id="formHarvestStart">
                <input
                  type="date"
                  className="kq-input"
                  value={form.expected_harvest_start}
                  onChange={e => setForm({ ...form, expected_harvest_start: e.target.value })}
                  required
                />
              </FormField>

              <FormField label="Expected Harvest End *" id="formHarvestEnd">
                <input
                  type="date"
                  className="kq-input"
                  value={form.expected_harvest_end}
                  onChange={e => setForm({ ...form, expected_harvest_end: e.target.value })}
                  required
                />
              </FormField>
            </div>

            {/* Live Yield Estimation Card */}
            {previewForecast && (
              <div style={{
                padding: '14px 18px',
                backgroundColor: 'var(--kq-green-50)',
                border: '1px solid var(--kq-green-200)',
                borderRadius: 'var(--kq-radius-md)',
                margin: '20px 0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 12
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Icon name="wheat" size={24} color="var(--kq-green-700)" />
                  <div>
                    <strong style={{ color: 'var(--kq-green-900)', fontSize: 14 }}>
                      Dynamic Procurement Forecast Preview
                    </strong>
                    <div style={{ fontSize: 13, color: 'var(--kq-text-secondary)', marginTop: 2 }}>
                      Estimated Production: <strong>{previewForecast.prodMin}–{previewForecast.prodMax} MT</strong> •
                      Estimated Centre Intake: <strong>{previewForecast.procMin}–{previewForecast.procMax} MT</strong>
                    </div>
                  </div>
                </div>
                <StatusBadge status="Auto Calculated" variant="positive" size="small" />
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
              <SecondaryButton type="button" onClick={() => setShowForm(false)}>
                Cancel
              </SecondaryButton>
              <PrimaryButton type="submit" loading={submitting} icon="check">
                Register Advance Crop Plan
              </PrimaryButton>
            </div>
          </form>
        </Card>
      )}

      {/* ========================================================================= */}
      {/* EXISTING CROP DECLARATIONS LIST                                           */}
      {/* ========================================================================= */}
      {loadingPlans ? (
        <LoadingState message="Loading your crop declarations..." minHeight={200} />
      ) : myPlans.length === 0 ? (
        <EmptyState
          icon="wheat"
          title="No Crop Declarations Yet"
          description="Registering your advance harvest plan helps the government allocate staff and ensure your local procurement centre has adequate storage."
          action={
            <PrimaryButton onClick={() => setShowForm(true)} icon="wheat">
              Create Your First Declaration
            </PrimaryButton>
          }
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {myPlans.map(plan => (
            <Card key={plan.id} style={{ padding: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <h3 className="kq-title-card" style={{ fontSize: 18 }}>
                      {plan.crop} {plan.crop_variety ? `(${plan.crop_variety})` : ''}
                    </h3>
                    <StatusBadge status={plan.status || 'Active'} size="small" />
                    {plan.forecast_version && (
                      <span style={{ fontSize: 11, color: 'var(--kq-text-muted)', backgroundColor: 'var(--kq-bg-subtle)', padding: '2px 6px', borderRadius: 4 }}>
                        v{plan.forecast_version}
                      </span>
                    )}
                  </div>
                  <div className="kq-text-muted" style={{ fontSize: 12.5, marginTop: 4 }}>
                    Plan ID: <strong>{plan.id}</strong> • Harvest Window: {plan.harvest_period || `${formatHumanDate(plan.expected_harvest_start)} – ${formatHumanDate(plan.expected_harvest_end)}`}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <SecondaryButton
                    onClick={() => handleViewHistory(plan)}
                    style={{ height: 30, padding: '2px 10px', fontSize: 12 }}
                  >
                    <Icon name="clock" size={13} />
                    <span>Audit History</span>
                  </SecondaryButton>
                  <SecondaryButton
                    onClick={() => handleOpenEdit(plan)}
                    style={{ height: 30, padding: '2px 10px', fontSize: 12 }}
                  >
                    <Icon name="edit-2" size={13} />
                    <span>Update Plan</span>
                  </SecondaryButton>
                </div>
              </div>

              {/* Metrics Grid */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                gap: 12,
                backgroundColor: 'var(--kq-bg-subtle)',
                padding: '12px 14px',
                borderRadius: 'var(--kq-radius-sm)'
              }}>
                <div>
                  <span className="kq-text-muted" style={{ fontSize: 12, display: 'block' }}>Cultivated Area</span>
                  <strong style={{ fontSize: 15, color: 'var(--kq-text-primary)' }}>{plan.cultivated_area} {plan.area_unit || 'Acres'}</strong>
                </div>
                <div>
                  <span className="kq-text-muted" style={{ fontSize: 12, display: 'block' }}>Sowing Date</span>
                  <strong style={{ fontSize: 14, color: 'var(--kq-text-primary)' }}>{formatHumanDate(plan.sowing_date)}</strong>
                </div>
                <div>
                  <span className="kq-text-muted" style={{ fontSize: 12, display: 'block' }}>Est. Production</span>
                  <strong style={{ fontSize: 15, color: 'var(--kq-text-primary)' }}>
                    {plan.production_min_mt ? `${plan.production_min_mt}–${plan.production_max_mt} MT` : 'Calculating...'}
                  </strong>
                </div>
                <div>
                  <span className="kq-text-muted" style={{ fontSize: 12, display: 'block' }}>Est. Procurement</span>
                  <strong style={{ fontSize: 15, color: 'var(--kq-green-800)' }}>
                    {plan.procurement_min_mt ? `${plan.procurement_min_mt}–${plan.procurement_max_mt} MT` : 'Calculating...'}
                  </strong>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Edit Plan Modal */}
      <Modal
        isOpen={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        title="Update Advance Crop Declaration"
        subtitle={`Plan #${planToEdit?.id}`}
        maxWidth={540}
        footer={
          <div style={{ display: 'flex', gap: 10 }}>
            <SecondaryButton onClick={() => setEditModalOpen(false)}>Cancel</SecondaryButton>
            <PrimaryButton onClick={handleUpdatePlan} loading={updating} icon="check">
              Save Changes & Recalculate
            </PrimaryButton>
          </div>
        }
      >
        <form onSubmit={handleUpdatePlan}>
          {editError && (
            <AlertBanner type="danger" message={editError} style={{ marginBottom: 14 }} />
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <FormField label="Cultivated Area (Acres) *" id="editArea">
              <input
                type="number"
                step="0.1"
                min="0.1"
                className="kq-input"
                value={editForm.cultivated_area}
                onChange={e => setEditForm({ ...editForm, cultivated_area: e.target.value })}
                required
              />
            </FormField>

            <FormField label="Irrigation Method" id="editIrrigation">
              <select
                className="kq-select"
                value={editForm.irrigation_type}
                onChange={e => setEditForm({ ...editForm, irrigation_type: e.target.value })}
              >
                <option value="Canal">Canal</option>
                <option value="Borewell">Borewell</option>
                <option value="Open Well">Open Well</option>
                <option value="Rainfed">Rainfed</option>
              </select>
            </FormField>

            <FormField label="Harvest Start *" id="editHarvestStart">
              <input
                type="date"
                className="kq-input"
                value={editForm.expected_harvest_start}
                onChange={e => setEditForm({ ...editForm, expected_harvest_start: e.target.value })}
                required
              />
            </FormField>

            <FormField label="Harvest End *" id="editHarvestEnd">
              <input
                type="date"
                className="kq-input"
                value={editForm.expected_harvest_end}
                onChange={e => setEditForm({ ...editForm, expected_harvest_end: e.target.value })}
                required
              />
            </FormField>
          </div>

          <FormField
            label="Reason for Modification *"
            id="updateReason"
            helpText="Mandatory government audit requirement (e.g. Unseasonal rain delayed harvest, expanded crop area)"
            style={{ marginTop: 14 }}
          >
            <textarea
              className="kq-textarea"
              rows="3"
              placeholder="State the reason for this change..."
              value={editForm.update_reason}
              onChange={e => setEditForm({ ...editForm, update_reason: e.target.value })}
              required
            />
          </FormField>
        </form>
      </Modal>

      {/* Audit History Drawer */}
      <Drawer
        isOpen={historyDrawerOpen}
        onClose={() => setHistoryDrawerOpen(false)}
        title="Declaration Version & Audit History"
        subtitle={`Plan #${selectedPlanDetails?.plan?.id}`}
        width={480}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{
            padding: 14,
            backgroundColor: 'var(--kq-bg-subtle)',
            borderRadius: 'var(--kq-radius-sm)',
            fontSize: 13
          }}>
            <div><strong>Crop:</strong> {selectedPlanDetails?.plan?.crop} ({selectedPlanDetails?.plan?.cultivated_area} Acres)</div>
            <div><strong>Active Version:</strong> v{selectedPlanDetails?.plan?.forecast_version || 1}</div>
            <div><strong>Registered Via:</strong> {selectedPlanDetails?.plan?.created_via || 'FARMER_SELF'}</div>
          </div>

          <h4 style={{ margin: '8px 0 4px 0', fontSize: 14, fontWeight: 700 }}>Version Audit Trail:</h4>
          {(selectedPlanDetails?.audit_logs || []).length === 0 ? (
            <p className="kq-text-muted" style={{ fontSize: 13 }}>No revision history for this declaration.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {selectedPlanDetails.audit_logs.map((log, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: '10px 12px',
                    borderLeft: '3px solid var(--kq-green-700)',
                    backgroundColor: '#ffffff',
                    borderRadius: 'var(--kq-radius-xs)',
                    boxShadow: 'var(--kq-shadow-xs)',
                    fontSize: 12.5
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                    <strong>{log.action}</strong>
                    <span className="kq-text-muted">{formatHumanDate(log.performed_at)}</span>
                  </div>
                  {log.reason && (
                    <div style={{ color: 'var(--kq-text-secondary)', marginTop: 2 }}>
                      <em>Reason:</em> {log.reason}
                    </div>
                  )}
                  <div className="kq-text-muted" style={{ fontSize: 11, marginTop: 4 }}>
                    By: {log.performed_by} ({log.performed_role})
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Drawer>
    </div>
  );
}
