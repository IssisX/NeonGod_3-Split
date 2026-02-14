
import { GameState, Enemy, GameCallbacks, BossModule, Player } from '../types';
import { CONFIG } from '../constants';
import { Utils } from '../utils';
import { createExplosion, createShockwave, createFloatingText, setupEnemy, spawnBoss, createAsteroid, createShipDebris, createSparks, generateNebula, spawnSquad, createLightningBolt, createStatusEffectParticles } from './generators';

// --- LOGIC HANDLERS ---

function applyStatusEffect(s: GameState, e: Enemy, type: 'BURN' | 'FREEZE', power: number, duration: number) {
    const existing = e.status.find(st => st.type === type);
    if (existing) {
        existing.duration = Math.max(existing.duration, duration);
        if (type === 'BURN') existing.power = Math.max(existing.power, power);
    } else {
        e.status.push({ type, duration, power, timer: 0 });
    }
}

function triggerChainLightning(s: GameState, origin: Enemy, damage: number, bounces: number, range: number, callbacks: GameCallbacks, exclude: string[] = []) {
    if (bounces <= 0) return;

    exclude.push(origin.id);
    const targets = s.spatialGrid.queryRadius(origin.x, origin.y, range);

    let bestTarget: Enemy | null = null;
    let minDist = range * range;

    for (const t of targets) {
        const en = t as Enemy;
        if (!en.active || en.dead || exclude.includes(en.id) || !(en as any).hp) continue;

        const dSq = (en.x - origin.x)**2 + (en.y - origin.y)**2;
        if (dSq < minDist) {
            minDist = dSq;
            bestTarget = en;
        }
    }

    if (bestTarget) {
        createLightningBolt(s, origin.x, origin.y, bestTarget.x, bestTarget.y, '#aa00ff');
        callbacks.playSound('spark', bestTarget.x, bestTarget.y); // Use spark sound for zap

        bestTarget.hp -= damage;
        bestTarget.hitFlash = 5;
        createFloatingText(s, bestTarget.x, bestTarget.y - 20, Math.round(damage).toString(), '#aa00ff', 16);

        if (bestTarget.hp <= 0) {
            handleEnemyDeath(s, bestTarget, callbacks, {x: 0, y: 0});
        }

        // Chain
        const targetId = bestTarget.id;
        s.delayedEvents.push({
            timer: 3,
            action: () => {
                if (bestTarget && bestTarget.active && bestTarget.id === targetId) {
                     triggerChainLightning(s, bestTarget, damage * 0.8, bounces - 1, range, callbacks, exclude);
                }
            }
        });
    }
}

function handleEnemyDeath(s: GameState, e: Enemy, callbacks: GameCallbacks, knockback: {x: number, y: number}) {
    if (e.dead) return;
    
    e.dead = true;
    e.active = false;
    
    s.score += e.score;
    s.player.xp += e.xp;
    
    if (!e.type.startsWith('boss') && e.type !== 'procedural_boss') {
        s.waveKills++;
    }
    
    // Gems
    const gemCount = e.isElite ? 5 : 1;
    for(let i=0; i<gemCount; i++) {
        const g = s.pools.gems.acquire();
        if(g) {
            g.x = e.x; g.y = e.y;
            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * 2 + 1;
            g.vx = Math.cos(angle) * speed + knockback.x * 0.1;
            g.vy = Math.sin(angle) * speed + knockback.y * 0.1;
            g.val = Math.ceil(e.xp / gemCount);
            g.life = CONFIG.GEMS.LIFETIME;
            g.active = true;
            s.gems.push(g);
        }
    }

    // Health Pickup Chance
    if (Math.random() < 0.02 || (e.isElite && Math.random() < 0.2)) {
        const p = s.pools.pickups.acquire();
        if (p) {
             p.x = e.x; p.y = e.y;
             p.vx = (Math.random() - 0.5) * 2;
             p.vy = (Math.random() - 0.5) * 2;
             p.type = 'heal';
             p.life = CONFIG.PICKUPS.LIFETIME;
             p.active = true;
             s.pickups.push(p);
        }
    }

    createExplosion(s, e.x, e.y, e.color, Math.floor(e.size), 2);
    
    const shardCount = Utils.rand(4, 7);
    for(let i=0; i<shardCount; i++) {
        createShipDebris(s, e.x, e.y, e.color, e.size, e.vx, e.vy);
    }

    // BOSS DEATH -> TRIGGER WARP
    if (e.type.startsWith('boss') || e.type === 'procedural_boss') {
        s.bossActive = false;
        s.arena.active = false;
        s.arena.alpha = 0; 
        
        // Initiate Warp Sequence
        s.warp.active = true;
        s.warp.stage = 'charge';
        s.warp.timer = CONFIG.WARP.CHARGE_TIME;
        
        callbacks.playSound('warp_charge');
        createFloatingText(s, s.player.x, s.player.y - 100, "INITIATING WARP...", "#00ffff", 30);

        // Kill minions visual only
        for(let i = s.enemies.length - 1; i >= 0; i--) {
            const minion = s.enemies[i];
            if(minion.active && minion.id !== e.id && !minion.type.startsWith('boss')) {
                minion.dead = true;
                minion.active = false;
                createExplosion(s, minion.x, minion.y, minion.color, 5, 1);
            }
        }
        
        createShockwave(s, e.x, e.y, 2000, '#ffffff', 30);
        callbacks.playSound('explosion', e.x, e.y);
    } else {
        callbacks.playSound('explosion', e.x, e.y);
    }
    
    s.combo++;
    s.comboTimer = CONFIG.PROGRESSION.COMBO_DURATION;
    s.overdrive = Math.min(100, s.overdrive + (e.isElite ? 5 : 1));
}

