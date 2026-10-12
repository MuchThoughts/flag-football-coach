'use client'

import { useEffect, useRef, useState } from 'react'
import { Maximize, Minus, Plus, Trash2 } from 'lucide-react'
import {
  bendThrough,
  DEFAULT_VIEW,
  frameScale,
  insertPivot,
  LINE_KINDS,
  lineEnd,
  linePath,
  lineStart,
  LINE_STYLES,
  motionEnd,
  movePoint,
  newLine,
  pathData,
  removePivot,
  segmentData,
  segmentMiddle,
  setBend,
  toWorld,
  viewBox,
  zoomAround,
  clampView
} from '@/lib/play-lines'
import type { FieldPoint, PlayLine, PlayLineKind, PlaybookPosition, PlayFootball, PlayRoute, PlayView, SlotPositions } from '@/lib/types'

/** Pointer travel, in screen pixels, before a press counts as a drag. */
const dragSlop = 5
const longPress = 500
/** Two presses on the same thing within this long, and this close, are a double-click. */
const doubleTapWindow = 350
const doubleTapDistance = 12
const reach = { x: -500, y: -400, w: 1200, h: 900 }

type Drag =
  | { kind: 'pan'; startX: number; startY: number; startView: PlayView; pixelsPerWorld: number; moved: boolean }
  | { kind: 'point'; lineId: string; index: number }
  | { kind: 'bend'; lineId: string; segment: number }
  | { kind: 'segment'; lineId: string; segment: number; startX: number; startY: number; point: FieldPoint }

function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function round(value: number) {
  return Math.round(value * 100) / 100
}

function capturePointer(element: Element, pointerId: number) {
  try {
    element.setPointerCapture(pointerId)
  } catch {
    // The drag still tracks through the element's own events.
  }
}

/**
 * The play editor's field. Players stay put; lines come out of them.
 *
 * - Drag empty grass to move around; wheel, pinch or the buttons to zoom.
 * - Tap a player for the menu: Block, Motion, Route, Run, Fake.
 * - Tap a line to select it. Drag its end (or any pivot) to reshape it.
 * - Double-click or hold on a line to add a pivot there; double-click a pivot to remove it.
 * - Drag the yellow dot in the middle of a segment to curve it.
 */
