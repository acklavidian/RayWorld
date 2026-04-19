// Blinn-Phong + 3x3 PCF shadow mapping + point lights.
// lightVP is computed CPU-side to exactly match raylib's internal depth-pass
// MVP (including the Y-flip raylib applies when rendering to render textures).
#version 330
in vec3 fragPosition;
in vec2 fragTexCoord;
in vec3 fragNormal;
uniform sampler2D texture0;     // albedo
uniform vec4      colDiffuse;
uniform vec3      lightDir;     // unit vector from light toward scene
uniform vec4      lightColor;
uniform vec4      ambient;      // unused (kept for uniform compatibility)
uniform vec3      viewPos;
uniform mat4      lightVP;      // matches the depth-pass MVP exactly
uniform sampler2D shadowMap;
uniform int       shadowMapResolution;

// Point lights
#define MAX_POINT_LIGHTS 16
uniform int   numPointLights;
uniform vec3  pointLightPos[MAX_POINT_LIGHTS];
uniform vec3  pointLightColor[MAX_POINT_LIGHTS];
uniform float pointLightRange[MAX_POINT_LIGHTS];

out vec4 finalColor;
void main() {
    vec4 texelColor = texture(texture0, fragTexCoord);
    vec3 normal     = normalize(fragNormal);
    vec3 l          = -lightDir;
    float NdotL     = max(dot(normal, l), 0.0);
    vec3 viewD      = normalize(viewPos - fragPosition);

    // Hemisphere ambient: dim base lighting
    vec3 skyAmbient    = vec3(0.06, 0.07, 0.10);
    vec3 groundAmbient = vec3(0.02, 0.015, 0.015);
    float hemi         = dot(normal, vec3(0.0, 1.0, 0.0)) * 0.5 + 0.5;
    vec3 ambientLight  = mix(groundAmbient, skyAmbient, hemi);

    // Floor detection: upward-facing surfaces get a polished/shiny look
    float isFloor = smoothstep(0.8, 0.95, dot(normal, vec3(0.0, 1.0, 0.0)));
    float shininess = mix(32.0, 256.0, isFloor);
    float specStrength = mix(0.3, 1.2, isFloor);

    // Blinn-Phong specular for directional light
    float specCo = 0.0;
    if (NdotL > 0.0) {
        vec3 halfV = normalize(l + viewD);
        specCo = pow(max(dot(normal, halfV), 0.0), shininess);
    }

    // Direct (sun) light contribution — modulated by shadow
    vec3 directLight = lightColor.rgb * NdotL + vec3(specCo * specStrength);

    // Transform fragment to light clip space, then to [0,1] UV range
    vec4 lsPos = lightVP * vec4(fragPosition, 1.0);
    lsPos.xyz /= lsPos.w;
    lsPos.xyz  = (lsPos.xyz + 1.0) * 0.5;
    float curDepth = lsPos.z;
    float bias     = max(0.0002 * (1.0 - dot(normal, l)), 0.00002) + 0.00001;

    // 3x3 PCF shadow
    int  hits   = 0;
    vec2 texel  = vec2(1.0 / float(shadowMapResolution));
    for (int x = -1; x <= 1; x++)
        for (int y = -1; y <= 1; y++)
            if (curDepth - bias > texture(shadowMap, lsPos.xy + texel * vec2(x, y)).r)
                hits++;
    float shadowFactor = 1.0 - float(hits) / 9.0;

    // Point lights — local illumination with falloff
    vec3 pointLighting = vec3(0.0);
    for (int i = 0; i < numPointLights; i++) {
        vec3 toLight = pointLightPos[i] - fragPosition;
        float dist = length(toLight);
        float range = pointLightRange[i];
        if (dist < range) {
            vec3 plDir = toLight / dist;
            float plNdotL = max(dot(normal, plDir), 0.0);
            // Smooth quadratic falloff
            float t = 1.0 - dist / range;
            float atten = t * t;
            pointLighting += pointLightColor[i] * plNdotL * atten;
            // Point light specular (boosted on floors for polished look)
            if (plNdotL > 0.0) {
                vec3 plHalf = normalize(plDir + viewD);
                float plShininess = mix(48.0, 256.0, isFloor);
                float plSpecStr = mix(0.4, 1.5, isFloor);
                float plSpec = pow(max(dot(normal, plHalf), 0.0), plShininess);
                pointLighting += pointLightColor[i] * plSpec * atten * plSpecStr;
            }
        }
    }

    // Combine: ambient always visible, sun modulated by shadow, point lights unshadowed
    vec3 albedo = texelColor.rgb * colDiffuse.rgb;
    vec3 color  = albedo * (ambientLight + directLight * shadowFactor * 0.15 + pointLighting);

    // Gamma correction
    finalColor = vec4(pow(max(color, vec3(0.0)), vec3(1.0 / 2.2)), texelColor.a * colDiffuse.a);
}
