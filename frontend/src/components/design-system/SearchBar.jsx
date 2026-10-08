import React from 'react';
import { Icon } from './Icons';

export function SearchBar({ value, onChange, onClear, placeholder = 'Search by keyword...', className = '', style = {}, autoFocus = false, ...props }) {
  return (
    <div
      className={`kq-search-bar ${className}`}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        width: '100%',
        maxWidth: 360,
        ...style
      }}
    >
      <div style={{
        position: 'absolute',
        left: 10,
        color: 'var(--kq-text-muted)',
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'center'
      }}>
        <Icon name="search" size={16} />
      </div>
      <input
        type="text"
        className="kq-input"
        value={value}
        onChange={e => onChange && onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          paddingLeft: 34,
          paddingRight: value ? 32 : 12,
          height: 36
        }}
        autoFocus={autoFocus}
        {...props}
      />
      {value && onClear && (
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear search"
          style={{
            position: 'absolute',
            right: 8,
            background: 'none',
            border: 'none',
            color: 'var(--kq-text-muted)',
            cursor: 'pointer',
            padding: 4,
            display: 'flex',
            alignItems: 'center'
          }}
        >
          <Icon name="x" size={14} />
        </button>
      )}
    </div>
  );
}
