(module
  (memory (export "memory") 1)

  (global $heapPtr (mut i32) (i32.const 1024))

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

  (func (export "computeRMS") (param $ptr i32) (param $length i32) (result f32)
    (local $sum f32)
    (local $i i32)
    (local $sample f32)
    (local.set $sum (f32.const 0))
    (local.set $i (i32.const 0))

    (block $end
      (loop $loop
        (br_if $end (i32.ge_u (local.get $i) (local.get $length)))
        (local.set $sample (f32.load (i32.add (local.get $ptr) (i32.shl (local.get $i) (i32.const 2)))))
        (local.set $sum (f32.add (local.get $sum) (f32.mul (local.get $sample) (local.get $sample))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $loop)
      )
    )

    (f32.sqrt (f32.div (local.get $sum) (f32.convert_i32_u (local.get $length))))
  )

  (func (export "resetHeap")
    (global.set $heapPtr (i32.const 1024))
  )
)
