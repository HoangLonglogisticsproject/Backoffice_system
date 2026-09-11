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
import { registerStaleChunkReload } from './utils/staleChunkReload'
/**
 * ★ IMPORTED FROM JS, NOT `@import`ed IN index.css.
 *
 * Tailwind v4's PostCSS plugin resolves `@import` itself and inlines the
 * package's CSS WITHOUT rebasing its relative `url()`s, so
 * `url(./files/geist-*.woff2)` survived verbatim into the built stylesheet.
 * The browser resolved it against the stylesheet's own directory —
 * `/assets/files/...` — which no build ever emitted, and the SPA rewrite
 * answered the 404 with `index.html`. The font parser read that HTML's first
 * four bytes, `<!do`, as an sfntVersion of 1008821359 and refused it.
 *
 * Imported here, Vite processes the package's stylesheet as a module: the
 * urls resolve against the file that wrote them, and the woff2 land in the
 * build fingerprinted.
 */
import '@fontsource-variable/geist'
import './index.css'

// A tab left open across a deploy asks for a chunk filename the new build no
// longer emits. Registered before anything can trigger it. See the module.
registerStaleChunkReload()

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
