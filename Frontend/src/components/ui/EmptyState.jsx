export default function EmptyState({ title = 'No data available', children }) {
  return (
    <div
      role="status"
      className="rounded-xl border border-line/60 bg-white px-6 py-8 text-center"
    >
      <h2 className="text-sm font-semibold text-primary-dark">{title}</h2>
      <p className="mt-2 text-xs leading-relaxed text-muted">
        {children ||
          'No backend records have been loaded. No example records or estimated metrics are displayed.'}
      </p>
    </div>
  )
}
