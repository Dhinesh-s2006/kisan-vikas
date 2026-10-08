import React from 'react';
import { Icon } from './Icons';

export function Header({
  lang = 'en',
  onLangToggle,
  rightContent
}) {
  return (
    <header
      className="kq-header"
      style={{
        backgroundColor: '#ffffff',
        borderBottom: '1px solid var(--kq-border-subtle)',
        boxShadow: 'var(--kq-shadow-xs)',
        position: 'sticky',
        top: 0,
        zIndex: 100
      }}
    >
      {/* Top subtle tri-color accent bar for public service feel */}
      <div style={{ height: 3, display: 'flex', width: '100%' }}>
        <div style={{ flex: 1, backgroundColor: '#ea580c' }} /> {/* Saffron */}
        <div style={{ flex: 1, backgroundColor: '#ffffff', borderBottom: '1px solid #e5e7eb' }} /> {/* White */}
        <div style={{ flex: 1, backgroundColor: '#166534' }} /> {/* Green */}
      </div>

      <div className="kq-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', minHeight: 64 }}>
        {/* Brand */}
        <a
          href="/"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            textDecoration: 'none',
            color: 'inherit'
          }}
        >
          <div style={{
            width: 38,
            height: 38,
            borderRadius: 'var(--kq-radius-sm)',
            backgroundColor: 'var(--kq-green-700)',
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: 'var(--kq-shadow-sm)'
          }}>
            <Icon name="wheat" size={22} />
          </div>
          <div>
            <div style={{
              fontSize: 17,
              fontWeight: 800,
              letterSpacing: 0.5,
              color: 'var(--kq-green-900)',
              lineHeight: 1.15
            }}>
              KISAN VIKAS
            </div>
            <div style={{
              fontSize: 12,
              color: 'var(--kq-text-muted)',
              fontWeight: 500,
              letterSpacing: 0.2
            }}>
              Uzhavarsethu — Digital Agricultural Procurement Platform
            </div>
          </div>
        </a>

        {/* Right actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {onLangToggle && (
            <button
              type="button"
              onClick={onLangToggle}
              className="kq-btn kq-btn-secondary"
              style={{
                height: 32,
                minHeight: 'auto',
                padding: '4px 10px',
                fontSize: 12,
                fontWeight: 600
              }}
              title="Toggle Language / மொழி மாற்றுக"
            >
              {lang === 'ta' ? 'English' : 'தமிழ்'}
            </button>
          )}

          {rightContent}
        </div>
      </div>
    </header>
  );
}
