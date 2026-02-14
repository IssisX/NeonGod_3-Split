
import { Entity } from '../types';
import { CONFIG } from '../constants';

export class SpatialGrid {
  width: number;
  height: number;
  cellSize: number;
  cols: number;
  rows: number;
  buckets: Entity[][];
  queryResult: Entity[]; // Pre-allocated result buffer

  constructor(width: number, height: number, cellSize: number) {
    this.width = width;
    this.height = height;
    this.cellSize = cellSize;
    this.cols = Math.ceil(width / cellSize);
    this.rows = Math.ceil(height / cellSize);
    this.buckets = new Array(this.cols * this.rows);
    for (let i = 0; i < this.buckets.length; i++) {
        this.buckets[i] = [];
    }
    this.queryResult = [];
  }
  
  clear() {
    for (let i = 0; i < this.buckets.length; i++) {
        this.buckets[i].length = 0; // Fast clear without reallocation
    }
  }
  
  insert(entity: Entity) {
    // Fast integer clamping
    const cx = (entity.x / this.cellSize) | 0;
    const cy = (entity.y / this.cellSize) | 0;
    
    // Safety clamp to ensure we never go out of bounds (e.g. glitches, recoil)
    const validCx = cx < 0 ? 0 : (cx >= this.cols ? this.cols - 1 : cx);
    const validCy = cy < 0 ? 0 : (cy >= this.rows ? this.rows - 1 : cy);

    this.buckets[validCy * this.cols + validCx].push(entity);
  }
  
  queryRadius(x: number, y: number, radius: number): Entity[] {
    this.queryResult.length = 0;
    
    const minCx = Math.max(0, ((x - radius) / this.cellSize) | 0);
    const maxCx = Math.min(this.cols - 1, ((x + radius) / this.cellSize) | 0);
    const minCy = Math.max(0, ((y - radius) / this.cellSize) | 0);
    const maxCy = Math.min(this.rows - 1, ((y + radius) / this.cellSize) | 0);

    for (let cy = minCy; cy <= maxCy; cy++) {
      const rowOffset = cy * this.cols;
      for (let cx = minCx; cx <= maxCx; cx++) {
        const bucket = this.buckets[rowOffset + cx];
        const len = bucket.length;
        for (let i = 0; i < len; i++) {
            this.queryResult.push(bucket[i]);
        }
      }
    }
    return this.queryResult;
  }
}

// Discretized Wave Equation Grid (Spectral-like propagation)
export class VisualGrid {
  width: number;
  height: number;
  cols: number;
  rows: number;
  cellSize: number;
  
  uCurrent: Float32Array;
  uPrev: Float32Array;
  uNext: Float32Array; 

  constructor(width: number, height: number, cellSize = CONFIG.GRID.CELL_SIZE) {
    this.width = width;
    this.height = height;
    this.cellSize = cellSize;
    this.cols = Math.ceil(width / cellSize) + 2;
    this.rows = Math.ceil(height / cellSize) + 2;
    
    const size = this.cols * this.rows;
    this.uCurrent = new Float32Array(size);
    this.uPrev = new Float32Array(size);
    this.uNext = new Float32Array(size);
  }

  applyForce(x: number, y: number, radius: number, strength: number) {
    const cx = (x / this.cellSize) | 0;
    const cy = (y / this.cellSize) | 0;
    const r = Math.ceil(radius / this.cellSize);

    for (let j = cy - r; j <= cy + r; j++) {
      for (let i = cx - r; i <= cx + r; i++) {
        if (i >= 0 && i < this.cols && j >= 0 && j < this.rows) {
          const idx = j * this.cols + i;
          const dx = (i * this.cellSize) - x;
          const dy = (j * this.cellSize) - y;
          const distSq = dx * dx + dy * dy;
          if (distSq < radius * radius) {
             const dist = Math.sqrt(distSq);
             const val = strength * (1 - dist / radius);
             this.uCurrent[idx] -= val * 0.2; 
             this.uPrev[idx] += val * 0.2; 
          }
        }
      }
    }
  }

  update(step = 1) {
    const c2 = CONFIG.GRID.WAVE_SPEED; 
    const damping = CONFIG.GRID.DAMPING;

    // Optimized loop with integer math where possible
    for (let j = 1; j < this.rows - 1; j++) {
      const rowOffset = j * this.cols;
      for (let i = 1; i < this.cols - 1; i++) {
        const idx = rowOffset + i;
        
        const u = this.uCurrent[idx];
        const laplacian = (
             this.uCurrent[idx - this.cols] + 
             this.uCurrent[idx + this.cols] + 
             this.uCurrent[idx - 1] + 
             this.uCurrent[idx + 1] - 4 * u
        );
        
        let val = 2 * u - this.uPrev[idx] + c2 * laplacian;
        val *= damping; 
        
        // Clamp to prevent instability explosion
        if (val > 1000) val = 1000;
        else if (val < -1000) val = -1000;

        this.uNext[idx] = val;
      }
    }

    const temp = this.uPrev;
    this.uPrev = this.uCurrent;
    this.uCurrent = this.uNext;
    this.uNext = temp;
  }

  render(ctx: CanvasRenderingContext2D, step = 1) {
    for (let j = 1; j < this.rows - 1; j+=step) {
      const y = j * this.cellSize;
      const rowOffset = j * this.cols;
      
      for (let i = 1; i < this.cols - 1; i+=step) {
        const idx = rowOffset + i;
        const val = this.uCurrent[idx];
        
        if (Math.abs(val) > 0.5) {
          const x = i * this.cellSize;
          const intensity = Math.min(1.0, Math.abs(val) / 60);
          const alpha = intensity * 0.6;
          
          ctx.fillStyle = `rgba(0, ${Math.floor(200 + val)}, 255, ${alpha})`;
          const size = Math.min(8, 2 + intensity * 6);
          ctx.fillRect(x - size/2, y - size/2, size, size);
        }
      }
    }
  }
}
