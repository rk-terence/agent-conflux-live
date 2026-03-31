import { getParticipantDisplay, formatTime, COLOR_HEX } from './DiscussionScreen'
import type { ParticipantDisplay } from './DiscussionScreen'
import type { DomainEvent } from '@core/domain/types.ts'

type Props = {
  participants: ParticipantDisplay[]
  events: DomainEvent[]
}

function getSeatPosition(index: number, total: number, radius: number) {
  const angle = (index / total) * 2 * Math.PI - Math.PI / 2
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  }
}

function getBubbleStyle(index: number, total: number, seatRadius: number) {
  const angle = (index / total) * 2 * Math.PI - Math.PI / 2
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const ax = cos * seatRadius
  const ay = sin * seatRadius
  const offset = 90
  const bx = ax - cos * offset
  const by = ay - sin * offset
  const anchorX = `${-50 + cos * -40}%`
  const anchorY = `${-50 + sin * -40}%`
  return { x: bx, y: by, anchorX, anchorY }
}

function splitSubtitles(text: string, maxChars = 20): string[] {
  const lines: string[] = []
  let remaining = text
  while (remaining.length > 0) {
    if (remaining.length <= maxChars) {
      lines.push(remaining)
      break
    }
    let breakAt = -1
    for (let i = maxChars; i >= maxChars - 6 && i > 0; i--) {
      if ('，。！？、；：  '.includes(remaining[i])) {
        breakAt = i + 1
        break
      }
    }
    if (breakAt === -1) breakAt = maxChars
    lines.push(remaining.slice(0, breakAt))
    remaining = remaining.slice(breakAt)
  }
  return lines.slice(-2)
}

// Get the latest speech text for each currently speaking participant
function getSpeakerBubbles(
  participants: ParticipantDisplay[],
  events: DomainEvent[],
): Map<string, string> {
  const speakers = new Set(participants.filter(p => p.state === 'speaking').map(p => p.id))
  const bubbles = new Map<string, string>()

  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.kind === 'sentence_committed' && speakers.has(e.speakerId) && !bubbles.has(e.speakerId)) {
      bubbles.set(e.speakerId, e.sentence)
    }
    if (bubbles.size === speakers.size) break
  }

  // For speakers without any sentence yet, show "..."
  for (const id of speakers) {
    if (!bubbles.has(id)) bubbles.set(id, '...')
  }

  return bubbles
}

