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

- TypeScript（strict mode，ESM modules）
- Node.js ≥ 20
- Vitest（测试）
- [ZenMux](https://zenmux.ai) 作为 LLM 聚合网关（一个 API key 访问所有模型）

## 快速开始

```bash
# 安装依赖
pnpm install

# 构建
pnpm build
```

### 运行讨论

1. 注册 [ZenMux](https://zenmux.ai) 获取 API key
2. 创建 `.env` 文件：`ZENMUX_API_KEY=your-key`
3. 编辑配置文件（参考 `examples/config.json`）
4. 运行：

```bash
# 使用编译产物
node dist/cli.js examples/config.json

# 或直接运行 TypeScript
npx tsx src/cli.ts examples/config.json

# 验证配置（不实际运行）
node dist/cli.js examples/config.json --dry-run

# 指定日志目录
node dist/cli.js examples/config.json --log-dir ./output
```

运行时，终端会输出人类可读的实时讨论过程；同时在 `logs/` 目录下生成 NDJSON 格式的完整日志文件，记录所有 API 请求/响应、事件和内心独白。

## 项目结构

```
src/
  cli.ts                    CLI 入口：读取配置文件、运行讨论、输出日志
  index.ts                  编程接口：创建会话、运行循环、输出结果
  types.ts                  所有共享类型定义
  config.ts                 SessionConfig 配置、默认值、校验

  core/                     主迭代循环、碰撞解决、打断、去重
  state/                    会话状态、agent 状态、虚拟时间
  prompt/                   Prompt 组装、系统 prompt、turn directive、历史投影、提示、模板
  llm/                      LLMClient 接口、各 provider 适配器、重试
  normalize/                按模式分发的归一化（JSON 提取、发言清洗、各模式归一化）
  util/                     Token 计数、句子分割、名称列表格式化
examples/
  config.json               示例配置文件
```

## 当前状态

核心引擎已完成，CLI 可用。正在迭代改进中。

## 文档

- [设计规范](./docs/DESIGN.md) — 系统行为、语义约束、prompt 文案、历史渲染格式、归一化规则
- [系统架构](./docs/ARCHITECTURE.md) — 模块边界、类型定义、数据流、算法
- [Provider 集成笔记](./docs/PROVIDER.md) — API 踩坑、模型行为观察

## License

MIT
