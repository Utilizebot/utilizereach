import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ConfigProvider } from './context/ConfigContext'
import { installAuthFetch } from './lib/auth'

// Attach the JWT to every /api request (and handle session expiry) BEFORE
// anything renders or fetches: the backend requires auth on every data route,
// and the token also selects the active brand.
installAuthFetch()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider>
      <App />
    </ConfigProvider>
  </StrictMode>,
)
