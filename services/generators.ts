
import { GameState, BossModule, Enemy, GameCallbacks, NebulaCloud } from '../types';
import { CONFIG } from '../constants';
import { Utils } from '../utils';

// --- GEOMETRY CONSTANTS ---

const SHAPES = {
    CORE: [
        [-20, -20, 20, -20, 20, 20, -20, 20], // Box
        [-20, -30, 20, -30, 30, 0, 20, 30, -20, 30, -30, 0], // Hex
        [0, -30, 25, 20, 0, 40, -25, 20] // Diamond
    ],
    WING: [
        [0, 0, 40, -20, 50, 10, 20, 30], // Swept
        [0, -10, 30, -30, 30, 30, 0, 10], // Broad
        [0, 0, 60, -10, 40, 20] // Needle
    ],
    TURRET: [
        [-8, -8, 8, -8, 8, 8, -8, 8], // Box Turret
        [0, -15, 10, 10, -10, 10], // Triangle Turret
        [-5, -10, 5, -10, 5, 10, -5, 10] // Railgun mount
    ],
    SHIELD: [
        [-10, -30, 10, -30, 20, 0, 10, 30, -10, 30], // Plate
        [0, -40, 15, -20, 15, 20, 0, 40] // Curved
    ],
    SPIKE: [
        [0, 0, 10, -40, 20, 0], // Simple Spike
        [0, 0, 5, -50, 15, -10, 25, 0] // Serrated
    ],
    ENGINE: [
        [-15, -20, 15, -20, 20, 20, -20, 20], // Thruster Block
        [-10, -30, 10, -30, 15, 10, -15, 10], // Exhaust Port
        [0, -25, 12, 15, -12, 15] // Triangle Drive
    ]
};

function getShape(type: keyof typeof SHAPES, variant: number): number[] {
    const list = SHAPES[type];
    if (!list) return SHAPES.CORE[0]; // Fail-safe fallback
    return list[Math.abs(Math.floor(variant)) % list.length];
}

// --- TITAN-FRAME BOSS GENERATOR ---

class TitanGenerator {
    rng: () => number;
    wave: number;

    constructor(seed: number, wave: number) {
        this.wave = wave;
        let s = seed;
        this.rng = () => {
            s = (s * 9301 + 49297) % 233280;
            return s / 233280;
        };
    }

    range(min: number, max: number) { return min + this.rng() * (max - min); }
    int(min: number, max: number) { return Math.floor(this.range(min, max)); }
    pick<T>(arr: T[]): T { return arr[this.int(0, arr.length)]; }

    generate(): { modules: BossModule[], name: string, stats: any } {
        const modules: BossModule[] = [];
        const coreSize = 50 + Math.min(100, this.wave * 5);
        
        // 1. CORE
        const coreColor = this.pick(['#ff0000', '#ff5500', '#ff00ff', '#ffffff']);
        const coreShapeIdx = this.int(0, SHAPES.CORE.length);
        
        modules.push({
            xOffset: 0, yOffset: 0, type: 'CORE', 
            size: coreSize, color: coreColor, rotation: 0, 
            health: 1, maxHealth: 1, 
            shape: getShape('CORE', coreShapeIdx)
        });

        // 2. ARCHITECTURE (Symmetry)
        const symmetry = this.pick([2, 3, 4, 6]);
        const tiers = this.int(1, 3 + Math.floor(this.wave / 5));
        
        const adjectives = ['VOID', 'OMEGA', 'APEX', 'ZERO', 'INFINITE', 'IRON', 'STEEL', 'NEON', 'HYPER'];
        const nouns = ['TITAN', 'DREADNOUGHT', 'WARDEN', 'GUARDIAN', 'EXECUTIONER', 'SERAPH', 'COLOSSUS'];
        const name = `${this.pick(adjectives)}-${this.pick(nouns)} MK.${this.wave}`;

        for (let t = 0; t < tiers; t++) {
            const dist = coreSize * (0.8 + t * 0.6);
            const type = this.pick(['TURRET', 'SHIELD', 'WING', 'SPIKE', 'ENGINE']);
            
            // Tier-specific props
            let tierColor = coreColor;
            if (type === 'SHIELD') tierColor = '#00ccff';
            if (type === 'TURRET') tierColor = '#ffaa00';
            if (type === 'SPIKE') tierColor = '#cccccc';
            if (type === 'ENGINE') tierColor = '#ffaa44';

            const angleOffset = this.range(0, Math.PI);

            for (let i = 0; i < symmetry; i++) {
                const angle = (Math.PI * 2 / symmetry) * i + angleOffset;
                
                modules.push({
                    xOffset: Math.cos(angle) * dist,
                    yOffset: Math.sin(angle) * dist,
                    type: type as any,
                    size: 1.0, // Scale handled by renderer based on type
                    color: tierColor,
                    rotation: angle + (type === 'WING' || type === 'SPIKE' || type === 'ENGINE' ? Math.PI/2 : 0),
                    health: 100 * this.wave,
                    maxHealth: 100 * this.wave,
                    shape: getShape(type as any, this.int(0, 5))
                });
            }
        }

        return {
            modules,
            name,
            stats: {
                hpMult: 1.0 + (this.wave * 0.5),
                speed: 1.5 + (this.rng() * 2.0),
                mass: 5000 + (this.wave * 1000)
            }
        };
    }
}

