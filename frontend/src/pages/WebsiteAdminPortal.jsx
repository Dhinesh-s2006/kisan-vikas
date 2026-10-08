import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Icon, Modal, PrimaryButton, SecondaryButton, KisanNatureBackground, KisanLogo, formatHumanDate } from '../components/design-system';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
const API_BASE = `${API_URL}/super-admin`;

// Scoped API caller that passes the Super Admin token
function useAdminApi() {
  const token = localStorage.getItem('kisan_super_admin_token');
  const client = axios.create({
    baseURL: API_BASE,
    headers: {
      Authorization: token ? `Bearer ${token}` : ''
    }
  });

  client.interceptors.response.use(
    res => res,
    err => {
      if (err.response?.status === 401) {
        localStorage.removeItem('kisan_super_admin_token');
        localStorage.removeItem('kisan_super_admin_user');
        window.dispatchEvent(new Event('super_admin_session_changed'));
      }
      return Promise.reject(err);
    }
  );

  return client;
}

export default function WebsiteAdminPortal() {
  const navigate = useNavigate();
  const [token, setToken] = useState(localStorage.getItem('kisan_super_admin_token') || '');
  const [adminUser, setAdminUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('kisan_super_admin_user')) || null;
    } catch {
      return null;
    }
  });

  const [activeTab, setActiveTab] = useState('overview');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Authentication State Listener
  useEffect(() => {
    const handleSessionChange = () => {
      const storedToken = localStorage.getItem('kisan_super_admin_token') || '';
      setToken(storedToken);
      try {
        setAdminUser(JSON.parse(localStorage.getItem('kisan_super_admin_user')) || null);
      } catch {
        setAdminUser(null);
      }
    };
    window.addEventListener('super_admin_session_changed', handleSessionChange);
    return () => window.removeEventListener('super_admin_session_changed', handleSessionChange);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('kisan_super_admin_token');
    localStorage.removeItem('kisan_super_admin_user');
    setToken('');
    setAdminUser(null);
    window.dispatchEvent(new Event('super_admin_session_changed'));
  };

  // If unauthenticated, render the Dedicated Super Admin Login View
  if (!token) {
    return <SuperAdminLoginView onLoginSuccess={(tok, user) => {
      localStorage.setItem('kisan_super_admin_token', tok);
      localStorage.setItem('kisan_super_admin_user', JSON.stringify(user));
      setToken(tok);
      setAdminUser(user);
    }} />;
  }

  const navItems = [
    { id: 'overview', label: 'Dashboard Overview', icon: 'bar-chart-2' },
    { id: 'farmers', label: 'Farmers Management', icon: 'users' },
    { id: 'users', label: 'Users & Roles', icon: 'shield' },
    { id: 'centres', label: 'Procurement Centres', icon: 'building' },
    { id: 'slots', label: 'Slots & Capacity', icon: 'calendar' },
    { id: 'bookings', label: 'Bookings Management', icon: 'clipboard-check' },
    { id: 'content', label: 'Website Content', icon: 'globe' },
    { id: 'settings', label: 'System Settings', icon: 'settings' },
    { id: 'audit', label: 'Audit Trail Logs', icon: 'activity' }
  ];

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: 'transparent', position: 'relative' }}>
      
      {/* 1. STATE EMBLEM HEADER & NAVIGATION BAR */}
      <header style={{
        backgroundColor: '#ffffff',
        borderBottom: '1px solid var(--kq-border-medium)',
        boxShadow: '0 2px 4px rgba(0,0,0,0.04)',
        position: 'sticky',
        top: 0,
        zIndex: 100
      }}>
        {/* Subtle tri-color public service stripe */}
        <div style={{ height: 3, display: 'flex', width: '100%' }}>
          <div style={{ flex: 1, backgroundColor: '#ea580c' }} />
          <div style={{ flex: 1, backgroundColor: '#ffffff', borderBottom: '1px solid #e5e7eb' }} />
          <div style={{ flex: 1, backgroundColor: '#166534' }} />
        </div>

        <div style={{
          padding: '10px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16
        }}>
          {/* Logo & Super Admin Title */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              type="button"
              className="kq-mobile-menu-btn"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              style={{
                display: 'none',
                background: 'none',
                border: '1px solid var(--kq-border-medium)',
                borderRadius: 'var(--kq-radius-sm)',
                padding: '6px 8px',
                cursor: 'pointer'
              }}
            >
              <Icon name="menu" size={20} color="var(--kq-text-primary)" />
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <KisanLogo size={36} />
              <div>
                <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--kq-green-900)', lineHeight: 1.15, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>KISAN VIKAS</span>
                  <span style={{
                    fontSize: 10,
                    fontWeight: 800,
                    backgroundColor: '#166534',
                    color: '#ffffff',
                    padding: '2px 6px',
                    borderRadius: 4,
                    letterSpacing: '0.05em'
                  }}>
                    SUPER ADMIN
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--kq-text-muted)', fontWeight: 600 }}>
                  Government of Tamil Nadu • State Central Administration Headquarters
                </div>
              </div>
            </div>
          </div>

          {/* Right Header Admin Info & Logout */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ textAlign: 'right', display: 'none', md: 'block' }} className="kq-admin-meta">
              <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--kq-text-primary)' }}>
                {adminUser?.fullName || 'Chief Administrator'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--kq-green-800)', fontWeight: 600 }}>
                {adminUser?.district || 'State HQ (Chennai)'}
              </div>
            </div>

            <button
              type="button"
              onClick={handleLogout}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '7px 14px',
                backgroundColor: '#ffffff',
                border: '1px solid var(--kq-border-medium)',
                color: 'var(--kq-danger-text)',
                borderRadius: 'var(--kq-radius-sm)',
                fontSize: 12.5,
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
              title="Securely terminate Super Administrator session"
            >
              <Icon name="log-out" size={15} color="var(--kq-danger-text)" />
              <span>Log out</span>
            </button>
          </div>
        </div>
      </header>

      {/* 2. MAIN LAYOUT: SIDEBAR + CONTENT AREA */}
      <div style={{ display: 'flex', flex: 1, position: 'relative', zIndex: 1 }}>
        
        {/* SIDEBAR NAVIGATION */}
        <aside
          className={`kq-admin-sidebar ${sidebarOpen ? 'kq-sidebar-open' : ''}`}
          style={{
            width: 250,
            backgroundColor: '#ffffff',
            borderRight: '1px solid var(--kq-border-medium)',
            display: 'flex',
            flexDirection: 'column',
            padding: '16px 10px',
            gap: 4,
            boxShadow: '1px 0 3px rgba(0,0,0,0.02)'
          }}
        >
          <div style={{ padding: '0 8px 10px', fontSize: 11, fontWeight: 800, color: 'var(--kq-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            System Controls
          </div>

          {navItems.map(item => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveTab(item.id);
                  setSidebarOpen(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 12px',
                  borderRadius: 'var(--kq-radius-sm)',
                  border: isActive ? '1px solid var(--kq-green-200)' : '1px solid transparent',
                  backgroundColor: isActive ? 'var(--kq-green-50)' : 'transparent',
                  color: isActive ? 'var(--kq-green-900)' : 'var(--kq-text-secondary)',
                  fontWeight: isActive ? 800 : 600,
                  fontSize: 13,
                  textAlign: 'left',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                <Icon name={item.icon} size={17} color={isActive ? 'var(--kq-green-800)' : 'var(--kq-text-muted)'} />
                <span>{item.label}</span>
              </button>
            );
          })}

          <div style={{ marginTop: 'auto', padding: '12px 10px', borderTop: '1px solid var(--kq-border-light)', fontSize: 11, color: 'var(--kq-text-muted)' }}>
            <div>Session: <strong>Encrypted JWT</strong></div>
            <div style={{ marginTop: 2 }}>Scope: <strong>State Nodal Super Admin</strong></div>
          </div>
        </aside>

        {/* CONTENT SURFACES */}
        <main style={{ flex: 1, padding: '24px 28px', maxWidth: 1280, margin: '0 auto', width: '100%' }}>
          {activeTab === 'overview' && <OverviewTab />}
          {activeTab === 'farmers' && <FarmersTab />}
          {activeTab === 'users' && <UsersTab currentAdmin={adminUser} />}
          {activeTab === 'centres' && <CentresTab />}
          {activeTab === 'slots' && <SlotsTab />}
          {activeTab === 'bookings' && <BookingsTab />}
          {activeTab === 'content' && <ContentTab />}
          {activeTab === 'settings' && <SettingsTab />}
          {activeTab === 'audit' && <AuditLogsTab />}
        </main>

      </div>

      {/* Global subtle leaf/hill agricultural watermark */}
      <KisanNatureBackground />

      <style>{`
        @media (max-width: 900px) {
          .kq-admin-sidebar {
            position: fixed;
            top: 56px;
            bottom: 0;
            left: -260px;
            z-index: 99;
            transition: left 0.2s ease;
          }
          .kq-sidebar-open {
            left: 0 !important;
          }
          .kq-mobile-menu-btn {
            display: inline-flex !important;
          }
        }
      `}</style>

    </div>
  );
}

