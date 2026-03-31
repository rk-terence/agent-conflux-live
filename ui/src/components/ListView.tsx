import { useEffect, useRef } from 'react'
import { getParticipantDisplay, formatTime, COLOR_HEX } from './DiscussionScreen'
import type { ParticipantDisplay } from './DiscussionScreen'
import type { DomainEvent } from '@core/domain/types.ts'

type Props = {
  participants: ParticipantDisplay[]
  events: DomainEvent[]
}

export function ListView({ participants, events }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const speakingParticipants = participants.filter(p => p.state === 'speaking')

  // Auto-scroll to bottom on new events
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [events.length])

  // Filter out discussion_started for display
  const displayEvents = events.filter(e => e.kind !== 'discussion_started')

  return (
    <div className="h-full overflow-y-auto px-6 py-6">
      <div className="max-w-2xl mx-auto space-y-4">
        {displayEvents.map((event, i) => (
          <EventItem key={i} event={event} participants={participants} />
        ))}

        {/* In-progress indicators */}
        {speakingParticipants.map(p => {
          const hex = COLOR_HEX[p.color] ?? '#9ca3af'
          return (
            <div key={p.id} className="flex items-start gap-3">
              <div className={`w-8 h-8 rounded-full ${p.color} flex items-center justify-center text-xs font-bold text-white shrink-0 mt-0.5`}>
                {p.name[0]}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium" style={{ color: hex }}>{p.name}</span>
                  <span className="text-xs text-gray-500">正在说...</span>
                  <span className="flex gap-0.5">
                    <span className="w-1 h-1 rounded-full animate-bounce" style={{ backgroundColor: hex, animationDelay: '0ms' }} />
                    <span className="w-1 h-1 rounded-full animate-bounce" style={{ backgroundColor: hex, animationDelay: '150ms' }} />
                    <span className="w-1 h-1 rounded-full animate-bounce" style={{ backgroundColor: hex, animationDelay: '300ms' }} />
                  </span>
                </div>
              </div>
            </div>
          )
        })}

        <div ref={bottomRef} />
      </div>
    </div>
  )
}

function EventItem({ event, participants }: { event: DomainEvent; participants: ParticipantDisplay[] }) {
  switch (event.kind) {
    case 'sentence_committed':
      return <SpeechEvent event={event} participants={participants} />
    case 'collision':
      return event.during === 'speech'
        ? <CollisionSpeechEvent event={event} participants={participants} />
        : <CollisionGapEvent event={event} participants={participants} />
    case 'silence_extended':
      return <SilenceEvent event={event} />
    case 'turn_ended':
      return null // Don't render explicitly — speech flow is clear enough
    case 'discussion_ended':
      return (
        <div className="text-center py-4">
          <span className="text-sm text-red-500">讨论结束 — {reasonLabel(event.reason)}</span>
        </div>
      )
    default:
      return null
  }
}

function SpeechEvent({ event, participants }: {
  event: Extract<DomainEvent, { kind: 'sentence_committed' }>
  participants: ParticipantDisplay[]
}) {
  const p = getParticipantDisplay(event.speakerId, participants)
  const hex = COLOR_HEX[p.color] ?? '#9ca3af'
  return (
    <div className="flex items-start gap-3">
      <div className={`w-8 h-8 rounded-full ${p.color} flex items-center justify-center text-xs font-bold text-white shrink-0 mt-0.5`}>
        {p.name[0]}
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-medium" style={{ color: hex }}>{p.name}</span>
          <span className="text-xs text-gray-600 font-mono">{formatTime(event.timestamp)}</span>
        </div>
        <p className="text-sm text-gray-300 leading-relaxed">{event.sentence}</p>
      </div>
    </div>
  )
}

function CollisionGapEvent({ event, participants }: {
  event: Extract<DomainEvent, { kind: 'collision' }>
  participants: ParticipantDisplay[]
}) {
  return (
    <div className="border border-yellow-900/50 rounded-xl bg-yellow-950/20 p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs text-yellow-600 font-medium">
          {event.utterances.map(u => getParticipantDisplay(u.agentId, participants).name).join(' 和 ')} 同时说
        </span>
        <span className="text-xs text-gray-600 font-mono">{formatTime(event.timestamp)}</span>
      </div>
      <div className="space-y-2">
        {event.utterances.map((u, i) => {
          const p = getParticipantDisplay(u.agentId, participants)
          return (
            <div key={i} className="flex items-start gap-2">
              <span className={`w-5 h-5 rounded-full ${p.color} flex items-center justify-center text-[10px] font-bold text-white shrink-0 mt-0.5`}>
                {p.name[0]}
              </span>
              <p className="text-sm text-gray-400">{u.text}</p>
            </div>
          )
        })}
      </div>
      <p className="text-xs text-yellow-700 mt-2">几个人同时开口，都只说了一句</p>
    </div>
  )
}

function CollisionSpeechEvent({ event, participants }: {
  event: Extract<DomainEvent, { kind: 'collision' }>
  participants: ParticipantDisplay[]
}) {
  const speaker = getParticipantDisplay(event.utterances[0].agentId, participants)
  const others = event.utterances.slice(1).map(u => getParticipantDisplay(u.agentId, participants))
  return (
    <div className="border border-red-900/50 rounded-xl bg-red-950/20 p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs text-red-500 font-medium">
          {speaker.name} 正在说时，{others.map(o => o.name).join('、')} 也开口了
        </span>
        <span className="text-xs text-gray-600 font-mono">{formatTime(event.timestamp)}</span>
      </div>
      <div className="space-y-2">
        {event.utterances.map((u, i) => {
          const p = getParticipantDisplay(u.agentId, participants)
          return (
            <div key={i} className="flex items-start gap-2">
              <span className={`w-5 h-5 rounded-full ${p.color} flex items-center justify-center text-[10px] font-bold text-white shrink-0 mt-0.5`}>
                {p.name[0]}
              </span>
              <p className="text-sm text-gray-400">{u.text}</p>
            </div>
          )
        })}
      </div>
      <p className="text-xs text-red-700 mt-2">{event.utterances.length}人同时在说话</p>
    </div>
  )
}

function SilenceEvent({ event }: { event: Extract<DomainEvent, { kind: 'silence_extended' }> }) {
  return (
    <div className="text-center py-2">
      <span className="text-xs text-gray-600 font-mono">{formatTime(event.timestamp)}</span>
      <span className="mx-3 text-xs text-gray-500">已经安静了 {Math.round(event.cumulativeSeconds)} 秒</span>
    </div>
  )
}

function reasonLabel(reason: string): string {
  switch (reason) {
    case 'silence_timeout': return '沉默超时'
    case 'duration_limit': return '时间到'
    case 'manual': return '手动结束'
    case 'fatal_error': return '系统错误'
    default: return reason
  }
}
