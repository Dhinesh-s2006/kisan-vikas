import React, { useEffect } from 'react';
import { Icon } from './Icons';

export function Drawer({
  isOpen = false,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = 460,
  position = 'right',
  className = '',
  ...props
}) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && onClose) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9990,
        display: 'flex',
        justifyContent: position === 'right' ? 'flex-end' : 'flex-start',
        backgroundColor: 'rgba(28, 25, 23, 0.55)',
        backdropFilter: 'blur(2px)'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && onClose) onClose();
      }}
    >
      <div
        className={`kq-drawer ${className}`}
        style={{
          width: '100%',
          maxWidth: width,
          height: '100%',
          backgroundColor: '#ffffff',
          boxShadow: 'var(--kq-shadow-lg)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animation: position === 'right' ? 'kq-slide-right 0.2s ease-out' : 'kq-slide-left 0.2s ease-out'
        }}
        {...props}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--kq-border-subtle)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12
          }}
        >
          <div>
            <h3 className="kq-title-card" style={{ fontSize: 17 }}>
              {title}
            </h3>
            {subtitle && (
              <p className="kq-text-muted" style={{ marginTop: 2 }}>
                {subtitle}
              </p>
            )}
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close panel"
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 4,
                color: 'var(--kq-text-muted)',
                borderRadius: 'var(--kq-radius-xs)',
                display: 'flex',
                alignItems: 'center'
              }}
            >
              <Icon name="x" size={18} />
            </button>
          )}
        </div>

        {/* Content */}
        <div style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div
            style={{
              padding: '14px 20px',
              backgroundColor: 'var(--kq-bg-subtle)',
              borderTop: '1px solid var(--kq-border-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: 10
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