export function RoundtableView({ participants, events }: Props) {
  const radius = Math.min(typeof window !== 'undefined' ? window.innerHeight * 0.38 : 380, 420)
  const bubbles = getSpeakerBubbles(participants, events)

  return (
    <div className="h-full flex items-center justify-center relative overflow-hidden">
      <div className="relative" style={{ width: radius * 2 + 100, height: radius * 2 + 100 }}>
        {/* Table surface */}
        <div
          className="absolute rounded-full border border-gray-700/30 bg-gray-900/20"
          style={{
            width: radius * 1.7,
            height: radius * 1.7,
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
          }}
        />

        {/* Subtitle bubbles */}
        {participants.map((p, i) => {
          const bubbleText = bubbles.get(p.id)
          if (!bubbleText) return null

          const pos = getBubbleStyle(i, participants.length, radius)
          const hex = COLOR_HEX[p.color] ?? '#9ca3af'
          const lines = splitSubtitles(bubbleText)

          return (
            <div
              key={`bubble-${p.id}`}
              className="absolute z-10"
              style={{
                left: `calc(50% + ${pos.x}px)`,
                top: `calc(50% + ${pos.y}px)`,
                transform: `translate(${pos.anchorX}, ${pos.anchorY})`,
              }}
            >
              <div className="flex flex-col items-center gap-1">
                {lines.map((line, j) => (
                  <span
                    key={j}
                    className="inline-block rounded-full px-4 py-1 text-sm whitespace-nowrap"
                    style={{
                      backgroundColor: `${hex}18`,
                      borderColor: `${hex}30`,
                      color: '#e5e7eb',
                      border: '1px solid',
                    }}
                  >
                    {line}
                  </span>
                ))}
              </div>
            </div>
          )
        })}

        {/* Seats */}
        {participants.map((p, i) => {
          const pos = getSeatPosition(i, participants.length, radius)
          const isSpeaking = p.state === 'speaking'
          const hex = COLOR_HEX[p.color] ?? '#9ca3af'

          return (
            <div
              key={p.id}
              className="absolute z-20"
              style={{
                left: `calc(50% + ${pos.x}px)`,
                top: `calc(50% + ${pos.y}px)`,
                transform: 'translate(-50%, -50%)',
              }}
            >
              <div className="relative flex flex-col items-center gap-1">
                <div
                  className={`w-14 h-14 rounded-full ${p.color} flex items-center justify-center text-lg font-bold text-white transition-all ${
                    isSpeaking ? 'ring-2 ring-offset-2 ring-offset-gray-950 scale-110' : ''
                  }`}
                  style={isSpeaking ? { ringColor: hex } : undefined}
                >
                  {p.name[0]}
                </div>
                {isSpeaking && (
                  <div
                    className="absolute inset-0 rounded-full animate-ping opacity-20"
                    style={{ backgroundColor: hex }}
                  />
                )}
                <span className={`text-xs font-medium ${isSpeaking ? 'text-gray-200' : 'text-gray-500'}`}>
                  {p.name}
                </span>
                <span className={`text-[10px] ${
                  p.state === 'speaking' ? 'text-yellow-500' :
                  p.state === 'listening' ? 'text-gray-400' : 'text-gray-600'
                }`}>
                  {p.state === 'speaking' ? '发言中' :
                   p.state === 'listening' ? '倾听' : '沉默'}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Recent events — bottom right */}
      <div className="absolute bottom-4 right-4 w-72">
        <RecentEvents events={events} participants={participants} />
      </div>
    </div>
  )
}

function RecentEvents({ events, participants }: { events: DomainEvent[]; participants: ParticipantDisplay[] }) {
  const recent = events.filter(e => e.kind !== 'discussion_started').slice(-4)
  if (recent.length === 0) return null

  return (
    <div className="space-y-1.5 bg-gray-900/80 backdrop-blur-sm rounded-lg border border-gray-800/50 p-2.5">
      <span className="text-[10px] text-gray-600 uppercase tracking-wider font-semibold">最近</span>
      {recent.map((event, i) => (
        <RecentEventItem key={i} event={event} participants={participants} />
      ))}
    </div>
  )
}

function RecentEventItem({ event, participants }: { event: DomainEvent; participants: ParticipantDisplay[] }) {
  switch (event.kind) {
    case 'sentence_committed': {
      const p = getParticipantDisplay(event.speakerId, participants)
      const hex = COLOR_HEX[p.color] ?? '#9ca3af'
      return (
        <div className="flex items-center gap-1.5 truncate">
          <span className={`w-3 h-3 rounded-full ${p.color} shrink-0`} />
          <span className="text-[11px] font-medium shrink-0" style={{ color: hex }}>{p.name}</span>
          <span className="text-[11px] text-gray-500 truncate">
            {event.sentence.length > 30 ? event.sentence.slice(0, 30) + '...' : event.sentence}
          </span>
        </div>
      )
    }
    case 'collision': {
      const names = event.utterances.map(u => getParticipantDisplay(u.agentId, participants).name).join('、')
      return <div className="text-[11px] text-yellow-600">⚡ {names} 同时说</div>
    }
    case 'silence_extended':
      return <div className="text-[11px] text-gray-600">安静了 {Math.round(event.cumulativeSeconds)} 秒</div>
    case 'turn_ended': {
      const p = getParticipantDisplay(event.speakerId, participants)
      return <div className="text-[11px] text-gray-600">{p.name} 说完了</div>
    }
    case 'discussion_ended':
      return <div className="text-[11px] text-red-500">讨论结束</div>
    default:
      return null
  }
}
