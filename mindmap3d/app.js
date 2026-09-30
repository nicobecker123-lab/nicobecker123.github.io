import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';

/* ---------- Konfiguration ---------- */
const S = 3;              // Gesamtmaßstab der Szene (Layout, Box, Beschriftung)
const L = 100 * S;        // Kantenlänge der Sandkasten-Box
const GAP = 15 * S;       // Abstand zwischen zwei Ebenen entlang der Achse
const T0 = 8 * S;         // Position der Wurzel auf der Achse
const NODE = 1.6;         // Knotengröße relativ zum Layout (kleiner als S = mehr Zwischenraum)
const LINK_COLOR = 0xF2C14E;
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
const camera = new THREE.PerspectiveCamera(50, 1, 1, 8000);
const DEFAULT_CAM = { p: [L * 1.55, L * 1.1, L * 1.75], t: [L / 2, L / 2, L / 2] };
camera.position.fromArray(DEFAULT_CAM.p);

scene.add(new THREE.HemisphereLight(0xffffff, 0x334039, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(60 * S, 120 * S, 80 * S);
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
controls.minDistance = 10;
controls.maxDistance = 2800;
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
    const arrow = new THREE.ArrowHelper(dir, new THREE.Vector3(), L + 10 * S, ax.color, 5 * S, 2.4 * S);
    arrow.line.material.transparent = true;
    arrow.line.material.opacity = 0.45;
    arrow.cone.material.transparent = true;
    arrow.cone.material.opacity = 0.55;
    scene.add(arrow);
    const tag = textSprite(ax.key.toUpperCase() + '-Achse', { size: 4 * S, color: '#' + ax.color.toString(16).padStart(6, '0') });
    tag.position.copy(dir).multiplyScalar(L + 12 * S);
    scene.add(tag);
    for (let d = 0; d <= 6; d++) {
      const t = textSprite('E' + d, { size: 2 * S, color: '#9AA69F', weight: 500 });
      t.position.copy(dir).multiplyScalar(T0 + d * GAP);
      t.position.setComponent(ax.perp[0], -3 * S);
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
  captured: new Set(),  // im Lexikon erfasste Dokumente (Schlüssel)
  home: null,           // vom Nutzer fixierte Startansicht {p, t}
  links: [],            // freie Verknüpfungen [{id, a, b, label}] zwischen Knoten-IDs
  linkMode: false,
  milestones: [],       // markierte Zwischenstände {id, name, note, at, metrics, extra?, snap?, seed?}
};
let linkSeq = 0;

function nodeSize(n) {
  const base = n.depth === 0 ? 1.7 : n.depth === 1 ? 1.25 : n.depth === 2 ? 1.0 : n.d.s === 'datei' ? 0.42 : 0.7;
  return base * NODE;
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

function spread(depth) { return S * Math.max(0.9, 3.6 * Math.pow(0.72, depth)); }

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
  renderLinks();
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
    n.label = textSprite(labelText(n), { size: (n.depth === 0 ? 2.6 : 1.3) * S * 0.9, color: n.depth === 0 ? '#FFFFFF' : n === state.selected ? '#FFFFFF' : '#E2E8E3' });
    n.axis.group.add(n.label);
  }
  n.label.position.set(n.world.x, n.world.y + nodeSize(n) + 0.3 * S, n.world.z);
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
  state.captured = new Set();
  state.links = [];
  linkSeq = 0;
  state.milestones = saved?.milestones ? [...saved.milestones] : [];
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
    state.captured = new Set(saved.captured || []);
    setLock(saved.lock || 'free');
    setSlider('depth', saved.depth ?? 2);
    setSlider('labelDepth', saved.labelDepth ?? 1);
    state.home = saved.scale === S ? saved.home || null : null;
    if (state.home) {
      camera.position.fromArray(state.home.p);
      controls.target.fromArray(state.home.t);
    }
    const f = S / (saved.scale || 1);
    for (const l of saved.links || []) {
      if (nodeById(l.a) && nodeById(l.b)) state.links.push({ id: ++linkSeq, a: l.a, b: l.b, label: l.label || '' });
    }
    if (f !== 1) for (const a of state.axes) for (const n of a.all) n.off.multiplyScalar(f);
  } else {
    expandToDepth(state.depth);
  }
  fitSliderMax();
  relayout();
  lexRebuild();
  renderLinkPanel();
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
  if (state.linkMode || ev.shiftKey) {
    const facing = new THREE.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()), n.world);
    pointer.down = { link: true, n, sx: ev.clientX, sy: ev.clientY, moved: false, plane: facing };
    tip.style.display = 'none';
    return;
  }
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
  if (d.link) return dragWire(d, ev);
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
  if (d.link) {
    rubber.visible = false;
    setHover(null);
    if (d.moved) {
      const target = pickNode(ev);
      if (target && target !== d.n) addLink(d.n, target);
    }
    select(d.n);
    return;
  }
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
function focusOn(point, dist = 70) {
  const dir = camera.position.clone().sub(controls.target).normalize();
  flyTo(point.clone().addScaledVector(dir, dist), point.clone());
}
function resetView() {
  const h = state.home || DEFAULT_CAM;
  flyTo(new THREE.Vector3().fromArray(h.p), new THREE.Vector3().fromArray(h.t));
}
$('setHome').addEventListener('click', () => {
  state.home = { p: camera.position.toArray().map((v) => +v.toFixed(2)), t: controls.target.toArray().map((v) => +v.toFixed(2)) };
  markDirty();
  toast('Startansicht fixiert. Mit „Zustand speichern“ bleibt sie beim nächsten Öffnen erhalten.');
});

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
    await ensureSeedMilestones();
    persist(json);
    toast('Zustand importiert');
  }
});
function attachAndShow(parent, tree) {
  const k = attachTree(parent, tree);
  state.attachLog.push({ axis: parent.axis.key, parentId: parent.id, tree });
  fitSliderMax();
  relayout();
  lexRebuild();
  select(parent);
  focusOn(k.world, 120);
  markDirty();
  toast(`„${tree.n}“ an ${parent.d.n} angehängt`);
}



