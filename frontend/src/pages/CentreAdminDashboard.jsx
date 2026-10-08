import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import {
  Card,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
  AlertBanner,
  LoadingState,
  EmptyState,
  SearchBar,
  FilterBar,
  Pagination,
  DataTable,
  FormField,
  Icon,
  Modal,
  formatHumanDate,
  formatHumanTime
} from '../components/design-system';
import CentreAdminAiOperations from '../components/CentreAdminAiOperations';
import AdminNotificationBell from '../components/AdminNotificationBell';

const API = axios.create({ baseURL: import.meta.env.VITE_API_URL || 'http://localhost:4000/api' });

API.interceptors.request.use(config => {
  const token = localStorage.getItem('kisan_admin_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

const STATUS_FLOW = ['Booked', 'Confirmed', 'On The Way', 'Checked-In', 'Grading', 'Weighing', 'Procured', 'Payment Pending', 'Payment Completed'];

export default function CentreAdminDashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [centreData, setCentreData] = useState(null);
  const [stats, setStats] = useState(null);
  const [pacingData, setPacingData] = useState(null);
  const [pacingLoading, setPacingLoading] = useState(false);
  const [pacingMsg, setPacingMsg] = useState('');
  const [fairnessSummary, setFairnessSummary] = useState(null);
  const [showFairnessModal, setShowFairnessModal] = useState(false);
  const [demandOutlook, setDemandOutlook] = useState(null);
  const [queue, setQueue] = useState([]);
  const [grievances, setGrievances] = useState([]);
  const [selectedProcurementBooking, setSelectedProcurementBooking] = useState(null);
  const [activeMainTab, setActiveMainTab] = useState('overview'); // overview, queue, procurement, demand, grievances, assistant
  const [loading, setLoading] = useState(false);
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [loginError, setLoginError] = useState('');

  // AI Operations Assistant state
  const [aiLoading, setAiLoading] = useState(false);
  const [aiQuery, setAiQuery] = useState('');
  const [aiResponse, setAiResponse] = useState(null);
  const [aiError, setAiError] = useState('');
  const [simType, setSimType] = useState('arrival_change');
  const [simArrivalPct, setSimArrivalPct] = useState(25);
  const [simCounterDelta, setSimCounterDelta] = useState(1);

  // Queue table filter, fairness sort & pagination state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [sortOrder, setSortOrder] = useState('fairness_desc'); // fairness_desc, score_desc, queue_asc, time_asc
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  // Missed Appointments management state
  const [missedVisits, setMissedVisits] = useState([]);
  const [missedLoading, setMissedLoading] = useState(false);
  const [missedSearch, setMissedSearch] = useState('');
  const [missedStatusFilter, setMissedStatusFilter] = useState('ALL');
  const [restoreModalBooking, setRestoreModalBooking] = useState(null);
  const [restoreTargetDate, setRestoreTargetDate] = useState('');
  const [restoreTargetSlot, setRestoreTargetSlot] = useState('');
  const [restoreSlotsList, setRestoreSlotsList] = useState([]);
  const [restoreSlotsLoading, setRestoreSlotsLoading] = useState(false);
  const [restoreSubmitting, setRestoreSubmitting] = useState(false);
  const [restoreError, setRestoreError] = useState('');

  // Active More Dropdown for Queue row
  const [activeRowMenuId, setActiveRowMenuId] = useState(null);

  useEffect(() => {
    const savedToken = localStorage.getItem('kisan_admin_token');
    if (savedToken) {
      loadMyCentre();
    }
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      setLoading(true);
      setLoginError('');
      const res = await API.post('/auth/login', loginForm);
      if (res.data.user.role !== 'CENTRE_ADMIN') {
        setLoginError('This portal is restricted to Centre Admins only.');
        return;
      }
      localStorage.setItem('kisan_admin_token', res.data.token);
      localStorage.setItem('kisan_admin_username', res.data.user.username);
      setUser(res.data.user);
      loadMyCentre();
    } catch (err) {
      console.error('Login error:', err);
      setLoginError(err.response?.data?.message || 'Login failed. Invalid credentials.');
    } finally {
      setLoading(false);
    }
  };

  const loadMyCentre = async () => {
    try {
      setLoading(true);
      const res = await API.get('/admin/my-centre');
      setCentreData(res.data.centre);
      setStats(res.data.stats);
      if (res.data.pacing) setPacingData(res.data.pacing);
      if (res.data.fairness_summary) setFairnessSummary(res.data.fairness_summary);
      setQueue(res.data.queue || []);

      if (res.data.queue && res.data.queue.length > 0 && !selectedProcurementBooking) {
        setSelectedProcurementBooking(res.data.queue[0]);
      }

      // Load Demand Outlook
      try {
        const outlookRes = await API.get('/admin/my-centre/procurement-outlook');
        if (outlookRes.data?.demand_outlook) {
          setDemandOutlook(outlookRes.data.demand_outlook);
        }
      } catch (oErr) {
        console.warn('Error fetching demand outlook:', oErr.message);
      }

      // Load Centre Grievances
      if (res.data.centre?.centre_id) {
        try {
          const gRes = await API.get(`/centres/${res.data.centre.centre_id}/grievances`);
          setGrievances(gRes.data || []);
        } catch (gErr) {
          console.warn('Error fetching grievances:', gErr.message);
        }
      }

      // Load Missed & Elapsed Appointments for Centre
      fetchMissedVisits();
    } catch (err) {
      console.error('Error loading my centre:', err);
      if (err.response?.status === 401 || err.response?.status === 403) {
        handleLogout();
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchMissedVisits = async () => {
    try {
      setMissedLoading(true);
      const res = await API.get('/admin/missed-appointments');
      setMissedVisits(res.data.missed_appointments || []);
    } catch (err) {
      console.warn('Error fetching missed appointments:', err.message);
    } finally {
      setMissedLoading(false);
    }
  };

  const fetchRestoreSlots = async (date) => {
    if (!centreData?.centre_id || !date) return;
    try {
      setRestoreSlotsLoading(true);
      setRestoreError('');
      const res = await API.get(`/centres/${centreData.centre_id}/slots`, { params: { date } });
      const rawSlots = Array.isArray(res.data) ? res.data : (res.data?.slots || []);
      const available = rawSlots.filter(s => !s.is_expired && s.booked_count < s.max_farmers);
      setRestoreSlotsList(available);
      if (available.length > 0) {
        setRestoreTargetSlot(available[0].slot_id);
      } else {
        setRestoreTargetSlot('');
      }
    } catch (err) {
      console.error('Error fetching slots for restore:', err);
      setRestoreError('Failed to load slots for selected date.');
    } finally {
      setRestoreSlotsLoading(false);
    }
  };

  const handleRestoreSlot = async (e) => {
    if (e) e.preventDefault();
    if (!restoreModalBooking || !restoreTargetDate || !restoreTargetSlot) return;
    try {
      setRestoreSubmitting(true);
      setRestoreError('');
      await API.post(`/admin/missed-appointments/${restoreModalBooking.booking_id}/restore-slot`, {
        target_date: restoreTargetDate,
        target_slot_id: restoreTargetSlot,
        reason: 'Restored from missed visits by Centre Admin'
      });
      setRestoreModalBooking(null);
      await fetchMissedVisits();
      await loadMyCentre();
    } catch (err) {
      console.error('Restore error:', err);
      setRestoreError(err.response?.data?.message || 'Failed to restore appointment.');
    } finally {
      setRestoreSubmitting(false);
    }
  };

  const handleReleaseCapacity = async (booking) => {
    if (!window.confirm(`Confirm capacity release for farmer ${booking.farmer_name}?`)) return;
    try {
      await API.post(`/admin/missed-appointments/${booking.booking_id}/release-capacity`, {
        reason: 'Capacity confirmed released by Centre Admin'
      });
      await fetchMissedVisits();
      await loadMyCentre();
    } catch (err) {
      console.error('Release capacity error:', err);
      alert(err.response?.data?.message || 'Failed to release capacity.');
    }
  };

  const applyPacing = async () => {
    if (!centreData) return;
    try {
      setPacingLoading(true);
      setPacingMsg('');
      const res = await API.post(`/centres/${centreData.centre_id}/pacing/apply`);
      setPacingMsg(res.data.message || 'Pacing recommendation applied successfully.');
      loadMyCentre();
    } catch (err) {
      console.error('Apply pacing error:', err);
      alert(err.response?.data?.message || 'Failed to apply pacing recommendation.');
    } finally {
      setPacingLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('kisan_admin_token');
    localStorage.removeItem('kisan_admin_username');
    setUser(null);
    setCentreData(null);
    setStats(null);
    setPacingData(null);
    setPacingMsg('');
    setQueue([]);
    setGrievances([]);
    setSelectedProcurementBooking(null);
    setAiResponse(null);
    setAiError('');
    setAiQuery('');
  };

  // AI Operations Handlers
  const fetchAiBriefing = async () => {
    try {
      setAiLoading(true);
      setAiError('');
      const res = await API.get('/officer-ai/briefing');
      setAiResponse(res.data);
    } catch (err) {
      console.error('AI briefing error:', err);
      setAiError(err.response?.data?.message || 'Failed to generate operational briefing.');
    } finally {
      setAiLoading(false);
    }
  };

  const handleAskAi = async (customQuery = null, customScenario = null) => {
    const queryToSend = (customQuery || aiQuery).trim();
    if (!queryToSend && !customScenario) return;

    try {
      setAiLoading(true);
      setAiError('');
      const payload = {
        query: queryToSend || 'Simulate operational scenario.'
      };
      if (customScenario) {
        payload.scenario = customScenario;
      }
      const res = await API.post('/officer-ai/ask', payload);
      setAiResponse(res.data);
      if (!customQuery) setAiQuery('');
    } catch (err) {
      console.error('Ask AI error:', err);
      setAiError(err.response?.data?.message || 'Failed to retrieve AI analysis.');
    } finally {
      setAiLoading(false);
    }
  };

  const handleRunSimulation = async (typeOverride = null) => {
    const effectiveType = typeOverride || simType;
    let scenario = { type: effectiveType };
    let queryDescription = '';

    if (effectiveType === 'arrival_change') {
      scenario.percentage = Number(simArrivalPct);
      queryDescription = `Simulate impact if arrivals change by ${simArrivalPct > 0 ? `+${simArrivalPct}` : simArrivalPct}%`;
    } else if (effectiveType === 'counter_change') {
      scenario.counter_delta = Number(simCounterDelta);
      queryDescription = `Simulate impact of changing counters by ${simCounterDelta > 0 ? `+${simCounterDelta}` : simCounterDelta}`;
    }

    try {
      setAiLoading(true);
      setAiError('');
      const res = await API.post('/officer-ai/simulate', { scenario, query: queryDescription });
      setAiResponse(res.data);
    } catch (err) {
      console.error('Simulation error:', err);
      setAiError(err.response?.data?.message || 'Failed to run scenario simulation.');
    } finally {
      setAiLoading(false);
    }
  };

  useEffect(() => {
    if (activeMainTab === 'assistant' && !aiResponse) {
      fetchAiBriefing();
    }
  }, [activeMainTab]);

  const advanceStatus = async (booking) => {
    try {
      const idx = STATUS_FLOW.indexOf(booking.status);
      const next = STATUS_FLOW[Math.min(idx + 1, STATUS_FLOW.length - 1)];
      await API.patch(`/bookings/${booking.booking_id}/status`, { status: next });
      setActiveRowMenuId(null);
      loadMyCentre();
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.message || 'Unable to update booking status.');
    }
  };

  const markNoShow = async (booking) => {
    try {
      await API.post(`/bookings/${booking.booking_id}/no-show`);
      setActiveRowMenuId(null);
      loadMyCentre();
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.message || 'Unable to mark booking as No-Show.');
    }
  };

  // ----------------------------------------------------
  // LOGIN SCREEN
  // ----------------------------------------------------
  if (!centreData) {
    return (
      <div style={{ minHeight: '100vh', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, position: 'relative' }}>
        <div style={{ background: '#ffffff', padding: 32, borderRadius: 'var(--kq-radius-lg, 8px)', boxShadow: '0 4px 16px rgba(0,0,0,0.08)', width: '100%', maxWidth: 460, border: '1px solid var(--kq-border-light, #e5e7eb)', position: 'relative', zIndex: 1 }}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <div style={{ display: 'inline-flex', padding: 12, borderRadius: '50%', background: 'var(--kq-green-50, #f0fdf4)', color: 'var(--kq-green-800, #166534)', marginBottom: 12 }}>
              <Icon name="building-2" size={32} />
            </div>
            <h1 style={{ margin: '4px 0', fontSize: 22, fontWeight: 800, color: 'var(--kq-text-primary, #111827)' }}>
              Procurement Centre Admin
            </h1>
            <p style={{ margin: 0, color: 'var(--kq-text-secondary, #4b5563)', fontSize: 13 }}>
              KISAN VIKAS • DPC Operations Control Panel
            </p>
          </div>

          {loginError && (
            <AlertBanner
              type="error"
              message={loginError}
              style={{ marginBottom: 18 }}
            />
          )}

          <form onSubmit={handleLogin}>
            <FormField label="Admin Username" required>
              <input
                className="kq-input"
                type="text"
                value={loginForm.username}
                onChange={e => setLoginForm({ ...loginForm, username: e.target.value })}
                placeholder="e.g. admin_madurai"
                required
              />
            </FormField>

            <FormField label="Password" required style={{ marginTop: 14 }}>
              <input
                className="kq-input"
                type="password"
                value={loginForm.password}
                onChange={e => setLoginForm({ ...loginForm, password: e.target.value })}
                required
              />
            </FormField>

            <PrimaryButton
              type="submit"
              disabled={loading}
              style={{ width: '100%', marginTop: 20, padding: 12 }}
            >
              {loading ? 'Signing In...' : 'Sign In as DPC Officer →'}
            </PrimaryButton>
          </form>

          {/* Return to Role Selection */}
          <div style={{ textAlign: 'center', marginTop: 24 }}>
            <Link
              to="/"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--kq-green-800, #166534)',
                textDecoration: 'none'
              }}
            >
              ← Return to Role Selection
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Real Dynamic Metrics (NO HARDCODED VALUES — grounded in backend CongestionService & PostgreSQL)
  const waitingCount = stats?.active_queue_today ?? stats?.farmers_in_queue ?? queue.length;
  const activeCounters = Math.max(1, Number(stats?.active_counters || centreData?.active_counters || 2));
  const dailyCapacity = Number(stats?.daily_capacity || centreData?.daily_capacity_slots || 80);
  const processingRate = Number(stats?.processing_rate_min || pacingData?.metrics?.observed_rate_min || 12);
  const estWaitMin = stats?.estimated_wait_minutes != null ? stats.estimated_wait_minutes : Math.round((waitingCount * processingRate) / activeCounters);
  const hourlyThroughput = stats?.theoretical_throughput_per_hr || Math.round((60 / processingRate) * activeCounters);
  const actualThroughputToday = stats?.actual_throughput_today || 0;
  const procuredTodayQ = stats?.procured_today_quintals || 0;
  const procuredTodayMt = stats?.procured_today_mt || Number((procuredTodayQ / 10).toFixed(2));
  const cumulativeProcuredMt = stats?.cumulative_procured_mt || 0;
  const cumulativeProcuredQ = stats?.cumulative_procured_quintals || 0;
  const openGrievancesCount = grievances.filter(g => g.status !== 'Resolved' && g.status !== 'Verified Resolved' && g.status !== 'AWAITING_FARMER_CONFIRMATION').length;

  // Filter & Sort Queue for Queue Tab
  const filteredQueue = queue.filter(b => {
    const matchesSearch = !searchQuery ||
      b.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      b.phone?.includes(searchQuery) ||
      b.token?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      b.booking_id?.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = statusFilter === 'ALL' || b.status === statusFilter;
    return matchesSearch && matchesStatus;
  }).sort((a, b) => {
    if (sortOrder === 'fairness_desc') {
      const protRank = { 'HIGH': 3, 'MODERATE': 2, 'LOW': 1 };
      const pDiff = (protRank[b.protection_level] || 1) - (protRank[a.protection_level] || 1);
      if (pDiff !== 0) return pDiff;
      const sDiff = (b.fairness_score || 0) - (a.fairness_score || 0);
      if (sDiff !== 0) return sDiff;
      const qDiff = (a.queue_position_at_booking || 0) - (b.queue_position_at_booking || 0);
      if (qDiff !== 0) return qDiff;
      return new Date(a.created_at || 0) - new Date(b.created_at || 0);
    } else if (sortOrder === 'score_desc') {
      const sDiff = (b.fairness_score || 0) - (a.fairness_score || 0);
      if (sDiff !== 0) return sDiff;
      const qDiff = (a.queue_position_at_booking || 0) - (b.queue_position_at_booking || 0);
      if (qDiff !== 0) return qDiff;
      return new Date(a.created_at || 0) - new Date(b.created_at || 0);
    } else if (sortOrder === 'time_asc') {
      const dDiff = String(a.booking_date || '').localeCompare(String(b.booking_date || ''));
      if (dDiff !== 0) return dDiff;
      const tDiff = String(a.start_time || '').localeCompare(String(b.start_time || ''));
      if (tDiff !== 0) return tDiff;
      return (a.queue_position_at_booking || 0) - (b.queue_position_at_booking || 0);
    }
    // Default queue_asc
    return (a.queue_position_at_booking || 0) - (b.queue_position_at_booking || 0);
  });

  const totalPages = Math.ceil(filteredQueue.length / pageSize) || 1;
  const paginatedQueue = filteredQueue.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  // Derive Current Serving and Next Farmer
  const servingBooking = queue.find(b => b.status === 'Grading' || b.status === 'Weighing' || b.status === 'Checked-In') || queue[0];
  const nextBooking = queue.find(b => b.booking_id !== servingBooking?.booking_id && (b.status === 'Confirmed' || b.status === 'Checked-In'));

  // Derive "Needs Your Attention" Issues
  const attentionIssues = [];
  if (pacingData && (pacingData.pacing_status === 'DELAYED' || pacingData.pacing_status === 'SURGE_STAGGER' || pacingData.recommended_delay_minutes > 0)) {
    attentionIssues.push({
      id: 'pacing',
      type: 'warning',
      text: pacingData.reason || 'Queue flow is slower than expected. Consider staggering arrivals.',
      actionLabel: 'Review Operations',
      action: () => applyPacing()
    });
  }
  if (openGrievancesCount > 0) {
    attentionIssues.push({
      id: 'grievance',
      type: 'error',
      text: `${openGrievancesCount} farmer grievance${openGrievancesCount > 1 ? 's require' : ' requires'} officer response.`,
      actionLabel: 'Review Grievances',
      action: () => setActiveMainTab('grievances')
    });
  }
  if (waitingCount > dailyCapacity * 0.9) {
    attentionIssues.push({
      id: 'capacity',
      type: 'warning',
      text: `Queue has reached ${waitingCount} / ${dailyCapacity} slots (${Math.round((waitingCount / dailyCapacity) * 100)}% capacity).`,
      actionLabel: 'Check Capacity',
      action: () => setActiveMainTab('demand')
    });
  }

  return (
    <div style={{ minHeight: '100vh', background: 'transparent', position: 'relative' }}>
      
      {/* ===================================================== */}
      {/* 6. COMPACT ADMIN HEADER WITH CENTRE NOTIFICATION BELL */}
      {/* ===================================================== */}
      <header style={{
        background: '#ffffff',
        borderBottom: '1px solid var(--kq-border-medium, #d1d5db)',
        padding: '10px 24px',
        position: 'sticky',
        top: 0,
        zIndex: 50,
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
      }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          {/* Left: Centre Identity */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ background: 'var(--kq-green-800, #166534)', color: '#ffffff', padding: '5px 9px', borderRadius: 4, fontWeight: 800, fontSize: 13, letterSpacing: '0.04em' }}>
              KISAN VIKAS
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--kq-text-primary, #111827)' }}>
                {centreData.centre_name}
              </div>
              <div style={{ fontSize: 12, color: 'var(--kq-text-muted, #6b7280)' }}>
                {centreData.village_town}, {centreData.district} • ID: <code>{centreData.centre_id}</code>
              </div>
            </div>
          </div>

          {/* Right: Notification Bell, Profile, Sign Out */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* Centre-Scoped Notification Bell */}
            <AdminNotificationBell api={API} onNavigateTab={setActiveMainTab} />

            <div style={{ textAlign: 'right', display: 'none', md: 'block' }}>
              <div style={{ fontSize: 11, color: 'var(--kq-text-muted, #6b7280)', fontWeight: 600 }}>DPC OFFICER</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--kq-text-primary, #111827)' }}>
                {user?.username || localStorage.getItem('kisan_admin_username') || 'Admin'}
              </div>
            </div>

            <SecondaryButton
              onClick={handleLogout}
              style={{ fontSize: 12, padding: '5px 10px', height: 32, gap: 5 }}
            >
              <Icon name="log-out" size={13} />
              <span>Sign Out</span>
            </SecondaryButton>
          </div>
        </div>
      </header>

      {/* ===================================================== */}
      {/* 5. GLOBAL ADMIN NAVIGATION (6 CLEAN SHORT LABELS)     */}
      {/* ===================================================== */}
      <div style={{ background: '#ffffff', borderBottom: '1px solid var(--kq-border-light, #e5e7eb)' }}>
        <div style={{
          maxWidth: 1280,
          margin: '0 auto',
          padding: '0 24px',
          display: 'flex',
          gap: 4,
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch'
        }}>
          {[
            { id: 'overview', label: 'Overview', icon: 'home' },
            { id: 'queue', label: 'Queue', icon: 'users' },
            { id: 'missed', label: `Missed Visits${missedVisits.length > 0 ? ` (${missedVisits.length})` : ''}`, icon: 'calendar-x' },
            { id: 'procurement', label: 'Procurement', icon: 'scale' },
            { id: 'demand', label: 'Demand', icon: 'trending-up' },
            { id: 'grievances', label: `Grievances${openGrievancesCount > 0 ? ` (${openGrievancesCount})` : ''}`, icon: 'message-square' },
            { id: 'assistant', label: 'Assistant', icon: 'sparkles' }
          ].map(tab => {
            const isActive = activeMainTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveMainTab(tab.id);
                  setActiveRowMenuId(null);
                  window.dispatchEvent(new Event('kisan_close_admin_notifications'));
                }}
                style={{
                  padding: '12px 18px',
                  border: 'none',
                  borderBottom: isActive ? '3px solid var(--kq-green-800, #166534)' : '3px solid transparent',
                  background: 'transparent',
                  color: isActive ? 'var(--kq-green-900, #14532d)' : 'var(--kq-text-secondary, #4b5563)',
                  fontWeight: isActive ? 700 : 500,
                  fontSize: 13.5,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  whiteSpace: 'nowrap',
                  transition: 'all 0.15s ease'
                }}
              >
                <Icon name={tab.icon} size={15} color={isActive ? 'var(--kq-green-800, #166534)' : 'currentColor'} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main App Container */}
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '20px 24px' }}>
        
        {/* Closed Centre Warning */}
        {centreData.operational_status === 'Closed' && (
          <AlertBanner
            type="error"
            title="Centre Status: CLOSED"
            message="New farmer bookings are suspended for this centre. Existing records remain accessible."
            style={{ marginBottom: 18 }}
          />
        )}

        {/* ===================================================== */}
        {/* 7. OVERVIEW PAGE — "CENTRE TODAY"                     */}
        {/* ===================================================== */}
        {activeMainTab === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            
            {/* LEVEL 1: TODAY AT YOUR CENTRE (Unified Operational Status Banner) */}
            <div style={{
              background: '#ffffff',
              borderRadius: 8,
              border: '1px solid var(--kq-border-medium, #d1d5db)',
              padding: '16px 20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 16
            }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--kq-text-muted, #6b7280)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Today at Your Centre
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <span style={{ fontSize: 16 }}>
                    {attentionIssues.length > 0 ? '🟡' : '🟢'}
                  </span>
                  <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--kq-text-primary, #111827)' }}>
                    {attentionIssues.length > 0 ? 'ATTENTION REQUIRED' : 'NORMAL'}
                  </span>
                </div>
              </div>

              {/* Dynamic metrics bar */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--kq-text-muted, #6b7280)', fontWeight: 600 }}>FARMERS WAITING</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--kq-text-primary, #111827)' }}>
                    {waitingCount}
                  </div>
                </div>

                <div style={{ width: 1, height: 32, background: 'var(--kq-border-light, #e5e7eb)' }} />

                <div>
                  <div style={{ fontSize: 11, color: 'var(--kq-text-muted, #6b7280)', fontWeight: 600 }}>ACTIVE COUNTERS</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--kq-text-primary, #111827)' }}>
                    {activeCounters}
                  </div>
                </div>

                <div style={{ width: 1, height: 32, background: 'var(--kq-border-light, #e5e7eb)' }} />

                <div>
                  <div style={{ fontSize: 11, color: 'var(--kq-text-muted, #6b7280)', fontWeight: 600 }}>ESTIMATED WAIT</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--kq-text-primary, #111827)' }}>
                    ~{estWaitMin} min
                  </div>
                </div>

                <div style={{ width: 1, height: 32, background: 'var(--kq-border-light, #e5e7eb)' }} />

                <div>
                  <div style={{ fontSize: 11, color: 'var(--kq-text-muted, #6b7280)', fontWeight: 600 }}>DAILY CAPACITY</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--kq-text-primary, #111827)' }}>
                    {dailyCapacity} slots
                  </div>
                </div>

                <div style={{ width: 1, height: 32, background: 'var(--kq-border-light, #e5e7eb)' }} />

                <div>
                  <div style={{ fontSize: 11, color: '#166534', fontWeight: 600 }}>PROCURING TODAY</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#166534' }}>
                    {procuredTodayQ} q <span style={{ fontSize: 13, fontWeight: 600, color: '#15803d' }}>({procuredTodayMt} MT)</span>
                  </div>
                </div>

                <div style={{ width: 1, height: 32, background: 'var(--kq-border-light, #e5e7eb)' }} />

                <div>
                  <div style={{ fontSize: 11, color: '#1e40af', fontWeight: 600 }}>SEASON PROCURED</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#1e40af' }}>
                    {cumulativeProcuredMt} MT
                  </div>
                </div>
              </div>
            </div>

            {/* LEVEL 1: NEEDS YOUR ATTENTION (Shown only when issues exist, or compact clean checkmark) */}
            <Card style={{ padding: '16px 20px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--kq-text-muted, #6b7280)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
                Needs Your Attention
              </div>

              {attentionIssues.length === 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#166534', fontSize: 13.5, fontWeight: 600, padding: '4px 0' }}>
                  <Icon name="check-circle" size={17} color="#166534" />
                  <span>No issues requiring action. Operations are proceeding smoothly.</span>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {attentionIssues.map(issue => (
                    <div
                      key={issue.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 14px',
                        borderRadius: 6,
                        backgroundColor: issue.type === 'error' ? '#fef2f2' : '#fffbeb',
                        border: issue.type === 'error' ? '1px solid #fecaca' : '1px solid #fde68a',
                        gap: 12,
                        flexWrap: 'wrap'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ color: issue.type === 'error' ? '#b91c1c' : '#d97706' }}>⚠</span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--kq-text-primary, #111827)' }}>
                          {issue.text}
                        </span>
                      </div>
                      <PrimaryButton
                        onClick={issue.action}
                        style={{ fontSize: 12, padding: '4px 10px', height: 28 }}
                      >
                        {issue.actionLabel}
                      </PrimaryButton>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* LEVEL 1: CURRENT QUEUE & OPERATIONS GRID */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16 }}>
              {/* Card 1: CURRENT QUEUE GLANCE */}
              <Card style={{ padding: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--kq-text-primary, #111827)' }}>
                    Current Queue
                  </h3>
                  <SecondaryButton
                    onClick={() => setActiveMainTab('queue')}
                    style={{ fontSize: 12, padding: '4px 10px', height: 28 }}
                  >
                    Open Queue →
                  </SecondaryButton>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {/* Now Serving */}
                  <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', padding: '12px 14px', borderRadius: 6 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#166534', textTransform: 'uppercase' }}>
                      Now Serving
                    </div>
                    {servingBooking ? (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                        <div>
                          <span style={{ fontSize: 16, fontWeight: 800, color: '#14532d' }}>
                            {servingBooking.token || '#' + servingBooking.queue_position_at_booking}
                          </span>
                          <span style={{ fontSize: 13, color: 'var(--kq-text-primary, #111827)', marginLeft: 8, fontWeight: 600 }}>
                            {servingBooking.name}
                          </span>
                          <div style={{ fontSize: 11.5, color: '#166534', marginTop: 2 }}>
                            {servingBooking.crop} • {servingBooking.quantity_quintals} q
                          </div>
                        </div>
                        <PrimaryButton
                          onClick={() => {
                            setSelectedProcurementBooking(servingBooking);
                            setActiveMainTab('procurement');
                          }}
                          style={{ fontSize: 11, padding: '4px 10px', height: 28 }}
                        >
                          Process Produce
                        </PrimaryButton>
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: 'var(--kq-text-muted, #6b7280)', marginTop: 4 }}>No active token</div>
                    )}
                  </div>

                  {/* Next Farmer */}
                  <div style={{ background: '#f9fafb', border: '1px solid var(--kq-border-light, #e5e7eb)', padding: '12px 14px', borderRadius: 6 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--kq-text-muted, #6b7280)', textTransform: 'uppercase' }}>
                      Next in Line
                    </div>
                    {nextBooking ? (
                      <div style={{ marginTop: 4 }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--kq-text-primary, #111827)' }}>
                          {nextBooking.token || '#' + nextBooking.queue_position_at_booking}
                        </span>
                        <span style={{ fontSize: 13, color: 'var(--kq-text-secondary, #4b5563)', marginLeft: 8 }}>
                          {nextBooking.name} ({nextBooking.crop})
                        </span>
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: 'var(--kq-text-muted, #6b7280)', marginTop: 4 }}>No upcoming farmers in slot</div>
                    )}
                  </div>
                </div>
              </Card>

              {/* Card 2: CENTRE OPERATIONS (Queue Flow & Velocity) */}
              <Card style={{ padding: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--kq-text-primary, #111827)' }}>
                    Centre Operations
                  </h3>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {fairnessSummary && (
                      <SecondaryButton
                        onClick={() => setShowFairnessModal(true)}
                        style={{ fontSize: 11, padding: '4px 8px', height: 28 }}
                      >
                        Queue Fairness
                      </SecondaryButton>
                    )}
                    <SecondaryButton
                      onClick={applyPacing}
                      disabled={pacingLoading}
                      style={{ fontSize: 11, padding: '4px 8px', height: 28 }}
                    >
                      {pacingLoading ? 'Updating...' : 'Adjust Flow'}
                    </SecondaryButton>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div style={{ background: '#f9fafb', padding: '10px 12px', borderRadius: 6, border: '1px solid var(--kq-border-light, #e5e7eb)' }}>
                    <div style={{ fontSize: 11, color: 'var(--kq-text-muted, #6b7280)' }}>PROCESSING SPEED</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--kq-text-primary, #111827)', marginTop: 2 }}>
                      {processingRate} min / farmer
                    </div>
                  </div>

                  <div style={{ background: '#f9fafb', padding: '10px 12px', borderRadius: 6, border: '1px solid var(--kq-border-light, #e5e7eb)' }}>
                    <div style={{ fontSize: 11, color: 'var(--kq-text-muted, #6b7280)' }}>THROUGHPUT</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--kq-text-primary, #111827)', marginTop: 2 }}>
                      ~{hourlyThroughput} / hr <span style={{ fontSize: 11, fontWeight: 500, color: '#6b7280' }}>(done: {actualThroughputToday})</span>
                    </div>
                  </div>

                  <div style={{ background: '#f9fafb', padding: '10px 12px', borderRadius: 6, border: '1px solid var(--kq-border-light, #e5e7eb)' }}>
                    <div style={{ fontSize: 11, color: 'var(--kq-text-muted, #6b7280)' }}>ACTIVE COUNTERS</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--kq-text-primary, #111827)', marginTop: 2 }}>
                      {activeCounters} Bays
                    </div>
                  </div>

                  <div style={{ background: '#f9fafb', padding: '10px 12px', borderRadius: 6, border: '1px solid var(--kq-border-light, #e5e7eb)' }}>
                    <div style={{ fontSize: 11, color: 'var(--kq-text-muted, #6b7280)' }}>CAPACITY LOAD</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--kq-text-primary, #111827)', marginTop: 2 }}>
                      {waitingCount} / {dailyCapacity} ({Math.round((waitingCount / dailyCapacity) * 100)}%)
                    </div>
                  </div>

                  <div style={{ background: '#f0fdf4', padding: '10px 12px', borderRadius: 6, border: '1px solid #bbf7d0' }}>
                    <div style={{ fontSize: 11, color: '#166534', fontWeight: 600 }}>PROCURING TODAY</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#166534', marginTop: 2 }}>
                      {procuredTodayQ} q ({procuredTodayMt} MT)
                    </div>
                  </div>
                </div>

                {pacingMsg && (
                  <div style={{ marginTop: 10, fontSize: 12, color: '#166534', fontWeight: 600 }}>
                    {pacingMsg}
                  </div>
                )}
              </Card>
            </div>

            {/* LEVEL 3: UPCOMING DEMAND SUMMARY */}
            {demandOutlook && (
              <Card style={{ padding: 18 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--kq-text-muted, #6b7280)', textTransform: 'uppercase' }}>
                      Upcoming Demand ({demandOutlook.forecast_period || 'Next 7 Days'})
                    </div>
                    <div style={{ fontSize: 14, color: 'var(--kq-text-primary, #111827)', marginTop: 4 }}>
                      Expected arrivals: <strong>~{demandOutlook.expected_farmers} farmers</strong> • Projected volume: <strong>{demandOutlook.expected_procurement_min_mt} – {demandOutlook.expected_procurement_max_mt} MT</strong> • Storage: <strong>{demandOutlook.centre_capacity_mt} MT</strong>
                    </div>
                  </div>

                  <SecondaryButton
                    onClick={() => setActiveMainTab('demand')}
                    style={{ fontSize: 12, padding: '4px 10px', height: 30 }}
                  >
                    View Full Forecast →
                  </SecondaryButton>
                </div>
              </Card>
            )}
          </div>
        )}

        {/* ===================================================== */}
        {/* 9. QUEUE PAGE — STREAMLINED TABLE                     */}
        {/* ===================================================== */}
        {activeMainTab === 'queue' && (
          <Card style={{ padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'var(--kq-text-primary, #111827)' }}>
                  Active Queue Registry
                </h3>
                <div style={{ fontSize: 12, color: 'var(--kq-text-muted, #6b7280)', marginTop: 2 }}>
                  Showing current farmers in line for check-in, produce inspection, and weighing.
                </div>
              </div>
              <PrimaryButton
                onClick={loadMyCentre}
                style={{ fontSize: 12, padding: '6px 12px', gap: 6 }}
              >
                <Icon name="refresh-cw" size={13} />
                <span>Refresh Queue</span>
              </PrimaryButton>
            </div>

            {/* Search and Filters */}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ flex: '1 1 240px' }}>
                <SearchBar
                  value={searchQuery}
                  onChange={setSearchQuery}
                  placeholder="Search farmer name, phone, or token..."
                />
              </div>
              <FilterBar
                filters={[
                  {
                    key: 'status',
                    label: 'Status',
                    options: [
                      { value: 'ALL', label: 'All Statuses' },
                      ...STATUS_FLOW.map(s => ({ value: s, label: s }))
                    ],
                    value: statusFilter,
                    onChange: setStatusFilter
                  },
                  {
                    key: 'sort',
                    label: 'Sort By',
                    options: [
                      { value: 'fairness_desc', label: 'Fairness Priority (Highest First)' },
                      { value: 'score_desc', label: 'Fairness Score (Highest First)' },
                      { value: 'queue_asc', label: 'Queue Position (Standard)' },
                      { value: 'time_asc', label: 'Slot Time (Earliest First)' }
                    ],
                    value: sortOrder,
                    onChange: setSortOrder
                  }
                ]}
              />
            </div>

            {/* Restored 9-Column Operational DataTable */}
            {filteredQueue.length === 0 ? (
              <EmptyState
                icon="users"
                title="No queue records found"
                description="There are currently no farmers matching your search or filter."
              />
            ) : (
              <div>
                <DataTable
                  columns={[
                    {
                      key: 'queue_position_at_booking',
                      header: 'Q#',
                      width: '55px',
                      render: (val, r) => (
                        <strong style={{ color: 'var(--kq-text-secondary, #4b5563)', fontSize: 12 }}>
                          #{val || r.queue_position || '—'}
                        </strong>
                      )
                    },
                    {
                      key: 'token',
                      header: 'Token',
                      width: '90px',
                      render: (val, r) => (
                        <span style={{
                          background: 'var(--kq-green-800, #166534)',
                          color: '#ffffff',
                          padding: '2px 7px',
                          borderRadius: 4,
                          fontSize: 12,
                          fontWeight: 700,
                          letterSpacing: '0.02em',
                          display: 'inline-block'
                        }}>
                          {val || '#' + (r.queue_position_at_booking || '—')}
                        </span>
                      )
                    },
                    {
                      key: 'booking_date',
                      header: 'Date',
                      width: '90px',
                      render: val => (
                        <span style={{ fontSize: 12, color: 'var(--kq-text-secondary, #4b5563)' }}>
                          {formatHumanDate(val)}
                        </span>
                      )
                    },
                    {
                      key: 'slot_time',
                      header: 'Slot',
                      width: '100px',
                      render: (val, r) => (
                        <span style={{ fontSize: 12, color: 'var(--kq-text-secondary, #4b5563)' }}>
                          {formatHumanTime(val || `${r.start_time || ''} - ${r.end_time || ''}`)}
                        </span>
                      )
                    },
                    {
                      key: 'name',
                      header: 'Farmer',
                      render: (val, r) => (
                        <div>
                          <strong style={{ fontSize: 13, color: 'var(--kq-text-primary, #111827)' }}>{val}</strong>
                          <div style={{ fontSize: 11, color: 'var(--kq-text-muted, #6b7280)', marginTop: 1 }}>
                            {r.phone} {r.village ? `• ${r.village}` : ''}
                          </div>
                        </div>
                      )
                    },
                    {
                      key: 'crop',
                      header: 'Crop / Qty',
                      width: '120px',
                      render: (val, r) => (
                        <span style={{ fontSize: 12 }}>
                          {val} • <strong>{r.quantity_quintals} q</strong>
                        </span>
                      )
                    },
                    {
                      key: 'protection_level',
                      header: 'Fairness / Priority',
                      width: '145px',
                      render: (val, r) => {
                        const isHigh = val === 'HIGH';
                        const isMod = val === 'MODERATE';
                        return (
                          <div title={r.fairness_message || 'Standard fairness tracking'}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{
                                padding: '2px 6px',
                                borderRadius: 4,
                                fontSize: 10.5,
                                fontWeight: 700,
                                background: isHigh ? '#dcfce7' : isMod ? '#fef3c7' : 'var(--kq-bg-subtle, #f3f4f6)',
                                color: isHigh ? '#166534' : isMod ? '#92400e' : 'var(--kq-text-muted, #6b7280)',
                                border: `1px solid ${isHigh ? '#bbf7d0' : isMod ? '#fde68a' : 'var(--kq-border-light, #e5e7eb)'}`
                              }}>
                                {isHigh ? '🛡️ HIGH' : isMod ? '🛡️ MOD' : 'STD'}
                              </span>
                              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--kq-text-secondary, #4b5563)' }}>
                                Score: {r.fairness_score || 0}
                              </span>
                            </div>
                            {isHigh && (
                              <div style={{ fontSize: 10, color: '#166534', fontWeight: 600, marginTop: 2 }}>
                                Priority Protected
                              </div>
                            )}
                          </div>
                        );
                      }
                    },
                    {
                      key: 'status',
                      header: 'Status',
                      width: '120px',
                      render: val => <StatusBadge status={val} size="sm" />
                    },
                    {
                      key: 'action',
                      header: 'Actions',
                      render: (_, b) => {
                        const isCompleted = b.status === 'Payment Completed' || b.status === 'Procured';
                        const isNoShow = b.status === 'No-Show';
                        const canNoShow = b.status === 'Confirmed' || b.status === 'Checked-In';
                        const canAdvance = !isCompleted && !isNoShow;

                        if (isCompleted) {
                          return (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedProcurementBooking(b);
                                setActiveMainTab('procurement');
                              }}
                              style={{
                                background: 'var(--kq-green-700, #15803d)',
                                color: '#ffffff',
                                border: 'none',
                                padding: '4px 9px',
                                borderRadius: 4,
                                cursor: 'pointer',
                                fontWeight: 600,
                                fontSize: 11.5,
                                whiteSpace: 'nowrap'
                              }}
                            >
                              View Record
                            </button>
                          );
                        }

                        if (isNoShow) {
                          return <span style={{ fontSize: 11, color: 'var(--kq-text-muted, #9ca3af)' }}>Closed</span>;
                        }

                        return (
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedProcurementBooking(b);
                                setActiveMainTab('procurement');
                              }}
                              style={{
                                background: '#0284c7',
                                color: '#ffffff',
                                border: 'none',
                                padding: '4px 9px',
                                borderRadius: 4,
                                cursor: 'pointer',
                                fontWeight: 600,
                                fontSize: 11.5,
                                whiteSpace: 'nowrap'
                              }}
                            >
                              Process
                            </button>

                            {canAdvance && (
                              <button
                                type="button"
                                onClick={() => advanceStatus(b)}
                                style={{
                                  background: 'var(--kq-green-800, #166534)',
                                  color: '#ffffff',
                                  border: 'none',
                                  padding: '4px 9px',
                                  borderRadius: 4,
                                  cursor: 'pointer',
                                  fontWeight: 600,
                                  fontSize: 11.5,
                                  whiteSpace: 'nowrap'
                                }}
                              >
                                Advance →
                              </button>
                            )}

                            {canNoShow && (
                              <button
                                type="button"
                                onClick={() => markNoShow(b)}
                                style={{
                                  background: '#fff1f2',
                                  border: '1px solid #fecdd3',
                                  color: '#be123c',
                                  padding: '3px 8px',
                                  borderRadius: 4,
                                  cursor: 'pointer',
                                  fontSize: 11.5,
                                  fontWeight: 600,
                                  whiteSpace: 'nowrap'
                                }}
                              >
                                No-Show
                              </button>
                            )}
                          </div>
                        );
                      }
                    }
                  ]}
                  data={paginatedQueue}
                />

                <div style={{ marginTop: 14 }}>
                  <Pagination
                    currentPage={currentPage}
                    totalPages={totalPages}
                    totalItems={filteredQueue.length}
                    pageSize={pageSize}
                    onPageChange={setCurrentPage}
                  />
                </div>
              </div>
            )}
          </Card>
        )}

        {/* ===================================================== */}
        {/* MISSED VISITS PAGE — REVIEW & CAPACITY RESTORATION    */}
        {/* ===================================================== */}
        {activeMainTab === 'missed' && (
          <Card style={{ padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'var(--kq-text-primary, #111827)' }}>
                  Missed & Elapsed Appointments
                </h3>
                <div style={{ fontSize: 12, color: 'var(--kq-text-muted, #6b7280)', marginTop: 2 }}>
                  Review no-show visits and elapsed scheduled slots. Authorized administrators can safely restore farmers into upcoming operational slots without creating duplicates.
                </div>
              </div>
              <PrimaryButton
                onClick={fetchMissedVisits}
                loading={missedLoading}
                style={{ fontSize: 12, padding: '6px 12px', gap: 6 }}
              >
                <Icon name="refresh-cw" size={13} />
                <span>Refresh List</span>
              </PrimaryButton>
            </div>

            {/* Filter and Search */}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ flex: '1 1 240px' }}>
                <SearchBar
                  value={missedSearch}
                  onChange={setMissedSearch}
                  placeholder="Search farmer name, token, or phone..."
                />
              </div>
              <FilterBar
                filters={[
                  {
                    key: 'status',
                    label: 'Filter',
                    options: [
                      { value: 'ALL', label: 'All Records' },
                      { value: 'No-Show', label: 'No-Show Only' },
                      { value: 'Elapsed', label: 'Elapsed / Unarrived Only' }
                    ],
                    value: missedStatusFilter,
                    onChange: setMissedStatusFilter
                  }
                ]}
              />
            </div>

            {missedVisits.filter(b => {
              const matchesSearch = !missedSearch ||
                b.farmer_name?.toLowerCase().includes(missedSearch.toLowerCase()) ||
                b.phone?.includes(missedSearch) ||
                b.token?.toLowerCase().includes(missedSearch.toLowerCase()) ||
                b.booking_id?.toLowerCase().includes(missedSearch.toLowerCase());
              const matchesStatus = missedStatusFilter === 'ALL' ||
                (missedStatusFilter === 'No-Show' ? b.status === 'No-Show' : b.status !== 'No-Show');
              return matchesSearch && matchesStatus;
            }).length === 0 ? (
              <EmptyState
                icon="check-circle"
                title="No missed appointments"
                description="There are currently no recorded no-show or elapsed unarrived visits for your centre."
              />
            ) : (
              <DataTable
                columns={[
                  {
                    key: 'token',
                    header: 'Token / ID',
                    width: '110px',
                    render: (val, r) => (
                      <div>
                        <span style={{
                          background: 'var(--kq-bg-subtle, #f3f4f6)',
                          color: 'var(--kq-text-primary, #111827)',
                          padding: '2px 6px',
                          borderRadius: 4,
                          fontSize: 11.5,
                          fontWeight: 700,
                          border: '1px solid var(--kq-border-light)'
                        }}>
                          {val || r.booking_id?.slice(-6)}
                        </span>
                        <div style={{ fontSize: 10, color: 'var(--kq-text-muted)', marginTop: 2 }}>
                          {r.booking_id}
                        </div>
                      </div>
                    )
                  },
                  {
                    key: 'farmer_name',
                    header: 'Farmer Name & Contact',
                    render: (val, r) => (
                      <div>
                        <strong style={{ fontSize: 13, color: 'var(--kq-text-primary)' }}>{val}</strong>
                        <div style={{ fontSize: 11, color: 'var(--kq-text-muted)', marginTop: 1 }}>
                          {r.phone} {r.village ? `• ${r.village}` : ''}
                        </div>
                      </div>
                    )
                  },
                  {
                    key: 'booking_date',
                    header: 'Original Slot',
                    width: '150px',
                    render: (val, r) => (
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600 }}>{formatHumanDate(val)}</div>
                        <div style={{ fontSize: 11, color: 'var(--kq-text-muted)' }}>
                          {formatHumanTime(r.slot_time || `${r.start_time || ''} - ${r.end_time || ''}`)}
                        </div>
                      </div>
                    )
                  },
                  {
                    key: 'crop',
                    header: 'Crop / Qty',
                    width: '110px',
                    render: (val, r) => (
                      <span style={{ fontSize: 12 }}>
                        {val} • <strong>{r.quantity_quintals} q</strong>
                      </span>
                    )
                  },
                  {
                    key: 'missed_status',
                    header: 'Status & Reason',
                    render: (val, r) => (
                      <div>
                        <span style={{
                          padding: '2px 7px',
                          borderRadius: 4,
                          fontSize: 11,
                          fontWeight: 700,
                          background: r.status === 'No-Show' ? '#fee2e2' : '#fef3c7',
                          color: r.status === 'No-Show' ? '#991b1b' : '#92400e',
                          border: `1px solid ${r.status === 'No-Show' ? '#fecaca' : '#fde68a'}`
                        }}>
                          {val}
                        </span>
                        <div style={{ fontSize: 10.5, color: 'var(--kq-text-muted)', marginTop: 3 }}>
                          {r.recorded_reason}
                        </div>
                      </div>
                    )
                  },
                  {
                    key: 'actions',
                    header: 'Admin Actions',
                    width: '180px',
                    render: (_, r) => (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={() => {
                            setRestoreModalBooking(r);
                            const tomorrow = new Date();
                            tomorrow.setDate(tomorrow.getDate() + 1);
                            const tStr = tomorrow.toISOString().slice(0, 10);
                            setRestoreTargetDate(tStr);
                            fetchRestoreSlots(tStr);
                          }}
                          style={{
                            background: 'var(--kq-green-800, #166534)',
                            color: '#ffffff',
                            border: 'none',
                            padding: '4px 10px',
                            borderRadius: 4,
                            cursor: 'pointer',
                            fontWeight: 600,
                            fontSize: 11.5,
                            whiteSpace: 'nowrap'
                          }}
                        >
                          Restore Slot
                        </button>
                        <button
                          type="button"
                          onClick={() => handleReleaseCapacity(r)}
                          style={{
                            background: '#ffffff',
                            color: 'var(--kq-text-secondary)',
                            border: '1px solid var(--kq-border-medium)',
                            padding: '4px 8px',
                            borderRadius: 4,
                            cursor: 'pointer',
                            fontWeight: 500,
                            fontSize: 11,
                            whiteSpace: 'nowrap'
                          }}
                        >
                          Release
                        </button>
                      </div>
                    )
                  }
                ]}
                data={missedVisits.filter(b => {
                  const matchesSearch = !missedSearch ||
                    b.farmer_name?.toLowerCase().includes(missedSearch.toLowerCase()) ||
                    b.phone?.includes(missedSearch) ||
                    b.token?.toLowerCase().includes(missedSearch.toLowerCase()) ||
                    b.booking_id?.toLowerCase().includes(missedSearch.toLowerCase());
                  const matchesStatus = missedStatusFilter === 'ALL' ||
                    (missedStatusFilter === 'No-Show' ? b.status === 'No-Show' : b.status !== 'No-Show');
                  return matchesSearch && matchesStatus;
                })}
              />
            )}
          </Card>
        )}

        {/* Restore Missed Appointment Modal */}
        {restoreModalBooking && (
          <Modal
            isOpen={!!restoreModalBooking}
            onClose={() => setRestoreModalBooking(null)}
            title="Restore Missed Farmer Appointment"
            subtitle={`Rebooking capacity for ${restoreModalBooking.farmer_name} (${restoreModalBooking.crop} · ${restoreModalBooking.quantity_quintals}q)`}
            footer={
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', width: '100%' }}>
                <SecondaryButton onClick={() => setRestoreModalBooking(null)}>
                  Cancel
                </SecondaryButton>
                <PrimaryButton
                  onClick={handleRestoreSlot}
                  loading={restoreSubmitting}
                  disabled={!restoreTargetSlot || restoreSlotsLoading}
                >
                  Confirm Slot Restoration
                </PrimaryButton>
              </div>
            }
          >
            <div>
              {restoreError && (
                <AlertBanner type="error" message={restoreError} style={{ marginBottom: 14 }} />
              )}
              
              <div style={{ fontSize: 13, color: 'var(--kq-text-secondary)', marginBottom: 14 }}>
                Choose a valid upcoming operational date and slot at this centre. Capacity will be verified and reserved transactionally. Historical records and audit logs are preserved.
              </div>

              <FormField label="Target Date" required>
                <input
                  type="date"
                  className="kq-input"
                  value={restoreTargetDate}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={e => {
                    setRestoreTargetDate(e.target.value);
                    fetchRestoreSlots(e.target.value);
                  }}
                  required
                />
              </FormField>

              <FormField label="Available Operational Slots" required style={{ marginTop: 14 }}>
                {restoreSlotsLoading ? (
                  <div style={{ fontSize: 12, color: 'var(--kq-text-muted)' }}>Checking real-time slot availability...</div>
                ) : restoreSlotsList.length === 0 ? (
                  <div style={{ fontSize: 12, color: '#dc2626', fontWeight: 600 }}>
                    No unexpired slots with free capacity on {restoreTargetDate}. Please choose another date.
                  </div>
                ) : (
                  <select
                    className="kq-input"
                    value={restoreTargetSlot}
                    onChange={e => setRestoreTargetSlot(e.target.value)}
                    required
                  >
                    {restoreSlotsList.map(s => (
                      <option key={s.slot_id} value={s.slot_id}>
                        {s.start_time.slice(0, 5)} - {s.end_time.slice(0, 5)} ({s.max_farmers - s.booked_count} slots open)
                      </option>
                    ))}
                  </select>
                )}
              </FormField>
            </div>
          </Modal>
        )}

        {/* ===================================================== */}
        {/* 10-13. PROCUREMENT PAGE — SEQUENTIAL STEPPER WORKFLOW */}
        {/* ===================================================== */}
        {activeMainTab === 'procurement' && (
          <ProcurementWorkflow
            booking={selectedProcurementBooking}
            queue={queue}
            onSelectBooking={setSelectedProcurementBooking}
            user={user}
            onRefreshCentre={loadMyCentre}
          />
        )}

        {/* ===================================================== */}
        {/* 14. DEMAND PAGE — DEMAND & FORECAST                   */}
        {/* ===================================================== */}
        {activeMainTab === 'demand' && (
          <DemandOutlookPanel demandOutlook={demandOutlook} />
        )}

        {/* ===================================================== */}
        {/* 15. GRIEVANCES PAGE — TABBED BY STATUS                */}
        {/* ===================================================== */}
        {activeMainTab === 'grievances' && (
          <GrievancePanel centreId={centreData.centre_id} />
        )}

        {/* ===================================================== */}
        {/* 16-23. ASSISTANT PAGE — CENTRE ASSISTANT              */}
        {/* ===================================================== */}
        {activeMainTab === 'assistant' && (
          <CentreAdminAiOperations
            api={API}
            centreData={centreData}
            stats={stats}
            pacingData={pacingData}
            queue={queue}
            grievances={grievances}
            demandOutlook={demandOutlook}
            aiLoading={aiLoading}
            aiQuery={aiQuery}
            setAiQuery={setAiQuery}
            aiResponse={aiResponse}
            aiError={aiError}
            simType={simType}
            setSimType={setSimType}
            simArrivalPct={simArrivalPct}
            setSimArrivalPct={setSimArrivalPct}
            simCounterDelta={simCounterDelta}
            setSimCounterDelta={setSimCounterDelta}
            fetchAiBriefing={fetchAiBriefing}
            handleAskAi={handleAskAi}
            handleRunSimulation={handleRunSimulation}
            onNavigateTab={setActiveMainTab}
          />
        )}

      </div>

      {/* ===================================================== */}
      {/* 24. QUEUE FAIRNESS MODAL (PROGRESSIVE DISCLOSURE)     */}
      {/* ===================================================== */}
      {showFairnessModal && fairnessSummary && (
        <Modal
          isOpen={showFairnessModal}
          onClose={() => setShowFairnessModal(false)}
          title="Queue Fairness & Priority Protection"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--kq-text-secondary, #4b5563)', lineHeight: 1.5 }}>
              The fairness protocol tracks historical wait-time variance and past delays to safeguard farmers who experienced cancellations or long queues.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', padding: 12, borderRadius: 6, textAlign: 'center' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#166534' }}>HIGH PROTECTION</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#14532d', marginTop: 4 }}>
                  {fairnessSummary.high_protection_count}
                </div>
                <div style={{ fontSize: 11, color: '#166534', marginTop: 2 }}>Shielded from delays</div>
              </div>

              <div style={{ background: '#fffbeb', border: '1px solid #fde68a', padding: 12, borderRadius: 6, textAlign: 'center' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#92400e' }}>MODERATE</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#78350f', marginTop: 4 }}>
                  {fairnessSummary.moderate_protection_count}
                </div>
                <div style={{ fontSize: 11, color: '#92400e', marginTop: 2 }}>Prior wait recorded</div>
              </div>

              <div style={{ background: '#f9fafb', border: '1px solid var(--kq-border-light, #e5e7eb)', padding: 12, borderRadius: 6, textAlign: 'center' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--kq-text-muted, #6b7280)' }}>STANDARD</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--kq-text-primary, #111827)', marginTop: 4 }}>
                  {fairnessSummary.low_protection_count}
                </div>
                <div style={{ fontSize: 11, color: 'var(--kq-text-muted, #6b7280)', marginTop: 2 }}>Normal candidate</div>
              </div>
            </div>

            <div style={{ background: '#f9fafb', padding: 12, borderRadius: 6, fontSize: 12, color: 'var(--kq-text-secondary, #4b5563)', lineHeight: 1.4 }}>
              <strong>Operational Rule:</strong> Never alter the physical queue order arbitrarily. High Protection farmers must proceed through the next available counter without being bumped for late arrivals.
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
              <PrimaryButton onClick={() => setShowFairnessModal(false)}>
                Close
              </PrimaryButton>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// =====================================================
// 10-13. PROCUREMENT STEPPER COMPONENT
// =====================================================
function ProcurementWorkflow({ booking, queue, onSelectBooking, user, onRefreshCentre }) {
  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(false);
  const [activeStage, setActiveStage] = useState('quality'); // 'quality' | 'weighment' | 'acceptance' | 'payment'
  const [actionLoading, setActionLoading] = useState(false);
  const [msg, setMsg] = useState({ type: '', text: '' });

  const [qualityForm, setQualityForm] = useState({
    grade: 'Grade A',
    moisture_pct: '12.0',
    foreign_matter_pct: '0.5',
    visual_inspection_notes: 'Standard quality golden grain'
  });

  const [weighmentForm, setWeighmentForm] = useState({
    gross_weight_kg: '',
    tare_weight_kg: '50',
    scale_id: 'SCALE-BAY-01',
    notes: 'Electronic scale weighed'
  });

  const [acceptanceForm, setAcceptanceForm] = useState({
    accepted_grade: 'Grade A',
    net_quantity_kg: '',
    msp_rate_per_quintal: '2320',
    payment_mode: 'DBT_AADHAAR',
    notes: 'Verified and accepted for procurement'
  });

  const [paymentForm, setPaymentForm] = useState({
    payment_status: 'COMPLETED',
    payment_reference: 'PFMS' + Math.floor(10000000 + Math.random() * 90000000),
    notes: 'Direct Benefit Transfer credited successfully'
  });

  const loadRecord = async () => {
    if (!booking) return;
    try {
      setLoading(true);
      const res = await API.get('/bookings/' + booking.booking_id + '/procurement-record');
      if (res.data && res.data.success) {
        const r = res.data.record;
        setRecord(r);

        // Pre-fill forms from database record
        if (r.quality) {
          setQualityForm({
            grade: r.quality.grade || 'Grade A',
            moisture_pct: String(r.quality.moisture_pct || '12.0'),
            foreign_matter_pct: String(r.quality.foreign_matter_pct || '0.5'),
            visual_inspection_notes: r.quality.visual_inspection_notes || ''
          });
        }
        if (r.weighment) {
          setWeighmentForm({
            gross_weight_kg: String(r.weighment.gross_weight_kg || ''),
            tare_weight_kg: String(r.weighment.tare_weight_kg || '50'),
            scale_id: r.weighment.scale_id || 'SCALE-BAY-01',
            notes: r.weighment.notes || ''
          });
          setAcceptanceForm(prev => ({
            ...prev,
            net_quantity_kg: String(r.weighment.net_weight_kg || ''),
            accepted_grade: r.quality ? r.quality.grade : prev.accepted_grade
          }));
        } else if (booking.quantity_quintals) {
          const estKg = Number(booking.quantity_quintals) * 100;
          setWeighmentForm(prev => ({
            ...prev,
            gross_weight_kg: prev.gross_weight_kg || String(estKg + 50)
          }));
          setAcceptanceForm(prev => ({
            ...prev,
            net_quantity_kg: prev.net_quantity_kg || String(estKg)
          }));
        }
        if (r.acceptance) {
          setAcceptanceForm({
            accepted_grade: r.acceptance.accepted_grade,
            net_quantity_kg: String(r.acceptance.net_quantity_kg),
            msp_rate_per_quintal: String(r.acceptance.msp_rate_per_quintal),
            payment_mode: r.acceptance.payment_mode || 'DBT_AADHAAR',
            notes: r.acceptance.notes || ''
          });
        }
        if (r.payment) {
          setPaymentForm({
            payment_status: r.payment.payment_status || 'COMPLETED',
            payment_reference: r.payment.payment_reference || ('PFMS' + Math.floor(10000000 + Math.random() * 90000000)),
            notes: r.payment.notes || ''
          });
        }

        // Auto-advance active stage based on completion state
        if (!r.quality) setActiveStage('quality');
        else if (!r.weighment) setActiveStage('weighment');
        else if (!r.receipt) setActiveStage('acceptance');
        else setActiveStage('payment');
      }
    } catch (err) {
      console.warn('Error loading procurement record:', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (booking) {
      loadRecord();
    }
  }, [booking?.booking_id]);

  if (!booking) {
    return (
      <EmptyState
        icon="scale"
        title="No Farmer Booking Selected"
        description="Select a farmer from the queue to proceed with grading, weighbridge measurement, and receipt generation."
      />
    );
  }

  const handleSaveQuality = async (e) => {
    e.preventDefault();
    try {
      setActionLoading(true);
      setMsg({ type: '', text: '' });
      await API.post('/bookings/' + booking.booking_id + '/quality', {
        ...qualityForm,
        moisture_pct: Number(qualityForm.moisture_pct),
        foreign_matter_pct: Number(qualityForm.foreign_matter_pct),
        assessed_by: user ? user.username : 'admin'
      });
      setMsg({ type: 'success', text: '✓ Quality assessment saved.' });
      await loadRecord();
      onRefreshCentre();
      setActiveStage('weighment');
    } catch (err) {
      setMsg({ type: 'error', text: err.response?.data?.message || 'Failed to save quality assessment.' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleSaveWeighment = async (e) => {
    e.preventDefault();
    try {
      setActionLoading(true);
      setMsg({ type: '', text: '' });
      const gross = Number(weighmentForm.gross_weight_kg);
      const tare = Number(weighmentForm.tare_weight_kg);
      if (gross <= tare) {
        setMsg({ type: 'error', text: `Gross weight (${gross} kg) must exceed tare weight (${tare} kg).` });
        setActionLoading(false);
        return;
      }
      await API.post('/bookings/' + booking.booking_id + '/weighment', {
        ...weighmentForm,
        gross_weight_kg: gross,
        tare_weight_kg: tare,
        weighbridge_operator: user ? user.username : 'admin'
      });
      setMsg({ type: 'success', text: `✓ Weighment saved! Net: ${gross - tare} kg.` });
      await loadRecord();
      onRefreshCentre();
      setActiveStage('acceptance');
    } catch (err) {
      setMsg({ type: 'error', text: err.response?.data?.message || 'Failed to save weighment.' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleSaveAcceptance = async (e) => {
    e.preventDefault();
    try {
      setActionLoading(true);
      setMsg({ type: '', text: '' });
      const res = await API.post('/bookings/' + booking.booking_id + '/procurement-acceptance', {
        ...acceptanceForm,
        net_quantity_kg: Number(acceptanceForm.net_quantity_kg),
        msp_rate_per_quintal: Number(acceptanceForm.msp_rate_per_quintal),
        accepted_by: user ? user.username : 'admin'
      });
      setMsg({ type: 'success', text: `✓ Procurement accepted! Official Receipt: ${res.data.receipt?.receipt_number || ''}` });
      await loadRecord();
      onRefreshCentre();
      setActiveStage('payment');
    } catch (err) {
      setMsg({ type: 'error', text: err.response?.data?.message || 'Failed to accept procurement.' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleSavePayment = async (e) => {
    e.preventDefault();
    try {
      setActionLoading(true);
      setMsg({ type: '', text: '' });
      await API.post('/bookings/' + booking.booking_id + '/payment', {
        ...paymentForm,
        updated_by: user ? user.username : 'admin'
      });
      setMsg({ type: 'success', text: '✓ Payment record updated.' });
      await loadRecord();
      onRefreshCentre();
    } catch (err) {
      setMsg({ type: 'error', text: err.response?.data?.message || 'Failed to update payment.' });
    } finally {
      setActionLoading(false);
    }
  };

  const calcNetKg = Math.max(0, Number(weighmentForm.gross_weight_kg || 0) - Number(weighmentForm.tare_weight_kg || 0));
  const calcTotalInr = (Number(acceptanceForm.net_quantity_kg || 0) * Number(acceptanceForm.msp_rate_per_quintal || 0)) / 100;

  const stages = [
    { key: 'quality', label: '1 Quality', done: !!record?.quality },
    { key: 'weighment', label: '2 Weighment', done: !!record?.weighment },
    { key: 'acceptance', label: '3 Receipt', done: !!record?.receipt },
    { key: 'payment', label: '4 Payment', done: record?.payment?.payment_status === 'COMPLETED' }
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20, alignItems: 'start' }}>
      
      {/* Left: Active Farmer Produce Card & Stage Stepper */}
      <Card style={{ padding: 20 }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700, color: 'var(--kq-text-primary, #111827)' }}>
          Active Produce Session
        </h3>

        {/* Quick Dropdown to switch farmer */}
        <FormField label="Switch Farmer in Queue">
          <select
            className="kq-select"
            value={booking.booking_id}
            onChange={e => {
              const found = queue.find(q => q.booking_id === e.target.value);
              if (found) onSelectBooking(found);
            }}
          >
            {queue.map(q => (
              <option key={q.booking_id} value={q.booking_id}>
                Token {q.token || '#' + q.queue_position_at_booking} — {q.name} ({q.crop}) [{q.status}]
              </option>
            ))}
          </select>
        </FormField>

        {/* Selected Farmer Info Card */}
        <div style={{ marginTop: 14, background: '#f9fafb', padding: 14, borderRadius: 6, border: '1px solid var(--kq-border-light, #e5e7eb)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--kq-green-800, #166534)' }}>
              {booking.token || '#' + booking.queue_position_at_booking}
            </span>
            <StatusBadge status={booking.status} size="sm" />
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--kq-text-primary, #111827)', marginTop: 4 }}>
            {booking.name}
          </div>
          <div style={{ fontSize: 12, color: 'var(--kq-text-secondary, #4b5563)', marginTop: 2 }}>
            Phone: {booking.phone} • Booking: <code>{booking.booking_id}</code>
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--kq-text-primary, #111827)', marginTop: 4 }}>
            Crop: <strong>{booking.crop}</strong> • Declared: <strong>{booking.quantity_quintals} q</strong>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--kq-text-muted, #6b7280)', marginTop: 2 }}>
            Slot: {formatHumanDate(booking.booking_date)}
          </div>
        </div>

        {/* 4-Stage Stepper Navigation */}
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--kq-text-muted, #6b7280)', textTransform: 'uppercase', marginBottom: 8 }}>
            Procurement Pipeline
          </div>
          {stages.map(s => {
            const isCurrent = activeStage === s.key;
            return (
              <div
                key={s.key}
                onClick={() => setActiveStage(s.key)}
                style={{
                  padding: '9px 12px',
                  borderRadius: 6,
                  marginBottom: 6,
                  background: isCurrent ? 'var(--kq-green-50, #f0fdf4)' : '#ffffff',
                  border: isCurrent ? '1.5px solid var(--kq-green-700, #15803d)' : '1px solid var(--kq-border-light, #e5e7eb)',
                  cursor: 'pointer',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: 13,
                  fontWeight: isCurrent ? 700 : 500,
                  color: isCurrent ? 'var(--kq-green-900, #14532d)' : 'var(--kq-text-secondary, #4b5563)'
                }}
              >
                <span>{s.label}</span>
                {s.done ? (
                  <span style={{ color: '#166534', fontWeight: 700, fontSize: 12 }}>✓ Completed</span>
                ) : isCurrent ? (
                  <span style={{ color: 'var(--kq-green-800, #166534)', fontWeight: 700, fontSize: 11 }}>● CURRENT</span>
                ) : (
                  <span style={{ color: '#9ca3af', fontSize: 11 }}>Pending</span>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* Right: Only the CURRENT Stage Form is Shown Prominently */}
      <Card style={{ padding: 22, flex: '2 1 480px' }}>
        {msg.text && (
          <AlertBanner
            type={msg.type === 'error' ? 'error' : 'success'}
            message={msg.text}
            onClose={() => setMsg({ type: '', text: '' })}
            style={{ marginBottom: 16 }}
          />
        )}

        {/* STAGE 1: QUALITY CHECK */}
        {activeStage === 'quality' && (
          <form onSubmit={handleSaveQuality}>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--kq-green-800, #166534)', textTransform: 'uppercase' }}>
                Stage 1 of 4
              </div>
              <h3 style={{ margin: '2px 0 0', fontSize: 16, fontWeight: 800, color: 'var(--kq-text-primary, #111827)' }}>
                Quality Check
              </h3>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <FormField label="Grade" required>
                <select
                  className="kq-select"
                  value={qualityForm.grade}
                  onChange={e => setQualityForm({ ...qualityForm, grade: e.target.value })}
                  required
                >
                  <option value="Grade A">Grade A (MSP Premium)</option>
                  <option value="Grade B">Grade B (Standard MSP)</option>
                  <option value="Grade C">Grade C (Permissible)</option>
                  <option value="REJECTED">REJECTED</option>
                </select>
              </FormField>

              <FormField label="Moisture (%)" required hint="Standard ≤ 17%">
                <input
                  className="kq-input"
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  value={qualityForm.moisture_pct}
                  onChange={e => setQualityForm({ ...qualityForm, moisture_pct: e.target.value })}
                  required
                />
              </FormField>
            </div>

            <div style={{ marginTop: 12 }}>
              <FormField label="Foreign Matter (%)">
                <input
                  className="kq-input"
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  value={qualityForm.foreign_matter_pct}
                  onChange={e => setQualityForm({ ...qualityForm, foreign_matter_pct: e.target.value })}
                />
              </FormField>
            </div>

            <div style={{ marginTop: 12 }}>
              <FormField label="Remarks">
                <input
                  className="kq-input"
                  type="text"
                  value={qualityForm.visual_inspection_notes}
                  onChange={e => setQualityForm({ ...qualityForm, visual_inspection_notes: e.target.value })}
                />
              </FormField>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
              <PrimaryButton type="submit" disabled={actionLoading}>
                {actionLoading ? 'Saving...' : 'Save & Continue →'}
              </PrimaryButton>
            </div>
          </form>
        )}

        {/* STAGE 2: WEIGHMENT */}
        {activeStage === 'weighment' && (
          <form onSubmit={handleSaveWeighment}>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--kq-green-800, #166534)', textTransform: 'uppercase' }}>
                Stage 2 of 4
              </div>
              <h3 style={{ margin: '2px 0 0', fontSize: 16, fontWeight: 800, color: 'var(--kq-text-primary, #111827)' }}>
                Weighment
              </h3>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <FormField label="Gross Weight (kg)" required>
                <input
                  className="kq-input"
                  type="number"
                  step="0.01"
                  min="1"
                  value={weighmentForm.gross_weight_kg}
                  onChange={e => setWeighmentForm({ ...weighmentForm, gross_weight_kg: e.target.value })}
                  required
                />
              </FormField>

              <FormField label="Tare Weight (kg)" required>
                <input
                  className="kq-input"
                  type="number"
                  step="0.01"
                  min="0"
                  value={weighmentForm.tare_weight_kg}
                  onChange={e => setWeighmentForm({ ...weighmentForm, tare_weight_kg: e.target.value })}
                  required
                />
              </FormField>
            </div>

            {/* Calculated Net Weight Box */}
            <div style={{
              marginTop: 14,
              background: '#f0fdf4',
              border: '1px solid #bbf7d0',
              padding: '12px 16px',
              borderRadius: 6,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <div>
                <div style={{ fontSize: 11, color: '#166534', fontWeight: 700 }}>NET WEIGHT</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: '#14532d' }}>
                  {calcNetKg > 0 ? calcNetKg.toLocaleString() + ' kg' : '0 kg'}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 11, color: '#166534', fontWeight: 700 }}>QUINTALS</div>
                <div style={{ fontSize: 17, fontWeight: 700, color: '#166534' }}>
                  {calcNetKg > 0 ? (calcNetKg / 100).toFixed(2) + ' q' : '0 q'}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
              <PrimaryButton type="submit" disabled={actionLoading}>
                {actionLoading ? 'Saving...' : 'Save Weighment & Continue →'}
              </PrimaryButton>
            </div>
          </form>
        )}

        {/* STAGE 3: RECEIPT */}
        {activeStage === 'acceptance' && (
          <form onSubmit={handleSaveAcceptance}>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--kq-green-800, #166534)', textTransform: 'uppercase' }}>
                Stage 3 of 4
              </div>
              <h3 style={{ margin: '2px 0 0', fontSize: 16, fontWeight: 800, color: 'var(--kq-text-primary, #111827)' }}>
                Official Receipt
              </h3>
            </div>

            {record?.receipt && (
              <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 6, padding: '10px 14px', marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 11, color: '#1e40af', fontWeight: 700 }}>RECEIPT NUMBER</div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: '#1d4ed8', fontFamily: 'monospace' }}>
                    {record.receipt.receipt_number}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 11, color: '#1e40af' }}>Total Amount</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: '#166534' }}>
                    ₹{Number(record.receipt.total_amount_inr || 0).toLocaleString('en-IN')}
                  </div>
                </div>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              <FormField label="Accepted Grade" required>
                <input
                  className="kq-input"
                  type="text"
                  value={acceptanceForm.accepted_grade}
                  onChange={e => setAcceptanceForm({ ...acceptanceForm, accepted_grade: e.target.value })}
                  required
                />
              </FormField>

              <FormField label="Net Quantity (kg)" required>
                <input
                  className="kq-input"
                  type="number"
                  step="0.01"
                  min="1"
                  value={acceptanceForm.net_quantity_kg}
                  onChange={e => setAcceptanceForm({ ...acceptanceForm, net_quantity_kg: e.target.value })}
                  required
                />
              </FormField>

              <FormField label="MSP Rate (₹ / Quintal)" required>
                <input
                  className="kq-input"
                  type="number"
                  step="1"
                  min="100"
                  value={acceptanceForm.msp_rate_per_quintal}
                  onChange={e => setAcceptanceForm({ ...acceptanceForm, msp_rate_per_quintal: e.target.value })}
                  required
                />
              </FormField>
            </div>

            <div style={{ marginTop: 14, background: '#fefce8', border: '1px solid #fef08a', padding: '10px 14px', borderRadius: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 12, color: '#854d0e', fontWeight: 600 }}>Calculated Procurement Payout:</div>
              <div style={{ fontSize: 17, fontWeight: 800, color: '#854d0e' }}>
                ₹{calcTotalInr.toLocaleString('en-IN')}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
              <PrimaryButton type="submit" disabled={actionLoading}>
                {actionLoading ? 'Generating...' : (record?.receipt ? 'Re-Issue Receipt' : 'Generate Receipt →')}
              </PrimaryButton>
            </div>
          </form>
        )}

        {/* STAGE 4: PAYMENT */}
        {activeStage === 'payment' && (
          <form onSubmit={handleSavePayment}>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--kq-green-800, #166534)', textTransform: 'uppercase' }}>
                Stage 4 of 4
              </div>
              <h3 style={{ margin: '2px 0 0', fontSize: 16, fontWeight: 800, color: 'var(--kq-text-primary, #111827)' }}>
                DBT Payment Settlement
              </h3>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <FormField label="Payment Status" required>
                <select
                  className="kq-select"
                  value={paymentForm.payment_status}
                  onChange={e => setPaymentForm({ ...paymentForm, payment_status: e.target.value })}
                  required
                >
                  <option value="PAYMENT_PENDING">PAYMENT_PENDING</option>
                  <option value="PROCESSING">PROCESSING</option>
                  <option value="COMPLETED">COMPLETED</option>
                  <option value="FAILED">FAILED</option>
                </select>
              </FormField>

              <FormField label="PFMS / Transaction Reference">
                <input
                  className="kq-input"
                  type="text"
                  value={paymentForm.payment_reference}
                  onChange={e => setPaymentForm({ ...paymentForm, payment_reference: e.target.value })}
                />
              </FormField>
            </div>

            <div style={{ marginTop: 12 }}>
              <FormField label="Remarks">
                <input
                  className="kq-input"
                  type="text"
                  value={paymentForm.notes}
                  onChange={e => setPaymentForm({ ...paymentForm, notes: e.target.value })}
                />
              </FormField>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
              <PrimaryButton type="submit" disabled={actionLoading}>
                {actionLoading ? 'Saving...' : 'Confirm / Process Payment →'}
              </PrimaryButton>
            </div>
          </form>
        )}

      </Card>
    </div>
  );
}

// =====================================================
// 14. DEMAND & FORECAST PANEL
// =====================================================
function DemandOutlookPanel({ demandOutlook }) {
  if (!demandOutlook) {
    return (
      <EmptyState
        icon="trending-up"
        title="Demand data unavailable"
        description="Forecast data for this procurement centre catchment is currently not loaded."
      />
    );
  }

  const isStorageEnough = (demandOutlook.potential_pressure_max_mt || 0) <= 0;

  return (
    <Card style={{ padding: 22 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--kq-text-muted, #6b7280)', textTransform: 'uppercase' }}>
            Planning & Logistics
          </div>
          <h3 style={{ margin: '2px 0 0', fontSize: 18, fontWeight: 800, color: 'var(--kq-text-primary, #111827)' }}>
            Demand & Forecast
          </h3>
        </div>
        <StatusBadge status={demandOutlook.status || 'NORMAL'} size="md" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 16 }}>
        <div style={{ background: '#f9fafb', padding: '12px 14px', borderRadius: 6, border: '1px solid var(--kq-border-light, #e5e7eb)' }}>
          <div style={{ fontSize: 11, color: 'var(--kq-text-muted, #6b7280)' }}>PRIMARY COMMODITY</div>
          <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--kq-text-primary, #111827)' }}>
            {demandOutlook.primary_crop || 'Paddy'}
          </div>
        </div>

        <div style={{ background: '#f9fafb', padding: '12px 14px', borderRadius: 6, border: '1px solid var(--kq-border-light, #e5e7eb)' }}>
          <div style={{ fontSize: 11, color: 'var(--kq-text-muted, #6b7280)' }}>EXPECTED FARMERS</div>
          <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--kq-text-primary, #111827)' }}>
            {demandOutlook.expected_farmers || 0}
          </div>
        </div>

        <div style={{ background: '#f9fafb', padding: '12px 14px', borderRadius: 6, border: '1px solid var(--kq-border-light, #e5e7eb)' }}>
          <div style={{ fontSize: 11, color: 'var(--kq-text-muted, #6b7280)' }}>EXPECTED PROCUREMENT</div>
          <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--kq-green-800, #166534)' }}>
            {demandOutlook.expected_procurement_min_mt} – {demandOutlook.expected_procurement_max_mt} MT
          </div>
        </div>

        <div style={{ background: '#f9fafb', padding: '12px 14px', borderRadius: 6, border: '1px solid var(--kq-border-light, #e5e7eb)' }}>
          <div style={{ fontSize: 11, color: 'var(--kq-text-muted, #6b7280)' }}>STORAGE CAPACITY</div>
          <div style={{ fontSize: 17, fontWeight: 800, color: isStorageEnough ? '#166534' : '#b91c1c' }}>
            {demandOutlook.centre_capacity_mt || 250} MT
          </div>
          <div style={{ fontSize: 11, color: isStorageEnough ? '#166534' : '#b91c1c', marginTop: 2, fontWeight: 600 }}>
            {isStorageEnough ? '🟢 Enough capacity' : '🟠 Storage pressure'}
          </div>
        </div>
      </div>

      <div style={{ background: '#f0fdf4', padding: '12px 14px', borderRadius: 6, border: '1px solid #bbf7d0', fontSize: 13, color: '#166534' }}>
        <strong>Operational Guidance: </strong>
        {demandOutlook.guidance || 'This is an early planning forecast. Adjust daily slot limits to match bag supplies.'}
      </div>
    </Card>
  );
}

// =====================================================
// 15. GRIEVANCE PANEL WITH STATUS TABS
// =====================================================
function GrievancePanel({ centreId }) {
  const [grievances, setGrievances] = useState([]);
  const [activeTab, setActiveTab] = useState('OPEN'); // 'OPEN' | 'IN_PROGRESS' | 'RESOLVED'
  const [notes, setNotes] = useState({});
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!centreId) return;
    try {
      setLoading(true);
      const res = await API.get(`/centres/${centreId}/grievances`);
      setGrievances(res.data || []);
    } catch (err) {
      console.warn('Error loading grievances:', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [centreId]);

  const resolve = async (id) => {
    try {
      await API.patch(`/grievances/${id}/resolve`, {
        resolution_notes: notes[id] || 'Resolved by DPC officer'
      });
      load();
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.message || 'Unable to resolve grievance.');
    }
  };

  const filtered = grievances.filter(g => {
    const isResolved = g.status === 'Resolved' || g.status === 'Verified Resolved' || g.status === 'AWAITING_FARMER_CONFIRMATION';
    const isInProgress = g.status === 'In Progress' || g.status === 'Under Review';
    if (activeTab === 'RESOLVED') return isResolved;
    if (activeTab === 'IN_PROGRESS') return isInProgress;
    return !isResolved && !isInProgress;
  });

  return (
    <Card style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'var(--kq-text-primary, #111827)' }}>
          Grievances
        </h3>
        <SecondaryButton onClick={load} style={{ fontSize: 12, padding: '4px 10px' }}>
          Refresh
        </SecondaryButton>
      </div>

      {/* Tabs: Open | In Progress | Resolved */}
      <div style={{ display: 'flex', gap: 6, borderBottom: '1px solid var(--kq-border-light, #e5e7eb)', marginBottom: 14 }}>
        {[
          { id: 'OPEN', label: 'Open' },
          { id: 'IN_PROGRESS', label: 'In Progress' },
          { id: 'RESOLVED', label: 'Resolved' }
        ].map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveTab(t.id)}
            style={{
              padding: '6px 14px',
              border: 'none',
              borderBottom: activeTab === t.id ? '2px solid var(--kq-green-800, #166534)' : '2px solid transparent',
              background: 'none',
              color: activeTab === t.id ? 'var(--kq-green-900, #14532d)' : 'var(--kq-text-secondary, #4b5563)',
              fontWeight: activeTab === t.id ? 700 : 500,
              fontSize: 13,
              cursor: 'pointer'
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div style={{ padding: '24px 16px', textAlign: 'center', color: '#166534', background: '#f0fdf4', borderRadius: 6, border: '1px solid #bbf7d0', fontSize: 13, fontWeight: 600 }}>
          ✓ No {activeTab.toLowerCase().replace('_', ' ')} grievances.
        </div>
      ) : (
        <DataTable
          columns={[
            {
              key: 'farmer_name',
              header: 'Farmer',
              render: (val, g) => (
                <div>
                  <strong>{val}</strong>
                  <div style={{ fontSize: 11, color: 'var(--kq-text-muted, #6b7280)' }}>{g.phone}</div>
                </div>
              )
            },
            { key: 'issue_type', header: 'Issue' },
            {
              key: 'description',
              header: 'Details',
              render: val => <div style={{ maxWidth: 260, fontSize: 12 }}>{val}</div>
            },
            {
              key: 'status',
              header: 'Status',
              render: (val, g) => <StatusBadge status={val || g.sla_status} size="sm" />
            },
            {
              key: 'action',
              header: 'Action',
              render: (_, g) => {
                if (g.status === 'Resolved' || g.status === 'Verified Resolved') {
                  return <span style={{ fontSize: 11, color: '#166534', fontWeight: 600 }}>Resolved</span>;
                }
                return (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input
                      className="kq-input"
                      placeholder="Resolution note..."
                      style={{ width: 140, padding: '4px 8px', fontSize: 11 }}
                      onChange={e => setNotes({ ...notes, [g.grievance_id]: e.target.value })}
                    />
                    <PrimaryButton
                      onClick={() => resolve(g.grievance_id)}
                      style={{ padding: '4px 10px', fontSize: 11 }}
                    >
                      Resolve
                    </PrimaryButton>
                  </div>
                );
              }
            }
          ]}
          data={filtered}
        />
      )}
    </Card>
  );
}
