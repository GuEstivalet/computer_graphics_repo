const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const infoDiv = document.getElementById('info');

let points = [];
let t = 0; // param lerp
let animationFrameId;

const nr_pontos = 5; 
const OBJECT_SIZE = 4;
const SPEED = 0.005; //velocidade da animação


function lerp(a, b, t) {
    return a + (b - a) * t;
}


// lerp para 2D
function lerpPoint(p1, p2, t) {
    return {
        x: lerp(p1.x, p2.x, t),
        y: lerp(p1.y, p2.y, t)
    };
}

// bezier quadratica
function quadraticInterpolation(t) {
    const [p1, p2, p3] = points;

    const a = lerpPoint(p1, p2, t);
    const b = lerpPoint(p2, p3, t);

    return lerpPoint(a, b, t);
}

// bezier cubica
function cubicInterpolation(p0, p1, p2, p3, t) {
    const a = lerpPoint(p0, p1, t);
    const b = lerpPoint(p1, p2, t);
    const c = lerpPoint(p2, p3, t);

    const d = lerpPoint(a, b, t);
    const e = lerpPoint(b, c, t);

    return lerpPoint(d, e, t);
}

// 
function quarticInterpolation(t) {
    if (points.length !== nr_pontos) return {x: 0, y: 0};

    const p = points.slice();
    const a = lerpPoint(p[0], p[1], t);
    const b = lerpPoint(p[1], p[2], t);
    const c = lerpPoint(p[2], p[3], t);
    const d = lerpPoint(p[3], p[4], t);

    const e = lerpPoint(a, b, t);
    const f = lerpPoint(b, c, t);
    const g = lerpPoint(c, d, t);

    const h = lerpPoint(e, f, t);
    const i = lerpPoint(f, g, t);

    return lerpPoint(h, i, t);
}


function draw() {

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (points.length < 2) {
    drawPoints();
    return;
    }

    // Desenha Interpolação (Esqueleto)
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);

    for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
    }
        ctx.stroke();

    // Desenha os pontos de controle
    drawPoints();

    // CORRIGIDO: Usa nr_pontos
    if (points.length === nr_pontos) { 
        const currentPos = quarticInterpolation(t);
        ctx.fillStyle = '#007bff';

        ctx.beginPath();
        ctx.arc(currentPos.x, currentPos.y, OBJECT_SIZE, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawPoints() {
    points.forEach((p, index) => {
    const color = '#428bca'

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#333';
        ctx.font = '8px Arial';
        ctx.fillText(`P${index + 1}`, p.x + 10, p.y - 10);
    });
}

//Loop 

function animate() {

if (points.length === nr_pontos) { 
    t += SPEED;
    if (t > 1) {
        t = 0;
    }
    }

draw();
animationFrameId = requestAnimationFrame(animate);
}

// --- Eventos ---

canvas.addEventListener('click', (event) => {
 if (points.length < nr_pontos) { 

const rect = canvas.getBoundingClientRect();
const x = event.clientX - rect.left;
const y = event.clientY - rect.top;

points.push({ x, y });

const nextPoint = points.length + 1;
infoDiv.textContent = `Ponto ${points.length} definido.`;

if (points.length === nr_pontos) { 
infoDiv.textContent = `${nr_pontos} setados. Agora animação`;
t = 0; 
    if (!animationFrameId) {
    animate();
    }
 }
 
 draw();
    }
});

// Configura o estado inicial da interface
infoDiv.textContent = "Aguardando Ponto 1.";
draw();