import BrandPanel from '../components/auth/BrandPanel.jsx'
import LoginForm from '../components/auth/LoginForm.jsx'
import Logo from '../components/auth/Logo.jsx'

export default function LoginPage() {
  return (
    <div className="flex min-h-svh bg-background">
      <BrandPanel />

      <main className="flex w-full flex-col items-center justify-center gap-8 px-6 py-12 md:w-1/2 lg:px-12">
        {/* Logo shown only when the brand panel is hidden (tablet / mobile) */}
        <Logo className="md:hidden" />
        <LoginForm />
      </main>
    </div>
  )
}
