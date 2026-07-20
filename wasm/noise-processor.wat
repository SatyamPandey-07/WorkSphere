(module
  (memory (export "memory") 1)

  ;; Heap pointer starts at 1024 (well above stack region).
  ;; IMPORTANT: always kept 8-byte aligned so that f32 / f64
  ;; loads never trap on 32-bit ARM Android Chrome (#1039).
  (global $heapPtr (mut i32) (i32.const 1024))

  ;; ---------------------------------------------------------------------------
  ;; malloc — returns an 8-byte-aligned pointer.
  ;;
  ;; Alignment is enforced by rounding the requested size up to the next
  ;; multiple of 8 before bumping the heap pointer:
  ;;   aligned_size = (size + 7) & ~7
  ;;
  ;; This guarantees that:
  ;;   - f32.load / f32.store always receive 4-byte-aligned addresses ✓
  ;;   - f64.load / f64.store always receive 8-byte-aligned addresses ✓
  ;; ---------------------------------------------------------------------------
  (func (export "malloc") (param $size i32) (result i32)
    (local $ptr i32)
    (local $alignedSize i32)

    ;; aligned_size = (size + 7) & ~7
    (local.set $alignedSize
      (i32.and
        (i32.add (local.get $size) (i32.const 7))
        (i32.const -8)
      )
    )

    ;; Save current pointer (this is what we return)
    (local.set $ptr (global.get $heapPtr))

    ;; Advance heap by aligned size
    (global.set $heapPtr
      (i32.add (global.get $heapPtr) (local.get $alignedSize))
    )

    (local.get $ptr)
  )

  ;; ---------------------------------------------------------------------------
  ;; free — simple bump allocator: only reclaims the last allocation.
  ;; The size passed here should be the original (unaligned) requested size;
  ;; we recompute the aligned size to correctly rewind $heapPtr.
  ;; ---------------------------------------------------------------------------
  (func (export "free") (param $ptr i32) (param $size i32)
    (local $alignedSize i32)

    ;; aligned_size = (size + 7) & ~7
    (local.set $alignedSize
      (i32.and
        (i32.add (local.get $size) (i32.const 7))
        (i32.const -8)
      )
    )

    ;; Only rewind if this was the last allocation
    (if (i32.eq
          (i32.add (local.get $ptr) (local.get $alignedSize))
          (global.get $heapPtr))
      (then (global.set $heapPtr (local.get $ptr)))
    )
  )

  ;; ---------------------------------------------------------------------------
  ;; computeRMS — squared-sum RMS over a float32 array.
  ;; $ptr must be 4-byte aligned (enforced by malloc above).
  ;; ---------------------------------------------------------------------------
  (func (export "computeRMS") (param $ptr i32) (param $length i32) (result f32)
    (local $sum f32)
    (local $i i32)
    (local $sample f32)
    (local $byteOffset i32)

    (local.set $sum (f32.const 0))
    (local.set $i (i32.const 0))

    (block $end
      (loop $loop
        (br_if $end (i32.ge_u (local.get $i) (local.get $length)))

        ;; byteOffset = ptr + i * 4  (explicit byte arithmetic — no element-index tricks)
        (local.set $byteOffset
          (i32.add (local.get $ptr) (i32.shl (local.get $i) (i32.const 2)))
        )
        (local.set $sample (f32.load (local.get $byteOffset)))
        (local.set $sum
          (f32.add (local.get $sum) (f32.mul (local.get $sample) (local.get $sample)))
        )

        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $loop)
      )
    )

    (f32.sqrt (f32.div (local.get $sum) (f32.convert_i32_u (local.get $length))))
  )

  ;; ---------------------------------------------------------------------------
  ;; resetHeap — resets the bump pointer to the initial 8-byte-aligned origin.
  ;; ---------------------------------------------------------------------------
  (func (export "resetHeap")
    (global.set $heapPtr (i32.const 1024))
  )
)
