import { useEffect, useState } from 'react'
import useAuth from './useAuth.js'
import { apiRequest } from '../services/api.js'

// Requests are cancelled on filter/token changes. Polling does not extend login idle time.
export default function useApiData(
  paths,
  { refreshMs = 15000, enabled = true } = {},
) {
  const { session } = useAuth()
  const token = session?.accessToken
  const key = JSON.stringify(paths)
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState({
    key: null,
    data: {},
    errors: {},
    loading: true,
  })
  const identity = JSON.stringify([key, token, revision])
  useEffect(() => {
    if (!enabled || !token) return
    const controller = new AbortController()
    let active = true,
      timer
    const load = async () => {
      const entries = Object.entries(JSON.parse(key)).filter(([, path]) => path)
      const results = await Promise.allSettled(
        entries.map(([, path]) =>
          apiRequest(token, path, { signal: controller.signal }),
        ),
      )
      if (!active) return
      const data = {},
        errors = {}
      results.forEach((result, index) => {
        const name = entries[index][0]
        if (result.status === 'fulfilled') data[name] = result.value
        else if (result.reason.name !== 'AbortError')
          errors[name] = result.reason.message
      })
      setState({
        key: identity,
        data,
        errors,
        loading: false,
        loadedAt: new Date(),
      })
      if (refreshMs) timer = setTimeout(load, refreshMs)
    }
    void load()
    return () => {
      active = false
      controller.abort()
      clearTimeout(timer)
    }
  }, [key, identity, token, refreshMs, enabled])
  const current = state.key === identity
  return {
    data: current ? state.data : {},
    errors: current ? state.errors : {},
    loading: enabled && !current,
    loadedAt: current ? state.loadedAt : null,
    reload: () => setRevision((v) => v + 1),
  }
}
