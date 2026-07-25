import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { VisualizerSettings, HandUpdate } from '../types';

interface CyberflowVisualizerProps {
  getFrequencyData: () => Uint8Array;
  settings: VisualizerSettings;
  mousePosRef: React.RefObject<{ x: number; y: number }>;
  handPosRef: React.RefObject<HandUpdate | null>;
  engineOverrides?: React.MutableRefObject<Partial<VisualizerSettings>>;
}

const vertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = `
  uniform float time;
  uniform vec2 resolution;
  uniform vec3 colorPrimary;
  uniform vec3 colorSecondary;
  uniform float intensity;
  uniform float bass;
  uniform float mid;
  uniform float high;
  uniform float kick;
  uniform float distortion;
  uniform vec2 mouse;
  varying vec2 vUv;

  mat2 rot(float a) {
    float c = cos(a), s = sin(a);
    return mat2(c, -s, s, c);
  }

  float poly(vec2 p, float n, float size) {
    float a = atan(p.x, p.y) + 3.14159265;
    float r = 6.2831853 / n;
    return cos(floor(0.5 + a / r) * r - a) * length(p) - size;
  }

  void main() {
    vec2 p = (gl_FragCoord.xy * 2.0 - resolution.xy) / min(resolution.x, resolution.y);
    vec2 m = (mouse * 2.0 - 1.0) * vec2(resolution.x / resolution.y, 1.0);
    float t = time * (0.4 + bass * 0.8);

    // Dance motion: rotating kaleido-ish geometry that "breathes" on beat.
    p *= rot(t * 0.7 + kick * 0.8);
    p += normalize(p - m) * (0.08 + distortion * 0.2) / (length(p - m) + 0.5) * (mid + 0.2);

    float pulse = 0.95 + kick * 0.7 + bass * 0.25;
    vec2 p2 = p * pulse;

    float g1 = poly(p2 * rot(t * 0.6), 6.0 + floor(high * 4.0), 0.32 + bass * 0.22);
    float g2 = poly(p2 * rot(-t * 0.9), 3.0 + floor(mid * 5.0), 0.16 + mid * 0.18);
    float ring = abs(length(p2) - (0.44 + sin(t * 2.0) * 0.08 + bass * 0.12));

    float s1 = smoothstep(0.02, 0.0, abs(g1));
    float s2 = smoothstep(0.025, 0.0, abs(g2));
    float sr = smoothstep(0.03, 0.0, ring);

    float wave = 0.5 + 0.5 * sin(p2.x * 12.0 + p2.y * 10.0 - t * 3.0);
    vec3 rainbow = vec3(
      0.5 + 0.5 * sin(t + p2.x * 2.5),
      0.5 + 0.5 * sin(t + 2.1 + p2.y * 2.7),
      0.5 + 0.5 * sin(t + 4.2 + (p2.x + p2.y) * 2.1)
    );

    vec3 baseColor = mix(colorPrimary, colorSecondary, wave);
    vec3 finalColor = baseColor * (s1 * 0.9 + s2 * 0.8 + sr * 0.7);
    finalColor += rainbow * (0.25 + high * 0.6) * (s1 + s2 + sr);
    finalColor += colorPrimary * kick * 0.45;
    finalColor += colorSecondary * bass * 0.2 / (length(p2) + 0.35);
    finalColor *= intensity;

    gl_FragColor = vec4(finalColor, 1.0);
  }
`;