// =========================================================================
// TAB 1: OVERVIEW TAB
// =========================================================================
function OverviewTab() {
  const api = useAdminApi();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const fetchOverview = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res = await api.get('/overview');
      if (res.data?.success) {
        setData(res.data.metrics);
      }
    } catch (err) {
      console.error('Fetch overview error:', err);
      setError(err.response?.data?.message || 'Unable to load administration overview.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--kq-text-muted)' }}>Loading administrative metrics...</div>;
  }

  if (error) {
    return (
      <div style={{ padding: 20, backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#991b1b' }}>
        <strong>Error:</strong> {error}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      
      {/* Banner Notice */}
      <div style={{
        padding: '14px 18px',
        backgroundColor: '#ffffff',
        border: '1px solid var(--kq-border-medium)',
        borderRadius: 'var(--kq-radius-md)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        boxShadow: 'var(--kq-shadow-xs)'
      }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 900, color: 'var(--kq-green-900)', margin: 0 }}>
            State Procurement Administration Cockpit
          </h2>
          <div style={{ fontSize: 12.5, color: 'var(--kq-text-muted)', marginTop: 2 }}>
            Real-time operations monitor covering all 38 districts of Tamil Nadu
          </div>
        </div>
        <button
          type="button"
          onClick={fetchOverview}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 12px',
            backgroundColor: 'var(--kq-green-50)',
            border: '1px solid var(--kq-green-200)',
            color: 'var(--kq-green-900)',
            borderRadius: 'var(--kq-radius-sm)',
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer'
          }}
        >
          <Icon name="refresh-cw" size={14} color="var(--kq-green-800)" />
          <span>Refresh</span>
        </button>
      </div>

      {/* Primary KPI Metrics Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 16 }}>
        
        <MetricCard
          title="Registered Farmers"
          value={data?.totalFarmers?.toLocaleString() || '0'}
          subtext="Active in state registry"
          icon="users"
          color="#166534"
        />

        <MetricCard
          title="Procurement Centres"
          value={data?.totalCentres?.toLocaleString() || '0'}
          subtext={`${data?.openCentres || 0} Open • ${data?.closedCentres || 0} Closed`}
          icon="building"
          color="#0284c7"
        />

        <MetricCard
          title="Total Bookings"
          value={data?.totalBookings?.toLocaleString() || '0'}
          subtext="Season to date"
          icon="clipboard-check"
          color="#7c3aed"
        />

        <MetricCard
          title="Upcoming Arrivals"
          value={data?.upcomingBookings?.toLocaleString() || '0'}
          subtext="Reserved for today & future"
          icon="calendar"
          color="#ea580c"
        />

        <MetricCard
          title="Procured & Paid"
          value={data?.procuredBookings?.toLocaleString() || '0'}
          subtext="Completed weighment & DBT"
          icon="scale"
          color="#059669"
        />

      </div>

      {/* Status Distribution & Recent Activities */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        
        {/* Booking Status Distribution */}
        <div style={{
          backgroundColor: '#ffffff',
          border: '1px solid var(--kq-border-medium)',
          borderRadius: 'var(--kq-radius-md)',
          padding: '18px 20px',
          boxShadow: 'var(--kq-shadow-xs)'
        }}>
          <h3 style={{ fontSize: 14.5, fontWeight: 800, color: 'var(--kq-text-primary)', marginBottom: 14 }}>
            Booking Lifecycle Distribution
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {data?.statusDistribution?.map(st => {
              const count = parseInt(st.count, 10);
              const total = data?.totalBookings || 1;
              const pct = Math.round((count / total) * 100);
              return (
                <div key={st.status}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
                    <span style={{ fontWeight: 700, color: 'var(--kq-text-secondary)' }}>{st.status}</span>
                    <span style={{ fontWeight: 800, color: 'var(--kq-text-primary)' }}>{count} ({pct}%)</span>
                  </div>
                  <div style={{ height: 6, backgroundColor: '#f1f5f9', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, backgroundColor: getStatusColor(st.status) }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Recent Admin Audit Activity */}
        <div style={{
          backgroundColor: '#ffffff',
          border: '1px solid var(--kq-border-medium)',
          borderRadius: 'var(--kq-radius-md)',
          padding: '18px 20px',
          boxShadow: 'var(--kq-shadow-xs)'
        }}>
          <h3 style={{ fontSize: 14.5, fontWeight: 800, color: 'var(--kq-text-primary)', marginBottom: 14 }}>
            Recent Administrative Actions
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {data?.recentAuditLogs?.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--kq-text-muted)' }}>No recent administrative events recorded.</div>
            ) : (
              data?.recentAuditLogs?.slice(0, 5).map(log => (
                <div key={log.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, borderBottom: '1px solid #f1f5f9', paddingBottom: 6 }}>
                  <div>
                    <strong style={{ color: 'var(--kq-green-900)' }}>{log.action}</strong>
                    <div style={{ color: 'var(--kq-text-muted)' }}>by {log.admin_username} • {log.resource_type} {log.resource_id ? `(${log.resource_id})` : ''}</div>
                  </div>
                  <span style={{ color: '#94a3b8', fontSize: 11 }}>
                    {new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

      </div>

      {/* Recent Bookings Quick Inspection Table */}
      <div style={{
        backgroundColor: '#ffffff',
        border: '1px solid var(--kq-border-medium)',
        borderRadius: 'var(--kq-radius-md)',
        padding: '18px 20px',
        boxShadow: 'var(--kq-shadow-xs)'
      }}>
        <h3 style={{ fontSize: 14.5, fontWeight: 800, color: 'var(--kq-text-primary)', marginBottom: 14 }}>
          Latest Bookings Received
        </h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ borderBottom: '1.5px solid var(--kq-border-medium)', textAlign: 'left', color: 'var(--kq-text-muted)', fontWeight: 800 }}>
                <th style={{ padding: '8px 10px' }}>Booking ID</th>
                <th style={{ padding: '8px 10px' }}>Farmer</th>
                <th style={{ padding: '8px 10px' }}>Centre</th>
                <th style={{ padding: '8px 10px' }}>Date</th>
                <th style={{ padding: '8px 10px' }}>Crop & Qty</th>
                <th style={{ padding: '8px 10px' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {data?.recentBookings?.map(b => (
                <tr key={b.booking_id} style={{ borderBottom: '1px solid var(--kq-border-light)' }}>
                  <td style={{ padding: '10px', fontWeight: 700 }}>{b.booking_id}</td>
                  <td style={{ padding: '10px' }}>{b.farmer_name || b.farmer_id}</td>
                  <td style={{ padding: '10px' }}>{b.centre_name || b.centre_id}</td>
                  <td style={{ padding: '10px' }}>{formatHumanDate(b.booking_date)}</td>
                  <td style={{ padding: '10px' }}>{b.crop} • {b.quantity_quintals} Qtl</td>
                  <td style={{ padding: '10px' }}>
                    <StatusBadge status={b.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}

// =========================================================================
// TAB 2: FARMERS MANAGEMENT TAB
// =========================================================================
function FarmersTab() {
  const api = useAdminApi();
  const [farmers, setFarmers] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [district, setDistrict] = useState('');

  // Modals state
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [selectedFarmer, setSelectedFarmer] = useState(null);

  const [form, setForm] = useState({
    farmer_id: '',
    name: '',
    phone: '',
    village: '',
    district: 'Ariyalur',
    land_holding_acres: 2.5,
    primary_crop: 'Paddy (Samba)',
    preferred_language: 'ta',
    smartphone_access: 'YES'
  });
  const [actionMsg, setActionMsg] = useState('');

  const loadFarmers = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get('/farmers', {
        params: { page, limit: 10, search, district }
      });
      if (res.data?.success) {
        setFarmers(res.data.farmers);
        setTotal(res.data.total);
        setTotalPages(res.data.totalPages || 1);
      }
    } catch (err) {
      console.error('Fetch farmers error:', err);
    } finally {
      setLoading(false);
    }
  }, [page, search, district]);

  useEffect(() => {
    loadFarmers();
  }, [loadFarmers]);

  const handleCreateFarmer = async (e) => {
    e.preventDefault();
    try {
      setActionMsg('');
      const res = await api.post('/farmers', form);
      if (res.data?.success) {
        setCreateOpen(false);
        setForm({
          farmer_id: '',
          name: '',
          phone: '',
          village: '',
          district: 'Ariyalur',
          land_holding_acres: 2.5,
          primary_crop: 'Paddy (Samba)',
          preferred_language: 'ta',
          smartphone_access: 'YES'
        });
        loadFarmers();
      }
    } catch (err) {
      setActionMsg(err.response?.data?.message || 'Failed to create farmer.');
    }
  };

  const handleUpdateFarmer = async (e) => {
    e.preventDefault();
    if (!selectedFarmer) return;
    try {
      setActionMsg('');
      const res = await api.put(`/farmers/${selectedFarmer.farmer_id}`, form);
      if (res.data?.success) {
        setEditOpen(false);
        loadFarmers();
      }
    } catch (err) {
      setActionMsg(err.response?.data?.message || 'Failed to update farmer.');
    }
  };

  const handleToggleStatus = async (farmer) => {
    const newStatus = !farmer.is_active;
    const confirmMsg = `Are you sure you want to ${newStatus ? 'activate' : 'deactivate'} farmer ${farmer.name || farmer.farmer_id}?`;
    if (!window.confirm(confirmMsg)) return;

    try {
      await api.patch(`/farmers/${farmer.farmer_id}/status`, { is_active: newStatus });
      loadFarmers();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to change farmer status.');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      
      {/* Action Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 900, color: 'var(--kq-green-900)', margin: 0 }}>Farmer Registry</h2>
          <div style={{ fontSize: 12.5, color: 'var(--kq-text-muted)' }}>Search and manage verified farmer identity records ({total} total)</div>
        </div>
        <PrimaryButton onClick={() => { setForm({ farmer_id: `F${Math.floor(100000 + Math.random() * 900000)}`, name: '', phone: '', village: '', district: 'Ariyalur', land_holding_acres: 2.0, primary_crop: 'Paddy (Samba)', preferred_language: 'ta', smartphone_access: 'YES' }); setActionMsg(''); setCreateOpen(true); }}>
          <Icon name="plus" size={16} />
          <span>Add New Farmer</span>
        </PrimaryButton>
      </div>

      {/* Filter Bar */}
      <div style={{
        display: 'flex',
        gap: 12,
        backgroundColor: '#ffffff',
        padding: '12px 16px',
        borderRadius: 'var(--kq-radius-md)',
        border: '1px solid var(--kq-border-medium)',
        flexWrap: 'wrap'
      }}>
        <div style={{ flex: 1, minWidth: 200, position: 'relative' }}>
          <input
            className="kq-input"
            placeholder="Search by Farmer ID, Name, Phone, or Village..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            style={{ paddingLeft: 34, height: 38, fontSize: 13 }}
          />
          <span style={{ position: 'absolute', left: 10, top: 10, color: '#94a3b8' }}>
            <Icon name="search" size={16} />
          </span>
        </div>

        <select
          className="kq-input"
          value={district}
          onChange={e => { setDistrict(e.target.value); setPage(1); }}
          style={{ width: 180, height: 38, fontSize: 13 }}
        >
          <option value="">All Districts</option>
          {['Ariyalur', 'Thanjavur', 'Thiruchirappalli', 'Madurai', 'Salem', 'Erode', 'Tirunelveli', 'Vellore'].map(d => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      </div>

      {/* Farmers Data Table */}
      <div style={{ backgroundColor: '#ffffff', border: '1px solid var(--kq-border-medium)', borderRadius: 'var(--kq-radius-md)', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr style={{ borderBottom: '1.5px solid var(--kq-border-medium)', backgroundColor: 'var(--kq-bg-subtle)', textAlign: 'left', color: 'var(--kq-text-secondary)', fontWeight: 800 }}>
              <th style={{ padding: '10px 12px' }}>Farmer ID</th>
              <th style={{ padding: '10px 12px' }}>Name</th>
              <th style={{ padding: '10px 12px' }}>Phone</th>
              <th style={{ padding: '10px 12px' }}>Village & District</th>
              <th style={{ padding: '10px 12px' }}>Land Holding</th>
              <th style={{ padding: '10px 12px' }}>Crop</th>
              <th style={{ padding: '10px 12px' }}>Status</th>
              <th style={{ padding: '10px 12px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>Loading records...</td></tr>
            ) : farmers.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>No farmer records found matching criteria.</td></tr>
            ) : (
              farmers.map(f => (
                <tr key={f.farmer_id} style={{ borderBottom: '1px solid var(--kq-border-light)' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 800, color: 'var(--kq-green-900)' }}>{f.farmer_id}</td>
                  <td style={{ padding: '10px 12px', fontWeight: 700 }}>{f.name}</td>
                  <td style={{ padding: '10px 12px', color: '#475569' }}>{f.phone}</td>
                  <td style={{ padding: '10px 12px' }}>{f.village ? `${f.village}, ` : ''}{f.district}</td>
                  <td style={{ padding: '10px 12px' }}>{f.land_holding_acres} Acres</td>
                  <td style={{ padding: '10px 12px' }}>{f.primary_crop}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{
                      padding: '2px 8px',
                      borderRadius: 12,
                      fontSize: 11,
                      fontWeight: 800,
                      backgroundColor: f.is_active ? '#dcfce7' : '#fee2e2',
                      color: f.is_active ? '#15803d' : '#b91c1c'
                    }}>
                      {f.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: 6 }}>
                      <button
                        type="button"
                        onClick={() => { setSelectedFarmer(f); setViewOpen(true); }}
                        style={{ padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 4, background: '#fff', cursor: 'pointer', fontSize: 11.5 }}
                        title="View Full Profile"
                      >
                        <Icon name="eye" size={13} color="#475569" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedFarmer(f);
                          setForm({ ...f });
                          setActionMsg('');
                          setEditOpen(true);
                        }}
                        style={{ padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 4, background: '#fff', cursor: 'pointer', fontSize: 11.5 }}
                        title="Edit Details"
                      >
                        <Icon name="edit-2" size={13} color="#0284c7" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleStatus(f)}
                        style={{
                          padding: '4px 8px',
                          border: '1px solid #cbd5e1',
                          borderRadius: 4,
                          background: '#fff',
                          cursor: 'pointer',
                          fontSize: 11.5,
                          color: f.is_active ? '#b91c1c' : '#15803d'
                        }}
                        title={f.is_active ? 'Deactivate record' : 'Activate record'}
                      >
                        {f.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12.5, color: 'var(--kq-text-muted)' }}>
        <span>Showing Page {page} of {totalPages} ({total} farmers)</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
            style={{ padding: '5px 12px', border: '1px solid #cbd5e1', borderRadius: 4, background: '#fff', cursor: page > 1 ? 'pointer' : 'default', opacity: page > 1 ? 1 : 0.5 }}
          >
            Previous
          </button>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
            style={{ padding: '5px 12px', border: '1px solid #cbd5e1', borderRadius: 4, background: '#fff', cursor: page < totalPages ? 'pointer' : 'default', opacity: page < totalPages ? 1 : 0.5 }}
          >
            Next
          </button>
        </div>
      </div>

      {/* ADD FARMER MODAL */}
      <Modal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Register New Farmer"
        subtitle="Create verified state agricultural registry record"
        maxWidth={500}
      >
        <form onSubmit={handleCreateFarmer} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {actionMsg && <div style={{ padding: 8, backgroundColor: '#fef2f2', color: '#991b1b', borderRadius: 4, fontSize: 12 }}>{actionMsg}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 11.5, fontWeight: 700 }}>Farmer ID *</label>
              <input className="kq-input" value={form.farmer_id} onChange={e => setForm({ ...form, farmer_id: e.target.value })} required style={{ height: 36, fontSize: 13 }} />
            </div>
            <div>
              <label style={{ fontSize: 11.5, fontWeight: 700 }}>Full Name *</label>
              <input className="kq-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required style={{ height: 36, fontSize: 13 }} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 11.5, fontWeight: 700 }}>Mobile Number *</label>
              <input className="kq-input" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} required style={{ height: 36, fontSize: 13 }} />
            </div>
            <div>
              <label style={{ fontSize: 11.5, fontWeight: 700 }}>District *</label>
              <input className="kq-input" value={form.district} onChange={e => setForm({ ...form, district: e.target.value })} required style={{ height: 36, fontSize: 13 }} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 11.5, fontWeight: 700 }}>Village</label>
              <input className="kq-input" value={form.village} onChange={e => setForm({ ...form, village: e.target.value })} style={{ height: 36, fontSize: 13 }} />
            </div>
            <div>
              <label style={{ fontSize: 11.5, fontWeight: 700 }}>Land Holding (Acres)</label>
              <input className="kq-input" type="number" step="0.1" value={form.land_holding_acres} onChange={e => setForm({ ...form, land_holding_acres: e.target.value })} style={{ height: 36, fontSize: 13 }} />
            </div>
          </div>

          <div>
            <label style={{ fontSize: 11.5, fontWeight: 700 }}>Primary Crop</label>
            <input className="kq-input" value={form.primary_crop} onChange={e => setForm({ ...form, primary_crop: e.target.value })} style={{ height: 36, fontSize: 13 }} />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
            <SecondaryButton onClick={() => setCreateOpen(false)}>Cancel</SecondaryButton>
            <PrimaryButton type="submit">Save Farmer Record</PrimaryButton>
          </div>
        </form>
      </Modal>

      {/* EDIT FARMER MODAL */}
      <Modal
        isOpen={editOpen}
        onClose={() => setEditOpen(false)}
        title={`Edit Farmer: ${selectedFarmer?.farmer_id}`}
        subtitle="Identity protected; edit permitted demographics"
        maxWidth={500}
      >
        <form onSubmit={handleUpdateFarmer} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {actionMsg && <div style={{ padding: 8, backgroundColor: '#fef2f2', color: '#991b1b', borderRadius: 4, fontSize: 12 }}>{actionMsg}</div>}
          <div>
            <label style={{ fontSize: 11.5, fontWeight: 700 }}>Full Name *</label>
            <input className="kq-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required style={{ height: 36, fontSize: 13 }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 11.5, fontWeight: 700 }}>Mobile Number *</label>
              <input className="kq-input" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} required style={{ height: 36, fontSize: 13 }} />
            </div>
            <div>
              <label style={{ fontSize: 11.5, fontWeight: 700 }}>District *</label>
              <input className="kq-input" value={form.district} onChange={e => setForm({ ...form, district: e.target.value })} required style={{ height: 36, fontSize: 13 }} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 11.5, fontWeight: 700 }}>Village</label>
              <input className="kq-input" value={form.village} onChange={e => setForm({ ...form, village: e.target.value })} style={{ height: 36, fontSize: 13 }} />
            </div>
            <div>
              <label style={{ fontSize: 11.5, fontWeight: 700 }}>Land Holding (Acres)</label>
              <input className="kq-input" type="number" step="0.1" value={form.land_holding_acres} onChange={e => setForm({ ...form, land_holding_acres: e.target.value })} style={{ height: 36, fontSize: 13 }} />
            </div>
          </div>

          <div>
            <label style={{ fontSize: 11.5, fontWeight: 700 }}>Primary Crop</label>
            <input className="kq-input" value={form.primary_crop} onChange={e => setForm({ ...form, primary_crop: e.target.value })} style={{ height: 36, fontSize: 13 }} />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
            <SecondaryButton onClick={() => setEditOpen(false)}>Cancel</SecondaryButton>
            <PrimaryButton type="submit">Update Record</PrimaryButton>
          </div>
        </form>
      </Modal>

      {/* VIEW FARMER DETAILS MODAL */}
      <Modal
        isOpen={viewOpen}
        onClose={() => setViewOpen(false)}
        title={`Farmer Profile: ${selectedFarmer?.name || selectedFarmer?.farmer_id}`}
        subtitle={`ID: ${selectedFarmer?.farmer_id}`}
        maxWidth={500}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, background: '#f8fafc', padding: 12, borderRadius: 6 }}>
            <div><span style={{ color: '#64748b' }}>Mobile:</span> <strong>{selectedFarmer?.phone}</strong></div>
            <div><span style={{ color: '#64748b' }}>District:</span> <strong>{selectedFarmer?.district}</strong></div>
            <div><span style={{ color: '#64748b' }}>Village:</span> <strong>{selectedFarmer?.village || '—'}</strong></div>
            <div><span style={{ color: '#64748b' }}>Land:</span> <strong>{selectedFarmer?.land_holding_acres} Acres</strong></div>
            <div><span style={{ color: '#64748b' }}>Primary Crop:</span> <strong>{selectedFarmer?.primary_crop}</strong></div>
            <div><span style={{ color: '#64748b' }}>Smartphone:</span> <strong>{selectedFarmer?.smartphone_access}</strong></div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
            <SecondaryButton onClick={() => setViewOpen(false)}>Close</SecondaryButton>
          </div>
        </div>
      </Modal>

    </div>
  );
}

// =========================================================================
// TAB 3: USERS AND ROLES MANAGEMENT TAB
// =========================================================================
function UsersTab({ currentAdmin }) {
  const api = useAdminApi();
  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [roleFilter, setRoleFilter] = useState('');
  const [search, setSearch] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);

  const [newUser, setNewUser] = useState({
    username: '',
    password: '',
    role: 'CENTRE_ADMIN',
    full_name: '',
    district: 'Ariyalur',
    centre_id: ''
  });
  const [newPassword, setNewPassword] = useState('');
  const [actionMsg, setActionMsg] = useState('');

  const loadUsers = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get('/users', {
        params: { page, limit: 12, role: roleFilter, search }
      });
      if (res.data?.success) {
        setUsers(res.data.users);
        setTotal(res.data.total);
        setTotalPages(res.data.totalPages || 1);
      }
    } catch (err) {
      console.error('Fetch users error:', err);
    } finally {
      setLoading(false);
    }
  }, [page, roleFilter, search]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleCreateUser = async (e) => {
    e.preventDefault();
    try {
      setActionMsg('');
      const res = await api.post('/users', newUser);
      if (res.data?.success) {
        setCreateOpen(false);
        setNewUser({ username: '', password: '', role: 'CENTRE_ADMIN', full_name: '', district: 'Ariyalur', centre_id: '' });
        loadUsers();
      }
    } catch (err) {
      setActionMsg(err.response?.data?.message || 'Failed to create user account.');
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    if (!selectedUser) return;
    try {
      setActionMsg('');
      const res = await api.post(`/users/${selectedUser.user_id}/reset-password`, { new_password: newPassword });
      if (res.data?.success) {
        setResetOpen(false);
        setNewPassword('');
        alert(res.data.message);
      }
    } catch (err) {
      setActionMsg(err.response?.data?.message || 'Failed to reset password.');
    }
  };

  const handleToggleStatus = async (user) => {
    if (user.user_id === currentAdmin?.userId) {
      alert('You cannot deactivate your own administrative account.');
      return;
    }
    const newStatus = !user.is_active;
    if (!window.confirm(`Are you sure you want to ${newStatus ? 'activate' : 'deactivate'} user ${user.username}?`)) return;

    try {
      await api.patch(`/users/${user.user_id}/status`, { is_active: newStatus });
      loadUsers();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to change status.');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 900, color: 'var(--kq-green-900)', margin: 0 }}>System Users & Role Access</h2>
          <div style={{ fontSize: 12.5, color: 'var(--kq-text-muted)' }}>Role-based access control and administrative credential management ({total} accounts)</div>
        </div>
        <PrimaryButton onClick={() => { setNewUser({ username: '', password: '', role: 'CENTRE_ADMIN', full_name: '', district: 'Ariyalur', centre_id: '' }); setActionMsg(''); setCreateOpen(true); }}>
          <Icon name="plus" size={16} />
          <span>Create Operator Account</span>
        </PrimaryButton>
      </div>

      {/* Filter Bar */}
      <div style={{ display: 'flex', gap: 12, backgroundColor: '#ffffff', padding: '12px 16px', borderRadius: 'var(--kq-radius-md)', border: '1px solid var(--kq-border-medium)', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200, position: 'relative' }}>
          <input
            className="kq-input"
            placeholder="Search by username, officer name, or district..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            style={{ paddingLeft: 34, height: 38, fontSize: 13 }}
          />
          <span style={{ position: 'absolute', left: 10, top: 10, color: '#94a3b8' }}>
            <Icon name="search" size={16} />
          </span>
        </div>

        <select
          className="kq-input"
          value={roleFilter}
          onChange={e => { setRoleFilter(e.target.value); setPage(1); }}
          style={{ width: 180, height: 38, fontSize: 13 }}
        >
          <option value="">All Roles</option>
          <option value="SUPER_ADMIN">SUPER_ADMIN</option>
          <option value="DISTRICT_OFFICER">DISTRICT_OFFICER</option>
          <option value="CENTRE_ADMIN">CENTRE_ADMIN</option>
          <option value="CSC_OPERATOR">CSC_OPERATOR</option>
          <option value="FARMER">FARMER</option>
        </select>
      </div>

      {/* Table */}
      <div style={{ backgroundColor: '#ffffff', border: '1px solid var(--kq-border-medium)', borderRadius: 'var(--kq-radius-md)', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr style={{ borderBottom: '1.5px solid var(--kq-border-medium)', backgroundColor: 'var(--kq-bg-subtle)', textAlign: 'left', color: 'var(--kq-text-secondary)', fontWeight: 800 }}>
              <th style={{ padding: '10px 12px' }}>Username</th>
              <th style={{ padding: '10px 12px' }}>Full Name</th>
              <th style={{ padding: '10px 12px' }}>Role</th>
              <th style={{ padding: '10px 12px' }}>District / Scope</th>
              <th style={{ padding: '10px 12px' }}>Centre ID</th>
              <th style={{ padding: '10px 12px' }}>Status</th>
              <th style={{ padding: '10px 12px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>Loading user directory...</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>No user accounts found.</td></tr>
            ) : (
              users.map(u => (
                <tr key={u.user_id} style={{ borderBottom: '1px solid var(--kq-border-light)' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 800, color: 'var(--kq-green-900)' }}>{u.username}</td>
                  <td style={{ padding: '10px 12px' }}>{u.full_name || '—'}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{
                      padding: '2px 8px',
                      borderRadius: 12,
                      fontSize: 10.5,
                      fontWeight: 800,
                      backgroundColor: u.role === 'SUPER_ADMIN' ? '#fef3c7' : u.role === 'DISTRICT_OFFICER' ? '#e0f2fe' : '#f0fdf4',
                      color: u.role === 'SUPER_ADMIN' ? '#92400e' : u.role === 'DISTRICT_OFFICER' ? '#0369a1' : '#166534'
                    }}>
                      {u.role}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px' }}>{u.district || '—'}</td>
                  <td style={{ padding: '10px 12px' }}>{u.centre_id || '—'}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{
                      padding: '2px 8px',
                      borderRadius: 12,
                      fontSize: 11,
                      fontWeight: 800,
                      backgroundColor: u.is_active ? '#dcfce7' : '#fee2e2',
                      color: u.is_active ? '#15803d' : '#b91c1c'
                    }}>
                      {u.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: 6 }}>
                      <button
                        type="button"
                        onClick={() => { setSelectedUser(u); setNewPassword(''); setActionMsg(''); setResetOpen(true); }}
                        style={{ padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 4, background: '#fff', cursor: 'pointer', fontSize: 11.5 }}
                        title="Reset User Password"
                      >
                        <Icon name="key" size={13} color="#d97706" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleStatus(u)}
                        disabled={u.user_id === currentAdmin?.userId}
                        style={{
                          padding: '4px 8px',
                          border: '1px solid #cbd5e1',
                          borderRadius: 4,
                          background: '#fff',
                          cursor: u.user_id === currentAdmin?.userId ? 'not-allowed' : 'pointer',
                          fontSize: 11.5,
                          color: u.is_active ? '#b91c1c' : '#15803d',
                          opacity: u.user_id === currentAdmin?.userId ? 0.4 : 1
                        }}
                        title={u.is_active ? 'Deactivate Account' : 'Activate Account'}
                      >
                        {u.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12.5, color: 'var(--kq-text-muted)' }}>
        <span>Showing Page {page} of {totalPages} ({total} accounts)</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} style={{ padding: '5px 12px', border: '1px solid #cbd5e1', borderRadius: 4, background: '#fff', opacity: page > 1 ? 1 : 0.5 }}>Previous</button>
          <button type="button" disabled={page >= totalPages} onClick={() => setPage(page + 1)} style={{ padding: '5px 12px', border: '1px solid #cbd5e1', borderRadius: 4, background: '#fff', opacity: page < totalPages ? 1 : 0.5 }}>Next</button>
        </div>
      </div>

      {/* CREATE USER MODAL */}
      <Modal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create Authorized System Account"
        subtitle="Provision portal login with strict role assignments"
        maxWidth={480}
      >
        <form onSubmit={handleCreateUser} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {actionMsg && <div style={{ padding: 8, backgroundColor: '#fef2f2', color: '#991b1b', borderRadius: 4, fontSize: 12 }}>{actionMsg}</div>}
          
          <div>
            <label style={{ fontSize: 11.5, fontWeight: 700 }}>Role *</label>
            <select className="kq-input" value={newUser.role} onChange={e => setNewUser({ ...newUser, role: e.target.value })} style={{ height: 36, fontSize: 13 }}>
              <option value="CENTRE_ADMIN">CENTRE_ADMIN (DPC Operator)</option>
              <option value="DISTRICT_OFFICER">DISTRICT_OFFICER (District Command)</option>
              <option value="CSC_OPERATOR">CSC_OPERATOR (Assisted Kiosk)</option>
              <option value="SUPER_ADMIN">SUPER_ADMIN (State Nodal)</option>
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 11.5, fontWeight: 700 }}>Username *</label>
              <input className="kq-input" value={newUser.username} onChange={e => setNewUser({ ...newUser, username: e.target.value })} required style={{ height: 36, fontSize: 13 }} />
            </div>
            <div>
              <label style={{ fontSize: 11.5, fontWeight: 700 }}>Password (min 6 chars) *</label>
              <input className="kq-input" type="password" value={newUser.password} onChange={e => setNewUser({ ...newUser, password: e.target.value })} required style={{ height: 36, fontSize: 13 }} />
            </div>
          </div>

          <div>
            <label style={{ fontSize: 11.5, fontWeight: 700 }}>Full Name *</label>
            <input className="kq-input" value={newUser.full_name} onChange={e => setNewUser({ ...newUser, full_name: e.target.value })} required style={{ height: 36, fontSize: 13 }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 11.5, fontWeight: 700 }}>District</label>
              <input className="kq-input" value={newUser.district} onChange={e => setNewUser({ ...newUser, district: e.target.value })} style={{ height: 36, fontSize: 13 }} />
            </div>
            <div>
              <label style={{ fontSize: 11.5, fontWeight: 700 }}>Centre ID (For Centre Admins)</label>
              <input className="kq-input" placeholder="e.g. TN_DPC_0859" value={newUser.centre_id} onChange={e => setNewUser({ ...newUser, centre_id: e.target.value })} style={{ height: 36, fontSize: 13 }} />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
            <SecondaryButton onClick={() => setCreateOpen(false)}>Cancel</SecondaryButton>
            <PrimaryButton type="submit">Create Account</PrimaryButton>
          </div>
        </form>
      </Modal>

      {/* RESET PASSWORD MODAL */}
      <Modal
        isOpen={resetOpen}
        onClose={() => setResetOpen(false)}
        title={`Reset Password: ${selectedUser?.username}`}
        subtitle="Set a new secure credential for this user account"
        maxWidth={400}
      >
        <form onSubmit={handleResetPassword} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {actionMsg && <div style={{ padding: 8, backgroundColor: '#fef2f2', color: '#991b1b', borderRadius: 4, fontSize: 12 }}>{actionMsg}</div>}
          <div>
            <label style={{ fontSize: 11.5, fontWeight: 700 }}>New Password (min 6 chars) *</label>
            <input className="kq-input" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required minLength={6} style={{ height: 36, fontSize: 13 }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
            <SecondaryButton onClick={() => setResetOpen(false)}>Cancel</SecondaryButton>
            <PrimaryButton type="submit">Reset Password</PrimaryButton>
          </div>
        </form>
      </Modal>

    </div>
  );
}

