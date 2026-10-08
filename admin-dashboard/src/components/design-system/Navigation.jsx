import React, { useState } from 'react';
import { Icon } from './Icons';

export function Sidebar({
  items = [],
  activeItem,
  onSelect,
  collapsed = false,
  onToggleCollapse,
  className = '',
  style = {}
}) {
  return (
    <aside
      className={`kq-sidebar ${className}`}
      style={{
        width: collapsed ? 64 : 240,
        backgroundColor: '#ffffff',
        borderRight: '1px solid var(--kq-border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        transition: 'width 0.2s ease',
        flexShrink: 0,
        ...style
      }}
    >
      <div style={{ padding: '12px', display: 'flex', justifyContent: collapsed ? 'center' : 'flex-end' }}>
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--kq-text-muted)',
              padding: 4
            }}
          >
            <Icon name={collapsed ? 'chevron-right' : 'chevron-left'} size={18} />
          </button>
        )}
      </div>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '0 8px', flex: 1 }}>
        {items.map(item => {
          const isActive = activeItem === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect && onSelect(item.id)}
              title={collapsed ? item.label : undefined}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                padding: '10px 12px',
                borderRadius: 'var(--kq-radius-sm)',
                border: 'none',
                backgroundColor: isActive ? 'var(--kq-green-50)' : 'transparent',
                color: isActive ? 'var(--kq-green-800)' : 'var(--kq-text-secondary)',
                fontWeight: isActive ? 600 : 500,
                fontSize: 13.5,
                cursor: 'pointer',
                textAlign: 'left',
                justifyContent: collapsed ? 'center' : 'flex-start',
                transition: 'background-color 0.15s ease, color 0.15s ease'
              }}
            >
              {item.icon && (
                <Icon
                  name={item.icon}
                  size={18}
                  color={isActive ? 'var(--kq-green-700)' : 'var(--kq-text-muted)'}
                />
              )}
              {!collapsed && <span style={{ flex: 1 }}>{item.label}</span>}
              {!collapsed && item.badge !== undefined && (
                <span style={{
                  fontSize: 11,
                  fontWeight: 700,
                  backgroundColor: isActive ? 'var(--kq-green-200)' : 'var(--kq-bg-subtle)',
                  color: isActive ? 'var(--kq-green-900)' : 'var(--kq-text-secondary)',
                  padding: '1px 6px',
                  borderRadius: 10
                }}>
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

export function MobileNavigation({
  items = [],
  activeItem,
  onSelect,
  isOpen = false,
  onClose
}) {
  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9995,
        backgroundColor: 'rgba(28, 25, 23, 0.55)',
        backdropFilter: 'blur(2px)',
        display: 'flex'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && onClose) onClose();
      }}
    >
      <div
        style={{
          width: '75%',
          maxWidth: 300,
          backgroundColor: '#ffffff',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          padding: 16,
          boxShadow: 'var(--kq-shadow-lg)'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--kq-green-900)' }}>
            KISAN VIKAS
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}
          >
            <Icon name="x" size={20} />
          </button>
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {items.map(item => {
            const isActive = activeItem === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  if (onSelect) onSelect(item.id);
                  if (onClose) onClose();
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  width: '100%',
                  padding: '12px 14px',
                  borderRadius: 'var(--kq-radius-sm)',
                  border: 'none',
                  backgroundColor: isActive ? 'var(--kq-green-50)' : 'transparent',
                  color: isActive ? 'var(--kq-green-800)' : 'var(--kq-text-secondary)',
                  fontWeight: isActive ? 700 : 500,
                  fontSize: 14,
                  cursor: 'pointer',
                  textAlign: 'left'
                }}
              >
                {item.icon && <Icon name={item.icon} size={18} color={isActive ? 'var(--kq-green-700)' : 'var(--kq-text-muted)'} />}
                <span style={{ flex: 1 }}>{item.label}</span>
                {item.badge !== undefined && (
                  <span style={{
                    fontSize: 11,
                    fontWeight: 700,
                    backgroundColor: 'var(--kq-green-100)',
                    color: 'var(--kq-green-900)',
                    padding: '2px 7px',
                    borderRadius: 10
                  }}>
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
