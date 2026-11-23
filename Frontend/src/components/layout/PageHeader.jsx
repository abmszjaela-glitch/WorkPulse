import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bell, CalendarDays, Menu, Search, X } from 'lucide-react'
import ProfileLink from './ProfileLink.jsx'
import useAuth from '../../hooks/useAuth.js'
import useApiData from '../../hooks/useApiData.js'
import { apiRequest } from '../../services/api.js'

export default function PageHeader({
  title,
  subtitle,
  search,
  date,
  onMenuOpen,
}) {
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const { session } = useAuth()
  const notificationData = useApiData(
    { notifications: '/notifications?pageSize=20' },
    { enabled: notificationsOpen, refreshMs: 15000 },
  )
  const [notificationMessage, setNotificationMessage] = useState('')
  const [notificationBusy, setNotificationBusy] = useState(false)
  const markRead = async (id) => {
    setNotificationBusy(true)
    try {
      await apiRequest(
        session.accessToken,
        id ? `/notifications/${id}/read` : '/notifications/read-all',
        { method: 'PATCH' },
      )
      notificationData.reload()
      setNotificationMessage('Notifications updated.')
    } catch (error) {
      setNotificationMessage(error.message)
    } finally {
      setNotificationBusy(false)
    }
  }
  const notifications = useRef(null)
  const trigger = useRef(null)
  useEffect(() => {
    if (!notificationsOpen) return
    const dismiss = (event) => {
      if (event.type === 'keydown' && event.key === 'Escape') {
        setNotificationsOpen(false)
        trigger.current?.focus()
      }
      if (
        event.type === 'pointerdown' &&
        !notifications.current?.contains(event.target)
      )
        setNotificationsOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', dismiss)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', dismiss)
    }
  }, [notificationsOpen])
  return (
    <header className="dashboard-header">
      <button
        type="button"
        className="mobile-menu icon-button"
        aria-label="Open navigation"
        aria-controls="main-sidebar"
        onClick={onMenuOpen}
      >
        <Menu />
      </button>
      <div className="page-title min-w-0">
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <div className="header-actions">
        {search && (
          <label className="employee-search min-w-0">
            <Search size={17} className="shrink-0" />
            <input
              type="search"
              aria-label={search.label}
              placeholder={search.placeholder || search.label}
              value={search.value}
              onChange={(event) => search.onChange(event.target.value)}
            />
          </label>
        )}
        {date && (
          <span className="date-badge whitespace-nowrap">
            <CalendarDays size={16} />
            {date}
          </span>
        )}
        <div ref={notifications} className="relative">
          <button
            type="button"
            ref={trigger}
            className="icon-button rounded-lg hover:bg-soft"
            aria-label="Notifications"
            aria-expanded={notificationsOpen}
            aria-controls="notification-panel"
            onClick={() => setNotificationsOpen((value) => !value)}
          >
            <Bell size={19} />
          </button>
          {notificationsOpen && (
            <section
              id="notification-panel"
              aria-label="Notifications"
              className="absolute right-0 top-full z-40 mt-3 w-64 rounded-xl border border-line bg-white p-4 shadow-floating"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Notifications</h2>
                <button
                  aria-label="Close notifications"
                  onClick={() => setNotificationsOpen(false)}
                >
                  <X size={16} />
                </button>
              </div>
              {notificationData.loading && (
                <p className="my-4 text-xs text-muted">
                  Loading notifications…
                </p>
              )}
              {Object.values(notificationData.errors).map((error) => (
                <p key={error} role="alert" className="my-3 text-xs text-error">
                  {error}
                </p>
              ))}
              {(notificationData.data.notifications?.data || []).map((item) => (
                <div
                  key={item.id}
                  className="my-3 border-b border-line pb-3 text-xs"
                >
                  <p>{item.message}</p>
                  <small className="text-muted">
                    {new Date(item.created_at).toLocaleString()}
                  </small>
                  {!item.read_at && (
                    <button
                      type="button"
                      disabled={notificationBusy}
                      className="mt-2 block text-primary"
                      onClick={() => markRead(item.id)}
                    >
                      Mark read
                    </button>
                  )}
                </div>
              ))}
              {notificationData.data.notifications?.data?.length === 0 && (
                <p className="my-4 text-xs text-muted">No notifications.</p>
              )}
              <button
                type="button"
                disabled={notificationBusy}
                className="mb-3 text-xs text-primary"
                onClick={() => markRead()}
              >
                Mark all read
              </button>
              {notificationMessage && (
                <p role="status" className="mb-3 text-xs">
                  {notificationMessage}
                </p>
              )}
              <Link
                to="/settings"
                onClick={() => setNotificationsOpen(false)}
                className="text-xs font-medium text-primary"
              >
                Manage notification preferences
              </Link>
            </section>
          )}
        </div>
        <ProfileLink />
      </div>
    </header>
  )
}
