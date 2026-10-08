import React from 'react';
import { Icon } from './Icons';

export function Breadcrumbs({ items = [], className = '', style = {} }) {
  if (items.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className={`kq-breadcrumbs ${className}`} style={{ marginBottom: 12, ...style }}>
      <ol style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 6,
        padding: 0,
        margin: 0,
        listStyle: 'none',
        fontSize: 12.5,
        color: 'var(--kq-text-muted)'
      }}>
        {items.map((item, idx) => {
          const isLast = idx === items.length - 1;
          return (
            <li key={idx} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {idx > 0 && <Icon name="chevron-right" size={12} color="var(--kq-border-strong)" />}
              {isLast || !item.href && !item.onClick ? (
                <span style={{ color: 'var(--kq-text-primary)', fontWeight: isLast ? 600 : 400 }}>
                  {item.label}
                </span>
              ) : (
                <a
                  href={item.href || '#'}
                  onClick={(e) => {
                    if (item.onClick) {
                      e.preventDefault();
                      item.onClick();
                    }
                  }}
                  style={{ color: 'var(--kq-green-700)', textDecoration: 'none' }}
                >
                  {item.label}
                </a>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function PageHeader({ title, subtitle, breadcrumbs, actions, className = '', style = {} }) {
  return (
    <div
      className={`kq-page-header ${className}`}
      style={{
        marginBottom: 20,
        paddingBottom: 14,
        borderBottom: '1px solid var(--kq-border-subtle)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        flexWrap: 'wrap',
        gap: 12,
        ...style
      }}
    >
      <div style={{ flex: 1, minWidth: 260 }}>
        {breadcrumbs && <Breadcrumbs items={breadcrumbs} />}
        <h1 className="kq-title-page">{title}</h1>
        {subtitle && <p className="kq-text-muted" style={{ margin: '4px 0 0 0', fontSize: 14 }}>{subtitle}</p>}
      </div>
      {actions && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {actions}
        </div>
      )}
    </div>
  );
}

export function SectionHeader({ title, subtitle, count, action, className = '', style = {} }) {
  return (
    <div
      className={`kq-section-header ${className}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 12,
        flexWrap: 'wrap',
        gap: 8,
        ...style
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h2 className="kq-title-section">{title}</h2>
        {count !== undefined && (
          <span style={{
            backgroundColor: 'var(--kq-bg-subtle)',
            color: 'var(--kq-text-secondary)',
            fontSize: 12,
            fontWeight: 700,
            padding: '2px 8px',
            borderRadius: 12,
            border: '1px solid var(--kq-border-subtle)'
          }}>
            {count}
          </span>
        )}
      </div>
      {action && <div>{action}</div>}
      {subtitle && <p className="kq-text-muted" style={{ width: '100%', margin: '2px 0 0 0' }}>{subtitle}</p>}
    </div>
  );
}
