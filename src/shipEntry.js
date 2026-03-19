// shipEntry.js
// Encapsulates the enter/exit and interior box helpers so main.js can remain smaller.
(function(window){
  const ShipEntry = {
    _opts: {},
    init(opts = {}){
      this._opts = opts;
      const enterBtn = document.getElementById('enterBtn');
      const exitInteriorBtn = document.getElementById('exitInteriorBtn');

      if (enterBtn) {
        enterBtn.addEventListener('click', () => {
          const shipModel = (this._opts.getShipModel || (() => null))();
          if (!shipModel) return alert('Ship model not loaded yet');
          const bin = shipModel.getObjectByName('binne');
          if (!bin) return alert('No object named "binne" found inside ship.glb');

          // compute the interior box from the shared base interior box
          const baseBox = (this._opts.getBaseInteriorBox || (() => null))();
          const interiorCfg = this._opts.interiorConfig || { position:[0,0,0], scale:[1,1,1] };
          let interiorBox = null;
          if (baseBox) {
            interiorBox = ShipEntry.computeInteriorBoxFromBin(baseBox, interiorCfg);
          }
          // let main code store the computed interiorBox
          if (this._opts.setInteriorBox && interiorBox) this._opts.setInteriorBox(interiorBox);

          // compute desired interior local position from an optional marker inside the model
          const startMarker = shipModel.getObjectByName('inerior') || shipModel.getObjectByName('interior');
          // compute desired interior local position and apply optional eye offset
          const eyeOffset = (interiorCfg && typeof interiorCfg.eyeOffsetY === 'number') ? interiorCfg.eyeOffsetY : 1.6;
          if (startMarker) {
            shipModel.updateMatrixWorld(true);
            const worldPos = new THREE.Vector3();
            startMarker.getWorldPosition(worldPos);
            const desired = (this._opts.ship && typeof this._opts.ship.worldToLocal === 'function') ? this._opts.ship.worldToLocal(worldPos.clone()) : worldPos.clone();
            desired.y += eyeOffset;
            if (this._opts.setDesiredInteriorLocalPos) this._opts.setDesiredInteriorLocalPos(desired);
          } else if (interiorBox) {
            const newCenter = interiorBox.getCenter(new THREE.Vector3());
            newCenter.y += eyeOffset;
            if (this._opts.setDesiredInteriorLocalPos) this._opts.setDesiredInteriorLocalPos(newCenter.clone());
          }

          // request pointer lock for interior mode
          if (this._opts.requestLock) this._opts.requestLock('interior');
        });
      }

      if (exitInteriorBtn) {
        exitInteriorBtn.addEventListener('click', () => {
          const getInteriorEnabled = this._opts.getInteriorEnabled || (() => false);
          if (!getInteriorEnabled()) return;
          if (this._opts.setInteriorDetachRequested) this._opts.setInteriorDetachRequested(true);
          const controls = (this._opts.getInteriorControls || (() => null))();
          if (controls && typeof controls.unlock === 'function') controls.unlock();
        });
      }
    },
    computeInteriorBoxFromBin(baseInteriorBox, interiorConfig){
      if (!baseInteriorBox) return null;
      const interiorBox = baseInteriorBox.clone();
      const center = interiorBox.getCenter(new THREE.Vector3());
      const size = interiorBox.getSize(new THREE.Vector3());
      const scaleV = new THREE.Vector3(interiorConfig.scale[0] || 1, interiorConfig.scale[1] || 1, interiorConfig.scale[2] || 1);
      size.multiply(scaleV);
      const posOffset = new THREE.Vector3(interiorConfig.position[0] || 0, interiorConfig.position[1] || 0, interiorConfig.position[2] || 0);
      const half = size.clone().multiplyScalar(0.5);
      interiorBox.min.copy(center).sub(half).add(posOffset);
      interiorBox.max.copy(center).add(half).add(posOffset);
      return interiorBox;
    },
    applyBuiteVisibility(shipModel, interiorConfig){
      try {
        const buite = shipModel && shipModel.getObjectByName && shipModel.getObjectByName('buite');
        if (buite) {
          buite.visible = interiorConfig && (typeof interiorConfig.showBuiteWire !== 'undefined' ? !!interiorConfig.showBuiteWire : true);
        }
        const binneWire = shipModel && shipModel.getObjectByName && shipModel.getObjectByName('binneWire');
        if (binneWire) binneWire.visible = !!interiorConfig.debug;
      } catch (e) { /* ignore */ }
    }
    ,
    attachShipModel(opts = {}){
      // opts: { shipModel, ship, loader, setBaseInteriorBox, setPilot, setExitDoor }
      try {
        const shipModel = opts.shipModel || (this._opts.getShipModel && this._opts.getShipModel());
        const ship = opts.ship || this._opts.ship;
        const loader = opts.loader || (typeof GLTFLoader !== 'undefined' ? new GLTFLoader() : null);
        if (!shipModel || !ship) return;

        // Load optional 'buite' model but render it as wireframe only
        try {
          const _loader = loader || new GLTFLoader();
          _loader.load('buite.glb', bgl => {
            try {
              const buite = bgl.scene;
              buite.name = 'buite';
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
              shipModel.add(buite);
              buite.userData.wireframe = true;
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
                try { this.applyBuiteVisibility(shipModel, this._opts.interiorConfig || {}); } catch (e) {}
              } catch (e) { console.warn('Failed to compute buite collision boxes', e); }
            } catch (err) { console.warn('Failed to attach buite', err); }
          }, undefined, err => { console.warn('Failed to load buite.glb', err); });
        } catch (e) { console.warn('buite load error', e); }

        // Load optional 'binne' model as wireframe for interior debug
        try {
          const _loader2 = loader || new GLTFLoader();
          _loader2.load('binne.glb', bgl => {
            try {
              const binneWire = bgl.scene;
              binneWire.name = 'binneWire';
              binneWire.traverse(child => {
                if (child.isMesh) {
                  try {
                    const baseColor = (child.material && child.material.color && child.material.color.getHex) ? child.material.color.getHex() : 0x00ff00;
                    child.material = new THREE.MeshBasicMaterial({ color: baseColor, wireframe: true });
                  } catch (e) {
                    child.material = new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true });
                  }
                  child.material.needsUpdate = true;
                }
              });
              shipModel.add(binneWire);
              binneWire.userData.wireframe = true;
              try {
                const invShip = new THREE.Matrix4().copy(ship.matrixWorld).invert();
                const boxes = [];
                binneWire.updateMatrixWorld(true);
                binneWire.traverse(child => {
                  if (child.isMesh && child.geometry) {
                    const geom = child.geometry;
                    if (!geom.boundingBox) geom.computeBoundingBox();
                    const gbox = geom.boundingBox.clone();
                    child.updateMatrixWorld(true);
                    gbox.applyMatrix4(child.matrixWorld);
                    const localBox = gbox.clone().applyMatrix4(invShip);
                    boxes.push(localBox);
                  }
                });
                if (boxes.length === 0) {
                  const pos = new THREE.Vector3(); binneWire.getWorldPosition(pos);
                  const b = new THREE.Box3().setFromCenterAndSize(pos, new THREE.Vector3(1,1,1));
                  boxes.push(b.applyMatrix4(invShip));
                }
                binneWire.userData.collisionBoxes = boxes;
                binneWire.userData.collidable = true;
              } catch (e) { console.warn('Failed to compute binneWire collision boxes', e); }
            } catch (err) { console.warn('Failed to attach binneWire', err); }
          }, undefined, err => { console.warn('Failed to load binne.glb', err); });
        } catch (e) { console.warn('binneWire load error', e); }

        // Compute a fixed collision box for the `binne` node in ship-local space and hide visuals
        try {
          const bin = shipModel.getObjectByName('binne');
          if (bin) {
            const binLocalBox = new THREE.Box3();
            bin.traverse(child => {
              if (child.isMesh && child.geometry) {
                const geom = child.geometry;
                if (!geom.boundingBox) geom.computeBoundingBox();
                const gbox = geom.boundingBox.clone();
                gbox.applyMatrix4(child.matrix);
                binLocalBox.union(gbox);
              }
            });
            ship.updateMatrixWorld(true);
            bin.updateMatrixWorld(true);
            const invShip = new THREE.Matrix4().copy(ship.matrixWorld).invert();
            const binToShip = new THREE.Matrix4().multiplyMatrices(invShip, bin.matrixWorld);
            const baseInteriorBox = binLocalBox.clone().applyMatrix4(binToShip);
            this._baseInteriorBox = baseInteriorBox;
            if (opts.setBaseInteriorBox) opts.setBaseInteriorBox(baseInteriorBox);

            // Hide visual geometry of 'binne' while keeping meshes
            bin.traverse(child => {
              if (child.isMesh) {
                if (Array.isArray(child.material)) {
                  child.material = child.material.map(mat => {
                    const m = mat.clone(); m.transparent = true; m.opacity = 0; m.depthWrite = false; return m;
                  });
                } else if (child.material) {
                  const m = child.material.clone(); m.transparent = true; m.opacity = 0; m.depthWrite = false; child.material = m;
                }
                if (child.material) child.material.needsUpdate = true;
              }
            });
          }
        } catch (e) { console.warn('Failed to compute baseInteriorBox', e); }

        // expose pilot / exitDoor to host via callbacks
        try {
          const pilot = shipModel.getObjectByName && shipModel.getObjectByName('pilot');
          if (pilot && opts.setPilot) opts.setPilot(pilot);
        } catch (e) {}
        try {
          const exitDoor = shipModel.getObjectByName && shipModel.getObjectByName('EXIT');
          if (exitDoor && opts.setExitDoor) opts.setExitDoor(exitDoor);
        } catch (e) {}

      } catch (e) { console.warn('attachShipModel failed', e); }
    }
  };
  window.ShipEntry = ShipEntry;
})(window);
