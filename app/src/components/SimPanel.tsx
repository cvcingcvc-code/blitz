import { useEffect, useMemo, useRef, useState } from "react";
import { simulate } from "../lib/simulator";

const USER_COLORS = [
  "#6366f1", "#f59e0b", "#10b981", "#ec4899",
  "#0ea5e9", "#a855f7", "#ef4444", "#14b8a6",
];

export default function SimPanel() {
  const [mode, setMode] = useState<"shared" | "independent">("shared");
  const [txCount, setTxCount] = useState(8);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0); // 0..100 动画进度
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);

  const sim = useMemo(() => simulate(mode, txCount), [mode, txCount]);

  // 重置动画
  useEffect(() => {
    setProgress(0);
    setPlaying(false);
  }, [mode, txCount]);

  useEffect(() => {
    if (!playing) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }
    startRef.current = performance.now();
    const DURATION = 3600;
    const tick = (now: number) => {
      const p = Math.min(100, ((now - startRef.current) / DURATION) * 100);
      setProgress(p);
      if (p < 100) rafRef.current = requestAnimationFrame(tick);
      else setPlaying(false);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [playing]);

  const userColor = (name: string) => {
    const idx = parseInt(name.replace("user", ""), 10) - 1;
    return USER_COLORS[idx % USER_COLORS.length];
  };

  // 每笔交易的动画时间窗：按执行轮次错开
  const totalRounds = sim.totalRounds;
  const txWindow = (round: number) => {
    // shared: 轮次串行铺开；independent: 全部第 0 轮，几乎同时
    const span = mode === "shared" ? 80 : 30; // % of timeline
    const start = mode === "shared" ? (round / totalRounds) * span : round * 4;
    return { start, end: start + 18 };
  };

  const isVisible = (round: number) => {
    const w = txWindow(round);
    return progress >= w.start;
  };

  return (
    <div className="space-y-5">
      {/* 控制条 */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg overflow-hidden border border-[#1c2230]">
          <button
            onClick={() => setMode("shared")}
            className={`px-3.5 py-2 text-xs font-medium transition-colors ${
              mode === "shared" ? "bg-rose-500/20 text-rose-300" : "bg-[#141a26] text-[#8b93a7] hover:text-[#c3c9d6]"
            }`}
          >
            优化前 · 共享计数器
          </button>
          <button
            onClick={() => setMode("independent")}
            className={`px-3.5 py-2 text-xs font-medium transition-colors ${
              mode === "independent" ? "bg-emerald-500/20 text-emerald-300" : "bg-[#141a26] text-[#8b93a7] hover:text-[#c3c9d6]"
            }`}
          >
            优化后 · 独立记录
          </button>
        </div>

        <div className="flex items-center gap-2 text-xs text-[#8b93a7]">
          <span>交易数</span>
          <input
            type="range"
            min={6}
            max={12}
            value={txCount}
            onChange={(e) => setTxCount(parseInt(e.target.value, 10))}
            className="w-24 accent-indigo-400"
          />
          <span className="font-mono text-[#c3c9d6] w-5">{txCount}</span>
        </div>

        <button
          onClick={() => {
            if (progress >= 100) setProgress(0);
            setPlaying(!playing);
          }}
          className="px-4 py-2 rounded-lg text-xs font-medium bg-indigo-500 hover:bg-indigo-400 text-white transition-colors"
        >
          {playing ? "暂停" : progress >= 100 ? "重播" : "播放动画"}
        </button>

        <span className="text-[11px] px-2 py-1 rounded bg-[#141a26] border border-[#1c2230] text-[#8b93a7]">
          本地模型模拟 · 非真实节点调度
        </span>
      </div>

      {/* 说明卡 */}
      <div
        className={`rounded-xl border p-4 text-xs leading-relaxed ${
          mode === "shared"
            ? "bg-rose-500/5 border-rose-500/25 text-rose-200/90"
            : "bg-emerald-500/5 border-emerald-500/25 text-emerald-200/90"
        }`}
      >
        {sim.note}
        <span className="block mt-1 text-[11px] opacity-70">
          理论依赖关系：{mode === "shared"
            ? "所有交易写同一存储槽（slot 0）→ 任意两笔交易之间都存在写-写依赖 → 只能串行确认。"
            : "每笔交易写独立槽（100 + 用户序号）→ 交易之间无共享状态 → 理论上全部可在同一轮并行乐观执行。"}
          不展示编造的性能提升百分比。
        </span>
      </div>

      {/* 四通道动画 */}
      <div className="bg-[#0d1119] border border-[#1c2230] rounded-xl p-4 sm:p-5 overflow-x-auto">
        <div className="min-w-[560px]">
          <div className="flex items-center justify-between mb-3 text-[11px] text-[#5d6478]">
            <span>4 条虚拟执行通道（Monad 乐观并行执行模型抽象）</span>
            <span className="font-mono">执行轮次（依赖深度）：{totalRounds} 轮</span>
          </div>

          <div className="space-y-2.5">
            {sim.lanes.map((lane) => (
              <div key={lane.lane} className="flex items-center gap-3">
                <div className="w-14 shrink-0 text-[11px] font-mono text-[#8b93a7]">
                  Lane {lane.lane}
                </div>
                <div className="relative flex-1 h-12 rounded-lg bg-[#10151f] border border-[#1c2230] overflow-hidden">
                  {/* 时间刻度 */}
                  <div className="absolute inset-0 flex">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <div key={i} className="flex-1 border-r border-[#161c29] last:border-r-0" />
                    ))}
                  </div>
                  {/* 交易块 */}
                  {lane.txIds.map((id) => {
                    const tx = sim.txnById(id);
                    if (!tx) return null;
                    const w = txWindow(sim.rounds[id]);
                    const width = mode === "shared" ? 13 : 14;
                    const conflict = tx.conflictsWith.length > 0;
                    return (
                      <div
                        key={id}
                        className="absolute top-1.5 bottom-1.5 rounded-md border flex flex-col items-center justify-center transition-all duration-500"
                        style={{
                          left: `${w.start}%`,
                          width: `${width}%`,
                          background: conflict
                            ? `${userColor(tx.from)}22`
                            : `${userColor(tx.from)}33`,
                          borderColor: conflict
                            ? "#f43f5e88"
                            : `${userColor(tx.from)}66`,
                          opacity: isVisible(sim.rounds[id]) ? 1 : 0,
                          transform: isVisible(sim.rounds[id]) ? "translateX(0)" : "translateX(-8px)",
                        }}
                      >
                        <span className="text-[9.5px] font-mono text-white/90 leading-none">
                          tx{id} · {tx.from}
                        </span>
                        <span className="text-[8.5px] font-mono leading-none mt-0.5 opacity-70">
                          slot {tx.slots[0]}
                          {conflict ? " ⚡" : ""}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* 进度条 */}
          <div className="mt-4 h-1 rounded-full bg-[#161c29] overflow-hidden">
            <div
              className="h-full bg-indigo-400/70 transition-[width] duration-150"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>

      {/* 图例 + 依赖表 */}
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="bg-[#0d1119] border border-[#1c2230] rounded-xl p-4">
          <h3 className="text-xs font-semibold text-[#c3c9d6] mb-3">图例</h3>
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 text-[10.5px] font-mono text-[#8b93a7]">
                <span className="w-3 h-3 rounded" style={{ background: `${USER_COLORS[i]}44`, border: `1px solid ${USER_COLORS[i]}66` }} />
                user{i + 1}
              </span>
            ))}
          </div>
          <div className="mt-3 space-y-1.5 text-[11px] text-[#8b93a7]">
            <div><span className="text-rose-300">⚡ 红色边框</span> = 与其他交易存在写-写依赖（同槽）</div>
            <div>块位置 = 执行轮次（被依赖推迟的越靠后）</div>
          </div>
        </div>

        <div className="bg-[#0d1119] border border-[#1c2230] rounded-xl p-4">
          <h3 className="text-xs font-semibold text-[#c3c9d6] mb-3">理论依赖关系</h3>
          {sim.conflictPairs.length === 0 ? (
            <p className="text-[11.5px] text-emerald-300/90 leading-relaxed">
              无写-写依赖：所有交易访问不同存储槽，理论可全并行。
            </p>
          ) : (
            <div className="max-h-32 overflow-y-auto space-y-1.5 pr-1">
              {sim.conflictPairs.slice(0, 10).map((p, i) => (
                <div key={i} className="text-[11px] font-mono text-[#8b93a7] flex items-center gap-2">
                  <span className="text-rose-300">tx{p.a} ↔ tx{p.b}</span>
                  <span className="opacity-70">写同一 slot 0</span>
                </div>
              ))}
              {sim.conflictPairs.length > 10 && (
                <div className="text-[11px] text-[#5d6478]">…共 {sim.conflictPairs.length} 组依赖</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