// --- SPAWNING LOGIC ---

export function setupEnemy(s: GameState, e: Enemy, type: string, x: number, y: number) {
    const conf = CONFIG.ENEMIES[type] || CONFIG.ENEMIES['CHASER']; // Fallback

    e.id = Utils.uid('e'); e.x = x; e.y = y;
    e.type = type.toLowerCase(); 
    
    // Scaling
    e.hp = conf.hp + (s.wave * conf.hpScale); e.maxHp = e.hp;
    e.speed = conf.speed + (s.wave * conf.speedScale); 
    e.size = conf.size; e.color = conf.color; 
    e.xp = conf.xp; e.score = conf.score; e.sides = conf.sides; e.mass = conf.mass || 1.0;
    
    e.behavior = conf.behavior;
    e.active = true; e.trail = []; e.state = 'idle'; e.stateTimer = 0; 
    e.squadId = undefined; e.squadRole = undefined;
    e.modules = undefined;
    e.vx = 0; e.vy = 0;

    const isElite = Math.random() < Math.min(CONFIG.ELITE.MAX_CHANCE, CONFIG.ELITE.CHANCE_PER_WAVE * s.wave);
    if (isElite && !type.startsWith('BOSS')) {
        e.isElite = true; 
        e.hp *= CONFIG.ELITE.HP_MULT; e.maxHp = e.hp; 
        e.speed *= CONFIG.ELITE.SPEED_MULT; 
        e.size *= CONFIG.ELITE.SIZE_MULT; 
        e.xp *= CONFIG.ELITE.XP_MULT; 
        e.score *= CONFIG.ELITE.SCORE_MULT; 
        e.mass *= 2.0; e.color = CONFIG.ELITE.COLOR;
        e.status.push({ type: 'BURN', duration: 0, power: 0, timer: 0 }); 
    } else {
        e.isElite = false;
    }

    // PROCEDURAL BOSS INJECTION
    if (type === 'PROCEDURAL_BOSS') {
        const seed = Date.now() + s.wave;
        const generator = new TitanGenerator(seed, s.wave);
        const blueprint = generator.generate();
        
        e.modules = blueprint.modules;
        e.hp = 2000 * blueprint.stats.hpMult;
        e.maxHp = e.hp;
        e.speed = blueprint.stats.speed;
        e.mass = blueprint.stats.mass;
        e.size = 80;
        e.color = blueprint.modules[0].color; // Core color
        e.behavior = 'dreadnought'; // NEW BEHAVIOR
        
        // Name injection via hacked property (optional, or store in state)
        console.log(`SPAWNED BOSS: ${blueprint.name}`);
    }

    s.enemies.push(e);

    if (type === 'SNAKE_HEAD') {
        let parentId = e.id;
        for(let k=1; k<=5; k++) {
             const body = s.pools.enemies.acquire();
             if(body) {
                 const bConf = CONFIG.ENEMIES.SNAKE_BODY;
                 body.id = Utils.uid('sb'); body.x = x; body.y = y; 
                 body.type = 'snake_body'; 
                 body.hp = bConf.hp + (s.wave * bConf.hpScale); body.maxHp = body.hp; 
                 body.size = bConf.size; body.color = bConf.color; 
                 body.xp = bConf.xp; body.score = bConf.score; 
                 body.parentId = parentId; body.segmentIndex = k; 
                 body.active = true; body.mass = bConf.mass;
                 s.enemies.push(body);
             }
        }
    }
    return e;
}

