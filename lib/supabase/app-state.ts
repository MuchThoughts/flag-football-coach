import type { RealtimeChannel } from '@supabase/supabase-js'
import type { AppSettings, AppState } from '../types'
import { getSupabaseClient } from './client'

/**
 * The whole coaching staff shares one dataset: a single row that every device
 * reads, writes and listens to. There are no accounts and nothing to sign in
 * to — opening the app is joining the team.
 */
export const SHARED_STATE_ID = 'franklin-dolphins'

const deviceIdStorageKey = 'flag-football-coach:device-id'

export interface SharedStateRow {
  id: string
  state: AppState
  updated_by: string
  updated_at: string
}

/**
 * A random id per device, so a device can tell its own saves apart from
 * everyone else's when they echo back over the live channel.
 */
export function getDeviceId(): string {
  if (typeof window === 'undefined') {
    return 'server'
  }

  const stored = window.localStorage.getItem(deviceIdStorageKey)
  if (stored) {
    return stored
  }

  const created = `device-${Date.now()}-${Math.random().toString(16).slice(2)}`
  window.localStorage.setItem(deviceIdStorageKey, created)
  return created
}

/** With one shared dataset there are no assistants: every device is the coach. */
export function normalizeAppStateForSupabase(state: AppState): AppState {
  return {
    ...state,
    appSettings: {
      ...state.appSettings,
      role: 'head'
    } satisfies AppSettings
  }
}

export async function loadSharedState(): Promise<SharedStateRow | null> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('shared_app_state')
    .select('id, state, updated_by, updated_at')
    .eq('id', SHARED_STATE_ID)
    .maybeSingle<SharedStateRow>()

  if (error) {
    throw error
  }

  return data
}

export async function saveSharedState(state: AppState, deviceId: string) {
  const supabase = getSupabaseClient()
  const { error } = await supabase.from('shared_app_state').upsert({
    id: SHARED_STATE_ID,
    state: normalizeAppStateForSupabase(state),
    updated_by: deviceId,
    updated_at: new Date().toISOString()
  })

  if (error) {
    throw error
  }
}

export function subscribeToSharedState(onState: (row: SharedStateRow) => void): RealtimeChannel {
  const supabase = getSupabaseClient()

  return supabase
    .channel('shared-app-state')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'shared_app_state',
        filter: `id=eq.${SHARED_STATE_ID}`
      },
      (payload) => {
        if (payload.new && 'state' in payload.new) {
          onState(payload.new as SharedStateRow)
        }
      }
    )
    .subscribe()
}
