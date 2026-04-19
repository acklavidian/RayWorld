// Cube is centered on camera; vertex positions double as view directions.
// Negate position to flip face winding (we're inside the cube).
// .xyww forces depth = 1.0 (far plane) so skybox renders behind everything.
#version 330
in vec3 vertexPosition;
uniform mat4 mvp;
out vec3 fragDir;
void main() {
    fragDir = vertexPosition;
    gl_Position = (mvp * vec4(-vertexPosition, 1.0)).xyww;
}
