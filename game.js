const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

/* ======================
   APP FLOW (MENU / PLAY / GAMEOVER)
====================== */
const UI = {
    mainMenu: document.getElementById("mainMenu"),
    gameOver: document.getElementById("gameOver"),
    gameOverDesc: document.getElementById("gameOverDesc"),
    btnStart: document.getElementById("btnStart"),
    btnToMain: document.getElementById("btnToMain"),
    hud: document.getElementById("hud")
};

const AppState = {
    MENU: "menu",
    PLAYING: "playing",
    GAMEOVER: "gameover"
};

let appState = AppState.MENU;
let rafId = null;

function setAppState(next) {
    appState = next;

    const isMenu = next === AppState.MENU;
    const isPlaying = next === AppState.PLAYING;
    const isGameOver = next === AppState.GAMEOVER;

    if (UI.mainMenu) UI.mainMenu.classList.toggle("is-hidden", !isMenu);
    if (UI.gameOver) UI.gameOver.classList.toggle("is-hidden", !isGameOver);

    // HUD는 플레이 중에만
    if (UI.hud) UI.hud.style.display = isPlaying ? "" : "none";

    // 보스 HUD는 플레이 중이 아닐 때는 숨김
    if (!isPlaying) setBossHudVisible(false);
}

function stopLoop() {
    if (rafId != null) cancelAnimationFrame(rafId);
    rafId = null;
}

function safeClearInputs() {
    shooting = false;
    for (const k in keys) delete keys[k];
}

/* ======================
   GAME STATE
====================== */
const GameState = {
    WAVE: "wave",
    BOSS: "boss"
};

let gameState = GameState.WAVE;
let stage = 1;
let wave = 1;
const WAVES_PER_STAGE = 3;
let shooting = false;
let shootCooldown = 0;
let damageTexts = [];
let meleeEffects = [];

const CONTACT = {
    DEFAULT_INTERVAL_MS: 500, // 타입에서 따로 지정 안하면 기본 0.5초
    BLINK_MS: 350             // 맞았을 때 깜빡이는 시간
};

let hitFlashUntil = 0; // 깜빡임 종료 시각(ms)

/* ======================
   MAP SYSTEM (RECT / CIRCLE, RANDOM SIZE)
====================== */
const MAP_CONF = {
    EDGE_PAD: 90,       // 화면 가장자리로부터 맵이 너무 붙지 않게 여백
    PICK_CIRCLE_PROB: 0.45, // 원형 맵 등장 확률

    // 사각형 크기 범위
    RECT_MIN_W: 520,
    RECT_MAX_W: 980,
    RECT_MIN_H: 360,
    RECT_MAX_H: 720,

    // 원형 반지름 범위
    CIRCLE_MIN_R: 260,
    CIRCLE_MAX_R: 520
};

function randInt(min, max) {
    min = Math.floor(min);
    max = Math.floor(max);
    if (max < min) return min;
    return Math.floor(min + Math.random() * (max - min + 1));
}

function generateRandomMap() {
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;

    // 화면 크기에 맞춰 상한을 자동으로 줄임
    const pad = MAP_CONF.EDGE_PAD;
    const maxW = Math.min(MAP_CONF.RECT_MAX_W, canvas.width - pad * 2);
    const maxH = Math.min(MAP_CONF.RECT_MAX_H, canvas.height - pad * 2);
    const minW = Math.min(MAP_CONF.RECT_MIN_W, maxW);
    const minH = Math.min(MAP_CONF.RECT_MIN_H, maxH);

    const circleMaxR = Math.min(
        MAP_CONF.CIRCLE_MAX_R,
        Math.floor(Math.min(canvas.width, canvas.height) / 2) - pad
    );
    const circleMinR = Math.min(MAP_CONF.CIRCLE_MIN_R, circleMaxR);

    const isCircle = Math.random() < MAP_CONF.PICK_CIRCLE_PROB;

    if (!isCircle || circleMaxR <= 120) {
        const w = randInt(minW, maxW);
        const h = randInt(minH, maxH);
        return { shape: "rect", cx, cy, width: w, height: h };
    } else {
        const r = randInt(circleMinR, circleMaxR);
        return { shape: "circle", cx, cy, radius: r };
    }
}

let currentMap = generateRandomMap();

function loadMap() {
    // 스테이지 진입 시 맵(형태/크기) 랜덤으로 새로 뽑기
    currentMap = generateRandomMap();

    // 플레이어는 항상 맵 중앙에서 시작
    player.x = currentMap.cx;
    player.y = currentMap.cy;
    clampPlayerToMap();
}

