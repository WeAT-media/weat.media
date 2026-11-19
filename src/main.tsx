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

// Сервер рендерит гостевую страницу на русском. Вошедшим и гостям с другим языком интерфейса
// разметка не совпадёт — для них обычный рендер вместо гидрации (иначе React #418).
let matchesSsr = true
try {
  const saved = JSON.parse(localStorage.getItem('indie-media:v1') || 'null')
  matchesSsr = !saved?.user && (saved?.prefs?.uiLang ?? 'ru') === 'ru'
} catch {
  matchesSsr = true
}

if (matchesSsr && container.hasChildNodes()) hydrateRoot(container, app)
else createRoot(container).render(app)