function calculateAutoPilot(s: GameState) {
    const p = s.player;
    let mx = 0, my = 0, shoot = false, dash = false, ult = false, q = false, e = false;
    let aimAngle = p.angle;
    
    let nearest = null;
    let minDst = Infinity;
    
    for(const en of s.enemies) {
        if(!en.active || en.dead) continue;
        const d = Utils.dist(p.x, p.y, en.x, en.y);
        if (d < minDst) { minDst = d; nearest = en; }
        
        if (d < 200) {
            const push = (200 - d) / 200;
            mx -= (en.x - p.x) / d * push * 2;
            my -= (en.y - p.y) / d * push * 2;
        }
    }
    
    const nearbyBullets = s.spatialGrid.queryRadius(p.x, p.y, 150);
    for(const obj of nearbyBullets) {
        if ((obj as any).dmg) {
             const b = obj as any;
             const toPlayerX = p.x - b.x;
             const toPlayerY = p.y - b.y;
             const dot = b.vx * toPlayerX + b.vy * toPlayerY;
             if (dot > 0) {
                 const d = Math.hypot(toPlayerX, toPlayerY);
                 if (d < 120) {
                     mx += (toPlayerY / d) * 3;
                     my -= (toPlayerX / d) * 3;
                     if (p.dashCd <= 0) dash = true;
                 }
             }
        }
    }

    if (p.hp < p.maxHp * 0.6) {
        for(const g of s.pickups) {
            if(!g.active) continue;
            const d = Utils.dist(p.x, p.y, g.x, g.y);
            if (d < 400) {
                 mx += (g.x - p.x) / d * 2.0;
                 my += (g.y - p.y) / d * 2.0;
            }
        }
    }
    
    if(p.x < 200) mx += 1; if(p.x > s.worldWidth - 200) mx -= 1;
    if(p.y < 200) my += 1; if(p.y > s.worldHeight - 200) my -= 1;

    if (nearest) {
        shoot = true;
        aimAngle = Math.atan2(nearest.y - p.y, nearest.x - p.x);
        if (minDst < 100 && p.dashCd <= 0) dash = true;
        if (s.overdrive >= 100 && s.enemies.length > 20) ult = true;
        
        if (s.enemies.length > 15) q = true;
        if (minDst < 150) e = true;
    }
    
    return { mx, my, aimAngle, shoot, dash, ult, q, e };
}

function applySteering(e: Enemy, s: GameState) {
    const p = s.player;
    const toPlayerX = p.x - e.x;
    const toPlayerY = p.y - e.y;
    const distToPlayer = Math.hypot(toPlayerX, toPlayerY) || 0.001;

    // DESIRED VELOCITY
    let desVx = 0;
    let desVy = 0;

    // 1. BEHAVIOR SWITCHING
    if (e.behavior === 'keep_distance') {
        const preferredDist = 300;
        if (distToPlayer < preferredDist) {
            // Flee
            desVx = -(toPlayerX / distToPlayer) * e.speed;
            desVy = -(toPlayerY / distToPlayer) * e.speed;
        } else {
            // Seek
            desVx = (toPlayerX / distToPlayer) * e.speed;
            desVy = (toPlayerY / distToPlayer) * e.speed;
        }
    } else if (e.behavior === 'orbit') {
        const rad = 250;
        // Tangent vector
        const tanX = -toPlayerY / distToPlayer;
        const tanY = toPlayerX / distToPlayer;
        // Attraction to ring
        const pushPull = (distToPlayer - rad) * 0.02;
        
        desVx = (tanX * e.speed) + (toPlayerX / distToPlayer * pushPull);
        desVy = (tanY * e.speed) + (toPlayerY / distToPlayer * pushPull);
    } else if (e.behavior === 'dash_attack') {
        if (e.state === 'charge') {
            desVx = e.vx * 1.05; // Accelerate current dir
            desVy = e.vy * 1.05;
        } else {
            desVx = (toPlayerX / distToPlayer) * e.speed;
            desVy = (toPlayerY / distToPlayer) * e.speed;
            if (distToPlayer < 200 && Math.random() < 0.02) {
                e.state = 'charge';
                e.vx = (toPlayerX / distToPlayer) * 15;
                e.vy = (toPlayerY / distToPlayer) * 15;
                // Lock direction for a bit?
            }
        }
    } else {
        // Standard Seek
        desVx = (toPlayerX / distToPlayer) * e.speed;
        desVy = (toPlayerY / distToPlayer) * e.speed;
    }

    // 2. SEPARATION (Fixing the Swarm/Crowding)
    // Stronger, larger radius separation
    const sepRad = e.size * 3.5;
    const neighbors = s.spatialGrid.queryRadius(e.x, e.y, sepRad);
    let sepX = 0, sepY = 0;
    let count = 0;

    for(let i=0; i<neighbors.length; i++) {
        const n = neighbors[i] as Enemy;
        // Don't separate from player, that's collision logic
        if (n === e || !n.active || n === s.player as any) continue;
        if ((n as any).hp) { // Is enemy
            const dx = e.x - n.x;
            const dy = e.y - n.y;
            const dSq = dx*dx + dy*dy;
            if (dSq < sepRad * sepRad && dSq > 0.001) {
                const d = Math.sqrt(dSq);
                const force = (sepRad - d) / sepRad; // Linear falloff
                sepX += (dx / d) * force;
                sepY += (dy / d) * force;
                count++;
            }
        }
    }

    if (count > 0) {
        // Normalize separation vector
        const sepLen = Math.hypot(sepX, sepY) || 1;
        sepX = (sepX / sepLen) * e.speed * 2.5; // Strong separation weight
        sepY = (sepY / sepLen) * e.speed * 2.5;
    }

    // 3. FLOCKING ALIGNMENT (Optional for squads)
    let aliX = 0, aliY = 0;
    if (e.behavior === 'flock' && count > 0) {
        // Add neighbors velocity
        // Simplified for perf
    }

    // 4. APPLY FORCES
    const steeringFactor = 0.08; // Agility
    
    // Desired final velocity combining Seek + Separation
    const finalDesVx = desVx + sepX;
    const finalDesVy = desVy + sepY;

    // Apply Steering: Force = Desired - Current
    const steerX = finalDesVx - e.vx;
    const steerY = finalDesVy - e.vy;

    e.vx += steerX * steeringFactor;
    e.vy += steerY * steeringFactor;

    // 5. MAX SPEED CLAMP (Soft cap)
    const currentSpeed = Math.hypot(e.vx, e.vy);
    const maxSpd = e.state === 'charge' ? 20 : e.speed * 2.0; // Allow burst from separation
    if (currentSpeed > maxSpd) {
        e.vx = (e.vx / currentSpeed) * maxSpd;
        e.vy = (e.vy / currentSpeed) * maxSpd;
    }
}

