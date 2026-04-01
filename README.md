> [English version](./README_EN.md)

# AI Roundtable

去中心化多模型自由讨论实验平台。

多个大语言模型围坐在一张虚拟圆桌旁，自由讨论一个话题。没有主持人，没有固定发言顺序。每个模型自主决定何时发言、何时沉默、说什么。

当多人同时开口时，模型之间会自主协商谁先说——就像真实的圆桌讨论一样。

这是一个大语言模型之间的社会实验。

## 观察什么

- 谁主导讨论，谁保持沉默
- 多人同时发言（collision）后如何通过协商决定谁先说
- 不同模型的"性格"差异：谁更强势、谁更谦让
- @某人 提问后，被提到的模型如何反应

## 核心设计

**一个循环。** 整个引擎是一个不断重复的迭代周期。碰撞、沉默、协商——都是同一个循环的自然产物。

**完整发言。** 每次 API 调用产出一段完整的发言，不是逐句拼接。

**碰撞协商。** 多人同时开口时，每个模型预声明的发言意愿（低/中/高）先做比较，大多数碰撞在零额外调用内解决。意愿相同时进入多轮协商、旁观者投票、随机兜底四层级机制，保证碰撞一定收敛。这让模型的性格在协商中自然显现。

**发言轮转。** 刚说完话的模型自动跳过一轮，把机会让给其他人。

**虚拟时间。** 说话消耗虚拟时间（按 token 数换算），思考（API 调用）不消耗虚拟时间。

**第一人称视角。** 每个模型看到的对话历史都是以自己为视角的版本——自己说过什么、碰撞时自己想说什么、谁让步了。

## 技术栈

- TypeScript（框架无关的核心引擎）
- React + Vite + Tailwind CSS（UI）
- [ZenMux](https://zenmux.ai) 作为 LLM 聚合网关（一个 API key 访问所有模型）

## 快速开始

```bash
# 安装依赖
pnpm install
cd ui && pnpm install && cd ..

# 运行测试
pnpm test

# CLI 方式运行（推荐用于开发调优）
echo "ZENMUX_API_KEY=your-key" > .env
npx tsx src/cli/run.ts --topic "AI 会取代人类吗？"

# 离线测试（无需 API key）
npx tsx src/cli/run.ts --gateway smart-dummy

# 启动 UI（实验性，已知问题较多，建议优先使用 CLI）
cd ui && pnpm dev
```

### CLI 工具

CLI 是目前最推荐的开发方式。它提供：

- 实时彩色终端输出（发言突出显示，碰撞和协商缩进展示）
- 详细日志文件（`.log` 人类可读 + `.jsonl` 结构化分析）
- 每个模型收到的完整 prompt 和原始 response
- 协商过程的逐轮记录

```bash
npx tsx src/cli/run.ts --help              # 查看所有选项
npx tsx src/cli/run.ts --preset premium    # 使用更强的模型
npx tsx src/cli/run.ts --duration 120      # 设置讨论时长
```

### 使用真实模型

1. 注册 [ZenMux](https://zenmux.ai) 获取 API key
2. 创建 `.env` 文件：`ZENMUX_API_KEY=your-key`
3. `npx tsx src/cli/run.ts`（推荐 CLI 方式运行）

## 项目结构

```
src/                          # 框架无关的核心引擎
  domain/                     # 状态类型、reducer、会话初始化
  engine/                     # 单次迭代编排器
  negotiation/                # 碰撞协商：多轮 insist/yield 决策
  history/                    # 视角相关的对话历史投影
  prompting/                  # Prompt 模板、渲染器、构建器
  model-gateway/              # 网关接口、Dummy + SmartDummy + ZenMux
  normalization/              # 原始输出清洗与分类
  runner/                     # 讨论循环驱动
  cli/                        # CLI 运行器 + 日志记录

ui/                           # React 应用（实验性，已知问题待修，独立 pnpm 项目）
```

## 当前状态

核心引擎已完成，测试全部通过。碰撞协商机制有效运作，讨论能正常推进。CLI 工具提供完整的 prompt/response 日志，用于迭代优化。

## 文档

- [系统架构](./docs/ARCHITECTURE.md) — 模块边界、数据流、设计约束
- [Provider 集成笔记](./docs/PROVIDER.md) — API 踩坑、模型行为观察
- [Roadmap](./docs/ROADMAP.md) — 后续规划

## License

MIT
