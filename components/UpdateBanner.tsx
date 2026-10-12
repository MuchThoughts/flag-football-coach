'use client'

import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'

const running = process.env.NEXT_PUBLIC_APP_VERSION || 'dev'
const checkEvery = 5 * 60 * 1000

/**
 * A tab or home-screen app left open keeps running the version it loaded.
 * This asks the server which version is live whenever the app comes back into
 * view, and offers a reload once a newer one has been deployed.
 */
export default function UpdateBanner() {
  const [outdated, setOutdated] = useState(false)

  useEffect(() => {
    if (running === 'dev') return

    async function check() {
      try {
        const response = await fetch('/version', { cache: 'no-store' })
        const { version } = (await response.json()) as { version?: string }
        if (version && version !== 'dev' && version !== running) setOutdated(true)
      } catch {
        // Offline or mid-deploy: try again next time.
      }
    }

    function onVisible() {
      if (document.visibilityState === 'visible') check()
    }

    check()
    const timer = window.setInterval(check, checkEvery)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', check)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', check)
    }
  }, [])

  if (!outdated) return null

  return (
    <div className="sticky top-12 z-30 bg-[#f7c948] text-[#10201a] shadow">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-3 py-1.5 sm:px-6">
        <p className="text-sm font-black">A new version of Flag Coach is ready.</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[#10201a] px-3 py-1.5 text-sm font-black text-white"
        >
          <RefreshCw size={14} />
          Reload
        </button>
      </div>
    </div>
  )
}
