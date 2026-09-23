import '../styles/globals.css'
import React from 'react'
import type { Metadata } from 'next'
import Providers from '@components/Providers'
import localFont from 'next/font/local'

/* Charte Ordria — typographies livrées (« Rendu Ordria », sept. 2026) :
   - Satoshi (baseline) : police de texte de l'interface
   - Expose (logo) : police de marque / display */
const satoshi = localFont({
  src: [
    { path: './fonts/Satoshi-Light.otf', weight: '300', style: 'normal' },
    { path: './fonts/Satoshi-LightItalic.otf', weight: '300', style: 'italic' },
    { path: './fonts/Satoshi-Regular.otf', weight: '400', style: 'normal' },
    { path: './fonts/Satoshi-Italic.otf', weight: '400', style: 'italic' },
    { path: './fonts/Satoshi-Medium.otf', weight: '500', style: 'normal' },
    { path: './fonts/Satoshi-MediumItalic.otf', weight: '500', style: 'italic' },
    { path: './fonts/Satoshi-Bold.otf', weight: '700', style: 'normal' },
    { path: './fonts/Satoshi-BoldItalic.otf', weight: '700', style: 'italic' },
    { path: './fonts/Satoshi-Black.otf', weight: '900', style: 'normal' },
    { path: './fonts/Satoshi-BlackItalic.otf', weight: '900', style: 'italic' },
  ],
  display: 'swap',
  variable: '--font-default',
})

const expose = localFont({
  src: [
    { path: './fonts/Expose-Regular.otf', weight: '400', style: 'normal' },
    { path: './fonts/Expose-Medium.otf', weight: '500', style: 'normal' },
    { path: './fonts/Expose-Bold.otf', weight: '700', style: 'normal' },
    { path: './fonts/Expose-Black.otf', weight: '900', style: 'normal' },
  ],
  display: 'swap',
  variable: '--font-expose',
})

export const metadata: Metadata = {
  title: { default: 'Ordria Learning', template: '%s' },
  description: 'Mettre de l\u2019ordre, simplement — la plateforme d\u2019apprentissage Ordria.',
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
        {/* Synchronous script — blocks parsing to guarantee window.__RUNTIME_CONFIG__ exists before any JS runs.
            Next.js <Script strategy="beforeInteractive"> is not truly blocking in all browsers (Safari). */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/runtime-config.js" />
        {/* Prevent white flash on embed routes: set html+body bg before body is painted.
            Reads the optional ?bgcolor param (hex-validated) or defaults to dark. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/embed-bg.js" />
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
