// 从 contracts/src 编译两份合约，产出 abi + bytecode artifact 供前端部署使用。
// 只在构建期运行（node scripts/build-artifacts.mjs），产物写入 app/src/artifacts/。
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, "..");
const CONTRACTS = resolve(APP_ROOT, "..", "contracts", "src");

const solc = require(resolve(APP_ROOT, "node_modules", "solc"));

const sources = {
  "SharedCounter.sol": {
    content: readFileSync(resolve(CONTRACTS, "SharedCounter.sol"), "utf8"),
  },
  "IndependentRecorder.sol": {
    content: readFileSync(resolve(CONTRACTS, "IndependentRecorder.sol"), "utf8"),
  },
};

const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: {
      "*": { "*": ["abi", "evm.bytecode.object"] },
    },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));

const errors = (output.errors ?? []).filter((e) => e.severity === "error");
if (errors.length > 0) {
  console.error("compile errors:\n" + errors.map((e) => e.formattedMessage).join("\n"));
  process.exit(1);
}
for (const w of output.errors ?? []) {
  if (w.severity === "warning") console.warn(w.formattedMessage.trim());
}

const outDir = resolve(APP_ROOT, "src", "artifacts");
mkdirSync(outDir, { recursive: true });

for (const [file, contracts] of Object.entries(output.contracts)) {
  for (const [name, artifact] of Object.entries(contracts)) {
    const payload = {
      name,
      abi: artifact.abi,
      bytecode: "0x" + artifact.evm.bytecode.object,
    };
    writeFileSync(resolve(outDir, `${name}.json`), JSON.stringify(payload, null, 2));
    console.log(`OK ${name}: abi(${artifact.abi.length} entries) bytecode(${payload.bytecode.length / 2 - 1} bytes)`);
  }
}
