import '../styles/globals.css'
import React from 'react'
import Providers from '@components/Providers'
import { Nunito } from 'next/font/google'

const nunito = Nunito({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-default',
  weight: ['400', '600', '700', '800', '900'],
})

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html className={nunito.variable} lang="en" suppressHydrationWarning>
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
