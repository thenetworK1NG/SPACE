// doors.js
// Handles EXIT/pilot and cabL/cabR animation setup and exposes initialization
(function(window){
  const Doors = {
    init(opts = {}){
      try {
        const ship = opts.ship;
        const shipModel = opts.shipModel || (typeof opts.getShipModel === 'function' ? opts.getShipModel() : null);
        const animations = opts.animations || [];
        const setMixer = opts.setMixer;
        const ensureMixerHandler = opts.ensureMixerHandler;
        const setCabs = opts.setCabs;
        const setExitDoor = opts.setExitDoor;
        if (!shipModel) return;

        if (animations && animations.length > 0) {
          const mixer = new THREE.AnimationMixer(shipModel);
          if (typeof setMixer === 'function') setMixer(mixer);
          try { if (typeof ensureMixerHandler === 'function') ensureMixerHandler(); } catch (e) {}
          const clips = animations;
          const cabL = shipModel.getObjectByName('cabL');
          const cabR = shipModel.getObjectByName('cabR');
          [cabL, cabR].forEach(obj => {
            if (!obj) return;
            obj.userData.interactionClips = [];
            for (const clip of clips) {
              const usesObj = clip.tracks && clip.tracks.some(t => t.name.indexOf(obj.name) !== -1);
              const nameMatch = clip.name && clip.name.toLowerCase().indexOf(obj.name.toLowerCase()) !== -1;
              if (usesObj || nameMatch) obj.userData.interactionClips.push(clip);
            }
          });
          // compute local boxes and init flags
          [cabL, cabR].forEach(obj => {
            if (!obj) return;
            const worldBox = new THREE.Box3();
            ship.updateMatrixWorld(true);
            obj.updateMatrixWorld(true);
            obj.traverse(child => {
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
              const pos = new THREE.Vector3(); obj.getWorldPosition(pos);
              worldBox.min.copy(pos).subScalar(0.5);
              worldBox.max.copy(pos).addScalar(0.5);
            }
            const invShip = new THREE.Matrix4().copy(ship.matrixWorld).invert();
            obj.userData.localBox = worldBox.clone().applyMatrix4(invShip);
            obj.userData.collidable = true;
            obj.userData.frozenOnLast = false;
            obj.userData.playing = false;
          });
          if (typeof setCabs === 'function') setCabs(cabL, cabR);
        }

        // expose exitDoor reference if requested
        try {
          const exitDoor = shipModel.getObjectByName && shipModel.getObjectByName('EXIT');
          if (exitDoor && typeof setExitDoor === 'function') setExitDoor(exitDoor);
        } catch (e) {}
      } catch (e) { console.warn('Doors.init failed', e); }
    }
  };
  window.Doors = Doors;
})(window);