/* ======================
   DAMAGE SETTINGS
====================== */
const CRIT = {
    CHANCE: 0.1,    // 10%
    MULTIPLIER: 1.5
};

const DAMAGE = {
    MELEE: 2,
    RANGE: 1
};

function calculateDamage(base) {
    const isCrit = Math.random() < CRIT.CHANCE;
    const dmg = isCrit ? Math.floor(base * CRIT.MULTIPLIER) : base;
    return { dmg, isCrit };
}

function applyDamageToTarget(target, baseDamage, textOffsetY = 0) {
    const { dmg, isCrit } = calculateDamage(baseDamage);
    target.hp -= dmg;

    const tx = target.x;
    const ty = target.y + textOffsetY;
    spawnDamageText(tx, ty, dmg, isCrit);
}

// =====================
// KNOCKBACK
// =====================
const KNOCKBACK = {
    melee: { default: 4.2, grunt: 5.2, runner: 4.6, tank: 2.8, shooter: 4.9, boss: 1.9 },
    range: { default: 3.0, grunt: 3.6, runner: 3.2, tank: 1.9, shooter: 3.4, boss: 1.2 }
};
const KNOCKBACK_DECAY = 0.84;
const KNOCKBACK_CAP = 18;

function applyKnockbackToTarget(target, mode, dirX, dirY) {
    if (!target) return;

    const t = target.type ? target.type : "boss";
    const table = mode === "range" ? KNOCKBACK.range : KNOCKBACK.melee;
    const strength = table[t] ?? table.default;

    const len = Math.hypot(dirX, dirY) || 1;
    const nx = dirX / len;
    const ny = dirY / len;

    target.kbVx = (target.kbVx || 0) + nx * strength;
    target.kbVy = (target.kbVy || 0) + ny * strength;

    const sp = Math.hypot(target.kbVx, target.kbVy);
    if (sp > KNOCKBACK_CAP) {
        target.kbVx = (target.kbVx / sp) * KNOCKBACK_CAP;
        target.kbVy = (target.kbVy / sp) * KNOCKBACK_CAP;
    }
}

function applyPlayerHit(target, baseDamage, textOffsetY, mode, dirX, dirY) {
    applyDamageToTarget(target, baseDamage, textOffsetY);
    applyKnockbackToTarget(target, mode, dirX, dirY);
}

function spawnDamageText(x, y, dmg, isCrit) {
    damageTexts.push({ x, y, dmg, isCrit, life: 40 });
}

/* ======================
   MELEE SETTINGS
====================== */
const MELEE = {
    RANGE: 40,
    SPREAD: Math.PI / 3,
    COOLDOWN: 40
};

/* ======================
   PLAYER
====================== */
const player = {
    x: canvas.width / 2,
    y: canvas.height / 2,
    r: 12,
    speed: 3,

    mode: "melee",

    maxHp: 100,
    hp: 100,
    maxShield: 50,
    shield: 50,

    maxDash: 3,
    dash: 3,

    isDashing: false,
    dashCooldown: 0,

    // dash internals
    dashTimeLeft: 0,
    dashVx: 0,
    dashVy: 0,
    lastMoveVx: 1,
    lastMoveVy: 0
};

const keys = {};
window.addEventListener("keydown", e => {
    keys[e.key.toLowerCase()] = true;

    // ✅ 메뉴/게임오버에서는 실제 기능 동작 막기
    if (appState !== AppState.PLAYING) return;

    if (e.code === "Space") {
        player.mode = player.mode === "melee" ? "range" : "melee";
        if (mode) mode.innerText = `MODE: ${player.mode.toUpperCase()}`;
    }

    // Shift 대쉬
    if (!e.repeat && (e.code === "ShiftLeft" || e.code === "ShiftRight")) {
        tryStartDash();
    }
});

window.addEventListener("keyup", e => {
    keys[e.key.toLowerCase()] = false;
});

const DASH = {
    SPEED: 12,
    DURATION_FRAMES: 10,
    RECHARGE_FRAMES: 75
};

function tryStartDash() {
    if (player.dash <= 0) return;
    if (player.isDashing) return;

    let vx = 0;
    let vy = 0;
    if (keys["w"]) vy -= 1;
    if (keys["s"]) vy += 1;
    if (keys["a"]) vx -= 1;
    if (keys["d"]) vx += 1;

    if (vx === 0 && vy === 0) {
        vx = player.lastMoveVx;
        vy = player.lastMoveVy;
    }

    const len = Math.hypot(vx, vy) || 1;
    vx /= len;
    vy /= len;

    player.isDashing = true;
    player.dashTimeLeft = DASH.DURATION_FRAMES;
    player.dashVx = vx;
    player.dashVy = vy;

    player.dash--;
    player.dashCooldown = DASH.RECHARGE_FRAMES;
}

