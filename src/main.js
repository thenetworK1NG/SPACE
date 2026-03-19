import * as THREE from 'https://esm.sh/three@0.152.2';
import { PointerLockControls } from 'https://esm.sh/three@0.152.2/examples/jsm/controls/PointerLockControls.js';
import { GLTFLoader } from 'https://esm.sh/three@0.152.2/examples/jsm/loaders/GLTFLoader.js';
// Expose commonly-used three.js symbols on window for non-module helpers (shipEntry.js)
try { window.THREE = THREE; window.PointerLockControls = PointerLockControls; window.GLTFLoader = GLTFLoader; } catch (e) {}
import ShipSystems from './shipSystems.js';
import AudioSystem from './audioSystem.js';
import ShipRuntime from './shipRuntime.js';
import * as Inventory from './inventory.js';
import PlayerInventory from './playerInventory.js';
import Flashlight from './flashlight.js';
import { setupLocker, playLockerOpen, playLockerClose } from './animatedComponents.js';

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
// ...existing code...
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

// Flashlight / darkness state (managed by ShipRuntime)
let sceneIsDark = false;
let flashlight = null;
let flashlightOn = false;
let flashlightBattery = 100; // kept for compatibility but no longer drains
const FLASHLIGHT_DRAIN_RATE = 0; // battery drain disabled
// Flicker helpers placeholder (runtime manages timers)
let _flickerTimers = [];
let _originalEmissiveMap = new WeakMap();

