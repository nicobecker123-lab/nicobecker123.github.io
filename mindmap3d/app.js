import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';

/* ---------- Konfiguration ---------- */
const S = 3;              // Gesamtmaßstab der Szene (Layout, Box, Beschriftung)
const L = 100 * S;        // Kantenlänge der Sandkasten-Box
const GAP = 15 * S;       // Abstand zwischen zwei Ebenen entlang der Achse
const T0 = 8 * S;         // Position der Wurzel auf der Achse
const NODE = 1.6;         // Knotengröße relativ zum Layout (kleiner als S = mehr Zwischenraum)
const LINK_COLOR = 0xF2C14E;
const STUFEN = [0.6, 1, 1.6, 2.4];   // Abstandsfaktor je Ebenen-Stufe
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

/* Box, Raster und Achsen hängen vom Bedarf der Äste ab und werden bei Änderung neu aufgebaut
   (setBox). Sektoren: Die drei Äste teilen den Würfel in drei gleiche Pyramiden um die Raumdiagonale,
   je 120° breit. Ast X liegt im Bereich x >= max(y, z), Ast Y bei y >= max(x, z), Ast Z bei z >= max(x, y). */
const boxGroup = new THREE.Group();
scene.add(boxGroup);
const sectorPref = { on: true };
let boxL = 0, boxG = 0;

function clearGroup(g) {
  for (const c of [...g.children]) {
    g.remove(c);
    if (c.isSprite) { disposeSprite(c); continue; }
    if (typeof c.dispose === 'function') c.dispose();
    if (c.isGroup) { clearGroup(c); continue; }
    c.geometry?.dispose();
    for (const m of Array.isArray(c.material) ? c.material : [c.material]) m?.dispose();
  }
}

function setBox(Ln, Gn) {
  if (Ln === boxL && Gn === boxG) return;
  boxL = Ln; boxG = Gn;
  clearGroup(boxGroup);
  const box = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(Ln, Ln, Ln)),
    new THREE.LineBasicMaterial({ color: 0x5B6B62 })
  );
  box.position.setScalar(Ln / 2);
  boxGroup.add(box);

  const div = Math.max(2, Math.round(Ln / Gn));
  const mk = () => {
    const g = new THREE.GridHelper(Ln, div, 0x3A4A41, 0x22302A);
    g.material.transparent = true;
    g.material.opacity = 0.7;
    return g;
  };
  const floor = mk(); floor.position.set(Ln / 2, 0, Ln / 2); boxGroup.add(floor);
  const back = mk(); back.rotation.x = Math.PI / 2; back.position.set(Ln / 2, Ln / 2, 0); boxGroup.add(back);
  const side = mk(); side.rotation.z = Math.PI / 2; side.position.set(0, Ln / 2, Ln / 2); boxGroup.add(side);

  for (const ax of AXES) {
    const dir = new THREE.Vector3().setComponent(ax.dim, 1);
    const arrow = new THREE.ArrowHelper(dir, new THREE.Vector3(), Ln + 10 * S, ax.color, 5 * S, 2.4 * S);
    arrow.line.material.transparent = true;
    arrow.line.material.opacity = 0.45;
    arrow.cone.material.transparent = true;
    arrow.cone.material.opacity = 0.55;
    boxGroup.add(arrow);
    const tag = textSprite(ax.key.toUpperCase() + '-Achse', { size: 4 * S, color: '#' + ax.color.toString(16).padStart(6, '0') });
    tag.position.copy(dir).multiplyScalar(Ln + 12 * S);
    boxGroup.add(tag);
  }

  const sec = new THREE.Group();
  sec.name = 'sectors';
  sec.visible = sectorPref.on;
  const D = Ln;
  const faces = [[[0, 0, 0], [D, D, 0], [D, D, D]], [[0, 0, 0], [0, D, D], [D, D, D]], [[0, 0, 0], [D, 0, D], [D, D, D]]];
  for (const f of faces) {
    const geo = new THREE.BufferGeometry().setFromPoints(f.map((p) => new THREE.Vector3(...p)));
    sec.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.045, side: THREE.DoubleSide, depthWrite: false })));
    sec.add(new THREE.LineLoop(geo, new THREE.LineBasicMaterial({ color: 0x8FA0B3, transparent: true, opacity: 0.35 })));
  }
  boxGroup.add(sec);
}
setBox(L, L / 10);

// Ebenenmarken E0..E6 je Achse; ihre Lage folgt den (am Raster eingerasteten) Ebenen.
for (const ax of AXES) {
  ax.ticks = [];
  for (let d = 0; d <= 6; d++) {
    const t = textSprite('E' + d, { size: 2 * S, color: '#9AA69F', weight: 500 });
    t.position.setComponent(ax.perp[0], -3 * S);
    scene.add(t);
    ax.ticks.push(t);
  }
}

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
  obsidian: { vault: 'Sy0sObsidian', folder: 'SystemOS-Mindmap', links: true },   // Obsidian-Konfiguration
  dev: {},              // Dev-Lifecycle je Knoten-ID: wait | test | commit | done
  editor: { nodes: {}, view: { x: 60, y: 60, k: 1 } },   // Node-Editor: Karten-Positionen und Ansicht
  stufe: 2,             // Ebenen-Stufe 1-4 (Abstand und Platz)
  spacing: 1,           // aktuell animierter Abstandsfaktor
  filter: { q: '', st: new Set(), dev: new Set(), linked: false, axes: { x: true, y: true, z: true } },
  lens: { on: false, r: 170, x: 0, y: 0, set: new Set() },   // Objektiv: folgt dem Zeiger
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
    kids: [], off: new THREE.Vector3(), world: new THREE.Vector3(), cs: new THREE.Vector3(),
    expanded: false, mesh: null, label: null, stamp: 0, fkeep: true, fmatch: false, fcol: false,
  };
  axis.byId.set(n.id, n);
  axis.all.push(n);
  n.kids = (d.c || []).map((c, i) => build(c, n, i, axis));
  return n;
}


/* ---------- Dev-Lifecycle: Wartebereich → Test → Commit → Abgeschlossen ----------
   Nichts gilt als fertig, bevor es geprüft und committed ist: Ein Punkt darf nur Schritt für Schritt
   vorrücken (zurück geht immer). Die Startwerte kommen aus dem Karten-Zweig „Dev-Lifecycle“. */
const DEV = [
  { key: 'wait', label: 'Wartebereich', color: '#D9A63B' },
  { key: 'test', label: 'Test', color: '#5FA6B8' },
  { key: 'commit', label: 'Commit', color: '#A488DB' },
  { key: 'done', label: 'Abgeschlossen', color: '#4DB57C' },
];
const devIndex = (key) => DEV.findIndex((d) => d.key === key);
const devMats = {};
const devMat = (key) => devMats[key] ||= new THREE.MeshBasicMaterial({
  color: DEV[devIndex(key)].color, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.BackSide,
});

function seedDevFromMap() {
  for (const a of state.axes) {
    for (const c of a.root.kids) {
      if (!c.d.n.startsWith('Dev-Lifecycle')) continue;
      for (const grp of c.kids) {
        const key = grp.d.n.startsWith('Wartebereich') ? 'wait' : grp.d.n.startsWith('Abgeschlossene') ? 'done' : null;
        if (key) for (const k of grp.kids) state.dev[k.id] = key;
      }
    }
  }
}

