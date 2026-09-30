import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';

/* ---------- Konfiguration ---------- */
const L = 100;            // Kantenlänge der Sandkasten-Box
const GAP = 15;           // Abstand zwischen zwei Ebenen entlang der Achse
const T0 = 8;             // Position der Wurzel auf der Achse
const GOLDEN = 2.399963;
const STORE_KEY = 'systemos-3d-sandbox-v1';

// Jede Achse trägt eine Mindmap-Quelle. Aktuell zeigen alle drei auf dieselbe Karte;
// eine andere Quelle = anderer Dateipfad bei `source`.
// `perp` = die zwei Querdimensionen, `spine` = ihre Lage in Box-Anteilen.
const AXES = [
  { key: 'x', dim: 0, perp: [1, 2], spine: [0.25, 0.75], color: 0xE4674F, source: 'data/systemos.json' },
  { key: 'y', dim: 1, perp: [0, 2], spine: [0.75, 0.25], color: 0x4DB57C, source: 'data/systemos.json' },
  { key: 'z', dim: 2, perp: [0, 1], spine: [0.25, 0.75], color: 0x5FA6B8, source: 'data/systemos.json' },
];

const STATUS = {
  core: '#D08A57', live: '#4DB57C', aktiv: '#5FA6B8', neu: '#A488DB', offen: '#D9A63B',
  risiko: '#E4674F', archiv: '#8C948F', info: '#8FA0B3', ordner: '#8C9A93', datei: '#B8C4BD',
};
const STATUS_TEXT = {
  core: 'Kern', live: 'Live', aktiv: 'Aktiv', neu: 'Neu', offen: 'Offen', risiko: 'Risiko',
  archiv: 'Archiv', info: 'Info', ordner: 'Ordner', datei: 'Datei',
};

/* ---------- Szene ---------- */
const $ = (id) => document.getElementById(id);
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0F1512);
const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 2000);
const DEFAULT_CAM = { p: [L * 1.55, L * 1.1, L * 1.75], t: [L / 2, L / 2, L / 2] };
camera.position.fromArray(DEFAULT_CAM.p);

scene.add(new THREE.HemisphereLight(0xffffff, 0x334039, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(60, 120, 80);
scene.add(sun);

/* Pointer-Handler VOR den OrbitControls registrieren, damit ein Treffer auf einen
   Knoten per stopImmediatePropagation das Drehen der Kamera verhindert. */
const pointer = { down: null, hover: null };
canvas.addEventListener('pointerdown', onPointerDown);
canvas.addEventListener('pointermove', onPointerMove);
canvas.addEventListener('pointerup', onPointerUp);
canvas.addEventListener('pointercancel', onPointerUp);
canvas.addEventListener('dblclick', onDblClick);
canvas.addEventListener('pointerleave', () => setHover(null));

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.zoomSpeed = 1.2;
controls.minDistance = 4;
controls.maxDistance = 900;
controls.target.fromArray(DEFAULT_CAM.t);

/* ---------- Sandkasten-Box, Achsen, Raster ---------- */
function textSprite(text, { size = 1.5, color = '#E2E8E3', weight = 600 } = {}) {
  const fs = 44;
  const cv = document.createElement('canvas');
  const g = cv.getContext('2d');
  g.font = `${weight} ${fs}px system-ui,sans-serif`;
  cv.width = Math.ceil(g.measureText(text).width) + 20;
  cv.height = fs + 20;
  g.font = `${weight} ${fs}px system-ui,sans-serif`;
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = 9;
  g.strokeStyle = '#0F1512';
  g.strokeText(text, 10, cv.height / 2);
  g.fillStyle = color;
  g.fillText(text, 10, cv.height / 2);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
  sp.scale.set((size * cv.width) / cv.height, size, 1);
  sp.center.set(0.5, 0);
  sp.renderOrder = 10;
  return sp;
}
function disposeSprite(sp) {
  sp.material.map.dispose();
  sp.material.dispose();
}

(function buildBox() {
  const box = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(L, L, L)),
    new THREE.LineBasicMaterial({ color: 0x5B6B62 })
  );
  box.position.set(L / 2, L / 2, L / 2);
  scene.add(box);

  const gridMat = { color: 0x2B3731, transparent: true, opacity: 0.7 };
  const mk = () => {
    const g = new THREE.GridHelper(L, 10, 0x3A4A41, 0x22302A);
    Object.assign(g.material, gridMat);
    return g;
  };
  const floor = mk(); floor.position.set(L / 2, 0, L / 2); scene.add(floor);
  const back = mk(); back.rotation.x = Math.PI / 2; back.position.set(L / 2, L / 2, 0); scene.add(back);
  const side = mk(); side.rotation.z = Math.PI / 2; side.position.set(0, L / 2, L / 2); scene.add(side);

  for (const ax of AXES) {
    const dir = new THREE.Vector3().setComponent(ax.dim, 1);
    const arrow = new THREE.ArrowHelper(dir, new THREE.Vector3(), L + 10, ax.color, 5, 2.4);
    scene.add(arrow);
    const tag = textSprite(ax.key.toUpperCase() + '-Achse', { size: 4, color: '#' + ax.color.toString(16).padStart(6, '0') });
    tag.position.copy(dir).multiplyScalar(L + 12);
    scene.add(tag);
    for (let d = 0; d <= 6; d++) {
      const t = textSprite('E' + d, { size: 2, color: '#9AA69F', weight: 500 });
      t.position.copy(dir).multiplyScalar(T0 + d * GAP);
      t.position.setComponent(ax.perp[0], -3);
      scene.add(t);
    }
  }
})();

