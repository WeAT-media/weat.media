import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { captureUtm, stripUtm } from '@/lib/utm'

/** Захватывает utm_* с любой страницы и убирает их из адреса (replace — без лишней записи в истории) */
export default function UtmCapture() {
  const { pathname, search, hash } = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    const params = new URLSearchParams(search)
    const rest = stripUtm(params)
    if (!rest) return
    captureUtm(params)
    const q = rest.toString()
    navigate(`${pathname}${q ? `?${q}` : ''}${hash}`, { replace: true })
  }, [pathname, search, hash, navigate])

  return null
}
