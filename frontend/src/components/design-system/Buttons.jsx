import React from 'react';
import { Icon } from './Icons';

export function PrimaryButton({ children, icon, loading, disabled, className = '', ...props }) {
  return (
    <button
      type="button"
      className={`kq-btn kq-btn-primary ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <Icon name="refresh-cw" size={16} className="kq-spin" style={{ animation: 'kq-spin 1s linear infinite' }} />
      ) : icon ? (
        <Icon name={icon} size={16} />
      ) : null}
      <span>{children}</span>
    </button>
  );
}

export function SecondaryButton({ children, icon, loading, disabled, className = '', ...props }) {
  return (
    <button
      type="button"
      className={`kq-btn kq-btn-secondary ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <Icon name="refresh-cw" size={16} style={{ animation: 'kq-spin 1s linear infinite' }} />
      ) : icon ? (
        <Icon name={icon} size={16} />
      ) : null}
      <span>{children}</span>
    </button>
  );
}

export function DangerButton({ children, icon, loading, disabled, className = '', ...props }) {
  return (
    <button
      type="button"
      className={`kq-btn kq-btn-danger ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <Icon name="refresh-cw" size={16} style={{ animation: 'kq-spin 1s linear infinite' }} />
      ) : icon ? (
        <Icon name={icon} size={16} />
      ) : null}
      <span>{children}</span>
    </button>
  );
}

export function GhostButton({ children, icon, loading, disabled, className = '', ...props }) {
  return (
    <button
      type="button"
      className={`kq-btn kq-btn-ghost ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <Icon name="refresh-cw" size={16} style={{ animation: 'kq-spin 1s linear infinite' }} />
      ) : icon ? (
        <Icon name={icon} size={16} />
      ) : null}
      <span>{children}</span>
    </button>
  );
}