/* ---------- Knoten & Layout ---------- */
const sphereGeo = new THREE.SphereGeometry(1, 14, 10);
const matCache = {};
const matFor = (s) => matCache[s] ||= new THREE.MeshLambertMaterial({ color: STATUS[s] || STATUS.info });
const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.07, 8, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }));
ring.renderOrder = 9;
ring.visible = false;
scene.add(ring);

const state = {
  axes: [],           // Laufzeitdaten je Achse
  selected: null,
  hit: null,          // Suchtreffer
  lock: 'free',
  labelDepth: 1,
  depth: 2,
  attachLog: [],      // [{axis, parentId, tree}] - angehängte Scans, für Speichern
  stamp: 0,
};

function nodeSize(n) {
  if (n.depth === 0) return 1.7;
  if (n.depth === 1) return 1.25;
  if (n.depth === 2) return 1.0;
  return n.d.s === 'datei' ? 0.42 : 0.7;
}

function build(d, parent, index, axis) {
  const n = {
    d, axis, parent, depth: parent ? parent.depth + 1 : 0,
    id: parent ? `${parent.id}.${index}` : axis.key,
    kids: [], off: new THREE.Vector3(), world: new THREE.Vector3(),
    expanded: false, mesh: null, label: null, stamp: 0,
  };
  axis.byId.set(n.id, n);
  axis.all.push(n);
  n.kids = (d.c || []).map((c, i) => build(c, n, i, axis));
  return n;
}

function spread(depth) { return Math.max(0.9, 3.6 * Math.pow(0.72, depth)); }

function layoutAxis(axis) {
  const [p, q] = axis.perp;
  const stamp = state.stamp;
  const visible = [];
  const place = (n, pu, pv, sx, sy, sz) => {
    const w = n.world;
    const c = [0, 0, 0];
    c[axis.dim] = T0 + n.depth * GAP;
    c[p] = pu; c[q] = pv;
    const shx = sx + n.off.x, shy = sy + n.off.y, shz = sz + n.off.z;
    w.set(c[0] + shx, c[1] + shy, c[2] + shz);
    n.stamp = stamp;
    visible.push(n);
    if (!n.expanded || !n.kids.length) return;
    const count = n.kids.length, s = spread(n.depth);
    n.kids.forEach((k, i) => {
      const r = count === 1 ? 0 : s * Math.sqrt(i + 1);
      const a = i * GOLDEN;
      place(k, pu + r * Math.cos(a), pv + r * Math.sin(a), shx, shy, shz);
    });
  };
  place(axis.root, axis.spine[0] * L, axis.spine[1] * L, 0, 0, 0);
  axis.visible = visible;
}

