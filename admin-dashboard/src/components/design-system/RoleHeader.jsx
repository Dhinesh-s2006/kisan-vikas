import React from 'react';
import { Icon } from './Icons';

export function RoleHeader({
  roleTitle = 'Portal',
  entityName,
  entityLocation,
  userName,
  userRole,
  onLogout,
  onProfile,
  actions,
  className = '',
  style = {}
}) {
  return (
    <div
      className={`kq-role-header ${className}`}
      style={{
        backgroundColor: 'var(--kq-bg-subtle)',
        borderBottom: '1px solid var(--kq-border-subtle)',
        padding: '10px 16px',
        fontSize: 13,
        ...style
      }}
    >
      <div
        className="kq-container"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12
        }}
      >
        {/* Left: Role scope & context */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{
            fontWeight: 700,
            color: 'var(--kq-green-800)',
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            fontSize: 12
          }}>
            {roleTitle}
          </span>

          {entityName && (
            <>
              <span style={{ color: 'var(--kq-border-strong)' }}>|</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon name="map-pin" size={14} color="var(--kq-green-700)" />
                <span style={{ fontWeight: 600, color: 'var(--kq-text-primary)' }}>
                  {entityName}
                </span>
                {entityLocation && (
                  <span className="kq-text-muted" style={{ fontSize: 12 }}>
                    ({entityLocation})
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        {/* Right: Authenticated persona & actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {actions}

          {(userName || userRole) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{
                width: 26,
                height: 26,
                borderRadius: '50%',
                backgroundColor: 'var(--kq-green-100)',
                color: 'var(--kq-green-800)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 12,
                fontWeight: 700
              }}>
                <Icon name="user" size={14} />
              </div>
              <div>
                <span style={{ fontWeight: 600, color: 'var(--kq-text-primary)', fontSize: 12.5 }}>
                  {userName}
                </span>
                {userRole && (
                  <span className="kq-text-muted" style={{ fontSize: 11, marginLeft: 4 }}>
                    • {userRole}
                  </span>
                )}
              </div>
            </div>
          )}

          {onProfile && (
            <button
              type="button"
              onClick={onProfile}
              className="kq-btn kq-btn-secondary"
              style={{ height: 28, minHeight: 'auto', padding: '2px 8px', fontSize: 12 }}
            >
              Profile
            </button>
          )}

          {onLogout && (
            <button
              type="button"
              onClick={onLogout}
              className="kq-btn kq-btn-secondary"
              style={{ height: 28, minHeight: 'auto', padding: '2px 8px', fontSize: 12, color: 'var(--kq-danger-text)' }}
              title="Log out of session"
            >
              <Icon name="log-out" size={13} />
              <span>Logout</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