function applyBossLogic(e: Enemy, s: GameState, callbacks: GameCallbacks) {
    const p = s.player;
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const dist = Math.sqrt(dx*dx + dy*dy);
    
    // Slow drift towards player
    e.vx += (dx / dist) * 0.05;
    e.vy += (dy / dist) * 0.05;
    e.vx *= 0.98;
    e.vy *= 0.98;

    e.rotation = (e.rotation || 0) + 0.005;

    // TURRET LOGIC
    if (e.modules && s.frame % 30 === 0) {
        for (const mod of e.modules) {
            if (mod.type === 'TURRET' && Math.random() < 0.3) {
                const cos = Math.cos(e.rotation);
                const sin = Math.sin(e.rotation);
                const mx = e.x + (mod.xOffset * cos - mod.yOffset * sin);
                const my = e.y + (mod.xOffset * sin + mod.yOffset * cos);
                
                const aimAngle = Math.atan2(p.y - my, p.x - mx);
                
                const b = s.pools.bullets.acquire();
                if (b) {
                    b.active = true;
                    b.x = mx; b.y = my;
                    b.vx = Math.cos(aimAngle) * 5;
                    b.vy = Math.sin(aimAngle) * 5;
                    b.color = '#ff0000';
                    b.dmg = 10 * s.wave;
                    b.life = 100;
                    b.size = 6;
                    b.pierce = 0;
                    b.homing = 0;
                    s.bullets.push(b);
                    if (Math.random() < 0.2) callbacks.playSound('shoot', mx, my);
                }
            }
        }
    }
}

function handleShooting(s: GameState, callbacks: GameCallbacks) {
    const p = s.player;
    if (p.cd > 0) return;

    const weapon = CONFIG.WEAPONS[p.weapon];
    p.cd = weapon.fireDelay / p.stats.fireRateMod;
    p.muzzleFlash = 3;
    
    const recoilForce = (weapon.recoil || 2.0); 
    p.recoilX -= Math.cos(p.angle) * recoilForce;
    p.recoilY -= Math.sin(p.angle) * recoilForce;
    s.shake += weapon.recoil > 5 ? 2 : 0;
    
    if (recoilForce > 2.0) {
        s.camera.kickX -= Math.cos(p.angle) * (recoilForce * 2);
        s.camera.kickY -= Math.sin(p.angle) * (recoilForce * 2);
    }

    if (p.weapon === 'SHOTGUN') callbacks.playSound('shoot_shotgun', p.x, p.y);
    else if (p.weapon === 'RAILGUN') callbacks.playSound('shoot_railgun', p.x, p.y);
    else if (p.weapon === 'VOID') callbacks.playSound('shoot_void', p.x, p.y);
    else callbacks.playSound('shoot', p.x, p.y);

    const totalShots = (weapon.count || 1) + p.stats.multishot;
    const spread = weapon.spread;
    
    for(let i=0; i<totalShots; i++) {
        const b = s.pools.bullets.acquire();
        if (b) {
            b.active = true;
            let angleOffset = 0;
            if (totalShots > 1) angleOffset = (i - (totalShots - 1) / 2) * (spread || 0.1);
            else angleOffset = (Math.random() - 0.5) * (spread || 0);
            
            const fireAngle = p.angle + angleOffset;
            const muzzleDist = 20;
            b.x = p.x + Math.cos(p.angle) * muzzleDist;
            b.y = p.y + Math.sin(p.angle) * muzzleDist;
            
            const spd = weapon.speed;
            b.vx = Math.cos(fireAngle) * spd + p.vx * 0.2;
            b.vy = Math.sin(fireAngle) * spd + p.vy * 0.2;
            
            b.color = weapon.color;
            b.dmg = 10 * weapon.dmgMult * p.stats.damageMod;
            b.life = weapon.lifetime;
            b.maxLife = weapon.lifetime; // Trail fade ref
            b.size = weapon.size;
            b.pierce = weapon.pierce + p.stats.pierce;
            b.homing = weapon.homing + p.stats.homing;
            b.trail = [];
            b.isBeam = weapon.type === 'beam';
            if (b.isBeam) {
                b.beamPoints = [];
                b.beamPoints.push({x: b.x, y: b.y});
            }
            b.elemental = { ...p.stats.elemental };
            
            // AUGMENTATIONS
            b.bounce = p.stats.bounce;
            b.split = p.stats.split;
            b.explosive = p.stats.explosive;
            b.generation = 0;
            b.knockback = weapon.knockback;

            s.bullets.push(b);
        }
    }
}

function handleDash(s: GameState, callbacks: GameCallbacks, mx: number, my: number) {
    const p = s.player;
    if (p.dashCd > 0) return;
    p.dashCd = p.maxDashCd;
    p.invuln = CONFIG.PLAYER.DASH.INVULN_DURATION;
    
    let dx = mx, dy = my;
    const len = Math.hypot(dx, dy);
    if (len < 0.1) { dx = Math.cos(p.angle); dy = Math.sin(p.angle); } 
    else { dx /= len; dy /= len; }
    
    p.vx = dx * CONFIG.PLAYER.DASH.SPEED;
    p.vy = dy * CONFIG.PLAYER.DASH.SPEED;
    
    createShockwave(s, p.x, p.y, 100, '#ffffff', 5);
    callbacks.playSound('dash', p.x, p.y); 
    
    for(let i=0; i<10; i++) {
        const pt = s.pools.particles.acquire();
        if(pt) {
            pt.x = p.x; pt.y = p.y;
            pt.vx = -dx * Math.random() * 5; pt.vy = -dy * Math.random() * 5;
            pt.life = 20; pt.maxLife = 20; pt.color = CONFIG.COLORS.PLAYER_DASH; pt.size = 2; pt.active = true;
            s.particles.push(pt);
        }
    }
}

