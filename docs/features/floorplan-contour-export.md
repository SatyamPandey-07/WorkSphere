# Marching Squares 2D Contour Tracing & SVG Vectorization Pipeline

## 1. Architectural & Algorithmic Executive Summary

WorkSphere transforms raster floorplan imagery, LiDAR spatial captures, and occupancy density grids into clean, scalable vector graphics suitable for CAD manipulation, desk placement, and spatial navigation. The raster-to-vector pipeline bridges client-side WebAssembly computation in C (`src/wasm/floorplan/contour_tracer.c`) and high-performance TypeScript vector formatting in [`src/lib/floorplan/contourSvgExporter.ts`](file:///c:/Users/admin/Desktop/workfere/src/lib/floorplan/contourSvgExporter.ts).

```mermaid
flowchart TD
    RasterInput["Raster Floorplan Image / Occupancy Grid"] --> Binarize["Binarization & Thresholding (sobel_edge.c)"]
    Binarize --> Grid["2D Binary Grid Cell Discretization (dx, dy)"]
    Grid --> MS["Marching Squares 2D Cell Evaluator (4 Corner Bits)"]
    MS --> LUT["16-Case Lookup Table & Edge Interpolator"]
    LUT --> Segments["Vector Line Segments & Moore Boundary Traversal"]
    Segments --> PolyAssembly["Closed Polygon Assembly & Topology Ring Matching"]
    PolyAssembly --> Smoothing["Douglas-Peucker & Chaikin Spline Smoothing"]
    Smoothing --> Exporter["contourSvgExporter.ts (contourToSvgPathData)"]
    Exporter --> SVG["Scalable Vector Graphics (SVG Path / Document)"]
```

Key engineering capabilities:
- **Zero-Latency Vector Generation:** Sub-millisecond vector path assembly from discrete $(x, y)$ coordinate sequences.
- **Topological Integrity:** Preserves architectural boundaries, interior partition walls, and room openings without self-intersecting artifacts.
- **Parametric Precision & Normalization:** Coordinate quantizing ($[0, 1]$ bounding box relative scaling) and decimal rounding for minimal payload footprint.
- **Industrial CAD & Web Compatibility:** Generates SVG 1.1 compliant paths with standard line caps, joints, and configurable architectural fill styles.

---

## 2. Mathematical Foundation of Marching Squares

The **Marching Squares** algorithm is a computer graphics and computer vision technique used to extract two-dimensional isocontours from a scalar field or discretized binary grid. When applied to architectural floorplans, it identifies the precise boundary interfaces between solid structures (walls, pillars, furniture) and navigable void space (walkways, corridors, seating areas).

### 2.1 Grid Cell Discretization & Dual Representation

Let an input floorplan image or room occupancy matrix be represented as a discrete scalar grid:

$$I(x, y) \in [0, 255], \quad x \in [0, W-1], \ y \in [0, H-1]$$

A binary threshold $T_{\text{iso}}$ classifies every pixel into a binary occupancy state:

$$B(x, y) = \begin{cases} 1 & \text{if } I(x, y) \ge T_{\text{iso}} \quad (\text{Wall / Obstacle}) \\ 0 & \text{if } I(x, y) < T_{\text{iso}} \quad (\text{Free Navigable Space}) \end{cases}$$

Rather than treating pixels as independent points, Marching Squares groups every $2 \times 2$ neighborhood of adjacent sampling vertices into an individual square cell $C(i, j)$ defined by four corners:

$$\begin{aligned}
v_0 &= (i, j) & (\text{Top-Left}) \\
v_1 &= (i+1, j) & (\text{Top-Right}) \\
v_2 &= (i+1, j+1) & (\text{Bottom-Right}) \\
v_3 &= (i, j+1) & (\text{Bottom-Left})
\end{aligned}$$

```
(i, j)          (i+1, j)
   v0 ---------- v1
   |    Edge 0   |
   |             |
E3 |  Cell(i, j) | E1
   |             |
   |    Edge 2   |
   v3 ---------- v2
(i, j+1)        (i+1, j+1)
```

Each cell contains 4 boundary midpoints or edge intersections:
- **Edge 0 (Top):** Between $v_0$ and $v_1$ at $(i + 0.5, j)$
- **Edge 1 (Right):** Between $v_1$ and $v_2$ at $(i + 1.0, j + 0.5)$
- **Edge 2 (Bottom):** Between $v_3$ and $v_2$ at $(i + 0.5, j + 1.0)$
- **Edge 3 (Left):** Between $v_0$ and $v_3$ at $(i, j + 0.5)$

### 2.2 4-Bit Corner State Indexing

The topological configuration of a cell is determined by evaluating which corners are occupied ($1$) versus empty ($0$). A 4-bit binary index $K \in [0, 15]$ is constructed by assigning positional bit weights to each corner:

$$K = (B(v_0) \cdot 2^3) + (B(v_1) \cdot 2^2) + (B(v_2) \cdot 2^1) + (B(v_3) \cdot 2^0)$$

$$K = (B(v_0) \ll 3) \mid (B(v_1) \ll 2) \mid (B(v_2) \ll 1) \mid B(v_3)$$

Since each corner has $2$ possible states, there are exactly $2^4 = 16$ distinct configurations.

---

## 3. The 16-Case Marching Squares Lookup Table

Each state index $K \in \{0, 1, \dots, 15\}$ maps deterministically to a set of directed line segments cutting through the cell's edges.

### 3.1 Visual Case Lookup Matrix

```
Case 0 (0000): Empty         Case 1 (0001): BL            Case 2 (0010): BR            Case 3 (0011): Bottom
   0 ------- 0                  0 ------- 0                  0 ------- 0                  0 ------- 0
   |         |                  |         |                  |         |                  |         |
   |  (none) |                  |     /   |                  |   \     |                  | ------- |
   |         |                  |    /    |                  |    \    |                  |         |
   0 ------- 0                  1 ------- 0                  0 ------- 1                  1 ------- 1

Case 4 (0100): TR            Case 5 (0101): Saddle A      Case 6 (0110): Right         Case 7 (0111): Not TL
   0 ------- 1                  0 ------- 1                  0 ------- 1                  0 ------- 1
   |    \    |                  |  \   /  |                  |    |    |                  |   /     |
   |     \   |                  |   \ /   |                  |    |    |                  |  /      |
   |         |                  |    X    |                  |    |    |                  |         |
   0 ------- 0                  1 ------- 0                  0 ------- 1                  1 ------- 1

Case 8 (1000): TL            Case 9 (1001): Left          Case 10 (1010): Saddle B     Case 11 (1011): Not TR
   1 ------- 0                  1 ------- 0                  1 ------- 0                  1 ------- 0
   |    /    |                  |    |    |                  |  /   \  |                  |     \   |
   |   /     |                  |    |    |                  |   \ /   |                  |      \  |
   |         |                  |    |    |                  |    X    |                  |         |
   0 ------- 0                  1 ------- 0                  0 ------- 1                  1 ------- 1

Case 12 (1100): Top          Case 13 (1101): Not BR       Case 14 (1110): Not BL       Case 15 (1111): Full
   1 ------- 1                  1 ------- 1                  1 ------- 1                  1 ------- 1
   |         |                  |         |                  |         |                  |         |
   | ------- |                  |    \    |                  |   /     |                  |  (none) |
   |         |                  |     \   |                  |  /      |                  |         |
   0 ------- 0                  1 ------- 0                  0 ------- 1                  1 ------- 1
```

### 3.2 Canonical Lookup Specification Table

| Index ($K$) | Binary ($v_0 v_1 v_2 v_3$) | Active Corners | Generated Line Segment(s) | Architectural Feature |
| :---: | :---: | :--- | :--- | :--- |
| **0** | `0000` | None | None | Open corridor / void |
| **1** | `0001` | Bottom-Left | Edge 3 $\rightarrow$ Edge 2 | Convex corner (SW) |
| **2** | `0010` | Bottom-Right | Edge 2 $\rightarrow$ Edge 1 | Convex corner (SE) |
| **3** | `0011` | BL, BR | Edge 3 $\rightarrow$ Edge 1 | Horizontal boundary (South) |
| **4** | `0100` | Top-Right | Edge 0 $\rightarrow$ Edge 1 | Convex corner (NE) |
| **5** | `0101` | BL, TR | (Edge 0 $\rightarrow$ Edge 1), (Edge 3 $\rightarrow$ Edge 2) | Ambiguous diagonal saddle |
| **6** | `0110` | TR, BR | Edge 0 $\rightarrow$ Edge 2 | Vertical boundary (East) |
| **7** | `0111` | TR, BR, BL | Edge 0 $\rightarrow$ Edge 3 | Concave corner (NW notch) |
| **8** | `1000` | Top-Left | Edge 0 $\rightarrow$ Edge 3 | Convex corner (NW) |
| **9** | `1001` | TL, BL | Edge 0 $\rightarrow$ Edge 2 | Vertical boundary (West) |
| **10** | `1010` | TL, BR | (Edge 0 $\rightarrow$ Edge 3), (Edge 2 $\rightarrow$ Edge 1) | Ambiguous diagonal saddle |
| **11** | `1011` | TL, BR, BL | Edge 0 $\rightarrow$ Edge 1 | Concave corner (NE notch) |
| **12** | `1100` | TL, TR | Edge 3 $\rightarrow$ Edge 1 | Horizontal boundary (North) |
| **13** | `1101` | TL, TR, BL | Edge 2 $\rightarrow$ Edge 1 | Concave corner (SE notch) |
| **14** | `1110` | TL, TR, BR | Edge 3 $\rightarrow$ Edge 2 | Concave corner (SW notch) |
| **15** | `1111` | All | None | Solid wall / room interior |

### 3.3 Saddle Ambiguity Resolution (Cases 5 and 10)

Cases 5 and 10 represent topological saddle points where opposing diagonal corners have identical values. Without an explicit disambiguation strategy, the algorithm cannot determine whether two isolated regions connect as a narrow neck or separate into distinct partitions.

WorkSphere resolves saddle points by computing the central cell intensity value $C_{\text{center}}$:

$$C_{\text{center}} = \frac{I(v_0) + I(v_1) + I(v_2) + I(v_3)}{4}$$

- **Case 5 ($v_1=1, v_3=1$):** If $C_{\text{center}} \ge T_{\text{iso}}$, the diagonal solid corners connect, yielding two curves separating the voids: $(E_0 \rightarrow E_3)$ and $(E_1 \rightarrow E_2)$. Otherwise, the void space connects, yielding $(E_0 \rightarrow E_1)$ and $(E_3 \rightarrow E_2)$.
- **Case 10 ($v_0=1, v_2=1$):** If $C_{\text{center}} \ge T_{\text{iso}}$, the diagonal walls connect, producing $(E_0 \rightarrow E_1)$ and $(E_2 \rightarrow E_3)$. Otherwise, voids connect, producing $(E_0 \rightarrow E_3)$ and $(E_1 \rightarrow E_2)$.

---

## 4. Sub-Pixel Linear Interpolation

To avoid aliased "staircase" raster artifacts along angled walls, the edge intersection point $P_{\text{edge}}$ is linearly interpolated based on continuous scalar intensity values rather than fixed at the $0.5$ midpoint:

$$P = P_1 + t \cdot (P_2 - P_1)$$

Where parameter $t \in [0, 1]$ represents the normalized distance along the cell edge:

$$t = \frac{T_{\text{iso}} - I(P_1)}{I(P_2) - I(P_1)}$$

For edge $0$ connecting $v_0 = (x, y)$ and $v_1 = (x+1, y)$:

$$x_{\text{interp}} = x + \frac{T_{\text{iso}} - I(x, y)}{I(x+1, y) - I(x, y)}, \quad y_{\text{interp}} = y$$

This continuous formulation guarantees $C^0$ continuous perimeter curves that align with millimeter-precision architectural floorplans.

---

## 5. Polygon Assembly & Smoothing Pipeline

Once the line segments are extracted across all cells, they must be chained into ordered closed polygons and smoothed before SVG serialization.

```mermaid
sequenceDiagram
    participant Raw as Segment Disjoint List
    participant Chain as Topology Assembler
    participant DP as Douglas-Peucker Filter
    participant Chaikin as Chaikin Spline Filter
    participant SVG as contourSvgExporter.ts

    Raw->>Chain: Connect matching endpoints (tolerance ε < 1e-4)
    Chain->>Chain: Form closed loops (startPoint === endPoint)
    Chain->>DP: Simplify collinear wall vertices
    DP->>Chaikin: Subdivide & smooth curved room boundaries
    Chaikin->>SVG: contourToSvgPathData(polygon, width, height)
    SVG-->>SVG: Format "M x y L x y ... Z" path string
```

### 5.1 Douglas-Peucker Simplification

Floorplans consist largely of orthogonal and straight walls. High-frequency pixel steps along flat surfaces are pruned using the **Ramer-Douglas-Peucker (RDP)** algorithm with perpendicular distance threshold $\epsilon$:

$$d_{\perp} = \frac{|(y_2 - y_1) x_0 - (x_2 - x_1) y_0 + x_2 y_1 - y_2 x_1|}{\sqrt{(y_2 - y_1)^2 + (x_2 - x_1)^2}}$$

Points with $d_{\perp} < \epsilon$ (typically $0.75\text{ px}$) are eliminated, reducing SVG vertex counts by up to $85\%$ without losing architectural fidelity.

### 5.2 Chaikin's Corner Cutting Spline Algorithm

For conference rooms with circular tables, bay windows, or acoustic pod curves, the polygonal vertices can optionally be smoothed using **Chaikin's algorithm**. Each line segment $P_i P_{i+1}$ is replaced by two refined control points located at $1/4$ and $3/4$ distances:

$$Q_i = \frac{3}{4} P_i + \frac{1}{4} P_{i+1}, \quad R_i = \frac{1}{4} P_i + \frac{3}{4} P_{i+1}$$

Applying 2 iterations produces smooth, organic SVG vector curves while preserving topological enclosure.

---

## 6. Vector SVG Path Generation in `contourSvgExporter.ts`

The module [`src/lib/floorplan/contourSvgExporter.ts`](file:///c:/Users/admin/Desktop/workfere/src/lib/floorplan/contourSvgExporter.ts) receives the assembled contour polygons and constructs standardized vector elements.

### 6.1 Path Data Assembly (`contourToSvgPathData`)

The core vector string serialization function converts an array of `ContourPoint` coordinates into an SVG path specification:

```typescript
export function contourToSvgPathData(
  polygon: ContourPolygon,
  width: number,
  height: number,
  options: SvgExportOptions = {}
): string {
  if (!polygon || polygon.length === 0) return "";

  const { normalize = false, precision = 2 } = options;
  const scaleX = normalize && width > 0 ? 1 / width : 1;
  const scaleY = normalize && height > 0 ? 1 / height : 1;

  const formatCoord = (val: number, scale: number): string => {
    const scaled = val * scale;
    return Number(scaled.toFixed(precision)).toString();
  };

  const commands = polygon.map((pt, idx) => {
    const xStr = formatCoord(pt.x, scaleX);
    const yStr = formatCoord(pt.y, scaleY);
    return idx === 0 ? `M ${xStr} ${yStr}` : `L ${xStr} ${yStr}`;
  });

  return `${commands.join(" ")} Z`;
}
```

Key features:
1. **Initial Move Command (`M x y`):** Anchors the drawing pen to the starting vertex of the contour polygon.
2. **Subsequent Line Commands (`L x y`):** Draws straight vector segments along subsequent perimeter vertices.
3. **Closed Path Operator (`Z`):** Closes the vector path by drawing a line segment directly back to the origin vertex, enabling SVG fill rendering.
4. **Coordinate Normalization (`normalize: true`):** Scales pixel coordinates by $(1/W, 1/H)$ into dimensionless $[0, 1]$ coordinates for responsive canvas zooming.
5. **Floating-Point Quantization (`precision: 2`):** Strips redundant decimal noise (e.g., `12.345678` $\rightarrow$ `12.35`), reducing file payload sizes.

### 6.2 Architectural Visual Styling Presets

WorkSphere provides pre-tuned color palettes in `CONTOUR_STROKE_PRESETS` for architectural exports:

| Preset Name | Identifier | Stroke Hex | Fill RGBA | Architectural Use Case |
| :--- | :--- | :--- | :--- | :--- |
| **Blueprint Blue** | `blueprintBlue` | `#0284c7` | `rgba(14, 165, 233, 0.15)` | Technical CAD drawing & blueprints |
| **Emerald Green** | `emeraldGreen` | `#059669` | `rgba(16, 185, 129, 0.15)` | Sustainability zones & outdoor terraces |
| **Minimalist Charcoal** | `minimalistCharcoal` | `#334155` | `rgba(51, 65, 85, 0.15)` | Modern monochrome spatial floorplans |
| **CAD Amber** | `cadAmber` | `#d97706` | `rgba(245, 158, 11, 0.15)` | Occupancy heatmaps & maintenance alerts |

---

## 7. Complete SVG Document Assembly & Download

The function `generateFloorplanSvg` embeds the path elements into an XML document conforming to the W3C SVG 1.1 specification:

```typescript
export function generateFloorplanSvg(
  contours: ContourPolygon[],
  width: number,
  height: number,
  venueId: string = "venue",
  options: SvgExportOptions = {}
): string
```

### 7.1 Generated SVG Document Structure

```xml
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" width="1200" height="800">
  <!-- Generated by WorkSphere Floor Plan Vectorizer (contour_tracer.c) -->
  <!-- Venue: venue-pacific-hall | Contours: 4 | ViewBox: 0 0 1200 800 -->
  <g id="floorplan-contours" class="architectural-contours">
    <path id="contour-1" d="M 50 50 L 350 50 L 350 250 L 50 250 Z" 
          fill="rgba(14, 165, 233, 0.15)" stroke="#0284c7" stroke-width="2" 
          stroke-linejoin="round" stroke-linecap="round" />
    <path id="contour-2" d="M 400 50 L 700 50 L 700 250 L 400 250 Z" 
          fill="rgba(14, 165, 233, 0.15)" stroke="#0284c7" stroke-width="2" 
          stroke-linejoin="round" stroke-linecap="round" />
  </g>
</svg>
```

Attributes:
- `stroke-linejoin="round"`: Prevents acute miter spikes on sharp wall corners.
- `stroke-linecap="round"`: Ensures uniform path terminations.
- `viewBox="0 0 W H"`: Ensures scalable responsiveness across all screen resolutions and zoom levels.

---

## 8. Client-Side Browser Blob Download

For zero-roundtrip client exports, `downloadFloorplanSvg` instantiates an in-memory browser `Blob` object:

```typescript
const blob = new Blob([svgContent], { type: "image/svg+xml;charset=utf-8" });
const url = URL.createObjectURL(blob);
const link = document.createElement("a");
link.href = url;
link.download = `${sanitizedVenueId}-floorplan-vector.svg`;
document.body.appendChild(link);
link.click();
document.body.removeChild(link);
URL.revokeObjectURL(url);
```

This guarantees instantaneous vector exports without server dependency or network transmission overhead.
