import React from 'react';
import { Icon } from './Icons';

export function StatusBadge({ status = '', variant, size = 'normal', showIcon = true, className = '', ...props }) {
  const normStatus = (status || '').toString().trim();
  const lower = normStatus.toLowerCase();

  let resolvedVariant = variant || 'neutral';
  let iconName = 'info';

  // Semantic resolution
  if (
    lower === 'confirmed' ||
    lower === 'procured' ||
    lower === 'payment completed' ||
    lower === 'completed' ||
    lower === 'resolved' ||
    lower === 'verified_resolved' ||
    lower === 'normal' ||
    lower === 'open' ||
    lower === 'active' ||
    lower === 'accepted' ||
    lower === 'protected'
  ) {
    resolvedVariant = 'positive';
    iconName = 'check-circle';
  } else if (
    lower === 'on the way' ||
    lower === 'checked-in' ||
    lower === 'grading' ||
    lower === 'weighing' ||
    lower === 'payment pending' ||
    lower === 'slow' ||
    lower === 'under_investigation' ||
    lower === 'pending' ||
    lower === 'awaiting_farmer_confirmation' ||
    lower === 'awaiting confirmation'
  ) {
    resolvedVariant = 'warning';
    iconName = lower === 'on the way' ? 'truck' : 'clock';
  } else if (
    lower === 'paused' ||
    lower === 'critical' ||
    lower === 'congested' ||
    lower === 'cancelled' ||
    lower === 'rejected' ||
    lower === 'no-show' ||
    lower === 'escalated' ||
    lower === 'disrupted' ||
    lower === 'reopened'
  ) {
    resolvedVariant = 'danger';
    iconName = lower === 'reopened' ? 'refresh-cw' : 'alert-triangle';
  } else if (
    lower === 'booked' ||
    lower === 'info' ||
    lower === 'high priority'
  ) {
    resolvedVariant = 'info';
    iconName = 'calendar';
  } else {
    resolvedVariant = 'neutral';
    iconName = 'info';
  }

  const isSmall = size === 'small';

  return (
    <span
      className={`kq-badge kq-badge-${resolvedVariant} ${className}`}
      style={{
        fontSize: isSmall ? '11px' : '12px',
        padding: isSmall ? '2px 6px' : '3px 8px'
      }}
      {...props}
    >
      {showIcon && <Icon name={iconName} size={isSmall ? 12 : 13} />}
      <span>{normStatus || 'Unknown'}</span>
    </span>
  );
}