function handleUltimate(s: GameState, callbacks: GameCallbacks) {
    if (s.overdrive < 100) return;
    s.overdrive = 0;
    s.screenFlash = 1.0;
    s.flashColor = CONFIG.COLORS.ULTIMATE;
    s.shake += 20;
    callbacks.playSound('explosion', s.player.x, s.player.y); 
    
    const range = 1000;
    for (const e of s.enemies) {
        if (e.active && !e.dead && Utils.dist(s.player.x, s.player.y, e.x, e.y) < range) {
            e.hp -= 500;
            createExplosion(s, e.x, e.y, CONFIG.COLORS.ULTIMATE, 10, 2);
            if (e.hp <= 0) handleEnemyDeath(s, e, callbacks, {x: 0, y: 0});
        }
    }
    createShockwave(s, s.player.x, s.player.y, range, CONFIG.COLORS.ULTIMATE, 30);
}

function handleSkillQ(s: GameState, callbacks: GameCallbacks) {
    const p = s.player;
    if (p.skills.q.cd > 0 || p.skills.q.active) return;
    p.skills.q.active = true;
    p.skills.q.duration = p.skills.q.maxDuration;
    p.skills.q.cd = p.skills.q.maxCd;
    callbacks.playSound('chrono');
    callbacks.setAudioTempo(0.5); 
    createShockwave(s, p.x, p.y, 800, '#00ffff', 5);
}

function handleSkillE(s: GameState, callbacks: GameCallbacks) {
    const p = s.player;
    if (p.skills.e.cd > 0 || p.skills.e.active) return;
    p.skills.e.active = true;
    p.skills.e.duration = p.skills.e.maxDuration;
    p.skills.e.cd = p.skills.e.maxCd;
    callbacks.playSound('fracture');
    const bh: any = {
        x: p.x + Math.cos(p.angle) * 150,
        y: p.y + Math.sin(p.angle) * 150,
        life: 4.0, maxLife: 4.0, radius: 10, pullRange: 300, color: '#aa00ff', active: true
    };
    s.blackHoles.push(bh);
}

function handlePlayerHit(s: GameState, e: Enemy, callbacks: GameCallbacks) {
    if (s.player.invuln > 0) return;
    let dmg = 20;
    if (e.type === 'tank') dmg = 40;
    if (e.type.startsWith('boss') || e.type === 'procedural_boss') dmg = 50;
    if (e.isElite) dmg *= 1.5;
    
    s.player.hp -= dmg;
    s.player.invuln = CONFIG.PLAYER.INVULN_ON_HIT;
    s.player.hitFlash = 10;
    s.shake += 10;
    s.screenFlash = 0.5;
    s.flashColor = '#ff0000';
    s.combo = 0; 
    callbacks.playSound('hit', s.player.x, s.player.y);
    
    const angle = Math.atan2(s.player.y - e.y, s.player.x - e.x);
    s.camera.kickX += Math.cos(angle) * 20;
    s.camera.kickY += Math.sin(angle) * 20;
    
    if (s.player.hp <= 0) {
        s.player.hp = 0; s.gameOver = true; s.active = false;
        createExplosion(s, s.player.x, s.player.y, CONFIG.COLORS.PLAYER, 50, 5);
        callbacks.onGameOver({
            score: Math.floor(s.score), wave: s.wave, level: s.player.level,
            duration: (Date.now() - s.startTime) / 1000,
            weapon: s.player.weapon, hull: s.player.hull,
            upgrades: Array.from(s.upgradeStacks.entries()).map(([id, count]) => ({ id, count }))
        });
        callbacks.playSound('gameover');
    }
}

// --- WARP SYSTEM ---
function updateWarp(s: GameState, callbacks: GameCallbacks) {
    if (!s.warp.active) return;
    
    s.warp.timer -= 1;
    
    // 1. CHARGE PHASE
    if (s.warp.stage === 'charge') {
        s.shake = Math.min(10, 10 * (1 - s.warp.timer/CONFIG.WARP.CHARGE_TIME));
        s.chromaticAberration = 2.0 * (1 - s.warp.timer/CONFIG.WARP.CHARGE_TIME);
        
        if (s.warp.timer <= 0) {
            s.warp.stage = 'jump';
            s.warp.timer = CONFIG.WARP.JUMP_TIME;
            s.warp.speedFactor = 20.0; // Hyper speed
            callbacks.playSound('warp_jump');
            createShockwave(s, s.player.x, s.player.y, 4000, '#00ffff', 100);
        }
    }
    // 2. JUMP PHASE
    else if (s.warp.stage === 'jump') {
        // Move stars faster
        // Player invisible? or immune?
        s.player.invuln = 10;
        
        if (s.warp.timer <= 0) {
            s.warp.stage = 'arrival';
            s.warp.timer = CONFIG.WARP.ARRIVAL_TIME;
            s.warp.speedFactor = 1.0;
            s.screenFlash = 1.0;
            s.flashColor = '#ffffff';
            
            // EXECUTE WAVE CHANGE
            s.wave++;
            s.waveKills = 0;
            s.waveQuota = Math.floor(s.waveQuota * CONFIG.SPAWNING.QUOTA_MULTIPLIER);
            
            // GENERATE NEW NEBULAE FOR NEW SECTOR
            s.nebulae = [];
            for (let i = 0; i < 5; i++) {
                s.nebulae.push(generateNebula(s.worldWidth, s.worldHeight, s.wave));
            }
        }
    }
    // 3. ARRIVAL PHASE
    else if (s.warp.stage === 'arrival') {
        s.chromaticAberration *= 0.9;
        if (s.warp.timer <= 0) {
            s.warp.active = false;
            createFloatingText(s, s.player.x, s.player.y - 100, "SECTOR " + s.wave, "#00ff00", 40);
        }
    }
}

