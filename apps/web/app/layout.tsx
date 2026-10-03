import '../styles/globals.css'
import React from 'react'
import type { Metadata } from 'next'
import Providers from '@components/Providers'
import localFont from 'next/font/local'

/* Charte Ordria · typographies livrées (« Rendu Ordria », sept. 2026) :
   - Satoshi (baseline) : police de texte de l'interface
   - Expose (logo) : police de marque / display */
const satoshi = localFont({
  src: [
    { path: './fonts/Satoshi-Light.woff2', weight: '300', style: 'normal' },
    { path: './fonts/Satoshi-LightItalic.woff2', weight: '300', style: 'italic' },
    { path: './fonts/Satoshi-Regular.woff2', weight: '400', style: 'normal' },
    { path: './fonts/Satoshi-Italic.woff2', weight: '400', style: 'italic' },
    { path: './fonts/Satoshi-Medium.woff2', weight: '500', style: 'normal' },
    { path: './fonts/Satoshi-MediumItalic.woff2', weight: '500', style: 'italic' },
    { path: './fonts/Satoshi-Bold.woff2', weight: '700', style: 'normal' },
    { path: './fonts/Satoshi-BoldItalic.woff2', weight: '700', style: 'italic' },
    { path: './fonts/Satoshi-Black.woff2', weight: '900', style: 'normal' },
    { path: './fonts/Satoshi-BlackItalic.woff2', weight: '900', style: 'italic' },
  ],
  display: 'swap',
  variable: '--font-default',
})

const expose = localFont({
  src: [
    { path: './fonts/Expose-Regular.woff2', weight: '400', style: 'normal' },
    { path: './fonts/Expose-Medium.woff2', weight: '500', style: 'normal' },
    { path: './fonts/Expose-Bold.woff2', weight: '700', style: 'normal' },
    { path: './fonts/Expose-Black.woff2', weight: '900', style: 'normal' },
  ],
  display: 'swap',
  variable: '--font-expose',
})

export const metadata: Metadata = {
  title: { default: 'Ordria Learning', template: '%s' },
  description: 'Mettre de l\u2019ordre, simplement : la plateforme d\u2019apprentissage Ordria.',
  icons: {
    icon: '/favicon.ico',
    apple: '/brands/ordria/apple-touch-icon.png',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html className={`${satoshi.variable} ${expose.variable}`} lang="en" suppressHydrationWarning>
      <head>
        {/* Synchronous script · blocks parsing to guarantee window.__RUNTIME_CONFIG__ exists before any JS runs.
            Next.js <Script strategy="beforeInteractive"> is not truly blocking in all browsers (Safari). */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/runtime-config.js" />
        {/* Prevent white flash on embed routes: set html+body bg before body is painted.
            INLINED on purpose — as a file it was a synchronous render-blocking
            fetch on EVERY page for an /embed/*-only concern, delaying first
            paint by a full round-trip. Reads the optional ?bgcolor param
            (hex-validated) or defaults to dark. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              '(function(){if(!/^\\/embed\\//.test(location.pathname))return;var p=new URLSearchParams(location.search);var c=p.get(\'bgcolor\');var bg=c&&/^[0-9a-fA-F]{3,8}$/.test(c)?\'#\'+c:\'#09090b\';var s=document.createElement(\'style\');s.textContent=\'html,body{background-color:\'+bg+\'!important}\';document.head.appendChild(s);})();',
          }}
        />
      </head>
      <body suppressHydrationWarning>
        <Providers>
          <main className="animate-fade-in">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  )
}
