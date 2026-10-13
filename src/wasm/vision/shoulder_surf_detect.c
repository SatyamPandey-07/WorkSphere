/**
 * shoulder_surf_detect.c
 * Calculates the geometric vector of secondary faces in the frame to determine
 * if they are focused on the user's screen.
 */

#include <math.h>
#include <stdint.h>

typedef struct {
  float x;
  float y;
  float z; // Estimated depth based on face bounding box size
} Point3D;

typedef struct {
  Point3D position;
  float yaw; // Head rotation
  int is_primary_user;
} DetectedFace;

// Estimate depth from bounding box height (simplified pinhole camera model)
float estimate_depth(float bbox_height, float focal_length,
                     float real_face_height) {
  if (bbox_height <= 0)
    return 0.0f;
  return (focal_length * real_face_height) / bbox_height;
}

// Calculate angle between the secondary face's gaze vector and the screen
// normal
int is_looking_at_screen(const DetectedFace *primary,
                         const DetectedFace *secondary, float screen_width,
                         float screen_height) {
  // Vector from secondary face to primary screen center (approximated as
  // primary face position)
  float dx = primary->position.x - secondary->position.x;
  float dy = primary->position.y - secondary->position.y;
  float dz = primary->position.z - secondary->position.z;

  // Normalize the vector
  float dist = sqrtf(dx * dx + dy * dy + dz * dz);
  if (dist == 0)
    return 0;

  float dir_x = dx / dist;
  float dir_y = dy / dist;
  float dir_z = dz / dist;

  // The secondary face's gaze vector (simplified: assuming yaw indicates
  // horizontal look) A yaw of 0 means looking straight ahead relative to their
  // own body. We need to know their orientation relative to the camera. For
  // this simulation, we assume the camera is the screen. If the secondary face
  // is looking towards the camera (z-axis), they are looking at the screen.

  // Simple heuristic: if the secondary face is within a certain angular cone
  // towards the camera
  float angle_to_camera = acosf(dir_z); // Angle between gaze and camera normal

  // Threshold: approx 30 degrees (0.52 radians)
  if (angle_to_camera < 0.52f) {
    return 1; // Looking at screen
  }

  return 0;
}

// Main detection logic
// Returns 1 if a shoulder surfer is detected, 0 otherwise
int detect_shoulder_surfing(const float *face_data, int num_faces,
                            int primary_face_index) {
  if (num_faces <= 1 || primary_face_index < 0 ||
      primary_face_index >= num_faces) {
    return 0; // No secondary faces or invalid index
  }

  // face_data format: [x, y, bbox_height, yaw] per face
  DetectedFace faces[10]; // Max 10 faces for stack allocation
  if (num_faces > 10)
    num_faces = 10;

  float focal_length = 500.0f;    // Mock camera focal length
  float real_face_height = 20.0f; // Mock real face height in cm

  for (int i = 0; i < num_faces; i++) {
    int offset = i * 4;
    faces[i].position.x = face_data[offset];
    faces[i].position.y = face_data[offset + 1];
    faces[i].position.z =
        estimate_depth(face_data[offset + 2], focal_length, real_face_height);
    faces[i].yaw = face_data[offset + 3];
    faces[i].is_primary_user = (i == primary_face_index);
  }

  const DetectedFace *primary = &faces[primary_face_index];

  for (int i = 0; i < num_faces; i++) {
    if (i == primary_face_index)
      continue;

    const DetectedFace *secondary = &faces[i];

    // Check distance: if too far, probably not a threat
    float dx = primary->position.x - secondary->position.x;
    float dy = primary->position.y - secondary->position.y;
    float dz = primary->position.z - secondary->position.z;
    float dist = sqrtf(dx * dx + dy * dy + dz * dz);

    if (dist < 100.0f) { // Within 1 meter
      if (is_looking_at_screen(primary, secondary, 1920.0f, 1080.0f)) {
        return 1; // Shoulder surfer detected!
      }
    }
  }

  return 0;
}