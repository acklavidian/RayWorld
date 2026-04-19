#version 330
in vec3 fragDir;
out vec4 finalColor;

float hash31(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.x + p.y) * p.z);
}

vec3 hash33(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract(vec3(p.x + p.y, p.x + p.z, p.y + p.z) * p.zyx);
}

float noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash31(i);
    float b = hash31(i + vec3(1,0,0));
    float c = hash31(i + vec3(0,1,0));
    float d = hash31(i + vec3(1,1,0));
    float e = hash31(i + vec3(0,0,1));
    float ff = hash31(i + vec3(1,0,1));
    float g = hash31(i + vec3(0,1,1));
    float h = hash31(i + vec3(1,1,1));
    return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y),
               mix(mix(e, ff, f.x), mix(g, h, f.x), f.y), f.z);
}

void main() {
    vec3 dir = normalize(fragDir);

    // Dense dim stars
    float stars = 0.0;
    vec3 d1 = dir * 300.0;
    vec3 cell1 = floor(d1);
    vec3 f1 = fract(d1);
    vec3 starOff1 = hash33(cell1);
    float dist1 = length(f1 - starOff1);
    stars += smoothstep(0.06, 0.0, dist1) * hash31(cell1 + 42.0) * 0.6;

    // Medium stars
    vec3 d2 = dir * 120.0;
    vec3 cell2 = floor(d2);
    vec3 f2 = fract(d2);
    vec3 starOff2 = hash33(cell2);
    float dist2 = length(f2 - starOff2);
    float b2 = hash31(cell2 + 77.0);
    if (b2 > 0.4) stars += smoothstep(0.08, 0.0, dist2) * b2;

    // Sparse bright colored stars
    vec3 starColor = vec3(stars);
    vec3 d3 = dir * 40.0;
    vec3 cell3 = floor(d3);
    vec3 f3 = fract(d3);
    vec3 starOff3 = hash33(cell3);
    float dist3 = length(f3 - starOff3);
    float b3 = hash31(cell3 + 13.0);
    if (b3 > 0.8) {
        float colorSel = hash31(cell3 + 200.0);
        vec3 tint = colorSel < 0.33 ? vec3(0.7, 0.8, 1.0)
                  : colorSel < 0.66 ? vec3(1.0, 0.95, 0.8)
                  : vec3(1.0, 0.7, 0.6);
        float glow = smoothstep(0.15, 0.0, dist3) * 1.5;
        starColor += tint * glow;
    }

    // Nebula
    float n1 = noise(dir * 2.0);
    float n2 = noise(dir * 4.0 + 50.0);
    float n3 = noise(dir * 1.5 + 100.0);
    vec3 nebula = vec3(0.06, 0.01, 0.10) * smoothstep(0.35, 0.65, n1)
                + vec3(0.01, 0.04, 0.08) * smoothstep(0.40, 0.70, n2)
                + vec3(0.04, 0.01, 0.02) * smoothstep(0.45, 0.75, n3);

    finalColor = vec4(nebula + starColor, 1.0);
}
