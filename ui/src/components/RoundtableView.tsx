import { PARTICIPANTS, MOCK_EVENTS, getParticipant, COLOR_HEX } from './DiscussionScreen'
import type { MockEvent } from './DiscussionScreen'

function getSeatPosition(index: number, total: number, radius: number) {
  const angle = (index / total) * 2 * Math.PI - Math.PI / 2
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  }
}

// Place bubble at a fixed pixel offset inward from the avatar toward center
function getBubbleStyle(index: number, total: number, seatRadius: number) {
  const angle = (index / total) * 2 * Math.PI - Math.PI / 2
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)

  // Avatar position
  const ax = cos * seatRadius
  const ay = sin * seatRadius

  // Move 90px toward center from avatar
  const offset = 90
  const bx = ax - cos * offset
  const by = ay - sin * offset

  // Anchor: the edge of the bubble closest to the avatar
  // maps angle to a translate that keeps the bubble "attached"
  const anchorX = `${-50 + cos * -40}%`
  const anchorY = `${-50 + sin * -40}%`

  return { x: bx, y: by, anchorX, anchorY }
}

// Split long text into subtitle-like lines (~20 chars each)
function splitSubtitles(text: string, maxChars = 20): string[] {
  const lines: string[] = []
  let remaining = text
  while (remaining.length > 0) {
    if (remaining.length <= maxChars) {
      lines.push(remaining)
      break
    }
    // Find a good break point (punctuation or space)
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
  // Show only last 2 lines (like subtitles scrolling)
  return lines.slice(-2)
}

function getCurrentBubbles(): { speakerId: string; text: string }[] {
  const speakers = PARTICIPANTS.filter(p => p.state === 'speaking')
  return speakers.map(speaker => {
    for (let i = MOCK_EVENTS.length - 1; i >= 0; i--) {
      const e = MOCK_EVENTS[i]
      if (e.type === 'speech' && e.speakerId === speaker.id) {
        return { speakerId: speaker.id, text: e.text }
      }
    }
    return { speakerId: speaker.id, text: '...' }
  })
}

export function RoundtableView() {
  // Fill the viewport — use vh to scale with window
  const radius = Math.min(typeof window !== 'undefined' ? window.innerHeight * 0.38 : 380, 420)
  const bubbles = getCurrentBubbles()
  const bubbleMap = new Map(bubbles.map(b => [b.speakerId, b]))

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
        {PARTICIPANTS.map((p, i) => {
          const bubble = bubbleMap.get(p.id)
          if (!bubble) return null

          const pos = getBubbleStyle(i, PARTICIPANTS.length, radius)
          const hex = COLOR_HEX[p.color] ?? '#9ca3af'
          const lines = splitSubtitles(bubble.text)

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
        {PARTICIPANTS.map((p, i) => {
          const pos = getSeatPosition(i, PARTICIPANTS.length, radius)
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

      {/* Recent events — bottom right corner */}
      <div className="absolute bottom-4 right-4 w-72">
        <RecentEvents />
      </div>
    </div>
  )
}

function RecentEvents() {
  const recent = MOCK_EVENTS.slice(-3)

  return (
    <div className="space-y-1.5 bg-gray-900/80 backdrop-blur-sm rounded-lg border border-gray-800/50 p-2.5">
      <span className="text-[10px] text-gray-600 uppercase tracking-wider font-semibold">最近</span>
      {recent.map((event, i) => (
        <RecentEventItem key={i} event={event} />
      ))}
    </div>
  )
}

function RecentEventItem({ event }: { event: MockEvent }) {
  switch (event.type) {
    case 'speech': {
      const p = getParticipant(event.speakerId)
      const hex = COLOR_HEX[p.color] ?? '#9ca3af'
      return (
        <div className="flex items-center gap-1.5 truncate">
          <span className={`w-3 h-3 rounded-full ${p.color} shrink-0`} />
          <span className="text-[11px] font-medium shrink-0" style={{ color: hex }}>{p.name}</span>
          <span className="text-[11px] text-gray-500 truncate">
            {event.text.length > 30 ? event.text.slice(0, 30) + '...' : event.text}
          </span>
        </div>
      )
    }
    case 'collision_gap': {
      const names = event.utterances.map(u => getParticipant(u.speakerId).name).join('、')
      return <div className="text-[11px] text-yellow-600">⚡ {names} 同时说</div>
    }
    case 'collision_speech': {
      const s = getParticipant(event.speakerId)
      const i = getParticipant(event.interrupterId)
      return <div className="text-[11px] text-red-500">⚡ {s.name} 说话时 {i.name} 插入</div>
    }
    case 'silence':
      return <div className="text-[11px] text-gray-600">安静了 {event.seconds} 秒</div>
  }
}