// =========================================================================
// TAB 4: PROCUREMENT CENTRES MANAGEMENT TAB
// =========================================================================
function CentresTab() {
  const api = useAdminApi();
  const [centres, setCentres] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [district, setDistrict] = useState('');
  const [status, setStatus] = useState('');

  const [editOpen, setEditOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedCentre, setSelectedCentre] = useState(null);
  const [statusHistory, setStatusHistory] = useState([]);

  const [form, setForm] = useState({
    centre_id: '',
    centre_name: '',
    village_town: '',
    district: 'Ariyalur',
    operational_status: 'OPEN',
    daily_capacity_slots: 50,
    storage_capacity_mt: 500,
    active_counters: 2,
    staff_availability: 5,
    processing_rate_min: 12,
    status_reason: ''
  });
  const [actionMsg, setActionMsg] = useState('');

  const loadCentres = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get('/centres', {
        params: { page, limit: 12, search, district, status }
      });
      if (res.data?.success) {
        setCentres(res.data.centres);
        setTotal(res.data.total);
        setTotalPages(res.data.totalPages || 1);
      }
    } catch (err) {
      console.error('Fetch centres error:', err);
    } finally {
      setLoading(false);
    }
  }, [page, search, district, status]);

  useEffect(() => {
    loadCentres();
  }, [loadCentres]);

  const handleUpdateCentre = async (e) => {
    e.preventDefault();
    if (!selectedCentre) return;
    try {
      setActionMsg('');
      const res = await api.put(`/centres/${selectedCentre.centre_id}`, form);
      if (res.data?.success) {
        setEditOpen(false);
        loadCentres();
      }
    } catch (err) {
      setActionMsg(err.response?.data?.message || 'Failed to update centre.');
    }
  };

  const handleAddCentre = async (e) => {
    e.preventDefault();
    try {
      setActionMsg('');
      const res = await api.post('/centres', form);
      if (res.data?.success) {
        setAddOpen(false);
        loadCentres();
      }
    } catch (err) {
      setActionMsg(err.response?.data?.message || 'Failed to create centre.');
    }
  };

  const handleViewHistory = async (centre) => {
    setSelectedCentre(centre);
    try {
      const res = await api.get(`/centres/${centre.centre_id}`);
      if (res.data?.success) {
        setStatusHistory(res.data.statusHistory || []);
        setHistoryOpen(true);
      }
    } catch (err) {
      alert('Failed to load status history.');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 900, color: 'var(--kq-green-900)', margin: 0 }}>Direct Procurement Centres (DPC)</h2>
          <div style={{ fontSize: 12.5, color: 'var(--kq-text-muted)' }}>Operational infrastructure, counter capacities, and status audit tracking ({total} centres)</div>
        </div>
        <PrimaryButton onClick={() => { setForm({ centre_id: `TN_DPC_${Math.floor(4000 + Math.random() * 5000)}`, centre_name: '', village_town: '', district: 'Ariyalur', operational_status: 'OPEN', daily_capacity_slots: 50, storage_capacity_mt: 500, active_counters: 2, staff_availability: 5, processing_rate_min: 12, status_reason: '' }); setActionMsg(''); setAddOpen(true); }}>
          <Icon name="plus" size={16} />
          <span>Add Centre</span>
        </PrimaryButton>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, backgroundColor: '#ffffff', padding: '12px 16px', borderRadius: 'var(--kq-radius-md)', border: '1px solid var(--kq-border-medium)', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200, position: 'relative' }}>
          <input
            className="kq-input"
            placeholder="Search by centre ID or name..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            style={{ paddingLeft: 34, height: 38, fontSize: 13 }}
          />
          <span style={{ position: 'absolute', left: 10, top: 10, color: '#94a3b8' }}>
            <Icon name="search" size={16} />
          </span>
        </div>

        <select className="kq-input" value={district} onChange={e => { setDistrict(e.target.value); setPage(1); }} style={{ width: 170, height: 38, fontSize: 13 }}>
          <option value="">All Districts</option>
          {['Ariyalur', 'Thanjavur', 'Thiruchirappalli', 'Madurai', 'Salem', 'Erode', 'Tirunelveli', 'Vellore'].map(d => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>

        <select className="kq-input" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }} style={{ width: 150, height: 38, fontSize: 13 }}>
          <option value="">All Statuses</option>
          <option value="OPEN">OPEN</option>
          <option value="CLOSED">CLOSED</option>
          <option value="TEMPORARILY_CLOSED">TEMPORARILY_CLOSED</option>
        </select>
      </div>

      {/* Table */}
      <div style={{ backgroundColor: '#ffffff', border: '1px solid var(--kq-border-medium)', borderRadius: 'var(--kq-radius-md)', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr style={{ borderBottom: '1.5px solid var(--kq-border-medium)', backgroundColor: 'var(--kq-bg-subtle)', textAlign: 'left', color: 'var(--kq-text-secondary)', fontWeight: 800 }}>
              <th style={{ padding: '10px 12px' }}>Centre ID</th>
              <th style={{ padding: '10px 12px' }}>Centre Name</th>
              <th style={{ padding: '10px 12px' }}>District</th>
              <th style={{ padding: '10px 12px' }}>Status</th>
              <th style={{ padding: '10px 12px' }}>Counters</th>
              <th style={{ padding: '10px 12px' }}>Staff</th>
              <th style={{ padding: '10px 12px' }}>Rate</th>
              <th style={{ padding: '10px 12px' }}>Storage</th>
              <th style={{ padding: '10px 12px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>Loading procurement centres...</td></tr>
            ) : centres.length === 0 ? (
              <tr><td colSpan={9} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>No procurement centres found.</td></tr>
            ) : (
              centres.map(c => (
                <tr key={c.centre_id} style={{ borderBottom: '1px solid var(--kq-border-light)' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 800, color: 'var(--kq-green-900)' }}>{c.centre_id}</td>
                  <td style={{ padding: '10px 12px', fontWeight: 700 }}>{c.centre_name}</td>
                  <td style={{ padding: '10px 12px' }}>{c.district}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{
                      padding: '2px 8px',
                      borderRadius: 12,
                      fontSize: 11,
                      fontWeight: 800,
                      backgroundColor: c.operational_status === 'OPEN' ? '#dcfce7' : '#fee2e2',
                      color: c.operational_status === 'OPEN' ? '#15803d' : '#b91c1c'
                    }}>
                      {c.operational_status}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px' }}>{c.active_counters} Active</td>
                  <td style={{ padding: '10px 12px' }}>{c.staff_availability} Staff</td>
                  <td style={{ padding: '10px 12px' }}>{c.processing_rate_min}m/farmer</td>
                  <td style={{ padding: '10px 12px' }}>{c.storage_capacity_mt} MT</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: 6 }}>
                      <button
                        type="button"
                        onClick={() => handleViewHistory(c)}
                        style={{ padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 4, background: '#fff', cursor: 'pointer', fontSize: 11.5 }}
                        title="View Status History"
                      >
                        <Icon name="activity" size={13} color="#475569" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedCentre(c);
                          setForm({ ...c, status_reason: '' });
                          setActionMsg('');
                          setEditOpen(true);
                        }}
                        style={{ padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 4, background: '#fff', cursor: 'pointer', fontSize: 11.5 }}
                        title="Edit Centre & Status"
                      >
                        <Icon name="edit-2" size={13} color="#0284c7" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12.5, color: 'var(--kq-text-muted)' }}>
        <span>Showing Page {page} of {totalPages} ({total} centres)</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} style={{ padding: '5px 12px', border: '1px solid #cbd5e1', borderRadius: 4, background: '#fff', opacity: page > 1 ? 1 : 0.5 }}>Previous</button>
          <button type="button" disabled={page >= totalPages} onClick={() => setPage(page + 1)} style={{ padding: '5px 12px', border: '1px solid #cbd5e1', borderRadius: 4, background: '#fff', opacity: page < totalPages ? 1 : 0.5 }}>Next</button>
        </div>
      </div>

      {/* EDIT CENTRE MODAL */}
      <Modal
        isOpen={editOpen}
        onClose={() => setEditOpen(false)}
        title={`Edit Centre: ${selectedCentre?.centre_name}`}
        subtitle={`ID: ${selectedCentre?.centre_id}`}
        maxWidth={500}
      >
        <form onSubmit={handleUpdateCentre} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {actionMsg && <div style={{ padding: 8, backgroundColor: '#fef2f2', color: '#991b1b', borderRadius: 4, fontSize: 12 }}>{actionMsg}</div>}
          
          <div>
            <label style={{ fontSize: 11.5, fontWeight: 700 }}>Operational Status *</label>
            <select className="kq-input" value={form.operational_status} onChange={e => setForm({ ...form, operational_status: e.target.value })} style={{ height: 36, fontSize: 13 }}>
              <option value="OPEN">OPEN (Accepting Arrivals & Slots)</option>
              <option value="CLOSED">CLOSED (No Procurement Operations)</option>
              <option value="TEMPORARILY_CLOSED">TEMPORARILY_CLOSED (Temporary Maintenance)</option>
            </select>
          </div>

          <div>
            <label style={{ fontSize: 11.5, fontWeight: 700 }}>Status Change Justification Note</label>
            <input className="kq-input" placeholder="e.g. Administrative order / Weather disruption" value={form.status_reason} onChange={e => setForm({ ...form, status_reason: e.target.value })} style={{ height: 36, fontSize: 13 }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 11.5, fontWeight: 700 }}>Active Weigh Counters</label>
              <input className="kq-input" type="number" min="1" max="10" value={form.active_counters} onChange={e => setForm({ ...form, active_counters: e.target.value })} style={{ height: 36, fontSize: 13 }} />
            </div>
            <div>
              <label style={{ fontSize: 11.5, fontWeight: 700 }}>Staff Availability</label>
              <input className="kq-input" type="number" min="1" max="25" value={form.staff_availability} onChange={e => setForm({ ...form, staff_availability: e.target.value })} style={{ height: 36, fontSize: 13 }} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 11.5, fontWeight: 700 }}>Processing Rate (min/farmer)</label>
              <input className="kq-input" type="number" min="5" max="60" value={form.processing_rate_min} onChange={e => setForm({ ...form, processing_rate_min: e.target.value })} style={{ height: 36, fontSize: 13 }} />
            </div>
            <div>
              <label style={{ fontSize: 11.5, fontWeight: 700 }}>Daily Slot Capacity</label>
              <input className="kq-input" type="number" min="10" max="500" value={form.daily_capacity_slots} onChange={e => setForm({ ...form, daily_capacity_slots: e.target.value })} style={{ height: 36, fontSize: 13 }} />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
            <SecondaryButton onClick={() => setEditOpen(false)}>Cancel</SecondaryButton>
            <PrimaryButton type="submit">Save Changes</PrimaryButton>
          </div>
        </form>
      </Modal>

      {/* ADD CENTRE MODAL */}
      <Modal
        isOpen={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add Direct Procurement Centre"
        subtitle="Provision a new government procurement centre"
        maxWidth={500}
      >
        <form onSubmit={handleAddCentre} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {actionMsg && <div style={{ padding: 8, backgroundColor: '#fef2f2', color: '#991b1b', borderRadius: 4, fontSize: 12 }}>{actionMsg}</div>}
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 11.5, fontWeight: 700 }}>Centre ID *</label>
              <input className="kq-input" value={form.centre_id} onChange={e => setForm({ ...form, centre_id: e.target.value })} required style={{ height: 36, fontSize: 13 }} />
            </div>
            <div>
              <label style={{ fontSize: 11.5, fontWeight: 700 }}>District *</label>
              <input className="kq-input" value={form.district} onChange={e => setForm({ ...form, district: e.target.value })} required style={{ height: 36, fontSize: 13 }} />
            </div>
          </div>

          <div>
            <label style={{ fontSize: 11.5, fontWeight: 700 }}>Centre Name *</label>
            <input className="kq-input" value={form.centre_name} onChange={e => setForm({ ...form, centre_name: e.target.value })} required style={{ height: 36, fontSize: 13 }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 11.5, fontWeight: 700 }}>Village / Town</label>
              <input className="kq-input" value={form.village_town} onChange={e => setForm({ ...form, village_town: e.target.value })} style={{ height: 36, fontSize: 13 }} />
            </div>
            <div>
              <label style={{ fontSize: 11.5, fontWeight: 700 }}>Status</label>
              <select className="kq-input" value={form.operational_status} onChange={e => setForm({ ...form, operational_status: e.target.value })} style={{ height: 36, fontSize: 13 }}>
                <option value="OPEN">OPEN</option>
                <option value="CLOSED">CLOSED</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
            <SecondaryButton onClick={() => setAddOpen(false)}>Cancel</SecondaryButton>
            <PrimaryButton type="submit">Create Centre</PrimaryButton>
          </div>
        </form>
      </Modal>

      {/* HISTORY MODAL */}
      <Modal
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
        title={`Status Audit Trail: ${selectedCentre?.centre_name}`}
        subtitle={`Centre ID: ${selectedCentre?.centre_id}`}
        maxWidth={500}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {statusHistory.length === 0 ? (
            <div style={{ fontSize: 13, color: '#64748b', padding: 12 }}>No historical status changes recorded for this centre.</div>
          ) : (
            statusHistory.map(h => (
              <div key={h.id} style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: 10, fontSize: 12.5, background: '#f8fafc' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <strong>{h.previous_status || 'INITIAL'} → <span style={{ color: h.new_status === 'OPEN' ? '#15803d' : '#b91c1c' }}>{h.new_status}</span></strong>
                  <span style={{ color: '#94a3b8', fontSize: 11 }}>{new Date(h.changed_at).toLocaleString()}</span>
                </div>
                <div style={{ color: '#475569' }}>Reason: {h.reason}</div>
                <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 2 }}>By: {h.changed_by}</div>
              </div>
            ))
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
            <SecondaryButton onClick={() => setHistoryOpen(false)}>Close</SecondaryButton>
          </div>
        </div>
      </Modal>

    </div>
  );
}