export default function PlayCanvas({
  players,
  spots,
  scrimmage,
  lines,
  onLinesChange,
  view,
  onViewChange,
  legacyRoutes = [],
  legacyFootballs = []
}: {
  players: PlaybookPosition[]
  spots: SlotPositions
  /** Where the line of scrimmage sits. */
  scrimmage: number
  lines: PlayLine[]
  onLinesChange: (lines: PlayLine[]) => void
  view: PlayView
  onViewChange: (view: PlayView) => void
  legacyRoutes?: PlayRoute[]
  legacyFootballs?: PlayFootball[]
}) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const pointersRef = useRef(new Map<number, { x: number; y: number }>())
  const pinchRef = useRef<{ distance: number; startView: PlayView; anchor: FieldPoint } | null>(null)
  const pressTimerRef = useRef<number | null>(null)
  const lastTapRef = useRef<{ key: string; at: number; x: number; y: number } | null>(null)
  const viewRef = useRef(view)
  viewRef.current = view
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null)
  const [selectedLine, setSelectedLine] = useState<string | null>(null)

  const box = viewBox(view)
  const scale = frameScale(view)
  const selected = lines.find((item) => item.id === selectedLine)
  const player = players.find((item) => item.code === selectedPlayer)

  function toField(clientX: number, clientY: number): FieldPoint {
    const svg = svgRef.current
    const matrix = svg?.getScreenCTM()
    if (!svg || !matrix) return { x: 50, y: 50 }
    const point = svg.createSVGPoint()
    point.x = clientX
    point.y = clientY
    const world = point.matrixTransform(matrix.inverse())
    return { x: round(world.x / 2), y: round(world.y) }
  }

  function updateLine(lineId: string, change: (line: PlayLine) => PlayLine) {
    onLinesChange(lines.map((item) => (item.id === lineId ? change(item) : item)))
  }

  function startOf(line: PlayLine) {
    return lineStart(line, spots, lines)
  }

  function cancelPress() {
    if (pressTimerRef.current) {
      window.clearTimeout(pressTimerRef.current)
      pressTimerRef.current = null
    }
  }

  function addPivot(lineId: string, segment: number, point: FieldPoint) {
    updateLine(lineId, (line) => insertPivot(line, segment, point))
    setSelectedLine(lineId)
    setSelectedPlayer(null)
  }

  function startPan(clientX: number, clientY: number, moved: boolean): Drag {
    const rect = svgRef.current?.getBoundingClientRect()
    return {
      kind: 'pan',
      startX: clientX,
      startY: clientY,
      startView: viewRef.current,
      pixelsPerWorld: rect ? rect.width / viewBox(viewRef.current).w : 4,
      moved
    }
  }

  // The wheel zooms around the pointer. React's wheel events are passive, so listen directly.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    function onWheel(event: WheelEvent) {
      event.preventDefault()
      const factor = Math.exp(-event.deltaY * 0.0015)
      onViewChange(zoomAround(viewRef.current, factor, toField(event.clientX, event.clientY)))
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onViewChange])

  useEffect(() => cancelPress, [])

  function handlePointerDown(event: React.PointerEvent<SVGSVGElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.preventDefault()
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    capturePointer(event.currentTarget, event.pointerId)

    // A second finger turns whatever was happening into a pinch.
    if (pointersRef.current.size === 2) {
      cancelPress()
      dragRef.current = null
      const [a, b] = Array.from(pointersRef.current.values())
      pinchRef.current = {
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        startView: viewRef.current,
        anchor: toField((a.x + b.x) / 2, (a.y + b.y) / 2)
      }
      return
    }
    if (pointersRef.current.size > 2) return

    const target = event.target as Element
    const point = target.closest('[data-point]')?.getAttribute('data-point')
    const bend = target.closest('[data-bend]')?.getAttribute('data-bend')
    const segment = target.closest('[data-seg]')?.getAttribute('data-seg')
    const code = target.closest('[data-player]')?.getAttribute('data-player')

    // Pointer capture sends the browser's own double-click to the field, so spot them here.
    const key = point ? `point:${point}` : bend ? `seg:${bend}` : segment ? `seg:${segment}` : ''
    const last = lastTapRef.current
    const now = Date.now()
    if (
      key &&
      last &&
      last.key === key &&
      now - last.at < doubleTapWindow &&
      Math.hypot(event.clientX - last.x, event.clientY - last.y) < doubleTapDistance
    ) {
      lastTapRef.current = null
      cancelPress()
      dragRef.current = null
      handleDoubleTap(key, toField(event.clientX, event.clientY))
      return
    }
    lastTapRef.current = key ? { key, at: now, x: event.clientX, y: event.clientY } : null

    if (point) {
      const [lineId, index] = point.split('|')
      setSelectedLine(lineId)
      setSelectedPlayer(null)
      dragRef.current = { kind: 'point', lineId, index: Number(index) }
      return
    }
    if (bend) {
      const [lineId, index] = bend.split('|')
      dragRef.current = { kind: 'bend', lineId, segment: Number(index) }
      return
    }
    if (segment) {
      const [lineId, index] = segment.split('|')
      const at = toField(event.clientX, event.clientY)
      setSelectedLine(lineId)
      setSelectedPlayer(null)
      dragRef.current = { kind: 'segment', lineId, segment: Number(index), startX: event.clientX, startY: event.clientY, point: at }
      cancelPress()
      // Holding on a line drops a pivot there.
      pressTimerRef.current = window.setTimeout(() => {
        pressTimerRef.current = null
        navigator.vibrate?.(15)
        addPivot(lineId, Number(index), at)
        dragRef.current = null
      }, longPress)
      return
    }
    if (code) {
      setSelectedPlayer(code)
      setSelectedLine(null)
      dragRef.current = null
      return
    }
    dragRef.current = startPan(event.clientX, event.clientY, false)
  }

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
    if (!pointersRef.current.has(event.pointerId)) return
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })

    const pinch = pinchRef.current
    if (pinch && pointersRef.current.size >= 2) {
      const [a, b] = Array.from(pointersRef.current.values())
      const distance = Math.hypot(a.x - b.x, a.y - b.y)
      if (pinch.distance > 0) onViewChange(zoomAround(pinch.startView, distance / pinch.distance, pinch.anchor))
      return
    }

    const drag = dragRef.current
    if (!drag) return

    if (drag.kind === 'segment') {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < dragSlop) return
      cancelPress()
      dragRef.current = startPan(drag.startX, drag.startY, true)
      return
    }

    if (drag.kind === 'pan') {
      const dx = event.clientX - drag.startX
      const dy = event.clientY - drag.startY
      if (!drag.moved && Math.hypot(dx, dy) < dragSlop) return
      drag.moved = true
      onViewChange(
        clampView({
          zoom: drag.startView.zoom,
          x: drag.startView.x - dx / drag.pixelsPerWorld / 2,
          y: drag.startView.y - dy / drag.pixelsPerWorld
        })
      )
      return
    }

    const at = toField(event.clientX, event.clientY)
    if (drag.kind === 'point') {
      updateLine(drag.lineId, (line) => movePoint(line, drag.index, at))
      return
    }
    // Pulling a segment's middle curves it through the pointer.
    updateLine(drag.lineId, (line) => {
      const start = startOf(line)
      if (!start) return line
      const path = linePath(line, start)
      return setBend(line, drag.segment, bendThrough(path[drag.segment], path[drag.segment + 1], at))
    })
  }

  function handlePointerUp(event: React.PointerEvent<SVGSVGElement>) {
    pointersRef.current.delete(event.pointerId)
    if (pointersRef.current.size < 2) pinchRef.current = null
    if (pointersRef.current.size > 0) return
    cancelPress()
    const drag = dragRef.current
    dragRef.current = null
    // A tap on empty grass lets go of whatever was selected.
    if (drag?.kind === 'pan' && !drag.moved) {
      setSelectedLine(null)
      setSelectedPlayer(null)
    }
  }

  /** Double-clicking a line adds a pivot there; double-clicking a pivot takes it out. */
  function handleDoubleTap(key: string, at: FieldPoint) {
    const [kind, ref] = key.split(':')
    const [lineId, index] = ref.split('|')
    if (kind === 'point') {
      updateLine(lineId, (line) => removePivot(line, Number(index)))
    } else {
      addPivot(lineId, Number(index), at)
    }
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      setSelectedLine(null)
      setSelectedPlayer(null)
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && selectedLine) {
      event.preventDefault()
      deleteLine(selectedLine)
    }
  }

  function addLine(kind: PlayLineKind) {
    if (!selectedPlayer || !spots[selectedPlayer]) return
    const start = kind === 'motion' ? spots[selectedPlayer] : motionEnd(lines, selectedPlayer) || spots[selectedPlayer]
    const line = newLine(uid('line'), kind, selectedPlayer, start)
    onLinesChange([...lines, line])
    setSelectedLine(line.id)
    setSelectedPlayer(null)
  }

  /** A motion takes the lines that started from it back to the player. */
  function deleteLine(lineId: string) {
    onLinesChange(lines.filter((item) => item.id !== lineId))
    setSelectedLine(null)
  }

  function changeKind(kind: PlayLineKind) {
    if (!selected || selected.kind === 'motion' || kind === 'motion') return
    updateLine(selected.id, (line) => ({ ...line, kind }))
  }

  const ordered = [...lines.filter((item) => item.id !== selectedLine), ...(selected ? [selected] : [])]
  const playerHasMotion = selectedPlayer ? lines.some((item) => item.kind === 'motion' && item.playerCode === selectedPlayer) : false
  const playerLines = selectedPlayer ? lines.filter((item) => item.playerCode === selectedPlayer) : []
  const fontSize = (label: string) => (label.length > 2 ? 2.7 : label.length > 1 ? 3.4 : 4.2)
  const menuButton = 'rounded-md px-2.5 py-1 text-xs font-black'
  const zoomButton = 'flex h-7 w-7 items-center justify-center rounded-md bg-black/45 text-white hover:bg-black/60'

  return (
    <div className="space-y-1" onKeyDown={handleKeyDown}>
      <div
        className="relative w-full overflow-hidden rounded-lg border-4 border-[#f6f2df] shadow-field outline-none focus-visible:ring-2 focus-visible:ring-[#f7c948]"
        style={{ aspectRatio: '2 / 1', touchAction: 'none' }}
        tabIndex={0}
      >
        <svg
          ref={svgRef}
          viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
          className="absolute inset-0 h-full w-full select-none"
          style={{ cursor: 'grab' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onContextMenu={(event) => event.preventDefault()}
          aria-label="Play field"
        >
          <rect x={reach.x} y={reach.y} width={reach.w} height={reach.h} fill="#1f7a4d" />
          {Array.from({ length: reach.w / 20 + 1 }, (_, index) => reach.x + index * 20).map((x) => (
            <line key={x} x1={x} y1={reach.y} x2={x} y2={reach.y + reach.h} stroke="rgba(246,242,223,0.22)" strokeWidth={0.4 * scale} />
          ))}
          <line x1={reach.x} y1={scrimmage} x2={reach.x + reach.w} y2={scrimmage} stroke="rgba(246,242,223,0.75)" strokeWidth={0.5 * scale} />

          {legacyRoutes.map((route) => (
            <polyline
              key={route.id}
              points={route.points.map((point) => `${point.x * 2},${point.y}`).join(' ')}
              fill="none"
              stroke="#10201a"
              strokeWidth={1.1 * scale}
              strokeDasharray={route.style === 'dashed' ? `${3 * scale} ${2.2 * scale}` : undefined}
              opacity={0.6}
              style={{ pointerEvents: 'none' }}
            />
          ))}

          {ordered.map((item) => {
            const start = startOf(item)
            if (!start || item.points.length === 0) return null
            const style = LINE_STYLES[item.kind]
            const isSelected = item.id === selectedLine
            const path = linePath(item, start)
            const end = toWorld(path[path.length - 1])
            return (
              <g key={item.id}>
                {isSelected && (
                  <path d={pathData(item, start)} fill="none" stroke="#f7c948" strokeWidth={(style.width + 2.4) * scale} strokeLinecap="round" strokeLinejoin="round" opacity={0.95} style={{ pointerEvents: 'none' }} />
                )}
                {item.kind === 'run' && (
                  <path d={pathData(item, start)} fill="none" stroke="rgba(246,242,223,0.55)" strokeWidth={(style.width + 0.9) * scale} strokeLinecap="round" strokeLinejoin="round" style={{ pointerEvents: 'none' }} />
                )}
                <path
                  d={pathData(item, start)}
                  fill="none"
                  stroke={style.color}
                  strokeWidth={style.width * scale}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={style.dash ? style.dash.split(' ').map((part) => Number(part) * scale).join(' ') : undefined}
                  style={{ pointerEvents: 'none' }}
                />
                <g style={{ pointerEvents: 'none' }} dangerouslySetInnerHTML={{ __html: lineEnd(item, start, scale) }} />
                {path.slice(1).map((to, segment) => (
                  <path
                    key={segment}
                    data-seg={`${item.id}|${segment}`}
                    d={segmentData(path[segment], to, item.bends[segment])}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={4 * scale}
                    strokeLinecap="round"
                    style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                  />
                ))}
                {/* The end can always be grabbed, selected or not. */}
                {item.kind !== 'motion' && (
                  <circle data-point={`${item.id}|${item.points.length - 1}`} cx={end.x} cy={end.y} r={2.6 * scale} fill="transparent" style={{ cursor: 'move' }} />
                )}
              </g>
            )
          })}

          {players.map((slot) => {
            const spot = spots[slot.code]
            if (!spot) return null
            const { x, y } = toWorld(spot)
            const isSelected = slot.code === selectedPlayer
            return (
              <g key={slot.code} data-player={slot.code} style={{ cursor: 'pointer' }}>
                {isSelected && <circle cx={x} cy={y} r={6.2} fill="none" stroke="#f7c948" strokeWidth={1.6} />}
                <circle cx={x} cy={y} r={4.4} fill="#fff" stroke="#10201a" strokeWidth={0.8} />
                <text x={x} y={y} dy="0.36em" textAnchor="middle" fontFamily="Helvetica, Arial, sans-serif" fontWeight={900} fontSize={fontSize(slot.label)} fill="#10201a" style={{ pointerEvents: 'none' }}>
                  {slot.label}
                </text>
              </g>
            )
          })}

          {/* A motion ends in a dashed copy of the player, dragged to wherever they go. */}
          {lines
            .filter((item) => item.kind === 'motion' && item.points.length > 0)
            .map((item) => {
              const slot = players.find((position) => position.code === item.playerCode)
              if (!slot || !spots[slot.code]) return null
              const { x, y } = toWorld(item.points[item.points.length - 1])
              return (
                <g key={`ghost-${item.id}`} data-point={`${item.id}|${item.points.length - 1}`} style={{ cursor: 'move' }}>
                  {item.id === selectedLine && <circle cx={x} cy={y} r={6.2} fill="none" stroke="#f7c948" strokeWidth={1.6} />}
                  <circle cx={x} cy={y} r={4.4} fill="#fff" fillOpacity={0.75} stroke="#10201a" strokeWidth={0.7} strokeDasharray="1.6 1.2" />
                  <text x={x} y={y} dy="0.36em" textAnchor="middle" fontFamily="Helvetica, Arial, sans-serif" fontWeight={900} fontSize={fontSize(slot.label)} fill="#10201a" fillOpacity={0.75} style={{ pointerEvents: 'none' }}>
                    {slot.label}
                  </text>
                </g>
              )
            })}

          {legacyFootballs.map((ball) => (
            <ellipse key={ball.id} cx={ball.x * 2} cy={ball.y} rx={3.6} ry={2.3} fill="#8a4b23" stroke="#2f1b0d" strokeWidth={0.5} style={{ pointerEvents: 'none' }} />
          ))}

          {/* Handles for the selected line: pivots and its end, and a curve dot on every segment. */}
          {selected &&
            (() => {
              const start = startOf(selected)
              if (!start) return null
              const path = linePath(selected, start)
              return (
                <g>
                  {path.slice(1).map((to, segment) => {
                    const middle = toWorld(segmentMiddle(path[segment], to, selected.bends[segment]))
                    return (
                      <circle
                        key={`bend-${segment}`}
                        data-bend={`${selected.id}|${segment}`}
                        cx={middle.x}
                        cy={middle.y}
                        r={1.3 * scale}
                        fill="#f7c948"
                        stroke="#10201a"
                        strokeWidth={0.45 * scale}
                        style={{ cursor: 'grab' }}
                      />
                    )
                  })}
                  {selected.points.map((point, index) => {
                    const isEnd = index === selected.points.length - 1
                    if (isEnd && selected.kind === 'motion') return null
                    const { x, y } = toWorld(point)
                    return (
                      <circle
                        key={`point-${index}`}
                        data-point={`${selected.id}|${index}`}
                        cx={x}
                        cy={y}
                        r={(isEnd ? 1.9 : 1.5) * scale}
                        fill="#fff"
                        stroke="#10201a"
                        strokeWidth={0.5 * scale}
                        style={{ cursor: 'move' }}
                      />
                    )
                  })}
                </g>
              )
            })()}
        </svg>

        <div className="absolute right-1.5 top-1.5 z-10 flex items-center gap-1">
          <button type="button" onClick={() => onViewChange(zoomAround(view, 1 / 1.25, { x: view.x, y: view.y }))} aria-label="Zoom out" className={zoomButton}>
            <Minus size={14} />
          </button>
          <button type="button" onClick={() => onViewChange(zoomAround(view, 1.25, { x: view.x, y: view.y }))} aria-label="Zoom in" className={zoomButton}>
            <Plus size={14} />
          </button>
          <button type="button" onClick={() => onViewChange(DEFAULT_VIEW)} aria-label="Fit the field" title="Fit the field" className={zoomButton}>
            <Maximize size={13} />
          </button>
          <span className="rounded-md bg-black/45 px-1.5 py-1 text-[10px] font-black text-white">{Math.round(view.zoom * 100)}%</span>
        </div>

      </div>

        {player || selected ? (
          <div className="flex justify-center">
            <div className="flex max-w-full flex-wrap items-center justify-center gap-1 rounded-lg bg-[#10201a] p-1 text-white">
              {player && (
                <>
                  <span className="px-1.5 text-xs font-black text-[#f7c948]">{player.label}</span>
                  {LINE_KINDS.map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      disabled={kind === 'motion' && playerHasMotion}
                      onClick={() => addLine(kind)}
                      className={`${menuButton} bg-white/10 hover:bg-white/20 disabled:opacity-30`}
                      style={{ boxShadow: `inset 0 -2px 0 ${kind === 'run' ? '#3fbf7f' : LINE_STYLES[kind].color === '#10201a' ? '#ffffff55' : LINE_STYLES[kind].color}` }}
                    >
                      {LINE_STYLES[kind].label}
                    </button>
                  ))}
                  {playerLines.length > 0 && (
                    <button
                      type="button"
                      onClick={() => onLinesChange(lines.filter((item) => item.playerCode !== selectedPlayer))}
                      className={`${menuButton} text-[#f0a090] hover:bg-white/10`}
                    >
                      Clear
                    </button>
                  )}
                </>
              )}
              {selected && (
                <>
                  {selected.kind === 'motion' ? (
                    <span className="px-1.5 text-xs font-black text-[#f7c948]">Motion</span>
                  ) : (
                    LINE_KINDS.filter((kind) => kind !== 'motion').map((kind) => (
                      <button
                        key={kind}
                        type="button"
                        onClick={() => changeKind(kind)}
                        aria-pressed={selected.kind === kind}
                        className={`${menuButton} ${selected.kind === kind ? 'bg-[#f7c948] text-[#10201a]' : 'bg-white/10 hover:bg-white/20'}`}
                      >
                        {LINE_STYLES[kind].label}
                      </button>
                    ))
                  )}
                  <button type="button" onClick={() => deleteLine(selected.id)} aria-label="Delete line" className={`${menuButton} flex items-center gap-1 text-[#f0a090] hover:bg-white/10`}>
                    <Trash2 size={12} />
                    Delete
                  </button>
                  <span className="hidden px-1 text-[10px] font-bold text-white/60 lg:inline">
                    Double-click or hold the line to add a pivot · drag a yellow dot to curve
                  </span>
                </>
              )}
            </div>
          </div>
        ) : (
          <p className="py-1 text-xs font-bold text-[#53665c]">
            Tap a player to add a line. Drag the grass to move around; scroll or pinch to zoom. The view you save is how the play prints.
          </p>
        )}
    </div>
  )
}
