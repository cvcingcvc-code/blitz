# SlotShift — Monad Parallel Architecture Lab

> 让普通开发者理解智能合约的**状态访问冲突**：通过可视化模拟与真实 Monad 测试网交易，学习如何写出并行友好的合约。

Monad 采用乐观并行执行（optimistic parallel execution）：交易先并行乐观执行，一旦发生状态访问冲突（写-写 / 读-写依赖），相关交易会按依赖关系串行重执行。**合约的并行友好性取决于交易之间是否触碰同一状态** —— 这就是 SlotShift 要讲清楚的一件事。

## 三个核心功能

| 模块 | 内容 | 数据口径 |
|---|---|---|
| **合约分析** (P0) | Solidity 编辑区 + 受限规则静态分析：识别共享标量状态写入、循环内热点写入；给出问题位置、原因、可解释的优化建议；内置优化前后代码 Diff 视图 | **本地静态规则** — 只识别潜在冲突模式，不能测量运行时冲突频率 |
| **并行模拟** (P0) | 4 条虚拟执行通道，6–12 笔示例交易动画；区分共享状态冲突与独立状态访问；支持优化前后切换；展示理论依赖关系 | **本地模型模拟** — 概念演示，非真实节点调度，无编造性能百分比 |
| **测试网实验** (P1) | 连接 EVM 钱包 → 部署两份最小合约到 Monad Testnet → 发起真实交易；展示交易哈希、Gas、区块号、回执状态、观察到的端到端延迟 | **真实链上数据** — 可在 Monad Explorer 验证 |

模拟数据与实测数据在 UI 中严格区分标注。

## 技术架构

```
SlotShift/
├── contracts/                  # Foundry 工程
│   ├── src/
│   │   ├── SharedCounter.sol       # 反面教材：所有用户写 slot 0（全局计数器）
│   │   └── IndependentRecorder.sol # 优化版：mapping 按地址隔离，每地址独立槽
│   ├── test/SlotShift.t.sol        # 11 个单元测试（含存储槽隔离证明）
│   └── foundry.toml
├── app/                        # React + TypeScript + Vite + Tailwind 前端
│   ├── src/lib/
│   │   ├── analyzer.ts         # 受限规则静态分析引擎（确定性规则，非 AI）
│   │   ├── simulator.ts        # 四通道并行执行模拟（本地确定性模型）
│   │   └── monad.ts            # Monad Testnet 配置 + viem 钱包/交易服务
│   ├── src/components/         # 三个 P0/P1 面板
│   ├── src/artifacts/          # 合约 abi + bytecode（构建期由 solc 生成）
│   └── scripts/build-artifacts.mjs
└── README.md
```

**技术栈**：Solidity 0.8.28 · Foundry · React 18 · TypeScript · Vite 5 · Tailwind CSS · viem 2

**设计取舍**：单页应用，无后端；合约 artifact 在构建期用 solc 编译注入前端，浏览器 bundle 内不含任何私钥；分析层用可解释的确定性规则而非 AI（诚实标注能力边界）。

## 演示方式

```bash
# 前端
cd app
npm install
npm run dev          # http://localhost:5173

# 合约（编译 + 测试）
cd ../contracts
forge build
forge test           # 11/11 pass

# 重新生成合约 artifact（合约改动后）
cd ../app && npm run artifacts
```

**90 秒演示流程**：
1. **合约分析页**：内置「全局计数器」示例 → 一键分析 → 看到 `count += 1` 被标红（共享槽写热点）→ 展开「优化前后差异」看 Diff。
2. **并行模拟页**：切到「优化前」播放动画 → 8 笔交易全部挤在 slot 0，串行成链 → 切到「优化后」→ 8 笔交易各写独立槽，四通道全并行。
3. **测试网实验页**：连接钱包（自动切 Monad Testnet 10143）→ 部署两份合约 → 各发一笔真实交易 → 在 Monad Explorer 验证哈希与回执。

## 测试网配置

| 项 | 值 |
|---|---|
| 网络 | Monad Testnet |
| Chain ID | `10143` (0x279f) |
| RPC | `https://testnet-rpc.monad.xyz` |
| Explorer | `https://testnet.monadexplorer.com` |
| 水龙头 | Monad 官方 Discord / faucet 渠道获取测试 MON |

合约地址：见测试网实验页部署后展示（每次部署由用户钱包签名产生，项目不预置部署）。

## 局限（诚实声明）

1. **静态分析不能测量运行时冲突**。规则引擎只识别「潜在的」共享状态访问模式（AST 级受限规则，非完整 solc 解析），无法给出真实冲突频率或加速比。
2. **模拟是概念模型，不是真实调度**。四通道动画展示的是依赖关系理论（同槽 → 串行，异槽 → 可并行），不代表 Monad 节点内部的实际调度算法；刻意不展示编造的性能提升百分比。
3. **测试网延迟是端到端观察值**。页面展示的 ms 级延迟包含签名、广播与回执轮询，不等于区块内执行时间。
4. **未观察到真实内部并行调度**。除非有可靠节点追踪证据（如 debug API 级别的调度日志），否则不声称「看到了并行调度」——只能验证交易在链上最终成功。
5. **部署依赖用户钱包**。项目不托管私钥、不预置部署；缺少钱包/测试币/网络时对应功能显示 BLOCKED，不伪造结果。

## 未来扩展

- 静态分析层：接入完整 solc AST 解析，支持继承 / modifier / 汇总到存储槽级的冲突图。
- 模拟层：支持用户自定义交易负载（混合读写比例、多合约交叉访问），对比理论轮次曲线。
- 实验层：批量发送 N 笔交易并统计吞吐衰减曲线，用真实数据验证「共享热点 → 串行化」。
- AI 解释层：在确定性规则之上加一层自然语言解释（时间充裕时的可选项，当前刻意未接）。

## 许可

MIT