// =========================================================================
// TAB 5: SLOTS AND CAPACITY MANAGEMENT TAB
// =========================================================================
function SlotsTab() {
  const api = useAdminApi();
  const [slots, setSlots] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [centreId, setCentreId] = useState('');
  const [date, setDate] = useState('');
  const [district, setDistrict] = useState('');

  const [capacityModalOpen, setCapacityModalOpen] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [newCapacity, setNewCapacity] = useState(10);
  const [actionMsg, setActionMsg] = useState('');

  const [generateOpen, setGenerateOpen] = useState(false);
  const [genCentre, setGenCentre] = useState('');
  const [genDate, setGenDate] = useState(() => new Date().toISOString().split('T')[0]);

  const loadSlots = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get('/slots', {
        params: { page, limit: 15, centre_id: centreId, date, district }
      });
      if (res.data?.success) {
        setSlots(res.data.slots);
        setTotal(res.data.total);
        setTotalPages(res.data.totalPages || 1);
      }
    } catch (err) {
      console.error('Fetch slots error:', err);
    } finally {
      setLoading(false);
    }
  }, [page, centreId, date, district]);

  useEffect(() => {
    loadSlots();
  }, [loadSlots]);

  const handleUpdateCapacity = async (e) => {
    e.preventDefault();
    if (!selectedSlot) return;
    try {
      setActionMsg('');
      const res = await api.put(`/slots/${selectedSlot.slot_id}/capacity`, { max_farmers: newCapacity });
      if (res.data?.success) {
        setCapacityModalOpen(false);
        loadSlots();
      }
    } catch (err) {
      setActionMsg(err.response?.data?.message || 'Failed to update slot capacity.');
    }
  };

  const handleGenerateSlots = async (e) => {
    e.preventDefault();
    try {
      setActionMsg('');
      const res = await api.post('/slots/generate', { centre_id: genCentre, date: genDate });
      if (res.data?.success) {
        setGenerateOpen(false);
        alert(res.data.message);
        loadSlots();
      }
    } catch (err) {
      setActionMsg(err.response?.data?.message || 'Failed to generate slots.');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 900, color: 'var(--kq-green-900)', margin: 0 }}>Slots & Center Capacity</h2>
          <div style={{ fontSize: 12.5, color: 'var(--kq-text-muted)' }}>Daily appointment windows, counter bookings, and dynamic pacing ({total} slots)</div>
        </div>
        <PrimaryButton onClick={() => { setGenCentre(centreId || 'TN_DPC_0005'); setActionMsg(''); setGenerateOpen(true); }}>
          <Icon name="calendar" size={16} />
          <span>Generate / Ensure Slots</span>
        </PrimaryButton>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, backgroundColor: '#ffffff', padding: '12px 16px', borderRadius: 'var(--kq-radius-md)', border: '1px solid var(--kq-border-medium)', flexWrap: 'wrap' }}>
        <input
          className="kq-input"
          placeholder="Filter by Centre ID (e.g. TN_DPC_0005)..."
          value={centreId}
          onChange={e => { setCentreId(e.target.value); setPage(1); }}
          style={{ width: 220, height: 38, fontSize: 13 }}
        />

        <input
          className="kq-input"
          type="date"
          value={date}
          onChange={e => { setDate(e.target.value); setPage(1); }}
          style={{ width: 160, height: 38, fontSize: 13 }}
        />

        <select className="kq-input" value={district} onChange={e => { setDistrict(e.target.value); setPage(1); }} style={{ width: 170, height: 38, fontSize: 13 }}>
          <option value="">All Districts</option>
          {['Ariyalur', 'Thanjavur', 'Thiruchirappalli', 'Madurai', 'Salem', 'Erode', 'Tirunelveli', 'Vellore'].map(d => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      </div>

      {/* Slots Table */}
      <div style={{ backgroundColor: '#ffffff', border: '1px solid var(--kq-border-medium)', borderRadius: 'var(--kq-radius-md)', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr style={{ borderBottom: '1.5px solid var(--kq-border-medium)', backgroundColor: 'var(--kq-bg-subtle)', textAlign: 'left', color: 'var(--kq-text-secondary)', fontWeight: 800 }}>
              <th style={{ padding: '10px 12px' }}>Slot ID</th>
              <th style={{ padding: '10px 12px' }}>Centre Name</th>
              <th style={{ padding: '10px 12px' }}>Date</th>
              <th style={{ padding: '10px 12px' }}>Window</th>
              <th style={{ padding: '10px 12px' }}>Max Capacity</th>
              <th style={{ padding: '10px 12px' }}>Booked / Held</th>
              <th style={{ padding: '10px 12px' }}>Available</th>
              <th style={{ padding: '10px 12px' }}>Status</th>
              <th style={{ padding: '10px 12px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>Loading slots...</td></tr>
            ) : slots.length === 0 ? (
              <tr><td colSpan={9} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>No slot schedules found matching criteria.</td></tr>
            ) : (
              slots.map(s => (
                <tr key={s.slot_id} style={{ borderBottom: '1px solid var(--kq-border-light)' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 800, color: 'var(--kq-green-900)' }}>{s.slot_id}</td>
                  <td style={{ padding: '10px 12px' }}>{s.centre_name} ({s.centre_id})</td>
                  <td style={{ padding: '10px 12px' }}>{String(s.date).slice(0, 10)}</td>
                  <td style={{ padding: '10px 12px' }}>{String(s.start_time).slice(0, 5)} - {String(s.end_time).slice(0, 5)}</td>
                  <td style={{ padding: '10px 12px', fontWeight: 700 }}>{s.max_farmers} slots</td>
                  <td style={{ padding: '10px 12px' }}>{s.booked_count} booked {s.held_count ? `(${s.held_count} held)` : ''}</td>
                  <td style={{ padding: '10px 12px', fontWeight: 800, color: s.available_capacity > 0 ? '#15803d' : '#b91c1c' }}>
                    {s.available_capacity} left
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    {s.is_expired ? (
                      <span style={{ padding: '2px 8px', borderRadius: 12, fontSize: 10.5, fontWeight: 800, backgroundColor: '#f1f5f9', color: '#64748b' }}>EXPIRED</span>
                    ) : s.is_full ? (
                      <span style={{ padding: '2px 8px', borderRadius: 12, fontSize: 10.5, fontWeight: 800, backgroundColor: '#fee2e2', color: '#b91c1c' }}>FULL</span>
                    ) : (
                      <span style={{ padding: '2px 8px', borderRadius: 12, fontSize: 10.5, fontWeight: 800, backgroundColor: '#dcfce7', color: '#15803d' }}>BOOKABLE</span>
                    )}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                    <button
                      type="button"
                      onClick={() => { setSelectedSlot(s); setNewCapacity(s.max_farmers); setActionMsg(''); setCapacityModalOpen(true); }}
                      style={{ padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 4, background: '#fff', cursor: 'pointer', fontSize: 11.5 }}
                      title="Adjust Max Capacity"
                    >
                      <Icon name="edit-2" size={13} color="#0284c7" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12.5, color: 'var(--kq-text-muted)' }}>
        <span>Showing Page {page} of {totalPages} ({total} slots)</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} style={{ padding: '5px 12px', border: '1px solid #cbd5e1', borderRadius: 4, background: '#fff', opacity: page > 1 ? 1 : 0.5 }}>Previous</button>
          <button type="button" disabled={page >= totalPages} onClick={() => setPage(page + 1)} style={{ padding: '5px 12px', border: '1px solid #cbd5e1', borderRadius: 4, background: '#fff', opacity: page < totalPages ? 1 : 0.5 }}>Next</button>
        </div>
      </div>

      {/* ADJUST CAPACITY MODAL */}
      <Modal
        isOpen={capacityModalOpen}
        onClose={() => setCapacityModalOpen(false)}
        title={`Adjust Slot Capacity: ${selectedSlot?.slot_id}`}
        subtitle={`${selectedSlot?.centre_name} • ${String(selectedSlot?.date).slice(0, 10)}`}
        maxWidth={400}
      >
        <form onSubmit={handleUpdateCapacity} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {actionMsg && <div style={{ padding: 8, backgroundColor: '#fef2f2', color: '#991b1b', borderRadius: 4, fontSize: 12 }}>{actionMsg}</div>}
          <div style={{ fontSize: 12.5, color: '#475569' }}>
            Current confirmed bookings: <strong>{selectedSlot?.booked_count}</strong>. New capacity cannot be lower than existing bookings.
          </div>
          <div>
            <label style={{ fontSize: 11.5, fontWeight: 700 }}>Max Farmers (Capacity) *</label>
            <input className="kq-input" type="number" min={selectedSlot?.booked_count || 1} max="50" value={newCapacity} onChange={e => setNewCapacity(e.target.value)} required style={{ height: 36, fontSize: 13 }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
            <SecondaryButton onClick={() => setCapacityModalOpen(false)}>Cancel</SecondaryButton>
            <PrimaryButton type="submit">Update Capacity</PrimaryButton>
          </div>
        </form>
      </Modal>

      {/* GENERATE SLOTS MODAL */}
      <Modal
        isOpen={generateOpen}
        onClose={() => setGenerateOpen(false)}
        title="Ensure & Generate Centre Slots"
        subtitle="Generates standard daily appointment windows for an open centre"
        maxWidth={420}
      >
        <form onSubmit={handleGenerateSlots} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {actionMsg && <div style={{ padding: 8, backgroundColor: '#fef2f2', color: '#991b1b', borderRadius: 4, fontSize: 12 }}>{actionMsg}</div>}
          <div>
            <label style={{ fontSize: 11.5, fontWeight: 700 }}>Centre ID *</label>
            <input className="kq-input" value={genCentre} onChange={e => setGenCentre(e.target.value)} required placeholder="e.g. TN_DPC_0005" style={{ height: 36, fontSize: 13 }} />
          </div>
          <div>
            <label style={{ fontSize: 11.5, fontWeight: 700 }}>Target Date *</label>
            <input className="kq-input" type="date" value={genDate} onChange={e => setGenDate(e.target.value)} required style={{ height: 36, fontSize: 13 }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
            <SecondaryButton onClick={() => setGenerateOpen(false)}>Cancel</SecondaryButton>
            <PrimaryButton type="submit">Generate Slots</PrimaryButton>
          </div>
        </form>
      </Modal>

    </div>
  );
}

// =========================================================================
// TAB 6: BOOKINGS MANAGEMENT TAB
// =========================================================================
function BookingsTab() {
  const api = useAdminApi();
  const [bookings, setBookings] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [district, setDistrict] = useState('');

  const [dossierOpen, setDossierOpen] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState(null);
  const [dossierRecords, setDossierRecords] = useState(null);

  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const [newStatus, setNewStatus] = useState('');
  const [statusReason, setStatusReason] = useState('');
  const [actionMsg, setActionMsg] = useState('');

  const loadBookings = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get('/bookings', {
        params: { page, limit: 12, search, status, district }
      });
      if (res.data?.success) {
        setBookings(res.data.bookings);
        setTotal(res.data.total);
        setTotalPages(res.data.totalPages || 1);
      }
    } catch (err) {
      console.error('Fetch bookings error:', err);
    } finally {
      setLoading(false);
    }
  }, [page, search, status, district]);

  useEffect(() => {
    loadBookings();
  }, [loadBookings]);

  const handleOpenDossier = async (booking) => {
    setSelectedBooking(booking);
    try {
      const res = await api.get(`/bookings/${booking.booking_id}`);
      if (res.data?.success) {
        setSelectedBooking(res.data.booking);
        setDossierRecords(res.data.records);
        setDossierOpen(true);
      }
    } catch (err) {
      alert('Failed to load full booking dossier.');
    }
  };

  const handleUpdateStatus = async (e) => {
    e.preventDefault();
    if (!selectedBooking) return;
    try {
      setActionMsg('');
      const res = await api.patch(`/bookings/${selectedBooking.booking_id}/status`, {
        new_status: newStatus,
        reason: statusReason
      });
      if (res.data?.success) {
        setStatusModalOpen(false);
        loadBookings();
      }
    } catch (err) {
      setActionMsg(err.response?.data?.message || 'Failed to update booking status.');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 900, color: 'var(--kq-green-900)', margin: 0 }}>Procurement Bookings Lifecycle</h2>
          <div style={{ fontSize: 12.5, color: 'var(--kq-text-muted)' }}>Complete state tracking from reservation through DBT disbursement ({total} bookings)</div>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, backgroundColor: '#ffffff', padding: '12px 16px', borderRadius: 'var(--kq-radius-md)', border: '1px solid var(--kq-border-medium)', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200, position: 'relative' }}>
          <input
            className="kq-input"
            placeholder="Search by Booking ID, Farmer ID, Token, or Name..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            style={{ paddingLeft: 34, height: 38, fontSize: 13 }}
          />
          <span style={{ position: 'absolute', left: 10, top: 10, color: '#94a3b8' }}>
            <Icon name="search" size={16} />
          </span>
        </div>

        <select className="kq-input" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }} style={{ width: 170, height: 38, fontSize: 13 }}>
          <option value="">All Statuses</option>
          <option value="BOOKED">BOOKED</option>
          <option value="CONFIRMED">CONFIRMED</option>
          <option value="CHECKED_IN">CHECKED_IN</option>
          <option value="GRADING">GRADING</option>
          <option value="PROCURED">PROCURED</option>
          <option value="PAYMENT_PENDING">PAYMENT_PENDING</option>
          <option value="PAYMENT_COMPLETED">PAYMENT_COMPLETED</option>
          <option value="CANCELLED">CANCELLED</option>
        </select>

        <select className="kq-input" value={district} onChange={e => { setDistrict(e.target.value); setPage(1); }} style={{ width: 170, height: 38, fontSize: 13 }}>
          <option value="">All Districts</option>
          {['Ariyalur', 'Thanjavur', 'Thiruchirappalli', 'Madurai', 'Salem', 'Erode', 'Tirunelveli', 'Vellore'].map(d => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div style={{ backgroundColor: '#ffffff', border: '1px solid var(--kq-border-medium)', borderRadius: 'var(--kq-radius-md)', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr style={{ borderBottom: '1.5px solid var(--kq-border-medium)', backgroundColor: 'var(--kq-bg-subtle)', textAlign: 'left', color: 'var(--kq-text-secondary)', fontWeight: 800 }}>
              <th style={{ padding: '10px 12px' }}>Booking ID</th>
              <th style={{ padding: '10px 12px' }}>Token</th>
              <th style={{ padding: '10px 12px' }}>Farmer</th>
              <th style={{ padding: '10px 12px' }}>Centre</th>
              <th style={{ padding: '10px 12px' }}>Arrival Date</th>
              <th style={{ padding: '10px 12px' }}>Crop & Qty</th>
              <th style={{ padding: '10px 12px' }}>Lifecycle Status</th>
              <th style={{ padding: '10px 12px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>Loading booking records...</td></tr>
            ) : bookings.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>No bookings matching criteria found.</td></tr>
            ) : (
              bookings.map(b => (
                <tr key={b.booking_id} style={{ borderBottom: '1px solid var(--kq-border-light)' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 800, color: 'var(--kq-green-900)' }}>{b.booking_id}</td>
                  <td style={{ padding: '10px 12px', fontWeight: 800, color: '#b45309' }}>{b.token || '—'}</td>
                  <td style={{ padding: '10px 12px' }}>{b.farmer_name || b.farmer_id}</td>
                  <td style={{ padding: '10px 12px' }}>{b.centre_name || b.centre_id}</td>
                  <td style={{ padding: '10px 12px' }}>{formatHumanDate(b.booking_date)}</td>
                  <td style={{ padding: '10px 12px' }}>{b.crop} • {b.quantity_quintals} Qtl</td>
                  <td style={{ padding: '10px 12px' }}>
                    <StatusBadge status={b.status} />
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: 6 }}>
                      <button
                        type="button"
                        onClick={() => handleOpenDossier(b)}
                        style={{ padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 4, background: '#fff', cursor: 'pointer', fontSize: 11.5 }}
                        title="View Full Dossier"
                      >
                        <Icon name="file-text" size={13} color="#475569" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedBooking(b);
                          setNewStatus(b.status);
                          setStatusReason('');
                          setActionMsg('');
                          setStatusModalOpen(true);
                        }}
                        style={{ padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 4, background: '#fff', cursor: 'pointer', fontSize: 11.5 }}
                        title="Change Status"
                      >
                        <Icon name="edit-2" size={13} color="#0284c7" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12.5, color: 'var(--kq-text-muted)' }}>
        <span>Showing Page {page} of {totalPages} ({total} bookings)</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} style={{ padding: '5px 12px', border: '1px solid #cbd5e1', borderRadius: 4, background: '#fff', opacity: page > 1 ? 1 : 0.5 }}>Previous</button>
          <button type="button" disabled={page >= totalPages} onClick={() => setPage(page + 1)} style={{ padding: '5px 12px', border: '1px solid #cbd5e1', borderRadius: 4, background: '#fff', opacity: page < totalPages ? 1 : 0.5 }}>Next</button>
        </div>
      </div>

      {/* STATUS OVERRIDE MODAL */}
      <Modal
        isOpen={statusModalOpen}
        onClose={() => setStatusModalOpen(false)}
        title={`Status Override: ${selectedBooking?.booking_id}`}
        subtitle={`Current: ${selectedBooking?.status} • Token: ${selectedBooking?.token || 'None'}`}
        maxWidth={450}
      >
        <form onSubmit={handleUpdateStatus} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {actionMsg && <div style={{ padding: 8, backgroundColor: '#fef2f2', color: '#991b1b', borderRadius: 4, fontSize: 12 }}>{actionMsg}</div>}
          
          <div>
            <label style={{ fontSize: 11.5, fontWeight: 700 }}>Select Target Status *</label>
            <select className="kq-input" value={newStatus} onChange={e => setNewStatus(e.target.value)} style={{ height: 36, fontSize: 13 }}>
              {['BOOKED', 'CONFIRMED', 'CHECKED_IN', 'GRADING', 'PROCURED', 'PAYMENT_PENDING', 'PAYMENT_COMPLETED', 'CANCELLED'].map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ fontSize: 11.5, fontWeight: 700 }}>Super Admin Override Reason *</label>
            <input className="kq-input" placeholder="e.g. Weighbridge calibration verification / Manual DBT reconciliation" value={statusReason} onChange={e => setStatusReason(e.target.value)} required style={{ height: 36, fontSize: 13 }} />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
            <SecondaryButton onClick={() => setStatusModalOpen(false)}>Cancel</SecondaryButton>
            <PrimaryButton type="submit">Commit Status Change</PrimaryButton>
          </div>
        </form>
      </Modal>

      {/* BOOKING DOSSIER MODAL */}
      <Modal
        isOpen={dossierOpen}
        onClose={() => setDossierOpen(false)}
        title={`Procurement Dossier: ${selectedBooking?.booking_id}`}
        subtitle={`Token: ${selectedBooking?.token || 'N/A'} • Farmer: ${selectedBooking?.farmer_name}`}
        maxWidth={580}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontSize: 13 }}>
          
          {/* Header Summary */}
          <div style={{ background: '#f8fafc', padding: 12, borderRadius: 6, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div><span style={{ color: '#64748b' }}>Centre:</span> <strong>{selectedBooking?.centre_name}</strong></div>
            <div><span style={{ color: '#64748b' }}>Date:</span> <strong>{formatHumanDate(selectedBooking?.booking_date)}</strong></div>
            <div><span style={{ color: '#64748b' }}>Crop:</span> <strong>{selectedBooking?.crop}</strong></div>
            <div><span style={{ color: '#64748b' }}>Reserved Qty:</span> <strong>{selectedBooking?.quantity_quintals} Qtl</strong></div>
            <div><span style={{ color: '#64748b' }}>Status:</span> <StatusBadge status={selectedBooking?.status} /></div>
            <div><span style={{ color: '#64748b' }}>Farmer Phone:</span> <strong>{selectedBooking?.farmer_phone}</strong></div>
          </div>

          {/* Phase 7.3 Procurement Breakdown */}
          <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', marginBottom: 8 }}>
              Electronic Procurement Records
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Quality Grading:</span>
                <strong>{dossierRecords?.quality?.grade ? `${dossierRecords.quality.grade} (${dossierRecords.quality.moisture_percentage}% Moisture)` : 'Pending Grading'}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Weighbridge Net Weight:</span>
                <strong>{dossierRecords?.weighment?.net_weight_kg ? `${dossierRecords.weighment.net_weight_kg} kg` : 'Pending Weighment'}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Accepted Quantity:</span>
                <strong>{dossierRecords?.acceptance?.accepted_quantity_quintals ? `${dossierRecords.acceptance.accepted_quantity_quintals} Qtl` : 'Pending Acceptance'}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Receipt Number:</span>
                <strong style={{ color: 'var(--kq-green-900)' }}>{dossierRecords?.receipt?.receipt_number || 'Not Issued Yet'}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>DBT Net Payable:</span>
                <strong style={{ color: '#059669' }}>{dossierRecords?.payment?.net_payable_inr ? `Rs. ${Number(dossierRecords.payment.net_payable_inr).toLocaleString()}` : 'Pending DBT'}</strong>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            <SecondaryButton onClick={() => setDossierOpen(false)}>Close Dossier</SecondaryButton>
          </div>
        </div>
      </Modal>

    </div>
  );
}

