/* ═══════════════════════════════════════════════════════════
   post.js — a small hand-rolled post chain. EffectComposer is
   an addon and we ship no addons, so this is the whole thing:

     scene → HDR target → bright pass → two blur levels
           → composite (bloom + ACES + grade + vignette
             + chromatic aberration + grain) → screen
   ═══════════════════════════════════════════════════════════ */
'use strict';

PP.Post = {
  enabled: true, ready: false,
  renderer: null, w: 0, h: 0, dpr: 1, time: 0,
  params: {
    exposure: 1.0, bloom: 0.6, threshold: 1.05, softKnee: 0.35,
    vignette: 0.55, grain: 0.022, aberration: 0.9, lift: 0.0, sat: 1.06,
    ao: 1.0, aoRadius: 16.0, fxaa: 1.0, contrast: 1.14, black: 0.012
  },
  ssao: true, fxaa: true,

  /* ── shared plumbing ─────────────────────────────────── */
  quad: null, ortho: null,

  vert: [
    'varying vec2 vUv;',
    'void main() {',
    '  vUv = uv;',
    '  gl_Position = vec4(position.xy, 0.0, 1.0);',
    '}'
  ].join('\n'),

  init: function (renderer) {
    this.renderer = renderer;
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadGeo = new THREE.PlaneGeometry(2, 2);
    this.quad = new THREE.Mesh(this.quadGeo, null);
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.quad);

    var type = THREE.HalfFloatType;
    try {
      var gl = renderer.getContext();
      if (!renderer.capabilities.isWebGL2 &&
          !gl.getExtension('OES_texture_half_float')) type = THREE.UnsignedByteType;
    } catch (e) { type = THREE.UnsignedByteType; }
    this.type = type;

    this.matBright = this.shader({
      tDiffuse: { value: null }, threshold: { value: 0.75 }, knee: { value: 0.4 }
    }, [
      'uniform sampler2D tDiffuse; uniform float threshold; uniform float knee;',
      'varying vec2 vUv;',
      'void main() {',
      '  vec3 c = texture2D(tDiffuse, vUv).rgb;',
      '  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));',
      // soft knee so the bloom ramps in rather than clipping on
      '  float soft = clamp(l - threshold + knee, 0.0, 2.0 * knee);',
      '  soft = soft * soft / (4.0 * knee + 0.0001);',
      '  float w = max(soft, l - threshold) / max(l, 0.0001);',
      '  gl_FragColor = vec4(c * w, 1.0);',
      '}'
    ].join('\n'));

    this.matBlur = this.shader({
      tDiffuse: { value: null }, dir: { value: new THREE.Vector2(1, 0) },
      texel: { value: new THREE.Vector2(1, 1) }
    }, [
      'uniform sampler2D tDiffuse; uniform vec2 dir; uniform vec2 texel;',
      'varying vec2 vUv;',
      'void main() {',
      // 9-tap gaussian, separable
      '  vec3 sum = texture2D(tDiffuse, vUv).rgb * 0.227027;',
      '  vec2 o1 = dir * texel * 1.3846153846;',
      '  vec2 o2 = dir * texel * 3.2307692308;',
      '  sum += (texture2D(tDiffuse, vUv + o1).rgb + texture2D(tDiffuse, vUv - o1).rgb) * 0.3162162162;',
      '  sum += (texture2D(tDiffuse, vUv + o2).rgb + texture2D(tDiffuse, vUv - o2).rgb) * 0.0702702703;',
      '  gl_FragColor = vec4(sum, 1.0);',
      '}'
    ].join('\n'));

    /* ── SSAO: hemisphere sampling with normals reconstructed from depth ── */
    var KERNEL = 12, kern = [];
    var rnd = PP.rng(7);
    for (var i = 0; i < KERNEL; i++) {
      var v = new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd());
      v.normalize().multiplyScalar(0.35 + 0.65 * Math.pow((i + 1) / KERNEL, 2));
      kern.push(v);
    }
    this.matAO = this.shader({
      tDepth: { value: null }, invProj: { value: new THREE.Matrix4() },
      proj: { value: new THREE.Matrix4() },
      near: { value: 1 }, far: { value: 3000 },
      radius: { value: 26 }, strength: { value: 1.0 },
      texel: { value: new THREE.Vector2(1, 1) }, kernel: { value: kern }
    }, [
      '#define KERNEL ' + KERNEL,
      'uniform sampler2D tDepth; uniform mat4 invProj; uniform mat4 proj;',
      'uniform float near; uniform float far; uniform float radius; uniform float strength;',
      'uniform vec2 texel; uniform vec3 kernel[KERNEL];',
      'varying vec2 vUv;',

      'float rawDepth(vec2 uv) { return texture2D(tDepth, uv).x; }',
      'vec3 viewPos(vec2 uv, float d) {',
      '  vec4 clip = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);',
      '  vec4 v = invProj * clip;',
      '  return v.xyz / v.w;',
      '}',
      'float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }',

      'void main() {',
      '  float d = rawDepth(vUv);',
      '  if (d >= 0.9999) { gl_FragColor = vec4(1.0); return; }',   // sky / nothing
      '  vec3 P = viewPos(vUv, d);',
      // normals from the depth derivative — no extra geometry pass needed
      '  vec3 N = normalize(cross(dFdx(P), dFdy(P)));',
      '  float ang = hash(vUv * 1024.0) * 6.2831853;',
      '  vec3 rv = vec3(cos(ang), sin(ang), 0.0);',
      '  vec3 T = normalize(rv - N * dot(rv, N));',
      '  vec3 B = cross(N, T);',
      '  mat3 TBN = mat3(T, B, N);',
      '  float occ = 0.0;',
      '  for (int i = 0; i < KERNEL; i++) {',
      '    vec3 sp = P + (TBN * kernel[i]) * radius;',
      '    vec4 off = proj * vec4(sp, 1.0);',
      '    off.xyz /= off.w;',
      '    vec2 suv = off.xy * 0.5 + 0.5;',
      '    if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) continue;',
      '    float sd = rawDepth(suv);',
      '    vec3 SP = viewPos(suv, sd);',
      // -Z is forward in view space, so a nearer surface has a larger z
      '    float rangeFade = smoothstep(0.0, 1.0, radius / max(0.001, abs(P.z - SP.z)));',
      '    occ += (SP.z >= sp.z + 0.6 ? 1.0 : 0.0) * rangeFade;',
      '  }',
      '  float ao = 1.0 - (occ / float(KERNEL)) * strength;',
      '  gl_FragColor = vec4(clamp(ao, 0.0, 1.0));',
      '}'
    ].join('\n'));

    // a small cross blur, so the AO does not read as noise
    this.matAOBlur = this.shader({
      tDiffuse: { value: null }, texel: { value: new THREE.Vector2(1, 1) }
    }, [
      'uniform sampler2D tDiffuse; uniform vec2 texel;',
      'varying vec2 vUv;',
      'void main() {',
      '  float sum = 0.0;',
      '  for (int x = -2; x <= 2; x++) {',
      '    for (int y = -2; y <= 2; y++) {',
      '      sum += texture2D(tDiffuse, vUv + vec2(float(x), float(y)) * texel).r;',
      '    }',
      '  }',
      '  gl_FragColor = vec4(sum / 25.0);',
      '}'
    ].join('\n'));

    /* ── FXAA, because rendering through a target loses the MSAA buffer ── */
    this.matFxaa = this.shader({
      tDiffuse: { value: null }, texel: { value: new THREE.Vector2(1, 1) }
    }, [
      'uniform sampler2D tDiffuse; uniform vec2 texel;',
      'varying vec2 vUv;',
      'float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }',
      'void main() {',
      '  vec3 rgbM = texture2D(tDiffuse, vUv).rgb;',
      '  float lNW = lum(texture2D(tDiffuse, vUv + vec2(-1.0, -1.0) * texel).rgb);',
      '  float lNE = lum(texture2D(tDiffuse, vUv + vec2( 1.0, -1.0) * texel).rgb);',
      '  float lSW = lum(texture2D(tDiffuse, vUv + vec2(-1.0,  1.0) * texel).rgb);',
      '  float lSE = lum(texture2D(tDiffuse, vUv + vec2( 1.0,  1.0) * texel).rgb);',
      '  float lM  = lum(rgbM);',
      '  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));',
      '  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));',
      '  if (lMax - lMin < max(0.05, lMax * 0.125)) { gl_FragColor = vec4(rgbM, 1.0); return; }',
      '  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), ((lNW + lSW) - (lNE + lSE)));',
      '  float scale = 1.0 / (min(abs(dir.x), abs(dir.y)) + ',
      '                       max((lNW + lNE + lSW + lSE) * 0.03125, 0.0078125));',
      '  dir = clamp(dir * scale, -8.0, 8.0) * texel;',
      '  vec3 a = 0.5 * (texture2D(tDiffuse, vUv + dir * (1.0 / 3.0 - 0.5)).rgb +',
      '                  texture2D(tDiffuse, vUv + dir * (2.0 / 3.0 - 0.5)).rgb);',
      '  vec3 b = a * 0.5 + 0.25 * (texture2D(tDiffuse, vUv - dir * 0.5).rgb +',
      '                             texture2D(tDiffuse, vUv + dir * 0.5).rgb);',
      '  float lB = lum(b);',
      '  gl_FragColor = vec4((lB < lMin || lB > lMax) ? a : b, 1.0);',
      '}'
    ].join('\n'));

    this.matComposite = this.shader({
      tDiffuse: { value: null }, tBloomA: { value: null }, tBloomB: { value: null },
      tAO: { value: null }, aoAmount: { value: 1.0 },
      exposure: { value: 1.0 }, bloom: { value: 0.85 },
      vignette: { value: 0.55 }, grain: { value: 0.055 },
      aberration: { value: 0.9 }, sat: { value: 1.06 },
      contrast: { value: 1.14 }, black: { value: 0.012 },
      fear: { value: 0.0 }, time: { value: 0.0 }, texel: { value: new THREE.Vector2(1, 1) }
    }, [
      'uniform sampler2D tDiffuse; uniform sampler2D tBloomA; uniform sampler2D tBloomB;',
      'uniform sampler2D tAO; uniform float aoAmount;',
      'uniform float exposure; uniform float bloom; uniform float vignette;',
      'uniform float grain; uniform float aberration; uniform float sat;',
      'uniform float contrast; uniform float black;',
      'uniform float fear; uniform float time; uniform vec2 texel;',
      'varying vec2 vUv;',

      // Narkowicz ACES fit — cheap and close enough to the real curve
      'vec3 aces(vec3 x) {',
      '  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);',
      '}',
      'float hash(vec2 p) {',
      '  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);',
      '}',

      'void main() {',
      '  vec2 uv = vUv;',
      '  vec2 c = uv - 0.5;',
      '  float r2 = dot(c, c);',
      // lens dispersion, stronger toward the edges and when frightened
      '  float ab = aberration * (0.0016 + fear * 0.0042) * r2;',
      '  vec3 col;',
      '  col.r = texture2D(tDiffuse, uv + c * ab).r;',
      '  col.g = texture2D(tDiffuse, uv).g;',
      '  col.b = texture2D(tDiffuse, uv - c * ab).b;',

      // ambient occlusion darkens the lit image before anything is added to it
      '  float ao = mix(1.0, texture2D(tAO, uv).r, aoAmount);',
      '  col *= ao;',
      '  vec3 bl = texture2D(tBloomA, uv).rgb * 0.62 + texture2D(tBloomB, uv).rgb * 0.38;',
      '  col += bl * bloom;',

      '  col *= exposure;',
      '  col = aces(col);',

      // grade: cool the shadows, warm the highlights, then trim saturation
      '  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));',
      '  vec3 shadowTint = vec3(0.88, 0.94, 1.10);',
      '  vec3 highTint   = vec3(1.06, 1.01, 0.94);',
      '  col *= mix(shadowTint, highTint, smoothstep(0.15, 0.8, lum));',
      '  col = mix(vec3(lum), col, sat);',
      // an S-curve and a slightly crushed black point, the way a graded frame sits
      '  col = clamp((col - 0.5) * contrast + 0.5, 0.0, 1.0);',
      '  col = max(col - black, 0.0) / (1.0 - black);',

      // fear pushes the whole frame red and desaturated at the edges
      '  col = mix(col, vec3(lum * 1.25, lum * 0.30, lum * 0.34), fear * 0.55 * smoothstep(0.05, 0.5, r2));',

      '  float v = smoothstep(0.85, 0.18, r2 * (1.0 + fear * 0.7));',
      '  col *= mix(1.0 - vignette, 1.0, v);',

      '  float g = hash(uv * 1024.0 + fract(time) * 91.0) - 0.5;',
      '  col += g * grain * (0.55 + 0.45 * (1.0 - lum));',

      '  col = max(col, 0.0);',
      '  gl_FragColor = vec4(pow(col, vec3(0.4545454545)), 1.0);',   // linear → sRGB
      '}'
    ].join('\n'));

    this.ready = true;
  },

  shader: function (uniforms, frag) {
    return new THREE.ShaderMaterial({
      uniforms: uniforms, vertexShader: this.vert, fragmentShader: frag,
      depthTest: false, depthWrite: false
    });
  },

  target: function (w, h, depth) {
    return new THREE.WebGLRenderTarget(Math.max(2, Math.floor(w)), Math.max(2, Math.floor(h)), {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat, type: this.type,
      encoding: THREE.LinearEncoding,
      depthBuffer: !!depth, stencilBuffer: false
    });
  },

  resize: function (w, h, dpr) {
    if (!this.ready) return;
    this.w = w; this.h = h; this.dpr = dpr;
    var W = Math.floor(w * dpr), H = Math.floor(h * dpr);
    var self = this;
    [this.rtScene, this.rtA, this.rtB, this.rtC, this.rtD,
     this.rtAO, this.rtAO2, this.rtLDR].forEach(function (rt) {
      if (rt) rt.dispose();
    });
    this.rtScene = this.target(W, H, true);   // colour + a depth texture for SSAO
    this.rtScene.texture.name = 'scene';
    var dt = new THREE.DepthTexture(Math.floor(W), Math.floor(H));
    dt.format = THREE.DepthFormat;
    dt.type = THREE.UnsignedIntType;
    dt.minFilter = dt.magFilter = THREE.NearestFilter;
    this.rtScene.depthTexture = dt;

    this.rtA = this.target(W / 2, H / 2);
    this.rtB = this.target(W / 2, H / 2);
    this.rtC = this.target(W / 4, H / 4);
    this.rtD = this.target(W / 4, H / 4);
    this.rtAO = this.target(W / 2, H / 2);
    this.rtAO2 = this.target(W / 2, H / 2);
    this.rtLDR = this.target(W, H);
  },

  pass: function (material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target || null);
    this.renderer.render(this.quadScene, this.ortho);
  },

  blur: function (src, tmp, dst, radius) {
    var t = this.matBlur.uniforms;
    t.texel.value.set(radius / src.width, radius / src.height);
    t.tDiffuse.value = src.texture;
    t.dir.value.set(1, 0);
    this.pass(this.matBlur, tmp);
    t.tDiffuse.value = tmp.texture;
    t.dir.value.set(0, 1);
    this.pass(this.matBlur, dst);
  },

  /** Full chain. Falls back to a plain render when disabled. */
  render: function (scene, camera, dt, fear) {
    if (camera) camera.updateProjectionMatrix();
    var r = this.renderer;
    this.time += dt || 0;

    if (!this.enabled || !this.ready || !this.rtScene) {
      r.toneMapping = THREE.ACESFilmicToneMapping;
      r.toneMappingExposure = this.params.exposure;
      r.outputEncoding = THREE.sRGBEncoding;
      r.setRenderTarget(null);
      r.render(scene, camera);
      return;
    }

    // 1. scene into a linear HDR buffer — tone mapping happens in the composite
    var prevTone = r.toneMapping, prevEnc = r.outputEncoding;
    r.toneMapping = THREE.NoToneMapping;
    r.outputEncoding = THREE.LinearEncoding;
    r.setRenderTarget(this.rtScene);
    r.clear();
    r.render(scene, camera);

    // 2. ambient occlusion from the depth buffer, at half res, then blurred
    var p0 = this.params;
    if (this.ssao && p0.ao > 0) {
      var au = this.matAO.uniforms;
      au.tDepth.value = this.rtScene.depthTexture;
      au.invProj.value.copy(camera.projectionMatrixInverse);
      au.proj.value.copy(camera.projectionMatrix);
      au.near.value = camera.near; au.far.value = camera.far;
      au.radius.value = p0.aoRadius;
      au.strength.value = 1.0;
      au.texel.value.set(1 / this.rtAO.width, 1 / this.rtAO.height);
      this.pass(this.matAO, this.rtAO);
      this.matAOBlur.uniforms.tDiffuse.value = this.rtAO.texture;
      this.matAOBlur.uniforms.texel.value.set(1 / this.rtAO.width, 1 / this.rtAO.height);
      this.pass(this.matAOBlur, this.rtAO2);
    }

    // 3. bright pass at half res
    this.matBright.uniforms.tDiffuse.value = this.rtScene.texture;
    this.matBright.uniforms.threshold.value = this.params.threshold;
    this.matBright.uniforms.knee.value = this.params.softKnee;
    this.pass(this.matBright, this.rtA);

    // 4. two blur levels — a tight halo and a wide glow
    this.blur(this.rtA, this.rtB, this.rtA, 1.0);
    this.matBlur.uniforms.tDiffuse.value = this.rtA.texture;
    this.matBlur.uniforms.dir.value.set(1, 0);
    this.matBlur.uniforms.texel.value.set(1 / this.rtA.width, 1 / this.rtA.height);
    this.pass(this.matBlur, this.rtC);
    this.blur(this.rtC, this.rtD, this.rtC, 2.0);

    // 5. composite, then anti-alias on the way out
    var u = this.matComposite.uniforms, p = this.params;
    u.tDiffuse.value = this.rtScene.texture;
    u.tBloomA.value = this.rtA.texture;
    u.tBloomB.value = this.rtC.texture;
    u.tAO.value = this.rtAO2.texture;
    u.aoAmount.value = (this.ssao ? p.ao : 0);
    u.exposure.value = p.exposure;
    u.bloom.value = p.bloom;
    u.vignette.value = p.vignette;
    u.grain.value = p.grain;
    u.aberration.value = p.aberration;
    u.sat.value = p.sat;
    u.contrast.value = p.contrast;
    u.black.value = p.black;
    u.fear.value = fear || 0;
    u.time.value = this.time;
    r.toneMapping = THREE.NoToneMapping;
    r.outputEncoding = THREE.LinearEncoding;   // the shaders encode sRGB themselves
    if (this.fxaa && p.fxaa > 0) {
      this.pass(this.matComposite, this.rtLDR);
      this.matFxaa.uniforms.tDiffuse.value = this.rtLDR.texture;
      this.matFxaa.uniforms.texel.value.set(1 / this.rtLDR.width, 1 / this.rtLDR.height);
      this.pass(this.matFxaa, null);
    } else {
      this.pass(this.matComposite, null);
    }

    r.toneMapping = prevTone;
    r.outputEncoding = prevEnc;
  }
};