export const CyberflowVisualizer: React.FC<CyberflowVisualizerProps> = ({
  getFrequencyData,
  settings,
  mousePosRef,
  handPosRef,
  engineOverrides,
}) => {
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const getFreqRef = useRef(getFrequencyData);
  getFreqRef.current = getFrequencyData;

  const containerRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<number>(0);
  const sceneRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.Camera;
    renderer: THREE.WebGLRenderer;
    material: THREE.ShaderMaterial;
  } | null>(null);
  const kickPrev = useRef(0);
  const kickEnergy = useRef(0);

  useEffect(() => {
    if (!containerRef.current) return;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const isChrome = /Chrome/.test(navigator.userAgent) && !/Edg|OPR|Brave|CriOS/.test(navigator.userAgent);
    const renderer = new THREE.WebGLRenderer({ antialias: !isChrome, alpha: true, powerPreference: 'high-performance' });
    
    renderer.setSize(width, height);
    renderer.setPixelRatio(isChrome ? 1 : Math.min(window.devicePixelRatio, 2));
    containerRef.current.appendChild(renderer.domElement);

    const geometry = new THREE.PlaneGeometry(2, 2);
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        time: { value: 0 },
        resolution: { value: new THREE.Vector2(width, height) },
        colorPrimary: { value: new THREE.Color(settings.colorPrimary) },
        colorSecondary: { value: new THREE.Color(settings.colorSecondary) },
        intensity: { value: 1.0 },
        bass: { value: 0 },
        mid: { value: 0 },
        high: { value: 0 },
        kick: { value: 0 },
        distortion: { value: settings.distortion },
        mouse: { value: new THREE.Vector2(0.5, 0.5) },
      },
    });

    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    sceneRef.current = { scene, camera, renderer, material };

    const handleResize = () => {
      if (!containerRef.current || !sceneRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      sceneRef.current.renderer.setSize(w, h);
      sceneRef.current.material.uniforms.resolution.value.set(w, h);
    };

    window.addEventListener('resize', handleResize);

    const animate = () => {
      if (!sceneRef.current) return;
      const { renderer, scene, camera, material } = sceneRef.current;

      const settings = engineOverrides?.current
        ? { ...settingsRef.current, ...engineOverrides.current } as VisualizerSettings
        : settingsRef.current;
      const mousePos = mousePosRef.current;
      const handPos = handPosRef.current;

      let freqData = getFreqRef.current();
      let cfEnergy = 0;
      if (freqData && freqData.length > 0) { for (let i = 0; i < Math.min(freqData.length, 64); i++) cfEnergy += freqData[i]; }
      if (!freqData || freqData.length === 0 || cfEnergy < 10) {
        const t = Date.now() * 0.001;
        const idle = new Uint8Array(256);
        for (let i = 0; i < 256; i++) idle[i] = Math.max(0, (Math.sin(t * 0.5) * 0.2 + 0.2 + Math.sin(i / 256 * 6 + t * 2) * 0.1) * 255);
        freqData = idle;
      }
      let bassAcc = 0; for (let i = 0; i < Math.min(10, freqData.length); i++) bassAcc += freqData[i];
      let midAcc = 0; for (let i = 20; i < Math.min(80, freqData.length); i++) midAcc += freqData[i];
      let highAcc = 0; for (let i = 80; i < Math.min(180, freqData.length); i++) highAcc += freqData[i];
      const bass = (bassAcc / Math.max(1, Math.min(10, freqData.length))) / 255;
      const mid = (midAcc / Math.max(1, Math.min(60, Math.max(0, freqData.length - 20)))) / 255;
      const high = (highAcc / Math.max(1, Math.min(100, Math.max(0, freqData.length - 80)))) / 255;
      const kickDelta = bass - kickPrev.current;
      kickPrev.current = bass;
      if (kickDelta > 0.06) kickEnergy.current = Math.min(1, kickDelta * 6.5);
      kickEnergy.current *= 0.84;

      material.uniforms.time.value += 0.01 * settings.speed;
      material.uniforms.bass.value = bass;
      material.uniforms.mid.value = mid;
      material.uniforms.high.value = high;
      material.uniforms.kick.value = kickEnergy.current;
      material.uniforms.intensity.value = settings.masterIntensity;
      material.uniforms.distortion.value = settings.distortion;
      material.uniforms.colorPrimary.value.set(settings.colorPrimary);
      material.uniforms.colorSecondary.value.set(settings.colorSecondary);

      const activeX = (settings.gestureControl && handPos?.active) ? handPos.x : mousePos.x;
      const activeY = (settings.gestureControl && handPos?.active) ? handPos.y : mousePos.y;
      material.uniforms.mouse.value.set(activeX, 1.0 - activeY);

      renderer.render(scene, camera);
      requestRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', handleResize);
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      renderer.dispose();
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={containerRef} className="w-full h-full" />;
};
