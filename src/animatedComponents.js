import * as THREE from 'https://esm.sh/three@0.152.2';

let _mixer = null;
let _lockerDoor = null;
let _gltf = null;

export function setupLocker(opts = {}) {
  _gltf = opts.gltf || _gltf;
  const shipModel = opts.shipModel;
  _mixer = opts.mixer || _mixer;
  const setLocker = typeof opts.setLockerDoor === 'function' ? opts.setLockerDoor : () => {};

  function attachLockerClips() {
    try {
      if (!shipModel || !_gltf || !_gltf.animations || !_gltf.animations.length) return false;
      const candidate = shipModel.getObjectByName('lockerdoor') || shipModel.getObjectByName('lockerDoor') || shipModel.getObjectByName('locker');
      if (!candidate) return false;
      _lockerDoor = candidate;
      const clips = _gltf.animations.filter(clip => {
        const nameMatch = clip.name && clip.name.toLowerCase().indexOf('locker') !== -1;
        const usesObj = clip.tracks && clip.tracks.some(t => t.name.indexOf(candidate.name) !== -1);
        return nameMatch || usesObj;
      });
      if (!clips || clips.length === 0) return false;
      _lockerDoor.userData = _lockerDoor.userData || {};
      _lockerDoor.userData.interactionClips = clips.slice();
      if (_mixer) {
        for (const clip of clips) {
          try { _mixer.clipAction(clip, _lockerDoor); } catch (e) {}
        }
      }
      try { window.lockerDoor = _lockerDoor; } catch (e) {}
      try { setLocker(_lockerDoor); } catch (e) {}
      return true;
    } catch (e) { return false; }
  }

  let attached = attachLockerClips();
  const retry = setInterval(() => {
    if (attached) { clearInterval(retry); return; }
    if (attachLockerClips()) { attached = true; clearInterval(retry); }
  }, 120);
}

export function playLockerOpen() {
  return new Promise((resolve) => {
    try {
      if (!_mixer || !_lockerDoor || !_lockerDoor.userData || !_lockerDoor.userData.interactionClips || _lockerDoor.userData.interactionClips.length === 0) return resolve();
      const clip = _lockerDoor.userData.interactionClips[0];
      const action = _mixer.clipAction(clip, _lockerDoor);
      action.reset();
      action.setLoop(THREE.LoopOnce, 0);
      action.clampWhenFinished = true;
      action.timeScale = 1;
      const handler = (e) => {
        try {
          if (e && e.action && e.action.getClip && e.action.getClip() === clip) {
            try { _mixer.removeEventListener('finished', handler); } catch (e) {}
            return resolve();
          }
        } catch (err) { /* ignore */ }
      };
      _mixer.addEventListener('finished', handler);
      action.play();
    } catch (e) { resolve(); }
  });
}

export function playLockerClose() {
  return new Promise((resolve) => {
    try {
      if (!_mixer || !_lockerDoor || !_lockerDoor.userData || !_lockerDoor.userData.interactionClips || _lockerDoor.userData.interactionClips.length === 0) return resolve();
      const clip = _lockerDoor.userData.interactionClips[0];
      const action = _mixer.clipAction(clip, _lockerDoor);
      action.reset();
      action.time = clip.duration;
      action.setLoop(THREE.LoopOnce, 0);
      action.clampWhenFinished = true;
      action.timeScale = -1;
      const handler = (e) => {
        try {
          if (e && e.action && e.action.getClip && e.action.getClip() === clip) {
            try { _mixer.removeEventListener('finished', handler); } catch (e) {}
            return resolve();
          }
        } catch (err) { /* ignore */ }
      };
      _mixer.addEventListener('finished', handler);
      action.play();
    } catch (e) { resolve(); }
  });
}