function setDev(n, key) {
  const cur = state.dev[n.id] || '';
  if (key && devIndex(key) > devIndex(cur) + 1) {
    return toast(`Erst „${DEV[devIndex(cur) + 1].label}“ abschließen: Nichts springt ungeprüft auf „${DEV[devIndex(key)].label}“.`);
  }
  if (key) state.dev[n.id] = key; else delete state.dev[n.id];
  syncDevShell(n);
  renderPanel(n);
  fltBuild();
  if (filterActive()) fltApply();
  markDirty();
  if (!$('ed').hidden) edRender();
}

function syncDevShell(n) {
  const key = state.dev[n.id];
  if (!n.mesh) return;
  if (!key) { if (n.devShell) { n.mesh.remove(n.devShell); n.devShell = null; } return; }
  if (!n.devShell) {
    n.devShell = new THREE.Mesh(sphereGeo, devMat(key));
    n.devShell.scale.setScalar(1.55);
    n.mesh.add(n.devShell);
  }
  n.devShell.material = devMat(key);
}

function devCounts() {
  const c = { wait: 0, test: 0, commit: 0, done: 0 };
  const seen = new Set();
  for (const a of state.axes) for (const n of a.all) {
    const key = state.dev[n.id];
    if (!key) continue;
    const id = n.d.p || n.id;                  // gleiche Punkte auf mehreren Achsen nur einmal zählen
    if (seen.has(id + key)) continue;
    seen.add(id + key);
    c[key]++;
  }
  return c;
}

/* ---------- Filter: Knoten dynamisch ein-/ausblenden ---------- */
const filterActive = () => !!(state.filter.q.trim() || state.filter.st.size || state.filter.dev.size || state.filter.linked);

function computeFilter() {
  const f = state.filter, q = f.q.trim().toLowerCase(), act = filterActive();
  state.fmatchCount = 0;
  const linkedIds = f.linked ? new Set(state.links.flatMap((l) => [l.a, l.b])) : null;
  const walk = (n) => {
    let keep = false;
    for (const k of n.kids) if (walk(k)) keep = true;
    const pass = act
      && (!q || n.d.n.toLowerCase().includes(q) || (n.d.p || '').toLowerCase().includes(q))
      && (!f.st.size || f.st.has(n.d.s))
      && (!f.dev.size || f.dev.has(state.dev[n.id] || 'none'))
      && (!linkedIds || linkedIds.has(n.id));
    n.fmatch = pass;
    if (pass) state.fmatchCount++;
    n.fkeep = !act || keep || pass;
    return n.fkeep;
  };
  for (const a of state.axes) walk(a.root);
}

// Unter aktivem Filter zeigt ein Knoten automatisch alle Treffer-Pfade (außer er wurde zugeklappt).
function shownKids(n) {
  if (filterActive()) return n.fcol ? [] : n.kids.filter((k) => k.fkeep);
  return n.expanded ? n.kids : [];
}
const isOpen = (n) => n.kids.length > 0 && shownKids(n).length > 0;
const baseScale = (n) => nodeSize(n) * (filterActive() && !n.fmatch ? 0.6 : 1);

/* ---------- Volumeneffizientes Layout ----------
   Jeder Ast bekommt seine Pyramide (Sektor). Auf Ebene d mit Achsenposition a liegt ein Quadrat der Seite a
   im Sektor. Die n_d Knoten der Ebene besetzen darin die Zellen eines k*k-Gitters (k = ceil(sqrt(n_d)))
   in Reihenfolge einer Hilbert-Kurve: Geschwister und Kinder bleiben räumlich zusammen, das Quadrat wird
   gleichmäßig gefüllt. Die Ebenenposition ist die kleinste, bei der jede Zelle mindestens den Knotenabstand
   hat, also das kleinste Volumen. Danach rasten alle Ebenen am automatisch gewählten Raster ein. */
const LAYOUT = 2;
const C0 = 2.4 * S;   // Mindestabstand der Knotenmitten bei Ebenen-Stufe 2

function niceStep(x) {
  const e = Math.pow(10, Math.floor(Math.log10(x)));
  return [1, 2, 3, 5, 10].map((c) => c * e).reduce((b, c) => (Math.abs(c - x) < Math.abs(b - x) ? c : b));
}

const hilbertCache = new Map();
function hilbertCells(k) {
  if (hilbertCache.has(k)) return hilbertCache.get(k);
  let m = 1;
  while (m < k) m *= 2;
  const cells = [];
  for (let d = 0; d < m * m; d++) {
    let x = 0, y = 0, t = d;
    for (let sz = 1; sz < m; sz *= 2) {
      const rx = 1 & (t >> 1), ry = 1 & (t ^ rx);
      if (ry === 0) {
        if (rx === 1) { x = sz - 1 - x; y = sz - 1 - y; }
        [x, y] = [y, x];
      }
      x += sz * rx; y += sz * ry; t >>= 2;
    }
    if (x < k && y < k) cells.push([x, y]);
  }
  hilbertCache.set(k, cells);
  return cells;
}

function planAxis(axis) {
  const plan = { axis, lists: [], raw: [] };
  if (!state.filter.axes[axis.key] || !axis.root.fkeep) return plan;
  const walk = (n, sx, sy, sz) => {
    n.cs.set(sx + n.off.x, sy + n.off.y, sz + n.off.z);
    (plan.lists[n.depth] ||= []).push(n);
    for (const k of shownKids(n)) walk(k, n.cs.x, n.cs.y, n.cs.z);
  };
  walk(axis.root, 0, 0, 0);
  const sp = state.spacing;
  plan.raw[0] = T0;
  for (let d = 1; d < plan.lists.length; d++) {
    const need = Math.ceil(Math.sqrt(plan.lists[d].length)) * C0 * sp;
    plan.raw[d] = Math.max(plan.raw[d - 1] + GAP * sp, need);
  }
  return plan;
}

function clampToRegion(axis, w, r) {
  const a = Math.max(w.getComponent(axis.dim), r);
  const m = Math.min(r, a / 2);
  w.setComponent(axis.dim, a);
  for (const d of axis.perp) w.setComponent(d, Math.min(Math.max(w.getComponent(d), m), a - m));
}

function layoutAll() {
  const plans = state.axes.map(planAxis);
  const rawTop = Math.max(L, ...plans.map((p) => p.raw.at(-1) ?? 0));
  const G = niceStep(rawTop / 10);
  let top = 0;
  for (const p of plans) {
    const lp = [];
    p.raw.forEach((r, d) => {
      let v = Math.ceil(r / G) * G;
      if (d > 0 && v <= lp[d - 1]) v = lp[d - 1] + G;
      lp[d] = v;
    });
    p.axis.levelPos = lp;
    top = Math.max(top, lp.at(-1) ?? 0);
  }
  const Leff = Math.max(Math.ceil(L / G) * G, Math.ceil((top + G * 0.6) / G) * G);
  setBox(Leff, G);
  state.boxL = Leff;
  state.gridG = G;

  for (const p of plans) {
    const axis = p.axis, [pd, qd] = axis.perp, visible = [];
    p.lists.forEach((list, d) => {
      const a = axis.levelPos[d];
      const k = Math.max(1, Math.ceil(Math.sqrt(list.length)));
      const cell = a / k, cells = hilbertCells(k);
      list.forEach((n, i) => {
        const c = [0, 0, 0];
        c[axis.dim] = a;
        c[pd] = (cells[i][0] + 0.5) * cell;
        c[qd] = (cells[i][1] + 0.5) * cell;
        n.world.set(c[0] + n.cs.x, c[1] + n.cs.y, c[2] + n.cs.z);
        clampToRegion(axis, n.world, nodeSize(n));
        n.stamp = state.stamp;
        visible.push(n);
      });
    });
    axis.visible = visible;
    axis.top = axis.levelPos.at(-1) ?? 0;
  }
}