function updateHUD() {
    const hpBar = document.querySelector(".gauge.hp div");
    const shBar = document.querySelector(".gauge.shield div");
    if (hpBar) hpBar.style.width = `${(player.hp / player.maxHp) * 100}%`;
    if (shBar) shBar.style.width = `${(player.shield / player.maxShield) * 100}%`;

    const dashIcons = document.getElementById("dash-icons");
    if (dashIcons) {
        dashIcons.innerHTML = "";
        for (let i = 0; i < player.dash; i++) dashIcons.innerHTML += "<span></span>";
    }
}

function damagePlayer(dmg) {
    if (player.shield > 0) {
        player.shield -= dmg;
        if (player.shield < 0) {
            player.hp += player.shield;
            player.shield = 0;
        }
    } else {
        player.hp -= dmg;
    }

    // 체력 0이면 게임오버
    if (player.hp <= 0) {
        player.hp = 0;
        gameOver();
    }
}

/* ======================
   ENEMIES
====================== */
let enemies = [];

const ENEMY_TYPES = {
    grunt: {
        label: "GRUNT",
        r: 10,
        color: "#f33",
        hpBase: 6,
        hpPerStage: 2,
        speedBase: 1.2,
        speedPerStage: 0.15,
        atkBase: 2,
        atkPerStage: 0.8,
        contactIntervalMs: 500,
        move: "chase",
        attack: "contact"
    },
    runner: {
        label: "RUNNER",
        r: 8,
        color: "#ff6a6a",
        hpBase: 4,
        hpPerStage: 1.3,
        speedBase: 2.1,
        speedPerStage: 0.18,
        atkBase: 1,
        atkPerStage: 0.5,
        contactIntervalMs: 350,
        move: "zigzag",
        zigzagAmp: 0.9,
        zigzagFreq: 0.015,
        attack: "contact"
    },
    tank: {
        label: "TANK",
        r: 14,
        color: "#c33",
        hpBase: 16,
        hpPerStage: 4,
        speedBase: 0.85,
        speedPerStage: 0.08,
        atkBase: 4,
        atkPerStage: 1.1,
        contactIntervalMs: 700,
        move: "chase",
        attack: "contact"
    },
    shooter: {
        label: "SHOOTER",
        r: 9,
        color: "#ff3",
        hpBase: 7,
        hpPerStage: 2,
        speedBase: 1.1,
        speedPerStage: 0.1,
        atkBase: 1,
        atkPerStage: 0.4,
        contactIntervalMs: 600,
        move: "keepDistance",
        preferredDist: 210,
        attack: "ranged",
        shotIntervalMs: 900,
        shotSpeed: 4.8,
        shotDamageBase: 3,
        shotDamagePerStage: 1
    }
};

function pickEnemyType() {
    const r = Math.random();
    if (stage <= 1 && wave <= 1) return "grunt";
    if (stage <= 1) return r < 0.65 ? "grunt" : (r < 0.85 ? "runner" : "tank");
    if (stage === 2) return r < 0.45 ? "grunt" : (r < 0.7 ? "runner" : (r < 0.88 ? "tank" : "shooter"));
    return r < 0.35 ? "grunt" : (r < 0.55 ? "runner" : (r < 0.75 ? "tank" : "shooter"));
}

function spawnEnemy(type = pickEnemyType()) {
    const cfg = ENEMY_TYPES[type] || ENEMY_TYPES.grunt;

    const maxHp = Math.round(cfg.hpBase + cfg.hpPerStage * stage);
    const speed = cfg.speedBase + cfg.speedPerStage * stage;
    const atk = Math.round(cfg.atkBase + cfg.atkPerStage * stage);

    const MIN_SPAWN_DIST = 180;
    let p = null;
    for (let tries = 0; tries < 30; tries++) {
        const cand = randomPointInMap(cfg.r + 2);
        const d = Math.hypot(cand.x - player.x, cand.y - player.y);
        if (d >= MIN_SPAWN_DIST) { p = cand; break; }
        p = cand;
    }

    return {
        type,
        x: p.x,
        y: p.y,
        r: cfg.r,
        color: cfg.color,
        maxHp,
        hp: maxHp,
        speed,
        atk,

        seed: Math.random() * 10000,
        shotAt: 0,

        nextContactAt: 0,

        kbVx: 0,
        kbVy: 0
    };
}

