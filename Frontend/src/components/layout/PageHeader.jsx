import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bell, CalendarDays, Menu, Search, X } from 'lucide-react'
import ProfileLink from './ProfileLink.jsx'

export default function PageHeader({ title, subtitle, search, date, onMenuOpen }) {
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const notifications = useRef(null)
  const trigger = useRef(null)
  useEffect(() => {
    if (!notificationsOpen) return
    const dismiss = (event) => {
      if (event.type === 'keydown' && event.key === 'Escape') { setNotificationsOpen(false); trigger.current?.focus() }
      if (event.type === 'pointerdown' && !notifications.current?.contains(event.target)) setNotificationsOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', dismiss)
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', dismiss) }
  }, [notificationsOpen])
  return <header className="dashboard-header">
    <button type="button" className="mobile-menu icon-button" aria-label="Open navigation" aria-controls="main-sidebar" onClick={onMenuOpen}><Menu /></button>
    <div className="page-title min-w-0"><h1>{title}</h1><p>{subtitle}</p></div>
    <div className="header-actions">
      {search && <label className="employee-search min-w-0"><Search size={17} className="shrink-0" /><input type="search" aria-label={search.label} placeholder={search.placeholder || search.label} value={search.value} onChange={(event) => search.onChange(event.target.value)} /></label>}
      {date && <span className="date-badge whitespace-nowrap"><CalendarDays size={16} />{date}</span>}
      <div ref={notifications} className="relative">
        <button type="button" ref={trigger} className="icon-button rounded-lg hover:bg-soft" aria-label="Notifications" aria-expanded={notificationsOpen} aria-controls="notification-panel" onClick={() => setNotificationsOpen((value) => !value)}><Bell size={19} /></button>
        {notificationsOpen && <section id="notification-panel" aria-label="Notifications" className="absolute right-0 top-full z-40 mt-3 w-64 rounded-xl border border-line bg-white p-4 shadow-floating"><div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Notifications</h2><button aria-label="Close notifications" onClick={() => setNotificationsOpen(false)}><X size={16} /></button></div><p className="my-4 text-xs leading-relaxed text-muted">No live notification service is connected. You can save your preferred alerts in Settings.</p><Link to="/settings#settings-notifications" onClick={() => setNotificationsOpen(false)} className="text-xs font-medium text-primary">Manage notification preferences</Link></section>}
      </div>
      <ProfileLink />
    </div>
  </header>
}