function updateTicks(axis) {
  const lp = axis.levelPos, G = state.gridG || GAP;
  (axis.ticks || []).forEach((t, d) => {
    t.position.setComponent(axis.dim, lp[d] ?? (lp.length ? lp.at(-1) + (d - lp.length + 1) * G : (d + 1) * G));
  });
}

function volumeK(axis) { return (axis.top ** 3) / 3 / 1000; }   // Pyramide in Tausend Einheiten³
function updateStat() {
  const parts = state.axes.map((a) => `${a.key.toUpperCase()} ${volumeK(a).toFixed(0)} k`);
  const tot = state.axes.reduce((t, a) => t + a.visible.length, 0);
  const vol = state.axes.reduce((t, a) => t + volumeK(a), 0);
  $('stat').textContent = `Volumen ${parts.join(' · ')} · ${tot} Knoten · ${(tot / Math.max(vol, 1)).toFixed(1)} Knoten/k · Raster ${state.gridG} · Box ${state.boxL}`;
}

function relayout() {
  state.stamp++;
  const pick = [];
  let total = 0;
  layoutAll();
  for (const axis of state.axes) {
    updateTicks(axis);
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
        axis.group.add(n.mesh);
      }
      n.mesh.scale.setScalar(baseScale(n) * (n === pointer.hover ? 1.35 : 1));
      n.mesh.visible = true;
      syncDevShell(n);
      n.mesh.position.copy(n.world);
      pick.push(n.mesh);
      if (n.parent) {
        seg[o++] = n.parent.world.x; seg[o++] = n.parent.world.y; seg[o++] = n.parent.world.z;
        seg[o++] = n.world.x; seg[o++] = n.world.y; seg[o++] = n.world.z;
      }
      updateLabel(n);
    }
    axis.lines.geometry.setAttribute('position', new THREE.BufferAttribute(seg, 3));
  }
  pointer.pickables = pick;
  updateStat();
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
  if (n.kids.length && !isOpen(n)) t = `▸ ${t} (${n.kids.length})`;
  return t;
}
function wantsLabel(n) {
  return n.depth <= state.labelDepth || n === state.selected || n === state.hit || n === pointer.hover
    || (n.fmatch && state.fmatchCount <= 60) || (state.lens.on && state.lens.set.has(n));
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
  state.dev = {};
  state.editor = { nodes: {}, view: { x: 60, y: 60, k: 1 } };
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
    for (const [id, v] of Object.entries(saved.layout === LAYOUT ? saved.offs || {} : {})) {
      const n = state.axes.map((a) => a.byId.get(id)).find(Boolean);
      if (n) n.off.fromArray(v);
    }
    state.captured = new Set(saved.captured || []);
    Object.assign(state.obsidian, saved.obsidian || {});
    obSync();
    state.dev = { ...(saved.dev || {}) };
    if (!saved.dev) seedDevFromMap();
    for (const id of Object.keys(state.dev)) if (!nodeById(id)) delete state.dev[id];
    if (saved.editor) {
      state.editor.view = { x: 60, y: 60, k: 1, ...(saved.editor.view || {}) };
      for (const [id, p] of Object.entries(saved.editor.nodes || {})) if (nodeById(id)) state.editor.nodes[id] = p;
    }
    setLock(saved.lock || 'free');
    setSlider('depth', saved.depth ?? 2);
    setSlider('labelDepth', saved.labelDepth ?? 1);
    setStufe(saved.stufe || 2, true);
    state.filter.q = saved.filter?.q || '';
    state.filter.st = new Set(saved.filter?.st || []);
    state.filter.dev = new Set(saved.filter?.dev || []);
    state.filter.linked = !!saved.filter?.linked;
    state.filter.axes = { x: true, y: true, z: true, ...(saved.filter?.axes || {}) };
    fltSync();
    state.home = saved.scale === S ? saved.home || null : null;
    if (state.home) {
      camera.position.fromArray(state.home.p);
      controls.target.fromArray(state.home.t);
    }
    const f = S / (saved.scale || 1);
    for (const l of saved.links || []) {
      if (nodeById(l.a) && nodeById(l.b)) state.links.push({ id: ++linkSeq, a: l.a, b: l.b, label: l.label || '' });
    }
    if (f !== 1 && saved.layout === LAYOUT) for (const a of state.axes) for (const n of a.all) n.off.multiplyScalar(f);
    sectorPref.on = saved.sectors !== false;
    boxGroup.getObjectByName('sectors').visible = sectorPref.on;
    $('sectorToggle').setAttribute('aria-pressed', String(sectorPref.on));
  } else {
    expandToDepth(state.depth);
    seedDevFromMap();
  }
  fitSliderMax();
  computeFilter();
  relayout();
  lexRebuild();
  renderLinkPanel();
  fltBuild();
}

function attachTree(parent, tree) {
  const k = build(tree, parent, parent.kids.length, parent.axis);
  parent.kids.push(k);
  parent.expanded = true;
  return k;
}

function expandToDepth(d) {
  for (const a of state.axes) for (const n of a.all) { n.expanded = n.kids.length > 0 && n.depth < d; n.fcol = !n.expanded; disposeLabel(n); }
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
    if (prev) { prev.mesh.scale.setScalar(baseScale(prev)); disposeLabelIfUnwanted(prev); }
    if (n) { n.mesh.scale.setScalar(baseScale(n) * 1.35); updateLabel(n); }
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
  if (n.d.ob?.file) {
    const a = add('a', 'In Obsidian öffnen ↗');
    a.href = `obsidian://open?vault=${encodeURIComponent(state.obsidian.vault)}&file=${encodeURIComponent(n.d.ob.file.replace(/\.md$/i, ''))}`;
    if (n.d.ob.tags?.length) add('div', n.d.ob.tags.map((t) => '#' + t).join(' '), 'path');
  }
  add('div', 'Dev-Lifecycle', 'k');
  const dv = document.createElement('div');
  dv.className = 'devrow';
  const cur = devIndex(state.dev[n.id] || '');
  DEV.forEach((st, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = st.label;
    b.style.setProperty('--c', st.color);
    b.setAttribute('aria-pressed', String(i === cur));
    if (i < cur) b.classList.add('past');
    b.addEventListener('click', () => setDev(n, st.key));
    dv.append(b);
  });
  if (cur >= 0) {
    const x = document.createElement('button');
    x.type = 'button';
    x.textContent = 'Entfernen';
    x.addEventListener('click', () => setDev(n, ''));
    dv.append(x);
  }
  el.append(dv);
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
  lensMove(ev);
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
  if (filterActive()) n.fcol = isOpen(n); else n.expanded = !n.expanded;
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
  computeFilter();
  relayout();
  lexRebuild();
  fltBuild();
  select(parent);
  focusOn(k.world, 120);
  markDirty();
  toast(`„${tree.n}“ an ${parent.d.n} angehängt`);
}