// =========================================================================
// TAB 7: WEBSITE CONTENT MANAGEMENT TAB
// =========================================================================
function ContentTab() {
  const api = useAdminApi();
  const [contentList, setContentList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);

  const [form, setForm] = useState({
    content_key: '',
    title: '',
    category: 'ANNOUNCEMENT',
    content: '',
    priority: 1,
    is_active: true
  });
  const [actionMsg, setActionMsg] = useState('');

  const loadContent = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get('/content');
      if (res.data?.success) {
        setContentList(res.data.content);
      }
    } catch (err) {
      console.error('Fetch content error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadContent();
  }, [loadContent]);

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      setActionMsg('');
      const res = await api.post('/content', form);
      if (res.data?.success) {
        setCreateOpen(false);
        loadContent();
      }
    } catch (err) {
      setActionMsg(err.response?.data?.message || 'Failed to save content.');
    }
  };

  const handleUpdate = async (e) => {
    e.preventDefault();
    if (!selectedItem) return;
    try {
      setActionMsg('');
      const res = await api.put(`/content/${selectedItem.id}`, form);
      if (res.data?.success) {
        setEditOpen(false);
        loadContent();
      }
    } catch (err) {
      setActionMsg(err.response?.data?.message || 'Failed to update content.');
    }
  };

  const handleDelete = async (item) => {
    if (!window.confirm(`Delete content "${item.title}"?`)) return;
    try {
      await api.delete(`/content/${item.id}`);
      loadContent();
    } catch (err) {
      alert('Failed to delete content.');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 900, color: 'var(--kq-green-900)', margin: 0 }}>Website Content & Public Notices</h2>
          <div style={{ fontSize: 12.5, color: 'var(--kq-text-muted)' }}>Configurable public service announcements, procurement guidelines, and support banners</div>
        </div>
        <PrimaryButton onClick={() => { setForm({ content_key: `notice_${Date.now()}`, title: '', category: 'ANNOUNCEMENT', content: '', priority: 1, is_active: true }); setActionMsg(''); setCreateOpen(true); }}>
          <Icon name="plus" size={16} />
          <span>Publish Notice</span>
        </PrimaryButton>
      </div>

      <div style={{ backgroundColor: '#ffffff', border: '1px solid var(--kq-border-medium)', borderRadius: 'var(--kq-radius-md)', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr style={{ borderBottom: '1.5px solid var(--kq-border-medium)', backgroundColor: 'var(--kq-bg-subtle)', textAlign: 'left', color: 'var(--kq-text-secondary)', fontWeight: 800 }}>
              <th style={{ padding: '10px 12px' }}>Key</th>
              <th style={{ padding: '10px 12px' }}>Title</th>
              <th style={{ padding: '10px 12px' }}>Category</th>
              <th style={{ padding: '10px 12px' }}>Content Body</th>
              <th style={{ padding: '10px 12px' }}>Priority</th>
              <th style={{ padding: '10px 12px' }}>Status</th>
              <th style={{ padding: '10px 12px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>Loading content entries...</td></tr>
            ) : contentList.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>No website content entries found.</td></tr>
            ) : (
              contentList.map(item => (
                <tr key={item.id} style={{ borderBottom: '1px solid var(--kq-border-light)' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 800, color: 'var(--kq-green-900)' }}>{item.content_key}</td>
                  <td style={{ padding: '10px 12px', fontWeight: 700 }}>{item.title}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{ padding: '2px 8px', borderRadius: 12, fontSize: 10.5, fontWeight: 800, backgroundColor: '#f1f5f9', color: '#334155' }}>
                      {item.category}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px', maxWidth: 280, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {item.content}
                  </td>
                  <td style={{ padding: '10px 12px' }}>{item.priority}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{ padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 800, backgroundColor: item.is_active ? '#dcfce7' : '#fee2e2', color: item.is_active ? '#15803d' : '#b91c1c' }}>
                      {item.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: 6 }}>
                      <button
                        type="button"
                        onClick={() => { setSelectedItem(item); setForm({ ...item }); setActionMsg(''); setEditOpen(true); }}
                        style={{ padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 4, background: '#fff', cursor: 'pointer', fontSize: 11.5 }}
                      >
                        <Icon name="edit-2" size={13} color="#0284c7" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(item)}
                        style={{ padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 4, background: '#fff', cursor: 'pointer', fontSize: 11.5 }}
                      >
                        <Icon name="trash-2" size={13} color="#b91c1c" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* CREATE MODAL */}
      <Modal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Publish Website Content"
        subtitle="Live announcements or notice board updates"
        maxWidth={500}
      >
        <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {actionMsg && <div style={{ padding: 8, backgroundColor: '#fef2f2', color: '#991b1b', borderRadius: 4, fontSize: 12 }}>{actionMsg}</div>}
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 11.5, fontWeight: 700 }}>Identifier Key *</label>
              <input className="kq-input" value={form.content_key} onChange={e => setForm({ ...form, content_key: e.target.value })} required style={{ height: 36, fontSize: 13 }} />
            </div>
            <div>
              <label style={{ fontSize: 11.5, fontWeight: 700 }}>Category *</label>
              <select className="kq-input" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} style={{ height: 36, fontSize: 13 }}>
                <option value="ANNOUNCEMENT">ANNOUNCEMENT</option>
                <option value="NOTICE">NOTICE</option>
                <option value="SUPPORT">SUPPORT</option>
                <option value="HELP">HELP</option>
                <option value="BANNER">BANNER</option>
              </select>
            </div>
          </div>

          <div>
            <label style={{ fontSize: 11.5, fontWeight: 700 }}>Title *</label>
            <input className="kq-input" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required style={{ height: 36, fontSize: 13 }} />
          </div>

          <div>
            <label style={{ fontSize: 11.5, fontWeight: 700 }}>Content Text *</label>
            <textarea className="kq-input" rows={4} value={form.content} onChange={e => setForm({ ...form, content: e.target.value })} required style={{ fontSize: 13, resize: 'vertical' }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 11.5, fontWeight: 700 }}>Display Priority (Higher first)</label>
              <input className="kq-input" type="number" value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })} style={{ height: 36, fontSize: 13 }} />
            </div>
            <div>
              <label style={{ fontSize: 11.5, fontWeight: 700 }}>Publication Status</label>
              <select className="kq-input" value={form.is_active ? 'true' : 'false'} onChange={e => setForm({ ...form, is_active: e.target.value === 'true' })} style={{ height: 36, fontSize: 13 }}>
                <option value="true">Active (Visible)</option>
                <option value="false">Inactive (Draft)</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
            <SecondaryButton onClick={() => setCreateOpen(false)}>Cancel</SecondaryButton>
            <PrimaryButton type="submit">Publish Notice</PrimaryButton>
          </div>
        </form>
      </Modal>

      {/* EDIT MODAL */}
      <Modal
        isOpen={editOpen}
        onClose={() => setEditOpen(false)}
        title={`Edit Content: ${selectedItem?.title}`}
        subtitle={`Key: ${selectedItem?.content_key}`}
        maxWidth={500}
      >
        <form onSubmit={handleUpdate} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {actionMsg && <div style={{ padding: 8, backgroundColor: '#fef2f2', color: '#991b1b', borderRadius: 4, fontSize: 12 }}>{actionMsg}</div>}
          
          <div>
            <label style={{ fontSize: 11.5, fontWeight: 700 }}>Title *</label>
            <input className="kq-input" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required style={{ height: 36, fontSize: 13 }} />
          </div>

          <div>
            <label style={{ fontSize: 11.5, fontWeight: 700 }}>Category *</label>
            <select className="kq-input" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} style={{ height: 36, fontSize: 13 }}>
              <option value="ANNOUNCEMENT">ANNOUNCEMENT</option>
              <option value="NOTICE">NOTICE</option>
              <option value="SUPPORT">SUPPORT</option>
              <option value="HELP">HELP</option>
              <option value="BANNER">BANNER</option>
            </select>
          </div>

          <div>
            <label style={{ fontSize: 11.5, fontWeight: 700 }}>Content Text *</label>
            <textarea className="kq-input" rows={4} value={form.content} onChange={e => setForm({ ...form, content: e.target.value })} required style={{ fontSize: 13, resize: 'vertical' }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 11.5, fontWeight: 700 }}>Priority</label>
              <input className="kq-input" type="number" value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })} style={{ height: 36, fontSize: 13 }} />
            </div>
            <div>
              <label style={{ fontSize: 11.5, fontWeight: 700 }}>Publication Status</label>
              <select className="kq-input" value={form.is_active ? 'true' : 'false'} onChange={e => setForm({ ...form, is_active: e.target.value === 'true' })} style={{ height: 36, fontSize: 13 }}>
                <option value="true">Active (Visible)</option>
                <option value="false">Inactive (Draft)</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
            <SecondaryButton onClick={() => setEditOpen(false)}>Cancel</SecondaryButton>
            <PrimaryButton type="submit">Update Content</PrimaryButton>
          </div>
        </form>
      </Modal>

    </div>
  );
}

