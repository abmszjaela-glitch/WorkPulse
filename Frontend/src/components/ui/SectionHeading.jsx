export default function SectionHeading({
  title,
  subtitle,
  description,
  children,
}) {
  return (
    <div className="panel-heading">
      <div>
        <h2 className="text-base font-semibold tracking-tight text-sidebar">
          {title}
        </h2>
        {(subtitle || description) && (
          <p className="mt-1 text-xs leading-relaxed text-muted">
            {subtitle || description}
          </p>
        )}
      </div>
      {children}
    </div>
  )
}
