export default class AudioSystem {
  constructor(opts = {}) {
    this.ambientSrc = opts.ambientSrc || 'sounds/ambient.mp3';
    this.outsideSrc = opts.outsideSrc || 'sounds/outside.mp3';
    this.volume = typeof opts.volume === 'number' ? opts.volume : 0.6;
    this.fade_ms = typeof opts.fade_ms === 'number' ? opts.fade_ms : 600;
    this._inited = false;
    this._target = null;
    this._current = null;

    this.eventMap = {
      poweroff: opts.poweroffSrc || 'sounds/power off.mp3',
      powerup: opts.powerupSrc || 'sounds/poweringup.mp3',
      door: opts.doorSrc || 'sounds/door.mp3'
    };
    this._queued = [];

    // WebAudio pieces
    this.ctx = null;
    this.ambientBuffer = null;
    this.outsideBuffer = null;
    this.ambientSource = null;
    this.outsideSource = null;
    this.ambientGain = null;
    this.outsideGain = null;
    this._eventBuffers = {};
  }

  async init() {
    if (this._inited) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) throw new Error('WebAudio not supported');
      this.ctx = new AC();
      // resume context (required on some browsers after gesture)
      if (typeof this.ctx.resume === 'function') await this.ctx.resume();

      // fetch and decode main loop buffers in parallel
      const fetchBuffer = async (url) => {
        const r = await fetch(url);
        const ab = await r.arrayBuffer();
        return await this.ctx.decodeAudioData(ab.slice(0));
      };

      const [ambBuf, outBuf] = await Promise.all([
        fetchBuffer(this.ambientSrc),
        fetchBuffer(this.outsideSrc)
      ]);
      this.ambientBuffer = ambBuf;
      this.outsideBuffer = outBuf;

      // create gain nodes
      this.ambientGain = this.ctx.createGain();
      this.outsideGain = this.ctx.createGain();
      this.ambientGain.gain.setValueAtTime(0, this.ctx.currentTime);
      this.outsideGain.gain.setValueAtTime(0, this.ctx.currentTime);
      // master connect
      this.ambientGain.connect(this.ctx.destination);
      this.outsideGain.connect(this.ctx.destination);

      // start loop sources (gapless via AudioBufferSourceNode.loop)
      this._startLoopSources();

      // preload event buffers
      for (const k of Object.keys(this.eventMap)) {
        try {
          const r = await fetch(this.eventMap[k]);
          const ab = await r.arrayBuffer();
          this._eventBuffers[k] = await this.ctx.decodeAudioData(ab.slice(0));
        } catch (e) { /* ignore individual failures */ }
      }

      // set ambient audible immediately
      this._setGains({ ambient: this.volume, outside: 0 });
      this._current = 'ambient';
      this._target = 'ambient';

      // play any queued events
      if (this._queued.length > 0) {
        for (const ev of this._queued) this.playOnce(ev);
        this._queued = [];
      }

      this._inited = true;
    } catch (err) {
      console.warn('AudioSystem init failed', err);
    }
  }

  _startLoopSources() {
    if (!this.ctx) return;
    // stop existing sources if any
    try { if (this.ambientSource) { this.ambientSource.stop(0); } } catch (e) {}
    try { if (this.outsideSource) { this.outsideSource.stop(0); } } catch (e) {}

    if (this.ambientBuffer) {
      this.ambientSource = this.ctx.createBufferSource();
      this.ambientSource.buffer = this.ambientBuffer;
      this.ambientSource.loop = true;
      this.ambientSource.connect(this.ambientGain);
      this.ambientSource.start(0);
    }
    if (this.outsideBuffer) {
      this.outsideSource = this.ctx.createBufferSource();
      this.outsideSource.buffer = this.outsideBuffer;
      this.outsideSource.loop = true;
      this.outsideSource.connect(this.outsideGain);
      this.outsideSource.start(0);
    }
  }

  setOutside(isOutside) {
    const want = isOutside ? 'outside' : 'ambient';
    if (want === this._target) return;
    this._target = want;
    this._fadeTo(want, this.fade_ms);
  }

  _fadeTo(target, ms = 600) {
    if (!this.ctx || !this.ambientGain || !this.outsideGain) return;
    const now = this.ctx.currentTime;
    const dur = Math.max(0.02, ms / 1000);
    const toA = target === 'ambient' ? this.volume : 0;
    const toO = target === 'outside' ? this.volume : 0;
    try {
      this.ambientGain.gain.cancelScheduledValues(now);
      this.outsideGain.gain.cancelScheduledValues(now);
      this.ambientGain.gain.setValueAtTime(this.ambientGain.gain.value || 0, now);
      this.outsideGain.gain.setValueAtTime(this.outsideGain.gain.value || 0, now);
      this.ambientGain.gain.linearRampToValueAtTime(toA, now + dur);
      this.outsideGain.gain.linearRampToValueAtTime(toO, now + dur);
      this._current = target;
    } catch (e) { /* ignore */ }
  }

  _setGains({ ambient = 0, outside = 0 } = {}) {
    if (!this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      this.ambientGain.gain.setValueAtTime(ambient, now);
      this.outsideGain.gain.setValueAtTime(outside, now);
    } catch (e) {}
  }

  playOnce(name, opts = {}) {
    if (!name) return;
    if (!this._inited) {
      this._queued.push(name);
      return;
    }
    try {
      const buf = this._eventBuffers[name];
      if (!buf) {
        // fallback to HTMLAudio if not decoded (no muffling available)
        const src = this.eventMap[name];
        if (src) {
          const a = new Audio(src);
          a.volume = Math.min(1, this.volume * (opts.boost || 1));
          a.play().catch(() => {});
        }
        return;
      }
      const now = this.ctx.currentTime;
      const srcNode = this.ctx.createBufferSource();
      srcNode.buffer = buf;
      const g = this.ctx.createGain();
      // make door/event sounds slightly louder so they cut through
      const eventGain = Math.min(1, this.volume * (opts.boost || 1.1));
      g.gain.setValueAtTime(eventGain, now);

      if (opts.muffled) {
        // insert a lowpass filter to simulate muffling when heard from outside
        const f = this.ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.setValueAtTime(typeof opts.cutoff === 'number' ? opts.cutoff : 900, now);
        f.Q.setValueAtTime(typeof opts.q === 'number' ? opts.q : 0.7, now);
        srcNode.connect(f);
        f.connect(g);
      } else {
        srcNode.connect(g);
      }
      g.connect(this.ctx.destination);
      srcNode.start(0);
      // schedule disconnect after buffer duration
      try {
        const dur = srcNode.buffer ? srcNode.buffer.duration : 4;
        setTimeout(() => { try { srcNode.disconnect(); g.disconnect(); } catch (e) {} }, (dur + 0.1) * 1000);
      } catch (e) {}
    } catch (e) { /* ignore */ }
  }
}
