import type { FloorPlanData } from "@/lib/webgpu/floorPlanRenderer";

export type LayoutWorkerRequest = {
  type: "CALCULATE_LAYOUT";
  data: FloorPlanData;
};

export type LayoutWorkerResponse = {
  type: "LAYOUT_COMPLETE";
  webgpu: {
    vertices: Float32Array;
    indices: Uint16Array;
    indexCount: number;
  };
  webgl: {
    positions: Float32Array;
    colors: Float32Array;
  };
};

const SEAT_COLORS: Record<string, [number, number, number]> = {
  hot_desk: [0.2, 0.6, 0.9],
  fixed_desk: [0.3, 0.8, 0.4],
  meeting_room: [0.8, 0.5, 0.2],
  phone_booth: [0.7, 0.3, 0.7],
};

function createSeatMesh(
  seat: FloorPlanData["seats"][0],
  size: number = 0.3,
): { vertices: number[]; indices: number[] } {
  const color = SEAT_COLORS[seat.type] ?? [0.5, 0.5, 0.5];
  const y = 0.4;
  const h = seat.type === "phone_booth" ? 1.8 : 0.05;
  const w = size;
  const d = size;

  const vertices: number[] = [];
  const indices: number[] = [];

  const faces: Array<{
    normal: [number, number, number];
    corners: [number, number, number][];
    uvs: [number, number][];
  }> = [
    // Front
    {
      normal: [0, 0, 1],
      corners: [
        [seat.x - w / 2, y, seat.z + d / 2],
        [seat.x + w / 2, y, seat.z + d / 2],
        [seat.x + w / 2, y + h, seat.z + d / 2],
        [seat.x - w / 2, y + h, seat.z + d / 2],
      ],
      uvs: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
    },
    // Back
    {
      normal: [0, 0, -1],
      corners: [
        [seat.x + w / 2, y, seat.z - d / 2],
        [seat.x - w / 2, y, seat.z - d / 2],
        [seat.x - w / 2, y + h, seat.z - d / 2],
        [seat.x + w / 2, y + h, seat.z - d / 2],
      ],
      uvs: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
    },
    // Left
    {
      normal: [-1, 0, 0],
      corners: [
        [seat.x - w / 2, y, seat.z - d / 2],
        [seat.x - w / 2, y, seat.z + d / 2],
        [seat.x - w / 2, y + h, seat.z + d / 2],
        [seat.x - w / 2, y + h, seat.z - d / 2],
      ],
      uvs: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
    },
    // Right
    {
      normal: [1, 0, 0],
      corners: [
        [seat.x + w / 2, y, seat.z + d / 2],
        [seat.x + w / 2, y, seat.z - d / 2],
        [seat.x + w / 2, y + h, seat.z - d / 2],
        [seat.x + w / 2, y + h, seat.z + d / 2],
      ],
      uvs: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
    },
    // Top
    {
      normal: [0, 1, 0],
      corners: [
        [seat.x - w / 2, y + h, seat.z + d / 2],
        [seat.x + w / 2, y + h, seat.z + d / 2],
        [seat.x + w / 2, y + h, seat.z - d / 2],
        [seat.x - w / 2, y + h, seat.z - d / 2],
      ],
      uvs: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
    },
  ];

  for (const face of faces) {
    const baseIdx = vertices.length / 10;
    for (let i = 0; i < 4; i++) {
      vertices.push(
        ...face.corners[i],
        ...face.normal,
        ...color,
        ...face.uvs[i],
      );
    }
    indices.push(baseIdx, baseIdx + 1, baseIdx + 2);
    indices.push(baseIdx, baseIdx + 2, baseIdx + 3);
  }

  // Power outlet indicator
  if (seat.hasPower) {
    const py = y + h + 0.02;
    const ps = 0.05;
    const pc: [number, number, number] = [1.0, 0.9, 0.1];
    const pFaces: Array<{
      normal: [number, number, number];
      corners: [number, number, number][];
    }> = [
      {
        normal: [0, 0, 1],
        corners: [
          [seat.x - ps, py, seat.z + ps],
          [seat.x + ps, py, seat.z + ps],
          [seat.x + ps, py + ps, seat.z + ps],
          [seat.x - ps, py + ps, seat.z + ps],
        ],
      },
      {
        normal: [0, 0, -1],
        corners: [
          [seat.x + ps, py, seat.z - ps],
          [seat.x - ps, py, seat.z - ps],
          [seat.x - ps, py + ps, seat.z - ps],
          [seat.x + ps, py + ps, seat.z - ps],
        ],
      },
      {
        normal: [0, 1, 0],
        corners: [
          [seat.x - ps, py + ps, seat.z + ps],
          [seat.x + ps, py + ps, seat.z + ps],
          [seat.x + ps, py + ps, seat.z - ps],
          [seat.x - ps, py + ps, seat.z - ps],
        ],
      },
    ];

    for (const face of pFaces) {
      const baseIdx = vertices.length / 10;
      for (let i = 0; i < 4; i++) {
        vertices.push(...face.corners[i], ...face.normal, ...pc, 0, 0);
      }
      indices.push(baseIdx, baseIdx + 1, baseIdx + 2);
      indices.push(baseIdx, baseIdx + 2, baseIdx + 3);
    }
  }

  return { vertices, indices };
}

