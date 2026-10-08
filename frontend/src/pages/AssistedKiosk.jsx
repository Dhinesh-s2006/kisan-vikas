import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import API from '../api';
import {
  Card,
  StatCard,
  PrimaryButton,
  SecondaryButton,
  DangerButton,
  StatusBadge,
  AlertBanner,
  LoadingState,
  EmptyState,
  SearchBar,
  DataTable,
  FormField,
  Modal,
  Icon,
  formatHumanDate,
  formatHumanTime
} from '../components/design-system';

const getTodayKolkataStr = () => {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
};

const getMaxDateKolkataStr = (daysAhead = 7) => {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
};

export default function AssistedKiosk() {
  const navigate = useNavigate();
  const todayStr = getTodayKolkataStr();
  const maxDateStr = getMaxDateKolkataStr(7);

  // Auth & Session state
  const [operatorUser, setOperatorUser] = useState(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [availableDistricts, setAvailableDistricts] = useState([]);

  const isDevSwitcherEnabled = import.meta.env.VITE_ENABLE_DEMO_ROLE_SWITCHER === 'true';
  const operatorId = operatorUser?.username || 'CSC_OPERATOR';

  // Active kiosk tab
  const [kioskTab, setKioskTab] = useState('booking'); // 'booking', 'today', 'register'

  // Farmers search & selection
  const [searchQuery, setSearchQuery] = useState('');
  const [farmers, setFarmers] = useState([]);
  const [selectedFarmer, setSelectedFarmer] = useState(null);
  const [loadingFarmers, setLoadingFarmers] = useState(false);

  // Assisted Farmer Registration Form
  const [registerForm, setRegisterForm] = useState({
    name: '',
    phone: '',
    village: '',
    district: '',
    land_holding_acres: '',
    primary_crop: 'Paddy',
    preferred_language: 'Tamil',
    smartphone_access: 'No'
  });
  const [registerLoading, setRegisterLoading] = useState(false);
  const [registeredFarmerInfo, setRegisteredFarmerInfo] = useState(null);
  const [registerError, setRegisterError] = useState('');

  // Centres & Slots Booking
  const [centres, setCentres] = useState([]);
  const [centreId, setCentreId] = useState('');
  const [date, setDate] = useState(todayStr);
  const [crop, setCrop] = useState('Paddy');
  const [qty, setQty] = useState('');
  const [slots, setSlots] = useState([]);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [bookingResult, setBookingResult] = useState(null);
  const [bookingError, setBookingError] = useState('');

  // Centre Pacing Advisory
  const [centrePacing, setCentrePacing] = useState(null);

  // Today's Assisted Bookings
  const [todayBookings, setTodayBookings] = useState([]);
  const [loadingTodayBookings, setLoadingTodayBookings] = useState(false);

  // Thermal Slip Modal & QR Code
  const [printSlipData, setPrintSlipData] = useState(null);
  const [qrCodeUrl, setQrCodeUrl] = useState('');

  // Mount verification
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

    if (!token || role !== 'CSC_OPERATOR') {
      handleLogout(false);
      setAuthChecking(false);
      return;
    }

    API.get('/auth/me')
      .then(res => {
        if (res.data?.user && res.data.user.role === 'CSC_OPERATOR' && res.data.user.district) {
          setOperatorUser(res.data.user);
          localStorage.setItem('kisan_district', res.data.user.district);
          localStorage.setItem('kisan_username', res.data.user.username);
          initializeKioskData(res.data.user.district, res.data.user.username);
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

  // Fetch centre pacing when centreId or date changes
  useEffect(() => {
    if (!centreId) {
      setCentrePacing(null);
      return;
    }
    API.get(`/centres/${centreId}/pacing`, { params: { date } })
      .then(res => setCentrePacing(res.data))
      .catch(() => setCentrePacing(null));
  }, [centreId, date]);

  // Generate QR code whenever slip data changes
  useEffect(() => {
    if (printSlipData) {
      QRCode.toDataURL(JSON.stringify({
        booking_id: printSlipData.booking_id,
        token: printSlipData.token,
        farmer_id: printSlipData.farmer_id
      }), { width: 140, margin: 1, color: { dark: '#166534', light: '#ffffff' } })
        .then(url => setQrCodeUrl(url))
        .catch(err => console.error(err));
    }
  }, [printSlipData]);

  const initializeKioskData = async (district, username) => {
    setRegisterForm(prev => ({ ...prev, district }));

    // Fetch centres in this district
    API.get('/centres', { params: { district } })
      .then(res => {
        setCentres(res.data || []);
        if (res.data && res.data.length > 0) {
          const firstOpen = res.data.find(c => c.operational_status === 'Open');
          setCentreId(firstOpen ? firstOpen.centre_id : res.data[0].centre_id);
        }
      })
      .catch(console.error);

    fetchFarmers('', district);
    loadTodayBookings(username, district);
  };

  const handleLogin = async (e) => {
    if (e) e.preventDefault();
    try {
      setLoginLoading(true);
      setLoginError('');

      const res = await API.post('/auth/login', {
        username: loginForm.username.trim(),
        password: loginForm.password
      });

      if (res.data?.user?.role !== 'CSC_OPERATOR') {
        setLoginError('Access denied. This portal is restricted to CSC Operators only.');
        return;
      }

      const user = res.data.user;
      localStorage.setItem('kisan_token', res.data.token);
      localStorage.setItem('kisan_role', user.role);
      localStorage.setItem('kisan_district', user.district);
      localStorage.setItem('kisan_username', user.username);

      setOperatorUser(user);
      setLoginForm({ username: '', password: '' });
      await initializeKioskData(user.district, user.username);
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
    setOperatorUser(null);
    setCentres([]);
    setFarmers([]);
    setSelectedFarmer(null);
    setTodayBookings([]);
    setSlots([]);
    setSelectedSlot(null);
    setBookingResult(null);
    if (resetError) setLoginError('');
  };

  const handleDevQuickSwitch = (districtName) => {
    if (!districtName) return;
    handleLogout(true);
    setLoginForm({
      username: `csc_${districtName.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
      password: ''
    });
  };

  const fetchFarmers = async (query = '', explicitDistrict = null) => {
    const dist = explicitDistrict || operatorUser?.district;
    try {
      setLoadingFarmers(true);
      const params = {};
      if (query) params.search = query;
      if (dist) params.district = dist;
      const res = await API.get('/farmers', { params });
      setFarmers(res.data || []);
    } catch (err) {
      console.error('Error fetching farmers:', err);
    } finally {
      setLoadingFarmers(false);
    }
  };

  const loadTodayBookings = async (explicitUsername = null, explicitDistrict = null) => {
    const opUser = explicitUsername || operatorUser?.username;
    const dist = explicitDistrict || operatorUser?.district;
    try {
      setLoadingTodayBookings(true);
      const params = { date: todayStr };
      if (opUser) params.operator_id = opUser;
      if (dist) params.district = dist;
      const res = await API.get('/csc/bookings', { params });
      setTodayBookings(res.data || []);
    } catch (err) {
      console.error('Error fetching today bookings:', err);
    } finally {
      setLoadingTodayBookings(false);
    }
  };

  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    setRegisterLoading(true);
    setRegisterError('');
    try {
      const generatedId = 'F' + Date.now().toString().slice(-6);
      const payload = {
        ...registerForm,
        district: operatorUser?.district || registerForm.district,
        farmer_id: generatedId,
        land_holding_acres: registerForm.land_holding_acres ? parseFloat(registerForm.land_holding_acres) : 0
      };
      await API.post('/farmers/register', payload);

      const newFarmer = { ...payload, name: registerForm.name };
      setRegisteredFarmerInfo({ name: registerForm.name, farmer_id: generatedId });
      setSelectedFarmer(newFarmer);
      if (newFarmer.primary_crop) setCrop(newFarmer.primary_crop);

      fetchFarmers(newFarmer.name);
      setKioskTab('booking');
    } catch (err) {
      setRegisterError(err.response?.data?.message || 'Farmer registration failed. Please verify details.');
    } finally {
      setRegisterLoading(false);
    }
  };

  const handleLoadSlots = async () => {
    if (!centreId) {
      alert('Please select a procurement centre first.');
      return;
    }
    if (!date) {
      alert('Please select a date.');
      return;
    }
    try {
      setLoadingSlots(true);
      setSelectedSlot(null);
      setBookingError('');
      const res = await API.get(`/centres/${centreId}/slots`, { params: { date } });
      setSlots(res.data || []);
    } catch (err) {
      alert('Failed to load slots for this centre and date.');
    } finally {
      setLoadingSlots(false);
    }
  };

  const handleAllocateSlot = async (slotToBook = selectedSlot) => {
    if (!selectedFarmer) {
      alert('Please select a farmer first.');
      return;
    }
    if (!centreId) {
      alert('Please select a procurement centre.');
      return;
    }
    const chosenCentre = centres.find(c => c.centre_id === centreId);
    if (chosenCentre && chosenCentre.operational_status !== 'Open') {
      alert(`Cannot book at ${chosenCentre.centre_name}: centre is currently ${chosenCentre.operational_status || 'Closed'}. Only Open centres can accept bookings.`);
      return;
    }
    if (!slotToBook) {
      alert('Please choose an available time slot.');
      return;
    }
    if (!qty || parseFloat(qty) <= 0) {
      alert('Please enter a valid procurement quantity in quintals.');
      return;
    }

    try {
      setBookingLoading(true);
      setBookingError('');
      setBookingResult(null);

      const booking_id = 'B' + Date.now().toString().slice(-6);
      const payload = {
        booking_id,
        farmer_id: selectedFarmer.farmer_id,
        slot_id: slotToBook.slot_id,
        centre_id: centreId,
        district: operatorUser?.district,
        booking_date: date,
        crop: crop || 'Paddy',
        quantity_quintals: parseFloat(qty),
        msp_rate_inr: 2275,
        booking_source: 'CSC_ASSISTED',
        operator_id: operatorId
      };

      const res = await API.post('/bookings', payload);
      const data = res.data;
      const centreObj = centres.find(c => c.centre_id === centreId);

      const confirmedData = {
        booking_id: data.booking_id,
        farmer_id: selectedFarmer.farmer_id,
        farmer_name: selectedFarmer.name,
        farmer_phone: selectedFarmer.phone,
        token: data.token || `Q${String(data.queue_position).padStart(3, '0')}`,
        centre_name: centreObj ? centreObj.centre_name : centreId,
        date: date,
        slot_time: `${slotToBook.start_time} - ${slotToBook.end_time}`,
        queue_position: data.queue_position,
        estimated_wait_minutes: data.estimated_wait_minutes,
        crop: crop || 'Paddy',
        quantity_quintals: parseFloat(qty),
        operator_id: operatorId,
        timestamp: new Date().toLocaleString('en-IN')
      };

      setBookingResult(confirmedData);
      setPrintSlipData(confirmedData);
      handleLoadSlots();
      loadTodayBookings();
    } catch (err) {
      console.error('Booking failed:', err);
      setBookingError(err.response?.data?.message || 'Booking allocation failed. Please choose another slot.');
    } finally {
      setBookingLoading(false);
    }
  };

  if (authChecking) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <LoadingState message="Verifying CSC Kiosk Session..." />
      </div>
    );
  }

  // Unauthenticated Login Screen
  if (!operatorUser) {
    return (
      <div style={{ minHeight: '100vh', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, position: 'relative', zIndex: 1 }}>
        <div style={{ background: '#ffffff', padding: 36, borderRadius: 'var(--kq-radius-lg)', boxShadow: 'var(--kq-shadow-md)', width: '100%', maxWidth: 440, border: '1px solid var(--kq-border-light)' }}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <div style={{ display: 'inline-flex', padding: 12, borderRadius: '50%', background: 'var(--kq-green-50)', color: 'var(--kq-green-800)', marginBottom: 12 }}>
              <Icon name="users" size={32} />
            </div>
            <h1 style={{ margin: '4px 0', fontSize: 22, fontWeight: 800, color: 'var(--kq-text-primary)' }}>
              CSC Assisted Kiosk
            </h1>
            <p style={{ margin: 0, color: 'var(--kq-text-secondary)', fontSize: 13 }}>
              KISAN VIKAS • Assisted Service for Digital Farmer Inclusion
            </p>
          </div>

          {loginError && (
            <AlertBanner type="error" message={loginError} style={{ marginBottom: 18 }} />
          )}

          <form onSubmit={handleLogin}>
            <FormField label="CSC Operator Username" required>
              <input
                className="kq-input"
                type="text"
                placeholder="e.g. csc_thanjavur"
                value={loginForm.username}
                onChange={e => setLoginForm({ ...loginForm, username: e.target.value })}
                required
              />
            </FormField>

            <FormField label="Password" required style={{ marginTop: 14 }}>
              <input
                className="kq-input"
                type="password"
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
              {loginLoading ? 'Authenticating...' : 'Sign In to CSC Kiosk →'}
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

  return (
    <div style={{ minHeight: '100vh', background: 'transparent', position: 'relative', zIndex: 1 }}>
      
      {/* Top Header */}
      <header className="no-print" style={{
        background: '#ffffff',
        borderBottom: '1px solid var(--kq-border-medium)',
        padding: '12px 24px',
        position: 'sticky',
        top: 0,
        zIndex: 50,
        boxShadow: 'var(--kq-shadow-sm)'
      }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ background: 'var(--kq-green-800)', color: '#ffffff', padding: '6px 10px', borderRadius: 'var(--kq-radius-sm)', fontWeight: 800, fontSize: 13, letterSpacing: '0.04em' }}>
              KISAN VIKAS
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--kq-text-primary)' }}>
                CSC Assisted Service Kiosk — {operatorUser.district}
              </div>
              <div style={{ fontSize: 12, color: 'var(--kq-text-muted)' }}>
                Operator ID: <strong>{operatorId}</strong> • Direct Farmer Assisted Booking
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <SecondaryButton
              onClick={() => navigate('/csc/crop-declarations')}
              style={{ fontSize: 12, padding: '6px 12px', gap: 6 }}
            >
              <Icon name="wheat" size={14} color="var(--kq-green-700)" /> Crop Declarations
            </SecondaryButton>

            <SecondaryButton
              onClick={() => handleLogout()}
              style={{ fontSize: 12, padding: '6px 12px', gap: 6 }}
            >
              <Icon name="log-out" size={14} /> Sign Out
            </SecondaryButton>
          </div>
        </div>
      </header>

      {/* Dev Quick Switcher */}
      {isDevSwitcherEnabled && (
        <div className="no-print" style={{
          background: 'var(--kq-green-50)',
          borderBottom: '1px solid var(--kq-green-200)',
          padding: '8px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
          fontSize: 12
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--kq-green-900)' }}>
            <strong>[DEV ONLY] Switch CSC Operator:</strong>
            <select
              value={operatorUser.district}
              onChange={(e) => handleDevQuickSwitch(e.target.value)}
              className="kq-select"
              style={{ padding: '3px 8px', fontSize: 12, width: 'auto' }}
            >
              {(availableDistricts.length > 0 ? availableDistricts : [operatorUser.district]).map(dist => (
                <option key={dist} value={dist}>
                  {dist} (csc_{dist.toLowerCase().replace(/[^a-z0-9]/g, '')})
                </option>
              ))}
            </select>
          </div>
          <div style={{ color: 'var(--kq-green-800)' }}>
            Isolated District: <strong>{operatorUser.district}</strong>
          </div>
        </div>
      )}

      {/* Main Kiosk Container */}
      <div className="no-print" style={{ maxWidth: 1280, margin: '0 auto', padding: '20px 24px' }}>
        
        {/* Navigation Tabs */}
        <div style={{
          display: 'flex',
          gap: 6,
          borderBottom: '1px solid var(--kq-border-medium)',
          marginBottom: 20
        }}>
          {[
            { id: 'booking', label: '1. Select Farmer & Book Slot', icon: 'calendar' },
            { id: 'register', label: '2. Register New Farmer', icon: 'user' },
            { id: 'today', label: `3. Today's Assisted Bookings (${todayBookings.length})`, icon: 'file-text' }
          ].map(tab => {
            const isActive = kioskTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setKioskTab(tab.id)}
                style={{
                  padding: '10px 18px',
                  border: 'none',
                  borderBottom: isActive ? '3px solid var(--kq-green-700)' : '3px solid transparent',
                  background: isActive ? 'var(--kq-green-50)' : 'transparent',
                  color: isActive ? 'var(--kq-green-900)' : 'var(--kq-text-secondary)',
                  fontWeight: isActive ? 700 : 500,
                  fontSize: 14,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  borderRadius: 'var(--kq-radius-sm) var(--kq-radius-sm) 0 0'
                }}
              >
                <Icon name={tab.icon} size={16} color={isActive ? 'var(--kq-green-700)' : 'currentColor'} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* TAB 1: SELECT FARMER & BOOK SLOT */}
        {kioskTab === 'booking' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 24, alignItems: 'start' }}>
            
            {/* Step 1: Farmer Lookup & Select */}
            <Card style={{ padding: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h3 style={{ margin: 0, fontSize: 16, color: 'var(--kq-text-primary)' }}>
                  Farmer Lookup
                </h3>
                <SecondaryButton
                  onClick={() => setKioskTab('register')}
                  style={{ fontSize: 11, padding: '4px 8px' }}
                >
                  + New Registration
                </SecondaryButton>
              </div>

              <div style={{ marginBottom: 14 }}>
                <SearchBar
                  value={searchQuery}
                  onChange={(val) => {
                    setSearchQuery(val);
                    fetchFarmers(val);
                  }}
                  placeholder="Search by Phone Number, Farmer ID, or Name..."
                />
              </div>

              {selectedFarmer && (
                <div style={{ background: 'var(--kq-green-50)', border: '1.5px solid var(--kq-green-300)', padding: 14, borderRadius: 'var(--kq-radius-md)', marginBottom: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: 11, color: 'var(--kq-green-800)', fontWeight: 700, textTransform: 'uppercase' }}>Selected Farmer</div>
                    <span style={{ fontSize: 11, color: 'var(--kq-green-800)', fontWeight: 700 }}>✓ Verified</span>
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--kq-green-900)', marginTop: 2 }}>{selectedFarmer.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--kq-green-800)', marginTop: 2 }}>
                    ID: <strong>{selectedFarmer.farmer_id}</strong> • Phone: {selectedFarmer.phone}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--kq-green-800)' }}>
                    📍 {selectedFarmer.village}, {selectedFarmer.district}
                  </div>
                </div>
              )}

              <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid var(--kq-border-light)', borderRadius: 'var(--kq-radius-md)' }}>
                {loadingFarmers ? (
                  <div style={{ padding: 20, textAlign: 'center', color: 'var(--kq-text-muted)', fontSize: 12 }}>Searching directory...</div>
                ) : farmers.length === 0 ? (
                  <div style={{ padding: 20, textAlign: 'center', color: 'var(--kq-text-muted)', fontSize: 12 }}>No farmers found in {operatorUser.district}.</div>
                ) : (
                  farmers.map(f => (
                    <div
                      key={f.farmer_id}
                      onClick={() => {
                        setSelectedFarmer(f);
                        if (f.primary_crop) setCrop(f.primary_crop);
                      }}
                      style={{
                        padding: '10px 14px',
                        borderBottom: '1px solid var(--kq-border-light)',
                        cursor: 'pointer',
                        background: selectedFarmer?.farmer_id === f.farmer_id ? 'var(--kq-green-50)' : 'transparent',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--kq-text-primary)' }}>{f.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--kq-text-muted)' }}>ID: {f.farmer_id} • 📞 {f.phone}</div>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--kq-text-secondary)', textAlign: 'right' }}>
                        {f.village}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>

            {/* Step 2: Slot Allocation Form */}
            <Card style={{ padding: 20 }}>
              <h3 style={{ margin: '0 0 16px', fontSize: 16, color: 'var(--kq-text-primary)' }}>
                Appointment Details
              </h3>

              {bookingError && (
                <AlertBanner type="error" message={bookingError} style={{ marginBottom: 14 }} />
              )}

              <FormField label="Procurement Centre" required>
                <select
                  className="kq-select"
                  value={centreId}
                  onChange={e => setCentreId(e.target.value)}
                >
                  {centres.map(c => (
                    <option key={c.centre_id} value={c.centre_id}>
                      {c.centre_name} ({c.operational_status || 'Open'})
                    </option>
                  ))}
                </select>
              </FormField>

              {/* Pacing Alert if centre has delay */}
              {centrePacing && centrePacing.pacing_status !== 'NORMAL' && (
                <div style={{ marginTop: 12, background: 'var(--kq-amber-50)', border: '1px solid var(--kq-amber-200)', borderRadius: 'var(--kq-radius-md)', padding: 12, fontSize: 12, color: 'var(--kq-amber-900)' }}>
                  <strong>Centre Pacing Notice:</strong> {centrePacing.reason} (+{centrePacing.recommended_delay_minutes || 0} min recommended delay).
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 14 }}>
                <FormField label="Appointment Date" required hint={`Valid: ${todayStr} to ${maxDateStr}`}>
                  <input
                    className="kq-input"
                    type="date"
                    min={todayStr}
                    max={maxDateStr}
                    value={date}
                    onChange={e => setDate(e.target.value)}
                  />
                </FormField>

                <FormField label="Commodity" required>
                  <select
                    className="kq-select"
                    value={crop}
                    onChange={e => setCrop(e.target.value)}
                  >
                    <option value="Paddy">Paddy (Common)</option>
                    <option value="Paddy Grade A">Paddy (Grade A)</option>
                    <option value="Ragi">Ragi (Finger Millet)</option>
                    <option value="Maize">Maize (Corn)</option>
                    <option value="Black Gram">Black Gram (Urad)</option>
                  </select>
                </FormField>
              </div>

              <div style={{ marginTop: 14 }}>
                <FormField label="Quantity in Quintals" required hint="MSP benchmark: ₹2,275 / quintal">
                  <input
                    className="kq-input"
                    type="number"
                    step="0.1"
                    min="1"
                    placeholder="e.g. 25"
                    value={qty}
                    onChange={e => setQty(e.target.value)}
                  />
                </FormField>
              </div>

              <div style={{ marginTop: 14 }}>
                <PrimaryButton
                  onClick={handleLoadSlots}
                  disabled={loadingSlots || !centreId || !date}
                  style={{ width: '100%', fontSize: 13, gap: 6 }}
                >
                  <Icon name="clock" size={15} />
                  {loadingSlots ? 'Loading Available Slots...' : 'Find Available Time Slots →'}
                </PrimaryButton>
              </div>

              {/* Slot Options */}
              {slots.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--kq-text-secondary)', marginBottom: 8 }}>
                    Available 1-Hour Arrival Windows:
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
                    {slots.map(s => {
                      const isSelected = selectedSlot?.slot_id === s.slot_id;
                      const isExpired = !!s.is_expired || s.slot_status === 'EXPIRED';
                      const isFull = s.is_full || s.available_capacity <= 0 || (s.booked_count >= s.max_farmers);
                      const isDisabled = isFull || isExpired;
                      return (
                        <button
                          key={s.slot_id}
                          disabled={isDisabled}
                          onClick={() => setSelectedSlot(s)}
                          style={{
                            padding: '8px 10px',
                            borderRadius: 'var(--kq-radius-md)',
                            border: isSelected ? '2px solid var(--kq-green-700)' : '1px solid var(--kq-border-medium)',
                            background: isSelected ? 'var(--kq-green-50)' : isDisabled ? 'var(--kq-bg-subtle)' : '#ffffff',
                            color: isDisabled ? 'var(--kq-text-muted)' : 'var(--kq-text-primary)',
                            cursor: isDisabled ? 'not-allowed' : 'pointer',
                            textAlign: 'center',
                            opacity: isExpired ? 0.7 : 1
                          }}
                        >
                          <div style={{ fontSize: 12, fontWeight: 700 }}>
                            {formatHumanTime(`${s.start_time} - ${s.end_time}`)}
                          </div>
                          <div style={{ fontSize: 10, color: isExpired ? '#6b7280' : isFull ? 'var(--kq-red-700)' : 'var(--kq-green-800)', marginTop: 2, fontWeight: 600 }}>
                            {isExpired ? 'Expired' : isFull ? 'Full' : `${s.available_capacity ?? s.capacity ?? 5} slots`}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  <div style={{ marginTop: 18 }}>
                    <PrimaryButton
                      onClick={() => handleAllocateSlot()}
                      disabled={bookingLoading || !selectedSlot}
                      style={{ width: '100%', padding: 12, fontSize: 14 }}
                    >
                      {bookingLoading ? 'Allocating Slot...' : 'Confirm Booking & Print Slip →'}
                    </PrimaryButton>
                  </div>
                </div>
              )}
            </Card>

          </div>
        )}

        {/* TAB 2: REGISTER NEW FARMER */}
        {kioskTab === 'register' && (
          <Card style={{ maxWidth: 640, margin: '0 auto', padding: 24 }}>
            <h3 style={{ margin: '0 0 4px', fontSize: 17, color: 'var(--kq-text-primary)' }}>
              Assisted Farmer Registration
            </h3>
            <p style={{ margin: '0 0 18px', fontSize: 12, color: 'var(--kq-text-muted)' }}>
              Assisting farmer enrollment in {operatorUser.district} district registry.
            </p>

            {registerError && (
              <AlertBanner type="error" message={registerError} style={{ marginBottom: 14 }} />
            )}

            <form onSubmit={handleRegisterSubmit}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <FormField label="Full Name" required>
                  <input
                    className="kq-input"
                    name="name"
                    value={registerForm.name}
                    onChange={e => setRegisterForm({ ...registerForm, name: e.target.value })}
                    required
                  />
                </FormField>

                <FormField label="Phone Number" required>
                  <input
                    className="kq-input"
                    name="phone"
                    value={registerForm.phone}
                    onChange={e => setRegisterForm({ ...registerForm, phone: e.target.value })}
                    required
                  />
                </FormField>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
                <FormField label="Village / Town" required>
                  <input
                    className="kq-input"
                    name="village"
                    value={registerForm.village}
                    onChange={e => setRegisterForm({ ...registerForm, village: e.target.value })}
                    required
                  />
                </FormField>

                <FormField label="District" required>
                  <input
                    className="kq-input"
                    name="district"
                    value={registerForm.district}
                    disabled
                  />
                </FormField>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
                <FormField label="Land Holding (Acres)">
                  <input
                    className="kq-input"
                    type="number"
                    step="0.1"
                    name="land_holding_acres"
                    value={registerForm.land_holding_acres}
                    onChange={e => setRegisterForm({ ...registerForm, land_holding_acres: e.target.value })}
                  />
                </FormField>

                <FormField label="Primary Crop">
                  <select
                    className="kq-select"
                    name="primary_crop"
                    value={registerForm.primary_crop}
                    onChange={e => setRegisterForm({ ...registerForm, primary_crop: e.target.value })}
                  >
                    <option value="Paddy">Paddy</option>
                    <option value="Ragi">Ragi</option>
                    <option value="Maize">Maize</option>
                    <option value="Black Gram">Black Gram</option>
                  </select>
                </FormField>
              </div>

              <div style={{ marginTop: 22, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <SecondaryButton type="button" onClick={() => setKioskTab('booking')}>
                  Cancel
                </SecondaryButton>
                <PrimaryButton type="submit" disabled={registerLoading}>
                  {registerLoading ? 'Registering...' : 'Register Farmer & Proceed to Booking →'}
                </PrimaryButton>
              </div>
            </form>
          </Card>
        )}

        {/* TAB 3: TODAY'S BOOKINGS */}
        {kioskTab === 'today' && (
          <Card style={{ padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 17, color: 'var(--kq-text-primary)' }}>
                  Today's Assisted Appointments ({todayBookings.length})
                </h3>
                <div style={{ fontSize: 12, color: 'var(--kq-text-muted)', marginTop: 2 }}>
                  Issued at Kiosk by Operator {operatorId}
                </div>
              </div>
              <PrimaryButton onClick={() => loadTodayBookings()} style={{ fontSize: 12, padding: '6px 14px' }}>
                Refresh List
              </PrimaryButton>
            </div>

            {todayBookings.length === 0 ? (
              <EmptyState
                icon="file-text"
                title="No bookings issued today"
                description="Bookings generated at this CSC kiosk will appear here."
              />
            ) : (
              <DataTable
                columns={[
                  { key: 'token', header: 'Token', render: val => <strong>{val || '—'}</strong> },
                  { key: 'booking_id', header: 'Booking ID', render: val => <code>{val}</code> },
                  { key: 'farmer_name', header: 'Farmer', render: (val, r) => <div><strong>{val}</strong><div style={{ fontSize: 11, color: 'var(--kq-text-muted)' }}>{r.phone || r.farmer_phone || '—'}</div></div> },
                  { key: 'centre_name', header: 'Centre' },
                  { key: 'slot_time', header: 'Slot Time', render: val => formatHumanTime(val) },
                  { key: 'crop', header: 'Crop & Qty', render: (val, r) => `${val} (${r.quantity_quintals} q)` },
                  {
                    key: 'action',
                    header: 'Print Slip',
                    render: (_, r) => (
                      <SecondaryButton
                        onClick={() => {
                          setPrintSlipData(r);
                        }}
                        style={{ fontSize: 11, padding: '4px 8px', gap: 4 }}
                      >
                        <Icon name="printer" size={13} /> Print
                      </SecondaryButton>
                    )
                  }
                ]}
                data={todayBookings}
              />
            )}
          </Card>
        )}

      </div>

      {/* Printable Thermal Slip Modal (80mm) */}
      {printSlipData && (
        <Modal
          isOpen={!!printSlipData}
          onClose={() => setPrintSlipData(null)}
          title="Printable Appointment Slip"
        >
          <div className="printable-slip-area" style={{
            maxWidth: 320,
            margin: '0 auto',
            background: '#ffffff',
            border: '1px dashed #9ca3af',
            padding: 16,
            fontFamily: 'monospace',
            color: '#000000',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: 13, fontWeight: 900 }}>KISAN VIKAS</div>
            <div style={{ fontSize: 10, letterSpacing: '0.05em' }}>UZHAVARSETHU PLATFORM</div>
            <div style={{ fontSize: 10, margin: '2px 0 8px' }}>DIGITAL AGRICULTURAL PROCUREMENT</div>
            <div style={{ borderTop: '1px dashed #000', borderBottom: '1px dashed #000', padding: '6px 0', margin: '6px 0' }}>
              <div style={{ fontSize: 10 }}>ASSIGNED QUEUE TOKEN</div>
              <div style={{ fontSize: 32, fontWeight: 900, lineHeight: 1.1 }}>{printSlipData.token}</div>
            </div>

            <div style={{ textAlign: 'left', fontSize: 11, lineHeight: 1.6, margin: '10px 0' }}>
              <div><strong>Farmer:</strong> {printSlipData.farmer_name}</div>
              <div><strong>Farmer ID:</strong> {printSlipData.farmer_id}</div>
              {printSlipData.farmer_phone && <div><strong>Phone:</strong> {printSlipData.farmer_phone}</div>}
              <div><strong>Centre:</strong> {printSlipData.centre_name}</div>
              <div><strong>Date:</strong> {formatHumanDate(printSlipData.date)}</div>
              <div><strong>Slot Window:</strong> {formatHumanTime(printSlipData.slot_time)}</div>
              <div><strong>Commodity:</strong> {printSlipData.crop} ({printSlipData.quantity_quintals} quintals)</div>
              <div><strong>Booking Ref:</strong> {printSlipData.booking_id}</div>
            </div>

            {qrCodeUrl && (
              <div style={{ margin: '10px auto' }}>
                <img src={qrCodeUrl} alt="QR Code" style={{ width: 120, height: 120, display: 'block', margin: '0 auto' }} />
                <div style={{ fontSize: 9, color: '#666', marginTop: 2 }}>Scan at gate for check-in</div>
              </div>
            )}

            <div style={{ fontSize: 9, borderTop: '1px dashed #000', paddingTop: 6, marginTop: 8, textAlign: 'left', lineHeight: 1.3 }}>
              ℹ️ Please arrive 15 minutes before your slot time. Bring your photo ID and produce samples for moisture verification.
            </div>

            <div style={{ fontSize: 9, marginTop: 6, color: '#444' }}>
              Operator: {printSlipData.operator_id || operatorId} • {printSlipData.timestamp || new Date().toLocaleString('en-IN')}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
            <SecondaryButton onClick={() => setPrintSlipData(null)}>
              Close
            </SecondaryButton>
            <PrimaryButton onClick={() => window.print()} style={{ gap: 6 }}>
              <Icon name="printer" size={15} color="#ffffff" /> Print Slip (80mm)
            </PrimaryButton>
          </div>
        </Modal>
      )}

      {/* Print-specific style to isolate the 80mm slip on thermal paper */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .printable-slip-area, .printable-slip-area * { visibility: visible !important; }
          .printable-slip-area {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 80mm !important;
            max-width: 80mm !important;
            border: none !important;
            box-shadow: none !important;
          }
        }
      `}</style>

    </div>
  );
}
