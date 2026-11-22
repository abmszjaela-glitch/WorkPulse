import BrandPanel from '../components/auth/BrandPanel.jsx'
import LoginForm from '../components/auth/LoginForm.jsx'
import Logo from '../components/auth/Logo.jsx'
import { useNavigate } from 'react-router-dom'
import useAuth from '../hooks/useAuth.js'

export default function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const signIn = async (credentials) => {
    await login(credentials)
    navigate('/dashboard', { replace: true })
  }
  return (
    <div className="flex min-h-svh bg-background">
      <BrandPanel />

      <main
        id="main-content"
        tabIndex={-1}
        className="flex w-full flex-col items-center justify-center gap-8 px-6 py-12 md:w-1/2 lg:px-12"
      >
        {/* Logo shown only when the brand panel is hidden (tablet / mobile) */}
        <Logo className="md:hidden" />
        <LoginForm onSubmit={signIn} />
      </main>
    </div>
  )
}