// =========================================================================
// TAB 8: SYSTEM SETTINGS TAB
// =========================================================================
function SettingsTab() {
  const api = useAdminApi();
  const [settings, setSettings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [savingKey, setSavingKey] = useState('');
  const [editValues, setEditValues] = useState({});
  const [feedback, setFeedback] = useState({});

  const loadSettings = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get('/settings');
      if (res.data?.success) {
        setSettings(res.data.settings);
        const map = {};
        res.data.settings.forEach(s => {
          map[s.setting_key] = s.setting_value;
        });
        setEditValues(map);
      }
    } catch (err) {
      console.error('Fetch settings error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleSaveSetting = async (key) => {
    try {
      setSavingKey(key);
      const res = await api.put(`/settings/${key}`, { setting_value: editValues[key] });
      if (res.data?.success) {
        setFeedback(prev => ({ ...prev, [key]: 'Saved successfully.' }));
        setTimeout(() => {
          setFeedback(prev => ({ ...prev, [key]: '' }));
        }, 3000);
      }
    } catch (err) {
      setFeedback(prev => ({ ...prev, [key]: 'Failed to save.' }));
    } finally {
      setSavingKey('');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 900, color: 'var(--kq-green-900)', margin: 0 }}>Approved Administrative Settings</h2>
        <div style={{ fontSize: 12.5, color: 'var(--kq-text-muted)' }}>Configurable platform parameters and operational constraints</div>
      </div>

      {/* Security Disclaimer Alert */}
      <div style={{
        padding: '12px 16px',
        backgroundColor: '#f0fdf4',
        border: '1px solid #bbf7d0',
        borderRadius: 'var(--kq-radius-md)',
        fontSize: 12.5,
        color: '#166534',
        display: 'flex',
        alignItems: 'center',
        gap: 10
      }}>
        <Icon name="shield" size={18} color="#166534" />
        <span>
          <strong>Security Boundary:</strong> Database credentials, internal secrets, and arbitrary SQL consoles are strictly isolated and not modifiable via browser UI.
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {loading ? (
          <div style={{ padding: 30, textAlign: 'center', color: '#64748b' }}>Loading settings...</div>
        ) : settings.length === 0 ? (
          <div style={{ padding: 30, textAlign: 'center', color: '#64748b' }}>No configurable settings found.</div>
        ) : (
          settings.map(s => (
            <div
              key={s.setting_key}
              style={{
                backgroundColor: '#ffffff',
                border: '1px solid var(--kq-border-medium)',
                borderRadius: 'var(--kq-radius-md)',
                padding: '16px 20px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 16,
                flexWrap: 'wrap'
              }}
            >
              <div style={{ flex: 1, minWidth: 240 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <strong style={{ fontSize: 13.5, color: 'var(--kq-text-primary)' }}>{s.setting_key}</strong>
                  <span style={{ fontSize: 10.5, fontWeight: 800, padding: '2px 6px', borderRadius: 4, backgroundColor: '#f1f5f9', color: '#475569' }}>
                    {s.category}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--kq-text-muted)', marginTop: 2 }}>{s.description}</div>
                {s.updated_by && (
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
                    Last modified by: {s.updated_by} • {new Date(s.updated_at).toLocaleDateString()}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                  className="kq-input"
                  value={editValues[s.setting_key] ?? s.setting_value}
                  onChange={e => setEditValues({ ...editValues, [s.setting_key]: e.target.value })}
                  style={{ width: 220, height: 36, fontSize: 13 }}
                />
                <PrimaryButton
                  onClick={() => handleSaveSetting(s.setting_key)}
                  loading={savingKey === s.setting_key}
                  style={{ height: 36, fontSize: 12.5 }}
                >
                  Save
                </PrimaryButton>
                {feedback[s.setting_key] && (
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: feedback[s.setting_key].includes('Failed') ? '#b91c1c' : '#15803d' }}>
                    {feedback[s.setting_key]}
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>

    </div>
  );
}

// =========================================================================
// TAB 9: AUDIT LOGS TAB
// =========================================================================
function AuditLogsTab() {
  const api = useAdminApi();
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selectedLog, setSelectedLog] = useState(null);

  const loadLogs = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get('/audit-logs', {
        params: { page, limit: 15, search, action }
      });
      if (res.data?.success) {
        setLogs(res.data.logs);
        setTotal(res.data.total);
        setTotalPages(res.data.totalPages || 1);
      }
    } catch (err) {
      console.error('Fetch audit logs error:', err);
    } finally {
      setLoading(false);
    }
  }, [page, search, action]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 900, color: 'var(--kq-green-900)', margin: 0 }}>System Audit Trail</h2>
          <div style={{ fontSize: 12.5, color: 'var(--kq-text-muted)' }}>Cryptographically immutable record of privileged state actions ({total} log entries)</div>
        </div>
      </div>

      {/* Filter Bar */}
      <div style={{ display: 'flex', gap: 12, backgroundColor: '#ffffff', padding: '12px 16px', borderRadius: 'var(--kq-radius-md)', border: '1px solid var(--kq-border-medium)', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200, position: 'relative' }}>
          <input
            className="kq-input"
            placeholder="Search by admin username, action, or target resource ID..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            style={{ paddingLeft: 34, height: 38, fontSize: 13 }}
          />
          <span style={{ position: 'absolute', left: 10, top: 10, color: '#94a3b8' }}>
            <Icon name="search" size={16} />
          </span>
        </div>

        <select className="kq-input" value={action} onChange={e => { setAction(e.target.value); setPage(1); }} style={{ width: 220, height: 38, fontSize: 13 }}>
          <option value="">All Actions</option>
          <option value="SUPER_ADMIN_LOGIN">SUPER_ADMIN_LOGIN</option>
          <option value="CREATE_USER">CREATE_USER</option>
          <option value="UPDATE_USER">UPDATE_USER</option>
          <option value="CREATE_CENTRE">CREATE_CENTRE</option>
          <option value="UPDATE_CENTRE">UPDATE_CENTRE</option>
          <option value="UPDATE_SLOT_CAPACITY">UPDATE_SLOT_CAPACITY</option>
          <option value="UPDATE_BOOKING_STATUS">UPDATE_BOOKING_STATUS</option>
          <option value="UPDATE_SETTING">UPDATE_SETTING</option>
          <option value="CREATE_CONTENT">CREATE_CONTENT</option>
        </select>
      </div>

      {/* Audit Table */}
      <div style={{ backgroundColor: '#ffffff', border: '1px solid var(--kq-border-medium)', borderRadius: 'var(--kq-radius-md)', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr style={{ borderBottom: '1.5px solid var(--kq-border-medium)', backgroundColor: 'var(--kq-bg-subtle)', textAlign: 'left', color: 'var(--kq-text-secondary)', fontWeight: 800 }}>
              <th style={{ padding: '10px 12px' }}>Timestamp</th>
              <th style={{ padding: '10px 12px' }}>Administrator</th>
              <th style={{ padding: '10px 12px' }}>Action</th>
              <th style={{ padding: '10px 12px' }}>Resource Type</th>
              <th style={{ padding: '10px 12px' }}>Resource ID</th>
              <th style={{ padding: '10px 12px' }}>Status</th>
              <th style={{ padding: '10px 12px', textAlign: 'right' }}>Payload</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>Loading audit records...</td></tr>
            ) : logs.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>No audit records found.</td></tr>
            ) : (
              logs.map(log => (
                <tr key={log.id} style={{ borderBottom: '1px solid var(--kq-border-light)' }}>
                  <td style={{ padding: '10px 12px', color: '#64748b', fontSize: 11.5 }}>
                    {new Date(log.created_at).toLocaleString()}
                  </td>
                  <td style={{ padding: '10px 12px', fontWeight: 700 }}>{log.admin_username}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{ padding: '2px 8px', borderRadius: 12, fontSize: 10.5, fontWeight: 800, backgroundColor: '#f1f5f9', color: '#0f172a' }}>
                      {log.action}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px' }}>{log.resource_type}</td>
                  <td style={{ padding: '10px 12px', fontWeight: 600 }}>{log.resource_id || '—'}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{
                      padding: '2px 8px',
                      borderRadius: 12,
                      fontSize: 10.5,
                      fontWeight: 800,
                      backgroundColor: log.status === 'SUCCESS' ? '#dcfce7' : '#fee2e2',
                      color: log.status === 'SUCCESS' ? '#15803d' : '#b91c1c'
                    }}>
                      {log.status}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                    <button
                      type="button"
                      onClick={() => { setSelectedLog(log); setDetailsOpen(true); }}
                      style={{ padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 4, background: '#fff', cursor: 'pointer', fontSize: 11.5 }}
                      title="Inspect Action Payload"
                    >
                      Inspect
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12.5, color: 'var(--kq-text-muted)' }}>
        <span>Showing Page {page} of {totalPages} ({total} events)</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} style={{ padding: '5px 12px', border: '1px solid #cbd5e1', borderRadius: 4, background: '#fff', opacity: page > 1 ? 1 : 0.5 }}>Previous</button>
          <button type="button" disabled={page >= totalPages} onClick={() => setPage(page + 1)} style={{ padding: '5px 12px', border: '1px solid #cbd5e1', borderRadius: 4, background: '#fff', opacity: page < totalPages ? 1 : 0.5 }}>Next</button>
        </div>
      </div>

      {/* AUDIT DETAILS MODAL */}
      <Modal
        isOpen={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        title={`Audit Event #${selectedLog?.id}: ${selectedLog?.action}`}
        subtitle={`Admin: ${selectedLog?.admin_username} • ${new Date(selectedLog?.created_at).toLocaleString()}`}
        maxWidth={500}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, background: '#f8fafc', padding: 10, borderRadius: 6 }}>
            <div><span style={{ color: '#64748b' }}>Resource Type:</span> <strong>{selectedLog?.resource_type}</strong></div>
            <div><span style={{ color: '#64748b' }}>Resource ID:</span> <strong>{selectedLog?.resource_id || 'N/A'}</strong></div>
            <div><span style={{ color: '#64748b' }}>Status:</span> <strong>{selectedLog?.status}</strong></div>
            <div><span style={{ color: '#64748b' }}>Admin ID:</span> <strong>{selectedLog?.admin_id}</strong></div>
          </div>

          <div>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: '#475569', marginBottom: 4 }}>Payload Details:</div>
            <pre style={{
              background: '#0f172a',
              color: '#f8fafc',
              padding: 12,
              borderRadius: 6,
              fontSize: 12,
              overflowX: 'auto',
              maxHeight: 200
            }}>
              {JSON.stringify(selectedLog?.details, null, 2)}
            </pre>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
            <SecondaryButton onClick={() => setDetailsOpen(false)}>Close</SecondaryButton>
          </div>
        </div>
      </Modal>

    </div>
  );
}

