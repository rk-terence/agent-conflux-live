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
- [x] LLM 输出结构化：reaction 返回 `{ speech, insistence }`，negotiation 返回 `{ insistence }`，voting 返回 `{ vote }`
- [x] 碰撞协商从二值 insist/yield 改为四层级系统（预声明意愿 → 多轮三档协商 → 旁观者投票 → 随机），保证收敛
- [x] Normalization 增加 JSON 提取与结构化解析，保留对自由文本的向后兼容 fallback
- [x] `InsistenceLevel` 类型贯穿 domain → engine → negotiation 全链路
- [x] 饥饿保护：连续碰撞失败 ≥2 次后在 reaction 和 negotiation prompt 中加入 starvation hint，告知 agent 失败次数
- [x] 协商 API 重试：Tier 2/3 调用失败时最多重试 2 次（线性退避），处理 cancelled 信号，全部失败后才 fallback

## Next
- [ ] 减少 meta 发言（如”让我把话说完””抱歉刚才重叠了”），让模型更聚焦话题本身
- [x] 引导模型产出更有差异化的观点，而非互相附和（新增”不需要附和”规则）
- [ ] 研究不同话题类型下的 prompt 表现差异
- [x] 处理模型输出过长的问题（REACTION_MAX_TOKENS 400→250 + 简洁表达规则）
- [ ] 研究 temperature 对讨论多样性的影响
- [ ] 增加基于 JSONL 的自动化分析脚本（collision 率、发言分布、协商模式）
- [ ] 增加 prompt A/B 测试框架

## Open Questions

- 当前重复检测仍是逐字匹配；是否需要升级为语义相似度检测？
- 四层级协商的 Tier 1 解决率是否足够高？是否需要调整 insistence prompt 引导？
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
- [ ] 在结构化输出基础上增加 emotion / reaction 字段（如 `{ speech, insistence, emotion }`）
- [ ] 给 agent 增加情绪 / 反应状态，而不要求必须发言
- [ ] 增加圆桌视图的表情动画和反应气泡
- [ ] 实时展示协商过程（谁在坚持、谁在让步）
- [ ] 增加讨论热度 / 节奏的可视化
- [ ] 完成移动端适配

## Thinking Model Integration

- [ ] 调研思考模型（Gemini 2.5 Flash/Pro 等）的 max_tokens 策略：当前 10x 乘数在投票等短输出场景仍可能不够，思考开销不可控
- [ ] 在 gateway 层捕获 reasoning content（API 响应中的独立字段），扩展 ModelCallOutput 和日志记录
- [ ] 将思考内容纳入日志（.log 和 .jsonl），用于观察模型的内部推理过程——对社会实验的分析有独立价值
- [ ] 评估是否在 UI 中展示思考过程（折叠面板或独立视图）

## Cost And Scalability

- [ ] 对较早历史做摘要压缩，只保留近期完整文本
- [ ] 分析并优化协商调用的 token 开销（每次 collision 的额外 API 调用）
- [ ] 研究静默概率高的 agent 是否可以降低调用频率
- [ ] 探索 streaming 支持，提前中断明显是 silence 的响应

## Session And Output

- [ ] 增加讨论存档与回放
- [ ] 支持导出为可分享的格式（图片、视频、文本摘要）
- [ ] 支持多话题连续讨论
