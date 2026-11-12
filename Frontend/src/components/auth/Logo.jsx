import logo from '../../assets/workplus-logo.png'

export default function Logo({ className = '' }) {
  return (
    <div className={className}>
      <img
        src={logo}
        alt="WorkPlus"
        width="597"
        height="196"
        className="h-auto w-[220px] max-w-full rounded-lg"
      />
    </div>
  )
}
