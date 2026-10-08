import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './design-system';

export function formatRelativeTime(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  const now = new Date();
  const diffInSec = Math.floor((now - date) / 1000);

  if (diffInSec < 60) return 'Just now';
  const diffInMin = Math.floor(diffInSec / 60);
  if (diffInMin < 60) return `${diffInMin}m ago`;
  const diffInHours = Math.floor(diffInMin / 60);
  if (diffInHours < 24) return `${diffInHours}h ago`;
  const diffInDays = Math.floor(diffInHours / 24);
  if (diffInDays < 7) return `${diffInDays}d ago`;
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function getAdminNotificationIcon(type) {
  switch (type) {
    case 'BOOKING_CONFIRMED':
      return { icon: 'calendar', color: '#15803d', bg: '#f0fdf4' };
    case 'PACING_ADVISORY':
      return { icon: 'alert-triangle', color: '#d97706', bg: '#fef3c7' };
    case 'PROCUREMENT_QUALITY':
      return { icon: 'clipboard-check', color: '#0369a1', bg: '#f0f9ff' };
    case 'PROCUREMENT_WEIGHMENT':
      return { icon: 'scale', color: '#4338ca', bg: '#eef2ff' };
    case 'PROCUREMENT_COMPLETED':
      return { icon: 'check-circle', color: '#15803d', bg: '#f0fdf4' };
    case 'PAYMENT_COMPLETED':
      return { icon: 'check-circle', color: '#15803d', bg: '#f0fdf4' };
    case 'GRIEVANCE_SUBMITTED':
      return { icon: 'message-square', color: '#b91c1c', bg: '#fef2f2' };
    case 'GRIEVANCE_CONFIRMATION':
      return { icon: 'alert-circle', color: '#b91c1c', bg: '#fef2f2' };
    default:
      return { icon: 'bell', color: '#4b5563', bg: '#f3f4f6' };
  }
}

export default function AdminNotificationBell({ api, onNavigateTab }) {
  const [isOpen, setIsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);

  const bellRef = useRef(null);
  const dropdownRef = useRef(null);

  const [dropdownPos, setDropdownPos] = useState({
    top: 50,
    right: 24,
    left: 'auto',
    width: 360,
    maxWidth: 'calc(100vw - 24px)',
    maxHeight: 'calc(100vh - 80px)'
  });

  const fetchUnreadCount = async () => {
    const token = localStorage.getItem('kisan_admin_token');
    if (!token || !api) {
      setUnreadCount(0);
      setNotifications([]);
      return;
    }
    try {
      const res = await api.get('/admin/my-centre/notifications/unread-count');
      if (res.data && typeof res.data.unread_count === 'number') {
        setUnreadCount(res.data.unread_count);
      }
    } catch (err) {
      console.warn('Failed to fetch centre unread count:', err?.response?.data || err.message);
    }
  };

  const fetchNotifications = async () => {
    const token = localStorage.getItem('kisan_admin_token');
    if (!token || !api) return;
    try {
      setLoading(true);
      const res = await api.get('/admin/my-centre/notifications?limit=20');
      if (res.data && Array.isArray(res.data.notifications)) {
        setNotifications(res.data.notifications);
        if (typeof res.data.unread_count === 'number') {
          setUnreadCount(res.data.unread_count);
        }
      }
    } catch (err) {
      console.warn('Failed to fetch centre notifications:', err?.response?.data || err.message);
    } finally {
      setLoading(false);
    }
  };

  const updatePosition = () => {
    if (!bellRef.current) return;
    const rect = bellRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const spacing = 8;
    const top = rect.bottom + spacing;
    const dropdownWidth = Math.min(360, viewportWidth - 24);
    let right = viewportWidth - rect.right;
    if (rect.right - dropdownWidth < 12) {
      right = Math.max(12, (viewportWidth - dropdownWidth) / 2);
    } else {
      right = Math.max(12, right);
    }

    setDropdownPos({
      top,
      right,
      left: 'auto',
      width: dropdownWidth,
      maxWidth: 'calc(100vw - 24px)',
      maxHeight: `calc(100vh - ${top + 16}px)`
    });
  };

  useEffect(() => {
    fetchUnreadCount();
    const intervalId = setInterval(fetchUnreadCount, 30000);
    const handleFocus = () => fetchUnreadCount();
    const handleRefresh = () => {
      fetchUnreadCount();
      if (isOpen) fetchNotifications();
    };

    const handleClose = () => setIsOpen(false);

    window.addEventListener('focus', handleFocus);
    window.addEventListener('kisan_admin_notification_refresh', handleRefresh);
    window.addEventListener('kisan_close_admin_notifications', handleClose);

    return () => {
      clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('kisan_admin_notification_refresh', handleRefresh);
      window.removeEventListener('kisan_close_admin_notifications', handleClose);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    updatePosition();

    const handleClickOutside = (event) => {
      if (dropdownRef.current && dropdownRef.current.contains(event.target)) return;
      if (bellRef.current && bellRef.current.contains(event.target)) return;
      setIsOpen(false);
    };

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        bellRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const toggleDropdown = () => {
    const nextState = !isOpen;
    if (nextState) {
      updatePosition();
      fetchNotifications();
    }
    setIsOpen(nextState);
  };

  const handleMarkAsRead = async (notif, e) => {
    if (e) e.stopPropagation();
    if (!notif.is_read) {
      try {
        await api.patch(`/admin/my-centre/notifications/${notif.id}/read`);
        setNotifications(prev =>
          prev.map(item => item.id === notif.id ? { ...item, is_read: true } : item)
        );
        setUnreadCount(prev => Math.max(0, prev - 1));
      } catch (err) {
        console.error('Failed to mark admin notification as read:', err);
      }
    }

    if (notif.related_grievance_id && onNavigateTab) {
      setIsOpen(false);
      onNavigateTab('grievances');
    } else if (notif.related_booking_id && onNavigateTab) {
      setIsOpen(false);
      onNavigateTab('queue');
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await api.patch('/admin/my-centre/notifications/read-all');
      setNotifications(prev => prev.map(item => ({ ...item, is_read: true })));
      setUnreadCount(0);
    } catch (err) {
      console.error('Failed to mark all centre notifications as read:', err);
    }
  };

  const badgeText = unreadCount > 99 ? '99+' : unreadCount;

  return (
    <>
      <button
        ref={bellRef}
        type="button"
        className="kq-notif-bell-btn"
        onClick={toggleDropdown}
        aria-label={`Centre Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        aria-expanded={isOpen}
        style={{
          position: 'relative',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 36,
          height: 36,
          borderRadius: '50%',
          backgroundColor: isOpen ? 'var(--kq-green-50, #f0fdf4)' : '#ffffff',
          border: '1px solid var(--kq-border-medium, #d1d5db)',
          cursor: 'pointer',
          color: isOpen ? 'var(--kq-green-800, #166534)' : 'var(--kq-text-secondary, #4b5563)',
          transition: 'all 0.15s ease',
          padding: 0,
          flexShrink: 0
        }}
      >
        <Icon name="bell" size={17} color="currentColor" />

        {unreadCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: -3,
              right: -3,
              backgroundColor: 'var(--kq-danger-btn, #b91c1c)',
              color: '#ffffff',
              fontSize: 10,
              fontWeight: 800,
              lineHeight: 1,
              padding: unreadCount > 9 ? '2px 5px' : '2px 4px',
              borderRadius: 10,
              border: '2px solid #ffffff',
              minWidth: 16,
              textAlign: 'center',
              boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
              pointerEvents: 'none'
            }}
          >
            {badgeText}
          </span>
        )}
      </button>

      {isOpen &&
        createPortal(
          <div
            ref={dropdownRef}
            role="dialog"
            aria-label="Centre Notifications"
            style={{
              position: 'fixed',
              top: `${dropdownPos.top}px`,
              right: dropdownPos.right !== 'auto' ? `${dropdownPos.right}px` : 'auto',
              left: dropdownPos.left !== 'auto' ? `${dropdownPos.left}px` : 'auto',
              width: typeof dropdownPos.width === 'number' ? `${dropdownPos.width}px` : dropdownPos.width,
              maxWidth: dropdownPos.maxWidth,
              maxHeight: dropdownPos.maxHeight,
              backgroundColor: '#ffffff',
              borderRadius: 10,
              boxShadow: '0 12px 32px rgba(0, 0, 0, 0.18), 0 4px 12px rgba(0, 0, 0, 0.08)',
              border: '1px solid var(--kq-border-medium, #d1d5db)',
              zIndex: 99999,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              boxSizing: 'border-box'
            }}
          >
            {/* Header */}
            <div
              style={{
                padding: '12px 16px',
                backgroundColor: '#f9fafb',
                borderBottom: '1px solid var(--kq-border-light, #e5e7eb)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexShrink: 0
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--kq-text-primary, #111827)' }}>
                  Centre Alerts
                </span>
                {unreadCount > 0 && (
                  <span
                    style={{
                      backgroundColor: '#fee2e2',
                      color: '#991b1b',
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '1px 6px',
                      borderRadius: 10
                    }}
                  >
                    {unreadCount} unread
                  </span>
                )}
              </div>

              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--kq-green-800, #15803d)',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    padding: '2px 4px'
                  }}
                >
                  Mark all read
                </button>
              )}
            </div>

            {/* List */}
            <div
              style={{
                maxHeight: 380,
                overflowY: 'auto',
                WebkitOverflowScrolling: 'touch'
              }}
            >
              {loading && notifications.length === 0 ? (
                <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--kq-text-muted)', fontSize: 13 }}>
                  Loading centre updates...
                </div>
              ) : notifications.length === 0 ? (
                <div style={{ padding: '36px 20px', textAlign: 'center' }}>
                  <div style={{ color: '#9ca3af', marginBottom: 8 }}>
                    <Icon name="bell" size={28} />
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--kq-text-secondary, #4b5563)' }}>
                    No centre alerts
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--kq-text-muted, #9ca3af)', marginTop: 2 }}>
                    புதிய அறிவிப்புகள் இல்லை
                  </div>
                </div>
              ) : (
                notifications.map((notif) => {
                  const iconInfo = getAdminNotificationIcon(notif.type);
                  const isUnread = !notif.is_read;

                  return (
                    <div
                      key={notif.id}
                      onClick={(e) => handleMarkAsRead(notif, e)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleMarkAsRead(notif, e);
                        }
                      }}
                      style={{
                        padding: '12px 16px',
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 12,
                        borderBottom: '1px solid #f3f4f6',
                        backgroundColor: isUnread ? '#f0fdf4' : '#ffffff',
                        cursor: 'pointer',
                        transition: 'background-color 0.15s ease',
                        outline: 'none'
                      }}
                    >
                      <div
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: '50%',
                          backgroundColor: iconInfo.bg,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          marginTop: 2
                        }}
                      >
                        <Icon name={iconInfo.icon} size={15} color={iconInfo.color} />
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                          <span
                            style={{
                              fontSize: 13,
                              fontWeight: isUnread ? 700 : 600,
                              color: isUnread ? 'var(--kq-green-900, #14532d)' : 'var(--kq-text-primary, #111827)',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis'
                            }}
                          >
                            {notif.title}
                          </span>
                          <span style={{ fontSize: 11, color: '#9ca3af', whiteSpace: 'nowrap' }}>
                            {formatRelativeTime(notif.created_at)}
                          </span>
                        </div>

                        <p
                          style={{
                            margin: '3px 0 0 0',
                            fontSize: 12,
                            color: isUnread ? '#166534' : 'var(--kq-text-secondary, #4b5563)',
                            lineHeight: 1.4,
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden'
                          }}
                        >
                          {notif.message}
                        </p>
                      </div>

                      {isUnread && (
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            backgroundColor: '#16a34a',
                            flexShrink: 0,
                            marginTop: 6
                          }}
                          title="Unread"
                        />
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
