/**
 * scene_graph.c
 * Constructs a localized spatial graph of detected amenities and obstacles
 * relative to the user's camera vector.
 */

#include <emscripten.h>
#include <math.h>
#include <stdint.h>

#define MAX_OBJECTS 64

typedef struct {
  float x;
  float y;
  float z;
  float width;
  float height;
  int type; // 0: obstacle, 1: chair, 2: outlet, 3: person
  float confidence;
} SpatialObject;

SpatialObject scene_objects[MAX_OBJECTS];
int object_count = 0;

EMSCRIPTEN_KEEPALIVE
void clear_scene() { object_count = 0; }

// Mock bounding box to 3D projection
EMSCRIPTEN_KEEPALIVE
void add_object(float bbox_x, float bbox_y, float bbox_w, float bbox_h,
                int type, float depth, int img_width, int img_height) {
  if (object_count >= MAX_OBJECTS)
    return;

  // Camera intrinsics (mock)
  float cx = img_width / 2.0f;
  float cy = img_height / 2.0f;
  float fx = img_width * 0.8f;
  float fy = img_height * 0.8f;

  // Center of bounding box
  float u = bbox_x + bbox_w / 2.0f;
  float v = bbox_y + bbox_h / 2.0f;

  // Unproject to 3D
  float x3d = (u - cx) * depth / fx;
  float y3d = (v - cy) * depth / fy;
  float z3d = depth;

  SpatialObject obj;
  obj.x = x3d;
  obj.y = y3d; // Note: Y is usually down in image, up in 3D. Invert if needed.
  obj.z = z3d;
  obj.width = bbox_w * depth / fx;
  obj.height = bbox_h * depth / fy;
  obj.type = type;
  obj.confidence = 0.9f; // Mock confidence

  scene_objects[object_count++] = obj;
}

EMSCRIPTEN_KEEPALIVE
int get_object_count() { return object_count; }

// Returns flattened array of objects: [x, y, z, type, confidence, ...]
EMSCRIPTEN_KEEPALIVE
void get_scene_graph(float *out_buffer) {
  for (int i = 0; i < object_count; i++) {
    int offset = i * 5;
    out_buffer[offset] = scene_objects[i].x;
    out_buffer[offset + 1] = scene_objects[i].y;
    out_buffer[offset + 2] = scene_objects[i].z;
    out_buffer[offset + 3] = (float)scene_objects[i].type;
    out_buffer[offset + 4] = scene_objects[i].confidence;
  }
}