function drawEnemyHp(e) {
    const w = 20;
    const h = 3;
    const ratio = e.hp / e.maxHp;

    ctx.fillStyle = "#333";
    ctx.fillRect(e.x - w / 2, e.y - e.r - 8, w, h);

    ctx.fillStyle = "#f33";
    ctx.fillRect(e.x - w / 2, e.y - e.r - 8, w * ratio, h);
}

function startWave() {
    // ✅ 웨이브 시작할 때마다 맵을 새로 뽑음
    loadMap();

    // (선택) 이전 웨이브 잔여 투사체/이펙트 정리
    bullets.length = 0;
    enemyBullets.length = 0;
    meleeEffects.length = 0;
    damageTexts.length = 0;

    const count = stage * 5 + wave * 3;
    for (let i = 0; i < count; i++) enemies.push(spawnEnemy());
    updateStageText();
    setBossHudVisible(false);
}

/* ======================
   BOSS
====================== */
let boss = null;

function spawnBoss() {
    const baseHp = 50 + stage * 30;

    const spawnX = currentMap.cx;
    const spawnY = (currentMap.shape === "rect")
        ? (currentMap.cy - currentMap.height / 2 + 60)
        : (currentMap.cy - currentMap.radius + 90);

    boss = {
        type: "boss",
        isBoss: true,
        x: spawnX,
        y: spawnY,
        r: 40,
        maxHp: baseHp,
        hp: baseHp,
        phase: 1,

        atk: 8 + stage * 2,

        contactIntervalMs: 450,
        nextContactAt: 0,

        kbVx: 0,
        kbVy: 0
    };

    clampCircleToMap(boss);
}

function startBoss() {
    loadMap();

    gameState = GameState.BOSS;
    spawnBoss();
    updateStageText();
    setBossHudVisible(true);
    updateBossHud();
}

/* ======================
   COMBAT
====================== */
let bullets = [];
let enemyBullets = [];
let mouse = { x: 0, y: 0 };

const UPGRADES = { pierce: 0 };

canvas.addEventListener("mousemove", e => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
});

canvas.addEventListener("mousedown", () => {
    if (appState !== AppState.PLAYING) return;
    shooting = true;
});
canvas.addEventListener("mouseup", () => shooting = false);
window.addEventListener("blur", () => shooting = false);
canvas.addEventListener("mouseleave", () => shooting = false);

function meleeAttackCone() {
    const range = MELEE.RANGE;
    const cone = MELEE.SPREAD;
    const baseAngle = Math.atan2(mouse.y - player.y, mouse.x - player.x);

    function isInCone(tx, ty, extraRadius = 0) {
        const dx = tx - player.x;
        const dy = ty - player.y;
        const dist = Math.hypot(dx, dy);
        if (dist > range + extraRadius) return false;

        const ang = Math.atan2(dy, dx);
        let diff = Math.abs(ang - baseAngle);
        if (diff > Math.PI) diff = Math.PI * 2 - diff;
        return diff <= cone / 2;
    }

    if (boss && isInCone(boss.x, boss.y, boss.r)) {
        applyPlayerHit(boss, DAMAGE.MELEE, -boss.r, "melee", boss.x - player.x, boss.y - player.y);
    }

    enemies.forEach(e => {
        if (isInCone(e.x, e.y, e.r)) {
            applyPlayerHit(e, DAMAGE.MELEE, 0, "melee", e.x - player.x, e.y - player.y);
        }
    });
}

function spawnMeleeEffect() {
    const angle = Math.atan2(mouse.y - player.y, mouse.x - player.x);
    meleeEffects.push({
        x: player.x,
        y: player.y,
        angle,
        radius: MELEE.RANGE,
        spread: MELEE.SPREAD,
        life: 10,
        maxLife: 10
    });
}

