import { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { SkyMaterial } from '@babylonjs/materials/sky/skyMaterial';
import { RIVER_Y } from './terrain';

export interface Environment {
  sun: DirectionalLight;
  shadows: ShadowGenerator | null;
  /** Keep the shadow frustum centred on the player. */
  follow(target: Vector3): void;
}

// Morning sun from the east-north-east (southern hemisphere: sun arcs through the north).
const SUN_DIR = new Vector3(-0.55, -0.62, -0.38).normalize();

export function buildEnvironment(scene: Scene, quality: 'high' | 'low'): Environment {
  scene.clearColor = new Color4(0.62, 0.74, 0.86, 1);
  scene.ambientColor = new Color3(0.3, 0.3, 0.3);

  // Atmospheric depth: the Andes fade into haze.
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.0011;
  scene.fogColor = new Color3(0.7, 0.78, 0.86);

  const sky = new SkyMaterial('skyMat', scene);
  sky.backFaceCulling = false;
  sky.luminance = 0.95;
  sky.turbidity = 6;
  sky.rayleigh = 1.6;
  sky.mieDirectionalG = 0.82;
  sky.useSunPosition = true;
  sky.sunPosition = SUN_DIR.scale(-1000);
  sky.fogEnabled = false;
  const skybox = MeshBuilder.CreateBox('skyBox', { size: 9000 }, scene);
  skybox.material = sky;
  skybox.infiniteDistance = true;
  skybox.isPickable = false;

  const hemi = new HemisphericLight('hemi', new Vector3(0.1, 1, 0.05), scene);
  hemi.intensity = 0.62;
  hemi.diffuse = new Color3(0.85, 0.9, 1.0);
  hemi.groundColor = new Color3(0.32, 0.3, 0.24);
  hemi.specular = Color3.Black();

  const sun = new DirectionalLight('sun', SUN_DIR, scene);
  sun.intensity = 1.25;
  sun.diffuse = new Color3(1.0, 0.95, 0.84);
  sun.specular = new Color3(0.3, 0.3, 0.25);
  sun.position = new Vector3(0, 100, 0);

  // River in the Urubamba gorge
  const water = MeshBuilder.CreateGround('river', { width: 9000, height: 9000, subdivisions: 1 }, scene);
  water.position.y = RIVER_Y;
  const wm = new StandardMaterial('riverMat', scene);
  wm.diffuseColor = new Color3(0.28, 0.36, 0.3);
  wm.specularColor = new Color3(0.4, 0.4, 0.4);
  wm.specularPower = 64;
  water.material = wm;
  water.isPickable = false;

  let shadows: ShadowGenerator | null = null;
  if (quality === 'high') {
    shadows = new ShadowGenerator(1024, sun);
    shadows.bias = 0.0015;
    shadows.normalBias = 0.02;
    shadows.usePercentageCloserFiltering = true;
    shadows.filteringQuality = ShadowGenerator.QUALITY_LOW;
    shadows.darkness = 0.35;
    sun.autoUpdateExtends = false;
    sun.autoCalcShadowZBounds = false;
    sun.shadowMinZ = 1;
    sun.shadowMaxZ = 160;
    sun.orthoLeft = -28;
    sun.orthoRight = 28;
    sun.orthoTop = 28;
    sun.orthoBottom = -28;
  }

  return {
    sun,
    shadows,
    follow(target: Vector3) {
      // snap to a coarse grid to reduce shadow shimmering
      const s = 2;
      sun.position.set(
        Math.round(target.x / s) * s - SUN_DIR.x * 80,
        Math.round(target.y / s) * s - SUN_DIR.y * 80,
        Math.round(target.z / s) * s - SUN_DIR.z * 80,
      );
    },
  };
}

export function animateClouds(clouds: Mesh[], t: number) {
  for (let i = 0; i < clouds.length; i++) {
    const c = clouds[i];
    c.position.x += Math.sin(i * 1.7) * 0.02 + 0.03;
    if (c.position.x > 650) c.position.x = -650;
    c.position.y += Math.sin(t * 0.1 + i) * 0.004;
  }
}
