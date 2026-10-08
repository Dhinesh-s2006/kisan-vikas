import React from 'react';

export function Card({ children, title, subtitle, headerAction, footer, className = '', style = {}, ...props }) {
  return (
    <div className={`kq-card ${className}`} style={style} {...props}>
      {(title || subtitle || headerAction) && (
        <div style={{
          padding: '14px 18px',
          borderBottom: '1px solid var(--kq-border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap'
        }}>
          <div>
            {title && <h3 className="kq-title-card">{title}</h3>}
            {subtitle && <p className="kq-text-muted" style={{ marginTop: 2 }}>{subtitle}</p>}
          </div>
          {headerAction && <div>{headerAction}</div>}
        </div>
      )}
      <div style={{ padding: '16px 18px' }}>
        {children}
      </div>
      {footer && (
        <div style={{
          padding: '12px 18px',
          backgroundColor: 'var(--kq-bg-subtle)',
          borderTop: '1px solid var(--kq-border-subtle)',
          borderBottomLeftRadius: 'var(--kq-radius-md)',
          borderBottomRightRadius: 'var(--kq-radius-md)'
        }}>
          {footer}
        </div>
      )}
    </div>
  );
}
