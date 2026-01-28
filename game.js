const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

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
   MAP SYSTEM
====================== */
const maps = [
    { width: 600, height: 400 },
    { width: 800, height: 500 },
    { width: 500, height: 500 }
];

let currentMap = maps[0];

function loadMap() {
    currentMap = maps[(stage - 1) % maps.length];
    player.x = canvas.width / 2;
    player.y = canvas.height / 2;
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
    const dmg = isCrit
        ? Math.floor(base * CRIT.MULTIPLIER)
        : base;

    return { dmg, isCrit };
}

function applyDamageToTarget(target, baseDamage, textOffsetY = 0) {
    const { dmg, isCrit } = calculateDamage(baseDamage);

    // boss/enemy 둘 다 hp가 있음
    target.hp -= dmg;

    // 데미지 텍스트 위치 통일
    const tx = target.x;
    const ty = target.y + textOffsetY;
    spawnDamageText(tx, ty, dmg, isCrit);
}

// =====================
// KNOCKBACK (플레이어 공격에 맞으면 넉백)
// - player.mode(melee/range) + enemy.type 별로 강도 조절
// =====================
const KNOCKBACK = {
    melee: { default: 4.2, grunt: 5.2, runner: 4.6, tank: 2.8, shooter: 4.9, boss: 1.9 },
    range: { default: 3.0, grunt: 3.6, runner: 3.2, tank: 1.9, shooter: 3.4, boss: 1.2 }
};
const KNOCKBACK_DECAY = 0.84; // 매 프레임 감쇠
const KNOCKBACK_CAP = 18;     // 속도 상한(너무 멀리 튕기는 것 방지)

function applyKnockbackToTarget(target, mode, dirX, dirY) {
    if (!target) return;

    const t = target.type ? target.type : "boss";
    const table = mode === "range" ? KNOCKBACK.range : KNOCKBACK.melee;
    const strength = table[t] ?? table.default;

    const len = Math.hypot(dirX, dirY) || 1;
    const nx = dirX / len;
    const ny = dirY / len;

    // kb 속도 누적
    target.kbVx = (target.kbVx || 0) + nx * strength;
    target.kbVy = (target.kbVy || 0) + ny * strength;

    // 상한
    const sp = Math.hypot(target.kbVx, target.kbVy);
    if (sp > KNOCKBACK_CAP) {
        target.kbVx = (target.kbVx / sp) * KNOCKBACK_CAP;
        target.kbVy = (target.kbVy / sp) * KNOCKBACK_CAP;
    }
}

// 플레이어가 준 타격(데미지 + 넉백) 공통 처리
function applyPlayerHit(target, baseDamage, textOffsetY, mode, dirX, dirY) {
    applyDamageToTarget(target, baseDamage, textOffsetY);
    applyKnockbackToTarget(target, mode, dirX, dirY);
}


function spawnDamageText(x, y, dmg, isCrit) {
    damageTexts.push({
        x,
        y,
        dmg,
        isCrit,
        life: 40
    });
}

/* ======================
   MELEE SETTINGS
====================== */
const MELEE = {
    RANGE: 70,              // 공격 거리
    SPREAD: Math.PI / 3,    // 60도 부채꼴
    COOLDOWN: 20
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

    if (e.code === "Space") {
        player.mode = player.mode === "melee" ? "range" : "melee";
        if (mode) mode.innerText = `MODE: ${player.mode.toUpperCase()}`;
    }

    // Shift 대쉬 (ShiftLeft / ShiftRight)
    if (!e.repeat && (e.code === "ShiftLeft" || e.code === "ShiftRight")) {
        tryStartDash();
    }
});
window.addEventListener("keyup", e => keys[e.key.toLowerCase()] = false);

const DASH = {
    SPEED: 12,
    DURATION_FRAMES: 10,
    RECHARGE_FRAMES: 75
};

function tryStartDash() {
    if (player.dash <= 0) return;
    if (player.isDashing) return;

    // 입력 방향이 있으면 그 방향, 없으면 마지막 이동 방향
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
    // 대쉬 1회 소모 후, 일정 프레임 뒤에 1칸 회복되는 구조
    player.dashCooldown = DASH.RECHARGE_FRAMES;
}