/* ======================
   UPDATE
====================== */
function updatePlayer() {
    let vx = 0;
    let vy = 0;

    if (keys["w"]) vy -= 1;
    if (keys["s"]) vy += 1;
    if (keys["a"]) vx -= 1;
    if (keys["d"]) vx += 1;

    const len = Math.hypot(vx, vy) || 1;
    vx /= len;
    vy /= len;

    if (vx !== 0 || vy !== 0) {
        player.lastMoveVx = vx;
        player.lastMoveVy = vy;
    }

    if (player.isDashing) {
        player.x += player.dashVx * DASH.SPEED;
        player.y += player.dashVy * DASH.SPEED;
        player.dashTimeLeft--;
        if (player.dashTimeLeft <= 0) player.isDashing = false;
    } else {
        player.x += vx * player.speed;
        player.y += vy * player.speed;
    }

    if (player.dash < player.maxDash) {
        player.dashCooldown--;
        if (player.dashCooldown <= 0) {
            player.dash++;
            player.dashCooldown = DASH.RECHARGE_FRAMES;
        }
    }

    clampPlayerToMap();
}

function updateEnemies(now) {
    enemies.forEach(e => {
        const cfg = ENEMY_TYPES[e.type] || ENEMY_TYPES.grunt;

        const dxp = player.x - e.x;
        const dyp = player.y - e.y;
        const dist = Math.hypot(dxp, dyp) || 1;
        const ux = dxp / dist;
        const uy = dyp / dist;

        if (cfg.move === "chase") {
            e.x += ux * e.speed;
            e.y += uy * e.speed;
        } else if (cfg.move === "zigzag") {
            const px = -uy;
            const py = ux;
            const wobble = Math.sin((now + e.seed) * (cfg.zigzagFreq || 0.015)) * (cfg.zigzagAmp || 1);
            e.x += ux * e.speed + px * wobble;
            e.y += uy * e.speed + py * wobble;
        } else if (cfg.move === "keepDistance") {
            const want = cfg.preferredDist || 200;
            if (dist > want + 18) {
                e.x += ux * e.speed;
                e.y += uy * e.speed;
            } else if (dist < want - 18) {
                e.x -= ux * e.speed;
                e.y -= uy * e.speed;
            } else {
                const px = -uy;
                const py = ux;
                e.x += px * e.speed * 0.9;
                e.y += py * e.speed * 0.9;
            }
        } else {
            e.x += ux * e.speed;
            e.y += uy * e.speed;
        }

        if (e.kbVx || e.kbVy) {
            e.x += e.kbVx;
            e.y += e.kbVy;

            e.kbVx *= KNOCKBACK_DECAY;
            e.kbVy *= KNOCKBACK_DECAY;

            if (Math.abs(e.kbVx) < 0.02) e.kbVx = 0;
            if (Math.abs(e.kbVy) < 0.02) e.kbVy = 0;
        }

        if (cfg.attack === "ranged") {
            if ((now - e.shotAt) >= (cfg.shotIntervalMs || 900)) {
                e.shotAt = now;
                const a = Math.atan2(player.y - e.y, player.x - e.x);
                enemyBullets.push({
                    x: e.x,
                    y: e.y,
                    vx: Math.cos(a) * (cfg.shotSpeed || 4.5),
                    vy: Math.sin(a) * (cfg.shotSpeed || 4.5),
                    r: 4,
                    dmg: Math.round((cfg.shotDamageBase || 3) + (cfg.shotDamagePerStage || 1) * stage),
                    life: 240,
                    color: "#ff0"
                });
            }
        }

        const dx = e.x - player.x;
        const dy = e.y - player.y;
        const d = Math.hypot(dx, dy);
        const minDist = e.r + player.r;

        if (d < minDist) {
            const nx = d === 0 ? 1 : dx / d;
            const ny = d === 0 ? 0 : dy / d;
            e.x = player.x + nx * minDist;
            e.y = player.y + ny * minDist;
        }

        clampCircleToMap(e);
    });

    enemies = enemies.filter(e => e.hp > 0);
}

function resolvePlayerAgainstCircle(cx, cy, cr) {
    const dx = player.x - cx;
    const dy = player.y - cy;
    const dist = Math.hypot(dx, dy);
    const minDist = player.r + cr;

    if (dist < minDist) {
        const nx = dist === 0 ? 1 : dx / dist;
        const ny = dist === 0 ? 0 : dy / dist;
        player.x = cx + nx * minDist;
        player.y = cy + ny * minDist;
    }
}

function clampPlayerToMap() {
    if (currentMap.shape === "rect") {
        const b = getMapBounds(player.r);
        player.x = Math.max(b.left, Math.min(b.right, player.x));
        player.y = Math.max(b.top, Math.min(b.bottom, player.y));
        return;
    }

    // circle
    const cx = currentMap.cx;
    const cy = currentMap.cy;
    const maxDist = Math.max(0, (currentMap.radius || 0) - player.r);

    const dx = player.x - cx;
    const dy = player.y - cy;
    const dist = Math.hypot(dx, dy);

    if (dist > maxDist) {
        const nx = dist === 0 ? 1 : dx / dist;
        const ny = dist === 0 ? 0 : dy / dist;
        player.x = cx + nx * maxDist;
        player.y = cy + ny * maxDist;
    }
}

