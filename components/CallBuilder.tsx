'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { COMPONENT_GROUPS, componentsInGroup, findComponent, stepLabel, type ComponentGroup } from '@/lib/play-builder'
import type { PlayStep } from '@/lib/types'

function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function Toggle({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-w-[22px] rounded-full px-1.5 py-0.5 text-[11px] font-black ${
        active ? 'bg-[#1f7a4d] text-white' : 'bg-white text-[#53665c] ring-1 ring-[#d8ded5]'
      }`}
    >
      {label}
    </button>
  )
}

/**
 * The play's call, stacked up from components the way the coach says it out
 * loud: "Fake HB Stretch Right, 4 Sweep". The name follows the call until the
 * coach types their own.
 */
export default function CallBuilder({
  steps,
  onChange,
  receivers
}: {
  steps: PlayStep[]
  onChange: (steps: PlayStep[]) => void
  /** Labels of everyone who can carry or run a route in this formation. */
  receivers: string[]
}) {
  const [group, setGroup] = useState<ComponentGroup>('backfield')
  const components = componentsInGroup(group)

  function add(componentId: string, receiver?: string) {
    onChange([...steps, { id: uid('step'), componentId, receivers: receiver ? [receiver] : undefined }])
  }

  function update(stepId: string, patch: Partial<PlayStep>) {
    onChange(steps.map((step) => (step.id === stepId ? { ...step, ...patch } : step)))
  }

  /** Tapping a number adds them to the step; tapping again takes them back out. */
  function toggleReceiver(step: PlayStep, code: string) {
    const current = step.receivers || []
    update(step.id, { receivers: current.includes(code) ? current.filter((item) => item !== code) : [...current, code] })
  }

  return (
    <div className="space-y-1.5">
      {steps.length > 0 && (
        <ol className="grid gap-1 xl:grid-cols-2">
          {steps.map((step, index) => {
            const component = findComponent(step.componentId)
            if (!component) return null
            const missing = component.needsReceiver && (step.receivers || []).length === 0
            return (
              <li key={step.id} className="rounded-md bg-[#f7f5ee] px-1.5 py-1">
                <div className="flex items-center gap-1.5">
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#10201a] text-[10px] font-black text-white">
                    {index + 1}
                  </span>
                  <span className={`min-w-0 flex-1 truncate text-xs font-black ${missing ? 'text-[#b4402f]' : ''}`}>
                    {stepLabel(step) || component.label}
                    {missing && ' · pick who'}
                  </span>
                  <button
                    type="button"
                    onClick={() => onChange(steps.filter((item) => item.id !== step.id))}
                    aria-label={`Remove ${component.label}`}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[#53665c] hover:bg-white"
                  >
                    <X size={12} />
                  </button>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1 pl-5">
                  <Toggle active={Boolean(step.fake)} label="Fake" onClick={() => update(step.id, { fake: !step.fake })} />
                  {component.hasDirection && (
                    <>
                      <Toggle
                        active={step.direction === 'left'}
                        label="Left"
                        onClick={() => update(step.id, { direction: step.direction === 'left' ? undefined : 'left' })}
                      />
                      <Toggle
                        active={step.direction === 'right'}
                        label="Right"
                        onClick={() => update(step.id, { direction: step.direction === 'right' ? undefined : 'right' })}
                      />
                    </>
                  )}
                  {component.needsReceiver &&
                    receivers.map((code) => (
                      <Toggle key={code} active={(step.receivers || []).includes(code)} label={code} onClick={() => toggleReceiver(step, code)} />
                    ))}
                </div>
              </li>
            )
          })}
        </ol>
      )}

      <div className="flex flex-wrap gap-1">
        {COMPONENT_GROUPS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setGroup(item.id)}
            aria-pressed={group === item.id}
            className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${
              group === item.id ? 'bg-[#10201a] text-white' : 'bg-[#f7f5ee] text-[#53665c] hover:text-[#10201a]'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 xl:grid-cols-4">
        {components
          .filter((component) => !component.needsReceiver)
          .map((component) => (
            <button
              key={component.id}
              type="button"
              onClick={() => add(component.id)}
              className="truncate rounded-md border border-[#d8ded5] bg-white px-1.5 py-1 text-xs font-black hover:border-[#10201a]"
            >
              + {component.label}
            </button>
          ))}
      </div>
      {components
        .filter((component) => component.needsReceiver)
        .map((component) => (
          <div key={component.id} className="flex flex-wrap items-center gap-1">
            <span className="w-16 shrink-0 truncate text-xs font-black">{component.label}</span>
            {receivers.map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => add(component.id, code)}
                aria-label={`${code} ${component.label}`}
                className="h-6 min-w-[24px] rounded-full bg-[#f7f5ee] px-1 text-[11px] font-black text-[#10201a] hover:bg-[#f7c948]"
              >
                {code}
              </button>
            ))}
          </div>
        ))}
    </div>
  )
}
