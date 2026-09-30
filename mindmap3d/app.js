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
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.xr.enabled = true;
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0F1512);
const world = new THREE.Group();   // alles Karten-Inhaltliche; XR skaliert/verschiebt nur diese Gruppe
scene.add(world);
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
world.add(boxGroup);
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
    world.add(t);
    ax.ticks.push(t);
  }
}

/* ---------- Knoten & Layout ---------- */
const sphereGeo = new THREE.SphereGeometry(1, 14, 10);
const matCache = {};
const matFor = (s) => matCache[s] ||= new THREE.MeshLambertMaterial({ color: STATUS[s] || STATUS.info, transparent: state.alpha < 1, opacity: state.alpha, depthWrite: state.alpha >= 1 });
const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.07, 8, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }));
ring.renderOrder = 9;
ring.visible = false;
world.add(ring);

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
  audit: [],            // Seat Governance: Weiterleitungen zur Freigabe durch den Operator
  intentOk: new Set(),  // als bekannt bestätigte Execution-Intent-Treffer (Schlüssel)
  dev: {},              // Dev-Lifecycle je Knoten-ID: wait | test | commit | done
  editor: { nodes: {}, view: { x: 60, y: 60, k: 1 } },   // Node-Editor: Karten-Positionen und Ansicht
  stufe: 2,             // Ebenen-Stufe 1-4 (Abstand und Platz)
  spacing: 1,           // aktuell animierter Abstandsfaktor
  filter: { q: '', st: new Set(), dev: new Set(), linked: false, axes: { x: true, y: true, z: true } },
  lens: { on: false, r: 170, x: 0, y: 0, set: new Set() },
  jit: { on: false, reach: 260, gen: 0, drop: 0, pinned: new Set() },   // JIT-Sicht: Knoten entstehen nach Blick
  alpha: 1,             // Durchsicht der Knoten (1 = deckend)
  declutter: true,      // Labels ohne Überdeckung
  overlap: 0,           // Anteil überdeckter Knoten im Bild
  born: [],             // gerade erzeugte Knoten (Einwachs-Animation)   // Objektiv: folgt dem Zeiger
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
  neuroOnDev(n);
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
  const ov = state.overlap > 0.05 ? ` · Überdeckung ${(state.overlap * 100).toFixed(0)} %${state.overlap > 0.35 ? ' (viel: Ebenen-Stufe erhöhen, Filter oder JIT nutzen)' : ''}` : '';
  const jit = state.jit.on ? ` · JIT an: ${state.jit.gen} erzeugt, ${state.jit.drop} verworfen` : '';
  $('stat').textContent = `Volumen ${parts.join(' · ')} · ${tot} Knoten · ${(tot / Math.max(vol, 1)).toFixed(1)} Knoten/k · Raster ${state.gridG} · Box ${state.boxL}${ov}${jit}`;
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
        n.mesh.userData.fresh = true;
        axis.group.add(n.mesh);
      }
      if (n.mesh.userData.fresh) { n.mesh.userData.fresh = false; n.born = performance.now(); state.born.push(n); }
      n.mesh.scale.setScalar(baseScale(n) * (n === pointer.hover ? 1.35 : 1) * bornFactor(n));
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

function bornFactor(n) {
  if (!n.born) return 1;
  const k = (performance.now() - n.born) / 380;
  if (k >= 1) { n.born = 0; return 1; }
  return 1 - Math.pow(1 - k, 3);
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
    || (n.fmatch && state.fmatchCount <= 60) || (state.lens.on && state.lens.set.has(n)) || (state.jit.on && n.jitNear);
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
    world.remove(a.group);
    for (const n of a.all) if (n.label) disposeSprite(n.label);
    a.lines.geometry.dispose();
  }
  state.axes = [];
  state.attachLog = [];
  state.captured = new Set();
  state.links = [];
  linkSeq = 0;
  state.dev = {};
  state.intentOk = new Set();
  state.audit = [];
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
    world.add(axis.group);
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
    state.intentOk = new Set(saved.intentOk || []);
    state.audit = [...(saved.audit || [])];
    MON.auditKeys = new Set(state.audit.filter((e) => e.key).map((e) => e.key));
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
    setAlpha(saved.alpha ?? 1, true);
    state.declutter = saved.declutter !== false;
    $('declutterToggle').setAttribute('aria-pressed', String(state.declutter));
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
  if (state.jit.on) state.jit.pinned.add(n.id);   // von Hand gesetzt: bleibt, bis du es änderst
  disposeLabel(n);
  relayout();
  markDirty();
}

/* ---------- Gamepad (aus MyIsland/VRSpace.tsx übertragen, an den freien 3D-Sandkasten angepasst) ----------
   Linker Stick: bewegen (Vor/Zurück/Seite, relativ zur Blickrichtung). Rechter Stick: umsehen (Kugelkoordinaten
   um controls.target). Knopf 0/1: hoch/runter. Knopf 5/7 (Schultertasten): schneller. Läuft nur auf dem
   Desktop-Pfad, nicht während eines XR-Sitzung oder eines laufenden Kamera-Flugs. */
