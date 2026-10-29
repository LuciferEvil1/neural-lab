'use strict';
/* ════════════════════════════════════════════════════════════════
   Neural Lab v68 — TERRARIUM TAB (UI layer).
   The Dish, rebuilt as an observatory inside Neural Lab:
   ONE bot, the full trinity brain (terrarium-core.js), an open
   3D terrarium, the Brain tab's live node view merged in as an
   overlay, Gamepad API control, and a mod menu that adds things
   to the world (persisted to localStorage).
   All sim logic lives in NL_TERCORE — this file is eyes + hands.

   v68 — GRAPHICS PUSH: blood-red moon + starfield at night,
   drifting fireflies, bot core pulse. SANDBOX PHYSICS PASS:
   throwable orbs (tap 🪀 Throw orb, tap ground — the bot throws
   it), bot↔prop collision.
   v69 — GRAPHICS: drifting CLOUD layer (warm at dawn/dusk, dark
   red-rimmed under the blood moon), dynamic sun/moon SHADOWS,
   pond ripple rings + specular glint + splash/float feedback,
   instanced grass + flowers, daytime pollen motes, dawn/dusk
   horizon band. All counts/shadow size scale by substrate tier.
   PHYSICS (core v69): velocity locomotion, slide, pushes,
   gravity, floating orbs — bot walk/head/core read the physics.
   ════════════════════════════════════════════════════════════════ */
