import { StrictMode } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import App from './App.tsx'
import { clientPages } from '@/lib/clientPages'

const container = document.getElementById('root')!
const pages = await clientPages(window.location.pathname)
const app = (
  <StrictMode>
    <BrowserRouter>
      <App pages={pages} />
    </BrowserRouter>
  </StrictMode>
)

let guest = true
try {
  guest = !JSON.parse(localStorage.getItem('indie-media:v1') || 'null')?.user
} catch {
  guest = true
}

if (guest && container.hasChildNodes()) hydrateRoot(container, app)
else createRoot(container).render(app)
