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
        borderBottom: '1px solid #e5e7eb',
        position: 'sticky',
        top: 0,
        zIndex: 100
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: '0 auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 24px',
          minHeight: 64,
          boxSizing: 'border-box'
        }}
      >
        {/* Brand: Logo + KISAN VIKAS ONLY */}
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
            boxShadow: 'var(--kq-shadow-sm)',
            flexShrink: 0
          }}>
            <Icon name="wheat" size={22} />
          </div>
          <span style={{
            fontSize: 19,
            fontWeight: 800,
            letterSpacing: '0.03em',
            color: '#14532d',
            lineHeight: 1
          }}>
            KISAN VIKAS
          </span>
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
