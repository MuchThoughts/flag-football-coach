import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Flag Coach',
  description: 'Youth flag football roster, lineup, and game-day planning app',
  icons: {
    icon: '/icon.svg'
  }
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
