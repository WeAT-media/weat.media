import { StrictMode } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import App from './App.tsx'

const container = document.getElementById('root')!
const app = (
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
)

let firstVisit = false
try {
  firstVisit = !localStorage.getItem('indie-media:v1')
} catch {
  firstVisit = false
}

if (firstVisit && container.hasChildNodes()) hydrateRoot(container, app)
else createRoot(container).render(app)
