import * as THREE from 'https://esm.sh/three@0.152.2';
import { PointerLockControls } from 'https://esm.sh/three@0.152.2/examples/jsm/controls/PointerLockControls.js';
import { GLTFLoader } from 'https://esm.sh/three@0.152.2/examples/jsm/loaders/GLTFLoader.js';
import ShipSystems from './shipSystems.js';
import AudioSystem from './audioSystem.js';

const canvas = document.createElement('canvas');
document.body.appendChild(canvas);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 5000);
const BASE_FOV = 75;
camera.position.set(0, 2, 8);

// (Free camera mode removed)

const light = new THREE.DirectionalLight(0xffffff, 1);
light.position.set(5,10,7);
scene.add(light);
const ambientLight = new THREE.AmbientLight(0x666666);
scene.add(ambientLight);
// Remember baseline intensities so flicker restore returns to these values
const BASE_AMBIENT_INTENSITY = ambientLight.intensity || 1;
const BASE_DIR_INTENSITY = light.intensity || 1;

// Controls (pointer lock used for flying and we'll create a separate one for interior FPS)
const controls = new PointerLockControls(camera, document.body);
// Ensure UI buttons exist — if not, create hidden placeholders so code can safely
// call `.addEventListener` and manipulate `.style` without throwing.
let startBtn = document.getElementById('startBtn');
if (!startBtn) {
  startBtn = document.createElement('button');
  startBtn.id = 'startBtn';
  startBtn.style.display = 'none';
  document.body.appendChild(startBtn);
}
let enterBtn = document.getElementById('enterBtn');
if (!enterBtn) {
  enterBtn = document.createElement('button');
  enterBtn.id = 'enterBtn';
  enterBtn.style.display = 'none';
  document.body.appendChild(enterBtn);
}
// autopilot / interior-forward button (shown only when inside)
let autopilotBtn = document.getElementById('autopilotBtn');
if (!autopilotBtn) {
  autopilotBtn = document.createElement('button');
  autopilotBtn.id = 'autopilotBtn';
  autopilotBtn.style.display = 'none';
  // simple inline styling so it's visible over the canvas
  autopilotBtn.style.position = 'fixed';
  autopilotBtn.style.left = '12px';
  autopilotBtn.style.bottom = '12px';
  autopilotBtn.style.zIndex = 9999;
  autopilotBtn.style.padding = '8px 12px';
  autopilotBtn.style.background = 'rgba(0,0,0,0.6)';
  autopilotBtn.style.color = '#fff';
  autopilotBtn.style.border = '1px solid rgba(255,255,255,0.12)';
  autopilotBtn.style.borderRadius = '6px';
  autopilotBtn.style.fontFamily = 'sans-serif';
  autopilotBtn.textContent = 'Autopilot: Off';
  // Do not append to the document — keep as non-DOM placeholder so UI remains clean
}
// Button to re-open the freighter shop when near
let freighterShopBtn = document.getElementById('freighterShopBtn');
if (!freighterShopBtn) {
  freighterShopBtn = document.createElement('button');
  freighterShopBtn.id = 'freighterShopBtn';
  freighterShopBtn.style.display = 'none';
  freighterShopBtn.style.position = 'fixed';
  freighterShopBtn.style.right = '12px';
  freighterShopBtn.style.top = '12px';
  freighterShopBtn.style.zIndex = 10006;
  freighterShopBtn.style.padding = '8px 12px';
  freighterShopBtn.style.background = 'rgba(0,0,0,0.6)';
  freighterShopBtn.style.color = '#fff';
  freighterShopBtn.style.border = '1px solid rgba(255,255,255,0.12)';
  freighterShopBtn.style.borderRadius = '6px';
  freighterShopBtn.style.fontFamily = 'sans-serif';
  freighterShopBtn.textContent = 'Open Shop';
  freighterShopBtn.addEventListener('click', () => {
    try { openShop(); } catch (e) { console.warn('openShop failed', e); }
  });
  document.body.appendChild(freighterShopBtn);
}
// explicit exit button for leaving interior mode completely
let exitInteriorBtn = document.getElementById('exitInteriorBtn');
if (!exitInteriorBtn) {
  exitInteriorBtn = document.createElement('button');
  exitInteriorBtn.id = 'exitInteriorBtn';
  exitInteriorBtn.style.display = 'none';
  exitInteriorBtn.style.position = 'fixed';
  exitInteriorBtn.style.right = '12px';
  exitInteriorBtn.style.bottom = '12px';
  exitInteriorBtn.style.zIndex = 9999;
  exitInteriorBtn.style.padding = '8px 12px';
  exitInteriorBtn.style.background = 'rgba(0,0,0,0.6)';
  exitInteriorBtn.style.color = '#fff';
  exitInteriorBtn.style.border = '1px solid rgba(255,255,255,0.12)';
  exitInteriorBtn.style.borderRadius = '6px';
  exitInteriorBtn.style.fontFamily = 'sans-serif';
  exitInteriorBtn.textContent = 'Exit Interior';
  // Do not append to the document — keep as non-DOM placeholder so UI remains clean
}
// --- Ship systems UI / logic (simple, slow random degradation) ---
const shipSystems = new ShipSystems();
shipSystems.start();

// Audio system: lazy-init on first user gesture so browsers allow playback.
const audioSystem = new AudioSystem();
// initialize audio on the first user click (one-time listener)
document.addEventListener('click', function _initAudioOnce() {
  try { audioSystem.init(); } catch (e) { console.warn('audio init failed', e); }
}, { once: true, capture: true });

// Flashlight / darkness state (granted when circuits go below 50%)
let sceneIsDark = false;
let flashlight = null;
let flashlightOn = false;
let flashlightBattery = 100; // kept for compatibility but no longer drains
const FLASHLIGHT_DRAIN_RATE = 0; // battery drain disabled
// Flicker helpers
let _flickerTimers = [];
function _clearFlickers() {
  for (const t of _flickerTimers) clearTimeout(t);
  _flickerTimers = [];
}
function _startFlicker(toDark = true, duration = 1400) {
  _clearFlickers();
  const start = performance.now();
  // When flickering into darkness capture the current intensities as source;
  // when flickering back on use the saved baseline intensities so lights fully return.
  const origAmbient = toDark ? (ambientLight.intensity || BASE_AMBIENT_INTENSITY) : BASE_AMBIENT_INTENSITY;
  const origDir = toDark ? (light.intensity || BASE_DIR_INTENSITY) : BASE_DIR_INTENSITY;
  const lowAmbient = 0.06;
  const lowDir = 0.08;
  function step() {
    const t = performance.now() - start;
    if (t >= duration) {
      // finish at target
      ambientLight.intensity = toDark ? lowAmbient : BASE_AMBIENT_INTENSITY;
      light.intensity = toDark ? lowDir : BASE_DIR_INTENSITY;
      return;
    }
    // random flicker: choose either near off or near original depending on phase
    const flick = Math.random() > 0.5 ? (toDark ? lowAmbient : origAmbient) : (toDark ? origAmbient * 0.3 : origAmbient * 0.6);
    ambientLight.intensity = flick;
    light.intensity = Math.max(0.02, flick * (toDark ? 1.2 : 1.6));
    const next = 40 + Math.random() * 220;
    _flickerTimers.push(setTimeout(step, next));
  }
  step();
}

// When circuits go low, darken the world and grant the player a flashlight
window.addEventListener('circuits:low', (ev) => {
  if (sceneIsDark) return;
  sceneIsDark = true;
  // Enter power-out state: disable ship movement and pilot UI until repaired
  try { powerOut = true; } catch (e) {}
  try { velocity.set(0,0,0); } catch (e) {}
  try { interiorAutoThrust = false; } catch (e) {}
  try { autopilotBtn.textContent = 'Autopilot: Off'; autopilotBtn.style.background = 'rgba(0,0,0,0.6)'; autopilotBtn.disabled = true; } catch (e) {}
  try { pilotDisabled = true; if (pilotPopup) pilotPopup.style.display = 'none'; } catch (e) {}
  try { pendingAutopilotOn = false; } catch (e) {}
  // If we're currently in third-person flight, switch to the interior (first-person)
  try {
    if (flyEnabled && !interiorEnabled) {
      // Reuse the same flow as pressing E while flying
      enterBtn.click();
    }
  } catch (e) {}
  try {
    // flicker outage then settle to low lighting
    _startFlicker(true, 1400);
  } catch (e) {}
  // Give player a flashlight (add to inventory) and auto-enable it
  try {
    addToInventory({ id: 'flashlight', name: 'Flashlight', price: 0, desc: 'Battery-powered flashlight' });
    // create spotlight if missing
    if (!flashlight) {
      flashlight = new THREE.SpotLight(0xffffff, 0, 120, Math.PI/8, 0.3, 1);
      flashlight.castShadow = false;
      flashlight.target = new THREE.Object3D();
      scene.add(flashlight.target);
      scene.add(flashlight);
    }
    flashlightBattery = 100;
    flashlightOn = true;
    if (inventoryUI && inventoryUI.style.display === 'block') renderInventoryContents();
    try { interactHint.textContent = 'Power failure — systems offline'; interactHint.style.display = 'block'; setTimeout(() => { try { interactHint.style.display = 'none'; } catch(e){} }, 1500); } catch (e) {}
  } catch (err) { console.warn('Failed to grant flashlight', err); }
  try { if (audioSystem) audioSystem.playOnce('poweroff'); } catch (e) {}
});

// When circuits are repaired above threshold, restore controls
window.addEventListener('circuits:restored', (ev) => {
  try { powerOut = false; } catch (e) {}
  try { autopilotBtn.disabled = false; autopilotBtn.textContent = 'Autopilot: Off'; autopilotBtn.style.background = 'rgba(0,0,0,0.6)'; } catch (e) {}
  try { pilotDisabled = false; } catch (e) {}
  try { interactHint.textContent = 'Power restored'; interactHint.style.display = 'block'; setTimeout(() => { try { interactHint.style.display = 'none'; } catch(e){} }, 1200); } catch (e) {}
  try { if (audioSystem) audioSystem.playOnce('powerup'); } catch (e) {}
});

// Animation and interaction helpers (for cabL / cabR)
let mixer = null;
let cabL = null, cabR = null;
let exitDoor = null;
let pilot = null;
const raycaster = new THREE.Raycaster();
let interactTarget = null;
const INTERACT_DISTANCE = 3.5;
const PLAYER_RADIUS = 0.45; // collision radius for the FPS player inside
// automatic door distances (in ship-local units)
const DOOR_AUTO_OPEN_DIST = 1.8; // when player comes within this, doors open
const DOOR_AUTO_CLOSE_DIST = 2.6; // when player leaves beyond this, doors close (hysteresis)

// Powerbox (repairable) state
let powerbox = null;
let powerboxMixer = null;
let powerboxClips = [];
let powerboxActions = [];
let powerboxInteracting = false;
// Note: fixed hold duration removed — play the GLB animations at their own natural speed
let powerboxFinishTimer = null; // timer to delay final repair after last animation frame

// on-screen hint element for interactions
let interactHint = document.getElementById('interactHint');
if (!interactHint) {
  interactHint = document.createElement('div');
  interactHint.id = 'interactHint';
  interactHint.style.position = 'fixed';
  interactHint.style.left = '50%';
  interactHint.style.bottom = '20%';
  interactHint.style.transform = 'translateX(-50%)';
  interactHint.style.padding = '8px 12px';
  interactHint.style.background = 'rgba(0,0,0,0.7)';
  interactHint.style.color = '#fff';
  interactHint.style.borderRadius = '6px';
  interactHint.style.fontFamily = 'sans-serif';
  interactHint.style.zIndex = 10001;
  interactHint.style.display = 'none';
  document.body.appendChild(interactHint);
}

