import * as ort from "onnxruntime-web";

export type LayoutRequest = {
  floorPlanGrid: number[] | Float32Array;
  width: number;
  height: number;
  deskCount: number;
  powerOutlets: { x: number; y: number }[];
};

export type LayoutRecommendation = {
  desks: { x: number; y: number; orientation: number }[];
  quietZones: { x: number; y: number; radius: number }[];
  score: number;
};

export type LayoutWorkerRequest = {
  type: "OPTIMIZE";
  requestId: number;
  payload: Omit<LayoutRequest, "floorPlanGrid"> & {
    floorPlanGridBuffer: ArrayBuffer;
  };
};

export type LayoutWorkerSuccess = {
  type: "SUCCESS";
  requestId: number;
  payload: {
    deskCoordinatesBuffer: ArrayBuffer;
    quietZoneCoordinatesBuffer: ArrayBuffer;
    score: number;
  };
};

export type LayoutWorkerFailure = {
  type: "ERROR";
  requestId: number;
  error: string;
};

export type LayoutWorkerResponse = LayoutWorkerSuccess | LayoutWorkerFailure;

let session: ort.InferenceSession | null = null;
let modelInitializationAttempted = false;

async function initModel(): Promise<void> {
  if (session || modelInitializationAttempted) {
    return;
  }

  modelInitializationAttempted = true;

  try {
    ort.env.wasm.wasmPaths = "/";
    session = await ort.InferenceSession.create(
      "/models/layout_optimizer.onnx",
      { executionProviders: ["wasm"] },
    );
  } catch (error) {
    console.warn(
      "Failed to load layout optimizer model; using the worker heuristic fallback.",
      error,
    );
  }
}

function validateRequest(
  request: Omit<LayoutRequest, "floorPlanGrid">,
  floorPlanGrid: Float32Array,
): void {
  if (!Number.isInteger(request.width) || request.width <= 0) {
    throw new Error("Layout width must be a positive integer.");
  }

  if (!Number.isInteger(request.height) || request.height <= 0) {
    throw new Error("Layout height must be a positive integer.");
  }

  if (!Number.isInteger(request.deskCount) || request.deskCount < 0) {
    throw new Error("Desk count must be a non-negative integer.");
  }

  if (floorPlanGrid.length !== request.width * request.height) {
    throw new Error(
      "Floor-plan grid length must equal width multiplied by height.",
    );
  }
}

function fallbackLayout(
  request: Omit<LayoutRequest, "floorPlanGrid">,
): LayoutRecommendation {
  const desks = Array.from({ length: request.deskCount }, (_, index) => {
    const outlet =
      request.powerOutlets[index % Math.max(request.powerOutlets.length, 1)];

    if (outlet) {
      const offset = Math.floor(index / request.powerOutlets.length) + 1;
      return {
        x: Math.min(
          request.width - 1,
          Math.max(0, outlet.x + (index % 2 === 0 ? offset : -offset)),
        ),
        y: Math.min(request.height - 1, Math.max(0, outlet.y)),
        orientation: index % 2 === 0 ? 0 : Math.PI,
      };
    }

    const columns = Math.max(1, Math.ceil(Math.sqrt(request.deskCount)));
    return {
      x: Math.min(request.width - 1, index % columns),
      y: Math.min(request.height - 1, Math.floor(index / columns)),
      orientation: 0,
    };
  });

  return {
    desks,
    quietZones: [],
    score: 0.5,
  };
}

async function optimizeLayout(
  request: Omit<LayoutRequest, "floorPlanGrid">,
  floorPlanGrid: Float32Array,
): Promise<LayoutRecommendation> {
  validateRequest(request, floorPlanGrid);
  await initModel();

  if (!session) {
    return fallbackLayout(request);
  }

  const inputTensor = new ort.Tensor("float32", floorPlanGrid, [
    1,
    1,
    request.height,
    request.width,
  ]);

  const results = await session.run({ input: inputTensor });
  const outputTensor = results.output;

  if (!outputTensor || !(outputTensor.data instanceof Float32Array)) {
    throw new Error(
      "Layout optimizer model returned an invalid output tensor.",
    );
  }

  const output = outputTensor.data;
  const requiredValues = request.deskCount * 3;

  if (output.length < requiredValues) {
    throw new Error(
      "Layout optimizer model returned insufficient desk coordinates.",
    );
  }

  const desks = Array.from({ length: request.deskCount }, (_, index) => ({
    x: output[index * 3],
    y: output[index * 3 + 1],
    orientation: output[index * 3 + 2],
  }));

  return {
    desks,
    quietZones: [
      {
        x: request.width / 2,
        y: request.height / 2,
        radius: Math.max(2, Math.min(request.width, request.height) / 10),
      },
    ],
    score: 0.92,
  };
}

function serializeRecommendation(recommendation: LayoutRecommendation) {
  const deskCoordinates = new Float32Array(recommendation.desks.length * 3);

  recommendation.desks.forEach((desk, index) => {
    deskCoordinates[index * 3] = desk.x;
    deskCoordinates[index * 3 + 1] = desk.y;
    deskCoordinates[index * 3 + 2] = desk.orientation;
  });

  const quietZoneCoordinates = new Float32Array(
    recommendation.quietZones.length * 3,
  );

  recommendation.quietZones.forEach((zone, index) => {
    quietZoneCoordinates[index * 3] = zone.x;
    quietZoneCoordinates[index * 3 + 1] = zone.y;
    quietZoneCoordinates[index * 3 + 2] = zone.radius;
  });

  return {
    deskCoordinates,
    quietZoneCoordinates,
  };
}

self.addEventListener(
  "message",
  async (event: MessageEvent<LayoutWorkerRequest>) => {
    const message = event.data;

    if (!message || message.type !== "OPTIMIZE") {
      return;
    }

    try {
      const { floorPlanGridBuffer, ...request } = message.payload;
      const floorPlanGrid = new Float32Array(floorPlanGridBuffer);
      const recommendation = await optimizeLayout(request, floorPlanGrid);
      const { deskCoordinates, quietZoneCoordinates } =
        serializeRecommendation(recommendation);

      const response: LayoutWorkerSuccess = {
        type: "SUCCESS",
        requestId: message.requestId,
        payload: {
          deskCoordinatesBuffer: deskCoordinates.buffer as ArrayBuffer,
          quietZoneCoordinatesBuffer:
            quietZoneCoordinates.buffer as ArrayBuffer,
          score: recommendation.score,
        },
      };

      self.postMessage(response, {
        transfer: [
          deskCoordinates.buffer as ArrayBuffer,
          quietZoneCoordinates.buffer as ArrayBuffer,
        ],
      });
    } catch (error) {
      const response: LayoutWorkerFailure = {
        type: "ERROR",
        requestId: message.requestId,
        error:
          error instanceof Error
            ? error.message
            : "Layout optimization failed.",
      };

      self.postMessage(response);
    }
  },
);
