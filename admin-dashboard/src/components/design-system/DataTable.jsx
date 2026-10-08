import React from 'react';
import { Icon } from './Icons';
import { LoadingState, EmptyState } from './States';

/**
 * Professional Public-Service DataTable Component
 * Features sticky headers, compact rows, responsive horizontal scrolling,
 * and built-in human-readable date/time formatters.
 */
export function DataTable({
  columns = [],
  data = [],
  loading = false,
  emptyTitle = 'No records found',
  emptyDescription = 'There are no items matching the selected criteria.',
  sortColumn,
  sortDirection,
  onSort,
  keyField = 'id',
  className = '',
  style = {}
}) {
  return (
    <div className={`kq-table-container ${className}`} style={style}>
      <table className="kq-table">
        <thead>
          <tr>
            {columns.map(col => {
              const isSorted = sortColumn === col.key;
              const isSortable = col.sortable && onSort;
              return (
                <th
                  key={col.key}
                  style={{
                    width: col.width,
                    textAlign: col.align || 'left',
                    cursor: isSortable ? 'pointer' : 'default',
                    userSelect: 'none'
                  }}
                  onClick={() => isSortable && onSort(col.key)}
                >
                  <div style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    justifyContent: col.align === 'right' ? 'flex-end' : col.align === 'center' ? 'center' : 'flex-start',
                    width: '100%'
                  }}>
                    <span>{col.header}</span>
                    {isSortable && (
                      <span style={{ color: isSorted ? 'var(--kq-green-700)' : 'var(--kq-text-muted)', display: 'inline-flex' }}>
                        {isSorted && sortDirection === 'desc' ? (
                          <Icon name="chevron-down" size={14} />
                        ) : isSorted && sortDirection === 'asc' ? (
                          <Icon name="chevron-up" size={14} />
                        ) : (
                          <Icon name="filter" size={11} style={{ opacity: 0.4 }} />
                        )}
                      </span>
                    )}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={columns.length} style={{ padding: '32px 16px', textAlign: 'center' }}>
                <LoadingState message="Loading table data..." minHeight={120} />
              </td>
            </tr>
          ) : data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} style={{ padding: '24px 16px' }}>
                <EmptyState title={emptyTitle} description={emptyDescription} />
              </td>
            </tr>
          ) : (
            data.map((row, rowIdx) => {
              const rowKey = row[keyField] || rowIdx;
              return (
                <tr key={rowKey}>
                  {columns.map(col => (
                    <td
                      key={`${rowKey}-${col.key}`}
                      style={{
                        textAlign: col.align || 'left',
                        whiteSpace: col.wrap ? 'normal' : 'nowrap'
                      }}
                    >
                      {col.render ? col.render(row[col.key], row, rowIdx) : (row[col.key] !== null && row[col.key] !== undefined ? String(row[col.key]) : '—')}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Human-readable date formatter
 * Example: 2026-10-08 -> 8 Oct 2026
 * Rules:
 * 1. For pure calendar date (YYYY-MM-DD), formats directly WITHOUT Date object or timezone shift.
 * 2. For ISO timestamp with timezone (contains T or Z), converts using Asia/Kolkata timezone.
 */
export function formatHumanDate(dateStr) {
  if (!dateStr) return '—';
  try {
    const s = String(dateStr).trim();
    // 1. If timestamp with timezone (contains T or Z), format in Indian Standard Time (Asia/Kolkata)
    if (s.includes('T') || s.includes('Z')) {
      const d = new Date(s);
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString('en-IN', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          timeZone: 'Asia/Kolkata'
        });
      }
    }
    // 2. Pure calendar date (YYYY-MM-DD): format directly WITHOUT any Date object or timezone shift
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      const year = m[1];
      const monthIdx = parseInt(m[2], 10) - 1;
      const day = parseInt(m[3], 10);
      if (monthIdx >= 0 && monthIdx < 12) {
        return `${day} ${MONTHS_SHORT[monthIdx]} ${year}`;
      }
    }
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    return d.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'Asia/Kolkata'
    });
  } catch {
    return String(dateStr);
  }
}

/**
 * Human-readable time range formatter
 * Example: 08:00:00 - 09:00:00 -> 8:00–9:00 AM
 */
export function formatHumanTime(timeStr) {
  if (!timeStr) return '—';
  try {
    const clean = String(timeStr).replace(/ - /g, '–');
    // If it's already friendly like 8:00–9:00 AM, return
    if (clean.includes('AM') || clean.includes('PM')) return clean;

    // Split if range e.g. "08:00:00–09:00:00" or "08:00:00 - 09:00:00"
    const parts = clean.split(/[–-]/).map(p => p.trim());
    if (parts.length === 2) {
      const formatPart = (t) => {
        const [hh, mm] = t.split(':');
        const h = parseInt(hh, 10);
        if (isNaN(h)) return t;
        const ampm = h >= 12 ? 'PM' : 'AM';
        const displayH = h % 12 === 0 ? 12 : h % 12;
        return `${displayH}:${mm || '00'} ${ampm}`;
      };
      return `${formatPart(parts[0])}–${formatPart(parts[1])}`;
    }
    return clean;
  } catch {
    return String(timeStr);
  }
}
