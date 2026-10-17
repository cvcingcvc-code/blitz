import { useState } from "react";
import {
  monadTestnet,
  getPublicClient,
  getWalletClient,
  hasWallet,
  connectWallet,
  formatEther,
  shortHash,
  shortAddr,
  EXPLORER_URL,
  type TxRecord,
} from "../lib/monad";
import SharedCounterArtifact from "../artifacts/SharedCounter.json";
import IndependentRecorderArtifact from "../artifacts/IndependentRecorder.json";
import type { Abi } from "viem";

type DeployState = "idle" | "deploying" | "deployed" | "error";

interface ContractState {
  state: DeployState;
  address?: string;
  error?: string;
}

const EMPTY: ContractState = { state: "idle" };

export default function TestnetPanel() {
  const [wallet, setWallet] = useState<{ address: string; chainId: number } | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const [shared, setShared] = useState<ContractState>(EMPTY);
  const [independent, setIndependent] = useState<ContractState>(EMPTY);
  const [deploying, setDeploying] = useState<"shared" | "independent" | null>(null);

  const [txs, setTxs] = useState<TxRecord[]>([]);
  const [busy, setBusy] = useState<string | null>(null); // "shared-increment" | "independent-record"
  const [actionError, setActionError] = useState<string | null>(null);

  const [recordValue, setRecordValue] = useState("1");

  // ---------- 钱包 ----------
  const onConnect = async () => {
    setWalletError(null);
    if (!hasWallet()) {
      setWalletError(
        "NO_WALLET：未检测到浏览器 EVM 钱包。请安装 MetaMask / OKX Wallet / Rabby 等支持自定义网络的插件后重试。"
      );
      return;
    }
    setConnecting(true);
    try {
      const w = await connectWallet();
      setWallet(w);
      if (w.chainId !== monadTestnet.id) {
        setWalletError(`WRONG_CHAIN：钱包当前在 chainId ${w.chainId}，请切换到 Monad Testnet (10143)。`);
      }
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      setWalletError(msg === "NO_WALLET" ? "未检测到 EVM 钱包插件。" : `连接失败：${msg}`);
    } finally {
      setConnecting(false);
    }
  };

  // ---------- 部署 ----------
  const deploy = async (which: "shared" | "independent") => {
    if (!wallet) return;
    setActionError(null);
    setDeploying(which);
    const setter = which === "shared" ? setShared : setIndependent;
    const artifact = which === "shared" ? SharedCounterArtifact : IndependentRecorderArtifact;
    const label = which === "shared" ? "SharedCounter" : "IndependentRecorder";

    setter({ state: "deploying" });
    const t0 = performance.now();
    try {
      const publicClient = getPublicClient();
      const walletClient = getWalletClient(wallet.address as `0x${string}`);

      const hash = await walletClient.deployContract({
        abi: artifact.abi as Abi,
        bytecode: artifact.bytecode as `0x${string}`,
        chain: monadTestnet,
        account: wallet.address as `0x${string}`,
      });

      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        timeout: 120_000,
        pollingInterval: 1_000,
      });
      const latencyMs = Math.round(performance.now() - t0);

      if (receipt.status !== "success" || !receipt.contractAddress) {
        setter({ state: "error", error: `部署失败：status=${receipt.status}` });
        setTxs((prev) => [
          {
            hash,
            contract: label,
            action: "deploy",
            gasUsed: receipt.gasUsed.toString(),
            effectiveGasPrice: receipt.effectiveGasPrice ? receipt.effectiveGasPrice.toString() : undefined,
            blockNumber: receipt.blockNumber.toString(),
            latencyMs,
            status: "reverted",
            explorerUrl: `${EXPLORER_URL}/tx/${hash}`,
            timestamp: Date.now(),
          },
          ...prev,
        ]);
        return;
      }

      setter({ state: "deployed", address: receipt.contractAddress });
      setTxs((prev) => [
        {
          hash,
          contract: label,
          action: "deploy",
          gasUsed: receipt.gasUsed.toString(),
          effectiveGasPrice: receipt.effectiveGasPrice ? receipt.effectiveGasPrice.toString() : undefined,
          blockNumber: receipt.blockNumber.toString(),
          latencyMs,
          status: "success",
          explorerUrl: `${EXPLORER_URL}/tx/${hash}`,
          timestamp: Date.now(),
        },
        ...prev,
      ]);
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      const short = msg.length > 220 ? msg.slice(0, 220) + "…" : msg;
      setter({ state: "error", error: short });
      if (/user rejected|User denied/i.test(msg)) {
        setActionError("部署请求在钱包中被拒绝（这是正常的安全行为，可重试）。");
      }
    } finally {
      setDeploying(null);
    }
  };

  // ---------- 交易 ----------
  const sendTx = async (which: "shared" | "independent") => {
    const cs = which === "shared" ? shared : independent;
    if (!wallet || cs.state !== "deployed" || !cs.address) return;
    setActionError(null);
    const key = `${which}-tx`;
    setBusy(key);
    const label = which === "shared" ? "SharedCounter" : "IndependentRecorder";
    const action = which === "shared" ? "increment" : "record";

    const t0 = performance.now();
    try {
      const publicClient = getPublicClient();
      const walletClient = getWalletClient(wallet.address as `0x${string}`);
      const artifact = which === "shared" ? SharedCounterArtifact : IndependentRecorderArtifact;

      const hash = await walletClient.writeContract({
        abi: artifact.abi as Abi,
        address: cs.address as `0x${string}`,
        functionName: action,
        args: which === "shared" ? [] : [BigInt(recordValue || "1")],
        chain: monadTestnet,
        account: wallet.address as `0x${string}`,
      });

      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        timeout: 120_000,
        pollingInterval: 1_000,
      });
      const latencyMs = Math.round(performance.now() - t0);

      setTxs((prev) => [
        {
          hash,
          contract: label,
          action,
          gasUsed: receipt.gasUsed.toString(),
          effectiveGasPrice: receipt.effectiveGasPrice ? receipt.effectiveGasPrice.toString() : undefined,
          blockNumber: receipt.blockNumber.toString(),
          latencyMs,
          status: receipt.status === "success" ? "success" : "reverted",
          explorerUrl: `${EXPLORER_URL}/tx/${hash}`,
          timestamp: Date.now(),
        },
        ...prev,
      ]);
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      setActionError(/user rejected|User denied/i.test(msg) ? "交易请求在钱包中被拒绝。" : `交易失败：${msg.slice(0, 220)}`);
    } finally {
      setBusy(null);
    }
  };

  // ---------- 状态徽章 ----------
  const badge = (cs: ContractState) => {
    if (cs.state === "deployed")
      return <span className="px-2 py-0.5 rounded-full text-[10.5px] bg-emerald-500/15 text-emerald-300 border border-emerald-500/40">已部署</span>;
    if (cs.state === "deploying")
      return <span className="px-2 py-0.5 rounded-full text-[10.5px] bg-amber-500/15 text-amber-300 border border-amber-500/40 animate-pulse">部署中…</span>;
    if (cs.state === "error")
      return <span className="px-2 py-0.5 rounded-full text-[10.5px] bg-rose-500/15 text-rose-300 border border-rose-500/40">失败</span>;
    return <span className="px-2 py-0.5 rounded-full text-[10.5px] bg-[#141a26] text-[#8b93a7] border border-[#1c2230]">未部署</span>;
  };

  return (
    <div className="space-y-5">
      {/* 声明 */}
      <div className="bg-[#0d1119] border border-[#1c2230] rounded-xl p-4 text-xs text-[#8b93a7] leading-relaxed">
        <span className="font-semibold text-[#c3c9d6]">数据口径：</span>
        本页的交易哈希、Gas、回执、延迟都是 <span className="text-indigo-300 font-medium">真实 Monad 测试网交易</span>
        （链上可验证）；并行模拟页的执行轮次是 <span className="text-amber-300 font-medium">本地模型模拟</span>。
        两者严格区分，不声称观察到真实内部并行调度（除非有节点追踪证据）。
      </div>

      {/* 钱包连接 */}
      <div className="bg-[#0d1119] border border-[#1c2230] rounded-xl p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-[#c3c9d6] mb-1">EVM 测试钱包</h2>
            {wallet ? (
              <p className="text-xs font-mono text-[#8b93a7]">
                {shortAddr(wallet.address)} · {wallet.chainId === monadTestnet.id ? "Monad Testnet (10143)" : `chainId ${wallet.chainId}`}
              </p>
            ) : (
              <p className="text-xs text-[#5d6478]">MetaMask / OKX Wallet / Rabby 等，需自备测试 MON（水龙头见 README）</p>
            )}
          </div>
          {!wallet ? (
            <button
              onClick={onConnect}
              disabled={connecting}
              className="px-4 py-2 rounded-lg text-xs font-medium bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 text-white transition-colors shrink-0"
            >
              {connecting ? "连接中…" : "连接钱包"}
            </button>
          ) : (
            <span className="px-3 py-1.5 rounded-lg text-[11px] bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 shrink-0">
              已连接
            </span>
          )}
        </div>
        {walletError && (
          <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-200/90 leading-relaxed">
            {walletError}
          </div>
        )}
      </div>

      {/* 合约部署 */}
      <div className="grid sm:grid-cols-2 gap-4">
        {/* SharedCounter */}
        <div className="bg-[#0d1119] border border-[#1c2230] rounded-xl p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-rose-300/90">SharedCounter</h3>
            {badge(shared)}
          </div>
          <p className="text-[11.5px] text-[#8b93a7] leading-relaxed">
            反面教材：所有用户写同一个全局计数器（slot 0）。每笔交易构成写-写依赖。
          </p>
          {shared.address && (
            <a
              href={`${EXPLORER_URL}/address/${shared.address}`}
              target="_blank"
              rel="noreferrer"
              className="block text-[11px] font-mono text-indigo-300 hover:text-indigo-200 break-all"
            >
              {shortHash(shared.address)} ↗ Explorer
            </a>
          )}
          {shared.error && <p className="text-[11px] text-rose-300/80 break-words">{shared.error}</p>}
          <div className="flex flex-wrap gap-2">
            {shared.state !== "deployed" ? (
              <button
                onClick={() => deploy("shared")}
                disabled={!wallet || deploying !== null}
                className="px-3.5 py-2 rounded-lg text-xs font-medium bg-rose-500/80 hover:bg-rose-500 disabled:opacity-40 text-white transition-colors"
              >
                {deploying === "shared" ? "部署中…" : "部署到 Monad Testnet"}
              </button>
            ) : (
              <button
                onClick={() => sendTx("shared")}
                disabled={!wallet || busy !== null}
                className="px-3.5 py-2 rounded-lg text-xs font-medium bg-rose-500/80 hover:bg-rose-500 disabled:opacity-40 text-white transition-colors"
              >
                {busy === "shared-tx" ? "交易确认中…" : "increment() 发交易"}
              </button>
            )}
          </div>
        </div>

        {/* IndependentRecorder */}
        <div className="bg-[#0d1119] border border-[#1c2230] rounded-xl p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-emerald-300/90">IndependentRecorder</h3>
            {badge(independent)}
          </div>
          <p className="text-[11.5px] text-[#8b93a7] leading-relaxed">
            优化版：按地址记录（mapping），每地址独立槽，无共享热点。
          </p>
          {independent.address && (
            <a
              href={`${EXPLORER_URL}/address/${independent.address}`}
              target="_blank"
              rel="noreferrer"
              className="block text-[11px] font-mono text-indigo-300 hover:text-indigo-200 break-all"
            >
              {shortHash(independent.address)} ↗ Explorer
            </a>
          )}
          {independent.error && <p className="text-[11px] text-rose-300/80 break-words">{independent.error}</p>}
          <div className="flex flex-wrap gap-2 items-center">
            {independent.state !== "deployed" ? (
              <button
                onClick={() => deploy("independent")}
                disabled={!wallet || deploying !== null}
                className="px-3.5 py-2 rounded-lg text-xs font-medium bg-emerald-600/80 hover:bg-emerald-600 disabled:opacity-40 text-white transition-colors"
              >
                {deploying === "independent" ? "部署中…" : "部署到 Monad Testnet"}
              </button>
            ) : (
              <>
                <label className="text-[11px] text-[#8b93a7] flex items-center gap-1.5">
                  value
                  <input
                    value={recordValue}
                    onChange={(e) => setRecordValue(e.target.value.replace(/[^0-9]/g, ""))}
                    className="w-20 bg-[#10151f] border border-[#1c2230] rounded px-2 py-1.5 font-mono text-[11.5px] text-[#d5dae6] focus:outline-none focus:border-emerald-500/50"
                  />
                </label>
                <button
                  onClick={() => sendTx("independent")}
                  disabled={!wallet || busy !== null}
                  className="px-3.5 py-2 rounded-lg text-xs font-medium bg-emerald-600/80 hover:bg-emerald-600 disabled:opacity-40 text-white transition-colors"
                >
                  {busy === "independent-tx" ? "交易确认中…" : "record(value) 发交易"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {actionError && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-200/90">
          {actionError}
        </div>
      )}

      {/* 交易记录 */}
      <div className="bg-[#0d1119] border border-[#1c2230] rounded-xl p-4 sm:p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-[#c3c9d6]">真实交易记录</h3>
          <span className="text-[11px] text-[#5d6478]">{txs.length} 笔 · 链上可验证</span>
        </div>
        {txs.length === 0 ? (
          <p className="text-xs text-[#5d6478]">
            暂无交易。连接钱包并部署合约后，这里会展示真实交易哈希、Gas、区块号、回执状态与观察到的端到端延迟。
          </p>
        ) : (
          <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
            {txs.map((tx, i) => (
              <div key={`${tx.hash}-${i}`} className="rounded-lg border border-[#1c2230] bg-[#10151f] px-3.5 py-3">
                <div className="flex flex-wrap items-center gap-2 mb-1.5">
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      tx.status === "success"
                        ? "bg-emerald-500/15 text-emerald-300"
                        : tx.status === "reverted"
                        ? "bg-rose-500/15 text-rose-300"
                        : "bg-amber-500/15 text-amber-300"
                    }`}
                  >
                    {tx.status === "success" ? "成功" : tx.status === "reverted" ? "回滚" : "pending"}
                  </span>
                  <span className={`text-[11px] font-medium ${tx.contract === "SharedCounter" ? "text-rose-300/90" : "text-emerald-300/90"}`}>
                    {tx.contract}.{tx.action}()
                  </span>
                  <a
                    href={tx.explorerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] font-mono text-indigo-300 hover:text-indigo-200"
                  >
                    {shortHash(tx.hash)} ↗
                  </a>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10.5px] font-mono text-[#8b93a7]">
                  <span>gasUsed {tx.gasUsed ?? "—"}</span>
                  <span>gasPrice {tx.effectiveGasPrice ? `${formatEther(BigInt(tx.effectiveGasPrice))} MON` : "—"}</span>
                  <span>block {tx.blockNumber ?? "—"}</span>
                  <span>延迟 {tx.latencyMs ?? "—"} ms（端到端观察值，含回执轮询）</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