const GP = { index: null };
addEventListener('gamepadconnected', (e) => { GP.index = e.gamepad.index; toast(`Gamepad verbunden: ${e.gamepad.id}`); });
addEventListener('gamepaddisconnected', (e) => { if (GP.index === e.gamepad.index) { GP.index = null; toast('Gamepad getrennt'); } });
const gpMove = new THREE.Vector3(), gpFwd = new THREE.Vector3(), gpRight = new THREE.Vector3(), gpOffset = new THREE.Vector3(), gpSph = new THREE.Spherical();
function gpFrame() {
  if (GP.index === null || !navigator.getGamepads) return;
  const gp = navigator.getGamepads()[GP.index];
  if (!gp) return;
  const dz = (v) => (Math.abs(v) > 0.18 ? v : 0);
  const lx = dz(gp.axes[0] || 0), ly = dz(gp.axes[1] || 0), rx = dz(gp.axes[2] || 0), ry = dz(gp.axes[3] || 0);
  const up = (gp.buttons[0]?.pressed ? 1 : 0) - (gp.buttons[1]?.pressed ? 1 : 0);
  const boost = (gp.buttons[5]?.pressed || gp.buttons[7]?.pressed) ? 2.5 : 1;
  if (lx || ly || up) {
    const speed = THREE.MathUtils.clamp(camera.position.distanceTo(controls.target) * 0.03, 1.5, 40) * boost;
    camera.getWorldDirection(gpFwd);
    gpRight.crossVectors(gpFwd, camera.up).normalize();
    gpMove.set(0, 0, 0).addScaledVector(gpFwd, -ly * speed).addScaledVector(gpRight, lx * speed).addScaledVector(camera.up, up * speed);
    camera.position.add(gpMove);
    controls.target.add(gpMove);
  }
  if (rx || ry) {
    gpOffset.copy(camera.position).sub(controls.target);
    gpSph.setFromVector3(gpOffset);
    gpSph.theta -= rx * 0.045;
    gpSph.phi = THREE.MathUtils.clamp(gpSph.phi + ry * 0.045, 0.02, Math.PI - 0.02);
    gpOffset.setFromSpherical(gpSph);
    camera.position.copy(controls.target).add(gpOffset);
  }
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
  if (fileMode === 'nmap') { netAttach(await f.text()); return; }
  let json;
  try { json = JSON.parse(await f.text()); } catch { return toast('Keine gültige JSON-Datei'); }
  if (fileMode === 'attach') {
    if (typeof json.n !== 'string') return toast('Kein Scan-Baum (Feld "n" fehlt)');
    attachAndShow(state.selected, json);
  } else {
    if (json.v !== 1) return toast('Keine Zustandsdatei dieser App');
    await buildAxes(json);
    await ensureSeedMilestones();
    seedLinks();
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



/* ---------- JIT-Sicht: Knoten entstehen nach Blick ----------
   Läuft im Takt, solange der Schalter an ist. Ein zugeklappter Knoten klappt auf, wenn er im Bild liegt und
   nah genug ist (Bildmitte zählt mehr als der Rand). Aufgeklappte Knoten, die weit weg oder außerhalb des
   Bildes liegen, klappen wieder zu. Von Hand aufgeklappte, der gewählte Knoten und sein Pfad bleiben stehen.
   Die Zahl sichtbarer Knoten ist gedeckelt, so bleibt auch ein Scan mit zehntausenden Dateien flüssig. */
const JIT_MAX = 2500;
const jitV = new THREE.Vector3();
function collapseDeep(n) {
  n.expanded = false; n.fcol = true;
  for (const k of n.kids) if (k.expanded && !state.jit.pinned.has(k.id)) collapseDeep(k);
}
function jitTick() {
  const J = state.jit;
  if (!J.on || filterActive() || pointer.down) return;
  const keep = new Set();
  for (let p = state.selected; p; p = p.parent) keep.add(p);
  const all = [], cand = [];
  let total = 0;
  for (const a of state.axes) {
    total += a.visible.length;
    for (const n of a.visible) {
      jitV.copy(n.world).project(camera);
      const off = Math.max(Math.abs(jitV.x), Math.abs(jitV.y));
      const item = { n, d: camera.position.distanceTo(n.world) * (1 + 1.5 * off), inView: jitV.z < 1 && off <= 1.15 };
      all.push(item);
      if (n.kids.length && n.depth >= 1) cand.push(item);
    }
  }
  cand.sort((a, b) => a.d - b.d);
  let opened = 0, closed = 0;
  for (const c of cand) {
    if (opened >= 4 || total >= JIT_MAX) break;
    if (!c.n.expanded && c.inView && c.d < J.reach) { c.n.expanded = true; c.n.fcol = false; opened++; total += c.n.kids.length; J.gen += c.n.kids.length; }
  }
  for (let i = cand.length - 1; i >= 0 && closed < 10; i--) {
    const c = cand[i], n = c.n;
    if (!n.expanded || J.pinned.has(n.id) || keep.has(n)) continue;
    if (!c.inView || c.d > J.reach * 1.5 || total > JIT_MAX * 1.1) { total -= n.kids.length; J.drop += n.kids.length; collapseDeep(n); closed++; }
  }
  // Beschriftung nach Blick: die 60 nächsten Knoten in Reichweite
  all.sort((a, b) => a.d - b.d);
  const near = new Set(all.filter((x) => x.inView && x.d < J.reach * 0.6).slice(0, 60).map((x) => x.n));
  const changed = [];
  for (const x of all) { const is = near.has(x.n); if (!!x.n.jitNear !== is) { x.n.jitNear = is; changed.push(x.n); } }
  if (opened || closed) relayout();
  else for (const n of changed) { disposeLabel(n); updateLabel(n); }
}
function setJit(on) {
  state.jit.on = on;
  $('jitToggle').setAttribute('aria-pressed', String(on));
  $('jitR').hidden = !on;
  if (on && filterActive()) toast('JIT-Sicht pausiert, solange ein Filter aktiv ist (der Filter bestimmt, was sichtbar ist).');
  if (!on) {
    for (const a of state.axes) for (const n of a.all) if (n.jitNear) { n.jitNear = false; disposeLabel(n); updateLabel(n); }
  }
  updateStat();
}
$('jitToggle').addEventListener('click', () => setJit(!state.jit.on));
$('jitR').addEventListener('input', (e) => { state.jit.reach = +e.target.value; });
setInterval(jitTick, 200);

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


/* ---------- Überdeckung, Transparenz, Label-Entzerrung (Blick auf AR/VR) ----------
   Im Raum überdecken sich Knoten und Beschriftungen je nach Blickwinkel. Drei Hilfen:
   1) Überdeckung messen: Anteil der Knoten, die im Bild ein anderes berühren.
   2) Durchsicht: Knoten halbtransparent ohne Tiefenschreiben, damit man hindurch sieht.
   3) Labels entzerren: Beschriftungen, die einander verdecken oder zu klein sind, werden ausgeblendet. */
function setAlpha(a, quiet = false) {
  state.alpha = Math.min(1, Math.max(0.2, a));
  for (const m of Object.values(matCache)) {
    m.transparent = state.alpha < 1;
    m.opacity = state.alpha;
    m.depthWrite = state.alpha >= 1;
    m.needsUpdate = true;
  }
  $('alphaR').value = Math.round(state.alpha * 100);
  for (const ax of state.axes) ax.lines.material.opacity = Math.min(0.6, state.alpha);
  if (!quiet) markDirty();
}
$('alphaR').addEventListener('input', (e) => setAlpha(e.target.value / 100));

const fovTan = () => Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
function measureOverlap() {
  const r = canvas.getBoundingClientRect(), cell = 24, grid = new Map(), pts = [];
  const v = new THREE.Vector3();
  for (const a of state.axes) for (const n of a.visible) {
    v.copy(n.world).project(camera);
    if (v.z > 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) continue;
    const d = camera.position.distanceTo(n.world);
    const rad = (baseScale(n) / (2 * d * fovTan())) * r.height;
    const p = { x: ((v.x + 1) / 2) * r.width, y: ((1 - v.y) / 2) * r.height, r: Math.max(rad, 1.5), hit: false };
    pts.push(p);
    const key = `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`;
    (grid.get(key) || grid.set(key, []).get(key)).push(p);
  }
  for (const p of pts) {
    const cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell);
    for (let dx = -1; dx <= 1 && !p.hit; dx++) for (let dy = -1; dy <= 1 && !p.hit; dy++) {
      for (const q of grid.get(`${cx + dx},${cy + dy}`) || []) {
        if (q !== p && Math.hypot(q.x - p.x, q.y - p.y) < p.r + q.r) { p.hit = true; break; }
      }
    }
  }
  state.overlap = pts.length ? pts.filter((p) => p.hit).length / pts.length : 0;
}

function declutterLabels() {
  const items = [];
  for (const a of state.axes) for (const n of a.visible) if (n.label) items.push(n);
  if (!state.declutter) { for (const n of items) n.label.visible = true; return; }
  const r = canvas.getBoundingClientRect(), v = new THREE.Vector3(), placed = [];
  const prio = (n) => (n === state.selected || n === pointer.hover ? -1 : n === state.hit ? 0 : n.depth);
  items.sort((a, b) => prio(a) - prio(b) || camera.position.distanceTo(a.world) - camera.position.distanceTo(b.world));
  for (const n of items) {
    const sp = n.label;
    v.copy(sp.position).project(camera);
    if (v.z > 1) { sp.visible = false; continue; }
    const d = camera.position.distanceTo(sp.position);
    const pxH = (sp.scale.y / (2 * d * fovTan())) * r.height, pxW = pxH * (sp.scale.x / sp.scale.y);
    const cx = ((v.x + 1) / 2) * r.width, cy = ((1 - v.y) / 2) * r.height;
    const box = { x0: cx - pxW / 2, x1: cx + pxW / 2, y0: cy - pxH, y1: cy };
    const important = prio(n) <= 0;
    const clash = placed.some((p) => box.x0 < p.x1 && box.x1 > p.x0 && box.y0 < p.y1 && box.y1 > p.y0);
    sp.visible = important || (pxH >= 7 && !clash);
    if (sp.visible) placed.push(box);
  }
}
$('declutterToggle').addEventListener('click', () => {
  state.declutter = !state.declutter;
  $('declutterToggle').setAttribute('aria-pressed', String(state.declutter));
  declutterLabels();
  markDirty();
});
setInterval(() => { declutterLabels(); measureOverlap(); updateStat(); }, 400);

/* ---------- AR/VR (WebXR) ----------
   Die Karte (Gruppe `world`) wird verkleinert vor dich gestellt (Tischmodell), die Controller bleiben in
   echten Meter-Koordinaten. Zeigen + Trigger wählt einen Knoten wie ein Klick. Zeigen + Griff an einem
   Knoten verschiebt seinen Ast (wie das Ziehen mit der Maus). Ein Griff auf leeren Raum verschiebt die
   ganze Karte ("Raum greifen"), zwei Griffe gleichzeitig drehen und skalieren sie um den Punkt zwischen
   den Controllern (wie Pinch-Zoom, nur räumlich). Die Knöpfe erscheinen nur, wenn das Gerät das unterstützt. */
const XR_SCALE = 0.004, XR_SCALE_MIN = 0.0006, XR_SCALE_MAX = 0.02;
async function xrInit() {
  if (!navigator.xr) return;
  for (const [mode, id] of [['immersive-vr', 'xrVr'], ['immersive-ar', 'xrAr']]) {
    if (!(await navigator.xr.isSessionSupported(mode).catch(() => false))) continue;
    const b = $(id);
    b.hidden = false;
    b.addEventListener('click', async () => {
      try {
        const session = await navigator.xr.requestSession(mode, { optionalFeatures: ['local-floor', 'bounded-floor'] });
        renderer.xr.setReferenceSpaceType('local-floor');
        await renderer.xr.setSession(session);
      } catch (e) { toast('AR/VR nicht startbar: ' + e.message); }
    });
  }
}
const xrSaved = {};
renderer.xr.addEventListener('sessionstart', () => {
  const blend = renderer.xr.getSession().environmentBlendMode;   // 'opaque' = VR, sonst AR mit Kamerabild
  xrSaved.bg = scene.background; xrSaved.near = camera.near; xrSaved.far = camera.far; xrSaved.enabled = controls.enabled;
  if (blend !== 'opaque') scene.background = null;             // Passthrough: kein Hintergrund malen
  world.scale.setScalar(XR_SCALE);
  world.position.set(-150 * XR_SCALE, 0.7, -1.8);              // Boxmitte etwa 1,2 m hoch, 1,2 m vor dir
  world.quaternion.identity();
  camera.near = 0.05; camera.far = 100; camera.updateProjectionMatrix();
  controls.enabled = false;
});
renderer.xr.addEventListener('sessionend', () => {
  scene.background = xrSaved.bg;
  world.scale.setScalar(1); world.position.set(0, 0, 0); world.quaternion.identity();
  camera.near = xrSaved.near; camera.far = xrSaved.far; camera.updateProjectionMatrix();
  controls.enabled = xrSaved.enabled;
  for (const st of XR.controllers) { st.mode = null; st.cursor.visible = false; }
  XR.prevGrabCount = 0; XR.twoHandPrev = null;
});
xrInit();

/* ---------- XR-Controller ---------- */
const XR = { controllers: [], prevGrabCount: 0, twoHandPrev: null };
const xrCaster = new THREE.Raycaster();
function xrRay(controller) {
  const origin = new THREE.Vector3().setFromMatrixPosition(controller.matrixWorld);
  const dir = new THREE.Vector3(0, 0, -1).transformDirection(controller.matrixWorld);
  return { origin, dir };
}
function xrToggleSelect(n) {
  if (n.kids.length) { if (filterActive()) n.fcol = isOpen(n); else n.expanded = !n.expanded; disposeLabel(n); relayout(); markDirty(); }
  select(n);
}
function makeXrController(index) {
  const controller = renderer.xr.getController(index);
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -3)]),
    new THREE.LineBasicMaterial({ color: LINK_COLOR, transparent: true, opacity: 0.7 })
  );
  line.name = 'ray';
  controller.add(line);
  const cursor = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 8), new THREE.MeshBasicMaterial({ color: LINK_COLOR }));
  cursor.visible = false;
  scene.add(cursor);
  const st = { controller, cursor, mode: null, node: null, offStart: null, grabPos: new THREE.Vector3() };
  controller.addEventListener('selectstart', () => {
    const { origin, dir } = xrRay(controller);
    xrCaster.set(origin, dir);
    const hit = pointer.pickables ? xrCaster.intersectObjects(pointer.pickables, false)[0] : null;
    if (hit) xrToggleSelect(hit.object.userData.node);
  });
  controller.addEventListener('squeezestart', () => {
    const { origin, dir } = xrRay(controller);
    xrCaster.set(origin, dir);
    const hit = pointer.pickables ? xrCaster.intersectObjects(pointer.pickables, false)[0] : null;
    st.grabPos.copy(origin);
    if (hit) { st.mode = 'node'; st.node = hit.object.userData.node; st.offStart = st.node.off.clone(); }
    else st.mode = 'world';
  });
  controller.addEventListener('squeezeend', () => { st.mode = null; st.node = null; });
  scene.add(controller);
  XR.controllers.push(st);
}
makeXrController(0);
makeXrController(1);

