import * as THREE from 'https://esm.sh/three@0.152.2';

// Ship runtime module: handles power outage/restore, flicker, emissive swaps,
// powerbox repair animations (powerbox mixer), and flashlight updates.

let _scene = null;
let _ambientLight = null;
let _dirLight = null;
let _shipSystems = null;
let _audioSystem = null;
let _addToInventory = null;
let _inventoryUI = null;
let _interactHint = null;
let _autopilotBtn = null;

// Flashlight / darkness state
let sceneIsDark = false;

// Flicker helpers
let _flickerTimers = [];
function _clearFlickers() {
  for (const t of _flickerTimers) clearTimeout(t);
  _flickerTimers = [];
}
function _startFlicker(toDark = true, duration = 1400) {
  _clearFlickers();
  const start = performance.now();
  const origAmbient = toDark ? (_ambientLight && _ambientLight.intensity ? _ambientLight.intensity : 1) : (_ambientLight && _ambientLight._baseIntensity ? _ambientLight._baseIntensity : 1);
  const origDir = toDark ? (_dirLight && _dirLight.intensity ? _dirLight.intensity : 1) : (_dirLight && _dirLight._baseIntensity ? _dirLight._baseIntensity : 1);
  const lowAmbient = 0.06;
  const lowDir = 0.08;
  function step() {
    const t = performance.now() - start;
    if (t >= duration) {
      if (_ambientLight) _ambientLight.intensity = toDark ? lowAmbient : (_ambientLight._baseIntensity || 1);
      if (_dirLight) _dirLight.intensity = toDark ? lowDir : (_dirLight._baseIntensity || 1);
      return;
    }
    const flick = Math.random() > 0.5 ? (toDark ? lowAmbient : origAmbient) : (toDark ? origAmbient * 0.3 : origAmbient * 0.6);
    if (_ambientLight) _ambientLight.intensity = flick;
    if (_dirLight) _dirLight.intensity = Math.max(0.02, flick * (toDark ? 1.2 : 1.6));
    const next = 40 + Math.random() * 220;
    _flickerTimers.push(setTimeout(step, next));
  }
  step();
}

// Emissive restoration map
let _originalEmissiveMap = new WeakMap();
function setAllEmissiveToRed(obj) {
  if (!obj) return;
  const lights1 = obj.getObjectByName && obj.getObjectByName('lights1');
  if (!lights1) return;
  lights1.traverse(child => {
    if (child.isMesh && child.material) {
      let mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const mat of mats) {
        if (mat.emissive) {
          if (!_originalEmissiveMap.has(mat)) _originalEmissiveMap.set(mat, mat.emissive.clone());
          mat.emissive.set(0xff0000);
          mat.emissiveIntensity = 1.0;
          mat.needsUpdate = true;
        }
      }
    }
  });
}
function restoreAllEmissive(obj) {
  if (!obj) return;
  const lights1 = obj.getObjectByName && obj.getObjectByName('lights1');
  if (!lights1) return;
  lights1.traverse(child => {
    if (child.isMesh && child.material) {
      let mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const mat of mats) {
        if (mat.emissive && _originalEmissiveMap.has(mat)) {
          mat.emissive.copy(_originalEmissiveMap.get(mat));
          mat.needsUpdate = true;
        }
      }
    }
  });
  _originalEmissiveMap = new WeakMap();
}

// Powerbox state & mixer
let powerbox = null;
let powerboxMixer = null;
let powerboxClips = [];
let powerboxActions = [];
let powerboxInteracting = false;
let powerboxFinishTimer = null;