// =========================================================================
// SUPER ADMIN LOGIN VIEW (SHOWN WHEN UNAUTHENTICATED)
// =========================================================================
function SuperAdminLoginView({ onLoginSuccess }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username || !password) return;
    try {
      setLoading(true);
      setError('');
      const res = await axios.post(`${API_BASE}/login`, { username, password });
      if (res.data?.success && res.data?.token) {
        onLoginSuccess(res.data.token, res.data.user);
      }
    } catch (err) {
      console.error('Super admin login error:', err);
      setError(
        err.response?.data?.message ||
        (err.code === 'ERR_NETWORK'
          ? 'Network Error: Cannot connect to API backend at ' + API_BASE
          : 'Access denied: Invalid credentials or insufficient privileges.')
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      padding: '20px',
      position: 'relative'
    }}>
      {/* Background decoration */}
      <KisanNatureBackground />

      <div style={{
        width: '100%',
        maxWidth: 420,
        backgroundColor: '#ffffff',
        border: '1px solid var(--kq-border-medium)',
        borderRadius: 'var(--kq-radius-lg)',
        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.08), 0 8px 10px -6px rgba(0, 0, 0, 0.05)',
        position: 'relative',
        zIndex: 1,
        overflow: 'hidden'
      }}>
        {/* Tricolor stripe */}
        <div style={{ height: 4, display: 'flex', width: '100%' }}>
          <div style={{ flex: 1, backgroundColor: '#ea580c' }} />
          <div style={{ flex: 1, backgroundColor: '#ffffff', borderBottom: '1px solid #e5e7eb' }} />
          <div style={{ flex: 1, backgroundColor: '#166534' }} />
        </div>

        <div style={{ padding: '32px 28px 24px' }}>
          
          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <div style={{ display: 'inline-flex', justifyContent: 'center', marginBottom: 12 }}>
              <KisanLogo size={48} />
            </div>
            <h1 style={{ fontSize: 20, fontWeight: 900, color: 'var(--kq-green-900)', margin: 0 }}>
              KISAN VIKAS
            </h1>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#166534', marginTop: 2 }}>
              உழவர்சேது • STATE SUPER ADMIN PORTAL
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--kq-text-muted)', marginTop: 4 }}>
              Government of Tamil Nadu • Central IT Nodal Administration
            </div>
          </div>

          {/* Warning notice */}
          <div style={{
            padding: '10px 12px',
            backgroundColor: '#fef3c7',
            border: '1px solid #fde68a',
            borderRadius: 'var(--kq-radius-sm)',
            fontSize: 11.5,
            color: '#92400e',
            marginBottom: 20,
            display: 'flex',
            alignItems: 'center',
            gap: 8
          }}>
            <Icon name="lock" size={15} color="#92400e" />
            <span>Restricted Access: State IT administrators only.</span>
          </div>

          {error && (
            <div style={{
              padding: '10px 12px',
              backgroundColor: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 'var(--kq-radius-sm)',
              fontSize: 12,
              color: '#991b1b',
              marginBottom: 16
            }}>
              {error}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--kq-text-secondary)', display: 'block', marginBottom: 4 }}>
                Admin Username
              </label>
              <input
                className="kq-input"
                placeholder="superadmin"
                value={username}
                onChange={e => setUsername(e.target.value)}
                required
                autoComplete="username"
                style={{ height: 40, fontSize: 13.5 }}
              />
            </div>

            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--kq-text-secondary)', display: 'block', marginBottom: 4 }}>
                Admin Password
              </label>
              <input
                className="kq-input"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                style={{ height: 40, fontSize: 13.5 }}
              />
            </div>

            <PrimaryButton
              type="submit"
              loading={loading}
              style={{ marginTop: 8, height: 42, fontSize: 14, justifyContent: 'center' }}
            >
              <Icon name="shield" size={16} />
              <span>Authenticate Session</span>
            </PrimaryButton>
          </form>

        </div>

        {/* Footer info */}
        <div style={{
          backgroundColor: 'var(--kq-bg-subtle)',
          borderTop: '1px solid var(--kq-border-light)',
          padding: '12px 24px',
          textAlign: 'center',
          fontSize: 11,
          color: 'var(--kq-text-muted)'
        }}>
          Tamil Nadu Civil Supplies Corporation • Secure State Nodal Console
        </div>
      </div>

    </div>
  );
}

