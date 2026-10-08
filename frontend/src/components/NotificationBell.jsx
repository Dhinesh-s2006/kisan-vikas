import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, Link } from 'react-router-dom';
import API from '../api';
import { Icon } from './design-system/Icons';

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

export function getNotificationIcon(type) {
  switch (type) {
    case 'BOOKING_CONFIRMED':
      return { icon: 'calendar', color: '#15803d', bg: '#f0fdf4' };
    case 'BOOKING_RESCHEDULED':
      return { icon: 'clock', color: '#b45309', bg: '#fffbeb' };
    case 'PACING_ADVISORY':
      return { icon: 'alert-triangle', color: '#d97706', bg: '#fef3c7' };
    case 'PROCUREMENT_QUALITY':
      return { icon: 'clipboard-check', color: '#0369a1', bg: '#f0f9ff' };
    case 'PROCUREMENT_WEIGHMENT':
      return { icon: 'scale', color: '#4338ca', bg: '#eef2ff' };
    case 'PROCUREMENT_COMPLETED':
      return { icon: 'badge-check', color: '#15803d', bg: '#f0fdf4' };
    case 'PAYMENT_PROCESSING':
      return { icon: 'credit-card', color: '#d97706', bg: '#fffbeb' };
    case 'PAYMENT_COMPLETED':
      return { icon: 'check-circle', color: '#15803d', bg: '#f0fdf4' };
    case 'GRIEVANCE_SUBMITTED':
      return { icon: 'message-square', color: '#0284c7', bg: '#e0f2fe' };
    case 'GRIEVANCE_UPDATED':
      return { icon: 'info', color: '#0284c7', bg: '#e0f2fe' };
    case 'GRIEVANCE_CONFIRMATION':
      return { icon: 'alert-circle', color: '#b91c1c', bg: '#fef2f2' };
    case 'GRIEVANCE_REOPENED':
      return { icon: 'alert-triangle', color: '#ea580c', bg: '#fff7ed' };
    default:
      return { icon: 'bell', color: '#4b5563', bg: '#f3f4f6' };
  }
}

