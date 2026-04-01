# Roadmap

## Completed

- [x] 移除 continuation mode 残留（CallMode、barrel 导出、SmartDummy/ZenMux 死分支）
- [x] 移除 `speaking` phase 和 `EngineIterationFailure` 死路径
- [x] 将 prompt 语义明确拆分为 `system prompt`、`projected history`、`turn directive`
- [x] 对齐 prompt / gateway / logger 术语为 `userPromptText`
- [x] 修正 negotiation history：当前 collision 不再混入 projected history
- [x] SmartDummyGateway 构造函数接受 `speakChanceOverride`，性格与真实 API 观察对齐
- [x] CLI 日志修正：iterationId 不再硬编码、events 落盘时序正确、retry 后 rawOutputs 一致、`iteration_start` 使用迭代前 state
- [x] 全部失败不重试策略在代码、测试、文档中统一
- [x] License 对齐（MIT）、UI preset 描述修正、UI 标注为实验性
- [x] Prompt 常量抽离为模板（`templates/`）+ 严格 `{{slot}}` 渲染器（`render.ts`）
- [x] History 输出格式化为 markdown list（`- [ts]`、`**名字**：`、blockquote）
- [x] `CallMode` 新增 `"negotiation"`，SmartDummyGateway 改用 `mode` 字段判断而非 sniff prompt 文案
- [x] Normalization speaker-prefix regex 拓宽，支持含连字符/点号/空格的 agent 名（如 `GPT-4o`）

## Next

- [ ] 在协商 prompt 中加入更有效的上下文引导，平衡过度强势或过度谦让的模型
- [ ] 评估协商轮数过多时（4-5 轮）的收敛效率
- [ ] 评估“全部让步后重试”策略是否需要调整
- [ ] 减少 meta 发言（如“让我把话说完”“抱歉刚才重叠了”），让模型更聚焦话题本身
- [ ] 引导模型产出更有差异化的观点，而非互相附和
- [ ] 研究不同话题类型下的 prompt 表现差异
- [ ] 处理模型输出过长的问题（有些模型一次说几百字）
- [ ] 研究 temperature 对讨论多样性的影响
- [ ] 增加基于 JSONL 的自动化分析脚本（collision 率、发言分布、协商模式）
- [ ] 增加 prompt A/B 测试框架

## Open Questions

- 当前重复检测仍是逐字匹配；是否需要升级为语义相似度检测？
- 协商机制是否需要对“DeepSeek 几乎不 yield、Gemini 过度谦让”做更强的系统性平衡？
- 历史压缩可以做到多激进，才不会明显伤害讨论质量？
- 按需调用是否会改善成本表现，同时不破坏讨论节奏？

## Interruption Design

- [ ] 重新引入打断机制，但以“主动打断决策”替代旧的被动 speech collision
- [ ] 设计 listener 视角的打断判断：听到当前发言后，决定是否要打断
- [ ] 让被打断者感知自己被打断，并可选择让出或坚持
- [ ] 为打断请求设计类似 negotiation 的协商流程
- [ ] 在 history 中记录被打断者未说完的内容

Open questions:

- 打断频率如何控制，避免每轮都有人打断？
- 打断后的发言权如何归属？
- 打断应如何影响虚拟时间？

## UI And Product

- [ ] 修复 speaking / listening 指示器失效问题（当前架构无 `speaking` phase，`currentTurn` 始终为 `null`）
- [ ] 为 UI 的 ZenMux 接入补上 `thinkingAgents`，恢复 thinking 模型的 10x token 补偿
- [ ] 修复会话串扰：快速重启时旧 runner 的收尾事件可能污染新会话
- [ ] 降低浏览器端直接持有 API key 的风险
- [ ] 从纯文本输出升级到结构化输出，例如 `{ speech, emotion, reaction }`
- [ ] 给 agent 增加情绪 / 反应状态，而不要求必须发言
- [ ] 增加圆桌视图的表情动画和反应气泡
- [ ] 实时展示协商过程（谁在坚持、谁在让步）
- [ ] 增加讨论热度 / 节奏的可视化
- [ ] 完成移动端适配

## Cost And Scalability

- [ ] 对较早历史做摘要压缩，只保留近期完整文本
- [ ] 分析并优化协商调用的 token 开销（每次 collision 的额外 API 调用）
- [ ] 研究静默概率高的 agent 是否可以降低调用频率
- [ ] 探索 streaming 支持，提前中断明显是 silence 的响应

## Session And Output

- [ ] 增加讨论存档与回放
- [ ] 支持导出为可分享的格式（图片、视频、文本摘要）
- [ ] 支持多话题连续讨论
