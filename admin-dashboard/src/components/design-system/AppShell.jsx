import React from 'react';
import { Header } from './Header';
import { RoleHeader } from './RoleHeader';
import { KisanNatureBackground } from './KisanNatureBackground';

export function AppShell({
  children,
  roleHeaderProps,
  navContent,
  lang,
  onLangToggle,
  rightHeaderContent,
  noContainer = false,
  className = '',
  style = {}
}) {
  return (
    <div
      className={`kq-app-shell ${className}`}
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'transparent',
        position: 'relative',
        ...style
      }}
    >
      {/* Skip to content link for keyboard accessibility */}
      <a href="#main-content" className="kq-skip-link">
        Skip to main content
      </a>

      {/* Main Public Service Header */}
      <Header
        lang={lang}
        onLangToggle={onLangToggle}
        rightContent={rightHeaderContent}
      />

      {/* Contextual Role Header if supplied */}
      {roleHeaderProps && <RoleHeader {...roleHeaderProps} />}

      {/* Role Navigation bar if supplied */}
      {navContent}

      {/* Main Content Area */}
      <main
        id="main-content"
        tabIndex="-1"
        style={{
          flex: 1,
          padding: '24px 0 40px 0',
          outline: 'none',
          position: 'relative',
          zIndex: 1
        }}
      >
        {noContainer ? children : <div className="kq-container">{children}</div>}
      </main>

      {/* Persistent Subtle Nature Background Watermark */}
      <KisanNatureBackground />

      {/* Public Service Footer */}
      <footer
        style={{
          backgroundColor: '#ffffff',
          borderTop: '1px solid var(--kq-border-subtle)',
          padding: '20px 16px',
          marginTop: 'auto',
          fontSize: 13,
          color: 'var(--kq-text-muted)',
          textAlign: 'center',
          position: 'relative',
          zIndex: 1
        }}
      >
        <div className="kq-container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <div style={{ fontWeight: 600, color: 'var(--kq-text-secondary)' }}>
            KISAN VIKAS — Uzhavarsethu Digital Agricultural Procurement Platform
          </div>
          <div>
            Built for transparent queue management, verified weighments, anti-disruption fairness, and instant direct benefit settlements.
          </div>
          <div style={{ fontSize: 12, color: 'var(--kq-text-muted)', marginTop: 4 }}>
            Equal Access & Operational Integrity for All Farmers • WCAG 2.2 AA Compliant
          </div>
        </div>
      </footer>
    </div>
  );
}