/* ---------- Verknüpfungen (Node-Editor) ---------- */
const nodeById = (id) => state.axes.map((a) => a.byId.get(id)).find(Boolean);
const linkGroup = new THREE.Group();
scene.add(linkGroup);
const linkMat = new THREE.MeshBasicMaterial({ color: LINK_COLOR, transparent: true, opacity: 0.9 });
const coneGeo = new THREE.ConeGeometry(1, 2.6, 12);
const rubber = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
  new THREE.LineBasicMaterial({ color: LINK_COLOR, depthTest: false })
);
rubber.frustumCulled = false;
rubber.renderOrder = 8;
rubber.visible = false;
scene.add(rubber);

// Zugeklappte Knoten: die Verknüpfung endet am nächsten sichtbaren Vorfahren.
function visibleAnchor(n) {
  let x = n;
  while (x && x.stamp !== state.stamp) x = x.parent;
  return x;
}
function linkCurve(a, b) {
  const p0 = a.world, p1 = b.world;
  const ctrl = p0.clone().add(p1).multiplyScalar(0.5);
  ctrl.y += p0.distanceTo(p1) * 0.18;
  return new THREE.QuadraticBezierCurve3(p0.clone(), ctrl, p1.clone());
}

function renderLinks() {
  for (const c of [...linkGroup.children]) {
    linkGroup.remove(c);
    if (c.isSprite) disposeSprite(c);
    else if (c.geometry !== coneGeo) c.geometry.dispose();
  }
  for (const l of state.links) {
    const a = visibleAnchor(nodeById(l.a)), b = visibleAnchor(nodeById(l.b));
    if (!a || !b || a === b) continue;
    const curve = linkCurve(a, b);
    linkGroup.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 28, 0.32 * S, 6, false), linkMat));
    const cone = new THREE.Mesh(coneGeo, linkMat);
    cone.position.copy(curve.getPoint(0.88));
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), curve.getTangent(0.88));
    cone.scale.setScalar(0.85 * S);
    linkGroup.add(cone);
    if (l.label) {
      const t = textSprite(l.label, { size: 0.9 * S, color: '#F2C14E' });
      t.position.copy(curve.getPoint(0.5));
      linkGroup.add(t);
    }
  }
}