// Oxygen UI (hidden until player is outside)
let oxygenUI = document.getElementById('oxygenUI');
if (!oxygenUI) {
  oxygenUI = document.createElement('div');
  oxygenUI.id = 'oxygenUI';
  oxygenUI.style.position = 'fixed';
  oxygenUI.style.right = '18px';
  oxygenUI.style.top = '18px';
  oxygenUI.style.width = '220px';
  oxygenUI.style.padding = '8px';
  oxygenUI.style.background = 'rgba(0,0,0,0.6)';
  oxygenUI.style.color = '#fff';
  oxygenUI.style.borderRadius = '6px';
  oxygenUI.style.fontFamily = 'sans-serif';
  oxygenUI.style.zIndex = 10003;
  oxygenUI.style.display = 'none';
  const label = document.createElement('div'); label.textContent = 'OXYGEN'; label.style.fontSize = '12px'; label.style.marginBottom = '6px';
  const barWrap = document.createElement('div'); barWrap.style.background = 'rgba(255,255,255,0.08)'; barWrap.style.height = '14px'; barWrap.style.borderRadius = '4px';
  const bar = document.createElement('div'); bar.id = 'oxygenBar'; bar.style.background = '#4fc3f7'; bar.style.height = '100%'; bar.style.width = '100%'; bar.style.borderRadius = '4px';
  barWrap.appendChild(bar);
  const pct = document.createElement('div'); pct.id = 'oxygenPct'; pct.textContent = '100%'; pct.style.textAlign = 'right'; pct.style.fontSize = '11px'; pct.style.marginTop = '6px';
  oxygenUI.appendChild(label); oxygenUI.appendChild(barWrap); oxygenUI.appendChild(pct);
  document.body.appendChild(oxygenUI);
}

// Popup UI for pilot interaction (two options: Fly / Autopilot)
let pilotPopup = document.getElementById('pilotPopup');
let gpsButton = null;
if (!pilotPopup) {
  pilotPopup = document.createElement('div');
  pilotPopup.id = 'pilotPopup';
  pilotPopup.style.position = 'fixed';
  pilotPopup.style.left = '50%';
  pilotPopup.style.top = '40%';
  pilotPopup.style.transform = 'translate(-50%, -50%)';
  pilotPopup.style.padding = '12px';
  pilotPopup.style.background = 'rgba(0,0,0,0.85)';
  pilotPopup.style.color = '#fff';
  pilotPopup.style.borderRadius = '8px';
  pilotPopup.style.fontFamily = 'sans-serif';
  pilotPopup.style.zIndex = 10002;
  pilotPopup.style.display = 'none';
  const txt = document.createElement('div'); txt.textContent = 'Pilot options'; txt.style.marginBottom = '8px'; pilotPopup.appendChild(txt);
  const btnFly = document.createElement('button'); btnFly.textContent = 'Fly (Third-person)'; btnFly.style.marginRight = '8px';
  const btnStats = document.createElement('button'); btnStats.textContent = 'Ship Stats'; btnStats.style.marginRight = '8px';
  const btnAuto = document.createElement('button'); btnAuto.textContent = 'Autopilot (Interior)';
  const btnGPS = document.createElement('button'); btnGPS.textContent = 'Set GPS Target'; btnGPS.style.marginRight = '8px';
  gpsButton = btnGPS;
  const btnInv = document.createElement('button'); btnInv.textContent = 'Inventory'; btnInv.style.marginRight = '8px';
  const btnClose = document.createElement('button'); btnClose.textContent = 'Cancel'; btnClose.style.marginLeft = '8px';
  pilotPopup.appendChild(btnFly); pilotPopup.appendChild(btnStats); pilotPopup.appendChild(btnAuto); pilotPopup.appendChild(btnClose);
  // insert Inventory and GPS buttons before the close button so they're visible
  pilotPopup.insertBefore(btnInv, btnClose);
  pilotPopup.insertBefore(btnGPS, btnClose);
  document.body.appendChild(pilotPopup);

  btnClose.addEventListener('click', () => { pilotPopup.style.display = 'none'; });
  btnInv.addEventListener('click', () => {
    pilotPopup.style.display = 'none';
    try { createInventoryUI(); openInventory(); } catch (err) { console.warn('Inventory failed', err); }
  });
  btnFly.addEventListener('click', () => {
    pilotPopup.style.display = 'none';
    // If we're inside, request a full detach first so we leave interior mode
    if (interiorEnabled) {
      interiorDetachRequested = true;
      interiorControls.unlock();
    }
    // Request fly lock (will set flyEnabled via the lock handler)
    requestLock('fly');
  });
  btnStats.addEventListener('click', () => {
    pilotPopup.style.display = 'none';
    // Open the centered modal and block walking while visible
    if (typeof window.__openShipStatsModal === 'function') {
      window.__openShipStatsModal();
    } else {
      // fallback if modal isn't available yet: ensure overlay is rendered
      if (typeof statsOverlay === 'undefined' || !statsOverlay) renderStats();
      if (statsOverlay) {
        statsOverlay.style.display = statsOverlay.style.display === 'none' ? 'block' : 'none';
        if (statsOverlay.style.display === 'block') renderStats();
      }
    }
  });
  btnAuto.addEventListener('click', () => {
    // If power is out, autopilot cannot be enabled
    if (powerOut) {
      try { interactHint.textContent = 'No power — cannot enable autopilot'; interactHint.style.display = 'block'; setTimeout(() => { try { interactHint.style.display = 'none'; } catch(e){} }, 1400); } catch (e) {}
      pilotPopup.style.display = 'none';
      return;
    }
    pilotPopup.style.display = 'none';
    // If we're already inside, just enable autopilot
    if (interiorEnabled) {
      interiorAutoThrust = true;
      autopilotBtn.textContent = 'Autopilot: On';
      autopilotBtn.style.background = 'rgba(0,100,0,0.7)';
      autopilotBtn.style.display = 'inline-block';
      return;
    }
    // Otherwise, enter interior mode and enable autopilot once inside
    pendingAutopilotOn = true;
    // Reuse the enter button flow so interior box is computed and lock requested
    enterBtn.click();
  });
  btnGPS.addEventListener('click', () => {
    pilotPopup.style.display = 'none';
    // Only allow one active freighter target at a time
    if (freighterGoal) {
      // keep popup closed; briefly notify player
      try { alert('GPS target already active. Reach it before setting a new one.'); } catch (e) {}
      return;
    }
    // spawn the freighter goal far from the player's current ship position and enable GPS HUD
    try {
      spawnFreighter();
      enableGPS(true);
      if (gpsButton) { gpsButton.disabled = true; gpsButton.textContent = 'GPS: Active'; }
    } catch (err) { console.warn('GPS failed', err); }
  });
}

function openPilotPopup() {
  // If power is out, pilot UI is disabled
  if (powerOut || pilotDisabled) {
    try { interactHint.textContent = 'Pilot disabled: no power'; interactHint.style.display = 'block'; setTimeout(() => { try { interactHint.style.display = 'none'; } catch(e){} }, 1400); } catch (e) {}
    return;
  }
  // release pointer lock so the user can click the popup buttons
  if (controls.isLocked) { lockRequest = null; controls.unlock(); }
  if (interiorControls.isLocked) { lockRequest = null; interiorControls.unlock(); }
  pilotPopup.style.display = 'block';
}

// Create a simple overlay to show system health. Toggle with `H` key.
let statsOverlay = document.getElementById('ship-stats');
if (!statsOverlay) {
  statsOverlay = document.createElement('div');
  statsOverlay.id = 'ship-stats';
  // modal-style centered overlay (hidden by default)
  statsOverlay.style.display = 'none';
  statsOverlay.style.zIndex = 10003;
  statsOverlay.style.position = 'fixed';
  statsOverlay.style.left = '50%';
  statsOverlay.style.top = '50%';
  statsOverlay.style.transform = 'translate(-50%, -50%)';
  statsOverlay.style.maxWidth = '620px';
  statsOverlay.style.width = '90%';
  statsOverlay.style.background = 'rgba(8,8,12,0.96)';
  statsOverlay.style.color = '#fff';
  statsOverlay.style.borderRadius = '10px';
  statsOverlay.style.padding = '18px';
  statsOverlay.style.boxShadow = '0 8px 40px rgba(0,0,0,0.7)';
  statsOverlay.style.fontFamily = 'sans-serif';
  statsOverlay.style.maxHeight = '78vh';
  statsOverlay.style.overflow = 'auto';
  // backdrop to dim the world (clicking backdrop will also close)
  const statsBackdrop = document.createElement('div');
  statsBackdrop.id = 'ship-stats-backdrop';
  statsBackdrop.style.position = 'fixed';
  statsBackdrop.style.left = '0';
  statsBackdrop.style.top = '0';
  statsBackdrop.style.width = '100%';
  statsBackdrop.style.height = '100%';
  statsBackdrop.style.background = 'rgba(0,0,0,0.5)';
  statsBackdrop.style.zIndex = 10002;
  statsBackdrop.style.display = 'none';
  document.body.appendChild(statsBackdrop);
  // close button
  const statsClose = document.createElement('button');
  statsClose.id = 'ship-stats-close';
  statsClose.textContent = 'Close';
  statsClose.style.position = 'absolute';
  statsClose.style.right = '12px';
  statsClose.style.top = '12px';
  statsClose.style.padding = '6px 10px';
  statsClose.style.borderRadius = '6px';
  statsClose.style.background = 'rgba(255,255,255,0.08)';
  statsClose.style.color = '#fff';
  statsClose.style.border = '1px solid rgba(255,255,255,0.06)';
  statsClose.style.cursor = 'pointer';
  statsOverlay.appendChild(statsClose);
  document.body.appendChild(statsOverlay);
  // state flag used to block player movement while modal is open
  let statsModalOpen = false;

  function openStatsModal() {
    // unlock pointer locks so the player can click UI
    try { if (controls.isLocked) { lockRequest = null; controls.unlock(); } } catch (e) {}
    try { if (interiorControls.isLocked) { lockRequest = null; interiorControls.unlock(); } } catch (e) {}
    // clear any movement and interactions
    move.forward = move.right = move.up = 0;
    interactHint.style.display = 'none';
    statsBackdrop.style.display = 'block';
    statsOverlay.style.display = 'block';
    renderStats();
    statsModalOpen = true;
  }

  function closeStatsModal() {
    statsBackdrop.style.display = 'none';
    statsOverlay.style.display = 'none';
    statsModalOpen = false;
  }

  // wire close handlers
  statsClose.addEventListener('click', closeStatsModal);
  statsBackdrop.addEventListener('click', closeStatsModal);
  // expose for other code (pilot popup will call this)
  window.__openShipStatsModal = openStatsModal;
  window.__closeShipStatsModal = closeStatsModal;
}

function renderStats() {
  const systems = shipSystems.getAll();
  let html = '<div class="stats-header">Ship Systems</div>';
  html += '<div class="stats-list">';
  for (const key of Object.keys(systems)) {
    const s = systems[key];
    const pct = Math.round(s.value);
    html += `<div class="stat-row"><div class="stat-name">${s.label}</div><div class="stat-bar"><div class="stat-fill" style="width:${pct}%"></div></div><div class="stat-pct">${pct}%</div></div>`;
  }
  html += '</div>';
  statsOverlay.innerHTML = html;
}

// update UI periodically
setInterval(renderStats, 700);

// Stats overlay is toggled only via the Pilot popup `Ship Stats` button.
let flyEnabled = true; // flight mode (third-person style) — start game in fly mode
let interiorEnabled = false; // inside-bin walking mode
let interiorAutoThrust = false; // when true, ship applies continuous forward thrust while inside
let activeCamera = camera; // renderer will use this (start in fly mode)
let interiorDetachRequested = false; // when true, the next unlock will perform a full exit to third-person
let pendingAutopilotOn = false;
// When true, circuits are impaired and ship/pilot controls are disabled until restored
let powerOut = false;
// When true, pilot UI is globally disabled (used while powerOut)
let pilotDisabled = false;

