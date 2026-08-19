import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App, { Style } from './App.jsx'
import AuthGate from './lib/AuthGate.jsx'
import { installStoragePolyfill } from './lib/storagePolyfill'

installStoragePolyfill()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Style />
    <AuthGate>
      {({ signOut }) => <App onSignOut={signOut} />}
    </AuthGate>
  </StrictMode>,
)