function relayout() {
  state.stamp++;
  const pick = [];
  let total = 0;
  for (const axis of state.axes) {
    layoutAxis(axis);
    total += axis.visible.length;
    for (const n of axis.shown) if (n.stamp !== state.stamp) hideNode(n);
    axis.shown.clear();
    const seg = new Float32Array(Math.max(0, axis.visible.length - 1) * 6);
    let o = 0;
    for (const n of axis.visible) {
      axis.shown.add(n);
      if (!n.mesh) {
        n.mesh = new THREE.Mesh(sphereGeo, matFor(n.d.s));
        n.mesh.userData.node = n;
        n.mesh.scale.setScalar(nodeSize(n));
        axis.group.add(n.mesh);
      }
      n.mesh.visible = true;
      n.mesh.position.copy(n.world);
      pick.push(n.mesh);
      if (n.parent) {
        seg[o++] = n.parent.world.x; seg[o++] = n.parent.world.y; seg[o++] = n.parent.world.z;
        seg[o++] = n.world.x; seg[o++] = n.world.y; seg[o++] = n.world.z;
      }
      updateLabel(n);
    }
    axis.lines.geometry.setAttribute('position', new THREE.BufferAttribute(seg, 3));
    axis.lines.geometry.computeBoundingSphere();
  }
  pointer.pickables = pick;
  updateRing();
  $('hud').dataset.count = total;
}

function hideNode(n) {
  if (n.mesh) n.mesh.visible = false;
  disposeLabel(n);
}

/* ---------- Labels ---------- */
function labelText(n) {
  let t = n.d.n.length > 38 ? n.d.n.slice(0, 37) + '…' : n.d.n;
  if (n.kids.length && !n.expanded) t = `▸ ${t} (${n.kids.length})`;
  return t;
}
function wantsLabel(n) {
  return n.depth <= state.labelDepth || n === state.selected || n === state.hit || n === pointer.hover;
}
function updateLabel(n) {
  if (n.stamp !== state.stamp || !wantsLabel(n)) return disposeLabel(n);
  if (!n.label) {
    n.label = textSprite(labelText(n), { size: n.depth === 0 ? 2.6 : 1.3, color: n.depth === 0 ? '#FFFFFF' : n === state.selected ? '#FFFFFF' : '#E2E8E3' });
    n.axis.group.add(n.label);
  }
  n.label.position.set(n.world.x, n.world.y + nodeSize(n) + 0.3, n.world.z);
}
function disposeLabel(n) {
  if (!n.label) return;
  n.axis.group.remove(n.label);
  disposeSprite(n.label);
  n.label = null;
}
function refreshLabelsAll() {
  for (const a of state.axes) for (const n of a.visible) updateLabel(n);
}

function updateRing() {
  const s = state.selected;
  if (!s || s.stamp !== state.stamp) { ring.visible = false; return; }
  ring.visible = true;
  ring.position.copy(s.world);
  ring.scale.setScalar(nodeSize(s) * 1.9);
}

/* ---------- Daten laden / Baum aufbauen ---------- */
const dataCache = {};
function loadJSON(url) {
  return dataCache[url] ||= fetch(url).then((r) => {
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    return r.json();
  });
}

