/* ======================================================================
   ECO: O ARQUIVO PERDIDO — REFATORAÇÃO
   CHANGELOG
   - Input unificado: teclado + mouse + joystick virtual flutuante (touch) com zona morta.
   - Movimento com inércia (lerp exponencial) em 2D e 3D, independente de FPS (delta-time).
   - Corredor 3D agora é um RAYCASTER DDA real: paredes, obstáculos, colisão circular
     (câmera nunca atravessa parede), FOV dinâmico (sprint), câmera suavizada, olhar p/ trás real.
   - IA do monstro: Patrulhando / Investigando Som / Perseguindo / Perdeu o Alvo,
     com linha de visão (raycast na grade), cone de visão, raio de audição e pathfinding BFS.
     Despiste: quebre a visão atrás das barreiras por `loseTime` segundos.
   - Monstro mais justo: hesita `reaction`s ao te ver e é mais lento que o sprint.
   - HUD/UI responsivos (safe-area, retrato/paisagem), touch-action:none, sem zoom/scroll.
   - Fixes: timers do showStory empilhados, teclas presas ao perder foco, rAF cancelável,
     "Tentar novamente" reinicia só a fuga (sem recarregar a página).

   COMO AJUSTAR (objeto CFG, seção do motor 3D):
   - CFG.ai.chase / patrol / investigate → velocidade do monstro (células/s)
   - CFG.ai.vision / fovDeg / closeSense → percepção; loseTime → facilidade de despistar
   - CFG.ai.reaction → tempo de hesitação; walkNoise / sprintNoise → raio de audição
   - CFG.player.walk / sprint / accel / decel / drain / regen → movimento e estâmina
   - CFG.cam.fov / fovSprint / turnLerp / lookLerp / mouseSens / touchSens / maxYaw / maxPitch → câmera (olhar livre)
   - STICK.dead / STICK.radius → zona morta e raio do joystick; CFG.render.maxWTouch → resolução mobile
   ====================================================================== */
// ======================================================
// ECO: O ARQUIVO PERDIDO — MOTOR PRINCIPAL DO JOGO (2D & 3D CHASE ENHANCED)
// ======================================================

