import { renderToString } from 'react-dom/server'
import { StaticRouter } from 'react-router'
import App from './App'

export function renderLanding(): string {
  return renderToString(
    <StaticRouter location="/">
      <App />
    </StaticRouter>,
  )
}
