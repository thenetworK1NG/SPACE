import * as THREE from 'https://esm.sh/three@0.152.2';

// Simple flashlight module: creates a SpotLight that follows the active camera.
let _scene = null;
let _spot = null;
let _target = null;

function init(opts = {}) {
  _scene = opts.scene || (typeof window !== 'undefined' ? window.scene : null);
  try { window.flashlightOn = window.flashlightOn || false; } catch (e) {}
}

function createSpotlight() {
  if (!_scene) return null;
  if (_spot) return _spot;
  _spot = new THREE.SpotLight(0xffffff, (typeof window !== 'undefined' && window.flashlightOn) ? 3.0 : 0);
  _spot.angle = Math.PI * 0.12;
  _spot.penumbra = 0.4;
  _spot.distance = 200;
  _spot.decay = 2;
  _spot.castShadow = false;
  _target = new THREE.Object3D();
  _scene.add(_spot);
  _scene.add(_target);
  _spot.target = _target;
  // expose convenience helpers
  try { window.spawnFlashlight = spawn; window.toggleFlashlight = toggle; window.setFlashlightOn = setOn; } catch (e) {}
  return _spot;
}

function spawn() {
  return createSpotlight();
}

function setOn(v) {
  try { window.flashlightOn = !!v; } catch (e) {}
  if (_spot) _spot.intensity = window.flashlightOn ? 3.0 : 0;
}

function toggle() {
  try { setOn(!window.flashlightOn); } catch (e) {}
}

function update(activeCamera) {
  try {
    // If the global flag was turned on but the spotlight hasn't been created yet,
    // create it so toggling via `F` works even if the player didn't explicitly equip.
    try {
      if ((typeof window !== 'undefined') && window.flashlightOn && !_spot) createSpotlight();
    } catch (e) {}
    if (!_spot) return;
    if (!activeCamera) return;
    // Ensure the spotlight is parented to the active camera so it follows reliably
    try {
      if (_spot.parent !== activeCamera) {
        try { if (_spot.parent) _spot.parent.remove(_spot); } catch (e) {}
        try { if (_target && _target.parent) _target.parent.remove(_target); } catch (e) {}
        activeCamera.add(_spot);
        activeCamera.add(_target);
        // position the light at the camera origin and target slightly forward
        _spot.position.set(0, 0, 0);
        _target.position.set(0, 0, -30);
        _spot.target = _target;
      }
    } catch (e) {}
    // Keep local positions stable each frame (in case camera moves in world space)
    _spot.position.set(0, 0, 0);
    _target.position.set(0, 0, -30);
    _target.updateMatrixWorld();
    _spot.intensity = (typeof window.flashlightOn !== 'undefined' && window.flashlightOn) ? 3.0 : 0;
  } catch (e) {}
}

export default { init, spawn, setOn, toggle, update };
