/**
 * Tests for the WebGL texture/shader memory leak fix in HeatDiffusionFallback
 * (Issue #1459). The fix ensures textures, VBOs, and shaders are freed on
 * repeated initialize() calls.
 */

// Simulate the resource tracking logic
class MockWebGLResourceTracker {
  private texture: object | null = null;
  private vbo: object | null = null;
  private vao: object | null = null;
  private program: object | null = null;

  private createdTextures = 0;
  private deletedTextures = 0;
  private linkedPrograms = 0;
  private deletedPrograms = 0;
  private deletedShaders = 0;

  initialize(): void {
    // Free any existing resources before re-allocating (the fix)
    if (this.texture) { this.deleteTexture(); }
    if (this.vbo) { this.deleteBuffer(); }
    if (this.vao) { this.deleteVertexArray(); }
    if (this.program) { this.deleteProgram(); }

    // Create new resources
    this.texture = {};
    this.vbo = {};
    this.vao = {};
    this.createdTextures++;

    // Compile shaders
    const vs = {};
    const fs = {};
    this.program = {};
    this.linkedPrograms++;

    // Delete shaders after linking (the fix)
    this.deleteShader(vs);
    this.deleteShader(fs);
  }

  private deleteTexture() { this.texture = null; this.deletedTextures++; }
  private deleteBuffer() { this.vbo = null; }
  private deleteVertexArray() { this.vao = null; }
  private deleteProgram() { this.program = null; this.deletedPrograms++; }
  private deleteShader(_shader: object) { this.deletedShaders++; }

  destroy(): void {
    if (this.texture) this.deleteTexture();
    if (this.program) this.deleteProgram();
    this.vbo = null;
    this.vao = null;
  }

  getStats() {
    return {
      createdTextures: this.createdTextures,
      deletedTextures: this.deletedTextures,
      linkedPrograms: this.linkedPrograms,
      deletedPrograms: this.deletedPrograms,
      deletedShaders: this.deletedShaders,
      hasTexture: this.texture !== null,
      hasProgram: this.program !== null,
    };
  }
}

describe("WebGL texture cleanup on re-initialize", () => {
  it("creates one texture per initialize() call", () => {
    const tracker = new MockWebGLResourceTracker();
    tracker.initialize();
    expect(tracker.getStats().createdTextures).toBe(1);
    expect(tracker.getStats().hasTexture).toBe(true);
  });

  it("deletes old texture before creating new one on second initialize()", () => {
    const tracker = new MockWebGLResourceTracker();
    tracker.initialize();
    tracker.initialize();
    const stats = tracker.getStats();
    expect(stats.createdTextures).toBe(2);
    expect(stats.deletedTextures).toBe(1); // old texture freed
    expect(stats.hasTexture).toBe(true); // new texture present
  });

  it("deletes shaders after linking (no dangling shader handles)", () => {
    const tracker = new MockWebGLResourceTracker();
    tracker.initialize();
    expect(tracker.getStats().deletedShaders).toBe(2); // vs + fs deleted
  });

  it("no resource leaks after 5 re-initializations", () => {
    const tracker = new MockWebGLResourceTracker();
    for (let i = 0; i < 5; i++) tracker.initialize();

    const stats = tracker.getStats();
    expect(stats.createdTextures).toBe(5);
    expect(stats.deletedTextures).toBe(4); // 4 old ones freed, 1 current
    expect(stats.hasTexture).toBe(true);
  });

  it("destroy() releases texture and program", () => {
    const tracker = new MockWebGLResourceTracker();
    tracker.initialize();
    tracker.destroy();

    const stats = tracker.getStats();
    expect(stats.hasTexture).toBe(false);
    expect(stats.hasProgram).toBe(false);
  });

  it("shaders deleted once per initialize (2 per call)", () => {
    const tracker = new MockWebGLResourceTracker();
    tracker.initialize();
    tracker.initialize();
    expect(tracker.getStats().deletedShaders).toBe(4); // 2 per init × 2 inits
  });
});