window.NL_TER = (function () {
  var C = window.NL_TERCORE;
  var $ = function (id) { return document.getElementById(id); };
  var inited = false, active = false, paused = false, simSpeed = 1;
  var renderer, scene, camera, sunLight, hemiLight, botLight;
  var worldGroup, propMeshes = {}, gravityMeshes = [];
  var botGrp, botParts = {}, coreMat, ringMesh, nameSprite;
  var brain = null, world = null, modStore = null;
  var orbit = { target: null, radius: 26, theta: 0.8, phi: 1.0 };
  var followBot = false;
  var selectedPropId = null, placeMode = null, moveModeId = null;
  var bursts = [];
  var padState = { prev: [] };
  var lastHudUpdate = 0, lastPanelUpdate = 0, clockT = 0;
  var eventLines = [];
  var flashCore = null, flashT = 0; // {color, t} — core glow flashes on lifecycle events
  /* v69 graphics state */
  var GFX = { tier: 1, shadow: 1024, clouds: 11, grass: 450, motes: 36, flies: 46, pr: 2 };
  var cloudSprites = [], cloudTex = null;
  var ripples = [], rippleTimer = 0, waterMat = null, glintMesh = null;
  var motePts = null, moteMat = null, moteBase = null;
  var horizonGlow = null;
  var headYaw = 0, prevBotSpeed = 0;
  var seenSplash = {};
  var _q = null, _axis = null; // spin quaternion scratch (lazy THREE)

  /* ---------- small helpers ---------- */
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function fmtT(s) { s = Math.floor(s); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
  // visual ground height == physics ground: ONE definition in core
  var POND = C.POND || { x: -5.2, z: 4.2, r: 3.6, waterY: -0.12 };
  function visH(x, z) {
    if (C.groundVis) return C.groundVis(x, z);
    var h = C.groundH(x, z);
    var d = Math.hypot(x - POND.x, z - POND.z);
    if (d < POND.r + 1.6) {
      var t = Math.max(0, (d - (POND.r - 0.6)) / 2.2);
      h = h * (0.25 + 0.75 * t) - (1 - t) * 0.5;
    }
    return h;
  }
  /* v69 — graphics budget from the substrate probe: weak hosts lose
   * shadows entirely; the phone tier keeps 1024 shadows so the A17
   * frame cost stays at/under control; strong hosts get 2048. */
  function gfxTier(sub) {
    var c = sub.ceilingParams;
    if (c < 24000) return { tier: 0, shadow: 0, clouds: 7, grass: 220, motes: 0, flies: 26, pr: 1.5 };
    if (c < 150000) return { tier: 1, shadow: 1024, clouds: 11, grass: 450, motes: 36, flies: 46, pr: 2 };
    return { tier: 2, shadow: 2048, clouds: 16, grass: 800, motes: 64, flies: 46, pr: 2 };
  }
  function dayFactors(phase) {
    // phase 0..1; 0.25=noon-ish peak, night around 0.75
    var sunA = Math.sin(phase * Math.PI * 2 - Math.PI / 2); // -1..1
    var day = Math.max(0, Math.min(1, sunA * 0.5 + 0.62));
    return { sunA: sunA, day: day };
  }

  /* ---------- init ---------- */
  function init() {
    if (inited) return;
    inited = true;
    var stage = $('ter-stage');
    if (!window.THREE || !C) {
      stage.innerHTML = '<div class="dsinfo" style="padding:16px">Terrarium failed to load (three.js / core missing).</div>';
      return;
    }
    // — brain + world, on THIS host (substrate probe with real signals) —
    var substrate = C.probeSubstrate({});
    GFX = gfxTier(substrate);
    brain = new C.TrinityBrain({ substrate: substrate });
    var storage = null;
    try { storage = window.localStorage; } catch (e) {}
    modStore = C.createModStore(storage);
    var rng = C.mulberry32(20261020);
    var props = modStore.load(C.defaultProps(rng));
    world = new C.TerWorld({ brain: brain, rng: C.mulberry32(777), props: props });

    // — three setup —
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, GFX.pr));
    if (GFX.shadow > 0) { // v69 — dynamic shadows, sized by tier
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = GFX.tier >= 2 ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    }
    stage.appendChild(renderer.domElement);
    renderer.domElement.id = 'ter-canvas';
    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x9fc8e8, 30, 95);
    camera = new THREE.PerspectiveCamera(55, 1, 0.1, 300);
    orbit.target = new THREE.Vector3(0, 0.6, 0);
    hemiLight = new THREE.HemisphereLight(0xbfd9ff, 0x3a5f2f, 0.9);
    scene.add(hemiLight);
    sunLight = new THREE.DirectionalLight(0xfff2d0, 1.6);
    if (GFX.shadow > 0) {
      sunLight.castShadow = true;
      sunLight.shadow.mapSize.set(GFX.shadow, GFX.shadow);
      sunLight.shadow.camera.left = -24; sunLight.shadow.camera.right = 24;
      sunLight.shadow.camera.top = 24; sunLight.shadow.camera.bottom = -24;
      sunLight.shadow.camera.near = 1; sunLight.shadow.camera.far = 160;
      sunLight.shadow.bias = -0.0006;
    }
    scene.add(sunLight);
    botLight = new THREE.PointLight(0x40e0ff, 12, 9, 1.8);
    scene.add(botLight);
    worldGroup = new THREE.Group();
    scene.add(worldGroup);
    buildTerrain();
    buildWater();
    buildBot();
    buildNightSky();   // v68 — blood-red moon + stars
    buildFireflies();  // v68 — drifting fireflies
    buildClouds();     // v69 — drifting cloud layer
    buildHorizonGlow();// v69 — dawn/dusk warm band
    buildGrass();      // v69 — instanced grass tufts + flower heads
    buildMotes();      // v69 — daytime pollen / dust motes
    props.forEach(function (p) { addPropMesh(p); });
    syncGravityMeshes();
    wireInput();
    wirePanels();
    resize();
    window.addEventListener('resize', resize);
    pushEvent('system', '🌍 terrarium online — one bot, full trinity brain, host: ' + substrate.profile +
      ' · gfx tier ' + GFX.tier + ' (shadows ' + (GFX.shadow ? GFX.shadow + 'px' : 'off') + ', clouds ' + GFX.clouds + ', grass ' + GFX.grass + ')');
    requestAnimationFrame(frame);
  }

  function buildTerrain() {
    var geo = new THREE.CircleGeometry(C.WORLD_R + 6, 72, 0, Math.PI * 2);
    geo.rotateX(-Math.PI / 2);
    var pos = geo.attributes.position;
    var colors = [];
    var cA = new THREE.Color(0x4d8f3f), cB = new THREE.Color(0x79b657), cSand = new THREE.Color(0xc2b280), tmp = new THREE.Color();
    for (var i = 0; i < pos.count; i++) {
      var x = pos.getX(i), z = pos.getZ(i);
      var h = visH(x, z);
      pos.setY(i, h);
      var dPond = Math.hypot(x - POND.x, z - POND.z);
      tmp.copy(cA).lerp(cB, Math.max(0, Math.min(1, h * 0.9 + 0.45)));
      if (dPond < POND.r + 0.9) tmp.lerp(cSand, 0.65);
      var r = Math.hypot(x, z);
      if (r > C.WORLD_R + 2) tmp.lerp(new THREE.Color(0x2c5d33), Math.min(1, (r - C.WORLD_R - 2) / 4));
      colors.push(tmp.r, tmp.g, tmp.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    var mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    var terrainMesh = new THREE.Mesh(geo, mat);
    terrainMesh.receiveShadow = true;
    worldGroup.add(terrainMesh);
    // rim ring so the dish edge reads
    var rim = new THREE.Mesh(
      new THREE.TorusGeometry(C.WORLD_R + 0.15, 0.14, 8, 72),
      new THREE.MeshStandardMaterial({ color: 0x8a97a5, roughness: 0.5, metalness: 0.6 }));
    rim.rotation.x = Math.PI / 2; rim.position.y = 0.12;
    worldGroup.add(rim);
  }
  function buildWater() {
    waterMat = new THREE.MeshStandardMaterial({ color: 0x2f8fd0, transparent: true, opacity: 0.78, roughness: 0.15, metalness: 0.1 });
    var w = new THREE.Mesh(new THREE.CircleGeometry(POND.r, 40), waterMat);
    w.rotation.x = -Math.PI / 2;
    w.position.set(POND.x, POND.waterY, POND.z);
    w.name = 'ter-water';
    w.receiveShadow = GFX.shadow > 0;
    worldGroup.add(w);
    // v69 — fake specular glint: a soft bright patch that wanders the pond
    glintMesh = new THREE.Mesh(new THREE.CircleGeometry(1.15, 20),
      new THREE.MeshBasicMaterial({ color: 0xeaf7ff, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending }));
    glintMesh.rotation.x = -Math.PI / 2;
    glintMesh.position.set(POND.x, POND.waterY + 0.015, POND.z);
    worldGroup.add(glintMesh);
  }
  /* v69 — expanding ripple rings on the pond (ambient + splashes) */
  var rippleGeo = null, rippleMatBase = null;
  function spawnRipple(x, z, big) {
    if (!rippleGeo) {
      rippleGeo = new THREE.RingGeometry(0.82, 1.0, 26);
      rippleMatBase = new THREE.MeshBasicMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide });
    }
    var r = null;
    for (var i = 0; i < ripples.length; i++) if (!ripples[i].mesh.visible) { r = ripples[i]; break; }
    if (!r) {
      if (ripples.length >= 10) return;
      var m = new THREE.Mesh(rippleGeo, rippleMatBase.clone());
      m.rotation.x = -Math.PI / 2;
      worldGroup.add(m);
      r = { mesh: m, age: 0, big: 1 };
      ripples.push(r);
    }
    r.age = 0; r.big = big ? 1.7 : 1;
    r.mesh.position.set(x, POND.waterY + 0.02, z);
    r.mesh.visible = true;
  }
  function updateRipples(dt) {
    for (var i = 0; i < ripples.length; i++) {
      var r = ripples[i];
      if (!r.mesh.visible) continue;
      r.age += dt;
      var k = r.age / 1.6;
      if (k >= 1) { r.mesh.visible = false; continue; }
      var sc = (0.35 + r.age * 1.5) * r.big;
      r.mesh.scale.set(sc, sc, sc);
      r.mesh.material.opacity = 0.5 * (1 - k);
    }
    rippleTimer -= dt;
    if (rippleTimer <= 0) { // ambient ripple somewhere on the pond
      rippleTimer = 0.8 + Math.random() * 0.7;
      var a = Math.random() * 6.283, d = Math.random() * POND.r * 0.78;
      spawnRipple(POND.x + Math.cos(a) * d, POND.z + Math.sin(a) * d, false);
    }
  }

  /* ---------- v68: night sky — blood-red moon + starfield ---------- */
  var moonSprite = null, moonMat = null, starPts = null, starMat = null;
  function redMoonTexture() {
    var c = document.createElement('canvas'); c.width = c.height = 128;
    var x = c.getContext('2d');
    var g = x.createRadialGradient(64, 64, 8, 64, 64, 64);
    g.addColorStop(0, '#ff7a68');
    g.addColorStop(0.45, '#c62f26');
    g.addColorStop(0.8, '#5e0f0c');
    g.addColorStop(1, 'rgba(40,4,4,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    x.fillStyle = 'rgba(90,12,10,0.5)'; // crater blotches
    [[44, 50, 10], [80, 60, 14], [60, 84, 8], [86, 38, 6], [36, 78, 7]].forEach(function (b) {
      x.beginPath(); x.arc(b[0], b[1], b[2], 0, 6.2832); x.fill();
    });
    return new THREE.CanvasTexture(c);
  }
  function buildNightSky() {
    moonMat = new THREE.SpriteMaterial({ map: redMoonTexture(), transparent: true, opacity: 0, depthWrite: false, fog: false });
    moonSprite = new THREE.Sprite(moonMat);
    moonSprite.scale.set(24, 24, 1);
    moonSprite.position.set(-58, 38, -72);
    scene.add(moonSprite);
    var n = 320, posArr = new Float32Array(n * 3), r = 130, i, th, ph;
    for (i = 0; i < n; i++) {
      th = Math.random() * Math.PI * 2; ph = Math.random() * Math.PI * 0.48 + 0.02;
      posArr[i * 3] = r * Math.sin(ph) * Math.cos(th);
      posArr[i * 3 + 1] = r * Math.cos(ph);
      posArr[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    }
    var sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    starMat = new THREE.PointsMaterial({ color: 0xdfe8ff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false });
    starPts = new THREE.Points(sg, starMat);
    scene.add(starPts);
  }
  /* ---------- v68: fireflies ---------- */
  var flyPts = null, flyMat = null, flyBase = null;
  function buildFireflies() {
    var n = GFX.flies || 46, i, a, d;
    flyBase = new Float32Array(n * 4); // x, z, phase, speed
    var posArr = new Float32Array(n * 3);
    for (i = 0; i < n; i++) {
      a = Math.random() * Math.PI * 2; d = 2 + Math.random() * 13;
      flyBase[i * 4] = Math.cos(a) * d; flyBase[i * 4 + 1] = Math.sin(a) * d;
      flyBase[i * 4 + 2] = Math.random() * Math.PI * 2; flyBase[i * 4 + 3] = 0.4 + Math.random() * 0.8;
      posArr[i * 3] = flyBase[i * 4]; posArr[i * 3 + 1] = 1.5; posArr[i * 3 + 2] = flyBase[i * 4 + 1];
    }
    var fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    flyMat = new THREE.PointsMaterial({ color: 0xb8ffc8, size: 0.22, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending });
    flyPts = new THREE.Points(fg, flyMat);
    scene.add(flyPts);
  }

  /* ---------- v69: clouds ---------- */
  function cloudTexture() {
    var c = document.createElement('canvas'); c.width = 256; c.height = 128;
    var x = c.getContext('2d');
    var puffs = [[70, 78, 42], [118, 66, 52], [168, 76, 44], [100, 86, 36], [145, 88, 34], [52, 88, 26], [196, 88, 28]];
    puffs.forEach(function (p) {
      var g = x.createRadialGradient(p[0], p[1], 4, p[0], p[1], p[2]);
      g.addColorStop(0, 'rgba(255,255,255,0.55)');
      g.addColorStop(0.7, 'rgba(255,255,255,0.28)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g;
      x.beginPath(); x.arc(p[0], p[1], p[2], 0, 6.2832); x.fill();
    });
    return new THREE.CanvasTexture(c);
  }
  function buildClouds() {
    cloudTex = cloudTexture();
    for (var i = 0; i < GFX.clouds; i++) {
      var mat = new THREE.SpriteMaterial({ map: cloudTex, transparent: true, opacity: 0.4 + Math.random() * 0.3, depthWrite: false, fog: false });
      var sp = new THREE.Sprite(mat);
      var a = Math.random() * Math.PI * 2, d = Math.random() * 115;
      sp.position.set(Math.cos(a) * d, 30 + Math.random() * 16, Math.sin(a) * d);
      sp.scale.set(20 + Math.random() * 24, 6.5 + Math.random() * 5, 1);
      sp.userData.speed = 0.35 + Math.random() * 0.55;
      scene.add(sp);
      cloudSprites.push(sp);
    }
  }
  /* ---------- v69: dawn/dusk horizon band ---------- */
  function buildHorizonGlow() {
    var c = document.createElement('canvas'); c.width = 128; c.height = 128;
    var x = c.getContext('2d');
    var g = x.createRadialGradient(64, 64, 4, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,170,90,0.85)');
    g.addColorStop(0.5, 'rgba(255,120,60,0.35)');
    g.addColorStop(1, 'rgba(255,100,50,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    var mat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, opacity: 0, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });
    horizonGlow = new THREE.Sprite(mat);
    horizonGlow.scale.set(110, 34, 1);
    scene.add(horizonGlow);
  }
  /* ---------- v69: instanced grass + flowers ---------- */
  function buildGrass() {
    var dummy = new THREE.Object3D();
    var col = new THREE.Color();
    var grass = new THREE.InstancedMesh(new THREE.ConeGeometry(0.055, 0.42, 5),
      new THREE.MeshStandardMaterial({ roughness: 1 }), GFX.grass);
    var placed = 0, guard = 0;
    while (placed < GFX.grass && guard++ < GFX.grass * 30) {
      var a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * (C.WORLD_R + 3);
      var x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (Math.hypot(x - POND.x, z - POND.z) < POND.r + 0.3) continue;
      dummy.position.set(x, visH(x, z) + 0.16, z);
      dummy.rotation.set((Math.random() - 0.5) * 0.35, Math.random() * 3.14, (Math.random() - 0.5) * 0.35);
      dummy.scale.setScalar(0.7 + Math.random() * 1.1);
      dummy.updateMatrix();
      grass.setMatrixAt(placed, dummy.matrix);
      col.setHSL(0.29 + Math.random() * 0.05, 0.5, 0.26 + Math.random() * 0.14);
      grass.setColorAt(placed, col);
      placed++;
    }
    grass.count = placed;
    grass.receiveShadow = GFX.shadow > 0;
    worldGroup.add(grass);
    var nF = Math.floor(GFX.grass / 6);
    var flowers = new THREE.InstancedMesh(new THREE.SphereGeometry(0.07, 6, 6),
      new THREE.MeshStandardMaterial({ roughness: 0.6, emissiveIntensity: 0.4 }), nF);
    var palette = [0xff8fc7, 0xffd24a, 0xffffff, 0xb78cff];
    placed = 0; guard = 0;
    while (placed < nF && guard++ < nF * 30) {
      var a2 = Math.random() * Math.PI * 2, d2 = Math.sqrt(Math.random()) * C.WORLD_R;
      var x2 = Math.cos(a2) * d2, z2 = Math.sin(a2) * d2;
      if (Math.hypot(x2 - POND.x, z2 - POND.z) < POND.r + 0.3) continue;
      dummy.position.set(x2, visH(x2, z2) + 0.3, z2);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(0.8 + Math.random() * 0.7);
      dummy.updateMatrix();
      flowers.setMatrixAt(placed, dummy.matrix);
      col.setHex(palette[(Math.random() * palette.length) | 0]);
      flowers.setColorAt(placed, col);
      placed++;
    }
    flowers.count = placed;
    worldGroup.add(flowers);
  }
  /* ---------- v69: daytime pollen / dust motes ---------- */
  function buildMotes() {
    if (!GFX.motes) return;
    var n = GFX.motes, i, a, d;
    moteBase = new Float32Array(n * 4);
    var posArr = new Float32Array(n * 3);
    for (i = 0; i < n; i++) {
      a = Math.random() * Math.PI * 2; d = 1 + Math.random() * 14;
      moteBase[i * 4] = Math.cos(a) * d; moteBase[i * 4 + 1] = Math.sin(a) * d;
      moteBase[i * 4 + 2] = Math.random() * Math.PI * 2; moteBase[i * 4 + 3] = 0.25 + Math.random() * 0.5;
      posArr[i * 3] = moteBase[i * 4]; posArr[i * 3 + 1] = 1.4; posArr[i * 3 + 2] = moteBase[i * 4 + 1];
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    moteMat = new THREE.PointsMaterial({ color: 0xfff2b0, size: 0.09, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending });
    motePts = new THREE.Points(g, moteMat);
    scene.add(motePts);
  }

  /* ---------- props ---------- */
  var GEO = null, MAT = null;
  function geos() {
    if (GEO) return GEO;
    GEO = {
      trunk: new THREE.CylinderGeometry(0.09, 0.14, 0.9, 7),
      cone: new THREE.ConeGeometry(0.75, 1.6, 8),
      coneS: new THREE.ConeGeometry(0.52, 1.2, 8),
      rock: new THREE.DodecahedronGeometry(0.55, 0),
      orb: new THREE.SphereGeometry(0.3, 18, 14),
      apple: new THREE.SphereGeometry(0.22, 12, 10),
      stem: new THREE.CylinderGeometry(0.03, 0.03, 0.22, 5),
      crystal: new THREE.OctahedronGeometry(0.5, 0),
      flowerTop: new THREE.SphereGeometry(0.13, 8, 8),
      wall: new THREE.BoxGeometry(1.7, 1.25, 0.6),
      zone: new THREE.CircleGeometry(1, 36)
    };
    MAT = {
      trunk: new THREE.MeshStandardMaterial({ color: 0x6e4f30, roughness: 0.9 }),
      leaf: new THREE.MeshStandardMaterial({ color: 0x2f7d3a, roughness: 0.85 }),
      pine: new THREE.MeshStandardMaterial({ color: 0x1f5f46, roughness: 0.85 }),
      rock: new THREE.MeshStandardMaterial({ color: 0x8d9299, roughness: 0.95, flatShading: true }),
      orb: new THREE.MeshStandardMaterial({ color: 0x66f6ff, emissive: 0x18b7c9, emissiveIntensity: 1.6, roughness: 0.2 }),
      apple: new THREE.MeshStandardMaterial({ color: 0xd8402e, roughness: 0.45 }),
      crystal: new THREE.MeshStandardMaterial({ color: 0xb78cff, emissive: 0x6a2fd0, emissiveIntensity: 0.9, roughness: 0.15, flatShading: true }),
      flower: new THREE.MeshStandardMaterial({ color: 0xff8fc7, emissive: 0x90305e, emissiveIntensity: 0.35, roughness: 0.6 }),
      wall: new THREE.MeshStandardMaterial({ color: 0x9a8d7a, roughness: 0.9 }),
      sludge: new THREE.MeshStandardMaterial({ color: 0x5e4a26, transparent: true, opacity: 0.55, roughness: 1 }),
      current: new THREE.MeshStandardMaterial({ color: 0x2f7fd0, transparent: true, opacity: 0.45, roughness: 0.4 })
    };
    return GEO;
  }
  function part(grp, geo, mat, x, y, z) {
    var m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    grp.add(m);
    return m;
  }
  function addPropMesh(p) {
    geos();
    var g = new THREE.Group();
    g.position.set(p.x, visH(p.x, p.z), p.z);
    var s = p.scale || 1;
    if (p.kind === 'tree') {
      part(g, GEO.trunk, MAT.trunk, 0, 0.45, 0);
      part(g, GEO.cone, MAT.leaf, 0, 1.55, 0);
      part(g, GEO.coneS, MAT.leaf, 0, 2.25, 0);
    } else if (p.kind === 'pine') {
      part(g, GEO.trunk, MAT.trunk, 0, 0.4, 0);
      part(g, GEO.cone, MAT.pine, 0, 1.3, 0);
      part(g, GEO.coneS, MAT.pine, 0, 2.0, 0);
      var t3 = part(g, GEO.coneS, MAT.pine, 0, 2.6, 0); t3.scale.setScalar(0.6);
    } else if (p.kind === 'rock') {
      var r = part(g, GEO.rock, MAT.rock, 0, 0.3, 0);
      r.rotation.set(p.x * 1.7, p.z * 2.3, 0.4);
    } else if (p.kind === 'orb') {
      var o = part(g, GEO.orb, MAT.orb, 0, 0.85, 0);
      o.name = 'float';
      part(g, GEO.stem, MAT.rock, 0, 0.2, 0);
    } else if (p.kind === 'food') {
      part(g, GEO.apple, MAT.apple, 0, 0.24, 0);
      part(g, GEO.stem, MAT.trunk, 0, 0.48, 0);
    } else if (p.kind === 'crystal') {
      var c = part(g, GEO.crystal, MAT.crystal, 0, 0.55, 0);
      c.name = 'float';
    } else if (p.kind === 'flower') {
      part(g, GEO.stem, MAT.leaf, 0, 0.16, 0);
      part(g, GEO.flowerTop, MAT.flower, 0, 0.36, 0);
      part(g, GEO.flowerTop, MAT.flower, 0.16, 0.28, 0.1).scale.setScalar(0.7);
    } else if (p.kind === 'wall') {
      var w = part(g, GEO.wall, MAT.wall, 0, 0.62, 0);
      w.rotation.y = (p.x + p.z) % 1.2;
    } else if (p.kind === 'zone-sludge' || p.kind === 'zone-current') {
      var z = part(g, GEO.zone, p.kind === 'zone-sludge' ? MAT.sludge : MAT.current, 0, 0.06, 0);
      z.rotation.x = -Math.PI / 2;
      z.scale.setScalar(p.radius || 3);
      z.name = p.kind === 'zone-current' ? 'spin' : '';
      g.position.y = visH(p.x, p.z) + 0.04;
    }
    if (GFX.shadow > 0 && ['tree', 'pine', 'rock', 'wall', 'crystal'].indexOf(p.kind) >= 0) {
      g.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    }
    g.scale.setScalar(s);
    g.userData.propId = p.id;
    worldGroup.add(g);
    propMeshes[p.id] = g;
    return g;
  }
  function removePropMesh(id) {
    var g = propMeshes[id];
    if (!g) return;
    worldGroup.remove(g);
    g.traverse(function (o) { /* shared geos/mats — do not dispose */ });
    delete propMeshes[id];
  }
  function syncGravityMeshes() {
    while (gravityMeshes.length < brain.gravity.length) {
      var grp = new THREE.Group();
      var core = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 12),
        new THREE.MeshBasicMaterial({ color: 0x05050c }));
      var ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.05, 8, 28),
        new THREE.MeshBasicMaterial({ color: 0x9a6bff, transparent: true, opacity: 0.85 }));
      ring.rotation.x = Math.PI / 2.4;
      grp.add(core); grp.add(ring);
      grp.userData.ring = ring;
      worldGroup.add(grp);
      gravityMeshes.push(grp);
    }
    for (var i = 0; i < gravityMeshes.length; i++) {
      var gp = brain.gravity[i], gm = gravityMeshes[i];
      if (!gp) { gm.visible = false; continue; }
      gm.visible = true;
      gm.position.set(gp.x, visH(gp.x, gp.z) + 0.75, gp.z);
      var sc = 0.7 + gp.strength * 0.45;
      gm.scale.setScalar(sc);
    }
  }

  /* ---------- v68: throwable orbs (sandbox physics bodies) ---------- */
  var throwMeshes = {}, throwGeo = null, throwMat = null, seenBounce = {};
  function throwAssets() {
    if (!throwGeo) {
      throwGeo = new THREE.SphereGeometry(0.18, 14, 10);
      throwMat = new THREE.MeshStandardMaterial({ color: 0xffb347, emissive: 0xd06a18, emissiveIntensity: 1.8, roughness: 0.3 });
    }
  }
  function syncThrowables(dt) {
    throwAssets();
    if (!_q) { _q = new THREE.Quaternion(); _axis = new THREE.Vector3(); }
    var alive = {};
    for (var i = 0; i < world.throwables.length; i++) {
      (function (t) {
        alive[t.id] = true;
        var m = throwMeshes[t.id];
        if (!m) {
          m = new THREE.Mesh(throwGeo, throwMat);
          if (GFX.shadow > 0) m.castShadow = true;
          scene.add(m);
          throwMeshes[t.id] = m;
          seenBounce[t.id] = 0;
          seenSplash[t.id] = 0;
        }
        // v69 — a floating orb bobs on the water
        var renderY = t.y + ((t.floating && t.rest) ? Math.sin(clockT * 2 + (t.bobPh || 0)) * 0.03 : 0);
        m.position.set(t.x, renderY, t.z);
        // v69 — true spin from physics (rolling / airborne)
        if (t.spin) {
          _axis.set(t.spinAx || 1, 0, t.spinAz || 0);
          _q.setFromAxisAngle(_axis, t.spin * Math.min(dt || 0.016, 0.05));
          m.quaternion.premultiply(_q);
        }
        if (t.evBounce > seenBounce[t.id]) {
          seenBounce[t.id] = t.evBounce;
          burst(t.x, t.y + 0.15, t.z, 0xffb347, 5); // dust puff on bounce
        }
        if (t.evSplash > (seenSplash[t.id] || 0)) {
          seenSplash[t.id] = t.evSplash;
          burst(t.x, POND.waterY + 0.25, t.z, 0xbfe8ff, 9); // splash droplets
          spawnRipple(t.x, t.z, true);
        }
      })(world.throwables[i]);
    }
    for (var id in throwMeshes) {
      if (!alive[id]) { scene.remove(throwMeshes[id]); delete throwMeshes[id]; delete seenBounce[id]; delete seenSplash[id]; }
    }
  }
  function throwAt(tx, tz) {
    // the bot throws an orb from its hands toward the tapped ground point
    var b = world.bot;
    var dx = tx - b.x, dz = tz - b.z;
    var dist = Math.hypot(dx, dz) || 1;
    var sp = Math.min(10, 4 + dist * 0.4);
    var t = world.spawnThrowable(b.x, 1.6, b.z, dx / dist * sp, 3.1 + dist * 0.09, dz / dist * sp);
    burst(b.x, 1.6, b.z, 0x40e0ff, 6);
    pushEvent('mod', '🪀 thrown toward (' + tx.toFixed(1) + ', ' + tz.toFixed(1) + ')');
    return t;
  }

  /* ---------- the bot (his humanoid) ---------- */
  function buildBot() {
    geos();
    botGrp = new THREE.Group();
    botGrp.rotation.order = 'YXZ'; // v69 — yaw, then slope pitch/roll
    var skin = new THREE.MeshStandardMaterial({ color: 0x8a5a3b, roughness: 0.7 });
    var cloth = new THREE.MeshStandardMaterial({ color: 0x14342e, roughness: 0.85 });
    var dark = new THREE.MeshStandardMaterial({ color: 0x1c1e26, roughness: 0.8 });
    function limb(geo, mat, x, y, z) {
      var holder = new THREE.Group();
      holder.position.set(x, y, z);
      var m = new THREE.Mesh(geo, mat);
      m.position.y = -geo.parameters.height / 2 + 0.05;
      holder.add(m);
      botGrp.add(holder);
      return holder;
    }
    var bodyGeo = new THREE.CapsuleGeometry(0.21, 0.42, 6, 12);
    var body = new THREE.Mesh(bodyGeo, cloth);
    body.position.y = 0.98;
    botGrp.add(body);
    coreMat = new THREE.MeshStandardMaterial({ color: 0x9ff6ff, emissive: 0x18b7c9, emissiveIntensity: 2.2 });
    var core = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 10), coreMat);
    core.position.set(0, 1.08, 0.19);
    botGrp.add(core);
    // v69 — head lives in its own group so it can turn toward the goal
    var headGrp = new THREE.Group();
    headGrp.position.y = 1.42;
    var head = new THREE.Mesh(new THREE.SphereGeometry(0.155, 16, 12), skin);
    head.position.y = 0.08;
    headGrp.add(head);
    var eyeMat = new THREE.MeshBasicMaterial({ color: 0xeafcff });
    [-0.055, 0.055].forEach(function (ex) {
      var e = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 8), eyeMat);
      e.position.set(ex, 0.11, 0.14);
      headGrp.add(e);
    });
    botGrp.add(headGrp);
    botParts.head = headGrp;
    botParts.armL = limb(new THREE.CapsuleGeometry(0.06, 0.34, 4, 8), cloth, -0.3, 1.28, 0);
    botParts.armR = limb(new THREE.CapsuleGeometry(0.06, 0.34, 4, 8), cloth, 0.3, 1.28, 0);
    botParts.legL = limb(new THREE.CapsuleGeometry(0.075, 0.36, 4, 8), dark, -0.11, 0.78, 0);
    botParts.legR = limb(new THREE.CapsuleGeometry(0.075, 0.36, 4, 8), dark, 0.11, 0.78, 0);
    ringMesh = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.44, 28),
      new THREE.MeshBasicMaterial({ color: 0x40e0ff, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
    ringMesh.rotation.x = -Math.PI / 2;
    ringMesh.position.y = 0.05;
    botGrp.add(ringMesh);
    if (GFX.shadow > 0) botGrp.traverse(function (o) { if (o.isMesh && o !== ringMesh) o.castShadow = true; });
    scene.add(botGrp);
  }
  function burst(x, y, z, color, n) {
    var geo = new THREE.SphereGeometry(0.05, 6, 6);
    var mat = new THREE.MeshBasicMaterial({ color: color, transparent: true });
    for (var i = 0; i < (n || 10); i++) {
      var m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.userData.v = new THREE.Vector3((Math.random() - 0.5) * 1.6, 1 + Math.random() * 1.4, (Math.random() - 0.5) * 1.6);
      m.userData.life = 1;
      scene.add(m);
      bursts.push(m);
    }
  }

  /* ---------- camera + input ---------- */
  function applyOrbit() {
    var t = orbit.target;
    camera.position.set(
      t.x + orbit.radius * Math.sin(orbit.phi) * Math.sin(orbit.theta),
      t.y + orbit.radius * Math.cos(orbit.phi),
      t.z + orbit.radius * Math.sin(orbit.phi) * Math.cos(orbit.theta));
    camera.lookAt(t);
  }
  function resize() {
    var stage = $('ter-stage');
    if (!stage || !renderer) return;
    var w = stage.clientWidth, h = stage.clientHeight;
    if (w < 40 || h < 40) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  var pointers = {}, pinchD0 = 0, pinchR0 = 0, downAt = 0, downPos = null, movedFar = false;
  function wireInput() {
    var cv = renderer.domElement;
    cv.style.touchAction = 'none';
    cv.addEventListener('pointerdown', function (ev) {
      pointers[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      if (Object.keys(pointers).length === 1) { downAt = performance.now(); downPos = { x: ev.clientX, y: ev.clientY }; movedFar = false; }
      if (Object.keys(pointers).length === 2) {
        var p = Object.values(pointers);
        pinchD0 = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y); pinchR0 = orbit.radius;
      }
      cv.setPointerCapture(ev.pointerId);
    });
    cv.addEventListener('pointermove', function (ev) {
      var pt = pointers[ev.pointerId];
      if (!pt) return;
      var dx = ev.clientX - pt.x, dy = ev.clientY - pt.y;
      pt.x = ev.clientX; pt.y = ev.clientY;
      if (downPos && Math.hypot(ev.clientX - downPos.x, ev.clientY - downPos.y) > 9) movedFar = true;
      var ids = Object.keys(pointers);
      if (ids.length === 1) {
        orbit.theta -= dx * 0.0055;
        orbit.phi = Math.min(1.45, Math.max(0.18, orbit.phi - dy * 0.0055));
      } else if (ids.length === 2) {
        var p = ids.map(function (id) { return pointers[id]; });
        var d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
        if (pinchD0 > 0) orbit.radius = Math.min(70, Math.max(8, pinchR0 * pinchD0 / Math.max(1, d)));
      }
    });
    function endPointer(ev) {
      var wasTap = performance.now() - downAt < 300 && !movedFar && Object.keys(pointers).length === 1;
      delete pointers[ev.pointerId];
      if (Object.keys(pointers).length < 2) pinchD0 = 0;
      if (wasTap) handleTap(ev.clientX, ev.clientY);
    }
    cv.addEventListener('pointerup', endPointer);
    cv.addEventListener('pointercancel', function (ev) { delete pointers[ev.pointerId]; pinchD0 = 0; });
    cv.addEventListener('wheel', function (ev) {
      ev.preventDefault();
      orbit.radius = Math.min(70, Math.max(8, orbit.radius * (1 + Math.sign(ev.deltaY) * 0.1)));
    }, { passive: false });
  }
  var raycaster = null;
  function groundPoint(cx, cy) {
    raycaster = raycaster || new THREE.Raycaster();
    var rect = renderer.domElement.getBoundingClientRect();
    var ndc = new THREE.Vector2(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    var plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    var pt = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(plane, pt)) {
      var r = Math.hypot(pt.x, pt.z);
      if (r > C.WORLD_R - 0.6) { pt.x *= (C.WORLD_R - 0.6) / r; pt.z *= (C.WORLD_R - 0.6) / r; }
      return pt;
    }
    return null;
  }
  function handleTap(cx, cy) {
    // mod flows first: placing or moving
    if (placeMode || moveModeId) {
      var pt = groundPoint(cx, cy);
      if (!pt) return;
      if (placeMode === 'throw') { // v68 — the bot throws an orb at the tapped spot
        throwAt(pt.x, pt.z);
        placeMode = null; markPlaceButtons();
        return;
      }
      if (placeMode) {
        var p = modStore.spawn(world.props, placeMode, pt.x, pt.z, Math.random);
        if (p) { addPropMesh(p); modStore.save(world.props); refreshModList(); pushEvent('mod', '🧩 added ' + C.MOD_KINDS[placeMode].label + ' — tap again to place another, or close add mode'); }
        placeMode = null; markPlaceButtons();
      } else if (moveModeId) {
        if (modStore.move(world.props, moveModeId, pt.x, pt.z)) {
          var g = propMeshes[moveModeId];
          if (g) g.position.set(pt.x, visH(pt.x, pt.z), pt.z);
          modStore.save(world.props); refreshModList();
          pushEvent('mod', '🧩 moved item');
        }
        moveModeId = null; markPlaceButtons();
      }
      return;
    }
    raycaster = raycaster || new THREE.Raycaster();
    var rect = renderer.domElement.getBoundingClientRect();
    var ndc = new THREE.Vector2(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    // bot?
    var hits = raycaster.intersectObject(botGrp, true);
    if (hits.length) { showPanel('thoughts'); updateThoughts(true); return; }
    // props?
    var groups = Object.values(propMeshes);
    hits = raycaster.intersectObjects(groups, true);
    if (hits.length) {
      var o = hits[0].object;
      while (o && !o.userData.propId) o = o.parent;
      if (o) { selectedPropId = o.userData.propId; showPanel('mod'); refreshModList(); }
    }
  }

  /* ---------- gamepad (called from app.js pollPad while this tab is active) ---------- */
  function padTick(gp) {
    if (!inited || !world) return;
    var m = C.mapPad(gp, padState);
    var ct = cameraDirectionGround();
    // left stick pans the camera focus in camera-relative ground directions
    if (m.pan.x || m.pan.y) {
      orbit.target.x += (ct.right.x * m.pan.x + ct.fwd.x * -m.pan.y) * 0.35;
      orbit.target.z += (ct.right.z * m.pan.x + ct.fwd.z * -m.pan.y) * 0.35;
      var r = Math.hypot(orbit.target.x, orbit.target.z);
      if (r > C.WORLD_R) { orbit.target.x *= C.WORLD_R / r; orbit.target.z *= C.WORLD_R / r; }
      followBot = false; markFollow();
    }
    if (m.orbit.x) orbit.theta -= m.orbit.x * 0.045;
    if (m.orbit.y) orbit.phi = Math.min(1.45, Math.max(0.18, orbit.phi + m.orbit.y * 0.045));
    if (m.zoom) orbit.radius = Math.min(70, Math.max(8, orbit.radius - m.zoom * 0.7));
    if (m.justPressed.interact) { followBot = true; markFollow(); showPanel('thoughts'); updateThoughts(true); }
    if (m.justPressed.brain) toggleBrainOverlay();
    if (m.justPressed.thoughts) showPanel('thoughts');
    if (m.justPressed.mod) showPanel('mod');
  }
  function cameraDirectionGround() {
    var fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
    var right = new THREE.Vector3(fwd.z, 0, -fwd.x);
    return { fwd: fwd, right: right };
  }
  function markFollow() { var b = $('ter-follow'); if (b) b.textContent = followBot ? '📷 Follow ✓' : '📷 Follow'; }

  /* ---------- panels ---------- */
  var panelState = { thoughts: false, inst: false, mod: false, brain: false };
  var instTab = 'events';
  var demoSheets = ['thoughts', 'inst', 'mod'];
  var demoSheet = 'thoughts';
  function showPanel(name) {
    if (name === 'brain') { toggleBrainOverlay(true); return; }
    if (document.body.classList.contains('demo-full') && (name === 'thoughts' || name === 'inst' || name === 'mod')) { showDemoSheet(name); return; }
    panelState[name] = true;
    var el = $('ter-panel-' + name);
    if (el) el.hidden = false;
    if (name === 'thoughts') updateThoughts(true);
    if (name === 'inst') showInstTab(instTab);
    if (name === 'mod') refreshModList();
  }
  function hidePanel(name) {
    if (name === 'brain') { toggleBrainOverlay(false); return; }
    if (document.body.classList.contains('demo-full') && (name === 'thoughts' || name === 'inst' || name === 'mod')) {
      if (name === demoSheet) return;
      panelState[name] = false;
      var el = $('ter-panel-' + name);
      if (el) el.hidden = true;
      return;
    }
    panelState[name] = false;
    var el = $('ter-panel-' + name);
    if (el) el.hidden = true;
  }
  function togglePanel(name) { panelState[name] ? hidePanel(name) : showPanel(name); }
  /* Fullscreen swipe cards: in demo-full mode the bottom sheet is one of
   * three cards — Bot Live, Instruments, Mod — swiping left/right on the
   * card loops through them. The world stays visible behind every card. */
  function showDemoSheet(name) {
    demoSheet = name;
    ['thoughts', 'inst', 'mod'].forEach(function (n) {
      panelState[n] = (n === name);
      var el = $('ter-panel-' + n);
      if (el) el.hidden = (n !== name);
    });
    if (name === 'thoughts') updateThoughts(true);
    if (name === 'inst') showInstTab(instTab);
    if (name === 'mod') refreshModList();
  }
  function demoSwipe(dir) {
    var i = demoSheets.indexOf(demoSheet);
    if (i < 0) i = 0;
    showDemoSheet(demoSheets[(i + dir + demoSheets.length) % demoSheets.length]);
  }
  function wireDemoSwipe() {
    ['thoughts', 'inst', 'mod'].forEach(function (n) {
      var el = $('ter-panel-' + n);
      if (!el) return;
      var sx = 0, sy = 0;
      el.addEventListener('touchstart', function (e) {
        if (!document.body.classList.contains('demo-full')) return;
        var t = e.changedTouches[0];
        sx = t.clientX; sy = t.clientY;
      }, { passive: true });
      el.addEventListener('touchend', function (e) {
        if (!document.body.classList.contains('demo-full')) return;
        var t = e.changedTouches[0];
        var dx = t.clientX - sx, dy = t.clientY - sy;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) demoSwipe(dx < 0 ? 1 : -1);
      }, { passive: true });
    });
  }
  /* Fullscreen demo view: whole screen for the Terrarium — 3D world on top,
   * live thoughts below, app chrome hidden, no scrolling. One AZ recording
   * then captures bot + verdict in a single frame. Exit restores the prior
   * thoughts-panel state. */
  var demoPrevThoughts = false;
  function toggleDemoFull() {
    var on = !document.body.classList.contains('demo-full');
    document.body.classList.toggle('demo-full', on);
    var btn = $('ter-btn-demo');
    if (on) {
      demoPrevThoughts = panelState.thoughts;
      hidePanel('inst'); hidePanel('mod');
      showPanel('thoughts');
      btn.textContent = '⛶ Exit full screen';
    } else {
      if (!demoPrevThoughts) hidePanel('thoughts');
      btn.textContent = '⛶ Full screen';
    }
    window.dispatchEvent(new Event('resize'));
    setTimeout(function () { window.dispatchEvent(new Event('resize')); }, 100);
  }
  function toggleBrainOverlay(force) {
    var on = force !== undefined ? force : !panelState.brain;
    panelState.brain = on;
    $('ter-brain-overlay').hidden = !on;
    if (on) drawBrain();
  }
  function wirePanels() {
    $('ter-pause').onclick = function () { paused = !paused; this.textContent = paused ? '▶ Resume' : '⏸ Pause'; };
    $('ter-speed').onclick = function () {
      simSpeed = simSpeed === 1 ? 2 : (simSpeed === 2 ? 4 : 1);
      this.textContent = '⏩ ' + simSpeed + '×';
    };
    $('ter-follow').onclick = function () { followBot = !followBot; markFollow(); };
    $('ter-btn-brain').onclick = function () { toggleBrainOverlay(); };
    $('ter-btn-thoughts').onclick = function () { togglePanel('thoughts'); };
    $('ter-btn-inst').onclick = function () { togglePanel('inst'); };
    Array.prototype.forEach.call(document.querySelectorAll('.ter-inst-tab'), function (b) {
      b.onclick = function () { showInstTab(b.dataset.tab); };
    });
    $('ter-btn-mod').onclick = function () { togglePanel('mod'); };
    $('ter-btn-demo').onclick = function () { toggleDemoFull(); };
    wireDemoSwipe();
    $('ter-thoughts-close').onclick = function () { hidePanel('thoughts'); };
    $('ter-inst-close').onclick = function () { hidePanel('inst'); };
    $('ter-mod-close').onclick = function () { hidePanel('mod'); placeMode = null; moveModeId = null; markPlaceButtons(); };
    $('ter-brain-close').onclick = function () { toggleBrainOverlay(false); };
    $('ter-reset-layout').onclick = function () {
      if (!confirm('Reset the terrarium layout to the default world? Your added items will be removed.')) return;
      Object.keys(propMeshes).forEach(removePropMesh);
      modStore.clear();
      world.props = modStore.load(C.defaultProps(C.mulberry32(20261020)));
      world.props.forEach(function (p) { addPropMesh(p); });
      refreshModList();
      pushEvent('mod', '🧩 layout reset to default world');
    };
    // spawn-kind buttons
    var grid = $('ter-mod-kinds');
    Object.keys(C.MOD_KINDS).forEach(function (kind) {
      var b = document.createElement('button');
      b.className = 'ghost ter-kind';
      b.dataset.kind = kind;
      b.style.minHeight = '48px';
      b.textContent = C.MOD_KINDS[kind].emoji + ' ' + C.MOD_KINDS[kind].label;
      b.onclick = function () {
        placeMode = placeMode === kind ? null : kind;
        moveModeId = null;
        markPlaceButtons();
      };
      grid.appendChild(b);
    });
  }
  function markPlaceButtons() {
    Array.prototype.forEach.call(document.querySelectorAll('.ter-kind'), function (b) {
      var on = b.dataset.kind === placeMode;
      b.style.outline = on ? '2px solid #40e0ff' : '';
      b.textContent = C.MOD_KINDS[b.dataset.kind].emoji + ' ' + C.MOD_KINDS[b.dataset.kind].label + (on ? ' — tap ground…' : '');
    });
    var hint = $('ter-mod-hint');
    if (hint) hint.textContent = placeMode ? 'Tap the ground to place the ' + C.MOD_KINDS[placeMode].label + '.' :
      (moveModeId ? 'Tap the ground to move the selected item there.' : 'Pick a kind, then tap the ground to place it. Tap any item in the world (or in the list) to select it.');
  }
  function refreshModList() {
    var el = $('ter-mod-list');
    if (!el || !world) return;
    if (!world.props.length) { el.innerHTML = '<div class="dsinfo">World is empty.</div>'; return; }
    el.innerHTML = world.props.map(function (p) {
      var sel = p.id === selectedPropId ? ' style="outline:2px solid #40e0ff"' : '';
      return '<div class="ter-mod-row"' + sel + ' data-pid="' + p.id + '">' +
        '<span>' + C.MOD_KINDS[p.kind].emoji + ' ' + esc(C.MOD_KINDS[p.kind].label) + ' <span class="dim">(' + p.x.toFixed(1) + ', ' + p.z.toFixed(1) + ')</span></span>' +
        '<span><button class="ghost ter-move" data-pid="' + p.id + '" style="min-height:48px">⌖ move</button> ' +
        '<button class="ghost ter-del" data-pid="' + p.id + '" style="min-height:48px">✕</button></span></div>';
    }).join('');
    Array.prototype.forEach.call(el.querySelectorAll('.ter-del'), function (b) {
      b.onclick = function () {
        var id = b.dataset.pid;
        if (modStore.remove(world.props, id)) { removePropMesh(id); modStore.save(world.props); refreshModList(); pushEvent('mod', '🧩 item removed'); }
      };
    });
    Array.prototype.forEach.call(el.querySelectorAll('.ter-move'), function (b) {
      b.onclick = function () { moveModeId = b.dataset.pid; placeMode = null; selectedPropId = moveModeId; markPlaceButtons(); refreshModList(); };
    });
    Array.prototype.forEach.call(el.querySelectorAll('.ter-mod-row'), function (row) {
      row.onclick = function (e) { if (e.target.tagName !== 'BUTTON') { selectedPropId = row.dataset.pid; refreshModList(); } };
    });
  }

  /* ---------- HUD / thoughts / instruments ---------- */
  function pushEvent(kind, msg) {
    eventLines.push({ t: world ? world.time : 0, kind: kind, msg: msg });
    if (eventLines.length > 40) eventLines.splice(0, eventLines.length - 40);
    if (kind === 'ghost') flash('ghost');
    if (kind === 'growth') flash('growth');
    if (kind === 'blackhole') flash('blackhole');
    if (panelState.inst) renderInstTab();
  }
  function flash(what) {
    flashCore = what; flashT = 1.6;
    if (!coreMat) return;
    if (what === 'ghost') coreMat.emissive.setHex(0x7a2fd0);
    else if (what === 'growth') coreMat.emissive.setHex(0xd0a018);
    else if (what === 'blackhole') coreMat.emissive.setHex(0x30105e);
  }
  function renderEvents() {
    var el = $('ter-events');
    if (!el) return;
    el.innerHTML = eventLines.slice(-26).map(function (e) {
      var cls = e.kind === 'ghost' ? 't-err' : (e.kind === 'growth' || e.kind === 'outcome' ? 't-ok' : (e.kind === 'blackhole' || e.kind === 'molecule' ? 't-warn' : ''));
      return '<div class="' + cls + '">[' + fmtT(e.t) + '] ' + esc(e.msg) + '</div>';
    }).join('');
    el.scrollTop = el.scrollHeight;
  }
  /* ---------- Dish instruments: one tab per trinity leg, live brain state ---------- */
  function actName(i) { return (typeof ACTIONS !== 'undefined' && ACTIONS[i]) ? ACTIONS[i] : ('action ' + i); }
  function showInstTab(tab) {
    instTab = tab;
    var tabs = { events: 'ter-events', seals: 'ter-inst-seals', molecules: 'ter-inst-molecules', gravity: 'ter-inst-gravity' };
    Object.keys(tabs).forEach(function (k) { var el = $(tabs[k]); if (el) el.hidden = (k !== tab); });
    Array.prototype.forEach.call(document.querySelectorAll('.ter-inst-tab'), function (b) {
      b.style.outline = b.dataset.tab === tab ? '2px solid #40e0ff' : '';
    });
    renderInstTab();
  }
  function renderInstTab() {
    if (!panelState.inst) return;
    if (instTab === 'seals') renderSeals();
    else if (instTab === 'molecules') renderMolecules();
    else if (instTab === 'gravity') renderGravity();
    else renderEvents();
  }
  function renderSeals() {
    var el = $('ter-inst-seals'); if (!el || !brain) return;
    if (!brain.ghosts.length) { el.innerHTML = '<div class="dsinfo">No ghosts sealed yet — a failed run seals here, with the Meta judge verdict when a key is saved.</div>'; return; }
    el.innerHTML = '<div class="dsinfo">' + brain.ghosts.length + ' / ' + brain.ghostCap + ' ghosts — sealed = awaiting appeal, redeemed = appeal won, broken = failed appeal, now molecules.</div>' +
      brain.ghosts.slice().reverse().map(function (g) {
        var st = g.status === 'redeemed' ? 'redeemed ✓' : (g.status === 'broken' ? 'broken → molecules' : 'sealed');
        var j = g.judgment ? '<div class="dim">⚖ judge: ' + esc(g.judgment) + '</div>' : '<div class="dim">⚖ judge: pending</div>';
        return '<div>👻 <b>' + esc(g.seal) + '</b> · “' + esc(g.objective) + '” · ep ' + g.t + ' · ' + st + j + '</div>';
      }).join('');
  }
  function renderMolecules() {
    var el = $('ter-inst-molecules'); if (!el || !brain) return;
    if (!brain.molecules.length) { el.innerHTML = '<div class="dsinfo">No molecules yet — when a ghost fails its appeal it breaks into 3 living bias fragments here.</div>'; return; }
    var nb = brain.moleculeBias(), li = 0;
    for (var a = 1; a < nb.length; a++) if (nb[a] < nb[li]) li = a;
    el.innerHTML = '<div class="dsinfo">' + brain.molecules.length + ' / ' + brain.moleculeCap + ' molecules — together they lean away from “' + esc(actName(li)) + '”.</div>' +
      brain.molecules.map(function (m) {
        var bi = 0;
        for (var a = 1; a < m.bias.length; a++) if (m.bias[a] < m.bias[bi]) bi = a;
        return '<div>🧬 mass ' + m.mass.toFixed(1) + ' · leans away from “' + esc(actName(bi)) + '” · from (' + m.ox.toFixed(1) + ', ' + m.oz.toFixed(1) + ')</div>';
      }).join('');
  }
  function renderGravity() {
    var el = $('ter-inst-gravity'); if (!el || !brain) return;
    if (!brain.gravity.length) { el.innerHTML = '<div class="dsinfo">No gravity wells yet — when ghosts or molecules pass their caps, the overflow merges here and pulls the bot and the props.</div>'; return; }
    el.innerHTML = '<div class="dsinfo">' + brain.gravity.length + ' well(s) — overflow weight, still pulling.</div>' +
      brain.gravity.map(function (g) {
        return '<div>🕳 well at (' + g.x.toFixed(1) + ', ' + g.z.toFixed(1) + ') · strength ' + g.strength.toFixed(2) + '</div>';
      }).join('');
  }
  function updateHUD() {
    var st = brain.status();
    var el = $('ter-hud');
    if (!el) return;
    var pct = Math.min(100, Math.round(st.params / st.ceiling * 100));
    el.innerHTML =
      '🧠 <b>' + st.params.toLocaleString() + '</b> / ' + st.ceiling.toLocaleString() + ' params (' + pct + '%)' +
      ' · net [' + st.sizes.join('→') + ']' +
      '<br>👻 ' + st.ghosts + ' ghosts · 🧬 ' + st.molecules + ' molecules · 🕳 ' + st.gravity + ' gravity' +
      ' · 🌱 ×' + st.growthEvents + ' · episodes ' + st.episodes +
      '<br><span class="dim">host: ' + esc(st.profile) + ' · pred-err ' + st.predErr + ' · growth = Net2Net widening on plateau/stuck (v1)</span>';
    var bar = $('ter-budget-bar');
    if (bar) bar.style.width = pct + '%';
  }
  function updateThoughts(force) {
    var el = $('ter-thoughts-body');
    if (!el || !world) return;
    var b = world.bot;
    var runName = world.run ? world.run.name : 'choosing…';
    el.innerHTML =
      '<div><b>Goal:</b> ' + esc(world.lastGoalText) + ' <span class="dim">(' + esc(runName) + ')</span></div>' +
      '<div>⚡ energy <b>' + Math.round(b.energy) + '%</b> · 🔮 charge <b>' + Math.round(b.charge) + '%</b> · ' +
      (world.run && world.zoneAt(b.x, b.z).sludge ? '<span class="t-warn">in sludge — slowed, draining</span>' : (world.run && world.zoneAt(b.x, b.z).current ? '<span class="t-warn">in a current — being pushed</span>' : 'on open ground')) + '</div>' +
      '<div class="ter-log">' + brain.log.slice(-12).map(function (l) { return '<div>💭 ' + esc(l) + '</div>'; }).join('') + '</div>';
  }

  /* ---------- brain node overlay (the Brain tab, merged in) ----------
   * Same visual language as NL_BRAIN: layers of glowing nodes,
   * brightness = LIVE activation of the terrarium brain, edges =
   * strongest live weights. Fed by the bot's actual forward pass. */
  function drawBrain() {
    var cv = $('ter-brain-canvas');
    if (!cv || !brain || !brain.net.lastActs) return;
    var ctx = cv.getContext('2d');
    var w = cv.clientWidth, h = cv.clientHeight;
    if (w > 40 && h > 40 && (cv.width !== Math.round(w) || cv.height !== Math.round(h))) { cv.width = Math.round(w); cv.height = Math.round(h); }
    var W = cv.width, H = cv.height;
    ctx.fillStyle = '#0d0d12'; ctx.fillRect(0, 0, W, H);
    var net = brain.net, acts = net.lastActs, sizes = net.sizes;
    var L = sizes.length;
    var maxPer = 26;
    function shown(l) { return Math.min(sizes[l], maxPer); }
    function nodePos(l, i) {
      var n = shown(l);
      var x = (l + 0.5) * (W / L);
      var y = n === 1 ? H / 2 : 26 + (i / (n - 1)) * (H - 52);
      return { x: x, y: y };
    }
    function realIdx(l, i) { return sizes[l] <= maxPer ? i : Math.floor(i * sizes[l] / maxPer); }
    // edges: strongest weights only (cap for legibility)
    ctx.lineWidth = 1;
    for (var l = 0; l < L - 1; l++) {
      var Wm = net.W[l];
      var maxW = 0.001;
      Wm.forEach(function (row) { row.forEach(function (v) { if (Math.abs(v) > maxW) maxW = Math.abs(v); }); });
      for (var o = 0; o < shown(l + 1); o++) {
        var ro = realIdx(l + 1, o);
        for (var i2 = 0; i2 < shown(l); i2++) {
          var ri = realIdx(l, i2);
          var wv = Wm[ro][ri];
          if (Math.abs(wv) < maxW * 0.45) continue;
          var p1 = nodePos(l, i2), p2 = nodePos(l + 1, o);
          ctx.strokeStyle = wv > 0 ? 'rgba(64,224,255,0.35)' : 'rgba(255,110,160,0.30)';
          ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
        }
      }
    }
    for (var l2 = 0; l2 < L; l2++) {
      for (var n = 0; n < shown(l2); n++) {
        var idx = realIdx(l2, n);
        var a = acts[l2][idx] || 0;
        var p = nodePos(l2, n);
        var r = 5 + Math.min(6, sizes[l2] / 8);
        var g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2.2);
        var col = a >= 0 ? '64,224,255' : '255,110,160';
        g.addColorStop(0, 'rgba(' + col + ',' + (0.25 + Math.abs(a) * 0.75) + ')');
        g.addColorStop(1, 'rgba(' + col + ',0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(p.x, p.y, r * 2.2, 0, 6.2832); ctx.fill();
        ctx.fillStyle = '#eafcff';
        ctx.beginPath(); ctx.arc(p.x, p.y, r * 0.45, 0, 6.2832); ctx.fill();
      }
      ctx.fillStyle = '#9a9aa8'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(sizes[l2] + (sizes[l2] > maxPer ? ' (sampled)' : ''), (l2 + 0.5) * (W / L), H - 8);
    }
    ctx.textAlign = 'left';
    var cap = $('ter-brain-cap');
    if (cap) cap.textContent = 'Live forward pass of the terrarium brain — net [' + sizes.join('→') + '], ' +
      brain.status().params.toLocaleString() + ' params. Cyan = positive activation, pink = negative; edges show the strongest weights.';
  }

  /* ---------- main loop ---------- */
  var lastTs = 0, walkPhase = 0, gravCountSeen = -1, stageW = 0;
  function frame(ts) {
    requestAnimationFrame(frame);
    if (!active || !renderer) return;
    var dt = Math.min(0.05, lastTs ? (ts - lastTs) / 1000 : 0.016);
    lastTs = ts;
    clockT += dt;
    var stage = $('ter-stage');
    if (stage && Math.abs(stage.clientWidth - stageW) > 4) { stageW = stage.clientWidth; resize(); }

    if (!paused) {
      for (var s = 0; s < simSpeed; s++) world.tick(dt);
      var evs = world.drainEvents().concat(brain.drainEvents());
      for (var i = 0; i < evs.length; i++) pushEvent(evs[i].kind, evs[i].msg);
      if (brain.gravity.length !== gravCountSeen) { gravCountSeen = brain.gravity.length; syncGravityMeshes(); }
    }

    // — bot sync (v69: stride/bob scale with physics speed, body
    //   tilts on slopes, leans into acceleration, head tracks goal) —
    var b = world.bot;
    var by = visH(b.x, b.z);
    var spdN = Math.min(1, (b.speed || 0) / C.PHYS.maxSpeed);
    botGrp.position.set(b.x, by, b.z);
    botGrp.rotation.y = b.heading;
    var lean = dt > 0 ? Math.max(-0.1, Math.min(0.16, ((b.speed || 0) - prevBotSpeed) / dt * 0.028)) : 0;
    prevBotSpeed = b.speed || 0;
    botGrp.rotation.x = (b.tiltP || 0) * 0.85 + lean;
    botGrp.rotation.z = (b.tiltR || 0) * 0.85;
    if (b.moving) walkPhase += dt * (3.5 + (b.speed || 0) * 4.6); else walkPhase *= 0.9;
    var sw = Math.sin(walkPhase) * (0.05 + spdN * 0.55);
    botParts.armL.rotation.x = sw; botParts.armR.rotation.x = -sw;
    botParts.legL.rotation.x = -sw; botParts.legR.rotation.x = sw;
    botGrp.position.y = by + Math.abs(Math.sin(walkPhase)) * (0.01 + spdN * 0.05);
    if (botParts.head) {
      var hTarget = Math.sin(clockT * 0.4) * 0.35; // idle scan
      if (world.run) {
        var hb = Math.atan2(world.run.tx - b.x, world.run.tz - b.z) - b.heading;
        while (hb > Math.PI) hb -= Math.PI * 2;
        while (hb < -Math.PI) hb += Math.PI * 2;
        hTarget = Math.max(-1.05, Math.min(1.05, hb));
      }
      headYaw += (hTarget - headYaw) * Math.min(1, 9 * dt);
      botParts.head.rotation.y = headYaw;
    }
    botLight.position.set(b.x, by + 1.6, b.z);
    // confidence ring: color by prediction error (calm cyan → strained orange)
    var pe = brain.predErrEMA;
    ringMesh.material.color.setHSL(0.52 - Math.min(0.14, pe * 0.14), 0.9, 0.55);
    ringMesh.rotation.z = clockT * 0.4;
    if (flashT > 0) { flashT -= dt; if (flashT <= 0 && coreMat) coreMat.emissive.setHex(0x18b7c9); }

    // — sky / day-night (v69: dawn/dusk warm band, moon key light) —
    var f = dayFactors(world.dayPhase);
    var warmF = Math.max(0, 1 - Math.abs(f.sunA) / 0.38); // peaks as the sun crosses the horizon
    var nightFv = Math.max(0, Math.min(1, (0.45 - f.day) / 0.45));
    var bg = new THREE.Color(0x0a0f24).lerp(new THREE.Color(0x9fc8e8), f.day);
    bg.lerp(new THREE.Color(0xe8975a), warmF * 0.3);
    scene.background = bg;
    scene.fog.color.copy(bg);
    var sunAng = world.dayPhase * Math.PI * 2;
    if (f.sunA > -0.06) {
      sunLight.position.set(Math.cos(sunAng) * 40, Math.max(4, Math.sin(sunAng) * 34 + 8), Math.sin(sunAng) * 26);
      sunLight.intensity = 0.25 + f.day * 1.5;
      sunLight.color.setHSL(0.11, 0.55, 0.65 + f.day * 0.2);
    } else {
      // night: the blood moon becomes the shadow-casting key light
      sunLight.position.set(-42, 30, -52);
      sunLight.intensity = 0.5 + nightFv * 0.35;
      sunLight.color.setHex(0xff7a5e);
    }
    hemiLight.intensity = 0.3 + f.day * 0.65;
    hemiLight.color.setHex(0xbfd9ff).lerp(new THREE.Color(0xffc9a0), warmF * 0.45);
    botLight.intensity = 6 + (1 - f.day) * 14;
    if (horizonGlow) {
      horizonGlow.position.set(Math.cos(sunAng) * 118, 7, Math.sin(sunAng) * 118);
      horizonGlow.material.opacity = warmF * 0.5;
    }

    // — v68: night sky — blood-red moon + stars fade in as day fades —
    var nightF = Math.max(0, Math.min(1, (0.45 - f.day) / 0.45));
    if (moonMat) moonMat.opacity = nightF * 0.95;
    if (starMat) starMat.opacity = nightF * 0.9;
    if (flyMat) flyMat.opacity = 0.22 + nightF * 0.68;
    // — v68: firefly drift —
    if (flyPts) {
      var fp = flyPts.geometry.attributes.position;
      for (var fi = 0; fi < flyBase.length / 4; fi++) {
        var bx = flyBase[fi * 4], bz = flyBase[fi * 4 + 1], ph = flyBase[fi * 4 + 2], fsp = flyBase[fi * 4 + 3];
        fp.setXYZ(fi,
          bx + Math.sin(clockT * fsp + ph) * 1.1,
          visH(bx, bz) + 1.1 + Math.sin(clockT * fsp * 1.3 + ph * 2) * 0.5,
          bz + Math.cos(clockT * fsp * 0.8 + ph) * 1.1);
      }
      fp.needsUpdate = true;
    }
    // — v69: clouds drift and take the sky's tint (day white,
    //   horizon-warm, dark red under the blood moon) —
    if (cloudSprites.length) {
      var ct2 = new THREE.Color(0xffffff);
      ct2.lerp(new THREE.Color(0xffb37a), warmF * 0.55);
      ct2.lerp(new THREE.Color(0x4a2530), nightF * 0.8);
      for (var ci = 0; ci < cloudSprites.length; ci++) {
        var csp = cloudSprites[ci];
        csp.position.x += csp.userData.speed * dt;
        if (csp.position.x > 140) csp.position.x = -140;
        csp.material.color.copy(ct2);
      }
    }
    // — v69: pollen / dust motes drift in daylight —
    if (motePts) {
      moteMat.opacity = 0.04 + f.day * 0.42;
      var mp = motePts.geometry.attributes.position;
      for (var mi = 0; mi < moteBase.length / 4; mi++) {
        var mx = moteBase[mi * 4], mz = moteBase[mi * 4 + 1], mph = moteBase[mi * 4 + 2], msp = moteBase[mi * 4 + 3];
        mp.setXYZ(mi,
          mx + Math.sin(clockT * msp + mph) * 0.9,
          visH(mx, mz) + 1.3 + Math.sin(clockT * msp * 1.4 + mph) * 0.6,
          mz + Math.cos(clockT * msp * 0.7 + mph) * 0.9);
      }
      mp.needsUpdate = true;
    }
    // — v69: bot core pulse — brightness follows brain activity
    //   (prediction error + motion); lifecycle flashes tint it —
    if (coreMat) {
      var act = Math.max(0, Math.min(1.3, 0.25 + brain.predErrEMA * 1.1 + (b.moving ? 0.18 : 0)));
      coreMat.emissiveIntensity = 1.7 + act * 1.5 + Math.sin(clockT * (2.2 + act * 2.6)) * (0.3 + act * 0.45);
    }

    // — v68+v69: sandbox bodies —
    syncThrowables(dt);

    // — ambient animation: floating orbs/crystals, spinning current zones, gravity rings —
    for (var pid in propMeshes) {
      var g = propMeshes[pid], p = world.propById(pid);
      if (!p) continue;
      // v69 — light props physically move now (pushes, knocks, gravity creep): follow them
      if (g.position.x !== p.x || g.position.z !== p.z) { g.position.x = p.x; g.position.z = p.z; }
      if (p.kind === 'orb' || p.kind === 'crystal') g.position.y = visH(p.x, p.z) + Math.sin(clockT * 1.7 + p.x) * 0.07;
      else if (p.kind !== 'zone-sludge' && p.kind !== 'zone-current') g.position.y = visH(p.x, p.z);
      g.children.forEach(function (ch) { if (ch.name === 'spin') ch.rotation.z = clockT * 0.5; });
    }
    gravityMeshes.forEach(function (gm) { if (gm.userData.ring) gm.userData.ring.rotation.z = clockT * 0.9; });
    // water: shimmer + v69 ripple rings + wandering specular glint
    if (waterMat) waterMat.opacity = 0.72 + Math.sin(clockT * 1.3) * 0.07;
    updateRipples(dt);
    if (glintMesh) {
      glintMesh.position.x = POND.x + Math.sin(clockT * 0.23) * 1.6;
      glintMesh.position.z = POND.z + Math.cos(clockT * 0.19) * 1.6;
      glintMesh.material.opacity = (0.06 + f.day * 0.26 + nightF * 0.12) * (0.6 + 0.4 * Math.sin(clockT * 1.7));
    }

    // — bursts —
    for (var bi = bursts.length - 1; bi >= 0; bi--) {
      var bp = bursts[bi];
      bp.position.addScaledVector(bp.userData.v, dt);
      bp.userData.v.y -= 2.0 * dt;
      bp.userData.life -= dt * 0.8;
      bp.material.opacity = Math.max(0, bp.userData.life);
      if (bp.userData.life <= 0) { scene.remove(bp); bursts.splice(bi, 1); }
    }
    // lifecycle bursts at the bot when big events land
    if (flashCore === 'ghost' && flashT > 1.5) { burst(b.x, by + 1.4, b.z, 0x9a6bff, 8); flashCore = null; }
    if (flashCore === 'growth' && flashT > 1.5) { burst(b.x, by + 1.4, b.z, 0xffd24a, 12); flashCore = null; }

    if (followBot) {
      orbit.target.x += (b.x - orbit.target.x) * 0.08;
      orbit.target.z += (b.z - orbit.target.z) * 0.08;
      orbit.target.y = by + 0.7;
    }
    applyOrbit();
    renderer.render(scene, camera);

    if (ts - lastHudUpdate > 500) { lastHudUpdate = ts; updateHUD(); }
    if (panelState.thoughts && ts - lastPanelUpdate > 700) { lastPanelUpdate = ts; updateThoughts(); }
    if (panelState.inst && ts - lastPanelUpdate > 700) renderInstTab();
    if (panelState.brain) drawBrain();
  }

  /* ---------- lifecycle (called by app.js) ---------- */
  function onShow() {
    init();
    active = true;
    resize();
    if (world) { updateHUD(); if (panelState.thoughts) updateThoughts(true); }
  }
  function setActive(on) {
    active = !!on;
    if (on) onShow();
    lastTs = 0;
  }
  return {
    onShow: onShow,
    setActive: setActive,
    padTick: padTick,
    active: function () { return active; }
  };
})();
