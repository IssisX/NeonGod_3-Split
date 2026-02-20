
import { GameState, Enemy, Player, BossModule, Bullet } from '../types';
import { CONFIG } from '../constants';
import { Utils } from '../utils';

// --- VISUAL HELPERS ---

function drawEnginePlume(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, power: number, color: string) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.globalCompositeOperation = 'lighter';
    
    // Core
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    const coreLen = 10 + power * 20 + Math.sin(Date.now() * 0.1) * 3;
    ctx.moveTo(0, 0); ctx.lineTo(-coreLen, -2); ctx.lineTo(-coreLen * 1.2, 0); ctx.lineTo(-coreLen, 2);
    ctx.closePath(); ctx.fill();
    
    // Outer Glow
    ctx.fillStyle = color;
    ctx.beginPath();
    const outerLen = 20 + power * 40 + Math.cos(Date.now() * 0.08) * 5;
    ctx.moveTo(0, 0); ctx.lineTo(-outerLen, -5); ctx.lineTo(-outerLen * 1.3, 0); ctx.lineTo(-outerLen, 5);
    ctx.closePath(); ctx.fill();
    
    // Particles
    if (power > 0.5) {
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        for(let i=1; i<=3; i++) {
            const d = i * 15 + (Date.now() % 200) * 0.1;
            ctx.beginPath(); ctx.ellipse(-d, 0, 3, 5, 0, 0, Math.PI*2); ctx.fill();
        }
    }
    ctx.restore();
}

function drawDissipatingTrail(ctx: CanvasRenderingContext2D, trail: {x: number, y: number}[], color: string, width: number) {
    if (trail.length < 2) return;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i < trail.length - 1; i++) {
        const p1 = trail[i];
        const p2 = trail[i+1];
        ctx.moveTo(p1.x, p1.y); 
        ctx.lineTo(p2.x, p2.y); 
    }
    
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.globalAlpha = 0.4;
    ctx.stroke();
    
    // Inner core for neon effect
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = width * 0.3;
    ctx.globalAlpha = 0.6;
    ctx.stroke();
    ctx.restore();
}