function xrFrame() {
  for (const st of XR.controllers) {
    const { origin, dir } = xrRay(st.controller);
    xrCaster.set(origin, dir);
    const hit = pointer.pickables ? xrCaster.intersectObjects(pointer.pickables, false)[0] : null;
    st.cursor.visible = !!hit;
    if (hit) {
      st.cursor.position.copy(hit.point);
      st.controller.getObjectByName('ray').scale.z = origin.distanceTo(hit.point) / 3;
    } else st.controller.getObjectByName('ray').scale.z = 1;
  }
  for (const st of XR.controllers) {
    if (st.mode !== 'node') continue;
    const cur = new THREE.Vector3().setFromMatrixPosition(st.controller.matrixWorld);
    const deltaLocal = cur.clone().sub(st.grabPos).applyQuaternion(world.quaternion.clone().invert()).divideScalar(world.scale.x);
    st.node.off.copy(st.offStart).add(deltaLocal);
    relayout();
    markDirty();
  }
  const grabbing = XR.controllers.filter((st) => st.mode === 'world');
  // Nur beim Loslassen der zweiten Hand (2 -> 1) neu einmessen: die verbleibende Hand hatte während des
  // Zweihand-Griffs keinen laufend aktualisierten grabPos. Ein frischer Griff (0 -> 1) setzt seinen grabPos
  // schon in squeezestart; ein erneutes Einmessen hier würde die Bewegung dieses ersten Bildes verschlucken.
  if (XR.prevGrabCount === 2 && grabbing.length === 1) grabbing[0].grabPos.setFromMatrixPosition(grabbing[0].controller.matrixWorld);
  if (grabbing.length !== 2) XR.twoHandPrev = null;
  XR.prevGrabCount = grabbing.length;
  if (grabbing.length === 2) {
    const [a, b] = grabbing;
    const curA = new THREE.Vector3().setFromMatrixPosition(a.controller.matrixWorld);
    const curB = new THREE.Vector3().setFromMatrixPosition(b.controller.matrixWorld);
    const curMid = curA.clone().add(curB).multiplyScalar(0.5);
    const curDist = Math.max(curA.distanceTo(curB), 0.02);
    const curVec = curB.clone().sub(curA);
    if (XR.twoHandPrev) {
      const { dist: prevDist, vec: prevVec } = XR.twoHandPrev;
      const scaleFactor = curDist / prevDist;
      const angle = Math.atan2(curVec.x, curVec.z) - Math.atan2(prevVec.x, prevVec.z);
      const pivotLocal = world.worldToLocal(curMid.clone());
      const newScale = THREE.MathUtils.clamp(world.scale.x * scaleFactor, XR_SCALE_MIN, XR_SCALE_MAX);
      world.scale.setScalar(newScale);
      world.rotateY(-angle);
      world.updateMatrixWorld();
      const pivotAfter = world.localToWorld(pivotLocal.clone());
      world.position.add(curMid.clone().sub(pivotAfter));
    }
    XR.twoHandPrev = { mid: curMid, dist: curDist, vec: curVec };
  } else {
    XR.twoHandPrev = null;
    if (grabbing.length === 1) {
      const st = grabbing[0];
      const cur = new THREE.Vector3().setFromMatrixPosition(st.controller.matrixWorld);
      world.position.add(cur.clone().sub(st.grabPos));
      st.grabPos.copy(cur);
    }
  }
}