export function spawnBoss(s: GameState, callbacks: GameCallbacks) {
    if (s.bossActive) return;
    
    // 1. FORCE POOL SLOT
    // If pool is full, brutally delete the oldest non-boss enemy
    let e = s.pools.enemies.acquire();
    if (!e) {
        console.warn("Enemy pool full for Boss. Forcing eviction.");
        const sacrifice = s.enemies.find(en => !en.type.startsWith('boss'));
        if (sacrifice) {
            sacrifice.dead = true;
            sacrifice.active = false;
            // Force return to pool immediately to make space
            // NOTE: In a real ECS we'd just overwrite, but here we release/acquire to be safe
            s.pools.enemies.release(sacrifice); 
            // Remove from active array
            const idx = s.enemies.indexOf(sacrifice);
            if (idx > -1) s.enemies.splice(idx, 1);
            
            // Retry acquire
            e = s.pools.enemies.acquire();
        }
    }

    // 2. SPAWN LOGIC
    if(e) {
        callbacks.playSound('spawn');
        callbacks.onBossSpawn();
        
        const ang = Math.random() * Math.PI * 2;
        const dist = 700; 
        const bx = s.player.x + Math.cos(ang) * dist;
        const by = s.player.y + Math.sin(ang) * dist;

        // Use the new Procedural Type
        const bossEntity = setupEnemy(s, e, 'PROCEDURAL_BOSS', bx, by);
        
        // 3. LOCK STATE
        // Double check existence in array
        if (s.enemies.includes(bossEntity)) {
            s.bossActive = true;
            s.arena.active = true;
            s.arena.x = s.player.x;
            s.arena.y = s.player.y;
            s.arena.radius = 1200; // Large arena
            s.arena.alpha = 0; 

            // 4. CLEAR AREA
            for(let i = s.enemies.length - 1; i >= 0; i--) {
                const minion = s.enemies[i];
                if(minion !== e && Utils.dist(s.arena.x, s.arena.y, minion.x, minion.y) < 1200) {
                    minion.dead = true;
                    createExplosion(s, minion.x, minion.y, '#ff0000', 5, 1);
                }
            }
        } else {
            console.error("Boss Entity failed to push to enemies array");
        }
    } else {
        console.error("CRITICAL: FAILED TO SPAWN BOSS - POOL EXHAUSTED EVEN AFTER PURGE");
    }
}

export function spawnSquad(s: GameState, type: string, count: number, formation: 'V' | 'LINE' | 'CIRCLE') {
    const leader = s.pools.enemies.acquire();
    if (!leader) return;

    // Get spawn pos
    const pos = Utils.getSpawnPos(s.worldWidth, s.worldHeight);
    setupEnemy(s, leader, type, pos.x, pos.y);
    leader.isElite = true; 
    leader.size *= 1.5; leader.hp *= 2; 
    leader.color = '#ffffff';

    const spacing = 40;
    const squadId = Utils.uid('sq');
    leader.squadId = squadId;
    leader.squadRole = 'protector';

    for(let i = 0; i < count; i++) {
        const wingman = s.pools.enemies.acquire();
        if (wingman) {
            let ox = 0, oy = 0;
            if (formation === 'V') {
                const row = Math.floor(i / 2) + 1;
                const side = i % 2 === 0 ? 1 : -1;
                ox = -side * row * spacing;
                oy = -row * spacing; 
            } else if (formation === 'LINE') {
                ox = (i - count/2) * spacing;
            } else if (formation === 'CIRCLE') {
                const ang = (Math.PI * 2 / count) * i;
                ox = Math.cos(ang) * spacing * 2;
                oy = Math.sin(ang) * spacing * 2;
            }

            setupEnemy(s, wingman, type, pos.x + ox, pos.y + oy);
            wingman.squadId = squadId;
            wingman.squadRole = 'flanker';
            wingman.squadOffset = { angle: 0, dist: Math.hypot(ox, oy) }; // Simplified, updates in System
            wingman.parentId = leader.id; // Follow leader
        }
    }
}

export function generateNebula(w: number, h: number, wave: number): NebulaCloud {
    const threatColor = wave % 5 === 0 ? '#ff0000' : (wave % 3 === 0 ? '#aa00ff' : '#00aaff');
    return {
        x: Math.random() * w,
        y: Math.random() * h,
        radius: Utils.rand(500, 1500),
        color: threatColor,
        opacity: Utils.rand(0.1, 0.3),
        seed: Math.random() * 100
    };
}

// --- STANDARD GENERATORS ---

export function createExplosion(s: GameState, x: number, y: number, color: string, count: number, speed: number) {
    for(let i=0; i<count; i++) {
        const p = s.pools.particles.acquire();
        if(p) {
            p.x = x; p.y = y;
            const angle = Math.random() * Math.PI * 2;
            const spd = Math.random() * speed + 1;
            p.vx = Math.cos(angle) * spd;
            p.vy = Math.sin(angle) * spd;
            p.life = Utils.rand(20, 40); p.maxLife = p.life;
            p.color = color;
            p.size = Utils.rand(2, 5);
            p.active = true;
            s.particles.push(p);
        }
    }
}

export function createSparks(s: GameState, x: number, y: number, dx: number, dy: number, count: number, color: string) {
    const baseAngle = Math.atan2(dy, dx);
    for(let i=0; i<count; i++) {
        const p = s.pools.particles.acquire();
        if(p) {
            p.x = x; p.y = y;
            const angle = baseAngle + (Math.random() - 0.5); 
            const spd = Utils.rand(3, 8);
            p.vx = Math.cos(angle) * spd;
            p.vy = Math.sin(angle) * spd;
            p.life = Utils.rand(10, 20); p.maxLife = p.life;
            p.color = color;
            p.size = Utils.rand(1, 3);
            p.type = 'spark';
            p.active = true;
            s.particles.push(p);
        }
    }
}