function getMapBounds(margin = 0) {
    // rect 전용 bounds
    const left = currentMap.cx - currentMap.width / 2 + margin;
    const right = currentMap.cx + currentMap.width / 2 - margin;
    const top = currentMap.cy - currentMap.height / 2 + margin;
    const bottom = currentMap.cy + currentMap.height / 2 - margin;
    return { left, right, top, bottom };
}

function clampCircleToMap(obj) {
    if (!obj) return;

    const r = obj.r || 0;

    if (currentMap.shape === "rect") {
        const b = getMapBounds(r);
        obj.x = Math.max(b.left, Math.min(b.right, obj.x));
        obj.y = Math.max(b.top, Math.min(b.bottom, obj.y));
        return;
    }

    // circle
    const cx = currentMap.cx;
    const cy = currentMap.cy;
    const maxDist = Math.max(0, (currentMap.radius || 0) - r);

    const dx = obj.x - cx;
    const dy = obj.y - cy;
    const dist = Math.hypot(dx, dy);

    if (dist > maxDist) {
        const nx = dist === 0 ? 1 : dx / dist;
        const ny = dist === 0 ? 0 : dy / dist;
        obj.x = cx + nx * maxDist;
        obj.y = cy + ny * maxDist;
    }
}

function randomPointInMap(margin = 0) {
    if (currentMap.shape === "rect") {
        const b = getMapBounds(margin);
        return {
            x: b.left + Math.random() * (b.right - b.left),
            y: b.top + Math.random() * (b.bottom - b.top)
        };
    }

    // circle: 균일 분포(면적) 샘플링
    const cx = currentMap.cx;
    const cy = currentMap.cy;
    const rr = Math.max(0, (currentMap.radius || 0) - margin);

    const ang = Math.random() * Math.PI * 2;
    const rad = Math.sqrt(Math.random()) * rr;

    return {
        x: cx + Math.cos(ang) * rad,
        y: cy + Math.sin(ang) * rad
    };
}

function updateContactDamage(now) {
    for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        const cfg = ENEMY_TYPES[e.type] || ENEMY_TYPES.grunt;

        const d = Math.hypot(e.x - player.x, e.y - player.y);
        if (d <= e.r + player.r + 0.01) {
            if (now >= (e.nextContactAt || 0)) {
                damagePlayer(e.atk || 1);
                e.nextContactAt = now + (cfg.contactIntervalMs ?? CONTACT.DEFAULT_INTERVAL_MS);
                hitFlashUntil = Math.max(hitFlashUntil, now + CONTACT.BLINK_MS);
            }
        }
    }

    if (boss) {
        const dBoss = Math.hypot(boss.x - player.x, boss.y - player.y);
        if (dBoss <= boss.r + player.r + 0.01) {
            if (now >= (boss.nextContactAt || 0)) {
                damagePlayer(boss.atk || 1);
                boss.nextContactAt = now + (boss.contactIntervalMs ?? CONTACT.DEFAULT_INTERVAL_MS);
                hitFlashUntil = Math.max(hitFlashUntil, now + CONTACT.BLINK_MS);
            }
        }
    }
}

function updateBoss() {
    if (!boss) return;

    boss.phase = boss.hp < 40 ? 2 : 1;
    boss.x += Math.sin(Date.now() * 0.002) * boss.phase;

    if (boss.kbVx || boss.kbVy) {
        boss.x += boss.kbVx;
        boss.y += boss.kbVy;
        boss.kbVx *= KNOCKBACK_DECAY;
        boss.kbVy *= KNOCKBACK_DECAY;
        if (Math.abs(boss.kbVx) < 0.02) boss.kbVx = 0;
        if (Math.abs(boss.kbVy) < 0.02) boss.kbVy = 0;
    }

    clampCircleToMap(boss);

    resolvePlayerAgainstCircle(boss.x, boss.y, boss.r);
    clampPlayerToMap();

    updateBossHud();

    if (boss.hp <= 0) {
        boss = null;
        setBossHudVisible(false);
        stage++;
        wave = 1;
        gameState = GameState.WAVE;
        startWave();
        updateStageText();
    }
}

