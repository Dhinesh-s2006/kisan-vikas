import React from 'react';
import { Modal } from './Modal';
import { PrimaryButton, SecondaryButton, DangerButton } from './Buttons';
import { Icon } from './Icons';

export function ConfirmationDialog({
  isOpen,
  onClose,
  onConfirm,
  title = 'Confirm Action',
  message = 'Are you sure you want to proceed with this action?',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  isDanger = false,
  loading = false
}) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      maxWidth={460}
      footer={
        <>
          <SecondaryButton onClick={onClose} disabled={loading}>
            {cancelLabel}
          </SecondaryButton>
          {isDanger ? (
            <DangerButton onClick={onConfirm} loading={loading}>
              {confirmLabel}
            </DangerButton>
          ) : (
            <PrimaryButton onClick={onConfirm} loading={loading}>
              {confirmLabel}
            </PrimaryButton>
          )}
        </>
      }
    >
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        <div style={{
          color: isDanger ? 'var(--kq-danger-btn)' : 'var(--kq-green-700)',
          backgroundColor: isDanger ? 'var(--kq-danger-bg)' : 'var(--kq-green-50)',
          padding: 8,
          borderRadius: '50%',
          flexShrink: 0
        }}>
          <Icon name={isDanger ? 'alert-triangle' : 'info'} size={24} />
        </div>
        <p className="kq-text-body" style={{ margin: 0 }}>
          {message}
        </p>
      </div>
    </Modal>
  );
}

export function Toast({
  message,
  type = 'info',
  onClose,
  actionLabel,
  onAction,
  className = '',
  style = {}
}) {
  if (!message) return null;

  let iconName = 'info';
  let borderLeft = 'var(--kq-info-text)';
  if (type === 'success' || type === 'positive') {
    iconName = 'check-circle';
    borderLeft = 'var(--kq-green-700)';
  } else if (type === 'warning') {
    iconName = 'alert-triangle';
    borderLeft = 'var(--kq-warning-text)';
  } else if (type === 'error' || type === 'danger') {
    iconName = 'alert-circle';
    borderLeft = 'var(--kq-danger-btn)';
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={`kq-toast ${className}`}
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        zIndex: 9999,
        backgroundColor: '#ffffff',
        border: '1px solid var(--kq-border-subtle)',
        borderLeft: `4px solid ${borderLeft}`,
        borderRadius: 'var(--kq-radius-md)',
        boxShadow: 'var(--kq-shadow-lg)',
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        maxWidth: 420,
        fontSize: 13.5,
        color: 'var(--kq-text-primary)',
        ...style
      }}
    >
      <Icon name={iconName} size={18} color={borderLeft} />
      <div style={{ flex: 1 }}>{message}</div>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--kq-green-700)',
            fontWeight: 700,
            cursor: 'pointer',
            padding: '2px 6px'
          }}
        >
          {actionLabel}
        </button>
      )}
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close notification"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--kq-text-muted)',
            padding: 2
          }}
        >
          <Icon name="x" size={14} />
        </button>
      )}
    </div>
  );
}

export function Tooltip({ text, children, position = 'top' }) {
  const [visible, setVisible] = React.useState(false);

  return (
    <div
      style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {children}
      {visible && text && (
        <div
          role="tooltip"
          style={{
            position: 'absolute',
            bottom: position === 'top' ? 'calc(100% + 6px)' : undefined,
            top: position === 'bottom' ? 'calc(100% + 6px)' : undefined,
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: 'var(--kq-text-primary)',
            color: '#ffffff',
            padding: '4px 8px',
            borderRadius: 'var(--kq-radius-xs)',
            fontSize: 11.5,
            whiteSpace: 'nowrap',
            zIndex: 9999,
            pointerEvents: 'none',
            boxShadow: 'var(--kq-shadow-sm)'
          }}
        >
          {text}
        </div>
      )}
    </div>
  );
}
