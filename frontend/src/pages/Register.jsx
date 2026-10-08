import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import API from '../api';
import {
  Card,
  PrimaryButton,
  SecondaryButton,
  FormField,
  FormSection,
  Stepper,
  AlertBanner,
  Modal,
  Icon
} from '../components/design-system';
import { useI18n, getLanguage, setLanguage } from '../i18n';

export default function FarmerEntry({ onLoginSuccess }) {
  const navigate = useNavigate();
  const { t } = useI18n();

  // Mode: 'entry' (Single unified screen) or 'register' (4-step registration wizard)
  const [authMode, setAuthMode] = useState('entry');
  const [currentLang, setCurrentLang] = useState(getLanguage());

  // Existing session from localStorage
  const [existingFarmerId, setExistingFarmerId] = useState(localStorage.getItem('kisan_farmer_id') || '');
  const [existingFarmerName, setExistingFarmerName] = useState(localStorage.getItem('kisan_farmer_name') || '');

  // 1. Registered Farmer Login State
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [loginSuccess, setLoginSuccess] = useState('');

  // 2. New Farmer Registration State
  const [currentStep, setCurrentStep] = useState(1);
  const [districts, setDistricts] = useState([]);
  const [villages, setVillages] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [panchayats, setPanchayats] = useState([]);
  const [loadingDistricts, setLoadingDistricts] = useState(false);
  const [loadingVillages, setLoadingVillages] = useState(false);
  const [loadingBlocks, setLoadingBlocks] = useState(false);
  const [loadingPanchayats, setLoadingPanchayats] = useState(false);

  const [form, setForm] = useState({
    name: '',
    phone: '',
    district: '',
    village: '',
    block: '',
    panchayat: '',
    land_holding_acres: '',
    primary_crop: 'Paddy (Common)',
    preferred_language: 'Tamil',
    smartphone_access: 'Yes'
  });

  const [submitting, setSubmitting] = useState(false);
  const [regError, setRegError] = useState('');
  const [registeredFarmer, setRegisteredFarmer] = useState(null);

  // 3. CSC Assistance Modal State
  const [showCscModal, setShowCscModal] = useState(false);
  const [cscDistrict, setCscDistrict] = useState(localStorage.getItem('kisan_district') || 'Thanjavur');
  const [cscCentres, setCscCentres] = useState([]);
  const [loadingCscCentres, setLoadingCscCentres] = useState(false);

  // Sync language changes
  useEffect(() => {
    const handleLangChange = () => setCurrentLang(getLanguage());
    window.addEventListener('kq_language_changed', handleLangChange);
    return () => window.removeEventListener('kq_language_changed', handleLangChange);
  }, []);

  // Load districts for registration
  useEffect(() => {
    setLoadingDistricts(true);
    API.get('/locations/districts', { skipAuth: true })
      .then(res => setDistricts(res.data || []))
      .catch(err => {
        console.error('Error loading districts:', err);
        setRegError('Unable to load district list.');
      })
      .finally(() => setLoadingDistricts(false));
  }, []);

  // Load CSC centres when modal opens or cscDistrict changes
  useEffect(() => {
    if (!showCscModal || !cscDistrict) return;
    setLoadingCscCentres(true);
    API.get('/centres', { params: { district: cscDistrict }, skipAuth: true })
      .then(res => setCscCentres(res.data || []))
      .catch(err => {
        console.error('Error fetching CSC centres:', err);
        setCscCentres([]);
      })
      .finally(() => setLoadingCscCentres(false));
  }, [showCscModal, cscDistrict]);

  // Fetch villages and blocks when district changes in registration
  const handleDistrictChange = async (e) => {
    const selectedDist = e.target.value;
    // Changing district clears invalid village, block and panchayat selections
    setForm(prev => ({
      ...prev,
      district: selectedDist,
      village: '',
      block: '',
      panchayat: ''
    }));
    setVillages([]);
    setBlocks([]);
    setPanchayats([]);
    setRegError('');

    if (!selectedDist) return;

    try {
      setLoadingVillages(true);
      setLoadingBlocks(true);
      
      const [vRes, bRes] = await Promise.all([
        API.get(`/locations/districts/${encodeURIComponent(selectedDist)}/villages`, { skipAuth: true }).catch(() => ({ data: [] })),
        API.get(`/locations/districts/${encodeURIComponent(selectedDist)}/blocks`, { skipAuth: true }).catch(() => ({ data: [] }))
      ]);

      const villageList = Array.isArray(vRes.data) ? vRes.data : (vRes.data?.villages || []);
      const blockList = Array.isArray(bRes.data) ? bRes.data : (bRes.data?.blocks || []);

      setVillages(villageList);
      setBlocks(blockList);
    } catch (err) {
      console.error('Error fetching location data for district:', err);
      setRegError('Unable to load location choices for selected district.');
    } finally {
      setLoadingVillages(false);
      setLoadingBlocks(false);
    }
  };

  // Fetch panchayats when block changes in registration
  const handleBlockChange = async (e) => {
    const selectedBlock = e.target.value;
    // Changing block clears invalid panchayat selection
    setForm(prev => ({
      ...prev,
      block: selectedBlock,
      panchayat: ''
    }));
    setPanchayats([]);
    setRegError('');

    if (!selectedBlock) return;

    try {
      setLoadingPanchayats(true);
      const res = await API.get(`/locations/blocks/${encodeURIComponent(selectedBlock)}/panchayats`, {
        params: { district: form.district },
        skipAuth: true
      });
      const pList = Array.isArray(res.data) ? res.data : (res.data?.panchayats || []);
      setPanchayats(pList);
    } catch (err) {
      console.error('Error fetching panchayats for block:', err);
    } finally {
      setLoadingPanchayats(false);
    }
  };

  const handleFormChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
    setRegError('');
  };

  // Step navigation validations
  const handleNextStep = () => {
    setRegError('');
    if (currentStep === 1) {
      if (!form.name.trim()) {
        setRegError(currentLang === 'ta' ? 'உங்கள் முழு பெயரை உள்ளிடவும்.' : 'Please enter your full name.');
        return;
      }
      const digits = form.phone.replace(/\D/g, '');
      if (digits.length !== 10) {
        setRegError(currentLang === 'ta' ? 'சரியான 10-இலக்க மொபைல் எண்ணை உள்ளிடவும்.' : 'Please enter a valid 10-digit mobile number.');
        return;
      }
    } else if (currentStep === 2) {
      if (!form.district) {
        setRegError(currentLang === 'ta' ? 'மாவட்டத்தை தேர்ந்தெடுக்கவும்.' : 'Please select your district.');
        return;
      }
      if (!form.village) {
        setRegError(currentLang === 'ta' ? 'கிராமத்தை தேர்ந்தெடுக்கவும்.' : 'Please select your village/town.');
        return;
      }
    } else if (currentStep === 3) {
      if (blocks.length > 0 && !form.block) {
        setRegError(currentLang === 'ta' ? 'வட்டம் / பிளாக்கைத் தேர்ந்தெடுக்கவும்.' : 'Please select your block / taluk.');
        return;
      }
      if (!form.panchayat) {
        setRegError(currentLang === 'ta' ? 'ஊராட்சியைத் தேர்ந்தெடுக்கவும் அல்லது உள்ளிடவும்.' : 'Please select or enter your panchayat.');
        return;
      }
      if (!form.land_holding_acres || parseFloat(form.land_holding_acres) <= 0) {
        setRegError(currentLang === 'ta' ? 'நில அளவை (ஏக்கர்) உள்ளிடவும்.' : 'Please enter a valid land holding in acres.');
        return;
      }
      if (!form.primary_crop) {
        setRegError(currentLang === 'ta' ? 'முதன்மை பயிரை தேர்ந்தெடுக்கவும்.' : 'Please select your primary crop.');
        return;
      }
    }
    setCurrentStep(prev => Math.min(4, prev + 1));
  };

  const handlePrevStep = () => {
    setRegError('');
    setCurrentStep(prev => Math.max(1, prev - 1));
  };

  // Submit Registration
  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    setRegError('');

    try {
      setSubmitting(true);
      const generatedId = 'F' + Date.now().toString().slice(-6);
      const payload = {
        ...form,
        farmer_id: generatedId,
        land_holding_acres: parseFloat(form.land_holding_acres) || 2.5
      };

      const res = await API.post('/farmers/register', payload, { skipAuth: true });

      if (res.data?.token) {
        localStorage.setItem('kisan_token', res.data.token);
      }
      localStorage.setItem('kisan_farmer_id', generatedId);
      localStorage.setItem('kisan_farmer_name', form.name);
      localStorage.setItem('kisan_role', 'FARMER');
      localStorage.setItem('kisan_district', form.district);
      if (form.village) localStorage.setItem('kisan_village', form.village);
      if (form.block) localStorage.setItem('kisan_block', form.block);
      if (form.panchayat) localStorage.setItem('kisan_panchayat', form.panchayat);

      setRegisteredFarmer({
        farmer_id: generatedId,
        name: form.name,
        district: form.district,
        village: form.village,
        block: form.block,
        panchayat: form.panchayat,
        phone: form.phone
      });
      window.dispatchEvent(new Event('storage'));
    } catch (err) {
      console.error('Registration failed:', err);
      setRegError(err.response?.data?.message || (currentLang === 'ta' ? 'பதிவு தோல்வியடைந்தது. விவரங்களை சரிபார்க்கவும்.' : 'Registration failed. Please check your details.'));
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Registered Farmer Login
  const handleLoginSubmit = async (e) => {
    e?.preventDefault();
    setLoginError('');
    setLoginSuccess('');

    const query = loginIdentifier.trim();
    if (!query) {
      setLoginError(currentLang === 'ta' ? 'உழவர் அடையாள எண் அல்லது மொபைல் எண்ணை உள்ளிடவும்.' : 'Please enter your Farmer ID or registered mobile number.');
      return;
    }

    try {
      setLoginLoading(true);

      const res = await API.post('/auth/farmer-login', { identifier: query }, { skipAuth: true });
      if (res.data?.success && res.data?.farmer) {
        const f = res.data.farmer;
        const fId = f.farmer_id || f.id;
        if (res.data.token) {
          localStorage.setItem('kisan_token', res.data.token);
        }
        localStorage.setItem('kisan_farmer_id', fId);
        localStorage.setItem('kisan_farmer_name', f.name || fId);
        localStorage.setItem('kisan_role', 'FARMER');
        if (f.district) localStorage.setItem('kisan_district', f.district);
        if (f.village) localStorage.setItem('kisan_village', f.village);
        if (f.block) localStorage.setItem('kisan_block', f.block);
        if (f.panchayat) localStorage.setItem('kisan_panchayat', f.panchayat);

        setLoginSuccess(currentLang === 'ta' ? `நல்வரவு, ${f.name || fId}!` : `Welcome back, ${f.name || fId}!`);
        window.dispatchEvent(new Event('storage'));

        if (onLoginSuccess) {
          onLoginSuccess(fId);
        } else {
          setTimeout(() => navigate('/farmer'), 500);
        }
      } else {
        setLoginError(currentLang === 'ta' ? 'இந்த எண்ணில் உழவர் கணக்கு காணப்படவில்லை.' : 'No registered farmer account found with this ID or mobile number.');
      }
    } catch (err) {
      console.error('Farmer login error:', err);
      if (err.response?.status === 409 || err.response?.data?.ambiguous) {
        setLoginError(
          currentLang === 'ta'
            ? 'இந்த மொபைல் எண்ணில் பல உழவர் கணக்குகள் பதிவு செய்யப்பட்டுள்ளன. உள்நுழைய உங்கள் தனித்துவமான உழவர் அடையாள எண்ணை (எ.கா: F932193) உள்ளிடவும்.'
            : 'Multiple accounts are associated with this mobile number. Please enter your unique Farmer ID (e.g. F932193) to log in.'
        );
      } else if (err.response?.status === 404) {
        setLoginError(
          currentLang === 'ta'
            ? 'இந்த மொபைல் எண் அல்லது உழவர் எண்ணில் கணக்கு எதுவும் பதிவு செய்யப்படவில்லை. சரிபார்க்கவும் அல்லது புதிய பதிவை தொடங்கவும்.'
            : 'No registered farmer found with this mobile number or Farmer ID. Please check your details or register as a new farmer.'
        );
      } else {
        setLoginError(err.response?.data?.message || (currentLang === 'ta' ? 'உள்நுழைவு தோல்வியடைந்தது.' : 'Verification failed. Please check your credentials.'));
      }
    } finally {
      setLoginLoading(false);
    }
  };

  const steps = [
    { id: 1, title: currentLang === 'ta' ? 'தனிப்பட்ட விவரம்' : 'Personal Details' },
    { id: 2, title: currentLang === 'ta' ? 'இருப்பிடம்' : 'Location' },
    { id: 3, title: currentLang === 'ta' ? 'பண்ணை & பயிர்' : 'Farm & Crop' },
    { id: 4, title: currentLang === 'ta' ? 'உறுதிசெய்தல்' : 'Review & Submit' }
  ];

  return (
    <div style={{ maxWidth: 540, margin: '24px auto', padding: '0 16px 60px' }}>
      
      {/* ===================================================================== */}
      {/* 1. SINGLE UNIFIED FARMER ENTRY SCREEN                                 */}
      {/* ===================================================================== */}
      {authMode === 'entry' && (
        <div>
          {/* Identity & Friendly Welcome */}
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <div style={{
              width: 52,
              height: 52,
              borderRadius: 'var(--kq-radius-md)',
              backgroundColor: 'var(--kq-green-800)',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 12px',
              boxShadow: 'var(--kq-shadow-sm)'
            }}>
              <Icon name="wheat" size={28} />
            </div>
            
            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--kq-green-800)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {currentLang === 'ta' ? 'தமிழ்நாடு அரசு • உழவர்சேது' : 'Govt of Tamil Nadu • Kisan Vikas'}
            </div>
            <h1 style={{ margin: '6px 0 4px', fontSize: 26, fontWeight: 900, color: 'var(--kq-text-primary)' }}>
              {currentLang === 'ta' ? 'வணக்கம்' : 'Vanakkam'}
            </h1>
            <p style={{ margin: 0, fontSize: 14.5, color: 'var(--kq-text-secondary)', lineHeight: 1.4 }}>
              {currentLang === 'ta'
                ? 'நேரடி கொள்முதல் நிலையத்தில் உங்கள் நெல்லை விற்பனை செய்யுங்கள்.'
                : 'Sell your crop at the procurement centre.'}
            </p>
          </div>

          {/* Active Session Notice if already logged in */}
          {existingFarmerId && (
            <div style={{
              background: 'var(--kq-green-50)',
              border: '1.5px solid var(--kq-green-300)',
              borderRadius: 'var(--kq-radius-md)',
              padding: '12px 16px',
              marginBottom: 20,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 8
            }}>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--kq-green-900)' }}>
                  {existingFarmerName || 'Farmer'} ({existingFarmerId})
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--kq-green-800)' }}>
                  {currentLang === 'ta' ? 'உள்நுழைவு செயலில் உள்ளது' : 'Active session detected'}
                </div>
              </div>
              <PrimaryButton
                onClick={() => navigate('/farmer')}
                style={{ padding: '6px 14px', fontSize: 12.5 }}
              >
                {currentLang === 'ta' ? 'முகப்புக்கு செல் →' : 'Go to Home →'}
              </PrimaryButton>
            </div>
          )}

          {/* SECTION 1: I ALREADY REGISTERED */}
          <div style={{
            background: '#ffffff',
            border: '2px solid var(--kq-green-700)',
            borderRadius: 'var(--kq-radius-lg)',
            padding: '22px 20px',
            boxShadow: 'var(--kq-shadow-sm)',
            marginBottom: 18
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Icon name="check-circle" size={18} color="var(--kq-green-700)" />
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: 'var(--kq-text-primary)' }}>
                {currentLang === 'ta' ? 'ஏற்கனவே பதிவு செய்துள்ளேன்' : 'I already registered'}
              </h2>
            </div>
            
            <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--kq-text-secondary)' }}>
              {currentLang === 'ta'
                ? 'உங்கள் உழவர் அடையாள எண் அல்லது மொபைல் எண்ணை உள்ளிடவும்.'
                : 'Enter your Farmer ID or mobile number.'}
            </p>

            {loginError && <AlertBanner type="error" message={loginError} style={{ marginBottom: 14 }} />}
            {loginSuccess && <AlertBanner type="success" message={loginSuccess} style={{ marginBottom: 14 }} />}

            <form onSubmit={handleLoginSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <input
                type="text"
                value={loginIdentifier}
                onChange={(e) => {
                  setLoginIdentifier(e.target.value);
                  setLoginError('');
                }}
                placeholder={currentLang === 'ta' ? 'உழவர் எண் அல்லது 10-இலக்க மொபைல் எண் (எ.கா: F932193 / 9876543210)' : 'Farmer ID or 10-digit mobile (e.g. F932193 or 9876543210)'}
                required
                style={{
                  height: 48,
                  padding: '0 14px',
                  borderRadius: 'var(--kq-radius-sm)',
                  border: '1.5px solid var(--kq-border-strong)',
                  fontSize: 16,
                  fontWeight: 700,
                  color: 'var(--kq-text-primary)'
                }}
              />

              <PrimaryButton
                type="submit"
                loading={loginLoading}
                style={{
                  height: 48,
                  fontSize: 16,
                  fontWeight: 800,
                  justifyContent: 'center',
                  boxShadow: 'var(--kq-shadow-sm)'
                }}
              >
                {currentLang === 'ta' ? 'தொடரவும்' : 'Continue'}
              </PrimaryButton>
            </form>
          </div>

          {/* SECTION 2: NEW FARMER? */}
          <div style={{
            background: '#ffffff',
            border: '1px solid var(--kq-border-medium)',
            borderRadius: 'var(--kq-radius-lg)',
            padding: '20px',
            boxShadow: 'var(--kq-shadow-xs)',
            marginBottom: 18,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12
          }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--kq-text-primary)' }}>
                {currentLang === 'ta' ? 'புதிய உழவரா?' : 'New farmer?'}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--kq-text-secondary)', marginTop: 2 }}>
                {currentLang === 'ta'
                  ? 'பயிர்களை விற்க புதிய உழவர் கணக்கை தொடங்குங்கள்.'
                  : 'Create your account to start booking procurement slots.'}
              </div>
            </div>

            <SecondaryButton
              onClick={() => {
                setAuthMode('register');
                setCurrentStep(1);
                setRegError('');
              }}
              style={{ padding: '8px 20px', fontSize: 14, fontWeight: 700 }}
            >
              {currentLang === 'ta' ? 'புதிய பதிவு' : 'Register'}
            </SecondaryButton>
          </div>

          {/* SECTION 3: NEED HELP / CSC KIOSK */}
          <div style={{
            background: 'var(--kq-bg-subtle)',
            border: '1px solid var(--kq-border-medium)',
            borderRadius: 'var(--kq-radius-lg)',
            padding: '16px 18px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--kq-text-primary)' }}>
                  {currentLang === 'ta' ? 'உதவி தேவையா?' : 'Need help?'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--kq-text-muted)', marginTop: 1 }}>
                  {currentLang === 'ta' ? 'கட்டணமில்லா உழவர் உதவி எண்: 1800-425-4444' : 'Toll-free agricultural support: 1800-425-4444'}
                </div>
              </div>

              <a
                href="tel:18004254444"
                className="kq-btn kq-btn-secondary"
                style={{ fontSize: 12.5, padding: '4px 12px', textDecoration: 'none', height: 32 }}
              >
                {currentLang === 'ta' ? 'உதவி எண் அழைக்க' : 'Get Help'}
              </a>
            </div>

            <div style={{ borderTop: '1px solid var(--kq-border-light)', paddingTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--kq-text-secondary)' }}>
                  {currentLang === 'ta' ? 'ஸ்மார்ட்போன் இல்லையா?' : "Don't have a smartphone?"}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--kq-text-muted)' }}>
                  {currentLang === 'ta' ? 'அருகிலுள்ள கிராம சேவை மையத்தில் பதிவு செய்யலாம்.' : 'Visit your nearby CSC assisted service kiosk.'}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowCscModal(true)}
                className="kq-btn kq-btn-secondary"
                style={{ fontSize: 12, padding: '4px 12px', height: 30, cursor: 'pointer' }}
              >
                {currentLang === 'ta' ? 'CSC உதவி மையம்' : 'Assisted Centres'}
              </button>
            </div>
          </div>

          {/* Return to Role Selection Link */}
          <div style={{ textAlign: 'center', marginTop: 24 }}>
            <Link
              to="/"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--kq-green-800)',
                textDecoration: 'none'
              }}
            >
              ← {currentLang === 'ta' ? 'முதன்மை பங்கு தேர்வுக்கு திரும்புக' : 'Return to Role Selection'}
            </Link>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* 2. REGISTRATION WIZARD (When "Register" Is Clicked)                    */}
      {/* ===================================================================== */}
      {authMode === 'register' && (
        <div>
          {/* Back to entry button */}
          <div style={{ marginBottom: 18 }}>
            <button
              type="button"
              onClick={() => {
                setAuthMode('entry');
                setRegError('');
                setRegisteredFarmer(null);
              }}
              className="kq-btn kq-btn-secondary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700 }}
            >
              <Icon name="arrow-left" size={14} />
              <span>{currentLang === 'ta' ? 'உள்நுழைவு செல்ல' : 'Back to Login'}</span>
            </button>
          </div>

          <Card style={{ padding: 24 }}>
            {registeredFarmer ? (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <div style={{
                  width: 56,
                  height: 56,
                  borderRadius: '50%',
                  background: 'var(--kq-green-100)',
                  color: 'var(--kq-green-800)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 16px'
                }}>
                  <Icon name="check" size={32} />
                </div>
                <h2 style={{ fontSize: 22, fontWeight: 800, color: 'var(--kq-text-primary)', margin: '0 0 8px' }}>
                  {currentLang === 'ta' ? 'பதிவு வெற்றிகரமாக முடிந்தது!' : 'Registration Successful!'}
                </h2>
                <p style={{ fontSize: 14, color: 'var(--kq-text-secondary)', margin: '0 0 16px' }}>
                  {currentLang === 'ta'
                    ? `உங்கள் உழவர் அடையாள எண் உருவாக்கப்பட்டுள்ளது: ${registeredFarmer.farmer_id}`
                    : `Your new Farmer ID has been generated: ${registeredFarmer.farmer_id}`}
                </p>

                <div style={{
                  padding: 16,
                  background: 'var(--kq-green-50)',
                  border: '1.5px solid var(--kq-green-600)',
                  borderRadius: 'var(--kq-radius-md)',
                  marginBottom: 24,
                  fontSize: 24,
                  fontWeight: 900,
                  color: 'var(--kq-green-900)'
                }}>
                  {registeredFarmer.farmer_id}
                </div>

                <PrimaryButton
                  onClick={() => navigate('/farmer/book')}
                  style={{ width: '100%', height: 44, fontSize: 15, justifyContent: 'center' }}
                >
                  {currentLang === 'ta' ? 'கொள்முதல் நேரம் பதிவு செய்ய →' : 'Book a Procurement Visit →'}
                </PrimaryButton>
              </div>
            ) : (
              <div>
                <div style={{ marginBottom: 18 }}>
                  <h2 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 800, color: 'var(--kq-text-primary)' }}>
                    {currentLang === 'ta' ? 'புதிய உழவர் பதிவு' : 'New Farmer Registration'}
                  </h2>
                  <div style={{ fontSize: 13, color: 'var(--kq-text-secondary)' }}>
                    {currentLang === 'ta' ? `படி ${currentStep} / 4: ${steps[currentStep - 1].title}` : `Step ${currentStep} of 4: ${steps[currentStep - 1].title}`}
                  </div>
                </div>

                <Stepper steps={steps} currentStep={currentStep} style={{ marginBottom: 24 }} />

                {regError && <AlertBanner type="error" message={regError} style={{ marginBottom: 18 }} />}

                {/* Step 1: Personal Details */}
                {currentStep === 1 && (
                  <FormSection title={currentLang === 'ta' ? '1. உங்கள் விவரங்கள்' : '1. Personal Details'}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                      <FormField label={currentLang === 'ta' ? 'முழு பெயர் *' : 'Full Name *'} id="name">
                        <input
                          type="text"
                          name="name"
                          className="kq-input"
                          value={form.name}
                          onChange={handleFormChange}
                          placeholder={currentLang === 'ta' ? 'எ.கா: ராமசாமி' : 'e.g. Ramasamy'}
                          required
                        />
                      </FormField>

                      <FormField label={currentLang === 'ta' ? 'மொபைல் எண் (10 இலக்கங்கள்) *' : 'Mobile Number (10 digits) *'} id="phone">
                        <input
                          type="tel"
                          name="phone"
                          maxLength="10"
                          className="kq-input"
                          value={form.phone}
                          onChange={handleFormChange}
                          placeholder="9876543210"
                          required
                        />
                      </FormField>
                    </div>
                  </FormSection>
                )}

                {/* Step 2: Location */}
                {currentStep === 2 && (
                  <FormSection
                    title={currentLang === 'ta' ? '2. இருப்பிடம்' : '2. Location'}
                    description={currentLang === 'ta' ? 'உங்கள் மாவட்டம் மற்றும் கிராமத்தை தேர்வு செய்க' : 'Select your district and village/town'}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                      <FormField label={currentLang === 'ta' ? 'மாவட்டம் *' : 'District *'} id="district">
                        <select
                          name="district"
                          className="kq-select"
                          value={form.district}
                          onChange={handleDistrictChange}
                          required
                        >
                          <option value="">{currentLang === 'ta' ? '-- மாவட்டம் தேர்வு செய்க --' : '-- Select District --'}</option>
                          {districts.map(d => (
                            <option key={d.district} value={d.district}>{d.district}</option>
                          ))}
                        </select>
                      </FormField>

                      <FormField
                        label={currentLang === 'ta' ? 'கிராமம் / நகரம் *' : 'Village / Town *'}
                        id="village"
                        helpText={!form.district ? (currentLang === 'ta' ? 'முதலில் மாவட்டத்தைத் தேர்வு செய்க' : 'Select district first') : (loadingVillages ? (currentLang === 'ta' ? 'ஏற்றப்படுகிறது...' : 'Loading villages...') : `${villages.length} ${currentLang === 'ta' ? 'கிராமங்கள் கிடைக்கின்றன' : 'villages available'}`)}
                      >
                        {villages.length > 0 ? (
                          <select
                            name="village"
                            className="kq-select"
                            value={form.village}
                            onChange={handleFormChange}
                            disabled={!form.district || loadingVillages}
                            required
                          >
                            <option value="">{currentLang === 'ta' ? '-- கிராமம் / நகரத்தைத் தேர்ந்தெடுக்கவும் --' : '-- Select Village / Town --'}</option>
                            {villages.map(v => (
                              <option key={v} value={v}>{v}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="text"
                            name="village"
                            className="kq-input"
                            value={form.village}
                            onChange={handleFormChange}
                            placeholder={currentLang === 'ta' ? 'உங்கள் கிராமத்தின் பெயர்' : 'Your village name'}
                            disabled={!form.district}
                            required
                          />
                        )}
                      </FormField>
                    </div>
                  </FormSection>
                )}

                {/* Step 3: Farm & Crop / Address Details */}
                {currentStep === 3 && (
                  <FormSection
                    title={currentLang === 'ta' ? '3. பண்ணை & பயிர் / முகவரி விவரங்கள்' : '3. Farm & Crop / Address Details'}
                    description={currentLang === 'ta' ? 'வட்டம், ஊராட்சி மற்றும் பயிர் விவரங்களை உள்ளிடவும்' : 'Specify block, panchayat and farm crop information'}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                      <FormField
                        label={currentLang === 'ta' ? 'வட்டம் / பிளாக் (Block) *' : 'Block / Taluk *'}
                        id="block"
                        helpText={!form.district ? (currentLang === 'ta' ? 'முதலில் மாவட்டத்தைத் தேர்வு செய்க' : 'Select district first') : (loadingBlocks ? (currentLang === 'ta' ? 'ஏற்றப்படுகிறது...' : 'Loading blocks...') : `${blocks.length} ${currentLang === 'ta' ? 'வட்டங்கள்' : 'blocks available'}`)}
                      >
                        <select
                          name="block"
                          className="kq-select"
                          value={form.block}
                          onChange={handleBlockChange}
                          disabled={!form.district || loadingBlocks}
                          required
                        >
                          <option value="">{currentLang === 'ta' ? '-- வட்டம் / பிளாக்கைத் தேர்ந்தெடுக்கவும் --' : '-- Select Block / Taluk --'}</option>
                          {blocks.map(b => (
                            <option key={b} value={b}>{b}</option>
                          ))}
                        </select>
                      </FormField>

                      <FormField
                        label={currentLang === 'ta' ? 'ஊராட்சி (Panchayat) *' : 'Panchayat *'}
                        id="panchayat"
                        helpText={!form.block ? (currentLang === 'ta' ? 'முதலில் பிளாக்கைத் தேர்வு செய்க' : 'Select block first') : (loadingPanchayats ? (currentLang === 'ta' ? 'ஏற்றப்படுகிறது...' : 'Loading panchayats...') : `${panchayats.length} ${currentLang === 'ta' ? 'ஊராட்சிகள் கிடைக்கின்றன' : 'panchayats available'}`)}
                      >
                        {panchayats.length > 0 ? (
                          <select
                            name="panchayat"
                            className="kq-select"
                            value={form.panchayat}
                            onChange={handleFormChange}
                            disabled={!form.block || loadingPanchayats}
                            required
                          >
                            <option value="">{currentLang === 'ta' ? '-- ஊராட்சியைத் தேர்ந்தெடுக்கவும் --' : '-- Select Panchayat --'}</option>
                            {panchayats.map(p => (
                              <option key={p} value={p}>{p}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="text"
                            name="panchayat"
                            className="kq-input"
                            value={form.panchayat}
                            onChange={handleFormChange}
                            placeholder={currentLang === 'ta' ? 'உங்கள் ஊராட்சியின் பெயரை உள்ளிடவும்' : 'Enter panchayat name'}
                            disabled={!form.block}
                            required
                          />
                        )}
                      </FormField>

                      <FormField label={currentLang === 'ta' ? 'நில அளவு (ஏக்கர்) *' : 'Land Size (Acres) *'} id="land">
                        <input
                          type="number"
                          step="0.5"
                          name="land_holding_acres"
                          className="kq-input"
                          value={form.land_holding_acres}
                          onChange={handleFormChange}
                          placeholder="2.5"
                          required
                        />
                      </FormField>

                      <FormField label={currentLang === 'ta' ? 'முதன்மை பயிர் *' : 'Primary Crop *'} id="crop">
                        <select
                          name="primary_crop"
                          className="kq-select"
                          value={form.primary_crop}
                          onChange={handleFormChange}
                          required
                        >
                          <option value="Paddy (Common)">{currentLang === 'ta' ? 'நெல் (பொது ரகம் - MSP ₹2,275)' : 'Paddy (Common) - MSP ₹2,275'}</option>
                          <option value="Paddy (Grade A)">{currentLang === 'ta' ? 'நெல் (கிரேடு ஏ - MSP ₹2,320)' : 'Paddy (Grade A) - MSP ₹2,320'}</option>
                          <option value="Maize">{currentLang === 'ta' ? 'மக்காச்சோளம்' : 'Maize'}</option>
                        </select>
                      </FormField>
                    </div>
                  </FormSection>
                )}

                {/* Step 4: Review & Submit */}
                {currentStep === 4 && (
                  <FormSection title={currentLang === 'ta' ? '4. விவரங்களை சரிபார்க்கவும்' : '4. Review & Confirm'}>
                    <div style={{ background: 'var(--kq-bg-subtle)', padding: 16, borderRadius: 'var(--kq-radius-md)', display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13.5 }}>
                      <div><strong>{currentLang === 'ta' ? 'பெயர்:' : 'Name:'}</strong> {form.name}</div>
                      <div><strong>{currentLang === 'ta' ? 'மொபைல்:' : 'Mobile:'}</strong> {form.phone}</div>
                      <div><strong>{currentLang === 'ta' ? 'மாவட்டம்:' : 'District:'}</strong> {form.district}</div>
                      <div><strong>{currentLang === 'ta' ? 'கிராமம்:' : 'Village:'}</strong> {form.village}</div>
                      <div><strong>{currentLang === 'ta' ? 'வட்டம் / பிளாக்:' : 'Block:'}</strong> {form.block || '-'}</div>
                      <div><strong>{currentLang === 'ta' ? 'ஊராட்சி:' : 'Panchayat:'}</strong> {form.panchayat || '-'}</div>
                      <div><strong>{currentLang === 'ta' ? 'பயிர்:' : 'Crop:'}</strong> {form.primary_crop} ({form.land_holding_acres} {currentLang === 'ta' ? 'ஏக்கர்' : 'acres'})</div>
                    </div>
                  </FormSection>
                )}

                {/* Wizard Buttons */}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24, gap: 12 }}>
                  {currentStep > 1 ? (
                    <SecondaryButton onClick={handlePrevStep} style={{ padding: '8px 18px', fontSize: 13 }}>
                      ← {currentLang === 'ta' ? 'முந்தையது' : 'Back'}
                    </SecondaryButton>
                  ) : <div />}

                  {currentStep < 4 ? (
                    <PrimaryButton onClick={handleNextStep} style={{ padding: '8px 24px', fontSize: 13 }}>
                      {currentLang === 'ta' ? 'அடுத்தது →' : 'Next →'}
                    </PrimaryButton>
                  ) : (
                    <PrimaryButton onClick={handleRegisterSubmit} loading={submitting} style={{ padding: '8px 24px', fontSize: 13 }}>
                      {currentLang === 'ta' ? 'உறுதி செய்து பதிவு செய்க' : 'Submit & Register'}
                    </PrimaryButton>
                  )}
                </div>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* CSC ASSISTED SERVICE MODAL */}
      <Modal
        isOpen={showCscModal}
        onClose={() => setShowCscModal(false)}
        title={currentLang === 'ta' ? 'கிராம சேவை மையம் (CSC) உதவி' : 'CSC Assisted Service & Centres'}
        subtitle={
          currentLang === 'ta'
            ? 'ஸ்மார்ட்போன் இல்லாத உழவர்களுக்கான நேரடி முன்பதிவு மற்றும் உதவி'
            : 'In-person registration & booking assistance for farmers without smartphones'
        }
        maxWidth={520}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Toll free helpline highlight */}
          <div style={{
            background: 'var(--kq-green-50)',
            border: '1.5px solid var(--kq-green-300)',
            borderRadius: 'var(--kq-radius-md)',
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 10
          }}>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--kq-green-900)' }}>
                📞 {currentLang === 'ta' ? 'கட்டணமில்லா உழவர் உதவி எண்' : 'Toll-Free Farmer Helpline'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--kq-green-800)', marginTop: 2 }}>
                1800-425-4444 (24x7 IVR & Operator Support)
              </div>
            </div>
            <a
              href="tel:18004254444"
              className="kq-btn kq-btn-primary"
              style={{ padding: '6px 14px', fontSize: 12.5, textDecoration: 'none' }}
            >
              {currentLang === 'ta' ? 'அழைக்க' : 'Call 1800-425-4444'}
            </a>
          </div>

          {/* District Selector */}
          <FormField
            label={currentLang === 'ta' ? 'மாவட்டம்' : 'Select District'}
            helpText={currentLang === 'ta' ? 'அருகிலுள்ள மையங்களை காண மாவட்டத்தைத் தேர்ந்தெடுக்கவும்' : 'Filter centres by district'}
          >
            <select
              className="kq-select"
              value={cscDistrict}
              onChange={(e) => setCscDistrict(e.target.value)}
              style={{ height: 42, fontSize: 14, fontWeight: 600 }}
            >
              {districts.map(d => {
                const distName = typeof d === 'string' ? d : (d.district || d.name || '');
                return (
                  <option key={distName} value={distName}>
                    {distName}
                  </option>
                );
              })}
            </select>
          </FormField>

          {/* Centres List */}
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--kq-text-secondary)', marginBottom: 8 }}>
              {currentLang === 'ta' ? `${cscDistrict} கொள்முதல் / உதவி மையங்கள்:` : `Available Procurement & Assisted Centres in ${cscDistrict}:`}
            </div>

            {loadingCscCentres ? (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--kq-text-muted)', fontSize: 13 }}>
                <Icon name="refresh-cw" size={18} className="kq-spin" />
                <div style={{ marginTop: 6 }}>{currentLang === 'ta' ? 'மையங்கள் ஏற்றப்படுகின்றன...' : 'Loading centres...'}</div>
              </div>
            ) : cscCentres.length === 0 ? (
              <div style={{ padding: 18, background: 'var(--kq-bg-subtle)', borderRadius: 'var(--kq-radius-md)', textAlign: 'center', fontSize: 13, color: 'var(--kq-text-muted)' }}>
                {currentLang === 'ta' ? 'இந்த மாவட்டத்தில் மையங்கள் எதுவும் கிடைக்கவில்லை.' : 'No centres found for this district.'}
              </div>
            ) : (
              <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, paddingRight: 4 }}>
                {cscCentres.map(c => (
                  <div
                    key={c.centre_id}
                    style={{
                      padding: '10px 12px',
                      background: 'var(--kq-bg-subtle)',
                      borderRadius: 'var(--kq-radius-sm)',
                      border: '1px solid var(--kq-border-light)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 10
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--kq-text-primary)' }}>
                        {c.centre_name}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--kq-text-muted)', marginTop: 2 }}>
                        {c.address || c.village_town || c.district} • ID: <code>{c.centre_id}</code>
                      </div>
                    </div>
                    <span style={{
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 10,
                      backgroundColor: c.operational_status === 'Open' ? '#dcfce7' : '#f1f5f9',
                      color: c.operational_status === 'Open' ? '#166534' : '#64748b'
                    }}>
                      {c.operational_status || 'Open'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Operator Portal Link */}
          <div style={{
            marginTop: 6,
            paddingTop: 10,
            borderTop: '1px solid var(--kq-border-light)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <div style={{ fontSize: 11.5, color: 'var(--kq-text-muted)' }}>
              {currentLang === 'ta' ? 'CSC ஆபரேட்டரா?' : 'Are you a CSC Operator?'}
            </div>
            <Link
              to="/csc"
              onClick={() => setShowCscModal(false)}
              style={{ fontSize: 12, fontWeight: 700, color: 'var(--kq-green-800)', textDecoration: 'none' }}
            >
              {currentLang === 'ta' ? 'ஆபரேட்டர் உள்நுழைவு →' : 'Operator Login →'}
            </Link>
          </div>
        </div>
      </Modal>

    </div>
  );
}