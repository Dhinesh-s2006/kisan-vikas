import React from 'react';
import { Icon } from './Icons';

export function StatCard({
  label,
  title,
  value,
  subtext,
  subtitle,
  description,
  delta,
  deltaType = 'neutral',
  icon,
  statusColor,
  className = '',
  ...props
}) {
  const displayLabel = label || title || '';
  const displaySubtext = subtext || subtitle || description || '';

  const getDeltaBadgeStyle = () => {
    switch (deltaType) {
      case 'positive':
        return { bg: 'var(--kq-positive-bg)', text: 'var(--kq-positive-text)', border: 'var(--kq-positive-border)' };
      case 'negative':
      case 'danger':
        return { bg: 'var(--kq-danger-bg)', text: 'var(--kq-danger-text)', border: 'var(--kq-danger-border)' };
      case 'warning':
        return { bg: 'var(--kq-warning-bg)', text: 'var(--kq-warning-text)', border: 'var(--kq-warning-border)' };
      default:
        return { bg: 'var(--kq-bg-subtle)', text: 'var(--kq-text-secondary)', border: 'var(--kq-border-subtle)' };
    }
  };

  const deltaStyle = getDeltaBadgeStyle();

  return (
    <div
      className={`kq-card ${className}`}
      style={{
        padding: '16px 18px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        borderLeft: statusColor ? `4px solid ${statusColor}` : undefined
      }}
      {...props}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--kq-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
          {displayLabel}
        </span>
        {icon && (
          <div style={{
            color: 'var(--kq-green-700)',
            backgroundColor: 'var(--kq-green-50)',
            padding: 6,
            borderRadius: 'var(--kq-radius-sm)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <Icon name={icon} size={18} />
          </div>
        )}
      </div>

      <div style={{ margin: '10px 0 4px 0', display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span style={{ fontSize: 26, fontWeight: 700, color: 'var(--kq-text-primary)', lineHeight: 1.1 }}>
          {value}
        </span>
        {delta && (
          <span style={{
            fontSize: 12,
            fontWeight: 600,
            padding: '2px 6px',
            borderRadius: 'var(--kq-radius-xs)',
            backgroundColor: deltaStyle.bg,
            color: deltaStyle.text,
            border: `1px solid ${deltaStyle.border}`
          }}>
            {delta}
          </span>
        )}
      </div>

      {displaySubtext && (
        <span style={{ fontSize: 12, marginTop: 4, color: 'var(--kq-text-muted)' }}>
          {displaySubtext}
        </span>
      )}
    </div>
  );
}
