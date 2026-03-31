import { useState } from 'react'
import { RoundtableView } from './RoundtableView'
import { ListView } from './ListView'
import type { UseDiscussionReturn } from '../hooks/useDiscussion'
import type { SessionState, DomainEvent } from '@core/domain/types.ts'
import type { IterationDebugInfo } from '@core/engine/engine.ts'

type Props = {
  discussion: UseDiscussionReturn
  onBack: () => void
}

export type ViewMode = 'roundtable' | 'list'

// Derive participant display info from session state
export type ParticipantDisplay = {
  id: string
  name: string
  color: string
  state: 'speaking' | 'listening' | 'silent'
}

const AGENT_COLORS: Record<string, string> = {
  claude: 'bg-orange-500',
  gpt4o: 'bg-green-500',
  gemini: 'bg-blue-500',
  deepseek: 'bg-purple-500',
  qwen: 'bg-cyan-500',
  llama: 'bg-red-500',
}

export const COLOR_HEX: Record<string, string> = {
  'bg-orange-500': '#f97316',
  'bg-green-500': '#22c55e',
  'bg-blue-500': '#3b82f6',
  'bg-purple-500': '#a855f7',
  'bg-cyan-500': '#06b6d4',
  'bg-red-500': '#ef4444',
}

export function deriveParticipants(state: SessionState | null): ParticipantDisplay[] {
  if (!state) return []
  return state.participants.map(p => {
    const isSpeaking = state.currentTurn?.speakerId === p.agentId
    const hasSpeaker = state.currentTurn !== null
    return {
      id: p.agentId,
      name: p.name,
      color: AGENT_COLORS[p.agentId] ?? 'bg-gray-500',
      state: isSpeaking ? 'speaking' : hasSpeaker ? 'listening' : 'silent',
    }
  })
}

export function getParticipantDisplay(id: string, participants: ParticipantDisplay[]): ParticipantDisplay {
  return participants.find(p => p.id === id) ?? { id, name: id, color: 'bg-gray-500', state: 'silent' }
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function DiscussionScreen({ discussion, onBack }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>('roundtable')
  const [showDebug, setShowDebug] = useState(false)
  const { status, state, events, latestDebug } = discussion

  const participants = deriveParticipants(state)
  const virtualTime = state?.virtualTime ?? 0
  const topic = state?.topic ?? ''

  return (
    <div className="flex flex-col h-screen">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-gray-800 shrink-0">
        {/* Left: view toggle */}
        <div className="flex items-center gap-1 bg-gray-900 rounded-lg p-0.5">
          <button
            onClick={() => setViewMode('roundtable')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              viewMode === 'roundtable'
                ? 'bg-gray-700 text-gray-200'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            圆桌
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              viewMode === 'list'
                ? 'bg-gray-700 text-gray-200'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            列表
          </button>
        </div>

        {/* Center: topic + virtual clock */}
        <div className="text-center">
          <div className="text-xs text-gray-400 mb-0.5">{topic}</div>
          <div className="font-mono text-lg font-light tracking-wider">{formatTime(virtualTime)}</div>
        </div>

        {/* Right: controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowDebug(!showDebug)}
            className={`px-3 py-1.5 rounded-lg text-xs border transition-all ${
              showDebug
                ? 'border-gray-400 text-gray-200'
                : 'border-gray-700 text-gray-500 hover:text-gray-300'
            }`}
          >
            Debug
          </button>
          {status === 'running' ? (
            <button
              onClick={discussion.pause}
              className="px-3 py-1.5 rounded-lg text-xs border border-gray-700 text-gray-500 hover:text-gray-300"
            >
              暂停
            </button>
          ) : status === 'paused' ? (
            <button
              onClick={discussion.resume}
              className="px-3 py-1.5 rounded-lg text-xs border border-yellow-700 text-yellow-500 hover:text-yellow-300"
            >
              继续
            </button>
          ) : null}
          <button
            onClick={onBack}
            className="px-3 py-1.5 rounded-lg text-xs border border-gray-700 text-gray-500 hover:text-red-400"
          >
            结束
          </button>
          {status === 'ended' && (
            <span className="text-xs text-gray-600">已结束</span>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-hidden">
          {viewMode === 'roundtable' ? (
            <RoundtableView participants={participants} events={events} />
          ) : (
            <ListView participants={participants} events={events} />
          )}
        </div>

        {/* Debug panel */}
        {showDebug && (
          <DebugPanel
            participants={participants}
            debug={latestDebug}
            state={state}
          />
        )}
      </div>
    </div>
  )
}

function DebugPanel({ participants, debug, state }: {
  participants: ParticipantDisplay[]
  debug: IterationDebugInfo | null
  state: SessionState | null
}) {
  return (
    <div className="w-80 border-l border-gray-800 overflow-y-auto p-4 bg-gray-900/50 shrink-0">
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
        Debug {debug ? `— Iteration #${debug.iterationId}` : ''}
      </h3>
      {debug ? (
        <>
          {debug.normalizedResults.map(r => {
            const p = participants.find(pp => pp.id === r.agentId)
            const color = p?.color ?? 'bg-gray-500'
            const name = p?.name ?? r.agentId
            const callInput = debug.callInputs.find(c => c.agentId === r.agentId)
            return (
              <div key={r.agentId} className="mb-4">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`w-2 h-2 rounded-full ${color}`} />
                  <span className="text-xs font-medium text-gray-400">{name}</span>
                  <span className="text-xs text-gray-600">{callInput?.mode ?? '?'}</span>
                </div>
                <pre className="text-xs text-gray-500 bg-gray-800/50 rounded p-2 overflow-x-auto whitespace-pre-wrap">
                  {r.output.type === 'speech'
                    ? `"${r.output.text}"`
                    : r.output.type === 'silence'
                      ? '[silence]'
                      : r.output.type === 'end_of_turn'
                        ? '[end_of_turn]'
                        : `[error: ${(r.output as { message: string }).message}]`}
                </pre>
              </div>
            )
          })}
          <div className="text-xs text-gray-600 mt-2 pt-2 border-t border-gray-800">
            <div>Wall clock: {debug.wallClockMs}ms</div>
            <div>Phase: {state?.phase ?? '?'}</div>
            <div>Virtual time: {state ? formatTime(state.virtualTime) : '?'}</div>
          </div>
        </>
      ) : (
        <div className="text-xs text-gray-600">等待第一次迭代...</div>
      )}
    </div>
  )
}