function createFloorMesh(data: FloorPlanData): {
  vertices: number[];
  indices: number[];
} {
  const vertices: number[] = [];
  const indices: number[] = [];
  const floorColor: [number, number, number] = [0.15, 0.15, 0.18];

  const hw = data.width / 2;
  const hd = data.depth / 2;
  const floorVerts: [number, number, number][] = [
    [-hw, 0, -hd],
    [hw, 0, -hd],
    [hw, 0, hd],
    [-hw, 0, hd],
  ];
  const floorUVs: [number, number][] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  const baseIdx = vertices.length / 10;
  for (let i = 0; i < 4; i++) {
    vertices.push(...floorVerts[i], 0, 1, 0, ...floorColor, ...floorUVs[i]);
  }
  indices.push(baseIdx, baseIdx + 1, baseIdx + 2);
  indices.push(baseIdx, baseIdx + 2, baseIdx + 3);

  return { vertices, indices };
}

function createWallMesh(wall: FloorPlanData["walls"][0]): {
  vertices: number[];
  indices: number[];
} {
  const vertices: number[] = [];
  const indices: number[] = [];
  const wallColor: [number, number, number] = [0.3, 0.3, 0.35];

  const dx = wall.x2 - wall.x1;
  const dz = wall.z2 - wall.z1;
  const len = Math.sqrt(dx * dx + dz * dz);
  const nx = -dz / len;
  const nz = dx / len;

  const corners: [number, number, number][] = [
    [wall.x1, 0, wall.z1],
    [wall.x2, 0, wall.z2],
    [wall.x2, wall.height, wall.z2],
    [wall.x1, wall.height, wall.z1],
  ];

  const baseIdx = vertices.length / 10;
  for (let i = 0; i < 4; i++) {
    vertices.push(
      ...corners[i],
      nx,
      0,
      nz,
      ...wallColor,
      i < 2 ? 0 : 1,
      i % 2 === 0 ? 0 : 1,
    );
  }
  indices.push(baseIdx, baseIdx + 1, baseIdx + 2);
  indices.push(baseIdx, baseIdx + 2, baseIdx + 3);

  return { vertices, indices };
}

function computeWebGPUMesh(data: FloorPlanData) {
  const allVertices: number[] = [];
  const allIndices: number[] = [];

  const floor = createFloorMesh(data);
  allVertices.push(...floor.vertices);
  allIndices.push(...floor.indices);

  for (const wall of data.walls) {
    const wallMesh = createWallMesh(wall);
    const offset = allVertices.length / 10;
    allVertices.push(...wallMesh.vertices);
    allIndices.push(...wallMesh.indices.map((i) => i + offset));
  }

  for (const seat of data.seats) {
    const seatMesh = createSeatMesh(seat);
    const offset = allVertices.length / 10;
    allVertices.push(...seatMesh.vertices);
    allIndices.push(...seatMesh.indices.map((i) => i + offset));
  }

  return {
    vertices: new Float32Array(allVertices),
    indices: new Uint16Array(allIndices),
    indexCount: allIndices.length,
  };
}

function computeWebGLFallback(data: FloorPlanData) {
  const positions: number[] = [];
  const colors: number[] = [];
  const hw = data.width / 2;
  const hd = data.depth / 2;

  // Floor
  const fc = [0.15, 0.15, 0.18];
  positions.push(-hw, 0, -hd, hw, 0, -hd, hw, 0, hd);
  positions.push(-hw, 0, -hd, hw, 0, hd, -hw, 0, hd);
  for (let i = 0; i < 6; i++) colors.push(...fc);

  // Seats
  for (const seat of data.seats) {
    const c =
      seat.type === "hot_desk"
        ? [0.2, 0.6, 0.9]
        : seat.type === "fixed_desk"
          ? [0.3, 0.8, 0.4]
          : seat.type === "meeting_room"
            ? [0.8, 0.5, 0.2]
            : [0.7, 0.3, 0.7];
    const s = 0.3;
    const y = 0.4;
    const x = seat.x;
    const z = seat.z;
    // Simple quad
    positions.push(x - s, y, z - s, x + s, y, z - s, x + s, y, z + s);
    positions.push(x - s, y, z - s, x + s, y, z + s, x - s, y, z + s);
    for (let i = 0; i < 6; i++) colors.push(...c);
  }

  return {
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
  };
}

self.addEventListener("message", (event: MessageEvent<LayoutWorkerRequest>) => {
  if (event.data.type === "CALCULATE_LAYOUT") {
    const data = event.data.data;
    const webgpu = computeWebGPUMesh(data);
    const webgl = computeWebGLFallback(data);

    const response: LayoutWorkerResponse = {
      type: "LAYOUT_COMPLETE",
      webgpu,
      webgl,
    };

    self.postMessage(response, {
      transfer: [
        webgpu.vertices.buffer,
        webgpu.indices.buffer,
        webgl.positions.buffer,
        webgl.colors.buffer,
      ],
    });
  }
});