// Helper components
function MetricCard({ title, value, subtext, icon, color }) {
  return (
    <div style={{
      backgroundColor: '#ffffff',
      border: '1px solid var(--kq-border-medium)',
      borderRadius: 'var(--kq-radius-md)',
      padding: '18px 20px',
      display: 'flex',
      alignItems: 'center',
      gap: 14,
      boxShadow: 'var(--kq-shadow-xs)'
    }}>
      <div style={{
        width: 44,
        height: 44,
        borderRadius: 8,
        backgroundColor: `${color}15`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0
      }}>
        <Icon name={icon} size={22} color={color} />
      </div>
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--kq-text-muted)' }}>{title}</div>
        <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--kq-text-primary)', lineHeight: 1.15, marginTop: 2 }}>{value}</div>
        <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{subtext}</div>
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  return (
    <span style={{
      padding: '2px 8px',
      borderRadius: 12,
      fontSize: 11,
      fontWeight: 800,
      backgroundColor: getStatusBg(status),
      color: getStatusColor(status)
    }}>
      {status}
    </span>
  );
}

function getStatusBg(status) {
  switch (status) {
    case 'BOOKED': return '#f1f5f9';
    case 'CONFIRMED': return '#e0f2fe';
    case 'CHECKED_IN': return '#fef3c7';
    case 'GRADING': return '#ffedd5';
    case 'PROCURED': return '#dcfce7';
    case 'PAYMENT_PENDING': return '#fef08a';
    case 'PAYMENT_COMPLETED': return '#d1fae5';
    case 'CANCELLED': return '#fee2e2';
    default: return '#f1f5f9';
  }
}

function getStatusColor(status) {
  switch (status) {
    case 'BOOKED': return '#475569';
    case 'CONFIRMED': return '#0369a1';
    case 'CHECKED_IN': return '#b45309';
    case 'GRADING': return '#c2410c';
    case 'PROCURED': return '#15803d';
    case 'PAYMENT_PENDING': return '#854d0e';
    case 'PAYMENT_COMPLETED': return '#047857';
    case 'CANCELLED': return '#b91c1c';
    default: return '#334155';
  }
}
