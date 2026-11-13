import Toggle from '../ui/Toggle.jsx'
export default function ToggleRow({
  Icon,
  title,
  description,
  checked,
  onChange,
  children,
}) {
  return (
    <div className="flex items-start gap-3 px-1 py-5 sm:px-4">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-xs font-semibold text-ink">{title}</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-strong">
          {description}
        </p>
        {children}
      </div>
      <div className="self-center">
        <Toggle label={title} checked={checked} onChange={onChange} />
      </div>
    </div>
  )
}