/* ---------- Netzwerk (nmap): Ergebnisse als Ast im Visualizer ----------
   nmap selbst läuft nicht im Browser. tools/Scan-OwnNetwork.ps1 startet es gegen eigene Geräte und
   schreibt eine XML-Datei (nmap -oX), die hier importiert wird: Rechner → Ports mit Dienst und Status. */
const NET_RISKY = { 21: 'FTP', 22: 'SSH', 23: 'Telnet', 135: 'RPC', 139: 'NetBIOS', 445: 'SMB', 1433: 'MSSQL', 2375: 'Docker-API', 3306: 'MySQL', 3389: 'RDP', 5432: 'PostgreSQL', 5900: 'VNC', 6379: 'Redis', 9200: 'Elasticsearch', 11434: 'Ollama', 27017: 'MongoDB' };
function nmapToTree(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror') || doc.documentElement.nodeName !== 'nmaprun') throw new Error('keine nmap-XML (nmap -oX)');
  const start = +doc.documentElement.getAttribute('start') * 1000;
  const when = start ? new Date(start).toLocaleString('de-DE') : 'unbekannt';
  let open = 0, risky = 0;
  const hosts = [...doc.querySelectorAll('host')].map((h) => {
    const ip = h.querySelector('address[addrtype="ipv4"], address')?.getAttribute('addr') || '?';
    const name = h.querySelector('hostname')?.getAttribute('name') || '';
    const up = h.querySelector('status')?.getAttribute('state') === 'up';
    const loop = /^127\./.test(ip);
    const os = h.querySelector('osmatch')?.getAttribute('name') || '';
    const ports = [...h.querySelectorAll('port')].map((p) => {
      const state = p.querySelector('state')?.getAttribute('state') || '?';
      const num = +p.getAttribute('portid'), proto = p.getAttribute('protocol') || 'tcp';
      const sv = p.querySelector('service');
      const svc = sv?.getAttribute('name') || '?', prod = [sv?.getAttribute('product'), sv?.getAttribute('version')].filter(Boolean).join(' ');
      const isRisky = state === 'open' && NET_RISKY[num] && !loop;
      if (state === 'open') open++;
      if (isRisky) risky++;
      const node = {
        n: `${num}/${proto} ${svc}`, p: `${ip}:${num}`,
        s: state === 'closed' ? 'archiv' : isRisky ? 'risiko' : state === 'open' ? (NET_RISKY[num] ? 'info' : 'live') : 'offen',
        m: `${state}${prod ? ' · ' + prod : ''}`,
        d: `${ip}${name ? ' (' + name + ')' : ''}: ${proto}/${num} ${state}, Dienst ${svc}${prod ? ' (' + prod + ')' : ''}.${NET_RISKY[num] ? ' Bekannter Fernzugriffs- oder Datendienst: ' + NET_RISKY[num] + '.' : ''}`,
      };
      if (isRisky) node.z = ['haerten', `${NET_RISKY[num]} ist von anderen Geräten erreichbar. Nur behalten, wenn bewusst genutzt, sonst Dienst abschalten oder per Firewall auf vertraute Adressen beschränken.`];
      return node;
    });
    return {
      n: `${ip}${name ? ' (' + name + ')' : ''}`, s: up ? 'live' : 'archiv', p: ip,
      m: `${ports.filter((x) => x.m.startsWith('open')).length} offene Ports`,
      d: `${up ? 'Erreichbar' : 'Nicht erreichbar'}${os ? ', vermutlich ' + os : ''}.`, c: ports,
    };
  });
  return {
    n: `nmap ${when}`, s: 'ordner', p: `nmap/${start || 0}`,
    m: `${hosts.length} Hosts · ${open} offene Ports · ${risky} Risiko`,
    d: `Import aus nmap-XML (${doc.documentElement.getAttribute('scanner') || 'nmap'} ${doc.documentElement.getAttribute('version') || ''}).`, c: hosts,
  };
}
function netAttach(text) {
  try { attachAndShow(state.selected || state.axes[0].root, nmapToTree(text)); }
  catch (e) { toast('nmap-Datei nicht lesbar: ' + e.message); }
}
$('netToggle').addEventListener('click', () => toggleLeft('net'));
$('netClose').addEventListener('click', () => { $('net').hidden = true; });
$('netImport').addEventListener('click', () => pickFile('nmap'));
$('netSample').addEventListener('click', async () => {
  try { netAttach(await (await fetch('data/nmap-beispiel.xml')).text()); } catch (e) { toast('Beispiel nicht ladbar: ' + e.message); }
});

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
  for (const x of ['lex', 'ms', 'flt', 'ob', 'net', 'neuro']) $(x).hidden = true;
  el.hidden = !open;
  if (open && onOpen) onOpen();
}
$('fltToggle').addEventListener('click', () => toggleLeft('flt', fltInfoUpdate));
$('fltClose').addEventListener('click', () => { $('flt').hidden = true; });

/* ---------- Verknüpfungen (Node-Editor) ---------- */
const nodeById = (id) => state.axes.map((a) => a.byId.get(id)).find(Boolean);
const linkGroup = new THREE.Group();
world.add(linkGroup);
const linkMat = new THREE.MeshBasicMaterial({ color: LINK_COLOR, transparent: true, opacity: 0.9 });
const coneGeo = new THREE.ConeGeometry(1, 2.6, 12);
const rubber = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
  new THREE.LineBasicMaterial({ color: LINK_COLOR, depthTest: false })
);
rubber.frustumCulled = false;
rubber.renderOrder = 8;
rubber.visible = false;
world.add(rubber);

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
  neuroOnLink(a, b);
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
  coherence: 'Kohärenz (%)', intent: 'Intent-Hinweise', auditOpen: 'Governance offen',
  devWait: 'Dev Wartebereich', devTest: 'Dev Test', devCommit: 'Dev Commit', devDone: 'Dev abgeschlossen',
};

