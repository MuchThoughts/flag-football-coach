import type { MetadataRoute } from 'next'

/** Lets the app be added to a home screen or the Dock and open in its own window. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Flag Coach',
    short_name: 'Flag Coach',
    description: 'Youth flag football roster, lineup, and game-day planning app',
    start_url: '/playbooks',
    scope: '/',
    display: 'standalone',
    background_color: '#f7f5ee',
    theme_color: '#10201a',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }
    ]
  }
}
