import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

export default function RouteFocus() {
  const { pathname, hash } = useLocation()
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (hash)
        document
          .getElementById(hash.slice(1))
          ?.scrollIntoView({ block: 'start' })
      else {
        window.scrollTo(0, 0)
        document.getElementById('main-content')?.focus({ preventScroll: true })
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [pathname, hash])
  return null
}
