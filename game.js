/* =========================================================
   地铁跑酷 · Subway Surfers 3D
   依赖: three.js (r150 UMD, 本地 three.min.js)
   ========================================================= */
(function () {
  'use strict';

  if (THREE.ColorManagement) THREE.ColorManagement.enabled = true;

  if (typeof THREE === 'undefined') {
    document.body.innerHTML = '<div style="color:#fff;font:16px sans-serif;padding:40px">three.min.js 加载失败，请确认文件与 index.html 在同一目录。</div>';
    return;
  }

  /* ---------------- 小工具 ---------------- */
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = n => (Math.random() * n) | 0;
  const pick = a => a[(Math.random() * a.length) | 0];
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const damp = (a, b, l, dt) => a + (b - a) * (1 - Math.exp(-l * dt));
  const lerp = (a, b, t) => a + (b - a) * t;
  function shuffle(a) {
    a = a.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* ---------------- 常量 ---------------- */
  // 车道间距按录屏重新标定：原版车道宽约是角色身高的 1.6 倍，角色 2.0 → 3.18
  const LANES = [-3.18, 0, 3.18];
  const SPAWN_Z = -168;
  const DESPAWN_Z = 15;
  const GRAVITY = -42;
  const JUMP_V = 14.0;
  const SLIDE_TIME = 0.62;
  const SPEED_START = 26;
  const SPEED_MAX = 56;
  const PLAYER_H = 2.0;
  const PLAYER_H_SLIDE = 1.05;
  // 世界横向放大 1.55 倍后，机位按"角色在画面里占 15% 高度"重新对过录屏
  // ?camy=&camz= 是调机位用的临时钩子，改完对着录屏比一眼就够
  const _camy = /[?&]camy=([\d.]+)/.exec(location.search);
  const _camz = /[?&]camz=([\d.]+)/.exec(location.search);
  const CAM_Y = _camy ? parseFloat(_camy[1]) : 5.95;
  const CAM_Z = _camz ? parseFloat(_camz[1]) : 8.40;

  /* ---------------- 渲染器 / 场景 ---------------- */
  const canvas = document.getElementById('game');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  if ('outputEncoding' in renderer && THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x8a2a4e, 92, 380);

  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 950);
  camera.position.set(0, CAM_Y, CAM_Z);
  camera.lookAt(0, 2.70, -11.0);

  // 竖屏 / 窄屏自适应：拉远相机 + 放大视野，保证三条轨道都在画面里
  let baseFov = 62, camScale = 1;
  function fitView() {
    const a = window.innerWidth / window.innerHeight;
    const t = clamp((1.5 - a) / 1.0, 0, 1);
    baseFov = 62 + 16 * t;
    camScale = 1 + 0.45 * t;
    camera.aspect = a;
    camera.updateProjectionMatrix();
  }
  fitView();

  /* ---------------- 天空 ---------------- */
  (function sky() {
    const geo = new THREE.SphereGeometry(400, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        cTop: { value: new THREE.Color(0x2a0a26) },
        cMid: { value: new THREE.Color(0x7c1542) },
        cBot: { value: new THREE.Color(0xcf4a63) }
      },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: [
        'uniform vec3 cTop; uniform vec3 cMid; uniform vec3 cBot;',
        'varying vec3 vP;',
        'void main(){',
        '  float h = clamp(normalize(vP).y * 0.5 + 0.5, 0.0, 1.0);',
        '  vec3 c = h < 0.5 ? mix(cBot, cMid, smoothstep(0.36, 0.5, h)) : mix(cMid, cTop, smoothstep(0.5, 0.95, h));',
        '  gl_FragColor = vec4(pow(c, vec3(0.4545)), 1.0);',
        '}'
      ].join('\n')
    });
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    scene.add(m);
  })();

  /* ---------------- 灯光 ---------------- */
  scene.add(new THREE.HemisphereLight(0xc0688e, 0x241a28, 1.05));
  const sun = new THREE.DirectionalLight(0xffb490, 0.72);
  sun.position.set(-14, 26, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -22;
  sun.shadow.camera.right = 22;
  sun.shadow.camera.top = 30;
  sun.shadow.camera.bottom = -26;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 110;
  sun.shadow.bias = -0.0009;
  sun.target.position.set(0, 0, -12);
  scene.add(sun);
  scene.add(sun.target);

  const fill = new THREE.DirectionalLight(0x7a5aa8, 0.30);
  fill.position.set(16, 10, -22);
  scene.add(fill);

  // 轮廓光：从后上方打，让角色边缘有一圈冷光，体积感更强
  const rim = new THREE.DirectionalLight(0xff9a6a, 0.34);
  rim.position.set(6, 9, -16);
  scene.add(rim);

  /* ---------------- 地面 / 道砟 / 枕木 / 钢轨 ---------------- */
  // 城区地面：加一层沥青/水泥斑驳纹理，否则墙后是一整片死板的灰
  const groundTex = (function () {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#3f2c3a';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 900; i++) {
      const v = 58 + Math.random() * 40 | 0;
      g.fillStyle = 'rgba(' + (v + 10) + ',' + v + ',' + (v + 8) + ',' + (0.10 + Math.random() * 0.20).toFixed(2) + ')';
      g.beginPath();
      g.arc(Math.random() * 256, Math.random() * 256, Math.random() * 16 + 3, 0, 7);
      g.fill();
    }
    for (let i = 0; i < 40; i++) {
      g.strokeStyle = 'rgba(30,20,30,.24)';
      g.lineWidth = Math.random() * 2 + 0.6;
      g.beginPath();
      g.moveTo(Math.random() * 256, Math.random() * 256);
      g.lineTo(Math.random() * 256, Math.random() * 256);
      g.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(26, 30);
    t.encoding = THREE.sRGBEncoding;
    return t;
  })();

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(600, 700),
    new THREE.MeshLambertMaterial({ color: 0xffffff, map: groundTex })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.04, -220);
  scene.add(ground);

  // 道床：原版是纯色块 + 极淡的明暗过渡，没有写实碎石。这里只保留一点点低频斑驳，
  // 否则整条轨道会变成一块塑料板
  const ballastTex = (function () {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#9c8574';
    g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 90; i++) {
      const v = 112 + Math.random() * 30 | 0;
      g.fillStyle = 'rgba(' + v + ',' + (v - 12) + ',' + (v - 14) + ',' + (0.10 + Math.random() * 0.16).toFixed(2) + ')';
      g.beginPath();
      g.arc(Math.random() * 128, Math.random() * 128, Math.random() * 18 + 5, 0, 7);
      g.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(3.83, 42);
    t.encoding = THREE.sRGBEncoding;
    return t;
  })();

  const bed = new THREE.Mesh(
    new THREE.BoxGeometry(10.60, 0.16, 560),
    new THREE.MeshLambertMaterial({ map: ballastTex })
  );
  bed.position.set(0, -0.08, -220);
  scene.add(bed);

  // 枕木（实例化 + 滚动 + 每根颜色微差）：原版枕木"稀而厚"，而且三条轨道各自的
  // 枕木之间要露出一条道床，否则整片会连成一条连续的"梯子"
  const SLEEPER_N = 90;
  const SLEEPER_GAP = 3.10;
  const SLEEPER_SPAN = SLEEPER_N * SLEEPER_GAP;
  const sleepers = new THREE.InstancedMesh(
    new THREE.BoxGeometry(2.76, 0.24, 1.15),
    new THREE.MeshLambertMaterial({ color: 0xffffff }),
    SLEEPER_N * 3
  );
  sleepers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  sleepers.frustumCulled = false;
  scene.add(sleepers);

  const sleeperZ = new Float32Array(SLEEPER_N);
  for (let i = 0; i < SLEEPER_N; i++) sleeperZ[i] = 12 - i * SLEEPER_GAP;

  (function tintSleepers() {
    const col = new THREE.Color();
    for (let i = 0; i < SLEEPER_N * 3; i++) {
      const v = 0.84 + Math.random() * 0.34;
      col.setRGB(0.062 * v, 0.050 * v, 0.045 * v);
      sleepers.setColorAt(i, col);
    }
    sleepers.instanceColor.needsUpdate = true;
  })();

  // 枕木脚下的接触阴影：原版每根枕木下面都压着一圈暗，少了这个枕木会像"贴"在道床上
  const sleeperShade = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(2.98, 1.42),
    new THREE.MeshBasicMaterial({
      color: 0x140a0e, transparent: true, opacity: 0.26,
      depthWrite: false, blending: THREE.NormalBlending
    }),
    SLEEPER_N * 3
  );
  sleeperShade.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  sleeperShade.frustumCulled = false;
  scene.add(sleeperShade);

  const dummy = new THREE.Object3D();
  const dummyFlat = new THREE.Object3D();
  dummyFlat.rotation.x = -Math.PI / 2;
  function layoutSleepers() {
    let idx = 0;
    for (let l = 0; l < 3; l++) {
      for (let i = 0; i < SLEEPER_N; i++) {
        dummy.position.set(LANES[l], 0.11, sleeperZ[i]);
        dummy.updateMatrix();
        sleepers.setMatrixAt(idx, dummy.matrix);

        dummyFlat.position.set(LANES[l], 0.012, sleeperZ[i]);
        dummyFlat.updateMatrix();
        sleeperShade.setMatrixAt(idx, dummyFlat.matrix);
        idx++;
      }
    }
    sleepers.instanceMatrix.needsUpdate = true;
    sleeperShade.instanceMatrix.needsUpdate = true;
  }
  layoutSleepers();

  // 钢轨（轨底 + 轨头，做出工字断面感）
  // 原版的轨面是浅色细条，压在深色枕木上对比很强，所以轨头提亮、轨底压暗
  const railMat = new THREE.MeshStandardMaterial({ color: 0xded8d2, roughness: 0.5, metalness: 0.10 });
  const railBaseMat = new THREE.MeshStandardMaterial({ color: 0x3a3032, roughness: 0.9, metalness: 0.08 });
  const railBaseGeo = new THREE.BoxGeometry(0.20, 0.05, 560);
  const railHeadGeo = new THREE.BoxGeometry(0.09, 0.07, 560);
  for (let i = 0; i < 3; i++) {
    for (const sgn of [-1, 1]) {
      const x = LANES[i] + sgn * 0.99;
      const rb = new THREE.Mesh(railBaseGeo, railBaseMat);
      rb.position.set(x, 0.22, -220);
      scene.add(rb);
      const rh = new THREE.Mesh(railHeadGeo, railMat);
      rh.position.set(x, 0.278, -220);
      scene.add(rh);
    }
  }

  // 道床两侧边梁（原版是一条深蓝灰的厚边，把道床"框"起来）
  const curbMat = new THREE.MeshLambertMaterial({ color: 0x2f3444 });
  for (const sgn of [-1, 1]) {
    const curb = new THREE.Mesh(new THREE.BoxGeometry(0.47, 0.34, 560), curbMat);
    curb.position.set(sgn * 5.42, 0.17, -220);
    scene.add(curb);
  }

  /* ---------------- 轨道两侧：人行道 + 石基 + 铁栅栏 ---------------- */
  const fenceMat = new THREE.MeshLambertMaterial({ color: 0x14161e });
  const walkMat = new THREE.MeshLambertMaterial({ color: 0x6f6069 });
  const stoneMat = new THREE.MeshLambertMaterial({ color: 0x4b4250 });

  function makeFenceTexture() {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const g = c.getContext('2d');
    g.clearRect(0, 0, 64, 64);
    g.fillStyle = '#0d0f16';
    // 四根竖栏
    for (const x of [4, 20, 36, 52]) {
      g.fillRect(x, 0, 5, 64);
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 2.5, -8); g.lineTo(x + 5, 0); g.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.encoding = THREE.sRGBEncoding;
    return t;
  }

  for (const s of [-1, 1]) {
    // 轨旁人行道
    const walk = new THREE.Mesh(new THREE.BoxGeometry(2.78, 0.24, 560), walkMat);
    walk.position.set(s * 6.81, 0.02, -220);
    scene.add(walk);

    // 石基
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.98, 560), stoneMat);
    base.position.set(s * 8.20, 0.49, -220);
    scene.add(base);

    // 铁栅栏（贴图 + alphaTest，比几百根实体柱子便宜太多）
    const fTex = makeFenceTexture();
    fTex.repeat.set(260, 1);
    const fence = new THREE.Mesh(
      new THREE.PlaneGeometry(560, 2.0),
      new THREE.MeshLambertMaterial({ map: fTex, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide })
    );
    fence.position.set(s * 8.20, 1.98, -220);
    fence.rotation.y = Math.PI / 2;
    scene.add(fence);

    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 560), fenceMat);
    rail.position.set(s * 8.20, 2.98, -220);
    scene.add(rail);
  }

  /* ---------------- 都铎式木筋墙房子 ---------------- */
  // 用一张贴图同时解决"浅色灰泥 + 深色木梁 + 发光窗"，
  // 每栋房子只要 1 个 draw call，不然几十栋房子光是木梁就要几百个 mesh
  function makeTudorTex(plaster, timber, variant) {
    const W = 256, H = 256;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const e = document.createElement('canvas');
    e.width = W; e.height = H;
    const ge = e.getContext('2d');

    g.fillStyle = plaster; g.fillRect(0, 0, W, H);
    ge.fillStyle = '#000'; ge.fillRect(0, 0, W, H);

    // 灰泥的脏污
    for (let i = 0; i < 60; i++) {
      g.fillStyle = 'rgba(0,0,0,' + (0.03 + Math.random() * 0.06).toFixed(2) + ')';
      g.beginPath();
      g.arc(Math.random() * W, Math.random() * H, Math.random() * 26 + 6, 0, 7);
      g.fill();
    }

    // 木梁：外框 + 竖 + 横 + 斜撑
    const T = 11;
    g.fillStyle = timber;
    g.fillRect(0, 0, W, T); g.fillRect(0, H - T, W, T);
    g.fillRect(0, 0, T, H); g.fillRect(W - T, 0, T, H);
    g.fillRect(W / 2 - T / 2, 0, T, H * 0.46);
    g.fillRect(0, H * 0.46, W, T);
    // 下层的斜撑（都铎式标志性的"人"字）
    for (const bx of [0.25, 0.75]) {
      for (const rot of [0.62, -0.62]) {
        g.save();
        g.translate(W * bx, H * 0.72); g.rotate(rot);
        g.fillRect(-T / 2, -H * 0.2, T, H * 0.4);
        g.restore();
      }
    }

    // 窗：深色窗框 + 十字窗棂 + 发光的玻璃
    function win(x, y, w, h) {
      g.fillStyle = timber; g.fillRect(x - 7, y - 7, w + 14, h + 14);
      g.fillStyle = '#2a1c16'; g.fillRect(x, y, w, h);
      const panes = [
        [x + 4, y + 4, w / 2 - 6, h / 2 - 6],
        [x + w / 2 + 2, y + 4, w / 2 - 6, h / 2 - 6],
        [x + 4, y + h / 2 + 2, w / 2 - 6, h / 2 - 6],
        [x + w / 2 + 2, y + h / 2 + 2, w / 2 - 6, h / 2 - 6]
      ];
      g.fillStyle = '#ffe98a';
      ge.fillStyle = '#ffe98a';
      for (const pn of panes) { g.fillRect(pn[0], pn[1], pn[2], pn[3]); ge.fillRect(pn[0], pn[1], pn[2], pn[3]); }
    }

    if (variant === 0) {
      win(W * 0.14, H * 0.13, W * 0.32, H * 0.26);
    } else if (variant === 1) {
      win(W * 0.54, H * 0.13, W * 0.32, H * 0.26);
    } else if (variant === 2) {
      win(W * 0.09, H * 0.12, W * 0.30, H * 0.27);
      win(W * 0.61, H * 0.12, W * 0.30, H * 0.27);
    } else if (variant === 3) {
      win(W * 0.30, H * 0.10, W * 0.40, H * 0.30);
      win(W * 0.36, H * 0.55, W * 0.28, H * 0.15);
    } else {
      // 只开一扇小圆窗，立面更"空"，用来打散节奏
      g.fillStyle = timber;
      g.beginPath(); g.arc(W * 0.5, H * 0.24, W * 0.14, 0, 7); g.fill();
      g.fillStyle = '#2a1c16';
      g.beginPath(); g.arc(W * 0.5, H * 0.24, W * 0.11, 0, 7); g.fill();
      g.fillStyle = '#ffe98a';
      ge.fillStyle = '#ffe98a';
      g.beginPath(); g.arc(W * 0.5, H * 0.24, W * 0.085, 0, 7); g.fill();
      ge.beginPath(); ge.arc(W * 0.5, H * 0.24, W * 0.085, 0, 7); ge.fill();
    }

    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    const te = new THREE.CanvasTexture(e);
    te.encoding = THREE.sRGBEncoding;
    return { map: t, emissiveMap: te };
  }

  // 10 种立面 × 8 种屋顶，加上烟囱，长距离跑也不容易看出循环
  const FACADE = [
    makeTudorTex('#7f7a68', '#2f2119', 0),
    makeTudorTex('#8a8172', '#33241b', 1),
    makeTudorTex('#6f6b5c', '#2a1e17', 2),
    makeTudorTex('#8d8478', '#37271d', 3),
    makeTudorTex('#6b6a72', '#2b2028', 4),
    makeTudorTex('#7a6f60', '#33241b', 0),
    makeTudorTex('#847b6e', '#2c1f18', 2),
    makeTudorTex('#6d6a60', '#241a14', 1),
    makeTudorTex('#8f8878', '#352519', 3),
    makeTudorTex('#74706a', '#2a1e1a', 4)
  ];
  const facadeMats = FACADE.map((f, i) => new THREE.MeshLambertMaterial({
    map: f.map, emissiveMap: f.emissiveMap,
    emissive: i % 3 === 2 ? 0xff7ad0 : 0xffe98a,
    emissiveIntensity: 1.0
  }));

  const ROOF_COLORS = [0x6e2434, 0x3f2c4c, 0x5c3226, 0x352c4e, 0x1f4a4a, 0x7a2c52, 0x2f3a5c, 0x50303a];
  const roofMats = ROOF_COLORS.map(c => new THREE.MeshLambertMaterial({ color: c, side: THREE.DoubleSide }));

  // 双坡屋顶：三角截面棱柱，底面 y=0，屋脊 y=1
  const gableGeo = (function () {
    const g = new THREE.BufferGeometry();
    const v = [
      -0.5, 0, -0.5, 0, 1, -0.5, 0, 1, 0.5,
      -0.5, 0, -0.5, 0, 1, 0.5, -0.5, 0, 0.5,
      0.5, 0, -0.5, 0.5, 0, 0.5, 0, 1, 0.5,
      0.5, 0, -0.5, 0, 1, 0.5, 0, 1, -0.5,
      -0.5, 0, -0.5, 0.5, 0, -0.5, 0, 1, -0.5,
      -0.5, 0, 0.5, 0, 1, 0.5, 0.5, 0, 0.5
    ];
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.computeVertexNormals();
    return g;
  })();

  const unitBox = new THREE.BoxGeometry(1, 1, 1);

  const houses = [];
  const CHIMNEY_MAT = new THREE.MeshLambertMaterial({ color: 0x6d5546 });

  function resetHouse(h, side, z) {
    const w = rand(7.1, 12.4);
    const hh = h.row === 1 ? rand(5.9, 11.8) : rand(9.3, 19.4);
    const d = rand(8.5, 15.5);
    const rh = rand(2.9, 6.5);
    h.body.scale.set(w, hh, d);
    h.body.position.y = hh / 2;
    h.body.material = pick(facadeMats);
    h.roof.scale.set(w * 1.1, rh, d * 1.1);
    h.roof.position.y = hh;
    h.roof.material = pick(roofMats);

    // 烟囱：约六成的房子有，位置随机，破掉"一排一模一样的尖顶"
    const hasChimney = Math.random() < 0.6;
    h.chimney.visible = hasChimney;
    if (hasChimney) {
      const cx = (Math.random() < 0.5 ? -1 : 1) * w * rand(0.12, 0.26);
      const cy = hh + rh * (1 - Math.abs(cx) / (w * 0.55)) + rand(1.16, 1.94);
      h.chimney.position.set(cx, cy, rand(-d * 0.26, d * 0.26));
      h.chimney.scale.set(rand(0.78, 1.16), rand(2.5, 3.7), rand(0.78, 1.16));
    }

    // 房子的近墙至少要退到栅栏(8.2)外面：房子宽度是随机的，写死一个中心点会让
    // 最宽的那几栋直接插到人行道上，所以按自身宽度反推
    const near = h.row === 1 ? 9.3 : 15.2;
    const xr = near + w / 2 + rand(0, h.row === 1 ? 4.6 : 11.5);
    h.mesh.position.set(side * xr, 0, z);
  }
  for (const side of [-1, 1]) {
    for (let i = 0; i < 12; i++) {
      const grp = new THREE.Group();
      const body = new THREE.Mesh(unitBox, facadeMats[0]);
      const roof = new THREE.Mesh(gableGeo, roofMats[0]);
      const chimney = new THREE.Mesh(unitBox, CHIMNEY_MAT);
      body.castShadow = true; roof.castShadow = true; chimney.castShadow = true;
      grp.add(body, roof, chimney);
      const h = { mesh: grp, body, roof, chimney, side, row: 0 };
      resetHouse(h, side, 18 - i * 29.5);
      scene.add(grp);
      houses.push(h);
    }
    for (let i = 0; i < 12; i++) {
      const grp = new THREE.Group();
      const body = new THREE.Mesh(unitBox, facadeMats[0]);
      const roof = new THREE.Mesh(gableGeo, roofMats[0]);
      const chimney = new THREE.Mesh(unitBox, CHIMNEY_MAT);
      body.castShadow = true; roof.castShadow = true; chimney.castShadow = true;
      grp.add(body, roof, chimney);
      const h = { mesh: grp, body, roof, chimney, side, row: 1 };
      resetHouse(h, side, 14 - i * 20);
      scene.add(grp);
      houses.push(h);
    }
  }

  /* ---------------- 石头拱门（替代钢桁架） ---------------- */
  const gates = [];
  const gateMat = new THREE.MeshLambertMaterial({ color: 0x6a6272 });
  const gateDarkMat = new THREE.MeshLambertMaterial({ color: 0x4a4454 });
  // 拱门整体抬高到 10.0 以上：相机在 y=5.95、向下俯 14.6°，横梁低于这个高度就会在
  // 接近时糊住画面上方。另外顶盖从"大三角屋顶"改成薄檐口 —— 那个三角顶是遮挡的主犯。
  const GATE_H = 12.0;
  const pillarGeo = new THREE.BoxGeometry(2.0, GATE_H, 2.0);
  const lintelGeo = new THREE.BoxGeometry(18.4, 0.9, 1.4);
  const corniceGeo = new THREE.BoxGeometry(19.3, 0.4, 2.2);
  for (let i = 0; i < 8; i++) {
    const g = new THREE.Group();
    const p1 = new THREE.Mesh(pillarGeo, gateMat); p1.position.set(-8.42, GATE_H / 2, 0);
    const p2 = new THREE.Mesh(pillarGeo, gateMat); p2.position.set(8.42, GATE_H / 2, 0);
    const lt = new THREE.Mesh(lintelGeo, gateDarkMat); lt.position.set(0, GATE_H + 0.4, 0);
    const cor = new THREE.Mesh(corniceGeo, gateDarkMat); cor.position.set(0, GATE_H + 0.97, 0);
    g.add(p1, p2, lt, cor);
    g.position.z = 16 - i * 34;
    scene.add(g);
    gates.push(g);
  }

  /* ---------------- 松树 / 岩石 / 路灯（随场景滚动） ---------------- */
  const TREE_MAT = new THREE.MeshLambertMaterial({ color: 0x1c4a44 });
  const TREE_MAT2 = new THREE.MeshLambertMaterial({ color: 0x27594f });
  const coneGeo = new THREE.ConeGeometry(1, 1, 7);
  const trunkGeo = new THREE.BoxGeometry(0.3, 1, 0.3);
  const TRUNK_MAT = new THREE.MeshLambertMaterial({ color: 0x2a1e1a });

  const ROCK_MAT = new THREE.MeshLambertMaterial({ color: 0x565a55, flatShading: true });
  const rockGeo = new THREE.IcosahedronGeometry(1, 0);

  const LAMP_MAT = new THREE.MeshLambertMaterial({ color: 0x22403f });
  const LAMP_GLOW = new THREE.MeshBasicMaterial({ color: 0xffd98a });
  const lampPostGeo = new THREE.CylinderGeometry(0.14, 0.20, 5.27, 6);
  const lampBoxGeo = new THREE.BoxGeometry(0.78, 0.93, 0.78);
  const lampCapGeo = new THREE.ConeGeometry(0.65, 0.56, 4);

  const decor = [];
  function resetDecor(d, z) {
    const side = d.side;
    if (d.kind === 'tree') {
      const s = rand(1.55, 2.64);
      d.mesh.scale.set(s, s * rand(1.5, 2.3), s);
      d.mesh.position.set(side * rand(9.9, 14.2), 0, z);
    } else if (d.kind === 'rock') {
      const s = rand(1.1, 2.9);
      d.mesh.scale.set(s * rand(1.0, 1.6), s * rand(0.6, 1.1), s * rand(1.0, 1.6));
      d.mesh.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
      d.mesh.position.set(side * rand(9.7, 13.9), 0, z);
    } else {
      d.mesh.position.set(side * 9.55, 0, z);
    }
  }
  function makeTree() {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(trunkGeo, TRUNK_MAT);
    trunk.scale.set(1, 0.9, 1); trunk.position.y = 0.45;
    const c1 = new THREE.Mesh(coneGeo, TREE_MAT);
    c1.scale.set(1.0, 2.0, 1.0); c1.position.y = 1.6;
    const c2 = new THREE.Mesh(coneGeo, TREE_MAT2);
    c2.scale.set(0.72, 1.5, 0.72); c2.position.y = 2.6;
    g.add(trunk, c1, c2);
    return g;
  }
  function makeLamp() {
    const g = new THREE.Group();
    const post = new THREE.Mesh(lampPostGeo, LAMP_MAT); post.position.y = 2.64;
    const box = new THREE.Mesh(lampBoxGeo, LAMP_GLOW); box.position.y = 5.43;
    const cap = new THREE.Mesh(lampCapGeo, LAMP_MAT); cap.position.y = 6.12;
    g.add(post, box, cap);
    return g;
  }
  for (const side of [-1, 1]) {
    for (let i = 0; i < 9; i++) {
      const m = makeTree();
      const d = { mesh: m, side, kind: 'tree' };
      resetDecor(d, 8 - i * 22);
      scene.add(m); decor.push(d);
    }
    for (let i = 0; i < 7; i++) {
      const m = new THREE.Mesh(rockGeo, ROCK_MAT);
      const d = { mesh: m, side, kind: 'rock' };
      resetDecor(d, 2 - i * 26);
      scene.add(m); decor.push(d);
    }
    for (let i = 0; i < 6; i++) {
      const m = makeLamp();
      const d = { mesh: m, side, kind: 'lamp' };
      resetDecor(d, 6 - i * 31);
      scene.add(m); decor.push(d);
    }
  }

  // 地上的雪块
  const snowMat = new THREE.MeshLambertMaterial({ color: 0xb2a2d6 });
  const snowGeo = new THREE.CircleGeometry(1, 7);
  const snow = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(snowGeo, snowMat);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = rand(0, 6.28);
      const s = rand(1.4, 4.65);
      m.scale.set(s, s * rand(0.5, 1.2), 1);
      m.position.set(side * rand(9.7, 16.2), 0.13, 6 - i * 21);
      scene.add(m);
      snow.push({ mesh: m, side });
    }
  }

  /* ---------------- 会动的元素：灯笼 / 雾 / 蝙蝠 / 炊烟 ---------------- */
  // 一张柔和的圆形光斑贴图，灯笼光晕、雾、烟都用它，只是颜色和混合方式不同
  const SOFT_DOT = (function () {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.42, 'rgba(255,255,255,.42)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    return t;
  })();

  // —— 挂在拱门横梁下的灯笼 ——
  const LANTERN_MAT = new THREE.MeshBasicMaterial({ color: 0xffbe5c });
  const LANTERN_DARK = new THREE.MeshLambertMaterial({ color: 0x2a1a16 });
  const lanternGeo = new THREE.SphereGeometry(0.27, 12, 10);
  const lanternCapGeo = new THREE.CylinderGeometry(0.13, 0.16, 0.11, 8);
  const lanternStrGeo = new THREE.CylinderGeometry(0.016, 0.016, 1, 4);
  const lanternHaloMat = new THREE.SpriteMaterial({
    map: SOFT_DOT, color: 0xff9a3c, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.75
  });
  const lanterns = [];
  for (const g of gates) {
    for (const lx of [-5.6, 5.6]) {
      const pivot = new THREE.Group();
      pivot.position.set(lx, 11.6, 0);
      pivot.scale.setScalar(1.55);
      const str = new THREE.Mesh(lanternStrGeo, LANTERN_DARK);
      str.scale.y = 1.95; str.position.y = -0.97;
      const body = new THREE.Mesh(lanternGeo, LANTERN_MAT);
      body.scale.set(1, 1.3, 1); body.position.y = -2.15;
      const cap = new THREE.Mesh(lanternCapGeo, LANTERN_DARK);
      cap.position.y = -1.87;
      const halo = new THREE.Sprite(lanternHaloMat);
      halo.scale.set(2.4, 2.4, 1);
      halo.position.y = -2.15;
      pivot.add(str, body, cap, halo);
      g.add(pivot);
      lanterns.push({ pivot, phase: rand(0, 6.28) });
    }
  }

  // —— 地面飘的雾 ——
  const fogs = [];
  for (let i = 0; i < 14; i++) {
    const m = new THREE.SpriteMaterial({
      map: SOFT_DOT, color: 0xb58fb8, transparent: true,
      depthWrite: false, opacity: rand(0.10, 0.20)
    });
    const sp = new THREE.Sprite(m);
    const s = rand(18.6, 34);
    sp.scale.set(s, s * 0.55, 1);
    sp.position.set(rand(-14, 14), rand(1.2, 3.7), -i * 28 + rand(-9, 9));
    scene.add(sp);
    fogs.push({ sp, baseX: sp.position.x, phase: rand(0, 6.28), spd: rand(0.15, 0.4), amp: rand(1.5, 4) });
  }

  // —— 天上飞的蝙蝠 ——
  const BAT_MAT = new THREE.MeshLambertMaterial({ color: 0x1a0f18, side: THREE.DoubleSide });
  const batBodyGeo = new THREE.SphereGeometry(0.17, 8, 6);
  const batWingGeo = (function () {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0, 1.15, 0.05, -0.32, 0.18, 0, 0.62
    ], 3));
    g.computeVertexNormals();
    return g;
  })();
  const bats = [];
  for (let i = 0; i < 8; i++) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(batBodyGeo, BAT_MAT);
    body.scale.set(0.75, 1, 1.8);
    const wl = new THREE.Group(), wr = new THREE.Group();
    const w1 = new THREE.Mesh(batWingGeo, BAT_MAT);
    const w2 = new THREE.Mesh(batWingGeo, BAT_MAT); w2.scale.x = -1;
    wl.add(w1); wr.add(w2);
    g.add(body, wl, wr);
    g.scale.setScalar(rand(0.8, 1.4));
    scene.add(g);
    bats.push({
      g, wl, wr,
      cx: rand(-18, 18), cz: rand(-110, -35), cy: rand(9, 16),
      r: rand(6, 16), a: rand(0, 6.28), spd: rand(0.25, 0.6) * (Math.random() < 0.5 ? -1 : 1),
      flap: rand(0, 6.28)
    });
  }
  // 先摆到位：不然开局/暂停时 updateDecor 没跑，蝙蝠会堆在原点，两只翅膀正好摊在角色脚下
  for (const b of bats) {
    b.g.position.set(b.cx + Math.cos(b.a) * b.r, b.cy + Math.sin(b.a * 2.7 + b.flap) * 1.2, b.cz + Math.sin(b.a) * b.r * 0.55);
    b.g.rotation.y = Math.atan2(-Math.sin(b.a) * b.r * b.spd, Math.cos(b.a) * b.r * 0.55 * b.spd);
  }

  // —— 屋顶炊烟 ——
  const smokes = [];
  for (let i = 0; i < 14; i++) {
    const m = new THREE.SpriteMaterial({
      map: SOFT_DOT, color: 0xaea0ac, transparent: true, depthWrite: false, opacity: 0
    });
    const sp = new THREE.Sprite(m);
    sp.visible = false;
    scene.add(sp);
    smokes.push({ sp, life: 0, maxLife: 1, vy: 1, base: 1 });
  }
  function respawnSmoke(sm) {
    // 只在"看得见"的那一段街上找烟囱，太远或已经跑到镜头后面的都不选
    let h = null;
    for (let k = 0; k < 26; k++) {
      const c = houses[(Math.random() * houses.length) | 0];
      if (!c.chimney.visible) continue;
      const z = c.mesh.position.z;
      if (z > -26 || z < -96) continue;
      h = c; break;
    }
    if (!h) {                       // 这一帧没找到合适的，下一帧再来
      sm.sp.visible = false;
      sm.life = 1; sm.maxLife = 1;
      return;
    }
    const p = h.chimney.position;
    sm.sp.position.set(h.mesh.position.x + p.x, p.y + 0.85, h.mesh.position.z + p.z);
    sm.life = rand(0, 0.6);          // 错开起始时间，避免整片一起冒
    sm.maxLife = rand(2.2, 3.4);
    sm.vy = rand(0.7, 1.3);
    sm.base = rand(1.4, 2.4);
    sm.sp.visible = true;
  }
  for (const sm of smokes) respawnSmoke(sm);

  /* ---------------- 障碍物工厂 ---------------- */
  // 尺寸全部按"碰撞盒"写，视觉体块贴着这些数字长，改尺寸不用动碰撞代码
  // 尺寸全部按"碰撞盒"写，视觉体块贴着这些数字长，改尺寸不用动碰撞代码。
  // 第八轮把整体放大约 1.2 倍宽、1.3 倍高：原来比原版小一整圈，站到旁边只有半个身子
  // 尺寸按录屏重新标定过：原版车厢接近角色两倍高、宽度吃满一条轨道，
  // 矮栅栏到角色胸口。玩家身高 2.0，所以火车 4.76（2.38 倍）、栅栏 1.86（0.93 倍）
  // 宽度吃满一条车道（车道宽 3.18，只留 0.06 的缝）
  const OB_DEF = {
    hurdle: { w: 3.06, h: 1.86, d: 0.96, baseY: 0 },
    bar: { w: 3.06, h: 0.86, d: 0.66, baseY: 1.76 },
    crate: { w: 2.58, h: 1.98, d: 2.34, baseY: 0 },
    train: { w: 3.06, h: 4.76, d: 9.60, baseY: 0 },
    // 坡道不是"撞到就死"的障碍，是能跑上去的地形：h 就是它高端的高度，
    // 和火车顶一样高，跑完坡道正好接上车顶
    ramp: { w: 3.06, h: 4.76, d: 8.60, baseY: 0 }
  };

  // —— 原版那套材质语言：橄榄绿石台 + 红白条纹软垫 + 暖橙梯形车顶 ——
  const matStone = new THREE.MeshStandardMaterial({ color: 0x4e5340, roughness: 0.86, metalness: 0.02 });
  const matStoneTop = new THREE.MeshStandardMaterial({ color: 0x616847, roughness: 0.80, metalness: 0.02 });
  const matStoneLow = new THREE.MeshStandardMaterial({ color: 0x363a2a, roughness: 0.92 });
  const matIron = new THREE.MeshStandardMaterial({ color: 0x4a4436, roughness: 0.72, metalness: 0.35 });
  const matWood = new THREE.MeshStandardMaterial({ color: 0xb5762f, roughness: 0.78, metalness: 0.04 });
  const matWoodDark = new THREE.MeshStandardMaterial({ color: 0x8a5416, roughness: 0.82 });
  const matNavy = new THREE.MeshStandardMaterial({ color: 0x38335c, roughness: 0.62, metalness: 0.12 });
  const matNavyDark = new THREE.MeshStandardMaterial({ color: 0x2b2750, roughness: 0.70, metalness: 0.10 });
  const matGlass = new THREE.MeshStandardMaterial({
    color: 0xcfc8ec, roughness: 0.30, metalness: 0.18,
    emissive: 0x4e3f84, emissiveIntensity: 0.62
  });
  const matHood = new THREE.MeshStandardMaterial({ color: 0x7a2a34, roughness: 0.75 });
  const matWarn = new THREE.MeshBasicMaterial({ color: 0xffd24a });
  const matFace = new THREE.MeshStandardMaterial({ color: 0xe4ddf2, roughness: 0.58, metalness: 0.06 });
  // 车顶配色：原版车厢靠车顶区分，橙 / 暗红 / 砖红轮着来。
  // 这里加了两支冷色（石板蓝、暗紫），否则并排三条车道全在橙色系里，
  // 车顶上换道时根本分不清自己在哪条
  const TRAIN_COLORS = [0xc8763a, 0x7a2e3c, 0x3f5a72, 0xdcae4a, 0x8e3a1e, 0x5a3a6a];

  // 红白条纹软垫的贴图：沿宽度方向一条条排开
  function bandTexture(a, b, n) {
    const c = document.createElement('canvas');
    c.width = n * 24; c.height = 48;
    const g = c.getContext('2d');
    for (let i = 0; i < n; i++) {
      g.fillStyle = i % 2 ? b : a;
      g.fillRect(i * 24, 0, 24, 48);
    }
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    return t;
  }
  const matPad = new THREE.MeshStandardMaterial({ map: bandTexture('#d8324a', '#f4e8de', 6), roughness: 0.60 });

  /* 坡道（录像里那个"车厢鼻子"）：不是工地的木板坡，而是把车头削成一个斜面 ——
     深酒红的坡面 + 品红箭头花纹 + 玫瑰色边条 + 深蓝底座。
     坡面花纹用一张 canvas 贴图，比拿十几个小方块拼干净得多 */
  const RAMP_FACE = '#451020';    // 坡面深酒红（渲染后会亮一档，这里要压暗）
  const RAMP_ACCENT = '#87136e';  // 品红花纹
  function rampTexture() {
    const c = document.createElement('canvas');
    // 画布长宽比要和坡面一致（坡面又窄又长），否则花纹会被拉长
    c.width = 256; c.height = 880;
    const g = c.getContext('2d');
    g.fillStyle = RAMP_FACE;
    g.fillRect(0, 0, 256, 880);
    // 上下各压一点暗，斜面才有纵深感
    const gr = g.createLinearGradient(0, 0, 0, 880);
    gr.addColorStop(0, 'rgba(0,0,0,.30)');
    gr.addColorStop(0.28, 'rgba(0,0,0,0)');
    gr.addColorStop(1, 'rgba(0,0,0,.14)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 256, 880);

    g.fillStyle = RAMP_ACCENT;
    // 顶部小三角
    g.beginPath();
    g.moveTo(128, 34); g.lineTo(180, 138); g.lineTo(76, 138);
    g.closePath(); g.fill();
    // 中间菱形
    g.beginPath();
    g.moveTo(128, 178); g.lineTo(162, 224); g.lineTo(128, 270); g.lineTo(94, 224);
    g.closePath(); g.fill();
    // 底部大 V：箭头朝坡顶
    g.beginPath();
    g.moveTo(128, 318);
    g.lineTo(232, 880); g.lineTo(178, 880);
    g.lineTo(128, 500);
    g.lineTo(78, 880); g.lineTo(24, 880);
    g.closePath(); g.fill();

    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    return t;
  }
  const matRampFace = new THREE.MeshStandardMaterial({ map: rampTexture(), roughness: 0.66, metalness: 0.06 });
  const matRampDeck = new THREE.MeshStandardMaterial({ color: 0x451020, roughness: 0.66, metalness: 0.06 });
  const matRampSide = new THREE.MeshStandardMaterial({ color: 0x454962, roughness: 0.72, metalness: 0.10 });
  const matRampTrim = new THREE.MeshStandardMaterial({ color: 0x9a6f6b, roughness: 0.78, metalness: 0.02 });

  // 车顶用的梯形棱柱（截面下宽上窄），沿 z 拉伸
  function trapGeo(wb, wt, h, d) {
    const hb = wb / 2, ht = wt / 2, hd = d / 2;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([
      -hb, 0, -hd, hb, 0, -hd, ht, h, -hd, -ht, h, -hd,
      -hb, 0, hd, hb, 0, hd, ht, h, hd, -ht, h, hd
    ], 3));
    g.setIndex([
      0, 1, 2, 0, 2, 3,
      4, 6, 5, 4, 7, 6,
      0, 4, 5, 0, 5, 1,
      3, 2, 6, 3, 6, 7,
      0, 3, 7, 0, 7, 4,
      1, 5, 6, 1, 6, 2
    ]);
    const flat = g.toNonIndexed();     // 拆成独立三角面，法线才是硬边
    flat.computeVertexNormals();
    return flat;
  }

  // 坡道用的楔形截面：低端在 +z（朝玩家），先斜升、顶端留一小段平顶（land）
  // 平顶是必需的：车尾的碰撞判定有 ±0.45 的扫掠带，没有平顶角色会在
  // 还差 0.2 米没升满的时候被车尾"撞"死
  function wedgeGeo(w, h, d, land) {
    const hw = w / 2, hd = d / 2, zb = -hd + land;
    const A = [-hw, 0, hd], Ap = [hw, 0, hd];
    const B = [-hw, h, zb], Bp = [hw, h, zb];
    const C = [-hw, h, -hd], Cp = [hw, h, -hd];
    const D = [-hw, 0, -hd], Dp = [hw, 0, -hd];
    const tri = [
      A, B, D, B, C, D,          // 左侧面
      Ap, Dp, Bp, Bp, Dp, Cp,    // 右侧面
      A, D, Dp, A, Dp, Ap,       // 底面
      A, Bp, B, A, Ap, Bp,       // 斜面
      B, Cp, C, B, Bp, Cp,       // 平顶
      D, Cp, Dp, D, C, Cp        // 背面
    ];
    const arr = new Float32Array(tri.length * 3);
    for (let i = 0; i < tri.length; i++) {
      arr[i * 3] = tri[i][0]; arr[i * 3 + 1] = tri[i][1]; arr[i * 3 + 2] = tri[i][2];
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    g.computeVertexNormals();
    return g;
  }

  // 需要跳过去的矮路障：橄榄绿石台 + 压顶板 + 红白条纹软垫（软垫嵌在压顶板里）
  function buildHurdle(def) {
    const g = new THREE.Group();
    const W = def.w, D = def.d, H = def.h;
    const foot = new THREE.Mesh(new THREE.BoxGeometry(W + 0.12, 0.16, D + 0.10), matStoneLow);
    foot.position.y = 0.08;
    const plinthH = H * 0.50 - 0.16;
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(W, plinthH, D), matStone);
    plinth.position.y = 0.16 + plinthH / 2;
    const cap = new THREE.Mesh(new THREE.BoxGeometry(W + 0.14, 0.13, D + 0.10), matStoneTop);
    cap.position.y = H * 0.50 + 0.065;
    const padH = H * 0.44;
    const pad = new THREE.Mesh(new THREE.BoxGeometry(W - 0.26, padH, D - 0.14), matPad);
    pad.position.y = H - padH / 2;
    for (const m of [foot, plinth, cap, pad]) { m.castShadow = true; g.add(m); }
    return g;
  }

  // 要滑铲钻过去的横梁：两根石柱 + 顶梁 + 吊在下面的条纹软垫
  function buildBar(def) {
    const g = new THREE.Group();
    const W = def.w, B = def.baseY, H = def.h;
    const top = B + H;                    // 横梁顶面 = 碰撞上沿
    const px = W / 2 - 0.10;
    const postH = top + 0.16;
    const postGeo = new THREE.BoxGeometry(0.22, postH, 0.22);
    const capGeo = new THREE.BoxGeometry(0.32, 0.12, 0.32);
    const baseGeo = new THREE.BoxGeometry(0.38, 0.16, 0.38);
    for (const sgn of [-1, 1]) {
      const p = new THREE.Mesh(postGeo, matStone);
      p.position.set(sgn * px, postH / 2, 0);
      const cap = new THREE.Mesh(capGeo, matStoneTop);
      cap.position.set(sgn * px, postH + 0.06, 0);
      const base = new THREE.Mesh(baseGeo, matStoneLow);
      base.position.set(sgn * px, 0.08, 0);
      p.castShadow = true;
      g.add(p, cap, base);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(W + 0.18, 0.22, 0.36), matStoneTop);
    beam.position.y = top - 0.11; beam.castShadow = true;
    // 吊杆要露出来，否则软垫像是直接粘在横梁上
    const hangGeo = new THREE.BoxGeometry(0.05, 0.20, 0.05);
    for (const sgn of [-1, 1]) {
      const hg = new THREE.Mesh(hangGeo, matIron);
      hg.position.set(sgn * (W / 2 - 0.42), top - 0.28, 0);
      g.add(hg);
    }
    const padBase = new THREE.Mesh(new THREE.BoxGeometry(W - 0.16, 0.07, 0.58), matStoneLow);
    padBase.position.y = B + 0.05;
    const padH = H * 0.60;
    const pad = new THREE.Mesh(new THREE.BoxGeometry(W - 0.26, padH, 0.54), matPad);
    pad.position.y = B + padH / 2 + 0.04; pad.castShadow = true;
    // 横梁两端的黄灯
    const lampGeo = new THREE.SphereGeometry(0.12, 10, 8);
    for (const sgn of [-1, 1]) {
      const lamp = new THREE.Mesh(lampGeo, matWarn);
      lamp.position.set(sgn * (W / 2 - 0.05), top - 0.11, 0.21);
      g.add(lamp);
    }
    g.add(beam, padBase, pad);
    return g;
  }

  // 木箱：暖橙木身 + 四角立柱 + 两道铁箍 + 正反面 X 形加固
  function buildCrate(def) {
    const g = new THREE.Group();
    const W = def.w, D = def.d, H = def.h;
    const bodyH = H - 0.18;
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, bodyH, D), matWood);
    body.position.y = bodyH / 2;
    const top = new THREE.Mesh(new THREE.BoxGeometry(W + 0.10, 0.18, D + 0.10), matWoodDark);
    top.position.y = H - 0.09;
    body.castShadow = top.castShadow = true;
    g.add(body, top);

    const postGeo = new THREE.BoxGeometry(0.19, bodyH + 0.04, 0.19);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const p = new THREE.Mesh(postGeo, matWoodDark);
        p.position.set(sx * (W / 2 - 0.02), (bodyH + 0.04) / 2, sz * (D / 2 - 0.02));
        g.add(p);
      }
    }
    for (const t of [0.30, 0.74]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(W + 0.04, 0.13, D + 0.04), matIron);
      b.position.y = bodyH * t;
      g.add(b);
    }
    const diag = Math.sqrt(W * W + bodyH * bodyH) * 0.94;
    for (const sz of [-1, 1]) {
      for (const rot of [0.79, -0.79]) {
        const br = new THREE.Mesh(new THREE.BoxGeometry(diag, 0.11, 0.05), matWoodDark);
        br.position.set(0, bodyH / 2, sz * (D / 2 + 0.012));
        br.rotation.z = rot;
        g.add(br);
      }
    }
    return g;
  }

  // 上坡道：照录像里"车厢鼻子"的做法 —— 整个坡就是车头削出来的一个斜面，
  // 深酒红坡面 + 品红箭头花纹 + 玫瑰色边条 + 深蓝底座，跑上去正好接车顶
  const RAMP_LAND = 0.70;   // 顶端平顶长度，和 groundHeightAt 共用
  function buildRamp(def) {
    const g = new THREE.Group();
    const W = def.w, H = def.h, D = def.d;
    const sl = D - RAMP_LAND;                 // 斜面在 z 方向占的长度
    const ang = Math.atan2(H, sl);
    const L = Math.sqrt(H * H + sl * sl);     // 斜面实际长度
    const ny = Math.cos(ang), nz = Math.sin(ang);   // 斜面法线（朝上朝后）
    const zMid = (D / 2 + (-D / 2 + RAMP_LAND)) / 2;  // 斜面中点 z

    // 楔形本体：深蓝灰，和车厢裙板同色，侧面看就是车头
    const body = new THREE.Mesh(wedgeGeo(W, H, D, RAMP_LAND), matRampSide);
    body.castShadow = true;
    g.add(body);

    // 坡面：一块贴了品红箭头花纹的斜板，比本体窄一圈，两侧露出深蓝车头
    const bw = W - 0.36;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(bw, L - 0.06), matRampFace);
    face.rotation.x = ang - Math.PI / 2;
    face.position.set(0, H / 2 + 0.025 * ny, zMid + 0.025 * nz);
    face.userData.noOutline = true;
    g.add(face);

    // 顶端平顶：同一套酒红，接上车顶脊。
    // 注意要整块压在楔形顶面之上，否则和楔形的顶面共面会打架（闪出一块深蓝）
    const deck = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.08, RAMP_LAND + 0.04), matRampDeck);
    deck.position.set(0, H + 0.03, -D / 2 + RAMP_LAND / 2);
    deck.castShadow = true;
    g.add(deck);

    // 两侧玫瑰色边条：沿坡面一路拉到平顶，是录像里最显眼的一条亮边
    const trimGeo = new THREE.BoxGeometry(0.20, 0.09, L - 0.04);
    const capGeo = new THREE.BoxGeometry(0.20, 0.09, RAMP_LAND + 0.06);
    for (const sgn of [-1, 1]) {
      const t = new THREE.Mesh(trimGeo, matRampTrim);
      t.rotation.x = ang;
      t.position.set(sgn * (bw / 2 - 0.06), H / 2 + 0.06 * ny, zMid + 0.06 * nz);
      t.userData.noOutline = true;
      g.add(t);

      const tc = new THREE.Mesh(capGeo, matRampTrim);
      tc.position.set(sgn * (bw / 2 - 0.06), H + 0.07, -D / 2 + RAMP_LAND / 2);
      tc.userData.noOutline = true;
      g.add(tc);
    }

    // 坡底挡块：横跨整条车道的一道深蓝矮墙，把坡脚"封"住，
    // 远看就是车头下面那块配重
    const bump = new THREE.Mesh(new THREE.BoxGeometry(W - 0.14, 0.30, 0.26), matRampSide);
    bump.position.set(0, 0.15, D / 2 - 0.13);
    bump.castShadow = true;
    g.add(bump);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(W - 0.30, 0.07, 0.30), matRampTrim);
    lip.position.set(0, 0.315, D / 2 - 0.13);
    lip.userData.noOutline = true;
    g.add(lip);

    return g;
  }

  // 地铁车厢：暖橙梯形车顶 + 深靛蓝车身 + 淡薰衣草窗带 + 车头红白 V 形
  function buildTrain(def) {
    const g = new THREE.Group();
    const D = def.d;
    const roofMat = new THREE.MeshStandardMaterial({
      color: TRAIN_COLORS[0], roughness: 0.62, metalness: 0.12, side: THREE.DoubleSide
    });

    const hem = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.14, D), matHood);
    hem.position.y = 0.07;
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(1.88, 0.68, D), matNavyDark);
    skirt.position.y = 0.44;
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.90, 1.78, D), matNavy.clone());
    body.position.y = 1.66;
    const win = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.84, D - 0.7), matGlass);
    win.position.y = 1.80;
    body.castShadow = true;
    g.add(hem, skirt, body, win);

    const frameGeo = new THREE.BoxGeometry(1.96, 0.90, 0.09);
    for (let z = -D / 2 + 1.1; z < D / 2 - 0.75; z += 1.15) {
      const f = new THREE.Mesh(frameGeo, matNavyDark);
      f.position.set(0, 1.80, z);
      f.userData.noOutline = true;
      g.add(f);
    }

    const roof = new THREE.Mesh(trapGeo(2.00, 1.26, 0.36, D), roofMat);
    roof.position.y = 2.55;
    roof.castShadow = true;
    g.add(roof);

    // 车顶横向压条：贴着梯形顶面（2.55+0.36=2.91），玩家跑在上面时有速度感
    const seamGeo = new THREE.BoxGeometry(1.12, 0.05, 0.12);
    for (let z = -D / 2 + 1.0; z < D / 2 - 0.5; z += 1.6) {
      const sm = new THREE.Mesh(seamGeo, matHood);
      sm.position.set(0, 2.885, z);
      sm.userData.noOutline = true;
      g.add(sm);
    }

    // 车头面：深色面板 + 红白 V 形 + 小黄菱形 + 车灯
    // 车头正脸：原版迎面开来的车厢就是一张"脸"——浅色面板 + 竖格栅 + 两只圆头灯。
    // 之前是深色面板配红白 V 形，看着像赛车而不是地铁
    const fz = D / 2 + 0.012, faceY = 1.50;
    const faceParts = [];
    const panel = new THREE.Mesh(new THREE.BoxGeometry(1.80, 1.50, 0.06), matFace);
    panel.position.set(0, faceY, fz);
    panel.userData.noOutline = true;
    faceParts.push(panel);
    g.add(panel);
    const grilleGeo = new THREE.BoxGeometry(0.07, 0.68, 0.05);
    for (let i = -2; i <= 2; i++) {
      const b = new THREE.Mesh(grilleGeo, matNavyDark);
      b.position.set(i * 0.17, faceY + 0.18, fz + 0.045);
      b.userData.noOutline = true;
      faceParts.push(b);
      g.add(b);
    }
    const band = new THREE.Mesh(new THREE.BoxGeometry(1.84, 0.18, 0.07), matNavyDark);
    band.position.set(0, faceY - 0.46, fz + 0.02);
    band.userData.noOutline = true;
    faceParts.push(band);
    g.add(band);

    const lampGeo = new THREE.SphereGeometry(0.145, 12, 9);
    for (const sgn of [-1, 1]) {
      const l = new THREE.Mesh(lampGeo, matWarn);
      l.position.set(sgn * 0.66, 0.66, fz + 0.04);
      l.userData.noOutline = true;
      faceParts.push(l);
      g.add(l);
    }
    // 车灯辉光：迎面开来的车全靠这两团光在雾里先被认出来
    const hl = new THREE.Sprite(glowMat);
    hl.scale.set(2.2, 1.5, 1);
    hl.position.set(0, 0.66, fz + 0.10);
    hl.userData.noOutline = true;
    faceParts.push(hl);
    g.add(hl);

    g.userData.roof = roof;
    g.userData.body = body;
    g.userData.face = faceParts;    // 车头正脸那堆零件，排成走廊时可以整组关掉
    return g;
  }

  function createOb(type) {
    const def = OB_DEF[type];
    let mesh, tint = null, bodyTint = null;
    if (type === 'hurdle') mesh = buildHurdle(def);
    else if (type === 'bar') mesh = buildBar(def);
    else if (type === 'crate') mesh = buildCrate(def);
    else if (type === 'ramp') mesh = buildRamp(def);
    else {
      mesh = buildTrain(def);
      tint = mesh.userData.roof;
      bodyTint = mesh.userData.body;
      // 车厢零件是按 1.90 宽 / 2.91 高写的，按目标尺寸整体缩一下
      // （碰撞用 def.w / def.h，视觉必须和它们对上，否则"看着没碰到却撞了"）
      mesh.scale.x = def.w / 1.90;
      mesh.scale.y = def.h / 2.91;
    }
    // 障碍物统一加描边，和角色同一套卡通风格，不然是些光秃秃的方块
    addOutline(mesh, OUTLINE_MAT_BIG);
    mesh.visible = false;
    scene.add(mesh);
    return {
      type, mesh, tint, bodyTint, flip: false,
      w: def.w, h: def.h, d: def.d, baseY: def.baseY,
      active: false, prevZ: 0, vz: 0   // vz：在"世界滚动"之外自己额外前进的速度
    };
  }

  /* ---------------- 金币 ---------------- */
  const coinTex = (function () {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(46, 44, 6, 64, 64, 64);
    grad.addColorStop(0, '#fff8cc');
    grad.addColorStop(0.55, '#ffcf2a');
    grad.addColorStop(1, '#e08a00');
    g.fillStyle = grad;
    g.beginPath(); g.arc(64, 64, 64, 0, 7); g.fill();
    g.strokeStyle = '#c47a00'; g.lineWidth = 7;
    g.beginPath(); g.arc(64, 64, 56, 0, 7); g.stroke();
    g.fillStyle = '#fff6c0';
    g.beginPath();
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + (k / 10) * Math.PI * 2;
      const r = k % 2 ? 14 : 33;
      const x = 64 + Math.cos(a) * r, y = 64 + Math.sin(a) * r;
      if (k === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath(); g.fill();
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    return t;
  })();

  const coinGeo = new THREE.CylinderGeometry(0.46, 0.46, 0.115, 22);
  coinGeo.rotateX(Math.PI / 2);
  const coinMat = new THREE.MeshStandardMaterial({
    map: coinTex, color: 0xffffff,
    roughness: 0.3, metalness: 0.15,
    emissive: 0x9a6400, emissiveIntensity: 0.55
  });
  // 金币光晕：原版金币外面有一圈很亮的辉光，没有这个金币会显得很"死"
  const glowTex = (function () {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,246,190,1)');
    grad.addColorStop(0.28, 'rgba(255,206,60,.72)');
    grad.addColorStop(0.62, 'rgba(255,170,20,.20)');
    grad.addColorStop(1, 'rgba(255,160,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    return t;
  })();
  const glowMat = new THREE.SpriteMaterial({
    map: glowTex, color: 0xffffff, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false
  });

  function createCoin() {
    const mesh = new THREE.Mesh(coinGeo, coinMat);
    mesh.castShadow = true;
    addOutline(mesh);
    const glow = new THREE.Sprite(glowMat);
    glow.scale.set(2.05, 2.05, 1);
    mesh.add(glow);
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, active: false, spin: rand(0, 6.28), prevZ: 0, baseY: 0.95 };
  }

  /* ---------------- 对象池 ---------------- */
  const pools = { hurdle: [], bar: [], crate: [], train: [], ramp: [], coin: [] };
  const activeObs = [];
  const activeCoins = [];

  function takeOb(type) {
    const o = pools[type].pop() || createOb(type);
    o.active = true;
    o.mesh.visible = true;
    activeObs.push(o);
    return o;
  }
  function freeOb(o) {
    o.active = false;
    o.vz = 0;
    o.mesh.visible = false;
    pools[o.type].push(o);
  }
  function takeCoin() {
    const c = pools.coin.pop() || createCoin();
    c.active = true;
    c.mesh.visible = true;
    activeCoins.push(c);
    return c;
  }
  function freeCoin(c) {
    c.active = false;
    c.mesh.visible = false;
    pools.coin.push(c);
  }

  /* ---------------- 角色：Jake ---------------- */
  const playerGroup = new THREE.Group();
  scene.add(playerGroup);

  // 卡通描边：反向外壳，让角色从背景里跳出来
  // alpha=true 时走透明通道，供抓捕人淡出用（否则外壳会留一圈黑边不跟着淡）
  const mkOutlineMat = (thick, alpha) => new THREE.ShaderMaterial({
    uniforms: {
      thick: { value: thick },
      uColor: { value: new THREE.Color(0x1b2534) },
      uOpacity: { value: 1 }
    },
    vertexShader: [
      'uniform float thick;',
      'void main(){',
      '  vec3 p = position + normal * thick;',
      '  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);',
      '}'
    ].join('\n'),
    fragmentShader: 'uniform vec3 uColor; uniform float uOpacity; void main(){ gl_FragColor = vec4(pow(uColor, vec3(0.4545)), uOpacity); }',
    transparent: !!alpha,
    side: THREE.BackSide
  });
  const OUTLINE_MAT = mkOutlineMat(0.028);
  // 大体块（木箱 / 火车）用更粗的线，否则 2px 的线在远处等于没有
  const OUTLINE_MAT_BIG = mkOutlineMat(0.062);

  // 描边是每个零件多一个背面外壳，零件一多绘制批次就翻倍。
  // 细碎装饰（横条、接缝、车灯这种）标 userData.noOutline 跳过，看不出差别但省不少
  function addOutline(root, mat) {
    const OM = mat || OUTLINE_MAT;
    const list = [];
    root.traverse(o => {
      if (o.isMesh && !o.userData.noOutline &&
          o.material !== OUTLINE_MAT && o.material !== OUTLINE_MAT_BIG) list.push(o);
    });
    for (const m of list) {
      const shell = new THREE.Mesh(m.geometry, OM);
      shell.castShadow = false;
      shell.receiveShadow = false;
      m.add(shell);
    }
  }

  // 外层放大组：让角色在画面里更醒目（不影响碰撞盒）
  const runnerRoot = new THREE.Group();
  runnerRoot.scale.setScalar(1.08);
  playerGroup.add(runnerRoot);

  // 几何体缓存（按真实尺寸建，描边着色器依赖物体空间法线）
  const GEO = {};
  const sphereGeo = r => {
    const k = 'S' + r.toFixed(3);
    return GEO[k] || (GEO[k] = new THREE.SphereGeometry(r, 22, 16));
  };
  const capGeo2 = (r, len) => {
    const k = 'C' + r.toFixed(3) + '_' + len.toFixed(3);
    return GEO[k] || (GEO[k] = new THREE.CapsuleGeometry(r, len, 8, 18));
  };

  const runner = (function buildRunner() {
    const g = new THREE.Group();
    const M = (c, r) => new THREE.MeshStandardMaterial({ color: c, roughness: r === undefined ? 0.85 : r });

    // 配色对齐录屏里的角色：米白色帽子 + 红色帽檐 + 米白上衣 + 蓝色背带裤 + 黄绿色背包
    const matSkin = M(0xf3c8a0, 0.9);
    const matHair = M(0x5c3c1e, 0.95);
    const matCapW = M(0xf2e9d6, 0.78);
    const matCapR = M(0xc8332b, 0.72);
    const matHoodie = M(0xeae2d2, 0.88);
    const matHood = M(0xdcd3c1, 0.9);
    const matDenim = M(0x3f7cc0, 0.86);
    const matShirt = M(0xeae2d2, 0.88);
    const matJeans = M(0x4a9de0, 0.86);
    const matShoeG = M(0xf2ece0, 0.78);   // 鞋面：米白
    const matShoeR = M(0x3f74c8, 0.72);   // 鞋侧装饰条：蓝
    const matSole = M(0xc2a878, 0.9);     // 生胶鞋底
    const matGlove = M(0xe8873c, 0.86);   // 橙色手套（录屏里袖口露出的就是这截橙）
    const matPack = M(0xd2d63a, 0.78);
    const matPackDark = M(0x7f8f22, 0.84);
    const matEye = new THREE.MeshBasicMaterial({ color: 0x2a1e14 });

    const ball = (r, mat, x, y, z, sx, sy, sz) => {
      const m = new THREE.Mesh(sphereGeo(r), mat);
      m.position.set(x, y, z);
      m.scale.set(sx === undefined ? 1 : sx, sy === undefined ? 1 : sy, sz === undefined ? 1 : sz);
      m.castShadow = true;
      return m;
    };
    const capm = (r, len, mat, x, y, z) => {
      const m = new THREE.Mesh(capGeo2(r, len), mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      return m;
    };
    const tor = (r, tube, mat, x, y, z, rx) => {
      const m = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 10, 24), mat);
      m.position.set(x, y, z);
      if (rx !== undefined) m.rotation.x = rx;
      m.castShadow = true;
      return m;
    };

    /* ---------- 胯 / 躯干 ---------- */
    g.add(ball(0.215, matJeans, 0, 0.83, 0, 1.02, 0.8, 0.92));
    // 白色连帽卫衣躯干（前后压扁、左右加宽，才不像根圆筒）
    g.add(ball(0.238, matHoodie, 0, 1.19, 0, 1.05, 1.56, 0.80));
    // 胸口加宽一点，做出肩线，不然整体像个上下一般粗的雪人
    g.add(ball(0.246, matHoodie, 0, 1.36, 0, 1.06, 0.62, 0.76));
    // 卫衣下摆
    g.add(ball(0.245, matHoodie, 0, 0.90, 0, 1.0, 0.35, 0.82));
    // 红色内搭（正面露出一条）
    g.add(ball(0.20, matShirt, 0, 1.20, -0.075, 0.72, 1.15, 0.9));

    /* ---------- 牛仔马甲：后背壳 + 肩带 ---------- */
    g.add(ball(0.252, matDenim, 0, 1.20, 0.075, 1.03, 1.06, 0.72));
    g.add(capm(0.052, 0.13, matDenim, -0.175, 1.44, 0.01));
    g.add(capm(0.052, 0.13, matDenim, 0.175, 1.44, 0.01));

    /* ---------- 帽兜：脑后一块扁扁的折叠 + 领口一圈 ---------- */
    g.add(ball(0.188, matHood, 0, 1.398, 0.145, 1.0, 0.42, 0.60));
    g.add(tor(0.098, 0.024, matHood, 0, 1.458, 0.012, Math.PI / 2));

    /* ---------- 背包 ---------- */
    // 方一点的背包才像原版那个带图案的书包，圆球看着像气球
    const packBody = new THREE.Mesh(new THREE.BoxGeometry(0.285, 0.335, 0.165), matPack);
    packBody.position.set(0, 1.245, 0.238);
    packBody.castShadow = true;
    g.add(packBody);
    // 背包正面的图案块（原版是个黄绿色的印花）
    const packLogo = new THREE.Mesh(new THREE.BoxGeometry(0.185, 0.115, 0.03), matPackDark);
    packLogo.position.set(0, 1.30, 0.325);
    g.add(packLogo);
    // 背包盖 + 底兜
    const packFlap = new THREE.Mesh(new THREE.BoxGeometry(0.29, 0.09, 0.175), matPackDark);
    packFlap.position.set(0, 1.40, 0.238);
    g.add(packFlap);
    g.add(capm(0.030, 0.17, matPackDark, -0.128, 1.38, 0.12));
    g.add(capm(0.030, 0.17, matPackDark, 0.128, 1.38, 0.12));

    /* ---------- 脖子 ---------- */
    g.add(capm(0.072, 0.05, matSkin, 0, 1.55, 0));

    /* ---------- 头 ---------- */
    const head = new THREE.Group();
    head.position.set(0, 1.82, 0);
    // 头稍微收一点，避免头身比过于卡通
    head.scale.setScalar(0.93);
    head.add(ball(0.298, matSkin, 0, 0, 0, 1, 1.0, 0.97));

    // 帽冠拆成前后两片：前沿停在眉毛上方，后沿压到后脑勺，
    // 这样从背后看是一顶完整的帽子，而不是"棕球 + 白顶"
    const capFront = new THREE.Mesh(
      new THREE.SphereGeometry(0.316, 26, 16, Math.PI, Math.PI, 0, Math.PI * 0.46),
      matCapW
    );
    capFront.castShadow = true;
    head.add(capFront);
    const capBack = new THREE.Mesh(
      new THREE.SphereGeometry(0.316, 26, 16, 0, Math.PI, 0, Math.PI * 0.60),
      matCapW
    );
    capBack.castShadow = true;
    head.add(capBack);
    // 录屏里从背后看是"白色帽身 + 头顶后上方压着一块红"：
    // 像毛线帽翻折出来的红色边，不是棒球帽檐
    const capRed = ball(0.172, matCapR, 0, 0.258, 0.062, 1.12, 0.42, 1.02);
    capRed.rotation.x = 0.24;
    head.add(capRed);
    // 帽顶扣
    head.add(ball(0.038, matCapW, 0, 0.318, 0.02, 1, 0.85, 1));
    // 后脑头发：只在帽子下沿露出一圈
    const napeHair = new THREE.Mesh(
      new THREE.SphereGeometry(0.303, 24, 16, -Math.PI * 0.16, Math.PI * 1.32, Math.PI * 0.50, Math.PI * 0.29),
      matHair
    );
    napeHair.castShadow = true;
    head.add(napeHair);
    // 鬓角
    head.add(ball(0.062, matHair, -0.263, -0.055, -0.075, 0.72, 1.15, 0.9));
    head.add(ball(0.062, matHair, 0.263, -0.055, -0.075, 0.72, 1.15, 0.9));
    // 眼睛
    head.add(ball(0.036, matEye, -0.104, -0.072, -0.272, 1, 1.2, 0.6));
    head.add(ball(0.036, matEye, 0.104, -0.072, -0.272, 1, 1.2, 0.6));
    g.add(head);

    /* ---------- 手臂（肩 + 肘） ---------- */
    const mkArm = side => {
      const sh = new THREE.Group();
      // 肩点外移，让手臂能从躯干两侧露出来（原来被躯干吃掉了一半）
      sh.position.set(side * 0.272, 1.385, 0);
      sh.add(ball(0.086, matHoodie, 0, 0, 0));
      sh.add(capm(0.076, 0.14, matHoodie, 0, -0.11, 0));
      const el = new THREE.Group();
      el.position.set(0, -0.22, 0);
      el.add(capm(0.068, 0.13, matHoodie, 0, -0.10, 0));
      el.add(tor(0.066, 0.019, matDenim, 0, -0.155, 0, Math.PI / 2));
      // 手掌：掌 + 拇指，比单个球更像手
      el.add(ball(0.074, matGlove, 0, -0.215, 0, 1, 0.92, 1.1));
      el.add(ball(0.033, matGlove, side * 0.052, -0.198, -0.030, 0.9, 0.9, 1.25));
      sh.add(el);
      g.add(sh);
      return { sh, el };
    };

    /* ---------- 腿（胯 + 膝） ---------- */
    const mkLeg = side => {
      const hip = new THREE.Group();
      hip.position.set(side * 0.118, 0.86, 0);
      hip.add(capm(0.089, 0.20, matJeans, 0, -0.15, 0));
      const knee = new THREE.Group();
      knee.position.set(0, -0.34, 0);
      knee.add(capm(0.079, 0.20, matJeans, 0, -0.18, 0));
      // 脚踝单独成组：脚掌能随步态压/翘，落地那一下才看得出"蹬地"
      const ankle = new THREE.Group();
      ankle.position.set(0, -0.40, 0);
      const shoe = new THREE.Mesh(capGeo2(0.085, 0.11), matShoeG);
      shoe.rotation.x = Math.PI / 2;
      shoe.position.set(0, -0.02, -0.05);
      shoe.castShadow = true;
      ankle.add(shoe);
      ankle.add(ball(0.072, matShoeR, 0, -0.025, -0.175, 1, 0.85, 0.95));
      ankle.add(ball(0.095, matSole, 0, -0.078, -0.05, 1.06, 0.3, 1.24));
      knee.add(ankle);
      hip.add(knee);
      g.add(hip);
      return { hip, knee, ankle };
    };

    const mats = {
      skin: matSkin, hair: matHair, capW: matCapW, capR: matCapR,
      hoodie: matHoodie, hood: matHood, denim: matDenim, shirt: matShirt,
      jeans: matJeans, shoeG: matShoeG, shoeR: matShoeR, sole: matSole,
      pack: matPack, packDark: matPackDark, glove: matGlove
    };
    return { group: g, armL: mkArm(-1), armR: mkArm(1), legL: mkLeg(-1), legR: mkLeg(1), head, mats };
  })();
  runnerRoot.add(runner.group);
  addOutline(runner.group);
  playerGroup.add(runner.group);

  /* ---------------- 追捕的警察 ---------------- */
  // 原版里开局有个警察在后面追，撞到障碍时扑上来抓人。
  // 他站在相机和角色之间（z 为正），所以天生显得比角色大一圈，正好有压迫感
  const OUTLINE_MAT_GUARD = mkOutlineMat(0.030, true);

  const guard = (function buildGuard() {
    const g = new THREE.Group();
    const mats = [];
    const M = (c, r) => {
      const m = new THREE.MeshStandardMaterial({
        color: c, roughness: r === undefined ? 0.85 : r,
        transparent: true, opacity: 1
      });
      mats.push(m);
      return m;
    };

    const matCoat  = M(0x474d64, 0.84);   // 深灰蓝呢大衣（对齐录屏里的警察）
    const matCoatD = M(0x2e3244, 0.86);   // 暗部 / 裤子
    const matShirt = M(0xadc7e0, 0.86);   // 浅蓝衬衫
    const matSkin  = M(0xe9b68c, 0.90);
    const matMous  = M(0x53381f, 0.95);   // 大胡子
    const matCap   = M(0x363a4e, 0.80);
    const matBrim  = M(0x1b2334, 0.60);
    const matGold  = M(0xd7ac48, 0.42);
    const matBelt  = M(0x3b2a1a, 0.90);
    const matBoot  = M(0x24242e, 0.70);
    const matEye   = new THREE.MeshBasicMaterial({ color: 0x201408, transparent: true, opacity: 1 });
    mats.push(matEye);

    const ball = (r, mat, x, y, z, sx, sy, sz) => {
      const m = new THREE.Mesh(sphereGeo(r), mat);
      m.position.set(x, y, z);
      m.scale.set(sx === undefined ? 1 : sx, sy === undefined ? 1 : sy, sz === undefined ? 1 : sz);
      m.castShadow = true;
      return m;
    };
    const capm = (r, len, mat, x, y, z) => {
      const m = new THREE.Mesh(capGeo2(r, len), mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      return m;
    };
    const box = (w, h, d, mat, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      return m;
    };

    /* ---------- 胯 / 大肚子 ---------- */
    g.add(ball(0.235, matCoatD, 0, 0.86, 0, 1.06, 0.74, 0.94));
    g.add(ball(0.285, matCoat, 0, 1.10, 0, 1.06, 0.99, 0.97));      // 啤酒肚
    g.add(ball(0.255, matCoat, 0, 1.41, 0, 1.10, 0.88, 0.88));      // 胸
    g.add(ball(0.262, matCoat, 0, 1.47, 0, 1.14, 0.50, 0.82));      // 肩线
    g.add(ball(0.205, matShirt, 0, 1.42, -0.105, 0.60, 0.94, 0.72)); // 前襟衬衫

    // 皮带 + 铜扣
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.246, 0.036, 8, 22), matBelt);
    belt.rotation.x = Math.PI / 2;
    belt.position.set(0, 0.92, 0);
    belt.scale.set(1.05, 1.05, 1.0);
    g.add(belt);
    g.add(box(0.105, 0.095, 0.035, matGold, 0, 0.92, -0.245));
    // 制服铜扣
    g.add(ball(0.028, matGold, 0, 1.24, -0.252, 1, 1, 0.6));
    g.add(ball(0.028, matGold, 0, 1.36, -0.238, 1, 1, 0.6));
    // 肩章
    g.add(box(0.15, 0.038, 0.135, matGold, -0.245, 1.505, 0));
    g.add(box(0.15, 0.038, 0.135, matGold, 0.245, 1.505, 0));
    // 胸袋
    g.add(box(0.115, 0.10, 0.02, matCoatD, -0.155, 1.34, -0.222));
    g.add(box(0.115, 0.10, 0.02, matCoatD, 0.155, 1.34, -0.222));

    /* ---------- 脖子 / 头 ---------- */
    g.add(capm(0.088, 0.045, matSkin, 0, 1.575, 0));

    const head = new THREE.Group();
    head.position.set(0, 1.80, 0);
    head.scale.setScalar(0.97);
    head.add(ball(0.288, matSkin, 0, 0, 0, 1, 1.0, 0.97));
    // 双下巴 / 腮帮子，脸要方一点才像个中年警察
    head.add(ball(0.145, matSkin, -0.125, -0.135, -0.145, 1.0, 0.85, 1.0));
    head.add(ball(0.145, matSkin, 0.125, -0.135, -0.145, 1.0, 0.85, 1.0));
    // 鼻子
    head.add(ball(0.072, matSkin, 0, -0.005, -0.278, 1, 1.0, 1.1));
    // 大胡子：两撇 + 中间鼻下的一小段
    head.add(ball(0.105, matMous, -0.098, -0.108, -0.228, 1.15, 0.52, 0.82));
    head.add(ball(0.105, matMous, 0.098, -0.108, -0.228, 1.15, 0.52, 0.82));
    head.add(ball(0.052, matMous, 0, -0.088, -0.252, 1.5, 0.5, 0.7));
    // 眼睛 / 眉毛
    head.add(ball(0.030, matEye, -0.098, 0.042, -0.263, 1, 1.15, 0.55));
    head.add(ball(0.030, matEye, 0.098, 0.042, -0.263, 1, 1.15, 0.55));
    head.add(box(0.085, 0.026, 0.03, matMous, -0.100, 0.098, -0.256));
    head.add(box(0.085, 0.026, 0.03, matMous, 0.100, 0.098, -0.256));
    // 耳朵
    head.add(ball(0.058, matSkin, -0.278, -0.005, -0.02, 0.6, 1.0, 0.85));
    head.add(ball(0.058, matSkin, 0.278, -0.005, -0.02, 0.6, 1.0, 0.85));

    // 大檐帽：帽冠 + 帽墙 + 黑帽檐 + 金徽
    const crown = new THREE.Mesh(
      new THREE.SphereGeometry(0.292, 26, 16, 0, Math.PI * 2, 0, Math.PI * 0.50),
      matCap
    );
    crown.position.y = 0.028;
    crown.scale.set(1.02, 1.06, 1.02);
    crown.castShadow = true;
    head.add(crown);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.293, 0.299, 0.085, 26), matBrim);
    band.position.y = 0.055;
    head.add(band);
    const brim = ball(0.192, matBrim, 0, 0.070, -0.232, 1.46, 0.15, 0.98);
    brim.rotation.x = 0.20;
    head.add(brim);
    head.add(box(0.078, 0.090, 0.032, matGold, 0, 0.215, -0.222));
    head.add(ball(0.034, matGold, 0, 0.310, 0, 1, 0.7, 1));
    g.add(head);

    /* ---------- 手臂（肩 + 肘） ---------- */
    const mkArm = side => {
      const sh = new THREE.Group();
      sh.position.set(side * 0.345, 1.44, 0);   // 肩点外移，否则手臂埋进大衣里看不见
      sh.add(ball(0.098, matCoat, 0, 0, 0));
      sh.add(capm(0.088, 0.16, matCoat, 0, -0.13, 0));
      const el = new THREE.Group();
      el.position.set(0, -0.26, 0);
      el.add(capm(0.080, 0.15, matCoat, 0, -0.11, 0));
      el.add(ball(0.052, matShirt, 0, -0.225, 0, 1.1, 0.5, 1.1));   // 袖口露出的衬衫
      el.add(ball(0.082, matSkin, 0, -0.285, 0, 1, 0.92, 1.1));     // 手
      el.add(ball(0.036, matSkin, side * 0.058, -0.268, -0.032, 0.9, 0.9, 1.25));
      sh.add(el);
      g.add(sh);
      return { sh, el };
    };

    /* ---------- 腿（胯 + 膝） ---------- */
    const mkLeg = side => {
      const hip = new THREE.Group();
      hip.position.set(side * 0.135, 0.84, 0);
      hip.add(capm(0.102, 0.22, matCoatD, 0, -0.16, 0));
      const knee = new THREE.Group();
      knee.position.set(0, -0.36, 0);
      knee.add(capm(0.090, 0.20, matCoatD, 0, -0.18, 0));
      // 皮鞋：靴筒 + 鞋头
      knee.add(box(0.165, 0.13, 0.20, matBoot, 0, -0.375, 0));
      knee.add(ball(0.092, matBoot, 0, -0.415, -0.095, 1.05, 0.72, 1.35));
      hip.add(knee);
      g.add(hip);
      return { hip, knee };
    };

    /* ---------- 警犬（录屏里警察身边一直跟着一条白狗） ---------- */
    const matDog  = M(0xe9e5dd, 0.88);
    const matDogD = M(0xbdb6a9, 0.90);
    const matDogN = M(0x2a2420, 0.70);

    const dogG = new THREE.Group();
    const dogBody = capm(0.138, 0.30, matDog, 0, 0.42, 0.02);
    dogBody.rotation.x = Math.PI / 2;
    dogG.add(dogBody);
    dogG.add(ball(0.148, matDog, 0, 0.43, -0.20, 1, 1, 1));
    dogG.add(ball(0.142, matDog, 0, 0.42, 0.22, 1, 1, 1));
    const dogNeck = capm(0.086, 0.10, matDog, 0, 0.50, -0.28);
    dogNeck.rotation.x = Math.PI / 2 - 0.35;
    dogG.add(dogNeck);
    dogG.add(ball(0.125, matDog, 0, 0.575, -0.395, 1, 0.95, 1.02));
    dogG.add(ball(0.076, matDogD, 0, 0.535, -0.495, 1, 0.82, 1.30));   // 嘴
    dogG.add(ball(0.038, matDogN, 0, 0.552, -0.560, 1, 0.85, 0.9));    // 鼻头
    dogG.add(ball(0.026, matEye, -0.063, 0.612, -0.470, 1, 1.1, 0.6));
    dogG.add(ball(0.026, matEye, 0.063, 0.612, -0.470, 1, 1.1, 0.6));
    // 垂耳
    const earL = ball(0.062, matDogD, -0.092, 0.640, -0.350, 0.55, 1.20, 0.85);
    const earR = ball(0.062, matDogD, 0.092, 0.640, -0.350, 0.55, 1.20, 0.85);
    earL.rotation.z = 0.32; earR.rotation.z = -0.32;
    dogG.add(earL); dogG.add(earR);
    // 尾巴
    const tail = capm(0.034, 0.17, matDog, 0, 0.545, 0.345);
    tail.rotation.x = -0.95;
    dogG.add(tail);

    const dogLegs = [];
    for (const lz of [-0.155, 0.195]) {
      for (const lx of [-0.088, 0.088]) {
        const hip = new THREE.Group();
        hip.position.set(lx, 0.32, lz);
        hip.add(capm(0.040, 0.17, matDogN, 0, -0.10, 0));
        hip.add(ball(0.046, matDog, 0, -0.195, -0.012, 1, 0.72, 1.25));  // 爪
        dogG.add(hip);
        dogLegs.push({ g: hip, ph: (lz < 0 ? 0 : Math.PI) + (lx < 0 ? Math.PI : 0) });
      }
    }
    dogG.position.set(0.96, 0, -0.62);
    dogG.rotation.y = -0.92;   // 侧一点，从背后才看得出是条狗
    dogG.scale.setScalar(1.08);
    g.add(dogG);

    return { group: g, armL: mkArm(-1), armR: mkArm(1), legL: mkLeg(-1), legR: mkLeg(1), head, mats, dogG, dogLegs, tail };
  })();

  const guardRoot = new THREE.Group();
  guardRoot.scale.setScalar(0.86);   // 相机离得近，缩一点才不会被撑满画面
  guardRoot.add(guard.group);
  guardRoot.visible = false;
  scene.add(guardRoot);
  addOutline(guard.group, OUTLINE_MAT_GUARD);

  // 抓捕人的状态：hidden / intro（开局追一段）/ chase（逮住过一次，吊在身后）
  //               / leave（追了 10 秒没再得手，放弃退场）/ crash（扑上来抓人）
  const GUARD_Z = 1.95;
  const GUARD_X = 0.62;   // 稍微偏到角色右侧，免得正好挡住他的腿
  const GUARD_LIFE = 10;  // 逮住一次后只在身后纠缠 10 秒，追不上就走了
  let guardMode = 'hidden';
  let guardT = 0;
  let guardPhase = 0;
  let guardZ = GUARD_Z;
  let guardFade = 1;
  let guardReach = 0;
  let guardLife = 0;      // chase 状态的剩余纠缠时间

  // 两段式判定：第一次撞只是被追捕者逮住（游戏继续），再撞一次才是终局
  let hasGuard = false;   // 已经被追捕者盯上
  let stumbleT = 0;       // 撞击后的踉跄动画倒计时
  let invT = 0;           // 撞击后的无敌时间，避免同一个障碍连撞好几帧
  let slowMul = 1;        // 撞击后的速度惩罚，慢慢回到 1

  // 开场动画：镜头从贴地近景拉回正常机位（1.35 秒），期间速度从 0.45 倍起步
  const INTRO_DUR = 1.35;
  let introT = INTRO_DUR;

  // 阴影承接面
  const shadowCatcher = new THREE.Mesh(
    new THREE.PlaneGeometry(190, 230),
    new THREE.ShadowMaterial({ opacity: 0.34 })
  );
  shadowCatcher.rotation.x = -Math.PI / 2;
  shadowCatcher.position.set(0, 0.245, -45);   // 要高于枕木顶面(0.22)，否则影子被枕木切成碎块
  shadowCatcher.receiveShadow = true;
  scene.add(shadowCatcher);

  // 落地阴影贴片
  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(0.55, 24),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false })
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.25;
  scene.add(blob);

  /* ---------------- 游戏状态 ---------------- */
  const player = {
    lane: 1, x: 0, y: 0, vy: 0,
    onGround: true, sliding: false, slideT: 0,
    height: PLAYER_H, runPhase: 0,
    flipT: 0,      // 起跳后累计的时间，用来驱动前空翻
    landT: 0       // 落地缓冲倒计时
  };
  const FLIP_DUR = 0.58;   // 空翻一圈用多久（略短于滞空的 0.667 秒）
  let state = 'ready';
  let speed = SPEED_START;
  let travel = 0;
  let coinCount = 0;
  let score = 0;
  let spawnTimer = 1.0;
  const rowStat = { one: 0, two: 0, threeH: 0, threeB: 0, train: 0, corridor: 0, flow: 0, moving: 0 };
  let jumpBuf = 0;
  let slideBuf = 0;
  let finalDist = 0;
  let crashT = 0;
  let shakeT = 0;
  let noSpawn = false;   // 调试用：关掉自动生成
  let godMode = /[?&]god=1/.test(location.search);   // 调试用：撞不死，方便统计生成节奏
  const charCam = /[?&]charcam=1/.test(location.search);   // 调试用：角色特写机位
  let best = 0;
  try { best = parseInt(localStorage.getItem('subway_best') || '0', 10) || 0; } catch (e) { best = 0; }

  /* ---------------- UI ---------------- */
  const elScore = document.getElementById('score');
  const elToast = document.getElementById('toast');
  let toastTimer = 0;
  function showToast(msg, dur) {
    if (!elToast) return;
    elToast.textContent = msg;
    elToast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => elToast.classList.remove('show'), dur || 2300);
  }
  const elDist = document.getElementById('dist');
  const elCoins = document.getElementById('coins');
  const overlay = document.getElementById('overlay');
  const elHud = document.getElementById('hud');
  const cardStart = document.getElementById('cardStart');
  const cardOver = document.getElementById('cardOver');
  const cardPause = document.getElementById('cardPause');
  const cardChars = document.getElementById('cardChars');
  const cardShop = document.getElementById('cardShop');
  const oScore = document.getElementById('oScore');
  const oDist = document.getElementById('oDist');
  const oCoins = document.getElementById('oCoins');
  const oBest = document.getElementById('oBest');

  function showCard(which) {
    [cardStart, cardOver, cardPause, cardChars, cardShop].forEach(c => c.classList.add('hidden'));
    // 主菜单是全屏布局，暗角要淡一点，不然两侧按钮糊成一片
    overlay.classList.toggle('menu-mode', which === cardStart);
    // 主菜单/角色/商店有自己的资源显示，游戏里的分数/金币 HUD 收起来
    if (elHud) elHud.classList.toggle('off', which === cardStart || which === cardChars || which === cardShop);
    if (which) {
      overlay.classList.remove('hide');
      which.classList.remove('hidden');
      if (which === cardStart) renderMenu();
    } else {
      overlay.classList.add('hide');
    }
  }

  /* ---- 关卡分段：录屏里的关卡是"一段一段"的，不是每行掷一次骰子 ----
     corridor 段：两侧连续排着车厢、只留一条缝，人贴着车流跑（录屏 0~12s、70~80s）
     open 段：开阔路面，只有矮障碍和金币，迎面火车在这儿冲过来（录屏 30s、78s）
     长度用"米"计而不是"秒"，速度涨上去以后空间布局才稳定 */
  let sect = 'corridor';        // 'corridor' | 'open'
  let sectT = 0;                // 本段还剩多少米
  let sectWalls = [0, 2];       // corridor 段被车厢占住的车道
  let sectFree = 1;             // corridor 段留出的那条缝
  let sectVz = 0;               // corridor 段车厢自己的速度：>0 就是"车流段"
  // 迎面火车占用某条车道时要锁一段时间：这条道上不能再生成静态车厢，
  // 否则快车会从后面追上前车、直接穿模过去
  const laneLock = [0, 0, 0];
  let mtTimer = 1.6;            // 距离下一列迎面火车还有多少秒
  let mtBudget = 0;             // 本段开阔路面还能放几列迎面火车
  let cObsCool = 0;             // 走廊缝里的矮障碍冷却：隔一行才放一个

  /* ---------------- 障碍生成 ---------------- */
  function spawnObstacle(type, lane, z, flip, vz) {
    const o = takeOb(type);
    o.mesh.position.set(LANES[lane], 0, z);
    o.vz = vz || 0;
    // 坡道转 180° 就是下坡（楔形左右对称，转过来不会变形）
    o.flip = !!flip;
    o.mesh.rotation.y = o.flip ? Math.PI : 0;
    o.prevZ = z;
    if (type === 'train' && o.tint) {
      const c = pick(TRAIN_COLORS);
      o.tint.material.color.setHex(c).multiplyScalar(0.66);
      if (o.bodyTint) o.bodyTint.material.color.setHex(c);
    }
    return o;
  }

  function addCoin(x, y, z) {
    const c = takeCoin();
    c.baseY = y;
    c.mesh.position.set(x, y, z);
    c.prevZ = z;
    return c;
  }

  // 给一整列（可能多节）车厢接坡道：zRear 是车尾、zFront 是车头。
  // 顺手在坡面和整条车顶撒金币，等于给玩家画了条"这儿能上去"的路线
  function attachRamps(lane, zRear, zFront) {
    const rd = OB_DEF.ramp.d, rh = OB_DEF.ramp.h, sl = rd - RAMP_LAND;
    const th = OB_DEF.train.h;

    // 车尾上坡：高端齐车顶
    const rz = zRear + rd / 2;
    spawnObstacle('ramp', lane, rz, false);
    for (const t of [0.34, 0.80]) {
      addCoin(LANES[lane], rh * t + 0.95, rz + rd / 2 - sl * t);
    }

    // 车头下坡：反着放，高端贴在车头
    const dz = zFront - rd / 2;
    spawnObstacle('ramp', lane, dz, true);
    for (const t of [0.30, 0.72]) {
      addCoin(LANES[lane], rh * t + 0.95, dz - rd / 2 + sl * t);
    }

    // 金币别铺太密：光晕是加法混合的，三条车道并排时挤在一起会糊成一堵光墙
    for (let z = zRear - 2.6; z > zFront + 2.0; z -= 5.60) {
      addCoin(LANES[lane], th + 0.95, z);
    }
  }

  // 一整列火车：同一条轨道上连着 cars 节车厢，两头各接一段坡道。
  // 车顶连成一条长通道，跑上去以后能在顶上待好几秒，而不是一闪而过
  function spawnTrainLane(lane, cars, z0) {
    const td = OB_DEF.train.d, rd = OB_DEF.ramp.d;
    const zRear0 = z0 === undefined ? SPAWN_Z : z0;
    for (let k = 0; k < cars; k++) {
      const o = spawnObstacle('train', lane, zRear0 - k * td);
      // 按车道+节号定色，保证相邻车道颜色一定不同 —— 车顶上换道时靠颜色分辨左右
      if (o.tint) {
        const c = TRAIN_COLORS[(lane * 2 + k) % TRAIN_COLORS.length];
        o.tint.material.color.setHex(c).multiplyScalar(0.66);
        if (o.bodyTint) o.bodyTint.material.color.setHex(c);
      }
    }
    attachRamps(lane, zRear0 + td / 2, zRear0 - (cars - 1) * td - td / 2);
    return cars * td + 2 * rd;
  }

  // 会开的火车：原版里迎面冲过来的那几列 —— 它们比地面滚得快，
  // 会在你还没跑到之前就贴上来，是整关最有压迫感的东西。
  // 只在"这条道前方没有静止车厢"的道上生成，并且把这条道锁住几秒，
  // 否则它会在自己那条线上追上刚生成的车厢、直接穿模过去
  let mtSpawned = 0, mtTried = 0;
  function spawnMovingTrain(want) {
    mtTried++;
    const td = OB_DEF.train.d;
    const z0 = SPAWN_Z - 30;

    // 永远留一条道不放迎面火车：三条道一起冲过来就是必死
    let locked = 0;
    for (let i = 0; i < 3; i++) if (laneLock[i] > 0) locked++;
    const n = Math.min(want || 1, 2, 3 - locked - 1);
    if (n <= 0) return 0;

    const used = [];
    let total = 0;
    for (let k = 0; k < n; k++) {
      let placed = false;
      for (const lane of shuffle([0, 1, 2])) {
        if (used.indexOf(lane) >= 0 || laneLock[lane] > 0) continue;
        // 只有"生成点前方这一段"里的车厢会被快车追上 —— 更远的那些会先跑到
        // 玩家身后被回收，追不上。这条界线由速度反推，所以越跑越快时它也跟着前移
        const danger = (DESPAWN_Z * 13 + speed * z0) / (speed + 13);
        let clear = true;
        for (let i = 0; i < activeObs.length; i++) {
          const o = activeObs[i];
          if (o.vz || o.type === 'ramp') continue;
          if (Math.abs(o.mesh.position.x - LANES[lane]) > 1.6) continue;
          if (o.mesh.position.z - o.d / 2 < danger) { clear = false; break; }
        }
        if (!clear) continue;

        const cars = 1 + randInt(2);
        const vz = rand(8, 13);
        for (let c = 0; c < cars; c++) spawnObstacle('train', lane, z0 - c * td, false, vz);
        used.push(lane);
        // 只要车尾越过生成线就可以解锁了：之后新生成的车厢在它后面、
        // 而且比它慢，永远追不上，所以不用锁满整趟
        const rear = -z0 + (cars - 1) * td + td / 2 - Math.abs(SPAWN_Z);
        laneLock[lane] = Math.max(0.7, rear / (speed + vz)) + 0.45;
        total += cars * td;
        placed = true;
        break;
      }
      if (!placed) break;
    }

    if (total > 0) { mtSpawned++; rowStat.moving++; }
    return total;
  }

  // 开阔段的一行：矮障碍为主，偶尔来一组静止车厢当路障，
  // 迎面火车由外面的计时器单独安排
  function openRow(base) {
    const occ = [0, 0, 0];
    let len = 12;
    const r = Math.random();

    if (r < 0.18) {
      // 一组静止车厢：两道并排（车顶跑酷）或单道堵路
      rowStat.train++;
      const lanes = Math.random() < 0.42 ? pick([[0, 1], [1, 2]]) : [pick([0, 1, 2])];
      const cars = 2 + randInt(2);
      for (const ln of lanes) {
        len = Math.max(len, spawnTrainLane(ln, cars, base));
        occ[ln] = 1;
      }
    } else {
      const q = (r - 0.18) / 0.82;
      let cells = [null, null, null];
      if (q < 0.34) {
        rowStat.one++;
        cells[randInt(3)] = pick(['hurdle', 'bar', 'crate']);
      } else if (q < 0.60) {
        rowStat.two++;
        const ls = shuffle([0, 1, 2]).slice(0, 2);
        cells[ls[0]] = pick(['hurdle', 'bar', 'crate']);
        cells[ls[1]] = pick(['hurdle', 'bar', 'crate']);
      } else if (q < 0.80) {
        rowStat.threeH++;
        cells = ['hurdle', 'hurdle', 'hurdle'];
      } else {
        rowStat.threeB++;
        cells = ['bar', 'bar', 'bar'];
      }
      for (let i = 0; i < 3; i++) {
        if (!cells[i] || laneLock[i] > 0) continue;   // 有迎面火车在跑的道要留空
        spawnObstacle(cells[i], i, base);
        occ[i] = 1;
      }
    }

    // 空着的道撒一串金币
    const free = [];
    for (let i = 0; i < 3; i++) if (!occ[i] && laneLock[i] <= 0) free.push(i);
    if (free.length && Math.random() < 0.95) {
      const lane = pick(free);
      const n = 3 + randInt(3);
      for (let k = 0; k < n; k++) addCoin(LANES[lane], 0.95, base + 7.5 + k * 2.95);
    }

    spawnTimer = len / speed + rand(0.55, 0.85);
    return len;
  }

  // 走廊段的一行：占住的道连着排车厢，留出的那条缝里放矮障碍和金币
  function corridorRow(base) {
    const td = OB_DEF.train.d;
    const cars = 2 + randInt(2);
    const len = cars * td;

    // 约四分之一的行接坡道：给玩家一个跑上车顶长通道的机会。
    // 车流段不接坡道 —— 坡道是地形，不能跟着车厢一起跑
    const rampLane = (sectVz === 0 && Math.random() < 0.26) ? pick(sectWalls) : -1;
    for (const ln of sectWalls) {
      if (ln === rampLane) { spawnTrainLane(ln, cars, base); continue; }
      for (let k = 0; k < cars; k++) spawnObstacle('train', ln, base - k * td, false, sectVz);
    }
    rowStat.corridor++;
    if (sectVz > 0) rowStat.flow++;

    // 缝里放矮障碍，但必须隔一行才放一个 —— 走廊里行距只有 20 米出头，
    // 连着两行都是栅栏的话，起跳落地就得立刻再起跳，根本来不及
    if (cObsCool > 0) cObsCool--;
    else if (Math.random() < 0.72) {
      spawnObstacle(pick(['hurdle', 'bar']), sectFree, base);
      cObsCool = 1;
    }
    // 缝里撒金币；单侧走廊时另一条空道也撒一串，否则整条道空荡荡的
    const coinLanes = [sectFree];
    if (sectWalls.length === 1) {
      for (let i = 0; i < 3; i++) if (sectWalls.indexOf(i) < 0 && i !== sectFree) coinLanes.push(i);
    }
    for (const cl of coinLanes) {
      if (Math.random() > 0.9) continue;
      const n = 3 + randInt(3);
      for (let k = 0; k < n; k++) addCoin(LANES[cl], 0.95, base + 7.5 + k * 2.95);
    }

    // 行距按"车厢相对地面的速度"算：车流段的车跑得更快，
    // 生成得也得跟得上，否则墙上会裂出一道道缝
    const rel = speed + sectVz;
    spawnTimer = len / rel + (rampLane >= 0 ? rand(0.34, 0.46) : rand(0.02, 0.10));
    return len;
  }

  // z0 默认是生成线；预铺开场路面时会传一个更近的 z
  function spawnRow(z0) {
    const base = z0 === undefined ? SPAWN_Z : z0;

    /* ---- 段切换 ---- */
    if (sectT <= 0) {
      if (sect === 'corridor') {
        sect = 'open';
        sectT = rand(320, 430);
        // 开阔段一开始就排 3~4 列迎面火车：这段是整关最"有车"的地方
        mtBudget = 3 + randInt(2);
        mtTimer = rand(1.0, 1.9);
      } else {
        let canCorridor = true;
        // 有迎面火车在跑就先别开走廊，等它过去
        for (let i = 0; i < 3; i++) if (laneLock[i] > 0) canCorridor = false;

        if (canCorridor) {
          // 只占一条道的走廊占多数（看着才不闷），两条道夹一条缝的是少数。
          // 两道全占的时候视野只剩一条缝，连着来太久会很难受
          const m = Math.random();
          let walls, free;
          if (m < 0.30) { walls = [pick([0, 2])]; free = 1; }
          else if (m < 0.42) { walls = [0]; free = pick([1, 2]); }
          else if (m < 0.54) { walls = [2]; free = pick([0, 1]); }
          else if (m < 0.80) { walls = [0, 2]; free = 1; }
          else if (m < 0.92) { walls = [0, 1]; free = 2; }
          else { walls = [1, 2]; free = 0; }

          // 车流段：整条道的车厢一起比地面跑得快，会从身边超过去。
          // 只在单侧走廊里开 —— 两侧同时有车呼啸而过太闹，视野也容易糊
          const mvz = (walls.length === 1 && Math.random() < 0.52) ? rand(6, 12) : 0;

          // 车流段开闸前，把占住的道上"刚生成、还没跑近"的静止车厢清掉 ——
          // 它们都在雾里（z < -110），删掉看不出来；不清的话更快的车流会
          // 从后面追上它们，直接穿模过去
          if (mvz > 0) {
            const dc = (DESPAWN_Z * 12 + speed * SPAWN_Z) / (speed + 12);
            for (let i = activeObs.length - 1; i >= 0; i--) {
              const o = activeObs[i];
              if (o.vz || o.type === 'ramp') continue;
              if (o.mesh.position.z - o.d / 2 > dc) continue;
              let onWall = false;
              for (const ln of walls) if (Math.abs(o.mesh.position.x - LANES[ln]) < 1.6) onWall = true;
              if (!onWall) continue;
              freeOb(o);
              activeObs.splice(i, 1);
            }
          }

          sect = 'corridor';
          sectT = rand(85, 120);
          sectWalls = walls; sectFree = free; sectVz = mvz;
        }
        if (sect !== 'corridor') sectT = 45;   // 等迎面火车跑过去再说
      }
    }

    if (sect === 'corridor') corridorRow(base);
    else openRow(base);

    // 行距换算成米，从本段剩余长度里扣掉（车流段按车厢自己的速度算）
    sectT -= (sect === 'corridor' ? speed + sectVz : speed) * spawnTimer;
  }

  /* ---------------- 重置 ---------------- */
  function resetGame() {
    while (activeObs.length) freeOb(activeObs.pop());
    while (activeCoins.length) freeCoin(activeCoins.pop());

    player.lane = 1; player.x = 0; player.y = 0; player.vy = 0;
    player.onGround = true; player.sliding = false; player.slideT = 0;
    player.height = PLAYER_H; player.runPhase = 0;
    player.flipT = 0; player.landT = 0;
    runner.group.rotation.set(0, 0, 0);
    runner.group.scale.set(1, 1, 1);
    runner.group.position.set(0, 0, 0);
    playerGroup.position.set(0, 0, 0);

    speed = SPEED_START;
    travel = 0; coinCount = 0; score = 0;
    spawnTimer = 0.9; jumpBuf = 0; slideBuf = 0;
    crashT = 0; shakeT = 0; finalDist = 0;
    hasGuard = false; stumbleT = 0; invT = 0; slowMul = 1;
    if (elToast) elToast.classList.remove('show');

    // 开局先来一段单侧车厢：左边一列车贴着跑，右边是房子和栅栏，
    // 一上来就能看清远处 —— 两侧全堵的开局太闷
    sect = 'corridor'; sectWalls = [0]; sectFree = 1; sectVz = 0;
    for (let i = 0; i < 3; i++) laneLock[i] = 0;
    mtTimer = 1.4; mtBudget = 0; cObsCool = 4;   // 开局前 90 米先别放障碍，给玩家一点反应时间
    let fz = -12;
    while (fz > -105) fz -= corridorRow(fz);
    sectT = 58;         // 开局这段走廊只跑两秒多就换成开阔段

    for (let i = 0; i < SLEEPER_N; i++) sleeperZ[i] = 12 - i * SLEEPER_GAP;
    layoutSleepers();

    // 抓捕人：先藏起来，开局再放出来追
    guardMode = 'hidden'; guardT = 0; guardPhase = 0;
    guardZ = GUARD_Z; guardFade = 1; guardReach = 0; guardLife = 0;
    guardRoot.visible = false;
    guard.group.rotation.set(0, 0, 0);
    guard.group.position.set(0, 0, 0);
    for (const m of guard.mats) m.opacity = 1;
    OUTLINE_MAT_GUARD.uniforms.uOpacity.value = 1;

    elScore.textContent = '0';
    elDist.textContent = '0';
    elCoins.textContent = '0';

    camera.position.set(0, CAM_Y * camScale, CAM_Z * camScale);
  }

  function startGame() {
    resetGame();
    state = 'playing';
    guardMode = 'intro';       // 开局警察从身后追上来
    guardT = 0;
    introT = 0;                // 触发开场镜头
    showCard(null);
  }

  // 第一次撞：追捕者扑上来把你摁住，但这一下不致命 —— 爬起来还能接着跑。
  // 从这以后他在身后纠缠 10 秒，这 10 秒内再撞就是终局；撑过去他就放弃了
  function stumble(o) {
    hasGuard = true;
    guardMode = 'chase';
    guardT = 0;
    guardLife = GUARD_LIFE;
    guardFade = 1;
    guardReach = 0;
    guardRoot.visible = true;

    stumbleT = 0.62;        // 踉跄一下
    invT = 1.15;            // 无敌：别让同一个障碍连着触发
    slowMul = 0.52;         // 被撞得掉速，再慢慢提回来
    shakeT = Math.max(shakeT, 0.36);

    // 撞上的那个直接撞飞，否则下一帧人还卡在它里面
    const i = activeObs.indexOf(o);
    if (i >= 0) { freeOb(o); activeObs.splice(i, 1); }

    showToast('追捕者追上来了！10 秒内别再撞');
  }

  function gameOver() {
    state = 'crash';
    hasGuard = true;
    finalDist = Math.floor(travel);
    // 本局吃到的金币存进钱包，商店里能花
    wallet += coinCount;
    saveSave();
    updateWallet();
    crashT = 0.62;
    shakeT = 0.45;
    // 撞上了：警察扑上来抓人
    guardMode = 'crash';
    guardT = 0;
    guardFade = 1;
    guardRoot.visible = true;
    if (score > best) {
      best = score;
      try { localStorage.setItem('subway_best', String(best)); } catch (e) {}
    }
  }

  function showOver() {
    state = 'over';
    oScore.textContent = score;
    oDist.textContent = finalDist;
    oCoins.textContent = coinCount;
    oBest.textContent = best;
    renderMenu();
    showCard(cardOver);
  }

  /* ---------------- 输入 ---------------- */
  function moveLane(dir) {
    player.lane = clamp(player.lane + dir, 0, 2);
  }
  function doJump() {
    if (state !== 'playing') return;
    jumpBuf = 0.14;
  }
  function doSlide() {
    if (state !== 'playing') return;
    slideBuf = 0.14;
  }
  function togglePause() {
    if (state === 'playing') { state = 'paused'; showCard(cardPause); }
    else if (state === 'paused') { state = 'playing'; showCard(null); }
  }

  window.addEventListener('keydown', e => {
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown' || k === ' ' || k === 'Spacebar') e.preventDefault();

    if (state === 'ready' && (k === ' ' || k === 'Enter')) {
      if (!cardStart.classList.contains('hidden')) startGame();
      return;
    }
    if (state === 'over' && (k === 'r' || k === 'R' || k === 'Enter' || k === ' ')) { startGame(); return; }

    if (k === 'p' || k === 'P' || k === 'Escape') { togglePause(); return; }
    if (state !== 'playing') return;

    if (k === 'ArrowLeft' || k === 'a' || k === 'A') moveLane(-1);
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') moveLane(1);
    else if (k === 'ArrowUp' || k === 'w' || k === 'W' || k === ' ' || k === 'Spacebar') doJump();
    else if (k === 'ArrowDown' || k === 's' || k === 'S') doSlide();
  }, { passive: false });

  // 触摸
  let tStartX = 0, tStartY = 0, tStartT = 0, tMoved = false;
  canvas.addEventListener('touchstart', e => {
    const t = e.changedTouches[0];
    tStartX = t.clientX; tStartY = t.clientY; tStartT = Date.now(); tMoved = false;
  }, { passive: true });

  canvas.addEventListener('touchmove', e => {
    if (tMoved) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - tStartX, dy = t.clientY - tStartY;
    if (Math.abs(dx) < 28 && Math.abs(dy) < 28) return;
    tMoved = true;
    if (state !== 'playing') return;
    if (Math.abs(dx) > Math.abs(dy)) moveLane(dx > 0 ? 1 : -1);
    else if (dy < 0) doJump();
    else doSlide();
  }, { passive: true });

  canvas.addEventListener('touchend', () => {
    if (tMoved) return;
    if (Date.now() - tStartT > 320) return;
    if (state === 'ready' || state === 'over') startGame();
    else if (state === 'paused') { state = 'playing'; showCard(null); }
    else if (state === 'playing') doJump();
  }, { passive: true });

  /* ---------------- 角色 / 商店 ---------------- */
  // 每个角色就是一套配色，换角色时直接改 runner.mats 里那些材质的颜色
  const CHARS = [
    { id: 'jake', name: '杰克', desc: '街头常客', price: 0,
      skin: 0xf3c8a0, hair: 0x5c3c1e, cap: 0xf2e9d6, cap2: 0xc8332b,
      hoodie: 0xeae2d2, hood: 0xdcd3c1, denim: 0x3f7cc0, shirt: 0xeae2d2,
      jeans: 0x4a9de0, shoe: 0xf2ece0, shoe2: 0x3f74c8, sole: 0xc2a878,
      pack: 0xd2d63a, pack2: 0x7f8f22, glove: 0xe8873c },

    { id: 'tricky', name: '崔琦', desc: '涂鸦少女', price: 600,
      skin: 0xf0c49c, hair: 0x3a2436, cap: 0x8c2f6a, cap2: 0xff5aa8,
      hoodie: 0x6a2f8f, hood: 0x53246f, denim: 0x3a1c4e, shirt: 0xff5aa8,
      jeans: 0x2e1738, shoe: 0xf0d8ea, shoe2: 0xc04a8a, sole: 0x8a6a80,
      pack: 0xff7a3c, pack2: 0xb54a18, glove: 0xff9a4a },

    { id: 'fresh', name: '弗雷什', desc: '复古玩家', price: 1600,
      skin: 0xdca97a, hair: 0x1f1a16, cap: 0x1f2a1c, cap2: 0x7ee04a,
      hoodie: 0xc8e04a, hood: 0xa8c03a, denim: 0x2f4a2a, shirt: 0x1f2a1c,
      jeans: 0x2a3038, shoe: 0xf6f2e6, shoe2: 0x4a8f3a, sole: 0x8a8a6a,
      pack: 0x1f2a1c, pack2: 0x7ee04a, glove: 0x7ee04a },

    { id: 'yutani', name: '尤塔尼', desc: '机械师', price: 2600,
      skin: 0xe8b98e, hair: 0x2a1a12, cap: 0xd2541f, cap2: 0x2a2a30,
      hoodie: 0x4a4a56, hood: 0x3a3a44, denim: 0x2a2a30, shirt: 0xd2541f,
      jeans: 0xc8642a, shoe: 0x2a2a30, shoe2: 0xd2541f, sole: 0x6a6a72,
      pack: 0x2a2a30, pack2: 0xd2541f, glove: 0xd2541f },

    { id: 'lucy', name: '露西', desc: '夜行舞者', price: 1400,
      skin: 0xf6d2b4, hair: 0xe07ab0, cap: 0xff8fc4, cap2: 0x7a2f6a,
      hoodie: 0xf6f0f4, hood: 0xe6dce6, denim: 0x7a2f6a, shirt: 0xff8fc4,
      jeans: 0xd8609c, shoe: 0xfff2fa, shoe2: 0x7a2f6a, sole: 0xc8a0b8,
      pack: 0x9a4ad0, pack2: 0x6a2a9a, glove: 0xffb0d8 },

    { id: 'spike', name: '斯派克', desc: '夜班巡警', price: 4200,
      skin: 0xc99a72, hair: 0x14100e, cap: 0x1a1a22, cap2: 0xc02a2a,
      hoodie: 0x24304a, hood: 0x1a2338, denim: 0x14181f, shirt: 0xc02a2a,
      jeans: 0x14181f, shoe: 0x2a2a32, shoe2: 0xc02a2a, sole: 0x4a4a52,
      pack: 0xc02a2a, pack2: 0x6a1414, glove: 0xc02a2a }
  ];

  const SAVE_KEY = { wallet: 'subway_wallet', owned: 'subway_owned', char: 'subway_char' };
  let wallet = 0;
  let ownedChars = ['jake'];
  let curChar = 'jake';

  function loadSave() {
    try {
      const w = localStorage.getItem(SAVE_KEY.wallet);
      // 第一次玩先给一点启动资金，不然商店点开全是买不起的
      wallet = w === null ? 800 : (parseInt(w, 10) || 0);
      const o = JSON.parse(localStorage.getItem(SAVE_KEY.owned) || '["jake"]');
      if (Array.isArray(o) && o.length) ownedChars = o;
      const c = localStorage.getItem(SAVE_KEY.char);
      if (c) curChar = c;
    } catch (e) {
      wallet = 800; ownedChars = ['jake']; curChar = 'jake';
    }
    if (ownedChars.indexOf('jake') < 0) ownedChars.unshift('jake');
    if (ownedChars.indexOf(curChar) < 0) curChar = 'jake';
  }

  function saveSave() {
    try {
      localStorage.setItem(SAVE_KEY.wallet, String(wallet));
      localStorage.setItem(SAVE_KEY.owned, JSON.stringify(ownedChars));
      localStorage.setItem(SAVE_KEY.char, curChar);
    } catch (e) {}
  }

  function applyChar(id) {
    const c = CHARS.find(x => x.id === id) || CHARS[0];
    const M = runner.mats;
    if (!M) return;
    M.skin.color.setHex(c.skin);
    M.hair.color.setHex(c.hair);
    M.capW.color.setHex(c.cap);
    M.capR.color.setHex(c.cap2);
    M.hoodie.color.setHex(c.hoodie);
    M.hood.color.setHex(c.hood);
    M.denim.color.setHex(c.denim);
    M.shirt.color.setHex(c.shirt);
    M.jeans.color.setHex(c.jeans);
    M.shoeG.color.setHex(c.shoe);
    M.shoeR.color.setHex(c.shoe2);
    M.sole.color.setHex(c.sole);
    M.pack.color.setHex(c.pack);
    M.packDark.color.setHex(c.pack2);
    M.glove.color.setHex(c.glove);
  }

  const elChGrid = document.getElementById('chGrid');
  const elShopList = document.getElementById('shopList');
  const elShopWallet = document.getElementById('shopWallet');
  const elWalletChip = document.getElementById('walletChip');
  const elMenuCoin = document.getElementById('menuCoin');
  const elMenuAvatar = document.getElementById('menuAvatar');
  const elMenuName = document.getElementById('menuName');
  const elMenuLevel = document.getElementById('menuLevel');

  const fmtNum = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const hex6 = n => '#' + ('000000' + n.toString(16)).slice(-6);

  // 纯 CSS 拼的小人预览
  function figHTML(c) {
    return '<div class="ch-fig" style="--cap:' + hex6(c.cap) + ';--cap2:' + hex6(c.cap2) +
      ';--skin:' + hex6(c.skin) + ';--body:' + hex6(c.hoodie) + ';--leg:' + hex6(c.jeans) + '">' +
      '<span class="f-cap"></span><span class="f-head"></span><span class="f-body"></span>' +
      '<span class="f-leg l"></span><span class="f-leg r"></span></div>';
  }

  function updateWallet() {
    if (elWalletChip) elWalletChip.textContent = fmtNum(wallet);
    if (elShopWallet) elShopWallet.textContent = fmtNum(wallet);
    if (elMenuCoin) elMenuCoin.textContent = fmtNum(wallet);
  }

  // 等级只是给主菜单凑个热闹：按历史最高分折算，最高 99
  function menuLevel() {
    return Math.max(1, Math.min(99, 1 + Math.floor(best / 2500)));
  }

  function renderMenu() {
    updateWallet();
    const c = CHARS.find(x => x.id === curChar) || CHARS[0];
    if (elMenuAvatar) elMenuAvatar.innerHTML = figHTML(c);
    if (elMenuName) elMenuName.textContent = c.name;
    if (elMenuLevel) elMenuLevel.textContent = menuLevel();
  }

  function renderChars() {
    if (!elChGrid) return;
    elChGrid.innerHTML = CHARS.map(c => {
      const own = ownedChars.indexOf(c.id) >= 0;
      const on = curChar === c.id;
      const tag = on ? '<div class="tag use">使用中</div>'
        : own ? '<div class="tag own">已拥有</div>'
        : '<div class="tag buy">' + fmtNum(c.price) + '</div>';
      return '<div class="ch-card' + (on ? ' on' : '') + (own ? '' : ' lock') +
        '" data-id="' + c.id + '">' + figHTML(c) +
        '<div class="nm">' + c.name + '</div>' + tag + '</div>';
    }).join('');
  }

  function renderShop() {
    if (!elShopList) return;
    elShopList.innerHTML = CHARS.map(c => {
      const own = ownedChars.indexOf(c.id) >= 0;
      const on = curChar === c.id;
      let btn;
      if (on) btn = '<button class="buy-btn equip" disabled>使用中</button>';
      else if (own) btn = '<button class="buy-btn equip" data-act="use" data-id="' + c.id + '">装备</button>';
      else btn = '<button class="buy-btn" data-act="buy" data-id="' + c.id + '"' +
        (wallet < c.price ? ' disabled' : '') + '>' + fmtNum(c.price) + '</button>';
      return '<div class="shop-row">' + figHTML(c) +
        '<div class="info"><div class="nm">' + c.name + '</div>' +
        '<div class="ds">' + c.desc + '</div></div>' + btn + '</div>';
    }).join('');
    updateWallet();
  }

  if (elChGrid) {
    elChGrid.addEventListener('click', e => {
      const card = e.target.closest('.ch-card');
      if (!card) return;
      const id = card.dataset.id;
      if (ownedChars.indexOf(id) < 0) { renderShop(); showCard(cardShop); return; }
      curChar = id;
      saveSave(); applyChar(id); renderChars(); renderShop(); renderMenu();
    });
  }

  if (elShopList) {
    elShopList.addEventListener('click', e => {
      const b = e.target.closest('.buy-btn');
      if (!b || b.disabled) return;
      const id = b.dataset.id;
      if (b.dataset.act === 'use') {
        curChar = id; saveSave(); applyChar(id);
      } else {
        const c = CHARS.find(x => x.id === id);
        if (!c || wallet < c.price) return;
        wallet -= c.price;
        ownedChars.push(id);
        curChar = id;
        saveSave(); applyChar(id);
        showToast('已解锁「' + c.name + '」');
      }
      renderChars(); renderShop(); renderMenu();
    });
  }

  document.getElementById('btnChars').addEventListener('click', () => {
    renderChars(); showCard(cardChars);
  });
  document.getElementById('btnShop').addEventListener('click', () => {
    renderShop(); showCard(cardShop);
  });
  document.getElementById('btnCharsBack').addEventListener('click', () => {
    renderChars(); showCard(cardStart);
  });
  document.getElementById('btnShopBack').addEventListener('click', () => {
    renderShop(); showCard(cardStart);
  });

  // 侧栏里还没做的功能：点一下给个提示，别让人以为是坏了
  document.querySelectorAll('.side-btn.soon').forEach(b => {
    b.addEventListener('click', () => {
      showToast('「' + b.dataset.soon + '」还没做，先专注跑酷吧');
    });
  });

  loadSave();
  applyChar(curChar);
  renderChars();
  renderShop();
  renderMenu();

  // 调试：?panel=chars / ?panel=shop 直接打开对应面板，方便截图。
  // 真正的 showCard 放在文件末尾的初始化里（那里会覆盖这里），所以只记下要开哪张
  const _pn = /[?&]panel=(\w+)/.exec(location.search);
  const bootPanel = _pn ? _pn[1] : null;

  document.getElementById('btnStart').addEventListener('click', startGame);
  document.getElementById('btnRetry').addEventListener('click', startGame);
  document.getElementById('btnMenu').addEventListener('click', () => {
    state = 'ready';
    renderMenu();
    showCard(cardStart);
  });
  document.getElementById('btnResume').addEventListener('click', () => { state = 'playing'; showCard(null); });
  document.getElementById('btnPause').addEventListener('click', togglePause);

  window.addEventListener('resize', () => {
    fitView();
    renderer.setSize(window.innerWidth, window.innerHeight);
    camPos.set(0, CAM_Y * camScale, CAM_Z * camScale);
  });

  /* ---------------- 碰撞（扫掠区间，避免高速穿透） ---------------- */
  // 脚下地面高度。玩家永远在 z=0，所以只要问"此刻 z=0 处有什么能踩的"
  // 车顶 = 车厢高度；坡道 = 沿 z 线性升高。返回最大值（同时压着车和坡道时取高的）
  // y 是玩家当前高度：已经在顶上时把横向判定放宽 0.18，
  // 相邻两列车顶之间那 0.17 的缝就能跨过去 —— 这是"车顶上换道"的前提
  function groundHeightAt(x, z, y) {
    const wide = y > 1.2 ? 0.26 : 0;
    let h = 0;
    for (let i = 0; i < activeObs.length; i++) {
      const o = activeObs[i];
      if (!o.active) continue;
      const oz = o.mesh.position.z;
      if (z > oz + o.d / 2 || z < oz - o.d / 2) continue;
      const half = o.type === 'ramp' ? o.w / 2 - 0.04 + wide : o.w / 2 - 0.10 + wide;
      if (Math.abs(x - o.mesh.position.x) > half) continue;
      let oh = 0;
      if (o.type === 'train') {
        oh = o.h;
      } else if (o.type === 'ramp') {
        // 上坡：低端在 +z、高端在 -z；下坡反过来。顶端 RAMP_LAND 这一段是平的
        const sl = o.d - RAMP_LAND;
        oh = o.flip
          ? o.h * clamp((z - (oz - o.d / 2)) / sl, 0, 1)
          : o.h * clamp((oz + o.d / 2 - z) / sl, 0, 1);
      }
      if (oh > h) h = oh;
    }
    return h;
  }

  function hitTest(o) {
    if (o.type === 'ramp') return false;   // 坡道是地形，不是障碍
    const ox = o.mesh.position.x;
    const z = o.mesh.position.z;
    if (z + o.d / 2 < -0.45) return false;
    if (o.prevZ - o.d / 2 > 0.45) return false;
    if (Math.abs(player.x - ox) > 0.31 + o.w / 2) return false;
    const pTop = player.y + player.height;
    const pBot = player.y;
    if (pTop <= o.baseY + 0.06) return false;
    if (pBot >= o.baseY + o.h - 0.06) return false;
    return true;
  }

  /* ---------------- 主循环 ---------------- */
  const camPos = new THREE.Vector3(0, CAM_Y, CAM_Z);
  const camLook = new THREE.Vector3(0, 1.82, -7.50);
  let lastT = performance.now();
  let tGlobal = 0;

  /* ---- 动态装饰：灯笼摆动 / 雾飘 / 蝙蝠飞 / 炊烟升起 ----
     开局界面、暂停时也要动，所以不塞在"世界滚动"里，单独一个函数 */
  function updateDecor(dt, dz) {
    for (const ln of lanterns) {
      ln.pivot.rotation.z = Math.sin(tGlobal * 1.4 + ln.phase) * 0.09;
      ln.pivot.rotation.x = Math.cos(tGlobal * 1.05 + ln.phase) * 0.06;
    }
    for (const f of fogs) {
      f.sp.position.z += dz;
      if (f.sp.position.z > 26) {
        f.sp.position.z -= 200;
        f.sp.position.y = rand(0.8, 2.4);
        f.baseX = rand(-9, 9);
      }
      f.sp.position.x = f.baseX + Math.sin(tGlobal * f.spd + f.phase) * f.amp;
      f.sp.material.opacity = 0.10 + 0.09 * (0.5 + 0.5 * Math.sin(tGlobal * 0.6 + f.phase));
    }
    for (const b of bats) {
      b.a += b.spd * dt;
      b.g.position.set(
        b.cx + Math.cos(b.a) * b.r,
        b.cy + Math.sin(b.a * 2.7 + b.flap) * 1.2,
        b.cz + Math.sin(b.a) * b.r * 0.55
      );
      b.g.rotation.y = Math.atan2(-Math.sin(b.a) * b.r * b.spd, Math.cos(b.a) * b.r * 0.55 * b.spd);
      const flap = Math.sin(tGlobal * 11 + b.flap) * 0.85;
      b.wl.rotation.z = flap;
      b.wr.rotation.z = -flap;
    }
    for (const sm of smokes) {
      if (!sm.sp.visible) { respawnSmoke(sm); continue; }
      sm.life += dt;
      sm.sp.position.z += dz;
      sm.sp.position.y += sm.vy * dt;
      sm.sp.position.x += Math.sin(sm.life * 1.7 + sm.maxLife * 3) * 0.28 * dt;
      const tt = sm.life / sm.maxLife;
      if (tt >= 1) { respawnSmoke(sm); continue; }
      const sc = sm.base * (0.75 + tt * 2.6);
      sm.sp.scale.set(sc, sc, 1);
      sm.sp.material.opacity = 0.50 * Math.sin(Math.PI * Math.min(1, tt * 1.12));
    }
  }

  /* ---------------- 抓捕人 ---------------- */
  // 他不在滚动的世界里，永远跟着角色跑：z 固定 = 一直保持着那个追赶距离
  function updateGuard(dt) {
    // 开场镜头还贴着地的时候他离相机太近，等镜头拉开再放出来
    if (guardMode === 'hidden' || (guardMode === 'intro' && introT < 0.95)) {
      guardRoot.visible = false;
      return;
    }
    guardRoot.visible = true;
    guardT += dt;

    if (guardMode === 'intro') {
      // 先贴身追 1.05 秒，然后慢慢落后、沉出画面下沿（就是"追丢了"）
      if (guardT > 1.05) {
        const k = clamp((guardT - 1.05) / 0.78, 0, 1);
        guardZ = GUARD_Z + k * k * 4.6;
        guardFade = 1 - k * k * k;
        if (k >= 1) { guardMode = 'hidden'; guardRoot.visible = false; return; }
      } else {
        guardZ = GUARD_Z;
        guardFade = clamp(guardT / 0.14, 0, 1);   // 淡入，别硬弹出来
      }
      guardReach = 0;
    } else if (guardMode === 'chase') {
      // 逮住过一次：吊在身后纠缠 GUARD_LIFE 秒，这期间再撞就是终局。
      // 距离和横向都拉开一点，别把角色的腿整个挡住
      guardLife -= dt;
      if (guardLife <= 0) {
        // 追了 10 秒没得手，放弃 —— 马上解除"再撞就死"的判定，再撞等于重新触发一次
        guardMode = 'leave';
        guardT = 0;
        hasGuard = false;
        showToast('甩掉追捕者了！');
      }
      guardZ = GUARD_Z + 0.92;
      guardFade = 1;
      guardReach = 0.16;      // 手微微前伸，一副随时要扑的架势
    } else if (guardMode === 'leave') {
      // 退场：手收回来、边落后边淡出，和开场那段的走法反过来
      const k = clamp(guardT / 0.85, 0, 1);
      guardZ = GUARD_Z + 0.92 + k * k * 5.4;
      guardFade = 1 - k * k;
      guardReach = damp(guardReach, 0, 14, dt);
      if (k >= 1) { guardMode = 'hidden'; guardRoot.visible = false; return; }
    } else {
      // crash：从后面扑上来，双手前伸抓住角色
      const k = clamp(guardT / 0.32, 0, 1);
      guardZ = GUARD_Z + (1.46 - GUARD_Z) * (k * k);
      guardReach = k;
      guardFade = 1;
    }

    // 撞车之后人物会往前扑倒，警察停在原地，所以只在跑动时贴着他的横向位置
    const followX = guardMode === 'crash' ? player.x * 0.85 : player.x * 0.5;
    // 撞车时也只往中间靠一点，别整个把角色盖住；
    // 追赶状态再往右偏一截，把中间那条视线让出来
    const gx = (guardMode === 'chase' || guardMode === 'leave') ? GUARD_X + 0.34 : GUARD_X;
    guardRoot.position.set(followX + gx * (1 - guardReach * 0.18), 0, guardZ);

    // 步频跟着速度走；撞车后（over 界面）站定不动，别在原地踏步
    const run = state === 'over' ? 0 : 1;
    guardPhase += dt * (9.5 + speed * 0.16) * run;
    const s = Math.sin(guardPhase) * run;

    guard.legL.hip.rotation.x = s * 0.95;
    guard.legL.knee.rotation.x = Math.max(0, s) * 1.25;
    guard.legR.hip.rotation.x = -s * 0.95;
    guard.legR.knee.rotation.x = Math.max(0, -s) * 1.25;

    // 手臂：平时前后摆；扑上来时张开成"合围"姿势 —— 从背后看，前伸是看不见的，只有横向张开才有剪影
    const rc = guardReach;
    guard.armL.sh.rotation.x = -s * 0.85 * (1 - rc) - 0.72 * rc;
    guard.armR.sh.rotation.x = s * 0.85 * (1 - rc) - 0.72 * rc;
    guard.armL.el.rotation.x = -0.50 * (1 - rc) - 0.55 * rc;
    guard.armR.el.rotation.x = -0.50 * (1 - rc) - 0.55 * rc;
    guard.armL.sh.rotation.z = -1.05 * rc;
    guard.armR.sh.rotation.z = 1.05 * rc;

    guard.group.position.y = Math.abs(s) * 0.075;
    guard.group.rotation.z = Math.sin(guardPhase * 0.5) * 0.045 * run;
    guard.group.rotation.x = damp(guard.group.rotation.x,
      guardMode === 'chase' ? 0.16 : (guardMode === 'crash' ? 0.30 : 0), 10, dt);
    guard.group.rotation.x = -0.30 * rc;         // 扑上来时身体前倾

    // 警犬：四条腿交替蹬地，尾巴甩
    const dp = guardPhase * 1.3;
    for (const l of guard.dogLegs) l.g.rotation.x = Math.sin(dp + l.ph) * 0.88 * run;
    guard.dogG.position.y = Math.abs(Math.sin(dp)) * 0.07 * run;
    guard.tail.rotation.z = Math.sin(guardPhase * 2.4) * 0.38;

    for (const m of guard.mats) m.opacity = guardFade;
    OUTLINE_MAT_GUARD.uniforms.uOpacity.value = guardFade;
  }

  function update(dt) {
    tGlobal += dt;
    updateDecor(dt, (state === 'playing' || state === 'crash') ? speed * dt : 0);
    updateGuard(dt);

    /* ---- 世界滚动 ---- */
    const moving = state === 'playing' || state === 'crash';
    if (moving) {
      if (state === 'crash') speed = damp(speed, 0, 6, dt);
      else {
        speed = Math.min(SPEED_MAX, SPEED_START + travel * 0.013);
        if (introT < INTRO_DUR) {
          // 开场从 0.42 倍速起步，镜头拉到位的同时加速 —— 有个"冲出去"的劲
          const e = 1 - Math.pow(1 - clamp(introT / INTRO_DUR, 0, 1), 3);
          speed = Math.min(speed, SPEED_START * (0.42 + 0.58 * e));
        }
        // 被撞那一下会明显掉速，再慢慢提回来
        speed *= slowMul;
        slowMul = damp(slowMul, 1, 3.4, dt);
      }

      const dz = speed * dt;
      travel += dz;

      for (let i = 0; i < SLEEPER_N; i++) {
        sleeperZ[i] += dz;
        if (sleeperZ[i] > 12) sleeperZ[i] -= SLEEPER_SPAN;
      }
      layoutSleepers();

      for (const b of houses) {
        b.mesh.position.z += dz;
        const span = b.row === 1 ? 156 : 228;
        if (b.mesh.position.z > 18) resetHouse(b, b.side, b.mesh.position.z - span);
      }
      for (const a of gates) {
        a.position.z += dz;
        if (a.position.z > 20) a.position.z -= 272;
      }
      for (const d of decor) {
        d.mesh.position.z += dz;
        const span = d.kind === 'lamp' ? 186 : (d.kind === 'tree' ? 198 : 182);
        if (d.mesh.position.z > 16) resetDecor(d, d.mesh.position.z - span);
      }
      for (const sn of snow) {
        sn.mesh.position.z += dz;
        if (sn.mesh.position.z > 16) {
          sn.mesh.position.z -= 340;
          const s = rand(1.4, 4.65);
          sn.mesh.scale.set(s, s * rand(0.5, 1.2), 1);
          sn.mesh.position.x = sn.side * rand(9.7, 16.2);
        }
      }

      // 走廊里车厢是一节贴一节排的，只有最靠近玩家那一节的车头正脸看得见，
      // 后面那些的正脸全被前一节挡住了 —— 整组关掉，省下不少绘制调用
      for (let i = 0; i < activeObs.length; i++) {
        const o = activeObs[i];
        const fp = o.mesh.userData.face;
        if (!fp) continue;
        let covered = false;
        for (let j = 0; j < activeObs.length; j++) {
          const q = activeObs[j];
          if (q === o || q.type !== 'train') continue;
          if (Math.abs(q.mesh.position.x - o.mesh.position.x) > 0.5) continue;
          const dzz = q.mesh.position.z - o.mesh.position.z;
          if (dzz > 8.0 && dzz < 10.8) { covered = true; break; }
        }
        for (let k = 0; k < fp.length; k++) fp[k].visible = !covered;
      }

      for (let i = activeObs.length - 1; i >= 0; i--) {
        const o = activeObs[i];
        o.prevZ = o.mesh.position.z;
        o.mesh.position.z += dz + o.vz * dt;
        if (o.mesh.position.z - o.d / 2 > DESPAWN_Z) {
          freeOb(o);
          activeObs.splice(i, 1);
        }
      }

      for (let i = activeCoins.length - 1; i >= 0; i--) {
        const c = activeCoins[i];
        c.prevZ = c.mesh.position.z;
        c.mesh.position.z += dz;
        c.spin += dt * 4.5;
        c.mesh.rotation.y = c.spin;
        c.mesh.position.y = c.baseY + Math.sin(tGlobal * 3 + c.spin) * 0.08;
        // 金币一过玩家就收：留在 z>3 会被镜头怼到脸上，变成一团糊掉的金光
        if (c.mesh.position.z > 3.0) {
          freeCoin(c);
          activeCoins.splice(i, 1);
        }
      }

      // 迎面火车按时间排，不受"行"的节奏影响 —— 录屏里它们是穿插在行与行之间的
      for (let i = 0; i < 3; i++) if (laneLock[i] > 0) laneLock[i] -= dt;
      if (state === 'playing' && !noSpawn) {
        // 迎面火车只在开阔段放：走廊段两道都是墙，硬塞进来会把唯一的缝堵死
        if (sect === 'open' && mtBudget > 0) {
          mtTimer -= dt;
          if (mtTimer <= 0) {
            // 一次来 1~2 列；成对时更像录屏里两条道同时冲过来
            const want = Math.random() < 0.45 ? 2 : 1;
            if (spawnMovingTrain(want) > 0) {
              mtBudget--;
              mtTimer = rand(1.7, 2.6);
            } else {
              mtTimer = 0.55;      // 暂时没有空道，过一会儿再试
            }
          }
        }
        spawnTimer -= dt;
        if (spawnTimer <= 0) spawnRow();
      }
    }

    /* ---- 玩家 ---- */
    if (moving) {
      player.x = damp(player.x, LANES[player.lane], 13, dt);
      playerGroup.position.x = player.x;

      if (state === 'playing') {
        jumpBuf = Math.max(0, jumpBuf - dt);
        slideBuf = Math.max(0, slideBuf - dt);

        if (jumpBuf > 0 && player.onGround && !player.sliding) {
          player.vy = JUMP_V;
          player.onGround = false;
          player.flipT = 0;        // 起跳瞬间开始空翻
          player.landT = 0;
          jumpBuf = 0;
        }
        if (slideBuf > 0 && !player.sliding) {
          player.sliding = true;
          player.slideT = SLIDE_TIME;
          slideBuf = 0;
          if (!player.onGround) player.vy = Math.min(player.vy, -28);
        }
        if (player.sliding) {
          player.slideT -= dt;
          if (player.slideT <= 0) player.sliding = false;
        }
      }

      // 脚下的地面：平地 0、坡道上逐渐升高、车顶 2.9
      const gnd = groundHeightAt(player.x, 0, player.y);
      if (player.onGround) {
        if (gnd > player.y) {
          // 上坡：限速抬升，免得从侧面蹭进坡道时人一下弹上去
          player.y = Math.min(gnd, player.y + 45 * dt);
        } else if (gnd > player.y - 1.2) {
          player.y = gnd;                 // 平路 / 下坡：直接贴地
        } else {
          player.onGround = false;        // 脚下地面塌了（车尾跑过去），开始下落
        }
      }
      if (!player.onGround) {
        player.vy += GRAVITY * dt;
        player.y += player.vy * dt;
        if (player.y <= gnd) {
          player.y = gnd; player.vy = 0; player.onGround = true;
          player.landT = 0.17;    // 落地缓冲：膝盖沉一下
          player.flipT = 0;
        }
      }
      playerGroup.position.y = player.y;
      player.height = player.sliding ? PLAYER_H_SLIDE : PLAYER_H;

      /* 模型姿态 */
      const rg = runner.group;
      const d = (o, t, k) => { o.rotation.x = damp(o.rotation.x, t, k || 14, dt); };
      const dz = (o, t, k) => { o.rotation.z = damp(o.rotation.z, t, k || 14, dt); };

      // 空中累计时间 → 前空翻进度（落地前正好转完一整圈）
      if (!player.onGround && state === 'playing') player.flipT += dt;
      const fk = clamp(player.flipT / FLIP_DUR, 0, 1);
      const fe = fk * fk * (3 - 2 * fk);      // smoothstep：起翻和收尾都缓一点，中段转得快
      if (player.landT > 0) player.landT -= dt;

      if (state === 'crash') {
        // 往前扑倒，而不是横着躺下——横躺看着像模型翻了
        rg.scale.y = damp(rg.scale.y, 1, 20, dt);
        rg.rotation.x = damp(rg.rotation.x, -1.42, 9, dt);
        rg.rotation.z = damp(rg.rotation.z, 0.14, 9, dt);
        rg.position.y = damp(rg.position.y, 0.18, 9, dt);
        rg.position.z = damp(rg.position.z, -0.25, 9, dt);
        dz(runner.armL.sh, -0.34, 9); dz(runner.armR.sh, 0.34, 9);
      } else if (!player.onGround) {
        /* 前空翻：绕 X 轴负方向整转一圈 —— 头先扎下去，再翻回脚下。
           旋转中心取重心而不是脚底，否则翻到一半头会直接扎进地面 */
        rg.scale.y = damp(rg.scale.y, 1, 20, dt);
        const th = -Math.PI * 2 * fe;
        const hp = 0.95;
        rg.rotation.x = th;
        rg.rotation.z = damp(rg.rotation.z, 0, 18, dt);
        rg.position.y = hp - hp * Math.cos(th);
        rg.position.z = -hp * Math.sin(th);
        // 翻的时候双臂张开保持平衡（录屏里就是这样），双腿微屈收起
        d(runner.legL.hip, -0.92, 16); d(runner.legL.knee, -1.20, 16);
        d(runner.legR.hip, -0.50, 16); d(runner.legR.knee, -0.98, 16);
        d(runner.legL.ankle, 0.34, 16); d(runner.legR.ankle, 0.34, 16);
        d(runner.armL.sh, -0.28, 14); d(runner.armL.el, -0.26, 14);
        d(runner.armR.sh, -0.28, 14); d(runner.armR.el, -0.26, 14);
        dz(runner.armL.sh, -1.28, 14); dz(runner.armR.sh, 1.28, 14);
        d(runner.head, -0.16, 14);
      } else if (player.sliding) {
        /* 滑铲：身体向后仰倒（正角度才是后仰，负角度是前扑），
           前腿贴着地面伸出去、后腿屈膝收在身下，双臂张开撑住平衡 */
        rg.scale.y = damp(rg.scale.y, 1, 20, dt);
        rg.rotation.x = damp(rg.rotation.x, 0.72, 17, dt);
        rg.rotation.z = damp(rg.rotation.z, 0, 18, dt);
        rg.position.z = damp(rg.position.z, 0, 18, dt);
        rg.position.y = damp(rg.position.y, 0, 18, dt);
        // hip 正角度才是"腿向前"；身体已经后仰了 0.72，所以这里再补 0.85
        // 才能让前腿贴着地面伸出去（绝对角度约 1.57 = 水平向前）
        d(runner.legL.hip, 0.85, 20); d(runner.legL.knee, -0.12, 20);
        d(runner.legR.hip, 0.45, 20); d(runner.legR.knee, -1.62, 20);
        d(runner.legL.ankle, 0.24, 18); d(runner.legR.ankle, -0.12, 18);
        d(runner.armL.sh, -0.62, 18); d(runner.armL.el, -0.34, 18);
        d(runner.armR.sh, -0.62, 18); d(runner.armR.el, -0.34, 18);
        dz(runner.armL.sh, -1.02, 16); dz(runner.armR.sh, 1.02, 16);
        d(runner.head, 0.32, 16);
      } else {
        /* 奔跑：大腿大摆、后腿折叠踢屁股、手臂反相摆、身体起伏 */
        rg.scale.y = damp(rg.scale.y, 1, 20, dt);
        rg.rotation.x = damp(rg.rotation.x, 0.10, 18, dt);
        rg.rotation.z = damp(rg.rotation.z, 0, 18, dt);
        rg.position.z = damp(rg.position.z, 0, 18, dt);

        player.runPhase += dt * (7.6 + speed * 0.30);
        const ph = player.runPhase;
        const s = Math.sin(ph);
        const c = Math.cos(ph);

        // 大腿：向前留得大、向后收得少，重心才不会往后飘
        const fwd = 0.90, back = 0.80;
        runner.legL.hip.rotation.x = s > 0 ? s * fwd : s * back;
        runner.legR.hip.rotation.x = -s > 0 ? -s * fwd : -s * back;
        // 膝盖只能向后折：腿往后摆时折得最狠（脚跟踢屁股），前摆时几乎伸直
        runner.legL.knee.rotation.x = -0.12 - Math.max(0, -s) * 1.56;
        runner.legR.knee.rotation.x = -0.12 - Math.max(0, s) * 1.56;
        // 脚踝：腿后摆时压脚背（蹬地），前摆时勾起来准备落地
        runner.legL.ankle.rotation.x = 0.20 + Math.max(0, -s) * 0.32;
        runner.legR.ankle.rotation.x = 0.20 + Math.max(0, s) * 0.32;

        // 手臂与腿反相，肘部跟着屈
        runner.armL.sh.rotation.x = -s * 1.06;
        runner.armL.el.rotation.x = -0.40 - Math.max(0, -s) * 0.72;
        runner.armR.sh.rotation.x = s * 1.06;
        runner.armR.el.rotation.x = -0.40 - Math.max(0, s) * 0.72;
        dz(runner.armL.sh, -0.26, 16); dz(runner.armR.sh, 0.26, 16);

        // 身体起伏：一个步幅上下两次；落地那一下额外沉一点
        const bob = Math.abs(c) * 0.085;
        const crouch = player.landT > 0 ? (player.landT / 0.17) * 0.13 : 0;
        rg.position.y = bob - crouch;
        runner.head.rotation.x = -0.05 + Math.abs(s) * 0.05;

        // 被撞那一下：身体往前栽、手臂乱抡，跑姿短暂乱掉，看得出是"被逮了一下"
        if (stumbleT > 0) {
          const k = clamp(stumbleT / 0.62, 0, 1);
          const w = Math.sin(stumbleT * 42);
          rg.rotation.x = 0.10 + 0.66 * k;
          runner.armL.sh.rotation.x = -1.55 * k + w * 0.42 * k;
          runner.armR.sh.rotation.x = -1.55 * k - w * 0.42 * k;
          runner.armL.sh.rotation.z = -0.26 - 0.88 * k;
          runner.armR.sh.rotation.z = 0.26 + 0.88 * k;
          runner.head.rotation.x = -0.05 - 0.52 * k;
        }
      }

      // 影子跟着脚下的面走：地面贴地，车顶上就贴车顶
      blob.position.set(player.x, gnd > 0.01 ? gnd + 0.03 : 0.25, 0);
      const k = clamp(1 - (player.y - gnd) / 5, 0.25, 1);
      blob.scale.setScalar(k * 1.15);
      blob.material.opacity = 0.24 * k;

      /* 碰撞 & 金币 */
      if (state === 'playing') {
        if (invT > 0) invT -= dt;
        if (stumbleT > 0) stumbleT -= dt;

        for (let i = 0; i < activeObs.length; i++) {
          if (godMode || invT > 0) break;
          const o = activeObs[i];
          if (!hitTest(o)) continue;
          // 已经被追捕者盯上（或者开局那段他还在身后），再撞就是终局；
          // 否则只是被逮住一次，游戏继续
          if (hasGuard || guardMode === 'intro') gameOver();
          else stumble(o);
          break;
        }
        if (state === 'playing') {
          for (let i = activeCoins.length - 1; i >= 0; i--) {
            const c = activeCoins[i];
            const p = c.mesh.position;
            const crossed = !(p.z + 0.45 < -0.85 || c.prevZ - 0.45 > 0.85);
            if (crossed &&
                Math.abs(p.x - player.x) < 0.95 &&
                p.y > player.y - 0.7 && p.y < player.y + player.height + 0.5) {
              coinCount++;
              freeCoin(c);
              activeCoins.splice(i, 1);
              elCoins.textContent = coinCount;
            }
          }
        }
      }
    }

    /* ---- 计分 ---- */
    if (state === 'playing') {
      score = Math.floor(travel) * 2 + coinCount * 15;
      elScore.textContent = score;
      elDist.textContent = Math.floor(travel);
    }

    /* ---- 崩溃计时 ---- */
    if (state === 'crash') {
      crashT -= dt;
      if (crashT <= 0) showOver();
    }

    /* ---- 相机 ---- */
    const camY = CAM_Y * camScale;
    const camZ = CAM_Z * camScale;
    camPos.x = damp(camPos.x, player.x * 0.42, 6, dt);
    camPos.y = damp(camPos.y, camY + player.y * 0.38, 6, dt);
    camPos.z = damp(camPos.z, camZ + (state === 'crash' ? 0.55 : 0), 4, dt);
    camLook.x = damp(camLook.x, player.x * 0.32, 6, dt);
    camLook.y = damp(camLook.y, 1.82 * camScale + player.y * 0.58, 6, dt);

    /* ---- 开场镜头：贴地近景 → 拉高拉远 ---- */
    if (introT < INTRO_DUR) {
      introT += dt;
      const e = 1 - Math.pow(1 - clamp(introT / INTRO_DUR, 0, 1), 3);   // easeOutCubic
      camPos.x = lerp(0, camPos.x, e);
      camPos.y = lerp(1.55, camPos.y, e);
      camPos.z = lerp(3.30, camPos.z, e);
      camLook.x = lerp(0, camLook.x, e);
      camLook.y = lerp(1.82, camLook.y, e);
      camLook.z = lerp(-5.60, camLook.z, e);
    }

    camera.position.copy(camPos);
    if (shakeT > 0) {
      shakeT -= dt;
      const s = shakeT * 0.55;
      camera.position.x += rand(-s, s);
      camera.position.y += rand(-s, s);
    }
    if (charCam) {
      guardRoot.visible = false;
      // 特写机位：站到角色右后方 3 米，看清楚腿和手臂
      camera.position.set(player.x + 2.15, player.y + 2.75, 3.05);
      camera.lookAt(player.x, player.y + 0.85, -0.15);
    } else {
      camera.lookAt(camLook);
    }

    const fovTarget = baseFov + clamp((speed - SPEED_START) / (SPEED_MAX - SPEED_START), 0, 1) * 9;
    if (introT < INTRO_DUR) {
      // 开场用窄视角起步、镜头拉远的同时张开。这里直接写 fov 不走阻尼，
      // 否则阻尼跟不上目标的变化，整段开场视野会一直发闷
      const e = 1 - Math.pow(1 - clamp(introT / INTRO_DUR, 0, 1), 3);
      camera.fov = lerp(52, fovTarget, e);
      camera.updateProjectionMatrix();
    } else if (Math.abs(camera.fov - fovTarget) > 0.01) {
      camera.fov = damp(camera.fov, fovTarget, 3, dt);
      camera.updateProjectionMatrix();
    }
  }

  function loop(now) {
    requestAnimationFrame(loop);
    let dt = (now - lastT) / 1000;
    lastT = now;
    if (!isFinite(dt) || dt <= 0) dt = 0.016;
    dt = Math.min(dt, 1 / 30);

    if (state !== 'paused') update(dt);
    renderer.render(scene, camera);
  }

  /* ---------------- 初始化 ---------------- */
  resetGame();
  if (bootPanel === 'chars') showCard(cardChars);
  else if (bootPanel === 'shop') showCard(cardShop);
  else showCard(cardStart);   // 主菜单：套全屏布局、收起游戏 HUD
  requestAnimationFrame(loop);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state === 'playing' && !godMode) {
      state = 'paused';
      showCard(cardPause);
    }
  });

  // 调试：?ui=buy 模拟"点未解锁角色 → 跳商店 → 购买"整条链路，
  // 结果写进 title，方便无头浏览器验证点击逻辑（截图看不出这些）
  if (/[?&]ui=buy/.test(location.search)) {
    wallet = 5000;
    renderMenu();
    const tgt = document.querySelector('.ch-card[data-id="tricky"]');
    if (tgt) tgt.click();
    const shopOpen = !cardShop.classList.contains('hidden');
    const buy = document.querySelector('.buy-btn[data-act="buy"][data-id="tricky"]');
    if (buy) buy.click();
    document.title = 'UI shop=' + shopOpen + ' owned=' + (ownedChars.indexOf('tricky') >= 0) +
      ' wallet=' + wallet + ' cur=' + curChar +
      ' name=' + (elMenuName ? elMenuName.textContent : '-') +
      ' coin=' + (elMenuCoin ? elMenuCoin.textContent : '-');
  }

  // 调试：?ui=reset 清掉存档（金币/已解锁角色/当前角色/最高分），回到第一次玩的状态
  if (/[?&]ui=reset/.test(location.search)) {
    try {
      Object.keys(SAVE_KEY).forEach(k => localStorage.removeItem(SAVE_KEY[k]));
      localStorage.removeItem('subway_best');
      wallet = 800; ownedChars = ['jake']; curChar = 'jake'; best = 0;
      applyChar(curChar); renderChars(); renderShop(); renderMenu();
    } catch (e) {}
  }

  window.__DBG = () => ({
    state, speed, travel, coinCount,
    coins: activeCoins.length, obs: activeObs.length,
    cx: activeCoins.map(c => [+c.mesh.position.x.toFixed(2), +c.mesh.position.z.toFixed(1)]),
    ox: activeObs.map(o => [+o.mesh.position.x.toFixed(2), +o.mesh.position.z.toFixed(1), o.type]),
    px: +player.x.toFixed(2), py: +player.y.toFixed(2),
    gnd: +groundHeightAt(player.x, 0, player.y).toFixed(2), air: !player.onGround,
    calls: renderer.info.render.calls, tris: renderer.info.render.triangles
  });
  window.__SUBWAY_READY__ = true;

  // 本地调试用：index.html?auto=1 直接开跑，方便截图/自动测试
  // ?ff=N 额外以 1/60 秒步长空跑 N 帧，让截图状态与渲染速度无关
  if (/[?&]auto=1/.test(location.search)) {
    setTimeout(() => {
      startGame();
      if (/[?&]nointro=1/.test(location.search)) introT = INTRO_DUR;   // 跳过开场镜头，方便截图
      // ?rampdemo=N 摆一段带坡道的火车组（N=1/2/3 条并排车道），
      // 验证"上坡 → 车顶 → 下坡"，N=2/3 时还能验证车顶上换道
      const rdemo = /[?&]rampdemo=(\d)/.exec(location.search);
      if (rdemo) {
        while (activeObs.length) freeOb(activeObs.pop());
        while (activeCoins.length) freeCoin(activeCoins.pop());
        noSpawn = true;
        const n = Math.max(1, Math.min(3, +rdemo[1]));
        const lanes = n === 1 ? [1] : (n === 2 ? [0, 1] : [0, 1, 2]);
        for (const ln of lanes) spawnTrainLane(ln, 3, -14);
        player.lane = 1; player.x = 0;
      }
      // ?jumpAt=N / ?slideAt=N 在空跑的第 N 帧触发跳跃/下滑，配合 ?charcam=1 看动作
      const ja = /[?&]jumpAt=(\d+)/.exec(location.search);
      const sa = /[?&]slideAt=(\d+)/.exec(location.search);
      const jumpAt = ja ? +ja[1] : -1;
      const slideAt = sa ? +sa[1] : -1;
      const m = /[?&]ff=(\d+)/.exec(location.search);
      if (m) {
        const n = Math.min(12000, +m[1]);
        for (let i = 0; i < n && state === 'playing'; i++) {
          if (i === jumpAt) jumpBuf = 0.14;
          if (i === slideAt) slideBuf = 0.14;
          update(1 / 60);
        }
        state = 'paused';          // 冻结世界，截图状态可复现
        renderer.render(scene, camera);
      }
      // ?ramplog=1 逐步推进并把 py/地面高度/横向位置打成日志，验证上坡→车顶→落地
      // 配 ?swap=1 会在刚上车顶时强制往左换一条道，验证"车顶上换道不掉下去"
      if (/[?&]ramplog=1/.test(location.search)) {
        const out = [];
        const doSwap = /[?&]swap=1/.test(location.search);
        let swapped = false;
        for (let i = 0; i < 900 && state === 'playing'; i++) {
          update(1 / 60);
          if (doSwap && !swapped && player.y > 2.5) { player.lane = 0; swapped = true; }
          if (i % 4 === 0) {
            out.push(i + ':' + player.y.toFixed(2) + '/' +
              groundHeightAt(player.x, 0, player.y).toFixed(2) + '/' +
              player.x.toFixed(2) + (player.onGround ? '' : '*'));
          }
        }
        document.title = 'LOG ' + out.join(' ');
        state = 'paused';
        renderer.render(scene, camera);
      }
      // ?obdemo=1 摆一排障碍物做样式检查
      if (/[?&]obdemo=1/.test(location.search)) {
        while (activeObs.length) freeOb(activeObs.pop());
        spawnObstacle('hurdle', 0, -5);
        spawnObstacle('bar', 1, -5);
        spawnObstacle('crate', 2, -5);
        spawnObstacle('train', 1, -16);
        state = 'paused';
        renderer.render(scene, camera);
      }
      // ?hit=N&hits=K&gap=F 连撞 K 次（每次间隔 F 帧，默认 100），再跑 N 帧冻结。
      // 用来验证"第一次只是被逮住、第二次才结束"；gap 拉大（如 700=11.6 秒）能验证
      // 抓捕者 10 秒后退场、再撞只是重新被逮住
      const hm = /[?&]hit=(\d+)/.exec(location.search);
      if (hm) {
        guardMode = 'hidden'; guardRoot.visible = false;   // 先假设开局那段已经跑完
        godMode = true;                                    // 别让自然碰撞打乱计数
        const times = +((/[?&]hits=(\d+)/.exec(location.search) || [])[1] || 1);
        const gap = +((/[?&]gap=(\d+)/.exec(location.search) || [])[1] || 100);
        for (let t = 0; t < times; t++) {
          // 走和真实碰撞完全一样的判定
          if (hasGuard || guardMode === 'intro') gameOver();
          else stumble(null);
          for (let i = 0; i < gap && state === 'playing'; i++) update(1 / 60);
        }
        const n = Math.min(180, +hm[1]);
        // 允许在 crash 状态下继续推进，才看得到"警察扑上来"那几帧
        for (let i = 0; i < n && state !== 'over'; i++) update(1 / 60);
        document.title = 'HIT state=' + state + ' guard=' + guardMode +
          ' has=' + hasGuard + ' tr=' + travel.toFixed(0);
        state = 'paused';
        renderer.render(scene, camera);
      }

      // ?gl=N 撞一次后空跑 N 秒，验证抓捕者 10 秒后自动退场
      const glm = /[?&]gl=(\d+(?:\.\d+)?)/.exec(location.search);
      if (glm) {
        guardMode = 'hidden'; guardRoot.visible = false;
        godMode = true;                     // 空跑期间别被障碍打断
        stumble(null);
        const secs = Math.min(20, +glm[1]);
        for (let i = 0; i < secs * 60 && state !== 'over'; i++) update(1 / 60);
        document.title = 'GL t=' + secs + ' guard=' + guardMode + ' has=' + hasGuard +
          ' life=' + guardLife.toFixed(2) + ' vis=' + guardRoot.visible;
        state = 'paused';
        renderer.render(scene, camera);
      }

      // ?crash=N 直接触发一次撞击，再跑 N 帧冻结，用来看"警察扑上来抓人"
      const cm = /[?&]crash=(\d+)/.exec(location.search);
      if (cm) {
        gameOver();
        const n = Math.min(120, +cm[1]);
        for (let i = 0; i < n; i++) update(1 / 60);
        state = 'paused';
        renderer.render(scene, camera);
      }
      // ?side=1 在玩家左右两条车道各放一列火车（和玩家齐平），用来对着录屏量高度比
      if (/[?&]side=1/.test(location.search)) {
        while (activeObs.length) freeOb(activeObs.pop());
        noSpawn = true;
        spawnObstacle('train', 0, 0);
        spawnObstacle('train', 2, 0);
        spawnObstacle('hurdle', 1, -14);
        player.lane = 1; player.x = 0;
        state = 'paused';
        renderer.render(scene, camera);
      }
      // ?flowdemo=1 摆一段"车流走廊"+ 一列迎面火车，
      // 用来看车厢之间有没有缝/穿模，以及迎面车的速度感
      if (/[?&]flowdemo=1/.test(location.search)) {
        while (activeObs.length) freeOb(activeObs.pop());
        while (activeCoins.length) freeCoin(activeCoins.pop());
        noSpawn = true;
        sectVz = 9;
        for (let z = -12; z > -168; z -= 19.2) {
          for (const ln of [0, 2]) {
            for (let k = 0; k < 2; k++) spawnObstacle('train', ln, z - k * 9.6, false, 9);
          }
        }
        spawnObstacle('train', 1, -78, false, 12);
        player.lane = 1; player.x = 0;
      }

      // ?mtrain=1 放一列"会开的火车"，跑 1 秒看它是不是比地面滚得快
      if (/[?&]mtrain=1/.test(location.search)) {
        while (activeObs.length) freeOb(activeObs.pop());
        noSpawn = true;
        spawnObstacle('train', 1, -60, false, 12);
        const o0 = activeObs[0];
        const z0 = o0.mesh.position.z;
        for (let i = 0; i < 60; i++) update(1 / 60);
        document.title = 'MT z0=' + z0.toFixed(2) + ' z1=' + o0.mesh.position.z.toFixed(2) +
          ' dz=' + (o0.mesh.position.z - z0).toFixed(2) + ' speed=' + speed.toFixed(1);
        state = 'paused';
      }
      // ?bbox=1 量一下角色/火车/栅栏的真实视觉包围盒，确认"视觉高度"和"碰撞高度"对得上
      if (/[?&]bbox=1/.test(location.search)) {
        const bb = new THREE.Box3().setFromObject(playerGroup);
        const out = ['player h=' + (bb.max.y - bb.min.y).toFixed(2) +
          ' w=' + (bb.max.x - bb.min.x).toFixed(2) + ' y0=' + bb.min.y.toFixed(2)];
        for (const t of ['train', 'hurdle', 'bar', 'crate', 'ramp']) {
          const m = createOb(t);
          const b2 = new THREE.Box3().setFromObject(m.mesh);
          out.push(t + ' h=' + (b2.max.y - b2.min.y).toFixed(2) +
            ' w=' + (b2.max.x - b2.min.x).toFixed(2));
          scene.remove(m.mesh);
        }
        document.title = 'BBOX ' + out.join(' | ');
      }
      // ?dump=1 把内部状态塞进 document.title，用 --dump-dom 读回来
      if (/[?&]dump=1/.test(location.search)) {
        const o = activeObs.map(a => a.type + '@' +
          a.mesh.position.x.toFixed(1) + ',' + a.mesh.position.z.toFixed(1) +
          (a.vz ? 'v' + a.vz.toFixed(0) : '') +
          (a.mesh.visible ? '' : '!HIDDEN'));
        document.title = 'DBG ' + o.join(' | ') + ' || py=' + player.y.toFixed(2) + ' tr=' + travel.toFixed(0) + ' sp=' + speed.toFixed(1) +
          ' st=' + state + ' has=' + hasGuard +
          ' mt=' + mtSpawned + '/' + mtTried + ' sect=' + sect + ':' + sectT.toFixed(0) +
          ' vz=' + sectVz.toFixed(1) + ' mvOb=' + activeObs.filter(a => a.vz > 0).length +
          ' rows=' + JSON.stringify(rowStat) + ' calls=' + renderer.info.render.calls + ' tris=' + renderer.info.render.triangles;
      }
    }, 60);
  }
})();
