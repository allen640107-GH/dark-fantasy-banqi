import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ROWS, COLS } from './gameLogic.js';

const CELL_SIZE = 1.62;
const BOARD_W = COLS * CELL_SIZE;
const BOARD_H = ROWS * CELL_SIZE;
const PIECE_RADIUS = 0.65;
const PIECE_HEIGHT = 0.24;

export const CAMERA_PRESETS = [
  { name: '斜視', pos: new THREE.Vector3(0, 12.4, 9.5), target: new THREE.Vector3(0, 0, 0.25) },
  { name: '正俯視', pos: new THREE.Vector3(0, 16.0, 0.01), target: new THREE.Vector3(0, 0, 0) },
  { name: '史詩低角', pos: new THREE.Vector3(0, 7.6, 12.2), target: new THREE.Vector3(0, 0.2, -0.3) }
];

export class DarkChessScene3D {
  constructor(container, onTileClick, onTileHover) {
    this.container = container;
    this.onTileClick = onTileClick;
    this.onTileHover = onTileHover;

    this.pieceMeshes = new Map(); // id -> { group, topMat, piece }
    this.tileMeshes = [];
    this.highlightRings = [];
    this.animations = [];
    this.vfxParticles = [];
    this.portraitImages = new Map();
    this.faceTextureCache = new Map();

    this.cameraPresetIdx = 0;
    this.cameraLerp = null;
    this.shakeTime = 0;
    this.shakeIntensity = 0;
    this.hoveredTile = null;
    this.selectedTile = null;
    this.menuOrbit = true;

    this._initRenderer();
    this._initLighting();
    this._initEnvironment();
    this._initBoard();
    this._initAmbientParticles();
    this._initRaycasting();

    this.clock = new THREE.Clock();
    this._animate();
  }

