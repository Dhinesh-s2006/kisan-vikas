import React from 'react';
import { Icon } from './Icons';

export function FilterBar({ children, activeCount = 0, onReset, className = '', style = {} }) {
  return (
    <div
      className={`kq-filter-bar ${className}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 10,
        padding: '10px 14px',
        backgroundColor: 'var(--kq-bg-surface)',
        border: '1px solid var(--kq-border-subtle)',
        borderRadius: 'var(--kq-radius-md)',
        marginBottom: 12,
        ...style
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        color: 'var(--kq-text-secondary)',
        fontSize: 13,
        fontWeight: 600,
        marginRight: 4
      }}>
        <Icon name="filter" size={15} color="var(--kq-green-700)" />
        <span>Filters</span>
        {activeCount > 0 && (
          <span style={{
            backgroundColor: 'var(--kq-green-700)',
            color: '#fff',
            fontSize: 11,
            fontWeight: 700,
            padding: '1px 6px',
            borderRadius: 10
          }}>
            {activeCount}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, flex: 1 }}>
        {children}
      </div>

      {activeCount > 0 && onReset && (
        <button
          type="button"
          onClick={onReset}
          className="kq-btn kq-btn-secondary"
          style={{
            height: 32,
            padding: '4px 10px',
            fontSize: 12,
            minHeight: 'auto'
          }}
        >
          <Icon name="x" size={12} />
          <span>Reset all</span>
        </button>
      )}
    </div>
  );
}
