import { useMemo, useState } from "react";
import { analyze, EXAMPLES, type AnalysisIssue } from "../lib/analyzer";

const SEV_STYLE: Record<AnalysisIssue["severity"], { label: string; cls: string; dot: string }> = {
  high: { label: "高", cls: "bg-rose-500/10 border-rose-500/30 text-rose-300", dot: "bg-rose-400" },
  medium: { label: "中", cls: "bg-amber-500/10 border-amber-500/30 text-amber-300", dot: "bg-amber-400" },
  low: { label: "低", cls: "bg-sky-500/10 border-sky-500/30 text-sky-300", dot: "bg-sky-400" },
  info: { label: "提示", cls: "bg-emerald-500/10 border-emerald-500/30 text-emerald-300", dot: "bg-emerald-400" },
};

const SCORE_STYLE: Record<string, { label: string; cls: string }> = {
  poor: { label: "并行不友好", cls: "bg-rose-500/15 text-rose-300 border-rose-500/40" },
  fair: { label: "存在冲突风险", cls: "bg-amber-500/15 text-amber-300 border-amber-500/40" },
  good: { label: "并行友好", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40" },
  unknown: { label: "—", cls: "bg-[#141a26] text-[#8b93a7] border-[#1c2230]" },
};

// 优化前后 diff：内置「全局计数器 → mapping 隔离」的对照
const DIFF = {
  before: `contract SharedCounter {
    uint256 public count;              // ← 所有写入同一 slot 0

    function increment() external {
        count += 1;                    // ← SLOAD+SSTORE slot0，写热点
        emit Incremented(msg.sender, count);
    }
}`,
  after: `contract CounterOptimized {
    mapping(address => uint256) public counts;   // ← 每地址独立槽

    event Counted(address indexed caller, uint256 ownTotal);

    function increment() external {
        counts[msg.sender] += 1;       // ← 只写自己的槽，无写-写冲突
        emit Counted(msg.sender, counts[msg.sender]);
    }
}`,
  changes: [
    {
      label: "uint256 count → mapping(address => uint256) counts",
      detail: "存储从单一共享槽变为按地址隔离槽，不同用户的交易访问不同 slot",
    },
    {
      label: "count += 1 → counts[msg.sender] += 1",
      detail: "写入范围从全局共享收敛为调用者自身，消除写-写依赖链",
    },
    {
      label: "新增 event Counted",
      detail: "全局统计需求改由事件流承载（链下聚合），合约不再维护共享热点",
    },
  ],
};

export default function AnalyzerPanel() {
  const [code, setCode] = useState(EXAMPLES.shared.code);
  const [showDiff, setShowDiff] = useState(false);

  const result = useMemo(() => analyze(code), [code]);
  const scoreStyle = SCORE_STYLE[result.parallelFriendlyScore] ?? SCORE_STYLE.unknown;

  return (
    <div className="space-y-5">
      {/* 示例选择 */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(EXAMPLES).map(([key, ex]) => (
          <button
            key={key}
            onClick={() => {
              setCode(ex.code);
              setShowDiff(false);
            }}
            className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
              code === ex.code
                ? "bg-indigo-500/15 border-indigo-500/40 text-indigo-300"
                : "bg-[#141a26] border-[#1c2230] text-[#8b93a7] hover:text-[#c3c9d6]"
            }`}
          >
            {ex.name}
          </button>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        {/* 编辑区 */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#c3c9d6]">Solidity 代码</h2>
            <span className="text-[11px] text-[#5d6478]">{code.split("\n").length} 行</span>
          </div>
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            spellCheck={false}
            className="w-full h-[420px] bg-[#0d1119] border border-[#1c2230] rounded-xl p-4 font-mono text-[12.5px] leading-relaxed text-[#d5dae6] focus:outline-none focus:border-indigo-500/50 resize-y"
          />
        </div>

        {/* 分析结果 */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-[#c3c9d6]">分析结果</h2>
            <span className={`px-2.5 py-1 rounded-full text-[11px] border font-medium ${scoreStyle.cls}`}>
              {scoreStyle.label}
            </span>
          </div>

          <div className="bg-[#0d1119] border border-[#1c2230] rounded-xl p-4 text-xs text-[#8b93a7] leading-relaxed">
            {result.summary}
          </div>

          <div className="space-y-2.5 max-h-[560px] overflow-y-auto pr-1">
            {result.issues.length === 0 && (
              <div className="bg-[#0d1119] border border-[#1c2230] rounded-xl p-4 text-xs text-[#5d6478]">
                无分析输出 — 代码中未检测到状态变量。
              </div>
            )}
            {result.issues.map((issue, i) => {
              const s = SEV_STYLE[issue.severity];
              return (
                <div key={i} className={`rounded-xl border p-3.5 ${s.cls}`}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                    <span className="text-[11px] font-mono opacity-80">{issue.ruleId}</span>
                    <span className="text-[11px] opacity-60">· 第 {issue.location.line} 行</span>
                  </div>
                  <div className="text-[13px] font-semibold mb-1.5 text-white/90">{issue.title}</div>
                  <pre className="bg-black/30 rounded-lg px-3 py-2 font-mono text-[11.5px] overflow-x-auto mb-2 text-white/80">
                    {issue.snippet}
                  </pre>
                  <p className="text-[12px] leading-relaxed opacity-90 mb-1.5">
                    <span className="font-semibold">原因：</span>
                    {issue.reason}
                  </p>
                  <p className="text-[12px] leading-relaxed opacity-90">
                    <span className="font-semibold">建议：</span>
                    {issue.suggestion}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 优化前后 Diff */}
      <div className="border-t border-[#1c2230] pt-5">
        <button
          onClick={() => setShowDiff(!showDiff)}
          className="flex items-center gap-2 text-sm font-semibold text-[#c3c9d6] hover:text-white transition-colors"
        >
          <span className={`transition-transform ${showDiff ? "rotate-90" : ""}`}>▸</span>
          优化前后代码差异（全局计数器 → mapping 隔离）
        </button>

        {showDiff && (
          <div className="mt-4 grid lg:grid-cols-2 gap-4">
            <div>
              <div className="text-[11px] font-semibold text-rose-300/90 mb-2 flex items-center gap-1.5">
                <span className="px-1.5 py-0.5 rounded bg-rose-500/15 border border-rose-500/30">优化前</span>
                共享热点
              </div>
              <pre className="bg-[#0d1119] border border-rose-500/25 rounded-xl p-4 font-mono text-[11.5px] leading-relaxed overflow-x-auto text-[#d5dae6]">
                {DIFF.before}
              </pre>
            </div>
            <div>
              <div className="text-[11px] font-semibold text-emerald-300/90 mb-2 flex items-center gap-1.5">
                <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30">优化后</span>
                并行友好
              </div>
              <pre className="bg-[#0d1119] border border-emerald-500/25 rounded-xl p-4 font-mono text-[11.5px] leading-relaxed overflow-x-auto text-[#d5dae6]">
                {DIFF.after}
              </pre>
            </div>
            <div className="lg:col-span-2 space-y-2">
              {DIFF.changes.map((c, i) => (
                <div key={i} className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-3 bg-[#0d1119] border border-[#1c2230] rounded-lg px-3.5 py-2.5">
                  <code className="text-[11.5px] text-indigo-300 font-mono whitespace-nowrap sm:min-w-[320px]">{c.label}</code>
                  <span className="text-[11.5px] text-[#8b93a7]">{c.detail}</span>
                </div>
              ))}
              <p className="text-[11px] text-[#5d6478] pt-1">
                注：静态分析识别的是潜在共享状态访问模式，不能测量运行时真实冲突频率；实际并行收益取决于真实交易负载。
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
