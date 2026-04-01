# Roadmap

## Done

底层清理（API 面、日志、文档对齐）已完成：

- 移除 continuation mode 残留（CallMode、barrel 导出、SmartDummy/ZenMux 死分支）
- 移除 `speaking` phase 和 `EngineIterationFailure` 死路径
- SmartDummyGateway 构造函数接受 `speakChanceOverride`，性格与真实 API 观察对齐
- CLI 日志修正：iterationId 不再硬编码、events 落盘时序正确、retry 后 rawOutputs 一致、iteration_start 使用迭代前 state
- 全部失败不重试策略在代码/测试/文档中统一
- License 对齐（MIT）、UI preset 描述修正、UI 标注为实验性

## Phase 1: Prompt 与机制优化（近期）

核心讨论流程已跑通且底层已清理干净，下一步聚焦模型产出质量和讨论节奏。

- **协商机制调优**
  - 真实 API 观察：DeepSeek 几乎从不 yield，Gemini 过度谦让（SmartDummy 已对齐此行为）
  - 研究是否需要在协商 prompt 中加入更多上下文引导来平衡
  - 协商轮数过多时（4-5 轮）的收敛效率
  - 全部让步后重试的策略是否需要调整

- **Prompt 精细化**
  - 减少 meta 发言（"让我把话说完"、"抱歉刚才重叠了"）——模型应专注话题本身
  - 引导模型产出更有差异化的观点，而非互相附和
  - 研究不同话题类型下的 prompt 表现

- **发言质量保障**
  - 优化重复检测：当前是逐字匹配，考虑语义相似度检测
  - 处理模型输出过长的问题（有些模型一次说几百字）
  - 研究 temperature 对讨论多样性的影响

- **日志分析工具**
  - 基于 JSONL 的自动化分析脚本（collision 率、发言分布、协商模式）
  - Prompt A/B 测试框架

## Phase 2: 打断机制（中期）

当前"说完再让别人说"的模型过于礼貌，缺乏真实讨论的动态感。需要重新引入打断机制，但不是之前的 speech collision 方式。

- **设计思路**
  - 不再是"同时调用所有人"导致的被动碰撞
  - 而是其他 agent 主动判断："听到这里我有话要说，要不要打断？"
  - 打断是一个有意识的决策，不是系统层面的意外
  - 被打断的人知道自己被打断了，可以选择让出或坚持

- **可能的实现方式**
  - Speaker 说话后，向 listeners 展示当前发言内容，问"你要打断吗？"
  - 打断请求进入类似 negotiation 的协商流程
  - 被打断者的未说完内容记录在 history 中（"DeepSeek 正在说时被 Qwen 打断"）

- **需要解决的问题**
  - 打断频率控制——不能每轮都打断
  - 打断后的发言权归属
  - 对虚拟时间的影响

## Phase 3: UI 修复与升级（远期）

当前 UI 是实验性的，存在以下已知问题需要先修复，再做功能升级：

- **已知问题（修复优先）**
  - Speaking/listening 指示器失效：架构无 `speaking` phase，`currentTurn` 始终为 null，前端状态推导无效
  - ZenMux 接入缺少 `thinkingAgents`，thinking 模型在 UI 中失去 10x token 补偿
  - 会话串扰：快速重启时旧 runner 的收尾事件可能污染新会话
  - API key 在浏览器端直接持有，仅适合本地自用

- **模型结构化输出**
  - 从纯文本输出升级为结构化 JSON：`{ speech: "...", emotion: "thoughtful", reaction: "nod" }`
  - 表情 / 心情状态：每个 agent 的情绪随讨论变化
  - 对其他人发言的即时反应（点头、皱眉、思考）——不需要发言也能表达态度
  - 内心独白（只在 debug/分析视图中展示）

- **UI 升级**
  - 圆桌视图增加表情动画和反应气泡
  - 实时展示协商过程（谁在坚持、谁在让步）
  - 发言时其他 agent 的微表情变化
  - 讨论热度 / 节奏的可视化
  - 移动端适配

- **Token 耗费优化**
  - 当前每轮所有 agent 都收到完整 history，随讨论推进 prompt 越来越长
  - History 压缩：对较早的发言做摘要，只保留近期的完整文本
  - 协商调用的 token 开销分析与优化（每次 collision 额外 N 次 API 调用）
  - 按需调用：静默概率高的 agent 可以降低调用频率
  - Streaming 支持：提前中断明显是 silence 的响应

- **会话管理**
  - 讨论存档与回放
  - 导出为可分享的格式（图片、视频、文本摘要）
  - 多话题连续讨论
