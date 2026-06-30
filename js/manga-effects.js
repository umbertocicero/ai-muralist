import * as THREE from 'three';

// ===========================================================================
//  MANGA EFFECTS — Additional dramatic manga-style visual effects
//  Speed lines, impact effects, and dynamic atmosphere enhancements
// ===========================================================================

// Create speed line texture for dramatic motion effects
function speedLineTexture() {
  const w = 4, h = 256;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  
  // Vertical gradient for speed line
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(0,0,0,0.85)');
  g.addColorStop(0.7, 'rgba(0,0,0,0.15)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  
  const tex = new THREE.CanvasTexture(cv);
  tex.needsUpdate = true;
  return tex;
}

// Radial speed lines emanating from a point (classic manga focus effect)
export class SpeedLines {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.lines = [];
    
    const tex = speedLineTexture();
    const N = 24; // number of radial lines
    
    for (let i = 0; i < N; i++) {
      const len = 80 + Math.random() * 40;
      const wid = 0.3 + Math.random() * 0.4;
      const geo = new THREE.PlaneGeometry(wid, len);
      geo.translate(0, len / 2, 0); // pivot at center
      
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        color: 0x000000,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      
      const line = new THREE.Mesh(geo, mat);
      const angle = (i / N) * Math.PI * 2;
      line.rotation.z = angle;
      line._baseOpacity = 0.15 + Math.random() * 0.1;
      line._phase = Math.random() * Math.PI * 2;
      
      this.lines.push(line);
      this.group.add(line);
    }
    
    this.group.renderOrder = 1000;
    this.scene.add(this.group);
    this.enabled = false;
  }
  
  // Position speed lines at a point (e.g., when painting)
  setPosition(x, y, z) {
    this.group.position.set(x, y, z);
  }
  
  // Show/hide speed lines with intensity
  setIntensity(intensity) {
    this.enabled = intensity > 0;
    for (const line of this.lines) {
      line.material.opacity = line._baseOpacity * intensity;
    }
  }
  
  update(t, camera) {
    if (!this.enabled) return;
    if (camera) this.group.lookAt(camera.position);
    
    // Subtle pulsing animation
    for (const line of this.lines) {
      const pulse = 0.85 + 0.15 * Math.sin(t * 2 + line._phase);
      line.material.opacity = line._baseOpacity * pulse;
    }
  }
}

// Floating dust motes for atmospheric depth (manga atmosphere particles)
export class DustMotes {
  constructor(scene, count = 200) {
    const positions = new Float32Array(count * 3);
    const velocities = [];
    
    for (let i = 0; i < count; i++) {
      // Scatter in a large volume
      positions[i * 3]     = (Math.random() - 0.5) * 100;
      positions[i * 3 + 1] = Math.random() * 40;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 100;
      
      velocities.push({
        x: (Math.random() - 0.5) * 0.3,
        y: (Math.random() - 0.5) * 0.2,
        z: (Math.random() - 0.5) * 0.3,
      });
    }
    
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    
    const mat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.15,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    
    this.motes = new THREE.Points(geo, mat);
    this.motes.renderOrder = 996;
    this.velocities = velocities;
    this.count = count;
    scene.add(this.motes);
  }
  
  update(dt) {
    const pos = this.motes.geometry.attributes.position.array;
    
    for (let i = 0; i < this.count; i++) {
      const vel = this.velocities[i];
      pos[i * 3]     += vel.x * dt;
      pos[i * 3 + 1] += vel.y * dt;
      pos[i * 3 + 2] += vel.z * dt;
      
      // Wrap around
      if (Math.abs(pos[i * 3]) > 50) pos[i * 3] *= -0.9;
      if (pos[i * 3 + 1] > 40) pos[i * 3 + 1] = 0;
      if (pos[i * 3 + 1] < 0) pos[i * 3 + 1] = 40;
      if (Math.abs(pos[i * 3 + 2]) > 50) pos[i * 3 + 2] *= -0.9;
    }
    
    this.motes.geometry.attributes.position.needsUpdate = true;
  }
}

// Ink splatter effect for dramatic moments
export class InkSplatter {
  constructor(scene) {
    this.scene = scene;
    this.splatters = [];
  }
  
  // Trigger an ink splatter at a position
  trigger(x, y, z) {
    const geo = new THREE.SphereGeometry(0.1, 8, 8);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.8,
    });
    
    const splat = new THREE.Mesh(geo, mat);
    splat.position.set(x, y, z);
    splat._life = 1.0;
    splat._scale = 0.1;
    
    this.scene.add(splat);
    this.splatters.push(splat);
  }
  
  update(dt) {
    for (let i = this.splatters.length - 1; i >= 0; i--) {
      const splat = this.splatters[i];
      splat._life -= dt * 0.5;
      splat._scale += dt * 2;
      
      splat.scale.setScalar(splat._scale);
      splat.material.opacity = Math.max(0, splat._life * 0.8);
      
      if (splat._life <= 0) {
        this.scene.remove(splat);
        splat.geometry.dispose();
        splat.material.dispose();
        this.splatters.splice(i, 1);
      }
    }
  }
}
