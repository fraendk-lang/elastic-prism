import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { VisualizerSettings, VisualizerMode, HandUpdate } from '../types';

interface ShaderVisualizerProps {
  getFrequencyData: () => Uint8Array;
  settings: VisualizerSettings;
  mousePos: { x: number; y: number };
  handPos?: HandUpdate | null;
  engineOverrides?: React.MutableRefObject<Partial<VisualizerSettings>>;
}

const vertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const shaders: Record<string, string> = {
  fractal_zoom: `
    uniform float time;
    uniform vec2 resolution;
    uniform vec3 colorPrimary;
    uniform vec3 colorSecondary;
    uniform float intensity;
    uniform float bass;
    uniform float mid;
    uniform float high;
    uniform float kick;
    uniform vec2 mouse;
    varying vec2 vUv;

    vec3 palette(float t) {
      return mix(colorPrimary, colorSecondary, 0.5 + 0.5 * sin(t * 6.28));
    }

    void main() {
      vec2 uv = (gl_FragCoord.xy * 2.0 - resolution.xy) / min(resolution.x, resolution.y);

      // Audio-driven zoom with kick punch
      float zoom = 0.5 + bass * 3.0 + kick * 2.0;
      uv *= zoom;

      // Julia set parameter driven by audio
      float cr = -0.7 + sin(time * 0.2) * 0.15 * (1.0 + mid);
      float ci = 0.27015 + cos(time * 0.15) * 0.1 * (1.0 + high);

      // Mouse influence on seed
      cr += (mouse.x - 0.5) * 0.2;
      ci += (mouse.y - 0.5) * 0.2;

      vec2 z = uv;
      float iter = 0.0;
      float maxIter = 60.0 + bass * 40.0;

      for (float i = 0.0; i < 100.0; i++) {
        if (i >= maxIter) break;
        float x = z.x * z.x - z.y * z.y + cr;
        float y = 2.0 * z.x * z.y + ci;
        z = vec2(x, y);
        if (dot(z, z) > 4.0) break;
        iter = i;
      }

      float t = iter / maxIter;
      // Smooth coloring with hue rotation from time
      float hueShift = time * 0.3 + bass * 2.0;
      vec3 col = palette(t + hueShift) * intensity;

      // Kick flash
      col += colorPrimary * kick * 0.5;
      // Glow at center
      col += colorPrimary * 0.1 / (length(uv) + 0.3) * bass;

      gl_FragColor = vec4(col, 1.0);
    }
  `,

  fluid_sim: `
    uniform float time;
    uniform vec2 resolution;
    uniform vec3 colorPrimary;
    uniform vec3 colorSecondary;
    uniform float intensity;
    uniform float bass;
    uniform float mid;
    uniform float high;
    uniform float kick;
    uniform vec2 mouse;
    varying vec2 vUv;

    // Simplified reaction-diffusion inspired pattern
    float pattern(vec2 p, float t) {
      float a = 0.0;
      for (float i = 1.0; i < 8.0; i++) {
        p = abs(p) / dot(p, p) - 1.0;
        p *= 1.2 + bass * 0.3;
        float d = abs(p.x + p.y) * (0.5 + mid * 0.5);
        a += exp(-d * 3.0) / i;
      }
      return a;
    }

    void main() {
      vec2 uv = (gl_FragCoord.xy * 2.0 - resolution.xy) / min(resolution.x, resolution.y);

      // Slow rotation driven by audio
      float angle = time * 0.2 + bass * 0.5;
      mat2 rot = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
      uv = rot * uv;

      // Mouse disturbance
      vec2 mouseUV = (mouse * 2.0 - 1.0);
      float mouseDist = length(uv - mouseUV);
      uv += normalize(uv - mouseUV) * 0.1 / (mouseDist + 0.5) * mid;

      float t = time * 0.3;
      float p1 = pattern(uv + vec2(t, 0.0), t);
      float p2 = pattern(uv + vec2(0.0, t * 0.7), t);
      float p3 = pattern(uv * 1.5 + vec2(t * 0.5), t);

      vec3 col = colorPrimary * p1 + colorSecondary * p2;
      col += vec3(0.1, 0.2, 0.4) * p3 * high;
      col *= intensity;

      // Kick punch: brief white flash
      col += vec3(1.0) * kick * 0.3;
      // Vignette
      col *= 1.0 - 0.4 * length(vUv - 0.5);

      gl_FragColor = vec4(col, 1.0);
    }
  `,

  aurora: `
    uniform float time;
    uniform vec2 resolution;
    uniform vec3 colorPrimary;
    uniform vec3 colorSecondary;
    uniform float intensity;
    uniform float bass;
    uniform float mid;
    uniform float high;
    uniform float kick;
    uniform vec2 mouse;
    varying vec2 vUv;

    float fbm(vec2 p) {
      float value = 0.0;
      float amplitude = 0.5;
      for (int i = 0; i < 5; i++) {
        value += amplitude * sin(p.x * 3.0 + p.y * 2.0 + time * 0.5 + float(i));
        p = p * 2.1 + vec2(1.7, 1.2);
        amplitude *= 0.5;
      }
      return value;
    }

    void main() {
      vec2 uv = gl_FragCoord.xy / resolution.xy;
      vec2 p = uv * 2.0 - 1.0;
      p.x *= resolution.x / resolution.y;

      // Aurora layers - react to different frequency bands
      float aurora1 = fbm(vec2(p.x * 2.0 + time * 0.3, p.y * 0.5 + bass * 2.0));
      float aurora2 = fbm(vec2(p.x * 1.5 - time * 0.2, p.y * 0.8 + mid * 1.5));
      float aurora3 = fbm(vec2(p.x * 3.0 + time * 0.1, p.y * 0.3 + high));

      // Vertical fade - aurora is at top
      float verticalFade = smoothstep(-0.5, 0.8, p.y + aurora1 * 0.5 + bass * 0.3);
      float verticalFade2 = smoothstep(-0.3, 0.6, p.y + aurora2 * 0.3 + mid * 0.2);

      // Color mixing: green/teal base, purple/pink highlights
      vec3 auroraGreen = vec3(0.1, 0.9, 0.5) * verticalFade * (0.5 + aurora1 * 0.5);
      vec3 auroraPurple = vec3(0.6, 0.1, 0.8) * verticalFade2 * (0.3 + aurora2 * 0.4);
      vec3 auroraTeal = colorPrimary * smoothstep(0.0, 1.0, aurora3 + 0.3) * verticalFade;

      vec3 col = auroraGreen + auroraPurple + auroraTeal;

      // Beat pulse: aurora brightens on kicks
      col *= intensity * (1.0 + kick * 1.5);

      // Stars in background
      float stars = step(0.998, fract(sin(dot(floor(gl_FragCoord.xy * 0.5), vec2(12.9898, 78.233))) * 43758.5453));
      col += vec3(stars) * (1.0 - verticalFade) * 0.8 * (0.5 + high * 0.5);

      // Dark sky gradient at bottom
      vec3 sky = mix(vec3(0.0, 0.0, 0.02), vec3(0.0, 0.02, 0.05), uv.y);
      col = mix(sky, col, smoothstep(-0.5, 0.3, p.y + bass * 0.5));

      gl_FragColor = vec4(col, 1.0);
    }
  `,

  quantum_field: `
    uniform float time;
    uniform vec2 resolution;
    uniform vec3 colorPrimary;
    uniform vec3 colorSecondary;
    uniform float intensity;
    uniform float bass;
    uniform float mid;
    uniform float high;
    uniform float kick;
    uniform vec2 mouse;
    varying vec2 vUv;

    void main() {
      vec2 uv = (gl_FragCoord.xy * 2.0 - resolution.xy) / min(resolution.x, resolution.y);

      // 6 overlapping wave sources with audio-driven parameters
      float field = 0.0;
      for (float i = 0.0; i < 6.0; i++) {
        float angle = i * 1.047 + time * 0.2; // 60 degree offsets
        vec2 dir = vec2(cos(angle), sin(angle));
        float freq = 3.0 + i * 0.5 + bass * 2.0 + mid * i * 0.3;
        float phase = time * (0.5 + i * 0.1) + kick * 3.0;
        float amplitude = 0.5 + high * 0.3 / (i + 1.0);

        field += amplitude * sin(dot(uv, dir) * freq + phase);
      }

      // Mouse creates disturbance
      vec2 mouseUV = (mouse * 2.0 - 1.0);
      mouseUV.x *= resolution.x / resolution.y;
      float mouseDist = length(uv - mouseUV);
      field += 2.0 * sin(mouseDist * 8.0 - time * 3.0) / (mouseDist * 3.0 + 1.0);

      // Normalize and color
      field = field / 6.0;

      vec3 col = vec3(0.0);
      // Positive interference = primary color, negative = secondary
      col += colorPrimary * max(0.0, field) * 2.0;
      col += colorSecondary * max(0.0, -field) * 2.0;
      // High-frequency shimmer
      col += vec3(0.5, 0.5, 1.0) * abs(field) * high * 0.5;

      col *= intensity;

      // Kick: interference rings from center
      float kickRing = sin(length(uv) * 20.0 - time * 10.0) * kick;
      col += colorPrimary * max(0.0, kickRing) * 0.5;

      // Subtle grid
      float grid = step(0.97, max(
        abs(sin(uv.x * 10.0)),
        abs(sin(uv.y * 10.0))
      ));
      col += vec3(grid) * 0.03;

      gl_FragColor = vec4(col, 1.0);
    }
  `,

  neural_net: `
    uniform float time;
    uniform vec2 resolution;
    uniform vec3 colorPrimary;
    uniform vec3 colorSecondary;
    uniform float intensity;
    uniform float bass;
    uniform float mid;
    uniform float high;
    uniform float kick;
    uniform vec2 mouse;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    void main() {
      vec2 uv = gl_FragCoord.xy / resolution.xy;
      vec2 p = uv * 2.0 - 1.0;
      p.x *= resolution.x / resolution.y;

      vec3 col = vec3(0.0);

      // Neural network nodes in a grid
      float gridScale = 6.0;
      vec2 gridPos = p * gridScale;
      vec2 cellId = floor(gridPos);
      vec2 cellUV = fract(gridPos) - 0.5;

      // Node rendering
      float nodeRadius = 0.15 + bass * 0.1 + kick * 0.15;
      float nodeDist = length(cellUV);
      float nodeGlow = smoothstep(nodeRadius + 0.05, nodeRadius - 0.05, nodeDist);

      // Node activation based on audio + position hash
      float activation = hash(cellId) * 0.5 + 0.5;
      float audioSignal = bass * activation + mid * (1.0 - activation) + high * hash(cellId + 100.0);
      audioSignal = clamp(audioSignal, 0.0, 1.0);

      // Pulsing nodes
      float pulse = 0.5 + 0.5 * sin(time * 3.0 * activation + hash(cellId) * 6.28 + kick * 10.0);
      vec3 nodeColor = mix(colorSecondary * 0.3, colorPrimary, audioSignal * pulse);
      col += nodeColor * nodeGlow * intensity;

      // Connections between nodes
      for (float dx = -1.0; dx <= 1.0; dx++) {
        for (float dy = -1.0; dy <= 1.0; dy++) {
          if (dx == 0.0 && dy == 0.0) continue;
          vec2 neighborId = cellId + vec2(dx, dy);
          float neighborActivation = hash(neighborId) * 0.5 + 0.5;
          float connectionStrength = (audioSignal + neighborActivation * (bass + mid)) * 0.5;

          if (connectionStrength > 0.3) {
            // Draw line from center to neighbor
            vec2 neighborDir = vec2(dx, dy);
            float proj = clamp(dot(cellUV, normalize(neighborDir)), 0.0, length(neighborDir) * 0.5);
            vec2 closest = normalize(neighborDir) * proj;
            float lineDist = length(cellUV - closest);
            float lineGlow = smoothstep(0.04, 0.0, lineDist) * connectionStrength;

            // Signal traveling along connection
            float signal = sin(proj * 20.0 - time * 5.0 * activation + kick * 8.0);
            signal = max(0.0, signal);

            col += mix(colorSecondary, colorPrimary, signal) * lineGlow * 0.5 * intensity;
          }
        }
      }

      // Global kick flash
      col += colorPrimary * kick * 0.15;

      // Mouse proximity highlight
      float mouseDist = length(p - (mouse * 2.0 - 1.0) * vec2(resolution.x / resolution.y, 1.0));
      col += colorPrimary * 0.1 / (mouseDist + 0.5) * mid;

      gl_FragColor = vec4(col, 1.0);
    }
  `,

  glitch_city: `
    uniform float time;
    uniform vec2 resolution;
    uniform vec3 colorPrimary;
    uniform vec3 colorSecondary;
    uniform float intensity;
    uniform float bass;
    uniform float mid;
    uniform float high;
    uniform float kick;
    uniform vec2 mouse;
    varying vec2 vUv;

    float hash(float n) { return fract(sin(n) * 43758.5453); }
    float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

    void main() {
      vec2 uv = gl_FragCoord.xy / resolution.xy;
      vec2 p = uv * 2.0 - 1.0;
      p.x *= resolution.x / resolution.y;

      // Glitch displacement — bass drives horizontal tears
      float glitchLine = step(0.97, hash(floor(uv.y * 40.0 + time * 3.0))) * bass;
      p.x += glitchLine * (hash(floor(time * 20.0)) - 0.5) * 0.8;

      // Perspective grid — vanishing point with kick punch
      float horizon = 0.0 + kick * 0.3;
      float depth = 1.0 / (uv.y - horizon + 0.01);
      float gridX = sin(p.x * depth * 3.0 + time * 0.5) * 0.5 + 0.5;
      float gridZ = sin(depth * 2.0 - time * 2.0) * 0.5 + 0.5;
      float grid = smoothstep(0.95, 1.0, max(gridX, gridZ));

      // Buildings — procedural skyline from frequency
      float buildingX = floor(p.x * 8.0) / 8.0;
      float buildingH = hash2(vec2(buildingX, 0.0)) * 0.6 + mid * 0.4;
      float building = step(p.y, buildingH - 0.3) * step(-0.3, p.y);
      float windowGrid = step(0.6, sin(p.x * 50.0)) * step(0.6, sin(p.y * 30.0));

      vec3 col = vec3(0.0);

      // Sky gradient with audio-reactive color
      vec3 skyCol = mix(colorSecondary * 0.2, colorPrimary * 0.4, uv.y);
      col += skyCol;

      // Ground grid (below horizon)
      if (uv.y < 0.5 + horizon * 0.5) {
        col += colorPrimary * grid * 0.6 * intensity;
        col += colorSecondary * 0.05 / (abs(depth) * 0.01 + 0.3);
      }

      // Buildings with lit windows
      col = mix(col, vec3(0.02), building);
      col += colorPrimary * windowGrid * building * (0.3 + high * 0.7);

      // Neon signs — random bright spots on buildings
      float neon = step(0.985, hash2(floor(vec2(p.x * 20.0, p.y * 10.0)) + floor(time * 0.5))) * building;
      col += mix(colorPrimary, colorSecondary, hash(buildingX * 7.0)) * neon * 3.0;

      // Kick flash — horizon glow
      col += colorPrimary * kick * 0.4 * smoothstep(0.3, 0.0, abs(uv.y - 0.5));

      // Scanline effect
      col *= 0.95 + 0.05 * sin(gl_FragCoord.y * 1.5);

      // RGB split on glitch
      if (glitchLine > 0.0) {
        col.r = col.g * 1.5;
        col.b *= 0.3;
      }

      // Mouse spotlight
      float mDist = length(p - (mouse * 2.0 - 1.0) * vec2(resolution.x / resolution.y, 1.0));
      col += colorPrimary * 0.15 / (mDist + 0.4) * high;

      gl_FragColor = vec4(col * intensity, 1.0);
    }
  `,

  cosmic_web: `
    uniform float time;
    uniform vec2 resolution;
    uniform vec3 colorPrimary;
    uniform vec3 colorSecondary;
    uniform float intensity;
    uniform float bass;
    uniform float mid;
    uniform float high;
    uniform float kick;
    uniform vec2 mouse;
    varying vec2 vUv;

    // Voronoi distance for cosmic filament structure
    vec2 hash2v(vec2 p) {
      p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
      return fract(sin(p) * 43758.5453);
    }

    void main() {
      vec2 uv = (gl_FragCoord.xy * 2.0 - resolution.xy) / min(resolution.x, resolution.y);

      // Slow cosmic drift
      uv += vec2(sin(time * 0.05), cos(time * 0.07)) * 0.5;

      // Scale with bass pulse
      float scale = 4.0 + bass * 2.0;
      vec2 st = uv * scale;
      vec2 cellId = floor(st);
      vec2 cellUV = fract(st);

      // Two closest Voronoi distances — the gap between them = filament
      float d1 = 10.0;
      float d2 = 10.0;
      vec2 nearestId = vec2(0.0);

      for (float dy = -1.0; dy <= 1.0; dy++) {
        for (float dx = -1.0; dx <= 1.0; dx++) {
          vec2 neighbor = vec2(dx, dy);
          vec2 point = hash2v(cellId + neighbor);
          // Gentle orbital motion driven by mid frequencies
          point = 0.5 + 0.4 * sin(time * 0.3 + point * 6.28 + mid * 2.0);
          float d = length(cellUV - neighbor - point);
          if (d < d1) { d2 = d1; d1 = d; nearestId = cellId + neighbor; }
          else if (d < d2) { d2 = d; }
        }
      }

      // Filament = thin region between two cells
      float filament = smoothstep(0.0, 0.15 + high * 0.1, d2 - d1);
      filament = 1.0 - filament;

      // Node glow at cell centers
      float nodeGlow = smoothstep(0.15 + kick * 0.1, 0.0, d1);

      // Dark matter halo — large scale structure
      float halo = 0.5 + 0.5 * sin(length(uv) * 2.0 - time * 0.3 + bass * 3.0);

      vec3 col = vec3(0.0);

      // Filaments — primary color, pulsing with audio
      col += colorPrimary * filament * (0.4 + mid * 0.6) * intensity;

      // Nodes — bright secondary hot spots
      col += colorSecondary * nodeGlow * (1.0 + kick * 2.0) * intensity;

      // Halo background glow
      col += mix(colorPrimary, colorSecondary, halo) * 0.05;

      // Depth fog — distant filaments fade
      float fog = smoothstep(3.0, 0.0, length(uv));
      col *= fog;

      // Kick supernova flash at random node
      float flashNode = step(0.98, fract(sin(dot(nearestId, vec2(12.9, 78.2))) * 43758.5));
      col += colorPrimary * flashNode * kick * 2.0 * nodeGlow;

      // Mouse gravitational lens
      vec2 mUV = (mouse * 2.0 - 1.0) * vec2(resolution.x / resolution.y, 1.0);
      float mDist = length(uv - mUV);
      col += colorSecondary * 0.08 / (mDist + 0.3) * mid;

      gl_FragColor = vec4(col, 1.0);
    }
  `,

  electric_storm: `
    uniform float time;
    uniform vec2 resolution;
    uniform vec3 colorPrimary;
    uniform vec3 colorSecondary;
    uniform float intensity;
    uniform float bass;
    uniform float mid;
    uniform float high;
    uniform float kick;
    uniform vec2 mouse;
    varying vec2 vUv;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

    // Fractal brownian motion for cloud texture
    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float a = hash(i);
      float b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0));
      float d = hash(i + vec2(1.0, 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }

    float fbm(vec2 p) {
      float v = 0.0;
      float a = 0.5;
      for (int i = 0; i < 5; i++) {
        v += a * noise(p);
        p *= 2.0;
        a *= 0.5;
      }
      return v;
    }

    // Lightning bolt — jagged path between two points
    float lightning(vec2 uv, vec2 start, vec2 end, float seed) {
      vec2 dir = end - start;
      float len = length(dir);
      vec2 norm = normalize(dir);
      vec2 perp = vec2(-norm.y, norm.x);

      // Project point onto bolt line
      float t = clamp(dot(uv - start, norm) / len, 0.0, 1.0);
      vec2 linePoint = start + norm * t * len;

      // Jagged displacement using layered noise
      float displacement = 0.0;
      displacement += sin(t * 20.0 + seed + time * 8.0) * 0.03;
      displacement += sin(t * 45.0 + seed * 2.0 + time * 15.0) * 0.015;
      displacement += sin(t * 90.0 + seed * 3.0 + time * 25.0) * 0.007;

      linePoint += perp * displacement;

      float dist = length(uv - linePoint);

      // Glow falloff — thinner = more electric
      float bolt = 0.003 / (dist + 0.003);
      // Fade at ends
      bolt *= smoothstep(0.0, 0.1, t) * smoothstep(1.0, 0.9, t);
      return bolt;
    }

    void main() {
      vec2 uv = (gl_FragCoord.xy * 2.0 - resolution.xy) / min(resolution.x, resolution.y);

      // Storm clouds — dark, roiling FBM
      float clouds = fbm(uv * 2.0 + vec2(time * 0.1, time * 0.05));
      float clouds2 = fbm(uv * 3.0 - vec2(time * 0.15, time * 0.08) + 10.0);
      float stormCloud = clouds * clouds2;

      vec3 col = vec3(0.0);

      // Dark cloud base
      col += mix(vec3(0.01, 0.01, 0.03), colorSecondary * 0.15, stormCloud);

      // Lightning bolts — more active on kick/bass
      float boltCount = 2.0 + kick * 3.0 + bass * 2.0;
      for (float i = 0.0; i < 5.0; i++) {
        if (i >= boltCount) break;

        // Bolt appears/disappears rapidly — hash time to trigger
        float trigger = step(0.6 - kick * 0.3, hash(vec2(i, floor(time * 4.0 + i * 1.7))));
        if (trigger < 0.5) continue;

        // Start from top, end toward bottom with spread
        float seed = i * 137.0 + floor(time * 3.0);
        vec2 start = vec2(hash(vec2(seed, 0.0)) * 2.0 - 1.0, 1.2);
        vec2 end = vec2(start.x + (hash(vec2(seed, 1.0)) - 0.5) * 1.5, -0.8 - hash(vec2(seed, 2.0)) * 0.5);

        // Mouse attracts lightning
        end = mix(end, (mouse * 2.0 - 1.0) * vec2(resolution.x / resolution.y, 1.0), 0.3);

        float bolt = lightning(uv, start, end, seed);

        // Branch — smaller bolt from midpoint
        vec2 branchStart = mix(start, end, 0.3 + hash(vec2(seed, 3.0)) * 0.3);
        vec2 branchEnd = branchStart + vec2((hash(vec2(seed, 4.0)) - 0.5) * 0.8, -0.4);
        bolt += lightning(uv, branchStart, branchEnd, seed + 50.0) * 0.6;

        // Color: hot white core, colored glow
        col += vec3(1.0, 1.0, 1.0) * bolt * 0.5;
        col += colorPrimary * bolt * 0.8 * intensity;
        col += colorSecondary * bolt * 0.3;
      }

      // Thunder flash — whole sky illumination on kick
      col += mix(colorPrimary, vec3(0.8, 0.85, 1.0), 0.7) * kick * 0.2 * stormCloud;

      // Rain streaks — high frequency drives density
      float rain = 0.0;
      for (float i = 0.0; i < 3.0; i++) {
        vec2 rainUV = uv * vec2(30.0 + i * 10.0, 4.0);
        rainUV.y -= time * (8.0 + i * 3.0 + mid * 5.0);
        float streak = smoothstep(0.99, 1.0, sin(rainUV.x + hash(vec2(i, 0.0)) * 100.0));
        streak *= smoothstep(0.0, 0.5, fract(rainUV.y));
        rain += streak;
      }
      col += vec3(0.4, 0.5, 0.7) * rain * (0.1 + high * 0.2);

      // Ambient electrical charge — mid frequencies
      float charge = fbm(uv * 5.0 + time * vec2(0.5, 0.3)) * mid;
      col += colorPrimary * charge * 0.08;

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export const SHADER_MODES: VisualizerMode[] = ['fractal_zoom', 'fluid_sim', 'aurora', 'quantum_field', 'neural_net', 'glitch_city', 'cosmic_web', 'electric_storm'];

export const ShaderVisualizer: React.FC<ShaderVisualizerProps> = ({
  getFrequencyData,
  settings,
  mousePos,
  handPos,
  engineOverrides,
}) => {
  const isChrome = /Chrome/.test(navigator.userAgent) && !/Edg|OPR|Brave|CriOS/.test(navigator.userAgent);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const mousePosRef = useRef(mousePos);
  mousePosRef.current = mousePos;
  const handPosRef = useRef(handPos);
  handPosRef.current = handPos;
  const getFreqRef = useRef(getFrequencyData);
  getFreqRef.current = getFrequencyData;

  const containerRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<number>(0);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.Camera;
    material: THREE.ShaderMaterial;
    mesh: THREE.Mesh;
  } | null>(null);
  const kickPrev = useRef(0);
  const kickEnergy = useRef(0);

  useEffect(() => {
    if (!containerRef.current) return;
    const fragmentShader = shaders[settings.mode];
    if (!fragmentShader) return;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    // REUSE WebGL renderer (prevents context exhaustion)
    let renderer = rendererRef.current;
    if (!renderer) {
      renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'high-performance' });
      // Chrome is notably heavier at high DPR with shader-heavy scenes.
      renderer.setPixelRatio(isChrome ? 1 : Math.min(window.devicePixelRatio, 2));
      rendererRef.current = renderer;
      containerRef.current.appendChild(renderer.domElement);
    }
    renderer.setSize(width, height);

    // Dispose old scene objects
    if (sceneRef.current) {
      sceneRef.current.material.dispose();
      sceneRef.current.mesh.geometry.dispose();
    }

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const geometry = new THREE.PlaneGeometry(2, 2);
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        time: { value: 0 },
        resolution: { value: new THREE.Vector2(width, height) },
        colorPrimary: { value: new THREE.Color(settings.colorPrimary) },
        colorSecondary: { value: new THREE.Color(settings.colorSecondary) },
        intensity: { value: settings.masterIntensity },
        bass: { value: 0 },
        mid: { value: 0 },
        high: { value: 0 },
        kick: { value: 0 },
        mouse: { value: new THREE.Vector2(0.5, 0.5) },
        geoScale: { value: 1.0 },
        geoTurbulence: { value: 0.0 },
        geoComplexity: { value: 1.0 },
        geoSymmetry: { value: 1.0 },
      },
    });

    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    sceneRef.current = { scene, camera, material, mesh };

    const handleResize = () => {
      if (!containerRef.current || !sceneRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      rendererRef.current?.setSize(w, h);
      sceneRef.current.material.uniforms.resolution.value.set(w, h);
    };

    window.addEventListener('resize', handleResize);

    const animate = () => {
      if (!sceneRef.current || !rendererRef.current) return;
      const r = rendererRef.current;
      const { scene: s, camera: c, material: m } = sceneRef.current;

      const settings = engineOverrides?.current
        ? { ...settingsRef.current, ...engineOverrides.current } as VisualizerSettings
        : settingsRef.current;
      const mousePos = mousePosRef.current;
      const handPos = handPosRef.current;

      let freqData = getFreqRef.current();
      let shaderEnergy = 0;
      if (freqData && freqData.length > 0) { for (let i = 0; i < Math.min(freqData.length, 64); i++) shaderEnergy += freqData[i]; }
      if (!freqData || freqData.length === 0 || shaderEnergy < 10) {
        const t = Date.now() * 0.001;
        const idle = new Uint8Array(256);
        for (let i = 0; i < 256; i++) idle[i] = Math.max(0, (Math.sin(t * 0.5) * 0.2 + 0.2 + Math.sin(i / 256 * 6 + t * 2) * 0.1) * 255);
        freqData = idle;
      }
      const bass = freqData.length > 10 ? freqData.slice(0, 10).reduce((a, b) => a + b, 0) / (10 * 255) : 0;
      const mid = freqData.length > 100 ? freqData.slice(30, 100).reduce((a, b) => a + b, 0) / (70 * 255) : 0;
      const high = freqData.length > 200 ? freqData.slice(100, 200).reduce((a, b) => a + b, 0) / (100 * 255) : 0;

      // Kick detection
      const kickDelta = bass - kickPrev.current;
      kickPrev.current = bass;
      if (kickDelta > 0.06) kickEnergy.current = Math.min(1, kickDelta * 6);
      kickEnergy.current *= 0.82;

      m.uniforms.time.value += 0.016 * settings.speed;
      m.uniforms.bass.value = bass;
      m.uniforms.mid.value = mid;
      m.uniforms.high.value = high;
      m.uniforms.kick.value = kickEnergy.current;
      m.uniforms.intensity.value = settings.masterIntensity;
      m.uniforms.colorPrimary.value.set(settings.colorPrimary);
      m.uniforms.colorSecondary.value.set(settings.colorSecondary);
      m.uniforms.geoScale.value = settings.geoScale;
      m.uniforms.geoTurbulence.value = settings.geoTurbulence;
      m.uniforms.geoComplexity.value = settings.geoComplexity;
      m.uniforms.geoSymmetry.value = settings.geoSymmetry;

      const activeX = (settings.gestureControl && handPos?.active) ? handPos.x : mousePos.x;
      const activeY = (settings.gestureControl && handPos?.active) ? handPos.y : mousePos.y;
      m.uniforms.mouse.value.set(activeX, 1.0 - activeY);

      r.render(s, c);
      requestRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', handleResize);
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      // DON'T dispose renderer - reused across mode switches
      // Only dispose on full unmount (handled by parent)
    };
  // Only remount when shader mode changes (different GLSL program needed)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.mode]);

  return <div ref={containerRef} className="w-full h-full" />;
};
