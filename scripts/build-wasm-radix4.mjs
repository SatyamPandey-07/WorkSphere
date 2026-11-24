import fs from "node:fs";
import path from "node:path";
import wabtInit from "wabt";

const wabt = await wabtInit();

const watSource = `(module
  (memory (export "memory") 8)

  ;; Constants and buffers
  ;; 0: input samples (2048 * 4 = 8192 bytes, 0..8191)
  ;; 8192: real buffer (8192 bytes, 8192..16383)
  ;; 16384: imag buffer (8192 bytes, 16384..24575)
  ;; 24576: decibel buffer (1024 * 4 = 4096 bytes, 24576..28671)
  ;; 28672: hann window (8192 bytes, 28672..36863)

  (func (export "getInputPtr") (result i32) (i32.const 0))
  (func (export "getRealPtr") (result i32) (i32.const 8192))
  (func (export "getImagPtr") (result i32) (i32.const 16384))
  (func (export "getDbPtr") (result i32) (i32.const 24576))
  (func (export "getHannPtr") (result i32) (i32.const 28672))

  ;; 128-bit SIMD windowing and zeroing imaginary part
  (func (export "applyWindowSimd") (param $inPtr i32) (param $winPtr i32) (param $outRealPtr i32) (param $outImagPtr i32) (param $len i32)
    (local $i i32) (local $off i32) (local $vIn v128) (local $vWin v128) (local $vZero v128)
    (local.set $vZero (f32x4.splat (f32.const 0.0)))
    (local.set $i (i32.const 0))
    (block $break (loop $loop
      (br_if $break (i32.ge_u (local.get $i) (local.get $len)))
      (local.set $off (i32.shl (local.get $i) (i32.const 2)))
      (local.set $vIn (v128.load (i32.add (local.get $inPtr) (local.get $off))))
      (local.set $vWin (v128.load (i32.add (local.get $winPtr) (local.get $off))))
      (v128.store (i32.add (local.get $outRealPtr) (local.get $off)) (f32x4.mul (local.get $vIn) (local.get $vWin)))
      (v128.store (i32.add (local.get $outImagPtr) (local.get $off)) (local.get $vZero))
      (local.set $i (i32.add (local.get $i) (i32.const 4)))
      (br $loop)
    ))
  )

  ;; 128-bit SIMD Radix-4 butterfly accelerator
  (func (export "fftButterflySimd")
    (param $realPtr i32) (param $imagPtr i32)
    (param $uOffset i32) (param $vOffset i32)
    (param $wrPtr i32) (param $wiPtr i32)
    (param $count i32)
    (local $k i32) (local $byteOff i32)
    (local $ur v128) (local $ui v128) (local $vr v128) (local $vi v128)
    (local $wr v128) (local $wi v128) (local $tr v128) (local $ti v128)
    (local.set $k (i32.const 0))
    (block $done (loop $iter
      (br_if $done (i32.ge_u (local.get $k) (local.get $count)))
      (local.set $byteOff (i32.shl (local.get $k) (i32.const 2)))
      (local.set $ur (v128.load (i32.add (i32.add (local.get $realPtr) (local.get $uOffset)) (local.get $byteOff))))
      (local.set $ui (v128.load (i32.add (i32.add (local.get $imagPtr) (local.get $uOffset)) (local.get $byteOff))))
      (local.set $vr (v128.load (i32.add (i32.add (local.get $realPtr) (local.get $vOffset)) (local.get $byteOff))))
      (local.set $vi (v128.load (i32.add (i32.add (local.get $imagPtr) (local.get $vOffset)) (local.get $byteOff))))
      (local.set $wr (v128.load (i32.add (local.get $wrPtr) (local.get $byteOff))))
      (local.set $wi (v128.load (i32.add (local.get $wiPtr) (local.get $byteOff))))
      (local.set $tr (f32x4.sub (f32x4.mul (local.get $vr) (local.get $wr)) (f32x4.mul (local.get $vi) (local.get $wi))))
      (local.set $ti (f32x4.add (f32x4.mul (local.get $vr) (local.get $wi)) (f32x4.mul (local.get $vi) (local.get $wr))))
      (v128.store (i32.add (i32.add (local.get $realPtr) (local.get $uOffset)) (local.get $byteOff)) (f32x4.add (local.get $ur) (local.get $tr)))
      (v128.store (i32.add (i32.add (local.get $imagPtr) (local.get $uOffset)) (local.get $byteOff)) (f32x4.add (local.get $ui) (local.get $ti)))
      (v128.store (i32.add (i32.add (local.get $realPtr) (local.get $vOffset)) (local.get $byteOff)) (f32x4.sub (local.get $ur) (local.get $tr)))
      (v128.store (i32.add (i32.add (local.get $imagPtr) (local.get $vOffset)) (local.get $byteOff)) (f32x4.sub (local.get $ui) (local.get $ti)))
      (local.set $k (i32.add (local.get $k) (i32.const 4)))
      (br $iter)
    ))
  )

  ;; 128-bit SIMD magnitude computation
  (func (export "computeMagnitudeSimd") (param $realPtr i32) (param $imagPtr i32) (param $magPtr i32) (param $bins i32) (param $scale f32)
    (local $i i32) (local $off i32) (local $vr v128) (local $vi v128) (local $vPower v128) (local $vScale v128)
    (local.set $vScale (f32x4.splat (local.get $scale)))
    (local.set $i (i32.const 0))
    (block $end (loop $step
      (br_if $end (i32.ge_u (local.get $i) (local.get $bins)))
      (local.set $off (i32.shl (local.get $i) (i32.const 2)))
      (local.set $vr (v128.load (i32.add (local.get $realPtr) (local.get $off))))
      (local.set $vi (v128.load (i32.add (local.get $imagPtr) (local.get $off))))
      (local.set $vPower (f32x4.add (f32x4.mul (local.get $vr) (local.get $vr)) (f32x4.mul (local.get $vi) (local.get $vi))))
      (v128.store (i32.add (local.get $magPtr) (local.get $off)) (f32x4.mul (f32x4.sqrt (local.get $vPower)) (local.get $vScale)))
      (local.set $i (i32.add (local.get $i) (i32.const 4)))
      (br $step)
    ))
  )

  ;; Returns 1 indicating SIMD support
  (func (export "isSimdSupported") (result i32) (i32.const 1))
)`;

const outDir = path.resolve("public/wasm");
fs.mkdirSync(outDir, { recursive: true });

const parsed = wabt.parseWat("radix4-simd.wat", watSource, { simd: true });
parsed.validate();
const { buffer } = parsed.toBinary({ write_debug_names: false });
const outPath = path.join(outDir, "radix4_fft_simd.wasm");
fs.writeFileSync(outPath, Buffer.from(buffer));
console.log(`Successfully built ${outPath} (${buffer.byteLength} bytes)`);
