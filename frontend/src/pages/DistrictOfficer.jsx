import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import API from '../api';
import {
  Card,
  StatCard,
  PrimaryButton,
  SecondaryButton,
  DangerButton,
  GhostButton,
  StatusBadge,
  AlertBanner,
  LoadingState,
  ErrorState,
  EmptyState,
  SearchBar,
  FilterBar,
  Pagination,
  DataTable,
  FormField,
  Modal,
  Drawer,
  Icon,
  formatHumanDate,
  formatHumanTime
} from '../components/design-system';
import NotificationBell from '../components/NotificationBell';
import OfficerAiStructuredView from '../components/OfficerAiStructuredView';

export default function DistrictOfficer() {
  const navigate = useNavigate();

  // -------------------------------------------------------------
  // AUTH & SESSION STATE
  // -------------------------------------------------------------
  const [officerUser, setOfficerUser] = useState(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  // Active Tab (6 Top-Level Sections ONLY)
  // 1. overview, 2. centres, 3. procurement, 4. grievances, 5. demand, 6. assistant
  const [activeTab, setActiveTab] = useState('overview');

  // Available districts for demo switcher
  const [availableDistricts, setAvailableDistricts] = useState([]);
  const isDevSwitcherEnabled = import.meta.env.VITE_ENABLE_DEMO_ROLE_SWITCHER === 'true';

  // -------------------------------------------------------------
  // DOMAIN DATA STATES
  // -------------------------------------------------------------
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState('');

  // 1. Centres State
  const [centresData, setCentresData] = useState([]);
  const [loadingCentres, setLoadingCentres] = useState(false);
  const [centresError, setCentresError] = useState('');
  const [centreSearch, setCentreSearch] = useState('');
  const [centreStatusFilter, setCentreStatusFilter] = useState('ALL'); // ALL, Open, Closed, Paused, Attention
  const [centreViewMode, setCentreViewMode] = useState('table'); // 'table', 'gis', 'pacing', 'fairness'
  const [centrePage, setCentrePage] = useState(1);
  const centresPerPage = 10;
  const [selectedCentre, setSelectedCentre] = useState(null);
  const [centreAuditHistory, setCentreAuditHistory] = useState([]);
  const [loadingAudit, setLoadingAudit] = useState(false);

  // Closed Centre Management Modal state
  const [openModalOpen, setOpenModalOpen] = useState(false);
  const [centreToOpen, setCentreToOpen] = useState(null);
  const [openForm, setOpenForm] = useState({
    opening_date: new Date().toISOString().slice(0, 16),
    reason: 'Scheduled season opening',
    notes: ''
  });
  const [openLoading, setOpenLoading] = useState(false);
  const [openError, setOpenError] = useState('');
  const [openSuccessMsg, setOpenSuccessMsg] = useState('');

  // Supervisory Centre Operations (formerly Velocity & Pacing)
  const [districtPacing, setDistrictPacing] = useState(null);
  const [loadingPacing, setLoadingPacing] = useState(false);
  const [pacingError, setPacingError] = useState('');
  const [applyingPacingCentre, setApplyingPacingCentre] = useState(null);
  const [pacingSuccessMsg, setPacingSuccessMsg] = useState('');

  // Supervisory Fairness & Anti-Disruption
  const [districtFairness, setDistrictFairness] = useState(null);
  const [loadingFairness, setLoadingFairness] = useState(false);
  const [fairnessError, setFairnessError] = useState('');
  const [fairnessPage, setFairnessPage] = useState(1);
  const fairnessPerPage = 10;

  // 2. Procurement State
  const [districtProcurement, setDistrictProcurement] = useState(null);
  const [loadingProcurement, setLoadingProcurement] = useState(false);
  const [procurementError, setProcurementError] = useState('');
  const [procurementPage, setProcurementPage] = useState(1);
  const procurementPerPage = 10;

  // 3. Grievances & Accountability State
  const [grievanceData, setGrievanceData] = useState(null);
  const [loadingGrievances, setLoadingGrievances] = useState(false);
  const [grievancesError, setGrievancesError] = useState('');
  const [grievanceFilter, setGrievanceFilter] = useState('ALL'); // ALL, SLA_BREACHED, OPEN, RESOLVED
  const [grievancePage, setGrievancePage] = useState(1);
  const grievancePerPage = 10;
  const [selectedGrievanceCentre, setSelectedGrievanceCentre] = useState(null);
  const [centreGrievancesList, setCentreGrievancesList] = useState([]);
  const [loadingCentreGrievances, setLoadingCentreGrievances] = useState(false);

  // 4. Demand & Capacity State
  const [forecastKpi, setForecastKpi] = useState(null);
  const [cropBreakdown, setCropBreakdown] = useState([]);
  const [harvestBreakdown, setHarvestBreakdown] = useState([]);
  const [centresForecast, setCentresForecast] = useState([]);
  const [loadingForecast, setLoadingForecast] = useState(false);
  const [forecastError, setForecastError] = useState('');
  const [selectedForecastCrop, setSelectedForecastCrop] = useState('ALL');
  const [selectedForecastPeriod, setSelectedForecastPeriod] = useState('ALL');
  const [demandPage, setDemandPage] = useState(1);
  const demandPerPage = 10;

  // 5. Assistant State
  const [aiLoading, setAiLoading] = useState(false);
  const [aiQuery, setAiQuery] = useState('');
  const [aiResponse, setAiResponse] = useState(null);
  const [aiError, setAiError] = useState('');
  const [aiPrompts, setAiPrompts] = useState([]);
  const [chatHistory, setChatHistory] = useState([]);
  const [simType, setSimType] = useState('arrival_change');
  const [simArrivalPct, setSimArrivalPct] = useState(20);
  const [simCounterDelta, setSimCounterDelta] = useState(1);
  const [simSourceCentre, setSimSourceCentre] = useState('');
  const [simTargetCentre, setSimTargetCentre] = useState('');
  const [simQuantityMt, setSimQuantityMt] = useState(25);

  // 6. GIS Map Instance Refs
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef([]);

  // Cleanup Leaflet on unmount
  useEffect(() => {
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // -------------------------------------------------------------
  // INITIAL AUTH VERIFICATION
  // -------------------------------------------------------------
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
      handleLogout(false);
      setAuthChecking(false);
      return;
    }

    API.get('/auth/me')
      .then(res => {
        if (res.data?.user && res.data.user.role === 'DISTRICT_OFFICER' && res.data.user.district) {
          setOfficerUser(res.data.user);
          localStorage.setItem('kisan_district', res.data.user.district);
          localStorage.setItem('kisan_username', res.data.user.username);
          fetchAllDistrictData(res.data.user.district);
        } else {
          handleLogout(false);
        }
      })
      .catch(() => {
        handleLogout(false);
      })
      .finally(() => {
        setAuthChecking(false);
      });
  }, []);

  const handleLogin = async (e) => {
    if (e) e.preventDefault();
    try {
      setLoginLoading(true);
      setLoginError('');

      const res = await API.post('/auth/login', {
        username: loginForm.username.trim(),
        password: loginForm.password
      });

      if (res.data?.user?.role !== 'DISTRICT_OFFICER') {
        setLoginError('Access denied. This portal is restricted to District Officers only.');
        return;
      }

      const user = res.data.user;
      localStorage.setItem('kisan_token', res.data.token);
      localStorage.setItem('kisan_role', user.role);
      localStorage.setItem('kisan_district', user.district);
      localStorage.setItem('kisan_username', user.username);

      setOfficerUser(user);
      setLoginForm({ username: '', password: '' });
      await fetchAllDistrictData(user.district);
    } catch (err) {
      console.error('Login error:', err);
      setLoginError(err.response?.data?.message || 'Login failed. Please verify credentials.');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = (resetError = true) => {
    localStorage.removeItem('kisan_token');
    localStorage.removeItem('kisan_role');
    localStorage.removeItem('kisan_district');
    localStorage.removeItem('kisan_username');
    setOfficerUser(null);
    setCentresData([]);
    setDistrictPacing(null);
    setDistrictProcurement(null);
    setDistrictFairness(null);
    setGrievanceData(null);
    setForecastKpi(null);
    setCentresForecast([]);
    setChatHistory([]);
    setAiResponse(null);
    if (resetError) setLoginError('');
  };

  // Developer district switcher
  const handleDevQuickSwitch = async (newDistrict) => {
    try {
      const demoUsername = `officer_${newDistrict.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
      const res = await API.post('/auth/login', {
        username: demoUsername,
        password: 'password123'
      });
      const user = res.data.user;
      localStorage.setItem('kisan_token', res.data.token);
      localStorage.setItem('kisan_role', user.role);
      localStorage.setItem('kisan_district', user.district);
      localStorage.setItem('kisan_username', user.username);
      setOfficerUser(user);
      setChatHistory([]);
      await fetchAllDistrictData(user.district);
    } catch (err) {
      console.error('Failed to switch district:', err);
      alert(`Could not switch to ${newDistrict}: ${err.response?.data?.message || err.message}`);
    }
  };

  // -------------------------------------------------------------
  // MASTER DATA FETCHER
  // -------------------------------------------------------------
  const fetchAllDistrictData = async (district) => {
    if (!district) return;
    try {
      setDashboardLoading(true);
      setDashboardError('');

      await Promise.allSettled([
        fetchCentresData(district),
        fetchPacingData(district),
        fetchFairnessData(district),
        fetchProcurementData(district),
        fetchGrievanceData(district),
        fetchForecastData(district, selectedForecastCrop, selectedForecastPeriod),
        fetchAiBriefing()
      ]);
    } catch (err) {
      console.error('Master data load error:', err);
      setDashboardError('Failed to load some district telemetry. Please try refreshing.');
    } finally {
      setDashboardLoading(false);
    }
  };

  // 1. Fetch Centres
  const fetchCentresData = async (district) => {
    try {
      setLoadingCentres(true);
      setCentresError('');
      const res = await API.get('/district-officer/centres');
      const centres = res.data.centres || [];
      setCentresData(centres);
      if (centres.length > 0) {
        if (!simSourceCentre) setSimSourceCentre(centres[0].centre_id);
        if (!simTargetCentre && centres.length > 1) setSimTargetCentre(centres[1].centre_id);
      }
    } catch (err) {
      console.error('Error fetching centres:', err);
      setCentresError(err.response?.data?.message || 'Unable to load district centres.');
    } finally {
      setLoadingCentres(false);
    }
  };

  // 2. Fetch Pacing
  const fetchPacingData = async (district) => {
    try {
      setLoadingPacing(true);
      setPacingError('');
      const res = await API.get('/district-officer/pacing');
      setDistrictPacing(res.data);
    } catch (err) {
      console.error('Error fetching pacing data:', err);
      setPacingError(err.response?.data?.message || 'Unable to load pacing telemetry.');
    } finally {
      setLoadingPacing(false);
    }
  };

  // 3. Fetch Fairness
  const fetchFairnessData = async (district) => {
    try {
      setLoadingFairness(true);
      setFairnessError('');
      const res = await API.get('/district-officer/fairness');
      setDistrictFairness(res.data);
    } catch (err) {
      console.error('Error fetching fairness data:', err);
      setFairnessError(err.response?.data?.message || 'Unable to load fairness metrics.');
    } finally {
      setLoadingFairness(false);
    }
  };

  // 4. Fetch Procurement
  const fetchProcurementData = async (district) => {
    try {
      setLoadingProcurement(true);
      setProcurementError('');
      const res = await API.get('/district-officer/procurement-summary');
      setDistrictProcurement(res.data);
    } catch (err) {
      console.error('Error fetching procurement data:', err);
      setProcurementError(err.response?.data?.message || 'Unable to load procurement summary.');
    } finally {
      setLoadingProcurement(false);
    }
  };

  // 5. Fetch Grievances
  const fetchGrievanceData = async (district) => {
    try {
      setLoadingGrievances(true);
      setGrievancesError('');
      const res = await API.get('/district/grievances/summary');
      setGrievanceData(res.data);
    } catch (err) {
      console.error('Error fetching grievances:', err);
      setGrievancesError(err.response?.data?.message || 'Unable to load grievance tickets.');
    } finally {
      setLoadingGrievances(false);
    }
  };

  // 6. Fetch Forecast
  const fetchForecastData = async (district, crop = 'ALL', period = 'ALL') => {
    try {
      setLoadingForecast(true);
      setForecastError('');
      const [kpiRes, centresRes] = await Promise.all([
        API.get('/district-officer/demand/forecast', {
          params: { crop: crop !== 'ALL' ? crop : undefined, window: period !== 'ALL' ? period : undefined }
        }),
        API.get('/district-officer/demand/centres')
      ]);
      setForecastKpi(kpiRes.data.forecast || kpiRes.data);
      setCropBreakdown(kpiRes.data.crop_breakdown || []);
      setHarvestBreakdown(kpiRes.data.harvest_breakdown || []);
      setCentresForecast(centresRes.data.centres || []);
    } catch (err) {
      console.error('Error fetching forecast:', err);
      setForecastError(err.response?.data?.message || 'Unable to load demand forecast.');
    } finally {
      setLoadingForecast(false);
    }
  };

  // 7. Fetch AI Briefing
  const fetchAiBriefing = async (force = false) => {
    try {
      setAiLoading(true);
      setAiError('');
      const [briefingRes, promptsRes] = await Promise.all([
        API.get('/officer-ai/briefing'),
        API.get('/officer-ai/suggested-prompts')
      ]);
      if (Array.isArray(promptsRes.data?.prompts)) {
        setAiPrompts(promptsRes.data.prompts);
      }
      setAiResponse(briefingRes.data);
      setChatHistory(prev => {
        if (prev.length === 0 || force) {
          return [{
            id: 'briefing_initial',
            query: `Daily operational briefing for ${officerUser?.district || 'district'}`,
            response: briefingRes.data,
            timestamp: new Date()
          }];
        }
        return prev;
      });
    } catch (err) {
      console.warn('Could not load AI briefing:', err);
      setAiError(err.response?.data?.message || 'Could not fetch live AI briefing.');
    } finally {
      setAiLoading(false);
    }
  };

  // -------------------------------------------------------------
  // ACTIONS & MUTATIONS
  // -------------------------------------------------------------

  // Load Centre Audit History & Details
  const handleViewCentre = async (centre) => {
    setSelectedCentre(centre);
    setCentreAuditHistory([]);
    try {
      setLoadingAudit(true);
      const res = await API.get(`/district-officer/centres/${centre.centre_id}/audit`);
      setCentreAuditHistory(res.data.audit_history || []);
    } catch (err) {
      console.error('Failed to load centre audit history:', err);
    } finally {
      setLoadingAudit(false);
    }
  };

  // Trigger Open Centre Modal
  const handlePromptOpenCentre = (centre) => {
    setCentreToOpen(centre);
    setOpenError('');
    setOpenSuccessMsg('');
    setOpenForm({
      opening_date: new Date().toISOString().slice(0, 16),
      reason: 'Scheduled season opening',
      notes: ''
    });
    setOpenModalOpen(true);
  };

  // Confirm Open Centre (RBAC & Audit Record)
  const handleConfirmOpenCentre = async () => {
    if (!centreToOpen) return;
    try {
      setOpenLoading(true);
      setOpenError('');
      const res = await API.post(`/district-officer/centres/${centreToOpen.centre_id}/open`, {
        opening_date: openForm.opening_date,
        reason: openForm.reason,
        notes: openForm.notes
      });

      setOpenSuccessMsg('Centre opened successfully. The centre is now available for farmer bookings.');
      setOpenModalOpen(false);

      if (officerUser?.district) {
        await fetchCentresData(officerUser.district);
      }

      if (selectedCentre && selectedCentre.centre_id === centreToOpen.centre_id) {
        setSelectedCentre(prev => prev ? { ...prev, operational_status: 'Open' } : null);
        handleViewCentre({ ...centreToOpen, operational_status: 'Open' });
      }
    } catch (err) {
      console.error('Error opening centre:', err);
      setOpenError(err.response?.data?.message || 'Failed to open procurement centre. District authorization required.');
    } finally {
      setOpenLoading(false);
    }
  };

  // Broadcast Stagger Pacing Advisory
  const handleApplyCentrePacing = async (centreId) => {
    try {
      setApplyingPacingCentre(centreId);
      setPacingSuccessMsg('');
      const res = await API.post(`/centres/${centreId}/pacing/apply`);
      setPacingSuccessMsg(`Pacing advisory broadcast for ${centreId}: ${res.data.message || 'Advisory dispatched to farmers.'}`);
      if (officerUser?.district) {
        fetchPacingData(officerUser.district);
      }
    } catch (err) {
      console.error('Error applying pacing:', err);
      alert(err.response?.data?.message || 'Failed to apply pacing advisory.');
    } finally {
      setApplyingPacingCentre(null);
    }
  };

  // Load Centre Grievances for Drawer
  const handleLoadCentreGrievances = async (centre) => {
    try {
      setLoadingCentreGrievances(true);
      setSelectedGrievanceCentre(centre);
      const res = await API.get(`/district/grievances/centre/${centre.centre_id}`);
      setCentreGrievancesList(res.data.grievances || []);
    } catch (err) {
      console.error('Failed to load centre grievances:', err);
      setCentreGrievancesList([]);
    } finally {
      setLoadingCentreGrievances(false);
    }
  };

  // AI Assistant Ask
  const handleAskAi = async (overrideQuery = null, overrideScenario = null) => {
    const q = (overrideQuery || aiQuery).trim();
    if (!q && !overrideScenario) return;
    setAiLoading(true);
    setAiError('');
    if (q) setAiQuery(q); // Keep query in text box
    try {
      const historyContext = chatHistory.slice(-4).map(item => ({
        role: 'user',
        content: item.query
      }));
      const res = await API.post('/officer-ai/ask', {
        query: q,
        scenario: overrideScenario || null,
        conversationHistory: historyContext
      });
      setAiResponse(res.data);
      setChatHistory(prev => [
        ...prev,
        {
          id: Date.now(),
          query: q || `Simulation: ${overrideScenario?.type || 'scenario'}`,
          response: res.data,
          timestamp: new Date()
        }
      ]);
    } catch (err) {
      console.error('AI Query failed:', err);
      setAiError(err.response?.data?.message || 'Failed to process AI query.');
    } finally {
      setAiLoading(false);
    }
  };

  // AI Assistant Simulation
  const handleRunSimulation = async () => {
    setAiLoading(true);
    setAiError('');
    try {
      let scenario = {};
      let queryLabel = '';
      if (simType === 'arrival_change') {
        scenario = { type: 'arrival_change', percentage: Number(simArrivalPct) };
        queryLabel = `What-If Simulation: Harvest Arrivals Shift (${simArrivalPct > 0 ? '+' : ''}${simArrivalPct}%)`;
      } else if (simType === 'counter_change') {
        scenario = { type: 'counter_change', counter_delta: Number(simCounterDelta) };
        queryLabel = `What-If Simulation: Weighment Counter Change (${simCounterDelta > 0 ? '+' : ''}${simCounterDelta})`;
      } else if (simType === 'reallocation') {
        scenario = {
          type: 'reallocation',
          source_centre_id: simSourceCentre,
          target_centre_id: simTargetCentre,
          quantity_mt: Number(simQuantityMt)
        };
        queryLabel = `What-If Simulation: Grain Transfer (${simQuantityMt} MT from ${simSourceCentre} to ${simTargetCentre})`;
      }

      setAiQuery(queryLabel);

      const res = await API.post('/officer-ai/simulate', { scenario, query: queryLabel });
      setAiResponse(res.data);
      setChatHistory(prev => [
        ...prev,
        {
          id: Date.now(),
          query: queryLabel,
          response: res.data,
          timestamp: new Date()
        }
      ]);
    } catch (err) {
      console.error('Simulation failed:', err);
      setAiError(err.response?.data?.message || 'Failed to execute simulation.');
    } finally {
      setAiLoading(false);
    }
  };

  // -------------------------------------------------------------
  // GIS MAP INITIALIZATION (Inside Centres Module)
  // -------------------------------------------------------------
  useEffect(() => {
    if (activeTab === 'centres' && centreViewMode === 'gis' && mapContainerRef.current) {
      const validCoords = centresData.filter(c => c.latitude && c.longitude);
      const defaultLat = validCoords.length > 0 ? validCoords[0].latitude : 10.7870;
      const defaultLon = validCoords.length > 0 ? validCoords[0].longitude : 79.1378;

      if (!mapInstanceRef.current) {
        const map = L.map(mapContainerRef.current).setView([defaultLat, defaultLon], 11);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors'
        }).addTo(map);
        mapInstanceRef.current = map;
      } else {
        mapInstanceRef.current.invalidateSize();
      }

      // Clear existing markers
      markersRef.current.forEach(m => m.remove());
      markersRef.current = [];

      // Add centre markers
      validCoords.forEach(c => {
        const isClosed = c.operational_status === 'Closed';
        const isDelayed = (c.waiting_farmers || 0) > 20 || c.needs_attention;
        const color = isClosed ? '#64748b' : isDelayed ? '#ef4444' : '#16a34a';

        const customIcon = L.divIcon({
          className: 'kq-custom-map-pin',
          html: `<div style="
            background: ${color};
            width: 26px;
            height: 26px;
            border-radius: 50%;
            border: 2px solid white;
            box-shadow: 0 2px 6px rgba(0,0,0,0.3);
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 11px;
            font-weight: 800;
          ">${(c.waiting_farmers || 0)}</div>`,
          iconSize: [26, 26],
          iconAnchor: [13, 13]
        });

        const marker = L.marker([c.latitude, c.longitude], { icon: customIcon })
          .addTo(mapInstanceRef.current)
          .bindPopup(`
            <div style="font-family: system-ui; min-width: 180px;">
              <strong style="font-size: 14px;">${c.centre_name}</strong>
              <div style="font-size: 11px; color: #64748b; margin-bottom: 6px;">ID: ${c.centre_id}</div>
              <div style="font-size: 12px; margin-bottom: 4px;">Status: <strong>${c.operational_status}</strong></div>
              <div style="font-size: 12px; margin-bottom: 4px;">Waiting: <strong>${c.waiting_farmers || 0} farmers</strong></div>
              <div style="font-size: 12px; margin-bottom: 8px;">Storage: <strong>${c.storage_used_pct || 0}% used</strong></div>
              <div style="display: flex; gap: 6px;">
                <button id="btn-view-${c.centre_id}" style="
                  background: #166534; color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; cursor: pointer;
                ">View Centre</button>
                ${isClosed ? `
                  <button id="btn-open-${c.centre_id}" style="
                    background: #15803d; color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; cursor: pointer;
                  ">Open Centre</button>
                ` : ''}
              </div>
            </div>
          `);

        marker.on('popupopen', () => {
          const viewBtn = document.getElementById(`btn-view-${c.centre_id}`);
          if (viewBtn) {
            viewBtn.onclick = () => handleViewCentre(c);
          }
          const openBtn = document.getElementById(`btn-open-${c.centre_id}`);
          if (openBtn) {
            openBtn.onclick = () => handlePromptOpenCentre(c);
          }
        });

        markersRef.current.push(marker);
      });

      if (validCoords.length > 1) {
        const bounds = L.latLngBounds(validCoords.map(c => [c.latitude, c.longitude]));
        mapInstanceRef.current.fitBounds(bounds, { padding: [40, 40] });
      }
    }
  }, [activeTab, centreViewMode, centresData]);

  // -------------------------------------------------------------
  // AUTH CHECK RENDER
  // -------------------------------------------------------------
  if (authChecking) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', position: 'relative', zIndex: 1 }}>
        <LoadingState message="Verifying District Officer Authorization & Scope..." />
      </div>
    );
  }

  // Login view if unauthorized
  if (!officerUser) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', padding: 20, position: 'relative', zIndex: 1 }}>
        <div style={{ maxWidth: 440, width: '100%', background: '#ffffff', borderRadius: 'var(--kq-radius-lg)', boxShadow: 'var(--kq-shadow-md)', padding: 32, border: '1px solid var(--kq-border-light)' }}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <div style={{
              width: 48,
              height: 48,
              borderRadius: 'var(--kq-radius-md)',
              backgroundColor: 'var(--kq-green-800)',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 12px'
            }}>
              <Icon name="wheat" size={26} />
            </div>
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--kq-green-800)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
              KISAN VIKAS • OFFICER COMMAND PORTAL
            </div>
            <h2 style={{ margin: 0, fontSize: 22, color: 'var(--kq-text-primary)' }}>District Officer Sign In</h2>
            <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--kq-text-muted)' }}>
              Enter administrative credentials to supervise your district.
            </p>
          </div>

          {loginError && (
            <AlertBanner type="error" title="Access Denied" message={loginError} style={{ marginBottom: 18 }} />
          )}

          <form onSubmit={handleLogin}>
            <FormField label="Officer Username" required>
              <input
                type="text"
                className="kq-input"
                placeholder="e.g. officer_thanjavur"
                value={loginForm.username}
                onChange={e => setLoginForm({ ...loginForm, username: e.target.value })}
                required
              />
            </FormField>

            <FormField label="Password" required style={{ marginTop: 14 }}>
              <input
                type="password"
                className="kq-input"
                placeholder="••••••••"
                value={loginForm.password}
                onChange={e => setLoginForm({ ...loginForm, password: e.target.value })}
                required
              />
            </FormField>

            <PrimaryButton
              type="submit"
              disabled={loginLoading}
              style={{ width: '100%', marginTop: 20, padding: 12 }}
            >
              {loginLoading ? 'Authenticating...' : 'Sign In to District Portal →'}
            </PrimaryButton>
          </form>

          <div style={{ textAlign: 'center', marginTop: 20 }}>
            <button
              type="button"
              onClick={() => navigate('/')}
              style={{ background: 'none', border: 'none', color: 'var(--kq-green-800)', fontSize: 13, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}
            >
              ← Return to Role Selection
            </button>
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // COMPUTED STATS FOR OVERVIEW & FILTERS
  // -------------------------------------------------------------
  const totalCentresCount = centresData.length;
  const openCentresCount = centresData.filter(c => c.operational_status === 'Open').length;
  const closedCentresCount = centresData.filter(c => c.operational_status === 'Closed').length;
  const pausedCentresCount = centresData.filter(c => c.operational_status === 'Paused').length;
  const attentionCentresCount = centresData.filter(c => c.needs_attention).length;

  const totalWaitingFarmers = centresData.reduce((sum, c) => sum + Number(c.waiting_farmers || 0), 0);
  const grievanceSummary = grievanceData?.summary || {};
  const slaBreachedCount = Number(grievanceSummary.sla_breached || 0);

  // Filtered centres list
  const filteredCentres = centresData.filter(c => {
    const matchesSearch = !centreSearch.trim() ||
      c.centre_name?.toLowerCase().includes(centreSearch.toLowerCase()) ||
      c.centre_id?.toLowerCase().includes(centreSearch.toLowerCase());

    let matchesStatus = true;
    if (centreStatusFilter === 'Open') matchesStatus = c.operational_status === 'Open';
    else if (centreStatusFilter === 'Closed') matchesStatus = c.operational_status === 'Closed';
    else if (centreStatusFilter === 'Paused') matchesStatus = c.operational_status === 'Paused';
    else if (centreStatusFilter === 'Attention') matchesStatus = !!c.needs_attention;

    return matchesSearch && matchesStatus;
  });

  // Paginated slices
  const pagedCentres = filteredCentres.slice((centrePage - 1) * centresPerPage, centrePage * centresPerPage);

  const allProcCentres = districtProcurement?.centre_breakdown || districtProcurement?.centres || [];
  const pagedProcCentres = allProcCentres.slice((procurementPage - 1) * procurementPerPage, procurementPage * procurementPerPage);

  const allGrievanceCentres = (grievanceData?.centres || []).filter(c => {
    if (grievanceFilter === 'SLA_BREACHED') return Number(c.sla_breached || 0) > 0;
    if (grievanceFilter === 'OPEN') return (Number(c.total_grievances || 0) - Number(c.verified_resolved || 0)) > 0;
    if (grievanceFilter === 'RESOLVED') return Number(c.verified_resolved || 0) > 0;
    return true;
  });
  const pagedGrievanceCentres = allGrievanceCentres.slice((grievancePage - 1) * grievancePerPage, grievancePage * grievancePerPage);

  const pagedForecastCentres = centresForecast.slice((demandPage - 1) * demandPerPage, demandPage * demandPerPage);

  return (
    <div style={{ minHeight: '100vh', background: 'transparent', position: 'relative', zIndex: 1 }}>
      
      {/* ========================================================= */}
      {/* 1. CLEAN HEADER (No Duplicate Navigation Buttons)         */}
      {/* ========================================================= */}
      <header style={{
        background: '#ffffff',
        borderBottom: '1px solid var(--kq-border-medium)',
        padding: '12px 24px',
        position: 'sticky',
        top: 0,
        zIndex: 50,
        boxShadow: 'var(--kq-shadow-sm)'
      }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          {/* Left: Branding & Scope */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              background: 'var(--kq-green-800)',
              color: '#ffffff',
              padding: '6px 12px',
              borderRadius: 'var(--kq-radius-sm)',
              fontWeight: 800,
              fontSize: 13,
              letterSpacing: '0.04em'
            }}>
              KISAN VIKAS
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--kq-text-primary)' }}>
                District Officer Portal — {officerUser.district}
              </div>
              <div style={{ fontSize: 12, color: 'var(--kq-text-muted)' }}>
                Authorized District: <strong>{officerUser.district}</strong> • Role: District Officer Command
              </div>
            </div>
          </div>

          {/* Right: Notifications, Profile, Sign Out */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <NotificationBell />

            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '4px 10px',
              background: 'var(--kq-bg-subtle)',
              borderRadius: 'var(--kq-radius-md)',
              border: '1px solid var(--kq-border-light)'
            }}>
              <div style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: 'var(--kq-green-100)',
                color: 'var(--kq-green-900)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: 12
              }}>
                {officerUser.username.charAt(0).toUpperCase()}
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--kq-text-primary)' }}>
                {officerUser.username}
              </div>
              <button
                type="button"
                onClick={() => handleLogout()}
                title="Sign Out"
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--kq-text-muted)',
                  cursor: 'pointer',
                  padding: 4,
                  display: 'flex',
                  alignItems: 'center',
                  marginLeft: 4
                }}
              >
                <Icon name="log-out" size={15} color="var(--kq-text-secondary)" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Dev Role Quick Switcher (If enabled) */}
      {isDevSwitcherEnabled && (
        <div style={{
          background: 'var(--kq-green-50)',
          borderBottom: '1px solid var(--kq-green-200)',
          padding: '6px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: 12
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--kq-green-900)' }}>
            <strong>[DEV] Switch District Scope:</strong>
            <select
              value={officerUser.district}
              onChange={(e) => handleDevQuickSwitch(e.target.value)}
              className="kq-select"
              style={{ padding: '2px 8px', fontSize: 12, width: 'auto' }}
            >
              {(availableDistricts.length > 0 ? availableDistricts : [officerUser.district]).map(dist => (
                <option key={dist} value={dist}>
                  {dist} (officer_{dist.toLowerCase().replace(/[^a-z0-9]/g, '')})
                </option>
              ))}
            </select>
          </div>
          <div style={{ color: 'var(--kq-green-800)', fontSize: 11 }}>
            Strict RBAC Isolation: Mutating centres outside {officerUser.district} returns 403 Forbidden.
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* 2. TOP-LEVEL NAVIGATION: 6 MODULES ONLY                   */}
      {/* ========================================================= */}
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '16px 24px' }}>
        
        {/* Navigation Bar */}
        <div style={{
          display: 'flex',
          gap: 4,
          borderBottom: '1px solid var(--kq-border-medium)',
          marginBottom: 20,
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch'
        }}>
          {[
            { id: 'overview', label: 'Overview', icon: 'home' },
            { id: 'centres', label: `Centres (${totalCentresCount})`, icon: 'map-pin' },
            { id: 'procurement', label: 'Procurement', icon: 'file-text' },
            { id: 'grievances', label: `Grievances ${slaBreachedCount > 0 ? `(${slaBreachedCount}!)` : ''}`, icon: 'clipboard-check' },
            { id: 'demand', label: 'Demand & Capacity', icon: 'trending-up' },
            { id: 'assistant', label: 'Assistant', icon: 'sparkles' }
          ].map(tab => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 18px',
                  background: 'none',
                  border: 'none',
                  borderBottom: isActive ? '3px solid var(--kq-green-800)' : '3px solid transparent',
                  color: isActive ? 'var(--kq-green-900)' : 'var(--kq-text-secondary)',
                  fontWeight: isActive ? 700 : 500,
                  fontSize: 14,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'all 0.15s ease'
                }}
              >
                <Icon
                  name={tab.icon}
                  size={16}
                  color={isActive ? 'var(--kq-green-800)' : 'var(--kq-text-muted)'}
                />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Global Loading / Error */}
        {dashboardLoading && (
          <div style={{ marginBottom: 16 }}>
            <LoadingState message="Syncing live district operational telemetry..." />
          </div>
        )}
        {dashboardError && (
          <AlertBanner
            type="error"
            title="Operational Sync Notice"
            message={dashboardError}
            style={{ marginBottom: 16 }}
          />
        )}
        {openSuccessMsg && (
          <AlertBanner
            type="success"
            title="Centre Status Updated"
            message={openSuccessMsg}
            style={{ marginBottom: 16 }}
          />
        )}

        {/* ========================================================= */}
        {/* MODULE 1: OVERVIEW (Monitor -> Identify Exceptions)       */}
        {/* ========================================================= */}
        {activeTab === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            
            {/* Critical Attention Exceptions */}
            {(slaBreachedCount > 0 || attentionCentresCount > 0 || closedCentresCount > 0) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {slaBreachedCount > 0 && (
                  <div style={{
                    background: '#fef2f2',
                    border: '1px solid #fecaca',
                    padding: '12px 16px',
                    borderRadius: 'var(--kq-radius-md)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 12
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Icon name="alert-triangle" size={20} color="var(--kq-red-600)" />
                      <div>
                        <strong style={{ color: '#991b1b', fontSize: 14 }}>
                          {slaBreachedCount} Grievance Ticket(s) Exceeded SLA Deadline
                        </strong>
                        <div style={{ fontSize: 12, color: '#7f1d1d' }}>
                          Farmer complaints require immediate investigation and intervention.
                        </div>
                      </div>
                    </div>
                    <SecondaryButton
                      onClick={() => {
                        setGrievanceFilter('SLA_BREACHED');
                        setActiveTab('grievances');
                      }}
                      style={{ fontSize: 12, padding: '4px 12px' }}
                    >
                      Investigate Grievances →
                    </SecondaryButton>
                  </div>
                )}

                {closedCentresCount > 0 && (
                  <div style={{
                    background: '#f8fafc',
                    border: '1px solid #cbd5e1',
                    padding: '12px 16px',
                    borderRadius: 'var(--kq-radius-md)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 12
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Icon name="slash" size={20} color="#475569" />
                      <div>
                        <strong style={{ color: '#1e293b', fontSize: 14 }}>
                          {closedCentresCount} Procurement Centre(s) Currently Closed
                        </strong>
                        <div style={{ fontSize: 12, color: '#475569' }}>
                          Closed centres cannot accept farmer bookings. District Officers can open authorized centres.
                        </div>
                      </div>
                    </div>
                    <SecondaryButton
                      onClick={() => {
                        setCentreStatusFilter('Closed');
                        setActiveTab('centres');
                      }}
                      style={{ fontSize: 12, padding: '4px 12px' }}
                    >
                      Review Closed Centres →
                    </SecondaryButton>
                  </div>
                )}
              </div>
            )}

            {/* High-Level District Scale KPIs */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--kq-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 10 }}>
                District Procurement Operations Scale
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
                <StatCard
                  label="Procurement Centres"
                  value={totalCentresCount}
                  subtext={`${openCentresCount} Open • ${closedCentresCount} Closed • ${pausedCentresCount} Paused`}
                  icon="map-pin"
                />
                <StatCard
                  label="Waiting Farmers"
                  value={totalWaitingFarmers}
                  subtext="Active in district centre queues"
                  icon="users"
                  statusColor={totalWaitingFarmers > 50 ? 'var(--kq-amber-600)' : undefined}
                />
                <StatCard
                  label="Season Bookings"
                  value={districtProcurement?.summary?.total_bookings ?? 0}
                  subtext="Total farmer appointment slots"
                  icon="calendar"
                />
                <StatCard
                  label="Fully Procured"
                  value={districtProcurement?.summary?.procured_count ?? 0}
                  subtext={`${((districtProcurement?.summary?.total_net_kg || 0) / 1000).toFixed(1)} MT accepted`}
                  icon="check-circle"
                />
                <StatCard
                  label="Total MSP Outlay"
                  value={`₹${Number(districtProcurement?.summary?.total_payout_inr || 0).toLocaleString('en-IN')}`}
                  subtext="Direct Benefit Transfer commitment"
                  icon="credit-card"
                />
              </div>
            </div>

            {/* Quick Investigation Navigation Cards */}
            <Card style={{ padding: 20 }}>
              <h3 style={{ margin: '0 0 14px', fontSize: 15, color: 'var(--kq-text-primary)' }}>
                District Supervisory Modules
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
                
                <div
                  onClick={() => setActiveTab('centres')}
                  style={{
                    padding: 16,
                    background: 'var(--kq-bg-subtle)',
                    borderRadius: 'var(--kq-radius-md)',
                    border: '1px solid var(--kq-border-light)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--kq-green-600)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--kq-border-light)'}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14, color: 'var(--kq-text-primary)' }}>
                    <Icon name="map-pin" size={16} color="var(--kq-green-700)" />
                    Centres & GIS Command
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--kq-text-secondary)', marginTop: 4 }}>
                    Operational health, wait times, storage, GIS map, pacing balancing, and closed centre management.
                  </div>
                </div>

                <div
                  onClick={() => setActiveTab('procurement')}
                  style={{
                    padding: 16,
                    background: 'var(--kq-bg-subtle)',
                    borderRadius: 'var(--kq-radius-md)',
                    border: '1px solid var(--kq-border-light)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--kq-green-600)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--kq-border-light)'}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14, color: 'var(--kq-text-primary)' }}>
                    <Icon name="file-text" size={16} color="var(--kq-green-700)" />
                    Procurement & DBT Outlay
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--kq-text-secondary)', marginTop: 4 }}>
                    Track moisture grading, weighments, MSP disbursements, and centre-level procurement rates.
                  </div>
                </div>

                <div
                  onClick={() => setActiveTab('grievances')}
                  style={{
                    padding: 16,
                    background: 'var(--kq-bg-subtle)',
                    borderRadius: 'var(--kq-radius-md)',
                    border: '1px solid var(--kq-border-light)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--kq-green-600)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--kq-border-light)'}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14, color: 'var(--kq-text-primary)' }}>
                    <Icon name="clipboard-check" size={16} color="var(--kq-green-700)" />
                    Grievance SLA & Accountability
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--kq-text-secondary)', marginTop: 4 }}>
                    Audit farmer complaints, SLA breaches, and centre-level dispute resolution metrics.
                  </div>
                </div>

                <div
                  onClick={() => setActiveTab('demand')}
                  style={{
                    padding: 16,
                    background: 'var(--kq-bg-subtle)',
                    borderRadius: 'var(--kq-radius-md)',
                    border: '1px solid var(--kq-border-light)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--kq-green-600)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--kq-border-light)'}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14, color: 'var(--kq-text-primary)' }}>
                    <Icon name="trending-up" size={16} color="var(--kq-green-700)" />
                    Demand & Capacity Forecast
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--kq-text-secondary)', marginTop: 4 }}>
                    Catchment crop declarations vs godown headroom to anticipate congestion before harvest arrivals.
                  </div>
                </div>

                <div
                  onClick={() => setActiveTab('assistant')}
                  style={{
                    padding: 16,
                    background: 'var(--kq-bg-subtle)',
                    borderRadius: 'var(--kq-radius-md)',
                    border: '1px solid var(--kq-border-light)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--kq-green-600)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--kq-border-light)'}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14, color: 'var(--kq-text-primary)' }}>
                    <Icon name="sparkles" size={16} color="var(--kq-green-700)" />
                    AI Operations Copilot
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--kq-text-secondary)', marginTop: 4 }}>
                    Ask operational questions, simulate harvest shifts, and review daily procurement briefings.
                  </div>
                </div>

              </div>
            </Card>

          </div>
        )}

        {/* ========================================================= */}
        {/* MODULE 2: CENTRES (Operational Health + GIS + Pacing)     */}
        {/* ========================================================= */}
        {activeTab === 'centres' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Card style={{ padding: 20 }}>
              
              {/* Header & View Mode Switcher */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 17, color: 'var(--kq-text-primary)' }}>
                    Procurement Centres — {officerUser.district}
                  </h3>
                  <div style={{ fontSize: 12, color: 'var(--kq-text-muted)', marginTop: 2 }}>
                    Operational status, waiting queues, processing speed, storage headroom, and GIS command
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {/* View Mode Toggle */}
                  <div style={{
                    display: 'flex',
                    background: 'var(--kq-bg-subtle)',
                    borderRadius: 'var(--kq-radius-md)',
                    padding: 3,
                    border: '1px solid var(--kq-border-light)',
                    flexWrap: 'wrap',
                    gap: 2
                  }}>
                    {[
                      { id: 'table', label: '📋 Centres Health' },
                      { id: 'gis', label: '🗺️ GIS Command Map' },
                      { id: 'fairness', label: '⚖️ Fairness Surveillance' }
                    ].map(mode => (
                      <button
                        key={mode.id}
                        type="button"
                        onClick={() => setCentreViewMode(mode.id)}
                        style={{
                          padding: '5px 12px',
                          border: 'none',
                          borderRadius: 'var(--kq-radius-sm)',
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: 'pointer',
                          background: centreViewMode === mode.id ? '#ffffff' : 'transparent',
                          color: centreViewMode === mode.id ? 'var(--kq-green-900)' : 'var(--kq-text-secondary)',
                          boxShadow: centreViewMode === mode.id ? 'var(--kq-shadow-sm)' : 'none'
                        }}
                      >
                        {mode.label}
                      </button>
                    ))}
                  </div>

                  <SecondaryButton
                    onClick={() => {
                      fetchCentresData(officerUser.district);
                      fetchPacingData(officerUser.district);
                      fetchFairnessData(officerUser.district);
                    }}
                    disabled={loadingCentres}
                    style={{ fontSize: 12, padding: '6px 12px', gap: 6 }}
                  >
                    <Icon name="refresh-cw" size={13} /> Refresh
                  </SecondaryButton>
                </div>
              </div>

              {/* View 1: Centres Operational Health Table */}
              {centreViewMode === 'table' && (
                <>
                  {/* Filter Pills */}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                    {[
                      { id: 'ALL', label: `All Centres (${totalCentresCount})` },
                      { id: 'Open', label: `Open (${openCentresCount})` },
                      { id: 'Closed', label: `Closed (${closedCentresCount})` },
                      { id: 'Paused', label: `Paused (${pausedCentresCount})` },
                      { id: 'Attention', label: `Needs Attention (${attentionCentresCount})` }
                    ].map(pill => (
                      <button
                        key={pill.id}
                        type="button"
                        onClick={() => {
                          setCentreStatusFilter(pill.id);
                          setCentrePage(1);
                        }}
                        style={{
                          padding: '5px 12px',
                          borderRadius: 16,
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: 'pointer',
                          border: centreStatusFilter === pill.id ? '1px solid var(--kq-green-700)' : '1px solid var(--kq-border-medium)',
                          background: centreStatusFilter === pill.id ? 'var(--kq-green-50)' : '#ffffff',
                          color: centreStatusFilter === pill.id ? 'var(--kq-green-900)' : 'var(--kq-text-secondary)'
                        }}
                      >
                        {pill.label}
                      </button>
                    ))}
                  </div>

                  {/* Search Bar */}
                  <div style={{ maxWidth: 360, marginBottom: 16 }}>
                    <SearchBar
                      value={centreSearch}
                      onChange={val => {
                        setCentreSearch(val);
                        setCentrePage(1);
                      }}
                      placeholder="Search by centre name or ID..."
                    />
                  </div>

                  {loadingCentres ? (
                    <LoadingState message="Loading district procurement centres..." />
                  ) : filteredCentres.length === 0 ? (
                    <EmptyState
                      icon="map-pin"
                      title="No centres match filter"
                      description="Try adjusting your status filter or search query."
                    />
                  ) : (
                    <>
                      <DataTable
                        columns={[
                          {
                            key: 'centre_name',
                            header: 'Centre',
                            render: (_, c) => (
                              <div>
                                <div style={{ fontWeight: 700, color: 'var(--kq-text-primary)' }}>{c.centre_name}</div>
                                <div style={{ fontSize: 11, color: 'var(--kq-text-muted)' }}>ID: <code>{c.centre_id}</code></div>
                              </div>
                            )
                          },
                          {
                            key: 'operational_status',
                            header: 'Status',
                            width: '100px',
                            render: val => <StatusBadge status={val} size="sm" />
                          },
                          {
                            key: 'waiting_farmers',
                            header: 'Waiting Farmers',
                            render: (val, c) => c.operational_status === 'Closed' ? (
                              <span style={{ color: 'var(--kq-text-muted)' }}>— (Closed)</span>
                            ) : (
                              <div>
                                <strong>{val ?? 0}</strong>
                                <span style={{ fontSize: 11, color: 'var(--kq-text-muted)', marginLeft: 4 }}>farmers</span>
                              </div>
                            )
                          },
                          {
                            key: 'estimated_wait_minutes',
                            header: 'Estimated Wait',
                            render: (val, c) => c.operational_status === 'Closed' ? (
                              <span style={{ color: 'var(--kq-text-muted)' }}>— (Closed)</span>
                            ) : (
                              val ? `${val} min` : 'Nominal'
                            )
                          },
                          {
                            key: 'processing_speed_label',
                            header: 'Processing Speed',
                            render: (val, c) => {
                              if (c.operational_status === 'Closed') {
                                return <span style={{ color: 'var(--kq-text-muted)' }}>— (Closed)</span>;
                              }
                              const label = val || (c.estimated_wait_minutes > 45 ? 'Slow' : 'Normal');
                              const color = label === 'Critical' ? 'var(--kq-red-800)' : label === 'Slow' ? 'var(--kq-amber-800)' : 'var(--kq-green-800)';
                              return <span style={{ fontWeight: 600, color }}>{label}</span>;
                            }
                          },
                          {
                            key: 'storage_used_pct',
                            header: 'Storage',
                            render: (val, c) => {
                              if (c.operational_status === 'Closed') {
                                return <span style={{ color: 'var(--kq-text-muted)' }}>— (Closed)</span>;
                              }
                              const pct = Number(val || 0);
                              const barColor = pct >= 90 ? 'var(--kq-red-600)' : pct >= 75 ? 'var(--kq-amber-500)' : 'var(--kq-green-600)';
                              return (
                                <div style={{ minWidth: 120 }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 2 }}>
                                    <span>{pct}% used</span>
                                    <span style={{ color: 'var(--kq-text-muted)' }}>{c.current_stock_mt || 0} / {c.storage_capacity_mt || 0} MT</span>
                                  </div>
                                  <div style={{ width: '100%', height: 6, background: 'var(--kq-border-light)', borderRadius: 3, overflow: 'hidden' }}>
                                    <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: barColor }} />
                                  </div>
                                </div>
                              );
                            }
                          },
                          {
                            key: 'actions',
                            header: 'Action',
                            render: (_, c) => (
                              <div style={{ display: 'flex', gap: 6 }}>
                                <SecondaryButton
                                  onClick={() => handleViewCentre(c)}
                                  style={{ fontSize: 11, padding: '4px 10px' }}
                                >
                                  View Centre
                                </SecondaryButton>

                                {c.operational_status === 'Closed' && (
                                  <PrimaryButton
                                    onClick={() => handlePromptOpenCentre(c)}
                                    style={{ fontSize: 11, padding: '4px 10px', background: 'var(--kq-green-700)' }}
                                  >
                                    Open Centre
                                  </PrimaryButton>
                                )}
                              </div>
                            )
                          }
                        ]}
                        data={pagedCentres}
                      />

                      <Pagination
                        currentPage={centrePage}
                        totalItems={filteredCentres.length}
                        pageSize={centresPerPage}
                        onPageChange={setCentrePage}
                      />
                    </>
                  )}
                </>
              )}

              {/* View 2: GIS Command Map */}
              {centreViewMode === 'gis' && (
                <div style={{ marginBottom: 16 }}>
                  <div
                    ref={mapContainerRef}
                    style={{
                      height: 500,
                      width: '100%',
                      borderRadius: 'var(--kq-radius-md)',
                      overflow: 'hidden',
                      border: '1px solid var(--kq-border-medium)'
                    }}
                  />
                  <div style={{ fontSize: 11, color: 'var(--kq-text-muted)', marginTop: 8, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                    <span>🟢 <strong>Green Pin:</strong> Normal Operations</span>
                    <span>🔴 <strong>Red Pin:</strong> Queue Backlog / Congestion</span>
                    <span>⚪ <strong>Slate Pin:</strong> Closed Centre</span>
                    <span><em>Click pin popup to inspect details or open closed centres.</em></span>
                  </div>
                </div>
              )}

              {/* View 3: Fairness & Anti-Disruption Surveillance */}
              {centreViewMode === 'fairness' && (() => {
                const allFairnessHotspots = districtFairness?.hotspots || [];
                const pagedFairnessHotspots = allFairnessHotspots.slice((fairnessPage - 1) * fairnessPerPage, fairnessPage * fairnessPerPage);

                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {fairnessError && (
                      <AlertBanner type="error" message={fairnessError} />
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                      <div style={{ background: 'var(--kq-bg-subtle)', padding: 12, borderRadius: 'var(--kq-radius-md)', border: '1px solid var(--kq-border-light)' }}>
                        <div style={{ fontSize: 11, color: 'var(--kq-text-muted)' }}>EVALUATED FARMERS</div>
                        <div style={{ fontSize: 20, fontWeight: 800 }}>{districtFairness?.summary?.total_evaluated_farmers ?? 0}</div>
                      </div>
                      <div style={{ background: 'var(--kq-green-50)', padding: 12, borderRadius: 'var(--kq-radius-md)', border: '1px solid var(--kq-green-200)' }}>
                        <div style={{ fontSize: 11, color: 'var(--kq-green-800)', fontWeight: 600 }}>HIGH PROTECTION</div>
                        <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--kq-green-900)' }}>{districtFairness?.summary?.high_protection_farmers ?? 0}</div>
                      </div>
                      <div style={{ background: 'var(--kq-amber-50)', padding: 12, borderRadius: 'var(--kq-radius-md)', border: '1px solid var(--kq-amber-200)' }}>
                        <div style={{ fontSize: 11, color: 'var(--kq-amber-800)', fontWeight: 600 }}>MODERATE PROTECTION</div>
                        <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--kq-amber-900)' }}>{districtFairness?.summary?.moderate_protection_farmers ?? 0}</div>
                      </div>
                      <div style={{ background: 'var(--kq-bg-subtle)', padding: 12, borderRadius: 'var(--kq-radius-md)', border: '1px solid var(--kq-border-light)' }}>
                        <div style={{ fontSize: 11, color: 'var(--kq-text-muted)' }}>SYSTEM RESCHEDULES</div>
                        <div style={{ fontSize: 20, fontWeight: 800 }}>{districtFairness?.summary?.total_reschedules ?? 0}</div>
                      </div>
                    </div>

                    <DataTable
                      columns={[
                        {
                          key: 'centre_id',
                          header: 'Centre',
                          render: (val, c) => (
                            <div>
                              <strong>{c.centre_name}</strong>
                              <div style={{ fontSize: 11, color: 'var(--kq-text-muted)' }}><code>{val}</code></div>
                            </div>
                          )
                        },
                        { key: 'operational_status', header: 'Status', render: val => <StatusBadge status={val} size="sm" /> },
                        {
                          key: 'total_bookings',
                          header: 'Bookings',
                          render: (val, c) => c.operational_status === 'Closed' ? <span style={{ color: 'var(--kq-text-muted)' }}>— (Closed)</span> : (val ?? 0)
                        },
                        {
                          key: 'reschedule_events_count',
                          header: 'Reschedules',
                          render: (val, c) => c.operational_status === 'Closed' ? <span style={{ color: 'var(--kq-text-muted)' }}>— (Closed)</span> : (val ?? 0)
                        },
                        {
                          key: 'pacing_disruptions_count',
                          header: 'Pacing Delays',
                          render: (val, c) => c.operational_status === 'Closed' ? <span style={{ color: 'var(--kq-text-muted)' }}>— (Closed)</span> : (val ?? 0)
                        },
                        {
                          key: 'high_protection_farmers_count',
                          header: 'High Protection Farmers',
                          render: (val, c) => c.operational_status === 'Closed' ? <span style={{ color: 'var(--kq-text-muted)' }}>— (Closed)</span> : <strong>{val ?? 0}</strong>
                        },
                        {
                          key: 'fairness_health',
                          header: 'Fairness Health',
                          render: (_, h) => {
                            if (h.operational_status === 'Closed') {
                              return <span style={{ color: 'var(--kq-text-muted)' }}>— (Closed)</span>;
                            }
                            const totalDisruptions = (h.reschedule_events_count || 0) + (h.pacing_disruptions_count || 0);
                            const badge = totalDisruptions === 0 ? '🟢 Stable' : totalDisruptions <= 2 ? '🟡 Moderate' : '🔴 Congested';
                            return <strong>{badge}</strong>;
                          }
                        }
                      ]}
                      data={pagedFairnessHotspots}
                    />

                    <Pagination
                      currentPage={fairnessPage}
                      totalItems={allFairnessHotspots.length}
                      pageSize={fairnessPerPage}
                      onPageChange={setFairnessPage}
                    />
                  </div>
                );
              })()}

            </Card>
          </div>
        )}

        {/* ========================================================= */}
        {/* MODULE 3: PROCUREMENT (Summary + DBT + Centre Breakdown)  */}
        {/* ========================================================= */}
        {activeTab === 'procurement' && (
          <Card style={{ padding: 20 }}>
            {procurementError && (
              <AlertBanner
                type="error"
                title="Procurement Data Error"
                message={procurementError}
                style={{ marginBottom: 16 }}
              />
            )}
            {loadingProcurement ? (
              <LoadingState message="Loading district procurement & DBT outlay..." />
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: 17, color: 'var(--kq-text-primary)' }}>
                      District Procurement & DBT Outlay
                    </h3>
                    <div style={{ fontSize: 12, color: 'var(--kq-text-muted)', marginTop: 2 }}>
                      Moisture inspection, scale weighments, and Direct Benefit Transfer disbursements across {officerUser.district}
                    </div>
                  </div>
                </div>

                {/* Summary KPIs */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 18 }}>
                  <div style={{ background: 'var(--kq-bg-subtle)', padding: 14, borderRadius: 'var(--kq-radius-md)', border: '1px solid var(--kq-border-light)' }}>
                    <div style={{ fontSize: 11, color: 'var(--kq-text-muted)' }}>BOOKINGS IN SCOPE</div>
                    <div style={{ fontSize: 22, fontWeight: 800 }}>{districtProcurement?.summary?.total_bookings ?? 0}</div>
                  </div>
                  <div style={{ background: 'var(--kq-green-50)', padding: 14, borderRadius: 'var(--kq-radius-md)', border: '1px solid var(--kq-green-200)' }}>
                    <div style={{ fontSize: 11, color: 'var(--kq-green-800)', fontWeight: 600 }}>FULLY PROCURED</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--kq-green-900)' }}>{districtProcurement?.summary?.procured_count ?? 0}</div>
                  </div>
                  <div style={{ background: 'var(--kq-green-50)', padding: 14, borderRadius: 'var(--kq-radius-md)', border: '1px solid var(--kq-green-200)' }}>
                    <div style={{ fontSize: 11, color: 'var(--kq-green-800)', fontWeight: 600 }}>NET WEIGHT (MT)</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--kq-green-900)' }}>{((districtProcurement?.summary?.total_net_kg || 0) / 1000).toFixed(1)} MT</div>
                  </div>
                  <div style={{ background: '#fefce8', padding: 14, borderRadius: 'var(--kq-radius-md)', border: '1px solid #fef08a' }}>
                    <div style={{ fontSize: 11, color: '#854d0e', fontWeight: 600 }}>TOTAL MSP OUTLAY</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: '#a16207' }}>₹{Number(districtProcurement?.summary?.total_payout_inr || 0).toLocaleString('en-IN')}</div>
                  </div>
                  <div style={{ background: 'var(--kq-green-50)', padding: 14, borderRadius: 'var(--kq-radius-md)', border: '1px solid var(--kq-green-200)' }}>
                    <div style={{ fontSize: 11, color: 'var(--kq-green-800)', fontWeight: 600 }}>DBT COMPLETED</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--kq-green-900)' }}>{districtProcurement?.summary?.payments_completed ?? 0}</div>
                  </div>
                </div>

                {/* Centre-wise Breakdown Table */}
                <DataTable
                  columns={[
                    {
                      key: 'centre_id',
                      header: 'Centre',
                      render: (val, c) => (
                        <div>
                          <strong>{c.centre_name}</strong>
                          <div style={{ fontSize: 11, color: 'var(--kq-text-muted)' }}><code>{val}</code></div>
                        </div>
                      )
                    },
                    { key: 'total_bookings', header: 'Bookings' },
                    { key: 'graded_count', header: 'Graded' },
                    { key: 'weighed_count', header: 'Weighed' },
                    { key: 'procured_count', header: 'Procured', render: val => <strong>{val}</strong> },
                    { key: 'net_weight_kg', header: 'Net Weight', render: val => `${(Number(val) / 100).toFixed(1)} q` },
                    { key: 'total_payout_inr', header: 'MSP Outlay', render: val => `₹${Number(val).toLocaleString('en-IN')}` },
                    { key: 'paid_count', header: 'DBT Paid' },
                    {
                      key: 'open_disputes',
                      header: 'Disputes',
                      render: val => Number(val) > 0 ? <span style={{ color: 'var(--kq-red-800)', fontWeight: 700 }}>⚠️ {val}</span> : '0'
                    }
                  ]}
                  data={pagedProcCentres}
                />

                <Pagination
                  currentPage={procurementPage}
                  totalItems={allProcCentres.length}
                  pageSize={procurementPerPage}
                  onPageChange={setProcurementPage}
                />
              </>
            )}
          </Card>
        )}

        {/* ========================================================= */}
        {/* MODULE 4: GRIEVANCES & CENTRE ACCOUNTABILITY              */}
        {/* ========================================================= */}
        {activeTab === 'grievances' && (
          <Card style={{ padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 17, color: 'var(--kq-text-primary)' }}>
                  Centre Accountability & Grievance SLA
                </h3>
                <div style={{ fontSize: 12, color: 'var(--kq-text-muted)', marginTop: 2 }}>
                  Audit ticket resolution efficiency, SLA compliance, and reopened farmer disputes
                </div>
              </div>

              <SecondaryButton
                onClick={() => fetchGrievanceData(officerUser.district)}
                disabled={loadingGrievances}
                style={{ fontSize: 12, padding: '6px 12px', gap: 6 }}
              >
                <Icon name="refresh-cw" size={13} /> Refresh
              </SecondaryButton>
            </div>

            {/* Grievance Metrics */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 18 }}>
              <StatCard label="Total Grievances" value={grievanceSummary.total ?? 0} icon="message-square" />
              <StatCard label="Open" value={grievanceSummary.open ?? 0} icon="clock" />
              <StatCard label="Awaiting Farmer" value={grievanceSummary.awaiting_confirmation ?? 0} icon="user-check" />
              <StatCard label="Verified Resolved" value={grievanceSummary.verified_resolved ?? 0} icon="check" />
              <StatCard label="Reopened" value={grievanceSummary.reopened ?? 0} icon="refresh-cw" />
              <StatCard
                label="SLA Breached"
                value={slaBreachedCount}
                icon="alert-triangle"
                statusColor={slaBreachedCount > 0 ? 'var(--kq-red-600)' : undefined}
              />
            </div>

            {/* Filter Pills */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
              {[
                { id: 'ALL', label: 'All Centres' },
                { id: 'SLA_BREACHED', label: `SLA Breached (${slaBreachedCount})` },
                { id: 'OPEN', label: 'Open Grievances' },
                { id: 'RESOLVED', label: 'Resolved Tickets' }
              ].map(pill => (
                <button
                  key={pill.id}
                  type="button"
                  onClick={() => {
                    setGrievanceFilter(pill.id);
                    setGrievancePage(1);
                  }}
                  style={{
                    padding: '5px 12px',
                    borderRadius: 16,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    border: grievanceFilter === pill.id ? '1px solid var(--kq-green-700)' : '1px solid var(--kq-border-medium)',
                    background: grievanceFilter === pill.id ? 'var(--kq-green-50)' : '#ffffff',
                    color: grievanceFilter === pill.id ? 'var(--kq-green-900)' : 'var(--kq-text-secondary)'
                  }}
                >
                  {pill.label}
                </button>
              ))}
            </div>

            {/* Centre Accountability Table */}
            <DataTable
              columns={[
                {
                  key: 'centre_id',
                  header: 'Procurement Centre',
                  render: (val, c) => (
                    <div>
                      <strong>{c.centre_name}</strong>
                      <div style={{ fontSize: 11, color: 'var(--kq-text-muted)' }}><code>{val}</code></div>
                      {c.officer_name && <div style={{ fontSize: 11, color: 'var(--kq-green-800)' }}>Officer: {c.officer_name}</div>}
                    </div>
                  )
                },
                { key: 'total_grievances', header: 'Total Issues' },
                { key: 'verified_resolved', header: 'Verified Resolved', render: val => <span style={{ color: 'var(--kq-green-800)', fontWeight: 700 }}>✓ {val}</span> },
                { key: 'awaiting_confirmation', header: 'Awaiting Farmer' },
                { key: 'reopened', header: 'Reopened', render: val => Number(val) > 0 ? <span style={{ color: 'var(--kq-red-800)', fontWeight: 700 }}>{val}</span> : '0' },
                { key: 'sla_breached', header: 'SLA Breached', render: val => Number(val) > 0 ? <span style={{ color: 'var(--kq-red-800)', fontWeight: 700 }}>⚠️ {val}</span> : '0' },
                {
                  key: 'action',
                  header: 'Action',
                  render: (_, centre) => (
                    <PrimaryButton
                      onClick={() => handleLoadCentreGrievances(centre)}
                      style={{ fontSize: 11, padding: '4px 10px' }}
                    >
                      View Tickets →
                    </PrimaryButton>
                  )
                }
              ]}
              data={pagedGrievanceCentres}
            />

            <Pagination
              currentPage={grievancePage}
              totalItems={allGrievanceCentres.length}
              pageSize={grievancePerPage}
              onPageChange={setGrievancePage}
            />
          </Card>
        )}

        {/* ========================================================= */}
        {/* MODULE 5: DEMAND & CAPACITY (Forecast + Headroom)         */}
        {/* ========================================================= */}
        {activeTab === 'demand' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Card style={{ padding: 20 }}>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 17, color: 'var(--kq-text-primary)' }}>
                    Demand & Storage Headroom Forecast
                  </h3>
                  <div style={{ fontSize: 12, color: 'var(--kq-text-muted)', marginTop: 2 }}>
                    Pre-harvest catchment crop declarations vs godown capacity for {officerUser.district}
                  </div>
                </div>

                {/* Filter Controls */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <select
                    value={selectedForecastCrop}
                    onChange={e => {
                      setSelectedForecastCrop(e.target.value);
                      fetchForecastData(officerUser.district, e.target.value, selectedForecastPeriod);
                    }}
                    className="kq-select"
                    style={{ fontSize: 12, width: 'auto' }}
                  >
                    <option value="ALL">All Paddy Varieties</option>
                    <option value="Paddy (Common)">Paddy (Common)</option>
                    <option value="Paddy (Grade A)">Paddy (Grade A)</option>
                    <option value="Paddy (Fine)">Paddy (Fine)</option>
                  </select>

                  <select
                    value={selectedForecastPeriod}
                    onChange={e => {
                      setSelectedForecastPeriod(e.target.value);
                      fetchForecastData(officerUser.district, selectedForecastCrop, e.target.value);
                    }}
                    className="kq-select"
                    style={{ fontSize: 12, width: 'auto' }}
                  >
                    <option value="ALL">All Harvest Windows</option>
                    <option value="7d">Next 7 Days</option>
                    <option value="15d">Next 15 Days</option>
                    <option value="30d">Next 30 Days</option>
                  </select>
                </div>
              </div>

              {loadingForecast ? (
                <LoadingState message="Calculating harvest arrivals vs storage headroom..." />
              ) : (
                <>
                  {/* Forecast KPIs */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 18 }}>
                    <div style={{ background: 'var(--kq-green-50)', padding: 14, borderRadius: 'var(--kq-radius-md)', border: '1px solid var(--kq-green-200)' }}>
                      <div style={{ fontSize: 11, color: 'var(--kq-green-800)', fontWeight: 600 }}>EXPECTED HARVEST ARRIVALS</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--kq-green-900)' }}>
                        {Number(forecastKpi?.procurement_max_mt || forecastKpi?.production_max_mt || forecastKpi?.total_expected_catchment_mt || 0).toFixed(1)} MT
                      </div>
                    </div>
                    <div style={{ background: 'var(--kq-bg-subtle)', padding: 14, borderRadius: 'var(--kq-radius-md)', border: '1px solid var(--kq-border-light)' }}>
                      <div style={{ fontSize: 11, color: 'var(--kq-text-muted)' }}>TOTAL STORAGE CAPACITY</div>
                      <div style={{ fontSize: 22, fontWeight: 800 }}>
                        {Number(forecastKpi?.available_capacity_mt || forecastKpi?.total_storage_capacity_mt || 0).toLocaleString()} MT
                      </div>
                    </div>
                    <div style={{ background: 'var(--kq-green-50)', padding: 14, borderRadius: 'var(--kq-radius-md)', border: '1px solid var(--kq-green-200)' }}>
                      <div style={{ fontSize: 11, color: 'var(--kq-green-800)', fontWeight: 600 }}>AVAILABLE STORAGE HEADROOM</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--kq-green-900)' }}>
                        {Number(Math.max(0, (forecastKpi?.available_capacity_mt || 0) - (forecastKpi?.procurement_max_mt || 0))).toLocaleString()} MT
                      </div>
                    </div>
                    <div style={{ background: '#fef2f2', padding: 14, borderRadius: 'var(--kq-radius-md)', border: '1px solid #fecaca' }}>
                      <div style={{ fontSize: 11, color: '#991b1b', fontWeight: 600 }}>RISK CENTRES (OVERFLOW)</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: '#991b1b' }}>
                        {centresForecast.filter(c => c.risk_level === 'HIGH').length || (forecastKpi?.risk_level === 'HIGH' ? 1 : 0)}
                      </div>
                    </div>
                  </div>

                  {/* Centre-wise Demand & Headroom Table */}
                  <h4 style={{ margin: '16px 0 10px', fontSize: 14, color: 'var(--kq-text-primary)' }}>
                    Centre-level Demand Forecast & Capacity Allocation
                  </h4>
                  <DataTable
                    columns={[
                      {
                        key: 'centre_id',
                        header: 'Centre',
                        render: (val, c) => (
                          <div>
                            <strong>{c.centre_name}</strong>
                            <div style={{ fontSize: 11, color: 'var(--kq-text-muted)' }}><code>{val}</code></div>
                          </div>
                        )
                      },
                      {
                        key: 'expected_procurement_max_mt',
                        header: 'Expected Arrivals',
                        render: (val, c) => `${val || c.expected_catchment_mt || 0} MT`
                      },
                      {
                        key: 'available_capacity_mt',
                        header: 'Godown Capacity',
                        render: (val, c) => `${val || c.storage_capacity_mt || 0} MT`
                      },
                      {
                        key: 'projected_pressure_str',
                        header: 'Headroom Pressure',
                        render: (val) => val || 'Normal'
                      },
                      {
                        key: 'risk_level',
                        header: 'Headroom Risk',
                        render: (val, c) => {
                          const risk = c.risk_level || val || 'NORMAL';
                          const badge = risk === 'HIGH' ? '🔴 High Risk' : risk === 'MEDIUM' ? '🟡 Moderate' : '🟢 Safe';
                          return <strong>{badge}</strong>;
                        }
                      }
                    ]}
                    data={pagedForecastCentres}
                  />

                  <Pagination
                    currentPage={demandPage}
                    totalItems={centresForecast.length}
                    pageSize={demandPerPage}
                    onPageChange={setDemandPage}
                  />
                </>
              )}
            </Card>
          </div>
        )}

        {/* ========================================================= */}
        {/* MODULE 6: ASSISTANT (Persistent Q&A Copilot + Simulation) */}
        {/* ========================================================= */}
        {activeTab === 'assistant' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            
            {/* Header & Policy Notice */}
            <Card style={{ padding: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14, marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{
                    width: 42,
                    height: 42,
                    borderRadius: 'var(--kq-radius-md)',
                    background: 'var(--kq-green-100)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    <Icon name="sparkles" size={24} color="var(--kq-green-800)" />
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <h3 style={{ margin: 0, fontSize: 18, color: 'var(--kq-text-primary)' }}>
                        AI District Operations Assistant
                      </h3>
                      <span style={{
                        fontSize: 10,
                        fontWeight: 800,
                        padding: '2px 8px',
                        borderRadius: 12,
                        background: 'var(--kq-green-800)',
                        color: '#ffffff',
                        letterSpacing: '0.05em'
                      }}>
                        READ-ONLY COPILOT
                      </span>
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--kq-text-secondary)', marginTop: 2 }}>
                      Operational decision support grounded on live {officerUser.district} procurement records.
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  {chatHistory.length > 0 && (
                    <SecondaryButton
                      onClick={() => {
                        setChatHistory([]);
                        fetchAiBriefing(true);
                      }}
                      disabled={aiLoading}
                      style={{ fontSize: 12, padding: '6px 12px', gap: 6 }}
                    >
                      <Icon name="trash-2" size={13} /> Reset Thread
                    </SecondaryButton>
                  )}
                  <SecondaryButton
                    onClick={() => fetchAiBriefing(true)}
                    disabled={aiLoading}
                    style={{ fontSize: 12, padding: '6px 12px', gap: 6 }}
                  >
                    <Icon name="refresh-cw" size={13} /> Refresh Briefing
                  </SecondaryButton>
                </div>
              </div>

              {/* Informational Policy Banner */}
              <div style={{
                background: 'var(--kq-green-50)',
                border: '1px solid var(--kq-green-200)',
                padding: '10px 14px',
                borderRadius: 'var(--kq-radius-sm)',
                fontSize: 12,
                color: 'var(--kq-green-900)',
                display: 'flex',
                alignItems: 'center',
                gap: 8
              }}>
                <Icon name="shield" size={16} color="var(--kq-green-800)" />
                <span>
                  <strong>Strict District Scope & Read-Only Governance:</strong> This assistant answers operational questions for {officerUser.district}. Unrelated questions outside procurement operations are strictly filtered.
                </span>
              </div>
            </Card>

            {/* Suggested Prompt Chips */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--kq-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
                Suggested District Queries
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {[
                  { label: '📋 Daily Operational Briefing', q: `Give me today's operational summary and procurement posture for ${officerUser.district} district.` },
                  { label: '⚠️ Unsolved Grievances', q: `give me the center info which didn't solved grievance` },
                  { label: '📍 Nearest Centres', q: `which two centres are closest to each other?` },
                  { label: '🔮 What-If: +20% Arrivals', q: `What if harvest arrivals increase by 20% tomorrow across ${officerUser.district}?`, scenario: { type: 'arrival_change', percentage: 20 } },
                  { label: '⚖️ Grievance SLA Audit', q: `Summarize open farmer grievances and SLA breaches in ${officerUser.district}.` },
                  { label: '⏱️ Pacing Delay Advice', q: `Recommend pacing delay adjustments and grain transport priorities for congested centres.` }
                ].map((chip, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setAiQuery(chip.q);
                      handleAskAi(chip.q, chip.scenario);
                    }}
                    disabled={aiLoading}
                    style={{
                      background: '#ffffff',
                      border: '1px solid var(--kq-green-300)',
                      color: 'var(--kq-green-900)',
                      padding: '6px 14px',
                      borderRadius: 16,
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      boxShadow: 'var(--kq-shadow-sm)'
                    }}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Query Bar */}
            <Card style={{ padding: 16 }}>
              <form onSubmit={(e) => { e.preventDefault(); handleAskAi(); }} style={{ display: 'flex', gap: 10 }}>
                <input
                  type="text"
                  value={aiQuery}
                  onChange={(e) => setAiQuery(e.target.value)}
                  placeholder={`Ask about queues, centres, procurement, grievances, storage, or demand in ${officerUser.district}...`}
                  className="kq-input"
                  style={{ flex: 1, fontSize: 14 }}
                  disabled={aiLoading}
                />
                <PrimaryButton
                  type="submit"
                  disabled={aiLoading || !aiQuery.trim()}
                  style={{ gap: 6, padding: '0 20px', whiteSpace: 'nowrap' }}
                >
                  <Icon name="sparkles" size={16} /> Ask Assistant
                </PrimaryButton>
              </form>
            </Card>

            {/* What-If Scenario Simulation Sandbox */}
            <Card style={{ padding: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <h4 style={{ margin: 0, fontSize: 15, color: 'var(--kq-text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Icon name="trending-up" size={16} color="var(--kq-green-700)" />
                    What-If Operational Scenario Simulation (Zero DB Mutations)
                  </h4>
                  <div style={{ fontSize: 12, color: 'var(--kq-text-muted)', marginTop: 2 }}>
                    Simulate harvest volume shifts, counter staffing, or grain transfers in memory.
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 6 }}>
                  {[
                    { id: 'arrival_change', label: 'Arrival Volume (%)' },
                    { id: 'counter_change', label: 'Weighment Counters (+/-)' },
                    { id: 'reallocation', label: 'Inter-Centre Transfer' }
                  ].map(tab => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setSimType(tab.id)}
                      style={{
                        padding: '5px 12px',
                        fontSize: 12,
                        borderRadius: 14,
                        border: simType === tab.id ? '1px solid var(--kq-green-700)' : '1px solid var(--kq-border-light)',
                        background: simType === tab.id ? 'var(--kq-green-100)' : 'var(--kq-bg-subtle)',
                        color: simType === tab.id ? 'var(--kq-green-900)' : 'var(--kq-text-secondary)',
                        fontWeight: simType === tab.id ? 700 : 500,
                        cursor: 'pointer'
                      }}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Scenario Parameter Controls */}
              <div style={{ background: 'var(--kq-bg-subtle)', padding: 16, borderRadius: 'var(--kq-radius-md)', border: '1px solid var(--kq-border-light)' }}>
                {simType === 'arrival_change' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--kq-text-secondary)', marginBottom: 6 }}>
                        Projected Harvest Arrival Change: <strong>{simArrivalPct > 0 ? `+${simArrivalPct}` : simArrivalPct}%</strong>
                      </label>
                      <input
                        type="range"
                        min="-50"
                        max="100"
                        step="5"
                        value={simArrivalPct}
                        onChange={(e) => setSimArrivalPct(Number(e.target.value))}
                        style={{ width: '100%', cursor: 'pointer' }}
                      />
                    </div>
                    <PrimaryButton
                      type="button"
                      onClick={handleRunSimulation}
                      disabled={aiLoading}
                      style={{ fontSize: 13, padding: '8px 18px' }}
                    >
                      Simulate Arrival Impact
                    </PrimaryButton>
                  </div>
                )}

                {simType === 'counter_change' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--kq-text-secondary)', marginBottom: 6 }}>
                        Adjust Active Counters Per Centre:
                      </label>
                      <div style={{ display: 'flex', gap: 10 }}>
                        {[-1, 1, 2, 3].map(d => (
                          <button
                            key={d}
                            type="button"
                            onClick={() => setSimCounterDelta(d)}
                            style={{
                              padding: '6px 16px',
                              borderRadius: 'var(--kq-radius-sm)',
                              border: simCounterDelta === d ? '2px solid var(--kq-green-700)' : '1px solid var(--kq-border-medium)',
                              background: simCounterDelta === d ? 'var(--kq-green-50)' : '#ffffff',
                              color: simCounterDelta === d ? 'var(--kq-green-900)' : 'var(--kq-text-primary)',
                              fontWeight: simCounterDelta === d ? 700 : 500,
                              cursor: 'pointer'
                            }}
                          >
                            {d > 0 ? `+${d}` : d} Counter{Math.abs(d) > 1 ? 's' : ''}
                          </button>
                        ))}
                      </div>
                    </div>
                    <PrimaryButton
                      type="button"
                      onClick={handleRunSimulation}
                      disabled={aiLoading}
                      style={{ fontSize: 13, padding: '8px 18px' }}
                    >
                      Simulate Counter Impact
                    </PrimaryButton>
                  </div>
                )}

                {simType === 'reallocation' && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, alignItems: 'end' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--kq-text-secondary)', marginBottom: 4 }}>
                        Source Centre:
                      </label>
                      <select
                        value={simSourceCentre}
                        onChange={(e) => setSimSourceCentre(e.target.value)}
                        className="kq-select"
                        style={{ width: '100%', fontSize: 13 }}
                      >
                        {centresData.map(c => (
                          <option key={c.centre_id} value={c.centre_id}>
                            {c.centre_name} ({c.centre_id})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--kq-text-secondary)', marginBottom: 4 }}>
                        Target Centre:
                      </label>
                      <select
                        value={simTargetCentre}
                        onChange={(e) => setSimTargetCentre(e.target.value)}
                        className="kq-select"
                        style={{ width: '100%', fontSize: 13 }}
                      >
                        {centresData.map(c => (
                          <option key={c.centre_id} value={c.centre_id}>
                            {c.centre_name} ({c.centre_id})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--kq-text-secondary)', marginBottom: 4 }}>
                        Volume (MT):
                      </label>
                      <input
                        type="number"
                        min="5"
                        max="200"
                        value={simQuantityMt}
                        onChange={(e) => setSimQuantityMt(Number(e.target.value))}
                        className="kq-input"
                        style={{ width: '100%', fontSize: 13 }}
                      />
                    </div>

                    <PrimaryButton
                      type="button"
                      onClick={handleRunSimulation}
                      disabled={aiLoading}
                      style={{ fontSize: 13, padding: '8px 18px', height: 38 }}
                    >
                      Simulate Transfer
                    </PrimaryButton>
                  </div>
                )}
              </div>
            </Card>

            {/* Conversation Thread (Guarantees Question Never Clears or Vanishes) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {chatHistory.map((item) => (
                <div
                  key={item.id}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                    padding: 18,
                    background: '#ffffff',
                    borderRadius: 'var(--kq-radius-md)',
                    border: '1px solid var(--kq-border-light)',
                    boxShadow: 'var(--kq-shadow-sm)'
                  }}
                >
                  {/* User Question Card */}
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '10px 14px',
                    background: 'var(--kq-bg-subtle)',
                    borderRadius: 'var(--kq-radius-sm)',
                    border: '1px solid var(--kq-border-light)'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{
                        padding: '3px 8px',
                        borderRadius: 4,
                        background: 'var(--kq-green-800)',
                        color: '#ffffff',
                        fontSize: 11,
                        fontWeight: 800,
                        letterSpacing: '0.04em'
                      }}>
                        OFFICER QUERY
                      </span>
                      <strong style={{ fontSize: 14, color: 'var(--kq-text-primary)' }}>{item.query}</strong>
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--kq-text-muted)' }}>
                      {formatHumanTime(item.timestamp)}
                    </span>
                  </div>

                  {/* AI Structured Response */}
                  <OfficerAiStructuredView
                    response={item.response}
                    onNavigateTab={(tab) => setActiveTab(tab)}
                    onSelectPrompt={(text) => {
                      setAiQuery(text);
                      handleAskAi(text);
                    }}
                  />
                </div>
              ))}

              {/* In-Flight Loading State */}
              {aiLoading && (
                <div style={{ padding: 20, background: '#ffffff', borderRadius: 'var(--kq-radius-md)', border: '1px solid var(--kq-border-light)' }}>
                  <LoadingState message="Grounding query in live district operational data..." />
                </div>
              )}

              {/* Error Display */}
              {aiError && (
                <AlertBanner
                  type="error"
                  title="AI Operations Assistant Notice"
                  message={aiError}
                />
              )}
            </div>

          </div>
        )}

      </div>

      {/* ========================================================= */}
      {/* 3. CLOSED CENTRE CONFIRMATION MODAL                      */}
      {/* ========================================================= */}
      <Modal
        isOpen={openModalOpen}
        onClose={() => {
          if (!openLoading) {
            setOpenModalOpen(false);
            setCentreToOpen(null);
            setOpenError('');
          }
        }}
        title="Open this procurement centre?"
        subtitle="Opening this centre will make it available for new farmer bookings."
        maxWidth={500}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {openError && (
            <AlertBanner type="error" message={openError} />
          )}

          <div style={{ background: 'var(--kq-bg-subtle)', padding: 12, borderRadius: 'var(--kq-radius-md)', border: '1px solid var(--kq-border-light)' }}>
            <div style={{ fontSize: 12, color: 'var(--kq-text-muted)' }}>Centre</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--kq-text-primary)' }}>
              {centreToOpen?.centre_name || centreToOpen?.centre_id}
            </div>
            <div style={{ fontSize: 12, color: 'var(--kq-text-secondary)', marginTop: 2 }}>
              ID: <code>{centreToOpen?.centre_id}</code> • District: {officerUser?.district}
            </div>
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--kq-text-muted)' }}>Current Status:</span>
              <StatusBadge status="Closed" size="sm" />
            </div>
          </div>

          <FormField label="Opening Date & Time" required>
            <input
              type="datetime-local"
              className="kq-input"
              value={openForm.opening_date}
              onChange={e => setOpenForm({ ...openForm, opening_date: e.target.value })}
              required
            />
          </FormField>

          <FormField label="Reason for Opening" required>
            <select
              className="kq-select"
              value={openForm.reason}
              onChange={e => setOpenForm({ ...openForm, reason: e.target.value })}
            >
              <option value="Scheduled season opening">Scheduled season opening</option>
              <option value="Storage capacity restored">Storage capacity restored</option>
              <option value="Officer assigned">Officer assigned</option>
              <option value="Operational readiness verified">Operational readiness verified</option>
              <option value="Farmer demand surge">Farmer demand surge</option>
              <option value="Administrative directive">Administrative directive</option>
            </select>
          </FormField>

          <FormField label="Optional Officer Note">
            <textarea
              className="kq-textarea"
              rows={3}
              placeholder="e.g. Cleared godown space. Assigned weighment scales and moisture inspector for paddy intake."
              value={openForm.notes}
              onChange={e => setOpenForm({ ...openForm, notes: e.target.value })}
            />
          </FormField>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
            <SecondaryButton
              type="button"
              onClick={() => {
                setOpenModalOpen(false);
                setCentreToOpen(null);
                setOpenError('');
              }}
              disabled={openLoading}
            >
              Cancel
            </SecondaryButton>
            <PrimaryButton
              type="button"
              onClick={handleConfirmOpenCentre}
              disabled={openLoading}
            >
              {openLoading ? 'Opening Centre...' : 'Open Centre'}
            </PrimaryButton>
          </div>
        </div>
      </Modal>

      {/* ========================================================= */}
      {/* 4. CENTRE DETAIL & AUDIT HISTORY DRAWER                   */}
      {/* ========================================================= */}
      <Drawer
        isOpen={!!selectedCentre}
        onClose={() => {
          setSelectedCentre(null);
          setCentreAuditHistory([]);
        }}
        title={`Centre Details: ${selectedCentre?.centre_name || selectedCentre?.centre_id}`}
        width={560}
      >
        {selectedCentre && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            
            {/* Operational Status Banner */}
            <div style={{
              padding: 14,
              borderRadius: 'var(--kq-radius-md)',
              background: selectedCentre.operational_status === 'Closed' ? '#f8fafc' : 'var(--kq-green-50)',
              border: selectedCentre.operational_status === 'Closed' ? '1px solid #cbd5e1' : '1px solid var(--kq-green-200)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--kq-text-muted)' }}>CURRENT OPERATIONAL STATUS</div>
                <div style={{ fontSize: 16, fontWeight: 800, marginTop: 2 }}>
                  <StatusBadge status={selectedCentre.operational_status} size="md" />
                </div>
              </div>

              {selectedCentre.operational_status === 'Closed' && (
                <PrimaryButton
                  onClick={() => handlePromptOpenCentre(selectedCentre)}
                  style={{ fontSize: 12, padding: '6px 14px' }}
                >
                  Open Centre
                </PrimaryButton>
              )}
            </div>

            {/* Centre Properties */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={{ background: 'var(--kq-bg-subtle)', padding: 12, borderRadius: 'var(--kq-radius-sm)' }}>
                <div style={{ fontSize: 11, color: 'var(--kq-text-muted)' }}>CENTRE ID</div>
                <div style={{ fontWeight: 700, fontSize: 13 }}><code>{selectedCentre.centre_id}</code></div>
              </div>
              <div style={{ background: 'var(--kq-bg-subtle)', padding: 12, borderRadius: 'var(--kq-radius-sm)' }}>
                <div style={{ fontSize: 11, color: 'var(--kq-text-muted)' }}>DISTRICT</div>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{selectedCentre.district}</div>
              </div>
              <div style={{ background: 'var(--kq-bg-subtle)', padding: 12, borderRadius: 'var(--kq-radius-sm)' }}>
                <div style={{ fontSize: 11, color: 'var(--kq-text-muted)' }}>WAITING FARMERS</div>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{selectedCentre.operational_status === 'Closed' ? '— (Closed)' : `${selectedCentre.waiting_farmers || 0} farmers`}</div>
              </div>
              <div style={{ background: 'var(--kq-bg-subtle)', padding: 12, borderRadius: 'var(--kq-radius-sm)' }}>
                <div style={{ fontSize: 11, color: 'var(--kq-text-muted)' }}>ESTIMATED WAIT</div>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{selectedCentre.operational_status === 'Closed' ? '— (Closed)' : (selectedCentre.estimated_wait_minutes ? `${selectedCentre.estimated_wait_minutes} min` : 'Nominal')}</div>
              </div>
              <div style={{ background: 'var(--kq-bg-subtle)', padding: 12, borderRadius: 'var(--kq-radius-sm)' }}>
                <div style={{ fontSize: 11, color: 'var(--kq-text-muted)' }}>STORAGE CAPACITY</div>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{selectedCentre.storage_capacity_mt || 0} MT</div>
              </div>
              <div style={{ background: 'var(--kq-bg-subtle)', padding: 12, borderRadius: 'var(--kq-radius-sm)' }}>
                <div style={{ fontSize: 11, color: 'var(--kq-text-muted)' }}>CURRENT STOCK</div>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{selectedCentre.current_stock_mt || 0} MT ({selectedCentre.storage_used_pct || 0}%)</div>
              </div>
            </div>

            {/* Audit History (CENTRE STATUS AUDIT) */}
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--kq-text-primary)', marginBottom: 8 }}>
                Centre Status History & Audit Log
              </div>
              {loadingAudit ? (
                <LoadingState message="Loading status history..." />
              ) : centreAuditHistory.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--kq-text-muted)', padding: 12, background: 'var(--kq-bg-subtle)', borderRadius: 'var(--kq-radius-sm)' }}>
                  No recent status change events recorded for this centre.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {centreAuditHistory.map(audit => (
                    <div
                      key={audit.id}
                      style={{
                        padding: 10,
                        border: '1px solid var(--kq-border-light)',
                        borderRadius: 'var(--kq-radius-sm)',
                        background: '#ffffff',
                        fontSize: 12
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <div>
                          <span style={{ color: 'var(--kq-text-muted)' }}>{audit.previous_status || 'Initial'}</span>
                          <span style={{ margin: '0 6px' }}>→</span>
                          <StatusBadge status={audit.new_status} size="sm" />
                        </div>
                        <div style={{ color: 'var(--kq-text-muted)', fontSize: 11 }}>
                          {formatHumanDate(audit.changed_at)} {formatHumanTime(audit.changed_at)}
                        </div>
                      </div>
                      <div>
                        <strong>Changed by:</strong> {audit.changed_by}
                      </div>
                      <div>
                        <strong>Reason:</strong> {audit.reason || 'Operational update'}
                      </div>
                      {audit.notes && (
                        <div style={{ color: 'var(--kq-text-secondary)', marginTop: 4, fontStyle: 'italic' }}>
                          "{audit.notes}"
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        )}
      </Drawer>

      {/* ========================================================= */}
      {/* 5. GRIEVANCE TICKETS DRAWER                               */}
      {/* ========================================================= */}
      <Drawer
        isOpen={!!selectedGrievanceCentre}
        onClose={() => {
          setSelectedGrievanceCentre(null);
          setCentreGrievancesList([]);
        }}
        title={`Grievance Tickets: ${selectedGrievanceCentre?.centre_name || selectedGrievanceCentre?.centre_id}`}
        width={560}
      >
        {loadingCentreGrievances ? (
          <LoadingState message="Loading Centre Grievances..." />
        ) : centreGrievancesList.length === 0 ? (
          <EmptyState icon="message-square" title="No registered grievances" description="There are no tickets on file for this procurement centre." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {centreGrievancesList.map(g => (
              <div
                key={g.grievance_id}
                style={{
                  border: g.accountability_status === 'SLA Breached' ? '2px solid var(--kq-red-500)' : '1px solid var(--kq-border-medium)',
                  borderRadius: 'var(--kq-radius-md)',
                  padding: 14,
                  background: '#ffffff'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong>Ticket #{g.grievance_id} • {g.issue_type}</strong>
                  <StatusBadge status={g.accountability_status || g.status} size="sm" />
                </div>
                <div style={{ fontSize: 12, color: 'var(--kq-text-secondary)', marginTop: 6 }}>
                  {g.description}
                </div>
                <div style={{ fontSize: 11, color: 'var(--kq-text-muted)', marginTop: 8, display: 'flex', justifyContent: 'space-between' }}>
                  <span>Created: {formatHumanDate(g.created_at)}</span>
                  <span>SLA: {formatHumanDate(g.sla_deadline)}</span>
                </div>
                {g.resolution_notes && (
                  <div style={{ marginTop: 8, padding: 8, background: 'var(--kq-green-50)', borderRadius: 4, fontSize: 11, color: 'var(--kq-green-900)' }}>
                    <strong>Response:</strong> {g.resolution_notes}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Drawer>

    </div>
  );
}
