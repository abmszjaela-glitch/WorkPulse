import useMediaQuery from './useMediaQuery.js'
export default function useMobileNavigation() {
  return useMediaQuery('(max-width: 760px)')
}