function initGameEngine() {

    // ==========================================
    // SINTETIZADOR PROCEDURAL DE SOM (WEB AUDIO API)
    // ==========================================
    class SoundEngine {
        constructor() {
            this.ctx = null;
        }

        init() {
            if (!this.ctx) {
                const AudioContext = window.AudioContext || window.webkitAudioContext;
                this.ctx = new AudioContext();
            }
            if (this.ctx && this.ctx.state === 'suspended') {
                this.ctx.resume();
            }
        }

        playStep() {
            if (!this.ctx) return;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(80, this.ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(30, this.ctx.currentTime + 0.08);
            gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.08);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start();
            osc.stop(this.ctx.currentTime + 0.08);
        }

        playDoor() {
            if (!this.ctx) return;
            const bufferSize = this.ctx.sampleRate * 0.8;
            const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                data[i] = Math.random() * 2 - 1;
            }
            const noise = this.ctx.createBufferSource();
            noise.buffer = buffer;
            const filter = this.ctx.createBiquadFilter();
            filter.type = 'bandpass';
            filter.frequency.value = 400;
            const gain = this.ctx.createGain();
            gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.8);
            noise.connect(filter);
            filter.connect(gain);
            gain.connect(this.ctx.destination);
            noise.start();
        }

        playPaper() {
            if (!this.ctx) return;
            const bufferSize = this.ctx.sampleRate * 0.2;
            const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                data[i] = Math.random() * 2 - 1;
            }
            const noise = this.ctx.createBufferSource();
            noise.buffer = buffer;
            const filter = this.ctx.createBiquadFilter();
            filter.type = 'highpass';
            filter.frequency.value = 1000;
            const gain = this.ctx.createGain();
            gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.2);
            noise.connect(filter);
            filter.connect(gain);
            gain.connect(this.ctx.destination);
            noise.start();
        }

        playThud() {
            if (!this.ctx) return;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(140, this.ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(20, this.ctx.currentTime + 1.2);
            gain.gain.setValueAtTime(1.0, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 1.2);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start();
            osc.stop(this.ctx.currentTime + 1.2);
        }

        playMetalPounding() {
            if (!this.ctx) return;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(180, this.ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(30, this.ctx.currentTime + 0.4);
            gain.gain.setValueAtTime(0.9, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.4);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start();
            osc.stop(this.ctx.currentTime + 0.4);
        }

        playAlarm() {
            if (!this.ctx) return;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(600, this.ctx.currentTime);
            osc.frequency.linearRampToValueAtTime(900, this.ctx.currentTime + 0.5);
            gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.5);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start();
            osc.stop(this.ctx.currentTime + 0.5);
        }

        playRoar() {
            if (!this.ctx) return;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(160, this.ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(35, this.ctx.currentTime + 1.6);
            gain.gain.setValueAtTime(0.7, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 1.6);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start();
            osc.stop(this.ctx.currentTime + 1.6);
        }
    }

    const sound = new SoundEngine();

    // ==========================================
    // ELEMENTOS DO DOM
    // ==========================================
    const menu = document.getElementById("menu");
    const game = document.getElementById("game");
    const startButton = document.getElementById("startButton");
    const eyes = document.getElementById("eyes");
    const storyText = document.getElementById("storyText");
    const interaction = document.getElementById("interaction");
    const actionButton = document.getElementById("actionButton");
    const recovery = document.getElementById("recovery");
    const progress = document.getElementById("progress");
    const percentage = document.getElementById("percentage");
    const recoveryStatus = document.getElementById("recoveryStatus");
    const player = document.getElementById("player");
    const monster = document.getElementById("monster");
    const darkness = document.getElementById("darkness");
    const alarmOverlay = document.getElementById("alarmOverlay");
    const perspectiveTransition = document.getElementById("perspectiveTransition");

    const room1 = document.getElementById("room1");
    const room2 = document.getElementById("room2");
    const room3 = document.getElementById("room3");
    const door1 = document.getElementById("door1");
    const door3 = document.getElementById("door3");
    const room3EntranceDoor = document.getElementById("room3EntranceDoor");

    const paper1 = document.getElementById("paper1");
    const paper2 = document.getElementById("paper2");
    const paper3 = document.getElementById("paper3");
    const flashlightItem = document.getElementById("flashlightItem");

    const paperModal = document.getElementById("paperModal");
    const paperTitle = document.getElementById("paperTitle");
    const paperContent = document.getElementById("paperContent");
    const closePaperButton = document.getElementById("closePaperButton");

    const gameOverModal = document.getElementById("gameOverModal");
    const restartButton = document.getElementById("restartButton");

    // Elementos do Corredor 3D Chase & Primeira Pessoa
    const chase3DContainer = document.getElementById("chase3DContainer");
    const canvas3D = document.getElementById("canvas3D");
    const ctx3D = canvas3D.getContext("2d");
    const distBar = document.getElementById("distBar");
    const distText = document.getElementById("distText");
    const monsterBar = document.getElementById("monsterBar");
    const staminaBar = document.getElementById("staminaBar");
    const firstPersonArms = document.getElementById("firstPersonArms");
    const lookBackIndicator = document.getElementById("lookBackIndicator");

    // ==========================================
    // ESTADO DO JOGO 2D
    // ==========================================
    let canMove = false;
    let currentRoom = 1;

    let playerX = 5.2;
    let playerY = 20.8;
    let facing = "down";

    let doorUnlocked = false;
    let secretDoorUnlocked = false;
    let hasFlashlight = false;
    let activeAction = null;
    let currentPaperBeingRead = 0;
    let papersReadCount = 0;

    const keys = { 
        w: false, a: false, s: false, d: false, 
        arrowup: false, arrowdown: false, arrowleft: false, arrowright: false,
        shift: false, " ": false
    };

    // ==========================================
    // [MELHORIA] INPUT UNIFICADO (Teclado + Mouse + Touch/Joystick virtual)
    // ==========================================
    let dt = 1;            // delta em "frames de 60fps" (1 = 16.6ms): mesma velocidade em 60/120/144Hz
    let vx = 0, vy = 0;    // velocidade 2D com inércia
    let uiScale = 1;       // escala da lanterna 2D conforme a tela
    let storyTimer = 0;
    const isTouch = matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;
    const stick = { x: 0, y: 0 };               // joystick analógico (-1..1, y+ = frente)
    const btn = { run: false, look: false };    // botões de segurar
    const STICK = { dead: 0.12, radius: 0.4 };  // zona morta / raio (fração do diâmetro da base)
    document.body.classList.toggle("touch", isTouch);
    // dispositivos híbridos: ativa os controles touch no primeiro toque real
    window.addEventListener("pointerdown", e => { if (e.pointerType === "touch") document.body.classList.add("touch"); }, { passive: true });

    window.addEventListener("keydown", e => {
        sound.init();
        const k = e.key.toLowerCase();
        if (k in keys) { keys[k] = true; if (!game.classList.contains("hidden")) e.preventDefault(); }
    });
    window.addEventListener("keyup", e => { const k = e.key.toLowerCase(); if (k in keys) keys[k] = false; });
    // [FIX] teclas não ficam "presas" ao perder o foco
    window.addEventListener("blur", () => { for (const k in keys) keys[k] = false; btn.run = btn.look = false; });

    // Vetor de movimento combinado (teclado + joystick). chase=true: S/↓ é "olhar para trás", não recuar.
    function getAxis(chase) {
        let x = Number(keys.d || keys.arrowright) - Number(keys.a || keys.arrowleft) + stick.x;
        let y = Number(keys.w || keys.arrowup) - (chase ? 0 : Number(keys.s || keys.arrowdown)) + stick.y;
        if (chase) y = Math.max(0, y);
        const m = Math.hypot(x, y);
        if (m > 1) { x /= m; y /= m; }
        return { x, y, m: Math.min(1, m) };
    }

    // --- Joystick virtual flutuante: aparece onde o dedo toca na metade esquerda ---
    const stickZone = document.getElementById("stickZone");
    const stickBase = document.getElementById("stickBase");
    const stickKnob = document.getElementById("stickKnob");
    const btnAct = document.getElementById("btnAct");
    let sid = null, ox = 0, oy = 0;
    stickZone.addEventListener("pointerdown", e => {
        if (sid !== null) return;
        sid = e.pointerId; stickZone.setPointerCapture(sid); sound.init();
        ox = e.clientX; oy = e.clientY;
        const s = stickBase.offsetWidth;
        stickBase.style.cssText = `left:${ox - s / 2}px;top:${oy - s / 2}px;bottom:auto`;
        stickBase.classList.add("on");
    });
    stickZone.addEventListener("pointermove", e => {
        if (e.pointerId !== sid) return;
        const r = stickBase.offsetWidth * STICK.radius;
        let dx = e.clientX - ox, dy = e.clientY - oy;
        const d = Math.hypot(dx, dy) || 1;
        if (d > r) { dx *= r / d; dy *= r / d; }
        stickKnob.style.transform = `translate(${dx}px,${dy}px)`;
        let nx = dx / r, ny = -dy / r;
        const m = Math.hypot(nx, ny);
        if (m < STICK.dead) { nx = ny = 0; }
        else { const k = (m - STICK.dead) / (1 - STICK.dead) / m; nx *= k; ny *= k; }
        stick.x = nx; stick.y = ny;
    });
    const stickEnd = e => {
        if (e.pointerId !== sid) return;
        sid = null; stick.x = stick.y = 0;
        stickKnob.style.transform = ""; stickBase.style.cssText = ""; stickBase.classList.remove("on");
    };
    stickZone.addEventListener("pointerup", stickEnd);
    stickZone.addEventListener("pointercancel", stickEnd);

    // --- Botões de segurar (Correr / Olhar) e toque (Agir) ---
    function holdButton(id, key) {
        const el = document.getElementById(id);
        el.addEventListener("pointerdown", e => { e.preventDefault(); btn[key] = true; el.classList.add("down"); sound.init(); });
        ["pointerup", "pointercancel", "pointerleave"].forEach(t =>
            el.addEventListener(t, () => { btn[key] = false; el.classList.remove("down"); }));
    }
    holdButton("btnRun", "run");
    holdButton("btnLook", "look");
    btnAct.addEventListener("pointerdown", e => { e.preventDefault(); sound.init(); if (activeAction) activeAction(); });

    // --- Sem zoom por duplo toque / pinça / scroll elástico ---
    document.addEventListener("touchmove", e => e.preventDefault(), { passive: false });
    document.addEventListener("gesturestart", e => e.preventDefault());
    let lastTap = 0;
    document.addEventListener("touchend", e => { const n = Date.now(); if (n - lastTap < 300) e.preventDefault(); lastTap = n; }, { passive: false });

    function onResize() { uiScale = Math.max(0.55, Math.min(1, Math.min(innerWidth, innerHeight * 1.6) / 900)); }
    window.addEventListener("resize", onResize); onResize();

    // Função de colisão para não atravessar objetos na sala 2D
    function isColliding(px, py) {
        if (currentRoom === 1) {
            // Verifica colisão com a área das mesas no topo da sala
            if (py > 17.5 && px > 36 && px < 82) return true;
        }
        return false;
    }

    // ==========================================
    // LOOP PRINCIPAL 2D
    // ==========================================
    let stepCounter = 0;

    function gameLoop(now) {
        // [MELHORIA] delta-time
        dt = Math.min(2.5, (now - (gameLoop.t || now)) / 16.667) || 1; gameLoop.t = now;
        if (canMove && !in3DChase) {
            let isMoving = false;
            let moveX = 0;
            let moveY = 0;
            
            // [MELHORIA] Inércia: a velocidade persegue o alvo com lerp exponencial (sem paradas bruscas)
            const currentSpeed = (currentRoom === 2) ? 0.16 : 0.115; // [AJUSTE] velocidade de caminhada 2D
            const ax = getAxis(false);
            const kk = 1 - Math.exp(-(ax.m > 0 ? 12 : 9) * dt / 60);
            vx += (ax.x * currentSpeed - vx) * kk;
            vy += (ax.y * currentSpeed - vy) * kk;
            moveX = vx * dt; moveY = vy * dt;
            isMoving = Math.hypot(vx, vy) > currentSpeed * 0.15;
            if (isMoving) facing = Math.abs(vx) > Math.abs(vy) ? (vx > 0 ? "right" : "left") : (vy > 0 ? "up" : "down");

            // Calcula próxima posição com limites das paredes
            let nextX = Math.max(2, Math.min(93, playerX + moveX));
            let nextY = Math.max(2, Math.min(21, playerY + moveY));

            // Aplica movimento eixo por eixo (permite deslizar pelas mesas)
            if (!isColliding(nextX, playerY)) playerX = nextX;
            if (!isColliding(playerX, nextY)) playerY = nextY;

            player.style.left = playerX + "%";
            player.style.bottom = playerY + "%";

            if (isMoving) {
                player.classList.add("is-moving");
                stepCounter++;
                if (stepCounter % (currentRoom === 2 ? 20 : 28) === 0) sound.playStep();
            } else {
                player.classList.remove("is-moving");
            }

            player.classList.remove("facing-left", "facing-right", "facing-up", "facing-down");
            player.classList.add("facing-" + facing);

            if (currentRoom === 2 || currentRoom === 3) {
                darkness.style.setProperty('--px', (playerX + 2) + '%');
                darkness.style.setProperty('--py', (100 - playerY - 4) + '%');
                darkness.style.setProperty('--light-radius', (hasFlashlight ? 420 : 220) * uiScale + 'px');
            }

            checkInteractions();
        } else if (!in3DChase) {
            vx = vy = 0;
            player.classList.remove("is-moving");
        }

        requestAnimationFrame(gameLoop);
    }

    requestAnimationFrame(gameLoop);

    function isNear(targetX, targetY, radius = 6.5) {
        return Math.hypot(playerX - targetX, playerY - targetY) <= radius;
    }

    // ==========================================
    // INTERAÇÕES DA SALA 1 E SALA 2
    // ==========================================
    function checkInteractions() {
        activeAction = null;

        if (currentRoom === 1) {
            if (isNear(14, 18, 5.5)) {
                setAction("EXAMINAR COBERTOR JOGADO", inspectBlanket);
            } else if (isNear(28, 18, 5.5)) {
                setAction("EXAMINAR GOTEIRA E POÇA", inspectPuddle);
            } else if (isNear(41, 20, 6.0)) {
                if (!hasFlashlight) {
                    setAction("PEGAR LANTERNA DA MESA", takeFlashlightAndReadBooks);
                } else {
                    setAction("LER LIVROS DE ANOTAÇÕES", readDesk1Books);
                }
            } else if (isNear(58, 20, 6.0)) {
                setAction("LER DOCUMENTOS DA MESA", readDesk2Documents);
            } else if (isNear(74, 20, 6.0)) {
                setAction("ACESSAR COMPUTADOR", startRecovery);
            } else if (isNear(88, 20, 6.5)) {
                if (doorUnlocked) {
                    setAction("ENTRAR NA SALA ESCURA", goToRoom2);
                } else {
                    setAction("EXAMINAR PORTA DE METAL", inspectLockedDoor);
                }
            } else {
                hideAction();
            }
        } 
        else if (currentRoom === 2) {
            if (isNear(25, 18, 6.0) && papersReadCount === 0) {
                setAction("LER PAPEL 1", () => readPaper(1));
            } else if (isNear(52, 12, 6.0) && papersReadCount === 1) {
                setAction("LER PAPEL 2", () => readPaper(2));
            } else if (isNear(78, 20, 6.0) && papersReadCount === 2) {
                setAction("LER PAPEL 3", () => readPaper(3));
            } else if (isNear(8, 12, 6.5)) {
                setAction("VOLTAR AO QUARTO", goToRoom1);
            } else {
                hideAction();
            }
        }
        else if (currentRoom === 3) {
            if (isNear(10, 15, 6.5)) {
                setAction("EXAMINAR PORTA TRANCADA", inspectLockedBunkerDoor);
            } else if (isNear(27, 14, 6.0)) {
                setAction("EXAMINAR ARRANHÕES NA PAREDE", inspectScratches);
            } else if (isNear(45, 15, 8.0)) {
                setAction("EXAMINAR CELA DE CONTENÇÃO", inspectContainmentCell);
            } else if (isNear(63, 11, 6.0)) {
                setAction("EXAMINAR CAMISA DE FORÇA", inspectJacket);
            } else if (isNear(84, 15, 7.0)) {
                setAction("EXAMINAR CORRENTES", inspectChains);
            } else {
                hideAction();
            }
        }
    }

    function inspectBlanket() { showStory("Um cobertor áspero e rasgado. Pareço ter acordado aqui no chão..."); }
    function inspectPuddle() { showStory("* PING... PING... * Água fria caindo diretamente do teto."); }

    function takeFlashlightAndReadBooks() {
        hasFlashlight = true;
        flashlightItem.classList.add("hidden-item");
        sound.playPaper();
        openGenericDocument(
            "LANTERNA RECOLHIDA & DIÁRIO DA MESA",
            "Você pegou a lanterna de metal que estava sobre a mesa!\n\nNo livro aberto ao lado está escrito:\n'As instalações subterrâneas foram lacradas após o Incidente 04. Mantenha uma lanterna sempre em mãos.'"
        );
    }

    function readDesk1Books() {
        sound.playPaper();
        openGenericDocument(
            "MANUAL DE PROTOCOLO DE CONTENÇÃO",
            "''AVISO IMPORTANTE:\nEm caso de falha da tranca central, não permaneça nos corredores principais. O Espécime 09 tem sensibilidade auditiva avançada.''"
        );
    }

    function readDesk2Documents() {
        sound.playPaper();
        openGenericDocument(
            "RELATÓRIO DE AUTÓPSIA #882",
            "''DOCUMENTO CLASSIFICADO // NÍVEL 4\n\nA porta de acesso ao corredor leste foi sincronizada com o computador central.''"
        );
    }

    function inspectLockedBunkerDoor() { showStory("A porta de aço blindado está selada por dentro."); }
    function inspectLockedDoor() { showStory("A porta de metal está trancada. É preciso liberar o acesso pelo computador."); }
    function inspectScratches() { showStory("Arranhões fundos, ainda avermelhados. Feitos com unhas... ou garras. Dezenas deles."); }
    function inspectJacket() { showStory("Uma camisa de força rasgada de dentro para fora. As correias de couro foram arrebentadas."); }
    function inspectChains() { showStory("Correntes chumbadas na parede, algemas abertas. Nada aqui foi feito para segurar um homem."); }
    function inspectContainmentCell() { showStory("As barras foram arrancadas à força... Essa era a cela de contenção dele."); }

    function setAction(text, callback) {
        actionButton.innerText = text;
        interaction.classList.remove("hidden");
        btnAct.classList.add("ready");
        activeAction = callback;
    }

    function hideAction() {
        interaction.classList.add("hidden");
        btnAct.classList.remove("ready");
        activeAction = null;
    }

    actionButton.addEventListener("click", function() {
        if (activeAction) activeAction();
    });

    // ==========================================
    // INICIAR O JOGO E ANIMAÇÃO DE ACORDAR
    // ==========================================
    startButton.addEventListener("click", startGame);

    function startGame() {
        sound.init();
        startButton.disabled = true;
        menu.style.opacity = "0";

        setTimeout(function () {
            menu.classList.add("hidden");
            game.classList.remove("hidden");
            document.body.classList.add("playing");
            eyes.style.visibility = "visible";
            wakeUp();
        }, 1000);
    }

    function wakeUp() {
        eyes.classList.remove("open");
        canMove = false;

        setTimeout(function () { eyes.classList.add("open"); }, 600);
        setTimeout(function () { eyes.classList.remove("open"); }, 2200);
        setTimeout(function () { eyes.classList.add("open"); }, 3100);
        setTimeout(function () { eyes.classList.remove("open"); }, 4200);

        setTimeout(function () {
            eyes.classList.add("open");
            showStory("...onde eu estou?");

            setTimeout(function () {
                player.classList.remove("is-lying");
                player.classList.add("getting-up");

                setTimeout(function () {
                    player.classList.remove("getting-up");
                    canMove = true;
                }, 1400);
            }, 2500);
        }, 5000);
    }

    function showStory(text) {
        storyText.innerText = text;
        storyText.style.opacity = "1";
        clearTimeout(storyTimer); // [FIX] timers não se acumulam
        storyTimer = setTimeout(function () { storyText.style.opacity = "0"; }, 4000);
    }

    function openGenericDocument(title, text) {
        canMove = false;
        hideAction();
        paperTitle.innerText = title;
        paperContent.innerText = text;
        paperModal.classList.remove("hidden");
    }

    // ==========================================
    // COMPUTADOR E RECUPERAÇÃO DE DADOS
    // ==========================================
    function startRecovery() {
        canMove = false;
        hideAction();
        recovery.classList.remove("hidden");
        recoverFile();
    }

    function recoverFile() {
        let value = 0;
        progress.style.width = "0%";
        percentage.innerText = "0%";
        recoveryStatus.innerText = "Inicializando recuperação...";

        const interval = setInterval(function () {
            value++;
            progress.style.width = value + "%";
            percentage.innerText = value + "%";

            if (value === 25) recoveryStatus.innerText = "Reconstruindo dados...";
            if (value === 60) recoveryStatus.innerText = "Tentando recuperação manual...";
            if (value === 95) recoveryStatus.innerText = "ATENÇÃO: dados incomuns detectados.";

            if (value >= 100) {
                clearInterval(interval);
                recoveryStatus.innerText = "RECUPERAÇÃO CONCLUÍDA.";
                setTimeout(showRecoveredFile, 800);
            }
        }, 30);
    }

    function showRecoveredFile() {
        recovery.innerHTML = `
            <div class="modal-box">
                <p class="terminal">TERMINAL // RECOVERY_SYSTEM</p>
                <h2>ARQUIVO 01 — RECUPERADO</h2>
                <div style="color: #aaa; line-height: 1.7; text-align: center;">
                    <p>REGISTRO DE PESQUISA — 17/04/2006</p><br>
                    <p>"Se alguém encontrar este arquivo, não continue a investigação."</p><br>
                    <p>"Nós achávamos que o lugar estava abandonado. Estávamos errados."</p><br>
                    <p><strong>ele sabia que estávamos aqui.</strong></p>
                    <button id="continueButton" style="margin-top: 35px;">CONTINUAR</button>
                </div>
            </div>
        `;
        document.getElementById("continueButton").addEventListener("click", continueGame);
    }

    function continueGame() {
        recovery.classList.add("hidden");
        showStory("O arquivo termina aqui...");
        canMove = true;

        if (!doorUnlocked) {
            setTimeout(function() {
                doorUnlocked = true;
                sound.playDoor();
                door1.classList.add("door-open");
                showStory("* SCHHHHK-CLANK * ... A porta de metal do lado direito se abriu.");
            }, 2000);
        }
    }

    // ==========================================
    // PAPÉIS NA SALA 2
    // ==========================================
    function readPaper(number) {
        canMove = false;
        hideAction();
        sound.playPaper();
        currentPaperBeingRead = number;

        if (number === 1) {
            paperTitle.innerText = "PAPEL RASGADO (1/3)";
            paperContent.innerText = '"Dia 03: Algo escapou do setor de contenção inferior. A equipe tentou trancar os portões de metal, mas os controles principais foram sabotados."';
        } else if (number === 2) {
            paperTitle.innerText = "PAPEL RASGADO (2/3)";
            paperContent.innerText = '"Dia 05: Aquela coisa não é humana. Ela se move no escuro absoluto e se atrai por qualquer som de passos."';
        } else if (number === 3) {
            paperTitle.innerText = "PAPEL RASGADO (3/3)";
            paperContent.innerText = '"Dia 06: É tarde demais. O corredor principal de fuga é a única saída... ELE JÁ SABE QUE VOCÊ ESTÁ AQUI!"';
        }

        paperModal.classList.remove("hidden");
    }

    closePaperButton.addEventListener("click", function() {
        paperModal.classList.add("hidden");
        canMove = true;

        if (currentPaperBeingRead === 1 && papersReadCount === 0) {
            papersReadCount = 1;
            paper1.classList.add("hidden-item");
            paper2.classList.remove("hidden-item");
            showStory("Encontrei o próximo pedaço de papel mais à frente...");
        } else if (currentPaperBeingRead === 2 && papersReadCount === 1) {
            papersReadCount = 2;
            paper2.classList.add("hidden-item");
            paper3.classList.remove("hidden-item");
            showStory("Há mais um fragmento no final da sala...");
        } else if (currentPaperBeingRead === 3 && papersReadCount === 2) {
            papersReadCount = 3;
            paper3.classList.add("hidden-item");
            triggerMonsterEvent();
        }
    });

    // ==========================================
    // TRANSIÇÃO PARA MODO FUGA 3D EM 1ª PESSOA
    // ==========================================
    function triggerMonsterEvent() {
        canMove = false;
        showStory("Espere... o que foi isso?!");

        setTimeout(function() {
            sound.playThud();
            game.classList.add("shake");

            setTimeout(function() {
                game.classList.remove("shake");
                alarmOverlay.classList.remove("hidden");
                sound.playAlarm();
                sound.playRoar();

                perspectiveTransition.classList.remove("hidden");

                setTimeout(function() {
                    perspectiveTransition.classList.add("hidden");
                    start3DChase();
                }, 1500);

            }, 1000);
        }, 1500);
    }

    // ==========================================
    // MOTOR DE CORREDOR 3D EM 1ª PESSOA COM "LOOK BACK" E BRAÇOS (MELHORADO)
    // ==========================================
    // ==========================================
    // [REFATORADO] CORREDOR 3D — RAYCASTER DDA + IA COM LINHA DE VISÃO
    // ==========================================
    const CFG = {
        player: { walk: 3.4, sprint: 5.7, accel: 9, decel: 7, radius: 0.3, drain: 22, regen: 14, minStam: 25 }, // células/s
        cam:    { fov: 70, fovSprint: 84, fovLerp: 6, turnLerp: 9, bob: 1.9, mouseSens: 0.0022, touchSens: 0.005, turnKey: 2.2, lookLerp: 16, maxYaw: 1.35, maxPitch: 0.3 },
        ai:     { patrol: 2.1, investigate: 3.3, chase: 4.6, vision: 22, fovDeg: 110, closeSense: 3,
                  loseTime: 3.2, searchTime: 4, reaction: 0.8, catchDist: 0.8, walkNoise: 9, sprintNoise: 18, hunt: 9 },
        render: { maxW: 960, maxWTouch: 640, col: 2, fog: 24 }
    };
    const MW = 11, MH = 100, HEAD = -Math.PI / 2;   // corredor 11x100 células; jogador vai para o norte (y↓)
    const WALL = { 1: [58, 68, 84], 2: [150, 255, 230], 3: [110, 78, 48] }; // parede / porta do bunker / caixas
    const AI_LABEL = { patrol: "PATRULHANDO", investigate: "INVESTIGANDO SOM", chase: "PERSEGUINDO!", lost: "PERDEU O ALVO" };
    const monsterText = document.getElementById("monsterText");
    let grid = [], in3DChase = false, chaseFailed = false, chaseRAF = 0, lastT = 0, startRemain = 1;
    const ply = { x: 0, y: 0, vx: 0, vy: 0, speed: 0, sprint: false, stam: 100, tired: false };
    const mon = { x: 0, y: 0, face: HEAD, state: "patrol", react: 0, lost: 0, t: 0, tx: 0, ty: 0, lx: 0, ly: 0, wp: null, path: null, pathT: 0, d: 99 };
    const cam = { yaw: HEAD, pitch: 0, fov: CFG.cam.fov, bob: 0, step: 0 };
    const look = { yaw: 0, pitch: 0 };   // alvo do olhar livre (a câmera o segue com lerp)
    keys.q = keys.e = false;
    const motes = Array.from({ length: 36 }, () => ({ x: Math.random(), y: Math.random(), s: 0.5 + Math.random() }));
    let zb = new Float32Array(1), bgGrad = null, scare = 0, heart = 0;
    // batimento cardíaco: mais rápido e forte quanto mais perto o monstro está
    sound.playHeart = function (v) {
        if (!this.ctx) return;
        const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.type = "sine"; o.frequency.setValueAtTime(60, t); o.frequency.exponentialRampToValueAtTime(32, t + 0.18);
        g.gain.setValueAtTime(0.15 + v * 0.45, t); g.gain.exponentialRampToValueAtTime(0.01, t + 0.2);
        o.connect(g); g.connect(this.ctx.destination); o.start(t); o.stop(t + 0.2);
    };

    // --- Mundo: barreiras alternadas (meia largura) + pilares = cobertura para quebrar a visão ---
    function buildMap() {
        grid = [];
        for (let y = 0; y < MH; y++) { grid.push([]); for (let x = 0; x < MW; x++) grid[y].push(x === 0 || x === MW - 1 || y >= MH - 1 ? 1 : 0); }
        for (let x = 0; x < MW; x++) grid[0][x] = 2;
        for (let y = MH - 10, k = 0; y > 10; y -= 6, k++) {
            for (let x = 1; x <= 5; x++) grid[y][k % 2 ? MW - 1 - x : x] = 3;
            grid[y - 3][5] = 3;
        }
    }
    const cell = (x, y) => (x < 0 || y < 0 || x >= MW || y >= MH) ? 1 : grid[y][x];

    // Colisão círculo x grade, eixo a eixo (desliza nas paredes; câmera nunca entra na parede)
    function blocked(x, y, r) {
        for (let cy = Math.floor(y - r); cy <= Math.floor(y + r); cy++)
            for (let cx = Math.floor(x - r); cx <= Math.floor(x + r); cx++)
                if (cell(cx, cy)) {
                    const nx = Math.max(cx, Math.min(x, cx + 1)), ny = Math.max(cy, Math.min(y, cy + 1));
                    if ((x - nx) ** 2 + (y - ny) ** 2 < r * r) return true;
                }
        return false;
    }
    function move(e, dx, dy, r) { if (!blocked(e.x + dx, e.y, r)) e.x += dx; if (!blocked(e.x, e.y + dy, r)) e.y += dy; }

    // LINHA DE VISÃO: amostra o segmento na grade; qualquer célula sólida bloqueia
    function los(ax, ay, bx, by) {
        const n = Math.ceil(Math.hypot(bx - ax, by - ay) / 0.25);
        for (let i = 1; i < n; i++) { const t = i / n; if (cell(Math.floor(ax + (bx - ax) * t), Math.floor(ay + (by - ay) * t))) return false; }
        return true;
    }

    // Pathfinding BFS (4 vizinhos): devolve o centro da próxima célula no caminho
    function nextWaypoint(fx, fy, tx, ty) {
        const s = (fy | 0) * MW + (fx | 0), t = (ty | 0) * MW + (tx | 0);
        if (s === t || cell(tx | 0, ty | 0)) return null;
        const prev = new Int16Array(MW * MH).fill(-1), q = [s]; prev[s] = s;
        for (let h = 0; h < q.length && prev[t] < 0; h++) {
            const c = q[h], cx = c % MW, cy = (c / MW) | 0;
            for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
                const nx = cx + dx, ny = cy + dy; if (cell(nx, ny)) continue;
                const n = ny * MW + nx; if (prev[n] < 0) { prev[n] = c; q.push(n); }
            }
        }
        if (prev[t] < 0) return null;
        let c = t; while (prev[c] !== s) c = prev[c];
        return { x: (c % MW) + 0.5, y: ((c / MW) | 0) + 0.5 };
    }

    function steer(dt, speed, tx, ty, direct) {
        let wx = tx, wy = ty;
        if (!direct) {
            mon.pathT -= dt;
            if (mon.pathT <= 0 || !mon.path) { mon.path = nextWaypoint(mon.x, mon.y, tx, ty); mon.pathT = 0.25; }
            if (mon.path) { wx = mon.path.x; wy = mon.path.y; }
        }
        const dx = wx - mon.x, dy = wy - mon.y, d = Math.hypot(dx, dy);
        if (d < 0.05) return;
        const s = Math.min(speed * dt, d);
        mon.face = Math.atan2(dy, dx);
        move(mon, dx / d * s, dy / d * s, 0.3);
    }

    // --- IA: máquina de estados patrol → investigate → chase → lost → patrol ---
    function updateAI(dt) {
        const m = mon, p = ply, A = CFG.ai;
        const d = Math.hypot(p.x - m.x, p.y - m.y), ang = Math.atan2(p.y - m.y, p.x - m.x);
        const off = Math.abs(Math.atan2(Math.sin(ang - m.face), Math.cos(ang - m.face)));
        // percepção: raio + linha de visão + cone (ou proximidade extrema)
        const sees = d < A.vision && los(m.x, m.y, p.x, p.y) && (off < A.fovDeg * Math.PI / 360 || d < A.closeSense);
        // audição: correr faz muito barulho; andar pouco; parado nenhum
        const noise = p.sprint ? A.sprintNoise : (p.speed > CFG.player.walk * 0.5 ? A.walkNoise : 0);
        if (sees) {
            if (m.state !== "chase") { m.state = "chase"; m.react = A.reaction; sound.playRoar(); scare = 1; }
            m.lx = p.x; m.ly = p.y; m.lost = 0;
        } else if (d < noise && m.state !== "chase") {
            m.state = "investigate"; m.tx = p.x; m.ty = p.y; m.t = 0;
        }
        if (m.state === "patrol") {
            m.hunt = (m.hunt || 0) + dt;
            if (m.hunt > A.hunt) { m.hunt = 0; m.state = "investigate"; m.tx = p.x; m.ty = p.y; m.t = 0; }
        } else m.hunt = 0;
        let speed = 0, tx = m.x, ty = m.y, direct = false;
        switch (m.state) {
            case "chase":
                if (!sees) { m.lost += dt; if (m.lost > A.loseTime) { m.state = "lost"; m.t = 0; break; } } // perdeu de vista: vai ao último ponto
                tx = m.lx; ty = m.ly; direct = sees; m.react -= dt;
                if (m.react > 0) m.face = ang; else speed = A.chase;   // hesita ao te ver
                break;
            case "investigate":
                tx = m.tx; ty = m.ty; speed = A.investigate;
                if (Math.hypot(tx - m.x, ty - m.y) < 0.8) { m.state = "lost"; m.t = 0; m.lx = m.x; m.ly = m.y; }
                break;
            case "lost": // vai ao último ponto conhecido e varre o ambiente antes de desistir
                m.t += dt; tx = m.lx; ty = m.ly;
                if (Math.hypot(tx - m.x, ty - m.y) > 0.8 && m.t < A.searchTime) speed = A.investigate * 0.8; else m.face += dt * 1.6;
                if (m.t > A.searchTime) { m.state = "patrol"; m.wp = null; }
                break;
            default: // patrulha: waypoints aleatórios com leve tendência a avançar
                if (!m.wp || Math.hypot(m.wp.x - m.x, m.wp.y - m.y) < 0.8) {
                    m.wp = { x: m.x, y: m.y };
                    for (let i = 0; i < 8; i++) {
                        const x = 1.5 + Math.random() * (MW - 3), y = Math.max(2, Math.min(MH - 3, ply.y + Math.random() * 16 - 4));
                        if (!cell(x | 0, y | 0)) { m.wp = { x, y }; break; }
                    }
                }
                tx = m.wp.x; ty = m.wp.y; speed = A.patrol;
        }
        if (speed > 0) steer(dt, speed, tx, ty, direct);
        m.d = d;
    }

    // --- Jogador: aceleração/desaceleração suaves, estâmina, câmera com lerp e FOV dinâmico ---
    function updatePlayer(dt) {
        const P = CFG.player, ax = getAxis(true);
        const looking = keys[" "] || keys.s || keys.arrowdown || btn.look;
        if (ply.tired && ply.stam > P.minStam) ply.tired = false;
        ply.sprint = (keys.shift || btn.run) && ax.m > 0.1 && !ply.tired && ply.stam > 0;
        ply.stam = Math.max(0, Math.min(100, ply.stam + (ply.sprint ? -P.drain : P.regen * (ax.m > 0.1 ? 0.6 : 1)) * dt));
        if (ply.stam <= 0) { ply.tired = true; ply.sprint = false; }
        const sp = ply.sprint ? P.sprint : P.walk, k = 1 - Math.exp(-(ax.m > 0 ? P.accel : P.decel) * dt);
        look.yaw = Math.max(-CFG.cam.maxYaw, Math.min(CFG.cam.maxYaw, look.yaw + (Number(keys.e) - Number(keys.q)) * CFG.cam.turnKey * dt));
        const h = HEAD + look.yaw, fx = Math.cos(h), fy = Math.sin(h);   // anda para onde você olha
        ply.vx += ((fx * ax.y - fy * ax.x * 0.8) * sp - ply.vx) * k;
        ply.vy += ((fy * ax.y + fx * ax.x * 0.8) * sp - ply.vy) * k;
        move(ply, ply.vx * dt, ply.vy * dt, P.radius);
        ply.speed = Math.hypot(ply.vx, ply.vy);
        const tYaw = HEAD + look.yaw + (looking ? Math.PI : 0);
        cam.yaw += Math.atan2(Math.sin(tYaw - cam.yaw), Math.cos(tYaw - cam.yaw)) * (1 - Math.exp(-(looking ? CFG.cam.turnLerp * 1.3 : CFG.cam.lookLerp) * dt));
        cam.pitch += (look.pitch - cam.pitch) * (1 - Math.exp(-CFG.cam.lookLerp * dt));
        const tf = ply.sprint ? CFG.cam.fovSprint : CFG.cam.fov + ply.speed;
        cam.fov += (tf - cam.fov) * (1 - Math.exp(-CFG.cam.fovLerp * dt));
        cam.bob += ply.speed * dt * CFG.cam.bob;
        const st = Math.floor(cam.bob / Math.PI);
        if (st !== cam.step) { cam.step = st; if (ply.speed > 1) sound.playStep(); }
        return looking;
    }

    // --- Render: 1 raio por coluna (DDA), z-buffer, monstro como sprite com oclusão ---
    function render(now) {
        const g = ctx3D, W = canvas3D.width, H = canvas3D.height, COL = CFG.render.col, px = ply.x, py = ply.y;
        const half = Math.tan(cam.fov * Math.PI / 360), dirX = Math.cos(cam.yaw), dirY = Math.sin(cam.yaw);
        const plX = -dirY * half, plY = dirX * half;
        const al = Math.abs(Math.sin(now / 250)), fl = Math.random() > 0.985 ? 0.45 : 1;
        const hor = H / 2 + cam.pitch * H * 0.9 + (Math.random() - 0.5) * scare * H * 0.03 + Math.sin(cam.bob) * H * 0.008 * (ply.sprint ? 1.7 : 1) * Math.min(1, ply.speed / 2);
        g.fillStyle = bgGrad; g.setTransform(1, 0, 0, 1, 0, hor - H / 2); g.fillRect(0, -H, W, 3 * H); g.setTransform(1, 0, 0, 1, 0, 0);
        for (let x = 0; x < W; x += COL) {
            const cx = 2 * x / W - 1, rdx = dirX + plX * cx, rdy = dirY + plY * cx;
            const ddx = Math.abs(1 / rdx), ddy = Math.abs(1 / rdy);
            let mx = px | 0, my = py | 0, sx, sy, sdx, sdy, side = 0, hit = 0;
            if (rdx < 0) { sx = -1; sdx = (px - mx) * ddx; } else { sx = 1; sdx = (mx + 1 - px) * ddx; }
            if (rdy < 0) { sy = -1; sdy = (py - my) * ddy; } else { sy = 1; sdy = (my + 1 - py) * ddy; }
            for (let i = 0; i < 56 && !hit; i++) {
                if (sdx < sdy) { sdx += ddx; mx += sx; side = 0; } else { sdy += ddy; my += sy; side = 1; }
                hit = cell(mx, my);
            }
            const dist = Math.max(0.05, side ? sdy - ddy : sdx - ddx);
            zb[(x / COL) | 0] = hit ? dist : 99;
            if (!hit) continue;
            const lh = H / dist, wx = (((side ? px + dist * rdx : py + dist * rdy) % 1) + 1) % 1;
            const f = Math.pow(Math.max(0, 1 - dist / CFG.render.fog), 1.5) * fl, c = WALL[hit];
            let sh = (side ? 0.7 : 1) * f * ((wx * 3) % 1 < 0.04 ? 0.55 : 1);
            if (hit === 2) sh = 0.55 + 0.45 * al;   // porta do bunker: sempre visível e pulsante
            g.fillStyle = `rgb(${(c[0] * sh + al * 26 * f) | 0},${(c[1] * sh) | 0},${(c[2] * sh) | 0})`;
            g.fillRect(x, hor - lh / 2, COL, lh);
            const hs = ((mx * 73856093) ^ (my * 19349663)) >>> 0;
            if (hit === 1) {   // cano, rodapé e manchas de sangue nas paredes
                g.fillStyle = `rgb(${(70 * sh) | 0},${(46 * sh) | 0},${(34 * sh) | 0})`; g.fillRect(x, hor - lh * 0.3, COL, Math.max(1, lh * 0.05));
                g.fillStyle = `rgba(0,0,0,${0.5 * f})`; g.fillRect(x, hor + lh * 0.4, COL, lh * 0.1);
                if (hs % 9 === 0 && wx > 0.25 && wx < 0.6) { g.fillStyle = `rgba(${(110 * f) | 0},0,0,0.75)`; g.fillRect(x, hor - lh * 0.15, COL, lh * (0.12 + (wx - 0.25) * 0.5)); }
            } else if (hit === 3) {   // caixas: ripas e cinta
                g.fillStyle = `rgba(0,0,0,${0.45 * f})`;
                if ((wx * 4) % 1 < 0.08 || Math.abs(wx - 0.5) < 0.03) g.fillRect(x, hor - lh / 2, COL, lh);
                g.fillRect(x, hor - lh * 0.02, COL, Math.max(1, lh * 0.04));
            }
        }
        // luminárias do teto (ocluídas pelo z-buffer) com poça de luz no chão; algumas piscam
        const iv = 1 / (plX * dirY - dirX * plY);
        for (let ly = Math.floor(py / 4) * 4 - 24; ly < py + 8; ly += 4) {
            const lex = MW / 2 - px, ley = ly + 0.5 - py;
            const lX = iv * (dirY * lex - dirX * ley), lY = iv * (-plY * lex + plX * ley);
            if (lY < 0.4 || lY > CFG.render.fog) continue;
            const lsx = (W / 2) * (1 + lX / lY), sc = H / lY, ci = Math.max(0, Math.min(zb.length - 1, (lsx / COL) | 0));
            if (zb[ci] < lY) continue;
            const a = Math.max(0, 1 - lY / CFG.render.fog) * (((ly / 4) % 5 === 2 && Math.random() > 0.9) ? 0.25 : 1);
            g.fillStyle = `rgba(255,235,200,${a})`; g.fillRect(lsx - sc * 0.28, hor - sc * 0.5, sc * 0.56, Math.max(1.5, sc * 0.05));
            g.fillStyle = `rgba(255,220,170,${a * 0.14})`; g.beginPath(); g.ellipse(lsx, hor + sc * 0.5, sc * 1.3, sc * 0.12, 0, 0, 6.3); g.fill();
        }
        g.fillStyle = "rgba(200,210,230,0.35)";   // partículas de poeira
        for (const m of motes) { m.y = (m.y + m.s * 0.0004) % 1; m.x = (m.x + Math.sin(now / 2000 + m.s * 9) * 0.0003 + 1) % 1; g.fillRect(m.x * W, m.y * H, 1.5, 1.5); }
        // monstro (billboard): projeta no espaço da câmera e testa o z-buffer coluna a coluna
        const ex = mon.x - px, ey = mon.y - py, inv = 1 / (plX * dirY - dirX * plY);
        const tX = inv * (dirY * ex - dirX * ey), tY = inv * (-plY * ex + plX * ey);
        if (tY > 0.25) {
            const sxc = (W / 2) * (1 + tX / tY), h = Math.min(H * 2.4, H / tY * 1.05), w = h * 0.66, y0 = hor - h * 0.55;
            g.fillStyle = "#060000";
            for (let c = Math.max(0, (sxc - w / 2) | 0); c < Math.min(W, sxc + w / 2); c += COL) {
                if (zb[(c / COL) | 0] < tY) continue;
                const u = (c - (sxc - w / 2)) / w;
                if (u > 0.2 && u < 0.8) g.fillRect(c, y0 + h * 0.27, COL, h * 0.73); else g.fillRect(c, y0 + h * 0.3, COL, h * 0.6); // braços longos
                if (u > 0.32 && u < 0.68) g.fillRect(c, y0, COL, h * 0.3);
            }
            const mid = Math.min(zb.length - 1, Math.max(0, (sxc / COL) | 0));
            if (zb[mid] > tY) {
                g.fillStyle = `rgba(255,${(50 * al) | 0},0,0.95)`;
                for (const e of [sxc - w * 0.09, sxc + w * 0.09]) { g.beginPath(); g.arc(e, y0 + h * 0.13, Math.max(1.5, h * 0.022), 0, 6.3); g.fill(); }
            }
        }
        if (scare > 0) { const c = (180 * (1 - scare)) | 0; g.fillStyle = `rgba(255,${c},${c},${scare * 0.55})`; g.fillRect(0, 0, W, H); }
        if (mon.state === "chase") { g.fillStyle = `rgba(255,0,0,${Math.max(0, 1 - mon.d / 10) * 0.4})`; g.fillRect(0, 0, W, H); }
    }

    function resizeCanvas() {
        const r = Math.min(1, (isTouch ? CFG.render.maxWTouch : CFG.render.maxW) / innerWidth); // [PERF] resolução interna limitada
        canvas3D.width = Math.max(320, (innerWidth * r) | 0); canvas3D.height = Math.max(180, (innerHeight * r) | 0);
        zb = new Float32Array(Math.ceil(canvas3D.width / CFG.render.col));
        bgGrad = ctx3D.createLinearGradient(0, 0, 0, canvas3D.height);
        bgGrad.addColorStop(0, "#050507"); bgGrad.addColorStop(0.5, "#010102"); bgGrad.addColorStop(1, "#10131a");
    }
    window.addEventListener("resize", () => { if (in3DChase) resizeCanvas(); });
    const clampLook = () => {
        look.yaw = Math.max(-CFG.cam.maxYaw, Math.min(CFG.cam.maxYaw, look.yaw));
        look.pitch = Math.max(-CFG.cam.maxPitch, Math.min(CFG.cam.maxPitch, look.pitch));
    };
    let lookId = null, lx = 0, ly = 0;
    canvas3D.addEventListener("pointerdown", e => {
        if (!in3DChase) return;
        if (e.pointerType === "mouse") { if (canvas3D.requestPointerLock) canvas3D.requestPointerLock(); }
        else if (lookId === null) { lookId = e.pointerId; lx = e.clientX; ly = e.clientY; canvas3D.setPointerCapture(lookId); }
    });
    window.addEventListener("pointermove", e => {
        if (!in3DChase) return;
        if (e.pointerType === "mouse") {   // mouse: pointer lock (ou arrastar com botão esquerdo)
            if (document.pointerLockElement !== canvas3D && !(e.buttons & 1)) return;
            look.yaw += e.movementX * CFG.cam.mouseSens; look.pitch -= e.movementY * CFG.cam.mouseSens;
        } else if (e.pointerId === lookId) {   // touch: arrastar o dedo na metade direita
            look.yaw += (e.clientX - lx) * CFG.cam.touchSens; look.pitch -= (e.clientY - ly) * CFG.cam.touchSens;
            lx = e.clientX; ly = e.clientY;
        } else return;
        clampLook();
    });
    const lookEnd = e => { if (e.pointerId === lookId) lookId = null; };
    canvas3D.addEventListener("pointerup", lookEnd); canvas3D.addEventListener("pointercancel", lookEnd);

    function start3DChase() {
        buildMap();
        Object.assign(ply, { x: MW / 2, y: 74.5, vx: 0, vy: 0, speed: 0, sprint: false, stam: 100, tired: false });
        Object.assign(mon, { x: MW / 2 + 2, y: 86.5, face: HEAD, state: "chase", react: 1.4, lx: MW / 2, ly: 74.5, hunt: 0, lost: 0, t: 0, wp: null, path: null, d: 99 });
        Object.assign(cam, { yaw: HEAD, pitch: 0, fov: CFG.cam.fov, bob: 0, step: 0 }); look.yaw = look.pitch = 0;
        startRemain = ply.y - 1.4; chaseFailed = false; in3DChase = true;
        room2.classList.add("hidden"); darkness.classList.add("hidden");
        chase3DContainer.classList.remove("hidden"); document.body.classList.add("in-chase");
        resizeCanvas(); lastT = performance.now();
        if (!isTouch) showStory("Clique na tela para olhar com o mouse • Q/E também giram");
        sound.playRoar(); scare = 1;
        chaseRAF = requestAnimationFrame(chaseLoop);
    }

    function endChase(won) {
        in3DChase = false; cancelAnimationFrame(chaseRAF); if (document.exitPointerLock) document.exitPointerLock();   // [FIX] loop sempre cancelado
        document.body.classList.remove("in-chase");
        firstPersonArms.classList.remove("is-running", "is-sprinting", "is-looking-back");
        lookBackIndicator.classList.add("hidden");
        if (won) { chase3DContainer.classList.add("hidden"); goToRoom3(); }
        else { chaseFailed = true; sound.playRoar(); gameOverModal.classList.remove("hidden"); }
    }

    function chaseLoop(now) {
        if (!in3DChase) return;
        const step = Math.min(0.05, (now - lastT) / 1000 || 0.016); lastT = now;
        const looking = updatePlayer(step);
        updateAI(step);
        scare = Math.max(0, scare - step * 1.6);
        heart -= step;
        if (heart <= 0) { const dg = Math.max(0, 1 - mon.d / 18); if (dg > 0.05) sound.playHeart(dg); heart = 1.1 - dg * 0.75; }
        render(now);
        const rem = Math.max(0, ply.y - 1.4);
        distBar.style.width = (rem / startRemain * 100) + "%"; distText.innerText = Math.ceil(rem) + "m";
        monsterBar.style.width = Math.min(100, mon.d / 20 * 100) + "%"; staminaBar.style.width = ply.stam + "%";
        if (monsterText.dataset.s !== mon.state) { monsterText.dataset.s = mon.state; monsterText.innerText = AI_LABEL[mon.state]; monsterText.style.color = mon.state === "chase" ? "#ff3333" : "#ffcc00"; }
        lookBackIndicator.classList.toggle("hidden", !looking);
        firstPersonArms.classList.toggle("is-looking-back", !!looking);
        firstPersonArms.classList.toggle("is-running", ply.speed > 0.8 && !looking);
        firstPersonArms.classList.toggle("is-sprinting", ply.sprint && !looking);
        if (ply.y < 1.4) return endChase(true);
        if (mon.d < CFG.ai.catchDist) return endChase(false);
        chaseRAF = requestAnimationFrame(chaseLoop);
    }

        // ==========================================
    // DECORAÇÃO DINÂMICA DA CELA DE CONTENÇÃO (SALA 3)
    // ==========================================
    // Paredes acolchoadas: arranhões vermelhos (SVG gerado com seed fixa), rasgos no estofado e luz tensa
    function setupPaddedCell() {
        const svg = document.getElementById("cellScratches");
        if (!svg || svg.childElementCount) return;
        let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
        let paths = "", drips = "";
        for (let i = 0; i < 16; i++) {
            const x = 6 + rnd() * 148, y = 4 + rnd() * 38, a = (rnd() - 0.3) * 1.6 + 1.2, len = 10 + rnd() * 16;
            for (let k = 0, n = 3 + ((rnd() * 3) | 0); k < n; k++) {
                const ox = x + k * 2.6, oy = y + k * (rnd() * 1.5 - 0.4);
                const ex = ox + Math.cos(a) * len * (0.8 + rnd() * 0.5), ey = oy + Math.sin(a) * len;
                paths += `<path d="M${ox.toFixed(1)} ${oy.toFixed(1)} Q${((ox + ex) / 2 + (rnd() - 0.5) * 5).toFixed(1)} ${((oy + ey) / 2).toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}"/>`;
            }
        }
        for (let i = 0; i < 12; i++) { const x = rnd() * 160, y = rnd() * 40, l = 4 + rnd() * 14; drips += `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${x.toFixed(1)}" y2="${(y + l).toFixed(1)}"/>`; }
        svg.innerHTML = `<g class="sc-shadow">${paths}</g><g class="sc">${paths}</g><g class="drips">${drips}</g>`;
    }

    // ==========================================
    // TRANSIÇÕES DE SALA 2D E VITÓRIA
    // ==========================================
    function goToRoom2() {
        canMove = false;
        hideAction();
        sound.playDoor();

        currentRoom = 2;
        room1.classList.add("hidden");
        room2.classList.remove("hidden");
        darkness.classList.remove("hidden");

        playerX = 14;
        playerY = 12;
        player.style.left = playerX + "%";
        player.style.bottom = playerY + "%";

        setTimeout(function() {
            canMove = true;
            if (papersReadCount === 0) {
                showStory("Está muito escuro. Vejo um papel caído no chão...");
            }
        }, 500);
    }

    function goToRoom1() {
        canMove = false;
        hideAction();
        sound.playDoor();

        currentRoom = 1;
        room2.classList.add("hidden");
        room1.classList.remove("hidden");
        darkness.classList.add("hidden");

        playerX = 82;
        playerY = 12;
        player.style.left = playerX + "%";
        player.style.bottom = playerY + "%";

        setTimeout(function() { canMove = true; }, 500);
    }

    function goToRoom3() {
        perspectiveTransition.classList.remove("hidden");

        setTimeout(function() {
            perspectiveTransition.classList.add("hidden");

            currentRoom = 3;
            chase3DContainer.classList.add("hidden");
            room2.classList.add("hidden");
            room3.classList.remove("hidden");

            // Gera a decoração da cela de contenção dinamicamente ao entrar na sala 3
            setupPaddedCell();
            darkness.classList.add("hidden"); // a cela é iluminada pela própria lâmpada (sem máscara de lanterna)

            playerX = 25;
            playerY = 12;
            player.style.left = playerX + "%";
            player.style.bottom = playerY + "%";

            sound.playThud();
            room3EntranceDoor.classList.remove("door-open");
            game.classList.add("heavy-pounding");

            showStory("* CLANG-CLANG-CLANG * A porta de metal se fechou e selou!");

            let poundCount = 0;
            const poundingInterval = setInterval(function() {
                poundCount++;
                sound.playMetalPounding();

                if (poundCount % 2 === 0) sound.playRoar();

                if (poundCount >= 6) {
                    clearInterval(poundingInterval);
                    game.classList.remove("heavy-pounding");
                    alarmOverlay.classList.add("hidden");
                    showStory("O monstro está esmurrando a porta, mas o metal reforçado aguentou! Você conseguiu escapar... mas peraí, que lugar é esse?");
                    canMove = true;
                }
            }, 650);

        }, 1200);
    }

    restartButton.addEventListener("click", function() {
        if (chaseFailed) { gameOverModal.classList.add("hidden"); start3DChase(); } // reinicia só a fuga
        else location.reload();
    });
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initGameEngine);
} else {
    initGameEngine();
}