// SlotShift 静态分析规则引擎
// 受限规则分析：识别 Solidity 合约中的共享状态写入风险。
// 明确声明：这是基于 AST 的确定性规则分析，只能识别「潜在的」共享状态
// 访问模式，不能准确测量运行时的真实冲突频率——真实并行调度只能在
// Monad 测试网上用真实交易观察。

export interface CodeLocation {
  line: number;
  column: number;
  endLine?: number;
}

export interface AnalysisIssue {
  ruleId: string;
  severity: "high" | "medium" | "low" | "info";
  title: string;
  reason: string;
  suggestion: string;
  location: CodeLocation;
  snippet: string;
  stateVar?: string;
}

export interface StateVarInfo {
  name: string;
  type: "value" | "mapping" | "array" | "unknown";
  line: number;
  isPublic: boolean;
}

export interface AnalysisResult {
  issues: AnalysisIssue[];
  stateVars: StateVarInfo[];
  sharedWriteVars: string[]; // 被普通（非 mapping）状态变量写入的变量名
  parallelFriendlyScore: "poor" | "fair" | "good" | "unknown";
  summary: string;
}

// ---------- 极简 Solidity AST 提取（正则+结构化规则，不引入完整 solc 解析器） ----------

function stripComments(src: string): string {
  return src
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

function extractStateVars(stripped: string): StateVarInfo[] {
  const vars: StateVarInfo[] = [];
  const lines = stripped.split("\n");
  // 匹配合约级状态变量声明： type [visibility] name [= ...];
  const re =
    /^\s*(uint\d*|int\d*|address|bool|bytes\d*|string|mapping\([^)]*\)\s*=>\s*[^ ]+|\w+\[\])\s*(public|private|internal|external)?\s*(\w+)\s*(=|;)/;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(re);
    if (!m) continue;
    const typeStr = m[1];
    let type: StateVarInfo["type"] = "unknown";
    if (typeStr.startsWith("mapping")) type = "mapping";
    else if (typeStr.endsWith("[]")) type = "array";
    else type = "value";
    vars.push({
      name: m[3],
      type,
      line: i + 1,
      isPublic: m[2] === "public",
    });
  }
  return vars;
}

function extractFunctions(stripped: string): { name: string; startLine: number; endLine: number; body: string }[] {
  const fns: { name: string; startLine: number; endLine: number; body: string }[] = [];
  const lines = stripped.split("\n");
  const fnRe = /function\s+(\w+)\s*\(/;
  let current: { name: string; startLine: number; lines: string[] } | null = null;
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!current && fnRe.test(line)) {
      const m = line.match(fnRe)!;
      current = { name: m[1], startLine: i + 1, lines: [] };
    }
    if (current) {
      current.lines.push(line);
      for (const ch of line) {
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
      }
      if (depth <= 0 && current.lines.join("\n").includes("{")) {
        fns.push({
          name: current.name,
          startLine: current.startLine,
          endLine: i + 1,
          body: current.lines.join("\n"),
        });
        current = null;
        depth = 0;
      }
    }
  }
  return fns;
}

// ---------- 规则 ----------

const RULES = {
  SHARED_SCALAR_WRITE: {
    id: "SHARED_SCALAR_WRITE",
    severity: "high" as const,
    title: "共享标量状态写入（写热点）",
  },
  LOOP_SHARED_WRITE: {
    id: "LOOP_SHARED_WRITE",
    severity: "high" as const,
    title: "循环内重复写共享状态",
  },
  MAPPING_FRIENDLY: {
    id: "MAPPING_FRIENDLY",
    severity: "info" as const,
    title: "按地址隔离存储（并行友好）",
  },
  GLOBAL_READWRITE_IN_HOT_FN: {
    id: "GLOBAL_READWRITE_IN_HOT_FN",
    severity: "medium" as const,
    title: "外部可调用函数读改写全局状态",
  },
};