function dragWire(d, ev) {
  setRay(ev);
  const target = pickNode(ev);
  const end = target && target !== d.n ? target.world : raycaster.ray.intersectPlane(d.plane, new THREE.Vector3());
  setHover(target && target !== d.n ? target : null, ev);
  if (!end) return;
  rubber.geometry.setFromPoints([d.n.world, end]);
  rubber.visible = true;
}

function addLink(a, b) {
  if (state.links.some((l) => l.a === a.id && l.b === b.id)) return toast('Diese Verknüpfung gibt es schon');
  state.links.push({ id: ++linkSeq, a: a.id, b: b.id, label: '' });
  renderLinks();
  renderLinkPanel();
  markDirty();
  toast(`Verknüpft: ${a.d.n} → ${b.d.n}`);
}

function setLinkMode(on) {
  state.linkMode = on;
  $('linkMode').setAttribute('aria-pressed', String(on));
  canvas.style.outline = on ? '2px solid #F2C14E' : '';
  canvas.style.outlineOffset = '-2px';
  if (on) toast('Verknüpfen: von einem Knoten auf den Zielknoten ziehen');
}
$('linkMode').addEventListener('click', () => setLinkMode(!state.linkMode));
$('linksToggle').addEventListener('click', () => { const h = $('links').hidden; $('links').hidden = !h; if (h) renderLinkPanel(); });
$('linksClose').addEventListener('click', () => { $('links').hidden = true; });

function renderLinkPanel() {
  $('linksCount').textContent = `${state.links.length}`;
  if ($('links').hidden) return;
  const box = $('linksList');
  box.replaceChildren();
  if (!state.links.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'Noch keine Verknüpfung. „Verknüpfen“ einschalten (oder Shift halten) und von Knoten zu Knoten ziehen.';
    box.append(p);
    return;
  }
  const name = (id) => nodeById(id)?.d.n ?? '(fehlt)';
  for (const l of state.links) {
    const row = document.createElement('div');
    row.className = 'lnk';
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'go';
    go.textContent = `${name(l.a)} → ${name(l.b)}`;
    go.title = 'Zur Verknüpfung fliegen';
    go.addEventListener('click', () => {
      const a = visibleAnchor(nodeById(l.a)), b = visibleAnchor(nodeById(l.b));
      if (!a || !b) return toast('Ein Endpunkt ist zugeklappt oder fehlt');
      const mid = a.world.clone().add(b.world).multiplyScalar(0.5);
      focusOn(mid, Math.max(80, a.world.distanceTo(b.world) * 1.1));
    });
    const label = document.createElement('input');
    label.type = 'text';
    label.placeholder = 'Beschriftung';
    label.value = l.label;
    label.addEventListener('change', () => { l.label = label.value.trim().slice(0, 40); renderLinks(); markDirty(); });
    const swap = document.createElement('button');
    swap.type = 'button';
    swap.textContent = '⇄';
    swap.title = 'Richtung umkehren';
    swap.addEventListener('click', () => { [l.a, l.b] = [l.b, l.a]; renderLinks(); renderLinkPanel(); markDirty(); });
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = '×';
    del.title = 'Verknüpfung löschen';
    del.addEventListener('click', () => { state.links = state.links.filter((x) => x !== l); renderLinks(); renderLinkPanel(); markDirty(); });
    row.append(go, label, swap, del);
    box.append(row);
  }
}

/* ---------- Lexikon: alle Dokumente Schritt für Schritt erfassen ---------- */
const lex = { entries: [], view: [], cur: null, shown: 300 };
const docKey = (n) => n.d.p || [...ancestors(n), n.d.n].join('/');
function ancestors(n) { const r = []; for (let p = n.parent; p; p = p.parent) r.unshift(p.d.n); return r; }
function docFolder(n) {
  const p = n.d.p;
  if (p && p.includes('/')) return p.slice(0, p.lastIndexOf('/'));
  return ancestors(n).join(' / ');
}

