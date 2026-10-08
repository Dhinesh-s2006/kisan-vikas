import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../api';
import {
  Card,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
  AlertBanner,
  SearchBar,
  DataTable,
  FormField,
  Modal,
  Icon,
  formatHumanDate
} from '../components/design-system';

export default function CSCCropDeclarations() {
  const navigate = useNavigate();
  const receiptRef = useRef(null);

  // Operator Auth & District Scope
  const [operatorId, setOperatorId] = useState(localStorage.getItem('kisan_username') || 'csc_vellore');
  const [district, setDistrict] = useState(localStorage.getItem('kisan_district') || 'Vellore');

  // Search & Farmers
  const [searchQuery, setSearchQuery] = useState('');
  const [farmers, setFarmers] = useState([]);
  const [selectedFarmer, setSelectedFarmer] = useState(null);
  const [loadingFarmers, setLoadingFarmers] = useState(false);

  // Reference Yields
  const [referenceYields, setReferenceYields] = useState([]);

  // Declaration Form State
  const [form, setForm] = useState({
    crop: 'Paddy',
    cultivated_area: '4.0',
    sowing_date: '2026-07-20',
    expected_harvest_start: '2026-11-10',
    expected_harvest_end: '2026-11-25',
    irrigation_type: 'Canal',
    crop_variety: 'Co 51',
    expected_procurement_quantity: '',
    auto_estimate: true
  });
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Receipt Modal State
  const [receiptModal, setReceiptModal] = useState(null);

  // Recent District Declarations
  const [districtDeclarations, setDistrictDeclarations] = useState([]);
  const [loadingDeclarations, setLoadingDeclarations] = useState(false);

  // Dynamic preview calculation
  const [previewForecast, setPreviewForecast] = useState(null);

  useEffect(() => {
    const savedDist = localStorage.getItem('kisan_district');
    const savedUser = localStorage.getItem('kisan_username');
    if (savedDist) setDistrict(savedDist);
    if (savedUser) setOperatorId(savedUser);
  }, []);

  useEffect(() => {
    API.get('/crop-plans/reference-yields', { skipAuth: true })
      .then(res => {
        if (res.data?.reference_yields) setReferenceYields(res.data.reference_yields);
      })
      .catch(console.error);
  }, []);

  const searchFarmers = async (query = '') => {
    try {
      setLoadingFarmers(true);
      const res = await API.get('/farmers', {
        params: { search: query.trim(), district }
      });
      setFarmers(res.data || []);
      if (res.data && res.data.length > 0) {
        setSelectedFarmer(res.data[0]);
      }
    } catch (err) {
      console.error('Farmer search error:', err);
    } finally {
      setLoadingFarmers(false);
    }
  };

  const loadDistrictDeclarations = async (dist) => {
    try {
      setLoadingDeclarations(true);
      const res = await API.get('/csc/crop-plans', {
        params: { district: dist }
      });
      if (res.data?.crop_plans) {
        setDistrictDeclarations(res.data.crop_plans);
      }
    } catch (err) {
      console.error('Error loading district crop plans:', err);
    } finally {
      setLoadingDeclarations(false);
    }
  };

  useEffect(() => {
    if (district) {
      searchFarmers('');
      loadDistrictDeclarations(district);
    }
  }, [district]);

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

    const yMin = parseFloat(matchedBenchmark.min_yield_mt_per_acre ?? matchedBenchmark.yield_min_mt_per_acre ?? 1.6);
    const yMax = parseFloat(matchedBenchmark.max_yield_mt_per_acre ?? matchedBenchmark.yield_max_mt_per_acre ?? 2.0);
    const pFactorMin = parseFloat(matchedBenchmark.min_procurement_ratio ?? matchedBenchmark.procurement_factor_min ?? 0.75);
    const pFactorMax = parseFloat(matchedBenchmark.max_procurement_ratio ?? matchedBenchmark.procurement_factor_max ?? 0.85);

    const prodMin = parseFloat((area * yMin).toFixed(1));
    const prodMax = parseFloat((area * yMax).toFixed(1));
    const procMin = parseFloat((prodMin * pFactorMin).toFixed(1));
    const procMax = parseFloat((prodMax * pFactorMax).toFixed(1));

    setPreviewForecast({ prodMin, prodMax, procMin, procMax, yMin, yMax });
  }, [form.crop, form.cultivated_area, referenceYields]);

  const handleSwitchOperator = () => {
    localStorage.removeItem('kisan_token');
    localStorage.removeItem('kisan_role');
    localStorage.removeItem('kisan_district');
    localStorage.removeItem('kisan_username');
    navigate('/assisted-kiosk');
  };

  const handleSubmitAssistedPlan = async (e) => {
    e.preventDefault();
    if (!selectedFarmer) {
      setErrorMsg('Please select a verified farmer first.');
      return;
    }

    try {
      setSubmitting(true);
      setErrorMsg('');

      const payload = {
        farmer_id: selectedFarmer.farmer_id,
        crop: form.crop,
        cultivated_area: parseFloat(form.cultivated_area),
        area_unit: 'acres',
        sowing_date: form.sowing_date,
        expected_harvest_start: form.expected_harvest_start,
        expected_harvest_end: form.expected_harvest_end,
        irrigation_type: form.irrigation_type,
        crop_variety: form.crop_variety,
        expected_procurement_quantity: form.auto_estimate ? null : (parseFloat(form.expected_procurement_quantity) || null),
        district: district
      };

      const res = await API.post('/csc/crop-plans', payload);
      if (res.data?.receipt) {
        setReceiptModal(res.data.receipt);
      }
      loadDistrictDeclarations(district);
    } catch (err) {
      setErrorMsg(err.response?.data?.message || 'Failed to register assisted crop plan.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: 1100, margin: '24px auto', padding: '0 16px', position: 'relative', zIndex: 1 }}>
      
      {/* Top Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 12, color: 'var(--kq-green-800)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            KISAN VIKAS • CSC ASSISTED SERVICE
          </div>
          <h1 style={{ margin: '4px 0', fontSize: 22, fontWeight: 800, color: 'var(--kq-text-primary)' }}>
            🤝 Assisted Crop Declaration Entry
          </h1>
          <p style={{ margin: 0, color: 'var(--kq-text-secondary)', fontSize: 13 }}>
            Register pre-harvest cultivation declarations for farmers without smartphones in {district} district • Operator ID: <strong>{operatorId}</strong>
          </p>
        </div>

        <SecondaryButton
          onClick={() => navigate('/assisted-kiosk')}
          style={{ fontSize: 13, gap: 6 }}
        >
          <Icon name="arrow-left" size={14} /> Back to Slot Kiosk
        </SecondaryButton>
      </div>

      {/* Advisory Banner */}
      <AlertBanner
        type="info"
        title="Assisted Kiosk Advisory"
        message="This declaration is an upstream crop estimate for DPC demand planning. Please advise the farmer that this does not substitute for an official booking slot. Provide them the printed declaration receipt."
        style={{ marginBottom: 20 }}
      />

      {/* Two Column Layout */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 20, marginBottom: 24, alignItems: 'start' }}>
        
        {/* Left Column: Farmer Select */}
        <Card style={{ padding: 20 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 16, color: 'var(--kq-text-primary)' }}>
            1. Select Farmer ({district})
          </h3>

          <div style={{ marginBottom: 12 }}>
            <SearchBar
              value={searchQuery}
              onChange={val => {
                setSearchQuery(val);
                searchFarmers(val);
              }}
              placeholder="Search by name, ID or mobile..."
            />
          </div>

          {selectedFarmer && (
            <div style={{ background: 'var(--kq-green-50)', border: '1px solid var(--kq-green-200)', borderRadius: 'var(--kq-radius-md)', padding: 12, marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: 'var(--kq-green-800)', fontWeight: 700 }}>SELECTED FOR DECLARATION</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--kq-green-900)', marginTop: 2 }}>{selectedFarmer.name}</div>
              <div style={{ fontSize: 12, color: 'var(--kq-green-800)', marginTop: 2 }}>
                ID: <strong>{selectedFarmer.farmer_id}</strong> • Village: {selectedFarmer.village || 'General'}
              </div>
            </div>
          )}

          <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--kq-border-light)', borderRadius: 'var(--kq-radius-md)' }}>
            {loadingFarmers ? (
              <div style={{ padding: 16, textAlign: 'center', color: 'var(--kq-text-muted)', fontSize: 12 }}>Searching directory...</div>
            ) : farmers.length === 0 ? (
              <div style={{ padding: 16, textAlign: 'center', color: 'var(--kq-text-muted)', fontSize: 12 }}>No farmers found.</div>
            ) : (
              farmers.map(f => (
                <div
                  key={f.farmer_id}
                  onClick={() => setSelectedFarmer(f)}
                  style={{
                    padding: '10px 12px',
                    borderBottom: '1px solid var(--kq-border-light)',
                    cursor: 'pointer',
                    background: selectedFarmer?.farmer_id === f.farmer_id ? 'var(--kq-green-50)' : 'transparent'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ color: 'var(--kq-text-primary)', fontSize: 13 }}>{f.name}</strong>
                    <code style={{ fontSize: 11 }}>{f.farmer_id}</code>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--kq-text-muted)', marginTop: 2 }}>
                    📍 {f.village || 'Village'} • 📞 {f.phone || '—'}
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Right Column: Declaration Form */}
        <Card style={{ padding: 20 }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 16, color: 'var(--kq-text-primary)' }}>
            2. Enter Pre-Harvest Crop Plan
          </h3>

          {errorMsg && (
            <AlertBanner type="error" message={errorMsg} style={{ marginBottom: 14 }} />
          )}

          <form onSubmit={handleSubmitAssistedPlan}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <FormField label="Crop" required>
                <select
                  className="kq-select"
                  value={form.crop}
                  onChange={e => setForm({ ...form, crop: e.target.value })}
                  required
                >
                  <option value="Paddy">Paddy</option>
                  <option value="Maize">Maize</option>
                  <option value="Groundnut">Groundnut</option>
                  <option value="Cotton">Cotton</option>
                  <option value="Sugarcane">Sugarcane</option>
                </select>
              </FormField>

              <FormField label="Cultivated Area (Acres)" required>
                <input
                  className="kq-input"
                  type="number"
                  step="0.1"
                  min="0.1"
                  value={form.cultivated_area}
                  onChange={e => setForm({ ...form, cultivated_area: e.target.value })}
                  required
                />
              </FormField>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
              <FormField label="Sowing Date" required>
                <input
                  className="kq-input"
                  type="date"
                  value={form.sowing_date}
                  onChange={e => setForm({ ...form, sowing_date: e.target.value })}
                  required
                />
              </FormField>

              <FormField label="Irrigation Type">
                <select
                  className="kq-select"
                  value={form.irrigation_type}
                  onChange={e => setForm({ ...form, irrigation_type: e.target.value })}
                >
                  <option value="Canal">Canal</option>
                  <option value="Borewell">Borewell</option>
                  <option value="Rainfed">Rainfed</option>
                  <option value="Well">Well</option>
                  <option value="Drip">Drip</option>
                </select>
              </FormField>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
              <FormField label="Harvest Start" required>
                <input
                  className="kq-input"
                  type="date"
                  value={form.expected_harvest_start}
                  onChange={e => setForm({ ...form, expected_harvest_start: e.target.value })}
                  required
                />
              </FormField>

              <FormField label="Harvest End" required>
                <input
                  className="kq-input"
                  type="date"
                  value={form.expected_harvest_end}
                  onChange={e => setForm({ ...form, expected_harvest_end: e.target.value })}
                  required
                />
              </FormField>
            </div>

            {/* Dynamic Forecast Range Preview */}
            {previewForecast && (
              <div style={{ background: 'var(--kq-bg-subtle)', border: '1px solid var(--kq-border-light)', borderRadius: 'var(--kq-radius-md)', padding: 12, margin: '14px 0' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--kq-green-800)', marginBottom: 4 }}>CALCULATED BENCHMARK ESTIMATE</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--kq-text-primary)' }}>
                  <div>Production: <strong>{previewForecast.prodMin} – {previewForecast.prodMax} MT</strong></div>
                  <div>Procurement: <strong>{previewForecast.procMin} – {previewForecast.procMax} MT</strong></div>
                </div>
              </div>
            )}

            <div style={{ marginTop: 18 }}>
              <PrimaryButton
                type="submit"
                disabled={submitting || !selectedFarmer}
                style={{ width: '100%', padding: 12, fontSize: 14 }}
              >
                {submitting ? 'Registering Declaration...' : 'Register Declaration & Generate Slip →'}
              </PrimaryButton>
            </div>
          </form>
        </Card>

      </div>

      {/* Recent Declarations Table */}
      <Card style={{ padding: 20 }}>
        <h3 style={{ margin: '0 0 14px', fontSize: 16, color: 'var(--kq-text-primary)' }}>
          Recent Assisted Declarations in {district} ({districtDeclarations.length})
        </h3>

        <DataTable
          columns={[
            { key: 'id', header: 'Plan ID', render: val => <code>{val}</code> },
            { key: 'farmer_id', header: 'Farmer ID' },
            { key: 'crop', header: 'Crop' },
            { key: 'cultivated_area', header: 'Area', render: (val, r) => `${val} ${r.area_unit || 'acres'}` },
            { key: 'harvest_period', header: 'Harvest Window' },
            { key: 'expected_procurement_min_mt', header: 'Est. Procurement', render: (val, r) => <strong>{val} – {r.expected_procurement_max_mt} MT</strong> },
            { key: 'created_via', header: 'Channel' }
          ]}
          data={districtDeclarations.slice(0, 10)}
        />
      </Card>

      {/* Printable Receipt Modal */}
      {receiptModal && (
        <Modal
          isOpen={!!receiptModal}
          onClose={() => setReceiptModal(null)}
          title="Assisted Crop Declaration Receipt"
        >
          <div ref={receiptRef} style={{ border: '1px dashed var(--kq-border-strong)', padding: 16, borderRadius: 'var(--kq-radius-md)', background: '#fafafa', fontFamily: 'monospace', fontSize: 12, lineHeight: 1.6 }}>
            <div style={{ textAlign: 'center', borderBottom: '1px solid #cbd5e1', paddingBottom: 8, marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 900 }}>KISAN VIKAS</div>
              <div style={{ fontSize: 10 }}>PRE-HARVEST CROP DECLARATION SLIP</div>
            </div>

            <div><strong>RECEIPT REF:</strong> {receiptModal.receipt_id}</div>
            <div><strong>PLAN ID:</strong> {receiptModal.crop_plan_id}</div>
            <div><strong>FARMER:</strong> {receiptModal.farmer_name} ({receiptModal.farmer_id})</div>
            <div><strong>DISTRICT:</strong> {receiptModal.district}</div>
            <div style={{ borderTop: '1px dashed #ccc', margin: '6px 0' }} />
            <div><strong>CROP:</strong> {receiptModal.crop} ({receiptModal.cultivated_area} {receiptModal.area_unit})</div>
            <div><strong>HARVEST WINDOW:</strong> {receiptModal.harvest_period}</div>
            <div><strong>EST. PRODUCTION:</strong> {receiptModal.estimated_production_range}</div>
            <div><strong>EST. PROCUREMENT:</strong> {receiptModal.estimated_procurement_range}</div>
            <div style={{ borderTop: '1px dashed #ccc', margin: '6px 0' }} />
            <div style={{ fontSize: 10, color: '#555', textAlign: 'center' }}>
              Operator: {receiptModal.operator_id} • {formatHumanDate(receiptModal.registered_at)}
            </div>
            <div style={{ fontSize: 9, color: 'var(--kq-amber-800)', marginTop: 4, textAlign: 'center' }}>
              ⚠️ Early planning estimate only. Does not replace booking slot.
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
            <SecondaryButton onClick={() => setReceiptModal(null)}>Close</SecondaryButton>
            <PrimaryButton onClick={() => window.print()} style={{ gap: 6 }}>
              <Icon name="printer" size={14} color="#ffffff" /> Print Slip
            </PrimaryButton>
          </div>
        </Modal>
      )}

    </div>
  );
}