export function createShockwave(s: GameState, x: number, y: number, size: number, color: string, speed: number) {
    s.shockwaves.push({ x, y, size: 10, maxSize: size, color, speed, alpha: 1.0, width: 2 });
    if(s.visualGrid) s.visualGrid.applyForce(x, y, size, 80);
}

export function createFloatingText(s: GameState, x: number, y: number, text: string, color: string, size: number, isCrit: boolean = false) {
    const angle = -Math.PI/2 + (Math.random() - 0.5); 
    const speed = isCrit ? Utils.rand(6, 9) : Utils.rand(3, 6);
    
    s.texts.push({ 
        x, y, 
        vx: Math.cos(angle) * speed, 
        vy: Math.sin(angle) * speed, 
        text, 
        life: 60, 
        maxLife: 60,
        color, 
        size: isCrit ? size * 1.5 : size,
        isCrit,
        opacity: 1.0
    });
}

export function createAsteroid(s: GameState, x: number, y: number, size: number) {
    const d = s.pools.debris.acquire();
    if(d) {
        d.id = Utils.uid('ast');
        d.x = x; d.y = y;
        d.vx = (Math.random() - 0.5) * 0.5;
        d.vy = (Math.random() - 0.5) * 0.5;
        d.size = size;
        d.type = 'asteroid';
        d.color = '#556677';
        d.rotation = Math.random() * Math.PI * 2;
        d.vRot = (Math.random() - 0.5) * 0.02;
        d.sides = Math.floor(Utils.rand(5, 9));
        d.health = size * 5;
        d.mass = size * 0.5;
        d.friction = 0.99;
        d.active = true;
        s.debris.push(d);
    }
}

export function createShipDebris(s: GameState, x: number, y: number, color: string, size: number, ivx: number, ivy: number) {
    const d = s.pools.debris.acquire();
    if(d) {
        d.id = Utils.uid('scr');
        d.x = x; d.y = y;
        const angle = Math.random() * Math.PI * 2;
        const force = Utils.rand(3, 8); 
        d.vx = ivx * 0.3 + Math.cos(angle) * force;
        d.vy = ivy * 0.3 + Math.sin(angle) * force;
        
        d.size = size * Utils.rand(0.2, 0.4); 
        d.type = 'scrap'; 
        d.color = color;
        d.rotation = Math.random() * Math.PI * 2;
        d.vRot = (Math.random() - 0.5) * 0.8; 
        d.sides = 3; 
        d.health = size;
        d.mass = size * 0.1;
        d.friction = 0.95;
        d.active = true;
        s.debris.push(d);
    }
}

export function createEvolutionEffect(s: GameState, x: number, y: number, color: string) {
    createShockwave(s, x, y, 500, color, 15);
    createExplosion(s, x, y, color, 50, 8);
    createFloatingText(s, x, y - 50, "EVOLUTION", color, 24);
}

export function createLightningBolt(s: GameState, x1: number, y1: number, x2: number, y2: number, color: string) {
    const p = s.pools.particles.acquire();
    if(p) {
        p.x = x1; p.y = y1;
        p.targetX = x2; p.targetY = y2;
        p.life = 10; p.maxLife = 10;
        p.color = color;
        p.size = 2;
        p.type = 'lightning';
        p.active = true;
        s.particles.push(p);
    }
}

export function createStatusEffectParticles(s: GameState, e: any, type: 'BURN' | 'FREEZE') {
    const count = type === 'BURN' ? 2 : 1;
    for(let i=0; i<count; i++) {
        const p = s.pools.particles.acquire();
        if(p) {
            const angle = Math.random() * Math.PI * 2;
            const dist = Math.random() * e.size;
            p.x = e.x + Math.cos(angle) * dist;
            p.y = e.y + Math.sin(angle) * dist;

            p.vx = (Math.random() - 0.5) * 0.5;
            p.vy = (Math.random() - 0.5) * 0.5 - 1.0; // Upward drift

            p.life = Utils.rand(20, 40); p.maxLife = p.life;
            p.active = true;

            if (type === 'BURN') {
                p.color = i % 2 === 0 ? '#ffaa00' : '#ff4400';
                p.size = Utils.rand(2, 4);
                p.type = 'spark';
            } else {
                p.color = '#00ffff';
                p.size = Utils.rand(3, 6);
                p.type = 'shard';
                p.rotation = Math.random() * Math.PI * 2;
                p.rv = (Math.random() - 0.5) * 0.2;
            }
            s.particles.push(p);
        }
    }
}