function lexRebuild() {
  const map = new Map();
  for (const a of state.axes) for (const n of a.all) {
    if (n.d.s !== 'datei') continue;
    const key = docKey(n);
    let e = map.get(key);
    if (!e) map.set(key, e = { key, name: n.d.n, folder: docFolder(n), size: n.d.m || '', nodes: {} });
    e.nodes[a.key] = n;
  }
  lex.entries = [...map.values()].sort((a, b) => a.folder.localeCompare(b.folder, 'de') || a.name.localeCompare(b.name, 'de', { numeric: true }));
  lexRender();
}

function lexFilter() {
  const q = $('lexQ').value.trim().toLowerCase(), open = $('lexOpen').checked;
  lex.view = lex.entries.filter((e) => (!open || !state.captured.has(e.key)) && (!q || e.name.toLowerCase().includes(q) || e.folder.toLowerCase().includes(q)));
}

function lexRender() {
  if ($('lex').hidden) return;
  lexFilter();
  const box = $('lexList');
  box.replaceChildren();
  let last = null;
  for (const e of lex.view.slice(0, lex.shown)) {
    if (e.folder !== last) {
      last = e.folder;
      const f = document.createElement('div');
      f.className = 'fold';
      f.textContent = e.folder || '(Wurzel)';
      box.append(f);
    }
    const row = document.createElement('div');
    row.className = 'doc' + (state.captured.has(e.key) ? ' done' : '') + (lex.cur === e.key ? ' cur' : '');
    row.dataset.key = e.key;
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = state.captured.has(e.key);
    cb.setAttribute('aria-label', 'Erfasst: ' + e.name);
    cb.addEventListener('change', () => { setCaptured(e.key, cb.checked); lexRender(); });
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = e.name;
    b.addEventListener('click', () => lexGo(e));
    const sz = document.createElement('small');
    sz.textContent = e.size;
    row.append(cb, b, sz);
    box.append(row);
  }
  if (lex.view.length > lex.shown) {
    const more = document.createElement('button');
    more.type = 'button';
    more.textContent = `${lex.view.length - lex.shown} weitere anzeigen`;
    more.addEventListener('click', () => { lex.shown += 300; lexRender(); });
    box.append(more);
  }
  const done = lex.entries.filter((e) => state.captured.has(e.key)).length;
  $('lexProg').textContent = `${done} / ${lex.entries.length} erfasst`;
  box.querySelector('.cur')?.scrollIntoView({ block: 'nearest' });
}

function setCaptured(key, on) {
  on ? state.captured.add(key) : state.captured.delete(key);
  markDirty();
}

function lexGo(e) {
  lex.cur = e.key;
  const n = e.nodes[state.selected?.axis.key] || Object.values(e.nodes)[0];
  for (let p = n.parent; p; p = p.parent) p.expanded = true;
  relayout();
  select(n);
  focusOn(n.world, 45);
  lexRender();
}

function lexStep(dir, capture) {
  lexFilter();
  const all = lex.entries;
  let i = all.findIndex((e) => e.key === lex.cur);
  if (capture && i >= 0) setCaptured(lex.cur, true);
  const ok = (e) => !state.captured.has(e.key);
  let next = null;
  if (dir > 0) next = all.slice(i + 1).find(ok) || (i < 0 ? all.find(ok) : null);
  else next = i > 0 ? all[i - 1] : null;
  if (!next) { lexRender(); return toast(dir > 0 ? 'Keine weiteren offenen Dokumente' : 'Am Anfang der Liste'); }
  lexGo(next);
}

$('lexToggle').addEventListener('click', () => { const h = $('lex').hidden; $('lex').hidden = !h; if (h) { $('ms').hidden = true; lexRender(); } });
$('lexClose').addEventListener('click', () => { $('lex').hidden = true; });
$('lexQ').addEventListener('input', () => { lex.shown = 300; lexRender(); });
$('lexOpen').addEventListener('change', () => { lex.shown = 300; lexRender(); });
$('lexPrev').addEventListener('click', () => lexStep(-1, false));
$('lexSkip').addEventListener('click', () => lexStep(1, false));
$('lexDone').addEventListener('click', () => lexStep(1, true));
$('lexExport').addEventListener('click', () => {
  const lines = ['# Lexikon', '', `${state.captured.size} von ${lex.entries.length} Dokumenten erfasst · ${new Date().toISOString().slice(0, 10)}`];
  let last = null;
  for (const e of lex.entries) {
    if (e.folder !== last) { last = e.folder; lines.push('', `## ${e.folder || '(Wurzel)'}`, ''); }
    const axes = Object.keys(e.nodes).map((k) => k.toUpperCase()).join('/');
    lines.push(`- [${state.captured.has(e.key) ? 'x' : ' '}] ${e.name}${e.size ? ` · ${e.size}` : ''} · ${axes}`);
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lines.join('\n') + '\n'], { type: 'text/markdown' }));
  a.download = 'lexikon.md';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});


