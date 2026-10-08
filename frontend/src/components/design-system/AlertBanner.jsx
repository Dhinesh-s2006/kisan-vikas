import React from 'react';
import { Icon } from './Icons';

export function AlertBanner({ type = 'info', title, message, children, action, onDismiss, className = '', style = {}, ...props }) {
  let iconName = 'info';
  let badgeClass = 'kq-badge-info';
  let borderLeftColor = 'var(--kq-info-border)';

  if (type === 'warning') {
    iconName = 'alert-triangle';
    badgeClass = 'kq-badge-warning';
    borderLeftColor = 'var(--kq-warning-text)';
  } else if (type === 'danger' || type === 'error') {
    iconName = 'alert-circle';
    badgeClass = 'kq-badge-danger';
    borderLeftColor = 'var(--kq-danger-text)';
  } else if (type === 'positive' || type === 'success') {
    iconName = 'check-circle';
    badgeClass = 'kq-badge-positive';
    borderLeftColor = 'var(--kq-green-700)';
  }

  return (
    <div
      className={`kq-alert ${badgeClass} ${className}`}
      role="alert"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        padding: '12px 16px',
        borderRadius: 'var(--kq-radius-md)',
        borderLeft: `4px solid ${borderLeftColor}`,
        boxShadow: 'var(--kq-shadow-xs)',
        ...style
      }}
      {...props}
    >
      <div style={{ paddingTop: 2 }}>
        <Icon name={iconName} size={18} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {title && <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>{title}</div>}
        <div style={{ fontSize: 13.5, lineHeight: 1.45 }}>
          {message || children}
        </div>
      </div>
      {action && <div style={{ alignSelf: 'center' }}>{action}</div>}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss alert"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 4,
            color: 'inherit',
            opacity: 0.7
          }}
        >
          <Icon name="x" size={16} />
        </button>
      )}
    </div>
  );
}
