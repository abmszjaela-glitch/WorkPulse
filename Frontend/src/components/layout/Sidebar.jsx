import { Link, useLocation } from 'react-router-dom'
import { useEffect, useRef } from 'react'
import {
  Activity,
  Building2,
  FileBarChart,
  LayoutDashboard,
  LayoutGrid,
  LogOut,
  Settings,
  UsersRound,
  X,
} from 'lucide-react'
import Logo from '../auth/Logo.jsx'
import ProfileLink from './ProfileLink.jsx'
import useProfile from '../../hooks/useProfile.js'
import useMobileNavigation from '../../hooks/useMobileNavigation.js'

const navigation = [
  ['Dashboard', LayoutDashboard, '/dashboard'],
  ['Employees', UsersRound, '/employees'],
  ['Activity Details', Activity, '/activity-details'],
  ['Application Usage', LayoutGrid, '/application-usage'],
  ['Departments', Building2, '/departments'],
  ['Reports & Analytics', FileBarChart, '/reports'],
  ['Settings', Settings, '/settings'],
]
export default function Sidebar({ open, onClose }) {
  const { pathname } = useLocation()
  const { profile } = useProfile()
  const mobile = useMobileNavigation()
  const sidebar = useRef(null)
  useEffect(() => {
    if (!open || !mobile) return
    const trigger = document.activeElement
    const previousOverflow = document.body.style.overflow
    const workspace = document.querySelector('.dashboard-workspace')
    document.body.style.overflow = 'hidden'
    if (workspace) workspace.inert = true
    sidebar.current.querySelector('button')?.focus()
    return () => {
      document.body.style.overflow = previousOverflow
      if (workspace) workspace.inert = false
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus()
    }
  }, [open, mobile])
  const handleKey = (event) => {
    if (!mobile || !open) return
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Tab') return
    const items = [...sidebar.current.querySelectorAll('a, button')].filter(
      (item) => item.getClientRects().length,
    )
    const first = items[0],
      last = items.at(-1)
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    }
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }
  return (
    <>
      {open && (
        <button
          className="sidebar-overlay"
          aria-label="Close navigation"
          onClick={onClose}
        />
      )}
      <aside
        ref={sidebar}
        id="main-sidebar"
        aria-label="Main navigation panel"
        role={mobile && open ? 'dialog' : undefined}
        aria-hidden={mobile && !open ? true : undefined}
        aria-modal={mobile && open ? true : undefined}
        inert={mobile && !open}
        onKeyDown={handleKey}
        className={`dashboard-sidebar ${open ? 'is-open' : ''}`}
      >
        <div className="sidebar-brand">
          <Logo />
          <button
            className="mobile-close icon-button"
            aria-label="Close navigation"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        <nav aria-label="Main navigation">
          {navigation.map(([label, Icon, target]) => {
            const selected = pathname === target
            return (
              <Link
                key={label}
                to={target}
                className={selected ? 'selected' : ''}
                aria-current={selected ? 'page' : undefined}
                onClick={onClose}
              >
                <Icon size={19} />
                {label}
              </Link>
            )
          })}
        </nav>
        <div className="sidebar-account">
          <ProfileLink />
          <Link to="/profile" className="min-w-0 !ml-0 !p-0">
            <strong className="truncate">
              {profile.firstName} {profile.lastName}
            </strong>
            <small>Administrator · Preview</small>
          </Link>
          <Link to="/login" aria-label="Go to login">
            <LogOut size={18} />
          </Link>
        </div>
      </aside>
    </>
  )
}