function updateHUD() {
    document.querySelector(".gauge.hp div").style.width =
        `${(player.hp / player.maxHp) * 100}%`;

    document.querySelector(".gauge.shield div").style.width =
        `${(player.shield / player.maxShield) * 100}%`;

    const dashIcons = document.getElementById("dash-icons");
    dashIcons.innerHTML = "";
    for (let i = 0; i < player.dash; i++) {
        dashIcons.innerHTML += "<span></span>";
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
}

/* ======================
   ENEMIES
====================== */
let enemies = [];

// =====================
// ENEMY TYPES (타입별 이동/공격/데미지)
// - 각 타입의 스탯/행동을 여기서 한 번에 조절
// - 공격방식은 현재: contact(접촉)
//   shooter 타입은 원거리 투사체(기본 구현) 포함
// =====================
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
    // 스테이지/웨이브에 따라 타입 비율이 조금씩 바뀌게(원하는대로 조절 가능)
    const r = Math.random();
    if (stage <= 1 && wave <= 1) return "grunt";
    if (stage <= 1) {
        return r < 0.65 ? "grunt" : (r < 0.85 ? "runner" : "tank");
    }
    if (stage === 2) {
        return r < 0.45 ? "grunt" : (r < 0.7 ? "runner" : (r < 0.88 ? "tank" : "shooter"));
    }
    return r < 0.35 ? "grunt" : (r < 0.55 ? "runner" : (r < 0.75 ? "tank" : "shooter"));
}

function spawnEnemy(type = pickEnemyType()) {
    const cfg = ENEMY_TYPES[type] || ENEMY_TYPES.grunt;

    const maxHp = Math.round(cfg.hpBase + cfg.hpPerStage * stage);
    const speed = cfg.speedBase + cfg.speedPerStage * stage;
    const atk = Math.round(cfg.atkBase + cfg.atkPerStage * stage);

    // ✅ 스폰 위치를 '맵 안'에서 뽑기 (+ 플레이어와 너무 붙지 않게)
    const MIN_SPAWN_DIST = 180;
    let p = null;
    for (let tries = 0; tries < 30; tries++) {
        const cand = randomPointInMap(cfg.r + 2);
        const d = Math.hypot(cand.x - player.x, cand.y - player.y);
        if (d >= MIN_SPAWN_DIST) {
            p = cand;
            break;
        }
        p = cand; // 마지막 후보라도 저장
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

        // 타입별 동작용 런타임 상태
        seed: Math.random() * 10000,
        shotAt: 0,

        // 접촉 공격 쿨다운(개별)
        nextContactAt: 0,

        // 넉백 속도
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
    const count = stage * 5 + wave * 3; // 웨이브당 몬스터 수(원하면 wave까지 반영 가능)
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

    boss = {
        type: "boss",
        isBoss: true,
        x: canvas.width / 2,
        y: canvas.height / 2 - currentMap.height / 2 + 60,
        r: 40,
        maxHp: baseHp,
        hp: baseHp,
        phase: 1,

        // 보스 접촉 공격력
        atk: 8 + stage * 2,

        // 보스 접촉 공격 주기(개별)
        contactIntervalMs: 450,
        nextContactAt: 0,

        // 넉백 속도(보스는 약하게 적용)
        kbVx: 0,
        kbVy: 0
    };

    // 스폰 직후 맵 안으로 보정
    clampCircleToMap(boss);
}

function startBoss() {
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

// 업그레이드(추후 확장용)
// - pierce: 원거리 공격 관통 여부 (지금은 false)
const UPGRADES = {
    pierce: 0
};

canvas.addEventListener("mousemove", e => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
});

// 처음이 근접이어도 공격되도록: 누르면 무조건 shooting=true
canvas.addEventListener("mousedown", () => {
    shooting = true;
});

canvas.addEventListener("mouseup", () => {
    shooting = false;
});
window.addEventListener("blur", () => shooting = false);
canvas.addEventListener("mouseleave", () => shooting = false);

function meleeAttackCone() {
    const range = MELEE.RANGE;
    const cone = MELEE.SPREAD;

    const baseAngle = Math.atan2(mouse.y - player.y, mouse.x - player.x);

    // 공통: 부채꼴(거리+각도) 판정
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

    // 1) 보스도 범위 안이면 타격
    if (boss && isInCone(boss.x, boss.y, boss.r)) {
        applyPlayerHit(boss, DAMAGE.MELEE, -boss.r, "melee", boss.x - player.x, boss.y - player.y);
    }

    // 2) 범위 안의 모든 몬스터 타격
    enemies.forEach(e => {
        if (isInCone(e.x, e.y, e.r)) {
            applyPlayerHit(e, DAMAGE.MELEE, 0, "melee", e.x - player.x, e.y - player.y);
        }
    });
}

function spawnMeleeEffect() {
    const angle = Math.atan2(
        mouse.y - player.y,
        mouse.x - player.x
    );

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

    // 마지막 이동 방향 기억 (대쉬 방향용)
    if (vx !== 0 || vy !== 0) {
        player.lastMoveVx = vx;
        player.lastMoveVy = vy;
    }

    // 대쉬 이동(Shift)
    if (player.isDashing) {
        player.x += player.dashVx * DASH.SPEED;
        player.y += player.dashVy * DASH.SPEED;
        player.dashTimeLeft--;
        if (player.dashTimeLeft <= 0) {
            player.isDashing = false;
        }
    } else {
        // 일반 이동
        player.x += vx * player.speed;
        player.y += vy * player.speed;
    }

    // 대쉬 회복(1칸씩)
    if (player.dash < player.maxDash) {
        player.dashCooldown--;
        if (player.dashCooldown <= 0) {
            player.dash++;
            player.dashCooldown = DASH.RECHARGE_FRAMES;
        }
    }

    // 맵 경계
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

        // ---- 타입별 이동 ----
        if (cfg.move === "chase") {
            e.x += ux * e.speed;
            e.y += uy * e.speed;
        } else if (cfg.move === "zigzag") {
            // 플레이어를 향해 가되, 수직 방향으로 좌우 흔들림
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
                // 거리 유지: 측면 이동
                const px = -uy;
                const py = ux;
                e.x += px * e.speed * 0.9;
                e.y += py * e.speed * 0.9;
            }
        } else {
            // fallback
            e.x += ux * e.speed;
            e.y += uy * e.speed;
        }


        // ---- 넉백 적용(플레이어 공격에 맞으면 튕김) ----
        if (e.kbVx || e.kbVy) {
            e.x += e.kbVx;
            e.y += e.kbVy;

            e.kbVx *= KNOCKBACK_DECAY;
            e.kbVy *= KNOCKBACK_DECAY;

            if (Math.abs(e.kbVx) < 0.02) e.kbVx = 0;
            if (Math.abs(e.kbVy) < 0.02) e.kbVy = 0;
        }

        // ---- 타입별 공격(기본 구현) ----
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

        // ---- 플레이어 관통 방지(밀어내기) ----
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

        // ✅ 적도 맵 밖으로 못 나가게
        clampCircleToMap(e);
    });

    // 죽은 적 제거
    enemies = enemies.filter(e => e.hp > 0);
}

