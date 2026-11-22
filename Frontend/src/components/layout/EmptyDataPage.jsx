import { useState } from 'react'
import Sidebar from './Sidebar.jsx'
import PageHeader from './PageHeader.jsx'
import EmptyState from '../ui/EmptyState.jsx'

export default function EmptyDataPage({ title, message }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="dashboard-shell">
      <Sidebar open={open} onClose={() => setOpen(false)} />
      <div className="dashboard-workspace">
        <PageHeader title={title} onMenuOpen={() => setOpen(true)} />
        <main id="main-content" tabIndex={-1} className="dashboard-content">
          <EmptyState title={title}>{message}</EmptyState>
        </main>
      </div>
    </div>
  )
}
