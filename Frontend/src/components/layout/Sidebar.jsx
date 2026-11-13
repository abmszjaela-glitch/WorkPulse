import { Link, useLocation } from 'react-router-dom'
import { Activity, Building2, FileBarChart, LayoutDashboard, LayoutGrid, LogOut, Settings, UsersRound, X } from 'lucide-react'
import Logo from '../auth/Logo.jsx'
import ProfileLink from './ProfileLink.jsx'
import useProfile from '../../hooks/useProfile.js'

const navigation = [
  ['Dashboard', LayoutDashboard, '/dashboard'], ['Employees', UsersRound, '/employees'],
  ['Activity Details', Activity, '/activity-details'], ['Application Usage', LayoutGrid, '/application-usage'],
  ['Departments', Building2, '/departments'], ['Reports & Analytics', FileBarChart, '/reports'],
  ['Settings', Settings, '/settings'],
]
export default function Sidebar({ open, onClose }) {
  const { pathname } = useLocation()
  const { profile } = useProfile()
  return <>
    {open && <button className="sidebar-overlay" aria-label="Close navigation" onClick={onClose} />}
    <aside className={`dashboard-sidebar ${open ? 'is-open' : ''}`}>
      <div className="sidebar-brand"><Logo /><button className="mobile-close icon-button" aria-label="Close navigation" onClick={onClose}><X size={20} /></button></div>
      <nav aria-label="Main navigation">{navigation.map(([label, Icon, target]) => {
        const selected = pathname === target
        return <Link key={label} to={target} className={selected ? 'selected' : ''} aria-current={selected ? 'page' : undefined} onClick={onClose}><Icon size={19} />{label}</Link>
      })}</nav>
      <div className="sidebar-account"><ProfileLink /><Link to="/profile" className="min-w-0 !ml-0 !p-0"><strong className="truncate">{profile.firstName} {profile.lastName}</strong><small>Administrator · Preview</small></Link><Link to="/login" aria-label="Go to login"><LogOut size={18} /></Link></div>
    </aside>
  </>
}
