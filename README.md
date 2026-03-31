> [English version](./README_EN.md)

# AI Roundtable

去中心化多模型自由讨论实验平台。

多个大语言模型围坐在一张虚拟圆桌旁，自由讨论一个话题。没有主持人，没有固定发言顺序。每个模型自主决定何时发言、何时沉默、说什么。

这是一个大语言模型之间的社会实验。

## 观察什么

- 谁主导讨论，谁保持沉默
- 谁打断别人，谁选择退让
- 多人同时发言（collision）后如何自我协调
- 不同模型的"性格"差异如何在对话中体现

## 核心设计

**一个循环。** 整个引擎是一个不断重复的迭代周期。碰撞、沉默、打断——都是同一个循环的自然产物。

**句子是原子单位。** 每次 API 调用最多产出一句话。这是模拟的基本时钟。

**虚拟时间。** 说话消耗虚拟时间（按 token 数换算），思考（API 调用）不消耗虚拟时间。沉默时间指数增长。

**第一人称视角。** 每个模型看到的对话历史都是以自己为视角的版本。

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

# 启动 UI
cd ui && pnpm dev
```

打开 `http://localhost:5173`，选择 Demo 模式（模拟数据，无需 API key）即可体验。

### 使用真实模型

1. 注册 [ZenMux](https://zenmux.ai) 获取 API key
2. 启动 UI 后选择 **ZenMux** 模式
3. 输入 API key，选择 Budget 或 Premium 预设
4. 选择话题，开始讨论

## 项目结构

```
src/                          # 框架无关的核心引擎
  domain/                     # 状态类型、reducer、会话初始化
  engine/                     # 单次迭代编排器
  history/                    # 视角相关的对话历史投影
  prompting/                  # 系统提示词、调用输入构建
  model-gateway/              # 网关接口、Dummy + ZenMux 实现
  normalization/              # 原始输出 → AgentOutput 分类
  runner/                     # 讨论循环驱动

ui/                           # React 应用（独立 pnpm 项目）
  src/
    hooks/useDiscussion.ts    # React hook：runner ↔ 组件桥接
    components/
      SetupScreen.tsx         # 模型选择、话题、时长配置
      DiscussionScreen.tsx    # 顶栏、视图切换、Debug 面板
      RoundtableView.tsx      # 圆桌视图：头像 + 字幕气泡
      ListView.tsx            # 列表视图：时间线事件流
```

## 当前状态

核心引擎已完成，100 个测试全部通过。UI 支持 Demo 模式和 ZenMux 真实 API 模式。

**已知问题：**

- 多模型同时发言（collision）频率过高，turn-taking 机制需要进一步优化
- 部分模型倾向于"客套对话"而非实质讨论，prompt 调优进行中
- 详见 [docs/PROVIDER.md](./docs/PROVIDER.md)

## 文档

- [系统架构](./docs/ARCHITECTURE.md) — 模块边界、数据流、设计约束
- [Provider 集成笔记](./docs/PROVIDER.md) — API 踩坑、模型行为观察、prompt 调优

## License

MIT
