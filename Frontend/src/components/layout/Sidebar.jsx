import { Link, useLocation } from 'react-router-dom'
import { Activity, Building2, FileBarChart, LayoutDashboard, LayoutGrid, LogOut, Settings, UserRound, UsersRound, X } from 'lucide-react'
import Logo from '../auth/Logo.jsx'

const navigation = [
  ['Dashboard', LayoutDashboard, '/dashboard'], ['Employees', UsersRound, '/employees'],
  ['Activity Details', Activity, '/activity-details'], ['Application Usage', LayoutGrid, '/application-usage'],
  ['Departments', Building2, '/departments'], ['Reports & Analytics', FileBarChart, '/reports'],
]
export default function Sidebar({ open, onClose, onNotice }) {
  const { pathname, hash } = useLocation()
  return <>
    {open && <button className="sidebar-overlay" aria-label="Close navigation" onClick={onClose} />}
    <aside className={`dashboard-sidebar ${open ? 'is-open' : ''}`}>
      <div className="sidebar-brand"><Logo /><button className="mobile-close icon-button" aria-label="Close navigation" onClick={onClose}><X size={20} /></button></div>
      <nav aria-label="Main navigation">{navigation.map(([label, Icon, target]) => {
        const selected = target === '/employees' ? pathname === target : target === '/dashboard' ? pathname === target && !hash : `${pathname}${hash}` === target && label !== 'Reports & Analytics'
        return <Link key={label} to={target} className={selected ? 'selected' : ''} aria-current={selected ? 'page' : undefined} onClick={onClose}><Icon size={19} />{label}</Link>
      })}<button onClick={() => onNotice('Settings will be available when your organization is connected.')}><Settings size={19} />Settings</button></nav>
      <div className="sidebar-account"><span className="account-avatar"><UserRound size={17} /></span><div><strong>Admin preview</strong><small>Administrator</small></div><Link to="/login" aria-label="Go to login"><LogOut size={18} /></Link></div>
    </aside>
  </>
}
