/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// tslint:disable:organize-imports
// tslint:disable:ban-malformed-import-paths
// tslint:dsiable:no-new-decorators

import {LitElement, css, html} from 'lit';
import {customElement, property} from 'lit/decorators.js';
import {Analyser} from './analyser';

import * as THREE from 'three';
import {EXRLoader} from 'three/addons/loaders/EXRLoader.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {ShaderPass} from 'three/addons/postprocessing/ShaderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {FXAAShader} from 'three/addons/shaders/FXAAShader.js';
import {fs as backdropFS, vs as backdropVS} from './backdrop-shader';
import {vs as sphereVS} from './sphere-shader';

/**
 * 3D live audio visual.
 */
@customElement('gdm-live-audio-visuals-3d')
export class GdmLiveAudioVisuals3D extends LitElement {
  private inputAnalyser!: Analyser;
  private outputAnalyser!: Analyser;
  private camera!: THREE.PerspectiveCamera;
  private backdrop!: THREE.Mesh;
  private composer!: EffectComposer;
  private sphere!: THREE.Mesh;
  private prevTime = 0;
  private rotation = new THREE.Vector3(0, 0, 0);

  private _outputNode!: AudioNode;

  @property()
  set outputNode(node: AudioNode) {
    this._outputNode = node;
    this.outputAnalyser = new Analyser(this._outputNode);
  }

  get outputNode() {
    return this._outputNode;
  }

  private _inputNode!: AudioNode;

  @property()
  set inputNode(node: AudioNode) {
    this._inputNode = node;
    this.inputAnalyser = new Analyser(this._inputNode);
  }

  get inputNode() {
    return this._inputNode;
  }

  private canvas!: HTMLCanvasElement;

