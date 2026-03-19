// Simple ship systems module — slowly degrades systems over time
export default class ShipSystems {
  constructor() {
    this.systems = {
      oxygen: { label: 'Oxygen generator', value: 100 },
      water: { label: 'Water recycling unit', value: 100 },
      engine: { label: 'Engine manifolds', value: 100 },
      circuits: { label: 'Circuit breaker panels', value: 100 }
    };
    this._interval = null;
    this._circuitsInterval = null;
    this._engineInterval = null;
    this._circuitsLowDispatched = false;
  }

  start() {
    if (this._interval) return;
    // Every few seconds randomly reduce one system by a small amount
    this._interval = setInterval(() => {
      const keys = Object.keys(this.systems);
      const chosen = keys[Math.floor(Math.random() * keys.length)];
      // Engine should degrade faster; circuits will be slower than before.
      let decay;
      if (chosen === 'engine') {
        // larger random decay for engine when picked (fast)
        decay = Math.random() * 3.6 + 1.0; // ~1.0 - 4.6 percent
      } else if (chosen === 'circuits') {
        // reduced decay for circuits so they don't run out so fast
        decay = Math.random() * 3.6 + 1.0; // ~0.2 - 1.4 percent
      } else {
        decay = Math.random() * 1.8 + 0.2; // 0.2 - 2.0 percent
      }
      this.systems[chosen].value = Math.max(0, this.systems[chosen].value - decay);
      this._checkCircuitsLow();
    }, 4000 + Math.floor(Math.random() * 2000)); // 4-6s intervals (slows a bit by random)

    // Additional dedicated circuits drain reduced so circuits decline slower
    this._circuitsInterval = setInterval(() => {
      if (!this.systems || !this.systems.circuits) return;
      const extra = Math.random() * 4.3 + 2.9; // ~0.1 - 0.7%
      this.systems.circuits.value = Math.max(0, this.systems.circuits.value - extra);
      this._checkCircuitsLow();
    }, 5000);

    // Additional dedicated engine drain remains relatively aggressive
    this._engineInterval = setInterval(() => {
      if (!this.systems || !this.systems.engine) return;
      const extraE = Math.random() * 1.6 + 0.6; // 0.6 - 2.2%
      this.systems.engine.value = Math.max(0, this.systems.engine.value - extraE);
    }, 3000);
  }

  stop() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
    if (this._circuitsInterval) {
      clearInterval(this._circuitsInterval);
      this._circuitsInterval = null;
    }
    if (this._engineInterval) {
      clearInterval(this._engineInterval);
      this._engineInterval = null;
    }
  }

  _checkCircuitsLow() {
    if (!this.systems || !this.systems.circuits) return;
    const v = this.systems.circuits.value;
    if (v < 50 && !this._circuitsLowDispatched) {
      this._circuitsLowDispatched = true;
      try {
        window.dispatchEvent(new CustomEvent('circuits:low', { detail: { value: v } }));
      } catch (e) { /* ignore */ }
    } else if (v >= 50 && this._circuitsLowDispatched) {
      // circuits were low and have now been restored above threshold
      this._circuitsLowDispatched = false;
      try {
        window.dispatchEvent(new CustomEvent('circuits:restored', { detail: { value: v } }));
      } catch (e) { /* ignore */ }
    }
  }

  getAll() {
    // return a shallow copy so external code doesn't mutate directly
    const out = {};
    for (const k of Object.keys(this.systems)) {
      out[k] = { label: this.systems[k].label, value: Math.max(0, this.systems[k].value) };
    }
    return out;
  }

  repair(key, amount = 10) {
    if (this.systems[key]) this.systems[key].value = Math.min(100, this.systems[key].value + amount);
  }
}
