# SpatialAudioRouter Module Specification & API Reference

The `SpatialAudioRouter` module manages 3D audio positional rendering, listener coordinate mappings, and real-time panning matrix calculations across spatial audio channels.

---

## 1. Overview & Coordinate Space Specification

All spatial positioning operates on a 3D Cartesian coordinate system with defined boundaries:

* **Coordinate Boundaries:** `[-100, 100]` across all axes ($X, Y, Z$).
* **Origin `(0, 0, 0)`:** Center of the virtual listener environment.
* **Axes Mapping:**
  * **X-Axis:** Horizontal panning (`-100` = Full Left, `100` = Full Right).
  * **Y-Axis:** Elevation / Vertical distance (`-100` = Full Bottom, `100` = Full Top).
  * **Z-Axis:** Depth / Proximity (`-100` = Rear / Behind, `100` = Front / Ahead).

---

## 2. Helper Methods & JSDoc API Specifications

### `setListenerPosition(x, y, z)`

Updates the virtual listener's 3D spatial position within the bounded coordinate system.
```typescript
/**
 * Sets the 3D position coordinates of the virtual listener within the spatial audio scene.
 *
 * @param {number} x - Horizontal coordinate position along the X-axis. Valid range: [-100, 100].
 * @param {number} y - Vertical elevation coordinate along the Y-axis. Valid range: [-100, 100].
 * @param {number} z - Depth coordinate position along the Z-axis. Valid range: [-100, 100].
 * @returns {void}
 * @throws {RangeError} Throws an error if any coordinate falls outside the allowed [-100, 100] boundary.
 *
 * @example
 * ```typescript
 * import { SpatialAudioRouter } from '@/lib/SpatialAudioRouter';
 *
 * const router = new SpatialAudioRouter();
 * // Position listener at origin center
 * router.setListenerPosition(0, 0, 0);
 * ```
 */

calculatePanningMatrix(sourcePosition, listenerPosition)
Computes the stereo/multichannel attenuation and gain factors based on relative distance and orientation vectors.


TypeScript
/**
 * Calculates the relative spatial panning gain matrix between an audio emitter source and the listener.
 *
 * @param {Vector3D} sourcePosition - 3D coordinates {x, y, z} of the sound source. Values must be within [-100, 100].
 * @param {Vector3D} listenerPosition - 3D coordinates {x, y, z} of the active listener. Values must be within [-100, 100].
 * @returns {PanningMatrix} An object containing the calculated channel gains `{ left: number, right: number, attenuation: number }`.
 *
 * @example
 * ```typescript
 * import { SpatialAudioRouter, Vector3D } from '@/lib/SpatialAudioRouter';
 *
 * const source: Vector3D = { x: -50, y: 0, z: 10 };
 * const listener: Vector3D = { x: 0, y: 0, z: 0 };
 *
 * const panningMatrix = SpatialAudioRouter.calculatePanningMatrix(source, listener);
 * console.log(panningMatrix); // { left: 0.85, right: 0.15, attenuation: 0.92 }
 * ```
 */
``` 
## 3. Quick Usage Example
```TypeScript
import { SpatialAudioRouter } from '@/lib/SpatialAudioRouter';

// Initialize audio router
const audioRouter = new SpatialAudioRouter();

// 1. Set current listener position at center origin
audioRouter.setListenerPosition(0, 0, 0);

// 2. Compute panning matrix for an emitter on the far right
const matrix = audioRouter.calculatePanningMatrix(
  { x: 75, y: 0, z: 0 }, // Emitter
  { x: 0, y: 0, z: 0 }   // Listener
);
```
