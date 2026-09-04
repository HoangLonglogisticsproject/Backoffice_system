import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import App from './App.tsx'
import { Toaster } from './components/ui/sonner'
import { SessionProvider } from './contexts/SessionProvider'
import { LanguageProvider } from './contexts/LanguageContext'
import { queryClient } from './config/query-client'
import './index.css'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Root element not found')
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <LanguageProvider>
          <SessionProvider>
            <App />
          </SessionProvider>
        </LanguageProvider>
      </BrowserRouter>
      {/* ★ OUTSIDE THE ROUTER, ON PURPOSE. A write can navigate — changing a
          password sends you to the login screen, approving a completion closes
          the modal — and a toast mounted inside the route it was raised from
          would unmount with it. Here it outlives every navigation, so the
          receipt still arrives on the page you land on. */}
      {/* Giữa trên: một tài xế cầm điện thoại một tay đọc được ngay giữa màn
          hình, và trên bảng điều độ nó không đè lên cột thao tác bên phải. */}
      <Toaster  position="top-center" closeButton />
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  </StrictMode>,
)
