import { X } from 'lucide-react'
export default function Notice({ children, onDismiss }) {
  if (!children) return null
  return (
    <div className="dashboard-notice" role="status">
      <span>{children}</span>
      <button
        type="button"
        aria-label="Dismiss message"
        onClick={onDismiss}
        className="shrink-0 rounded-md p-1 hover:bg-primary/10"
      >
        <X size={17} />
      </button>
    </div>
  )
}
