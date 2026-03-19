// shipControls.js
// Handles keyboard/mouse input and autopilot button wiring.
 (function(window){
  const ShipControls = {
    _opts: {},
    init(opts = {}){
      this._opts = opts;
      // defaults
      if (!this._opts.move) this._opts.move = { forward:0, right:0, up:0 };
      if (!this._opts.velocity) this._opts.velocity = new THREE.Vector3();
      if (!this._opts.frameState) this._opts.frameState = { frameCounter: 0 };

      // movement key handling is left to main.js; shipControls only handles mouse and autopilot

      // pointer-mouse handling for yaw/pitch is handled by main.js; shipControls reads `target`.

      const autopilotBtn = document.getElementById('autopilotBtn');
      if (autopilotBtn) {
        autopilotBtn.addEventListener('click', () => {
          try {
            if (this._opts.powerOut) {
              try { if (this._opts.interactHint) { this._opts.interactHint.textContent = 'No power — autopilot disabled'; this._opts.interactHint.style.display = 'block'; setTimeout(() => { try { this._opts.interactHint.style.display = 'none'; } catch(e){} }, 1200); } } catch (e) {}
              return;
            }
            if (!this._opts.getInteriorEnabled || !this._opts.getInteriorEnabled()) return;
            this._opts.setInteriorAutoThrust && this._opts.setInteriorAutoThrust(!this._opts.getInteriorAutoThrust());
            autopilotBtn.textContent = (this._opts.getInteriorAutoThrust && this._opts.getInteriorAutoThrust()) ? 'Autopilot: On' : 'Autopilot: Off';
            autopilotBtn.style.background = (this._opts.getInteriorAutoThrust && this._opts.getInteriorAutoThrust()) ? 'rgba(0,100,0,0.7)' : 'rgba(0,0,0,0.6)';
          } catch (e) {}
        });
      }
    },
    update(dt){
      // physics and flight updates moved here
      const opts = this._opts;
      if (!opts) return;
      try {
        // smooth yaw/pitch
        opts.yaw = opts.yaw + (opts.target.yaw - opts.yaw) * Math.min(1, (opts.ROTATION_DAMPING || 6.0) * dt);
        opts.pitch = opts.pitch + (opts.target.pitch - opts.pitch) * Math.min(1, (opts.ROTATION_DAMPING || 6.0) * dt);

        const shipEuler = new THREE.Euler(opts.pitch, opts.yaw, 0, 'YXZ');
        const shipQuat = new THREE.Quaternion().setFromEuler(shipEuler);
        const forwardVec = new THREE.Vector3(0,0,-1).applyQuaternion(shipQuat);
        const rightVec = new THREE.Vector3(1,0,0).applyQuaternion(shipQuat);
        const upVec = new THREE.Vector3(0,1,0).applyQuaternion(shipQuat);

        const accelVec = new THREE.Vector3();
        const shipModel = opts.getShipModel ? opts.getShipModel() : opts.shipModel;
        // engine health influence
        let effectiveACCEL = opts.ACCEL || 360;
        let effectiveMAX_SPEED = opts.MAX_SPEED || 1600;
        try {
          const systems = opts.getShipSystems ? opts.getShipSystems() : null;
          const engVal = systems && systems.engine ? systems.engine.value : 100;
          if (engVal < 25) {
            if (opts.getFlyEnabled && opts.getFlyEnabled()) {
              opts.setFlyEnabled && opts.setFlyEnabled(false);
              try { opts.velocity.set(0,0,0); } catch (e) {}
              opts.move.forward = opts.move.right = opts.move.up = 0;
              try { if (opts.controls && opts.controls.isLocked) { opts.lockRequest = null; opts.controls.unlock(); } } catch (e) {}
              try { if (opts.interactHint) { opts.interactHint.textContent = 'Engine critically damaged — flight disabled'; opts.interactHint.style.display = 'block'; setTimeout(() => { try { opts.interactHint.style.display = 'none'; } catch(e){} }, 1800); } } catch (e) {}
            }
            effectiveACCEL = 0; effectiveMAX_SPEED = 0;
          } else {
            const frac = Math.max(0, engVal / 100);
            effectiveACCEL = (opts.ACCEL || 360) * frac;
            effectiveMAX_SPEED = (opts.MAX_SPEED || 1600) * frac;
          }
        } catch (e) {}

        // thrust application
        if (!opts.getPowerOut || !opts.getPowerOut()) {
          if (opts.getFlyEnabled && opts.getFlyEnabled() && !opts.getInteriorEnabled()) {
            accelVec.addScaledVector(forwardVec, opts.move.forward * effectiveACCEL);
            accelVec.addScaledVector(rightVec, opts.move.right * effectiveACCEL * 0.6);
            accelVec.addScaledVector(upVec, opts.move.up * effectiveACCEL * 0.6);
          }
          const AUTO_THRUST = 320;
          if (opts.getInteriorEnabled && opts.getInteriorEnabled() && opts.getInteriorAutoThrust && opts.getInteriorAutoThrust()) {
            accelVec.addScaledVector(forwardVec, AUTO_THRUST);
          }
        } else {
          try { opts.velocity.set(0,0,0); } catch (e) {}
        }

        // integrate
        opts.velocity.addScaledVector(accelVec, dt);
        const dragFactor = Math.max(0, 1 - (opts.DRAG || 0.6) * dt);
        opts.velocity.multiplyScalar(dragFactor);
        if (effectiveMAX_SPEED > 0) {
          if (opts.velocity.lengthSq() > (effectiveMAX_SPEED*effectiveMAX_SPEED)) opts.velocity.setLength(effectiveMAX_SPEED);
        } else {
          try { opts.velocity.set(0,0,0); } catch (e) {}
        }

        // move ship
        if (opts.ship) opts.ship.position.addScaledVector(opts.velocity, dt);

        // stars parallax and FOV
        const speedFrac = (typeof effectiveMAX_SPEED !== 'undefined' && effectiveMAX_SPEED > 0) ? Math.min(1, opts.velocity.length() / effectiveMAX_SPEED) : 0;
        const parallaxScale = 0.12 + speedFrac * 1.4;
        const shift = opts.velocity.clone().multiplyScalar(-parallaxScale * dt);
        if (opts.activeCamera && opts.nearStars) {
          const camPos = new THREE.Vector3(); opts.activeCamera.getWorldPosition(camPos);
          opts.nearStars.position.copy(camPos);
        }
        if (opts.BASE_FOV && opts.camera) {
          const fovValue = (opts.BASE_FOV || 75) + speedFrac * 18;
          try { opts.camera.fov = fovValue; opts.camera.updateProjectionMatrix(); } catch (e) {}
        }

        // recycle stars
        try {
          opts.frameState.frameCounter = (opts.frameState.frameCounter || 0) + 1;
          if ((opts.frameState.frameCounter & 3) === 0 && opts.nearGeo && opts.randPointInSphere) {
            const attr = opts.nearGeo.getAttribute('position');
            for (let i = 0; i < attr.count; i++) {
              let lx = attr.getX(i) + shift.x;
              let ly = attr.getY(i) + shift.y;
              let lz = attr.getZ(i) + shift.z;
              const d2 = lx*lx + ly*ly + lz*lz;
              if (d2 > (opts._replaceRadiusSq || ( (opts.NEAR_STAR_RADIUS||600)*1.25 )*((opts.NEAR_STAR_RADIUS||600)*1.25) )) {
                const p = opts.randPointInSphere(opts.NEAR_STAR_RADIUS || 600, opts.MIN_NEAR_STAR_DISTANCE || 30);
                lx = p[0]; ly = p[1]; lz = p[2];
              }
              attr.setXYZ(i, lx, ly, lz);
            }
            attr.needsUpdate = true;
          }
        } catch (e) {}

        // rotate ship toward shipQuat
        try { if (opts.ship && opts.ship.quaternion && shipQuat) opts.ship.quaternion.slerp(shipQuat, Math.min(1, (opts.ROTATION_DAMPING||6.0) * dt)); } catch (e) {}

        // banking
        try {
          const localVel = opts.velocity.clone().applyQuaternion((opts.ship && opts.ship.quaternion) ? opts.ship.quaternion.clone().invert() : new THREE.Quaternion());
          const bank = THREE.MathUtils.clamp(-localVel.x / 60, -1, 1) * (opts.BANK_AMOUNT || 0.9);
          if (opts.shipModel) {
            opts.shipModel.rotation.z += (bank - (opts.shipModel.rotation.z || 0)) * Math.min(1, 6 * dt);
          }
        } catch (e) {}

        // camera follow
        try {
          if (opts.cameraPivot) {
            const desiredCamPos = new THREE.Vector3(0, 2, 10);
            opts.cameraPivot.position.lerp(desiredCamPos, Math.min(1, 6 * dt));
          }
          if (opts.ship && opts.camera) {
            const lookAtPos = opts.ship.position.clone().add(forwardVec.clone().multiplyScalar(30));
            opts.camera.lookAt(lookAtPos);
          }
        } catch (e) {}

        // choose active camera
        if (opts.getInteriorEnabled && opts.getInteriorEnabled()) {
          opts.activeCamera = opts.fpCamera || opts.camera;
        } else {
          opts.activeCamera = opts.camera || opts.fpCamera;
        }

        // buite/binne visibility toggles left in main loop or handled elsewhere
      } catch (e) { console.warn('ShipControls.update failed', e); }
    }
  };
  window.ShipControls = ShipControls;
})(window);
