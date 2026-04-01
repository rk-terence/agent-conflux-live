import { useState } from 'react'
import type { SetupConfig } from '../App'
import { SmartDummyGateway } from '@core/model-gateway/smart-dummy.ts'
import { ZenMuxGateway, PRESET_BUDGET, PRESET_PREMIUM, presetToAgentModels } from '@core/model-gateway/zenmux.ts'
import type { PresetAgent } from '@core/model-gateway/zenmux.ts'

type GatewayMode = 'demo' | 'zenmux'
type PresetKey = 'budget' | 'premium'

const PRESETS: Record<PresetKey, { label: string; description: string; agents: readonly PresetAgent[] }> = {
  budget:  { label: 'Budget',  description: 'PAYG 友好 — DeepSeek, Gemini Flash, Qwen', agents: PRESET_BUDGET },
  premium: { label: 'Premium', description: '订阅推荐 — DeepSeek v3.2, Gemini 2.5 Pro, Qwen3 Max',      agents: PRESET_PREMIUM },
}

const DEMO_AGENTS: readonly PresetAgent[] = [
  { agentId: 'claude',   name: 'Claude',   provider: 'Anthropic', model: 'demo' },
  { agentId: 'gpt4o',    name: 'GPT-4o',   provider: 'OpenAI',    model: 'demo' },
  { agentId: 'gemini',   name: 'Gemini',   provider: 'Google',    model: 'demo' },
  { agentId: 'deepseek', name: 'DeepSeek', provider: 'DeepSeek',  model: 'demo' },
  { agentId: 'qwen',     name: 'Qwen',     provider: 'Alibaba',   model: 'demo' },
  { agentId: 'llama',    name: 'Llama',    provider: 'Meta',      model: 'demo' },
]

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
  const [mode, setMode] = useState<GatewayMode>('demo')
  const [apiKey, setApiKey] = useState('')
  const [presetKey, setPresetKey] = useState<PresetKey>('budget')

  const agents = mode === 'demo' ? DEMO_AGENTS : PRESETS[presetKey].agents
  const [selected, setSelected] = useState<Set<string>>(new Set(agents.slice(0, 3).map(a => a.agentId)))

  const [topic, setTopic] = useState(PRESET_TOPICS[0])
  const [customTopic, setCustomTopic] = useState('')
  const [useCustom, setUseCustom] = useState(false)
  const [duration, setDuration] = useState(180)

  const switchMode = (m: GatewayMode) => {
    setMode(m)
    const nextAgents = m === 'demo' ? DEMO_AGENTS : PRESETS[presetKey].agents
    setSelected(new Set(nextAgents.slice(0, 3).map(a => a.agentId)))
  }

  const switchPreset = (pk: PresetKey) => {
    setPresetKey(pk)
    const nextAgents = PRESETS[pk].agents
    setSelected(new Set(nextAgents.slice(0, 3).map(a => a.agentId)))
  }

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const finalTopic = useCustom ? customTopic.trim() : topic
  const canStart = selected.size >= 2 && finalTopic && (mode === 'demo' || apiKey.trim())

  const handleStart = () => {
    const selectedAgents = agents.filter(a => selected.has(a.agentId))

    const gateway = mode === 'demo'
      ? new SmartDummyGateway(0.3)
      : new ZenMuxGateway({
          apiKey: apiKey.trim(),
          agentModels: presetToAgentModels(selectedAgents),
          defaultModel: PRESETS[presetKey].agents[0].model,
        })

    onStart({
      topic: finalTopic,
      participants: selectedAgents.map(a => ({ agentId: a.agentId, name: a.name })),
      durationSeconds: duration,
      gateway,
    })
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      {/* Header */}
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold tracking-tight mb-2">AI Roundtable</h1>
        <p className="text-gray-400">去中心化多模型自由讨论</p>
      </div>

      {/* Gateway mode toggle */}
      <section className="mb-8">
        <div className="flex rounded-lg border border-gray-700 overflow-hidden">
          <button
            onClick={() => switchMode('demo')}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${
              mode === 'demo' ? 'bg-gray-700 text-gray-100' : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            Demo 模式
          </button>
          <button
            onClick={() => switchMode('zenmux')}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${
              mode === 'zenmux' ? 'bg-gray-700 text-gray-100' : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            ZenMux
          </button>
        </div>
      </section>

      {/* ZenMux config */}
      {mode === 'zenmux' && (
        <section className="mb-8 space-y-4">
          {/* API Key */}
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="zm-..."
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 placeholder-gray-600 focus:outline-none focus:border-gray-500 font-mono"
            />
          </div>

          {/* Preset selector */}
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">模型预设</label>
            <div className="flex gap-2">
              {(Object.keys(PRESETS) as PresetKey[]).map(pk => (
                <button
                  key={pk}
                  onClick={() => switchPreset(pk)}
                  className={`px-3 py-1.5 rounded-lg text-sm border transition-all ${
                    presetKey === pk
                      ? 'border-gray-400 bg-gray-800 text-gray-200'
                      : 'border-gray-700 text-gray-500 hover:text-gray-300'
                  }`}
                >
                  {PRESETS[pk].label}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-1.5">{PRESETS[presetKey].description}</p>
          </div>
        </section>
      )}

      {/* Participant list */}
      <section className="mb-10">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
          参与模型
          <span className="ml-2 text-gray-500">（至少 2 个）</span>
        </h2>
        <div className="space-y-1">
          {agents.map(a => (
            <label
              key={a.agentId}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                selected.has(a.agentId) ? 'bg-gray-800/80' : 'opacity-50 hover:opacity-75'
              }`}
            >
              <input
                type="checkbox"
                checked={selected.has(a.agentId)}
                onChange={() => toggle(a.agentId)}
                className="accent-gray-400"
              />
              <span className="text-sm font-medium flex-1">{a.name}</span>
              <span className="text-xs text-gray-500">{a.provider}</span>
              {mode === 'zenmux' && (
                <span className="text-xs text-gray-600 font-mono">{a.model}</span>
              )}
            </label>
          ))}
        </div>
      </section>

      {/* Topic */}
      <section className="mb-10">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
          讨论话题
        </h2>
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
        onClick={handleStart}
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
