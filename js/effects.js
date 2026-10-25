'use strict';
/* =========================================================
 * 视觉特效：炮口火花、撞墙火花、爆炸、屏幕震动
 * ========================================================= */

class Effects {
  constructor() {
    this.particles = [];
    this.rings = [];
    this.flashes = [];
  }

  clear() {
    this.particles.length = 0;
    this.rings.length = 0;
    this.flashes.length = 0;
  }

  addParticle(x, y, vx, vy, life, size, color, drag) {
    if (this.particles.length > 420) return;
    this.particles.push({ x, y, vx, vy, life, maxLife: life, size, color, drag: drag === undefined ? 0.92 : drag });
  }

  muzzle(x, y, angle, color) {
    this.flashes.push({ x, y, angle, life: 0.07, maxLife: 0.07, color });
    for (let i = 0; i < 4; i++) {
      const a = angle + (Math.random() - 0.5) * 0.7;
      const sp = 55 + Math.random() * 90;
      this.addParticle(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.12 + Math.random() * 0.1, 2.2, '#FFD86B', 0.86);
    }
  }

  wallHit(x, y, nx, ny, color) {
    for (let i = 0; i < 4; i++) {
      const a = Math.atan2(ny, nx) + (Math.random() - 0.5) * 1.9;
      const sp = 40 + Math.random() * 110;
      this.addParticle(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.16 + Math.random() * 0.14, 1.8, color, 0.9);
    }
    this.rings.push({ x, y, r: 2, maxR: 9, life: 0.16, maxLife: 0.16, color, width: 1.6 });
  }

  sparkBurst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const sp = 50 + Math.random() * 140;
      this.addParticle(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.2 + Math.random() * 0.2, 2, '#FFE08A', 0.9);
    }
  }

  explosion(x, y, color) {
    this.rings.push({ x, y, r: 6, maxR: 74, life: 0.55, maxLife: 0.55, color: '#FFC24A', width: 4 });
    this.rings.push({ x, y, r: 2, maxR: 46, life: 0.4, maxLife: 0.4, color: '#FFFFFF', width: 2.5 });
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * TAU;
      const sp = 60 + Math.random() * 260;
      const hot = Math.random() < 0.55;
      this.addParticle(
        x, y,
        Math.cos(a) * sp, Math.sin(a) * sp,
        0.35 + Math.random() * 0.45,
        2 + Math.random() * 3.4,
        hot ? '#FFCF5A' : color,
        0.9
      );
    }
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * TAU;
      const sp = 20 + Math.random() * 70;
      this.addParticle(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.6 + Math.random() * 0.5, 5 + Math.random() * 5, 'rgba(90,90,90,0.45)', 0.94);
    }
  }

  update(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      const d = Math.pow(p.drag, dt * 60);
      p.vx *= d; p.vy *= d;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      if (r.life <= 0) { this.rings.splice(i, 1); continue; }
      const k = 1 - r.life / r.maxLife;
      r.r = 2 + (r.maxR - 2) * k;
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life -= dt;
      if (f.life <= 0) this.flashes.splice(i, 1);
    }
  }

  render(ctx) {
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i];
      const k = r.life / r.maxLife;
      ctx.globalAlpha = k * 0.85;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, TAU);
      ctx.lineWidth = r.width * k + 0.4;
      ctx.strokeStyle = r.color;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      const k = p.life / p.maxLife;
      ctx.globalAlpha = Math.min(1, k * 1.5);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.35 + 0.65 * k), 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (let i = 0; i < this.flashes.length; i++) {
      const f = this.flashes[i];
      const k = f.life / f.maxLife;
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(f.angle);
      ctx.globalAlpha = k;
      ctx.fillStyle = '#FFE9A8';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(13, -6);
      ctx.lineTo(20, 0);
      ctx.lineTo(13, 6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
}

class Sound {
  constructor(enabled) {
    this.enabled = enabled !== false;
    this.ctx = null;
    this.master = null;
    this.noise = null;
  }

  ensure() {
    if (this.ctx) return;
    try {
      const AC = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.22;
      this.master.connect(this.ctx.destination);
    } catch (e) {
      this.ctx = null;
    }
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  noiseBuffer() {
    if (this.noise) return this.noise;
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * 0.4);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    this.noise = buffer;
    return buffer;
  }

  blip(freq, endFreq, duration, type, gainValue) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + duration);
    gain.gain.setValueAtTime(gainValue, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  play(name) {
    if (!this.enabled) return;
    this.ensure();
    if (!this.ctx) return;
    this.resume();
    try {
      switch (name) {
        case 'shoot': this.blip(360, 90, 0.11, 'square', 0.22); break;
        case 'bounce': this.blip(1200, 600, 0.05, 'triangle', 0.10); break;
        case 'explosion': {
          const ctx = this.ctx;
          const t = ctx.currentTime;
          const src = ctx.createBufferSource();
          src.buffer = this.noiseBuffer();
          const filter = ctx.createBiquadFilter();
          filter.type = 'lowpass';
          filter.frequency.setValueAtTime(900, t);
          filter.frequency.exponentialRampToValueAtTime(120, t + 0.4);
          const gain = ctx.createGain();
          gain.gain.setValueAtTime(0.5, t);
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
          src.connect(filter); filter.connect(gain); gain.connect(this.master);
          src.start(t);
          src.stop(t + 0.45);
          this.blip(140, 40, 0.35, 'sine', 0.25);
          break;
        }
        case 'win':
          this.blip(523, 523, 0.16, 'triangle', 0.2);
          setTimeout(() => { if (this.ctx) this.blip(784, 784, 0.22, 'triangle', 0.2); }, 150);
          break;
        case 'lose':
          this.blip(330, 200, 0.25, 'sawtooth', 0.16);
          setTimeout(() => { if (this.ctx) this.blip(220, 110, 0.4, 'sawtooth', 0.16); }, 180);
          break;
        case 'ui': this.blip(660, 880, 0.05, 'square', 0.10); break;
        case 'pickup':
          this.blip(700, 1100, 0.08, 'sine', 0.16);
          setTimeout(() => { if (this.ctx) this.blip(1100, 1500, 0.10, 'sine', 0.14); }, 70);
          break;
        case 'laser':
          this.blip(1800, 220, 0.18, 'sawtooth', 0.16);
          break;
        case 'split':
          this.blip(320, 90, 0.14, 'square', 0.16);
          break;
        case 'mine':
          this.blip(220, 70, 0.10, 'square', 0.14);
          break;
        case 'emp':
          this.blip(1500, 260, 0.26, 'sine', 0.18);
          break;
        default: break;
      }
    } catch (e) { /* 音频失败不影响游戏 */ }
  }
}
