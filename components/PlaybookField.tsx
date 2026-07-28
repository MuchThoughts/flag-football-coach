'use client'

import { useEffect, useRef, useState } from 'react'
import { Maximize2, Minus, Plus, X } from 'lucide-react'
import { PLAYBOOK_SLOTS } from '@/lib/playbook'
import { LINE_OF_SCRIMMAGE } from '@/lib/positions'
import { snapToField, type SnapResult } from '@/lib/snapping'
import type { FieldPoint, PlayFootball, PlayRoute, SlotPositions } from '@/lib/types'

/** The field is twice as wide as it is tall; drawing coordinates are percentages. */
const worldWidth = 200
const worldHeight = 100
const minScale = 1
const maxScale = 4
const holdDuration = 550
const drawStepDistance = 1.2
const dragThreshold = 6
/** A finger drifts while it is held, so a pending hold tolerates more than a drag does. */
const holdDriftTolerance = 16
const doubleTapWindow = 320

function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** Capturing can throw if the pointer is already gone; losing it is not fatal. */
function capturePointer(element: Element, pointerId: number) {
  try {
    element.setPointerCapture(pointerId)
  } catch {
    // The gesture still tracks through the element's own events.
  }
}

/** Percentage x maps across a viewBox that is twice as wide, so strokes stay round. */
function toViewBox(point: FieldPoint) {
  return `${point.x * 2},${point.y}`
}

function routePath(route: PlayRoute) {
  return route.points.map(toViewBox).join(' ')
}

function FootballIcon({ size }: { size: number }) {
  return (
    <svg viewBox="-10 -7 20 14" width={size} height={size * 0.7} aria-hidden>
      <g transform="rotate(-20)">
        <ellipse rx="9" ry="5.6" fill="#8a4b23" stroke="#2f1b0d" strokeWidth="1.4" />
        <line x1="-5.2" y1="0" x2="5.2" y2="0" stroke="#f7f5ee" strokeWidth="1.4" />
        <line x1="-2.8" y1="-1.8" x2="-2.8" y2="1.8" stroke="#f7f5ee" strokeWidth="1.2" />
        <line x1="0" y1="-2.2" x2="0" y2="2.2" stroke="#f7f5ee" strokeWidth="1.2" />
        <line x1="2.8" y1="-1.8" x2="2.8" y2="1.8" stroke="#f7f5ee" strokeWidth="1.2" />
      </g>
    </svg>
  )
}

/**
 * The playbook field. Positions show as small labelled circles. When routes can be
 * edited, dragging draws a line, holding drops a football for a handoff, and
 * double tapping a line makes it dashed for a pass. Two fingers always pinch to
 * zoom and drag the field around; in landscape the field takes over the screen.
 */
