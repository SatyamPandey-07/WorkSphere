const fs = require("fs");
const path = require("path");
const wabt = require("wabt");

async function compile() {
  const wabtApi = await wabt();
  const watPath = path.resolve(__dirname, "noise-processor.wat");
  const wasmPath = path.resolve(__dirname, "..", "public", "noise-processor.wasm");
  const wat = fs.readFileSync(watPath, "utf8");
  const module = wabtApi.parseWat("noise-processor", wat);
  const binary = module.toBinary({ write_debug_names: true });
  fs.writeFileSync(wasmPath, Buffer.from(binary.buffer));
  console.log("Compiled to", wasmPath, `(${binary.buffer.length} bytes)`);
}

compile().catch(console.error);
