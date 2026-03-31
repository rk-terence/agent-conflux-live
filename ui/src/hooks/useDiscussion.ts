import { useState, useCallback, useRef } from 'react'
import type { SessionState, DomainEvent, Participant } from '@core/domain/types.ts'
import type { IterationDebugInfo } from '@core/engine/engine.ts'
import type { DiscussionControls } from '@core/runner/runner.ts'
import { startDiscussion } from '@core/runner/runner.ts'
import { SmartDummyGateway } from '@core/model-gateway/smart-dummy.ts'

export type DiscussionStatus = 'idle' | 'running' | 'paused' | 'ended'

export type StartConfig = {
  topic: string
  participants: Participant[]
  durationSeconds: number
}

export type UseDiscussionReturn = {
  status: DiscussionStatus
  state: SessionState | null
  events: DomainEvent[]
  latestDebug: IterationDebugInfo | null
  start: (config: StartConfig) => void
  pause: () => void
  resume: () => void
  stop: () => void
}

export function useDiscussion(): UseDiscussionReturn {
  const [status, setStatus] = useState<DiscussionStatus>('idle')
  const [state, setState] = useState<SessionState | null>(null)
  const [events, setEvents] = useState<DomainEvent[]>([])
  const [latestDebug, setLatestDebug] = useState<IterationDebugInfo | null>(null)
  const controlsRef = useRef<DiscussionControls | null>(null)

  const start = useCallback((config: StartConfig) => {
    controlsRef.current?.stop()

    setEvents([])
    setLatestDebug(null)
    setStatus('running')

    const gateway = new SmartDummyGateway(0.3)

    const controls = startDiscussion(
      {
        sessionId: `session-${Date.now()}`,
        topic: config.topic,
        participants: config.participants,
        gateway,
        iterationDelayMs: 400,
        maxVirtualDurationSeconds: config.durationSeconds,
      },
      {
        onStateChange(newState) {
          setState(newState)
        },
        onEvents(newEvents) {
          setEvents(prev => [...prev, ...newEvents])
        },
        onDebug(debug) {
          setLatestDebug(debug)
        },
        onError(error) {
          console.warn('Discussion error:', error)
          if (error.type === 'fatal') {
            setStatus('ended')
          }
        },
        onEnd() {
          setStatus('ended')
        },
      },
    )

    controlsRef.current = controls
  }, [])

  const pause = useCallback(() => {
    controlsRef.current?.pause()
    setStatus('paused')
  }, [])

  const resume = useCallback(() => {
    controlsRef.current?.resume()
    setStatus('running')
  }, [])

  const stop = useCallback(() => {
    controlsRef.current?.stop()
    setStatus('ended')
  }, [])

  return { status, state, events, latestDebug, start, pause, resume, stop }
}
