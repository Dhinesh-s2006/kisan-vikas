import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import API from '../api';
import {
  Card,
  PrimaryButton,
  SecondaryButton,
  Icon,
  EmptyState,
  LoadingState
} from '../components/design-system';
import { formatRelativeTime, getNotificationIcon } from '../components/NotificationBell';

export default function FarmerNotifications() {
  const navigate = useNavigate();
  const [farmerId, setFarmerId] = useState(localStorage.getItem('kisan_farmer_id') || '');
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [filter, setFilter] = useState('ALL'); // 'ALL' | 'UNREAD' | 'ACTION_REQUIRED'
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const fetchNotifications = async () => {
    const token = localStorage.getItem('kisan_token');
    const fId = localStorage.getItem('kisan_farmer_id');
    if (!token || !fId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setErrorMsg('');

      let url = '/notifications?limit=50';
      if (filter === 'UNREAD') {
        url += '&unread_only=true';
      } else if (filter === 'ACTION_REQUIRED') {
        url += '&action_required_only=true';
      }

      const res = await API.get(url);
      if (res.data) {
        setNotifications(Array.isArray(res.data.notifications) ? res.data.notifications : []);
        setUnreadCount(typeof res.data.unread_count === 'number' ? res.data.unread_count : 0);
      }
    } catch (err) {
      console.error('Failed to load notifications:', err);
      setErrorMsg(err.response?.data?.message || 'Unable to load notifications. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotifications();
  }, [filter, farmerId]);

  const handleMarkAsRead = async (id, link) => {
    try {
      await API.patch(`/notifications/${id}/read`);
      setNotifications(prev =>
        prev.map(item => item.id === id ? { ...item, is_read: true } : item)
      );
      setUnreadCount(prev => Math.max(0, prev - 1));

      // Synchronize top nav bell
      window.dispatchEvent(new Event('kisan_notification_refresh'));

      if (link) {
        navigate(link);
      }
    } catch (err) {
      console.error('Failed to mark notification as read:', err);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      setActionLoading(true);
      await API.patch('/notifications/read-all');
      setNotifications(prev => prev.map(item => ({ ...item, is_read: true })));
      setUnreadCount(0);

      // Synchronize top nav bell
      window.dispatchEvent(new Event('kisan_notification_refresh'));
    } catch (err) {
      console.error('Failed to mark all notifications as read:', err);
    } finally {
      setActionLoading(false);
    }
  };

  const actionRequiredCount = notifications.filter(n => n.action_required && !n.is_read).length;

  if (!farmerId) {
    return (
      <div className="kq-container" style={{ padding: '32px 16px', maxWidth: 800, margin: '0 auto' }}>
        <Card title="Farmer Notification Center / அறிவிப்பு மையம்">
          <EmptyState
            icon="bell"
            title="Please sign in to view your notifications"
            description="Access real-time updates regarding your slot bookings, pacing advisories, quality reports, payments, and grievance resolutions."
            action={
              <Link to="/farmer" className="kq-btn kq-btn-primary">
                Farmer Login / உள்நுழைக
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="kq-container" style={{ padding: '24px 16px', maxWidth: 900, margin: '0 auto' }}>
      {/* Page Header */}
      <div style={{ marginBottom: 20, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 className="kq-title-page" style={{ margin: 0, fontSize: 24 }}>
              Notification Center
            </h1>
            {unreadCount > 0 && (
              <span
                style={{
                  backgroundColor: '#fee2e2',
                  color: '#991b1b',
                  fontSize: 12,
                  fontWeight: 700,
                  padding: '3px 8px',
                  borderRadius: 12,
                  border: '1px solid #fecaca'
                }}
              >
                {unreadCount} unread
              </span>
            )}
          </div>
          <p className="kq-text-muted" style={{ margin: '4px 0 0 0', fontSize: 13.5 }}>
            அறிவிப்பு மையம் — Real-time updates on your procurement bookings, queue advisories, weighments, payments, and grievances.
          </p>
        </div>

        {unreadCount > 0 && (
          <SecondaryButton
            onClick={handleMarkAllRead}
            disabled={actionLoading}
            style={{ fontSize: 13, height: 36 }}
          >
            <Icon name="check" size={15} />
            <span>Mark All as Read / அனைத்தையும் படித்ததாகக் குறிக்க</span>
          </SecondaryButton>
        )}
      </div>

      {/* Filter Tabs */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 16,
          borderBottom: '1px solid var(--kq-border-subtle, #e5e7eb)',
          paddingBottom: 8,
          overflowX: 'auto'
        }}
      >
        <button
          type="button"
          onClick={() => setFilter('ALL')}
          style={{
            padding: '6px 14px',
            borderRadius: 6,
            border: 'none',
            backgroundColor: filter === 'ALL' ? 'var(--kq-green-800, #166534)' : 'transparent',
            color: filter === 'ALL' ? '#ffffff' : 'var(--kq-text-secondary, #4b5563)',
            fontWeight: filter === 'ALL' ? 700 : 500,
            fontSize: 13,
            cursor: 'pointer',
            transition: 'all 0.15s ease'
          }}
        >
          All Notifications
        </button>

        <button
          type="button"
          onClick={() => setFilter('UNREAD')}
          style={{
            padding: '6px 14px',
            borderRadius: 6,
            border: 'none',
            backgroundColor: filter === 'UNREAD' ? 'var(--kq-green-800, #166534)' : 'transparent',
            color: filter === 'UNREAD' ? '#ffffff' : 'var(--kq-text-secondary, #4b5563)',
            fontWeight: filter === 'UNREAD' ? 700 : 500,
            fontSize: 13,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            transition: 'all 0.15s ease'
          }}
        >
          <span>Unread</span>
          {unreadCount > 0 && (
            <span
              style={{
                backgroundColor: filter === 'UNREAD' ? '#ffffff' : '#fee2e2',
                color: filter === 'UNREAD' ? '#166534' : '#991b1b',
                fontSize: 11,
                fontWeight: 700,
                padding: '1px 6px',
                borderRadius: 10
              }}
            >
              {unreadCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setFilter('ACTION_REQUIRED')}
          style={{
            padding: '6px 14px',
            borderRadius: 6,
            border: 'none',
            backgroundColor: filter === 'ACTION_REQUIRED' ? '#b91c1c' : 'transparent',
            color: filter === 'ACTION_REQUIRED' ? '#ffffff' : 'var(--kq-text-secondary, #4b5563)',
            fontWeight: filter === 'ACTION_REQUIRED' ? 700 : 500,
            fontSize: 13,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            transition: 'all 0.15s ease'
          }}
        >
          <Icon name="alert-circle" size={14} color={filter === 'ACTION_REQUIRED' ? '#ffffff' : '#b91c1c'} />
          <span>Action Required</span>
          {actionRequiredCount > 0 && (
            <span
              style={{
                backgroundColor: filter === 'ACTION_REQUIRED' ? '#ffffff' : '#fee2e2',
                color: filter === 'ACTION_REQUIRED' ? '#b91c1c' : '#991b1b',
                fontSize: 11,
                fontWeight: 700,
                padding: '1px 6px',
                borderRadius: 10
              }}
            >
              {actionRequiredCount}
            </span>
          )}
        </button>
      </div>

      {/* Notifications List */}
      {loading ? (
        <Card>
          <LoadingState message="Loading your updates..." />
        </Card>
      ) : errorMsg ? (
        <Card>
          <div style={{ padding: '24px', textAlign: 'center', color: '#b91c1c' }}>
            <Icon name="alert-triangle" size={28} />
            <p style={{ marginTop: 8, fontWeight: 600 }}>{errorMsg}</p>
            <SecondaryButton onClick={fetchNotifications} style={{ marginTop: 12 }}>
              Retry / மீண்டும் முயற்சிக்க
            </SecondaryButton>
          </div>
        </Card>
      ) : notifications.length === 0 ? (
        <Card>
          <EmptyState
            icon="bell"
            title={
              filter === 'UNREAD'
                ? 'No unread notifications'
                : filter === 'ACTION_REQUIRED'
                ? 'No pending actions required'
                : 'No notifications yet'
            }
            description={
              filter === 'UNREAD'
                ? 'You have caught up with all your updates.'
                : filter === 'ACTION_REQUIRED'
                ? 'All your grievances and slot bookings are in order.'
                : 'System advisories, booking confirmations, and procurement milestones will appear here.'
            }
            action={
              filter !== 'ALL' ? (
                <SecondaryButton onClick={() => setFilter('ALL')}>
                  View All Notifications
                </SecondaryButton>
              ) : null
            }
          />
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {notifications.map((notif) => {
            const iconInfo = getNotificationIcon(notif.type);
            const isUnread = !notif.is_read;

            return (
              <div
                key={notif.id}
                style={{
                  backgroundColor: isUnread ? '#f0fdf4' : '#ffffff',
                  border: isUnread ? '1.5px solid #86efac' : '1px solid var(--kq-border-subtle, #e5e7eb)',
                  borderRadius: 8,
                  padding: '16px 20px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 16,
                  boxShadow: isUnread ? '0 2px 4px rgba(22, 163, 74, 0.08)' : 'var(--kq-shadow-xs, 0 1px 2px rgba(0,0,0,0.05))',
                  transition: 'all 0.15s ease'
                }}
              >
                {/* Left Category Icon */}
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    backgroundColor: iconInfo.bg,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    marginTop: 2
                  }}
                >
                  <Icon name={iconInfo.icon} size={20} color={iconInfo.color} />
                </div>

                {/* Main Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <h4
                        style={{
                          margin: 0,
                          fontSize: 15,
                          fontWeight: isUnread ? 700 : 600,
                          color: isUnread ? 'var(--kq-green-900, #14532d)' : 'var(--kq-text-primary, #111827)'
                        }}
                      >
                        {notif.title}
                      </h4>

                      {isUnread && (
                        <span
                          style={{
                            backgroundColor: '#22c55e',
                            color: '#ffffff',
                            fontSize: 10,
                            fontWeight: 700,
                            padding: '1px 6px',
                            borderRadius: 10
                          }}
                        >
                          NEW
                        </span>
                      )}

                      {notif.priority === 'URGENT' && (
                        <span
                          style={{
                            backgroundColor: '#fee2e2',
                            color: '#991b1b',
                            fontSize: 10,
                            fontWeight: 700,
                            padding: '1px 6px',
                            borderRadius: 10
                          }}
                        >
                          URGENT
                        </span>
                      )}
                    </div>

                    <span style={{ fontSize: 12, color: 'var(--kq-text-muted, #9ca3af)', whiteSpace: 'nowrap' }}>
                      {formatRelativeTime(notif.created_at)} • {new Date(notif.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  <p
                    style={{
                      margin: '6px 0 0 0',
                      fontSize: 13.5,
                      color: isUnread ? '#166534' : 'var(--kq-text-secondary, #4b5563)',
                      lineHeight: 1.5
                    }}
                  >
                    {notif.message}
                  </p>

                  {/* Actions Area */}
                  <div
                    style={{
                      marginTop: 12,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      flexWrap: 'wrap'
                    }}
                  >
                    {notif.action_required && notif.link ? (
                      <PrimaryButton
                        onClick={() => handleMarkAsRead(notif.id, notif.link)}
                        style={{
                          backgroundColor: '#b91c1c',
                          borderColor: '#b91c1c',
                          fontSize: 12,
                          height: 32,
                          padding: '0 12px'
                        }}
                      >
                        <Icon name="check-circle" size={14} />
                        <span>Confirm Resolution / தீர்வு உறுதிசெய்க</span>
                      </PrimaryButton>
                    ) : notif.link ? (
                      <PrimaryButton
                        onClick={() => handleMarkAsRead(notif.id, notif.link)}
                        style={{ fontSize: 12, height: 32, padding: '0 12px' }}
                      >
                        <span>View Details / விவரங்களைக் காண்க</span>
                        <Icon name="arrow-right" size={13} />
                      </PrimaryButton>
                    ) : null}

                    {isUnread && (
                      <SecondaryButton
                        onClick={() => handleMarkAsRead(notif.id)}
                        style={{ fontSize: 12, height: 32, padding: '0 10px' }}
                      >
                        <Icon name="check" size={13} />
                        <span>Mark as Read</span>
                      </SecondaryButton>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
