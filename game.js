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
    dashCooldown: 0
};

const keys = {};
window.addEventListener("keydown", e => {
    keys[e.key.toLowerCase()] = true;

    if (e.code === "Space") {
        player.mode = player.mode === "melee" ? "range" : "melee";
        if (mode) mode.innerText = `MODE: ${player.mode.toUpperCase()}`;
    }

    if (e.key === "shift" && player.dash > 0 && !player.isDashing) {
        player.isDashing = true;
        player.dash--;
        player.dashCooldown = 20; // 회복용
    }
});
window.addEventListener("keyup", e => keys[e.key.toLowerCase()] = false);

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

function spawnEnemy() {
    const angle = Math.random() * Math.PI * 2;
    const dist = 300;
    return {
        x: player.x + Math.cos(angle) * dist,
        y: player.y + Math.sin(angle) * dist,
        r: 10,
        maxHp: 5 + stage * 2,
        hp: 5 + stage * 2,
        speed: 1 + stage * 0.2
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
    const count = stage * 3; // 웨이브당 몬스터 수(원하면 wave까지 반영 가능)
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
        x: canvas.width / 2,
        y: canvas.height / 2 - currentMap.height / 2 + 60,
        r: 40,
        maxHp: baseHp,
        hp: baseHp,
        phase: 1
    };
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

    // 공통: 부채꼴 판정 함수
    function isInCone(tx, ty, extraRadius = 0) {
        const dx = tx - player.x;
        const dy = ty - player.y;
        const dist = Math.hypot(dx, dy);

        // 보스 같은 큰 대상은 반지름만큼 보정
        if (dist > range + extraRadius) return false;

        const ang = Math.atan2(dy, dx);
        let diff = Math.abs(ang - baseAngle);
        if (diff > Math.PI) diff = Math.PI * 2 - diff;

        return diff <= cone / 2;
    }

    // 1) 보스 먼저 (원거리처럼)
    if (boss && isInCone(boss.x, boss.y, boss.r)) {
        applyDamageToTarget(boss, DAMAGE.MELEE, -boss.r);
        return; // 근접 1타 = 1대상 타격(원거리 히트 처리와 동일한 느낌)
    }

    // 2) 일반 몬스터들 중 하나만(가장 가까운 것) 타격
    let bestIdx = -1;
    let bestDist = Infinity;

    for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        if (!isInCone(e.x, e.y, e.r)) continue;

        const d = Math.hypot(e.x - player.x, e.y - player.y);
        if (d < bestDist) {
            bestDist = d;
            bestIdx = i;
        }
    }

    if (bestIdx !== -1) {
        const e = enemies[bestIdx];
        applyDamageToTarget(e, DAMAGE.MELEE, 0);
    }
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

    const speed = player.isDashing ? 10 : player.speed;
    player.x += vx * speed;
    player.y += vy * speed;

    // 대쉬 종료
    if (player.isDashing) {
        player.isDashing = false;
    }

    // 대쉬 회복
    if (player.dash < player.maxDash) {
        player.dashCooldown--;
        if (player.dashCooldown <= 0) {
            player.dash++;
            player.dashCooldown = 60;
        }
    }

    // 맵 경계
    const left = canvas.width / 2 - currentMap.width / 2 + player.r;
    const right = canvas.width / 2 + currentMap.width / 2 - player.r;
    const top = canvas.height / 2 - currentMap.height / 2 + player.r;
    const bottom = canvas.height / 2 + currentMap.height / 2 - player.r;

    player.x = Math.max(left, Math.min(right, player.x));
    player.y = Math.max(top, Math.min(bottom, player.y));
}

function updateEnemies() {
    enemies.forEach(e => {
        // 플레이어 방향으로 이동
        const angle = Math.atan2(player.y - e.y, player.x - e.x);
        e.x += Math.cos(angle) * e.speed;
        e.y += Math.sin(angle) * e.speed;

        // 플레이어 관통 방지 (밀어내기)
        const dx = e.x - player.x;
        const dy = e.y - player.y;
        const dist = Math.hypot(dx, dy);
        const minDist = e.r + player.r;

        if (dist < minDist) {
            const nx = dx / dist;
            const ny = dy / dist;
            e.x = player.x + nx * minDist;
            e.y = player.y + ny * minDist;
        }
    });

    // 죽은 적 제거
    enemies = enemies.filter(e => e.hp > 0);
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
    drawCircle(player.x, player.y, player.r, "#0ff");
    drawMeleeEffects();

    enemies.forEach(e => {
        drawCircle(e.x, e.y, e.r, "#f33");
        drawEnemyHp(e);
    });

    bullets.forEach(b => drawCircle(b.x, b.y, 4, "#fff"));
    if (boss) drawCircle(boss.x, boss.y, boss.r, "#f0f");
}

/* ======================
   LOOP
====================== */
function loop() {
    updatePlayer();
    updateEnemies();
    updateBoss();
    updateBullets();
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