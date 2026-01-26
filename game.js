const player = {
    x: canvas.width / 2,
    y: canvas.height / 2,
    radius: 12,
    mode: 'melee' // or 'range'
};

function spawnEnemy() {
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.max(canvas.width, canvas.height);
    return {
        x: player.x + Math.cos(angle) * dist,
        y: player.y + Math.sin(angle) * dist,
        speed: 1.2,
        radius: 10,
        hp: 2
    };
}

let mouse = { x: 0, y: 0 };

canvas.addEventListener('mousemove', e => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
});

function meleeAttack() {
    enemies.forEach(e => {
        const d = Math.hypot(e.x - player.x, e.y - player.y);
        if (d < 60) e.hp--;
    });
}

function shoot() {
    const angle = Math.atan2(mouse.y - player.y, mouse.x - player.x);
    bullets.push({
        x: player.x,
        y: player.y,
        vx: Math.cos(angle) * 6,
        vy: Math.sin(angle) * 6
    });
}

window.addEventListener('keydown', e => {
    if (e.code === 'Space') {
        player.mode = player.mode === 'melee' ? 'range' : 'melee';
        document.getElementById('mode').innerText =
            `MODE: ${player.mode.toUpperCase()}`;
    }
});
