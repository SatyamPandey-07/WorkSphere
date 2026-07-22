(module
  (memory (export "memory") 1)

  (global $heapPtr (mut i32) (i32.const 1024))
  (global $bandsPtr (mut i32) (i32.const 0))

  (func (export "malloc") (param $size i32) (result i32)
    (local $ptr i32)
    (local.set $ptr (global.get $heapPtr))
    (global.set $heapPtr (i32.add (global.get $heapPtr) (local.get $size)))
    (local.get $ptr)
  )

  (func (export "free") (param $ptr i32) (param $size i32)
    (if (i32.eq (i32.add (local.get $ptr) (local.get $size)) (global.get $heapPtr))
      (then (global.set $heapPtr (local.get $ptr)))
    )
  )

  (func (export "resetHeap")
    (global.set $heapPtr (i32.const 1024))
  )

  (func (export "setBandsPtr") (param $ptr i32)
    (global.set $bandsPtr (local.get $ptr))
  )

  (func (export "initBiquadState")
    (param $bandIndex i32)
    (param $b0 f32) (param $b1 f32) (param $b2 f32)
    (param $a1 f32) (param $a2 f32)
    (local $ptr i32)
    (local.set $ptr
      (i32.add
        (global.get $bandsPtr)
        (i32.mul (local.get $bandIndex) (i32.const 36))
      )
    )
    (f32.store (local.get $ptr) (f32.const 0))
    (f32.store (i32.add (local.get $ptr) (i32.const 4)) (f32.const 0))
    (f32.store (i32.add (local.get $ptr) (i32.const 8)) (f32.const 0))
    (f32.store (i32.add (local.get $ptr) (i32.const 12)) (f32.const 0))
    (f32.store (i32.add (local.get $ptr) (i32.const 16)) (local.get $b0))
    (f32.store (i32.add (local.get $ptr) (i32.const 20)) (local.get $b1))
    (f32.store (i32.add (local.get $ptr) (i32.const 24)) (local.get $b2))
    (f32.store (i32.add (local.get $ptr) (i32.const 28)) (local.get $a1))
    (f32.store (i32.add (local.get $ptr) (i32.const 32)) (local.get $a2))
  )

  (func $processBand
    (param $ptr i32) (param $input f32) (result f32)
    (local $x1 f32) (local $x2 f32) (local $y1 f32) (local $y2 f32)
    (local $b0 f32) (local $b1 f32) (local $b2 f32)
    (local $a1 f32) (local $a2 f32) (local $output f32)
    (local.set $x1 (f32.load (local.get $ptr)))
    (local.set $x2 (f32.load (i32.add (local.get $ptr) (i32.const 4))))
    (local.set $y1 (f32.load (i32.add (local.get $ptr) (i32.const 8))))
    (local.set $y2 (f32.load (i32.add (local.get $ptr) (i32.const 12))))
    (local.set $b0 (f32.load (i32.add (local.get $ptr) (i32.const 16))))
    (local.set $b1 (f32.load (i32.add (local.get $ptr) (i32.const 20))))
    (local.set $b2 (f32.load (i32.add (local.get $ptr) (i32.const 24))))
    (local.set $a1 (f32.load (i32.add (local.get $ptr) (i32.const 28))))
    (local.set $a2 (f32.load (i32.add (local.get $ptr) (i32.const 32))))
    (local.set $output
      (f32.sub
        (f32.add
          (f32.add
            (f32.mul (local.get $b0) (local.get $input))
            (f32.mul (local.get $b1) (local.get $x1))
          )
          (f32.mul (local.get $b2) (local.get $x2))
        )
        (f32.add
          (f32.mul (local.get $a1) (local.get $y1))
          (f32.mul (local.get $a2) (local.get $y2))
        )
      )
    )
    (f32.store (i32.add (local.get $ptr) (i32.const 12)) (local.get $y1))
    (f32.store (i32.add (local.get $ptr) (i32.const 8)) (local.get $output))
    (f32.store (i32.add (local.get $ptr) (i32.const 4)) (local.get $x1))
    (f32.store (local.get $ptr) (local.get $input))
    (local.get $output)
  )

  (func (export "processSample") (param $input f32) (param $numBands i32) (result f32)
    (local $i i32) (local $output f32) (local $bandPtr i32)
    (local.set $output (local.get $input))
    (local.set $i (i32.const 0))
    (block $end
      (loop $loop
        (br_if $end (i32.ge_u (local.get $i) (local.get $numBands)))
        (local.set $bandPtr
          (i32.add
            (global.get $bandsPtr)
            (i32.mul (local.get $i) (i32.const 36))
          )
        )
        (local.set $output
          (call $processBand (local.get $bandPtr) (local.get $output))
        )
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $loop)
      )
    )
    (local.get $output)
  )

  (func (export "processBlock")
    (param $inputPtr i32) (param $outputPtr i32)
    (param $length i32) (param $numBands i32)
    (local $i i32) (local $input f32) (local $output f32)
    (local $j i32) (local $bandPtr i32) (local $bandOutput f32)

    (local.set $i (i32.const 0))

    (block $outerEnd
      (loop $outerLoop
        (br_if $outerEnd (i32.ge_u (local.get $i) (local.get $length)))
        (local.set $input
          (f32.load
            (i32.add
              (local.get $inputPtr)
              (i32.shl (local.get $i) (i32.const 2))
            )
          )
        )
        (local.set $bandOutput (local.get $input))
        (local.set $j (i32.const 0))
        (block $innerEnd
          (loop $innerLoop
            (br_if $innerEnd (i32.ge_u (local.get $j) (local.get $numBands)))
            (local.set $bandPtr
              (i32.add
                (global.get $bandsPtr)
                (i32.mul (local.get $j) (i32.const 36))
              )
            )
            (local.set $bandOutput
              (call $processBand (local.get $bandPtr) (local.get $bandOutput))
            )
            (local.set $j (i32.add (local.get $j) (i32.const 1)))
            (br $innerLoop)
          )
        )
        (f32.store
          (i32.add
            (local.get $outputPtr)
            (i32.shl (local.get $i) (i32.const 2))
          )
          (local.get $bandOutput)
        )
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $outerLoop)
      )
    )
  )
)
