// SlotShift 并行执行模拟器（本地模型模拟）
// 明确声明：这是确定性的本地模型模拟，用于解释 Monad 乐观并行执行的概念，
// 不代表真实节点内部调度，也不预测真实性能提升百分比。
// 理论依据（Monad 公开文档口径）：Monad 采用乐观并行执行，
//   交易先并行乐观执行，若发生状态访问冲突（写-写 / 读-写依赖）则按
//   依赖关系串行重执行。合约的并行友好性取决于交易之间是否触碰同一状态。

export interface SimTx {
  id: number;
  from: string; // 用户名
  kind: "shared" | "independent";
  slots: number[]; // 读写涉及的存储槽（模型抽象）
  conflictsWith: number[]; // 与哪些交易有依赖（串行化原因）
  gas: number;
}

export interface SimLane {
  lane: number; // 0..3 四条虚拟执行通道
  txIds: number[];
}

export interface SimResult {
  mode: "shared" | "independent";
  txs: SimTx[];
  lanes: SimLane[];
  // 每笔交易的执行轮次（乐观执行轮）：轮次越高代表被依赖推迟
  rounds: Record<number, number>;
  conflictPairs: { a: number; b: number; reason: string }[];
  totalRounds: number;
  note: string;
  txnById: (id: number) => SimTx | undefined;
}

const USER_COUNT = 8;

function slotOf(kind: "shared" | "independent", user: number): number {
  // 模型抽象：
  // shared: 所有用户写同一个 slot 0
  // independent: 每个用户写自己的 slot 100+user
  return kind === "shared" ? 0 : 100 + user;
}

export function simulate(mode: "shared" | "independent", txCount = 8): SimResult {
  const txs: SimTx[] = [];
  const users = Array.from({ length: USER_COUNT }, (_, i) => `user${i + 1}`);
  for (let i = 0; i < txCount; i++) {
    const user = i % USER_COUNT;
    const kind = mode;
    const slot = slotOf(kind, user);
    txs.push({
      id: i,
      from: users[user],
      kind,
      slots: [slot],
      conflictsWith: [],
      gas: kind === "shared" ? 53596 : 59746, // 与 forge 实测 gas 一致
    });
  }

  // 冲突推导：同一轮内写同一 slot 的交易存在写-写依赖
  const conflictPairs: { a: number; b: number; reason: string }[] = [];
  for (let i = 0; i < txs.length; i++) {
    for (let j = i + 1; j < txs.length; j++) {
      const overlap = txs[i].slots.some((s) => txs[j].slots.includes(s));
      if (overlap) {
        txs[i].conflictsWith.push(txs[j].id);
        txs[j].conflictsWith.push(txs[i].id);
        conflictPairs.push({
          a: txs[i].id,
          b: txs[j].id,
          reason:
            mode === "shared"
              ? `tx${i} 与 tx${j} 都写 slot 0（共享计数器）→ 写-写依赖，必须串行`
              : "",
        });
      }
    }
  }

  // 分配四条虚拟通道 + 计算执行轮次（依赖深度）
  const LANES = 4;
  const lanes: SimLane[] = Array.from({ length: LANES }, (_, i) => ({ lane: i, txIds: [] }));
  const rounds: Record<number, number> = {};
  const laneLoad = new Array(LANES).fill(0);

  for (const tx of txs) {
    // 依赖深度：所有冲突伙伴的最大轮次 + 1
    const depDepth = tx.conflictsWith.length > 0 && tx.id > Math.min(...tx.conflictsWith)
      ? Math.max(0, ...tx.conflictsWith.filter((c) => c < tx.id).map((c) => rounds[c] ?? 0)) + 1
      : 0;
    rounds[tx.id] = depDepth;
    // 分配到当前最空的通道（模型抽象，不代表真实调度）
    const lane = laneLoad.indexOf(Math.min(...laneLoad));
    lanes[lane].txIds.push(tx.id);
    laneLoad[lane] += 1 + depDepth;
  }

  const totalRounds = Math.max(0, ...Object.values(rounds)) + 1;

  const note =
    mode === "shared"
      ? `本地模型模拟：${txCount} 笔交易全部写 slot 0，构成一条写-写依赖链，` +
        `理论最少需要 ${totalRounds} 轮串行确认。4 条虚拟通道无法并行消化同槽写入。`
      : `本地模型模拟：${txCount} 笔交易各写独立槽（100+user），无写-写依赖，` +
        `全部交易可在第 1 轮并行乐观执行，4 条虚拟通道均可满载。`;

  return { mode, txs, lanes, rounds, conflictPairs, totalRounds, note, txnById: (id: number) => txs.find((t) => t.id === id) };
}