async function buildAxes(saved) {
  for (const a of state.axes) {
    scene.remove(a.group);
    for (const n of a.all) if (n.label) disposeSprite(n.label);
    a.lines.geometry.dispose();
  }
  state.axes = [];
  state.attachLog = [];
  state.selected = state.hit = null;
  for (const cfg of AXES) {
    const data = await loadJSON(cfg.source);
    const axis = {
      ...cfg,
      byId: new Map(), all: [], shown: new Set(), visible: [],
      group: new THREE.Group(),
      lines: new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: cfg.color, transparent: true, opacity: 0.6 })),
    };
    axis.lines.frustumCulled = false;
    axis.group.add(axis.lines);
    scene.add(axis.group);
    axis.root = build(data, null, 0, axis);
    state.axes.push(axis);
  }
  for (const at of saved?.attach || []) {
    const axis = state.axes.find((a) => a.key === at.axis);
    const parent = axis?.byId.get(at.parentId);
    if (parent) attachTree(parent, at.tree);
  }
  if (saved) {
    const open = new Set(saved.expanded || []);
    for (const a of state.axes) for (const n of a.all) n.expanded = open.has(n.id) && n.kids.length > 0;
    for (const [id, v] of Object.entries(saved.offs || {})) {
      const n = state.axes.map((a) => a.byId.get(id)).find(Boolean);
      if (n) n.off.fromArray(v);
    }
    setLock(saved.lock || 'free');
    setSlider('depth', saved.depth ?? 2);
    setSlider('labelDepth', saved.labelDepth ?? 1);
    if (saved.camera) {
      camera.position.fromArray(saved.camera.p);
      controls.target.fromArray(saved.camera.t);
    }
  } else {
    expandToDepth(state.depth);
  }
  fitSliderMax();
  relayout();
}

function attachTree(parent, tree) {
  const k = build(tree, parent, parent.kids.length, parent.axis);
  parent.kids.push(k);
  parent.expanded = true;
  return k;
}

function expandToDepth(d) {
  for (const a of state.axes) for (const n of a.all) { n.expanded = n.kids.length > 0 && n.depth < d; disposeLabel(n); }
}
function maxDepth() {
  return Math.max(...state.axes.flatMap((a) => a.all.map((n) => n.depth)));
}
function fitSliderMax() {
  const m = Math.max(maxDepth(), 3);
  $('depth').max = m;
  $('labelDepth').max = m;
}

/* ---------- Auswahl, Hover, Detailpanel ---------- */
function select(n) {
  const prev = state.selected;
  state.selected = n;
  if (prev) disposeLabelIfUnwanted(prev);
  if (n) { disposeLabel(n); updateLabel(n); }
  updateRing();
  renderPanel(n);
}
function disposeLabelIfUnwanted(n) { if (!wantsLabel(n)) disposeLabel(n); else { disposeLabel(n); updateLabel(n); } }

const tip = $('tip');
function setHover(n, ev) {
  const prev = pointer.hover;
  if (prev !== n) {
    pointer.hover = n;
    if (prev) { prev.mesh.scale.setScalar(nodeSize(prev)); disposeLabelIfUnwanted(prev); }
    if (n) { n.mesh.scale.setScalar(nodeSize(n) * 1.35); updateLabel(n); }
    canvas.style.cursor = n ? 'pointer' : '';
  }
  if (n && ev && !pointer.down) {
    const r = canvas.getBoundingClientRect();
    tip.textContent = n.d.n + (n.d.m ? ` · ${n.d.m}` : '');
    tip.style.display = 'block';
    tip.style.left = Math.min(ev.clientX - r.left + 14, r.width - 330) + 'px';
    tip.style.top = ev.clientY - r.top + 14 + 'px';
  } else tip.style.display = 'none';
}