// UPGRADED: Reactive Data Injection
// R: Heat (Additive)
// G: Gravity (Additive)
// B: Turbulence/Movement (Additive)
function drawDistortion(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, intensity: number, type: 'heat' | 'gravity' | 'turbulence') {
    const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);

    const i255 = Math.min(255, Math.floor(intensity * 255));

    const r = type === 'heat' ? i255 : 0;
    const g = type === 'gravity' ? i255 : 0;
    const b = type === 'turbulence' ? i255 : 0;

    grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 1.0)`);
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.globalCompositeOperation = 'lighter'; // Accumulate distortion
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over'; // Reset
}

// NEW: Draws a velocity trail into the Blue channel (Turbulence)
function drawFlowTrail(ctx: CanvasRenderingContext2D, x: number, y: number, vx: number, vy: number, size: number) {
    const speed = Math.hypot(vx, vy);
    if (speed < 0.1) return;

    // Scale turbulence by speed, capped at reasonable limit
    const intensity = Math.min(1.0, speed * 0.1);
    const trailSize = size * 2.5;

    // Draw elongated ellipse along velocity vector
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.atan2(vy, vx));

    // Gradient: Center is high turbulence, tail is low
    const grad = ctx.createLinearGradient(0, 0, -trailSize, 0);
    const b = Math.floor(intensity * 255);
    grad.addColorStop(0, `rgba(0, 0, ${b}, 1.0)`);
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(-trailSize/2, 0, trailSize/2, size, 0, 0, Math.PI*2);
    ctx.fill();

    ctx.restore();
}

function drawWorldBoundary(ctx: CanvasRenderingContext2D, s: GameState) {
    const p = s.player;
    const margin = 500;
    if (p.x > margin && p.x < s.worldWidth - margin && p.y > margin && p.y < s.worldHeight - margin) return;

    ctx.save();
    ctx.strokeStyle = '#ff0055';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#ff0055';
    ctx.shadowBlur = 10;
    ctx.globalAlpha = 0.5 + Math.sin(s.frame * 0.1) * 0.2;

    ctx.strokeRect(0, 0, s.worldWidth, s.worldHeight);

    ctx.beginPath();
    const tickSize = 50;
    const step = 200;
    // Corners
    ctx.moveTo(0, 0); ctx.lineTo(tickSize, 0); ctx.moveTo(0, 0); ctx.lineTo(0, tickSize);
    ctx.moveTo(s.worldWidth, 0); ctx.lineTo(s.worldWidth - tickSize, 0); ctx.moveTo(s.worldWidth, 0); ctx.lineTo(s.worldWidth, tickSize);
    ctx.moveTo(0, s.worldHeight); ctx.lineTo(tickSize, s.worldHeight); ctx.moveTo(0, s.worldHeight); ctx.lineTo(0, s.worldHeight - tickSize);
    ctx.moveTo(s.worldWidth, s.worldHeight); ctx.lineTo(s.worldWidth - tickSize, s.worldHeight); ctx.moveTo(s.worldWidth, s.worldHeight); ctx.lineTo(s.worldWidth, s.worldHeight - tickSize);
    
    for(let i=step; i<s.worldWidth; i+=step) { ctx.moveTo(i, 0); ctx.lineTo(i, 20); ctx.moveTo(i, s.worldHeight); ctx.lineTo(i, s.worldHeight - 20); }
    for(let i=step; i<s.worldHeight; i+=step) { ctx.moveTo(0, i); ctx.lineTo(20, i); ctx.moveTo(s.worldWidth, i); ctx.lineTo(s.worldWidth - 20, i); }
    ctx.stroke();
    ctx.restore();
}

function drawEntityHP(ctx: CanvasRenderingContext2D, x: number, y: number, hp: number, maxHp: number, size: number, color: string, isBoss: boolean, hitFlash: number) {
    if (hp >= maxHp && !isBoss) return;
    
    const pct = Math.max(0, hp / maxHp);
    const width = isBoss ? 120 : size * 2.5;
    const height = isBoss ? 8 : 4;
    const yOff = isBoss ? -size - 40 : -size - 15;
    
    ctx.save();
    
    // HP Glitch on Hit
    let gx = x, gy = y + yOff;
    if (hitFlash > 0) {
        gx += (Math.random()-0.5) * 5;
        gy += (Math.random()-0.5) * 5;
    }
    
    ctx.translate(gx, gy);
    
    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(-width/2, 0, width, height);
    
    // Bar
    ctx.fillStyle = hitFlash > 0 ? '#ffffff' : color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    ctx.fillRect(-width/2, 0, width * pct, height);
    
    // Border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 1;
    ctx.shadowBlur = 0;
    ctx.strokeRect(-width/2, 0, width, height);
    
    // Boss Shield/Armor segments
    if (isBoss) {
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`${Math.ceil(hp)}`, 0, -5);
        
        // Segments
        ctx.strokeStyle = '#000';
        ctx.beginPath();
        for(let i=1; i<10; i++) {
            const xPos = -width/2 + (width/10)*i;
            ctx.moveTo(xPos, 0); ctx.lineTo(xPos, height);
        }
        ctx.stroke();
    }
    
    ctx.restore();
}

// --- BOSS RENDERER ---

function drawBossModule(ctx: CanvasRenderingContext2D, mod: BossModule, hitFlash: number) {
    ctx.save();
    ctx.translate(mod.xOffset, mod.yOffset);
    ctx.rotate(mod.rotation);

    const pulse = 1.0 + Math.sin(Date.now() * 0.005) * 0.02;
    ctx.scale(pulse, pulse);

    ctx.shadowColor = mod.color;
    ctx.shadowBlur = hitFlash > 0 ? 30 : 10;

    ctx.beginPath();
    if (mod.shape.length >= 2) {
        ctx.moveTo(mod.shape[0], mod.shape[1]);
        for(let k=2; k<mod.shape.length; k+=2) {
            ctx.lineTo(mod.shape[k], mod.shape[k+1]);
        }
    }
    ctx.closePath();

    if (hitFlash > 0) {
        ctx.fillStyle = '#ffffff';
    } else {
        const grad = ctx.createLinearGradient(-20, -20, 20, 20);
        grad.addColorStop(0, mod.color);
        grad.addColorStop(0.6, '#111');
        grad.addColorStop(1, mod.color);
        ctx.fillStyle = grad;
    }
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Tech Details
    if (mod.type === 'CORE' || mod.type === 'ENGINE') {
        const reactorPulse = Math.sin(Date.now() * 0.01) * 0.5 + 0.5;
        ctx.fillStyle = `rgba(255, 255, 255, ${reactorPulse})`;
        ctx.beginPath(); ctx.arc(0,0, mod.size * 0.15, 0, Math.PI*2); ctx.fill();
    }
    
    if (mod.type === 'TURRET') {
        ctx.fillStyle = '#000';
        ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI*2); ctx.fill();
    }

    ctx.shadowBlur = 0;
    ctx.restore();
}

function drawBossFace(ctx: CanvasRenderingContext2D, e: Enemy) {
    // PERSONALITY ENGINE: Reacts to velocity and state
    const speed = Math.hypot(e.vx, e.vy);
    const isHurt = e.hitFlash > 0;
    const isCharging = e.state === 'charge'; 
    const isFast = speed > 1.5;
    
    ctx.save();
    // Assuming we are already translated to boss center (0,0 of entity)
    // Draw the "Core Interface" on top of the base chassis
    
    // 1. Monitor Frame
    ctx.fillStyle = '#000000';
    ctx.strokeStyle = e.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-22, -16, 44, 32, 4);
    ctx.fill();
    ctx.stroke();
    
    // Glitch offset for hurt state
    const gx = isHurt ? (Math.random()-0.5)*4 : 0;
    const gy = isHurt ? (Math.random()-0.5)*4 : 0;
    ctx.translate(gx, gy);

    // 2. Eyes
    // Colors: Cyan (Idle), Red (Fast/Hurt), White (Charging)
    const eyeColor = isCharging ? '#ffffff' : (isFast || isHurt ? '#ff0000' : e.color);
    ctx.fillStyle = eyeColor;
    ctx.shadowColor = eyeColor;
    ctx.shadowBlur = isCharging ? 20 : 10;

    let eyeW = 10, eyeH = 6, eyeGap = 12, tilt = 0;

    if (isHurt) {
        // ERROR / PAIN: Wide, mismatched
        eyeW = 12; eyeH = 12; 
        ctx.fillRect(-eyeGap - eyeW/2, -5 - eyeH/2, eyeW, eyeH);
        ctx.fillRect(eyeGap - eyeW/2, -5 - eyeH/2 + (Math.random()*4), eyeW, eyeH * 0.5);
    } else if (isFast) {
        // AGGRESSION: Narrow slits, tilted down
        eyeW = 14; eyeH = 3; tilt = 0.3;
        
        ctx.save();
        ctx.translate(-eyeGap, -4); ctx.rotate(tilt);
        ctx.fillRect(-eyeW/2, -eyeH/2, eyeW, eyeH);
        ctx.restore();
        
        ctx.save();
        ctx.translate(eyeGap, -4); ctx.rotate(-tilt);
        ctx.fillRect(-eyeW/2, -eyeH/2, eyeW, eyeH);
        ctx.restore();
    } else if (isCharging) {
        // POWER: Glowing Orbs
        ctx.beginPath(); ctx.arc(-eyeGap, -4, 6, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(eyeGap, -4, 6, 0, Math.PI*2); ctx.fill();
    } else {
        // IDLE: Neutral rectangles, blinking
        if (Math.random() < 0.02) eyeH = 1; // Blink
        ctx.fillRect(-eyeGap - eyeW/2, -4 - eyeH/2, eyeW, eyeH);
        ctx.fillRect(eyeGap - eyeW/2, -4 - eyeH/2, eyeW, eyeH);
    }

    // 3. Mouth / Voice Visualizer
    ctx.fillStyle = eyeColor;
    ctx.shadowBlur = 0;
    
    if (isHurt) {
        // STATIC NOISE
        for(let i=0; i<10; i++) {
            const h = Math.random() * 6;
            ctx.fillRect(-15 + i*3, 8 - h/2, 2, h);
        }
    } else if (isFast) {
        // GRITTED TEETH MESH
        ctx.beginPath();
        ctx.rect(-14, 6, 28, 8);
        ctx.clip();
        ctx.strokeStyle = eyeColor;
        ctx.lineWidth = 1;
        // Crosshatch
        ctx.beginPath();
        for(let i=-20; i<20; i+=4) {
            ctx.moveTo(i, 0); ctx.lineTo(i+10, 20);
            ctx.moveTo(i, 20); ctx.lineTo(i+10, 0);
        }
        ctx.stroke();
    } else {
        // IDLE PULSE / VOICE
        const w = 20 + Math.sin(Date.now() * 0.01) * 10;
        const h = 2;
        ctx.fillRect(-w/2, 10 - h/2, w, h);
    }

    ctx.restore();
}

function drawMechanicalLimb(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
    ctx.save();
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo((x1+x2)/2, (y1+y2)/2); ctx.stroke();
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.arc(x1, y1, 5, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(x2, y2, 5, 0, Math.PI*2); ctx.fill();
    ctx.restore();
}

function drawInterceptor(ctx: CanvasRenderingContext2D, p: Player, s: GameState) {
    const power = Math.hypot(p.vx, p.vy) / 5;
    drawEnginePlume(ctx, -12, -6, Math.PI, power, '#00ffff');
    drawEnginePlume(ctx, -12, 6, Math.PI, power, '#00ffff');
    const color = p.hitFlash > 0 ? '#ffffff' : CONFIG.COLORS.PLAYER;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(15, 0); ctx.lineTo(-10, -10); ctx.lineTo(-5, 0); ctx.lineTo(-10, 10); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#005577'; ctx.beginPath(); ctx.moveTo(-5, -5); ctx.lineTo(-15, -15); ctx.lineTo(-5, -10); ctx.moveTo(-5, 5); ctx.lineTo(-15, 15); ctx.lineTo(-5, 10); ctx.fill();
    ctx.fillStyle = '#000'; ctx.beginPath(); ctx.moveTo(5, 0); ctx.lineTo(0, -3); ctx.lineTo(0, 3); ctx.fill();
}

function drawBastion(ctx: CanvasRenderingContext2D, p: Player, s: GameState) {
    const power = Math.hypot(p.vx, p.vy) / 5;
    drawEnginePlume(ctx, -15, 0, Math.PI, power * 1.5, '#ff5500');
    const color = p.hitFlash > 0 ? '#ffffff' : '#ff5500';
    ctx.fillStyle = color; ctx.fillRect(-15, -10, 25, 20);
    ctx.fillStyle = '#552200'; ctx.fillRect(-12, -12, 10, 4); ctx.fillRect(-12, 8, 10, 4);
}

function drawArchitect(ctx: CanvasRenderingContext2D, p: Player, s: GameState) {
    const power = Math.hypot(p.vx, p.vy) / 5;
    drawEnginePlume(ctx, -8, -8, Math.PI + 0.2, power, '#00ffaa');
    drawEnginePlume(ctx, -8, 8, Math.PI - 0.2, power, '#00ffaa');
    const color = p.hitFlash > 0 ? '#ffffff' : '#00ffaa';
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#00ffaa'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 12 + Math.sin(s.frame*0.1)*2, 0, Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(10, -10); ctx.lineTo(20, -15); ctx.moveTo(10, 10); ctx.lineTo(20, 15); ctx.stroke();
}

// --- MAIN RENDERER ---

export function renderGame(ctx: CanvasRenderingContext2D, distCtx: CanvasRenderingContext2D, s: GameState) {
    const w = ctx.canvas.width / s.pixelRatio;
    const h = ctx.canvas.height / s.pixelRatio;

    if (s.player.skills.q.active) ctx.fillStyle = '#000000'; 
    else ctx.fillStyle = CONFIG.COLORS.BACKGROUND;
    ctx.fillRect(0, 0, w, h);
    
    // Clear Distortion Map with Transparent Black (Important for additive blending)
    distCtx.clearRect(0, 0, w, h);
    distCtx.fillStyle = '#000000'; 
    distCtx.fillRect(0, 0, w, h);

    ctx.save(); distCtx.save();
    
    const shakeX = (Math.random() - 0.5) * s.shake + s.camera.kickX; 
    const shakeY = (Math.random() - 0.5) * s.shake + s.camera.kickY;
    const camX = s.camera.x + shakeX; 
    const camY = s.camera.y + shakeY;
    
    ctx.translate(w/2, h/2); ctx.scale(s.camera.zoom, s.camera.zoom); ctx.translate(-camX, -camY);
    distCtx.translate(w/2, h/2); distCtx.scale(s.camera.zoom, s.camera.zoom); distCtx.translate(-camX, -camY);

    // BACKGROUND NEBULAE (Visuals only, no distortion impact)
    if (s.nebulae) {
        for(const neb of s.nebulae) {
            ctx.save();
            ctx.globalAlpha = neb.opacity * 0.5;
            ctx.globalCompositeOperation = 'screen';
            const grad = ctx.createRadialGradient(neb.x, neb.y, 0, neb.x, neb.y, neb.radius);
            grad.addColorStop(0, neb.color);
            grad.addColorStop(1, 'transparent');
            ctx.fillStyle = grad;
            ctx.beginPath(); ctx.arc(neb.x, neb.y, neb.radius, 0, Math.PI*2); ctx.fill();
            ctx.restore();
        }
    }

    if (s.visualGrid) s.visualGrid.render(ctx, s.quality === 'LOW' ? 2 : 1);
    
    drawWorldBoundary(ctx, s);

    // STARFIELD & WARP
    const warpFactor = s.warp.active && s.warp.stage === 'jump' ? 100 : 1;
    for(const star of s.stars) {
        ctx.fillStyle = `rgba(255, 255, 255, ${star.brightness * (s.player.skills.q.active ? 0.2 : 1.0)})`;
        ctx.beginPath();
        if (warpFactor > 1) {
            // Warp streak
            ctx.moveTo(star.x, star.y);
            ctx.lineTo(star.x - (s.player.vx || 10) * star.z * 5, star.y - (s.player.vy || 0) * star.z * 5);
            ctx.strokeStyle = `rgba(255, 255, 255, ${star.brightness})`;
            ctx.lineWidth = star.size;
            ctx.stroke();
        } else {
            ctx.arc(star.x, star.y, star.size * star.z, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    
    if (s.arena.active || s.arena.alpha > 0) {
        ctx.save();
        ctx.globalAlpha = Math.min(1.0, s.arena.alpha * 1.5); // Increase visibility
        ctx.strokeStyle = '#ff0055';
        ctx.lineWidth = 4 + Math.sin(s.frame * 0.2) * 2; 
        ctx.setLineDash([30, 10]);
        ctx.lineDashOffset = -s.frame * 2; 
        ctx.beginPath();
        ctx.arc(s.arena.x, s.arena.y, s.arena.radius, 0, Math.PI * 2);
        ctx.stroke();
        
        ctx.fillStyle = 'rgba(255, 0, 85, 0.1)';
        ctx.fill();
        
        // Draw confinement warnings
        if (s.frame % 60 < 30) {
            ctx.fillStyle = '#ff0055';
            ctx.font = 'bold 20px monospace';
            ctx.textAlign = 'center';
            ctx.fillText("⚠ CONTAINMENT FIELD ACTIVE ⚠", s.arena.x, s.arena.y - s.arena.radius - 20);
        }

        drawDistortion(distCtx, s.arena.x, s.arena.y, s.arena.radius + 20, 0.5, 'heat');
        ctx.restore();
    }

    for(const bh of s.blackHoles) {
        if(bh.active) {
            ctx.fillStyle = '#000'; 
            ctx.shadowBlur = 30; ctx.shadowColor = bh.color;
            ctx.beginPath(); ctx.arc(bh.x, bh.y, bh.radius, 0, Math.PI * 2); ctx.fill(); 
            ctx.shadowBlur = 0;
            ctx.strokeStyle = bh.color; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(bh.x, bh.y, bh.radius * 1.5 + Math.sin(s.frame * 0.5) * 5, 0, Math.PI * 2); ctx.stroke();
            ctx.fillStyle = '#fff';
            for(let i=0; i<8; i++) {
                const ang = s.frame * 0.1 + (i * Math.PI / 4);
                const dist = bh.radius * 2;
                ctx.beginPath(); ctx.arc(bh.x + Math.cos(ang)*dist, bh.y + Math.sin(ang)*dist, 2, 0, Math.PI*2); ctx.fill();
            }
            drawDistortion(distCtx, bh.x, bh.y, bh.pullRange, 2.0, 'gravity');
        }
    }

    for(const d of s.debris) {
        if (!d.active) continue;
        ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(d.rotation);
        
        if (d.type === 'scrap') {
            ctx.strokeStyle = d.color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(-d.size, 0);
            ctx.lineTo(d.size, 0);
            ctx.moveTo(0, -d.size/2);
            ctx.lineTo(0, d.size/2);
            ctx.stroke();
            
        } else if (d.type === 'asteroid') {
            ctx.shadowColor = '#000'; ctx.shadowBlur = 10;
            ctx.beginPath();
            const step = (Math.PI * 2) / d.sides;
            for(let i=0; i<d.sides; i++) {
                const r = d.size * (0.8 + Math.sin(i * 123.1) * 0.2); 
                ctx.lineTo(Math.cos(step*i)*r, Math.sin(step*i)*r);
            }
            ctx.closePath(); ctx.fill();
            ctx.strokeStyle = '#222233'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(-d.size/2, 0); ctx.lineTo(0, d.size/4); ctx.lineTo(d.size/3, -d.size/4); ctx.stroke();
        } else {
            ctx.beginPath();
            const step = (Math.PI * 2) / d.sides;
            for(let i=0; i<d.sides; i++) ctx.lineTo(Math.cos(step*i)*d.size, Math.sin(step*i)*d.size);
            ctx.closePath(); ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1; ctx.stroke();
        }

        // Debris turbulence
        if (Math.abs(d.vx) > 0.1 || Math.abs(d.vy) > 0.1) {
             drawFlowTrail(distCtx, d.x, d.y, d.vx, d.vy, d.size);
        }

        ctx.restore();
    }

    // ENEMIES
    for(const e of s.enemies) {
        if (!e.active || e.dead) continue;

        // Reactive Turbulence
        drawFlowTrail(distCtx, e.x, e.y, e.vx, e.vy, e.size);

        ctx.save(); ctx.translate(e.x, e.y);
        
        if (e.trail && e.trail.length > 1) {
            ctx.restore(); drawDissipatingTrail(ctx, e.trail, e.color, e.size * 0.5); ctx.save(); ctx.translate(e.x, e.y);
        }

        if (e.modules) {
            const rot = s.frame * 0.005; 
            ctx.rotate(rot);
            for(const mod of e.modules) drawMechanicalLimb(ctx, 0, 0, mod.xOffset, mod.yOffset);
            for(const mod of e.modules) drawBossModule(ctx, mod, e.hitFlash);
            ctx.rotate(-rot); // Unrotate for the face
            
            // Draw Boss Face on top of core (assuming core is central)
            drawBossFace(ctx, e);
            
        } else {
            let rot = Math.atan2(e.vy, e.vx);
            if (e.type === 'snake_head') rot = e.rotation;
            if (e.type === 'orbiter') rot = s.frame * 0.05;
            ctx.rotate(rot);
            
            // ENGINE TRAILS FOR ALL ENEMIES (WOW FACTOR)
            const speed = Math.hypot(e.vx, e.vy);
            drawEnginePlume(ctx, -e.size, 0, Math.PI, speed * 0.3, e.color);

            const color = e.hitFlash > 0 ? '#ffffff' : e.color;
            ctx.fillStyle = color;
            ctx.beginPath();
            if (e.sides === 0) {
                ctx.arc(0, 0, e.size, 0, Math.PI * 2);
            } else {
                const step = (Math.PI * 2) / e.sides;
                const off = e.type === 'tank' ? Math.PI/e.sides : 0;
                ctx.moveTo(e.size, 0);
                for(let i=1; i<=e.sides; i++) ctx.lineTo(Math.cos(step*i + off) * e.size, Math.sin(step*i + off) * e.size);
            }
            ctx.closePath(); ctx.fill();
            
            // Inner detail for elites
            if (e.isElite) {
                ctx.fillStyle = '#000';
                ctx.beginPath(); ctx.arc(0,0, e.size*0.4, 0, Math.PI*2); ctx.fill();
                ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke();
            }
            
            ctx.shadowColor = e.color; ctx.shadowBlur = 10;
            ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1; ctx.stroke();
            ctx.shadowBlur = 0;
        }
        
        if (e.invulnerable) {
            ctx.strokeStyle = '#00ffff'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(0, 0, e.size + 8, 0, Math.PI*2); ctx.stroke();
        }
        ctx.restore();
        
        // HP BARS
        if (e.isElite || e.type.startsWith('boss') || e.type === 'procedural_boss') {
            drawEntityHP(ctx, e.x, e.y, e.hp, e.maxHp, e.size, e.color, !!e.modules, e.hitFlash);
        }
    }

    const p = s.player;
    if (p.active) {
        // Player Turbulence
        drawFlowTrail(distCtx, p.x, p.y, p.vx, p.vy, 20);

        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.angle);
        const bank = p.roll || 0;
        const bankScale = Math.max(0.6, 1.0 - Math.abs(bank * 0.4));
        ctx.transform(1, 0, -bank * 0.2, bankScale, 0, 0);

        if (p.dashCd > (p.maxDashCd - CONFIG.PLAYER.DASH.INVULN_DURATION)) {
            ctx.globalAlpha = 0.5; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(-20, -20, 40, 40);
        }

        if (p.hull === 'INTERCEPTOR') drawInterceptor(ctx, p, s);
        else if (p.hull === 'BASTION') drawBastion(ctx, p, s);
        else if (p.hull === 'ARCHITECT') drawArchitect(ctx, p, s);
        else drawInterceptor(ctx, p, s);

        if (s.orbitals.length > 0) {
            ctx.scale(1.0, 1.0/bankScale);
            for(const o of s.orbitals) {
                 o.angle += 0.05;
                 const ox = Math.cos(o.angle) * o.dist; const oy = Math.sin(o.angle) * o.dist;
                 ctx.fillStyle = '#00ffff'; ctx.beginPath(); ctx.arc(ox, oy, 6, 0, Math.PI * 2); ctx.fill();
                 ctx.strokeStyle = 'rgba(0,255,255,0.2)'; ctx.beginPath(); ctx.arc(0,0, o.dist, o.angle - 0.5, o.angle); ctx.stroke();
            }
        }
        ctx.restore();
        drawDistortion(distCtx, p.x + Math.cos(p.angle)*-20, p.y + Math.sin(p.angle)*-20, 30, 0.5, 'heat');
        if (p.muzzleFlash > 0) {
            const hx = p.x + Math.cos(p.angle)*30; const hy = p.y + Math.sin(p.angle)*30;
            drawDistortion(distCtx, hx, hy, 50, 0.8, 'heat');
            ctx.fillStyle = '#ffffaa'; ctx.beginPath(); ctx.arc(hx, hy, 15, 0, Math.PI*2); ctx.fill();
        }
    }

    for(const b of s.bullets) {
        if (!b.active) continue;
        drawDistortion(distCtx, b.x, b.y, b.size * 4, 0.3, 'heat');
        if (b.isBeam) {
             ctx.strokeStyle = b.color; ctx.lineWidth = b.size; ctx.shadowBlur = 10; ctx.shadowColor = b.color;
             ctx.beginPath();
             if(b.beamPoints) for(let i=0; i<b.beamPoints.length; i++) { const pt = b.beamPoints[i]; if(i===0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y); }
             ctx.stroke(); ctx.lineWidth = 1; ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.shadowBlur = 0;
        } else {
             if (b.trail) drawDissipatingTrail(ctx, b.trail, b.color, b.size * 0.8);
             ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = b.color; ctx.shadowColor = b.color; ctx.shadowBlur = 10;
             ctx.beginPath(); ctx.arc(b.x, b.y, b.size, 0, Math.PI * 2); ctx.fill();
             ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(b.x, b.y, b.size * 0.6, 0, Math.PI * 2); ctx.fill();
             ctx.restore();
        }
    }

    for(const sw of s.shockwaves) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = sw.color; ctx.lineWidth = sw.width; ctx.globalAlpha = sw.alpha;
        ctx.beginPath(); ctx.arc(sw.x, sw.y, sw.size, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
        drawDistortion(distCtx, sw.x, sw.y, sw.size, sw.alpha, 'heat');
    }

    for(const pt of s.particles) {
        if(!pt.active) continue;
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = pt.color; ctx.globalAlpha = pt.life / pt.maxLife;
        ctx.beginPath(); if (pt.type === 'spark') ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2); else ctx.rect(pt.x - pt.size/2, pt.y - pt.size/2, pt.size, pt.size);
        ctx.fill(); ctx.restore();
    }

    for(const g of s.gems) {
        if(!g.active) continue;
        ctx.fillStyle = CONFIG.COLORS.XP_GEM; ctx.shadowColor = CONFIG.COLORS.XP_GEM; ctx.shadowBlur = 5;
        ctx.beginPath(); ctx.moveTo(g.x, g.y - 4); ctx.lineTo(g.x + 4, g.y); ctx.lineTo(g.x, g.y + 4); ctx.lineTo(g.x - 4, g.y); ctx.fill(); ctx.shadowBlur = 0;
    }
    for(const p of s.pickups) {
        if(!p.active) continue;
        ctx.fillStyle = CONFIG.PICKUPS.COLOR; ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(p.x - 3, p.y); ctx.lineTo(p.x + 3, p.y); ctx.moveTo(p.x, p.y - 3); ctx.lineTo(p.x, p.y + 3); ctx.stroke();
    }
    for(const t of s.texts) { 
        ctx.save(); ctx.translate(t.x, t.y); ctx.globalAlpha = t.opacity;
        ctx.font = `bold ${t.size}px monospace`; ctx.textAlign = 'center'; ctx.fillStyle = t.color;
        if (t.isCrit) { ctx.shadowColor = t.color; ctx.shadowBlur = 10; ctx.scale(1.2, 1.2); }
        ctx.fillText(t.text, 0, 0); ctx.restore();
    }

    ctx.restore(); distCtx.restore();
    if (s.screenFlash > 0) { ctx.fillStyle = s.flashColor; ctx.globalAlpha = s.screenFlash * 0.3; ctx.fillRect(0, 0, w, h); ctx.globalAlpha = 1.0; }
}