export function analyze(source: string): AnalysisResult {
  const stripped = stripComments(source);
  const stateVars = extractStateVars(stripped);
  const fns = extractFunctions(stripped);
  const issues: AnalysisIssue[] = [];

  const scalarVars = stateVars.filter((v) => v.type === "value");
  const mappingVars = stateVars.filter((v) => v.type === "mapping");
  const sharedWriteVars: string[] = [];

  // 规则1：外部可调用函数写共享标量状态
  for (const fn of fns) {
    const isViewOrPure = /\bview\b|\bpure\b/.test(fn.body.split("{")[0]);
    if (isViewOrPure) continue;
    for (const v of scalarVars) {
      // 写检测：v +=、v++、v--、v =（排除 ==、<=、>=、!=）
      const writeRe = new RegExp(`\\b${v.name}\\b\\s*(\\+=|-=|\\+\\+|--|(=(?![=>])))`);
      let match: RegExpExecArray | null;
      const re = new RegExp(writeRe.source, "g");
      let found = false;
      while ((match = re.exec(fn.body)) !== null) {
        found = true;
        const absIdx = fn.body.indexOf("\n") >= 0 ? computeAbsLine(fn, match.index) : 0;
        const line = fn.startLine + absIdx;
        if (!sharedWriteVars.includes(v.name)) sharedWriteVars.push(v.name);
        issues.push({
          ruleId: RULES.SHARED_SCALAR_WRITE.id,
          severity: RULES.SHARED_SCALAR_WRITE.severity,
          title: RULES.SHARED_SCALAR_WRITE.title,
          reason:
            `函数 ${fn.name}() 对状态变量 ${v.name}（声明于第 ${v.line} 行）执行写入。` +
            `${v.name} 是单一标量存储槽，所有用户的交易都会读写同一个 slot。` +
            `在 Monad 的乐观并行执行模型下，写同一槽的交易存在写-写依赖，无法并行确认，会触发串行重执行。`,
          suggestion:
            v.type === "value"
              ? `按访问主体隔离状态：改用 mapping(address => uint256) 让每个地址写自己的槽；` +
                `或改用 events 记录（不写存储）；如确需全局聚合，考虑链下汇总。` +
                `注意：静态分析只能识别潜在冲突模式，不能测量运行时冲突频率。`
              : `考虑按主体隔离或事件化。`,
          location: { line, column: 0 },
          snippet: extractLine(source, line),
          stateVar: v.name,
        });
        break; // 每函数每变量报一次
      }
      void found;
    }
  }

  // 规则2：循环内写共享状态
  for (const fn of fns) {
    const loopMatch = fn.body.match(/\bfor\s*\(|\bwhile\s*\(/);
    if (!loopMatch) continue;
    for (const varName of sharedWriteVars) {
      const writeRe = new RegExp(`\\b${varName}\\b\\s*(\\+=|-=|\\+\\+|--|(=(?![=>])))`);
      if (writeRe.test(fn.body)) {
        const loopLine = fn.startLine + countLinesBefore(fn.body, loopMatch.index ?? 0);
        issues.push({
          ruleId: RULES.LOOP_SHARED_WRITE.id,
          severity: "high",
          title: RULES.LOOP_SHARED_WRITE.title,
          reason: `函数 ${fn.name}() 在循环中重复写入 ${varName}，每次迭代都对同一存储槽执行 SSTORE，冲突面随迭代次数线性放大。`,
          suggestion: `消除循环内写入：改为一次性计算后单次写入；或将聚合逻辑移到链下 / 事件流。`,
          location: { line: loopLine, column: 0 },
          snippet: extractLine(source, loopLine),
          stateVar: varName,
        });
        break;
      }
    }
  }

  // 规则3：mapping 隔离（正面信号）
  for (const v of mappingVars) {
    issues.push({
      ruleId: RULES.MAPPING_FRIENDLY.id,
      severity: "info",
      title: RULES.MAPPING_FRIENDLY.title,
      reason: `状态变量 ${v.name}（第 ${v.line} 行）是 mapping，按 key 隔离存储槽，不同 key 的写入互不冲突，是 Monad 并行友好的设计模式。`,
      suggestion: `保持这种按主体隔离的设计；避免在 mapping 写入之外再写共享标量。`,
      location: { line: v.line, column: 0 },
      snippet: extractLine(source, v.line),
      stateVar: v.name,
    });
  }

  // 评分
  const highCount = issues.filter((i) => i.severity === "high").length;
  let score: AnalysisResult["parallelFriendlyScore"] = "unknown";
  if (sharedWriteVars.length > 0) score = highCount > 1 ? "poor" : "fair";
  else if (mappingVars.length > 0 || stateVars.length === 0) score = "good";
  else score = "fair";

  const summary =
    sharedWriteVars.length > 0
      ? `发现 ${sharedWriteVars.length} 个共享状态写入热点（${sharedWriteVars.join(", ")}）。` +
        `这些变量的所有写入落在同一存储槽，是并行执行的串行化根源。`
      : `未发现共享标量状态写入。` +
        (mappingVars.length > 0
          ? `检测到按 key 隔离的 mapping 存储，属于并行友好模式。`
          : `合约没有可写状态。`);

  return { issues, stateVars, sharedWriteVars, parallelFriendlyScore: score, summary };
}

function computeAbsLine(fn: { body: string }, relIdx: number): number {
  return fn.body.slice(0, relIdx).split("\n").length - 1;
}

function countLinesBefore(body: string, idx: number): number {
  return body.slice(0, idx).split("\n").length - 1;
}

function extractLine(source: string, line: number): string {
  const lines = source.split("\n");
  return (lines[line - 1] ?? "").trim();
}

export const EXAMPLES: Record<string, { name: string; desc: string; code: string }> = {
  shared: {
    name: "全局计数器（反面教材）",
    desc: "所有用户写同一个 uint256 —— 每笔交易都访问同一 storage slot",
    code: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title SharedCounter — 反面教材：所有用户写同一个存储槽
contract SharedCounter {
    /// @notice 共享热点：所有调用者读写同一 slot
    uint256 public count;

    event Incremented(address indexed caller, uint256 newCount);

    /// @notice 全体共享计数 +1
    function increment() external {
        count += 1;
        emit Incremented(msg.sender, count);
    }

    /// @notice 批量 +n，循环内重复写同一 slot，冲突面更大
    function incrementBy(uint256 n) external {
        require(n <= 10_000, "n too large");
        for (uint256 i = 0; i < n; i++) {
            count += 1;
        }
        emit Incremented(msg.sender, count);
    }
}`,
  },
  independent: {
    name: "按地址独立记录（优化版）",
    desc: "mapping(address => uint256) —— 每个地址写自己的槽，无写-写冲突",
    code: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IndependentRecorder — 优化版：按地址隔离存储
contract IndependentRecorder {
    /// @notice 按地址隔离的记录
    mapping(address => uint256) public records;

    event Recorded(address indexed caller, uint256 value);

    /// @notice 只写调用者自己的槽
    function record(uint256 value) external {
        records[msg.sender] = value;
        emit Recorded(msg.sender, value);
    }

    /// @notice 读取调用者自己的记录
    function myRecord() external view returns (uint256) {
        return records[msg.sender];
    }
}`,
  },
  // 优化对照：同一业务（计数）的两种写法，用于 Diff 视图
  optimizedCounter: {
    name: "计数器优化对照",
    desc: "全局计数 → mapping 隔离 + 事件聚合",
    code: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title CounterOptimized — 计数器的并行友好版本
contract CounterOptimized {
    // 优化前: uint256 public count;  ← 所有写入同一 slot
    // 优化后: 每地址独立槽 + 事件流聚合
    mapping(address => uint256) public counts;

    event Counted(address indexed caller, uint256 ownTotal);

    function increment() external {
        counts[msg.sender] += 1;
        emit Counted(msg.sender, counts[msg.sender]);
    }
}`,
  },
};
