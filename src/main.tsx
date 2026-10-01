import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ConfigProvider } from './context/ConfigContext'
import { installAuthFetch } from './lib/auth'

// Attach the JWT to all /api requests + handle session expiry, app-wide.
installAuthFetch()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider>
      <App />
    </ConfigProvider>
  </StrictMode>,
)
