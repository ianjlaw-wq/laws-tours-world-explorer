import { Scene } from '@babylonjs/core/scene';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Material } from '@babylonjs/core/Materials/material';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CustomMaterial } from '@babylonjs/materials/custom/customMaterial';

// Photo textures are CC0 from Poly Haven (see public/textures/LICENSE.md).
// Custom shader snippets are injected into Babylon's standard material so lighting,
// shadows and fog keep working.

const cache = new Map<string, Texture>();
export function tex(scene: Scene, name: string): Texture {
  let t = cache.get(name);
  if (!t) {
    t = new Texture(`${import.meta.env.BASE_URL}textures/${name}.webp`, scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
    t.wrapU = Texture.WRAP_ADDRESSMODE;
    t.wrapV = Texture.WRAP_ADDRESSMODE;
    t.anisotropicFilteringLevel = 4;
    cache.set(name, t);
  }
  return t;
}

let time = 0;
const timed: Material[] = [];
export function setMaterialTime(t: number) {
  time = t;
}
function addTime(m: CustomMaterial) {
  m.AddUniform('uTime', 'float', 0);
  m.onBindObservable.add(() => m.getEffect()?.setFloat('uTime', time));
  timed.push(m);
}

/**
 * Natural ground: grass (two scales + macro variation), triplanar granite on steep faces,
 * forest canopy tint, trail dirt and distant snow. `splat` = per-vertex weights (r trail, g forest).
 */
export function groundMaterial(scene: Scene, name: string, useSplat: boolean): CustomMaterial {
  const m = new CustomMaterial(name, scene);
  m.specularColor = new Color3(0.03, 0.03, 0.03);
  m.AddUniform('grassTex', 'sampler2D', tex(scene, 'grass_diff'));
  m.AddUniform('meadowTex', 'sampler2D', tex(scene, 'meadow_diff'));
  m.AddUniform('cliffTex', 'sampler2D', tex(scene, 'cliff_diff'));
  m.AddUniform('trailTex', 'sampler2D', tex(scene, 'trail_diff'));
  if (useSplat) {
    m.AddAttribute('splat');
    m.Vertex_Definitions('attribute vec4 splat; varying vec4 vSplat;');
    m.Vertex_MainBegin('vSplat = splat;');
    m.Fragment_Definitions('varying vec4 vSplat;');
  } else {
    m.Fragment_Definitions('const vec4 vSplat = vec4(0.0);');
  }
  // 6 texture fetches per pixel (mobile budget).
  m.Fragment_Custom_Diffuse(`
    vec3 P = vPositionW;
    vec3 Ng = normalize(vNormalW);
    float dist = distance(vEyePosition.xyz, P);
    vec3 mac = texture2D(meadowTex, P.xz * 0.0031).rgb;      // macro variation (3 channels reused)
    float macro = dot(mac, vec3(0.333));
    vec3 g1 = texture2D(grassTex, P.xz * 0.19).rgb;
    vec3 meadow = texture2D(meadowTex, P.xz * 0.012).rgb;
    vec3 grass = mix(g1, meadow * 1.1, 0.25 + smoothstep(25.0, 200.0, dist) * 0.6);
    grass *= mix(vec3(0.74, 0.98, 0.58), vec3(1.04, 1.0, 0.74), smoothstep(0.3, 0.7, mac.r * 1.4 - 0.2));
    grass *= 0.82 + macro * 0.45;

    // biplanar granite on steep faces
    vec2 bw = pow(abs(Ng.xz), vec2(4.0));
    bw /= (bw.x + bw.y + 1e-4);
    vec3 cliff = texture2D(cliffTex, P.zy * 0.045).rgb * bw.x + texture2D(cliffTex, P.xy * 0.045).rgb * bw.y;
    float lum = dot(cliff, vec3(0.3, 0.59, 0.11));
    cliff = mix(vec3(lum) * vec3(0.98, 0.98, 1.0), cliff, 0.7);

    float slope = 1.0 - Ng.y;
    float rockW = smoothstep(0.45, 0.66, slope + (macro - 0.5) * 0.3);
    vec3 col = mix(grass, cliff, rockW);

    vec3 forest = mix(vec3(0.09, 0.19, 0.07), vec3(0.22, 0.35, 0.12), clamp(mac.g * 2.2 - 0.5, 0.0, 1.0));
    forest *= 0.7 + 0.6 * g1.g;
    col = mix(col, forest, vSplat.g * (1.0 - rockW * 0.75));

    vec3 dirt = texture2D(trailTex, P.xz * 0.3).rgb * vec3(1.0, 0.95, 0.88);
    col = mix(col, dirt, vSplat.r);

    float snow = smoothstep(640.0, 760.0, P.y + macro * 90.0) * smoothstep(0.3, 0.65, Ng.y);
    col = mix(col, cliff * 0.9, smoothstep(330.0, 540.0, P.y) * (1.0 - snow));
    col = mix(col, vec3(0.93, 0.95, 0.99), snow);
    baseColor.rgb = col;
  `);
  return m;
}

/** Granite masonry with per-block tint (vertex colours), normal map and moss on upward faces. */
export function stoneMaterial(scene: Scene, name: string, kind: 'wall_rough' | 'wall_fine', tint: Color3): CustomMaterial {
  const m = new CustomMaterial(name, scene);
  m.diffuseTexture = tex(scene, `${kind}_diff`);
  m.bumpTexture = tex(scene, `${kind}_nor`);
  m.bumpTexture.level = 0.9;
  m.diffuseColor = tint;
  m.specularColor = new Color3(0.06, 0.06, 0.06);
  m.specularPower = 24;
  m.AddUniform('mossTex', 'sampler2D', tex(scene, 'boulder_diff'));
  m.AddUniform('grassTex', 'sampler2D', tex(scene, 'grass_diff'));
  m.Fragment_Custom_Diffuse(`
    // pale grey granite: pull the photo texture towards neutral grey
    float sl = dot(baseColor.rgb, vec3(0.3, 0.59, 0.11));
    baseColor.rgb = mix(vec3(sl), baseColor.rgb, 0.45) * 1.08;
    vec3 Nm = normalize(vNormalW);
    float top = smoothstep(0.55, 0.9, Nm.y);
    vec3 P = vPositionW;
    vec3 moss = texture2D(mossTex, P.xz * 1.1).rgb * vec3(0.75, 0.95, 0.6);
    vec3 turf = texture2D(grassTex, P.xz * 0.3).rgb * vec3(0.9, 1.0, 0.8);
    float patchy = texture2D(mossTex, P.xz * 0.09).g;
    // wall tops: turf with mossy patches, a little stone showing through
    vec3 cap = mix(turf, moss, smoothstep(0.45, 0.7, patchy) * 0.6);
    baseColor.rgb = mix(baseColor.rgb, cap, top * 0.75);
    // weathering streaks and lichen on vertical faces
    float streak = texture2D(mossTex, vec2(P.x + P.z, P.y * 0.25) * 0.11).g;
    baseColor.rgb *= mix(0.82, 1.1, streak);
  `);
  return m;
}

export function boulderMaterial(scene: Scene): StandardMaterial {
  const m = new StandardMaterial('boulderMat', scene);
  m.diffuseTexture = tex(scene, 'boulder_diff');
  m.bumpTexture = tex(scene, 'boulder_nor');
  m.diffuseColor = new Color3(0.95, 0.95, 0.92);
  m.specularColor = new Color3(0.05, 0.05, 0.05);
  return m;
}

export function thatchMaterial(scene: Scene): StandardMaterial {
  const m = new StandardMaterial('thatchMat', scene);
  m.diffuseTexture = tex(scene, 'thatch_diff');
  m.bumpTexture = tex(scene, 'thatch_nor');
  m.diffuseColor = new Color3(1.05, 0.92, 0.72);
  m.specularColor = new Color3(0.02, 0.02, 0.02);
  return m;
}

/** Alpha-tested foliage/grass cards with gentle wind sway (height-weighted). */
export function foliageMaterial(scene: Scene, name: string, texture: Texture, sway: number): CustomMaterial {
  const m = new CustomMaterial(name, scene);
  m.diffuseTexture = texture;
  texture.hasAlpha = true;
  m.useAlphaFromDiffuseTexture = true; // required: alpha test runs on the computed alpha
  m.transparencyMode = Material.MATERIAL_ALPHATEST;
  m.alphaCutOff = 0.45;
  m.backFaceCulling = false;
  // normals are authored (up for grass, radial for crowns); don't flip them on back faces
  m.twoSidedLighting = false;
  m.specularColor = Color3.Black();
  addTime(m);
  m.Vertex_After_WorldPosComputed(`
    float h = max(0.0, position.y);
    float ph = worldPos.x * 0.17 + worldPos.z * 0.13;
    worldPos.x += sin(uTime * 1.6 + ph) * ${sway.toFixed(3)} * h;
    worldPos.z += cos(uTime * 1.3 + ph * 1.3) * ${(sway * 0.7).toFixed(3)} * h;
  `);
  return m;
}