// a second camera + pointerlock controls for interior first-person walking
const fpCamera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 5000);
const interiorControls = new PointerLockControls(fpCamera, document.body);

// small state to know who requested the lock (avoid both handlers firing ambiguously)
let lockRequest = null; // 'fly' or 'interior' or null
let interiorBox = null;
let desiredInteriorLocalPos = null; // temp store for desired local position when entering

startBtn.addEventListener('click', ()=> { requestLock('fly'); });
enterBtn.addEventListener('click', ()=> {
  // will compute interior bounds and request pointer lock (see handler below)
  if (!shipModel) return alert('Ship model not loaded yet');
  const bin = shipModel.getObjectByName('binne');
  if (!bin) return alert('No object named "binne" found inside ship.glb');
  // compute the interior box now from the canonical base box (loaded earlier)
  computeInteriorBoxFromBin();
  // Prefer an explicit start marker inside the model if present.
  // Look for both common spellings just in case (`inerior` or `interior`).
  const startMarker = shipModel.getObjectByName('inerior') || shipModel.getObjectByName('interior');
  if (startMarker) {
    ship.updateMatrixWorld(true);
    const worldPos = new THREE.Vector3();
    startMarker.getWorldPosition(worldPos);
    // convert world position into ship-local coordinates so it remains correct
    // after we parent the FP object to `ship`.
    desiredInteriorLocalPos = ship.worldToLocal(worldPos.clone());
  } else {
    // fallback: use the interior box center (existing behavior)
    const newCenter = interiorBox.getCenter(new THREE.Vector3());
    desiredInteriorLocalPos = newCenter.clone();
  }

  // create or update debug wireframe box
  if (interiorDebugMesh) {
    ship.remove(interiorDebugMesh);
    interiorDebugMesh.geometry.dispose();
  }
  if (interiorConfig.debug) {
    const boxSize = interiorBox.getSize(new THREE.Vector3());
    const geo = new THREE.BoxGeometry(boxSize.x, boxSize.y, boxSize.z);
    const edges = new THREE.EdgesGeometry(geo);
    const mat = new THREE.LineBasicMaterial({ color: 0x00ff00 });
    interiorDebugMesh = new THREE.LineSegments(edges, mat);
    const boxCenter = interiorBox.getCenter(new THREE.Vector3());
    interiorDebugMesh.position.copy(boxCenter);
    ship.add(interiorDebugMesh);
  }
  requestLock('interior');
});

// Autopilot button toggles continuous forward thrust while inside
autopilotBtn.addEventListener('click', () => {
  if (powerOut) {
    try { interactHint.textContent = 'No power — autopilot disabled'; interactHint.style.display = 'block'; setTimeout(() => { try { interactHint.style.display = 'none'; } catch(e){} }, 1200); } catch (e) {}
    return;
  }
  if (!interiorEnabled) return; // only usable while inside
  interiorAutoThrust = !interiorAutoThrust;
  autopilotBtn.textContent = interiorAutoThrust ? 'Autopilot: On' : 'Autopilot: Off';
  autopilotBtn.style.background = interiorAutoThrust ? 'rgba(0,100,0,0.7)' : 'rgba(0,0,0,0.6)';
});

// --- GPS / Goal system ---
let freighterGoal = null; // THREE.Object3D for the goal
let gpsTracking = false;
let gpsHud = null;
const FREIGHTER_REACH_DISTANCE = 200; // distance (units) to consider the freighter 'reached'

function createGpsHud() {
  if (gpsHud) return;
  gpsHud = document.createElement('div');
  gpsHud.id = 'gpsHud';
  gpsHud.style.position = 'fixed';
  gpsHud.style.left = '12px';
  gpsHud.style.top = '12px';
  gpsHud.style.padding = '8px 12px';
  gpsHud.style.background = 'rgba(0,0,0,0.6)';
  gpsHud.style.color = '#fff';
  gpsHud.style.borderRadius = '6px';
  gpsHud.style.fontFamily = 'sans-serif';
  gpsHud.style.zIndex = 10005;
  gpsHud.style.display = 'none';
  gpsHud.textContent = 'GPS: --';
  document.body.appendChild(gpsHud);
}

function enableGPS(on) {
  createGpsHud();
  gpsTracking = !!on;
  gpsHud.style.display = gpsTracking ? 'inline-block' : 'none';
}

function spawnFreighter() {
  // Only spawn a new one if none exists
  if (freighterGoal) return console.warn('Freighter target already exists');
  // lazy-load freighter; place far from current ship position
  const fLoader = new GLTFLoader();
  fLoader.load('freighter.glb', gltf => {
    freighterGoal = gltf.scene;
    // choose a distant random direction biased on horizontal plane
    const dir = new THREE.Vector3((Math.random()-0.5), (Math.random()-0.05)*0.1, (Math.random()-0.5)).normalize();
    // place the freighter very far away so it takes real time to reach
    // spawn distance: 40,000 - 80,000 units away
    const dist = 40000 + Math.random() * 40000;
    const targetPos = new THREE.Vector3().copy(ship.position).add(dir.multiplyScalar(dist));
    freighterGoal.position.copy(targetPos);
    freighterGoal.name = 'freighter_goal';
    scene.add(freighterGoal);
  }, undefined, err => {
    console.warn('Failed to load freighter.glb', err);
    // re-enable GPS button if load failed so player can retry
    if (gpsButton) { gpsButton.disabled = false; gpsButton.textContent = 'Set GPS Target'; }
    enableGPS(false);
  });
}

// --- Simple Shop System (dummy) ---
let shopUI = null;
const shopItems = [
  { id: 'medkit', name: 'Medkit', price: 150, desc: 'Restores health (dummy)'} ,
  { id: 'fuelcell', name: 'Fuel Cell', price: 320, desc: 'Refuels ship (dummy)'},
  { id: 'chip', name: 'Navigation Chip', price: 480, desc: 'Improves GPS (dummy)'}
];

// Simple inventory store: id -> { item, count }
const inventory = {};
let inventoryUI = null;

function addToInventory(item) {
  if (!inventory[item.id]) inventory[item.id] = { item: item, count: 0 };
  inventory[item.id].count += 1;
}

function createInventoryUI() {
  if (inventoryUI) return inventoryUI;
  inventoryUI = document.createElement('div');
  inventoryUI.id = 'inventory-ui';
  inventoryUI.style.position = 'fixed';
  inventoryUI.style.left = '50%';
  inventoryUI.style.top = '50%';
  inventoryUI.style.transform = 'translate(-50%, -50%)';
  inventoryUI.style.zIndex = 10011;
  inventoryUI.style.background = 'rgba(6,6,10,0.96)';
  inventoryUI.style.color = '#fff';
  inventoryUI.style.padding = '16px';
  inventoryUI.style.borderRadius = '10px';
  inventoryUI.style.minWidth = '320px';
  inventoryUI.style.fontFamily = 'sans-serif';

  const title = document.createElement('div'); title.textContent = 'Inventory'; title.style.fontSize = '18px'; title.style.marginBottom = '10px'; inventoryUI.appendChild(title);

  const contents = document.createElement('div'); contents.id = 'inventory-contents'; contents.style.maxHeight = '50vh'; contents.style.overflow = 'auto'; inventoryUI.appendChild(contents);

  const close = document.createElement('div'); close.style.marginTop = '12px'; close.style.textAlign = 'right';
  const closeBtn = document.createElement('button'); closeBtn.textContent = 'Close'; closeBtn.style.padding = '6px 10px'; closeBtn.style.borderRadius = '6px';
  closeBtn.addEventListener('click', () => { if (inventoryUI) inventoryUI.style.display = 'none'; });
  close.appendChild(closeBtn);
  inventoryUI.appendChild(close);
  inventoryUI.style.display = 'none';
  document.body.appendChild(inventoryUI);
  renderInventoryContents();
  return inventoryUI;
}

function openInventory() {
  createInventoryUI();
  if (inventoryUI) {
    renderInventoryContents();
    inventoryUI.style.display = 'block';
  }
}

function renderInventoryContents() {
  if (!inventoryUI) return;
  const contents = document.getElementById('inventory-contents');
  if (!contents) return;
  contents.innerHTML = '';
  const keys = Object.keys(inventory);
  if (keys.length === 0) {
    const empt = document.createElement('div'); empt.textContent = 'Inventory is empty.'; empt.style.opacity = '0.9'; contents.appendChild(empt); return;
  }
  for (const k of keys) {
    const entry = inventory[k];
    const row = document.createElement('div'); row.style.display = 'flex'; row.style.justifyContent = 'space-between'; row.style.alignItems = 'center'; row.style.padding = '6px 0';
    const left = document.createElement('div'); const nm = document.createElement('div'); nm.textContent = entry.item.name; nm.style.fontWeight = '600'; const cnt = document.createElement('div'); cnt.textContent = entry.item.desc; cnt.style.fontSize = '12px'; cnt.style.opacity = '0.9'; left.appendChild(nm); left.appendChild(cnt);
    const right = document.createElement('div'); right.style.textAlign = 'right'; const count = document.createElement('div'); count.textContent = `${entry.count}x`; count.style.marginBottom = '6px';
    // Remove ability to use items from the inventory UI
    // Only show the count; items are not usable from this UI.
    right.appendChild(count);
    row.appendChild(left); row.appendChild(right);
    contents.appendChild(row);
  }
}

function createShopUI() {
  if (shopUI) return shopUI;
  shopUI = document.createElement('div');
  shopUI.id = 'freighter-shop';
  shopUI.style.position = 'fixed';
  shopUI.style.left = '50%';
  shopUI.style.top = '50%';
  shopUI.style.transform = 'translate(-50%, -50%)';
  shopUI.style.zIndex = 10010;
  shopUI.style.background = 'rgba(6,6,10,0.96)';
  shopUI.style.color = '#fff';
  shopUI.style.padding = '16px';
  shopUI.style.borderRadius = '10px';
  shopUI.style.minWidth = '320px';
  shopUI.style.fontFamily = 'sans-serif';

  const title = document.createElement('div');
  title.textContent = 'Freighter Shop';
  title.style.fontSize = '18px';
  title.style.marginBottom = '10px';
  shopUI.appendChild(title);

  const list = document.createElement('div');
  list.style.display = 'grid';
  list.style.gridTemplateColumns = '1fr auto';
  list.style.rowGap = '8px';
  list.style.columnGap = '12px';
  list.style.alignItems = 'center';

  for (const it of shopItems) {
    const info = document.createElement('div');
    const name = document.createElement('div'); name.textContent = `${it.name} — ${it.price}cr`;
    name.style.fontWeight = '600';
    const desc = document.createElement('div'); desc.textContent = it.desc; desc.style.fontSize = '12px'; desc.style.opacity = '0.9';
    info.appendChild(name); info.appendChild(desc);

    const btnWrap = document.createElement('div');
    const btn = document.createElement('button');
    btn.textContent = 'Buy';
    btn.style.padding = '6px 10px';
    btn.style.borderRadius = '6px';
    btn.style.cursor = 'pointer';
    btn.addEventListener('click', () => {
      // Dummy purchase: add to inventory, disable button and show purchased state
      addToInventory(it);
      btn.disabled = true;
      btn.textContent = 'Purchased';
      btn.style.opacity = '0.7';
      console.log('Purchased item:', it.id);
      // update inventory UI if currently open
      if (inventoryUI && inventoryUI.style.display === 'block') renderInventoryContents();
    });
    btnWrap.appendChild(btn);

    list.appendChild(info);
    list.appendChild(btnWrap);
  }

  shopUI.appendChild(list);
  const close = document.createElement('div');
  close.style.marginTop = '12px';
  close.style.textAlign = 'right';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Close';
  closeBtn.style.padding = '6px 10px';
  closeBtn.style.borderRadius = '6px';
  closeBtn.addEventListener('click', () => {
    if (shopUI) shopUI.style.display = 'none';
    // re-enable GPS button so player can set new targets
    if (gpsButton) { gpsButton.disabled = false; gpsButton.textContent = 'Set GPS Target'; }
    // After closing the shop, ensure the next user click can re-lock the pointer.
    try { if (canvas && typeof canvas.focus === 'function') canvas.focus(); } catch (e) {}
    const tryRelock = (ev) => {
      try { document.removeEventListener('click', tryRelock, true); } catch (e) {}
      // ignore clicks that hit UI elements (shop, pilot popup, inventory)
      try {
        const tgt = ev.target;
        if (tgt && tgt.closest && (tgt.closest('#freighter-shop') || tgt.closest('#pilotPopup') || tgt.closest('#inventory-ui') || tgt.closest('#ship-stats') )) {
          return;
        }
      } catch (e) {}
      // User clicked outside UI — request pointer lock according to current mode.
      try {
        if (interiorEnabled) requestLock('interior');
        else requestLock('fly');
      } catch (err) { /* ignore lock errors */ }
    };
    // Attach capture-phase one-time listener so the user's click is used as gesture for pointer lock.
    document.addEventListener('click', tryRelock, true);
  });
  close.appendChild(closeBtn);
  shopUI.appendChild(close);
  shopUI.style.display = 'none';
  document.body.appendChild(shopUI);
  return shopUI;
}