// Animation and interaction helpers (for cabL / cabR)
let mixer = null;
let cabL = null, cabR = null;
let exitDoor = null;
let pilot = null;
let lockerDoor = null;
const raycaster = new THREE.Raycaster();
let interactTarget = null;
// Helper used by inventory UI to determine if the player is near the locker
try {
  window.isPlayerNearLocker = function() {
    try {
      if (!lockerDoor || !activeCamera) return false;
      const camPos = new THREE.Vector3(); activeCamera.getWorldPosition(camPos);
      const doorPos = new THREE.Vector3(); lockerDoor.getWorldPosition(doorPos);
      const dist = camPos.distanceTo(doorPos);
      return dist <= INTERACT_DISTANCE + 0.2;
    } catch (e) { return false; }
  };
} catch (e) {}
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
if (!pilotPopup) {
  pilotPopup = document.createElement('div');
  pilotPopup.id = 'pilotPopup';
  pilotPopup.style.position = 'fixed';
  pilotPopup.style.left = '50%';
  pilotPopup.style.top = '40%';
  pilotPopup.style.transform = 'translate(-50%, -50%)';
  pilotPopup.style.padding = '14px';
  pilotPopup.style.background = 'rgba(6,8,12,0.92)';
  pilotPopup.style.color = '#fff';
  pilotPopup.style.borderRadius = '10px';
  pilotPopup.style.fontFamily = 'sans-serif';
  pilotPopup.style.zIndex = 10002;
  pilotPopup.style.display = 'none';

  const title = document.createElement('div');
  title.textContent = 'Pilot';
  title.style.fontSize = '16px';
  title.style.fontWeight = '600';
  title.style.marginBottom = '8px';
  pilotPopup.appendChild(title);

  const subtitle = document.createElement('div');
  subtitle.textContent = 'Choose how you want to control the ship';
  subtitle.style.fontSize = '12px';
  subtitle.style.opacity = '0.85';
  subtitle.style.marginBottom = '12px';
  pilotPopup.appendChild(subtitle);

  // small helper to apply consistent button styling
  const styleBtn = (b) => {
    b.style.padding = '8px 12px';
    b.style.margin = '6px 8px 0 0';
    b.style.background = 'rgba(255,255,255,0.06)';
    b.style.color = '#fff';
    b.style.border = '1px solid rgba(255,255,255,0.08)';
    b.style.borderRadius = '6px';
    b.style.cursor = 'pointer';
    b.style.fontFamily = 'sans-serif';
  };

  const btnFly = document.createElement('button'); btnFly.textContent = 'Fly (3rd-person)'; styleBtn(btnFly);
  const btnStats = document.createElement('button'); btnStats.textContent = 'Ship Stats'; styleBtn(btnStats);
  const btnAuto = document.createElement('button'); btnAuto.textContent = 'Enable Autopilot (Interior)'; styleBtn(btnAuto);
  const btnClose = document.createElement('button'); btnClose.textContent = 'Cancel'; styleBtn(btnClose);

  const actions = document.createElement('div');
  actions.appendChild(btnFly); actions.appendChild(btnStats); actions.appendChild(btnAuto); actions.appendChild(btnClose);
  pilotPopup.appendChild(actions);
  document.body.appendChild(pilotPopup);

  btnClose.addEventListener('click', () => { pilotPopup.style.display = 'none'; });

  btnFly.addEventListener('click', () => {
    pilotPopup.style.display = 'none';
    if (interiorEnabled) {
      interiorDetachRequested = true;
      interiorControls.unlock();
    }
    requestLock('fly');
  });

  btnStats.addEventListener('click', () => {
    pilotPopup.style.display = 'none';
    if (typeof window.__openShipStatsModal === 'function') {
      window.__openShipStatsModal();
    } else {
      if (typeof statsOverlay === 'undefined' || !statsOverlay) renderStats();
      if (statsOverlay) {
        statsOverlay.style.display = statsOverlay.style.display === 'none' ? 'block' : 'none';
        if (statsOverlay.style.display === 'block') renderStats();
      }
    }
  });

  btnAuto.addEventListener('click', () => {
    if (powerOut) {
      try { interactHint.textContent = 'No power — cannot enable autopilot'; interactHint.style.display = 'block'; setTimeout(() => { try { interactHint.style.display = 'none'; } catch(e){} }, 1400); } catch (e) {}
      pilotPopup.style.display = 'none';
      return;
    }
    pilotPopup.style.display = 'none';
    if (interiorEnabled) {
      interiorAutoThrust = true;
      autopilotBtn.textContent = 'Autopilot: On';
      autopilotBtn.style.background = 'rgba(0,100,0,0.7)';
      autopilotBtn.style.display = 'inline-block';
      return;
    }
    pendingAutopilotOn = true;
    enterBtn.click();
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
// Enter/Exit handlers moved to src/shipEntry.js (initialized later)

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

// ...existing code...

// --- Simple Shop System (dummy) ---
let shopUI = null;
const shopItems = [
  { id: 'medkit', name: 'Medkit', price: 150, desc: 'Restores health (dummy)'} ,
  { id: 'fuelcell', name: 'Fuel Cell', price: 320, desc: 'Refuels ship (dummy)'},
  // ...existing code...
];

// Inventory is provided by the modular inventory system in src/inventory.js
const inventory = Inventory.inventory;

// Initialize player inventory UI and seed it for testing
  try {
    // create UIs (hidden) and seed a flashlight in the locker for testing
    try { if (window.playerInventory && typeof window.playerInventory.createPlayerUI === 'function') window.playerInventory.createPlayerUI(); } catch (e) {}
    try { if (window.playerInventory && typeof window.playerInventory.createLockerUI === 'function') window.playerInventory.createLockerUI(); } catch (e) {}
    const testFlash = { id: 'flashlight', name: 'Flashlight', price: 0, desc: 'Battery-powered flashlight' };
    try { if (window.playerInventory && typeof window.playerInventory.setLockerInventory === 'function') window.playerInventory.setLockerInventory({ flashlight: { item: testFlash, count: 1 } }); } catch (e) {}
  } catch (e) {}

// Initialize shipRuntime now that inventory helpers (addToInventory, UI) exist
ShipRuntime.init({
  scene,
  ambientLight,
  dirLight: light,
  shipSystems,
  audioSystem,
  addToInventory: Inventory.addToInventory,
  inventoryUI: Inventory.inventoryUI,
  interactHint,
  autopilotBtn,
});

// Initialize flashlight system
try { Flashlight.init({ scene }); } catch (e) {}

function createShopUI() {
  if (shopUI) return shopUI;
  shopUI = document.createElement('div');
  shopUI.id = 'shop-ui';
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
  title.textContent = 'Shop';
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
      Inventory.addToInventory(it);
      try { if (window.playerInventory && typeof window.playerInventory.addToPlayer === 'function') window.playerInventory.addToPlayer(it); } catch (e) {}
      btn.disabled = true;
      btn.textContent = 'Purchased';
      btn.style.opacity = '0.7';
      console.log('Purchased item:', it.id);
      // update inventory UI if currently open
      try { if (window.playerInventory && document.getElementById('player-inventory-ui') && document.getElementById('player-inventory-ui').style.display === 'block') window.playerInventory.render(); } catch (e) {}
      if (Inventory.inventoryUI && Inventory.inventoryUI.style.display === 'block') Inventory.renderInventoryContents();
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
    // After closing the shop, ensure the next user click can re-lock the pointer.
    try { if (canvas && typeof canvas.focus === 'function') canvas.focus(); } catch (e) {}
    const tryRelock = (ev) => {
      try { document.removeEventListener('click', tryRelock, true); } catch (e) {}
      // ignore clicks that hit UI elements (shop, pilot popup, inventory)
      try {
        const tgt = ev.target;
        if (tgt && tgt.closest && (tgt.closest('#shop-ui') || tgt.closest('#pilotPopup') || tgt.closest('#inventory-ui') || tgt.closest('#ship-stats') )) {
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
   // --- Reset all FPS and float key states to prevent stuck/jumbled controls ---
   try {
     const obj = interiorControls.getObject();
     if (obj && obj.userData) {
       if (obj.userData.fps && obj.userData.fps.keyStates) {
         for (const k in obj.userData.fps.keyStates) obj.userData.fps.keyStates[k] = false;
         if (obj.userData.fps.velocity) obj.userData.fps.velocity.set(0,0,0);
       }
       if (obj.userData.float && obj.userData.float.keyStates) {
         for (const k in obj.userData.float.keyStates) obj.userData.float.keyStates[k] = false;
         if (obj.userData.float.velocity) obj.userData.float.velocity.set(0,0,0);
       }
     }
   } catch (e) {}
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
    // Disable buite collision and wireframe when inside
    try {
      const buite = shipModel && shipModel.getObjectByName && shipModel.getObjectByName('buite');
      if (buite) {
        buite.userData.collidable = false;
        buite.visible = false;
      }
    } catch (e) {}
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
      // Re-enable buite collision and wireframe when outside
      try {
        const buite = shipModel && shipModel.getObjectByName && shipModel.getObjectByName('buite');
        if (buite) {
          buite.userData.collidable = true;
          // Use config to determine wireframe visibility
          buite.visible = interiorConfig && (typeof interiorConfig.showBuiteWire !== 'undefined' ? !!interiorConfig.showBuiteWire : true);
        }
      } catch (e) {}
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

// Exit Interior handler moved to src/shipEntry.js

// Ship model (use your ship.glb at the project root)
const loader = new GLTFLoader();
let shipModel = null;

// applyBuiteVisibility moved to ShipEntry.applyBuiteVisibility

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

// computeInteriorBoxFromBin moved to ShipEntry.computeInteriorBoxFromBin

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
  // Prevent entering flight mode if engine manifolds are critically low
  if (kind === 'fly') {
    try {
      const systems = shipSystems.getAll();
      const engVal = systems && systems.engine ? systems.engine.value : 100;
      if (engVal < 25) {
        try { interactHint.textContent = 'Engine critical — cannot engage flight'; interactHint.style.display = 'block'; setTimeout(() => { try { interactHint.style.display = 'none'; } catch(e){} }, 1600); } catch (e) {}
        return;
      }
    } catch (e) { /* ignore */ }
  }
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
  .then(cfg => { interiorConfig = { ...interiorConfig, ...cfg }; try { if (window.ShipEntry && ShipEntry.applyBuiteVisibility) ShipEntry.applyBuiteVisibility(shipModel, interiorConfig); } catch(e){} })
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
        // Delegate powerbox handling to shipRuntime so logic lives in the module
        ShipRuntime.handlePowerboxLoad(pgl, shipModel);
      } catch (err) { console.warn('Failed to attach powerbox (runtime)', err); }
    }, undefined, err => { console.warn('Failed to load powerbox.glb', err); });
  } catch (e) { console.warn('Powerbox load error', e); }

  // Load anchors.glb and attach it to the ship
  try {
    loader.load('anchors.glb', agl => {
      try {
        const anchors = agl.scene;
        anchors.name = 'anchors';
        // Optionally set position/scale/rotation here if needed
        // anchors.position.set(0, -2, 0); // Example: place below the ship
        // anchors.scale.set(1, 1, 1); // Example: default scale
        shipModel.add(anchors);
        anchors.userData.fixed = true;
      } catch (err) { console.warn('Failed to attach anchors', err); }
    }, undefined, err => { console.warn('Failed to load anchors.glb', err); });
  } catch (e) { console.warn('Anchors load error', e); }
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
  // Delegate buite/binne loading and collision setup to ShipEntry (wait for helper to load)
  try {
    const tryAttach = () => {
      try {
        if (window.ShipEntry && typeof window.ShipEntry.attachShipModel === 'function') {
          window.ShipEntry.attachShipModel({ shipModel, ship, loader, setBaseInteriorBox: b => { baseInteriorBox = b; }, setPilot: p => { pilot = p; }, setExitDoor: d => { exitDoor = d; } });
          return true;
        }
      } catch (e) { /* ignore */ }
      return false;
    };
    if (!tryAttach()) {
      // Poll briefly until the helper is available
      const attachRetry = setInterval(() => {
        if (tryAttach()) clearInterval(attachRetry);
      }, 120);
    }
  } catch (e) { console.warn('ShipEntry.attachShipModel scheduling failed', e); }
  // Initialize pilot/door animations via Doors module (cabL/cabR and EXIT)
  try {
    const tryInitDoors = () => {
      try {
        if (window.Doors && typeof window.Doors.init === 'function') {
          window.Doors.init({ ship, shipModel, animations: gltf.animations || [], setMixer: m => { mixer = m; try { setupLocker({ gltf, shipModel, mixer: m, setLockerDoor: d => { lockerDoor = d; } }); } catch (e) {} }, ensureMixerHandler, setCabs: (l, r) => { cabL = l; cabR = r; }, setExitDoor: d => { exitDoor = d; } });
          return true;
        }
      } catch (e) {}
      return false;
    };
    if (!tryInitDoors()) {
      const retry = setInterval(() => { if (tryInitDoors()) clearInterval(retry); }, 120);
    }
  } catch (e) { console.warn('Doors.init scheduling failed', e); }
  // Delegate locker animation handling to animatedComponents.setupLocker
  try { setupLocker({ gltf, shipModel, mixer: mixer, setLockerDoor: d => { lockerDoor = d; } }); } catch (e) {}
}, undefined, err => console.warn('Failed to load ship.glb — put it at the project root', err));

// Play locker open animation (forward to last keyframe) and resolve when finished.
// Expose locker playback helpers via animatedComponents for compatibility
try { window.playLockerOpen = playLockerOpen; window.playLockerClose = playLockerClose; } catch (e) {}

// Near starfield only: many small stars wrapped around the camera to appear infinite

// Dynamically load the ship entry/exit helper module and initialize it.
(function(){
  try {
    const s = document.createElement('script');
    s.src = 'src/shipEntry.js';
    s.onload = () => {
      if (!window.ShipEntry) return;
      try {
        ShipEntry.init({
          ship: ship,
          getShipModel: () => shipModel,
          getBaseInteriorBox: () => baseInteriorBox,
          setInteriorBox: (b) => { interiorBox = b; },
          setDesiredInteriorLocalPos: (v) => { desiredInteriorLocalPos = v; },
          requestLock: requestLock,
          getInteriorControls: () => interiorControls,
          getInteriorEnabled: () => interiorEnabled,
          setInteriorDetachRequested: (v) => { interiorDetachRequested = v; },
          interiorConfig: interiorConfig
        });
      } catch (e) {
        console.warn('Failed to initialize ShipEntry', e);
      }
    };
    document.body.appendChild(s);
  } catch (e) { console.warn('Failed to load shipEntry helper', e); }
})();
// Load shipControls non-module helper (input + autopilot wiring)
(function(){
  try {
    const s2 = document.createElement('script');
    s2.src = 'src/shipControls.js';
    document.body.appendChild(s2);
  } catch (e) { console.warn('Failed to load shipControls helper', e); }
})();

// Load doors helper (pilot/cabin/EXIT animations)
(function(){
  try {
    const s3 = document.createElement('script');
    s3.src = 'src/doors.js';
    document.body.appendChild(s3);
  } catch (e) { console.warn('Failed to load doors helper', e); }
})();

// Initialize ShipControls when available and provide references it needs
(function initShipControls(){
  try {
    if (!window.ShipControls) return setTimeout(initShipControls, 120);
    ShipControls.init({
      ship,
      shipModel: () => shipModel,
      getShipSystems: () => shipSystems,
      move,
      velocity,
      target: shipTarget,
      yaw: 0,
      pitch: 0,
      ACCEL: ACCEL,
      MAX_SPEED: MAX_SPEED,
      DRAG: DRAG,
      ROTATION_DAMPING: ROTATION_DAMPING,
      ROTATION_SPEED: ROTATION_SPEED,
      BANK_AMOUNT: BANK_AMOUNT,
      getShipModel: () => shipModel,
      getShipSystems: () => shipSystems,
      controls,
      interiorControls,
      camera,
      fpCamera,
      cameraPivot,
      nearStars,
      nearGeo,
      randPointInSphere,
      BASE_FOV: BASE_FOV,
      NEAR_STAR_RADIUS: NEAR_STAR_RADIUS,
      MIN_NEAR_STAR_DISTANCE: MIN_NEAR_STAR_DISTANCE,
      _replaceRadiusSq: _replaceRadiusSq,
      frameState: { frameCounter: 0 },
      getInteriorEnabled: () => interiorEnabled,
      getInteriorAutoThrust: () => interiorAutoThrust,
      setInteriorAutoThrust: (v) => { interiorAutoThrust = v; },
      getFlyEnabled: () => flyEnabled,
      setFlyEnabled: (v) => { flyEnabled = v; },
      getPowerOut: () => powerOut,
      interactHint,
      shipSystemsGet: () => shipSystems,
    });
  } catch (e) { console.warn('initShipControls error', e); }
})();
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
  // Toggle player inventory with I
  if (e.code === 'KeyI') {
    try { if (window.playerInventory && typeof window.playerInventory.togglePlayerUI === 'function') { window.playerInventory.togglePlayerUI(); return; } } catch (e) {}
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
      // If we're looking at the powerbox, delegate repair handling to ShipRuntime
      if (interactTarget && interactTarget.name === 'powerbox') {
        try {
          const handled = ShipRuntime.tryStartPowerboxRepair(interactTarget);
          if (handled) return;
        } catch (e) { /* fallthrough to default behavior */ }
      }
      // If we're looking at a locker, open the locker <-> player inventory UI
      if (interactTarget && interactTarget.name === 'locker') {
        try {
          const openLockerUI = () => { try { if (window.playerInventory && typeof window.playerInventory.openLockerUI === 'function') window.playerInventory.openLockerUI(); else { Inventory.createInventoryUI(); Inventory.openInventory(); } } catch (err) { console.warn('Failed to open locker inventory', err); } };
          if (window.playLockerOpen) {
            window.playLockerOpen().then(() => { openLockerUI(); });
          } else {
            openLockerUI();
          }
        } catch (err) { console.warn('Failed to open locker inventory', err); }
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

// --- Reset all movement key states on window blur to prevent stuck movement ---
window.addEventListener('blur', () => {
  // Reset float mode keys
  try {
    const obj = interiorControls.getObject();
    if (obj && obj.userData && obj.userData.float && obj.userData.float.keyStates) {
      for (const k in obj.userData.float.keyStates) obj.userData.float.keyStates[k] = false;
      if (obj.userData.float.velocity) obj.userData.float.velocity.set(0,0,0);
    }
  } catch (e) {}
  // Reset FPS mode keys
  try {
    const obj = interiorControls.getObject();
    if (obj && obj.userData && obj.userData.fps && obj.userData.fps.keyStates) {
      for (const k in obj.userData.fps.keyStates) obj.userData.fps.keyStates[k] = false;
      if (obj.userData.fps.velocity) obj.userData.fps.velocity.set(0,0,0);
    }
  } catch (e) {}
});

// Flight parameters
// tuned to make flying *feel* faster: higher accel/speed, stronger parallax and FOV kick
const ACCEL = 360; // units/s^2 (was 160)
const MAX_SPEED = 1600; // top speed (was 650)
const DRAG = 0.6; // lower = longer coast (was 0.9)
const ROTATION_SPEED = 0.0028; // mouse sensitivity
const ROTATION_DAMPING = 6.0; // higher = tighter tracking
const BANK_AMOUNT = 0.9; // roll when turning

// Expose movement constants and state to window so external non-module helpers can control them
try {
  window.ACCEL = ACCEL;
  window.MAX_SPEED = MAX_SPEED;
  window.DRAG = DRAG;
  window.ROTATION_SPEED = ROTATION_SPEED;
  window.ROTATION_DAMPING = ROTATION_DAMPING;
  window.BANK_AMOUNT = BANK_AMOUNT;
} catch (e) {}

// runtime state
const velocity = new THREE.Vector3();
// shared target for ship orientation (used by shipControls)
const shipTarget = { yaw: 0, pitch: 0 };
let lastMouse = { x:0, y:0 };

// capture raw mouse movement while pointer locked
// mouse movement for flight (interior pointerlock rotates the fp camera internally)
document.addEventListener('mousemove', (e) => {
  // only control ship orientation when pointerlock belongs to the flight controls
  if (!controls.isLocked || !flyEnabled) return;
  shipTarget.yaw -= e.movementX * ROTATION_SPEED;
  shipTarget.pitch -= e.movementY * ROTATION_SPEED;
  // clamp pitch to prevent flipping
  shipTarget.pitch = Math.max(-Math.PI/3, Math.min(Math.PI/3, shipTarget.pitch));
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
  try { window.flashlightOn = flashlightOn; } catch (e) {}
});

// (Free camera input removed)

let last = performance.now();
function animate(){
  const now = performance.now();
  const dt = Math.min(0.05, (now - last)/1000);
  last = now;
  // advance any animation mixers
  if (mixer) mixer.update(dt);
  // let ShipRuntime advance any runtime mixers (powerbox) and update flashlight
  try { ShipRuntime.update(dt, { activeCamera }); } catch (e) {}
  // Update flashlight position and intensity (managed by module)
  try { if (typeof Flashlight !== 'undefined' && Flashlight && typeof Flashlight.update === 'function') Flashlight.update(activeCamera); } catch (e) {}
  // update audio state based on oxygen UI visibility (outside when oxygen UI shown)
  try {
    const outsideFlag = !!(oxygenUI && oxygenUI.style && oxygenUI.style.display === 'block');
    if (audioSystem && audioSystem._inited) audioSystem.setOutside(outsideFlag);
  } catch (e) {}
  // Flight physics and camera follow handled by ShipControls
  try { if (window.ShipControls && typeof ShipControls.update === 'function') ShipControls.update(dt); } catch (e) {}

  // Toggle buite and binneWire collision/wireframe based on oxygen meter
  try {
    const buite = shipModel && shipModel.getObjectByName && shipModel.getObjectByName('buite');
    const binneWire = shipModel && shipModel.getObjectByName && shipModel.getObjectByName('binneWire');
    // Determine if player is inside any binneWire collision box
    let playerInsideBinne = false;
    if (binneWire && binneWire.userData && binneWire.userData.collisionBoxes) {
      const obj = interiorControls.getObject();
      for (const b of binneWire.userData.collisionBoxes) {
        if (b.containsPoint(obj.position)) { playerInsideBinne = true; break; }
      }
    }
    // buite: only visible/collidable when outside
    if (buite) {
      if (!playerInsideBinne) {
        buite.userData.collidable = true;
      } else {
        buite.userData.collidable = false;
      }
          // Always set visibility by config
          try { if (window.ShipEntry && ShipEntry.applyBuiteVisibility) ShipEntry.applyBuiteVisibility(shipModel, interiorConfig); } catch (e) {}
    }
    // binneWire: only visible/collidable when inside
    if (binneWire) {
      if (playerInsideBinne) {
        binneWire.userData.collidable = true;
      } else {
        binneWire.userData.collidable = false;
      }
      // Always set visibility by config
      try { if (window.ShipEntry && ShipEntry.applyBuiteVisibility) ShipEntry.applyBuiteVisibility(shipModel, interiorConfig); } catch (e) {}
    }
  } catch (e) {}
  // --- INTERIOR: FPS walking/jumping (binneWire) ---
  if (interiorEnabled && (!interiorFloat)) {
    ship.updateMatrixWorld(true);
    const obj = interiorControls.getObject();
    if (!obj.userData.fps) {
      obj.userData.fps = {
        velocity: new THREE.Vector3(),
        onGround: false,
        jumpSpeed: 4.2,
        speed: 3.0,
        gravity: 9.8,
        keyStates: { W: false, A: false, S: false, D: false, Space: false }
      };
    }
    const fps = obj.userData.fps;
    if (!fps._listener) {
      fps._listener = true;
      window.addEventListener('keydown', e => {
        if (!interiorEnabled) return;
        if (e.code === 'KeyW') fps.keyStates.W = true;
        if (e.code === 'KeyA') fps.keyStates.A = true;
        if (e.code === 'KeyS') fps.keyStates.S = true;
        if (e.code === 'KeyD') fps.keyStates.D = true;
        if (e.code === 'Space') fps.keyStates.Space = true;
      });
      window.addEventListener('keyup', e => {
        if (!interiorEnabled) return;
        if (e.code === 'KeyW') fps.keyStates.W = false;
        if (e.code === 'KeyA') fps.keyStates.A = false;
        if (e.code === 'KeyS') fps.keyStates.S = false;
        if (e.code === 'KeyD') fps.keyStates.D = false;
        if (e.code === 'Space') fps.keyStates.Space = false;
      });
    }
    // Get collision boxes from binneWire (with robust checks)
    let binneBoxes = [];
    try {
      const binneWire = shipModel && shipModel.getObjectByName && shipModel.getObjectByName('binneWire');
      if (
        binneWire &&
        binneWire.userData &&
        Array.isArray(binneWire.userData.collisionBoxes) &&
        binneWire.userData.collisionBoxes.length > 0 &&
        binneWire.userData.collidable === true
      ) {
        binneBoxes = binneWire.userData.collisionBoxes;
      }
    } catch (e) { binneBoxes = []; }
    // Find the furthest back face (max z)
    let maxBackZ = -Infinity;
    for (const b of binneBoxes) {
      if (b.max.z > maxBackZ) maxBackZ = b.max.z;
    }
    // FPS movement logic
      // Calculate movement relative to camera in ship-local space
      const forwardWorld = new THREE.Vector3();
      fpCamera.getWorldDirection(forwardWorld);
      // Remove ship rotation from camera direction
      const shipInvQuat = ship.quaternion.clone().invert();
      forwardWorld.applyQuaternion(shipInvQuat);
      forwardWorld.y = 0; forwardWorld.normalize();
      const rightWorld = new THREE.Vector3().crossVectors(forwardWorld, fpCamera.up.clone().applyQuaternion(shipInvQuat)).normalize();
      const move = new THREE.Vector3();
      if (fps.keyStates.W) move.add(forwardWorld);
      if (fps.keyStates.S) move.addScaledVector(forwardWorld, -1);
      if (fps.keyStates.A) move.addScaledVector(rightWorld, -1);
      if (fps.keyStates.D) move.add(rightWorld);
      if (move.lengthSq() > 0) move.normalize();
    if (fps.keyStates.Space && fps.onGround) {
      fps.velocity.y = fps.jumpSpeed;
      fps.onGround = false;
    }
    fps.velocity.x = move.x * fps.speed;
    fps.velocity.z = move.z * fps.speed;
    fps.velocity.y -= fps.gravity * dt;
    const nextPos = obj.position.clone().addScaledVector(fps.velocity, dt);
    // Allow walking out the furthest back face (max z) only
    let insideAny = false;
    let onGround = false;
    for (const b of binneBoxes) {
      const margin = 0.06; // Increased margin for stricter collision
      // If nextPos.z is beyond the maxBackZ face, allow exit (do not block)
      const isBackExit = (nextPos.z > maxBackZ - 0.05);
      // Check if inside box (with margin), or at exit
      if (
        nextPos.x > b.min.x + margin && nextPos.x < b.max.x - margin &&
        nextPos.z > b.min.z + margin && (nextPos.z < b.max.z - margin || isBackExit)
      ) {
        if (nextPos.y <= b.max.y + margin && nextPos.y >= b.min.y - margin) {
          insideAny = true;
          // Clamp position to stay inside walls (except exit)
          if (!isBackExit) {
            nextPos.x = Math.max(b.min.x + margin, Math.min(nextPos.x, b.max.x - margin));
            nextPos.z = Math.max(b.min.z + margin, Math.min(nextPos.z, b.max.z - margin));
          }
          if (nextPos.y <= b.min.y + 3.5) {
            nextPos.y = b.min.y + 3.5;
            fps.velocity.y = 0;
            onGround = true;
          }
        }
      }
    }
    if (insideAny) {
      obj.position.copy(nextPos);
      fps.onGround = onGround;
      // If after moving, player is outside all boxes, instantly enter float mode
      let nowInside = false;
      for (const b of binneBoxes) {
        if (b.containsPoint(obj.position)) { nowInside = true; break; }
      }
      if (!nowInside) {
        interiorFloat = true;
        interiorFloatVelocity.set(0,0,0);
        // Optionally clear FPS velocity to avoid carryover
        fps.velocity.set(0,0,0);
      }
    } else {
      // Instantly enter float mode if not inside any box
      interiorFloat = true;
      interiorFloatVelocity.set(0,0,0);
      fps.velocity.set(0,0,0);
    }
    fpCamera.fov = BASE_FOV; fpCamera.updateProjectionMatrix();
  }

  // --- FLOAT MODE: zero gravity movement and buite.glb collision when outside ---
  if (interiorEnabled && interiorFloat) {
    const obj = interiorControls.getObject();
    // Zero gravity controls: WASD for horizontal, Space for up, Q for down
    if (!obj.userData.float) {
      obj.userData.float = {
        velocity: new THREE.Vector3(),
        keyStates: { W: false, A: false, S: false, D: false, Space: false, Q: false }
      };
    }
    const float = obj.userData.float;
    if (!float._listener) {
      float._listener = true;
      window.addEventListener('keydown', e => {
        if (!(interiorEnabled && interiorFloat)) return;
        if (e.code === 'KeyW') float.keyStates.W = true;
        if (e.code === 'KeyA') float.keyStates.A = true;
        if (e.code === 'KeyS') float.keyStates.S = true;
        if (e.code === 'KeyD') float.keyStates.D = true;
        if (e.code === 'Space') float.keyStates.Space = true;
        if (e.code === 'KeyQ') float.keyStates.Q = true;
      });
      window.addEventListener('keyup', e => {
        if (!(interiorEnabled && interiorFloat)) return;
        if (e.code === 'KeyW') float.keyStates.W = false;
        if (e.code === 'KeyA') float.keyStates.A = false;
        if (e.code === 'KeyS') float.keyStates.S = false;
        if (e.code === 'KeyD') float.keyStates.D = false;
        if (e.code === 'Space') float.keyStates.Space = false;
        if (e.code === 'KeyQ') float.keyStates.Q = false;
      });
    }
    // Get direction vectors
      // Calculate movement relative to camera in ship-local space
      const forwardWorld = new THREE.Vector3();
      fpCamera.getWorldDirection(forwardWorld);
      // Remove ship rotation from camera direction
      const shipInvQuat = ship.quaternion.clone().invert();
      forwardWorld.applyQuaternion(shipInvQuat);
      forwardWorld.y = 0; forwardWorld.normalize();
      const rightWorld = new THREE.Vector3().crossVectors(forwardWorld, fpCamera.up.clone().applyQuaternion(shipInvQuat)).normalize();
      const upWorld = new THREE.Vector3(0,1,0); // up is always Y in ship-local
    // Movement (inertia-based for realism)
    const accel = new THREE.Vector3();
    if (float.keyStates.W) accel.add(forwardWorld);
    if (float.keyStates.S) accel.addScaledVector(forwardWorld, -1);
    if (float.keyStates.A) accel.addScaledVector(rightWorld, -1);
    if (float.keyStates.D) accel.add(rightWorld);
    if (float.keyStates.Space) accel.add(upWorld);
    if (float.keyStates.Q) accel.addScaledVector(upWorld, -1);
    if (accel.lengthSq() > 0) accel.normalize();
    // Acceleration and drag
    const FLOAT_ACCEL = 7.0; // units/s^2
    const FLOAT_DRAG = 0.18; // lower = more floaty
    float.velocity.addScaledVector(accel, FLOAT_ACCEL * dt);
    // Apply gentle drag
    float.velocity.multiplyScalar(Math.max(0, 1 - FLOAT_DRAG * dt));
    // Clamp max float speed
    const MAX_FLOAT_SPEED = 6.5;
    if (float.velocity.lengthSq() > MAX_FLOAT_SPEED * MAX_FLOAT_SPEED) float.velocity.setLength(MAX_FLOAT_SPEED);
    // Predict next position
    const proposed = obj.position.clone().addScaledVector(float.velocity, dt);
    // buite.glb collision (with robust checks)
    let collided = false;
    try {
      const buiteObj = shipModel && shipModel.getObjectByName && shipModel.getObjectByName('buite');
      if (
        buiteObj &&
        buiteObj.userData &&
        Array.isArray(buiteObj.userData.collisionBoxes) &&
        buiteObj.userData.collisionBoxes.length > 0 &&
        buiteObj.userData.collidable === true
      ) {
        for (const b of buiteObj.userData.collisionBoxes) {
          if (sphereIntersectsBox(proposed, PLAYER_RADIUS, b)) { collided = true; break; }
        }
      }
    } catch (e) { collided = false; }
    // --- NEW: check for binneWire collision to re-enter FPS mode ---
    let reenterBin = false;
    let binneBoxes = [];
    try {
      const binneWire = shipModel && shipModel.getObjectByName && shipModel.getObjectByName('binneWire');
      if (
        binneWire &&
        binneWire.userData &&
        Array.isArray(binneWire.userData.collisionBoxes) &&
        binneWire.userData.collisionBoxes.length > 0 &&
        binneWire.userData.collidable === true
      ) {
        binneBoxes = binneWire.userData.collisionBoxes;
      }
    } catch (e) { binneBoxes = []; }
    for (const b of binneBoxes) {
      if (sphereIntersectsBox(proposed, PLAYER_RADIUS, b)) { reenterBin = true; break; }
    }
    if (reenterBin) {
      // Robustly switch to FPS mode and reset all state
      interiorFloat = false;
      float.velocity.set(0,0,0);
      const objFPS = interiorControls.getObject();
      // Reset FPS state
      if (!objFPS.userData.fps) {
        objFPS.userData.fps = {
          velocity: new THREE.Vector3(),
          onGround: false,
          jumpSpeed: 4.2,
          speed: 3.0,
          gravity: 9.8,
          keyStates: { W: false, A: false, S: false, D: false, Space: false }
        };
      }
      const fps = objFPS.userData.fps;
      fps.velocity.set(0,0,0);
      // Place player at the entry point
      objFPS.position.copy(proposed);
      // Try to ground the player if possible
      let grounded = false;
      for (const b of binneBoxes) {
        if (b.containsPoint(objFPS.position)) {
          // Place player just above the floor
          objFPS.position.y = Math.max(objFPS.position.y, b.min.y + 3.5);
          grounded = true;
          break;
        }
      }
      fps.onGround = grounded;
      // Failsafe: ensure only binneWire collision is enabled, buite is disabled
      try {
        const buite = shipModel && shipModel.getObjectByName && shipModel.getObjectByName('buite');
        if (buite) {
          buite.userData.collidable = false;
          try { if (window.ShipEntry && ShipEntry.applyBuiteVisibility) ShipEntry.applyBuiteVisibility(shipModel, interiorConfig); } catch (e) {}
        }
        const binneWire = shipModel && shipModel.getObjectByName && shipModel.getObjectByName('binneWire');
        if (binneWire) {
          binneWire.userData.collidable = true;
          try { if (window.ShipEntry && ShipEntry.applyBuiteVisibility) ShipEntry.applyBuiteVisibility(shipModel, interiorConfig); } catch (e) {}
        }
      } catch (e) {}
      // Failsafe: ensure no float state lingers
      objFPS.userData.float = undefined;
    } else if (!collided) {
      obj.position.copy(proposed);
    } else {
      // stop at collision (only the direction that hit)
      // Try to slide along the surface by zeroing the velocity component that caused the collision
      // We'll do a simple approach: zero velocity in the direction of the attempted move
      const diff = proposed.clone().sub(obj.position);
      if (Math.abs(diff.x) > Math.abs(diff.y) && Math.abs(diff.x) > Math.abs(diff.z)) float.velocity.x = 0;
      else if (Math.abs(diff.y) > Math.abs(diff.x) && Math.abs(diff.y) > Math.abs(diff.z)) float.velocity.y = 0;
      else float.velocity.z = 0;
    }
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
  if (activeCamera && (pilot || cabL || cabR || window.powerbox)) {
    raycaster.setFromCamera(new THREE.Vector2(0, 0), activeCamera);
    const targets = [];
    if (pilot) targets.push(pilot);
    if (interiorEnabled) targets.push(cabL, cabR, exitDoor);
    if (window.powerbox) targets.push(window.powerbox);
    // include the full ship model so named children like `locker` can be targeted
    if (typeof shipModel !== 'undefined' && shipModel) targets.push(shipModel);
    const intersects = raycaster.intersectObjects(targets.filter(Boolean), true);
      if (intersects.length > 0) {
      let obj = intersects[0].object;
      // climb to the root named object (cabL/cabR/pilot/powerbox/locker)
      while (obj && obj !== shipModel && obj.name !== 'cabL' && obj.name !== 'cabR' && obj.name !== 'pilot' && obj.name !== 'powerbox' && obj.name !== 'EXIT' && obj.name !== 'locker') obj = obj.parent;
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
              if (window.powerboxInteracting) {
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
      } else if (obj && obj.name === 'locker') {
        const camPos = new THREE.Vector3(); activeCamera.getWorldPosition(camPos);
        const dist = camPos.distanceTo(intersects[0].point);
        if (dist <= INTERACT_DISTANCE) {
          interactTarget = obj;
          interactHint.textContent = 'Press E to open locker';
          interactHint.style.display = 'block';
        } else {
          interactTarget = null;
          interactHint.style.display = 'none';
        }
      } else {
        interactTarget = null;
        interactHint.style.display = 'none';
      }
      // Auto-close ship locker UI if player walks away while it's open
      try {
        const lockerUiEl = document.getElementById('player-inventory-ui-locker');
        if (lockerUiEl && lockerUiEl.style.display === 'block') {
          if (lockerDoor && activeCamera) {
            const camPos = new THREE.Vector3(); activeCamera.getWorldPosition(camPos);
            const doorPos = new THREE.Vector3(); lockerDoor.getWorldPosition(doorPos);
            const dist = camPos.distanceTo(doorPos);
            if (dist > INTERACT_DISTANCE + 0.2) {
              try { if (window.playerInventory && typeof window.playerInventory.closeLockerUI === 'function') window.playerInventory.closeLockerUI(); else { Inventory.closeInventory && Inventory.closeInventory(); } } catch (e) {}
            }
          }
        }
      } catch (e) {}
    } else {
      interactTarget = null;
      interactHint.style.display = 'none';
    }
  }

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
