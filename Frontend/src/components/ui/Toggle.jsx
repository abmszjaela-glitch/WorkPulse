export default function Toggle({ checked, onChange, label, small = false }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative shrink-0 rounded-full p-0.5 transition-colors ${small ? 'h-5 w-9' : 'h-6 w-11'} ${checked ? 'bg-primary' : 'bg-slate-200'}`}
    >
      <span
        className={`block rounded-full bg-white shadow-sm transition-transform motion-reduce:transition-none ${small ? 'size-4' : 'size-5'} ${checked ? (small ? 'translate-x-4' : 'translate-x-5') : 'translate-x-0'}`}
      />
    </button>
  )
}