export default function PlaybookField({
  positions,
  routes = [],
  footballs = [],
  onMovePosition,
  onRoutesChange,
  onFootballsChange,
  compact = false,
  fullscreenOnLandscape = false
}: {
  positions: SlotPositions
  routes?: PlayRoute[]
  footballs?: PlayFootball[]
  onMovePosition?: (slotCode: string, position: FieldPoint) => void
  onRoutesChange?: (routes: PlayRoute[]) => void
  onFootballsChange?: (footballs: PlayFootball[]) => void
  compact?: boolean
  fullscreenOnLandscape?: boolean
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 })
  const [draft, setDraft] = useState<FieldPoint[] | null>(null)
  const [draggingSlot, setDraggingSlot] = useState<string | null>(null)
  const [draggingFootball, setDraggingFootball] = useState<string | null>(null)
  const [snap, setSnap] = useState<SnapResult | null>(null)
  const [landscape, setLandscape] = useState(false)
  const [fullscreenOff, setFullscreenOff] = useState(false)

  const pointersRef = useRef(new Map<number, FieldPoint>())
  const pinchRef = useRef<{ distance: number; x: number; y: number } | null>(null)
  const strokeRef = useRef<{ startClientX: number; startClientY: number; started: boolean } | null>(null)
  const holdTimerRef = useRef<number | null>(null)
  const slotDragRef = useRef<{ slotCode: string; startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null)
  const footballDragRef = useRef<{ id: string; startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null)
  const lastTapRef = useRef<{ routeId: string; at: number } | null>(null)

  const drawable = Boolean(onRoutesChange)
  const fullscreen = fullscreenOnLandscape && landscape && !fullscreenOff

  /** Everything already on the field, for snapping and alignment guides. */
  function markerPoints(exclude?: string): FieldPoint[] {
    return [
      ...PLAYBOOK_SLOTS.filter((slot) => slot.code !== exclude).map(
        (slot) => positions[slot.code] || { x: slot.x, y: slot.y }
      ),
      ...footballs.filter((football) => football.id !== exclude).map((football) => ({ x: football.x, y: football.y }))
    ]
  }

  useEffect(() => {
    // A phone turned sideways: wide, and short enough that a desktop window is not mistaken for it.
    const query = window.matchMedia('(orientation: landscape) and (max-height: 620px)')
    const update = () => setLandscape(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    return () => {
      if (holdTimerRef.current) window.clearTimeout(holdTimerRef.current)
    }
  }, [])

  function cancelHold() {
    if (holdTimerRef.current) {
      window.clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
  }

  /** Screen coordinates to field percentages, undoing the current zoom and pan. */
  function toFieldPoint(clientX: number, clientY: number): FieldPoint {
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return { x: 50, y: 50 }
    return {
      x: clamp((((clientX - rect.left - view.x) / view.scale) / rect.width) * 100, 0, 100),
      y: clamp((((clientY - rect.top - view.y) / view.scale) / rect.height) * 100, 0, 100)
    }
  }

  function zoomBy(factor: number) {
    const rect = viewportRef.current?.getBoundingClientRect()
    const centerX = (rect?.width || 0) / 2
    const centerY = (rect?.height || 0) / 2
    setView((current) => {
      const scale = clamp(current.scale * factor, minScale, maxScale)
      if (scale === minScale) return { scale, x: 0, y: 0 }
      const ratio = scale / current.scale
      return {
        scale,
        x: centerX - (centerX - current.x) * ratio,
        y: centerY - (centerY - current.y) * ratio
      }
    })
  }

  function endStroke(commit: boolean) {
    strokeRef.current = null
    if (commit && draft && draft.length > 1 && onRoutesChange) {
      onRoutesChange([...routes, { id: uid('route'), points: draft, style: 'solid' }])
    }
    setDraft(null)
  }

  function handlePointerDown(event: React.PointerEvent) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    // Without this a press-and-hold turns into a text selection instead of a football.
    event.preventDefault()
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })

    if (pointersRef.current.size === 2) {
      cancelHold()
      endStroke(false)
      const [a, b] = Array.from(pointersRef.current.values())
      pinchRef.current = { distance: distance(a, b), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      capturePointer(event.currentTarget as HTMLElement, event.pointerId)
      return
    }

    if (pointersRef.current.size > 2) return

    strokeRef.current = { startClientX: event.clientX, startClientY: event.clientY, started: false }
    capturePointer(event.currentTarget as HTMLElement, event.pointerId)

    if (drawable) {
      const point = toFieldPoint(event.clientX, event.clientY)
      cancelHold()
      holdTimerRef.current = window.setTimeout(() => {
        holdTimerRef.current = null
        strokeRef.current = null
        setDraft(null)
        navigator.vibrate?.(15)
        const snapped = snapToField(point, markerPoints())
        onFootballsChange?.([...footballs, { id: uid('football'), x: snapped.x, y: snapped.y }])
      }, holdDuration)
    }
  }

  function handlePointerMove(event: React.PointerEvent) {
    if (!pointersRef.current.has(event.pointerId)) return
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })

    if (pointersRef.current.size >= 2 && pinchRef.current) {
      const [a, b] = Array.from(pointersRef.current.values())
      const spread = distance(a, b)
      const centerX = (a.x + b.x) / 2
      const centerY = (a.y + b.y) / 2
      const previous = pinchRef.current

      setView((current) => {
        const scale = clamp(current.scale * (spread / (previous.distance || spread)), minScale, maxScale)
        const ratio = scale / current.scale
        return {
          scale,
          x: centerX - (centerX - current.x) * ratio + (centerX - previous.x),
          y: centerY - (centerY - current.y) * ratio + (centerY - previous.y)
        }
      })

      pinchRef.current = { distance: spread, x: centerX, y: centerY }
      return
    }

    const stroke = strokeRef.current
    if (!stroke) return

    const moved = Math.hypot(event.clientX - stroke.startClientX, event.clientY - stroke.startClientY)
    if (!stroke.started) {
      const holdPending = holdTimerRef.current !== null
      if (moved < (holdPending ? holdDriftTolerance : dragThreshold)) return
    }

    cancelHold()

    if (!drawable) {
      // Nothing to draw here, so a single finger pans the field instead.
      if (!stroke.started) {
        stroke.started = true
        return
      }
      const previous = { x: stroke.startClientX, y: stroke.startClientY }
      stroke.startClientX = event.clientX
      stroke.startClientY = event.clientY
      setView((current) => ({
        ...current,
        x: current.x + (event.clientX - previous.x),
        y: current.y + (event.clientY - previous.y)
      }))
      return
    }

    const point = toFieldPoint(event.clientX, event.clientY)
    if (!stroke.started) {
      stroke.started = true
      setDraft([toFieldPoint(stroke.startClientX, stroke.startClientY), point])
      return
    }

    setDraft((current) => {
      if (!current) return [point]
      const last = current[current.length - 1]
      if (distance(last, point) < drawStepDistance) return current
      return [...current, point]
    })
  }

  function handlePointerUp(event: React.PointerEvent) {
    pointersRef.current.delete(event.pointerId)
    if (pointersRef.current.size < 2) pinchRef.current = null
    cancelHold()
    if (pointersRef.current.size === 0) endStroke(true)
  }

  /** Two quick taps on a line switch it between a run and a pass. */
  function handleRouteTap(routeId: string) {
    if (!onRoutesChange) return
    const now = Date.now()
    const last = lastTapRef.current
    if (last && last.routeId === routeId && now - last.at < doubleTapWindow) {
      lastTapRef.current = null
      onRoutesChange(
        routes.map((route) => (route.id === routeId ? { ...route, style: route.style === 'solid' ? 'dashed' : 'solid' } : route))
      )
      return
    }
    lastTapRef.current = { routeId, at: now }
  }

  const circleSize = compact ? 'h-6 w-6 text-[9px]' : 'h-9 w-9 text-xs'
  const viewportClass = fullscreen
    ? 'fixed inset-0 z-[60] rounded-none border-0'
    : `relative w-full ${compact ? '' : ''} rounded-lg border-4 border-[#f6f2df] shadow-field`

  const field = (
    <div
      ref={viewportRef}
      className={`field-yardlines select-none overflow-hidden ${viewportClass}`}
      style={{
        touchAction: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        aspectRatio: fullscreen ? undefined : '2 / 1'
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div
        className="absolute inset-0"
        style={{
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          transformOrigin: '0 0'
        }}
      >
        <div
          className={`absolute inset-x-0 h-px ${snap?.onLine ? 'bg-[#f7c948] shadow-[0_0_6px_#f7c948]' : 'bg-[#f6f2df]/70'}`}
          style={{ top: `${LINE_OF_SCRIMMAGE}%` }}
        />
        {snap?.alignedX !== undefined && (
          <div className="absolute inset-y-0 w-px bg-[#f7c948]/80" style={{ left: `${snap.alignedX}%` }} />
        )}
        {snap?.alignedY !== undefined && (
          <div className="absolute inset-x-0 h-px bg-[#f7c948]/80" style={{ top: `${snap.alignedY}%` }} />
        )}

        <svg viewBox={`0 0 ${worldWidth} ${worldHeight}`} className="absolute inset-0 h-full w-full" preserveAspectRatio="none">
          {routes.map((route) => (
            <g key={route.id}>
              <polyline
                points={routePath(route)}
                fill="none"
                stroke="#10201a"
                strokeWidth={compact ? 1.1 : 1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={route.style === 'dashed' ? '4 3' : undefined}
                vectorEffect="non-scaling-stroke"
              />
              {onRoutesChange && (
                <polyline
                  points={routePath(route)}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={6}
                  strokeLinecap="round"
                  style={{ pointerEvents: 'stroke' }}
                  onPointerDown={(event) => event.stopPropagation()}
                  onPointerUp={(event) => {
                    event.stopPropagation()
                    handleRouteTap(route.id)
                  }}
                />
              )}
            </g>
          ))}

          {draft && draft.length > 1 && (
            <polyline
              points={draft.map(toViewBox).join(' ')}
              fill="none"
              stroke="#c2412d"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          )}

        </svg>

        {PLAYBOOK_SLOTS.map((slot) => {
          const position = positions[slot.code] || { x: slot.x, y: slot.y }
          const isDragging = draggingSlot === slot.code
          return (
            <div
              key={slot.code}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${position.x}%`, top: `${position.y}%` }}
              onPointerDown={(event) => {
                if (!onMovePosition) return
                if (event.pointerType === 'mouse' && event.button !== 0) return
                event.stopPropagation()
                slotDragRef.current = {
                  slotCode: slot.code,
                  startX: event.clientX,
                  startY: event.clientY,
                  originX: position.x,
                  originY: position.y,
                  moved: false
                }
              }}
              onPointerMove={(event) => {
                const drag = slotDragRef.current
                const rect = viewportRef.current?.getBoundingClientRect()
                if (!drag || !rect || !onMovePosition) return
                event.stopPropagation()

                const deltaX = event.clientX - drag.startX
                const deltaY = event.clientY - drag.startY
                if (!drag.moved && Math.hypot(deltaX, deltaY) < dragThreshold) return
                if (!drag.moved) {
                  drag.moved = true
                  setDraggingSlot(drag.slotCode)
                  capturePointer(event.currentTarget as HTMLElement, event.pointerId)
                }

                const snapped = snapToField(
                  {
                    x: drag.originX + (deltaX / (rect.width * view.scale)) * 100,
                    y: drag.originY + (deltaY / (rect.height * view.scale)) * 100
                  },
                  markerPoints(drag.slotCode)
                )
                setSnap(snapped)
                onMovePosition(drag.slotCode, { x: snapped.x, y: snapped.y })
              }}
              onPointerUp={(event) => {
                if (!slotDragRef.current) return
                event.stopPropagation()
                slotDragRef.current = null
                setDraggingSlot(null)
                setSnap(null)
              }}
            >
              <div
                className={`flex ${circleSize} select-none items-center justify-center rounded-full border-2 border-[#10201a] bg-white font-black text-[#10201a] shadow-sm ${
                  isDragging ? 'scale-110 ring-2 ring-[#f7c948]' : ''
                }`}
              >
                {slot.shortName}
              </div>
            </div>
          )
        })}

        {footballs.map((football) => {
          const isDragging = draggingFootball === football.id
          return (
            <div
              key={football.id}
              className={`absolute -translate-x-1/2 -translate-y-1/2 ${isDragging ? 'z-20 scale-125' : 'z-10'}`}
              style={{ left: `${football.x}%`, top: `${football.y}%` }}
              onPointerDown={(event) => {
                if (!onFootballsChange) return
                if (event.pointerType === 'mouse' && event.button !== 0) return
                // The field would otherwise take this as the start of a new route.
                event.stopPropagation()
                event.preventDefault()
                footballDragRef.current = {
                  id: football.id,
                  startX: event.clientX,
                  startY: event.clientY,
                  originX: football.x,
                  originY: football.y,
                  moved: false
                }
              }}
              onPointerMove={(event) => {
                const drag = footballDragRef.current
                const rect = viewportRef.current?.getBoundingClientRect()
                if (!drag || !rect || !onFootballsChange) return
                event.stopPropagation()

                const deltaX = event.clientX - drag.startX
                const deltaY = event.clientY - drag.startY
                if (!drag.moved && Math.hypot(deltaX, deltaY) < dragThreshold) return
                if (!drag.moved) {
                  drag.moved = true
                  setDraggingFootball(drag.id)
                  capturePointer(event.currentTarget as HTMLElement, event.pointerId)
                }

                const snapped = snapToField(
                  {
                    x: drag.originX + (deltaX / (rect.width * view.scale)) * 100,
                    y: drag.originY + (deltaY / (rect.height * view.scale)) * 100
                  },
                  markerPoints(drag.id)
                )
                setSnap(snapped)
                onFootballsChange(
                  footballs.map((item) => (item.id === drag.id ? { ...item, x: snapped.x, y: snapped.y } : item))
                )
              }}
              onPointerUp={(event) => {
                if (!footballDragRef.current) return
                event.stopPropagation()
                footballDragRef.current = null
                setDraggingFootball(null)
                setSnap(null)
              }}
              onPointerCancel={() => {
                footballDragRef.current = null
                setDraggingFootball(null)
                setSnap(null)
              }}
            >
              <div className={`flex items-center justify-center ${onFootballsChange ? 'cursor-grab p-2' : ''}`}>
                <FootballIcon size={compact ? 18 : 26} />
              </div>
            </div>
          )
        })}
      </div>

      {!compact && (
        <div className="absolute right-2 top-2 z-10 flex items-center gap-1">
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => zoomBy(1 / 1.4)}
            aria-label="Zoom out"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white"
          >
            <Minus size={14} />
          </button>
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => zoomBy(1.4)}
            aria-label="Zoom in"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white"
          >
            <Plus size={14} />
          </button>
          {view.scale > 1 && (
            <button
              type="button"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => setView({ scale: 1, x: 0, y: 0 })}
              className="rounded-full bg-black/40 px-2 py-1 text-xs font-black text-white"
            >
              {Math.round(view.scale * 10) / 10}x
            </button>
          )}
          {fullscreen && (
            <button
              type="button"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => setFullscreenOff(true)}
              aria-label="Exit full screen"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white"
            >
              <X size={16} />
            </button>
          )}
        </div>
      )}
    </div>
  )

  if (!fullscreen) return field

  return (
    <>
      {/* Keeps the sheet's layout height while the field is lifted out to full screen. */}
      <div className="relative flex w-full items-center justify-center rounded-lg border border-dashed border-[#d8ded5] bg-[#f7f5ee] py-6" style={{ aspectRatio: '4 / 1' }}>
        <p className="flex items-center gap-2 text-sm font-black text-[#53665c]">
          <Maximize2 size={15} />
          Field is full screen
        </p>
      </div>
      {field}
    </>
  )
}
