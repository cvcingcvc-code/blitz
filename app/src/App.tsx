import { useState } from "react";
import AnalyzerPanel from "./components/AnalyzerPanel";
import SimPanel from "./components/SimPanel";
import TestnetPanel from "./components/TestnetPanel";

type Tab = "analyze" | "simulate" | "testnet";

const TABS: { id: Tab; label: string; sub: string }[] = [
  { id: "analyze", label: "合约分析", sub: "P0 · 静态规则" },
  { id: "simulate", label: "并行模拟", sub: "P0 · 本地模型" },
  { id: "testnet", label: "测试网实验", sub: "P1 · 真实交易" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("analyze");

  return (
    <div className="min-h-screen bg-[#0b0e14] text-[#e6e9f0]">
      {/* Header */}
      <header className="border-b border-[#1c2230] bg-[#0d1119]/90 backdrop-blur sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center font-bold text-white text-sm shrink-0">
              SS
            </div>
            <div className="min-w-0">
              <h1 className="font-bold text-base sm:text-lg leading-tight truncate">
                SlotShift <span className="text-[#8b93a7] font-normal text-xs sm:text-sm">· Monad Parallel Architecture Lab</span>
              </h1>
              <p className="text-[11px] sm:text-xs text-[#8b93a7] leading-tight">
                理解智能合约状态访问冲突 · 学习并行友好设计
              </p>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-2 text-xs text-[#8b93a7]">
            <span className="px-2 py-1 rounded bg-[#141a26] border border-[#1c2230]">Monad Testnet · 10143</span>
          </div>
        </div>

        {/* Tabs */}
        <nav className="max-w-6xl mx-auto px-2 sm:px-6 flex gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 sm:px-4 py-2.5 text-sm whitespace-nowrap border-b-2 transition-colors ${
                tab === t.id
                  ? "border-indigo-400 text-white font-medium"
                  : "border-transparent text-[#8b93a7] hover:text-[#c3c9d6]"
              }`}
            >
              {t.label}
              <span className="ml-1.5 text-[10px] text-[#5d6478] hidden sm:inline">{t.sub}</span>
            </button>
          ))}
        </nav>
      </header>

      {/* Content */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-5 sm:py-7">
        {tab === "analyze" && <AnalyzerPanel />}
        {tab === "simulate" && <SimPanel />}
        {tab === "testnet" && <TestnetPanel />}
      </main>

      <footer className="border-t border-[#1c2230] mt-8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 text-[11px] sm:text-xs text-[#5d6478] leading-relaxed">
          SlotShift · Monad 黑客松作品 — 静态分析与并行模拟均为本地模型，仅用于解释概念，不代表真实节点内部调度；
          链上数据（交易哈希/Gas/回执）为真实测试网交易，可在 Monad Explorer 验证。
        </div>
      </footer>
    </div>
  );
}