$('sectorToggle').addEventListener('click', () => {
  sectorPref.on = !sectorPref.on;
  boxGroup.getObjectByName('sectors').visible = sectorPref.on;
  $('sectorToggle').setAttribute('aria-pressed', String(sectorPref.on));
  markDirty();
});


/* ---------- Objektiv: Linse am Zeiger + Voreinstellungen ---------- */
const lensRing = $('lensRing');
let lensTick = 0;
function lensMove(ev) {
  if (!state.lens.on) return;
  const r = canvas.getBoundingClientRect();
  state.lens.x = ev.clientX - r.left;
  state.lens.y = ev.clientY - r.top;
  lensRing.style.left = state.lens.x + 'px';
  lensRing.style.top = state.lens.y + 'px';
}
function lensSize() {
  lensRing.style.width = lensRing.style.height = state.lens.r * 2 + 'px';
}
function setLens(on) {
  state.lens.on = on;
  lensRing.style.display = on ? 'block' : 'none';
  $('lensToggle').setAttribute('aria-pressed', String(on));
  $('lensR').hidden = !on;
  if (on) {
    const r = canvas.getBoundingClientRect();
    state.lens.x = r.width / 2; state.lens.y = r.height / 2;
    lensRing.style.left = state.lens.x + 'px'; lensRing.style.top = state.lens.y + 'px';
    lensSize();
    lensUpdate();
  } else {
    const old = [...state.lens.set];
    state.lens.set = new Set();
    for (const n of old) { disposeLabel(n); updateLabel(n); }
  }
}
// Nur Knoten im Kreis (die 40 nächsten am Mittelpunkt) bekommen ihr Label.
const lensV = new THREE.Vector3();
function lensUpdate() {
  const r = canvas.getBoundingClientRect(), L = state.lens, cand = [];
  for (const a of state.axes) for (const n of a.visible) {
    lensV.copy(n.world).project(camera);
    if (lensV.z > 1) continue;
    const d = Math.hypot(((lensV.x + 1) / 2) * r.width - L.x, ((1 - lensV.y) / 2) * r.height - L.y);
    if (d <= L.r) cand.push([d, n]);
  }
  cand.sort((a, b) => a[0] - b[0]);
  const next = new Set(cand.slice(0, 40).map((c) => c[1]));
  const changed = [...next].filter((n) => !L.set.has(n)).concat([...L.set].filter((n) => !next.has(n)));
  L.set = next;
  for (const n of changed) { disposeLabel(n); updateLabel(n); }
}
$('lensToggle').addEventListener('click', () => setLens(!state.lens.on));
$('lensR').addEventListener('input', (e) => { state.lens.r = +e.target.value; lensSize(); });