const EnemiesSystem = {
    update: (s: GameState, callbacks: GameCallbacks) => {
        let bossExists = false; // CRITICAL: Reset per frame

        const p = s.player;
        for (const e of s.enemies) {
            if (!e.active || e.dead) continue;

            if (e.type.startsWith('boss') || e.type === 'procedural_boss') bossExists = true;

            // Status Effects
            for (let i = e.status.length - 1; i >= 0; i--) {
                const st = e.status[i];

                // Visuals
                if (s.frame % 20 === 0) createStatusEffectParticles(s, e, st.type);

                st.timer += s.worldTimeScale;
                // Tick rate: Burn every 30 frames (0.5s), Freeze just exists
                const tickRate = st.type === 'BURN' ? 30 : 60;

                if (st.timer >= tickRate) {
                    st.timer = 0;
                    st.duration -= (tickRate / 60); // Duration in seconds roughly

                    if (st.type === 'BURN') {
                        e.hp -= st.power;
                        e.hitFlash = 2;
                        createFloatingText(s, e.x, e.y - e.size, Math.round(st.power).toString(), '#ffaa00', 12);
                        if (e.hp <= 0) handleEnemyDeath(s, e, callbacks, {x: 0, y: 0});
                    }
                }

                if (st.duration <= 0) {
                    e.status.splice(i, 1);
                }
            }
            
            if (e.hp <= 0 && !e.dead) {
                handleEnemyDeath(s, e, callbacks, {x: 0, y: 0}); 
                continue;
            }

            let moveSpeed = e.speed;
            if (e.status.some(st => st.type === 'FREEZE')) moveSpeed *= 0.5;

            if (e.type === 'snake_body') {
                if (e.parentId) {
                    const parent = s.enemies.find(p => p.id === e.parentId);
                    if (parent && parent.active) {
                         if (!parent.history) parent.history = [];
                         parent.history.push({x: parent.x, y: parent.y});
                         if (parent.history.length > 20) parent.history.shift();
                         
                         const dx = parent.x - e.x;
                         const dy = parent.y - e.y;
                         const dist = Math.hypot(dx, dy);
                         const targetDist = e.size + (parent.size || e.size) - 5;
                         
                         if (dist > targetDist) {
                             const angle = Math.atan2(dy, dx);
                             const tx = parent.x - Math.cos(angle) * targetDist;
                             const ty = parent.y - Math.sin(angle) * targetDist;
                             e.x += (tx - e.x) * 0.2;
                             e.y += (ty - e.y) * 0.2;
                             e.rotation = angle;
                         }
                    } else {
                        e.hp = 0; 
                        handleEnemyDeath(s, e, callbacks, {x: 0, y: 0});
                    }
                }
            } else if (e.type.startsWith('boss') || e.type === 'procedural_boss') {
                applyBossLogic(e, s, callbacks);
                e.x += e.vx * s.worldTimeScale;
                e.y += e.vy * s.worldTimeScale;
                
                // FORCE PUSH MINIONS AWAY FROM BOSS
                const pushRad = 300;
                const minions = s.spatialGrid.queryRadius(e.x, e.y, pushRad);
                for(const m of minions) {
                    if (m !== e && m !== s.player && (m as Enemy).active) {
                        const me = m as Enemy;
                        const dx = me.x - e.x;
                        const dy = me.y - e.y;
                        const d = Math.hypot(dx, dy);
                        if (d < pushRad) {
                            me.vx += (dx / d) * 2;
                            me.vy += (dy / d) * 2;
                        }
                    }
                }

            } else {
                 applySteering(e, s);
                 e.x += e.vx * moveSpeed * s.worldTimeScale;
                 e.y += e.vy * moveSpeed * s.worldTimeScale;
                 
                 if (Math.abs(e.vx) > 0.1 || Math.abs(e.vy) > 0.1) {
                     e.rotation = Math.atan2(e.vy, e.vx);
                 }
            }
            
            // Soft bounds (bounce instead of wrap to prevent poofing)
            const margin = 50;
            if (e.x < -margin) e.vx += 2;
            if (e.x > s.worldWidth + margin) e.vx -= 2;
            if (e.y < -margin) e.vy += 2;
            if (e.y > s.worldHeight + margin) e.vy -= 2;
            
            if (!e.trail) e.trail = [];
            if (s.frame % 5 === 0) {
                e.trail.push({x: e.x, y: e.y});
                if (e.trail.length > 10) e.trail.shift();
            }
        }

        // BOSS FAILSAFE: If game thinks boss is active but no boss entity is found, reset
        if (s.bossActive && !bossExists) {
            console.warn("BOSS SYSTEM FAILSAFE TRIGGERED: No Boss Entity Found. Resetting Arena.");
            s.bossActive = false;
            s.arena.active = false;
            s.arena.alpha = 0;
        }
    }
};

