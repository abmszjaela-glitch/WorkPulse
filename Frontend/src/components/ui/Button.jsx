export default function Button({ variant = 'secondary', type = 'button', className = '', children, ...props }) {
  const variants = { secondary: '', primary: 'primary', danger: 'danger', destructive: 'danger-solid' }
  return <button type={type} className={`em-button ${variants[variant] || ''} disabled:cursor-not-allowed disabled:opacity-40 ${className}`} {...props}>{children}</button>
}