const PRESETS = {
  alle: () => {},
  risiko: (f) => f.st.add('risiko'),
  wartebereich: (f) => f.dev.add('wait'),
  abgeschlossen: (f) => f.dev.add('done'),
  verknuepft: (f) => { f.linked = true; },
};
document.querySelectorAll('#lensPresets button').forEach((b) => b.addEventListener('click', () => {
  const f = state.filter;
  f.q = ''; f.st.clear(); f.dev.clear(); f.linked = false;
  PRESETS[b.dataset.preset](f);
  document.querySelectorAll('#lensPresets button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  fltApply();
}));

/* ---------- Ebenen-Stufen 1-4 ---------- */
function setStufe(n, instant = false) {
  state.stufe = Math.min(4, Math.max(1, n));
  state.spacingTarget = STUFEN[state.stufe - 1];
  if (instant) state.spacing = state.spacingTarget;
  document.querySelectorAll('#stufe button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.stufe === state.stufe)));
  if (!instant) { markDirty(); toast(`Ebenen-Stufe ${state.stufe}`); }
}
document.querySelectorAll('#stufe button').forEach((b) => b.addEventListener('click', () => setStufe(+b.dataset.stufe)));

/* ---------- Filter-Panel ---------- */
function fltBuild() {
  const counts = {};
  let total = 0;
  for (const a of state.axes) for (const n of a.all) { counts[n.d.s || '–'] = (counts[n.d.s || '–'] || 0) + 1; total++; }
  const box = $('fltChips');
  box.replaceChildren();
  for (const st of Object.keys(counts).sort((a, b) => counts[b] - counts[a])) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.dataset.st = st;
    b.setAttribute('aria-pressed', String(state.filter.st.has(st)));
    b.style.setProperty('--c', STATUS[st] || STATUS.info);
    const dot = document.createElement('i');
    b.append(dot, `${STATUS_TEXT[st] || st} ${counts[st]}`);
    b.addEventListener('click', () => {
      state.filter.st.has(st) ? state.filter.st.delete(st) : state.filter.st.add(st);
      fltApply();
    });
    box.append(b);
  }
  const dbox = $('fltDev');
  dbox.replaceChildren();
  const dc = { none: 0, wait: 0, test: 0, commit: 0, done: 0 };
  for (const a of state.axes) for (const n of a.all) dc[state.dev[n.id] || 'none']++;
  for (const [key, label, color] of [...DEV.map((d) => [d.key, d.label, d.color]), ['none', 'ohne Status', '#8C948F']]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.dataset.dev = key;
    b.setAttribute('aria-pressed', String(state.filter.dev.has(key)));
    b.style.setProperty('--c', color);
    const dot = document.createElement('i');
    b.append(dot, `${label} ${dc[key]}`);
    b.addEventListener('click', () => {
      state.filter.dev.has(key) ? state.filter.dev.delete(key) : state.filter.dev.add(key);
      fltApply();
    });
    dbox.append(b);
  }
  $('fltInfo').dataset.total = total;
  fltSync();
}
function fltSync() {
  $('fltQ').value = state.filter.q;
  document.querySelectorAll('#fltChips .chip').forEach((b) => b.setAttribute('aria-pressed', String(state.filter.st.has(b.dataset.st))));
  document.querySelectorAll('#fltDev .chip').forEach((b) => b.setAttribute('aria-pressed', String(state.filter.dev.has(b.dataset.dev))));
  document.querySelectorAll('#fltAxes button').forEach((b) => b.setAttribute('aria-pressed', String(state.filter.axes[b.dataset.axis])));
}
function fltApply() {
  for (const a of state.axes) for (const n of a.all) n.fcol = false;
  computeFilter();
  relayout();
  fltSync();
  fltInfoUpdate();
  markDirty();
}
function fltInfoUpdate() {
  const vis = state.axes.reduce((t, a) => t + a.visible.length, 0);
  $('fltInfo').textContent = filterActive()
    ? `${state.fmatchCount} Treffer · ${vis} von ${$('fltInfo').dataset.total} Knoten sichtbar`
    : `${vis} von ${$('fltInfo').dataset.total} Knoten sichtbar`;
}
$('fltQ').addEventListener('input', (e) => { state.filter.q = e.target.value; fltApply(); });
document.querySelectorAll('#fltAxes button').forEach((b) => b.addEventListener('click', () => {
  state.filter.axes[b.dataset.axis] = !state.filter.axes[b.dataset.axis];
  fltApply();
}));
$('fltReset').addEventListener('click', () => {
  state.filter.q = '';
  state.filter.st.clear();
  state.filter.dev.clear();
  state.filter.linked = false;
  state.filter.axes = { x: true, y: true, z: true };
  fltApply();
});
function toggleLeft(id, onOpen) {
  const el = $(id), open = el.hidden;
  for (const x of ['lex', 'ms', 'flt', 'ob']) $(x).hidden = true;
  el.hidden = !open;
  if (open && onOpen) onOpen();
}
$('fltToggle').addEventListener('click', () => toggleLeft('flt', fltInfoUpdate));
$('fltClose').addEventListener('click', () => { $('flt').hidden = true; });

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


/* ---------- Node-Editor (2D, wie n8n) ----------
   Karten für Knoten der Mindmap, Drähte = dieselben Verknüpfungen wie im 3D-Raum (state.links). */
const ED = { W: 210, H: 58, selLink: null, selNode: null, wire: null, drag: null, pan: null };
const edView = $('edView'), edWorld = $('edWorld'), edWires = $('edWires');
const SVGNS = 'http://www.w3.org/2000/svg';

function edApplyView() {
  const v = state.editor.view;
  edWorld.style.transform = `translate(${v.x}px,${v.y}px) scale(${v.k})`;
  edView.style.backgroundPosition = `${v.x}px ${v.y}px`;
  edView.style.backgroundSize = `${24 * v.k}px ${24 * v.k}px`;
}
function edToWorld(ev) {
  const r = edView.getBoundingClientRect(), v = state.editor.view;
  return { x: (ev.clientX - r.left - v.x) / v.k, y: (ev.clientY - r.top - v.y) / v.k };
}
function edCenter() {
  const r = edView.getBoundingClientRect(), v = state.editor.view;
  return { x: (r.width / 2 - v.x) / v.k - ED.W / 2, y: (r.height / 2 - v.y) / v.k - ED.H / 2 };
}
function edAdd(n, at) {
  if (state.editor.nodes[n.id]) return false;
  const c = at || edCenter(), i = Object.keys(state.editor.nodes).length % 6;
  state.editor.nodes[n.id] = [Math.round(c.x + i * 22), Math.round(c.y + i * 22)];
  return true;
}
function edPath(x1, y1, x2, y2) {
  const dx = Math.max(60, Math.abs(x2 - x1) * 0.5);
  return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
}
const svgEl = (tag, attrs) => {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};

function edDrawWires() {
  edWires.replaceChildren();
  const pos = state.editor.nodes;
  for (const l of state.links) {
    const pa = pos[l.a], pb = pos[l.b];
    if (!pa || !pb) continue;
    const d = edPath(pa[0] + ED.W, pa[1] + ED.H / 2, pb[0], pb[1] + ED.H / 2);
    const g = svgEl('g', { class: 'wire' + (ED.selLink === l.id ? ' sel' : ''), 'data-link': l.id });
    g.append(svgEl('path', { d, class: 'hit' }), svgEl('path', { d, class: 'line', 'marker-end': 'url(#edArrow)' }));
    if (l.label) {
      const t = svgEl('text', { x: (pa[0] + ED.W + pb[0]) / 2, y: (pa[1] + pb[1]) / 2 + ED.H / 2 - 8, class: 'lbl' });
      t.textContent = l.label;
      g.append(t);
    }
    edWires.append(g);
  }
}

function edRender() {
  edWorld.querySelectorAll('.edn').forEach((e) => e.remove());
  for (const [id, p] of Object.entries(state.editor.nodes)) {
    const n = nodeById(id);
    if (!n) continue;
    const el = document.createElement('div');
    el.className = 'edn' + (ED.selNode === id ? ' sel' : '');
    el.dataset.id = id;
    el.style.left = p[0] + 'px';
    el.style.top = p[1] + 'px';
    el.style.setProperty('--c', STATUS[n.d.s] || STATUS.info);
    const title = document.createElement('div');
    title.className = 't';
    title.textContent = n.d.n;
    const meta = document.createElement('div');
    meta.className = 'm';
    const dv = state.dev[id];
    if (dv) {
      const dot = document.createElement('i');
      dot.style.background = DEV[devIndex(dv)].color;
      dot.title = DEV[devIndex(dv)].label;
      meta.append(dot);
    }
    meta.append(`${STATUS_TEXT[n.d.s] || n.d.s || '–'} · ${n.axis.key.toUpperCase()} · E${n.depth}`);
    const pin = document.createElement('span'); pin.className = 'port in';
    const pout = document.createElement('span'); pout.className = 'port out';
    const x = document.createElement('button');
    x.type = 'button'; x.className = 'edx'; x.textContent = '×'; x.title = 'Aus dem Editor entfernen';
    x.addEventListener('click', () => { delete state.editor.nodes[id]; edRender(); markDirty(); });
    el.append(pin, pout, title, meta, x);
    edWorld.append(el);
  }
  edDrawWires();
  edInfo();
}
function edInfo() {
  const ids = Object.keys(state.editor.nodes);
  const n = state.links.filter((l) => state.editor.nodes[l.a] && state.editor.nodes[l.b]).length;
  $('edInfo').textContent = `${ids.length} Karten · ${n} Verbindungen`;
}

function edLayout() {
  const ids = Object.keys(state.editor.nodes).filter((id) => nodeById(id));
  const layer = Object.fromEntries(ids.map((id) => [id, 0]));
  const ls = state.links.filter((l) => layer[l.a] !== undefined && layer[l.b] !== undefined);
  for (let it = 0; it < ids.length; it++) {
    let changed = false;
    for (const l of ls) if (layer[l.b] < layer[l.a] + 1 && layer[l.a] + 1 <= ids.length) { layer[l.b] = layer[l.a] + 1; changed = true; }
    if (!changed) break;
  }
  const linked = new Set(ls.flatMap((l) => [l.a, l.b]));
  const cols = {};
  for (const id of ids.sort((a, b) => (linked.has(b) - linked.has(a)) || nodeById(a).d.n.localeCompare(nodeById(b).d.n, 'de'))) (cols[layer[id]] ||= []).push(id);
  for (const [c, list] of Object.entries(cols)) list.forEach((id, i) => { state.editor.nodes[id] = [c * (ED.W + 110), i * (ED.H + 26)]; });
  edRender();
  edFit();
  markDirty();
}
function edFit() {
  const ps = Object.values(state.editor.nodes);
  const r = edView.getBoundingClientRect(), v = state.editor.view;
  if (!ps.length) { v.x = 60; v.y = 60; v.k = 1; return edApplyView(); }
  const x0 = Math.min(...ps.map((p) => p[0])), x1 = Math.max(...ps.map((p) => p[0])) + ED.W;
  const y0 = Math.min(...ps.map((p) => p[1])), y1 = Math.max(...ps.map((p) => p[1])) + ED.H;
  v.k = Math.min(1.2, Math.max(0.3, Math.min((r.width - 80) / (x1 - x0), (r.height - 80) / (y1 - y0))));
  v.x = (r.width - (x1 - x0) * v.k) / 2 - x0 * v.k;
  v.y = (r.height - (y1 - y0) * v.k) / 2 - y0 * v.k;
  edApplyView();
}

function edOpen() {
  $('ed').hidden = false;
  const before = Object.keys(state.editor.nodes).length;
  for (const l of state.links) for (const id of [l.a, l.b]) { const n = nodeById(id); if (n) edAdd(n, { x: 0, y: 0 }); }
  edRender();
  if (!before && Object.keys(state.editor.nodes).length) edLayout(); else edApplyView();
}
function edClose() { $('ed').hidden = true; ED.wire = ED.drag = ED.pan = null; }
$('edToggle').addEventListener('click', () => ($('ed').hidden ? edOpen() : edClose()));
$('edClose').addEventListener('click', edClose);
$('edFit').addEventListener('click', edFit);
$('edLayout').addEventListener('click', edLayout);
$('edAddSel').addEventListener('click', () => {
  const n = state.selected;
  if (!n) return toast('Erst in der 3D-Ansicht einen Knoten wählen');
  edAdd(n); edRender(); markDirty();
});
$('edAddKids').addEventListener('click', () => {
  const n = state.selected;
  if (!n) return toast('Erst in der 3D-Ansicht einen Knoten wählen');
  edAdd(n);
  const p = state.editor.nodes[n.id];
  n.kids.slice(0, 40).forEach((k, i) => edAdd(k, { x: p[0] + ED.W + 90, y: p[1] + i * (ED.H + 14) }));
  edRender(); edFit(); markDirty();
});
$('edQ').addEventListener('input', () => {
  const q = $('edQ').value.trim().toLowerCase(), box = $('edResults');
  box.replaceChildren();
  if (!q) { box.hidden = true; return; }
  const all = state.axes.flatMap((a) => a.all).filter((n) => !state.editor.nodes[n.id]
    && (n.d.n.toLowerCase().includes(q) || (n.d.p || '').toLowerCase().includes(q))).slice(0, 30);
  box.hidden = false;
  if (!all.length) { box.textContent = 'Kein Treffer'; return; }
  for (const n of all) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = `${n.d.n}  ·  ${n.axis.key.toUpperCase()} E${n.depth}`;
    b.addEventListener('click', () => { edAdd(n); edRender(); markDirty(); b.remove(); });
    box.append(b);
  }
});

