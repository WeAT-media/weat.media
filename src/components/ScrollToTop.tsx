import { useEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router'

export default function ScrollToTop() {
  const { pathname, hash } = useLocation()
  const navType = useNavigationType()
  const first = useRef(true)

  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    if (navType === 'POP' || hash) return
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
    document.getElementById('main-content')?.focus({ preventScroll: true })
  }, [pathname, hash, navType])

  return null
}