function openShop() {
  createShopUI();
  // Release pointer lock so the player can click the shop UI
  try { if (controls.isLocked) { lockRequest = null; controls.unlock(); } } catch (e) {}
  try { if (interiorControls.isLocked) { lockRequest = null; interiorControls.unlock(); } } catch (e) {}
  if (shopUI) shopUI.style.display = 'block';
}


// Handlers for the flight pointerlock control
controls.addEventListener('lock', ()=> {
  if (lockRequest === 'fly') {
    startBtn.style.display = 'none';
    enterBtn.style.display = 'none';
    // If we were previously inside, fully detach from interior so walking is disabled
    if (interiorEnabled) {
      // remove FP object from ship and clear interior state
      try { ship.remove(interiorControls.getObject()); } catch (err) {}
      interiorEnabled = false;
      exitInteriorBtn.style.display = 'none';
      autopilotBtn.style.display = 'none';
      interiorAutoThrust = false;
      pendingAutopilotOn = false;
    }
    flyEnabled = true;
    activeCamera = camera;
  }
});
controls.addEventListener('unlock', ()=> {
  if (lockRequest === 'fly') {
    startBtn.style.display = 'inline-block';
    enterBtn.style.display = 'inline-block';
    flyEnabled = false; velocity.set(0,0,0); move.forward = move.right = move.up = 0;
    lockRequest = null;
  }
});

// Handlers for the interior pointerlock control
interiorControls.addEventListener('lock', ()=> {
  if (lockRequest === 'interior') {
    enterBtn.style.display = 'none';
    startBtn.style.display = 'none';
    interiorEnabled = true;
    activeCamera = fpCamera;
    // attach the fp object to the ship so it moves with the ship
    ship.add(interiorControls.getObject());
    // now that the fp object is parented to ship, set its local position
    if (desiredInteriorLocalPos) {
      interiorControls.getObject().position.copy(desiredInteriorLocalPos);
      desiredInteriorLocalPos = null;
    }
    // stop ship movement and clear flight input so player can't control ship while inside
    // keep current `velocity` so the ship continues moving (visual stars will keep moving past)
    // but clear player input so they can't thrust the ship while inside
    move.forward = move.right = move.up = 0;
    flyEnabled = false;
    // show interior UI while inside
    autopilotBtn.style.display = 'inline-block';
    exitInteriorBtn.style.display = 'inline-block';
    // If autopilot was requested via the pilot popup, enable it now
    if (pendingAutopilotOn) {
      interiorAutoThrust = true;
      autopilotBtn.textContent = 'Autopilot: On';
      autopilotBtn.style.background = 'rgba(0,100,0,0.7)';
      pendingAutopilotOn = false;
    }
  }
});
interiorControls.addEventListener('unlock', ()=> {
  if (lockRequest === 'interior') {
    // If we requested a detach (via the Exit button), perform the full interior exit
    if (interiorDetachRequested) {
      enterBtn.style.display = 'inline-block';
      startBtn.style.display = 'inline-block';
      interiorEnabled = false;
      activeCamera = camera;
      // remove the fp object from the ship to avoid leaving stray objects
      ship.remove(interiorControls.getObject());
      lockRequest = null;
      interiorDetachRequested = false;
      // hide interior UI
      exitInteriorBtn.style.display = 'none';
      autopilotBtn.style.display = 'none';
      interiorAutoThrust = false;
      autopilotBtn.textContent = 'Autopilot: Off';
      autopilotBtn.style.background = 'rgba(0,0,0,0.6)';
    } else {
      // Otherwise (likely ESC), just release the pointer lock and show the cursor
      // but keep interior mode active so you can still walk and the ship keeps moving.
      enterBtn.style.display = 'inline-block';
      startBtn.style.display = 'inline-block';
      // do NOT change `interiorEnabled` or `activeCamera` here; keep fpCamera attached
      // ensure interior UI remains visible so player can re-lock or exit
      exitInteriorBtn.style.display = 'inline-block';
      autopilotBtn.style.display = 'inline-block';
    }
  }
});

// Exit Interior button requests a full detach and triggers unlock
exitInteriorBtn.addEventListener('click', () => {
  if (!interiorEnabled) return;
  interiorDetachRequested = true;
  // trigger pointer lock exit — the unlock handler will perform the detach
  interiorControls.unlock();
});

// Ship model (use your ship.glb at the project root)
const loader = new GLTFLoader();
let shipModel = null;

function applyBuiteVisibility() {
  try {
    const buite = shipModel && shipModel.getObjectByName && shipModel.getObjectByName('buite');
    const visible = interiorConfig && (typeof interiorConfig.showBuiteWire !== 'undefined' ? !!interiorConfig.showBuiteWire : true);
    if (buite) buite.visible = visible;
  } catch (e) { /* ignore */ }
}

// Ship root object (world) and camera pivot for third-person follow
const ship = new THREE.Object3D();
scene.add(ship);
const cameraPivot = new THREE.Object3D();
camera.position.set(0, 2, 10); // default camera offset behind/up
cameraPivot.add(camera);
ship.add(cameraPivot);

// configurable ship transform (editable via ship.config.json at project root)
let shipConfig = { position: [0, 0, 0], scale: 0.6, rotation: [0,0,0] };
// optional interior config loaded from interior.config.json
let interiorConfig = { position: [0,0,0], scale: [1,1,1], debug: false, exit: { enabled: true, width: 2.0, depth: 3.0 } };
let interiorDebugMesh = null;
let interiorBin = null; // live reference to the 'binne' object
let baseInteriorBox = null; // canonical box for 'binne' in ship-local space

function computeInteriorBoxFromBin() {
  // Build `interiorBox` from the fixed `baseInteriorBox` (computed at load)
  if (!baseInteriorBox) return;
  interiorBox = baseInteriorBox.clone();
  // apply optional interior config adjustments (scale + offset)
  const center = interiorBox.getCenter(new THREE.Vector3());
  const size = interiorBox.getSize(new THREE.Vector3());
  const scaleV = new THREE.Vector3(interiorConfig.scale[0] || 1, interiorConfig.scale[1] || 1, interiorConfig.scale[2] || 1);
  size.multiply(scaleV);
  const posOffset = new THREE.Vector3(interiorConfig.position[0] || 0, interiorConfig.position[1] || 0, interiorConfig.position[2] || 0);
  const half = size.clone().multiplyScalar(0.5);
  interiorBox.min.copy(center).sub(half).add(posOffset);
  interiorBox.max.copy(center).add(half).add(posOffset);
}

// Safe pointer-lock requester: checks availability and catches SecurityErrors
let _pointerLockHint = null;
function _ensurePointerLockHint() {
  if (_pointerLockHint) return _pointerLockHint;
  try {
    _pointerLockHint = document.createElement('div');
    _pointerLockHint.id = 'pointerLockHint';
    _pointerLockHint.style.position = 'fixed';
    _pointerLockHint.style.left = '50%';
    _pointerLockHint.style.bottom = '8%';
    _pointerLockHint.style.transform = 'translateX(-50%)';
    _pointerLockHint.style.padding = '8px 12px';
    _pointerLockHint.style.background = 'rgba(0,0,0,0.8)';
    _pointerLockHint.style.color = '#fff';
    _pointerLockHint.style.borderRadius = '6px';
    _pointerLockHint.style.fontFamily = 'sans-serif';
    _pointerLockHint.style.zIndex = 10020;
    _pointerLockHint.style.display = 'none';
    _pointerLockHint.textContent = 'Click the canvas to re-lock the pointer';
    document.body.appendChild(_pointerLockHint);
  } catch (e) { _pointerLockHint = null; }
  return _pointerLockHint;
}

function requestLock(kind) {
  const ctrl = kind === 'interior' ? interiorControls : controls;
  // Quick feature-detect for Pointer Lock API
  const supported = (typeof document.pointerLockElement !== 'undefined') || (typeof document.mozPointerLockElement !== 'undefined') || (typeof document.webkitPointerLockElement !== 'undefined');
  if (!supported) {
    try { const hint = _ensurePointerLockHint(); if (hint) { hint.textContent = 'Pointer Lock API not supported in this browser'; hint.style.display = 'block'; setTimeout(() => { try { hint.style.display = 'none'; } catch (e) {} }, 3000); } } catch (e) {}
    return;
  }
  try {
    lockRequest = kind;
    ctrl.lock();
  } catch (err) {
    // Commonly thrown when trying to re-acquire immediately after exit.
    try { console.warn('Pointer lock request failed', err); } catch (e) {}
    const hint = _ensurePointerLockHint();
    if (hint) {
      hint.textContent = 'Click the canvas to re-lock the pointer';
      hint.style.display = 'block';
      const handler = function(ev) {
        try { document.removeEventListener('click', handler, true); } catch (e) {}
        try {
          if (ev.target === canvas) {
            lockRequest = kind;
            ctrl.lock();
            hint.style.display = 'none';
          }
        } catch (e) {}
      };
      document.addEventListener('click', handler, true);
      // hide after a short while if unused
      setTimeout(() => { try { hint.style.display = 'none'; } catch (e) {} }, 6000);
    }
  }
}

function sphereIntersectsBox(center, radius, box) {
  if (!box) return false;
  const x = Math.max(box.min.x, Math.min(center.x, box.max.x));
  const y = Math.max(box.min.y, Math.min(center.y, box.max.y));
  const z = Math.max(box.min.z, Math.min(center.z, box.max.z));
  const dx = center.x - x;
  const dy = center.y - y;
  const dz = center.z - z;
  return (dx*dx + dy*dy + dz*dz) <= (radius * radius);
}
function applyShipConfig(){
  if (!shipModel) return;
  const p = shipConfig.position || [0,0,0];
  ship.position.set(p[0], p[1], p[2]);
  shipModel.scale.setScalar(shipConfig.scale || 0.6);
  const r = shipConfig.rotation || [0,0,0];
  shipModel.rotation.set(r[0], r[1], r[2]);
}

fetch('ship.config.json')
  .then(r => r.json())
  .then(cfg => { shipConfig = { ...shipConfig, ...cfg }; applyShipConfig(); })
  .catch(() => console.warn('No ship.config.json found — using defaults'));

// load interior config (position/scale/debug)
fetch('interior.config.json')
  .then(r => r.json())
  .then(cfg => { interiorConfig = { ...interiorConfig, ...cfg }; try { applyBuiteVisibility(); } catch(e){} })
  .catch(() => console.warn('No interior.config.json found — using defaults'));

