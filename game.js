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
   PLAYER
====================== */
const player = {
    x: canvas.width / 2,
    y: canvas.height / 2,
    r: 12,
    speed: 3,

    maxHp: 100,
    hp: 100,

    maxShield: 50,
    shield: 50,

    maxDash: 3,
    dash: 3
};

const keys = {};
window.addEventListener("keydown", e => {
    keys[e.key.toLowerCase()] = true;
    if (e.code === "Space") {
        player.mode = player.mode === "melee" ? "range" : "melee";
        mode.innerText = `MODE: ${player.mode.toUpperCase()}`;
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

enemies.forEach(e => {
    drawCircle(e.x, e.y, e.r, "#f33");
    drawEnemyHp(e);
});

function startWave() {
    for (let i = 0; i < stage * 3; i++) {
        enemies.push(spawnEnemy());
    }
}

/* ======================
   BOSS
====================== */
let boss = null;

function spawnBoss() {
    boss = {
        x: canvas.width / 2,
        y: canvas.height / 2 - currentMap.height / 2 + 60,
        r: 40,
        hp: 50 + stage * 30,
        phase: 1
    };
}

function startBoss() {
    gameState = GameState.BOSS;
    spawnBoss();
}

/* ======================
   COMBAT
====================== */
let bullets = [];
let mouse = { x: 0, y: 0 };

canvas.addEventListener("mousemove", e => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
});

canvas.addEventListener("click", () => {
    if (player.mode !== "range") return;
    const a = Math.atan2(mouse.y - player.y, mouse.x - player.x);
    bullets.push({
        x: player.x,
        y: player.y,
        vx: Math.cos(a) * 6,
        vy: Math.sin(a) * 6
    });
});

function meleeAttack() {
    enemies.forEach(e => {
        const d = Math.hypot(e.x - player.x, e.y - player.y);
        if (d < 60) e.hp--;
    });
    if (boss) {
        const d = Math.hypot(boss.x - player.x, boss.y - player.y);
        if (d < 80) boss.hp--;
    }
}

/* ======================
   UPDATE
====================== */
function updatePlayer() {
    if (keys["w"]) player.y -= player.speed;
    if (keys["s"]) player.y += player.speed;
    if (keys["a"]) player.x -= player.speed;
    if (keys["d"]) player.x += player.speed;

    const left = canvas.width / 2 - currentMap.width / 2 + player.r;
    const right = canvas.width / 2 + currentMap.width / 2 - player.r;
    const top = canvas.height / 2 - currentMap.height / 2 + player.r;
    const bottom = canvas.height / 2 + currentMap.height / 2 - player.r;

    player.x = Math.max(left, Math.min(right, player.x));
    player.y = Math.max(top, Math.min(bottom, player.y));
}

function updateEnemies() {
    enemies.forEach(e => {
        const a = Math.atan2(player.y - e.y, player.x - e.x);
        e.x += Math.cos(a) * e.speed;
        e.y += Math.sin(a) * e.speed;
    });

    enemies = enemies.filter(e => e.hp > 0);

    if (enemies.length === 0 && gameState === GameState.WAVE) {
        if (wave >= WAVES_PER_STAGE) {
            startBoss();
        } else {
            wave++;
            startWave();
        }
    }
}

function updateBoss() {
    if (!boss) return;
    boss.phase = boss.hp < 40 ? 2 : 1;
    boss.x += Math.sin(Date.now() * 0.002) * boss.phase;
    if (boss.hp <= 0) {
        boss = null;
        stage++;
        wave = 1;
        gameState = GameState.WAVE;
        loadMap();
        startWave();
        stageEl.innerText = `STAGE ${stage}`;
    }
}

function updateBullets() {
    bullets.forEach(b => {
        b.x += b.vx;
        b.y += b.vy;
        enemies.forEach(e => {
            if (Math.hypot(b.x - e.x, b.y - e.y) < e.r) e.hp--;
        });
        if (boss && Math.hypot(b.x - boss.x, b.y - boss.y) < boss.r) {
            boss.hp--;
        }
    });
    bullets = bullets.filter(b => b.x > 0 && b.y > 0);
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

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawMap();
    drawCircle(player.x, player.y, player.r, "#0ff");
    enemies.forEach(e => drawCircle(e.x, e.y, e.r, "#f33"));
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
    draw();
    requestAnimationFrame(loop);
    updateHUD();
}

/* ======================
   INIT
====================== */
const stageEl = document.getElementById("stage");
const mode = document.getElementById("mode");

loadMap();
startWave();
loop();
