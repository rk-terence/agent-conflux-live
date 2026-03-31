import { useState } from 'react'
import type { SetupConfig } from '../App'

const MODELS = [
  { id: 'claude', name: 'Claude Sonnet 4', provider: 'Anthropic', color: 'bg-orange-500' },
  { id: 'gpt4o', name: 'GPT-4o', provider: 'OpenAI', color: 'bg-green-500' },
  { id: 'gemini', name: 'Gemini 2.5 Flash', provider: 'Google', color: 'bg-blue-500' },
  { id: 'deepseek', name: 'DeepSeek Chat', provider: 'DeepSeek', color: 'bg-purple-500' },
  { id: 'qwen', name: 'Qwen Plus', provider: 'Qwen', color: 'bg-cyan-500' },
  { id: 'llama', name: 'Llama 3.3 70B', provider: 'Groq', color: 'bg-red-500' },
] as const

const PRESET_TOPICS = [
  'AI 有没有意识？',
  '人类会被 AI 取代吗？',
  '什么是幸福？',
  '自由意志存在吗？',
  '宇宙有没有尽头？',
]

type Props = {
  onStart: (config: SetupConfig) => void
}

export function SetupScreen({ onStart }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set(['claude', 'gpt4o', 'gemini']))
  const [topic, setTopic] = useState(PRESET_TOPICS[0])
  const [customTopic, setCustomTopic] = useState('')
  const [useCustom, setUseCustom] = useState(false)
  const [duration, setDuration] = useState(180)

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const canStart = selected.size >= 2 && (useCustom ? customTopic.trim() : topic)

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      {/* Header */}
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold tracking-tight mb-2">AI Roundtable</h1>
        <p className="text-gray-400">去中心化多模型自由讨论</p>
      </div>

      {/* Model selector */}
      <section className="mb-10">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
          选择参与模型
          <span className="ml-2 text-gray-500">（至少 2 个）</span>
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {MODELS.map(m => (
            <button
              key={m.id}
              onClick={() => toggle(m.id)}
              className={`relative rounded-xl border-2 p-4 text-left transition-all ${
                selected.has(m.id)
                  ? 'border-gray-400 bg-gray-800/80'
                  : 'border-gray-700/50 bg-gray-900/50 opacity-50 hover:opacity-75'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className={`w-2.5 h-2.5 rounded-full ${m.color}`} />
                <span className="font-medium text-sm">{m.name}</span>
              </div>
              <span className="text-xs text-gray-500">{m.provider}</span>
              {selected.has(m.id) && (
                <span className="absolute top-2 right-2 text-gray-400 text-xs">&#10003;</span>
              )}
            </button>
          ))}
        </div>
      </section>

      {/* Demo mode notice */}
      <section className="mb-10">
        <div className="rounded-xl border border-yellow-900/50 bg-yellow-950/20 px-4 py-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-yellow-500 text-sm font-medium">Demo 模式</span>
          </div>
          <p className="text-xs text-gray-400">
            当前使用模拟数据运行，无需 API Key。接入真实 Provider 后将在此处配置密钥。
          </p>
        </div>
      </section>

      {/* Topic */}
      <section className="mb-10">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
          讨论话题
        </h2>

        {/* Preset topics */}
        <div className="flex flex-wrap gap-2 mb-3">
          {PRESET_TOPICS.map(t => (
            <button
              key={t}
              onClick={() => { setTopic(t); setUseCustom(false) }}
              className={`px-3 py-1.5 rounded-full text-sm border transition-all ${
                !useCustom && topic === t
                  ? 'border-gray-400 bg-gray-800 text-gray-200'
                  : 'border-gray-700 text-gray-500 hover:text-gray-300'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Custom topic */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setUseCustom(true)}
            className={`text-sm shrink-0 ${useCustom ? 'text-gray-200' : 'text-gray-500'}`}
          >
            自定义:
          </button>
          <input
            type="text"
            value={customTopic}
            onChange={e => { setCustomTopic(e.target.value); setUseCustom(true) }}
            placeholder="输入话题..."
            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 placeholder-gray-600 focus:outline-none focus:border-gray-500"
          />
        </div>
      </section>

      {/* Duration */}
      <section className="mb-12">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
          虚拟时长
          <span className="ml-2 text-gray-300 font-mono">{duration}s</span>
          <span className="ml-1 text-gray-500 font-normal">({Math.floor(duration / 60)} 分 {duration % 60} 秒)</span>
        </h2>
        <input
          type="range"
          min={60}
          max={600}
          step={30}
          value={duration}
          onChange={e => setDuration(Number(e.target.value))}
          className="w-full accent-gray-400"
        />
        <div className="flex justify-between text-xs text-gray-600 mt-1">
          <span>1 min</span>
          <span>10 min</span>
        </div>
      </section>

      {/* Start button */}
      <button
        onClick={() => {
          const selectedModels = MODELS.filter(m => selected.has(m.id))
          onStart({
            topic: useCustom ? customTopic.trim() : topic,
            participants: selectedModels.map(m => ({
              agentId: m.id,
              name: m.name.split(' ')[0],
            })),
            durationSeconds: duration,
          })
        }}
        disabled={!canStart}
        className={`w-full py-3 rounded-xl font-semibold text-lg transition-all ${
          canStart
            ? 'bg-gray-100 text-gray-900 hover:bg-white cursor-pointer'
            : 'bg-gray-800 text-gray-600 cursor-not-allowed'
        }`}
      >
        开始讨论
      </button>
    </div>
  )
}