// 플레이어가 큰 원(보스 등)을 통과하지 못하게 하는 충돌 보정
function resolvePlayerAgainstCircle(cx, cy, cr) {
    const dx = player.x - cx;
    const dy = player.y - cy;
    const dist = Math.hypot(dx, dy);
    const minDist = player.r + cr;

    if (dist < minDist) {
        // dist가 0이면 임의 방향
        const nx = dist === 0 ? 1 : dx / dist;
        const ny = dist === 0 ? 0 : dy / dist;
        player.x = cx + nx * minDist;
        player.y = cy + ny * minDist;
    }
}

function clampPlayerToMap() {
    const left = canvas.width / 2 - currentMap.width / 2 + player.r;
    const right = canvas.width / 2 + currentMap.width / 2 - player.r;
    const top = canvas.height / 2 - currentMap.height / 2 + player.r;
    const bottom = canvas.height / 2 + currentMap.height / 2 - player.r;
    player.x = Math.max(left, Math.min(right, player.x));
    player.y = Math.max(top, Math.min(bottom, player.y));
}


// =====================
// MAP BOUNDS HELPERS (적/보스도 맵 밖으로 못 나가게)
// =====================
function getMapBounds(margin = 0) {
    const left = canvas.width / 2 - currentMap.width / 2 + margin;
    const right = canvas.width / 2 + currentMap.width / 2 - margin;
    const top = canvas.height / 2 - currentMap.height / 2 + margin;
    const bottom = canvas.height / 2 + currentMap.height / 2 - margin;
    return { left, right, top, bottom };
}

function clampCircleToMap(obj) {
    if (!obj) return;
    const b = getMapBounds(obj.r || 0);
    obj.x = Math.max(b.left, Math.min(b.right, obj.x));
    obj.y = Math.max(b.top, Math.min(b.bottom, obj.y));
}

function randomPointInMap(margin = 0) {
    const b = getMapBounds(margin);
    return {
        x: b.left + Math.random() * (b.right - b.left),
        y: b.top + Math.random() * (b.bottom - b.top)
    };
}


