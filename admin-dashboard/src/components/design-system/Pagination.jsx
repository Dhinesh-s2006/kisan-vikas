import React from 'react';
import { Icon } from './Icons';

export function Pagination({
  currentPage = 1,
  totalItems = 0,
  pageSize = 10,
  onPageChange,
  className = '',
  style = {}
}) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const startItem = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(totalItems, currentPage * pageSize);

  if (totalItems <= 0) return null;

  // Generate page numbers with ellipsis
  const getPageNumbers = () => {
    const pages = [];
    if (totalPages <= 5) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (currentPage > 3) pages.push('...');
      const start = Math.max(2, currentPage - 1);
      const end = Math.min(totalPages - 1, currentPage + 1);
      for (let i = start; i <= end; i++) pages.push(i);
      if (currentPage < totalPages - 2) pages.push('...');
      pages.push(totalPages);
    }
    return pages;
  };

  const pages = getPageNumbers();

  return (
    <div
      className={`kq-pagination ${className}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        backgroundColor: 'var(--kq-bg-surface)',
        borderTop: '1px solid var(--kq-border-subtle)',
        flexWrap: 'wrap',
        gap: 12,
        fontSize: 13,
        ...style
      }}
    >
      <div className="kq-text-muted">
        Showing <strong style={{ color: 'var(--kq-text-primary)' }}>{startItem}–{endItem}</strong> of{' '}
        <strong style={{ color: 'var(--kq-text-primary)' }}>{totalItems}</strong> entries
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <button
          type="button"
          onClick={() => onPageChange && onPageChange(currentPage - 1)}
          disabled={currentPage <= 1}
          className="kq-btn kq-btn-secondary"
          style={{
            height: 32,
            minHeight: 'auto',
            padding: '4px 8px',
            fontSize: 12
          }}
          aria-label="Previous page"
        >
          <Icon name="chevron-left" size={14} />
          <span>Previous</span>
        </button>

        {pages.map((p, idx) => {
          if (p === '...') {
            return (
              <span key={`dots-${idx}`} style={{ padding: '0 4px', color: 'var(--kq-text-muted)' }}>
                ...
              </span>
            );
          }
          const isActive = p === currentPage;
          return (
            <button
              key={`page-${p}`}
              type="button"
              onClick={() => onPageChange && onPageChange(p)}
              className={isActive ? 'kq-btn kq-btn-primary' : 'kq-btn kq-btn-secondary'}
              style={{
                height: 32,
                minHeight: 'auto',
                minWidth: 32,
                padding: '4px 6px',
                fontSize: 12,
                fontWeight: isActive ? 700 : 500
              }}
              aria-current={isActive ? 'page' : undefined}
            >
              {p}
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => onPageChange && onPageChange(currentPage + 1)}
          disabled={currentPage >= totalPages}
          className="kq-btn kq-btn-secondary"
          style={{
            height: 32,
            minHeight: 'auto',
            padding: '4px 8px',
            fontSize: 12
          }}
          aria-label="Next page"
        >
          <span>Next</span>
          <Icon name="chevron-right" size={14} />
        </button>
      </div>
    </div>
  );
}
