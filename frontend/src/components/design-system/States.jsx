import React from 'react';
import { Icon } from './Icons';

export function EmptyState({ icon = 'info', title = 'No records found', description, action, className = '', style = {} }) {
  return (
    <div
      className={`kq-empty-state ${className}`}
      style={{
        padding: '36px 20px',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'var(--kq-bg-subtle)',
        borderRadius: 'var(--kq-radius-md)',
        border: '1px dashed var(--kq-border-medium)',
        ...style
      }}
    >
      <div style={{
        color: 'var(--kq-text-muted)',
        backgroundColor: 'var(--kq-bg-surface)',
        padding: 12,
        borderRadius: '50%',
        marginBottom: 12,
        boxShadow: 'var(--kq-shadow-xs)'
      }}>
        <Icon name={icon} size={28} />
      </div>
      <h4 style={{ margin: '0 0 6px 0', fontSize: 16, fontWeight: 600, color: 'var(--kq-text-primary)' }}>
        {title}
      </h4>
      {description && (
        <p className="kq-text-muted" style={{ maxWidth: 440, margin: '0 0 16px 0', fontSize: 13.5 }}>
          {description}
        </p>
      )}
      {action && <div>{action}</div>}
    </div>
  );
}

export function LoadingState({ message = 'Loading details...', minHeight = 160 }) {
  return (
    <div
      style={{
        minHeight,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        color: 'var(--kq-text-muted)'
      }}
      aria-busy="true"
      aria-live="polite"
    >
      <Icon name="refresh-cw" size={24} className="kq-spin" style={{ color: 'var(--kq-green-700)' }} />
      <span style={{ fontSize: 14, fontWeight: 500 }}>{message}</span>
    </div>
  );
}

export function ErrorState({ title = 'Unable to load data', error, onRetry, className = '' }) {
  return (
    <div
      className={`kq-error-state ${className}`}
      style={{
        padding: '24px',
        backgroundColor: 'var(--kq-danger-bg)',
        border: '1px solid var(--kq-danger-border)',
        borderRadius: 'var(--kq-radius-md)',
        textAlign: 'center',
        margin: '12px 0'
      }}
    >
      <div style={{ color: 'var(--kq-danger-text)', marginBottom: 8 }}>
        <Icon name="alert-triangle" size={32} />
      </div>
      <h4 style={{ margin: '0 0 6px 0', color: 'var(--kq-danger-text)', fontSize: 16, fontWeight: 600 }}>
        {title}
      </h4>
      {error && (
        <p style={{ margin: '0 0 14px 0', color: 'var(--kq-text-secondary)', fontSize: 13.5 }}>
          {typeof error === 'string' ? error : error.message || 'An unexpected error occurred.'}
        </p>
      )}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="kq-btn kq-btn-secondary"
          style={{ fontSize: 13, padding: '6px 12px' }}
        >
          <Icon name="refresh-cw" size={14} />
          <span>Retry Request</span>
        </button>
      )}
    </div>
  );
}
