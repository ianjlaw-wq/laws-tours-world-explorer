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
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
import { RIVER_Y } from './terrain';

export interface Environment {
  sun: DirectionalLight;
  shadows: ShadowGenerator | null;
  /** Keep the shadow frustum centred on the player. */
  follow(target: Vector3): void;
}

// Mid-morning sun from the north-east (southern hemisphere: the sun arcs through the north),
// low enough to rake across the stonework and give long, readable shadows.
const SUN_DIR = new Vector3(-0.78, -0.5, -0.24).normalize();

export function buildEnvironment(scene: Scene, quality: 'high' | 'low', mobile: boolean): Environment {
  scene.clearColor = new Color4(0.66, 0.76, 0.87, 1);
  scene.ambientColor = new Color3(0.3, 0.3, 0.3);

  // Filmic tone mapping + gentle contrast and vignette (applied inside material shaders: cheap).
  const ip = scene.imageProcessingConfiguration;
  ip.toneMappingEnabled = true;
  ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
  ip.exposure = 1.25;
  ip.contrast = 1.1;
  ip.vignetteEnabled = true;
  ip.vignetteWeight = 1.4;
  ip.vignetteStretch = 0.4;
  ip.vignetteColor = new Color4(0.05, 0.07, 0.1, 0);

  // Aerial perspective: blue-grey haze that swallows the distant ranges.
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.00085;
  scene.fogColor = new Color3(0.68, 0.76, 0.85);

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
  hemi.intensity = 1.0;
  hemi.diffuse = new Color3(0.72, 0.82, 1.0); // cool skylight in the shadows
  hemi.groundColor = new Color3(0.4, 0.4, 0.3); // warm-green bounce from grass and stone
  hemi.specular = Color3.Black();

  const sun = new DirectionalLight('sun', SUN_DIR, scene);
  sun.intensity = 1.55;
  sun.diffuse = new Color3(1.0, 0.91, 0.76); // warm morning light
  sun.specular = new Color3(0.3, 0.3, 0.25);
  sun.position = new Vector3(0, 100, 0);

  // River in the Urubamba gorge
  const water = MeshBuilder.CreateGround('river', { width: 9000, height: 9000, subdivisions: 1 }, scene);
  water.position.y = RIVER_Y;
  const wm = new StandardMaterial('riverMat', scene);
  wm.diffuseColor = new Color3(0.3, 0.33, 0.26); // silty Urubamba
  wm.specularColor = new Color3(0.4, 0.4, 0.4);
  wm.specularPower = 64;
  water.material = wm;
  water.isPickable = false;

  let shadows: ShadowGenerator | null = null;
  if (quality === 'high') {
    shadows = new ShadowGenerator(mobile ? 1024 : 2048, sun);
    shadows.bias = 0.0012;
    shadows.normalBias = 0.025;
    shadows.usePercentageCloserFiltering = true;
    shadows.filteringQuality = mobile ? ShadowGenerator.QUALITY_LOW : ShadowGenerator.QUALITY_MEDIUM;
    shadows.darkness = 0.28;
    sun.autoUpdateExtends = false;
    sun.autoCalcShadowZBounds = false;
    sun.shadowMinZ = 1;
    sun.shadowMaxZ = 160;
    sun.orthoLeft = -32;
    sun.orthoRight = 32;
    sun.orthoTop = 32;
    sun.orthoBottom = -32;
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
