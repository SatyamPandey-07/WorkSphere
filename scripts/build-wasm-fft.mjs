import fs from "node:fs";
import path from "node:path";
import wabtInit from "wabt";

const wabt = await wabtInit();
const watPath = path.resolve("wasm/fft-analyzer.wat");
const outDir = path.resolve("public/wasm");
const outPath = path.join(outDir, "fft_analyzer.wasm");

fs.mkdirSync(outDir, { recursive: true });
const watSource = fs.readFileSync(watPath, "utf8");

const module = wabt.parseWat(watPath, watSource, { simd: true });
module.validate();
const { buffer } = module.toBinary({ write_debug_names: false });
fs.writeFileSync(outPath, Buffer.from(buffer));
console.log(`Built ${outPath} (${buffer.byteLength} bytes) with 128-bit SIMD.`);
