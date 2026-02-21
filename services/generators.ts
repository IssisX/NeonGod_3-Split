
import { GameState, NebulaCloud, Player, BossModule } from '../types';
import { Utils } from '../utils';
import { CONFIG } from '../constants';

export function createEvolutionEffect(s: GameState, x: number, y: number, color: string) {
    // Shockwave
    s.shockwaves.push({
        x, y,
        size: 10,
        maxSize: 300,
        color: color,
        speed: 8,
        alpha: 1.0,
        width: 4
    });

    // Burst particles
    for(let i=0; i<40; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 5 + 2;
        const p = s.pools.particles.obtain();
        p.x = x; p.y = y;
        p.vx = Math.cos(angle) * speed;
        p.vy = Math.sin(angle) * speed;
        p.life = 60 + Math.random() * 40;
        p.maxLife = p.life;
        p.color = color;
        p.size = Math.random() * 3 + 2;
        p.friction = 0.95;
        p.type = 'spark';
        p.active = true;
        s.particles.push(p);
    }
}

export function generateNebula(w: number, h: number, id: number): NebulaCloud {
    return {
        x: Math.random() * w,
        y: Math.random() * h,
        radius: 300 + Math.random() * 500,
        color: `hsl(${Math.random() * 360}, 60%, 40%)`,
        opacity: 0.3 + Math.random() * 0.3,
        seed: Math.random() * 1000
    };
}

// --- MEGA STRUCTURE GENERATOR ---

interface StructureNode {
    x: number;
    y: number;
    w: number;
    h: number;
    type: 'hull' | 'corridor' | 'hub' | 'antenna';
    children: StructureNode[];
}

export class MegaStructureGenerator {
    private static cache: Map<string, HTMLCanvasElement> = new Map();

    static generate(seed: number, width: number, height: number, color: string): HTMLCanvasElement {
        const key = `${seed}-${width}-${height}-${color}`;
        if (this.cache.has(key)) return this.cache.get(key)!;

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return canvas;

        // Seeded RNG (simple LCG)
        let rngState = seed;
        const rand = () => {
            rngState = (rngState * 1664525 + 1013904223) % 4294967296;
            return (rngState / 4294967296);
        };

        // Recursive Structure Generation
        const generateNode = (x: number, y: number, w: number, h: number, depth: number): StructureNode => {
            const node: StructureNode = { x, y, w, h, type: 'hull', children: [] };
            
            if (depth <= 0 || w < 20 || h < 20) return node;

            const splitVert = w > h;
            const splitRatio = 0.3 + rand() * 0.4; // 0.3 to 0.7

            if (splitVert) {
                const w1 = w * splitRatio;
                const w2 = w - w1;
                // Add gap
                const gap = rand() < 0.3 ? 5 : 0;
                node.children.push(generateNode(x, y, w1 - gap, h, depth - 1));
                node.children.push(generateNode(x + w1 + gap, y, w2 - gap, h, depth - 1));
            } else {
                const h1 = h * splitRatio;
                const h2 = h - h1;
                const gap = rand() < 0.3 ? 5 : 0;
                node.children.push(generateNode(x, y, w, h1 - gap, depth - 1));
                node.children.push(generateNode(x, y + h1 + gap, w, h2 - gap, depth - 1));
            }

            // Randomly assign type
            if (node.children.length === 0) {
                 const t = rand();
                 if (t < 0.1) node.type = 'antenna';
                 else if (t < 0.3) node.type = 'hub';
                 else if (t < 0.5) node.type = 'corridor';
            }

            return node;
        };

        const root = generateNode(width * 0.1, height * 0.1, width * 0.8, height * 0.8, 4);

        // Rendering
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.shadowBlur = 10;
        ctx.shadowColor = color;
        
        const drawNode = (n: StructureNode) => {
            if (n.children.length > 0) {
                n.children.forEach(drawNode);
                // Connect children
                ctx.beginPath();
                ctx.moveTo(n.children[0].x + n.children[0].w/2, n.children[0].y + n.children[0].h/2);
                ctx.lineTo(n.children[1].x + n.children[1].w/2, n.children[1].y + n.children[1].h/2);
                ctx.stroke();
            } else {
                ctx.fillStyle = `rgba(0, 0, 0, 0.8)`;
                ctx.fillRect(n.x, n.y, n.w, n.h);
                ctx.strokeRect(n.x, n.y, n.w, n.h);

                // Greeble
                if (n.type === 'hub') {
                    ctx.beginPath(); ctx.arc(n.x + n.w/2, n.y + n.h/2, Math.min(n.w, n.h)*0.3, 0, Math.PI*2);
                    ctx.fillStyle = color; ctx.fill();
                } else if (n.type === 'antenna') {
                    ctx.beginPath(); ctx.moveTo(n.x + n.w/2, n.y); ctx.lineTo(n.x + n.w/2, n.y - 20); ctx.stroke();
                } else if (n.type === 'hull') {
                    // Crosshatch
                    ctx.save();
                    ctx.clip(new Path2D(`M${n.x},${n.y} h${n.w} v${n.h} h-${n.w} z`));
                    ctx.globalAlpha = 0.2;
                    for(let i=0; i<n.w + n.h; i+=10) {
                        ctx.beginPath(); ctx.moveTo(n.x + i, n.y); ctx.lineTo(n.x, n.y + i); ctx.stroke();
                    }
                    ctx.restore();
                }
            }
        };

        drawNode(root);

        this.cache.set(key, canvas);
        return canvas;
    }
}

// --- TITAN GENERATOR (BOSS) ---

export class TitanGenerator {
    static generate(type: string, wave: number): any {
         // Procedural Boss Logic
         const color = type === 'BOSS_WARLORD' ? '#ff2200' : (type === 'BOSS_HIVE' ? '#9900ff' : '#ffffff');
         const modules: BossModule[] = [];

         // Core
         modules.push({
             xOffset: 0, yOffset: 0, type: 'CORE', size: 40, color: color, rotation: 0,
             health: 1000 * wave, maxHealth: 1000 * wave,
             shape: [-20,-20, 20,-20, 20,20, -20,20]
         });

         if (type === 'BOSS_WARLORD') {
             // Wings
             modules.push({ xOffset: -60, yOffset: 0, type: 'WING', size: 30, color: color, rotation: 0, health: 500*wave, maxHealth: 500*wave, shape: [0,0, -40,-20, -40,20] });
             modules.push({ xOffset: 60, yOffset: 0, type: 'WING', size: 30, color: color, rotation: 0, health: 500*wave, maxHealth: 500*wave, shape: [0,0, 40,-20, 40,20] });
         } else if (type === 'BOSS_HIVE') {
             // Hex Grid
             for(let i=0; i<6; i++) {
                 const ang = (Math.PI*2/6)*i;
                 modules.push({ xOffset: Math.cos(ang)*50, yOffset: Math.sin(ang)*50, type: 'TURRET', size: 20, color: color, rotation: ang, health: 300*wave, maxHealth: 300*wave, shape: [-10,-10, 10,-10, 10,10, -10,10] });
             }
         }

         return modules;
    }
}
