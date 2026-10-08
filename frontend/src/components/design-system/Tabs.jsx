import React from 'react';
import { Icon } from './Icons';

export function Tabs({ items = [], activeTab, onChange, className = '', style = {} }) {
  return (
    <div
      role="tablist"
      className={`kq-tabs ${className}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        borderBottom: '2px solid var(--kq-border-subtle)',
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
        marginBottom: 18,
        ...style
      }}
    >
      {items.map(tab => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange && onChange(tab.id)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 16px',
              fontSize: 14,
              fontWeight: isActive ? 600 : 500,
              color: isActive ? 'var(--kq-green-700)' : 'var(--kq-text-muted)',
              background: 'none',
              border: 'none',
              borderBottom: isActive ? '2px solid var(--kq-green-700)' : '2px solid transparent',
              marginBottom: -2,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'color 0.15s ease, border-color 0.15s ease'
            }}
          >
            {tab.icon && <Icon name={tab.icon} size={16} />}
            <span>{tab.label}</span>
            {tab.badge !== undefined && tab.badge !== null && (
              <span style={{
                backgroundColor: isActive ? 'var(--kq-green-100)' : 'var(--kq-bg-subtle)',
                color: isActive ? 'var(--kq-green-800)' : 'var(--kq-text-secondary)',
                fontSize: 11,
                fontWeight: 700,
                padding: '1px 6px',
                borderRadius: 10
              }}>
                {tab.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