function renderPanel(n) {
  const el = $('panel');
  el.replaceChildren();
  if (!n) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  const add = (tag, text, cls) => {
    const e = document.createElement(tag);
    e.textContent = text;
    if (cls) e.className = cls;
    el.append(e);
    return e;
  };
  add('h2', n.d.n);
  const pill = add('span', STATUS_TEXT[n.d.s] || n.d.s || '–', 'pill');
  pill.style.setProperty('--c', STATUS[n.d.s] || STATUS.info);
  if (n.d.m) add('p', n.d.m);
  if (n.d.d) add('p', n.d.d);
  if (n.d.z) { add('div', 'Zielaktion: ' + n.d.z[0], 'k'); add('p', n.d.z[1]); }
  if (n.d.ak) { add('div', 'Gedankenanker', 'k'); add('p', n.d.ak); }
  if (n.d.p) { add('div', 'Pfad', 'k'); add('div', n.d.p, 'path'); }
  add('div', `Achse ${n.axis.key.toUpperCase()} · Ebene ${n.depth} · ${n.kids.length} Kinder`, 'k');
  if (typeof n.d.url === 'string' && n.d.url.startsWith('https://')) {
    const a = add('a', 'Verknüpftes Artifact öffnen ↗');
    a.href = n.d.url; a.target = '_blank'; a.rel = 'noopener';
  }
}

/* ---------- Picking & Ziehen ---------- */
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function setRay(ev) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
}
function pickNode(ev) {
  if (!pointer.pickables) return null;
  setRay(ev);
  const hit = raycaster.intersectObjects(pointer.pickables, false)[0];
  return hit ? hit.object.userData.node : null;
}

function makePlane(n) {
  const camDir = camera.getWorldDirection(new THREE.Vector3());
  const normal = camDir.clone();
  let axisDir = null;
  if (state.lock !== 'free') {
    axisDir = new THREE.Vector3().setComponent(AXES.find((a) => a.key === state.lock).dim, 1);
    normal.addScaledVector(axisDir, -camDir.dot(axisDir));
    if (normal.length() < 0.25) return { plane: new THREE.Plane().setFromNormalAndCoplanarPoint(camDir, n.world), axisDir };
    normal.normalize();
  }
  return { plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal, n.world), axisDir };
}

function onPointerDown(ev) {
  if (ev.button !== 0) return;
  const n = pickNode(ev);
  if (!n) return;
  ev.stopImmediatePropagation();
  canvas.setPointerCapture(ev.pointerId);
  const { plane, axisDir } = makePlane(n);
  const start = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
  pointer.down = { n, sx: ev.clientX, sy: ev.clientY, moved: false, plane, axisDir, start, startOff: n.off.clone() };
  tip.style.display = 'none';
}

function onPointerMove(ev) {
  const d = pointer.down;
  if (!d) {
    if (ev.buttons) return;
    return setHover(pickNode(ev), ev);
  }
  if (!d.moved && Math.hypot(ev.clientX - d.sx, ev.clientY - d.sy) < 4) return;
  d.moved = true;
  setRay(ev);
  const hit = raycaster.ray.intersectPlane(d.plane, new THREE.Vector3());
  if (!hit || !d.start) return;
  const delta = hit.sub(d.start);
  if (d.axisDir) delta.copy(d.axisDir).multiplyScalar(delta.dot(d.axisDir));
  d.n.off.copy(d.startOff).add(delta);
  relayout();
  if (state.selected === d.n) renderPanel(d.n);
  markDirty();
}

function onPointerUp(ev) {
  const d = pointer.down;
  pointer.down = null;
  if (!d) return;
  if (canvas.hasPointerCapture(ev.pointerId)) canvas.releasePointerCapture(ev.pointerId);
  if (d.moved) { select(d.n); return; }
  toggle(d.n);
  select(d.n);
}

function onDblClick(ev) {
  const n = pickNode(ev);
  if (n) focusOn(n.world);
}

function toggle(n) {
  if (!n.kids.length) return;
  n.expanded = !n.expanded;
  disposeLabel(n);
  relayout();
  markDirty();
}

