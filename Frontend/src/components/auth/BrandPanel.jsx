import { Check } from 'lucide-react'
import Logo from './Logo.jsx'

const FEATURES = [
  'Real-time employee status',
  'Application usage insights',
  'Reports and analytics',
]

export default function BrandPanel() {
  return (
    <aside className="hidden min-h-svh w-1/2 flex-col justify-between bg-primary-dark px-10 py-11 md:flex lg:px-14 lg:py-14">
      <Logo />

      <div className="max-w-[520px]">
        <h1 className="text-[34px] font-bold leading-[1.05] tracking-tight text-white xl:text-[44px]">
          Understand how your team works.
        </h1>
        <p className="mt-3 max-w-[440px] text-[13px] leading-relaxed text-background/80 lg:text-base">
          Track productivity, activity and application usage in one clear
          dashboard.
        </p>

        <ul className="mt-6 space-y-3">
          {FEATURES.map((feature) => (
            <li
              key={feature}
              className="flex items-center gap-3 text-sm font-medium text-white"
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full border border-success/70">
                <Check className="h-3 w-3 text-success" strokeWidth={2.5} />
              </span>
              {feature}
            </li>
          ))}
        </ul>
      </div>

      <p className="text-xs text-background/70">
        © {new Date().getFullYear()} WorkPulse
      </p>
    </aside>
  )
}