function updateContactDamage(now) {
    // 닿아있는 '각 적'이 자신의 공격 주기대로 데미지를 줌(개별 쿨다운)
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

    // 보스도 개별 주기 적용
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

function updateDamageTexts() {
    damageTexts.forEach(t => {
        t.y -= 0.5;
        t.life--;
    });
    damageTexts = damageTexts.filter(t => t.life > 0);
}

function updateBoss() {
    if (!boss) return;
    boss.phase = boss.hp < 40 ? 2 : 1;
    boss.x += Math.sin(Date.now() * 0.002) * boss.phase;

    // ---- 보스 넉백 적용 ----
    if (boss.kbVx || boss.kbVy) {
        boss.x += boss.kbVx;
        boss.y += boss.kbVy;
        boss.kbVx *= KNOCKBACK_DECAY;
        boss.kbVy *= KNOCKBACK_DECAY;
        if (Math.abs(boss.kbVx) < 0.02) boss.kbVx = 0;
        if (Math.abs(boss.kbVy) < 0.02) boss.kbVy = 0;
    }

    // ✅ 보스도 맵 밖으로 못 나가게
    clampCircleToMap(boss);

    // ✅ 보스도 플레이어가 통과 불가
    resolvePlayerAgainstCircle(boss.x, boss.y, boss.r);
    clampPlayerToMap();

    updateBossHud();

    if (boss.hp <= 0) {
        boss = null;
        setBossHudVisible(false);
        stage++;
        wave = 1;
        gameState = GameState.WAVE;
        loadMap();
        startWave();
        updateStageText();
    }
}

// 웨이브 클리어 시 다음 웨이브/보스로 자동 전환
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
    // 근접 유지 공격
    if (shooting && player.mode === "melee") {
        shootCooldown--;
        if (shootCooldown <= 0) {
            meleeAttackCone();
            spawnMeleeEffect();
            shootCooldown = MELEE.COOLDOWN;
        }
    }

    // 원거리 연사
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
            shootCooldown = 30; // 연사 속도
        }
    }

    // --- 투사체 이동 + 충돌(기본: 관통 없음) ---
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.x += b.vx;
        b.y += b.vy;

        // 화면 밖 제거
        if (b.x < -50 || b.x > canvas.width + 50 || b.y < -50 || b.y > canvas.height + 50) {
            bullets.splice(i, 1);
            continue;
        }

        let hit = false;

        // 보스 우선 판정
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

        // 일반 몬스터 판정
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

        // 기본: 1회 타격 후 제거(=관통 X)
        if (hit) {
            if (b.pierceLeft > 0) {
                b.pierceLeft--;
            } else {
                bullets.splice(i, 1);
            }
        }
    }

    // 원거리로 죽은 적 즉시 정리(웨이브 전환이 바로 되도록)
    enemies = enemies.filter(e => e.hp > 0);
}

function updateEnemyBullets(now) {
    for (let i = enemyBullets.length - 1; i >= 0; i--) {
        const b = enemyBullets[i];
        b.x += b.vx;
        b.y += b.vy;
        b.life--;

        // 화면 밖 또는 수명 끝
        if (b.life <= 0 || b.x < -60 || b.x > canvas.width + 60 || b.y < -60 || b.y > canvas.height + 60) {
            enemyBullets.splice(i, 1);
            continue;
        }

        // 플레이어 피격
        const d = Math.hypot(b.x - player.x, b.y - player.y);
        if (d < (b.r || 0) + player.r) {
            damagePlayer(b.dmg || 1);
            hitFlashUntil = now + CONTACT.BLINK_MS;
            enemyBullets.splice(i, 1);
        }
    }
}

function updateMeleeEffects() {
    meleeEffects.forEach(e => {
        e.life--;
    });
    meleeEffects = meleeEffects.filter(e => e.life > 0);
}

/* ======================
   DRAW
====================== */
function drawMap() {
    ctx.strokeStyle = "#00eaff";
    ctx.lineWidth = 3;
    ctx.strokeRect(
        canvas.width / 2 - currentMap.width / 2,
        canvas.height / 2 - currentMap.height / 2,
        currentMap.width,
        currentMap.height
    );
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
        ctx.arc(
            0,
            0,
            e.radius,
            -e.spread / 2,
            e.spread / 2
        );
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
    const blinkOff = flashing && (Math.floor(now / 80) % 2 === 0); // 80ms 간격 깜빡

    if (!blinkOff) {
        drawCircle(player.x, player.y, player.r, "#0ff");
    }

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
   LOOP
====================== */
function loop() {
    const now = performance.now();

    updatePlayer();
    updateEnemies(now);
    updateBoss();
    updateBullets();
    updateEnemyBullets(now);

    updateContactDamage(now);
    updateWaveProgress();

    draw();
    requestAnimationFrame(loop);

    updateHUD();
    updateMeleeEffects();
}

/* ======================
   INIT
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
    if (gameState === GameState.BOSS) {
        stageEl.innerText = `STAGE ${stage}  /  BOSS`;
    } else {
        stageEl.innerText = `STAGE ${stage}  /  WAVE ${wave}/${WAVES_PER_STAGE}`;
    }
}

loadMap();
startWave();
loop();