const CleanupSystem = {
    update: (s: GameState) => {
        // --- POOFING BUG FIX: EXPAND BOUNDS CHECK SIGNIFICANTLY ---
        // Entities should only be removed if they are WAY out of bounds.
        // Physics glitches might push them to -1000, so we use a huge margin.
        const DEATH_MARGIN = 3000; 

        for (let i = s.particles.length - 1; i >= 0; i--) {
            const p = s.particles[i];
            p.life -= s.worldTimeScale;
            p.x += p.vx * s.worldTimeScale; 
            p.y += p.vy * s.worldTimeScale;
            p.vx *= p.friction; p.vy *= p.friction;
            if (p.life <= 0) {
                s.pools.particles.release(p);
                s.particles.splice(i, 1);
            }
        }
        
        for (let i = s.gems.length - 1; i >= 0; i--) {
            const g = s.gems[i];
            g.life -= s.worldTimeScale;
            g.x += g.vx * s.worldTimeScale; g.y += g.vy * s.worldTimeScale;
            g.vx *= 0.9; g.vy *= 0.9;
            
            if (s.player.active) {
                const dist = Utils.dist(s.player.x, s.player.y, g.x, g.y);
                if (dist < s.player.stats.magnetRange) {
                    g.x += (s.player.x - g.x) * 0.1;
                    g.y += (s.player.y - g.y) * 0.1;
                    if (dist < CONFIG.GEMS.COLLECT_RADIUS) {
                        s.player.xp += g.val;
                        s.pools.gems.release(g);
                        s.gems.splice(i, 1);
                        continue;
                    }
                }
            }

            if (g.life <= 0) {
                s.pools.gems.release(g);
                s.gems.splice(i, 1);
            }
        }

        for (let i = s.pickups.length - 1; i >= 0; i--) {
            const p = s.pickups[i];
            p.life -= s.worldTimeScale;
            p.x += p.vx * s.worldTimeScale; p.y += p.vy * s.worldTimeScale;
            p.vx *= 0.9; p.vy *= 0.9;
             if (s.player.active) {
                const dist = Utils.dist(s.player.x, s.player.y, p.x, p.y);
                if (dist < s.player.stats.magnetRange) {
                    p.x += (s.player.x - p.x) * 0.05;
                    p.y += (s.player.y - p.y) * 0.05;
                    if (dist < CONFIG.GEMS.COLLECT_RADIUS) {
                        if (p.type === 'heal') s.player.hp = Math.min(s.player.maxHp, s.player.hp + CONFIG.PICKUPS.HEAL_AMOUNT);
                        s.pools.pickups.release(p);
                        s.pickups.splice(i, 1);
                        continue;
                    }
                }
            }
            if (p.life <= 0) {
                s.pools.pickups.release(p);
                s.pickups.splice(i, 1);
            }
        }

        for (let i = s.debris.length - 1; i >= 0; i--) {
            const d = s.debris[i];
            d.x += d.vx * s.worldTimeScale; d.y += d.vy * s.worldTimeScale;
            d.rotation += d.vRot * s.worldTimeScale;
            d.vx *= d.friction; d.vy *= d.friction;
            if (!Utils.inBounds(d.x, d.y, s.worldWidth, s.worldHeight, DEATH_MARGIN)) {
                s.pools.debris.release(d);
                s.debris.splice(i, 1);
            }
        }
        
        for (let i = s.texts.length - 1; i >= 0; i--) {
            const t = s.texts[i];
            t.life -= s.worldTimeScale;
            t.x += t.vx * s.worldTimeScale; t.y += t.vy * s.worldTimeScale;
            t.opacity = t.life / t.maxLife;
            if (t.life <= 0) s.texts.splice(i, 1);
        }
        
        for (let i = s.shockwaves.length - 1; i >= 0; i--) {
            const sw = s.shockwaves[i];
            sw.size += sw.speed * s.worldTimeScale;
            sw.alpha = 1.0 - (sw.size / sw.maxSize);
            if (sw.alpha <= 0) s.shockwaves.splice(i, 1);
        }
        
        for (let i = s.enemies.length - 1; i >= 0; i--) {
            const e = s.enemies[i];
            // Safety Check: Only remove if flag dead OR impossibly far away
            if (e.dead || !Utils.inBounds(e.x, e.y, s.worldWidth, s.worldHeight, DEATH_MARGIN)) {
                s.pools.enemies.release(e);
                s.enemies.splice(i, 1);
            }
        }
        
        for (let i = s.blackHoles.length - 1; i >= 0; i--) {
            const bh = s.blackHoles[i];
            bh.life -= s.worldTimeScale * 0.016;
            if (bh.life <= 0) {
                s.blackHoles.splice(i, 1);
            } else {
                const targets = s.spatialGrid.queryRadius(bh.x, bh.y, bh.pullRange);
                for (const t of targets) {
                    if (t !== s.player) {
                        const e = t as Enemy;
                        if(e.active) {
                            const ang = Math.atan2(bh.y - e.y, bh.x - e.x);
                            const force = 0.5;
                            e.vx += Math.cos(ang) * force;
                            e.vy += Math.sin(ang) * force;
                        }
                    }
                }
            }
        }
    }
};

