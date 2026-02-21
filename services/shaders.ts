
export const VERTEX_SHADER = `
attribute vec2 position;
varying vec2 vUv;
void main() {
  vUv = position * 0.5 + 0.5;
  vUv.y = 1.0 - vUv.y; 
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

export const FRAGMENT_SHADER = `
precision highp float;
varying vec2 vUv;

uniform sampler2D uGameTexture;
uniform sampler2D uDistortionTexture;
uniform float uTime;
uniform vec2 uResolution;
uniform vec2 uCameraPos;
uniform float uGlitchIntensity;
uniform float uAberration;
uniform float uDamage; 

// --- NOISE FUNCTIONS ---
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy) );
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1;
  i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 )) + i.x + vec3(0.0, i1.x, 1.0 ));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
  m = m*m ; m = m*m ;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

// Fractal Brownian Motion
float fbm(vec2 st) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 4; i++) {
        value += amplitude * snoise(st);
        st *= 2.0;
        amplitude *= 0.5;
    }
    return value;
}

// Domain Warping for Nebula
float nebula(vec2 st, float time) {
    vec2 q = vec2(0.);
    q.x = fbm( st + 0.00 * time);
    q.y = fbm( st + vec2(1.0));

    vec2 r = vec2(0.);
    r.x = fbm( st + 1.0*q + vec2(1.7,9.2)+ 0.15*time );
    r.y = fbm( st + 1.0*q + vec2(8.3,2.8)+ 0.126*time);

    float f = fbm(st+r);

    return f*f*f + 0.6*f*f + 0.5*f;
}

// ACES Tone Mapping
vec3 aces(vec3 x) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
    vec2 uv = vUv;

    // 0. GLITCH EFFECT
    if (uGlitchIntensity > 0.0) {
        float strip = floor(uv.y * 20.0 + uTime * 50.0);
        float n = snoise(vec2(strip, floor(uTime * 20.0)));
        if (n < 0.2 * uGlitchIntensity) {
             uv.x += (snoise(vec2(uTime, strip)) - 0.5) * 0.05 * uGlitchIntensity;
        }
    }

    // 1. DATA SAMPLING
    vec4 distData = texture2D(uDistortionTexture, uv);
    float heat = distData.r;       // Explosions
    float gravity = distData.g;    // Black Holes
    float turbulence = distData.b; // Movement/Flow

    // 2. DYNAMIC BACKGROUND (REACTIVE AETHER)
    // Scale UV by resolution to get square cells, add parallax
    vec2 bgUV = (uv * 2.0) + (uCameraPos * 0.0002);

    // Warp the background domain based on turbulence
    float warp = turbulence * 0.2 + heat * 0.1;
    vec2 warpedBgUV = bgUV + vec2(
        snoise(bgUV + uTime * 0.1),
        snoise(bgUV + uTime * 0.1 + 100.0)
    ) * warp;

    float neb = nebula(warpedBgUV * 3.0, uTime * 0.2);

    // Colorize Nebula
    vec3 col1 = vec3(0.1, 0.0, 0.2); // Deep Void
    vec3 col2 = vec3(0.0, 0.1, 0.3); // Cyan Mist
    vec3 col3 = vec3(0.4, 0.0, 0.5); // Purple Energy

    vec3 bgCol = mix(col1, col2, neb);
    bgCol = mix(bgCol, col3, smoothstep(0.4, 0.8, neb));

    // Add "Stars" from noise peaks
    float star = smoothstep(0.7, 1.0, snoise(bgUV * 20.0));
    bgCol += vec3(star * 0.5);

    // 3. CHROMATIC ABERRATION & DISTORTION
    vec2 distToCenter = uv - 0.5;
    float distLen = length(distToCenter);
    
    // Intensity depends on radius + events
    float totalAberration = (uAberration * 0.01) 
                          + (distLen * 0.02)
                          + (heat * 0.03)
                          + (gravity * 0.05)
                          + (turbulence * 0.01)
                          + (uDamage * 0.05 * sin(uTime * 30.0));
                          
    // Gravity sucks inwards, Heat expands
    vec2 warpOffset = distToCenter * (heat * -0.1 + gravity * 0.2);
    vec2 finalUV = uv + warpOffset;

    // RGB Split
    float r = texture2D(uGameTexture, finalUV - distToCenter * totalAberration).r;
    float g = texture2D(uGameTexture, finalUV).g;
    float b = texture2D(uGameTexture, finalUV + distToCenter * totalAberration).b;
    vec3 gameColor = vec3(r, g, b);

    // 4. SINGLE-PASS BLOOM (Approximate)
    // Sample 9 points around current pixel, keep only brights
    vec3 bloomSum = vec3(0.0);
    float bloomRadius = 0.004 + (heat * 0.01); // Heat increases bloom size

    // Simple 3x3 kernel
    for(int i=-1; i<=1; i++) {
        for(int j=-1; j<=1; j++) {
            vec2 offset = vec2(float(i), float(j)) * bloomRadius;
            vec3 samp = texture2D(uGameTexture, finalUV + offset).rgb;
            // Threshold
            float brightness = dot(samp, vec3(0.2126, 0.7152, 0.0722));
            if(brightness > 0.6) {
                bloomSum += samp * brightness;
            }
        }
    }
    vec3 bloom = bloomSum / 9.0 * 1.5; // Boost intensity

    // 5. COMPOSITION
    // Add nebula (Screen blend over dark parts of game)
    // If game pixel is dark, show nebula. If bright, show game.
    float gameBrightness = dot(gameColor, vec3(0.33));
    vec3 finalColor = gameColor + bgCol * (1.0 - smoothstep(0.0, 0.2, gameBrightness));

    // Add Bloom
    finalColor += bloom;

    // Add Damage Overlay
    if (uDamage > 0.0) {
        float pulse = sin(uTime * 15.0) * 0.5 + 0.5;
        vec3 dmgColor = vec3(0.8, 0.0, 0.0) * uDamage * pulse * smoothstep(0.3, 1.0, distLen);
        finalColor += dmgColor;
    }

    // 6. SCANLINES & VIGNETTE
    float scanline = sin(finalUV.y * uResolution.y * 0.5) * 0.02;
    finalColor -= scanline;
    
    float vignette = smoothstep(1.5, 0.3, distLen);
    finalColor *= vignette;

    // 7. TONE MAPPING
    finalColor = aces(finalColor * 1.2); // Exposure boost

    gl_FragColor = vec4(finalColor, 1.0);
}
`;