function currentMetrics() {
  let nodes = 0, moved = 0;
  for (const a of state.axes) for (const n of a.all) { nodes++; if (n.off.lengthSq() > 0) moved++; }
  const docs = lex.entries.length;
  const captured = lex.entries.filter((e) => state.captured.has(e.key)).length;
  const volume = Math.round(state.axes.reduce((t, a) => t + volumeK(a), 0));
  const dv = devCounts();
  monCoherence();
  return { nodes, docs, captured, links: state.links.length, moved, attached: state.attachLog.length, volume,
    coherence: Math.round(MON.coh), intent: monUniqueIntent().length, auditOpen: state.audit.filter((e) => e.status === 'PENDING').length,
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

/* Feste Querverweise zwischen Lexikon-Einträgen, per Dokumentpfad (d.p) statt Knoten-ID,
   damit sie unabhängig von der Position im Baum funktionieren. */
const LINK_SEEDS = [
  ['TRAININGSHUB/darwin-loop.md', 'TRAININGSHUB/iteration.md', 'besteht aus'],
  ['TRAININGSHUB/hybrid-sync.md', 'TRAININGSHUB/async.md', 'gefolgt von'],
];
function seedLinks() {
  const byPath = new Map();
  for (const a of state.axes) for (const n of a.all) if (n.d.p) byPath.set(n.d.p, n);
  let added = false;
  for (const [pa, pb, label] of LINK_SEEDS) {
    const a = byPath.get(pa), b = byPath.get(pb);
    if (!a || !b || state.links.some((l) => l.a === a.id && l.b === b.id)) continue;
    state.links.push({ id: ++linkSeq, a: a.id, b: b.id, label });
    added = true;
  }
  if (added) { renderLinks(); renderLinkPanel(); }
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


/* ---------- Monitor: dauerhaft laufende Kohärenz- und Execution-Intent-Prüfung ----------
   Läuft ab dem Laden im Takt (kein Trigger, kein Ausschalter) und zeigt nur an: Es wird nichts ausgeführt
   oder blockiert.
   Kohärenz = 100 % * (1 - Widersprüche / relevante Punkte). Relevant sind Knoten mit Dev-Stand oder Status
   „Risiko“ (ein Punkt zählt einmal, auch wenn er auf mehreren Achsen liegt) und Verknüpfungen.
   Widerspruch: „Abgeschlossen“ bei Status Risiko/Offen · „Wartebereich“ bei Status Live ·
   Risiko ohne Dev-Stand · Verknüpfung mit fehlendem Endpunkt. */
const COH_HI = 85, COH_LO = 70, COH_HYST = 2;
const MON = { coh: 100, mode: null, prev: null, baseline: false, log: [], auditKeys: new Set(), sig: '', coh0: false, contra: [], intent: new Map(), ingress: [], all: null, total: -1, axesRef: null, idx: 0, tick: 0, lastToast: 0 };

const INTENT_RULES = [
  ['PowerShell-Ausführung', /invoke-expression|\biex\b|-encodedcommand|set-executionpolicy|downloadstring|start-process\s+-verb\s+runas/i],
  ['Shell / Systembefehl', /\bcmd(\.exe)?\s*\/c\b|\bpowershell(\.exe)?\s+-\w|\bbash\s+-c\b|\bcurl\b[^\n]{0,80}\|\s*(ba)?sh|\bwget\b[^\n]{0,80}\|\s*(ba)?sh|\brm\s+-rf\b|certutil[^\n]{0,40}-urlcache|\breg\s+add\b|schtasks[^\n]{0,20}\/create/i],
  ['Skript / eval', /<script\b|javascript:|\beval\s*\(|\bexec\s*\(|os\.system\s*\(|subprocess\.(run|popen|call)|shell\s*=\s*true|child_process/i],
  ['Kodierte Nutzlast', /[A-Za-z0-9+/]{120,}={0,2}/],
  ['Prompt-Injection', /ignore (all |any )?(previous|prior|above) (instructions|rules)|ignoriere (alle )?(vorherigen|bisherigen|obigen) (anweisungen|regeln)|disregard (the )?system prompt|reveal (the )?system prompt|you are now\b|du bist jetzt\b|execute the following|führe (den folgenden|diesen) (befehl|code) aus/i],
];
function intentHits(text) {
  const t = text.length > 4000 ? text.slice(0, 4000) : text;
  return INTENT_RULES.filter(([, re]) => re.test(t)).map(([name]) => name);
}

function monLog(msg, cls = '') {
  MON.log.unshift({ t: new Date(), msg, cls });
  MON.log.length = Math.min(MON.log.length, 60);
}
// Seat Governance (wie audit.json im Neural HUD): Alles, was nicht eindeutig unkritisch ist, wird nicht still
// behandelt, sondern als offene Anfrage zur Entscheidung des Operators vorgemerkt. Fail-closed: Ohne Freigabe
// bleibt sie PENDING. Die Freigabe ist nur ein Vermerk, der Monitor führt nie etwas aus.
function auditAdd(type, source, reason, key, sample = '') {
  if (key && MON.auditKeys.has(key)) return;
  if (key) MON.auditKeys.add(key);
  const n = state.audit.length + 1;
  state.audit.push({
    id: `REQ_${String(n).padStart(4, '0')}`, t: new Date().toISOString(), type, source, reason, sample, key: key || '',
    capability: type === 'execute' ? 'EXECUTE_ROOT' : 'COGNITION_ONLY', status: 'PENDING',
  });
  if (state.audit.length > 200) state.audit.shift();
  monLog(type === 'execute' ? `[GATE: VETO] Ausführungs-Absicht (${source}): ${reason}. Weiter an Seat Governance.` : `[DIVERGENZ] ${reason}. Weiter an Seat Governance.`, type === 'execute' ? 'bad' : 'warn');
  if (Date.now() - MON.lastToast > 3000) {
    MON.lastToast = Date.now();
    toast(type === 'execute' ? `CreoAnalyze: Ausführungs-Absicht (${source}). Anfrage wartet auf Freigabe, nichts wird ausgeführt.` : `Divergenz-Kavität: Anfrage an Seat Governance vorgemerkt.`);
  }
  markDirty();
  monRender();
}
function auditResolve(e, res) {
  e.status = res === 'approve' ? 'APPROVED' : 'DENIED';
  if (res === 'approve' && e.key && e.type === 'execute') state.intentOk.add(e.key.replace(/^(n|in):/, ''));
  monLog(`Seat Governance: ${e.id} vom Operator ${e.status === 'APPROVED' ? 'freigegeben (nur Vermerk)' : 'abgelehnt'}`, res === 'approve' ? 'ok' : 'bad');
  markDirty();
  monRender();
}

function monNodes() {
  const total = state.axes.reduce((t, a) => t + a.all.length, 0);
  if (!MON.all || MON.axesRef !== state.axes || MON.total !== total) {
    MON.all = state.axes.flatMap((a) => a.all);
    MON.axesRef = state.axes;
    MON.total = total;
    MON.idx = 0;
  }
  return MON.all;
}

function monCoherence() {
  const seen = new Set(), contra = [];
  let relevant = 0;
  for (const a of state.axes) for (const n of a.all) {
    const dev = state.dev[n.id], st = n.d.s;
    if (!dev && st !== 'risiko') continue;
    const key = `${n.d.p || n.d.n}|${dev || '-'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    relevant++;
    if (dev === 'done' && (st === 'risiko' || st === 'offen')) contra.push([n, `Abgeschlossen, aber Status ${STATUS_TEXT[st]}`]);
    else if (!dev && st === 'risiko') contra.push([n, 'Risiko ohne Dev-Stand']);
    else if (dev === 'wait' && st === 'live') contra.push([n, 'Live, aber noch im Wartebereich']);
  }
  for (const l of state.links) {
    relevant++;
    if (!nodeById(l.a) || !nodeById(l.b)) contra.push([null, 'Verknüpfung mit fehlendem Endpunkt']);
  }
  MON.contra = contra;
  MON.coh = relevant ? 100 * (1 - contra.length / relevant) : 100;
  const c = MON.coh;
  let m = MON.mode;
  if (c > COH_HI) m = 'kollaps';
  else if (c < COH_LO) m = 'kavitaet';
  else if (m === 'kollaps' && c > COH_HI - COH_HYST) m = 'kollaps';
  else if (m === 'kavitaet' && c < COH_LO + COH_HYST) m = 'kavitaet';
  else m = 'neutral';
  MON.prev = MON.mode;
  MON.mode = m;
  if (MON.prev !== m) {
    const first = MON.prev === null;
    if (m === 'kollaps') monLog(`[WcT-KOLLAPS] Kohärenz ${c.toFixed(1)} % über ${COH_HI} %: stabil, Zustand verankert.`, 'ok');
    else if (m === 'kavitaet') {
      monLog(`[DIVERGENZ] Kohärenz ${c.toFixed(1)} % unter ${COH_LO} %.`, 'warn');
      if (!first) auditAdd('divergence', 'Kohärenz-Monitor', `Kohärenz (${c.toFixed(1)} %) unter ${COH_LO} %`, `coh:${Date.now()}`);
    } else monLog(`[NEUTRAL] Kohärenz ${c.toFixed(1)} % zwischen ${COH_LO} % und ${COH_HI} %.`);
  }
}

function monScanChunk(size = 400) {
  const all = monNodes();
  for (let i = 0; i < size && all.length; i++) {
    const n = all[MON.idx++ % all.length];
    const text = `${n.d.n}\n${n.d.d || ''}\n${n.d.m || ''}\n${n.d.ak || ''}\n${n.d.z ? n.d.z[1] : ''}`;
    const hits = intentHits(text);
    if (hits.length) {
      const had = MON.intent.has(n.id), key = n.d.p || n.d.n;
      MON.intent.set(n.id, hits);
      if (!had && MON.baseline && !state.intentOk.has(key)) auditAdd('execute', `Knoten „${n.d.n}“`, hits.join(', '), `n:${key}`);
    } else MON.intent.delete(n.id);
  }
  if (!MON.baseline && all.length && MON.idx >= all.length) {
    MON.baseline = true;
    monLog(`Basis erfasst: ${monUniqueIntent().length} bekannte Hinweise im Bestand, nur neue lösen künftig eine Anfrage aus.`);
  }
}

function monIngress(text, src) {
  if (!text) return;
  const hits = intentHits(text);
  if (!hits.length) return;
  MON.ingress.unshift({ t: new Date(), src, hits, sample: text.replace(/\s+/g, ' ').slice(0, 90) });
  MON.ingress.length = Math.min(MON.ingress.length, 20);
  auditAdd('execute', `Eingang ${src}`, hits.join(', '), `in:${text.slice(0, 60)}`, text.replace(/\s+/g, ' ').slice(0, 90));
  monRender();
}
// Alles, was von außen hereinkommt: Tippen in Textfelder und Einfügen aus der Zwischenablage
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t instanceof HTMLInputElement && (t.type === 'text' || t.type === 'search')) monIngress(t.value, t.id || 'Eingabe');
}, true);
document.addEventListener('paste', (e) => monIngress(e.clipboardData?.getData('text') || '', 'Einfügen'), true);

const MON_LABEL = { kollaps: '[+] WcT-Kollaps', kavitaet: '[~] Divergenz-Kavität' };
function monUniqueIntent() {
  const seen = new Map();
  for (const [id, hits] of MON.intent) {
    const n = nodeById(id);
    const key = n ? n.d.p || n.d.n : '';
    if (n && !state.intentOk.has(key) && !seen.has(key)) seen.set(key, { n, hits, key });
  }
  return [...seen.values()];
}
function monRender() {
  const bar = $('monBar');
  bar.dataset.mode = MON.mode;
  document.querySelectorAll('#monBar [data-m]').forEach((p) => p.classList.toggle('on', p.dataset.m === MON.mode));
  $('monVal').textContent = `${MON.coh.toFixed(0)} %`;
  const nHits = monUniqueIntent().length + MON.ingress.length;
  const it = $('monIntent');
  it.classList.toggle('alert', nHits > 0);
  const open = state.audit.filter((e) => e.status === 'PENDING').length;
  it.textContent = (nHits ? `[!] CreoAnalyze · ${nHits} Hinweis${nHits === 1 ? '' : 'e'}` : '[!] CreoAnalyze · ruhig') + (open ? ` · ${open} offen` : '');
  it.classList.toggle('alert', nHits > 0 || open > 0);
  const sig = `${MON.contra.length}|${MON.intent.size}|${MON.ingress.length}|${MON.coh.toFixed(1)}|${state.audit.map((e) => e.status[0]).join('')}|${MON.log.length}`;
  if (!$('monp').hidden && sig !== MON.sig) { MON.sig = sig; monPanel(); }
}

function monGo(n) {
  for (let p = n.parent; p; p = p.parent) { p.expanded = true; p.fcol = false; }
  relayout();
  select(n);
  focusOn(n.world);
}
function monPanel() {
  const el = $('monp');
  el.replaceChildren();
  const add = (tag, text, cls) => { const e = document.createElement(tag); e.textContent = text; if (cls) e.className = cls; el.append(e); return e; };
  const head = add('div', '', 'row');
  const b = document.createElement('b'); b.textContent = 'Monitor (läuft dauerhaft)'; head.append(b);
  const x = document.createElement('button'); x.type = 'button'; x.textContent = '×'; x.setAttribute('aria-label', 'Schließen');
  x.addEventListener('click', () => { $('monp').hidden = true; });
  const sp = document.createElement('span'); sp.className = 'spacer';
  head.append(sp, x);
  add('p', `Kohärenz ${MON.coh.toFixed(1)} % · über ${COH_HI} % = WcT-Kollaps · unter ${COH_LO} % = Divergenz-Kavität · dazwischen neutral (Hysterese ${COH_HYST} Punkte).`, 'hint');
  add('p', 'Formel: 100 % × (1 − Widersprüche ÷ relevante Punkte). Relevant: Knoten mit Dev-Stand oder Status Risiko, dazu alle Verknüpfungen.', 'hint');
  const row = (n, text) => {
    const r = document.createElement('button');
    r.type = 'button';
    r.className = 'mrow';
    r.textContent = text;
    if (n) r.addEventListener('click', () => monGo(n));
    el.append(r);
  };
  const grid = document.createElement('div');
  grid.className = 'mgrid';
  const cell = (k, v, cls) => { const d = document.createElement('div'); const a = document.createElement('span'); a.textContent = k; const b = document.createElement('b'); b.textContent = v; if (cls) b.className = cls; d.append(a, b); grid.append(d); };
  cell('Status', 'MONITORING', 'ok');
  cell('Letzte Kohärenz', `${MON.coh.toFixed(1)} %`);
  cell('Seat Redirects', String(state.audit.length), 'warn');
  cell('Abbadon Vetos', String(state.audit.filter((e) => e.type === 'execute').length), 'bad');
  el.append(grid);
  const pending = state.audit.filter((e) => e.status === 'PENDING');
  add('div', `Seat Governance · offene Anfragen (${pending.length})`, 'k');
  if (!pending.length) add('p', 'Keine offenen Anfragen.', 'hint');
  const card = (e) => {
    const c = document.createElement('div');
    c.className = 'acard';
    const h = document.createElement('div'); h.className = 'row';
    const id = document.createElement('b'); id.textContent = e.id;
    const sp = document.createElement('span'); sp.className = 'spacer';
    const tm = document.createElement('small'); tm.textContent = new Date(e.t).toLocaleTimeString('de-DE');
    h.append(id, sp, tm); c.append(h);
    const p = document.createElement('div'); p.className = 'hint';
    p.textContent = `Quelle: ${e.source} · Auslöser: ${e.reason} · Fähigkeit: ${e.capability}${e.sample ? ' · „' + e.sample + '“' : ''}`;
    c.append(p);
    if (e.status === 'PENDING') {
      const r = document.createElement('div'); r.className = 'row';
      const ok = document.createElement('button'); ok.type = 'button'; ok.textContent = 'Freigeben (nur Vermerk)';
      ok.addEventListener('click', () => auditResolve(e, 'approve'));
      const no = document.createElement('button'); no.type = 'button'; no.textContent = 'Ablehnen';
      no.addEventListener('click', () => auditResolve(e, 'deny'));
      r.append(ok, no); c.append(r);
    } else { const s2 = document.createElement('div'); s2.className = e.status === 'APPROVED' ? 'ok' : 'bad'; s2.textContent = `operator-approval: ${e.status}`; c.append(s2); }
    return c;
  };
  for (const e of pending.slice().reverse().slice(0, 15)) el.append(card(e));
  const done = state.audit.filter((e) => e.status !== 'PENDING').slice(-5).reverse();
  if (done.length) { add('div', 'Zuletzt entschieden', 'k'); for (const e of done) el.append(card(e)); }
  add('div', `Widersprüche (${MON.contra.length})`, 'k');
  if (!MON.contra.length) add('p', 'Keine.', 'hint');
  for (const [n, why] of MON.contra.slice(0, 40)) row(n, `${n ? n.d.n : '–'}  ·  ${why}`);
  const hits = monUniqueIntent();
  add('div', `Execution Intent in Knoten (${hits.length})`, 'k');
  if (!hits.length) add('p', 'Keine Treffer.', 'hint');
  for (const { n, hits: h, key } of hits.slice(0, 40)) {
    const wrap = document.createElement('div');
    wrap.className = 'irow';
    const go = document.createElement('button');
    go.type = 'button'; go.className = 'mrow'; go.textContent = `${n.d.n}  ·  ${h.join(', ')}`;
    go.addEventListener('click', () => monGo(n));
    const ok = document.createElement('button');
    ok.type = 'button'; ok.textContent = 'bekannt'; ok.title = 'Als bekannt bestätigen: zählt nicht mehr als Hinweis';
    ok.addEventListener('click', () => { state.intentOk.add(key); markDirty(); monRender(); monPanel(); });
    wrap.append(go, ok);
    el.append(wrap);
  }
  if (state.intentOk.size) {
    const back = document.createElement('button');
    back.type = 'button'; back.className = 'mrow';
    back.textContent = `${state.intentOk.size} als bekannt bestätigt · alle wieder zählen`;
    back.addEventListener('click', () => { state.intentOk.clear(); markDirty(); monRender(); monPanel(); });
    el.append(back);
  }
  add('div', `Execution Intent im Eingang (${MON.ingress.length})`, 'k');
  if (!MON.ingress.length) add('p', 'Keine Treffer beim Tippen oder Einfügen.', 'hint');
  for (const g of MON.ingress) row(null, `${g.t.toLocaleTimeString('de-DE')}  ${g.src}: ${g.hits.join(', ')}  ·  ${g.sample}`);
  add('div', 'TAIL_CALL.LOG', 'k');
  const lg = document.createElement('div'); lg.className = 'mlog';
  if (!MON.log.length) lg.textContent = 'Noch keine Ereignisse.';
  for (const l of MON.log.slice(0, 30)) { const d = document.createElement('div'); if (l.cls) d.className = l.cls; d.textContent = `[${l.t.toLocaleTimeString('de-DE')}] ${l.msg}`; lg.append(d); }
  el.append(lg);
  add('p', 'Nur Anzeige und Vormerkung. Der Monitor führt nichts aus, auch nicht bei „Freigeben“.', 'hint');
}
$('monBar').addEventListener('click', () => { const h = $('monp').hidden; $('monp').hidden = !h; if (h) monPanel(); });

// Dauerlauf: alle 250 ms ein Stück der Intent-Prüfung, jede Sekunde die Kohärenz. Unabhängig von Eingaben.
setInterval(() => {
  monScanChunk();
  if (++MON.tick % 4 === 0) { monCoherence(); }
  monRender();
}, 250);

/* ---------- Neuronale Zustände: jede Status-Kategorie als eigenes "Axiom" mit dynamischem Zustand ----------
   Jede Kategorie aus STATUS (core, live, risiko, …) bekommt einen Aktivierungswert wie ein Neuron: er steigt
   schnell mit dem Anteil sichtbarer Knoten dieser Kategorie plus einem Schub bei frischer Aktivität
   (Dev-Wechsel, neue Verknüpfung, Governance-Ereignis dieser Achse) und klingt danach langsam wieder ab
   (Leaky-Integrate-Charakteristik, keine Zufallswerte). Die Axiome zusammen ergeben ein Netz: eine Kante
   zwischen zwei Kategorien ist so stark, wie oft echte Verknüpfungen (state.links) Knoten dieser beiden
   Kategorien verbinden — das ist das "neuronale Muster", das aus den einzelnen Zuständen entsteht. */
const AXIOMS = Object.keys(STATUS);
const NEURO = { level: {}, boost: {}, mesh: {}, sig: '' };
for (const k of AXIOMS) { NEURO.level[k] = 0; NEURO.boost[k] = 0; }

function neuroPulse(statusKey) {
  if (NEURO.boost[statusKey] !== undefined) NEURO.boost[statusKey] = 1;
}
// Echte Ereignisse speisen den Zustand: ein Dev-Wechsel oder eine neue Verknüpfung ist ein Reiz für die
// Kategorie der beteiligten Knoten, kein erfundener Wert.
const neuroOnDev = (n) => neuroPulse(n.d.s);
const neuroOnLink = (a, b) => { neuroPulse(a.d.s); neuroPulse(b.d.s); };

function neuroTick() {
  const counts = {}, total = { n: 0 };
  for (const a of state.axes) for (const n of a.visible) {
    counts[n.d.s] = (counts[n.d.s] || 0) + 1;
    total.n++;
  }
  for (const k of AXIOMS) {
    const share = total.n ? (counts[k] || 0) / total.n : 0;
    const target = Math.min(1, share * 3.2 + NEURO.boost[k]);
    const rate = target > NEURO.level[k] ? 0.35 : 0.06;   // schnelles Auffeuern, langsames Abklingen
    NEURO.level[k] += (target - NEURO.level[k]) * rate;
    NEURO.boost[k] *= 0.9;
    if (NEURO.boost[k] < 0.01) NEURO.boost[k] = 0;
  }
  const mesh = {};
  for (const l of state.links) {
    const na = nodeById(l.a), nb = nodeById(l.b);
    if (!na || !nb) continue;
    const key = [na.d.s, nb.d.s].sort().join('|');
    mesh[key] = (mesh[key] || 0) + 1;
  }
  NEURO.mesh = mesh;
  if (!$('neuro').hidden) neuroRender();
}

function neuroRender() {
  const box = $('neuroBars');
  if (!box.children.length) {
    for (const k of AXIOMS) {
      const row = document.createElement('div');
      row.className = 'nrow';
      row.style.setProperty('--c', STATUS[k]);
      const label = document.createElement('span');
      label.className = 'nlbl';
      label.textContent = STATUS_TEXT[k] || k;
      const track = document.createElement('div');
      track.className = 'ntrack';
      const fill = document.createElement('i');
      fill.dataset.k = k;
      track.append(fill);
      const val = document.createElement('b');
      val.dataset.v = k;
      row.append(label, track, val);
      box.append(row);
    }
  }
  for (const k of AXIOMS) {
    const lvl = NEURO.level[k];
    box.querySelector(`i[data-k="${k}"]`).style.width = Math.round(lvl * 100) + '%';
    box.querySelector(`b[data-v="${k}"]`).textContent = Math.round(lvl * 100) + '%';
  }
  neuroDrawMesh();
}

// Achsen kreisförmig anordnen, Kantenstärke = wie oft echte Verknüpfungen beide Kategorien verbinden.
function neuroDrawMesh() {
  const svg = $('neuroMesh'), R = 92, C = 100;
  const pts = {};
  AXIOMS.forEach((k, i) => {
    const a = (i / AXIOMS.length) * Math.PI * 2 - Math.PI / 2;
    pts[k] = [C + R * Math.cos(a), C + R * Math.sin(a)];
  });
  const maxW = Math.max(1, ...Object.values(NEURO.mesh));
  const edges = Object.entries(NEURO.mesh).map(([key, n]) => {
    const [a, b] = key.split('|');
    const [x1, y1] = pts[a], [x2, y2] = pts[b];
    const w = 0.6 + (n / maxW) * 3.4;
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${STATUS[a]}" stroke-width="${w}" opacity="0.55"/>`;
  }).join('');
  const nodes = AXIOMS.map((k) => {
    const [x, y] = pts[k], r = 3 + NEURO.level[k] * 7;
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="${STATUS[k]}" opacity="${0.35 + NEURO.level[k] * 0.65}"/>`;
  }).join('');
  svg.innerHTML = edges + nodes;
}
/* ---------- Funkstelle: zentraler Hub-Knoten (Mehrfachstecker-Bild) + echte Bluetooth-Kopplung ----------
   Rein visuell: ein Punkt in der Boxmitte, an dem die drei Achsen als Linien zusammenlaufen, plus optional
   gekoppelte Bluetooth-Geräte als eigene Knoten daran. Jedes Gerät wird einzeln über die native
   Geräteauswahl des Browsers bestätigt (navigator.bluetooth.requestDevice) — kein Hintergrund-Scan, keine
   WLAN-Anbindung (dafür gibt es im Browser keine API), kein automatisches erneutes Verbinden. */
const hubGroup = new THREE.Group();
hubGroup.visible = false;
world.add(hubGroup);
const hubCore = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ color: LINK_COLOR, transparent: true, opacity: 0.6 }));
hubGroup.add(hubCore);
const hubSpokes = new THREE.Group();
hubGroup.add(hubSpokes);
const BT = { devices: [] };   // { device, gatt, mesh, line, angle }

function hubCenter() {
  const c = (state.boxL || L) / 2;
  return new THREE.Vector3(c, c, c);
}
function hubSpokeLine(p0, p1, color) {
  const geo = new THREE.BufferGeometry().setFromPoints([p0, p1]);
  return new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.5 }));
}
function hubTick() {
  hubGroup.visible = !$('neuro').hidden;
  if (!hubGroup.visible) return;
  const center = hubCenter();
  hubCore.position.copy(center);
  const avg = AXIOMS.reduce((t, k) => t + NEURO.level[k], 0) / AXIOMS.length;
  hubCore.scale.setScalar(1.4 + avg * 2.2);
  hubCore.material.opacity = 0.35 + avg * 0.5;

  while (hubSpokes.children.length) { const c = hubSpokes.children.pop(); c.geometry.dispose(); c.material.dispose(); }
  for (const a of state.axes) {
    if (a.root.stamp !== state.stamp) continue;
    hubSpokes.add(hubSpokeLine(center, a.root.world, a.color));
  }
  BT.devices.forEach((d, i) => {
    const angle = (i / Math.max(1, BT.devices.length)) * Math.PI * 2;
    const r = 14 * S;
    const p = center.clone().add(new THREE.Vector3(Math.cos(angle) * r, 6 * S, Math.sin(angle) * r));
    d.mesh.position.copy(p);
    d.mesh.scale.setScalar((d.gatt?.connected ? 1.3 : 0.9) * S * 0.6);
    hubSpokes.add(hubSpokeLine(center, p, LINK_COLOR));
  });
}

function btRenderList() {
  const box = $('btList');
  box.replaceChildren();
  for (const d of BT.devices) {
    const row = document.createElement('div');
    row.className = 'btrow';
    const dot = document.createElement('i');
    dot.style.background = d.gatt?.connected ? '#4DB57C' : '#E4674F';
    const name = document.createElement('span');
    name.textContent = d.device.name || `Gerät ${d.device.id.slice(0, 8)}`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = d.gatt?.connected ? 'Trennen' : 'entfernt';
    btn.disabled = !d.gatt?.connected;
    btn.addEventListener('click', () => btDisconnect(d));
    row.append(dot, name, btn);
    box.append(row);
  }
}
function btDisconnect(d) {
  try { d.gatt?.disconnect(); } catch { /* bereits getrennt */ }
  BT.devices = BT.devices.filter((x) => x !== d);
  hubGroup.remove(d.mesh);
  d.mesh.material.dispose();
  btRenderList();
  toast(`Bluetooth: „${d.device.name || 'Gerät'}“ getrennt`);
}
async function btPair() {
  try {
    const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true });
    let gatt = null;
    try { gatt = await device.gatt?.connect(); } catch { /* Kopplung ohne GATT-Verbindung bleibt sichtbar */ }
    const mesh = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ color: 0x8FA0B3 }));
    hubGroup.add(mesh);
    const entry = { device, gatt, mesh };
    device.addEventListener('gattserverdisconnected', () => { btRenderList(); });
    BT.devices.push(entry);
    btRenderList();
    toast(`Bluetooth: „${device.name || 'Gerät'}“ gekoppelt`);
  } catch (e) {
    if (e?.name !== 'NotFoundError') toast('Bluetooth: ' + (e?.message || 'Kopplung abgebrochen'));
  }
}
if (navigator.bluetooth) {
  $('btPair').addEventListener('click', btPair);
} else {
  $('btPair').hidden = true;
  $('btHint').textContent = 'Dieser Browser unterstützt Web Bluetooth nicht (nötig: Chrome/Edge über HTTPS oder localhost).';
}

$('neuroToggle').addEventListener('click', () => toggleLeft('neuro', neuroRender));
$('neuroClose').addEventListener('click', () => { $('neuro').hidden = true; });
setInterval(neuroTick, 180);
setInterval(hubTick, 180);

/* ---------- Zustand speichern / laden ---------- */
function snapshot(nested = false) {
  const expanded = [], offs = {};
  for (const a of state.axes) for (const n of a.all) {
    if (n.expanded) expanded.push(n.id);
    if (n.off.lengthSq() > 0) offs[n.id] = n.off.toArray().map((v) => +v.toFixed(3));
  }
  return {
    v: 1, savedAt: new Date().toISOString(),
    scale: S, alpha: state.alpha, declutter: state.declutter, layout: LAYOUT, sectors: sectorPref.on, stufe: state.stufe, home: state.home,
    filter: { q: state.filter.q, st: [...state.filter.st], dev: [...state.filter.dev], linked: state.filter.linked, axes: state.filter.axes },
    dev: state.dev, editor: state.editor, obsidian: state.obsidian, intentOk: [...state.intentOk], audit: state.audit, links: state.links.map(({ a, b, label }) => ({ a, b, label })),
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
  else if (e.key.toLowerCase() === 'j' || e.key === '^' || e.code === 'Backquote') setJit(!state.jit.on);
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
  if (renderer.xr.isPresenting) {
    xrFrame();
  } else {
    if (fly) {
      const k = Math.min(1, (performance.now() - fly.t0) / fly.ms);
      const e = 1 - Math.pow(1 - k, 3);
      camera.position.lerpVectors(fly.p0, fly.p1, e);
      controls.target.lerpVectors(fly.t0v, fly.t1, e);
      if (k >= 1) fly = null;
    } else {
      gpFrame();
    }
    controls.update();
  }
  if (state.lens.on && ++lensTick % 6 === 0) lensUpdate();
  if (state.born.length) {
    state.born = state.born.filter((n) => {
      if (!(n.mesh && n.mesh.visible)) { n.born = 0; return false; }
      n.mesh.scale.setScalar(baseScale(n) * (n === pointer.hover ? 1.35 : 1) * bornFactor(n));
      return n.born > 0;
    });
  }
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
    seedLinks();
    if (!saved && !state.milestones.some((m) => !m.seed)) markMilestone(`Zwischenstand ${new Date().toLocaleDateString('de-DE')} · Ausgangspunkt`, 'Automatisch beim ersten Öffnen markiert: Basis für den Fortschrittsvergleich.', true);
    if (state.milestones.some((m) => m.auto)) { persist(snapshot()); dirty = false; $('save').textContent = 'Zustand speichern'; }
    if (saved) toast(`Gespeicherten Zustand geladen (${new Date(saved.savedAt).toLocaleString('de-DE')})`);
  } catch (e) {
    console.error(e);
    toast('Daten konnten nicht geladen werden: ' + e.message);
  }
  window.__sandbox = {
    state, snapshot, relayout, select, camera, controls, focusOn, scene, world, renderer, XR, xrFrame, hubGroup, hubCore, NEURO, BT,
    project(n) {
      const r = canvas.getBoundingClientRect(), v = n.world.clone().project(camera);
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
    },
  };  // für Tests / Konsole
})();