// Public init
function init(opts = {}) {
  _scene = opts.scene;
  _ambientLight = opts.ambientLight;
  _dirLight = opts.dirLight;
  _shipSystems = opts.shipSystems;
  _audioSystem = opts.audioSystem;
  _addToInventory = opts.addToInventory;
  _inventoryUI = opts.inventoryUI;
  _interactHint = opts.interactHint;
  _autopilotBtn = opts.autopilotBtn;

  // remember baseline intensities
  if (_ambientLight) _ambientLight._baseIntensity = _ambientLight.intensity || 1;
  if (_dirLight) _dirLight._baseIntensity = _dirLight.intensity || 1;

  // circuits low/restored listeners
  window.addEventListener('circuits:low', (ev) => {
    if (sceneIsDark) return;
    sceneIsDark = true;
    try { window.powerOut = true; } catch (e) {}
    try { window.velocity && window.velocity.set && window.velocity.set(0,0,0); } catch (e) {}
    try { window.interiorAutoThrust = false; } catch (e) {}
    try { if (_autopilotBtn) { _autopilotBtn.textContent = 'Autopilot: Off'; _autopilotBtn.style.background = 'rgba(0,0,0,0.6)'; _autopilotBtn.disabled = true; } } catch (e) {}
    try { window.pilotDisabled = true; if (window.pilotPopup) window.pilotPopup.style.display = 'none'; } catch (e) {}
    try { window.pendingAutopilotOn = false; } catch (e) {}
    try {
      if (window.flyEnabled && !window.interiorEnabled) {
        try { window.enterBtn && window.enterBtn.click(); } catch (e) {}
      }
    } catch (e) {}
    try { _startFlicker(true, 1400); } catch (e) {}
    try { if (window.shipModel) setAllEmissiveToRed(window.shipModel); } catch (e) { console.warn('Failed to set emissive to red', e); }
    try {
      // Instead of auto-granting the flashlight, place it inside the ship locker
      const ft = { id: 'flashlight', name: 'Flashlight', price: 0, desc: 'Battery-powered flashlight' };
      try {
        // Avoid adding a flashlight if it already exists in the locker or player inventory
        const lockerCount = (window.playerInventory && typeof window.playerInventory.getLockerItemCount === 'function') ? window.playerInventory.getLockerItemCount('flashlight') : 0;
        const playerCount = (window.inventory && window.inventory['flashlight'] && window.inventory['flashlight'].count) ? window.inventory['flashlight'].count : 0;
        if ((lockerCount && lockerCount > 0) || (playerCount && playerCount > 0)) {
          // already present somewhere, skip
        } else {
          try {
            if (window.playerInventory && typeof window.playerInventory.addToLocker === 'function') {
              window.playerInventory.addToLocker(ft, 1);
            }
          } catch (e) { /* ignore */ }
        }
      } catch (e) { /* ignore */ }
      // Inform the player that power failed and the flashlight is in the locker
      try { if (_interactHint) { _interactHint.textContent = 'Power failure — check locker for a flashlight'; _interactHint.style.display = 'block'; setTimeout(() => { try { _interactHint.style.display = 'none'; } catch(e){} }, 2200); } } catch (e) {}
      // Refresh any open inventory UIs
      try { if (window.playerInventory && typeof window.playerInventory.renderLocker === 'function') { const el = document.getElementById('player-inventory-ui-locker'); if (el && el.style.display === 'block') window.playerInventory.renderLocker(); } } catch (e) {}
      try { if (_inventoryUI && _inventoryUI.style.display === 'block') { try { window.renderInventoryContents && window.renderInventoryContents(); } catch(e){} } } catch (e) {}
    } catch (err) { console.warn('Failed to place flashlight in locker', err); }
    try { if (_audioSystem) _audioSystem.playOnce && _audioSystem.playOnce('poweroff'); } catch (e) {}
  });

  window.addEventListener('circuits:restored', (ev) => {
    try { window.powerOut = false; } catch (e) {}
    try { if (_autopilotBtn) { _autopilotBtn.disabled = false; _autopilotBtn.textContent = 'Autopilot: Off'; _autopilotBtn.style.background = 'rgba(0,0,0,0.6)'; } } catch (e) {}
    try { window.pilotDisabled = false; } catch (e) {}
    try { if (window.shipModel) restoreAllEmissive(window.shipModel); } catch (e) { console.warn('Failed to restore emissive', e); }
    try { if (_interactHint) { _interactHint.textContent = 'Power restored'; _interactHint.style.display = 'block'; setTimeout(() => { try { _interactHint.style.display = 'none'; } catch(e){} }, 1200); } } catch (e) {}
    try { if (_audioSystem) _audioSystem.playOnce && _audioSystem.playOnce('powerup'); } catch (e) {}
  });
}

// Create or return the flashlight THREE.SpotLight attached to the scene
// Flashlight is now handled by src/flashlight.js