export default function NotificationBell() {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);

  const bellRef = useRef(null);
  const dropdownRef = useRef(null);

  const [dropdownPos, setDropdownPos] = useState({
    top: 0,
    right: 12,
    left: 'auto',
    width: 380,
    maxWidth: 'calc(100vw - 24px)',
    maxHeight: 'calc(100vh - 100px)'
  });

  const fetchUnreadCount = async () => {
    const token = localStorage.getItem('kisan_token');
    const farmerId = localStorage.getItem('kisan_farmer_id');
    if (!token || !farmerId) {
      setUnreadCount(0);
      setNotifications([]);
      return;
    }
    try {
      const res = await API.get('/notifications/unread-count');
      if (res.data && typeof res.data.unread_count === 'number') {
        setUnreadCount(res.data.unread_count);
      }
    } catch (err) {
      console.warn('Failed to fetch unread notification count:', err?.response?.data || err.message);
    }
  };

  const fetchRecentNotifications = async () => {
    const token = localStorage.getItem('kisan_token');
    const farmerId = localStorage.getItem('kisan_farmer_id');
    if (!token || !farmerId) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }
    try {
      setLoading(true);
      const res = await API.get('/notifications?limit=6');
      if (res.data && Array.isArray(res.data.notifications)) {
        setNotifications(res.data.notifications);
        if (typeof res.data.unread_count === 'number') {
          setUnreadCount(res.data.unread_count);
        }
      }
    } catch (err) {
      console.warn('Failed to fetch recent notifications:', err?.response?.data || err.message);
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
    const isMobile = viewportWidth < 480;

    if (isMobile) {
      setDropdownPos({
        top,
        left: 12,
        right: 12,
        width: 'calc(100vw - 24px)',
        maxWidth: 400,
        maxHeight: `calc(100vh - ${top + 16}px)`
      });
    } else {
      const dropdownWidth = Math.min(380, viewportWidth - 24);
      // Align right edge of dropdown with right edge of bell button
      let right = viewportWidth - rect.right;
      // Clamp right edge so left edge is at least 12px from left viewport
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
    }
  };

  useEffect(() => {
    fetchUnreadCount();

    // 45-second polling interval
    const intervalId = setInterval(fetchUnreadCount, 45000);

    const handleFocus = () => fetchUnreadCount();
    const handleCustomRefresh = () => {
      fetchUnreadCount();
      if (isOpen) fetchRecentNotifications();
    };

    window.addEventListener('focus', handleFocus);
    window.addEventListener('storage', handleCustomRefresh);
    window.addEventListener('kisan_auth_changed', handleCustomRefresh);
    window.addEventListener('kisan_notification_refresh', handleCustomRefresh);

    return () => {
      clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('storage', handleCustomRefresh);
      window.removeEventListener('kisan_auth_changed', handleCustomRefresh);
      window.removeEventListener('kisan_notification_refresh', handleCustomRefresh);
    };
  }, [isOpen]);

  // Position updates on scroll & resize using requestAnimationFrame
  useEffect(() => {
    if (!isOpen) return;

    updatePosition();

    let animationFrameId;
    const handleReposition = () => {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = requestAnimationFrame(updatePosition);
    };

    window.addEventListener('resize', handleReposition, { passive: true });
    window.addEventListener('scroll', handleReposition, { capture: true, passive: true });

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, { capture: true });
    };
  }, [isOpen]);

  // Outside click & Escape key dismissal
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event) => {
      if (dropdownRef.current && dropdownRef.current.contains(event.target)) {
        return;
      }
      if (bellRef.current && bellRef.current.contains(event.target)) {
        return;
      }
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
      fetchRecentNotifications();
    }
    setIsOpen(nextState);
  };

  const handleMarkAsRead = async (notif, e) => {
    if (e) e.stopPropagation();
    if (!notif.is_read) {
      try {
        await API.patch(`/notifications/${notif.id}/read`);
        setNotifications(prev =>
          prev.map(item => item.id === notif.id ? { ...item, is_read: true } : item)
        );
        setUnreadCount(prev => Math.max(0, prev - 1));
      } catch (err) {
        console.error('Failed to mark notification as read:', err);
      }
    }

    if (notif.link) {
      setIsOpen(false);
      navigate(notif.link);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await API.patch('/notifications/read-all');
      setNotifications(prev => prev.map(item => ({ ...item, is_read: true })));
      setUnreadCount(0);
    } catch (err) {
      console.error('Failed to mark all notifications as read:', err);
    }
  };

  const badgeText = unreadCount > 99 ? '99+' : unreadCount;

  return (
    <>
      {/* Bell Button (Remains exactly in header navigation) */}
      <button
        ref={bellRef}
        type="button"
        onClick={toggleDropdown}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        style={{
          position: 'relative',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 36,
          height: 36,
          borderRadius: '50%',
          backgroundColor: isOpen ? 'var(--kq-green-50, #f0fdf4)' : '#ffffff',
          border: '1px solid var(--kq-border-subtle, #e5e7eb)',
          cursor: 'pointer',
          color: isOpen ? 'var(--kq-green-800, #166534)' : 'var(--kq-text-secondary, #4b5563)',
          transition: 'all 0.15s ease',
          padding: 0,
          flexShrink: 0
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = 'var(--kq-gray-50, #f9fafb)';
          e.currentTarget.style.borderColor = 'var(--kq-border-default, #d1d5db)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = isOpen ? 'var(--kq-green-50, #f0fdf4)' : '#ffffff';
          e.currentTarget.style.borderColor = 'var(--kq-border-subtle, #e5e7eb)';
        }}
      >
        <Icon name="bell" size={18} color="currentColor" />

        {/* Small Red Unread Count Badge */}
        {unreadCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: -4,
              right: -4,
              backgroundColor: 'var(--kq-danger-btn, #b91c1c)',
              color: '#ffffff',
              fontSize: 10,
              fontWeight: 700,
              lineHeight: 1,
              padding: unreadCount > 9 ? '2px 5px' : '2px 4px',
              borderRadius: 10,
              border: '2px solid #ffffff',
              minWidth: 18,
              textAlign: 'center',
              boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
              pointerEvents: 'none'
            }}
          >
            {badgeText}
          </span>
        )}
      </button>

      {/* Popover Dropdown rendered into document.body via Portal to prevent any parent container clipping */}
      {isOpen &&
        createPortal(
          <div
            ref={dropdownRef}
            role="dialog"
            aria-label="Farmer Notifications"
            style={{
              position: 'fixed',
              top: `${dropdownPos.top}px`,
              right: dropdownPos.right !== 'auto' ? `${dropdownPos.right}px` : 'auto',
              left: dropdownPos.left !== 'auto' ? `${dropdownPos.left}px` : 'auto',
              width: typeof dropdownPos.width === 'number' ? `${dropdownPos.width}px` : dropdownPos.width,
              maxWidth: dropdownPos.maxWidth,
              maxHeight: dropdownPos.maxHeight,
              backgroundColor: '#ffffff',
              borderRadius: 12,
              boxShadow: '0 12px 30px -4px rgba(0, 0, 0, 0.18), 0 8px 12px -6px rgba(0, 0, 0, 0.12)',
              border: '1px solid var(--kq-border-subtle, #e5e7eb)',
              zIndex: 9999,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              boxSizing: 'border-box'
            }}
          >
            {/* Popover Header */}
            <div
              style={{
                padding: '12px 16px',
                backgroundColor: '#fafafa',
                borderBottom: '1px solid var(--kq-border-subtle, #e5e7eb)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexShrink: 0
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--kq-text-primary, #111827)' }}>
                  Notifications
                </span>
                {unreadCount > 0 && (
                  <span
                    style={{
                      backgroundColor: '#fee2e2',
                      color: '#991b1b',
                      fontSize: 11,
                      fontWeight: 600,
                      padding: '2px 6px',
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
                    color: 'var(--kq-green-700, #15803d)',
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

            {/* Notifications List with responsive internal scrolling */}
            <div
              style={{
                maxHeight: 'min(380px, calc(100vh - 180px))',
                overflowY: 'auto',
                WebkitOverflowScrolling: 'touch'
              }}
            >
              {loading && notifications.length === 0 ? (
                <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--kq-text-muted, #6b7280)', fontSize: 13 }}>
                  Loading updates...
                </div>
              ) : notifications.length === 0 ? (
                <div style={{ padding: '40px 20px', textAlign: 'center' }}>
                  <div style={{ color: 'var(--kq-text-muted, #9ca3af)', marginBottom: 8 }}>
                    <Icon name="bell" size={32} />
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--kq-text-secondary, #4b5563)' }}>
                    No notifications yet
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--kq-text-muted, #9ca3af)', marginTop: 2 }}>
                    புதிய அறிவிப்புகள் இல்லை
                  </div>
                </div>
              ) : (
                notifications.map((notif) => {
                  const iconInfo = getNotificationIcon(notif.type);
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
                        backgroundColor: notif.is_read ? '#ffffff' : '#f0fdf4',
                        cursor: 'pointer',
                        transition: 'background-color 0.15s ease',
                        outline: 'none'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = notif.is_read ? '#f9fafb' : '#dcfce7';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = notif.is_read ? '#ffffff' : '#f0fdf4';
                      }}
                    >
                      {/* Category Icon */}
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
                        <Icon name={iconInfo.icon} size={16} color={iconInfo.color} />
                      </div>

                      {/* Content */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                          <span
                            style={{
                              fontSize: 13,
                              fontWeight: notif.is_read ? 600 : 700,
                              color: notif.is_read ? 'var(--kq-text-primary, #111827)' : 'var(--kq-green-900, #14532d)',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis'
                            }}
                          >
                            {notif.title}
                          </span>
                          <span style={{ fontSize: 11, color: 'var(--kq-text-muted, #9ca3af)', whiteSpace: 'nowrap' }}>
                            {formatRelativeTime(notif.created_at)}
                          </span>
                        </div>

                        <p
                          style={{
                            margin: '3px 0 0 0',
                            fontSize: 12,
                            color: notif.is_read ? 'var(--kq-text-secondary, #4b5563)' : '#166534',
                            lineHeight: 1.4,
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden'
                          }}
                        >
                          {notif.message}
                        </p>

                        {notif.action_required && (
                          <div style={{ marginTop: 6 }}>
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                fontSize: 11,
                                fontWeight: 700,
                                color: '#b91c1c',
                                backgroundColor: '#fee2e2',
                                padding: '2px 8px',
                                borderRadius: 4
                              }}
                            >
                              <Icon name="alert-circle" size={12} color="#b91c1c" />
                              Action Required / உறுதிசெய்க
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Unread indicator dot */}
                      {!notif.is_read && (
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

            {/* Popover Footer */}
            <div
              style={{
                padding: '10px 16px',
                backgroundColor: '#fafafa',
                borderTop: '1px solid var(--kq-border-subtle, #e5e7eb)',
                textAlign: 'center',
                flexShrink: 0
              }}
            >
              <Link
                to="/farmer/notifications"
                onClick={() => setIsOpen(false)}
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--kq-green-700, #15803d)',
                  textDecoration: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4
                }}
              >
                <span>View all notifications</span>
                <Icon name="arrow-right" size={14} />
              </Link>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