  static styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
    }
    canvas {
      width: 100% !important;
      height: 100% !important;
      position: absolute;
      inset: 0;
      image-rendering: pixelated; /* Consider auto for smoother visuals if preferred */
    }
  `;

  connectedCallback() {
    super.connectedCallback();
  }

  private init() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x100c14);

    const backdrop = new THREE.Mesh(
      new THREE.IcosahedronGeometry(10, 5),
      new THREE.RawShaderMaterial({
        uniforms: {
          resolution: {value: new THREE.Vector2(1, 1)},
          rand: {value: 0},
        },
        vertexShader: backdropVS,
        fragmentShader: backdropFS,
        glslVersion: THREE.GLSL3,
      }),
    );
    backdrop.material.side = THREE.BackSide;
    scene.add(backdrop);
    this.backdrop = backdrop;

    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000,
    );
    camera.position.set(2, -2, 5);
    this.camera = camera;

    const renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true, // Enabled antialias for smoother backdrop/edges
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    // Cap pixel ratio for performance on mobile, especially high DPI screens
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const geometry = new THREE.IcosahedronGeometry(1, 10);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();
    
    const sphereMaterial = new THREE.MeshStandardMaterial({
      color: 0x000010,
      metalness: 0.5,
      roughness: 0.1,
      emissive: 0x000010,
      emissiveIntensity: 1.5,
    });

    new EXRLoader().load(
      './piz_compressed.exr', // Changed to relative path
      (texture: THREE.Texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping;
        const exrCubeRenderTarget = pmremGenerator.fromEquirectangular(texture);
        sphereMaterial.envMap = exrCubeRenderTarget.texture;
        // sphere.visible = true; // Sphere visibility is now controlled directly below
      },
      undefined, // onProgress callback (optional)
      (error) => { // onError callback
        console.error('An error occurred loading the EXR texture:', error);
        // Fallback or error handling: e.g., use a default envMap or simpler material
        // For now, the sphere might appear black or unreflective if texture fails to load.
      }
    );


    sphereMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.time = {value: 0};
      shader.uniforms.inputData = {value: new THREE.Vector4()};
      shader.uniforms.outputData = {value: new THREE.Vector4()};

      sphereMaterial.userData.shader = shader;

      shader.vertexShader = sphereVS;
    };

    const sphere = new THREE.Mesh(geometry, sphereMaterial);
    scene.add(sphere);
    sphere.visible = true; // Sphere is now visible

    this.sphere = sphere;

    const renderPass = new RenderPass(scene, camera);

    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.8, // Adjusted bloom strength for mobile performance
      0.35, // Adjusted bloom radius for mobile performance
      0.9, // Adjusted bloom threshold for mobile performance
    );

    // FXAA pass can be performance intensive, consider if needed
    // const fxaaPass = new ShaderPass(FXAAShader);

    const composer = new EffectComposer(renderer);
    composer.addPass(renderPass);
    composer.addPass(bloomPass);
    // composer.addPass(fxaaPass); 

    this.composer = composer;

    const onWindowResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      const dPR = renderer.getPixelRatio(); // Use the actual renderer's pixel ratio
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (backdrop.material.uniforms.resolution) { // Check if material and uniforms exist
        backdrop.material.uniforms.resolution.value.set(w * dPR, h * dPR);
      }
      renderer.setSize(w, h);
      composer.setSize(w, h);
      // if (fxaaPass.material.uniforms['resolution']) { // Check for FXAA uniforms if used
      //   fxaaPass.material.uniforms['resolution'].value.set(
      //     1 / (w * dPR),
      //     1 / (h * dPR),
      //   );
      // }
    }

    window.addEventListener('resize', onWindowResize);
    onWindowResize();

    this.animation();
  }

  private animation() {
    requestAnimationFrame(() => this.animation());

    if (!this.inputAnalyser || !this.outputAnalyser) return; // Guard against uninitialized analysers

    this.inputAnalyser.update();
    this.outputAnalyser.update();

    const t = performance.now();
    const dt = (t - this.prevTime) / (1000 / 60); // Time delta in 60fps units
    this.prevTime = t;

    const backdropMaterial = this.backdrop.material as THREE.RawShaderMaterial;
    if (backdropMaterial.uniforms.rand) { // Check if uniform exists
      backdropMaterial.uniforms.rand.value = Math.random() * 10000;
    }

    const sphereMaterial = this.sphere.material as THREE.MeshStandardMaterial;
    if (sphereMaterial.userData.shader) {
      this.sphere.scale.setScalar(
        1 + (0.2 * this.outputAnalyser.data[1]) / 255, // Make sphere pulse with output audio
      );
      sphereMaterial.userData.shader.uniforms.time.value +=
        (dt * 0.1 * this.outputAnalyser.data[0]) / 255;
      sphereMaterial.userData.shader.uniforms.inputData.value.set(
        (1 * this.inputAnalyser.data[0]) / 255,
        (0.1 * this.inputAnalyser.data[1]) / 255,
        (10 * this.inputAnalyser.data[2]) / 255,
        0,
      );
      sphereMaterial.userData.shader.uniforms.outputData.value.set(
        (2 * this.outputAnalyser.data[0]) / 255,
        (0.1 * this.outputAnalyser.data[1]) / 255,
        (10 * this.outputAnalyser.data[2]) / 255,
        0,
      );
    }
    
    // Camera rotation based on audio input - this affects the backdrop view
    const f = 0.001; // Rotation factor
    this.rotation.x += (dt * f * 0.5 * this.outputAnalyser.data[1]) / 255;
    this.rotation.z += (dt * f * 0.5 * this.inputAnalyser.data[1]) / 255;
    this.rotation.y += (dt * f * 0.25 * (this.inputAnalyser.data[2] + this.outputAnalyser.data[2])) / 255;

    const euler = new THREE.Euler(
      this.rotation.x,
      this.rotation.y,
      this.rotation.z,
    );
    const quaternion = new THREE.Quaternion().setFromEuler(euler);
    const vector = new THREE.Vector3(0, 0, 5); // Camera distance from origin
    vector.applyQuaternion(quaternion);
    this.camera.position.copy(vector);
    this.camera.lookAt(this.sphere.position); // Sphere is at origin (0,0,0)


    this.composer.render();
  }

  protected firstUpdated() {
    this.canvas = this.shadowRoot!.querySelector('canvas') as HTMLCanvasElement;
    // Ensure nodes are available before initializing
    if (this.inputNode && this.outputNode) {
        this.init();
    } else {
        // Poll for nodes if not immediately available (e.g. async property updates)
        const interval = setInterval(() => {
            if (this.inputNode && this.outputNode) {
                clearInterval(interval);
                this.init();
            }
        }, 100);
    }
  }

  protected render() {
    return html`<canvas></canvas>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'gdm-live-audio-visuals-3d': GdmLiveAudioVisuals3D;
  }
}