  async preloadPortraits() {
    const keys = [
      'r_general', 'r_advisor', 'r_elephant', 'r_chariot', 'r_horse', 'r_cannon', 'r_soldier', 'r_emblem',
      'b_general', 'b_advisor', 'b_elephant', 'b_chariot', 'b_horse', 'b_cannon', 'b_soldier', 'b_emblem'
    ];
    await Promise.all(keys.map(k => new Promise(resolve => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => { this.portraitImages.set(k, img); resolve(); };
      img.onerror = () => resolve();
      img.src = `assets/portraits/${k}.png`;
    })));
    this.backTexture = this._createPieceBackTexture();
  }

  _initRenderer() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x06050a);
    this.scene.fog = new THREE.FogExp2(0x06050a, 0.028);

    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 100);
    this.camera.position.copy(CAMERA_PRESETS[0].pos);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.enablePan = false;
    this.controls.minDistance = 7.5;
    this.controls.maxDistance = 19;
    this.controls.maxPolarAngle = Math.PI * 0.44;
    // Allow right-click orbit, keep left-click crisp for chess moves
    this.controls.mouseButtons = {
      LEFT: null,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE
    };
    this.controls.target.copy(CAMERA_PRESETS[0].target);

    window.addEventListener('resize', () => {
      const nw = this.container.clientWidth || window.innerWidth;
      const nh = this.container.clientHeight || window.innerHeight;
      this.camera.aspect = nw / nh;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(nw, nh);
    });
  }

  _initLighting() {
    // Subtle dark atmospheric ambient
    const hemi = new THREE.HemisphereLight(0xdcc8a2, 0x151828, 0.65);
    this.scene.add(hemi);

    // Warm overhead chandelier / torch key light with soft shadows
    this.keyLight = new THREE.DirectionalLight(0xffdfb0, 1.9);
    this.keyLight.position.set(3.5, 14, 5.5);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(2048, 2048);
    this.keyLight.shadow.camera.near = 2;
    this.keyLight.shadow.camera.far = 30;
    const d = 10.5;
    this.keyLight.shadow.camera.left = -d;
    this.keyLight.shadow.camera.right = d;
    this.keyLight.shadow.camera.top = d;
    this.keyLight.shadow.camera.bottom = -d;
    this.keyLight.shadow.bias = -0.0005;
    this.scene.add(this.keyLight);

    // Left Crimson Flame rim light (flickers subtly)
    this.crimsonLight = new THREE.PointLight(0xff5a22, 18, 22, 1.7);
    this.crimsonLight.position.set(-8.8, 3.6, 0.8);
    this.scene.add(this.crimsonLight);

    // Right Abyssal Cyan-Violet rim light (pulses subtly)
    this.abyssLight = new THREE.PointLight(0x3ecbff, 16, 22, 1.7);
    this.abyssLight.position.set(8.8, 3.6, -0.8);
    this.scene.add(this.abyssLight);

    // Back golden halo rim light for realistic metal bevel shine
    const rim = new THREE.DirectionalLight(0xf5c878, 0.85);
    rim.position.set(-2, 6, -10);
    this.scene.add(rim);
  }

  _makeWoodTexture(baseHex, grainHex, size = 512) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    ctx.fillStyle = baseHex;
    ctx.fillRect(0, 0, size, size);

    for (let i = 0; i < 420; i++) {
      const y = Math.random() * size;
      const h = 1 + Math.random() * 3.5;
      ctx.fillStyle = grainHex;
      ctx.globalAlpha = 0.04 + Math.random() * 0.09;
      ctx.fillRect(0, y, size, h);
    }
    // Subtle dark knots & organic noise
    for (let i = 0; i < 24; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const rx = 20 + Math.random() * 65;
      const ry = 3 + Math.random() * 8;
      ctx.save();
      ctx.translate(x, y);
      ctx.fillStyle = '#070405';
      ctx.globalAlpha = 0.14;
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  _initEnvironment() {
    // Realistic charred mahogany dark table surface
    const tableWood = this._makeWoodTexture('#1b1210', '#0a0605', 512);
    tableWood.repeat.set(4, 4);
    const tableGeo = new THREE.PlaneGeometry(46, 36);
    const tableMat = new THREE.MeshStandardMaterial({
      map: tableWood,
      bumpMap: tableWood,
      bumpScale: 0.04,
      roughness: 0.58,
      metalness: 0.14
    });
    const table = new THREE.Mesh(tableGeo, tableMat);
    table.rotation.x = -Math.PI / 2;
    table.position.y = -0.36;
    table.receiveShadow = true;
    this.scene.add(table);
  }

  _initBoard() {
    const boardGroup = new THREE.Group();

    // Outer forged bronze & dark oak frame
    const frameW = BOARD_W + 1.35;
    const frameH = BOARD_H + 1.35;
    const frameTex = this._makeWoodTexture('#241512', '#100807', 512);
    const frameGeo = new THREE.BoxGeometry(frameW, 0.36, frameH);
    const frameMat = new THREE.MeshStandardMaterial({
      map: frameTex,
      bumpMap: frameTex,
      bumpScale: 0.03,
      roughness: 0.42,
      metalness: 0.25
    });
    const frameMesh = new THREE.Mesh(frameGeo, frameMat);
    frameMesh.position.y = -0.18;
    frameMesh.receiveShadow = true;
    frameMesh.castShadow = true;
    boardGroup.add(frameMesh);

    // Metallic gold/brass inner bezel trim
    const trimMat = new THREE.MeshStandardMaterial({
      color: 0xc99a49,
      roughness: 0.28,
      metalness: 0.88
    });
    const trimThickness = 0.09;
    const topBar = new THREE.Mesh(new THREE.BoxGeometry(BOARD_W + 0.22, 0.06, trimThickness), trimMat);
    topBar.position.set(0, 0.02, -BOARD_H / 2 - 0.07);
    const botBar = topBar.clone();
    botBar.position.z = BOARD_H / 2 + 0.07;
    const leftBar = new THREE.Mesh(new THREE.BoxGeometry(trimThickness, 0.06, BOARD_H + 0.22), trimMat);
    leftBar.position.set(-BOARD_W / 2 - 0.07, 0.02, 0);
    const rightBar = leftBar.clone();
    rightBar.position.x = BOARD_W / 2 + 0.07;
    boardGroup.add(topBar, botBar, leftBar, rightBar);

    // Corner bronze studs
    const studGeo = new THREE.CylinderGeometry(0.18, 0.22, 0.1, 8);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const stud = new THREE.Mesh(studGeo, trimMat);
        stud.position.set(sx * (frameW / 2 - 0.32), 0.03, sz * (frameH / 2 - 0.32));
        stud.castShadow = true;
        boardGroup.add(stud);
      }
    }

    // Engraved dark obsidian-stone board surface texture
    const surfCanvas = document.createElement('canvas');
    surfCanvas.width = 1024;
    surfCanvas.height = 512;
    const ctx = surfCanvas.getContext('2d');

    // Obsidian stone gradient
    const grad = ctx.createLinearGradient(0, 0, 1024, 512);
    grad.addColorStop(0, '#1c1518');
    grad.addColorStop(0.5, '#13121b');
    grad.addColorStop(1, '#121822');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1024, 512);

    // Subtle stone texture speckles
    for (let i = 0; i < 6000; i++) {
      ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255,220,160,0.025)' : 'rgba(0,0,0,0.16)';
      ctx.fillRect(Math.random() * 1024, Math.random() * 512, 2, 2);
    }

    // Engraved gold grid lines
    const cw = 1024 / COLS;
    const ch = 512 / ROWS;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        // Subtle checkerboard tonal depth
        ctx.fillStyle = (r + c) % 2 === 0 ? 'rgba(255,215,150,0.025)' : 'rgba(0,0,0,0.12)';
        ctx.fillRect(c * cw, r * ch, cw, ch);

        // Inner rune corner ticks
        ctx.strokeStyle = 'rgba(218, 172, 92, 0.34)';
        ctx.lineWidth = 2;
        ctx.strokeRect(c * cw + 6, r * ch + 6, cw - 12, ch - 12);
      }
    }

    ctx.strokeStyle = 'rgba(235, 190, 105, 0.72)';
    ctx.lineWidth = 3.5;
    for (let c = 0; c <= COLS; c++) {
      ctx.beginPath();
      ctx.moveTo(c * cw, 0);
      ctx.lineTo(c * cw, 512);
      ctx.stroke();
    }
    for (let r = 0; r <= ROWS; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r * ch);
      ctx.lineTo(1024, r * ch);
      ctx.stroke();
    }

    const boardTex = new THREE.CanvasTexture(surfCanvas);
    boardTex.anisotropy = 8;
    boardTex.colorSpace = THREE.SRGBColorSpace;

    const surfaceGeo = new THREE.PlaneGeometry(BOARD_W, BOARD_H);
    const surfaceMat = new THREE.MeshStandardMaterial({
      map: boardTex,
      roughness: 0.45,
      metalness: 0.3
    });
    const surfaceMesh = new THREE.Mesh(surfaceGeo, surfaceMat);
    surfaceMesh.rotation.x = -Math.PI / 2;
    surfaceMesh.position.y = 0.005;
    surfaceMesh.receiveShadow = true;
    boardGroup.add(surfaceMesh);

    // Invisible interactive tile hitboxes + hover/selection rings
    const hitGeo = new THREE.PlaneGeometry(CELL_SIZE * 0.96, CELL_SIZE * 0.96);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const pos = this.gridToWorld(r, c);
        const tile = new THREE.Mesh(hitGeo, hitMat);
        tile.rotation.x = -Math.PI / 2;
        tile.position.set(pos.x, 0.02, pos.z);
        tile.userData = { r, c };
        boardGroup.add(tile);
        this.tileMeshes.push(tile);
      }
    }

    // Hover & Selection Ring meshes
    const ringGeo = new THREE.RingGeometry(PIECE_RADIUS * 0.95, PIECE_RADIUS * 1.12, 40);
    this.hoverRing = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color: 0xffd98a, transparent: true, opacity: 0.55, side: THREE.DoubleSide })
    );
    this.hoverRing.rotation.x = -Math.PI / 2;
    this.hoverRing.position.y = 0.025;
    this.hoverRing.visible = false;
    boardGroup.add(this.hoverRing);

    this.selectRing = new THREE.Mesh(
      new THREE.RingGeometry(PIECE_RADIUS * 0.92, PIECE_RADIUS * 1.16, 40),
      new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
    );
    this.selectRing.rotation.x = -Math.PI / 2;
    this.selectRing.position.y = 0.03;
    this.selectRing.visible = false;
    boardGroup.add(this.selectRing);

    this.scene.add(boardGroup);
    this.highlightGroup = new THREE.Group();
    this.scene.add(this.highlightGroup);
  }

  _initAmbientParticles() {
    const count = 110;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    this.ambientData = [];

    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * 18;
      const y = Math.random() * 6.5;
      const z = (Math.random() - 0.5) * 11;
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      const isLeft = x < 0;
      colors[i * 3] = isLeft ? 1.0 : 0.35;
      colors[i * 3 + 1] = isLeft ? 0.48 : 0.82;
      colors[i * 3 + 2] = isLeft ? 0.14 : 1.0;

      this.ambientData.push({
        speed: 0.25 + Math.random() * 0.45,
        phase: Math.random() * Math.PI * 2,
        drift: 0.2 + Math.random() * 0.4
      });
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      size: 0.11,
      vertexColors: true,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.ambientPoints = new THREE.Points(geo, mat);
    this.scene.add(this.ambientPoints);
  }

  _initRaycasting() {
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    const updatePointer = (e) => {
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    };

    this.renderer.domElement.addEventListener('pointermove', (e) => {
      updatePointer(e);
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hits = this.raycaster.intersectObjects(this.tileMeshes);
      if (hits.length > 0) {
        const { r, c } = hits[0].object.userData;
        const pos = this.gridToWorld(r, c);
        this.hoverRing.position.set(pos.x, 0.025, pos.z);
        this.hoverRing.visible = true;
        if (!this.hoveredTile || this.hoveredTile.r !== r || this.hoveredTile.c !== c) {
          this.hoveredTile = { r, c };
          if (this.onTileHover) this.onTileHover(r, c);
        }
      } else {
        this.hoverRing.visible = false;
        if (this.hoveredTile) {
          this.hoveredTile = null;
          if (this.onTileHover) this.onTileHover(-1, -1);
        }
      }
    });

    this.renderer.domElement.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return; // Left-click only
      updatePointer(e);
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hits = this.raycaster.intersectObjects(this.tileMeshes);
      if (hits.length > 0) {
        const { r, c } = hits[0].object.userData;
        if (this.onTileClick) this.onTileClick(r, c);
      }
    });
  }

  gridToWorld(r, c) {
    return new THREE.Vector3(
      (c - (COLS - 1) / 2) * CELL_SIZE,
      PIECE_HEIGHT / 2 + 0.01,
      (r - (ROWS - 1) / 2) * CELL_SIZE
    );
  }

  _createPieceBackTexture() {
    const s = 512;
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const ctx = c.getContext('2d');

    // Deep carved obsidian-mahogany coin back
    const grad = ctx.createRadialGradient(s / 2, s / 2, 30, s / 2, s / 2, s / 2);
    grad.addColorStop(0, '#2a1d19');
    grad.addColorStop(0.65, '#171112');
    grad.addColorStop(1, '#0c080a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, s, s);

    // Ornate golden concentric rune circles
    ctx.strokeStyle = '#d4a353';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, 224, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(229, 184, 105, 0.55)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, 188, 0, Math.PI * 2);
    ctx.stroke();

    // Octagonal ancient star seal
    ctx.save();
    ctx.translate(s / 2, s / 2);
    ctx.strokeStyle = 'rgba(235, 175, 85, 0.7)';
    ctx.lineWidth = 4;
    for (let i = 0; i < 8; i++) {
      ctx.rotate(Math.PI / 4);
      ctx.beginPath();
      ctx.moveTo(0, -172);
      ctx.lineTo(34, -75);
      ctx.lineTo(0, -45);
      ctx.stroke();
    }
    // Center arcane jewel
    const jGrad = ctx.createRadialGradient(0, 0, 4, 0, 0, 56);
    jGrad.addColorStop(0, '#ffe4a3');
    jGrad.addColorStop(0.45, '#b87628');
    jGrad.addColorStop(1, '#26140c');
    ctx.fillStyle = jGrad;
    ctx.beginPath();
    ctx.arc(0, 0, 54, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffd98a';
    ctx.lineWidth = 5;
    ctx.stroke();

    // Subtle "暗" ancient seal glyph
    ctx.fillStyle = '#fff5db';
    ctx.font = 'bold 54px "Noto Serif TC", "DFKai-SB", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('封', 0, 4);
    ctx.restore();

    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 8;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  _getPieceFaceTexture(piece) {
    const key = piece.meta.key;
    if (this.faceTextureCache.has(key)) return this.faceTextureCache.get(key);

    const s = 512;
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const ctx = c.getContext('2d');
    const isRed = piece.color === 'red';

    // Clip to circle & draw AI portrait
    ctx.save();
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, 232, 0, Math.PI * 2);
    ctx.clip();

    const img = this.portraitImages.get(key);
    if (img) {
      ctx.drawImage(img, 12, 12, s - 24, s - 24);
    } else {
      ctx.fillStyle = isRed ? '#3a1010' : '#0f1b2c';
      ctx.fillRect(0, 0, s, s);
    }

    // Subtle dark vignette at bottom for crisp character readability
    const vig = ctx.createRadialGradient(s / 2, s / 2, 150, s / 2, s / 2, 240);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.52)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, s, s);
    ctx.restore();

    // Glowing metallic outer ring
    const ringGrad = ctx.createLinearGradient(0, 0, s, s);
    if (isRed) {
      ringGrad.addColorStop(0, '#ffd87a');
      ringGrad.addColorStop(0.5, '#e8512c');
      ringGrad.addColorStop(1, '#ffba52');
    } else {
      ringGrad.addColorStop(0, '#b5f1ff');
      ringGrad.addColorStop(0.5, '#3b82f6');
      ringGrad.addColorStop(1, '#9b5de5');
    }
    ctx.strokeStyle = ringGrad;
    ctx.lineWidth = 22;
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, 236, 0, Math.PI * 2);
    ctx.stroke();

    // Inner filigree line
    ctx.strokeStyle = isRed ? 'rgba(255,230,170,0.75)' : 'rgba(180,240,255,0.75)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, 222, 0, Math.PI * 2);
    ctx.stroke();

    // Embossed Traditional Chinese Character Medallion (Bottom-Right for 100% instant readability!)
    const bx = 376, by = 378, br = 76;
    const medGrad = ctx.createRadialGradient(bx - 12, by - 12, 8, bx, by, br);
    if (isRed) {
      medGrad.addColorStop(0, '#b82514');
      medGrad.addColorStop(1, '#4a0b07');
    } else {
      medGrad.addColorStop(0, '#163859');
      medGrad.addColorStop(1, '#08121f');
    }
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = 14;
    ctx.fillStyle = medGrad;
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 7;
    ctx.strokeStyle = isRed ? '#ffd87a' : '#80e5ff';
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = isRed ? '#fff6dc' : '#e6faff';
    ctx.font = '900 84px "Noto Serif TC", "DFKai-SB", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(piece.meta.char, bx, by + 5);

    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 8;
    tex.colorSpace = THREE.SRGBColorSpace;
    this.faceTextureCache.set(key, tex);
    return tex;
  }

  syncBoard(board) {
    // Clear existing piece meshes
    for (const entry of this.pieceMeshes.values()) {
      this.scene.remove(entry.group);
    }
    this.pieceMeshes.clear();
    this.clearHighlights();

    const sideMatRed = new THREE.MeshStandardMaterial({ color: 0x5c2419, roughness: 0.36, metalness: 0.55 });
    const sideMatBlack = new THREE.MeshStandardMaterial({ color: 0x1d2536, roughness: 0.36, metalness: 0.6 });
    const sideMatHidden = new THREE.MeshStandardMaterial({ color: 0x3b2a20, roughness: 0.45, metalness: 0.42 });

    const cylGeo = new THREE.CylinderGeometry(PIECE_RADIUS, PIECE_RADIUS * 1.04, PIECE_HEIGHT, 40);
    const rimGeo = new THREE.TorusGeometry(PIECE_RADIUS * 0.99, 0.032, 12, 40);

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const piece = board[r][c];
        if (!piece) continue;

        const group = new THREE.Group();
        const faceTex = this._getPieceFaceTexture(piece);

        const topMat = new THREE.MeshStandardMaterial({
          map: faceTex,
          roughness: 0.32,
          metalness: 0.22
        });
        const botMat = new THREE.MeshStandardMaterial({
          map: this.backTexture,
          roughness: 0.42,
          metalness: 0.32
        });

        const sideMat = piece.revealed
          ? (piece.color === 'red' ? sideMatRed : sideMatBlack)
          : sideMatHidden;

        // Cylinder material array: [side, top, bottom]
        const mesh = new THREE.Mesh(cylGeo, [sideMat, topMat, botMat]);
        mesh.rotation.y = Math.PI / 2; // Align portraits upright toward the player
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);

        // Forged metallic bezel ring on top face (hidden until revealed so faction color never leaks!)
        const bezelMat = new THREE.MeshStandardMaterial({
          color: piece.color === 'red' ? 0xe5b158 : 0x6dd5fa,
          roughness: 0.25,
          metalness: 0.85,
          emissive: piece.color === 'red' ? 0x331204 : 0x062033,
          emissiveIntensity: 0.45
        });
        const bezel = new THREE.Mesh(rimGeo, bezelMat);
        bezel.rotation.x = Math.PI / 2;
        bezel.position.y = PIECE_HEIGHT / 2 - 0.01;
        bezel.visible = piece.revealed;
        group.add(bezel);

        const pos = this.gridToWorld(r, c);
        group.position.copy(pos);

        // If face-down, rotate 180 deg around Z so bottom (sealed rune) faces up!
        group.rotation.z = piece.revealed ? 0 : Math.PI;

        this.scene.add(group);
        this.pieceMeshes.set(piece.id, { group, mesh, bezel, piece, sideMatRed, sideMatBlack });
      }
    }
  }

  setSelection(r, c, validMoves = []) {
    this.clearHighlights();
    if (r === null || c === null) {
      this.selectedTile = null;
      this.selectRing.visible = false;
      return;
    }
    this.selectedTile = { r, c };
    const pos = this.gridToWorld(r, c);
    this.selectRing.position.set(pos.x, 0.03, pos.z);
    this.selectRing.visible = true;

    for (const mv of validMoves) {
      const mPos = this.gridToWorld(mv.tr, mv.tc);
      const isCap = mv.type === 'capture';
      const geo = isCap
        ? new THREE.RingGeometry(PIECE_RADIUS * 0.78, PIECE_RADIUS * 1.15, 36)
        : new THREE.CircleGeometry(0.24, 24);
      const mat = new THREE.MeshBasicMaterial({
        color: isCap ? 0xff3b30 : 0x4ade80,
        transparent: true,
        opacity: isCap ? 0.85 : 0.72,
        side: THREE.DoubleSide
      });
      const marker = new THREE.Mesh(geo, mat);
      marker.rotation.x = -Math.PI / 2;
      marker.position.set(mPos.x, 0.035, mPos.z);
      marker.userData = { pulse: true, baseScale: 1 };
      this.highlightGroup.add(marker);
      this.highlightRings.push(marker);
    }
  }

  clearHighlights() {
    while (this.highlightGroup.children.length > 0) {
      const ch = this.highlightGroup.children[0];
      this.highlightGroup.remove(ch);
      ch.geometry.dispose();
      ch.material.dispose();
    }
    this.highlightRings = [];
  }

  // ===================== Dramatic 3D Animations & VFX =====================
  animateFlip(pieceId, color) {
    const entry = this.pieceMeshes.get(pieceId);
    if (!entry) return Promise.resolve();
    entry.mesh.material[0] = color === 'red' ? entry.sideMatRed : entry.sideMatBlack;
    if (entry.bezel) entry.bezel.visible = true;
    const startY = entry.group.position.y;
    const pos = entry.group.position.clone();

    return new Promise(resolve => {
      this.animations.push({
        elapsed: 0,
        duration: 0.44,
        update: (p) => {
          // Parabolic jump + 180° flip
          const ease = 1 - Math.pow(1 - p, 3);
          entry.group.position.y = startY + Math.sin(p * Math.PI) * 1.35;
          entry.group.rotation.z = Math.PI * (1 - ease);
        },
        done: () => {
          entry.group.position.y = startY;
          entry.group.rotation.z = 0;
          this.spawnBurst(pos, color === 'red' ? 0xff6a2b : 0x52d4ff, 26);
          this.triggerShake(0.08, 0.14);
          resolve();
        }
      });
    });
  }

  animateMoveOrCapture(attackerId, defenderId, tr, tc, isCannon, attackerColor, attackerRank = 0, soldierSlaysGeneral = false) {
    const attacker = this.pieceMeshes.get(attackerId);
    const defender = defenderId ? this.pieceMeshes.get(defenderId) : null;
    if (!attacker) return Promise.resolve();

    const startPos = attacker.group.position.clone();
    const endPos = this.gridToWorld(tr, tc);
    const primaryCol = attackerColor === 'red' ? 0xff5a22 : 0x45d1ff;
    const accentCol = attackerColor === 'red' ? 0xffd86b : 0xb36bff;

    // Simple non-capture move
    if (!defender) {
      return new Promise(resolve => {
        this.animations.push({
          elapsed: 0,
          duration: 0.26,
          update: (p) => {
            const ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
            attacker.group.position.lerpVectors(startPos, endPos, ease);
            attacker.group.position.y = startPos.y + Math.sin(p * Math.PI) * 0.42;
          },
          done: () => {
            attacker.group.position.copy(endPos);
            resolve();
          }
        });
      });
    }

    const removeDefender = () => {
      if (this.pieceMeshes.has(defenderId)) {
        this.scene.remove(defender.group);
        this.pieceMeshes.delete(defenderId);
      }
    };

    // ===== 1. CANNON (炮 / 包): High-Arc Artillery Shell + Fiery/Void Explosion =====
    if (isCannon || attackerRank === 1) {
      return new Promise(resolve => {
        // Spawn glowing mortar shell
        const shellGeo = new THREE.SphereGeometry(0.24, 14, 14);
        const shellMat = new THREE.MeshBasicMaterial({ color: accentCol });
        const shell = new THREE.Mesh(shellGeo, shellMat);
        shell.position.copy(startPos);
        shell.position.y += 0.35;
        this.scene.add(shell);

        const shellLight = new THREE.PointLight(primaryCol, 14, 8);
        shell.add(shellLight);

        let lastTrail = 0;
        this.animations.push({
          elapsed: 0,
          duration: 0.42,
          update: (p) => {
            shell.position.lerpVectors(startPos, endPos, p);
            shell.position.y = startPos.y + 0.35 + Math.sin(p * Math.PI) * 3.4;
            // Attacker recoils slightly then starts moving
            if (p < 0.35) {
              const recoil = Math.sin((p / 0.35) * Math.PI) * 0.22;
              const dir = new THREE.Vector3().subVectors(startPos, endPos).normalize();
              attacker.group.position.copy(startPos).addScaledVector(dir, recoil);
            } else {
              const mp = (p - 0.35) / 0.65;
              attacker.group.position.lerpVectors(startPos, endPos, mp * mp);
              attacker.group.position.y = startPos.y + Math.sin(mp * Math.PI) * 1.4;
            }
            if (p - lastTrail > 0.05) {
              lastTrail = p;
              this.spawnBurst(shell.position, primaryCol, 3);
            }
          },
          done: () => {
            this.scene.remove(shell);
            shellGeo.dispose();
            shellMat.dispose();
            attacker.group.position.copy(endPos);
            removeDefender();
            this._vfxExplosion(endPos, primaryCol, accentCol);
            this.triggerShake(0.32, 0.36);
            resolve();
          }
        });
      });
    }

    // ===== 2. CHARIOT (俥 / 車): Wind-up + Heavy Ground Ramming Charge + Knockback =====
    if (attackerRank === 3) {
      const dir = new THREE.Vector3().subVectors(endPos, startPos).normalize();
      const windupPos = startPos.clone().addScaledVector(dir, -0.45);
      // Glowing ramming energy wedge attached to attacker
      const shieldGeo = new THREE.ConeGeometry(0.72, 0.6, 4);
      const shieldMat = new THREE.MeshBasicMaterial({ color: accentCol, transparent: true, opacity: 0.78, blending: THREE.AdditiveBlending });
      const shield = new THREE.Mesh(shieldGeo, shieldMat);
      shield.rotation.x = Math.PI / 2;
      shield.lookAt(dir.clone().multiplyScalar(5));
      shield.position.copy(dir).multiplyScalar(0.55);
      shield.position.y = 0.12;
      attacker.group.add(shield);

      let knocked = false;
      return new Promise(resolve => {
        this.animations.push({
          elapsed: 0,
          duration: 0.44,
          update: (p) => {
            if (p < 0.28) {
              const wp = p / 0.28;
              attacker.group.position.lerpVectors(startPos, windupPos, wp);
            } else {
              const cp = (p - 0.28) / 0.72;
              const ease = cp * cp * cp;
              attacker.group.position.lerpVectors(windupPos, endPos, Math.min(1, ease));
              if (Math.random() < 0.45) this.spawnBurst(attacker.group.position, primaryCol, 2);
              if (cp > 0.78 && !knocked) {
                knocked = true;
                this._vfxRamKnockback(defender, defenderId, dir, primaryCol, accentCol);
                this.spawnShockwave(endPos, accentCol, 2.2);
                this.spawnBurst(endPos, primaryCol, 42);
                this.triggerShake(0.28, 0.3);
              }
            }
          },
          done: () => {
            attacker.group.remove(shield);
            shieldGeo.dispose();
            shieldMat.dispose();
            attacker.group.position.copy(endPos);
            if (!knocked) removeDefender();
            resolve();
          }
        });
      });
    }

    // ===== 3. GENERAL (帥 / 將): Royal Hover + Celestial Pillar of Judgment =====
    if (attackerRank === 6) {
      return new Promise(resolve => {
        this.animations.push({
          elapsed: 0,
          duration: 0.5,
          update: (p) => {
            const ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
            attacker.group.position.lerpVectors(startPos, endPos, ease);
            attacker.group.position.y = startPos.y + Math.sin(p * Math.PI) * 1.9;
          },
          done: () => {
            attacker.group.position.copy(endPos);
            removeDefender();
            this._vfxPillarOfJudgment(endPos, primaryCol, accentCol);
            this.triggerShake(0.3, 0.34);
            resolve();
          }
        });
      });
    }

    // ===== 4. ADVISOR (仕 / 士): Swift Lunge + Twin X-Cross Blade Slash =====
    if (attackerRank === 5) {
      return new Promise(resolve => {
        this.animations.push({
          elapsed: 0,
          duration: 0.32,
          update: (p) => {
            const ease = 1 - Math.pow(1 - p, 3);
            attacker.group.position.lerpVectors(startPos, endPos, ease);
            attacker.group.position.y = startPos.y + Math.sin(p * Math.PI) * 0.95;
          },
          done: () => {
            attacker.group.position.copy(endPos);
            removeDefender();
            this._vfxCrossSlash(endPos, primaryCol, accentCol);
            this.spawnBurst(endPos, accentCol, 34);
            this.triggerShake(0.18, 0.22);
            resolve();
          }
        });
      });
    }

    // ===== 5. ELEPHANT (相 / 象): Arcane Rune Circle Detonation =====
    if (attackerRank === 4) {
      this._vfxArcaneCircle(endPos, primaryCol, accentCol);
      return new Promise(resolve => {
        this.animations.push({
          elapsed: 0,
          duration: 0.44,
          update: (p) => {
            const ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
            attacker.group.position.lerpVectors(startPos, endPos, ease);
            attacker.group.position.y = startPos.y + Math.sin(p * Math.PI) * 1.25;
          },
          done: () => {
            attacker.group.position.copy(endPos);
            removeDefender();
            this.spawnBurst(endPos, accentCol, 44);
            this.spawnShockwave(endPos, primaryCol, 2.1);
            this.triggerShake(0.2, 0.24);
            resolve();
          }
        });
      });
    }

    // ===== 6. HORSE (傌 / 馬): Phantom Afterimage Dash + Swirling Cyclone =====
    if (attackerRank === 2) {
      let ghostsSpawned = 0;
      return new Promise(resolve => {
        this.animations.push({
          elapsed: 0,
          duration: 0.34,
          update: (p) => {
            const ease = 1 - Math.pow(1 - p, 2);
            attacker.group.position.lerpVectors(startPos, endPos, ease);
            attacker.group.position.y = startPos.y + Math.sin(p * Math.PI) * 1.35;
            if (p > (ghostsSpawned + 1) * 0.22 && ghostsSpawned < 3) {
              ghostsSpawned++;
              this._spawnAfterimage(attacker.group.position, accentCol);
            }
          },
          done: () => {
            attacker.group.position.copy(endPos);
            removeDefender();
            this.spawnShockwave(endPos, accentCol, 1.9);
            this.spawnShockwave(endPos, primaryCol, 1.3);
            this.spawnBurst(endPos, primaryCol, 36);
            this.triggerShake(0.18, 0.2);
            resolve();
          }
        });
      });
    }

    // ===== 7. SOLDIER (兵 / 卒): Heroic Strike (or Legendary Finisher if Slaying General!) =====
    return new Promise(resolve => {
      this.animations.push({
        elapsed: 0,
        duration: soldierSlaysGeneral ? 0.54 : 0.34,
        update: (p) => {
          const ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
          attacker.group.position.lerpVectors(startPos, endPos, ease);
          attacker.group.position.y = startPos.y + Math.sin(p * Math.PI) * (soldierSlaysGeneral ? 2.1 : 0.9);
          attacker.group.rotation.x = Math.sin(p * Math.PI) * 0.32;
        },
        done: () => {
          attacker.group.position.copy(endPos);
          attacker.group.rotation.x = 0;
          removeDefender();
          if (soldierSlaysGeneral) {
            this._vfxPillarOfJudgment(endPos, 0xffd700, primaryCol);
            this._vfxCrossSlash(endPos, 0xffffff, 0xffd700);
            this.spawnBurst(endPos, 0xffd700, 75);
            this.triggerShake(0.38, 0.45);
          } else {
            this.spawnBurst(endPos, primaryCol, 30);
            this.spawnShockwave(endPos, accentCol, 1.45);
            this.triggerShake(0.14, 0.16);
          }
          resolve();
        }
      });
    });
  }

  // ===================== Specialized Role VFX Helpers =====================
  _vfxExplosion(origin, primaryCol, accentCol) {
    // Core expanding fireball / void blast sphere + flash light
    const coreGeo = new THREE.SphereGeometry(0.45, 20, 20);
    const coreMat = new THREE.MeshBasicMaterial({ color: accentCol, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending });
    const core = new THREE.Mesh(coreGeo, coreMat);
    core.position.copy(origin);
    core.position.y += 0.3;
    this.scene.add(core);

    const outerGeo = new THREE.SphereGeometry(0.55, 20, 20);
    const outerMat = new THREE.MeshBasicMaterial({ color: primaryCol, transparent: true, opacity: 0.72, wireframe: true, blending: THREE.AdditiveBlending });
    const outer = new THREE.Mesh(outerGeo, outerMat);
    outer.position.copy(core.position);
    this.scene.add(outer);

    const flash = new THREE.PointLight(accentCol, 35, 14);
    flash.position.copy(core.position);
    this.scene.add(flash);

    this.spawnBurst(origin, primaryCol, 65);
    this.spawnBurst(origin, accentCol, 28);
    this.spawnShockwave(origin, primaryCol, 2.9);
    this.spawnShockwave(origin, accentCol, 1.9);

    this.animations.push({
      elapsed: 0,
      duration: 0.52,
      update: (p) => {
        const s = 1 + p * 3.1;
        core.scale.setScalar(s);
        core.material.opacity = 0.95 * (1 - p);
        outer.scale.setScalar(1 + p * 3.8);
        outer.rotation.y += 0.15;
        outer.material.opacity = 0.72 * (1 - p);
        flash.intensity = 35 * Math.pow(1 - p, 2);
      },
      done: () => {
        this.scene.remove(core, outer, flash);
        coreGeo.dispose(); coreMat.dispose();
        outerGeo.dispose(); outerMat.dispose();
      }
    });
  }

  _vfxRamKnockback(defender, defenderId, dir, primaryCol, accentCol) {
    if (!this.pieceMeshes.has(defenderId)) return;
    this.pieceMeshes.delete(defenderId);
    const startP = defender.group.position.clone();
    const flyVel = dir.clone().multiplyScalar(8.5);
    this.animations.push({
      elapsed: 0,
      duration: 0.45,
      update: (p) => {
        defender.group.position.x = startP.x + flyVel.x * p;
        defender.group.position.z = startP.z + flyVel.z * p;
        defender.group.position.y = startP.y + Math.sin(p * Math.PI) * 1.6;
        defender.group.rotation.x += 0.35;
        defender.group.rotation.z += 0.28;
        defender.group.scale.setScalar(Math.max(0.05, 1 - p * 0.9));
      },
      done: () => {
        this.spawnBurst(defender.group.position, accentCol, 18);
        this.scene.remove(defender.group);
      }
    });
  }

  _vfxPillarOfJudgment(origin, primaryCol, accentCol) {
    const beamGeo = new THREE.CylinderGeometry(0.55, 0.85, 11, 24, 1, true);
    const beamMat = new THREE.MeshBasicMaterial({
      color: accentCol,
      transparent: true,
      opacity: 0.88,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.set(origin.x, 5.5, origin.z);
    this.scene.add(beam);

    const flash = new THREE.PointLight(accentCol, 32, 14);
    flash.position.set(origin.x, 1.5, origin.z);
    this.scene.add(flash);

    this.spawnShockwave(origin, accentCol, 2.8);
    this.spawnShockwave(origin, primaryCol, 2.0);
    this.spawnBurst(origin, accentCol, 50);

    this.animations.push({
      elapsed: 0,
      duration: 0.58,
      update: (p) => {
        const w = 1.15 - p * 0.7;
        beam.scale.set(w, 1, w);
        beam.rotation.y += 0.14;
        beam.material.opacity = 0.88 * (1 - p);
        flash.intensity = 32 * (1 - p);
      },
      done: () => {
        this.scene.remove(beam, flash);
        beamGeo.dispose(); beamMat.dispose();
      }
    });
  }

  _vfxCrossSlash(origin, primaryCol, accentCol) {
    const makeArc = (rotY, rotZ, col) => {
      const geo = new THREE.TorusGeometry(0.95, 0.08, 8, 28, Math.PI * 0.85);
      const mat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending });
      const arc = new THREE.Mesh(geo, mat);
      arc.position.set(origin.x, origin.y + 0.45, origin.z);
      arc.rotation.set(Math.PI * 0.35, rotY, rotZ);
      this.scene.add(arc);
      return { arc, geo, mat };
    };
    const s1 = makeArc(0.7, 0.4, accentCol);
    const s2 = makeArc(-0.7, -0.4, primaryCol);

    this.animations.push({
      elapsed: 0,
      duration: 0.36,
      update: (p) => {
        const sc = 0.6 + p * 1.45;
        s1.arc.scale.setScalar(sc);
        s2.arc.scale.setScalar(sc);
        s1.arc.rotation.z += 0.22;
        s2.arc.rotation.z -= 0.22;
        s1.mat.opacity = 0.95 * (1 - p);
        s2.mat.opacity = 0.95 * (1 - p);
      },
      done: () => {
        this.scene.remove(s1.arc, s2.arc);
        s1.geo.dispose(); s1.mat.dispose();
        s2.geo.dispose(); s2.mat.dispose();
      }
    });
  }

  _vfxArcaneCircle(origin, primaryCol, accentCol) {
    const group = new THREE.Group();
    group.position.set(origin.x, 0.06, origin.z);
    const outerGeo = new THREE.RingGeometry(0.75, 0.92, 6);
    const innerGeo = new THREE.RingGeometry(0.45, 0.56, 6);
    const m1 = new THREE.MeshBasicMaterial({ color: accentCol, transparent: true, opacity: 0.9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    const m2 = new THREE.MeshBasicMaterial({ color: primaryCol, transparent: true, opacity: 0.85, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    const r1 = new THREE.Mesh(outerGeo, m1);
    const r2 = new THREE.Mesh(innerGeo, m2);
    r1.rotation.x = r2.rotation.x = -Math.PI / 2;
    r2.rotation.z = Math.PI / 6;
    group.add(r1, r2);
    this.scene.add(group);

    this.animations.push({
      elapsed: 0,
      duration: 0.62,
      update: (p) => {
        const sc = p < 0.7 ? (0.4 + (p / 0.7) * 1.1) : (1.5 + (p - 0.7) * 2.5);
        group.scale.setScalar(sc);
        group.rotation.y += 0.16;
        const op = p < 0.7 ? 0.9 : 0.9 * (1 - (p - 0.7) / 0.3);
        m1.opacity = op;
        m2.opacity = op;
      },
      done: () => {
        this.scene.remove(group);
        outerGeo.dispose(); innerGeo.dispose();
        m1.dispose(); m2.dispose();
      }
    });
  }

  _spawnAfterimage(pos, hexColor) {
    const geo = new THREE.CylinderGeometry(PIECE_RADIUS * 0.95, PIECE_RADIUS, PIECE_HEIGHT, 24);
    const mat = new THREE.MeshBasicMaterial({ color: hexColor, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending });
    const ghost = new THREE.Mesh(geo, mat);
    ghost.position.copy(pos);
    this.scene.add(ghost);
    this.animations.push({
      elapsed: 0,
      duration: 0.32,
      update: (p) => {
        ghost.material.opacity = 0.5 * (1 - p);
        ghost.scale.setScalar(1 + p * 0.15);
      },
      done: () => {
        this.scene.remove(ghost);
        geo.dispose(); mat.dispose();
      }
    });
  }

  spawnBurst(origin, hexColor, count = 30) {
    const geo = new THREE.SphereGeometry(0.06, 6, 6);
    const mat = new THREE.MeshBasicMaterial({ color: hexColor, transparent: true, opacity: 1 });
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(geo, mat.clone());
      m.position.copy(origin);
      m.position.y += 0.15;
      const angle = Math.random() * Math.PI * 2;
      const spd = 1.6 + Math.random() * 4.2;
      const vy = 2.0 + Math.random() * 4.0;
      this.scene.add(m);
      this.vfxParticles.push({
        mesh: m,
        vx: Math.cos(angle) * spd,
        vy,
        vz: Math.sin(angle) * spd,
        life: 0,
        maxLife: 0.45 + Math.random() * 0.45
      });
    }
  }

  spawnShockwave(origin, hexColor, maxScale = 1.8) {
    const geo = new THREE.RingGeometry(0.3, 0.55, 36);
    const mat = new THREE.MeshBasicMaterial({ color: hexColor, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(geo, mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(origin.x, 0.06, origin.z);
    this.scene.add(ring);

    this.animations.push({
      elapsed: 0,
      duration: 0.42,
      update: (p) => {
        const s = 1 + p * maxScale;
        ring.scale.set(s, s, 1);
        ring.material.opacity = 0.9 * (1 - p);
      },
      done: () => {
        this.scene.remove(ring);
        geo.dispose();
        mat.dispose();
      }
    });
  }

  triggerShake(intensity = 0.15, duration = 0.2) {
    this.shakeIntensity = Math.max(this.shakeIntensity, intensity);
    this.shakeTime = Math.max(this.shakeTime, duration);
  }

  cycleCameraPreset() {
    this.cameraPresetIdx = (this.cameraPresetIdx + 1) % CAMERA_PRESETS.length;
    const preset = CAMERA_PRESETS[this.cameraPresetIdx];
    this.cameraLerp = {
      startPos: this.camera.position.clone(),
      endPos: preset.pos.clone(),
      startTarget: this.controls.target.clone(),
      endTarget: preset.target.clone(),
      t: 0
    };
    return preset.name;
  }

  setMenuOrbit(enabled) {
    this.menuOrbit = enabled;
    if (!enabled) {
      const preset = CAMERA_PRESETS[this.cameraPresetIdx];
      this.cameraLerp = {
        startPos: this.camera.position.clone(),
        endPos: preset.pos.clone(),
        startTarget: this.controls.target.clone(),
        endTarget: preset.target.clone(),
        t: 0
      };
    }
  }

  _animate() {
    requestAnimationFrame(() => this._animate());
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const elapsed = this.clock.getElapsedTime();

    // Dynamic dark-fantasy torch & abyssal rim light flicker
    this.crimsonLight.intensity = 17 + Math.sin(elapsed * 7.2) * 2.2 + Math.sin(elapsed * 13.5) * 1.1;
    this.abyssLight.intensity = 15 + Math.sin(elapsed * 3.8 + 1.5) * 2.5;

    // Gentle orbit while in menu
    if (this.menuOrbit) {
      const angle = elapsed * 0.16;
      this.camera.position.set(Math.sin(angle) * 12.2, 8.8, Math.cos(angle) * 12.2);
      this.camera.lookAt(0, 0, 0);
    } else if (this.cameraLerp) {
      this.cameraLerp.t += dt * 2.4;
      const p = Math.min(1, this.cameraLerp.t);
      const ease = 1 - Math.pow(1 - p, 3);
      this.camera.position.lerpVectors(this.cameraLerp.startPos, this.cameraLerp.endPos, ease);
      this.controls.target.lerpVectors(this.cameraLerp.startTarget, this.cameraLerp.endTarget, ease);
      if (p >= 1) this.cameraLerp = null;
      this.controls.update();
    } else {
      this.controls.update();
    }

    // Screen micro-shake on heavy impacts
    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      const mag = this.shakeIntensity * Math.max(0, this.shakeTime * 4);
      this.camera.position.x += (Math.random() - 0.5) * mag;
      this.camera.position.y += (Math.random() - 0.5) * mag;
    }

    // Pulse valid capture/move markers
    for (const r of this.highlightRings) {
      const s = 1 + 0.09 * Math.sin(elapsed * 6);
      r.scale.set(s, s, 1);
    }

    // Float ambient embers & abyssal wisps
    if (this.ambientPoints) {
      const pos = this.ambientPoints.geometry.attributes.position;
      for (let i = 0; i < this.ambientData.length; i++) {
        const d = this.ambientData[i];
        let y = pos.getY(i) + d.speed * dt;
        if (y > 6.5) y = 0.05;
        const x = pos.getX(i) + Math.sin(elapsed * 1.2 + d.phase) * d.drift * dt;
        pos.setY(i, y);
        pos.setX(i, x);
      }
      pos.needsUpdate = true;
    }

    // Update active animations
    for (let i = this.animations.length - 1; i >= 0; i--) {
      const anim = this.animations[i];
      anim.elapsed += dt;
      const p = Math.min(1, anim.elapsed / anim.duration);
      anim.update(p);
      if (p >= 1) {
        anim.done();
        this.animations.splice(i, 1);
      }
    }

    // Update burst VFX particles
    for (let i = this.vfxParticles.length - 1; i >= 0; i--) {
      const pt = this.vfxParticles[i];
      pt.life += dt;
      if (pt.life >= pt.maxLife) {
        this.scene.remove(pt.mesh);
        pt.mesh.material.dispose();
        this.vfxParticles.splice(i, 1);
        continue;
      }
      pt.vy -= 9.5 * dt;
      pt.mesh.position.x += pt.vx * dt;
      pt.mesh.position.y = Math.max(0.05, pt.mesh.position.y + pt.vy * dt);
      pt.mesh.position.z += pt.vz * dt;
      pt.mesh.material.opacity = 1 - pt.life / pt.maxLife;
    }

    this.renderer.render(this.scene, this.camera);
  }
}