function updateWaveProgress() {
    if (gameState !== GameState.WAVE) return;
    if (enemies.length > 0) return;

    if (wave < WAVES_PER_STAGE) {
        wave++;
        startWave();
    } else {
        startBoss();
    }
}

function updateBullets() {
    if (shooting && player.mode === "melee") {
        shootCooldown--;
        if (shootCooldown <= 0) {
            meleeAttackCone();
            spawnMeleeEffect();
            shootCooldown = MELEE.COOLDOWN;
        }
    }

    if (shooting && player.mode === "range") {
        shootCooldown--;
        if (shootCooldown <= 0) {
            const a = Math.atan2(mouse.y - player.y, mouse.x - player.x);
            bullets.push({
                x: player.x,
                y: player.y,
                vx: Math.cos(a) * 6,
                vy: Math.sin(a) * 6,
                r: 4,
                pierceLeft: UPGRADES.pierce
            });
            shootCooldown = 25;
        }
    }

    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.x += b.vx;
        b.y += b.vy;

        if (b.x < -50 || b.x > canvas.width + 50 || b.y < -50 || b.y > canvas.height + 50) {
            bullets.splice(i, 1);
            continue;
        }

        let hit = false;

        if (boss) {
            const dBoss = Math.hypot(b.x - boss.x, b.y - boss.y);
            if (dBoss < boss.r + (b.r || 0)) {
                const { dmg, isCrit } = calculateDamage(DAMAGE.RANGE);
                boss.hp -= dmg;
                spawnDamageText(boss.x, boss.y - boss.r, dmg, isCrit);
                applyKnockbackToTarget(boss, "range", b.vx, b.vy);
                hit = true;
            }
        }

        if (!hit) {
            for (let j = enemies.length - 1; j >= 0; j--) {
                const e = enemies[j];
                const d = Math.hypot(b.x - e.x, b.y - e.y);
                if (d < e.r + (b.r || 0)) {
                    const { dmg, isCrit } = calculateDamage(DAMAGE.RANGE);
                    e.hp -= dmg;
                    spawnDamageText(e.x, e.y, dmg, isCrit);
                    applyKnockbackToTarget(e, "range", b.vx, b.vy);
                    hit = true;
                    break;
                }
            }
        }

        if (hit) {
            if (b.pierceLeft > 0) b.pierceLeft--;
            else bullets.splice(i, 1);
        }
    }

    enemies = enemies.filter(e => e.hp > 0);
}

function updateEnemyBullets(now) {
    for (let i = enemyBullets.length - 1; i >= 0; i--) {
        const b = enemyBullets[i];
        b.x += b.vx;
        b.y += b.vy;
        b.life--;

        if (b.life <= 0 || b.x < -60 || b.x > canvas.width + 60 || b.y < -60 || b.y > canvas.height + 60) {
            enemyBullets.splice(i, 1);
            continue;
        }

        const d = Math.hypot(b.x - player.x, b.y - player.y);
        if (d < (b.r || 0) + player.r) {
            damagePlayer(b.dmg || 1);
            hitFlashUntil = now + CONTACT.BLINK_MS;
            enemyBullets.splice(i, 1);
        }
    }
}

function updateMeleeEffects() {
    meleeEffects.forEach(e => e.life--);
    meleeEffects = meleeEffects.filter(e => e.life > 0);
}

/* ======================
   DRAW
====================== */
function drawMap() {
    ctx.strokeStyle = "#00eaff";
    ctx.lineWidth = 3;

    if (currentMap.shape === "rect") {
        ctx.strokeRect(
            currentMap.cx - currentMap.width / 2,
            currentMap.cy - currentMap.height / 2,
            currentMap.width,
            currentMap.height
        );
        return;
    }

    // circle
    ctx.beginPath();
    ctx.arc(currentMap.cx, currentMap.cy, currentMap.radius, 0, Math.PI * 2);
    ctx.stroke();
}

function drawCircle(x, y, r, c) {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
}

