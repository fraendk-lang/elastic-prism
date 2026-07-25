import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
// @ts-ignore
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer';
// @ts-ignore
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass';
// @ts-ignore
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass';
// @ts-ignore
import { GlitchPass } from 'three/examples/jsm/postprocessing/GlitchPass';
// @ts-ignore
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass';
// @ts-ignore
import { RGBShiftShader } from 'three/examples/jsm/shaders/RGBShiftShader';
// @ts-ignore
import { VignetteShader } from 'three/examples/jsm/shaders/VignetteShader';
// @ts-ignore
import { FilmShader } from 'three/examples/jsm/shaders/FilmShader';
import { VisualizerSettings, HandUpdate } from '../types';

interface Visualizer3DProps {
  getFrequencyData: () => Uint8Array;
  settings: VisualizerSettings;
  mousePosRef: React.RefObject<{ x: number; y: number }>;
  handPosRef: React.RefObject<HandUpdate | null>;
  engineOverrides?: React.MutableRefObject<Partial<VisualizerSettings>>;
}

export const Visualizer3D: React.FC<Visualizer3DProps> = ({
  getFrequencyData,
  settings,
  mousePosRef,
  handPosRef,
  engineOverrides,
}) => {
  const isChrome = /Chrome/.test(navigator.userAgent) && !/Edg|OPR|Brave|CriOS/.test(navigator.userAgent);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const getFreqRef = useRef(getFrequencyData);
  getFreqRef.current = getFrequencyData;

  const containerRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<number>(0);
  const sceneRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    composer: EffectComposer;
    prism: THREE.Mesh;
    particles: THREE.Points;
    bloomPass: UnrealBloomPass;
    glitchPass: GlitchPass;
    rgbShiftPass: ShaderPass;
    vignettePass: ShaderPass;
    filmPass: ShaderPass;
    handIndicator: THREE.Mesh;
  } | null>(null);

  // Initialization
  useEffect(() => {
    if (!containerRef.current) return;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({
      antialias: !isChrome, // keep Chrome fast under live load
      alpha: true,
      powerPreference: 'high-performance',
    });
    
    renderer.setSize(width, height);
    // Match VisualizerCanvas strategy: cap Chrome DPR for smoother FPS.
    renderer.setPixelRatio(isChrome ? 1 : Math.min(window.devicePixelRatio, 2));
    containerRef.current.appendChild(renderer.domElement);

    const composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    const bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 1.5, 0.4, 0.85);
    composer.addPass(bloomPass);

    const glitchPass = new GlitchPass();
    composer.addPass(glitchPass);

    const rgbShiftPass = new ShaderPass(RGBShiftShader);
    composer.addPass(rgbShiftPass);

    const vignettePass = new ShaderPass(VignetteShader);
    composer.addPass(vignettePass);

    const filmPass = new ShaderPass(FilmShader);
    composer.addPass(filmPass);

    const geometry = new THREE.OctahedronGeometry(2, 0);
    const material = new THREE.MeshPhongMaterial({
      color: settings.colorPrimary,
      wireframe: true,
      transparent: true,
      opacity: 0.8,
      emissive: settings.colorPrimary,
      emissiveIntensity: 0.5,
    });
    const prism = new THREE.Mesh(geometry, material);
    scene.add(prism);

    const particleCount = 1000;
    const particleGeometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount * 3; i++) {
      positions[i] = (Math.random() - 0.5) * 20;
    }
    particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const particleMaterial = new THREE.PointsMaterial({
      color: settings.colorPrimary,
      size: 0.05,
      transparent: true,
      opacity: 0.5,
    });
    const particles = new THREE.Points(particleGeometry, particleMaterial);
    scene.add(particles);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);
    const pointLight = new THREE.PointLight(0xffffff, 1);
    pointLight.position.set(5, 5, 5);
    scene.add(pointLight);

    // Hand Indicator
    const handGeometry = new THREE.SphereGeometry(0.2, 16, 16);
    const handMaterial = new THREE.MeshBasicMaterial({ color: settings.colorPrimary, transparent: true, opacity: 0.5 });
    const handIndicator = new THREE.Mesh(handGeometry, handMaterial);
    handIndicator.visible = false;
    scene.add(handIndicator);

    camera.position.z = 8;

    sceneRef.current = { 
      scene, camera, renderer, composer, prism, particles,
      bloomPass, glitchPass, rgbShiftPass, vignettePass, filmPass,
      handIndicator
    };

    const handleResize = () => {
      if (!containerRef.current || !sceneRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      sceneRef.current.camera.aspect = w / h;
      sceneRef.current.camera.updateProjectionMatrix();
      sceneRef.current.renderer.setSize(w, h);
      sceneRef.current.composer.setSize(w, h);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      renderer.dispose();
      if (containerRef.current && renderer.domElement.parentElement === containerRef.current) {
        containerRef.current.removeChild(renderer.domElement);
      }
      sceneRef.current = null;
    };
  }, []); // Only once on mount

  // Animation and Settings Updates
  useEffect(() => {
    const animate = () => {
      try {
        if (!sceneRef.current) return;
        const {
          camera, prism, particles, composer, bloomPass, glitchPass,
          rgbShiftPass, vignettePass, filmPass
        } = sceneRef.current;

        const settings = engineOverrides?.current
          ? { ...settingsRef.current, ...engineOverrides.current } as VisualizerSettings
          : settingsRef.current;
        const mousePos = mousePosRef.current;
        const handPos = handPosRef.current;

        let data = getFreqRef.current();
        let energy3d = 0;
        if (data && data.length > 0) { for (let i = 0; i < Math.min(data.length, 64); i++) energy3d += data[i]; }
        if (!data || data.length === 0 || energy3d < 10) {
          // Generate idle data for ambient animation
          const t = Date.now() * 0.001;
          const idle = new Uint8Array(1024);
          for (let i = 0; i < 1024; i++) {
            const n = i / 1024;
            idle[i] = Math.max(0, (Math.sin(t * 0.5) * 0.25 + 0.25 + Math.sin(n * 8 + t * 2) * 0.1) * 255 * (1 - n * 0.6));
          }
          data = idle;
        }
        
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const avg = sum / (data.length || 1);
        const bass = data[0] / 255;

        prism.rotation.x += (0.01 + (avg / 255) * 0.05) * settings.speed;
        prism.rotation.y += (0.015 + (avg / 255) * 0.05) * settings.speed;

        const scale = 1 + bass * settings.intensity + settings.distortion * 0.5;
        prism.scale.set(scale, scale, scale);

        // Vortex Effect in 3D
        if (settings.mode === 'vortex' || settings.mode === 'cyberflow') {
          prism.visible = settings.mode === 'cyberflow';
          if (settings.mode === 'cyberflow') {
            prism.rotation.z += 0.1 * settings.distortion * settings.speed;
          }
          particles.rotation.z += 0.05 * (avg / 255 + 0.1 + settings.distortion * 0.1) * settings.speed;
          const particlePositions = particles.geometry.attributes.position.array as Float32Array;
          for (let i = 0; i < 1000; i++) {
            const idx = i * 3;
            const angle = (i / 1000) * Math.PI * 2 * 10 + (Date.now() * 0.001 * settings.speed);
            const r = (i / 1000) * 10 * (1 + bass);
            particlePositions[idx] = Math.cos(angle) * r;
            particlePositions[idx + 2] = Math.sin(angle) * r;
            particlePositions[idx + 1] += Math.sin(Date.now() * 0.002 * settings.speed + i) * 0.02 * bass;
          }
        } else {
          prism.visible = true;
          // Original particle animation
          particles.rotation.y += 0.002 * settings.speed;
          const positions = particles.geometry.attributes.position.array as Float32Array;
          for (let i = 0; i < 1000; i++) {
            const idx = i * 3;
            positions[idx + 1] += Math.sin(Date.now() * 0.001 * settings.speed + i) * 0.01 * bass;
            if (positions[idx + 1] > 10) positions[idx + 1] = -10;
            if (positions[idx + 1] < -10) positions[idx + 1] = 10;
          }
        }
        particles.geometry.attributes.position.needsUpdate = true;

        // Mouse & Hand Interaction
        const activeX = (settings.gestureControl && handPos?.active) ? handPos.x : mousePos.x;
        const activeY = (settings.gestureControl && handPos?.active) ? handPos.y : mousePos.y;
        const isActive = (settings.gestureControl && handPos?.active) || settings.mouseInteraction;

        if (isActive) {
          const targetX = (activeX - 0.5) * 10;
          const targetY = -(activeY - 0.5) * 10;
          camera.position.x += (targetX - camera.position.x) * 0.05;
          camera.position.y += (targetY - camera.position.y) * 0.05;
          camera.lookAt(0, 0, 0);
        } else {
          camera.position.x += (0 - camera.position.x) * 0.05;
          camera.position.y += (0 - camera.position.y) * 0.05;
          camera.lookAt(0, 0, 0);
        }

        // Apply Hue Rotation and Color Cycle to 3D
        const time = Date.now() * 0.001;
        const cycleHue = settings.colorCycleSpeed > 0 ? (time * settings.colorCycleSpeed * 360) % 360 : 0;
        const totalHue = (settings.hueRotation + cycleHue) % 360;
        
        const primaryColor = new THREE.Color(settings.colorPrimary);
        
        if (totalHue !== 0) {
          primaryColor.offsetHSL(totalHue / 360, 0, 0);
        }

        (prism.material as THREE.MeshPhongMaterial).color.copy(primaryColor);
        (prism.material as THREE.MeshPhongMaterial).emissive.copy(primaryColor);
        (particles.material as THREE.PointsMaterial).color.copy(primaryColor);
        (particles.material as THREE.PointsMaterial).size = 0.05 * settings.particleSize * (1 + bass);
        
        if (sceneRef.current.handIndicator) {
          const indicator = sceneRef.current.handIndicator;
          if (settings.gestureControl && handPos?.active) {
            indicator.visible = true;
            indicator.position.x = (handPos.x - 0.5) * 10;
            indicator.position.y = -(handPos.y - 0.5) * 10;
            indicator.position.z = 2;
            (indicator.material as THREE.MeshBasicMaterial).color.copy(primaryColor);
          } else {
            indicator.visible = false;
          }
        }

        const beatMultiplier = settings.beatSync ? (1 + bass * 0.5) : 1;

        bloomPass.enabled = settings.bloom;
        bloomPass.threshold = settings.bloomThreshold;
        bloomPass.strength = 1.5 * settings.intensity * settings.bloomRadius * beatMultiplier;
        
        glitchPass.enabled = settings.glitch;
        // @ts-ignore
        if (glitchPass.curF !== undefined) glitchPass.curF = settings.glitchIntensity * 0.1 * beatMultiplier;
        
        if (rgbShiftPass.uniforms?.['amount']) {
          rgbShiftPass.uniforms['amount'].value = (settings.chromaticAberration * 0.005 + (bass * 0.01)) * beatMultiplier;
        }
        
        if (vignettePass.uniforms?.['darkness']) {
          vignettePass.uniforms['darkness'].value = settings.vignette ? 1.5 + bass * 0.5 : 0;
        }
        
        if (filmPass.uniforms?.['nIntensity']) {
          filmPass.uniforms['nIntensity'].value = settings.noise + bass * 0.2;
        }
        
        if (filmPass.uniforms?.['time']) {
          filmPass.uniforms['time'].value += 0.01;
        }

        composer.render();
        requestRef.current = requestAnimationFrame(animate);
      } catch (err) {
        console.error("Visualizer3D animate error:", err);
        requestRef.current = requestAnimationFrame(animate);
      }
    };

    if (sceneRef.current) {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      animate();
    }

    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={containerRef} className="w-full h-full" />;
};