function edLink(a, b) {
  const na = nodeById(a), nb = nodeById(b);
  if (na && nb) addLink(na, nb);
  edDrawWires(); edInfo();
}
edView.addEventListener('pointerdown', (ev) => {
  if (ev.button !== 0) return;
  const port = ev.target.closest('.port'), card = ev.target.closest('.edn'), wire = ev.target.closest('.wire');
  if (ev.target.closest('.edx')) return;
  const key = wire ? 'w' + wire.dataset.link : card && !port ? 'c' + card.dataset.id : '';
  const now = performance.now();
  if (key && ED.last && ED.last.key === key && now - ED.last.t < 400) { ED.last = null; return edDouble(wire, card); }
  ED.last = key ? { key, t: now } : null;
  edView.setPointerCapture(ev.pointerId);
  if (port && card) {
    ED.wire = { id: card.dataset.id, out: port.classList.contains('out') };
    return;
  }
  if (card) {
    const id = card.dataset.id;
    ED.selNode = id; ED.selLink = null;
    edWorld.querySelectorAll('.edn').forEach((e) => e.classList.toggle('sel', e.dataset.id === id));
    ED.drag = { id, start: edToWorld(ev), orig: [...state.editor.nodes[id]], moved: false };
    edDrawWires();
    return;
  }
  if (wire) { ED.selLink = +wire.dataset.link; ED.selNode = null; edDrawWires(); return; }
  ED.selLink = ED.selNode = null;
  edWorld.querySelectorAll('.edn.sel').forEach((e) => e.classList.remove('sel'));
  edDrawWires();
  const v = state.editor.view;
  ED.pan = { x: ev.clientX, y: ev.clientY, vx: v.x, vy: v.y };
});
edView.addEventListener('pointermove', (ev) => {
  if (ED.drag) {
    const w = edToWorld(ev), d = ED.drag;
    const p = [Math.round(d.orig[0] + w.x - d.start.x), Math.round(d.orig[1] + w.y - d.start.y)];
    state.editor.nodes[d.id] = p;
    d.moved = true;
    const el = edWorld.querySelector(`.edn[data-id="${CSS.escape(d.id)}"]`);
    if (el) { el.style.left = p[0] + 'px'; el.style.top = p[1] + 'px'; }
    edDrawWires();
  } else if (ED.wire) {
    const w = edToWorld(ev), p = state.editor.nodes[ED.wire.id];
    const [x1, y1] = ED.wire.out ? [p[0] + ED.W, p[1] + ED.H / 2] : [p[0], p[1] + ED.H / 2];
    edDrawWires();
    const d = ED.wire.out ? edPath(x1, y1, w.x, w.y) : edPath(w.x, w.y, x1, y1);
    edWires.append(svgEl('path', { d, class: 'line rubber' }));
  } else if (ED.pan) {
    const v = state.editor.view;
    v.x = ED.pan.vx + ev.clientX - ED.pan.x;
    v.y = ED.pan.vy + ev.clientY - ED.pan.y;
    edApplyView();
  }
});
edView.addEventListener('pointerup', (ev) => {
  if (edView.hasPointerCapture(ev.pointerId)) edView.releasePointerCapture(ev.pointerId);
  if (ED.wire) {
    const t = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.edn');
    if (t && t.dataset.id !== ED.wire.id) ED.wire.out ? edLink(ED.wire.id, t.dataset.id) : edLink(t.dataset.id, ED.wire.id);
    else edDrawWires();
  }
  if (ED.drag?.moved || ED.pan) markDirty();
  ED.wire = ED.drag = ED.pan = null;
});
edView.addEventListener('wheel', (ev) => {
  ev.preventDefault();
  const v = state.editor.view, r = edView.getBoundingClientRect();
  const k = Math.min(2.5, Math.max(0.25, v.k * Math.exp(-ev.deltaY * 0.0015)));
  const px = ev.clientX - r.left, py = ev.clientY - r.top;
  v.x = px - ((px - v.x) * k) / v.k;
  v.y = py - ((py - v.y) * k) / v.k;
  v.k = k;
  edApplyView();
}, { passive: false });
// Doppelklick selbst erkennen: Das Neuzeichnen beim ersten Klick ersetzt die Zielelemente,
// dann feuert der Browser kein dblclick mehr.
function edDouble(wire, card) {
  if (wire) {
    const l = state.links.find((x) => x.id === +wire.dataset.link);
    const t = l && prompt('Beschriftung der Verbindung', l.label);
    if (t !== null && t !== undefined && l) { l.label = t.trim().slice(0, 40); renderLinks(); renderLinkPanel(); edDrawWires(); markDirty(); }
    return;
  }
  const n = nodeById(card.dataset.id);
  if (!n) return;
  edClose();
  for (let p = n.parent; p; p = p.parent) { p.expanded = true; p.fcol = false; }
  relayout();
  select(n);
  focusOn(n.world);
}
function edDeleteLink() {
  if (ED.selLink === null) return;
  state.links = state.links.filter((l) => l.id !== ED.selLink);
  ED.selLink = null;
  renderLinks(); renderLinkPanel(); edDrawWires(); edInfo(); markDirty();
}


