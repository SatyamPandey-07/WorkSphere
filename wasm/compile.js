const fs = require("fs");
const path = require("path");
const wabt = require("wabt");

async function compileAll() {
  const wabtApi = await wabt();

  const sources = [
    { name: "noise-processor", out: "noise-processor.wasm" },
    { name: "audio-equalizer", out: "audio-equalizer.wasm" },
  ];

  for (const { name, out } of sources) {
    const watPath = path.resolve(__dirname, `${name}.wat`);
    const wasmPath = path.resolve(__dirname, "..", "public", out);
    const wat = fs.readFileSync(watPath, "utf8");
    const module = wabtApi.parseWat(name, wat);
    const binary = module.toBinary({ write_debug_names: true });
    fs.writeFileSync(wasmPath, Buffer.from(binary.buffer));
    console.log("Compiled to", wasmPath, `(${binary.buffer.length} bytes)`);
  }
}

compileAll().catch(console.error);