function drawMeleeEffects() {
    meleeEffects.forEach(e => {
        const t = e.maxLife ? Math.max(0, Math.min(1, e.life / e.maxLife)) : 1;
        ctx.save();

        ctx.translate(e.x, e.y);
        ctx.rotate(e.angle);

        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, e.radius, -e.spread / 2, e.spread / 2);
        ctx.closePath();

        ctx.fillStyle = `rgba(0, 255, 255, ${0.28 * t})`;
        ctx.shadowColor = "#00ffff";
        ctx.shadowBlur = 18 * t;

        ctx.fill();
        ctx.restore();
    });
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    drawMap();

    const now = performance.now();
    const flashing = now < hitFlashUntil;
    const blinkOff = flashing && (Math.floor(now / 80) % 2 === 0);

    if (!blinkOff) drawCircle(player.x, player.y, player.r, "#0ff");

    drawMeleeEffects();

    enemies.forEach(e => {
        drawCircle(e.x, e.y, e.r, e.color || "#f33");
        drawEnemyHp(e);
    });

    bullets.forEach(b => drawCircle(b.x, b.y, 4, "#fff"));
    enemyBullets.forEach(b => drawCircle(b.x, b.y, b.r || 4, b.color || "#ff0"));
    if (boss) drawCircle(boss.x, boss.y, boss.r, "#f0f");
}

/* ======================
   LOOP (PLAYING일 때만)
====================== */
function loop() {
    if (appState !== AppState.PLAYING) return;

    const now = performance.now();

    updatePlayer();
    updateEnemies(now);
    updateBoss();
    updateBullets();
    updateEnemyBullets(now);

    updateContactDamage(now);
    updateWaveProgress();

    updateHUD();
    updateMeleeEffects();
    draw();

    rafId = requestAnimationFrame(loop);
}

/* ======================
   INIT (HUD)
====================== */
const stageEl = document.getElementById("stage");
const mode = document.getElementById("mode");
const bossHud = document.getElementById("bossHud");
const bossHpFill = document.getElementById("bossHpFill");
const bossHpText = document.getElementById("bossHpText");
const bossNameEl = document.getElementById("bossName");

function setBossHudVisible(visible) {
    if (!bossHud) return;
    bossHud.classList.toggle("is-hidden", !visible);
    document.body.classList.toggle("boss-on", !!visible);
}

function updateBossHud() {
    if (!bossHud || !boss) return;

    const max = boss.maxHp || 1;
    const ratio = Math.max(0, Math.min(1, boss.hp / max));

    if (bossHpFill) bossHpFill.style.width = `${ratio * 100}%`;
    if (bossHpText) bossHpText.textContent = `${Math.max(0, Math.ceil(boss.hp))} / ${max}`;
    if (bossNameEl) bossNameEl.textContent = `STAGE ${stage} BOSS`;
}

function updateStageText() {
    if (!stageEl) return;
    if (gameState === GameState.BOSS) stageEl.innerText = `STAGE ${stage}  /  BOSS`;
    else stageEl.innerText = `STAGE ${stage}  /  WAVE ${wave}/${WAVES_PER_STAGE}`;
}

/* ======================
   START / RESET / GAMEOVER / MENU
====================== */
function resetRun() {
    // 진행 상태 초기화
    gameState = GameState.WAVE;
    stage = 1;
    wave = 1;

    // 전투/오브젝트
    enemies = [];
    bullets = [];
    enemyBullets = [];
    boss = null;

    shootCooldown = 0;
    damageTexts = [];
    meleeEffects = [];

    hitFlashUntil = 0;

    // 플레이어 초기화
    player.mode = "melee";
    player.hp = player.maxHp;
    player.shield = player.maxShield;

    player.dash = player.maxDash;
    player.isDashing = false;
    player.dashCooldown = 0;
    player.dashTimeLeft = 0;
    player.dashVx = 0;
    player.dashVy = 0;
    player.lastMoveVx = 1;
    player.lastMoveVy = 0;

    safeClearInputs();

    loadMap();
    startWave();
    updateStageText();
    updateHUD();
    draw();
}

function startGame() {
    stopLoop();
    resetRun();
    setAppState(AppState.PLAYING);
    rafId = requestAnimationFrame(loop);
}

function gameOver() {
    if (appState !== AppState.PLAYING) return;

    stopLoop();
    setAppState(AppState.GAMEOVER);

    if (UI.gameOverDesc) {
        UI.gameOverDesc.textContent =
            `도달: STAGE ${stage} / ${gameState === GameState.BOSS ? "BOSS" : `WAVE ${wave}`}`;
    }

    shooting = false;
    draw();
}

function goToMenu() {
    stopLoop();
    safeClearInputs();
    setAppState(AppState.MENU);
    draw();
}

/* ======================
   BUTTONS + BOOT
====================== */
if (UI.btnStart) UI.btnStart.addEventListener("click", startGame);
if (UI.btnToMain) UI.btnToMain.addEventListener("click", goToMenu);

// ✅ 처음은 메인 화면
setAppState(AppState.MENU);
draw();
