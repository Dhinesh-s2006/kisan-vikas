import React from 'react';
import { Icon } from './Icons';

/**
 * Standard Kisan Vikas Application Logo & Brand Component (Admin Dashboard).
 */
export function KisanLogo({
  size = 'md',
  subtext = null,
  showSubtext = false,
  className = '',
  style = {}
}) {
  const iconBoxSize = size === 'sm' ? 32 : size === 'lg' ? 44 : 38;
  const iconSize = size === 'sm' ? 18 : size === 'lg' ? 24 : 22;
  const titleSize = size === 'sm' ? 16 : size === 'lg' ? 22 : 19;

  return (
    <div
      className={`kisan-vikas-logo ${className}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: size === 'sm' ? 8 : 12,
        ...style
      }}
    >
      <div
        style={{
          width: iconBoxSize,
          height: iconBoxSize,
          borderRadius: 'var(--kq-radius-sm, 6px)',
          backgroundColor: 'var(--kq-green-700, #15803d)',
          color: '#ffffff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: 'var(--kq-shadow-sm, 0 1px 2px rgba(0,0,0,0.05))',
          flexShrink: 0
        }}
      >
        <Icon name="wheat" size={iconSize} color="#ffffff" />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <span
          style={{
            fontSize: titleSize,
            fontWeight: 800,
            letterSpacing: '0.03em',
            color: '#14532d',
            lineHeight: 1
          }}
        >
          KISAN VIKAS
        </span>
        {showSubtext && (
          <span style={{ fontSize: 10.5, color: 'var(--kq-text-muted, #6b7280)', fontWeight: 600, marginTop: 2 }}>
            {subtext || 'DPC Operations Control Panel'}
          </span>
        )}
      </div>
    </div>
  );
}

export default KisanLogo;
