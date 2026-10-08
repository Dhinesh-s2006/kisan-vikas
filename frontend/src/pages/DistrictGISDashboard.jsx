import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import API from '../api';
import {
  Icon,
  PrimaryButton,
  SecondaryButton,
  GhostButton,
  Card,
  StatCard,
  StatusBadge,
  AlertBanner,
  EmptyState
} from '../components/design-system';

function DistrictGISDashboard() {
  const navigate = useNavigate();
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef([]);

  // Cleanup Leaflet map on unmount
  useEffect(() => {
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [officerUser, setOfficerUser] = useState(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [mapData, setMapData] = useState(null);
  const [selectedCentre, setSelectedCentre] = useState(null);
  const [centreDetails, setCentreDetails] = useState(null);
  const [loadingCentre, setLoadingCentre] = useState(false);
  const [availableDistricts, setAvailableDistricts] = useState([]);

  const isDevSwitcherEnabled = import.meta.env.VITE_ENABLE_DEMO_ROLE_SWITCHER === 'true';

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('ALL'); // ALL, Open, Closed
  const [filterCongestion, setFilterCongestion] = useState('ALL'); // ALL, HIGH, MEDIUM, LOW
  const [filterRisk, setFilterRisk] = useState('ALL'); // ALL, HIGH, MEDIUM, LOW

  // Active view tab in side drawer
  const [sidebarTab, setSidebarTab] = useState('list'); // 'list' or 'details'

  // Logout helper
  const handleLogout = () => {
    localStorage.removeItem('kisan_token');
    localStorage.removeItem('kisan_role');
    localStorage.removeItem('kisan_district');
    localStorage.removeItem('kisan_username');
    setOfficerUser(null);
    setMapData(null);
  };

  // Explicit dev switch helper for district officer testing
  const handleDevQuickSwitch = (districtName) => {
    if (!districtName) return;
    handleLogout();
    navigate('/district-officer');
  };

  // 1. Verify authentication and load map on mount
  useEffect(() => {
    if (isDevSwitcherEnabled) {
      API.get('/districts', { skipAuth: true })
        .then(res => {
          if (Array.isArray(res.data)) {
            setAvailableDistricts(res.data.map(d => d.district).filter(Boolean).sort());
          }
        })
        .catch(() => {});
    }

    const token = localStorage.getItem('kisan_token');
    const role = localStorage.getItem('kisan_role');

    if (!token || role !== 'DISTRICT_OFFICER') {
      handleLogout();
      setAuthChecking(false);
      return;
    }

    API.get('/auth/me')
      .then((res) => {
        if (res.data?.user && res.data.user.role === 'DISTRICT_OFFICER' && res.data.user.district) {
          setOfficerUser(res.data.user);
          localStorage.setItem('kisan_district', res.data.user.district);
          localStorage.setItem('kisan_username', res.data.user.username);
          loadMapData(res.data.user.district);
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

  // 2. Fetch District GIS Map data
  const loadMapData = async (district) => {
    if (!district) return;
    try {
      setLoading(true);
      setError('');
      setSelectedCentre(null);
      setCentreDetails(null);

      const res = await API.get('/district-officer/map', {
        params: { district: district }
      });

      setMapData(res.data);
    } catch (err) {
      console.error('Failed to load district map data:', err);
      if (err.response?.status === 401) {
        handleLogout();
        return;
      }
      const errMsg =
        err.response?.data?.message ||
        'Unable to load district GIS data. Please ensure you are authorized as a District Officer.';
      setError(errMsg);
    } finally {
      setLoading(false);
    }
  };

  // Load single centre detail when clicked
  const handleSelectCentre = async (centre) => {
    setSelectedCentre(centre);
    setSidebarTab('details');

    // Pan map to centre
    if (mapInstanceRef.current && centre.latitude && centre.longitude) {
      mapInstanceRef.current.flyTo([centre.latitude, centre.longitude], 14, {
        duration: 1.2
      });
    }

    try {
      setLoadingCentre(true);
      const res = await API.get(`/district-officer/centres/${centre.centre_id}`);
      setCentreDetails(res.data);
    } catch (err) {
      console.warn('Could not fetch single centre deep details:', err);
      setCentreDetails(null);
    } finally {
      setLoadingCentre(false);
    }
  };

  // Filtered centres list
  const filteredCentres = (mapData?.centres || []).filter((c) => {
    const matchesSearch =
      searchQuery.trim() === '' ||
      c.centre_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.centre_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.village_town && c.village_town.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesStatus =
      filterStatus === 'ALL' ||
      (filterStatus === 'Open' && c.operational_status !== 'Closed') ||
      (filterStatus === 'Closed' && c.operational_status === 'Closed');

    const matchesCongestion =
      filterCongestion === 'ALL' || c.congestion_level === filterCongestion;

    const matchesRisk =
      filterRisk === 'ALL' ||
      (c.risk_level && c.risk_level.toUpperCase() === filterRisk);

    return matchesSearch && matchesStatus && matchesCongestion && matchesRisk;
  });

  // 3. Initialize & update Leaflet map
  useEffect(() => {
    if (!mapContainerRef.current || !mapData) return;

    const centroid = mapData.centroid || { lat: 10.78, lon: 79.13 };

    // Create map instance if not exists
    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [centroid.lat, centroid.lon],
        zoom: 10,
        zoomControl: true
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 18
      }).addTo(map);

      mapInstanceRef.current = map;
    } else {
      mapInstanceRef.current.setView([centroid.lat, centroid.lon], 10);
    }

    const map = mapInstanceRef.current;

    // Clear existing markers
    markersRef.current.forEach((m) => map.removeLayer(m));
    markersRef.current = [];

    // Helper to generate colored SVG divIcon
    const createMarkerIcon = (congestion, status) => {
      let color = '#15803d'; // green for LOW
      let pulse = false;
      if (status === 'Closed') {
        color = '#64748b'; // slate for closed
      } else if (congestion === 'HIGH') {
        color = '#b91c1c'; // red
        pulse = true;
      } else if (congestion === 'MEDIUM') {
        color = '#b45309'; // amber
      }

      const html = `
        <div style="
          position: relative;
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        ">
          ${
            pulse
              ? `<div style="
                  position: absolute;
                  width: 36px;
                  height: 36px;
                  border-radius: 50%;
                  background: ${color};
                  opacity: 0.35;
                  animation: leaflet-pulse 2s infinite ease-out;
                "></div>`
              : ''
          }
          <div style="
            width: 24px;
            height: 24px;
            background: ${color};
            border: 2px solid #ffffff;
            box-shadow: 0 2px 6px rgba(0,0,0,0.3);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 11px;
            font-weight: bold;
          ">
            ${status === 'Closed' ? '✕' : congestion === 'HIGH' ? '!' : '✓'}
          </div>
        </div>
      `;

      return L.divIcon({
        className: 'custom-gis-pin',
        html: html,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
        popupAnchor: [0, -14]
      });
    };

    // Plot filtered centres
    filteredCentres.forEach((c) => {
      if (c.latitude == null || c.longitude == null) return;

      const marker = L.marker([c.latitude, c.longitude], {
        icon: createMarkerIcon(c.congestion_level, c.operational_status)
      });

      const popupHtml = `
        <div style="font-family: inherit; min-width: 220px; padding: 4px;">
          <div style="font-size: 11px; color: #166534; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">
            ${c.centre_id} ${c.is_demo_coordinate ? '• (Centroid Fallback)' : ''}
          </div>
          <div style="font-weight: 700; font-size: 14px; margin: 4px 0 6px 0; color: #1c1917;">
            ${c.centre_name}
          </div>
          <div style="display: flex; gap: 6px; margin-bottom: 8px;">
            <span style="
              padding: 2px 8px;
              border-radius: 9999px;
              font-size: 11px;
              font-weight: 700;
              background: ${
                c.congestion_level === 'HIGH'
                  ? '#fee2e2; color: #b91c1c;'
                  : c.congestion_level === 'MEDIUM'
                  ? '#fef3c7; color: #92400e;'
                  : '#dcfce7; color: #15803d;'
              }
            ">
              ${c.congestion_level} CONGESTION
            </span>
            <span style="
              padding: 2px 8px;
              border-radius: 9999px;
              font-size: 11px;
              background: #f5f5f4;
              color: #44403c;
              font-weight: 600;
            ">
              ${c.operational_status}
            </span>
          </div>
          <div style="font-size: 12px; color: #57534e; line-height: 1.5; margin-bottom: 10px;">
            <div>👥 <b>Current Queue:</b> ${c.current_queue} farmers</div>
            <div>⏱️ <b>Est. Wait:</b> ~${c.estimated_wait_minutes} mins</div>
            <div>📦 <b>Today's Bookings:</b> ${c.today_bookings}</div>
          </div>
          <button
            id="btn-select-${c.centre_id}"
            style="
              width: 100%;
              padding: 7px 10px;
              background: #166534;
              color: white;
              border: none;
              border-radius: 6px;
              font-weight: 600;
              font-size: 12px;
              cursor: pointer;
            "
          >
            Inspect Centre Telemetry →
          </button>
        </div>
      `;

      marker.bindPopup(popupHtml);

      marker.on('popupopen', () => {
        const btn = document.getElementById(`btn-select-${c.centre_id}`);
        if (btn) {
          btn.onclick = () => handleSelectCentre(c);
        }
      });

      marker.addTo(map);
      markersRef.current.push(marker);
    });
  }, [mapData, filteredCentres]);

  const summary = mapData?.summary || {
    total_centres: 0,
    open_centres: 0,
    closed_centres: 0,
    high_congestion: 0,
    medium_congestion: 0,
    low_congestion: 0,
    total_current_queue: 0,
    avg_estimated_wait_minutes: 0
  };

  if (authChecking) {
    return (
      <div style={{ minHeight: '100vh', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', zIndex: 1 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🗺️</div>
          <div style={{ color: 'var(--kq-green-800)', fontWeight: 700, fontSize: 16 }}>Verifying District Officer Session...</div>
          <div style={{ color: 'var(--kq-text-muted)', fontSize: 13, marginTop: 4 }}>KISAN VIKAS • Spatial Command Surveillance</div>
        </div>
      </div>
    );
  }

  if (!officerUser) {
    return (
      <div style={{ minHeight: '100vh', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, position: 'relative', zIndex: 1 }}>
        <Card style={{ maxWidth: 440, width: '100%', textAlign: 'center', padding: 32 }}>
          <div style={{ fontSize: 44, marginBottom: 12 }}>🔒</div>
          <h2 style={{ margin: '0 0 8px 0', color: 'var(--kq-text-primary)', fontSize: 20, fontWeight: 700 }}>
            Authentication Required
          </h2>
          <p style={{ margin: '0 0 24px 0', color: 'var(--kq-text-muted)', fontSize: 13, lineHeight: 1.5 }}>
            The District GIS Command Dashboard is restricted to authorized District Officers. Please sign in to view spatial queue surveillance and centre capacities.
          </p>
          <PrimaryButton
            onClick={() => navigate('/district-officer')}
            style={{ width: '100%', marginBottom: 12, padding: 12 }}
          >
            Sign In as District Officer →
          </PrimaryButton>
          <GhostButton
            onClick={() => navigate('/')}
            style={{ width: '100%' }}
          >
            ← Return to Role Selection
          </GhostButton>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'transparent', display: 'flex', flexDirection: 'column', position: 'relative', zIndex: 1 }}>
      {/* Inline styles for pulses and custom leaflet overrides */}
      <style>{`
        @keyframes leaflet-pulse {
          0% { transform: scale(0.9); opacity: 0.6; }
          70% { transform: scale(1.6); opacity: 0; }
          100% { transform: scale(1.6); opacity: 0; }
        }
        .custom-gis-pin {
          background: transparent !important;
          border: none !important;
        }
        .leaflet-popup-content-wrapper {
          border-radius: var(--kq-radius-md, 8px);
          box-shadow: var(--kq-shadow-md);
          border: 1px solid var(--kq-border-subtle);
        }
      `}</style>

      {/* ========================================================= */}
      {/* 1. TOP HEADER */}
      {/* ========================================================= */}
      <header
        style={{
          background: '#ffffff',
          borderBottom: '1px solid var(--kq-border-medium)',
          padding: '12px 24px',
          position: 'sticky',
          top: 0,
          zIndex: 50,
          boxShadow: 'var(--kq-shadow-sm)'
        }}
      >
        <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              background: 'var(--kq-green-800)',
              color: '#ffffff',
              padding: '6px 10px',
              borderRadius: 'var(--kq-radius-sm)',
              fontWeight: 800,
              fontSize: 13,
              letterSpacing: '0.04em'
            }}>
              KISAN VIKAS
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--kq-text-primary)' }}>
                District GIS Command Dashboard — {officerUser.district}
              </div>
              <div style={{ fontSize: 12, color: 'var(--kq-text-muted)' }}>
                Uzhavarsethu Platform • Officer: <strong>{officerUser.username}</strong> • Live Spatial Queue Surveillance
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <SecondaryButton
              onClick={() => navigate('/district-officer')}
              style={{ fontSize: 12, padding: '6px 12px', gap: 6 }}
            >
              <Icon name="file-text" size={14} color="var(--kq-green-700)" /> Accountability & Grievances
            </SecondaryButton>

            <SecondaryButton
              onClick={() => navigate('/district-officer/procurement-forecast')}
              style={{ fontSize: 12, padding: '6px 12px', gap: 6 }}
            >
              <Icon name="trending-up" size={14} color="var(--kq-green-700)" /> Demand Forecast
            </SecondaryButton>

            <SecondaryButton
              onClick={() => {
                handleLogout();
                navigate('/district-officer');
              }}
              style={{ fontSize: 12, padding: '6px 12px', gap: 6 }}
            >
              <Icon name="log-out" size={14} /> Sign Out
            </SecondaryButton>

            <GhostButton
              onClick={() => navigate('/')}
              style={{ fontSize: 12, padding: '6px 10px' }}
            >
              Exit
            </GhostButton>
          </div>
        </div>
      </header>

      {/* Developer Testing Quick Switcher (Only visible when VITE_ENABLE_DEMO_ROLE_SWITCHER=true) */}
      {isDevSwitcherEnabled && (
        <div style={{
          background: 'var(--kq-green-50, #f0fdf4)',
          borderBottom: '1px solid var(--kq-green-200, #bbf7d0)',
          padding: '8px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--kq-green-800)' }}>
            <span style={{ fontWeight: 700 }}>[DEV ONLY] Switch District Command Scope:</span>
            <select
              value={officerUser.district}
              onChange={(e) => handleDevQuickSwitch(e.target.value)}
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                border: '1px solid var(--kq-green-600)',
                background: 'white',
                fontWeight: 600,
                color: 'var(--kq-green-800)',
                cursor: 'pointer',
                fontSize: 12
              }}
            >
              {(availableDistricts.length > 0 ? availableDistricts : [officerUser.district]).map(dist => (
                <option key={dist} value={dist}>
                  {dist} (officer_{dist.toLowerCase().replace(/[^a-z0-9]/g, '')})
                </option>
              ))}
            </select>
          </div>
          <div style={{ fontSize: 12, color: 'var(--kq-green-800)', fontWeight: 600 }}>
            Total Districts Provisioned: {availableDistricts.length || 35}
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* 2. SUMMARY KPI BAR */}
      {/* ========================================================= */}
      <section
        style={{
          background: '#ffffff',
          borderBottom: '1px solid var(--kq-border-subtle)',
          padding: '12px 24px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))',
          gap: 12
        }}
      >
        <div style={kpiCardStyle}>
          <div style={kpiTitleStyle}>Total Centres</div>
          <div style={{ ...kpiValueStyle, color: 'var(--kq-text-primary)' }}>{summary.total_centres}</div>
          <div style={kpiSubStyle}>{officerUser.district} District</div>
        </div>

        <div style={kpiCardStyle}>
          <div style={kpiTitleStyle}>Operational Status</div>
          <div style={{ ...kpiValueStyle, color: 'var(--kq-green-700)' }}>{summary.open_centres} Open</div>
          <div style={kpiSubStyle}>{summary.closed_centres} currently closed</div>
        </div>

        <div style={{ ...kpiCardStyle, borderLeft: '3px solid var(--kq-error-text, #b91c1c)' }}>
          <div style={kpiTitleStyle}>High Congestion</div>
          <div style={{ ...kpiValueStyle, color: 'var(--kq-error-text, #b91c1c)' }}>{summary.high_congestion}</div>
          <div style={kpiSubStyle}>&gt;75% cap or &gt;45m wait</div>
        </div>

        <div style={{ ...kpiCardStyle, borderLeft: '3px solid var(--kq-warning-text, #b45309)' }}>
          <div style={kpiTitleStyle}>Medium Congestion</div>
          <div style={{ ...kpiValueStyle, color: 'var(--kq-warning-text, #b45309)' }}>{summary.medium_congestion}</div>
          <div style={kpiSubStyle}>Moderate load</div>
        </div>

        <div style={{ ...kpiCardStyle, borderLeft: '3px solid var(--kq-green-700)' }}>
          <div style={kpiTitleStyle}>Low / Normal</div>
          <div style={{ ...kpiValueStyle, color: 'var(--kq-green-700)' }}>{summary.low_congestion}</div>
          <div style={kpiSubStyle}>Optimal throughput</div>
        </div>

        <div style={kpiCardStyle}>
          <div style={kpiTitleStyle}>Total in Queue</div>
          <div style={{ ...kpiValueStyle, color: 'var(--kq-blue-700, #1d4ed8)' }}>{summary.total_current_queue}</div>
          <div style={kpiSubStyle}>Farmers across district</div>
        </div>

        <div style={kpiCardStyle}>
          <div style={kpiTitleStyle}>Avg Estimated Wait</div>
          <div style={{ ...kpiValueStyle, color: 'var(--kq-text-secondary)' }}>
            ~{summary.avg_estimated_wait_minutes} <span style={{ fontSize: 13, fontWeight: 500 }}>min</span>
          </div>
          <div style={kpiSubStyle}>District moving average</div>
        </div>
      </section>

      {/* ========================================================= */}
      {/* 3. FILTER & SEARCH CONTROLS */}
      {/* ========================================================= */}
      <section
        style={{
          background: 'var(--kq-bg-subtle)',
          borderBottom: '1px solid var(--kq-border-subtle)',
          padding: '10px 24px',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 12,
          justifyContent: 'space-between'
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
          {/* Search */}
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              placeholder="Search centre name, ID, village..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="kq-input"
              style={{
                paddingLeft: 32,
                width: 260,
                fontSize: 13,
                height: 36
              }}
            />
            <span style={{ position: 'absolute', left: 10, top: 9, fontSize: 14, color: 'var(--kq-text-muted)' }}>
              🔍
            </span>
          </div>

          {/* Status Filter */}
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="kq-select"
            style={{ width: 'auto', height: 36, fontSize: 13 }}
          >
            <option value="ALL">All Operational Statuses</option>
            <option value="Open">Open Only</option>
            <option value="Closed">Closed Only</option>
          </select>

          {/* Congestion Filter */}
          <select
            value={filterCongestion}
            onChange={(e) => setFilterCongestion(e.target.value)}
            className="kq-select"
            style={{ width: 'auto', height: 36, fontSize: 13 }}
          >
            <option value="ALL">All Congestion Levels</option>
            <option value="HIGH">🔴 High Congestion</option>
            <option value="MEDIUM">🟡 Medium Congestion</option>
            <option value="LOW">🟢 Low / Normal</option>
          </select>

          {/* Risk Level Filter */}
          <select
            value={filterRisk}
            onChange={(e) => setFilterRisk(e.target.value)}
            className="kq-select"
            style={{ width: 'auto', height: 36, fontSize: 13 }}
          >
            <option value="ALL">All Risk Levels</option>
            <option value="HIGH">Risk: High</option>
            <option value="MEDIUM">Risk: Medium</option>
            <option value="LOW">Risk: Low</option>
          </select>

          {(searchQuery || filterStatus !== 'ALL' || filterCongestion !== 'ALL' || filterRisk !== 'ALL') && (
            <GhostButton
              onClick={() => {
                setSearchQuery('');
                setFilterStatus('ALL');
                setFilterCongestion('ALL');
                setFilterRisk('ALL');
              }}
              style={{ fontSize: 12, padding: '4px 10px', height: 36 }}
            >
              ✕ Clear Filters
            </GhostButton>
          )}
        </div>

        <div style={{ fontSize: 12, color: 'var(--kq-text-muted)', fontWeight: 600 }}>
          Showing <b>{filteredCentres.length}</b> of <b>{mapData?.centres?.length || 0}</b> centres
        </div>
      </section>

      {/* ========================================================= */}
      {/* 4. MAIN WORKSPACE: MAP + INTERACTIVE SIDEBAR */}
      {/* ========================================================= */}
      <div style={{ display: 'flex', flex: 1, position: 'relative', overflow: 'hidden' }}>
        {/* LEAFLET MAP CONTAINER */}
        <div style={{ flex: 1, position: 'relative', minHeight: 520 }}>
          {loading && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: 'rgba(255,255,255,0.85)',
                zIndex: 1000,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <div style={{ fontSize: 32, marginBottom: 8 }}>🔄</div>
              <div style={{ fontWeight: 700, color: 'var(--kq-green-800)' }}>
                Loading GIS Map Data for {officerUser?.district}...
              </div>
            </div>
          )}

          {error && (
            <div
              style={{
                position: 'absolute',
                top: 20,
                left: 20,
                right: 20,
                zIndex: 1000
              }}
            >
              <AlertBanner
                variant="error"
                title="Map Data Unavailable"
                message={error}
                action={
                  <div style={{ display: 'flex', gap: 8 }}>
                    <SecondaryButton onClick={() => loadMapData(officerUser?.district)} style={{ fontSize: 12 }}>
                      Retry
                    </SecondaryButton>
                    <SecondaryButton onClick={() => navigate('/district-officer')} style={{ fontSize: 12 }}>
                      Go to Dashboard
                    </SecondaryButton>
                  </div>
                }
              />
            </div>
          )}

          <div
            ref={mapContainerRef}
            style={{ width: '100%', height: '100%', minHeight: 520 }}
          />

          {/* MAP LEGEND OVERLAY */}
          <div
            style={{
              position: 'absolute',
              bottom: 24,
              left: 16,
              background: 'rgba(255,255,255,0.96)',
              padding: '12px 14px',
              borderRadius: 'var(--kq-radius-md)',
              boxShadow: 'var(--kq-shadow-md)',
              zIndex: 800,
              fontSize: 12,
              lineHeight: 1.6,
              border: '1px solid var(--kq-border-subtle)'
            }}
          >
            <div style={{ fontWeight: 700, color: 'var(--kq-text-primary)', marginBottom: 6, fontSize: 12 }}>
              Congestion Legend
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#b91c1c' }} />
              <span style={{ color: 'var(--kq-text-secondary)' }}>High Congestion (&gt;75% cap / &gt;45m wait)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#b45309' }} />
              <span style={{ color: 'var(--kq-text-secondary)' }}>Medium Congestion (40-74% cap)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#15803d' }} />
              <span style={{ color: 'var(--kq-text-secondary)' }}>Low / Normal Load (&lt;40% cap)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#64748b' }} />
              <span style={{ color: 'var(--kq-text-secondary)' }}>Closed / Inactive DPC</span>
            </div>
          </div>
        </div>

        {/* SIDEBAR: CENTRES LIST & INSPECTOR DRAWER */}
        <div
          style={{
            width: 380,
            background: '#ffffff',
            borderLeft: '1px solid var(--kq-border-subtle)',
            display: 'flex',
            flexDirection: 'column',
            maxHeight: 'calc(100vh - 180px)',
            boxShadow: 'var(--kq-shadow-sm)'
          }}
        >
          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--kq-border-subtle)' }}>
            <button
              onClick={() => setSidebarTab('list')}
              style={{
                flex: 1,
                padding: '11px 12px',
                border: 'none',
                background: sidebarTab === 'list' ? '#ffffff' : 'var(--kq-bg-subtle)',
                borderBottom: sidebarTab === 'list' ? '2px solid var(--kq-green-800)' : 'none',
                fontWeight: sidebarTab === 'list' ? 700 : 500,
                color: sidebarTab === 'list' ? 'var(--kq-green-800)' : 'var(--kq-text-muted)',
                cursor: 'pointer',
                fontSize: 13
              }}
            >
              Centres List ({filteredCentres.length})
            </button>
            <button
              onClick={() => setSidebarTab('details')}
              style={{
                flex: 1,
                padding: '11px 12px',
                border: 'none',
                background: sidebarTab === 'details' ? '#ffffff' : 'var(--kq-bg-subtle)',
                borderBottom: sidebarTab === 'details' ? '2px solid var(--kq-green-800)' : 'none',
                fontWeight: sidebarTab === 'details' ? 700 : 500,
                color: sidebarTab === 'details' ? 'var(--kq-green-800)' : 'var(--kq-text-muted)',
                cursor: 'pointer',
                fontSize: 13
              }}
            >
              Centre Inspector {selectedCentre ? `(${selectedCentre.centre_id})` : ''}
            </button>
          </div>

          {/* TAB 1: CENTRES LIST VIEW */}
          {sidebarTab === 'list' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
              {filteredCentres.length === 0 ? (
                <EmptyState
                  icon="map-pin"
                  title="No centres found"
                  description="No procurement centres match your search or filter criteria."
                  style={{ padding: '30px 16px' }}
                />
              ) : (
                filteredCentres.map((c) => {
                  const isSelected = selectedCentre?.centre_id === c.centre_id;
                  return (
                    <div
                      key={c.centre_id}
                      onClick={() => handleSelectCentre(c)}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 'var(--kq-radius-md)',
                        background: isSelected ? 'var(--kq-green-50, #f0fdf4)' : '#ffffff',
                        border: isSelected ? '1px solid var(--kq-green-600)' : '1px solid var(--kq-border-subtle)',
                        marginBottom: 8,
                        cursor: 'pointer',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 700,
                              color: 'var(--kq-green-800)',
                              marginRight: 6
                            }}
                          >
                            {c.centre_id}
                          </span>
                          <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--kq-text-primary)' }}>
                            {c.centre_name}
                          </span>
                        </div>
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            padding: '2px 6px',
                            borderRadius: 'var(--kq-radius-sm)',
                            background:
                              c.congestion_level === 'HIGH'
                                ? 'var(--kq-error-bg, #fee2e2)'
                                : c.congestion_level === 'MEDIUM'
                                ? 'var(--kq-warning-bg, #fef3c7)'
                                : 'var(--kq-green-100, #dcfce7)',
                            color:
                              c.congestion_level === 'HIGH'
                                ? 'var(--kq-error-text, #b91c1c)'
                                : c.congestion_level === 'MEDIUM'
                                ? 'var(--kq-warning-text, #92400e)'
                                : 'var(--kq-green-800, #15803d)'
                          }}
                        >
                          {c.congestion_level}
                        </span>
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          gap: 12,
                          marginTop: 6,
                          fontSize: 11,
                          color: 'var(--kq-text-secondary)'
                        }}
                      >
                        <span>👥 Queue: <b>{c.current_queue}</b></span>
                        <span>⏱️ Wait: <b>~{c.estimated_wait_minutes}m</b></span>
                        <span>📊 Cap: <b>{c.utilization_percent}%</b></span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* TAB 2: DETAILED INSPECTOR */}
          {sidebarTab === 'details' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
              {!selectedCentre ? (
                <EmptyState
                  icon="info"
                  title="No centre selected"
                  description="Select a procurement centre on the map or from the list to view comprehensive real-time status."
                  style={{ padding: '40px 16px' }}
                />
              ) : (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--kq-green-800)' }}>
                        {selectedCentre.centre_id} • {selectedCentre.district}
                      </div>
                      <h3 style={{ margin: '4px 0', fontSize: 16, color: 'var(--kq-text-primary)' }}>
                        {selectedCentre.centre_name}
                      </h3>
                      <div style={{ fontSize: 12, color: 'var(--kq-text-muted)' }}>
                        Village/Town: {selectedCentre.village_town || 'N/A'}
                      </div>
                    </div>
                    <StatusBadge
                      status={selectedCentre.operational_status === 'Closed' ? 'CANCELLED' : 'ACTIVE'}
                      label={selectedCentre.operational_status}
                    />
                  </div>

                  {/* GPS Verified or Centroid Fallback Tag */}
                  <div style={{ marginTop: 8 }}>
                    {selectedCentre.has_real_coordinates ? (
                      <span
                        style={{
                          fontSize: 10,
                          background: 'var(--kq-green-50, #ecfdf5)',
                          color: 'var(--kq-green-800, #065f46)',
                          border: '1px solid var(--kq-green-200, #a7f3d0)',
                          padding: '2px 6px',
                          borderRadius: 4,
                          fontWeight: 600
                        }}
                      >
                        ✓ GPS Geocoded ({selectedCentre.latitude?.toFixed(4)}°, {selectedCentre.longitude?.toFixed(4)}°)
                      </span>
                    ) : (
                      <span
                        style={{
                          fontSize: 10,
                          background: 'var(--kq-warning-bg, #fef3c7)',
                          color: 'var(--kq-warning-text, #92400e)',
                          border: '1px solid #fde68a',
                          padding: '2px 6px',
                          borderRadius: 4,
                          fontWeight: 600
                        }}
                      >
                        ⚠️ Centroid Fallback (DEMO/SYNTHETIC COORDINATES)
                      </span>
                    )}
                  </div>

                  {/* Core Metrics Grid */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: 8,
                      marginTop: 14
                    }}
                  >
                    <div style={detailBoxStyle}>
                      <div style={detailBoxLabel}>Current Queue</div>
                      <div style={detailBoxValue}>{selectedCentre.current_queue} farmers</div>
                    </div>
                    <div style={detailBoxStyle}>
                      <div style={detailBoxLabel}>Estimated Wait</div>
                      <div style={{ ...detailBoxValue, color: 'var(--kq-warning-text, #b45309)' }}>
                        ~{selectedCentre.estimated_wait_minutes} min
                      </div>
                    </div>
                    <div style={detailBoxStyle}>
                      <div style={detailBoxLabel}>Active Counters</div>
                      <div style={detailBoxValue}>{selectedCentre.active_counters} counters</div>
                    </div>
                    <div style={detailBoxStyle}>
                      <div style={detailBoxLabel}>Daily Capacity</div>
                      <div style={detailBoxValue}>{selectedCentre.daily_capacity} slots/day</div>
                    </div>
                  </div>

                  {/* Capacity Utilization Progress Bar */}
                  <div style={{ marginTop: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                      <span style={{ color: 'var(--kq-text-secondary)', fontWeight: 500 }}>Capacity Utilization</span>
                      <span style={{
                        fontWeight: 700,
                        color: selectedCentre.utilization_percent > 75
                          ? 'var(--kq-error-text, #b91c1c)'
                          : 'var(--kq-green-800)'
                      }}>
                        {selectedCentre.utilization_percent}%
                      </span>
                    </div>
                    <div style={{ height: 8, width: '100%', background: 'var(--kq-border-subtle)', borderRadius: 4, overflow: 'hidden' }}>
                      <div
                        style={{
                          height: '100%',
                          width: `${Math.min(100, selectedCentre.utilization_percent)}%`,
                          background:
                            selectedCentre.utilization_percent > 75
                              ? 'var(--kq-error-text, #b91c1c)'
                              : selectedCentre.utilization_percent > 40
                              ? 'var(--kq-warning-text, #b45309)'
                              : 'var(--kq-green-700)',
                          borderRadius: 4
                        }}
                      />
                    </div>
                  </div>

                  {/* Storage & Grain Stock (DEMO/SYNTHETIC) */}
                  <div
                    style={{
                      marginTop: 16,
                      padding: 10,
                      background: 'var(--kq-bg-subtle)',
                      borderRadius: 'var(--kq-radius-md)',
                      border: '1px solid var(--kq-border-subtle)'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--kq-text-secondary)' }}>
                        WAREHOUSE & STORAGE
                      </span>
                      <span style={{ fontSize: 9, background: 'var(--kq-border-medium)', color: 'var(--kq-text-muted)', padding: '1px 5px', borderRadius: 3 }}>
                        DEMO/SYNTHETIC
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--kq-text-primary)', lineHeight: 1.6 }}>
                      <div>📦 Capacity: <b>{selectedCentre.storage_capacity_mt || 500} MT</b></div>
                      <div>🌾 Current Stock: <b>{selectedCentre.current_stock_mt || 120} MT</b></div>
                      <div>🚚 Expected Arrivals: <b>{selectedCentre.expected_arrivals_mt || 35} MT</b></div>
                      <div>⚠️ Risk Level: <b style={{ textTransform: 'uppercase' }}>{selectedCentre.risk_level || 'LOW'}</b></div>
                    </div>
                  </div>

                  {/* Deep details from /centres/:id */}
                  {loadingCentre ? (
                    <div style={{ textAlign: 'center', padding: 12, color: 'var(--kq-text-muted)', fontSize: 12 }}>
                      Loading grievance and booking history...
                    </div>
                  ) : centreDetails ? (
                    <div style={{ marginTop: 14 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--kq-text-primary)', marginBottom: 6 }}>
                        Accountability Summary
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          gap: 8,
                          fontSize: 12,
                          background: 'var(--kq-bg-subtle)',
                          padding: 8,
                          borderRadius: 6
                        }}
                      >
                        <div>Total Grievances: <b>{centreDetails.grievance_stats?.total || 0}</b></div>
                        <div>•</div>
                        <div style={{ color: centreDetails.grievance_stats?.unresolved > 0 ? 'var(--kq-error-text, #b91c1c)' : 'var(--kq-green-800)' }}>
                          Unresolved: <b>{centreDetails.grievance_stats?.unresolved || 0}</b>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {/* Actions */}
                  <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <PrimaryButton
                      onClick={() => navigate('/district-officer')}
                      style={{ width: '100%', fontSize: 12, padding: 10 }}
                    >
                      View Centre in Accountability & Grievances →
                    </PrimaryButton>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ========================================================= */}
      {/* 5. FOOTER DISCLAIMER */}
      {/* ========================================================= */}
      <footer
        style={{
          background: '#ffffff',
          borderTop: '1px solid var(--kq-border-subtle)',
          padding: '8px 24px',
          fontSize: 11,
          color: 'var(--kq-text-muted)',
          display: 'flex',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 8
        }}
      >
        <span>
          <b>Notice:</b> Congestion classifications, estimated wait times, and storage predictions are operational decision indicators. Live procurement counts and farmer queues reflect active database state.
        </span>
        <span>KISAN VIKAS • Uzhavarsethu GIS Command System</span>
      </footer>
    </div>
  );
}

const kpiCardStyle = {
  background: 'var(--kq-bg-subtle)',
  padding: '8px 12px',
  borderRadius: 'var(--kq-radius-md)',
  border: '1px solid var(--kq-border-subtle)'
};

const kpiTitleStyle = {
  fontSize: 11,
  color: 'var(--kq-text-muted)',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: 0.5
};

const kpiValueStyle = {
  fontSize: 18,
  fontWeight: 700,
  margin: '2px 0'
};

const kpiSubStyle = {
  fontSize: 10,
  color: 'var(--kq-text-muted)'
};

const detailBoxStyle = {
  background: 'var(--kq-bg-subtle)',
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid var(--kq-border-subtle)'
};

const detailBoxLabel = {
  fontSize: 10,
  color: 'var(--kq-text-muted)',
  fontWeight: 600,
  textTransform: 'uppercase'
};

const detailBoxValue = {
  fontSize: 14,
  fontWeight: 700,
  color: 'var(--kq-text-primary)',
  marginTop: 2
};

class GISErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('DistrictGISDashboard error caught by boundary:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          background: 'var(--kq-bg-canvas)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20
        }}>
          <Card style={{ maxWidth: 480, width: '100%', textAlign: 'center', padding: 32 }}>
            <div style={{ fontSize: 44, marginBottom: 12 }}>⚠️</div>
            <h2 style={{ margin: '0 0 8px 0', color: 'var(--kq-text-primary)', fontSize: 20, fontWeight: 700 }}>
              District GIS could not be loaded
            </h2>
            <p style={{ margin: '0 0 24px 0', color: 'var(--kq-text-muted)', fontSize: 13, lineHeight: 1.5 }}>
              A rendering issue occurred while initializing the spatial dashboard. Please refresh the page or sign in again.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <PrimaryButton onClick={() => window.location.reload()}>
                Refresh Page
              </PrimaryButton>
              <SecondaryButton
                onClick={() => {
                  localStorage.removeItem('kisan_token');
                  localStorage.removeItem('kisan_role');
                  localStorage.removeItem('kisan_district');
                  localStorage.removeItem('kisan_username');
                  window.location.href = '/district-officer';
                }}
              >
                Sign In Again
              </SecondaryButton>
            </div>
          </Card>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function DistrictGISDashboardWrapper(props) {
  return (
    <GISErrorBoundary>
      <DistrictGISDashboard {...props} />
    </GISErrorBoundary>
  );
}
