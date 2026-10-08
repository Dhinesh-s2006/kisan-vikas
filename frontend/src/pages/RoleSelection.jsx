import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AppShell, Icon } from '../components/design-system';

export default function RoleSelection() {
  const navigate = useNavigate();

  const openAdmin = () => {
    navigate('/admin');
  };

  const continueAsFarmer = () => {
    const role = localStorage.getItem('kisan_role');
    if (role && role !== 'FARMER') {
      localStorage.removeItem('kisan_token');
      localStorage.removeItem('kisan_role');
      localStorage.removeItem('kisan_district');
    }
    navigate('/farmer');
  };

  return (
    <AppShell hideFooter={true}>
      <div
        style={{
          position: 'relative',
          minHeight: 'calc(100vh - 65px)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          backgroundColor: 'transparent',
          overflow: 'hidden'
        }}
      >
        {/* Main Content Area */}
        <div
          style={{
            maxWidth: 1160,
            width: '100%',
            margin: '0 auto',
            padding: '48px 24px 32px 24px',
            position: 'relative',
            zIndex: 1,
            boxSizing: 'border-box'
          }}
        >
          {/* Main Hero: Centered */}
          <div style={{ textAlign: 'center', marginBottom: 52 }}>
            {/* Subtle horizontal green decorative line */}
            <div
              style={{
                width: 40,
                height: 3,
                backgroundColor: '#16a34a',
                borderRadius: 2,
                margin: '0 auto 16px auto'
              }}
              aria-hidden="true"
            />

            {/* Main Heading: Dark text for Empowering Farmers, Green for Strengthening Agriculture */}
            <h1
              style={{
                fontSize: 'clamp(22px, 3.8vw, 38px)',
                fontWeight: 800,
                letterSpacing: '-0.02em',
                lineHeight: 1.3,
                margin: 0,
                fontFamily: 'inherit',
                textAlign: 'center'
              }}
            >
              <span style={{ color: '#111827', display: 'inline-block' }}>Empowering Farmers,&nbsp;</span>
              <span style={{ color: '#15803d', display: 'inline-block' }}>Strengthening Agriculture</span>
            </h1>


          </div>

          {/* Exactly Four Role Cards */}
          <div className="kv-cards-grid">
            {/* Card 1: Farmer Portal */}
            <div className="kv-card">
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 10,
                  backgroundColor: '#f0fdf4',
                  border: '1px solid #dcfce7',
                  color: '#15803d',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 18
                }}
              >
                <Icon name="user" size={22} />
              </div>

              <h2
                style={{
                  fontSize: 17,
                  fontWeight: 700,
                  color: '#111827',
                  margin: '0 0 4px 0',
                  lineHeight: 1.3
                }}
              >
                Farmer Portal
              </h2>

              <p
                style={{
                  fontSize: 13,
                  color: '#6b7280',
                  margin: '0 0 28px 0',
                  fontWeight: 500
                }}
              >
                உழவர் தளம்
              </p>

              <button
                type="button"
                onClick={continueAsFarmer}
                className="kv-btn-primary"
              >
                Enter Farmer Portal
              </button>
            </div>

            {/* Card 2: Assisted Kiosk (CSC) */}
            <div className="kv-card">
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 10,
                  backgroundColor: '#f0fdf4',
                  border: '1px solid #dcfce7',
                  color: '#15803d',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 18
                }}
              >
                <Icon name="users" size={22} />
              </div>

              <h2
                style={{
                  fontSize: 17,
                  fontWeight: 700,
                  color: '#111827',
                  margin: '0 0 4px 0',
                  lineHeight: 1.3
                }}
              >
                Assisted Kiosk (CSC)
              </h2>

              <p
                style={{
                  fontSize: 13,
                  color: '#6b7280',
                  margin: '0 0 28px 0',
                  fontWeight: 500
                }}
              >
                உதவி சேவை மையம்
              </p>

              <button
                type="button"
                onClick={() => navigate('/assisted-kiosk')}
                className="kv-btn-secondary"
              >
                Open CSC Kiosk
              </button>
            </div>

            {/* Card 3: Centre Admin */}
            <div className="kv-card">
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 10,
                  backgroundColor: '#f0fdf4',
                  border: '1px solid #dcfce7',
                  color: '#15803d',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 18
                }}
              >
                <Icon name="building-2" size={22} />
              </div>

              <h2
                style={{
                  fontSize: 17,
                  fontWeight: 700,
                  color: '#111827',
                  margin: '0 0 4px 0',
                  lineHeight: 1.3
                }}
              >
                Centre Admin
              </h2>

              <p
                style={{
                  fontSize: 13,
                  color: '#6b7280',
                  margin: '0 0 28px 0',
                  fontWeight: 500
                }}
              >
                கொள்முதல் நிலைய நிர்வாகி
              </p>

              <button
                type="button"
                onClick={openAdmin}
                className="kv-btn-secondary"
              >
                Open Admin Portal
              </button>
            </div>

            {/* Card 4: District Command */}
            <div className="kv-card">
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 10,
                  backgroundColor: '#f0fdf4',
                  border: '1px solid #dcfce7',
                  color: '#15803d',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 18
                }}
              >
                <Icon name="map" size={22} />
              </div>

              <h2
                style={{
                  fontSize: 17,
                  fontWeight: 700,
                  color: '#111827',
                  margin: '0 0 4px 0',
                  lineHeight: 1.3
                }}
              >
                District Command
              </h2>

              <p
                style={{
                  fontSize: 13,
                  color: '#6b7280',
                  margin: '0 0 28px 0',
                  fontWeight: 500
                }}
              >
                மாவட்ட கண்காணிப்பு
              </p>

              <button
                type="button"
                onClick={() => navigate('/district-officer')}
                className="kv-btn-secondary"
              >
                Open Dashboard
              </button>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}