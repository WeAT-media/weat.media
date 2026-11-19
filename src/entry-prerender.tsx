import { renderToString } from 'react-dom/server'
import { StaticRouter } from 'react-router'
import App from './App'
import LandingPage from './pages/LandingPage'

export function renderLanding(): string {
  return renderToString(
    <StaticRouter location="/">
      <App pages={{ Landing: LandingPage }} />
    </StaticRouter>,
  )
}