/* ---------- Kamera-Flug ---------- */
let fly = null;
function flyTo(pos, target, ms = 650) {
  fly = { t0: performance.now(), ms, p0: camera.position.clone(), t0v: controls.target.clone(), p1: pos, t1: target };
}
function focusOn(point, dist = 32) {
  const dir = camera.position.clone().sub(controls.target).normalize();
  flyTo(point.clone().addScaledVector(dir, dist), point.clone());
}
function resetView() {
  flyTo(new THREE.Vector3().fromArray(DEFAULT_CAM.p), new THREE.Vector3().fromArray(DEFAULT_CAM.t));
}

/* ---------- Bedienelemente ---------- */
function setLock(v) {
  state.lock = v;
  document.querySelectorAll('#lock button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lock === v)));
}
function setSlider(id, v) {
  $(id).value = v;
  $(id === 'depth' ? 'depthV' : 'labelV').textContent = v;
  state[id] = +v;
}
document.querySelectorAll('#lock button').forEach((b) => b.addEventListener('click', () => { setLock(b.dataset.lock); markDirty(); }));
$('depth').addEventListener('input', (e) => {
  setSlider('depth', e.target.value);
  expandToDepth(state.depth);
  relayout();
  markDirty();
});
$('labelDepth').addEventListener('input', (e) => {
  setSlider('labelDepth', e.target.value);
  refreshLabelsAll();
  markDirty();
});
$('fit').addEventListener('click', resetView);
$('resetPos').addEventListener('click', () => {
  for (const a of state.axes) for (const n of a.all) n.off.set(0, 0, 0);
  relayout();
  markDirty();
  toast('Alle Äste zurück auf Ausgangsposition');
});

/* Suche */
let matches = [], matchIdx = -1, lastQ = '';
function runSearch() {
  const q = $('q').value.trim().toLowerCase();
  if (!q) { matches = []; state.hit = null; return; }
  if (q !== lastQ) {
    lastQ = q;
    const all = state.axes.flatMap((a) => a.all);
    const byName = all.filter((n) => n.d.n.toLowerCase().includes(q));
    const byPath = all.filter((n) => !byName.includes(n) && (n.d.p || '').toLowerCase().includes(q));
    matches = [...byName, ...byPath];
    matchIdx = -1;
  }
  if (!matches.length) return toast('Kein Treffer');
  matchIdx = (matchIdx + 1) % matches.length;
  const n = matches[matchIdx];
  for (let p = n.parent; p; p = p.parent) p.expanded = true;
  const oldHit = state.hit;
  state.hit = n;
  if (oldHit) disposeLabel(oldHit);
  relayout();
  select(n);
  focusOn(n.world);
  toast(`Treffer ${matchIdx + 1} / ${matches.length} · Achse ${n.axis.key.toUpperCase()}`);
}
$('qNext').addEventListener('click', runSearch);
$('q').addEventListener('keydown', (e) => { if (e.key === 'Enter') runSearch(); });

/* Ordner-Scan anhängen */
const fileInput = $('file');
let fileMode = 'import';
function pickFile(mode) { fileMode = mode; fileInput.value = ''; fileInput.click(); }
$('import').addEventListener('click', () => pickFile('import'));
$('attach').addEventListener('click', () => {
  if (!state.selected) return toast('Erst einen Knoten wählen, an den der Scan gehängt wird');
  pickFile('attach');
});
$('attachRepos').addEventListener('click', async () => {
  const parent = state.selected || state.axes[0].root;
  try { attachAndShow(parent, await loadJSON('data/repos-scan.json')); } catch (e) { toast('Repo-Scan nicht ladbar: ' + e.message); }
});
fileInput.addEventListener('change', async () => {
  const f = fileInput.files[0];
  if (!f) return;
  let json;
  try { json = JSON.parse(await f.text()); } catch { return toast('Keine gültige JSON-Datei'); }
  if (fileMode === 'attach') {
    if (typeof json.n !== 'string') return toast('Kein Scan-Baum (Feld "n" fehlt)');
    attachAndShow(state.selected, json);
  } else {
    if (json.v !== 1) return toast('Keine Zustandsdatei dieser App');
    await buildAxes(json);
    persist(json);
    toast('Zustand importiert');
  }
});
function attachAndShow(parent, tree) {
  const k = attachTree(parent, tree);
  state.attachLog.push({ axis: parent.axis.key, parentId: parent.id, tree });
  fitSliderMax();
  relayout();
  select(parent);
  focusOn(k.world, 45);
  markDirty();
  toast(`„${tree.n}“ an ${parent.d.n} angehängt`);
}

/* ---------- Zustand speichern / laden ---------- */
function snapshot() {
  const expanded = [], offs = {};
  for (const a of state.axes) for (const n of a.all) {
    if (n.expanded) expanded.push(n.id);
    if (n.off.lengthSq() > 0) offs[n.id] = n.off.toArray().map((v) => +v.toFixed(3));
  }
  return {
    v: 1, savedAt: new Date().toISOString(),
    camera: { p: camera.position.toArray().map((v) => +v.toFixed(2)), t: controls.target.toArray().map((v) => +v.toFixed(2)) },
    lock: state.lock, depth: state.depth, labelDepth: state.labelDepth,
    expanded, offs, attach: state.attachLog,
  };
}
function persist(snap) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(snap)); return true; } catch { return false; }
}
let dirty = false;
function markDirty() {
  dirty = true;
  $('save').textContent = 'Zustand speichern •';
}
function save() {
  const ok = persist(snapshot());
  dirty = false;
  $('save').textContent = 'Zustand speichern';
  toast(ok ? 'Zustand gespeichert (Browser). Für den nächsten Schritt zusätzlich „Export“ nutzen.' : 'Browser-Speicher voll – bitte „Export“ nutzen');
}
$('save').addEventListener('click', save);
$('export').addEventListener('click', () => {
  const snap = snapshot();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(snap, null, 1)], { type: 'application/json' }));
  a.download = `systemos-3d-zustand-${snap.savedAt.slice(0, 19).replace(/[:T]/g, '-')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  persist(snap);
  dirty = false;
  $('save').textContent = 'Zustand speichern';
  toast('Zustand als Datei exportiert');
});
addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });

addEventListener('keydown', (e) => {
  if (e.target.matches('input')) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); return save(); }
  const map = { 1: 'free', 2: 'x', 3: 'y', 4: 'z' };
  if (map[e.key]) { setLock(map[e.key]); markDirty(); }
  else if (e.key === 'f' && state.selected) focusOn(state.selected.world);
  else if (e.key === 'Escape') select(null);
});

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 3200);
}

/* ---------- Render-Loop ---------- */
function resize() {
  const r = canvas.parentElement.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / Math.max(r.height, 1);
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas.parentElement);
resize();

renderer.setAnimationLoop(() => {
  if (fly) {
    const k = Math.min(1, (performance.now() - fly.t0) / fly.ms);
    const e = 1 - Math.pow(1 - k, 3);
    camera.position.lerpVectors(fly.p0, fly.p1, e);
    controls.target.lerpVectors(fly.t0v, fly.t1, e);
    if (k >= 1) fly = null;
  }
  controls.update();
  if (ring.visible) ring.quaternion.copy(camera.quaternion);
  renderer.render(scene, camera);
});
controls.addEventListener('start', () => { fly = null; });

/* ---------- Start ---------- */
(async () => {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch { /* leer */ }
  if (saved && saved.v !== 1) saved = null;
  try {
    await buildAxes(saved);
    if (saved) toast(`Gespeicherten Zustand geladen (${new Date(saved.savedAt).toLocaleString('de-DE')})`);
  } catch (e) {
    console.error(e);
    toast('Daten konnten nicht geladen werden: ' + e.message);
  }
  window.__sandbox = {
    state, snapshot, relayout,
    project(n) {
      const r = canvas.getBoundingClientRect(), v = n.world.clone().project(camera);
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
    },
  };  // für Tests / Konsole
})();
