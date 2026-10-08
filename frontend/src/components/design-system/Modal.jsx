import React, { useEffect } from 'react';
import { Icon } from './Icons';

export function Modal({
  isOpen = false,
  onClose,
  title,
  subtitle,
  children,
  footer,
  maxWidth = 540,
  className = '',
  ...props
}) {
  // ESC key handler and focus trap behavior
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
      aria-labelledby="modal-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9990,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        backgroundColor: 'rgba(28, 25, 23, 0.65)',
        backdropFilter: 'blur(2px)'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && onClose) onClose();
      }}
    >
      <div
        className={`kq-card ${className}`}
        style={{
          width: '100%',
          maxWidth,
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#ffffff',
          borderRadius: 'var(--kq-radius-lg)',
          boxShadow: 'var(--kq-shadow-lg)',
          overflow: 'hidden',
          animation: 'kq-modal-in 0.18s ease-out'
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
            <h3 id="modal-title" className="kq-title-card" style={{ fontSize: 18 }}>
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
              aria-label="Close dialog"
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

        {/* Content Body */}
        <div style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div
            style={{
              padding: '12px 20px',
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