/* ---------- Obsidian: Vault einlesen, Wikilinks übernehmen, Notizen exportieren ---------- */
const OB_SKIP = new Set(['.obsidian', '.git', '.trash', 'node_modules']);
const OB_MAX_NOTES = 3000, OB_MAX_LINKS = 400, OB_MAX_EXPORT = 800;

function obSync() {
  $('obVault').value = state.obsidian.vault;
  $('obFolder').value = state.obsidian.folder;
  $('obLinks').checked = state.obsidian.links;
}
$('obVault').addEventListener('input', (e) => { state.obsidian.vault = e.target.value.trim(); markDirty(); });
$('obFolder').addEventListener('input', (e) => { state.obsidian.folder = e.target.value.trim() || 'SystemOS-Mindmap'; markDirty(); });
$('obLinks').addEventListener('change', (e) => { state.obsidian.links = e.target.checked; markDirty(); });
$('obToggle').addEventListener('click', () => toggleLeft('ob', obSync));
$('obClose').addEventListener('click', () => { $('ob').hidden = true; });

function obParse(text) {
  let body = text, fmTags = [];
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (m) {
    body = text.slice(m[0].length);
    const t = /^tags:\s*(.*)$/mi.exec(m[1]);
    if (t) fmTags = t[1].replace(/[[\]]/g, '').split(/[,\s]+/).map((x) => x.replace(/^#/, '').trim()).filter(Boolean);
  }
  const links = [...new Set([...body.matchAll(/\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\]/g)].map((x) => x[1].trim()))];
  const tags = [...new Set([...fmTags, ...[...body.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu)].map((x) => x[1])])].slice(0, 8);
  const lines = body.split(/\r?\n/).map((l) => l.trim());
  const excerpt = (lines.filter((l) => l && !l.startsWith('#')).join(' ') || lines.find((l) => l) || '')
    .replace(/[*_`>[\]]/g, '').slice(0, 240);
  return { links, tags, excerpt };
}

async function obWalkHandle(dir, rel, out) {
  for await (const [name, h] of dir.entries()) {
    if (out.length >= OB_MAX_NOTES) return;
    if (OB_SKIP.has(name)) continue;
    const p = rel ? `${rel}/${name}` : name;
    if (h.kind === 'directory') await obWalkHandle(h, p, out);
    else if (/\.md$/i.test(name)) out.push({ rel: p, get: () => h.getFile() });
  }
}

async function obImport(rootName, entries) {
  const parent = state.selected || state.axes[0].root;
  const root = { n: rootName, s: 'ordner', p: rootName, c: [] };
  const dirs = new Map([['', root]]);
  const ensure = (path) => {
    if (dirs.has(path)) return dirs.get(path);
    const i = path.lastIndexOf('/');
    const par = ensure(i < 0 ? '' : path.slice(0, i));
    const node = { n: path.slice(i + 1), s: 'ordner', p: `${rootName}/${path}`, c: [] };
    par.c.push(node);
    dirs.set(path, node);
    return node;
  };
  entries.sort((a, b) => a.rel.localeCompare(b.rel, 'de', { numeric: true }));
  let count = 0;
  for (const e of entries.slice(0, OB_MAX_NOTES)) {
    const file = await e.get();
    const info = obParse((await file.text()).slice(0, 100000));
    const i = e.rel.lastIndexOf('/');
    const dir = ensure(i < 0 ? '' : e.rel.slice(0, i));
    dir.c.push({
      n: e.rel.slice(i + 1).replace(/\.md$/i, ''), s: 'datei', p: `${rootName}/${e.rel}`,
      m: `${(file.size / 1024).toFixed(1)} KB${info.tags.length ? ' · ' + info.tags.map((t) => '#' + t).join(' ') : ''}`,
      d: info.excerpt, ob: { file: e.rel, tags: info.tags, links: info.links },
    });
    count++;
  }
  const fill = (n) => {
    if (!n.c) return 1;
    const notes = n.c.reduce((t, c) => t + fill(c), 0);
    n.c.sort((a, b) => (a.c ? 0 : 1) - (b.c ? 0 : 1));
    n.m = `${notes} Notizen`;
    return notes;
  };
  fill(root);

  attachAndShow(parent, root);
  const top = parent.kids.at(-1);
  const byName = new Map(), notes = [];
  (function walk(n) { if (n.d.ob) { notes.push(n); const k = n.d.n.toLowerCase(); if (!byName.has(k)) byName.set(k, n); } n.kids.forEach(walk); })(top);
  let made = 0, skipped = 0;
  if (state.obsidian.links) {
    for (const n of notes) {
      for (const target of n.d.ob.links) {
        const t = byName.get(target.split('/').pop().toLowerCase());
        if (!t || t === n) continue;
        if (state.links.some((l) => l.a === n.id && l.b === t.id)) continue;
        if (made >= OB_MAX_LINKS) { skipped++; continue; }
        state.links.push({ id: ++linkSeq, a: n.id, b: t.id, label: '' });
        made++;
      }
    }
  }
  for (const n of notes) delete n.d.ob.links;   // nur zum Verknüpfen nötig, spart Speicher
  renderLinks(); renderLinkPanel(); markDirty();
  toast(`Obsidian: ${count} Notizen, ${made} Wikilinks als Verknüpfungen${skipped ? ` (${skipped} weitere über dem Limit von ${OB_MAX_LINKS})` : ''}`);
}

$('obImport').addEventListener('click', async () => {
  try {
    if (window.showDirectoryPicker) {
      const dir = await window.showDirectoryPicker({ mode: 'read' });
      const out = [];
      await obWalkHandle(dir, '', out);
      await obImport(dir.name, out);
    } else {
      $('obDir').value = '';
      $('obDir').click();
    }
  } catch (e) { if (e?.name !== 'AbortError') toast('Vault nicht lesbar: ' + e.message); }
});
$('obDir').addEventListener('change', async () => {
  const files = [...$('obDir').files];
  if (!files.length) return;
  const rootName = files[0].webkitRelativePath.split('/')[0] || 'Vault';
  const out = files.map((f) => ({ rel: f.webkitRelativePath.split('/').slice(1).join('/'), get: async () => f }))
    .filter((e) => /\.md$/i.test(e.rel) && !e.rel.split('/').some((p) => OB_SKIP.has(p)));
  try { await obImport(rootName, out); } catch (e) { toast('Vault nicht lesbar: ' + e.message); }
});

/* Export: eine Notiz je Knoten (Auswahl samt Unterbaum, sonst der bearbeitete Stand), Verknüpfungen als [[Links]] */
const obName = (s) => s.replace(/[\\/:*?"<>|#^[\]]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Knoten';

function obExportSet() {
  if (state.selected) {
    const out = [];
    (function walk(n) { if (out.length < OB_MAX_EXPORT) { out.push(n); n.kids.forEach(walk); } })(state.selected);
    return { nodes: out, label: `„${state.selected.d.n}“ samt Unterbaum` };
  }
  const linked = new Set(state.links.flatMap((l) => [l.a, l.b]));
  const nodes = state.axes.flatMap((a) => a.all).filter((n) => linked.has(n.id) || state.dev[n.id] || state.captured.has(docKey(n))).slice(0, OB_MAX_EXPORT);
  return { nodes, label: 'bearbeiteter Stand (verknüpft, mit Dev-Stand oder erfasst)' };
}

function obBuildNotes(nodes) {
  const names = new Map(), used = new Set();
  for (const n of nodes) {
    let base = obName(n.d.n), name = base;
    if (used.has(name.toLowerCase())) name = `${base} (${n.axis.key.toUpperCase()} E${n.depth} ${n.id})`;
    used.add(name.toLowerCase());
    names.set(n.id, name);
  }
  const notes = [];
  for (const n of nodes) {
    const out = [], inc = [];
    for (const l of state.links) {
      if (l.a === n.id && names.has(l.b)) out.push(`- → [[${names.get(l.b)}]]${l.label ? ' · ' + l.label : ''}`);
      if (l.b === n.id && names.has(l.a)) inc.push(`- ← [[${names.get(l.a)}]]${l.label ? ' · ' + l.label : ''}`);
    }
    const kids = n.kids.filter((k) => names.has(k.id)).map((k) => `- [[${names.get(k.id)}]]`);
    const dev = state.dev[n.id];
    const tags = ['systemos', n.d.s ? `status/${n.d.s}` : null, dev ? `dev/${dev}` : null].filter(Boolean);
    const lines = [
      '---', `tags: [${tags.join(', ')}]`, `achse: ${n.axis.key.toUpperCase()}`, `ebene: ${n.depth}`,
      ...(n.d.p ? [`pfad: "${n.d.p.replace(/"/g, "'")}"`] : []), ...(dev ? [`dev: ${DEV[devIndex(dev)].label}`] : []), '---', '',
      `# ${n.d.n}`, '',
    ];
    if (n.d.m) lines.push(`_${n.d.m}_`, '');
    if (n.d.d) lines.push(n.d.d, '');
    if (n.d.z) lines.push(`**Zielaktion (${n.d.z[0]}):** ${n.d.z[1]}`, '');
    if (n.d.ak) lines.push(`> Gedankenanker: ${n.d.ak}`, '');
    if (out.length || inc.length) lines.push('## Verknüpfungen', ...out, ...inc, '');
    if (kids.length) lines.push('## Kinder', ...kids, '');
    notes.push({ file: `${names.get(n.id)}.md`, text: lines.join('\n') });
  }
  const idx = ['---', 'tags: [systemos, index]', '---', '', '# Mindmap-Index', '',
    `Export vom ${new Date().toLocaleString('de-DE')} · ${nodes.length} Notizen`, ''];
  for (const a of state.axes) {
    const mine = nodes.filter((n) => n.axis === a);
    if (mine.length) idx.push(`## Achse ${a.key.toUpperCase()}`, '', ...mine.map((n) => `- [[${names.get(n.id)}]]`), '');
  }
  notes.unshift({ file: '_Mindmap-Index.md', text: idx.join('\n') });
  return notes;
}

