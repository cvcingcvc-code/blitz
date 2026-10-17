// Monad 测试网配置与钱包/交易服务
// 链数据：Monad Testnet (chainId 10143 = 0x279f)
// 明确声明：展示的交易哈希/Gas/回执/延迟都是真实链上数据；
// 不声称观察到真实内部并行调度（除非有节点追踪证据）。

import { createPublicClient, createWalletClient, custom, http, type PublicClient, type WalletClient, type Chain } from "viem";

export const monadTestnet: Chain = {
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://testnet-rpc.monad.xyz"] },
  },
  blockExplorers: {
    default: { name: "Monad Explorer", url: "https://testnet.monadexplorer.com" },
  },
  testnet: true,
};

export const RPC_URL = monadTestnet.rpcUrls.default.http[0];
export const EXPLORER_URL = "https://testnet.monadexplorer.com";

export function getPublicClient(): PublicClient {
  return createPublicClient({ chain: monadTestnet, transport: http(RPC_URL) });
}

// ---------- 钱包连接（EIP-1193 注入提供者） ----------

type Eip1193 = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
};

declare global {
  interface Window {
    ethereum?: Eip1193;
  }
}

export function hasWallet(): boolean {
  return typeof window !== "undefined" && !!window.ethereum;
}

export async function connectWallet(): Promise<{ address: string; chainId: number }> {
  if (!window.ethereum) throw new Error("NO_WALLET");
  const accounts = (await window.ethereum.request({ method: "eth_requestAccounts" })) as string[];
  const address = accounts[0];
  if (!address) throw new Error("NO_ACCOUNTS");
  let chainIdHex = (await window.ethereum.request({ method: "eth_chainId" })) as string;
  let chainId = parseInt(chainIdHex, 16);
  if (chainId !== monadTestnet.id) {
    await switchToMonad(window.ethereum);
    chainIdHex = (await window.ethereum.request({ method: "eth_chainId" })) as string;
    chainId = parseInt(chainIdHex, 16);
  }
  return { address, chainId };
}

async function switchToMonad(eth: Eip1193): Promise<void> {
  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x279f" }],
    });
  } catch (e) {
    const code = (e as { code?: number }).code;
    if (code === 4902) {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: "0x279f",
            chainName: "Monad Testnet",
            nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
            rpcUrls: [RPC_URL],
            blockExplorerUrls: [EXPLORER_URL],
          },
        ],
      });
    } else {
      throw e;
    }
  }
}

export function getWalletClient(address: `0x${string}`): WalletClient {
  if (!window.ethereum) throw new Error("NO_WALLET");
  return createWalletClient({ chain: monadTestnet, account: address, transport: custom(window.ethereum) });
}

// ---------- 交易与回执 ----------

export interface TxRecord {
  hash: string;
  contract: string; // SharedCounter | IndependentRecorder
  action: string; // deploy | increment | record
  gasUsed?: string;
  effectiveGasPrice?: string;
  blockNumber?: string;
  latencyMs?: number;
  status: "pending" | "success" | "reverted";
  explorerUrl: string;
  timestamp: number;
}

export async function waitForReceipt(
  publicClient: PublicClient,
  hash: `0x${string}`
): Promise<TxRecord["gasUsed" | "blockNumber"] extends never ? never : { gasUsed: bigint; effectiveGasPrice: bigint; blockNumber: bigint; status: "success" | "reverted" }> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000, pollingInterval: 1_000 });
  return {
    gasUsed: receipt.gasUsed,
    effectiveGasPrice: receipt.effectiveGasPrice ?? 0n,
    blockNumber: receipt.blockNumber,
    status: receipt.status === "success" ? "success" : "reverted",
  };
}

export function formatEther(wei: bigint, decimals = 18): string {
  const base = 10n ** BigInt(decimals);
  const whole = wei / base;
  const frac = (wei % base).toString().padStart(decimals, "0").slice(0, 6);
  return `${whole}.${frac}`;
}

export function shortHash(hash: string): string {
  return hash.length > 18 ? `${hash.slice(0, 10)}…${hash.slice(-8)}` : hash;
}

export function shortAddr(addr: string): string {
  return addr.length > 14 ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : addr;
}
