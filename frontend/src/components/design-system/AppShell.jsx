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
  hideFooter = false,
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
          display: 'flex',
          flexDirection: 'column',
          outline: 'none',
          position: 'relative',
          zIndex: 1
        }}
      >
        {children}
      </main>


      {!hideFooter && (
        <footer
          style={{
            backgroundColor: '#ffffff',
            borderTop: '1px solid #f3f4f6',
            padding: '16px 24px',
            marginTop: 'auto',
            fontSize: 12,
            color: '#6b7280',
            textAlign: 'center',
            position: 'relative',
            zIndex: 1
          }}
        >
          <div style={{ maxWidth: 1200, margin: '0 auto' }}>
            <span>KISAN VIKAS • Agricultural Digital Service Platform</span>
          </div>
        </footer>
      )}
    </div>
  );
}