loader.load('ship.glb', gltf => {
  shipModel = gltf.scene;
  // ensure the model faces -Z (forward) and sits at the ship origin
  shipModel.position.set(0,0,0);
  ship.add(shipModel);
  applyShipConfig();
  // Load an auxiliary power box model and attach it as a fixed child of the ship.
  // Place `powerbox.glb` at the project root so the loader can find it.
  try {
    loader.load('powerbox.glb', pgl => {
      try {
        powerbox = pgl.scene;
        powerbox.name = 'powerbox';
        // Attach to the ship model so it moves/rotates with the ship (fixed relative to ship)
        shipModel.add(powerbox);
        // mark as fixed for downstream logic
        powerbox.userData.fixed = true;
        // if the powerbox GLB contains animations, create a mixer for it
        if (pgl.animations && pgl.animations.length > 0) {
          try {
            powerboxMixer = new THREE.AnimationMixer(powerbox);
            powerboxClips = pgl.animations.slice();
            try {
              powerboxMixer.addEventListener('finished', (ev) => {
                const clip = ev.action && ev.action.getClip ? ev.action.getClip() : null;
                if (!clip) return;
                if (powerboxClips && powerboxClips.some(c => c === clip) && powerboxInteracting) {
                  // Clear any existing finish timer and set a new one so the repair
                  // happens 3 seconds after the last finished animation frame.
                  try { if (powerboxFinishTimer) { clearTimeout(powerboxFinishTimer); powerboxFinishTimer = null; } } catch (e) {}
                  powerboxFinishTimer = setTimeout(() => {
                    try { shipSystems.repair('circuits', 100); } catch (e) { console.warn('Repair failed', e); }
                    powerboxInteracting = false;
                    powerboxActions = [];
                    try { _startFlicker(false, 1400); _flickerTimers.push(setTimeout(() => { sceneIsDark = false; }, 1400)); } catch (e) {}
                    try { interactHint.textContent = 'Power restored'; setTimeout(() => { try { interactHint.style.display = 'none'; } catch(e){} }, 1200); } catch (e) {}
                    try { if (audioSystem) audioSystem.playOnce('powerup'); } catch (e) {}
                    powerboxFinishTimer = null;
                  }, 3000);
                }
              });
            } catch (e) { /* ignore event binding errors */ }
          } catch (e) { console.warn('Failed to create powerbox mixer', e); }
        }
        // Optionally position/scale the box here if needed (defaults to model origin)
        // powerbox.position.set(0.5, 0.2, -1.0);
      } catch (err) { console.warn('Failed to attach powerbox', err); }
    }, undefined, err => { console.warn('Failed to load powerbox.glb', err); });
  } catch (e) { console.warn('Powerbox load error', e); }
  // Also try to load an optional EXIT model and attach it to the ship
  try {
    loader.load('EXIT.glb', exgl => {
        try {
          exitDoor = exgl.scene;
          exitDoor.name = 'EXIT';
          // Attach to the ship model so it moves/rotates with the ship
          shipModel.add(exitDoor);
          exitDoor.userData.fixed = true;
          // If the EXIT GLB contains animations, expose them as interaction clips
          if (exgl.animations && exgl.animations.length > 0) {
            exitDoor.userData.interactionClips = exgl.animations.slice();
            exitDoor.userData.clips = exgl.animations.slice();
            // If a global mixer already exists, ensure clips will be playable via it
            try {
              if (mixer) {
                for (const clip of exgl.animations) {
                  try { mixer.clipAction(clip, exitDoor); } catch (e) {}
                }
              }
            } catch (e) { console.warn('Failed to register EXIT clips with mixer', e); }
          }
          // Compute a ship-local bounding box for automatic proximity checks
          try {
            const worldBox = new THREE.Box3();
            exitDoor.updateMatrixWorld(true);
            exitDoor.traverse(child => {
              if (child.isMesh && child.geometry) {
                const geom = child.geometry;
                if (!geom.boundingBox) geom.computeBoundingBox();
                const gbox = geom.boundingBox.clone();
                child.updateMatrixWorld(true);
                gbox.applyMatrix4(child.matrixWorld);
                worldBox.union(gbox);
              }
            });
            if (worldBox.isEmpty()) {
              const pos = new THREE.Vector3(); exitDoor.getWorldPosition(pos);
              worldBox.min.copy(pos).subScalar(0.5);
              worldBox.max.copy(pos).addScalar(0.5);
            }
            const invShip = new THREE.Matrix4().copy(ship.matrixWorld).invert();
            exitDoor.userData.localBox = worldBox.clone().applyMatrix4(invShip);
            exitDoor.userData.collidable = true;
            exitDoor.userData.frozenOnLast = false;
            exitDoor.userData.playing = false;
          } catch (e) { console.warn('Failed to compute EXIT bounds', e); }
      } catch (err) { console.warn('Failed to attach EXIT', err); }
    }, undefined, err => { console.warn('Failed to load EXIT.glb', err); });
  } catch (e) { console.warn('EXIT load error', e); }
  // Load optional 'buite' model but render it as wireframe only
  try {
    loader.load('buite.glb', bgl => {
      try {
        const buite = bgl.scene;
        buite.name = 'buite';
        // Replace each mesh material with a simple wireframe material
        buite.traverse(child => {
          if (child.isMesh) {
            try {
              const baseColor = (child.material && child.material.color && child.material.color.getHex) ? child.material.color.getHex() : 0xffffff;
              child.material = new THREE.MeshBasicMaterial({ color: baseColor, wireframe: true });
            } catch (e) {
              child.material = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true });
            }
            child.material.needsUpdate = true;
          }
        });
        // Attach as a child so it moves with the ship
        shipModel.add(buite);
        buite.userData.wireframe = true;
        // Compute ship-local collision boxes for each mesh in the buite model
        try {
          const invShip = new THREE.Matrix4().copy(ship.matrixWorld).invert();
          const boxes = [];
          buite.updateMatrixWorld(true);
          buite.traverse(child => {
            if (child.isMesh && child.geometry) {
              const geom = child.geometry;
              if (!geom.boundingBox) geom.computeBoundingBox();
              const gbox = geom.boundingBox.clone();
              child.updateMatrixWorld(true);
              gbox.applyMatrix4(child.matrixWorld);
              // transform to ship-local
              const localBox = gbox.clone().applyMatrix4(invShip);
              boxes.push(localBox);
            }
          });
          if (boxes.length === 0) {
            const pos = new THREE.Vector3(); buite.getWorldPosition(pos);
            const b = new THREE.Box3().setFromCenterAndSize(pos, new THREE.Vector3(1,1,1));
            boxes.push(b.applyMatrix4(invShip));
          }
          buite.userData.collisionBoxes = boxes;
          buite.userData.collidable = true;
          try { applyBuiteVisibility(); } catch (e) {}
        } catch (e) { console.warn('Failed to compute buite collision boxes', e); }
      } catch (err) { console.warn('Failed to attach buite', err); }
    }, undefined, err => { console.warn('Failed to load buite.glb', err); });
  } catch (e) { console.warn('buite load error', e); }
    // expose pilot object if present
  pilot = shipModel.getObjectByName('pilot');
  // also try to find an `EXIT` child if it was embedded inside ship.glb
  if (!exitDoor) exitDoor = shipModel.getObjectByName('EXIT');
  // Compute a fixed collision box for the `binne` node in ship-local space.
  // This uses the raw geometry bounds (plus mesh local transforms) and a
  // one-time transform into the ship-local frame so subsequent flight
  // rotations/animations won't change the canonical collision box.
  const bin = shipModel.getObjectByName('binne');
  if (bin) {
    // compute bounding box in `bin` local space by unioning child geometries
    const binLocalBox = new THREE.Box3();
    bin.traverse(child => {
      if (child.isMesh && child.geometry) {
        const geom = child.geometry;
        if (!geom.boundingBox) geom.computeBoundingBox();
        const gbox = geom.boundingBox.clone();
        // apply mesh's local matrix (relative to `bin`) to place geometry inside bin-local
        gbox.applyMatrix4(child.matrix);
        binLocalBox.union(gbox);
      }
    });
    // transform that box into ship-local space using the bin->ship matrix
    ship.updateMatrixWorld(true);
    bin.updateMatrixWorld(true);
    const invShip = new THREE.Matrix4().copy(ship.matrixWorld).invert();
    const binToShip = new THREE.Matrix4().multiplyMatrices(invShip, bin.matrixWorld);
    baseInteriorBox = binLocalBox.clone().applyMatrix4(binToShip);
  }
  // Hide the visual geometry of the interior 'binne' while keeping its meshes
  // in the scene so they still contribute to bounding-box / collision calculations.
  if (bin) {
    bin.traverse(child => {
      if (child.isMesh) {
        // clone material(s) so we don't accidentally mutate shared materials
        if (Array.isArray(child.material)) {
          child.material = child.material.map(mat => {
            const m = mat.clone();
            m.transparent = true;
            m.opacity = 0;
            m.depthWrite = false;
            return m;
          });
        } else if (child.material) {
          const m = child.material.clone();
          m.transparent = true;
          m.opacity = 0;
          m.depthWrite = false;
          child.material = m;
        }
        if (child.material) child.material.needsUpdate = true;
      }
    });
  }
  // Setup animations / interaction targets for cabL / cabR
  if (gltf.animations && gltf.animations.length > 0) {
    mixer = new THREE.AnimationMixer(shipModel);
    ensureMixerHandler();
    const clips = gltf.animations;
    cabL = shipModel.getObjectByName('cabL');
    cabR = shipModel.getObjectByName('cabR');
    [cabL, cabR].forEach(obj => {
      if (!obj) return;
      obj.userData.interactionClips = [];
      for (const clip of clips) {
        const usesObj = clip.tracks && clip.tracks.some(t => t.name.indexOf(obj.name) !== -1);
        const nameMatch = clip.name && clip.name.toLowerCase().indexOf(obj.name.toLowerCase()) !== -1;
        if (usesObj || nameMatch) obj.userData.interactionClips.push(clip);
      }
    });
    // compute simple ship-local bounding boxes for cabL / cabR to allow collision checks
    [cabL, cabR].forEach(obj => {
      if (!obj) return;
      const worldBox = new THREE.Box3();
      // ensure matrices are up to date
      ship.updateMatrixWorld(true);
      obj.updateMatrixWorld(true);
      obj.traverse(child => {
        if (child.isMesh && child.geometry) {
          const geom = child.geometry;
          if (!geom.boundingBox) geom.computeBoundingBox();
          const gbox = geom.boundingBox.clone();
          // apply mesh world transform so box is in world space
          child.updateMatrixWorld(true);
          gbox.applyMatrix4(child.matrixWorld);
          worldBox.union(gbox);
        }
      });
      // if traversal found nothing, make a tiny box around the object's world position
      if (worldBox.isEmpty()) {
        const pos = new THREE.Vector3(); obj.getWorldPosition(pos);
        worldBox.min.copy(pos).subScalar(0.5);
        worldBox.max.copy(pos).addScalar(0.5);
      }
      // transform that world box into ship-local space
      const invShip = new THREE.Matrix4().copy(ship.matrixWorld).invert();
      obj.userData.localBox = worldBox.clone().applyMatrix4(invShip);
      // initialize collision/state flags
      obj.userData.collidable = true;
      obj.userData.frozenOnLast = false; // true when frozen on last frame after forward play
      obj.userData.playing = false; // true when currently playing any interaction
    });
  }
}, undefined, err => console.warn('Failed to load ship.glb — put it at the project root', err));

