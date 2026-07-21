export {};

declare global {
  interface CustomJwtSessionClaims {
    metadata: {
      role?: "admin" | "manager" | "employee";
    };
  }

  const GPUBufferUsage: {
    MAP_READ: number;
    MAP_WRITE: number;
    COPY_SRC: number;
    COPY_DST: number;
    INDEX: number;
    VERTEX: number;
    UNIFORM: number;
    STORAGE: number;
    INDIRECT: number;
    QUERY_RESOLVE: number;
  };

  const GPUTextureUsage: {
    COPY_SRC: number;
    COPY_DST: number;
    TEXTURE_BINDING: number;
    STORAGE_BINDING: number;
    RENDER_ATTACHMENT: number;
  };

  // WebGPU Ambient Type Declarations
  interface GPUDevice {
    createCommandEncoder(descriptor?: any): any;
    createRenderPipeline(descriptor: any): any;
    createBuffer(descriptor: any): any;
    createTexture(descriptor: any): any;
    createBindGroup(descriptor: any): any;
    createShaderModule(descriptor: any): any;
    queue: {
      writeBuffer(
        buffer: any,
        bufferOffset: number,
        data: any,
        dataOffset?: number,
        size?: number,
      ): void;
      submit(commandBuffers: any[]): void;
    };
    [key: string]: any;
  }

  interface GPUCanvasContext {
    configure(config: any): void;
    getCurrentTexture(): any;
    [key: string]: any;
  }

  interface GPURenderPipeline {
    [key: string]: any;
  }

  interface GPUBuffer {
    destroy(): void;
    [key: string]: any;
  }

  interface GPUBindGroup {
    [key: string]: any;
  }

  interface GPUAdapter {
    requestDevice(descriptor?: any): Promise<GPUDevice>;
    [key: string]: any;
  }

  interface Navigator {
    gpu?: {
      requestAdapter(options?: any): Promise<GPUAdapter | null>;
      getPreferredCanvasFormat(): string;
    };
  }
}