export const Systems = {
    Camera: {
        update: (s: GameState) => {
            if (!s.player.active) return;
            const lerp = 0.1;
            
            // Standard Follow
            let targetX = s.player.x;
            let targetY = s.player.y;
            
            s.camera.x += (targetX - s.camera.x) * lerp;
            s.camera.y += (targetY - s.camera.y) * lerp;
            
            s.camera.x += s.camera.kickX; 
            s.camera.y += s.camera.kickY;
            s.camera.kickX *= 0.8; 
            s.camera.kickY *= 0.8;
            
            // Warp FOV
            let targetZoom = s.arena.active ? 0.7 : 1.0;
            if (s.warp.active && s.warp.stage === 'jump') targetZoom = 0.4;
            
            s.camera.zoom += (targetZoom - s.camera.zoom) * 0.05;
        }
    },

    Wave: {
        update: (s: GameState, callbacks: GameCallbacks) => {
            // WARP HANDLING
            if (s.warp.active) {
                updateWarp(s, callbacks);
                return; // No spawning during warp
            }

            // Trigger Boss Spawn
            if (!s.bossActive && s.waveKills >= s.waveQuota) { 
                spawnBoss(s, callbacks); 
                return; 
            }
            
            // Stop regular spawning if boss is active
            if (s.bossActive) return;

            s.spawnTimer += s.worldTimeScale;
            // Spawn logic
            if (s.spawnTimer > Math.max(15, 60 * Math.pow(0.95, s.wave))) {
                s.spawnTimer = 0;
                
                // Keep spawning until we hit quota or max enemies
                if (s.enemies.length < CONFIG.SPAWNING.MAX_ENEMIES) {
                    // SQUAD SPAWNING CHANCE
                    if (Math.random() < 0.2) {
                        const types: any[] = ['CHASER', 'SHOOTER', 'DASHER'];
                        const type = types[Math.floor(Math.random() * types.length)];
                        spawnSquad(s, type, Math.floor(Utils.rand(3, 6)), Math.random() > 0.5 ? 'V' : 'LINE');
                    } else {
                        const angle = Math.random() * Math.PI * 2;
                        const dist = 800 / s.camera.zoom;
                        const px = Utils.clamp(s.player.x + Math.cos(angle) * dist, 100, s.worldWidth - 100);
                        const py = Utils.clamp(s.player.y + Math.sin(angle) * dist, 100, s.worldHeight - 100);
                        const e = s.pools.enemies.acquire();
                        if (e) setupEnemy(s, e, 'CHASER', px, py);
                    }
                }
            }
        }
    },

    Player: {
        update: (s: GameState, callbacks: GameCallbacks) => {
            const p = s.player;
            callbacks.updateAudioListener(p.x, p.y);
            if (p.cd > 0) p.cd -= s.playerTimeScale;
            if (p.dashCd > 0) p.dashCd -= s.playerTimeScale;
            if (p.invuln > 0) p.invuln -= s.playerTimeScale;
            if (p.hitFlash > 0) p.hitFlash--;
            if (p.muzzleFlash > 0) p.muzzleFlash--;

            let mx = 0, my = 0;
            const stick = (s as any).stickInput;

            if (s.autoMode) {
                const ai = calculateAutoPilot(s);
                mx = ai.mx; my = ai.my; p.angle = ai.aimAngle;
                if(ai.shoot) handleShooting(s, callbacks);
                if(ai.dash && p.dashCd <= 0) handleDash(s, callbacks, mx, my);
                if(ai.ult && s.overdrive >= 100) handleUltimate(s, callbacks);
                if(ai.q) handleSkillQ(s, callbacks);
                if(ai.e) handleSkillE(s, callbacks);
            } else {
                if (s.keys.w || s.keys.ArrowUp) my -= 1;
                if (s.keys.s || s.keys.ArrowDown) my += 1;
                if (s.keys.a || s.keys.ArrowLeft) mx -= 1;
                if (s.keys.d || s.keys.ArrowRight) mx += 1;

                if (stick && (Math.abs(stick.mx) > 0.05 || Math.abs(stick.my) > 0.05)) {
                    mx = stick.mx;
                    my = stick.my;
                }

                let isShooting = false;
                if (s.mouse.down) {
                    const screenPx = (p.x - s.camera.x) * s.camera.zoom + s.width / 2;
                    const screenPy = (p.y - s.camera.y) * s.camera.zoom + s.height / 2;
                    p.angle = Math.atan2(s.mouse.y - screenPy, s.mouse.x - screenPx);
                    isShooting = true;
                }
                if (stick && (Math.abs(stick.aimX) > 0.1 || Math.abs(stick.aimY) > 0.1)) {
                    p.angle = Math.atan2(stick.aimY, stick.aimX);
                    if (stick.shooting) isShooting = true;
                }

                if (isShooting) handleShooting(s, callbacks);
                if ((s.keys.space || s.keys.shift) && p.dashCd <= 0) handleDash(s, callbacks, mx, my);
                if (s.keys.f && s.overdrive >= 100) handleUltimate(s, callbacks);
                if (s.keys.q) handleSkillQ(s, callbacks);
                if (s.keys.e) handleSkillE(s, callbacks);
            }

            p.vx += mx * CONFIG.PLAYER.THRUST * p.stats.speedMod;
            p.vy += my * CONFIG.PLAYER.THRUST * p.stats.speedMod;
            p.vx *= CONFIG.PLAYER.FRICTION; p.vy *= CONFIG.PLAYER.FRICTION;
            p.recoilX *= 0.8; p.recoilY *= 0.8;
            p.x = Utils.clamp(p.x + p.vx + p.recoilX, 0, s.worldWidth);
            p.y = Utils.clamp(p.y + p.vy + p.recoilY, 0, s.worldHeight);

            if (s.arena.active) {
                const d = Utils.dist(p.x, p.y, s.arena.x, s.arena.y);
                if (d > s.arena.radius - 30) {
                    const ang = Math.atan2(p.y - s.arena.y, p.x - s.arena.x);
                    const pushBack = 2.0;
                    p.vx -= Math.cos(ang) * pushBack;
                    p.vy -= Math.sin(ang) * pushBack;
                    p.x = s.arena.x + Math.cos(ang) * (s.arena.radius - 30);
                    p.y = s.arena.y + Math.sin(ang) * (s.arena.radius - 30);
                }
            }
        }
    },

    Enemies: EnemiesSystem,

    Combat: {
        update: (s: GameState, callbacks: GameCallbacks) => {
            for (let bi = s.bullets.length - 1; bi >= 0; bi--) {
                const b = s.bullets[bi];
                b.x += b.vx * s.worldTimeScale; b.y += b.vy * s.worldTimeScale; b.life -= s.worldTimeScale;
                
                if (b.isBeam && b.beamPoints) {
                    b.beamPoints.push({x: b.x, y: b.y});
                    if (b.beamPoints.length > 20) b.beamPoints.shift();
                }

                // --- TRACKER AI (HOMING LOGIC) ---
                if (b.homing > 0) {
                    const range = 400 + (b.homing * 100);
                    // Use grid to find nearby targets efficiently
                    const targets = s.spatialGrid.queryRadius(b.x, b.y, range);
                    let nearest = null;
                    let minDstSq = range * range;
                    
                    for (let i = 0; i < targets.length; i++) {
                        const t = targets[i] as Enemy;
                        // Filter for active enemies only (excluding player which is in grid)
                        if (t === s.player || !t.active || t.dead || !(t as any).hp) continue;
                        
                        const dx = t.x - b.x;
                        const dy = t.y - b.y;
                        const dSq = dx * dx + dy * dy;
                        
                        if (dSq < minDstSq) {
                            minDstSq = dSq;
                            nearest = t;
                        }
                    }

                    if (nearest) {
                        const speed = Math.hypot(b.vx, b.vy);
                        // Reynolds Steering Behavior
                        const dx = nearest.x - b.x;
                        const dy = nearest.y - b.y;
                        const dist = Math.sqrt(minDstSq); // We know it's nearest

                        if (dist > 0.1) {
                            // Normalized vector to target
                            const desVx = (dx / dist) * speed;
                            const desVy = (dy / dist) * speed;
                            
                            // Steering force = desired - velocity
                            const steerX = desVx - b.vx;
                            const steerY = desVy - b.vy;
                            
                            // Limit turn rate based on homing stat
                            const turnRate = (0.05 + b.homing * 0.1) * s.worldTimeScale;
                            
                            b.vx += steerX * turnRate;
                            b.vy += steerY * turnRate;
                            
                            // Renormalize velocity to maintain projectile speed
                            const newSpeed = Math.hypot(b.vx, b.vy);
                            if (newSpeed > 0.1) {
                                b.vx = (b.vx / newSpeed) * speed;
                                b.vy = (b.vy / newSpeed) * speed;
                            }
                        }
                    }
                }
                // --- END TRACKER AI ---

                // BOUNDS CHECK FOR BOUNCE
                let hitWall = false;
                if (b.x < 0 || b.x > s.worldWidth) { b.vx *= -1; hitWall = true; }
                if (b.y < 0 || b.y > s.worldHeight) { b.vy *= -1; hitWall = true; }
                
                if (hitWall) {
                    if (b.bounce > 0) {
                        b.bounce--;
                        b.life = b.maxLife; // Refresh life on bounce
                        createSparks(s, b.x, b.y, b.vx, b.vy, 3, b.color);
                    } else {
                        b.life = 0;
                    }
                }

                if (b.life <= 0) { s.pools.bullets.release(b); s.bullets.splice(bi, 1); continue; }

                const nearby = s.spatialGrid.queryRadius(b.x, b.y, 60);
                for (let i=0; i<nearby.length; i++) {
                    const ent = nearby[i];
                    // FIX: Cast to any to prevent overlap errors when comparing Entity union types
                    if ((ent as unknown) === s.player) continue;

                    const e = ent as Enemy;
                    if (!e.active || e.dead) continue;
                    
                    if (Utils.dist(b.x, b.y, e.x, e.y) < e.size + b.size) {
                        e.hp -= b.dmg; e.hitFlash = 3;
                        s.damageDealtBuffer += b.dmg; 
                        
                        // EXPLOSIVE AUGMENTATION
                        if (b.explosive > 0) {
                            createExplosion(s, b.x, b.y, b.color, 3, 2);
                            const blastRadius = 100;
                            // Naive AoE loop (optimization: use grid)
                            const targets = s.spatialGrid.queryRadius(b.x, b.y, blastRadius);
                            for(const t of targets) {
                                if (t !== s.player && t.active) {
                                    const dist = Utils.dist(b.x, b.y, t.x, t.y);
                                    if (dist < blastRadius) {
                                        (t as Enemy).hp -= b.dmg * 0.5;
                                    }
                                }
                            }
                        }

                        // SPLIT AUGMENTATION
                        if (b.split > 0 && b.generation < 1) {
                            for(let k=0; k<2; k++) {
                                const splitB = s.pools.bullets.acquire();
                                if(splitB) {
                                    splitB.active = true;
                                    splitB.x = b.x; splitB.y = b.y;
                                    const ang = Math.atan2(b.vy, b.vx) + (k===0 ? 0.5 : -0.5);
                                    splitB.vx = Math.cos(ang) * 10;
                                    splitB.vy = Math.sin(ang) * 10;
                                    splitB.dmg = b.dmg * 0.5;
                                    splitB.color = b.color;
                                    splitB.life = 20;
                                    splitB.size = b.size * 0.6;
                                    splitB.generation = b.generation + 1;
                                    s.bullets.push(splitB);
                                }
                            }
                        }

                        // ELEMENTAL APPLICATION
                        if (b.elemental.fire > 0) {
                            // 20% dmg per tick, 3s duration (6 ticks) -> 120% total dmg bonus over time if full duration
                            const burnDmg = b.dmg * 0.2 * b.elemental.fire;
                            applyStatusEffect(s, e, 'BURN', burnDmg, 3.0);
                        }
                        if (b.elemental.ice > 0) {
                            const duration = 2.0 + (b.elemental.ice * 0.5);
                            applyStatusEffect(s, e, 'FREEZE', 0, duration);
                        }
                        if (b.elemental.volt > 0) {
                            const chains = b.elemental.volt + 2;
                            triggerChainLightning(s, e, b.dmg * 0.6, chains, 200, callbacks);
                        }

                        createSparks(s, b.x, b.y, b.vx, b.vy, 3, b.color);
                        if (e.hp <= 0) handleEnemyDeath(s, e, callbacks, {x: b.vx, y: b.vy});
                        
                        // PIERCE & BOUNCE LOGIC
                        if (b.pierce > 0) {
                            b.pierce--;
                        } else if (b.bounce > 0) {
                            b.bounce--;
                            // Reflect off enemy? Simplified: bounce back randomly
                            const norm = Math.atan2(b.y - e.y, b.x - e.x);
                            b.vx = Math.cos(norm) * 10;
                            b.vy = Math.sin(norm) * 10;
                        } else {
                            b.life = 0; 
                            break; 
                        }
                    }
                }
            }

            if (s.player.active && s.player.invuln <= 0) {
                const nearby = s.spatialGrid.queryRadius(s.player.x, s.player.y, 80);
                for (let i=0; i<nearby.length; i++) {
                    const ent = nearby[i];
                    // FIX: Cast to any to prevent overlap errors when comparing Entity union types
                    if ((ent as unknown) === s.player) continue;

                    const e = ent as Enemy;
                    if (e.dead || !e.active) continue;

                    const rad = e.modules ? 60 : e.size; 
                    if (Utils.dist(e.x, e.y, s.player.x, s.player.y) < rad + 15) {
                        handlePlayerHit(s, e, callbacks);
                        break; 
                    }
                }
            }
        }
    },
    Cleanup: CleanupSystem
};