// Near starfield only: many small stars wrapped around the camera to appear infinite
const NEAR_STAR_COUNT = 1200;
const NEAR_STAR_RADIUS = 600;
const MIN_NEAR_STAR_DISTANCE = 30; // avoid stars that are too close and look huge
const nearGeo = new THREE.BufferGeometry();
const nearPos = new Float32Array(NEAR_STAR_COUNT * 3);
function randPointInSphere(maxR, minR = 0){
  const u = Math.random();
  const v = Math.random();
  const theta = 2*Math.PI*u;
  const phi = Math.acos(2*v-1);
  const r = minR + (maxR - minR) * Math.cbrt(Math.random());
  return [r*Math.sin(phi)*Math.cos(theta), r*Math.sin(phi)*Math.sin(theta), r*Math.cos(phi)];
}
for (let i=0;i<NEAR_STAR_COUNT;i++){
  const p = randPointInSphere(NEAR_STAR_RADIUS, MIN_NEAR_STAR_DISTANCE);
  nearPos[i*3]=p[0]; nearPos[i*3+1]=p[1]; nearPos[i*3+2]=p[2];
}
nearGeo.setAttribute('position', new THREE.BufferAttribute(nearPos,3));
// Use a smaller constant screen-space size and prevent attenuation
// so stars don't blow up when very close to the camera.
const nearMat = new THREE.PointsMaterial({ color:0xffffff, size:0.6, sizeAttenuation: false, opacity:0.95, transparent:true });
const nearStars = new THREE.Points(nearGeo, nearMat);
nearStars.frustumCulled = false;
scene.add(nearStars);

// We will shift star local positions by a small amount opposite the ship velocity
// so they appear to move past the camera while always staying within the sphere.
const parallaxOffset = new THREE.Vector3();
const _replaceRadiusSq = (NEAR_STAR_RADIUS * 1.25) * (NEAR_STAR_RADIUS * 1.25);
let _frameCounter = 0;

// (Asteroids removed — starfield now provides distant visuals only)

// Movement state (third-person ship-like flight)
const move = { forward:0, right:0, up:0 };
document.addEventListener('keydown', e => {
  // If stats modal is open, only allow Escape to close it and ignore other input
  if (statsOverlay && statsOverlay.style.display === 'block') {
    if (e.code === 'Escape') { if (window.__closeShipStatsModal) window.__closeShipStatsModal(); }
    return;
  }
  if (!(flyEnabled || interiorEnabled)) return;
  // Handle quick E actions: enter interior when flying, or interact when inside
  if (e.code === 'KeyE') {
    // If we're looking at the pilot, open the pilot options popup
      if (interactTarget && interactTarget.name === 'pilot') {
      if (powerOut || pilotDisabled) {
        try { interactHint.textContent = 'Pilot disabled: no power'; interactHint.style.display = 'block'; setTimeout(() => { try { interactHint.style.display = 'none'; } catch(e){} }, 1400); } catch (e) {}
        return;
      }
      openPilotPopup();
      return;
    }
    if (flyEnabled && !interiorEnabled) {
      enterBtn.click();
      return;
    }
    if (interiorEnabled) {
      // If we're looking at the powerbox, trigger its repair animation(s)
      if (interactTarget && interactTarget.name === 'powerbox') {
        const systems = shipSystems.getAll();
        const circVal = systems && systems.circuits ? systems.circuits.value : 100;
        if (circVal >= 50) {
          try { interactHint.textContent = 'Power stable — no repair needed'; interactHint.style.display = 'block'; } catch (e) {}
          return;
        }
        // If the powerbox GLB has no animations, perform an immediate repair.
        if (!powerbox || !powerboxMixer || !powerboxClips || powerboxClips.length === 0) {
          try {
            shipSystems.repair('circuits', 100);
            _startFlicker(false, 1400);
            _flickerTimers.push(setTimeout(() => { sceneIsDark = false; }, 1400));
            interactHint.textContent = 'Power restored';
            setTimeout(() => { try { interactHint.style.display = 'none'; } catch (e) {} }, 1200);
            try { if (audioSystem) audioSystem.playOnce('powerup'); } catch (e) {}
          } catch (e) { console.warn('Instant power restore failed', e); }
          return;
        }
        // Start the powerbox animations at their natural speed and wait for them to finish.
        if (!powerboxInteracting) {
          powerboxActions = [];
          for (const clip of powerboxClips) {
            try {
              const action = powerboxMixer.clipAction(clip);
              action.reset();
              action.setLoop(THREE.LoopOnce, 0);
              action.clampWhenFinished = true;
              action.timeScale = 1; // play at natural clip speed
              action.play();
              powerboxActions.push(action);
            } catch (err) { console.warn('Powerbox action failed', err); }
          }
          powerboxInteracting = true;
          interactHint.textContent = 'Repairing power...';
          interactHint.style.display = 'block';
        }
        return;
      }
      if (interactTarget) playInteraction(interactTarget);
      return;
    }
  }
  if (e.code==='KeyW') move.forward = 1;
  if (e.code==='KeyS') move.forward = -1;
  // Only allow strafing with A/D while inside (interior walking).
  // Remove A/D as flight controls so they do nothing during third-person flying.
  if (e.code==='KeyA' && interiorEnabled) move.right = -1;
  if (e.code==='KeyD' && interiorEnabled) move.right = 1;
  if (e.code==='Space') move.up = 1;
  if (e.code==='ShiftLeft' || e.code==='ShiftRight') move.up = -1;
});
document.addEventListener('keyup', e => {
  if (statsOverlay && statsOverlay.style.display === 'block') return;
  if (!(flyEnabled || interiorEnabled)) return;
  if (e.code === 'KeyE') {
    // releasing E no longer cancels a started powerbox animation
  }
  if (e.code==='KeyW' || e.code==='KeyS') move.forward = 0;
  if (e.code==='KeyA' || e.code==='KeyD') move.right = 0;
  if (e.code==='Space' || e.code==='ShiftLeft' || e.code==='ShiftRight') move.up = 0;
});

// Interior float (zero-gravity) state when player leaves the interior box
let interiorFloat = false;
let interiorFloatVelocity = new THREE.Vector3();
const FLOAT_ACCEL = 6.0; // m/s^2 for zero-g control
const FLOAT_DRAG = 0.6; // damping per second
// Oxygen system for outside the ship
let oxygenLevel = 100.0; // percent
const OXYGEN_DRAIN_RATE = 0.6; // percent per second while outside

// Flight parameters
// tuned to make flying *feel* faster: higher accel/speed, stronger parallax and FOV kick
const ACCEL = 360; // units/s^2 (was 160)
const MAX_SPEED = 1600; // top speed (was 650)
const DRAG = 0.6; // lower = longer coast (was 0.9)
const ROTATION_SPEED = 0.0028; // mouse sensitivity
const ROTATION_DAMPING = 6.0; // higher = tighter tracking
const BANK_AMOUNT = 0.9; // roll when turning

// runtime state
const velocity = new THREE.Vector3();
let targetYaw = 0, targetPitch = 0;
let yaw = 0, pitch = 0;
let lastMouse = { x:0, y:0 };

// capture raw mouse movement while pointer locked
// mouse movement for flight (interior pointerlock rotates the fp camera internally)
document.addEventListener('mousemove', (e) => {
  // only control ship orientation when pointerlock belongs to the flight controls
  if (!controls.isLocked || !flyEnabled) return;
  targetYaw -= e.movementX * ROTATION_SPEED;
  targetPitch -= e.movementY * ROTATION_SPEED;
  // clamp pitch to prevent flipping
  targetPitch = Math.max(-Math.PI/3, Math.min(Math.PI/3, targetPitch));
});

// Resize
window.addEventListener('resize', ()=>{
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  fpCamera.aspect = window.innerWidth / window.innerHeight;
  fpCamera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function playInteraction(target) {
  if (!mixer) return;
  // If a specific target is provided, only play its clips; otherwise play both cab doors
  const targets = target ? [target] : [cabL, cabR].filter(Boolean);
  // If the EXIT door is being interacted with, disable autopilot immediately
  try {
    if (targets.includes(exitDoor) && interiorAutoThrust) {
      interiorAutoThrust = false;
      autopilotBtn.textContent = 'Autopilot: Off';
      autopilotBtn.style.background = 'rgba(0,0,0,0.6)';
    }
  } catch (e) {}
  const clips = [];
  const seen = new Set();
  for (const t of targets) {
    const list = t.userData && t.userData.interactionClips ? t.userData.interactionClips : [];
    for (const c of list) {
      if (!c || seen.has(c.uuid)) continue;
      seen.add(c.uuid);
      clips.push({ clip: c, owner: t });
    }
  }
  if (clips.length === 0) return;
  const owners = new Set();
  for (const item of clips) {
    try {
      const action = mixer.clipAction(item.clip, item.owner);
      action.reset();
      action.setLoop(THREE.LoopOnce, 0);
      action.clampWhenFinished = true;
      action.timeScale = 1;
      action.play();
      owners.add(item.owner);
    } catch (err) {
      console.warn('Failed to play interaction clip', err);
    }
  }
  try {
    if (audioSystem) {
      const outsideFlag = !!(oxygenUI && oxygenUI.style && oxygenUI.style.display === 'block');
      const isExit = owners.has(exitDoor);
      audioSystem.playOnce('door', { muffled: Boolean(isExit && outsideFlag) });
    }
  } catch (e) {}
  owners.forEach(o => { try { o.userData.playing = true; } catch (e) {} });
}

function playReverseBoth() {
  if (!mixer) return;
  const targets = [cabL, cabR].filter(Boolean);
  const clips = [];
  const seen = new Set();
  for (const t of targets) {
    const list = t.userData && t.userData.interactionClips ? t.userData.interactionClips : [];
    for (const c of list) {
      if (!c || seen.has(c.uuid)) continue;
      seen.add(c.uuid);
      clips.push({ clip: c, owner: t });
    }
    t.userData.playing = true;
  }
  if (clips.length === 0) return;
  for (const item of clips) {
    try {
      const action = mixer.clipAction(item.clip, item.owner);
      action.reset();
      action.setLoop(THREE.LoopOnce, 0);
      action.clampWhenFinished = true;
      action.time = item.clip.duration;
      action.timeScale = -1;
      action.play();
    } catch (err) {
      console.warn('Failed to play reverse clip', err);
    }
  }
  try {
    if (audioSystem) {
      const outsideFlag = !!(oxygenUI && oxygenUI.style && oxygenUI.style.display === 'block');
      // reverse both typically for cabL/cabR so not exit, but keep check
      const isExit = false;
      audioSystem.playOnce('door', { muffled: Boolean(isExit && outsideFlag) });
    }
  } catch (e) {}
}

function playReverseTarget(target) {
  if (!mixer || !target) return;
  const list = target.userData && target.userData.interactionClips ? target.userData.interactionClips : [];
  if (!list || list.length === 0) return;
  target.userData.playing = true;
  for (const clip of list) {
    try {
      const action = mixer.clipAction(clip, target);
      action.reset();
      action.setLoop(THREE.LoopOnce, 0);
      action.clampWhenFinished = true;
      action.time = clip.duration;
      action.timeScale = -1;
      action.play();
    } catch (err) { console.warn('Failed to play reverse clip for target', err); }
  }
  try {
    if (audioSystem) {
      const outsideFlag = !!(oxygenUI && oxygenUI.style && oxygenUI.style.display === 'block');
      const isExit = (target === exitDoor);
      audioSystem.playOnce('door', { muffled: Boolean(isExit && outsideFlag) });
    }
  } catch (e) {}
}

// Mixer finished handler: update per-cab flags and collisions
function ensureMixerHandler() {
  if (!mixer || mixer._hasHandler) return;
  mixer._hasHandler = true;
  mixer.addEventListener('finished', (e) => {
    const clip = e.action.getClip();
    // determine whether this was playing forward (timeScale>0) or reverse
    const wasForward = (e.action.timeScale > 0);
    // for each cab, if this clip belonged to it, update its state
    [cabL, cabR, exitDoor].filter(Boolean).forEach(c => {
      const list = c.userData && c.userData.interactionClips ? c.userData.interactionClips : [];
      if (list.some(l => l === clip)) {
        c.userData.playing = false;
        if (wasForward) {
          // froze on last frame: disable collision
          c.userData.frozenOnLast = true;
          c.userData.collidable = false;
          // If the EXIT door finished opening while autopilot was active,
          // ensure autopilot is fully disabled until the player re-enables it.
          try {
            if (c === exitDoor) {
              interiorAutoThrust = false;
              autopilotBtn.textContent = 'Autopilot: Off';
              autopilotBtn.style.background = 'rgba(0,0,0,0.6)';
            }
          } catch (e) {}
        } else {
          // reverse finished -> back at start frame: re-enable collision
          c.userData.frozenOnLast = false;
          c.userData.collidable = true;
          // ensure the action is at time 0 and stopped
          try { e.action.paused = true; e.action.time = 0; } catch (err) {}
        }
      }
    });
  });
}


// Listen for mixer finished events to update cab states and collisions
if (!mixer) {
  // mixer is created during load; attach handler after load below when available
}

// Clicking the canvas should re-lock the pointer when interior/fly mode is active
document.addEventListener('click', (e) => {
  // only lock when clicking the 3D canvas (avoid stealing clicks from UI buttons)
  if (e.target !== canvas) return;
  if (interiorEnabled && !interiorControls.isLocked) {
    requestLock('interior');
  } else if (flyEnabled && !controls.isLocked) {
    requestLock('fly');
  }
});

// Allow toggling flashlight with `F` when player has one
document.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyF') return;
  // if the player doesn't have a flashlight in inventory, ignore
  if (!inventory['flashlight'] || inventory['flashlight'].count <= 0) return;
  flashlightOn = !flashlightOn;
});

