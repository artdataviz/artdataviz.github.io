// The baked globe's material: albedo, tangent-space normal and AO from the bake,
// lit here with the Blender scene's studio rig plus a world-fixed sun.
//
// The surface map is tangent-space in each texel's own frame (scripts/pack_bake.py):
// R and G are the normal's east and north components, B is ambient occlusion, and
// the outward component is recovered as sqrt(1 - x^2 - y^2). East and north are
// tiles.frame_basis's, rebuilt per fragment from the position: east = Y x up,
// north = up x east, in three's y-up axes (see geo.js).

export const VERTEX = /* glsl */ `
varying vec3 vWorld;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export const FRAGMENT = /* glsl */ `
uniform sampler2D colourMap;
uniform sampler2D surfaceMap;
uniform vec3 boardColour;
uniform vec3 keyDir, frontDir, rimDir, sunDir;      // world space, towards the light
uniform vec3 keyCol, frontCol, rimCol, sunCol;      // colour x energy
uniform vec3 ambient;                               // the room, occluded by AO
varying vec3 vWorld;
varying vec2 vUv;

// blender/paper.py's thin sheet: 75% Principled, 25% Translucent. The lit side
// reflects 75% of the diffuse and a broad white specular (roughness 0.74, IOR
// 1.5); light from behind comes through at 25%.
const float TRANSLUCENCY = 0.25;
const float SPECULAR = 0.05;
vec3 front = vec3(0.0), back = vec3(0.0);
void light(vec3 col, vec3 n, vec3 l) {
  float c = dot(n, l);
  front += col * max(c, 0.0);
  back += col * max(-c, 0.0);
}

void main() {
  vec3 up = normalize(vWorld);
  vec3 e = cross(vec3(0.0, 1.0, 0.0), up);
  vec3 east = dot(e, e) > 1e-12 ? normalize(e) : vec3(1.0, 0.0, 0.0);
  vec3 north = cross(up, east);
#ifdef USE_MAPS
  vec3 albedo = texture2D(colourMap, vUv).rgb;
  vec3 s = texture2D(surfaceMap, vUv).rgb;
  vec2 xy = s.rg * 2.0 - 1.0;
  float ao = s.b;
  vec3 n = normalize(xy.x * east + xy.y * north + sqrt(max(0.0, 1.0 - dot(xy, xy))) * up);
#else
  vec3 albedo = boardColour;
  float ao = 1.0;
  vec3 n = up;
#endif
  light(keyCol, n, keyDir); light(frontCol, n, frontDir);
  light(rimCol, n, rimDir); light(sunCol, n, sunDir);
  // AO darkens the room fully and the direct light by half: it is all the bake
  // keeps of the shadow between coil turns.
  float occ = mix(1.0, ao, 0.5);
  // The board between the coils is not paper: no sheet specular, nothing coming
  // through it. Lit as paper, its dark brown (linear luminance 0.017) drowned in
  // the white specular and showed as light grey. The darkest dye, crimson, is 0.063.
  float paper = smoothstep(0.02, 0.05, dot(albedo, vec3(0.2126, 0.7152, 0.0722)));
  float through = TRANSLUCENCY * paper;
  float spec = (1.0 - through) * SPECULAR * paper;
  vec3 direct = (albedo * ((1.0 - through) * front + through * back) + spec * front)
              * occ / 3.14159265;
  vec3 radiance = direct + ambient * ao * (albedo + spec);
  gl_FragColor = vec4(radiance, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
