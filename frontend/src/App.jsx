import { BrowserRouter, Routes, Route, Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';

import RoleSelection from './pages/RoleSelection';
import Register from './pages/Register';
import FarmerHome from './pages/FarmerHome';
import MyVisit from './pages/MyVisit';
import BookSlot from './pages/BookSlot';
import FarmerDocuments from './pages/FarmerDocuments';
import MyStatus from './pages/MyStatus';
import RaiseGrievance from './pages/RaiseGrievance';
import DistrictOfficer from './pages/DistrictOfficer';
import DistrictGISDashboard from './pages/DistrictGISDashboard';
import AssistedKiosk from './pages/AssistedKiosk';
import DigitalPass from './pages/DigitalPass';
import ProcurementRecord from './pages/ProcurementRecord';
import MyCropPlan from './pages/MyCropPlan';
import CSCCropDeclarations from './pages/CSCCropDeclarations';
import ProcurementForecast from './pages/ProcurementForecast';
import FarmerNotifications from './pages/FarmerNotifications';
import VoiceBooking from './pages/VoiceBooking';
import CentreAdminDashboard from './pages/CentreAdminDashboard';
import WebsiteAdminPortal from './pages/WebsiteAdminPortal';

import NotificationBell from './components/NotificationBell';
import { Icon, Modal, PrimaryButton, SecondaryButton, KisanNatureBackground } from './components/design-system';
import { useI18n, getLanguage, setLanguage } from './i18n';
import API from './api';

function FarmerLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useI18n();

  const [farmerId, setFarmerId] = useState(localStorage.getItem('kisan_farmer_id') || '');
  const [farmerName, setFarmerName] = useState(localStorage.getItem('kisan_farmer_name') || '');
  const [district, setDistrict] = useState(localStorage.getItem('kisan_district') || '');
  const [village, setVillage] = useState('');
  const [phone, setPhone] = useState('');
  const [currentLang, setCurrentLang] = useState(getLanguage());

  const [profileOpen, setProfileOpen] = useState(false);
  const [editProfileMode, setEditProfileMode] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', phone: '', village: '', district: '' });
  const [editLoading, setEditLoading] = useState(false);
  const [editMsg, setEditMsg] = useState('');

  const [helpOpen, setHelpOpen] = useState(false);

  // Sync session and language
  useEffect(() => {
    const handleStorage = () => {
      setFarmerId(localStorage.getItem('kisan_farmer_id') || '');
      setFarmerName(localStorage.getItem('kisan_farmer_name') || '');
      setDistrict(localStorage.getItem('kisan_district') || '');
    };
    const handleLangChange = () => setCurrentLang(getLanguage());
    const handleOpenHelp = () => setHelpOpen(true);

    window.addEventListener('storage', handleStorage);
    window.addEventListener('kq_language_changed', handleLangChange);
    window.addEventListener('kq_open_help', handleOpenHelp);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('kq_language_changed', handleLangChange);
      window.removeEventListener('kq_open_help', handleOpenHelp);
    };
  }, []);

  // Fetch farmer profile details for Profile Drawer
  useEffect(() => {
    if (!farmerId) return;
    API.get(`/farmers/${encodeURIComponent(farmerId)}`, { skipAuth: true })
      .then(res => {
        if (res.data) {
          if (res.data.name) setFarmerName(res.data.name);
          if (res.data.district) setDistrict(res.data.district);
          if (res.data.village) setVillage(res.data.village);
          if (res.data.phone) setPhone(res.data.phone);
          setEditForm({
            name: res.data.name || farmerName || '',
            phone: res.data.phone || '9000000010',
            village: res.data.village || 'Kattathur',
            district: res.data.district || district || 'Ariyalur'
          });
        }
      })
      .catch(() => {});
  }, [farmerId]);

  const handleFarmerLogout = () => {
    localStorage.removeItem('kisan_farmer_id');
    localStorage.removeItem('kisan_farmer_name');
    localStorage.removeItem('kisan_token');
    localStorage.removeItem('kisan_role');
    localStorage.removeItem('kisan_district');
    localStorage.removeItem('kisan_village');
    localStorage.removeItem('kisan_block');
    localStorage.removeItem('kisan_panchayat');
    setFarmerId('');
    setFarmerName('');
    setDistrict('');
    setVillage('');
    setPhone('');
    setProfileOpen(false);
    window.dispatchEvent(new Event('storage'));
    navigate('/farmer/login');
  };

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    if (!farmerId) return;
    try {
      setEditLoading(true);
      setEditMsg('');
      const res = await API.put(`/farmers/${encodeURIComponent(farmerId)}`, editForm, { skipAuth: true });
      if (res.data?.success) {
        setFarmerName(editForm.name);
        setDistrict(editForm.district);
        setVillage(editForm.village);
        setPhone(editForm.phone);
        localStorage.setItem('kisan_farmer_name', editForm.name);
        localStorage.setItem('kisan_district', editForm.district);
        window.dispatchEvent(new Event('storage'));
        setEditProfileMode(false);
        setEditMsg(currentLang === 'ta' ? 'சுயவிவரம் வெற்றிகரமாக புதுப்பிக்கப்பட்டது.' : 'Profile updated successfully.');
      }
    } catch (err) {
      console.error('Update profile error:', err);
      setEditMsg(err.response?.data?.message || (currentLang === 'ta' ? 'புதுப்பிக்க முடியவில்லை.' : 'Failed to update profile.'));
    } finally {
      setEditLoading(false);
    }
  };

  // Primary Farmer Navigation Destinations (Max 4-5 items, pure language)
  const navItems = [
    { to: '/farmer', label: currentLang === 'ta' ? 'முகப்பு' : 'Home', icon: 'home' },
    { to: '/farmer/visit', label: currentLang === 'ta' ? 'எனது வருகை' : 'My Visit', icon: 'clock' },
    { to: '/farmer/book', label: currentLang === 'ta' ? 'பதிவு' : 'Book', icon: 'calendar' },
    { to: '/farmer/documents', label: currentLang === 'ta' ? 'ஆவணங்கள்' : 'Documents', icon: 'file-text' }
  ];

  const isAuthenticated = Boolean(farmerId && farmerId.trim());
  const isAuthPage = location.pathname.includes('/login') || location.pathname.includes('/register');
  const showAuthenticatedNav = isAuthenticated && !isAuthPage;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: 'transparent', position: 'relative' }}>
      
      {/* 1. COMPACT GOVERNMENT BRAND ACCENT & DESKTOP HEADER */}
      <header style={{
        backgroundColor: '#ffffff',
        borderBottom: '1px solid var(--kq-border-medium)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
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
          maxWidth: 1080,
          margin: '0 auto',
          padding: '10px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12
        }}>
          {/* Brand Logo & Title */}
          <Link
            to={isAuthenticated ? '/farmer' : '/'}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              textDecoration: 'none',
              color: 'inherit'
            }}
          >
            <div style={{
              width: 34,
              height: 34,
              borderRadius: 'var(--kq-radius-sm)',
              backgroundColor: 'var(--kq-green-800)',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: 'var(--kq-shadow-xs)'
            }}>
              <Icon name="wheat" size={18} />
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--kq-green-900)', lineHeight: 1.15, letterSpacing: '0.02em' }}>
                {currentLang === 'ta' ? 'உழவர்சேது' : 'KISAN VIKAS'}
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--kq-text-muted)', fontWeight: 600 }}>
                {currentLang === 'ta' ? 'தமிழ்நாடு அரசு கொள்முதல்' : 'Govt of Tamil Nadu'}
              </div>
            </div>
          </Link>

          {/* Desktop Primary Navigation Links (Only shown when authenticated) */}
          {showAuthenticatedNav && (
            <nav className="kq-desktop-nav" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {navItems.map(item => {
                const isActive = location.pathname === item.to || (item.to === '/farmer' && (location.pathname === '/farmer/' || location.pathname === '/farmer/home'));
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '8px 14px',
                      borderRadius: 'var(--kq-radius-sm)',
                      fontSize: 13.5,
                      fontWeight: isActive ? 800 : 600,
                      color: isActive ? 'var(--kq-green-900)' : 'var(--kq-text-secondary)',
                      backgroundColor: isActive ? 'var(--kq-green-50)' : 'transparent',
                      border: isActive ? '1px solid var(--kq-green-200)' : '1px solid transparent',
                      textDecoration: 'none',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <Icon name={item.icon} size={15} color={isActive ? 'var(--kq-green-800)' : 'var(--kq-text-muted)'} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          )}

          {/* Right Header Controls: Language, plus Notification Bell & Profile Icon ONLY when authenticated */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            
            {/* The Primary Language Switcher (Always available) */}
            <button
              type="button"
              onClick={() => setLanguage(currentLang === 'ta' ? 'en' : 'ta')}
              style={{
                padding: '5px 12px',
                borderRadius: 'var(--kq-radius-sm)',
                border: '1.5px solid var(--kq-border-medium)',
                background: '#ffffff',
                color: 'var(--kq-green-900)',
                fontWeight: 700,
                fontSize: 12.5,
                cursor: 'pointer'
              }}
              title={currentLang === 'ta' ? 'Switch to English' : 'தமிழுக்கு மாறவும்'}
            >
              {currentLang === 'ta' ? 'English' : 'தமிழ்'}
            </button>

            {/* Authenticated Only: Notification Bell & Profile Icon */}
            {showAuthenticatedNav && (
              <>
                <NotificationBell />

                <button
                  type="button"
                  className="kq-profile-trigger-btn"
                  onClick={() => {
                    setProfileOpen(true);
                    setEditProfileMode(false);
                  }}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    border: '1.5px solid var(--kq-green-700)',
                    background: 'var(--kq-green-50)',
                    color: 'var(--kq-green-900)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    boxShadow: 'var(--kq-shadow-xs)'
                  }}
                  title={currentLang === 'ta' ? 'என் சுயவிவரம்' : 'My Profile'}
                  aria-label={currentLang === 'ta' ? 'என் சுயவிவரம்' : 'My Profile'}
                >
                  <Icon name="user" size={18} color="var(--kq-green-800)" />
                </button>
              </>
            )}

          </div>
        </div>
      </header>

      {/* 2. MAIN OUTLET CONTENT AREA */}
      <main style={{ flex: 1, outline: 'none', paddingBottom: showAuthenticatedNav ? 72 : 24, position: 'relative', zIndex: 1 }}>
        <Outlet />
      </main>


      {/* 3. MOBILE STICKY BOTTOM NAVIGATION BAR (Screens <= 768px, authenticated only) */}
      {showAuthenticatedNav && (
        <nav
          className="kq-mobile-nav"
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            backgroundColor: '#ffffff',
            borderTop: '1px solid var(--kq-border-medium)',
            boxShadow: '0 -2px 10px rgba(0,0,0,0.06)',
            zIndex: 100,
            display: 'flex',
            justifyContent: 'space-around',
            alignItems: 'center',
            padding: '6px 4px',
            height: 60
          }}
        >
          {navItems.map(item => {
            const isActive = location.pathname === item.to || (item.to === '/farmer' && (location.pathname === '/farmer/' || location.pathname === '/farmer/home'));
            return (
              <Link
                key={item.to}
                to={item.to}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  textDecoration: 'none',
                  color: isActive ? 'var(--kq-green-900)' : 'var(--kq-text-muted)',
                  fontWeight: isActive ? 800 : 500,
                  fontSize: 11,
                  flex: 1,
                  gap: 2
                }}
              >
                <Icon name={item.icon} size={20} color={isActive ? 'var(--kq-green-700)' : 'var(--kq-text-muted)'} />
                <span>{item.label}</span>
              </Link>
            );
          })}

          {/* Profile Tab in Mobile Bottom Bar */}
          <button
            type="button"
            onClick={() => {
              setProfileOpen(true);
              setEditProfileMode(false);
            }}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'none',
              border: 'none',
              color: profileOpen ? 'var(--kq-green-900)' : 'var(--kq-text-muted)',
              fontWeight: profileOpen ? 800 : 500,
              fontSize: 11,
              flex: 1,
              gap: 2,
              cursor: 'pointer',
              padding: 0
            }}
          >
            <Icon name="user" size={20} color={profileOpen ? 'var(--kq-green-700)' : 'var(--kq-text-muted)'} />
            <span>{currentLang === 'ta' ? 'சுயவிவரம்' : 'Profile'}</span>
          </button>
        </nav>
      )}

      {/* 4. MY PROFILE MODAL / DRAWER (SPECIFICALLY FOR ACCOUNT & PERSONAL SETTINGS) */}
      <Modal
        isOpen={profileOpen}
        onClose={() => { setProfileOpen(false); setEditProfileMode(false); }}
        title={currentLang === 'ta' ? 'என் சுயவிவரம்' : 'My Profile'}
        subtitle={farmerId ? (currentLang === 'ta' ? `உழவர் எண்: ${farmerId}` : `Farmer ID: ${farmerId}`) : ''}
        maxWidth={460}
        footer={
          <div style={{ display: 'flex', gap: 10, width: '100%' }}>
            <SecondaryButton
              onClick={() => { setProfileOpen(false); setEditProfileMode(false); }}
              style={{ flex: 1, justifyContent: 'center' }}
            >
              {currentLang === 'ta' ? 'மூடுக' : 'Close'}
            </SecondaryButton>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          
          {editMsg && (
            <div style={{
              padding: '8px 12px',
              borderRadius: 'var(--kq-radius-sm)',
              backgroundColor: 'var(--kq-green-50)',
              border: '1px solid var(--kq-green-200)',
              fontSize: 12.5,
              fontWeight: 600,
              color: 'var(--kq-green-900)'
            }}>
              {editMsg}
            </div>
          )}

          {/* Profile Header Summary */}
          <div style={{
            background: 'var(--kq-bg-subtle)',
            border: '1px solid var(--kq-border-light)',
            borderRadius: 'var(--kq-radius-md)',
            padding: '16px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12
          }}>
            <div>
              <div style={{ fontWeight: 900, fontSize: 18, color: 'var(--kq-text-primary)' }}>
                {farmerName || farmerId}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--kq-text-muted)', marginTop: 2 }}>
                {district || 'Ariyalur'} • {farmerId}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setEditProfileMode(!editProfileMode)}
              style={{
                background: '#ffffff',
                border: '1px solid var(--kq-border-medium)',
                color: 'var(--kq-green-900)',
                fontSize: 12,
                fontWeight: 700,
                padding: '6px 12px',
                borderRadius: 'var(--kq-radius-sm)',
                cursor: 'pointer'
              }}
            >
              {editProfileMode
                ? (currentLang === 'ta' ? 'ரத்து' : 'Cancel')
                : (currentLang === 'ta' ? 'சுயவிவரம் திருத்து' : 'Edit Profile')}
            </button>
          </div>

          {/* Edit Profile Form Mode */}
          {editProfileMode ? (
            <form onSubmit={handleSaveProfile} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--kq-text-secondary)', display: 'block', marginBottom: 4 }}>
                  {currentLang === 'ta' ? 'முழு பெயர்' : 'Full Name'}
                </label>
                <input
                  className="kq-input"
                  value={editForm.name}
                  onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                  required
                  style={{ height: 38, fontSize: 13 }}
                />
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--kq-text-secondary)', display: 'block', marginBottom: 4 }}>
                  {currentLang === 'ta' ? 'மொபைல் எண்' : 'Mobile Number'}
                </label>
                <input
                  className="kq-input"
                  value={editForm.phone}
                  onChange={e => setEditForm({ ...editForm, phone: e.target.value })}
                  style={{ height: 38, fontSize: 13 }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--kq-text-secondary)', display: 'block', marginBottom: 4 }}>
                    {currentLang === 'ta' ? 'கிராமம்' : 'Village'}
                  </label>
                  <input
                    className="kq-input"
                    value={editForm.village}
                    onChange={e => setEditForm({ ...editForm, village: e.target.value })}
                    style={{ height: 38, fontSize: 13 }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--kq-text-secondary)', display: 'block', marginBottom: 4 }}>
                    {currentLang === 'ta' ? 'மாவட்டம்' : 'District'}
                  </label>
                  <input
                    className="kq-input"
                    value={editForm.district}
                    onChange={e => setEditForm({ ...editForm, district: e.target.value })}
                    style={{ height: 38, fontSize: 13 }}
                  />
                </div>
              </div>

              <PrimaryButton type="submit" loading={editLoading} style={{ marginTop: 4, height: 38, fontSize: 13, justifyContent: 'center' }}>
                {currentLang === 'ta' ? 'சேமிக்கவும்' : 'Save Changes'}
              </PrimaryButton>
            </form>
          ) : (
            <>
              {/* Personal Details Section */}
              <div style={{ border: '1px solid var(--kq-border-light)', borderRadius: 'var(--kq-radius-md)', padding: '14px 16px' }}>
                <div style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--kq-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
                  {currentLang === 'ta' ? 'தனிப்பட்ட விவரங்கள்' : 'PERSONAL DETAILS'}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--kq-text-secondary)' }}>{currentLang === 'ta' ? 'பெயர்' : 'Name'}</span>
                    <strong style={{ color: 'var(--kq-text-primary)' }}>{farmerName || farmerId}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--kq-text-secondary)' }}>{currentLang === 'ta' ? 'மொபைல் எண்' : 'Mobile Number'}</span>
                    <strong style={{ color: 'var(--kq-text-primary)' }}>{phone || '9000000010'}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--kq-text-secondary)' }}>{currentLang === 'ta' ? 'கிராமம்' : 'Village'}</span>
                    <strong style={{ color: 'var(--kq-text-primary)' }}>{village || 'Kattathur'}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--kq-text-secondary)' }}>{currentLang === 'ta' ? 'மாவட்டம்' : 'District'}</span>
                    <strong style={{ color: 'var(--kq-text-primary)' }}>{district || 'Ariyalur'}</strong>
                  </div>
                </div>
              </div>

              {/* Account Settings Section (Read-only summary, NO duplicate switchers) */}
              <div style={{ border: '1px solid var(--kq-border-light)', borderRadius: 'var(--kq-radius-md)', padding: '14px 16px' }}>
                <div style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--kq-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
                  {currentLang === 'ta' ? 'கணக்கு' : 'ACCOUNT'}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--kq-text-secondary)' }}>{currentLang === 'ta' ? 'மொழி' : 'Language'}</span>
                    <strong style={{ color: 'var(--kq-text-primary)' }}>{currentLang === 'ta' ? 'தமிழ் (Tamil)' : 'English (ஆங்கிலம்)'}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--kq-text-secondary)' }}>{currentLang === 'ta' ? 'அறிவிப்புகள்' : 'Notifications'}</span>
                    <strong style={{ color: 'var(--kq-green-800)' }}>{currentLang === 'ta' ? 'செயலில் உள்ளது' : 'Active'}</strong>
                  </div>
                </div>
              </div>

              {/* Account Actions Section */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button
                  type="button"
                  onClick={handleFarmerLogout}
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: 'var(--kq-radius-sm)',
                    border: '1px solid var(--kq-border-medium)',
                    backgroundColor: '#ffffff',
                    color: 'var(--kq-danger-text)',
                    fontWeight: 700,
                    fontSize: 13,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    cursor: 'pointer'
                  }}
                >
                  <Icon name="log-out" size={15} color="var(--kq-danger-text)" />
                  <span>{currentLang === 'ta' ? 'வெளியேறு' : 'Log out'}</span>
                </button>

                {/* Subtle secondary role switch link */}
                <div style={{ textAlign: 'center', marginTop: 4 }}>
                  <Link
                    to="/"
                    onClick={() => setProfileOpen(false)}
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--kq-text-muted)',
                      textDecoration: 'underline'
                    }}
                  >
                    {currentLang === 'ta' ? 'பாத்திர மாற்றம் (Switch Role)' : 'Switch Role'}
                  </Link>
                </div>
              </div>
            </>
          )}

        </div>
      </Modal>

      {/* 5. TASK-BASED HELP & HELPLINE MODAL */}
      <Modal
        isOpen={helpOpen}
        onClose={() => setHelpOpen(false)}
        title={currentLang === 'ta' ? 'உழவர் உதவி மையம்' : 'Help & Support'}
        subtitle={currentLang === 'ta' ? 'உங்களுக்கு என்ன உதவி தேவை?' : 'What do you need help with?'}
        maxWidth={500}
        footer={
          <SecondaryButton onClick={() => setHelpOpen(false)} style={{ width: '100%', justifyContent: 'center' }}>
            {currentLang === 'ta' ? 'மூடுக' : 'Close'}
          </SecondaryButton>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          
          {/* Action 1: Book Help */}
          <button
            type="button"
            onClick={() => { setHelpOpen(false); navigate('/farmer/book'); }}
            className="kq-btn kq-btn-secondary"
            style={{ justifyContent: 'flex-start', padding: '12px 14px', textAlign: 'left', height: 'auto', gap: 10 }}
          >
            <Icon name="calendar" size={18} color="var(--kq-green-800)" />
            <div>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>{currentLang === 'ta' ? 'நான் கொள்முதல் பதிவு செய்ய வேண்டும்' : 'I want to book a visit'}</div>
              <div style={{ fontSize: 11.5, color: 'var(--kq-text-muted)' }}>{currentLang === 'ta' ? 'நாள் & நேரம் முன்பதிவு பக்கம் செல்ல' : 'Reserve date and time at procurement centre'}</div>
            </div>
          </button>

          {/* Action 2: Find Booking */}
          <button
            type="button"
            onClick={() => { setHelpOpen(false); navigate('/farmer/visit'); }}
            className="kq-btn kq-btn-secondary"
            style={{ justifyContent: 'flex-start', padding: '12px 14px', textAlign: 'left', height: 'auto', gap: 10 }}
          >
            <Icon name="clock" size={18} color="var(--kq-green-800)" />
            <div>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>{currentLang === 'ta' ? 'எனது முன்பதிவு எங்கே?' : "I can't find my booking"}</div>
              <div style={{ fontSize: 11.5, color: 'var(--kq-text-muted)' }}>{currentLang === 'ta' ? 'எனது வருகை மற்றும் டோக்கன் விவரம் காண' : 'View active visit cockpit and token'}</div>
            </div>
          </button>

          {/* Action 3: Pass Help */}
          <button
            type="button"
            onClick={() => { setHelpOpen(false); navigate('/farmer/documents'); }}
            className="kq-btn kq-btn-secondary"
            style={{ justifyContent: 'flex-start', padding: '12px 14px', textAlign: 'left', height: 'auto', gap: 10 }}
          >
            <Icon name="file-text" size={18} color="var(--kq-green-800)" />
            <div>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>{currentLang === 'ta' ? 'எனது நுழைவு பாஸ் எங்கே?' : 'Where is my pass?'}</div>
              <div style={{ fontSize: 11.5, color: 'var(--kq-text-muted)' }}>{currentLang === 'ta' ? 'டிஜிட்டல் பாஸ் மற்றும் ஆவணங்களை திறக்க' : 'View gate pass and official procurement documents'}</div>
            </div>
          </button>

          {/* Action 4: Payment Help */}
          <button
            type="button"
            onClick={() => { setHelpOpen(false); navigate('/farmer/grievance?issue_type=Payment+Delay'); }}
            className="kq-btn kq-btn-secondary"
            style={{ justifyContent: 'flex-start', padding: '12px 14px', textAlign: 'left', height: 'auto', gap: 10 }}
          >
            <Icon name="credit-card" size={18} color="#b45309" />
            <div>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>{currentLang === 'ta' ? 'எனது பணம் இன்னும் வரவில்லை' : 'My payment has not come'}</div>
              <div style={{ fontSize: 11.5, color: 'var(--kq-text-muted)' }}>{currentLang === 'ta' ? 'வங்கி வரவு தாமதம் புகார் பதிவு செய்ய' : 'Report direct benefit transfer delay'}</div>
            </div>
          </button>

          {/* Action 5: Centre Grievance */}
          <button
            type="button"
            onClick={() => { setHelpOpen(false); navigate('/farmer/grievance'); }}
            className="kq-btn kq-btn-secondary"
            style={{ justifyContent: 'flex-start', padding: '12px 14px', textAlign: 'left', height: 'auto', gap: 10 }}
          >
            <Icon name="alert-triangle" size={18} color="#dc2626" />
            <div>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>{currentLang === 'ta' ? 'கொள்முதல் நிலையத்தில் பிரச்சனை உள்ளது' : 'I have a problem at the centre'}</div>
              <div style={{ fontSize: 11.5, color: 'var(--kq-text-muted)' }}>{currentLang === 'ta' ? 'எடை அல்லது பணியாளர் தொடர்பான புகார்' : 'File a grievance regarding weighment or staff'}</div>
            </div>
          </button>

          {/* Action 6: Call Helpline */}
          <a
            href="tel:18004254444"
            className="kq-btn"
            style={{
              justifyContent: 'flex-start',
              padding: '12px 14px',
              textAlign: 'left',
              height: 'auto',
              gap: 10,
              backgroundColor: 'var(--kq-green-800)',
              color: '#ffffff',
              textDecoration: 'none'
            }}
          >
            <Icon name="phone" size={18} color="#ffffff" />
            <div>
              <div style={{ fontWeight: 800, fontSize: 13.5, color: '#ffffff' }}>
                {currentLang === 'ta' ? 'உதவி மையத்தை அழைக்கவும்: 1800-425-4444' : 'Talk to someone: 1800-425-4444'}
              </div>
              <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.85)' }}>
                {currentLang === 'ta' ? 'திங்கள் - சனி காலை 8:00 முதல் மாலை 6:00 வரை (கட்டணமில்லா சேவை)' : 'Toll-free agricultural support line (Mon - Sat 8 AM - 6 PM)'}
              </div>
            </div>
          </a>

          {/* Action 7: Voice Assistant */}
          <button
            type="button"
            onClick={() => { setHelpOpen(false); navigate('/farmer/voice-booking'); }}
            className="kq-btn kq-btn-secondary"
            style={{ justifyContent: 'flex-start', padding: '12px 14px', textAlign: 'left', height: 'auto', gap: 10 }}
          >
            <Icon name="mic" size={18} color="var(--kq-green-800)" />
            <div>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>{currentLang === 'ta' ? 'குரல் வழி உதவி (Voice Help)' : 'Voice Help'}</div>
              <div style={{ fontSize: 11.5, color: 'var(--kq-text-muted)' }}>{currentLang === 'ta' ? 'தமிழில் பேசி தகவல்களை அறிய' : 'Speak in Tamil or English to get assistance'}</div>
            </div>
          </button>

        </div>
      </Modal>

      {/* 6. SUBTLE PUBLIC SERVICE FOOTER */}
      <footer style={{
        marginTop: 'auto',
        borderTop: '1px solid var(--kq-border-light)',
        backgroundColor: '#ffffff',
        padding: '14px 16px',
        textAlign: 'center',
        fontSize: 12,
        color: 'var(--kq-text-muted)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span>{currentLang === 'ta' ? 'தமிழ்நாடு நுகர்பொருள் வாணிபக் கழகம்' : 'Tamil Nadu Civil Supplies Corporation'}</span>
          <span>•</span>
          <span>1800-425-4444</span>
          <span>•</span>
          <Link to="/" style={{ color: 'var(--kq-text-muted)', textDecoration: 'underline' }}>
            {currentLang === 'ta' ? 'பாத்திர மாற்றம்' : 'Change Role'}
          </Link>
        </div>
      </footer>

      {/* Responsive styles */}
      <style>{`
        @media (max-width: 768px) {
          .kq-desktop-nav {
            display: none !important;
          }
        }
        @media (min-width: 769px) {
          .kq-mobile-nav {
            display: none !important;
          }
        }
      `}</style>

    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="kq-app-root" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', position: 'relative' }}>
        <Routes>
          {/* MAIN ROLE SELECTION */}
          <Route path="/" element={<RoleSelection />} />

          {/* ASSISTED SERVICE KIOSK (CSC) */}
          <Route path="/assisted-kiosk" element={<AssistedKiosk />} />
          <Route path="/csc" element={<AssistedKiosk />} />
          <Route path="/csc/crop-declarations" element={<CSCCropDeclarations />} />

          {/* DIGITAL PROCUREMENT PASS DIRECT ROUTE */}
          <Route path="/pass/:id" element={<DigitalPass />} />
          <Route path="/pass" element={<DigitalPass />} />

          {/* DIGITAL PROCUREMENT RECORD DIRECT ROUTE */}
          <Route path="/procurement-record/:id" element={<ProcurementRecord />} />
          <Route path="/procurement-record" element={<ProcurementRecord />} />

          {/* DISTRICT OFFICER */}
          <Route path="/district-officer" element={<DistrictOfficer />} />
          <Route path="/district-officer/procurement-forecast" element={<ProcurementForecast />} />
          <Route path="/district-gis" element={<DistrictGISDashboard />} />

          {/* PROCUREMENT CENTRE ADMIN (DIRECT SINGLE ORIGIN ROUTES) */}
          <Route path="/admin" element={<CentreAdminDashboard />} />
          <Route path="/admin-dashboard" element={<CentreAdminDashboard />} />

          {/* DEDICATED SUPER ADMIN PORTAL (HIDDEN DIRECT ROUTE) */}
          <Route path="/super-admin" element={<WebsiteAdminPortal />} />
          <Route path="/website-admin" element={<WebsiteAdminPortal />} />

          {/* FARMER APPLICATION */}
          <Route path="/farmer" element={<FarmerLayout />}>
            <Route index element={<FarmerHome />} />
            <Route path="home" element={<FarmerHome />} />
            <Route path="visit" element={<MyVisit />} />
            <Route path="status" element={<MyVisit />} />
            <Route path="legacy-status" element={<MyStatus />} />
            <Route path="register" element={<Register />} />
            <Route path="login" element={<Register />} />
            <Route path="book" element={<BookSlot />} />
            <Route path="documents" element={<FarmerDocuments />} />
            <Route path="voice-booking" element={<VoiceBooking />} />
            <Route path="crop-plan" element={<MyCropPlan />} />
            <Route path="pass/:id" element={<DigitalPass />} />
            <Route path="pass" element={<DigitalPass />} />
            <Route path="procurement-record/:id" element={<ProcurementRecord />} />
            <Route path="procurement-record" element={<ProcurementRecord />} />
            <Route path="grievance" element={<RaiseGrievance />} />
            <Route path="notifications" element={<FarmerNotifications />} />
          </Route>

          {/* TOP-LEVEL SHORTCUT ALIASES */}
          <Route element={<FarmerLayout />}>
            <Route path="/home" element={<FarmerHome />} />
            <Route path="/visit" element={<MyVisit />} />
            <Route path="/book" element={<BookSlot />} />
            <Route path="/documents" element={<FarmerDocuments />} />
            <Route path="/crop-plan" element={<MyCropPlan />} />
            <Route path="/voice-booking" element={<VoiceBooking />} />
            <Route path="/status" element={<MyVisit />} />
            <Route path="/login" element={<Register />} />
            <Route path="/register" element={<Register />} />
            <Route path="/grievance" element={<RaiseGrievance />} />
            <Route path="/notifications" element={<FarmerNotifications />} />
          </Route>
        </Routes>

        {/* Global Persistent Subtle Nature Background Watermark */}
        <KisanNatureBackground />
      </div>
    </BrowserRouter>
  );
}