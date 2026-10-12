'use client'

import { useRef, useState } from 'react'
import { moveGroup, moveLine, playersInBox } from '@/lib/formation-edit'
import { snapToField, type SnapResult } from '@/lib/snapping'
import type { FieldPoint, PlaybookPosition, SlotPositions } from '@/lib/types'

/** Below this much movement, in field percent, a press is a click rather than a drag. */
const clickSlop = 0.8

type Drag =
  | { kind: 'players'; anchor: string; origins: SlotPositions; start: FieldPoint; moved: boolean; additive: boolean }
  | { kind: 'box'; start: FieldPoint; current: FieldPoint; base: string[]; additive: boolean }
  | { kind: 'line'; from: number; origins: SlotPositions }

function capturePointer(element: Element, pointerId: number) {
  try {
    element.setPointerCapture(pointerId)
  } catch {
    // The drag still tracks through the element's own events.
  }
}

/**
 * The formation page's field. It never scrolls or zooms: what you see is the
 * whole field. Click a player to select them; shift-click, or drag a box over
 * empty grass, to select several; drag any selected player to move them all.
 * The line of scrimmage drags up and down by its handle.
 */
export default function FormationCanvas({
  players,
  spots,
  line,
  selected,
  onSelect,
  onChange,
  onLineChange
}: {
  players: PlaybookPosition[]
  spots: SlotPositions
  line: number
  selected: string[]
  onSelect: (codes: string[]) => void
  onChange: (spots: SlotPositions) => void
  onLineChange: (line: number, spots: SlotPositions) => void
}) {
  const fieldRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const [box, setBox] = useState<{ a: FieldPoint; b: FieldPoint } | null>(null)
  const [guide, setGuide] = useState<SnapResult | null>(null)
  const codes = players.map((player) => player.code)

  function toField(clientX: number, clientY: number): FieldPoint {
    const rect = fieldRef.current?.getBoundingClientRect()
    if (!rect) return { x: 50, y: 50 }
    return { x: ((clientX - rect.left) / rect.width) * 100, y: ((clientY - rect.top) / rect.height) * 100 }
  }

  function pick(codesToPick: string[]) {
    return codesToPick.reduce<SlotPositions>((picked, code) => {
      if (spots[code]) picked[code] = spots[code]
      return picked
    }, {})
  }

  function handlePointerDown(event: React.PointerEvent) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.preventDefault()
    fieldRef.current?.focus({ preventScroll: true })
    const point = toField(event.clientX, event.clientY)
    const target = event.target as HTMLElement
    const code = target.closest<HTMLElement>('[data-code]')?.dataset.code
    const additive = event.shiftKey || event.metaKey || event.ctrlKey
    capturePointer(event.currentTarget, event.pointerId)

    if (code) {
      let next = selected
      if (additive) {
        next = selected.includes(code) ? selected.filter((item) => item !== code) : [...selected, code]
      } else if (!selected.includes(code)) {
        next = [code]
      }
      onSelect(next)
      if (!next.includes(code)) return
      dragRef.current = { kind: 'players', anchor: code, origins: pick(next), start: point, moved: false, additive }
      return
    }

    if (target.closest('[data-line], [data-line-handle]')) {
      dragRef.current = { kind: 'line', from: line, origins: { ...spots } }
      return
    }

    dragRef.current = { kind: 'box', start: point, current: point, base: additive ? selected : [], additive }
  }

  function handlePointerMove(event: React.PointerEvent) {
    const drag = dragRef.current
    if (!drag) return
    const point = toField(event.clientX, event.clientY)

    if (drag.kind === 'players') {
      const delta = { x: point.x - drag.start.x, y: point.y - drag.start.y }
      if (!drag.moved && Math.hypot(delta.x, delta.y / 2) < clickSlop) return
      drag.moved = true
      // The player under the pointer snaps to the line, a neighbour or the grid; the rest follow.
      const anchor = drag.origins[drag.anchor]
      const others = codes.filter((code) => !(code in drag.origins) && spots[code]).map((code) => spots[code])
      const snapped = snapToField({ x: anchor.x + delta.x, y: anchor.y + delta.y }, others, line)
      setGuide(snapped)
      onChange({ ...spots, ...moveGroup(drag.origins, { x: snapped.x - anchor.x, y: snapped.y - anchor.y }) })
      return
    }

    if (drag.kind === 'line') {
      const moved = moveLine(drag.origins, drag.from, point.y)
      onLineChange(moved.line, moved.spots)
      return
    }

    drag.current = point
    setBox({ a: drag.start, b: point })
    const inside = playersInBox(spots, codes, drag.start, point)
    onSelect(Array.from(new Set([...drag.base, ...inside])))
  }

  function handlePointerUp() {
    const drag = dragRef.current
    dragRef.current = null
    setBox(null)
    setGuide(null)
    if (!drag) return

    // Clicking one of several selected players, without dragging, picks just that one.
    if (drag.kind === 'players' && !drag.moved && !drag.additive && selected.length > 1) {
      onSelect([drag.anchor])
    }
    // A click on empty grass clears the selection.
    if (drag.kind === 'box' && !drag.additive && Math.hypot(drag.current.x - drag.start.x, drag.current.y - drag.start.y) < clickSlop) {
      onSelect([])
    }
  }

  /** Arrow keys nudge the selection; Escape lets go of it. */
  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      onSelect([])
      return
    }
    const steps: Record<string, FieldPoint> = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -2 },
      ArrowDown: { x: 0, y: 2 }
    }
    const step = steps[event.key]
    if (!step || selected.length === 0) return
    event.preventDefault()
    const size = event.shiftKey ? 4 : 1
    onChange({ ...spots, ...moveGroup(pick(selected), { x: step.x * size, y: step.y * size }) })
  }

  const boxRect = box && {
    left: `${Math.min(box.a.x, box.b.x)}%`,
    top: `${Math.min(box.a.y, box.b.y)}%`,
    width: `${Math.abs(box.a.x - box.b.x)}%`,
    height: `${Math.abs(box.a.y - box.b.y)}%`
  }

  return (
    // The line's handle lives in a strip just right of the field, where no player can cover it.
    <div
      className="relative select-none pr-6"
      style={{ touchAction: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={handleKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div
        data-line-handle
        title="Drag to move the line of scrimmage"
        aria-label="Line of scrimmage"
        className="absolute right-0 z-10 flex w-6 -translate-y-1/2 cursor-row-resize flex-col items-center justify-center rounded-r-md bg-[#f6f2df] py-1 text-[8px] font-black leading-none text-[#10201a] shadow"
        style={{ top: `calc(4px + (100% - 8px) * ${line / 100})` }}
      >
        <span>LOS</span>
        <span className="text-[11px]">⇕</span>
      </div>
      <div
        ref={fieldRef}
        tabIndex={0}
        aria-label="Formation field"
        className="field-yardlines relative w-full overflow-hidden rounded-lg border-4 border-[#f6f2df] outline-none shadow-field focus-visible:ring-2 focus-visible:ring-[#f7c948]"
        style={{ aspectRatio: '2 / 1' }}
      >
        {guide?.alignedX !== undefined && <div className="absolute inset-y-0 w-px bg-[#f7c948]/80" style={{ left: `${guide.alignedX}%` }} />}
        {guide?.alignedY !== undefined && <div className="absolute inset-x-0 h-px bg-[#f7c948]/80" style={{ top: `${guide.alignedY}%` }} />}

        <div
          data-line
          title="Drag to move the line of scrimmage"
          className="absolute inset-x-0 z-10 -translate-y-1/2 cursor-row-resize py-2"
          style={{ top: `${line}%` }}
        >
          <div className={`h-0.5 ${guide?.onLine ? 'bg-[#f7c948] shadow-[0_0_6px_#f7c948]' : 'bg-[#f6f2df]/80'}`} />
        </div>

        {players.map((player) => {
          const spot = spots[player.code]
          if (!spot) return null
          const isSelected = selected.includes(player.code)
          return (
            <div
              key={player.code}
              data-code={player.code}
              className="absolute z-20 -translate-x-1/2 -translate-y-1/2 cursor-grab active:cursor-grabbing"
              style={{ left: `${spot.x}%`, top: `${spot.y}%` }}
            >
              <div
                className={`flex h-9 w-9 items-center justify-center rounded-full border-2 bg-white text-xs font-black text-[#10201a] shadow-sm lg:h-11 lg:w-11 lg:text-sm ${
                  isSelected ? 'border-[#f7c948] ring-4 ring-[#f7c948]/60' : 'border-[#10201a]'
                }`}
              >
                <span className={player.label.length > 2 ? 'text-[0.8em] tracking-tight' : ''}>{player.label}</span>
              </div>
            </div>
          )
        })}

        {boxRect && <div className="pointer-events-none absolute z-30 border-2 border-dashed border-[#f7c948] bg-[#f7c948]/15" style={boxRect} />}
      </div>
    </div>
  )
}
