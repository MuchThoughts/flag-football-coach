import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Flag Coach',
  description: 'Youth flag football roster, lineup, and game-day planning app',
  applicationName: 'Flag Coach',
  icons: {
    icon: '/icon.svg',
    apple: '/apple-touch-icon.png'
  },
  // Added to an iPhone or iPad home screen, the app opens full screen without Safari's bars.
  appleWebApp: {
    capable: true,
    title: 'Flag Coach',
    statusBarStyle: 'default'
  }
}

export const viewport: Viewport = {
  themeColor: '#10201a'
}

export default function RootLayout({
  children
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