/* ---------- Meilensteine: Zwischenstände markieren, Fortschritt messen ---------- */
const METRIC_LABELS = {
  captured: 'Dokumente erfasst', docs: 'Dokumente gesamt', nodes: 'Knoten', links: 'Verknüpfungen',
  moved: 'Verschobene Äste', attached: 'Angehängte Scans',
};

function currentMetrics() {
  let nodes = 0, moved = 0;
  for (const a of state.axes) for (const n of a.all) { nodes++; if (n.off.lengthSq() > 0) moved++; }
  const docs = lex.entries.length;
  const captured = lex.entries.filter((e) => state.captured.has(e.key)).length;
  return { nodes, docs, captured, links: state.links.length, moved, attached: state.attachLog.length };
}

function markMilestone(name, note, auto = false) {
  const snap = snapshot(true);
  const m = {
    id: 'ms-' + Date.now().toString(36), name, note, at: new Date().toISOString(), auto,
    metrics: currentMetrics(),
    // Vollständiger Zustand nur, solange er klein genug für den Browser-Speicher ist.
    snap: JSON.stringify(snap).length <= 400000 ? snap : null,
  };
  state.milestones.push(m);
  markDirty();
  renderMilestones();
  return m;
}

async function ensureSeedMilestones() {
  try {
    const seeds = await loadJSON('data/milestones.json');
    for (const sd of seeds) if (!state.milestones.some((m) => m.id === sd.id)) state.milestones.push(sd);
  } catch { /* Seeds sind optional */ }
}

const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1).replace('.', ',') + ' %' : '–');
const fmtDate = (iso) => new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

function metricLine(m, prev) {
  const wrap = document.createElement('div');
  wrap.className = 'mets';
  const chip = (label, value, delta) => {
    const c = document.createElement('span');
    c.textContent = `${label}: ${value}`;
    if (typeof delta === 'number' && delta !== 0) {
      const d = document.createElement('b');
      d.className = delta > 0 ? 'up' : 'down';
      d.textContent = ` ${delta > 0 ? '+' : ''}${delta}`;
      c.append(d);
    }
    wrap.append(c);
  };
  const met = m.metrics || {};
  for (const k of Object.keys(METRIC_LABELS)) {
    if (met[k] === undefined || k === 'docs') continue;
    const value = k === 'captured' ? `${met.captured}/${met.docs} (${pct(met.captured, met.docs)})` : met[k];
    chip(METRIC_LABELS[k], value, prev?.metrics?.[k] !== undefined ? met[k] - prev.metrics[k] : undefined);
  }
  for (const [k, v] of Object.entries(m.extra || {})) chip(k, v);
  return wrap;
}

