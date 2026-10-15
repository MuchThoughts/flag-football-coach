'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Printer, X } from 'lucide-react'
import { usePackages, usePositions } from '@/components/PositionsContext'
import { bothSides, formationTitle, sideTitle } from '@/lib/play-flip'
import { playDiagramSvg, playFileName, type PlayDiagramTheme } from '@/lib/play-svg'
import type { Formation, PlaybookPlay, PlaybookPosition } from '@/lib/types'

export function PlayDiagram({
  play,
  formation,
  theme = 'paper',
  labels = true
}: {
  play: Pick<PlaybookPlay, 'routes' | 'footballs'> & Partial<Pick<PlaybookPlay, 'lines' | 'view' | 'lineVersion' | 'defenders' | 'mirrored'>>
  formation?: Formation
  theme?: PlayDiagramTheme
  labels?: boolean
}) {
  const positions = usePositions(formation?.packageId)
  return (
    <div
      className="play-diagram w-full overflow-hidden rounded border border-[#d8ded5]"
      style={{ aspectRatio: '2 / 1' }}
      // The markup is built from numbers, with the position labels escaped.
      dangerouslySetInnerHTML={{ __html: playDiagramSvg(play, formation, positions, theme, { labels }) }}
    />
  )
}

/** Draws an SVG onto a canvas at a given spot. */
async function drawSvg(context: CanvasRenderingContext2D, svg: string, x: number, y: number, width: number, height: number) {
  const image = new Image()
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  try {
    image.src = url
    await image.decode()
    context.drawImage(image, x, y, width, height)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Turns a play into a PNG with both sides, right above left, each under its
 * name. On a phone the share sheet offers Save Image, which is where coaches
 * expect it; anywhere else the file downloads.
 */
export async function savePlayImage(play: PlaybookPlay, formation: Formation | undefined, positions: PlaybookPosition[]) {
  const width = 1200
  const height = 600
  const bar = 48
  const sides = bothSides(play, formation, positions)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = sides.length * (bar + height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('The image could not be drawn.')
  for (let index = 0; index < sides.length; index += 1) {
    const side = sides[index]
    const top = index * (bar + height)
    context.fillStyle = '#10201a'
    context.fillRect(0, top, width, bar)
    context.fillStyle = '#ffffff'
    context.font = '900 26px Helvetica, Arial, sans-serif'
    context.textBaseline = 'middle'
    context.fillText(sideTitle(side), 18, top + bar / 2, width - 36)
    await drawSvg(context, playDiagramSvg(side, formation, positions, 'turf'), 0, top + bar, width, height)
  }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('The image could not be drawn.')

  const fileName = playFileName(play.name, 'png')
  const file = new File([blob], fileName, { type: 'image/png' })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: play.name })
      return
    } catch (error) {
      // Closing the share sheet is a choice, not a failure.
      if (error instanceof DOMException && error.name === 'AbortError') return
    }
  }

  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = fileName
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000)
}

/**
 * Whatever this wraps is what prints, in place of the app, while it is mounted.
 * On screen it stays hidden.
 */
export function PrintPortal({ page, children }: { page: string; children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    document.body.classList.add('printing')
    setMounted(true)
    return () => document.body.classList.remove('printing')
  }, [])

  if (!mounted) return null
  return createPortal(
    <div className="print-root">
      <style>{`@page { size: ${page}; margin: 0.4in; }`}</style>
      {children}
    </div>,
    document.body
  )
}

type PrintLayout = 'grid' | 'full'

/**
 * Prints the plays, one per page or six to a page. The browser's print dialog
 * has Save as PDF, which is how the playbook leaves the app.
 */
export function PrintPlaybookSheet({
  title,
  plays,
  formations,
  teamName,
  onClose
}: {
  title: string
  plays: PlaybookPlay[]
  formations: Formation[]
  teamName: string
  onClose: () => void
}) {
  const [layout, setLayout] = useState<PrintLayout>('grid')
  const [includeNotes, setIncludeNotes] = useState(true)

  const packages = usePackages()
  const formationFor = (play: PlaybookPlay) => formations.find((item) => item.id === play.formationId)
  const positionsFor = (formation?: Formation) => (packages.find((item) => item.id === formation?.packageId) || packages[0]).positions
  // Every play prints twice: its right, then its left.
  const cards = plays.flatMap((play, index) => {
    const formation = formationFor(play)
    return bothSides(play, formation, positionsFor(formation)).map((side) => ({
      key: `${play.id}-${side.side}`,
      number: `${index + 1}${side.side === 'left' ? 'L' : 'R'}`,
      play: side,
      formation
    }))
  })

  const printable = (
    <PrintPortal page={`letter ${layout === 'full' ? 'landscape' : 'portrait'}`}>
      <header className="print-header">
        <div>
          <h1>{title}</h1>
          {teamName && <p className="print-header-team">{teamName}</p>}
        </div>
        <p>
          {plays.length} play{plays.length === 1 ? '' : 's'}, right and left
        </p>
      </header>
      <div className={layout === 'full' ? 'print-full' : 'print-grid'}>
        {cards.map(({ key, number, play, formation }) => (
          <article key={key} className="print-card">
            <div className="print-card-title">
              <span className="print-card-number">{number}</span>
              <h2>{sideTitle(play)}</h2>
            </div>
            <p className="print-card-meta">
              {formation ? formationTitle(formation.name, play.mirrored) : 'No formation'} · {play.type} · {play.area}
            </p>
            <PlayDiagram play={play} formation={formation} />
            {includeNotes && play.notes && <p className="print-card-notes">{play.notes}</p>}
          </article>
        ))}
      </div>
    </PrintPortal>
  )

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-3 pb-3 sm:items-center">
        <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border border-[#d8ded5] bg-white p-3 shadow-xl safe-bottom">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-display text-xl font-black">Export Playbook</h3>
              <p className="mt-1 text-sm font-bold text-[#53665c]">
                All {plays.length} play{plays.length === 1 ? '' : 's'} in {title}, each drawn right and left. Choose Save as PDF in the print dialog
                to keep a copy.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#d8ded5]"
            >
              <X size={18} />
            </button>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            {(
              [
                { value: 'grid', label: '6 per page' },
                { value: 'full', label: '1 per page' }
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setLayout(option.value)}
                className={`rounded-lg px-3 py-2 text-sm font-black ${
                  layout === option.value ? 'bg-[#10201a] text-white' : 'bg-[#f7f5ee] text-[#53665c]'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <label className="mt-3 flex items-center gap-2 text-sm font-black">
            <input type="checkbox" checked={includeNotes} onChange={(event) => setIncludeNotes(event.target.checked)} />
            Include notes
          </label>

          <button
            type="button"
            disabled={plays.length === 0}
            onClick={() => window.print()}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-[#10201a] px-3 py-2 font-black text-white disabled:opacity-40"
          >
            <Printer size={16} />
            Print or Save PDF
          </button>
        </div>
      </div>
      {printable}
    </>
  )
}