// Called from main loader when powerbox GLB is loaded
function handlePowerboxLoad(pgl, shipModel) {
  try {
    powerbox = pgl.scene;
    powerbox.name = 'powerbox';
    shipModel.add(powerbox);
    // expose to main for backwards-compatible raycasts/interactions
    try { window.powerbox = powerbox; } catch (e) {}
    try { window.powerboxInteracting = false; } catch (e) {}
    powerbox.userData.fixed = true;
    if (pgl.animations && pgl.animations.length > 0) {
      try {
        powerboxMixer = new THREE.AnimationMixer(powerbox);
        powerboxClips = pgl.animations.slice();
        try { window.powerboxMixer = powerboxMixer; window.powerboxClips = powerboxClips; } catch (e) {}
        try {
          powerboxMixer.addEventListener('finished', (ev) => {
            const clip = ev.action && ev.action.getClip ? ev.action.getClip() : null;
            if (!clip) return;
            if (powerboxClips && powerboxClips.some(c => c === clip) && powerboxInteracting) {
              try { if (powerboxFinishTimer) { clearTimeout(powerboxFinishTimer); powerboxFinishTimer = null; } } catch (e) {}
              powerboxFinishTimer = setTimeout(() => {
                try { _shipSystems && _shipSystems.repair && _shipSystems.repair('circuits', 100); } catch (e) { console.warn('Repair failed', e); }
                powerboxInteracting = false;
                try { window.powerboxInteracting = false; } catch (e) {}
                powerboxActions = [];
                try { _startFlicker(false, 1400); _flickerTimers.push(setTimeout(() => { sceneIsDark = false; }, 1400)); } catch (e) {}
                try { if (_interactHint) { _interactHint.textContent = 'Power restored'; setTimeout(() => { try { _interactHint.style.display = 'none'; } catch(e){} }, 1200); } } catch (e) {}
                try { if (_audioSystem) _audioSystem.playOnce && _audioSystem.playOnce('powerup'); } catch (e) {}
                powerboxFinishTimer = null;
              }, 3000);
            }
          });
        } catch (e) {}
      } catch (e) { console.warn('Failed to create powerbox mixer', e); }
    }
  } catch (err) { console.warn('Failed to attach powerbox', err); }
}

// Attempt to start repair (called from main key handler)
function tryStartPowerboxRepair(interactTarget) {
  try {
    if (!interactTarget || interactTarget.name !== 'powerbox') return false;
    const systems = _shipSystems && _shipSystems.getAll ? _shipSystems.getAll() : null;
    const circVal = systems && systems.circuits ? systems.circuits.value : 100;
    if (circVal >= 50) {
      try { if (_interactHint) { _interactHint.textContent = 'Power stable — no repair needed'; _interactHint.style.display = 'block'; setTimeout(() => { try { _interactHint.style.display = 'none'; } catch(e){} }, 800); } } catch (e) {}
      return true;
    }
    if (!powerbox || !powerboxMixer || !powerboxClips || powerboxClips.length === 0) {
      try {
        _shipSystems && _shipSystems.repair && _shipSystems.repair('circuits', 100);
        _startFlicker(false, 1400);
        _flickerTimers.push(setTimeout(() => { sceneIsDark = false; }, 1400));
        try { if (_interactHint) { _interactHint.textContent = 'Power restored'; _interactHint.style.display = 'block'; setTimeout(() => { try { _interactHint.style.display = 'none'; } catch(e){} }, 1200); } } catch (e) {}
        try { if (_audioSystem) _audioSystem.playOnce && _audioSystem.playOnce('powerup'); } catch (e) {}
      } catch (e) { console.warn('Instant power restore failed', e); }
      return true;
    }
    if (!powerboxInteracting) {
      powerboxActions = [];
      for (const clip of powerboxClips) {
        try {
          const action = powerboxMixer.clipAction(clip);
          action.reset();
          action.setLoop(THREE.LoopOnce, 0);
          action.clampWhenFinished = true;
          action.timeScale = 1;
          action.play();
          powerboxActions.push(action);
        } catch (err) { console.warn('Powerbox action failed', err); }
      }
      powerboxInteracting = true;
      try { window.powerboxInteracting = true; } catch (e) {}
      try { if (_interactHint) { _interactHint.textContent = 'Repairing power...'; _interactHint.style.display = 'block'; } } catch (e) {}
    }
    return true;
  } catch (e) { return false; }
}

function update(dt, opts = {}) {
  try { if (powerboxMixer) powerboxMixer.update(dt); } catch (e) {}
  try {
    // Flashlight update handled by src/flashlight.js; nothing to do here.
  } catch (err) {}
}

export default {
  init,
  handlePowerboxLoad,
  tryStartPowerboxRepair,
  update,
};
