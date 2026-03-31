import { MOCK_EVENTS, PARTICIPANTS, getParticipant, formatTime, COLOR_HEX } from './DiscussionScreen'
import type { MockEvent } from './DiscussionScreen'

export function ListView() {
  const speakingParticipants = PARTICIPANTS.filter(p => p.state === 'speaking')

  return (
    <div className="h-full overflow-y-auto px-6 py-6">
      <div className="max-w-2xl mx-auto space-y-4">
        {MOCK_EVENTS.map((event, i) => (
          <EventItem key={i} event={event} />
        ))}

        {/* In-progress indicators for all currently speaking participants */}
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
      </div>
    </div>
  )
}

function EventItem({ event }: { event: MockEvent }) {
  switch (event.type) {
    case 'speech':
      return <SpeechEvent event={event} />
    case 'collision_gap':
      return <CollisionGapEvent event={event} />
    case 'collision_speech':
      return <CollisionSpeechEvent event={event} />
    case 'silence':
      return <SilenceEvent event={event} />
  }
}

function SpeechEvent({ event }: { event: Extract<MockEvent, { type: 'speech' }> }) {
  const p = getParticipant(event.speakerId)
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
        <p className="text-sm text-gray-300 leading-relaxed">{event.text}</p>
      </div>
    </div>
  )
}

function CollisionGapEvent({ event }: { event: Extract<MockEvent, { type: 'collision_gap' }> }) {
  return (
    <div className="border border-yellow-900/50 rounded-xl bg-yellow-950/20 p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs text-yellow-600 font-medium">
          {event.utterances.map(u => getParticipant(u.speakerId).name).join(' 和 ')} 同时说
        </span>
        <span className="text-xs text-gray-600 font-mono">{formatTime(event.timestamp)}</span>
      </div>
      <div className="space-y-2">
        {event.utterances.map((u, i) => {
          const p = getParticipant(u.speakerId)
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

function CollisionSpeechEvent({ event }: { event: Extract<MockEvent, { type: 'collision_speech' }> }) {
  const speaker = getParticipant(event.speakerId)
  const interrupter = getParticipant(event.interrupterId)
  return (
    <div className="border border-red-900/50 rounded-xl bg-red-950/20 p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs text-red-500 font-medium">
          {speaker.name} 正在说时，{interrupter.name} 也开口了
        </span>
        <span className="text-xs text-gray-600 font-mono">{formatTime(event.timestamp)}</span>
      </div>
      <div className="space-y-2">
        <div className="flex items-start gap-2">
          <span className={`w-5 h-5 rounded-full ${speaker.color} flex items-center justify-center text-[10px] font-bold text-white shrink-0 mt-0.5`}>
            {speaker.name[0]}
          </span>
          <p className="text-sm text-gray-400">{event.speakerText}</p>
        </div>
        <div className="flex items-start gap-2">
          <span className={`w-5 h-5 rounded-full ${interrupter.color} flex items-center justify-center text-[10px] font-bold text-white shrink-0 mt-0.5`}>
            {interrupter.name[0]}
          </span>
          <p className="text-sm text-gray-400">{event.interrupterText}</p>
        </div>
      </div>
      <p className="text-xs text-red-700 mt-2">两人同时在说话</p>
    </div>
  )
}

function SilenceEvent({ event }: { event: Extract<MockEvent, { type: 'silence' }> }) {
  return (
    <div className="text-center py-2">
      <span className="text-xs text-gray-600 font-mono">{formatTime(event.timestamp)}</span>
      <span className="mx-3 text-xs text-gray-500">已经安静了 {event.seconds} 秒</span>
    </div>
  )
}
