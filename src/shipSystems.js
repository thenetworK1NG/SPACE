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
    this._circuitsLowDispatched = false;
  }

  start() {
    if (this._interval) return;
    // Every few seconds randomly reduce one system by a small amount
    this._interval = setInterval(() => {
      const keys = Object.keys(this.systems);
      const chosen = keys[Math.floor(Math.random() * keys.length)];
      // circuits should degrade faster than other systems
      let decay;
      if (chosen === 'circuits') {
        // larger random decay for circuits when picked
        decay = Math.random() * 3.2 + 0.8; // ~0.8 - 4.0 percent
      } else {
        decay = Math.random() * 1.8 + 0.2; // 0.2 - 2.0 percent
      }
      this.systems[chosen].value = Math.max(0, this.systems[chosen].value - decay);
      this._checkCircuitsLow();
    }, 4000 + Math.floor(Math.random() * 2000)); // 4-6s intervals (slows a bit by random)

    // Additional dedicated circuits drain so circuits decline noticeably faster
    this._circuitsInterval = setInterval(() => {
      if (!this.systems || !this.systems.circuits) return;
      const extra = Math.random() * 1.6 + 0.6; // 0.6 - 2.2%
      this.systems.circuits.value = Math.max(0, this.systems.circuits.value - extra);
      this._checkCircuitsLow();
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