// (Free camera input removed)

let last = performance.now();
function animate(){
  const now = performance.now();
  const dt = Math.min(0.05, (now - last)/1000);
  last = now;
  // advance any animation mixers
  if (mixer) mixer.update(dt);
  if (powerboxMixer) powerboxMixer.update(dt);
  // update audio state based on oxygen UI visibility (outside when oxygen UI shown)
  try {
    const outsideFlag = !!(oxygenUI && oxygenUI.style && oxygenUI.style.display === 'block');
    if (audioSystem && audioSystem._inited) audioSystem.setOutside(outsideFlag);
  } catch (e) {}
  // Smoothly approach target orientation (yaw/pitch kept even when not flying)
  yaw += (targetYaw - yaw) * Math.min(1, ROTATION_DAMPING * dt);
  pitch += (targetPitch - pitch) * Math.min(1, ROTATION_DAMPING * dt);

  // Compose ship orientation from smoothed yaw/pitch (available for camera/look and movement)
  const shipEuler = new THREE.Euler(pitch, yaw, 0, 'YXZ');
  const shipQuat = new THREE.Quaternion().setFromEuler(shipEuler);

  // Forward/right/up in ship local space
  const forwardVec = new THREE.Vector3(0,0,-1).applyQuaternion(shipQuat);
  const rightVec = new THREE.Vector3(1,0,0).applyQuaternion(shipQuat);
  const upVec = new THREE.Vector3(0,1,0).applyQuaternion(shipQuat);

  // Compute thrust only when actively flying (not when inside). However, always
  // apply drag and move the ship so it continues coasting while interior is active.
  const accelVec = new THREE.Vector3();
  // When power is out, block all thrust and zero velocity
  if (!powerOut) {
    if (flyEnabled && !interiorEnabled) {
      // Thrust/strafe from player controls when flying
      accelVec.addScaledVector(forwardVec, move.forward * ACCEL);
      accelVec.addScaledVector(rightVec, move.right * ACCEL * 0.6);
      accelVec.addScaledVector(upVec, move.up * ACCEL * 0.6);
    }
    // If autopilot is enabled while inside, add a continuous forward thrust
    const AUTO_THRUST = 320; // continuous thrust while interior autopilot is enabled
    if (interiorEnabled && interiorAutoThrust) {
      accelVec.addScaledVector(forwardVec, AUTO_THRUST);
    }
  } else {
    try { velocity.set(0,0,0); } catch (e) {}
  }

  // integrate velocity from any acceleration (or none) and always apply drag
  velocity.addScaledVector(accelVec, dt);
  const dragFactor = Math.max(0, 1 - DRAG * dt);
  velocity.multiplyScalar(dragFactor);
  // clamp speed
  if (velocity.lengthSq() > (MAX_SPEED*MAX_SPEED)) velocity.setLength(MAX_SPEED);

  // Always move the ship by its current velocity so the world moves while inside
  ship.position.addScaledVector(velocity, dt);

  // update near-star positions so they appear to move past the camera.
  // Parallax is scaled with ship speed to amplify perceived velocity when looking at stars.
  const speedFrac = Math.min(1, velocity.length() / MAX_SPEED);
  const parallaxScale = 0.12 + speedFrac * 1.4; // base + stronger scale with speed
  const shift = velocity.clone().multiplyScalar(-parallaxScale * dt);
  const _camWorldPos = new THREE.Vector3();
  activeCamera.getWorldPosition(_camWorldPos);
  nearStars.position.copy(_camWorldPos);

  // stronger FOV kick when moving fast to increase sense of speed (applies to main camera)
  const fovValue = BASE_FOV + speedFrac * 18;
  camera.fov = fovValue;
  camera.updateProjectionMatrix();

  // GPS tracking: update HUD and check if we've reached the freighter goal
  if (gpsTracking && freighterGoal && freighterGoal.position) {
    try {
      const dist = ship.position.distanceTo(freighterGoal.position);
      if (gpsHud) gpsHud.textContent = `GPS: ${Math.round(dist)}m`;
      if (dist <= FREIGHTER_REACH_DISTANCE) {
        // Player reached the freighter: remove target, open shop, allow next GPS
        try { enableGPS(false); } catch (e) {}
        try { scene.remove(freighterGoal); } catch (e) {}
        freighterGoal = null;
        try {
          freighterShopBtn.style.display = 'inline-block';
          openShop();
        } catch (e) {}
        if (gpsButton) { gpsButton.disabled = false; gpsButton.textContent = 'Set GPS Target'; }
      }
    } catch (e) { /* ignore GPS errors */ }
  }

  // Recycle stars that drift too far from the camera to create an "infinite" field.
  _frameCounter++;
  if ((_frameCounter & 3) === 0) { // every 4th frame: update positions in bulk
    const attr = nearGeo.getAttribute('position');
    for (let i = 0; i < attr.count; i++) {
      let lx = attr.getX(i) + shift.x;
      let ly = attr.getY(i) + shift.y;
      let lz = attr.getZ(i) + shift.z;
      const d2 = lx*lx + ly*ly + lz*lz;
      if (d2 > _replaceRadiusSq) {
        const p = randPointInSphere(NEAR_STAR_RADIUS, MIN_NEAR_STAR_DISTANCE);
        lx = p[0]; ly = p[1]; lz = p[2];
      }
      attr.setXYZ(i, lx, ly, lz);
    }
    attr.needsUpdate = true;
  }

  // smoothly rotate ship to face movement/orientation
  ship.quaternion.slerp(shipQuat, Math.min(1, ROTATION_DAMPING * dt));

  // banking/roll: based on lateral velocity and yaw rate
  const localVel = velocity.clone().applyQuaternion(ship.quaternion.clone().invert());
  const bank = THREE.MathUtils.clamp(-localVel.x / 60, -1, 1) * BANK_AMOUNT;
  if (shipModel) {
    shipModel.rotation.z += (bank - shipModel.rotation.z) * Math.min(1, 6 * dt);
  }

  // smooth camera follow: desired pivot is behind the ship in ship space
  const desiredCamPos = new THREE.Vector3(0, 2, 10);
  cameraPivot.position.lerp(desiredCamPos, Math.min(1, 6 * dt));
  // point camera further toward ship forward to emphasize motion
  const lookAtPos = ship.position.clone().add(forwardVec.clone().multiplyScalar(30));
  camera.lookAt(lookAtPos);

  // Choose active camera: prefer interior FP when inside, otherwise use main camera.
  if (interiorEnabled) {
    activeCamera = fpCamera;
  } else {
    activeCamera = camera;
  }

  // interior walking movement (simple collision against the computed binn
  if (interiorEnabled && interiorBox) {
    // ensure interiorBox is derived from the fixed base box (applies any config)
    if (baseInteriorBox) computeInteriorBoxFromBin();
    // make sure ship/world matrices are up-to-date so collision boxes
    // and raycasts operate on current transforms while autopilot moves the ship
    ship.updateMatrixWorld(true);
    const obj = interiorControls.getObject();
    const walkSpeed = 3.0; // meters per second inside
    // Compute movement vectors in ship-local space. Convert the FP camera's
    // world forward into the ship-local frame so adding to the FP object's
    // local position produces the expected walk direction regardless of
    // ship rotation/banking caused while flying.
    const forwardWorld = new THREE.Vector3();
    fpCamera.getWorldDirection(forwardWorld);
    const shipQuatInv = ship.quaternion.clone().invert();
    const forwardLocal = forwardWorld.clone().applyQuaternion(shipQuatInv);
    forwardLocal.y = 0;
    if (forwardLocal.lengthSq() === 0) forwardLocal.set(0,0,-1);
    forwardLocal.normalize();
    const rightLocal = new THREE.Vector3().crossVectors(forwardLocal, new THREE.Vector3(0,1,0)).normalize();
    const upLocal = new THREE.Vector3(0,1,0);

    // Refresh interiorBox from base if available
    const min = interiorBox.min.clone();
    const max = interiorBox.max.clone();
    min.y += 0.1; max.y -= 0.1;

    // Detect whether player is inside the canonical interior box
    const wasFloat = interiorFloat;
    const nowInside = interiorBox.containsPoint(obj.position);
    if (!nowInside) {
      if (!interiorFloat) {
        interiorFloat = true;
        interiorFloatVelocity.set(0,0,0);
      }
    } else {
      if (interiorFloat) {
        interiorFloat = false;
        interiorFloatVelocity.set(0,0,0);
      }
    }

    if (!interiorFloat) {
      // walking mode (original behavior)
      const moveVec = new THREE.Vector3();
      moveVec.addScaledVector(forwardLocal, move.forward);
      moveVec.addScaledVector(rightLocal, move.right);
      moveVec.addScaledVector(upLocal, move.up * 0.8);
      if (moveVec.lengthSq() > 0) {
        moveVec.normalize();
        const proposed = obj.position.clone().addScaledVector(moveVec, walkSpeed * dt);
        // simple collision test against cab boxes: if moving would intersect, cancel movement
        let blocked = false;
        const checks = [cabL, cabR, exitDoor].filter(Boolean);
        for (const c of checks) {
          if (c.userData && c.userData.collidable === false) continue;
          const b = c.userData && c.userData.localBox ? c.userData.localBox : null;
          if (b && sphereIntersectsBox(proposed, PLAYER_RADIUS, b)) { blocked = true; break; }
        }
        if (!blocked) {
          // Allow rear exit slice beyond the back face up to configured depth
          let finalPos = proposed.clone();
          try {
            const exitCfg = interiorConfig && interiorConfig.exit ? interiorConfig.exit : null;
            if (exitCfg && exitCfg.enabled) {
              const centerX = (min.x + max.x) * 0.5;
              const halfW = (exitCfg.width || 1.0) * 0.5;
              const yMin = min.y;
              const yMax = max.y;
              const nearBack = proposed.z > (max.z - 0.2);
              const withinX = (proposed.x >= (centerX - halfW) && proposed.x <= (centerX + halfW));
              const withinY = (proposed.y >= yMin && proposed.y <= yMax);
              if (nearBack && withinX && withinY) {
                const maxAllowedZ = max.z + (exitCfg.depth || 2.0);
                finalPos.z = Math.min(proposed.z, maxAllowedZ);
                finalPos.x = Math.max(min.x, Math.min(max.x, finalPos.x));
                finalPos.y = Math.max(yMin, Math.min(yMax, finalPos.y));
              } else {
                finalPos.clamp(min, max);
              }
            } else {
              finalPos.clamp(min, max);
            }
          } catch (e) { finalPos.clamp(min, max); }
          obj.position.copy(finalPos);
        }
      }
    } else {
      // Zero-gravity floating mode: apply simple thruster-style controls with inertia
      const accel = new THREE.Vector3();
      accel.addScaledVector(forwardLocal, move.forward * FLOAT_ACCEL);
      accel.addScaledVector(rightLocal, move.right * FLOAT_ACCEL);
      accel.addScaledVector(upLocal, move.up * FLOAT_ACCEL);
      // Integrate velocity
      interiorFloatVelocity.addScaledVector(accel, dt);
      // apply damping
      interiorFloatVelocity.multiplyScalar(Math.max(0, 1 - FLOAT_DRAG * dt));
      // propose new position
      const proposed = obj.position.clone().addScaledVector(interiorFloatVelocity, dt);
      let collided = false;
      try {
        // only check buite collisions when buite is present and collidable
        const buiteObj = shipModel.getObjectByName('buite');
        if (buiteObj && buiteObj.userData && buiteObj.userData.collisionBoxes && buiteObj.userData.collidable) {
          for (const b of buiteObj.userData.collisionBoxes) {
            if (sphereIntersectsBox(proposed, PLAYER_RADIUS, b)) { collided = true; break; }
          }
        }
      } catch (e) { /* ignore collision test errors */ }
      if (!collided) {
        obj.position.copy(proposed);
      } else {
        // simple collision response: stop velocity when hitting buite
        interiorFloatVelocity.set(0,0,0);
      }
      // If we've returned inside the canonical interior box, snap back to walking mode
      if (interiorBox.containsPoint(obj.position)) {
        interiorFloat = false;
        // clamp inside
        obj.position.clamp(min, max);
        interiorFloatVelocity.set(0,0,0);
      }
    }
    // ensure fpCamera matches any FOV change if desired
    fpCamera.fov = BASE_FOV; fpCamera.updateProjectionMatrix();
  }

  // Interaction raycast (center of FP camera). Detect cabs when inside and the pilot always when present.
  // Automatic door open/close: when walking up to cabL/cabR open automatically,
  // and when walking away close them. Uses ship-local boxes computed at load.
  if (interiorEnabled) {
    try {
      const fpObj = interiorControls.getObject();
      const playerLocalPos = fpObj.position.clone();
      // if any interactive object is within open distance, trigger open for that object
      const checks = [cabL, cabR, exitDoor].filter(Boolean);
      const nearTargets = [];
      for (const c of checks) {
        const b = c.userData && c.userData.localBox ? c.userData.localBox : null;
        if (!b) continue;
        if (sphereIntersectsBox(playerLocalPos, DOOR_AUTO_OPEN_DIST, b)) {
          nearTargets.push(c);
        }
      }
      if (nearTargets.length > 0) {
        // If the EXIT is among the near targets, open only the EXIT; otherwise open the cab doors
        const exitNear = nearTargets.includes(exitDoor);
        if (exitNear) {
          if (exitDoor.userData && !exitDoor.userData.frozenOnLast && !exitDoor.userData.playing) playInteraction(exitDoor);
        } else {
          const cabChecks = [cabL, cabR].filter(Boolean);
          const needsOpen = cabChecks.some(c => c.userData && !c.userData.frozenOnLast && !c.userData.playing);
          if (needsOpen) playInteraction(null);
        }
      } else {
        // No targets near: handle closing separately for cabs and EXIT (hysteresis)
        const cabChecks = [cabL, cabR].filter(Boolean);
        const anyCabOpen = cabChecks.some(c => c.userData && c.userData.frozenOnLast && !c.userData.playing);
        if (anyCabOpen) {
          let allFar = true;
          for (const c of cabChecks) {
            const b = c.userData && c.userData.localBox ? c.userData.localBox : null;
            if (!b) continue;
            if (sphereIntersectsBox(playerLocalPos, DOOR_AUTO_CLOSE_DIST, b)) { allFar = false; break; }
          }
          if (allFar) playReverseBoth();
        }
        // Handle EXIT close independently
        if (exitDoor && exitDoor.userData && exitDoor.userData.frozenOnLast && !exitDoor.userData.playing) {
          const b = exitDoor.userData.localBox;
          if (b && !sphereIntersectsBox(playerLocalPos, DOOR_AUTO_CLOSE_DIST, b)) playReverseTarget(exitDoor);
        }
      }
    } catch (err) { /* ignore auto-door errors */ }
  }
  if (activeCamera && (pilot || cabL || cabR || powerbox)) {
    raycaster.setFromCamera(new THREE.Vector2(0, 0), activeCamera);
    const targets = [];
    if (pilot) targets.push(pilot);
    if (interiorEnabled) targets.push(cabL, cabR, exitDoor);
    if (powerbox) targets.push(powerbox);
    const intersects = raycaster.intersectObjects(targets.filter(Boolean), true);
      if (intersects.length > 0) {
      let obj = intersects[0].object;
      // climb to the root named object (cabL/cabR/pilot)
      while (obj && obj !== shipModel && obj.name !== 'cabL' && obj.name !== 'cabR' && obj.name !== 'pilot' && obj.name !== 'powerbox' && obj.name !== 'EXIT') obj = obj.parent;
      // Do not show or set a press-E hint for cab doors or EXIT — they open/close automatically.
      if (obj && (obj.name === 'cabL' || obj.name === 'cabR' || obj.name === 'EXIT')) {
        interactTarget = null;
        interactHint.style.display = 'none';
      } else if (obj && obj.name === 'pilot') {
        const camPos = new THREE.Vector3(); activeCamera.getWorldPosition(camPos);
        const dist = camPos.distanceTo(intersects[0].point);
        if (dist <= INTERACT_DISTANCE) {
          interactTarget = obj;
          interactHint.textContent = `Press E to interact (${obj.name})`;
          interactHint.style.display = 'block';
        } else {
          interactTarget = null;
          interactHint.style.display = 'none';
        }
      } else if (obj && obj.name === 'powerbox') {
        const camPos = new THREE.Vector3(); activeCamera.getWorldPosition(camPos);
        const dist = camPos.distanceTo(intersects[0].point);
            if (dist <= INTERACT_DISTANCE) {
            const systems = shipSystems.getAll();
            const circVal = systems && systems.circuits ? systems.circuits.value : 100;
            if (circVal < 50) {
              interactTarget = obj;
              // show hint; if the animation is playing show a generic 'repairing' message
              if (powerboxInteracting) {
                interactHint.textContent = 'Repairing power...';
              } else {
                interactHint.textContent = 'Press E to repair power';
              }
              interactHint.style.display = 'block';
            } else {
              // circuits sufficiently healthy — don't allow repair
              interactTarget = null;
              interactHint.textContent = 'Power stable';
              interactHint.style.display = 'block';
            }
          } else {
            interactTarget = null;
            interactHint.style.display = 'none';
          }
      } else {
        interactTarget = null;
        interactHint.style.display = 'none';
      }
    } else {
      interactTarget = null;
      interactHint.style.display = 'none';
    }
  }

  // Update GPS HUD/marker if tracking is enabled
  if (gpsTracking && freighterGoal && activeCamera) {
    try {
      const camPos = new THREE.Vector3(); activeCamera.getWorldPosition(camPos);
      const dist = Math.max(0, Math.round(camPos.distanceTo(freighterGoal.position)));
      // If close enough, consider the freighter reached — open the shop UI
      if (dist <= FREIGHTER_REACH_DISTANCE) {
        // stop tracking but keep the freighter model in the world (player can inspect)
        gpsTracking = false;
        if (gpsHud) {
          gpsHud.textContent = 'Freighter reached!';
          setTimeout(() => { if (gpsHud) gpsHud.style.display = 'none'; }, 2800);
        }
        if (gpsButton) { gpsButton.disabled = true; gpsButton.textContent = 'GPS: Active'; }
        try {
          openShop();
          if (freighterShopBtn) freighterShopBtn.style.display = 'inline-block';
        } catch (err) { console.warn('Failed to open shop UI', err); }
      }

      // Determine whether the target is in front of the camera. If it's behind,
      // projecting will mirror the coordinates and make it appear 'twice' on screen.
      const camDir = new THREE.Vector3(); activeCamera.getWorldDirection(camDir);
      const toTarget = freighterGoal.position.clone().sub(camPos);
      const inFront = camDir.dot(toTarget) > 0;

      if (!inFront) {
        // Target is behind the camera: avoid projecting (which mirrors position).
        if (gpsHud) {
          gpsHud.style.left = '12px';
          gpsHud.style.top = '12px';
          gpsHud.textContent = `Freighter: ${dist}m (behind)`;
        }
      } else {
        // Target is in front: project to screen and show HUD near the target.
        const sp = freighterGoal.position.clone().project(activeCamera);
        const sx = (sp.x * 0.5 + 0.5) * window.innerWidth;
        const sy = (-sp.y * 0.5 + 0.5) * window.innerHeight;
        if (gpsHud) {
          gpsHud.style.left = Math.min(Math.max(8, sx), window.innerWidth - 140) + 'px';
          gpsHud.style.top = Math.min(Math.max(8, sy), window.innerHeight - 32) + 'px';
          gpsHud.textContent = `Freighter: ${dist}m`;
        }
      }
    } catch (err) { /* ignore GPS update errors */ }
  }
  // If a freighter exists, toggle the small reopen button by proximity even when GPS tracking is off
  if (freighterGoal && activeCamera) {
    try {
      const camPos2 = new THREE.Vector3(); activeCamera.getWorldPosition(camPos2);
      const d2 = Math.max(0, Math.round(camPos2.distanceTo(freighterGoal.position)));
      const nearEnough = d2 <= (FREIGHTER_REACH_DISTANCE * 1.5);
      if (freighterShopBtn) freighterShopBtn.style.display = nearEnough ? 'inline-block' : 'none';
    } catch (e) { /* ignore */ }
  }
  // Update flashlight transform + battery drain
  try {
    if (flashlight) {
      const camPos = new THREE.Vector3();
      activeCamera.getWorldPosition(camPos);
      const camDir = new THREE.Vector3();
      activeCamera.getWorldDirection(camDir);
      flashlight.position.copy(camPos);
      flashlight.target.position.copy(camPos.clone().add(camDir.multiplyScalar(30)));
      flashlight.target.updateMatrixWorld();
      // battery no longer drains — flashlight simply toggles on/off
      flashlight.intensity = flashlightOn ? 3.0 : 0;
    }
  } catch (err) { /* ignore flashlight update errors */ }

  // powerbox animation completion now handled via the mixer 'finished' event

  // Oxygen depletion when outside (zero-g/float mode)
  try {
    if (interiorFloat) {
      oxygenLevel = Math.max(0, oxygenLevel - (OXYGEN_DRAIN_RATE * dt));
      if (oxygenUI) {
        oxygenUI.style.display = 'block';
        const bar = document.getElementById('oxygenBar');
        const pct = document.getElementById('oxygenPct');
        if (bar) bar.style.width = Math.max(0, Math.round(oxygenLevel)) + '%';
        if (pct) pct.textContent = Math.round(oxygenLevel) + '%';
        if (oxygenLevel <= 20) oxygenUI.style.background = 'rgba(80,0,0,0.7)'; else oxygenUI.style.background = 'rgba(0,0,0,0.6)';
      }
    } else {
      // inside or re-entered: restore oxygen and hide UI
      if (oxygenLevel < 100) oxygenLevel = 100;
      if (oxygenUI) oxygenUI.style.display = 'none';
    }
  } catch (err) { /* ignore oxygen UI errors */ }

  renderer.render(scene, activeCamera);
  requestAnimationFrame(animate);
}

animate();
