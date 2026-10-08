import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../api';

export default function ProcurementForecast() {
  const navigate = useNavigate();

  // District Officer Auth & Scope
  const [officerUser, setOfficerUser] = useState(null);
  const [district, setDistrict] = useState(localStorage.getItem('kisan_district') || '');
  const [authChecking, setAuthChecking] = useState(true);

  // Filters
  const [selectedCrop, setSelectedCrop] = useState('ALL');
  const [selectedPeriod, setSelectedPeriod] = useState('ALL');

  // Data states
  const [kpiData, setKpiData] = useState(null);
  const [cropBreakdown, setCropBreakdown] = useState([]);
  const [harvestBreakdown, setHarvestBreakdown] = useState([]);
  const [centresForecast, setCentresForecast] = useState([]);
  const [trends, setTrends] = useState([]);
  const [actualVsForecast, setActualVsForecast] = useState(null);

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  // Logout helper
  const handleLogout = () => {
    localStorage.removeItem('kisan_token');
    localStorage.removeItem('kisan_role');
    localStorage.removeItem('kisan_district');
    localStorage.removeItem('kisan_username');
    setOfficerUser(null);
    setDistrict('');
  };

  // Mount check
  useEffect(() => {
    const token = localStorage.getItem('kisan_token');
    const role = localStorage.getItem('kisan_role');

    if (!token || role !== 'DISTRICT_OFFICER') {
      handleLogout();
      setAuthChecking(false);
      return;
    }

    API.get('/auth/me')
      .then(res => {
        if (res.data?.user && res.data.user.role === 'DISTRICT_OFFICER' && res.data.user.district) {
          setOfficerUser(res.data.user);
          setDistrict(res.data.user.district);
          localStorage.setItem('kisan_district', res.data.user.district);
          localStorage.setItem('kisan_username', res.data.user.username);
        } else {
          handleLogout();
        }
      })
      .catch(() => {
        handleLogout();
      })
      .finally(() => {
        setAuthChecking(false);
      });
  }, []);

  // Fetch forecast data when district or filters change
  useEffect(() => {
    if (district && officerUser) {
      fetchAllForecastData(district, selectedCrop, selectedPeriod);
    }
  }, [district, selectedCrop, selectedPeriod, officerUser]);

  const fetchAllForecastData = async (dist, crop, period) => {
    try {
      setLoading(true);
      setErrorMsg('');

      const [kpiRes, distRes, centresRes, trendsRes, compRes] = await Promise.all([
        API.get('/district-officer/procurement-forecast', {
          params: { district: dist, crop, harvest_period: period }
        }),
        API.get('/district-officer/procurement-forecast/district', {
          params: { district: dist }
        }),
        API.get('/district-officer/procurement-forecast/centres', {
          params: { district: dist }
        }),
        API.get('/district-officer/procurement-forecast/trends', {
          params: { district: dist }
        }),
        API.get('/district-officer/procurement-forecast/actual-vs-forecast', {
          params: { district: dist }
        })
      ]);

      setKpiData(kpiRes.data?.kpi_summary || null);
      setCropBreakdown(distRes.data?.crop_breakdown || []);
      setHarvestBreakdown(distRes.data?.harvest_breakdown || []);
      setCentresForecast(centresRes.data?.centres_forecast || []);
      setTrends(trendsRes.data?.trends || []);
      setActualVsForecast(compRes.data || null);

    } catch (err) {
      console.error('Fetch forecast data error:', err);
      setErrorMsg(err.response?.data?.message || 'Unable to load district procurement forecast.');
    } finally {
      setLoading(false);
    }
  };

  if (authChecking) {
    return (
      <div style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#166534', fontWeight: 600 }}>Verifying District Officer Session...</div>
      </div>
    );
  }

  if (!officerUser) {
    return (
      <div style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, position: 'relative', zIndex: 1 }}>
        <div style={{ maxWidth: 460, width: '100%', textAlign: 'center', padding: 32, background: 'white', borderRadius: 8, boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: 44, marginBottom: 12 }}>🔒</div>
          <h2 style={{ margin: '0 0 8px 0', color: '#1e293b', fontSize: 20, fontWeight: 700 }}>
            Authentication Required
          </h2>
          <p style={{ margin: '0 0 24px 0', color: '#64748b', fontSize: 13, lineHeight: 1.5 }}>
            The District Procurement Demand Planning Forecast is restricted to authorized District Officers. Please sign in to view predictive procurement demand planning and capacity simulation.
          </p>
          <button
            onClick={() => navigate('/district-officer')}
            style={{ width: '100%', marginBottom: 12, padding: 12, background: '#166534', color: 'white', border: 'none', borderRadius: 6, fontWeight: 700, cursor: 'pointer' }}
          >
            Sign In as District Officer →
          </button>
          <button
            onClick={() => navigate('/')}
            style={{ width: '100%', padding: 10, background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 13 }}
          >
            ← Return to Role Selection
          </button>
        </div>
      </div>
    );
  }

  // Max value for SVG bar scaling
  const maxCropDemand = Math.max(...cropBreakdown.map(c => parseFloat(c.max_proc_mt || 0)), 10);
  const maxTrendDemand = Math.max(...trends.map(t => parseFloat(t.max_procurement_mt || 0)), 10);

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', fontFamily: 'sans-serif', padding: '16px 20px', position: 'relative', zIndex: 1 }}>
      {/* Top Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, borderBottom: '2px solid #166534', paddingBottom: 14, marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 12, color: '#166534', fontWeight: 'bold', letterSpacing: 1 }}>
            KISAN VIKAS • UZHAVARSETHU PLATFORM
          </div>
          <h1 style={{ margin: '4px 0', color: '#14532d', fontSize: 26 }}>
            🌾 Predictive Procurement Demand Planning
          </h1>
          <div style={{ fontSize: 13, color: '#475569' }}>
            District-Level Pre-Harvest Cultivation Forecast, Storage Gap Simulation & DPC Capacity Planning
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={() => navigate('/district-officer')}
            style={{ padding: '8px 14px', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            ← District Officer Dashboard
          </button>
          <button
            onClick={() => navigate('/district-gis')}
            style={{ padding: '8px 14px', background: '#047857', color: 'white', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            🗺️ GIS Command Map
          </button>
          <button
            onClick={() => {
              handleLogout();
              navigate('/district-officer');
            }}
            style={{ padding: '8px 14px', background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            Sign Out
          </button>
        </div>
      </div>

      {/* District Officer Scope Bar */}
      <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '12px 16px', marginBottom: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 24 }}>🏛️</span>
          <div>
            <div style={{ fontSize: 11, fontWeight: 'bold', color: '#166534', letterSpacing: 0.5 }}>ACTIVE DISTRICT COMMAND SCOPE</div>
            <div style={{ fontSize: 15, fontWeight: 'bold', color: '#0f172a' }}>
              District: <span style={{ color: '#166534' }}>{district}</span> | Officer: {officerUser?.username}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>Command Scope:</span>
          <span style={{
            padding: '4px 10px',
            borderRadius: 4,
            fontSize: 12,
            fontWeight: 600,
            border: '1.5px solid #166534',
            background: '#dcfce7',
            color: '#166534'
          }}>
            {district} (Assigned Jurisdiction)
          </span>
          <button
            onClick={() => {
              handleLogout();
              navigate('/district-officer');
            }}
            style={{
              padding: '4px 10px',
              borderRadius: 4,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              border: '1px solid #cbd5e1',
              background: 'white',
              color: '#475569'
            }}
          >
            Switch District / Sign Out →
          </button>
        </div>
      </div>

      {/* Mandatory Disclaimer Box */}
      <div style={{
        background: '#fffbeb',
        border: '1px solid #fde68a',
        borderRadius: 8,
        padding: '12px 16px',
        marginBottom: 20,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        color: '#92400e'
      }}>
        <span style={{ fontSize: 22 }}>⚠️</span>
        <div style={{ fontSize: 13, lineHeight: 1.5 }}>
          <strong>DEMO MODE — Forecast Disclaimer:</strong> Forecast values shown here are synthetic data created for administrative planning demonstration and queue load simulation. They are operational forecasting estimates created for queue load simulation and planning.
        </div>
      </div>

      {/* Filter Bar */}
      <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 8, padding: '12px 18px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>Filter Crop:</label>
          <select
            value={selectedCrop}
            onChange={e => setSelectedCrop(e.target.value)}
            style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 13 }}
          >
            <option value="ALL">All Crops</option>
            <option value="Paddy">Paddy</option>
            <option value="Maize">Maize</option>
            <option value="Groundnut">Groundnut</option>
            <option value="Cotton">Cotton</option>
            <option value="Sugarcane">Sugarcane</option>
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>Harvest Window:</label>
          <select
            value={selectedPeriod}
            onChange={e => setSelectedPeriod(e.target.value)}
            style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 13 }}
          >
            <option value="ALL">All Harvest Periods</option>
            <option value="October 2026">October 2026</option>
            <option value="November 2026">November 2026</option>
            <option value="December 2026">December 2026</option>
            <option value="January 2027">January 2027</option>
          </select>
        </div>

        <div style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>
          Active centres evaluated: <strong>{kpiData?.total_centres || 0}</strong>
        </div>
      </div>

      {/* 5 KPI CARDS */}
      {kpiData && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14, marginBottom: 24 }}>
          {/* KPI 1 */}
          <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 8, padding: '16px 18px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>DECLARED CROP PLANS</div>
            <div style={{ fontSize: 24, fontWeight: 'bold', color: '#166534', marginTop: 4 }}>
              {kpiData.registered_plans}
            </div>
            <div style={{ fontSize: 12, color: '#047857', marginTop: 2 }}>Pre-harvest farmer declarations</div>
          </div>

          {/* KPI 2 */}
          <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 8, padding: '16px 18px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>EXPECTED FARMERS</div>
            <div style={{ fontSize: 24, fontWeight: 'bold', color: '#0f172a', marginTop: 4 }}>
              {kpiData.expected_farmers}
            </div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>Distinct participating farmers</div>
          </div>

          {/* KPI 3 */}
          <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 8, padding: '16px 18px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>CULTIVATED ACRES</div>
            <div style={{ fontSize: 24, fontWeight: 'bold', color: '#0f172a', marginTop: 4 }}>
              {kpiData.cultivated_acres}
            </div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>Total declared cultivation area</div>
          </div>

          {/* KPI 4 */}
          <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 8, padding: '16px 18px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>PROJECTED DEMAND RANGE</div>
            <div style={{ fontSize: 20, fontWeight: 'bold', color: '#1e3a8a', marginTop: 4 }}>
              {kpiData.procurement_min_mt} – {kpiData.procurement_max_mt} MT
            </div>
            <div style={{ fontSize: 12, color: '#475569', marginTop: 2 }}>Based on 75–85% procurement ratio</div>
          </div>

          {/* KPI 5: Capacity & Potential Gap */}
          <div style={{
            background: kpiData.risk_level === 'HIGH PRESSURE' ? '#fef2f2' : kpiData.risk_level === 'WATCH' ? '#fffbeb' : '#f0fdf4',
            border: `1px solid ${kpiData.risk_level === 'HIGH PRESSURE' ? '#f87171' : kpiData.risk_level === 'WATCH' ? '#fde68a' : '#86efac'}`,
            borderRadius: 8,
            padding: '16px 18px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>DISTRICT STORAGE GAP</div>
              <span style={{
                fontSize: 10,
                fontWeight: 'bold',
                padding: '2px 8px',
                borderRadius: 10,
                background: kpiData.risk_level === 'HIGH PRESSURE' ? '#dc2626' : kpiData.risk_level === 'WATCH' ? '#d97706' : '#166534',
                color: 'white'
              }}>
                {kpiData.risk_level}
              </span>
            </div>
            <div style={{ fontSize: 20, fontWeight: 'bold', color: kpiData.risk_level === 'HIGH PRESSURE' ? '#b91c1c' : '#14532d', marginTop: 4 }}>
              {kpiData.potential_gap_max_mt > 0 ? `+${kpiData.potential_gap_min_mt} – ${kpiData.potential_gap_max_mt} MT Gap` : 'Sufficient Capacity'}
            </div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
              Capacity: {kpiData.available_capacity_mt} MT across {kpiData.total_centres} DPCs
            </div>
          </div>
        </div>
      )}

      {/* VISUAL CHARTS ROW (SVG Based) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginBottom: 24 }}>
        {/* Chart 1: Demand by Crop */}
        <div style={{ background: 'white', borderRadius: 8, border: '1px solid #e2e8f0', padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3 style={{ margin: 0, fontSize: 16, color: '#0f172a' }}>🌾 Projected Demand by Crop</h3>
            <span style={{ fontSize: 11, color: '#64748b' }}>Metric Tonnes</span>
          </div>

          {cropBreakdown.length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center', color: '#94a3b8' }}>No crop data available</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {cropBreakdown.map(c => {
                const maxMt = parseFloat(c.max_proc_mt || 0);
                const minMt = parseFloat(c.min_proc_mt || 0);
                const pct = Math.min(100, Math.round((maxMt / maxCropDemand) * 100));
                return (
                  <div key={c.crop}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                      <strong style={{ color: '#334155' }}>{c.crop} ({c.plans_count} plans)</strong>
                      <span style={{ color: '#166534', fontWeight: 600 }}>{minMt} – {maxMt} MT</span>
                    </div>
                    <div style={{ background: '#f1f5f9', height: 16, borderRadius: 8, overflow: 'hidden', display: 'flex' }}>
                      <div
                        style={{
                          width: `${pct}%`,
                          background: 'linear-gradient(90deg, #16a34a, #15803d)',
                          borderRadius: 8,
                          transition: 'width 0.4s ease'
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Chart 2: Monthly Demand Trends */}
        <div style={{ background: 'white', borderRadius: 8, border: '1px solid #e2e8f0', padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3 style={{ margin: 0, fontSize: 16, color: '#0f172a' }}>📅 Monthly Harvest Arrival Curve</h3>
            <span style={{ fontSize: 11, color: '#64748b' }}>Estimated Peak Months</span>
          </div>

          {trends.length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center', color: '#94a3b8' }}>No monthly trends available</div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-around', height: 160, borderBottom: '2px solid #e2e8f0', paddingTop: 10 }}>
              {trends.map(t => {
                const maxMt = parseFloat(t.max_procurement_mt || 0);
                const heightPct = Math.max(10, Math.min(100, Math.round((maxMt / maxTrendDemand) * 120)));
                return (
                  <div key={t.period} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '22%' }}>
                    <div style={{ fontSize: 11, fontWeight: 'bold', color: '#1e3a8a', marginBottom: 4 }}>
                      {maxMt > 0 ? `${maxMt} MT` : '—'}
                    </div>
                    <div
                      style={{
                        width: '70%',
                        height: `${heightPct}px`,
                        background: maxMt > 300 ? 'linear-gradient(180deg, #ef4444, #b91c1c)' : 'linear-gradient(180deg, #3b82f6, #1d4ed8)',
                        borderRadius: '6px 6px 0 0',
                        transition: 'height 0.4s ease'
                      }}
                    />
                    <div style={{ fontSize: 11, color: '#475569', marginTop: 8, textAlign: 'center' }}>
                      {t.period.split(' ')[0]}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* CENTRE CAPACITY & DEMAND GAP TABLE */}
      <div style={{ background: 'white', borderRadius: 8, border: '1px solid #e2e8f0', padding: 20, marginBottom: 28 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 17, color: '#0f172a' }}>
              🏢 DPC Capacity & Forecast Gap Simulation Table
            </h3>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
              Centre-level allocations, risk assessment & planning indicators
            </div>
          </div>
          <span style={{ fontSize: 12, color: '#64748b' }}>
            Showing {centresForecast.length} centres in {district}
          </span>
        </div>

        {centresForecast.length === 0 ? (
          <div style={{ padding: 30, textAlign: 'center', color: '#64748b' }}>No centres found for this district</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table width="100%" cellPadding="10" style={{ borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f8fafc', color: '#475569', borderBottom: '1px solid #e2e8f0' }}>
                  <th>Centre ID & Name</th>
                  <th>Village</th>
                  <th>Primary Crop</th>
                  <th>Est. Farmers</th>
                  <th>DPC Capacity</th>
                  <th>Projected Demand</th>
                  <th>Potential Gap</th>
                  <th>Risk Level</th>
                  <th>Planning Indicators</th>
                </tr>
              </thead>
              <tbody>
                {centresForecast.map(c => {
                  const isHigh = c.risk_level === 'HIGH PRESSURE';
                  const isWatch = c.risk_level === 'WATCH';
                  return (
                    <tr key={c.centre_id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td>
                        <strong style={{ color: '#0f172a' }}>{c.centre_name}</strong>
                        <div style={{ fontSize: 11, color: '#64748b' }}>{c.centre_id}</div>
                      </td>
                      <td>{c.village}</td>
                      <td>{c.crop}</td>
                      <td><strong>{c.expected_farmers}</strong></td>
                      <td>{c.available_capacity_mt} MT</td>
                      <td><strong>{c.expected_procurement_min_mt} – {c.expected_procurement_max_mt} MT</strong></td>
                      <td>
                        <span style={{ fontWeight: 'bold', color: isHigh ? '#dc2626' : isWatch ? '#d97706' : '#166534' }}>
                          {c.potential_gap_max_mt > 0 ? `+${c.potential_gap_min_mt} – ${c.potential_gap_max_mt} MT` : 'None'}
                        </span>
                      </td>
                      <td>
                        <span style={{
                          display: 'inline-block',
                          padding: '3px 8px',
                          borderRadius: 12,
                          fontSize: 11,
                          fontWeight: 'bold',
                          background: isHigh ? '#fee2e2' : isWatch ? '#fef3c7' : '#dcfce7',
                          color: isHigh ? '#b91c1c' : isWatch ? '#92400e' : '#166534'
                        }}>
                          ● {c.risk_level}
                        </span>
                      </td>
                      <td>
                        {c.planning_indicators && (
                          <div style={{ fontSize: 11, color: '#334155' }}>
                            <div>Slots: <strong>+{c.planning_indicators.estimated_additional_slots}</strong></div>
                            <div>Storage: <strong>+{c.planning_indicators.estimated_additional_storage_mt} MT</strong></div>
                            <span style={{ fontSize: 9, color: '#64748b' }}>({c.planning_indicators.label})</span>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* FORECAST VS ACTUAL COMPARISON TABLE */}
      {actualVsForecast && (
        <div style={{ background: 'white', borderRadius: 8, border: '1px solid #e2e8f0', padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 17, color: '#0f172a' }}>
                ⚖️ Pre-Harvest Forecast vs. Actual Procurement Receipts
              </h3>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                Cross-referencing verified booking weighment receipts with upstream declarations
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <div style={{ background: '#f0fdf4', border: '1px solid #86efac', padding: '4px 12px', borderRadius: 16, fontSize: 12, color: '#166534', fontWeight: 'bold' }}>
                Range Accuracy: {actualVsForecast.accuracy_rate_pct}% ({actualVsForecast.within_range_count}/{actualVsForecast.total_evaluations})
              </div>
            </div>
          </div>

          <div style={{ fontSize: 11, color: '#64748b', fontStyle: 'italic', marginBottom: 12 }}>
            ℹ️ {actualVsForecast._notice}
          </div>

          {actualVsForecast.comparisons.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: '#64748b', background: '#f8fafc', borderRadius: 6 }}>
              No completed procurement records available for cross-comparison in {district}.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table width="100%" cellPadding="10" style={{ borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#f8fafc', color: '#475569', borderBottom: '1px solid #e2e8f0' }}>
                    <th>Booking / Receipt</th>
                    <th>Farmer</th>
                    <th>Crop</th>
                    <th>Harvest Period</th>
                    <th>Forecast Range (MT)</th>
                    <th>Actual Procured (MT)</th>
                    <th>Evaluation Status</th>
                  </tr>
                </thead>
                <tbody>
                  {actualVsForecast.comparisons.map(c => {
                    const isWithin = c.forecast_vs_actual_status === 'Within Forecast Range';
                    return (
                      <tr key={c.booking_id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td><strong style={{ color: '#1e3a8a' }}>{c.booking_id}</strong></td>
                        <td>{c.farmer_name} ({c.farmer_id})</td>
                        <td>{c.crop}</td>
                        <td>{c.harvest_period}</td>
                        <td>{c.forecast_range_mt}</td>
                        <td><strong style={{ color: '#0f172a' }}>{c.actual_procured_mt} MT</strong></td>
                        <td>
                          <span style={{
                            display: 'inline-block',
                            padding: '3px 8px',
                            borderRadius: 12,
                            fontSize: 11,
                            fontWeight: 'bold',
                            background: isWithin ? '#dcfce7' : '#fef3c7',
                            color: isWithin ? '#166534' : '#92400e'
                          }}>
                            {isWithin ? '✓ Within Range' : 'Outside Range'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
