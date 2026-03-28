
import { GameState, GameCallbacks, Enemy, Bullet, Player, Debris } from '../types';
import { CONFIG } from '../constants';
import { Utils } from '../utils';
import { createEvolutionEffect, TitanGenerator } from './generators'; // Import visual helpers

// --- SYSTEM ARCHITECTURE ---

const SpatialHash = {
    // Optimization: Pre-allocate static arrays for neighbor lookups
    nearby: [] as Enemy[],
    
    query(s: GameState, e: Enemy, radius: number): Enemy[] {
        // Reuse the array to avoid GC
        this.nearby.length = 0;
        
        // Use the existing spatial grid in GameState which is already built every frame
        // This is much faster than N^2
        const cells = s.spatialGrid.getNearby(e.x, e.y, radius);
        
        // Filter specifically for enemies within radius
        const r2 = radius * radius;
        for (const other of cells) {
            if (other === e || !(other as any).type) continue; // Skip self and non-enemies
            const dx = other.x - e.x;
            const dy = other.y - e.y;
            if (dx*dx + dy*dy < r2) {
                this.nearby.push(other as Enemy);
            }
        }
        return this.nearby;
    }
};

export const Systems = {
    Wave: {
        update(s: GameState, callbacks: GameCallbacks) {
            if (s.bossActive) return;

            s.spawnTimer--;
            if (s.spawnTimer <= 0 && s.enemies.length < CONFIG.SPAWNING.MAX_ENEMIES) {
                // Determine spawn type based on wave composition
                const waveConfig = CONFIG.WAVES[s.waveType as keyof typeof CONFIG.WAVES];
                const type = waveConfig.types[Math.floor(Math.random() * waveConfig.types.length)];
                const stats = CONFIG.ENEMIES[type.toUpperCase()];
                
                // Spawn Logic (Off-screen)
                const angle = Math.random() * Math.PI * 2;
                // Spawn further out to allow swarming behavior to form before entering screen
                const dist = Math.max(s.width, s.height) * 0.8;
                const ex = s.player.x + Math.cos(angle) * dist;
                const ey = s.player.y + Math.sin(angle) * dist;
                
                const e = s.pools.enemies.obtain();
                e.x = ex; e.y = ey;
                e.type = type;
                e.hp = stats.hp * (1 + (s.wave * 0.1));
                e.maxHp = e.hp;
                e.speed = stats.speed * (1 + (s.wave * 0.02));
                e.size = stats.size;
                e.color = stats.color;
                e.score = stats.score;
                e.xp = stats.xp;
                e.behavior = stats.behavior;
                e.mass = stats.mass || 1.0;
                e.sides = stats.sides;
                e.active = true;
                e.dead = false;

                // Elite Chance
                if (Math.random() < Math.min(CONFIG.ELITE.MAX_CHANCE, CONFIG.ELITE.CHANCE_PER_WAVE * s.wave)) {
                    e.isElite = true;
                    e.hp *= CONFIG.ELITE.HP_MULT;
                    e.maxHp = e.hp;
                    e.size *= CONFIG.ELITE.SIZE_MULT;
                    e.xp *= CONFIG.ELITE.XP_MULT;
                    e.score *= CONFIG.ELITE.SCORE_MULT;
                    e.color = CONFIG.ELITE.COLOR;
                }

                s.enemies.push(e);
                s.spawnTimer = s.spawnRate;
            }
            
            // Wave Progression
            if (s.waveKills >= s.waveQuota) {
                s.wave++;
                s.waveKills = 0;
                s.waveQuota = Math.floor(s.waveQuota * CONFIG.SPAWNING.QUOTA_MULTIPLIER);
                s.spawnRate = Math.max(CONFIG.SPAWNING.MIN_RATE, s.spawnRate * CONFIG.SPAWNING.RATE_DECAY);

                // Boss Spawn
                if (s.wave % CONFIG.SPAWNING.BOSS_INTERVAL === 0) {
                    s.bossActive = true;
                    callbacks.onBossSpawn();

                    // --- BOSS SPAWN LOGIC ---
                    const bossTypes = ['BOSS_WARLORD', 'BOSS_HIVE', 'BOSS_OMNI'];
                    const bossType = bossTypes[(s.wave / CONFIG.SPAWNING.BOSS_INTERVAL) % bossTypes.length];
                    const stats = CONFIG.ENEMIES[bossType];

                    const boss = s.pools.enemies.obtain();
                    // Spawn at distance
                    const angle = Math.random() * Math.PI * 2;
                    boss.x = s.player.x + Math.cos(angle) * 1000;
                    boss.y = s.player.y + Math.sin(angle) * 1000;
                    boss.type = bossType;
                    boss.hp = stats.hp * (1 + (s.wave * 0.2));
                    boss.maxHp = boss.hp;
                    boss.size = stats.size;
                    boss.color = stats.color;
                    boss.behavior = stats.behavior; // 'warlord', 'hive', etc.
                    boss.active = true;
                    boss.dead = false;
                    boss.mass = stats.mass;

                    // Procedural Modules
                    boss.modules = TitanGenerator.generate(bossType, s.wave);

                    s.enemies.push(boss);

                    // Sound
                    callbacks.playSound('warn_siren' as any); // Assuming sound exists or is handled
                }

                // Rotate Wave Type
                const types = Object.keys(CONFIG.WAVES);
                s.waveType = types[s.wave % types.length] as any;
            }
        }
    },

    Enemies: {
        update(s: GameState, callbacks: GameCallbacks) {
            const p = s.player;
            // Pre-calculate player position for boids to avoid property access in loop
            const px = p.x;
            const py = p.y;
            
            // Shared Boid Vectors (reused)
            let sepX = 0, sepY = 0;
            let aliX = 0, aliY = 0;
            let cohX = 0, cohY = 0;
            let count = 0;

            for (let i = s.enemies.length - 1; i >= 0; i--) {
                const e = s.enemies[i];
                if (!e.active) continue;

                // --- BOID FLOCKING LOGIC ---
                // Only apply flocking if behavior is 'flock' or 'swarm'
                if (e.behavior === 'flock' || e.behavior === 'swarm') {
                    const neighbors = SpatialHash.query(s, e, CONFIG.BOIDS.ALIGNMENT_RADIUS);

                    sepX = 0; sepY = 0;
                    aliX = 0; aliY = 0;
                    cohX = 0; cohY = 0;
                    count = 0;

                    for(const other of neighbors) {
                        const d = Utils.dist(e.x, e.y, other.x, other.y);
                        if (d > 0) {
                            // Separation
                            if (d < CONFIG.BOIDS.SEPARATION_RADIUS) {
                                const push = (CONFIG.BOIDS.SEPARATION_RADIUS - d) / d;
                                sepX += (e.x - other.x) * push;
                                sepY += (e.y - other.y) * push;
                            }
                            // Alignment
                            aliX += other.vx;
                            aliY += other.vy;
                            // Cohesion
                            cohX += other.x;
                            cohY += other.y;
                            count++;
                        }
                    }

                    if (count > 0) {
                        // Normalize and Weight
                        // Alignment: steer towards average heading
                        aliX /= count; aliY /= count;
                        // Cohesion: steer towards center of mass
                        cohX = (cohX / count) - e.x;
                        cohY = (cohY / count) - e.y;

                        e.vx += (sepX * CONFIG.BOIDS.SEPARATION_WEIGHT + aliX * CONFIG.BOIDS.ALIGNMENT_WEIGHT + cohX * CONFIG.BOIDS.COHESION_WEIGHT) * 0.01;
                        e.vy += (sepY * CONFIG.BOIDS.SEPARATION_WEIGHT + aliY * CONFIG.BOIDS.ALIGNMENT_WEIGHT + cohY * CONFIG.BOIDS.COHESION_WEIGHT) * 0.01;
                    }
                }

                // Standard Seeking (Flow towards player)
                const dx = px - e.x;
                const dy = py - e.y;
                const distToPlayer = Math.hypot(dx, dy);
                
                // Steering towards player
                if (distToPlayer > 0) {
                    e.vx += (dx / distToPlayer) * 0.05 * CONFIG.BOIDS.PLAYER_WEIGHT;
                    e.vy += (dy / distToPlayer) * 0.05 * CONFIG.BOIDS.PLAYER_WEIGHT;
                }

                // Physics Integration
                // Cap speed
                const speed = Math.hypot(e.vx, e.vy);
                if (speed > e.speed) {
                    e.vx = (e.vx / speed) * e.speed;
                    e.vy = (e.vy / speed) * e.speed;
                }

                e.x += e.vx * s.worldTimeScale;
                e.y += e.vy * s.worldTimeScale;

                // Rotation (Face velocity)
                if (speed > 0.1) e.rotation = Math.atan2(e.vy, e.vx);

                // --- COLLISION WITH PLAYER ---
                if (p.invuln <= 0 && distToPlayer < (e.size + CONFIG.PLAYER.COLLISION_RADIUS)) {
                    // Hit Player
                    if (p.hull === 'BASTION' && p.dashCd > (p.maxDashCd - 20)) {
                        // Bastion Ram (Invuln dash)
                        e.hp -= 50;
                        e.hitFlash = 10;
                    } else {
                        // Player takes damage
                        p.hp -= 10; // Base damage
                        p.hitFlash = 10;
                        p.invuln = CONFIG.PLAYER.INVULN_ON_HIT;
                        callbacks.playSound('hit');
                        s.shake = 10;
                        s.screenFlash = 0.5;
                        s.flashColor = '#ff0000';

                        // Knockback
                        const ang = Math.atan2(p.y - e.y, p.x - e.x);
                        p.vx += Math.cos(ang) * 10;
                        p.vy += Math.sin(ang) * 10;
                    }
                }

                // Death Logic
                if (e.hp <= 0) {
                    e.dead = true;
                    e.active = false;
                    s.waveKills++;
                    s.score += e.score;
                    s.combo++;
                    s.comboTimer = CONFIG.PROGRESSION.COMBO_DURATION;

                    // Spawn Gems
                    const g = s.pools.gems.obtain();
                    g.x = e.x; g.y = e.y; g.val = e.xp; g.life = CONFIG.GEMS.LIFETIME; g.active = true;
                    s.gems.push(g);

                    // Explosion visual (Restored)
                    callbacks.playSound('explosion', e.x, e.y);
                    createEvolutionEffect(s, e.x, e.y, e.color); // Re-using evolution effect for big boom

                    // Boss Kill Logic
                    if (e.type.startsWith('BOSS_')) {
                        s.bossActive = false;
                        // Massive clear
                        s.enemies.forEach(minion => {
                            if (!minion.type.startsWith('BOSS_')) minion.hp = 0;
                        });
                        s.screenFlash = 1.0;
                        s.flashColor = '#ffffff';
                    }
                }

                if (e.hitFlash > 0) e.hitFlash--;
            }
        }
    },

    Player: {
        update(s: GameState, callbacks: GameCallbacks) {
            const p = s.player;
            if (!p.active) return;
            
            // Input
            let ax = 0; let ay = 0;
            if (s.keys.a || s.keys.ArrowLeft) ax -= 1;
            if (s.keys.d || s.keys.ArrowRight) ax += 1;
            if (s.keys.w || s.keys.ArrowUp) ay -= 1;
            if (s.keys.s || s.keys.ArrowDown) ay += 1;

            if (ax !== 0 || ay !== 0) {
                const len = Math.hypot(ax, ay);
                ax /= len; ay /= len;
                p.vx += ax * CONFIG.PLAYER.ACCELERATION * p.stats.speedMod;
                p.vy += ay * CONFIG.PLAYER.ACCELERATION * p.stats.speedMod;
            }
            
            // Friction
            p.vx *= CONFIG.PLAYER.FRICTION;
            p.vy *= CONFIG.PLAYER.FRICTION;
            
            p.x += p.vx * s.playerTimeScale;
            p.y += p.vy * s.playerTimeScale;
            
            // Bound to World
            p.x = Math.max(0, Math.min(s.worldWidth, p.x));
            p.y = Math.max(0, Math.min(s.worldHeight, p.y));
            
            // Aiming
            const targetX = s.mouse.x / s.camera.zoom + s.camera.x - (s.width/2)/s.camera.zoom;
            const targetY = s.mouse.y / s.camera.zoom + s.camera.y - (s.height/2)/s.camera.zoom;
            p.angle = Math.atan2(targetY - p.y, targetX - p.x);
            
            // Shooting
            if (p.cd > 0) p.cd -= s.playerTimeScale;
            if ((s.mouse.down || s.keys.space || s.autoMode) && p.cd <= 0) {
                // Fire Weapon
                const w = CONFIG.WEAPONS[p.weapon];
                
                // Multishot Fan
                const totalShots = w.count + p.stats.multishot;
                const startAngle = p.angle - (w.spread * (totalShots-1))/2;

                for(let i=0; i<totalShots; i++) {
                     const ang = startAngle + i * w.spread + (Math.random()-0.5)*0.05;

                     const b = s.pools.bullets.obtain();
                     b.x = p.x + Math.cos(ang) * 10;
                     b.y = p.y + Math.sin(ang) * 10;
                     b.vx = Math.cos(ang) * w.speed;
                     b.vy = Math.sin(ang) * w.speed;
                     b.life = w.lifetime;
                     b.maxLife = w.lifetime;
                     b.color = w.color;
                     b.size = w.size;
                     b.dmg = 10 * w.dmgMult * p.stats.damageMod; // Base dmg
                     b.pierce = w.pierce + p.stats.pierce;
                     b.homing = w.homing + p.stats.homing;
                     b.bounce = p.stats.bounce;
                     b.split = p.stats.split;
                     b.explosive = p.stats.explosive;
                     b.active = true;
                     b.trail = [];

                     s.bullets.push(b);
                }

                p.cd = w.fireDelay / p.stats.fireRateMod;
                p.muzzleFlash = 3;
                s.shake += w.recoil;

                // Reverse Velocity (Recoil)
                p.vx -= Math.cos(p.angle) * w.recoil * 0.5;
                p.vy -= Math.sin(p.angle) * w.recoil * 0.5;

                callbacks.playSound('shoot');
            }

            if (p.invuln > 0) p.invuln--;
            if (p.muzzleFlash > 0) p.muzzleFlash--;

            // Dash
            if (p.dashCd > 0) p.dashCd -= s.playerTimeScale;
            if (s.keys.shift && p.dashCd <= 0) {
                p.dashCd = p.maxDashCd;
                p.invuln = CONFIG.PLAYER.DASH.INVULN_DURATION;

                // Dash in movement dir or aim dir
                let dashAng = p.angle;
                if (Math.abs(p.vx) > 0.1 || Math.abs(p.vy) > 0.1) dashAng = Math.atan2(p.vy, p.vx);

                p.vx += Math.cos(dashAng) * CONFIG.PLAYER.DASH.SPEED;
                p.vy += Math.sin(dashAng) * CONFIG.PLAYER.DASH.SPEED;

                callbacks.playSound('dash');
                // Dash Particles
                createEvolutionEffect(s, p.x, p.y, '#ffffff'); // Re-use effect for dash poof
            }
        }
    },

    Combat: {
        update(s: GameState, callbacks: GameCallbacks) {
            // Bullet Collision
            for (let i = s.bullets.length - 1; i >= 0; i--) {
                const b = s.bullets[i];
                if (!b.active) continue;
                
                b.x += b.vx * s.worldTimeScale;
                b.y += b.vy * s.worldTimeScale;
                b.life -= s.worldTimeScale;

                // Trail
                if (s.frame % 2 === 0) {
                    b.trail.push({x: b.x, y: b.y});
                    if (b.trail.length > 5) b.trail.shift();
                }

                if (b.life <= 0) {
                    b.active = false;
                    continue;
                }
                
                // Check Hits
                // Optimization: Use Spatial Hash query for Bullet vs Enemies?
                // For now, grid lookup is fast enough
                const potentialTargets = s.spatialGrid.getNearby(b.x, b.y, b.size + 30);

                for (const t of potentialTargets) {
                    const e = t as Enemy; // Cast
                    if (!e.active || e.dead || e.invulnerable) continue;

                    const distSq = (b.x - e.x)**2 + (b.y - e.y)**2;
                    const radSum = b.size + e.size;
                    
                    if (distSq < radSum * radSum) {
                        // HIT!
                        e.hp -= b.dmg;
                        e.hitFlash = 5;
                        s.damageDealtBuffer += b.dmg;
                        
                        // Knockback
                        const kx = b.vx * 0.1;
                        const ky = b.vy * 0.1;
                        e.vx += kx; e.vy += ky;
                        
                        // Pierce Logic
                        if (b.pierce > 0) {
                            b.pierce--;
                            // Reduce damage for subsequent hits?
                        } else {
                            b.active = false;
                        }

                        // Bounce Logic
                        if (b.bounce > 0 && !b.active) { // Only bounce if it "died" (ran out of pierce)
                             b.active = true; // Revive
                             b.bounce--;
                             // Reflect velocity
                             b.vx = -b.vx; b.vy = -b.vy; // Simplified reflection
                        }

                        // Floating Text
                        const ft = {
                            x: e.x, y: e.y - 20, vx: (Math.random()-0.5)*2, vy: -2,
                            text: Math.floor(b.dmg).toString(),
                            life: 60, maxLife: 60, color: '#fff', size: 12, isCrit: false, opacity: 1
                        };
                        s.texts.push(ft);

                        if (e.hp <= 0 && !e.dead) {
                           // Kill handled in Enemy update
                        }

                        if (!b.active) break; // Bullet died, stop checking targets
                    }
                }
            }
        }
    },

    Camera: {
        update(s: GameState) {
            const p = s.player;
            // Smooth Follow
            const targetX = p.x;
            const targetY = p.y;

            s.camera.x += (targetX - s.camera.x) * 0.1;
            s.camera.y += (targetY - s.camera.y) * 0.1;

            // Zoom logic based on speed
            const speed = Math.hypot(p.vx, p.vy);
            const targetZoom = Math.max(0.7, 1.0 - (speed * 0.01));
            s.camera.zoom += (targetZoom - s.camera.zoom) * 0.05;

            // Shake Decay
            if (s.camera.kickX) s.camera.kickX *= 0.9;
            if (s.camera.kickY) s.camera.kickY *= 0.9;
        }
    },

    Cleanup: {
        update(s: GameState) {
            // Remove inactive entities
            // Use filter or swap-remove for performance
            // For now, simple filter
            s.bullets = s.bullets.filter(b => b.active);
            s.enemies = s.enemies.filter(e => e.active);
            s.particles = s.particles.filter(p => p.active);
            s.gems = s.gems.filter(g => g.active);
            s.texts = s.texts.filter(t => t.life > 0);

            // Update Texts
            for(const t of s.texts) {
                t.x += t.vx; t.y += t.vy; t.life--;
                t.opacity = t.life / 20;
            }
        }
    }
};