function renderMilestones() {
  if ($('ms').hidden) return;
  const list = [...state.milestones].sort((a, b) => a.at.localeCompare(b.at));
  const box = $('msList');
  box.replaceChildren();

  const cards = [];
  const now = { id: 'now', name: 'Jetzt', note: 'Laufender Stand, noch nicht markiert', at: new Date().toISOString(), metrics: currentMetrics(), live: true };
  const withMetrics = list.filter((m) => Object.keys(m.metrics || {}).length);
  cards.push({ m: now, prev: withMetrics.at(-1) });
  for (let i = list.length - 1; i >= 0; i--) {
    const prev = list.slice(0, i).reverse().find((p) => Object.keys(p.metrics || {}).length && Object.keys(list[i].metrics || {}).length);
    cards.push({ m: list[i], prev });
  }

  for (const { m, prev } of cards) {
    const card = document.createElement('div');
    card.className = 'card' + (m.live ? ' live' : '');
    const head = document.createElement('div');
    head.className = 'head';
    const t = document.createElement('b');
    t.textContent = m.name + (m.auto ? ' (automatisch)' : '');
    const when = document.createElement('small');
    when.textContent = m.live ? '' : fmtDate(m.at);
    head.append(t, when);
    card.append(head);
    if (m.note) { const p = document.createElement('p'); p.textContent = m.note; card.append(p); }
    if (m.metrics?.docs) {
      const bar = document.createElement('div');
      bar.className = 'bar2';
      const fill = document.createElement('i');
      fill.style.width = Math.min(100, (m.metrics.captured / m.metrics.docs) * 100) + '%';
      bar.append(fill);
      card.append(bar);
    }
    card.append(metricLine(m, prev));
    if (!m.live) {
      const act = document.createElement('div');
      act.className = 'act';
      if (m.snap) {
        const load = document.createElement('button');
        load.type = 'button';
        load.textContent = 'Laden';
        load.title = 'Diesen Zwischenstand wiederherstellen';
        load.addEventListener('click', async () => {
          if (!confirm(`Aktuellen Stand verlassen und „${m.name}“ laden?`)) return;
          const keep = state.milestones;
          await buildAxes(m.snap);
          state.milestones = keep;
          markDirty();
          renderMilestones();
          toast(`„${m.name}“ geladen`);
        });
        act.append(load);
      }
      if (!m.seed) {
        const del = document.createElement('button');
        del.type = 'button';
        del.textContent = 'Löschen';
        del.addEventListener('click', () => { state.milestones = state.milestones.filter((x) => x !== m); markDirty(); renderMilestones(); });
        act.append(del);
      }
      if (act.children.length) card.append(act);
    }
    box.append(card);
  }
}

$('msToggle').addEventListener('click', () => {
  const h = $('ms').hidden;
  $('ms').hidden = !h;
  if (h) { $('lex').hidden = true; renderMilestones(); }
});
$('msClose').addEventListener('click', () => { $('ms').hidden = true; });
$('msAdd').addEventListener('click', () => {
  const name = $('msName').value.trim() || `Zwischenstand ${new Date().toLocaleDateString('de-DE')}`;
  markMilestone(name, $('msNote').value.trim());
  $('msName').value = $('msNote').value = '';
  toast(`Zwischenstand „${name}“ markiert. Mit „Zustand speichern“ sichern.`);
});

/* ---------- Zustand speichern / laden ---------- */
function snapshot(nested = false) {
  const expanded = [], offs = {};
  for (const a of state.axes) for (const n of a.all) {
    if (n.expanded) expanded.push(n.id);
    if (n.off.lengthSq() > 0) offs[n.id] = n.off.toArray().map((v) => +v.toFixed(3));
  }
  return {
    v: 1, savedAt: new Date().toISOString(),
    scale: S, home: state.home, links: state.links.map(({ a, b, label }) => ({ a, b, label })),
    lock: state.lock, depth: state.depth, labelDepth: state.labelDepth,
    expanded, offs, attach: state.attachLog, captured: [...state.captured],
    ...(nested ? {} : { milestones: state.milestones.filter((m) => !m.seed) }),
  };
}
function persist(snap) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(snap)); return true; } catch { return false; }
}
let dirty = false;
function markDirty() {
  dirty = true;
  if (!$('ms').hidden) renderMilestones();
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
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); return save(); }
  if (e.target.matches('input')) return;
  const map = { 1: 'free', 2: 'x', 3: 'y', 4: 'z' };
  if (map[e.key]) { setLock(map[e.key]); markDirty(); }
  else if (e.key === 'f' && state.selected) focusOn(state.selected.world);
  else if (e.key.toLowerCase() === 'l') setLinkMode(!state.linkMode);
  else if (e.key === 'Escape') { setLinkMode(false); select(null); }
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
    await ensureSeedMilestones();
    if (!saved && !state.milestones.some((m) => !m.seed)) markMilestone(`Zwischenstand ${new Date().toLocaleDateString('de-DE')} · Ausgangspunkt`, 'Automatisch beim ersten Öffnen markiert: Basis für den Fortschrittsvergleich.', true);
    if (state.milestones.some((m) => m.auto)) { persist(snapshot()); dirty = false; $('save').textContent = 'Zustand speichern'; }
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
