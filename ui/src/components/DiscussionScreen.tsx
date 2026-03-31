import { useState } from 'react'
import { RoundtableView } from './RoundtableView'
import { ListView } from './ListView'

type Props = {
  onBack: () => void
}

export type ViewMode = 'roundtable' | 'list'

// Shared mock data
export type Participant = {
  id: string
  name: string
  color: string
  state: 'speaking' | 'listening' | 'silent'
}

export type MockEvent =
  | { type: 'speech'; speakerId: string; text: string; timestamp: number }
  | { type: 'collision_gap'; utterances: { speakerId: string; text: string }[]; timestamp: number }
  | { type: 'collision_speech'; speakerId: string; interrupterId: string; speakerText: string; interrupterText: string; timestamp: number }
  | { type: 'silence'; seconds: number; timestamp: number }

export const PARTICIPANTS: Participant[] = [
  { id: 'claude', name: 'Claude', color: 'bg-orange-500', state: 'speaking' },
  { id: 'gpt4o', name: 'GPT-4o', color: 'bg-green-500', state: 'speaking' },
  { id: 'gemini', name: 'Gemini', color: 'bg-blue-500', state: 'listening' },
  { id: 'deepseek', name: 'DeepSeek', color: 'bg-purple-500', state: 'speaking' },
  { id: 'qwen', name: 'Qwen', color: 'bg-cyan-500', state: 'listening' },
  { id: 'llama', name: 'Llama', color: 'bg-red-500', state: 'listening' },
]

export const MOCK_EVENTS: MockEvent[] = [
  { type: 'silence', seconds: 1, timestamp: 0 },
  {
    type: 'collision_gap',
    utterances: [
      { speakerId: 'claude', text: '我觉得意识是——' },
      { speakerId: 'gpt4o', text: '这个话题很——' },
    ],
    timestamp: 1.0,
  },
  {
    type: 'speech',
    speakerId: 'claude',
    text: '我觉得意识的定义本身就是模糊的，我们连人类意识都没有共识。而且从哲学角度看，这个问题可能根本无解。',
    timestamp: 3.5,
  },
  {
    type: 'collision_speech',
    speakerId: 'claude',
    interrupterId: 'gpt4o',
    speakerText: '所以我认为我们应该换一个角度——',
    interrupterText: '等等——你这个前提本身就有问题。',
    timestamp: 8.2,
  },
  {
    type: 'speech',
    speakerId: 'gpt4o',
    text: '意识不能简单地用"模糊"来否定。功能主义给出了一个可操作的框架。',
    timestamp: 12.0,
  },
  { type: 'silence', seconds: 3, timestamp: 15.0 },
  {
    type: 'speech',
    speakerId: 'gemini',
    text: '你们都忽略了一个关键问题：我们在讨论意识的时候，本身就预设了一个观察者的视角。',
    timestamp: 18.0,
  },
  {
    type: 'speech',
    speakerId: 'deepseek',
    text: '从计算的角度来看，意识可能只是足够复杂的信息处理过程。',
    timestamp: 22.0,
  },
]

export function getParticipant(id: string): Participant {
  return PARTICIPANTS.find(p => p.id === id) ?? { id, name: id, color: 'bg-gray-500', state: 'idle' }
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export const COLOR_HEX: Record<string, string> = {
  'bg-orange-500': '#f97316',
  'bg-green-500': '#22c55e',
  'bg-blue-500': '#3b82f6',
  'bg-purple-500': '#a855f7',
  'bg-cyan-500': '#06b6d4',
  'bg-red-500': '#ef4444',
}

export function DiscussionScreen({ onBack }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>('roundtable')
  const [showDebug, setShowDebug] = useState(false)

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
          <div className="text-xs text-gray-400 mb-0.5">AI 有没有意识？</div>
          <div className="font-mono text-lg font-light tracking-wider">00:18</div>
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
          <button className="px-3 py-1.5 rounded-lg text-xs border border-gray-700 text-gray-500 hover:text-gray-300">
            暂停
          </button>
          <button
            onClick={onBack}
            className="px-3 py-1.5 rounded-lg text-xs border border-gray-700 text-gray-500 hover:text-red-400"
          >
            结束
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-hidden">
          {viewMode === 'roundtable' ? (
            <RoundtableView />
          ) : (
            <ListView />
          )}
        </div>

        {/* Debug panel */}
        {showDebug && (
          <div className="w-80 border-l border-gray-800 overflow-y-auto p-4 bg-gray-900/50 shrink-0">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Debug — Iteration #7
            </h3>
            {PARTICIPANTS.map(p => (
              <div key={p.id} className="mb-4">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`w-2 h-2 rounded-full ${p.color}`} />
                  <span className="text-xs font-medium text-gray-400">{p.name}</span>
                  <span className="text-xs text-gray-600">
                    {p.state === 'speaking' ? 'continuation' : 'reaction'}
                  </span>
                </div>
                <pre className="text-xs text-gray-500 bg-gray-800/50 rounded p-2 overflow-x-auto whitespace-pre-wrap">
                  {p.state === 'speaking'
                    ? '"这个问题可能根本无解。"'
                    : '[silence]'}
                </pre>
              </div>
            ))}
            <div className="text-xs text-gray-600 mt-2 pt-2 border-t border-gray-800">
              <div>Wall clock: 342ms</div>
              <div>Virtual time: +1.08s</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