$('obExport').addEventListener('click', async () => {
  const { nodes, label } = obExportSet();
  if (!nodes.length) return toast('Nichts zu exportieren: erst einen Knoten wählen oder Verknüpfungen/Dev-Stände setzen');
  const notes = obBuildNotes(nodes);
  try {
    if (window.showDirectoryPicker) {
      const vault = await window.showDirectoryPicker({ mode: 'readwrite' });
      const dir = await vault.getDirectoryHandle(state.obsidian.folder, { create: true });
      for (const n of notes) {
        const w = await (await dir.getFileHandle(n.file, { create: true })).createWritable();
        await w.write(n.text);
        await w.close();
      }
      toast(`${notes.length} Notizen (${label}) nach ${vault.name}/${state.obsidian.folder} geschrieben`);
    } else {
      const text = notes.map((n) => `<!-- ${n.file} -->\n${n.text}`).join('\n\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
      a.download = `${state.obsidian.folder}.md`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast(`Dieser Browser kann keinen Ordner beschreiben. Alle ${notes.length} Notizen als eine Datei geladen.`);
    }
  } catch (e) { if (e?.name !== 'AbortError') toast('Export fehlgeschlagen: ' + e.message); }
});

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

$('lexToggle').addEventListener('click', () => toggleLeft('lex', lexRender));
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
  moved: 'Verschobene Äste', attached: 'Angehängte Scans', volume: 'Volumen (k Einh.³)',
  devWait: 'Dev Wartebereich', devTest: 'Dev Test', devCommit: 'Dev Commit', devDone: 'Dev abgeschlossen',
};

function currentMetrics() {
  let nodes = 0, moved = 0;
  for (const a of state.axes) for (const n of a.all) { nodes++; if (n.off.lengthSq() > 0) moved++; }
  const docs = lex.entries.length;
  const captured = lex.entries.filter((e) => state.captured.has(e.key)).length;
  const volume = Math.round(state.axes.reduce((t, a) => t + volumeK(a), 0));
  const dv = devCounts();
  return { nodes, docs, captured, links: state.links.length, moved, attached: state.attachLog.length, volume,
    devWait: dv.wait, devTest: dv.test, devCommit: dv.commit, devDone: dv.done };
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

$('msToggle').addEventListener('click', () => toggleLeft('ms', renderMilestones));
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
    scale: S, layout: LAYOUT, sectors: sectorPref.on, stufe: state.stufe, home: state.home,
    filter: { q: state.filter.q, st: [...state.filter.st], dev: [...state.filter.dev], linked: state.filter.linked, axes: state.filter.axes },
    dev: state.dev, editor: state.editor, obsidian: state.obsidian, links: state.links.map(({ a, b, label }) => ({ a, b, label })),
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
  if (!$('ed').hidden) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); return save(); }
    if (e.target.matches('input')) return;
    if (e.key === 'Escape') edClose();
    else if (e.key === 'Delete' || e.key === 'Backspace') edDeleteLink();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); return save(); }
  if (e.target.matches('input')) return;
  const k = e.key.toLowerCase();
  if (['1', '2', '3', '4'].includes(k)) setStufe(+k);
  else if (k === '+' || k === '=') setStufe(state.stufe + 1);
  else if (k === '-') setStufe(state.stufe - 1);
  else if (['x', 'y', 'z'].includes(k)) { setLock(state.lock === k ? 'free' : k); markDirty(); }
  else if (e.key === 'f' && state.selected) focusOn(state.selected.world);
  else if (e.key.toLowerCase() === 'l') setLinkMode(!state.linkMode);
  else if (e.key.toLowerCase() === 'o') setLens(!state.lens.on);
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
  if (state.spacingTarget !== undefined && Math.abs(state.spacingTarget - state.spacing) > 0.002) {
    state.spacing += (state.spacingTarget - state.spacing) * 0.2;
    if (Math.abs(state.spacingTarget - state.spacing) <= 0.002) state.spacing = state.spacingTarget;
    relayout();
  }
  if (fly) {
    const k = Math.min(1, (performance.now() - fly.t0) / fly.ms);
    const e = 1 - Math.pow(1 - k, 3);
    camera.position.lerpVectors(fly.p0, fly.p1, e);
    controls.target.lerpVectors(fly.t0v, fly.t1, e);
    if (k >= 1) fly = null;
  }
  controls.update();
  if (state.lens.on && ++lensTick % 6 === 0) lensUpdate();
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
    state, snapshot, relayout, select,
    project(n) {
      const r = canvas.getBoundingClientRect(), v = n.world.clone().project(camera);
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
    },
  };  // für Tests / Konsole
})();
