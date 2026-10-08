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

        // ---------- BLOCOS BÁSICOS DE SÍNTESE ----------
        _nbuf() {   // 2 s de ruído branco compartilhado
            if (this._nb) return this._nb;
            const c = this.ctx, b = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = b.getChannelData(0);
            for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
            this._nb = b; return b;
        }
        _burst(t, dur, type, f, q, vol, dest, fEnd) {   // estalo de ruído filtrado com envelope curto
            const c = this.ctx, s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
            s.buffer = this._nbuf(); fl.type = type; fl.Q.value = q;
            fl.frequency.setValueAtTime(f, t); if (fEnd) fl.frequency.exponentialRampToValueAtTime(fEnd, t + dur);
            g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + Math.min(0.006, dur / 3)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
            s.connect(fl); fl.connect(g); g.connect(dest || this._bus());
            s.start(t, Math.random() * 1.4); s.stop(t + dur + 0.03);
        }
        _ping(t, f, dur, vol, type, dest, fEnd) {   // tom curto (batida, clique, sino metálico)
            const c = this.ctx, o = c.createOscillator(), g = c.createGain();
            o.type = type || "sine"; o.frequency.setValueAtTime(f, t); if (fEnd) o.frequency.exponentialRampToValueAtTime(fEnd, t + dur);
            g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
            o.connect(g); g.connect(dest || this._bus()); o.start(t); o.stop(t + dur + 0.03);
        }

        // ---------- PASSOS POR TIPO DE PISO: 'pad' (acolchoado), 'concrete', 'metal' ----------
        playStep(kind, loud) {
            if (!this.ctx) return;
            const t = this.ctx.currentTime, k = kind || "concrete", v = loud ? 1.35 : 1;
            this._foot = !this._foot; const p = (this._foot ? 1 : 0.9) * (0.94 + Math.random() * 0.12);
            if (k === "pad") {            // estofado: baque surdo e abafado, quase sem agudos
                this._burst(t, 0.17, "lowpass", 240 * p, 0.7, 0.20 * v);
                this._ping(t, 82 * p, 0.14, 0.13 * v, "sine", null, 44);
                this._burst(t + 0.02, 0.1, "lowpass", 600, 0.6, 0.025 * v);   // roçar do tecido
            } else if (k === "metal") {   // laboratório: salto no piso metálico, ressonância e eco
                const g = this.ctx.createGain(); g.gain.value = 1; this._send(g, 0.28);
                this._burst(t, 0.05, "lowpass", 1500, 0.8, 0.09 * v, g);
                this._burst(t, 0.09, "bandpass", 700 * p, 1.4, 0.10 * v, g);
                this._ping(t, 210 * p, 0.22, 0.04 * v, "sine", g, 160 * p);
                this._ping(t, 96 * p, 0.09, 0.11 * v, "sine", null, 55);
            } else if (k === "grass") {   // grama: farfalhar suave + pisada macia
                this._burst(t, 0.14, "lowpass", 900 * p, 0.6, 0.08 * v);
                this._ping(t, 88 * p, 0.07, 0.06 * v, "sine", null, 52);
            } else {                      // concreto: estalo seco + corpo grave
                this._burst(t, 0.05, "lowpass", 1100 * p, 0.9, 0.13 * v);
                this._burst(t, 0.1, "lowpass", 480 * p, 0.8, 0.14 * v);
                this._ping(t, 105 * p, 0.09, 0.10 * v, "sine", null, 56);
            }
        }

        // ---------- PORTAS, TRAVAS E MAÇANETAS ----------
        playKnob(t0) {   // maçaneta girando: catraca de cliques + trinco
            if (!this.ctx) return;
            const t = (t0 || this.ctx.currentTime);
            for (let i = 0; i < 4; i++) this._burst(t + i * 0.035, 0.02, "bandpass", 1300 + i * 120, 1.6, 0.07);
            this._burst(t + 0.17, 0.05, "lowpass", 900, 1.2, 0.2); this._ping(t + 0.17, 300, 0.06, 0.07, "sine", null, 170);
        }
        playDoor() {   // porta de metal: maçaneta, rangido de dobradiça, arrasto e batida final
            if (!this.ctx) return;
            const c = this.ctx, t = c.currentTime;
            this.playKnob(t);
            const g = c.createGain(); g.gain.value = 1; this._send(g, 0.45);
            const o = c.createOscillator(), og = c.createGain(), bp = c.createBiquadFilter();   // rangido
            o.type = "sawtooth"; o.frequency.setValueAtTime(95, t + 0.2); o.frequency.linearRampToValueAtTime(150 + Math.random() * 40, t + 0.62); o.frequency.linearRampToValueAtTime(110, t + 0.85);
            bp.type = "bandpass"; bp.frequency.value = 520; bp.Q.value = 7;
            og.gain.setValueAtTime(0.0001, t + 0.2); og.gain.linearRampToValueAtTime(0.055, t + 0.4); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
            o.connect(bp); bp.connect(og); og.connect(g); o.start(t + 0.2); o.stop(t + 0.95);
            this._burst(t + 0.2, 0.6, "lowpass", 900, 0.8, 0.11, g, 260);            // arrasto do painel
            this._burst(t + 0.78, 0.07, "lowpass", 800, 1.2, 0.22, g);              // batente
            this._ping(t + 0.78, 85, 0.22, 0.28, "sine", g, 42);
        }
        playUnlock() {   // fechadura eletromecânica: bip, motor de trava e dois estalos de metal
            if (!this.ctx) return;
            const t = this.ctx.currentTime, g = this.ctx.createGain(); g.gain.value = 1; this._send(g, 0.3);
            this._ping(t, 640, 0.1, 0.05, "sine", g); this._ping(t + 0.11, 860, 0.13, 0.05, "sine", g);
            this._ping(t + 0.26, 120, 0.28, 0.05, "triangle", g, 260);               // motorzinho
            this._burst(t + 0.5, 0.04, "lowpass", 1400, 0.9, 0.28, g); this._ping(t + 0.5, 520, 0.08, 0.07, "sine", g);
            this._burst(t + 0.62, 0.04, "bandpass", 1100, 2, 0.26, g); this._ping(t + 0.62, 140, 0.14, 0.2, "sine", g, 70);
        }
        playLocked() {   // porta trancada: maçaneta sacudindo + buzina de recusa
            if (!this.ctx) return;
            const t = this.ctx.currentTime, g = this.ctx.createGain(); g.gain.value = 1; this._send(g, 0.3);
            [0, 0.08, 0.2].forEach((d, i) => { this._burst(t + d, 0.05, "bandpass", 750 - i * 80, 2.5, 0.22, g); this._ping(t + d, 120 - i * 15, 0.09, 0.18, "sine", g, 60); });
            this._ping(t + 0.34, 150, 0.2, 0.05, "triangle", g); this._ping(t + 0.34, 156, 0.2, 0.05, "triangle", g);
        }
        playBeep() { if (!this.ctx) return; const t = this.ctx.currentTime; this._ping(t, 620, 0.08, 0.05, "sine"); this._ping(t + 0.1, 840, 0.1, 0.05, "sine"); }
        playKeys() {   // chave coletada: tilintar de metal
            if (!this.ctx) return;
            const t = this.ctx.currentTime, g = this.ctx.createGain(); g.gain.value = 1; this._send(g, 0.5);
            [1500, 2000, 1750, 2300].forEach((f, i) => { this._ping(t + i * 0.055, f, 0.3, 0.04, "sine", g); this._burst(t + i * 0.055, 0.04, "bandpass", 1300, 1.2, 0.05, g); });
        }

        // ---------- PAPEL: amassar e desdobrar ----------
        playPaper() {
            if (!this.ctx) return;
            const c = this.ctx, t = c.currentTime, g = c.createGain(); g.gain.value = 1; g.connect(this._bus());
            const n = 16 + ((Math.random() * 8) | 0);
            for (let i = 0; i < n; i++) {                 // dezenas de estalinhos irregulares = papel enrugando
                const d = Math.pow(i / n, 0.85) * 0.62 + Math.random() * 0.03, env = 0.5 + 0.5 * Math.sin((i / n) * Math.PI);
                this._burst(t + d, 0.012 + Math.random() * 0.035, "bandpass", 1100 + Math.random() * 2600, 0.9 + Math.random() * 1.2, (0.05 + Math.random() * 0.09) * env, g);
            }
            const s = c.createBufferSource(), bp = c.createBiquadFilter(), sg = c.createGain();   // roçar contínuo das folhas
            s.buffer = this._nbuf(); bp.type = "bandpass"; bp.frequency.setValueAtTime(900, t); bp.frequency.linearRampToValueAtTime(1900, t + 0.55); bp.Q.value = 0.6;
            sg.gain.setValueAtTime(0.0001, t); sg.gain.linearRampToValueAtTime(0.05, t + 0.12); sg.gain.linearRampToValueAtTime(0.025, t + 0.4); sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
            s.connect(bp); bp.connect(sg); sg.connect(g); s.start(t, Math.random() * 1.2); s.stop(t + 0.75);
        }

        // ---------- AMBIENTE DO BUNKER: reator, vento nos corredores, goteiras, rangidos ----------
        startAmbience() {   // ambiente do bunker: cada sala ajusta as camadas em setAmbience()
            if (!this.ctx || this._amb) return;
            const c = this.ctx, t = c.currentTime, out = c.createGain();
            out.gain.setValueAtTime(0.0001, t); out.gain.linearRampToValueAtTime(1, t + 4);
            out.connect(this._bus()); const rv = c.createGain(); rv.gain.value = 0.3; out.connect(rv); rv.connect(this._rev());
            const A = this._amb = { out, nodes: [], timers: [] };
            const noiseLoop = (type, f, q) => { const s = c.createBufferSource(), fl = c.createBiquadFilter(); s.buffer = this._nbuf(); s.loop = true; fl.type = type; fl.frequency.value = f; fl.Q.value = q || 0.7; s.connect(fl); s.start(t, Math.random()); A.nodes.push(s); return fl; };
            // zumbido elétrico grave (transformadores/reator)
            const humG = c.createGain(), humLP = c.createBiquadFilter(); humLP.type = "lowpass"; humLP.frequency.value = 320; humG.gain.value = 0.045;
            [[50, "sawtooth", 0.5], [100.3, "sine", 0.7], [150.2, "sine", 0.2]].forEach(([f, ty, a]) => {
                const o = c.createOscillator(), g = c.createGain(); o.type = ty; o.frequency.value = f; g.gain.value = a; o.connect(g); g.connect(humLP); o.start(); A.nodes.push(o);
            });
            humLP.connect(humG); humG.connect(out);
            const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 0.37; lg.gain.value = 0.012; lfo.connect(lg); lg.connect(humG.gain); lfo.start(); A.nodes.push(lfo);
            // batida lenta do reator
            const rO = c.createOscillator(), rG = c.createGain(), rL = c.createOscillator(), rLG = c.createGain();
            rO.frequency.value = 37; rG.gain.value = 0.025; rL.frequency.value = 0.16; rLG.gain.value = 0.015; rL.connect(rLG); rLG.connect(rG.gain); rO.connect(rG); rG.connect(out); rO.start(); rL.start(); A.nodes.push(rO, rL);
            // vento distante nos corredores (faixa média-grave, varredura lenta)
            const wbp = noiseLoop("bandpass", 320, 1.1), wG = c.createGain(), wl = c.createOscillator(), wlg = c.createGain(), wl2 = c.createOscillator(), wlg2 = c.createGain();
            wG.gain.value = 0.05; wl.frequency.value = 0.07; wlg.gain.value = 140; wl.connect(wlg); wlg.connect(wbp.frequency);
            wl2.frequency.value = 0.11; wlg2.gain.value = 0.025; wl2.connect(wlg2); wlg2.connect(wG.gain); wbp.connect(wG); wG.connect(out); wl.start(); wl2.start(); A.nodes.push(wl, wl2);
            // sopro grave de ar (sem assobio agudo)
            const sbp = noiseLoop("lowpass", 520, 0.5), sG = c.createGain(); sG.gain.value = 0.0; sbp.connect(sG); sG.connect(out);
            // chiado baixo de monitores CRT (só graves/médios) + zumbido de bobina
            const crtF = noiseLoop("lowpass", 1700, 0.5), crtG = c.createGain(); crtG.gain.value = 0; crtF.connect(crtG); crtG.connect(out);
            const buzO = c.createOscillator(), buzG = c.createGain(); buzO.type = "sine"; buzO.frequency.value = 120; buzG.gain.value = 0; buzO.connect(buzG); buzG.connect(out); buzO.start(); A.nodes.push(buzO);
            // rumor grave do reator do laboratório
            const rumF = noiseLoop("lowpass", 110, 0.7), rumG = c.createGain(); rumG.gain.value = 0; rumF.connect(rumG); rumG.connect(out);
            const rumO = c.createOscillator(), rumOG = c.createGain(); rumO.frequency.value = 29; rumOG.gain.value = 0; rumO.connect(rumOG); rumOG.connect(out); rumO.start(); A.nodes.push(rumO);
            Object.assign(A, { humG, humLP, windG: wG, airG: sG, crtG, buzG, rumG, rumOG, crackRate: 0, valveRate: 0, base: { hum: 0.045, wind: 0.05, air: 0.03, crt: 0.011, buzz: 0.004, rum: 0.07, rumO: 0.05 } });
            // goteiras graves, válvulas de pressão e rangidos distantes
            const crack = () => {   // estalos elétricos curtos (só na sala de vigilância)
                if (this._amb !== A) return;
                if (A.crackRate > 0) {
                    const tt = c.currentTime, g = c.createGain(); g.gain.value = 1; g.connect(out);
                    this._burst(tt, 0.012 + Math.random() * 0.03, "bandpass", 2400 + Math.random() * 2400, 1.4, 0.05 * A.crackRate, g);
                    if (Math.random() < 0.4) this._burst(tt + 0.04, 0.02, "bandpass", 1800, 1.2, 0.03 * A.crackRate, g);
                }
                A.timers.push(setTimeout(crack, 500 + Math.random() * 2600));
            };
            const valve = () => {
                if (this._amb !== A) return;
                if (A.valveRate > 0) {
                    const tt = c.currentTime, s = c.createBufferSource(), lp = c.createBiquadFilter(), g = c.createGain();
                    s.buffer = this._nbuf(); lp.type = "lowpass"; lp.frequency.setValueAtTime(950, tt); lp.frequency.exponentialRampToValueAtTime(260, tt + 1.8); lp.Q.value = 0.8;
                    g.gain.setValueAtTime(0.0001, tt); g.gain.linearRampToValueAtTime(0.09, tt + 0.22); g.gain.exponentialRampToValueAtTime(0.003, tt + 1.9);
                    s.connect(lp); lp.connect(g); this._send(g, 0.4); s.start(tt, Math.random()); s.stop(tt + 2);
                    this._ping(tt, 64, 0.3, 0.12, "sine", null, 40);   // "tump" da válvula fechando
                }
                A.timers.push(setTimeout(valve, 6000 + Math.random() * 8000));
            };
            const creak = () => {
                if (this._amb !== A) return;
                const tt = c.currentTime, o = c.createOscillator(), g = c.createGain(), bp = c.createBiquadFilter(), lp = c.createBiquadFilter(); o.type = "sawtooth";
                const f = 48 + Math.random() * 30; o.frequency.setValueAtTime(f, tt); o.frequency.linearRampToValueAtTime(f * (1.15 + Math.random() * 0.35), tt + 1.4);
                bp.type = "bandpass"; bp.frequency.value = 200 + Math.random() * 160; bp.Q.value = 5; lp.type = "lowpass"; lp.frequency.value = 480;
                g.gain.setValueAtTime(0.0001, tt); g.gain.linearRampToValueAtTime(0.02, tt + 0.6); g.gain.exponentialRampToValueAtTime(0.0001, tt + 1.6);
                o.connect(bp); bp.connect(lp); lp.connect(g); g.connect(out); o.start(tt); o.stop(tt + 1.7);
                A.timers.push(setTimeout(creak, 14000 + Math.random() * 22000));
            };
            A.timers.push(setTimeout(crack, 1500), setTimeout(valve, 7000), setTimeout(creak, 9000));
        }
        setAmbience(room) {   // assinatura sonora de cada ambiente
            const A = this._amb; if (!A) return; const t = this.ctx.currentTime, B = A.base;
            const P = {   //         zumbido vento ar  --  abafamento(Hz) crt  rumor válvulas --
                0: [1.0, 0.8, 0.8, 0, 380, 0, 0.5, 0, 1.0],      // fuga no corredor
                1: [1.0, 0.35, 0.3, 0, 260, 0, 0.2, 0, 1.0],     // quarto/corredores: zumbido grave, seco e abafado
                2: [1.0, 0.35, 0.3, 0, 260, 0, 0.2, 0, 1.0],
                3: [0.8, 0.2, 0.2, 0, 220, 0, 0.3, 0, 1.0],      // cela acolchoada: som seco e abafado
                4: [1.0, 0.4, 0.3, 0, 260, 0, 0.25, 0, 1.0],
                5: [1.0, 0.4, 0.3, 0, 260, 0, 0.3, 0, 1.0],
                6: [1.0, 0.4, 0.3, 0, 260, 0, 0.3, 0, 1.0],
                7: [0.5, 0.05, 0.05, 0, 360, 3.2, 0.05, 0, 1.0], // vigilância: chiado CRT leve + ruído elétrico
                8: [0.12, 0.04, 0.04, 0, 200, 0, 1.5, 0, 1.0]    // laboratório: quase silêncio + vibração grave
            }[room] || [1, 1, 0.5, 1, 340, 0, 0.3, 0, 1];
            const k = 0.7;
            A.humG.gain.setTargetAtTime(B.hum * P[0], t, k); A.windG.gain.setTargetAtTime(B.wind * P[1], t, k); A.airG.gain.setTargetAtTime(B.air * P[2], t, k);
            A.humLP.frequency.setTargetAtTime(P[4], t, 0.5); A.crtG.gain.setTargetAtTime(B.crt * P[5], t, k); A.buzG.gain.setTargetAtTime(B.buzz * P[5], t, k);
            A.rumG.gain.setTargetAtTime(B.rum * P[6], t, k); A.rumOG.gain.setTargetAtTime(B.rumO * P[6], t, k);
            A.crackRate = P[5] ? 1 : 0; A.valveRate = P[7];
        }
        stopAmbience(fade) {
            const A = this._amb; if (!A) return; this._amb = null;
            const c = this.ctx, t = c.currentTime, f = fade || 2;
            A.out.gain.cancelScheduledValues(t); A.out.gain.setValueAtTime(A.out.gain.value, t); A.out.gain.linearRampToValueAtTime(0.0001, t + f);
            A.timers.forEach(clearTimeout);
            setTimeout(() => { A.nodes.forEach(n => { try { n.stop(); } catch (e) {} }); try { A.out.disconnect(); } catch (e) {} }, f * 1000 + 300);
        }

        // ---------- TRILHA DE PERSEGUIÇÃO: épica, rápida e aterrorizante + batimentos e respiração ----------
        startChase(kind) {   // kind: "corridor" (3D, mais sombrio/metálico) | "lab" (mais agudo e brutal)
            if (!this.ctx) return;
            if (this._ch) this.stopChase(0.2);
            const c = this.ctx, t = c.currentTime, out = c.createGain();
            out.gain.setValueAtTime(0.0001, t); out.gain.linearRampToValueAtTime(1, t + 1.2);
            out.connect(this._bus()); const rv = c.createGain(); rv.gain.value = 0.35; out.connect(rv); rv.connect(this._rev());
            const lab = kind === "lab", bpm = lab ? 168 : 154, sp = 60 / bpm / 2;   // colcheias
            const H = this._ch = { out, nodes: [], threat: 0.3, tgt: 0.3, next: c.currentTime + 0.1, step: 0, nextHeart: t + 0.6, nextBreath: t + 1.2, breathIn: true, kind, timer: 0 };
            // camada contínua de tensão: cordas dissonantes subindo (tritono) com vibrato
            const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 900; lp.Q.value = 0.8; lp.connect(out);
            const stg = c.createGain(); stg.gain.value = 0.05; stg.connect(lp);
            [[110, 0], [116.5, 3], [164.8, -4], [233, 5], [311, -6]].forEach(([f, dt], i) => {
                const o = c.createOscillator(), g = c.createGain(), v = c.createOscillator(), vg = c.createGain();
                o.type = "sawtooth"; o.frequency.value = f * (lab ? 1.06 : 1); o.detune.value = dt * 5; v.frequency.value = 5.2 + i * 0.4; vg.gain.value = 6; v.connect(vg); vg.connect(o.detune);
                g.gain.value = i > 2 ? 0.4 : 0.7; o.connect(g); g.connect(stg); o.start(); v.start(); H.nodes.push(o, v);
            });
            H.strings = stg; H.strLP = lp;
            // sirene grave "buzina de trem" distante, subindo e descendo devagar
            const so = c.createOscillator(), sg = c.createGain(), sl = c.createOscillator(), slg = c.createGain();
            so.type = "sawtooth"; so.frequency.value = lab ? 73.4 : 55; sl.frequency.value = 0.25; slg.gain.value = 9; sl.connect(slg); slg.connect(so.frequency);
            const sflt = c.createBiquadFilter(); sflt.type = "lowpass"; sflt.frequency.value = 260; sg.gain.value = 0.07; so.connect(sflt); sflt.connect(sg); sg.connect(out); so.start(); sl.start(); H.nodes.push(so, sl);
            // roots: Mi menor frigio / tritono para o clima de horror
            const root = lab ? 41.2 : 36.7, scale = [0, 0, 12, 0, 1, 0, 12, 6, 0, 0, 12, 0, 13, 0, 6, 1];   // semitons sobre a tônica (16 passos)
            const sched = () => {
                if (this._ch !== H) return;
                const now = c.currentTime;
                while (H.next < now + 0.15) {
                    const st = H.step % 32, i16 = st % 16, bar = (st / 16) | 0, tt = H.next, th = H.threat;
                    // ostinato de baixo, galopante (serrilhada filtrada)
                    const semi = scale[i16] + (bar ? (i16 % 8 === 0 ? 1 : 0) : 0), f = root * Math.pow(2, semi / 12);
                    const bo = c.createOscillator(), bg = c.createGain(), bf = c.createBiquadFilter();
                    bo.type = "sawtooth"; bo.frequency.value = f * 2; bf.type = "lowpass"; bf.frequency.setValueAtTime(260 + th * 900, tt); bf.frequency.exponentialRampToValueAtTime(140, tt + sp * 0.9); bf.Q.value = 3;
                    bg.gain.setValueAtTime(0.0001, tt); bg.gain.linearRampToValueAtTime(0.16 + th * 0.08, tt + 0.008); bg.gain.exponentialRampToValueAtTime(0.0001, tt + sp * 0.95);
                    bo.connect(bf); bf.connect(bg); bg.connect(out); bo.start(tt); bo.stop(tt + sp);
                    // percussão: bumbo grave nos tempos, caixa metálica nos contratempos, hi-hat constante
                    if (i16 % 4 === 0) { this._ping(tt, 120, 0.22, 0.42, "sine", out, 38); this._burst(tt, 0.03, "lowpass", 900, 0.8, 0.12, out); }
                    if (i16 === 4 || i16 === 12) { this._burst(tt, 0.14, "bandpass", 1800, 0.9, 0.2, out); this._ping(tt, 190, 0.09, 0.12, "triangle", out, 110); }
                    if (i16 % 2 === 1) this._burst(tt, 0.03, "highpass", 6500, 0.7, 0.045 + th * 0.04, out);
                    if (i16 === 14 && bar === 1) { this._burst(tt, 0.1, "bandpass", 2200, 0.8, 0.12, out); this._burst(tt + sp * 0.5, 0.1, "bandpass", 2200, 0.8, 0.1, out); }
                    // golpe de metal/orquestra no início de cada 2 compassos + riser de tensão
                    if (st === 0) {
                        [root * 4, root * 4 * 1.414, root * 8].forEach((ff, k) => {
                            const o = c.createOscillator(), g = c.createGain(), fl = c.createBiquadFilter(); o.type = "sawtooth"; o.frequency.value = ff; fl.type = "lowpass"; fl.frequency.setValueAtTime(2200, tt); fl.frequency.exponentialRampToValueAtTime(300, tt + 1.1); fl.Q.value = 1.4;
                            g.gain.setValueAtTime(0.0001, tt); g.gain.linearRampToValueAtTime(0.09 - k * 0.015, tt + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, tt + 1.2); o.connect(fl); fl.connect(g); g.connect(out); o.start(tt); o.stop(tt + 1.25);
                        });
                        this._ping(tt, 70, 0.7, 0.35, "sine", out, 30); this._burst(tt, 0.7, "lowpass", 2500, 0.6, 0.1, out, 300);
                    }
                    if (st === 24) this._burst(tt, sp * 8, "bandpass", 500, 3, 0.1, out, 4500);   // riser
                    H.next += sp; H.step++;
                }
                // batimentos cardíacos + respiração: mais rápidos e mais altos conforme a ameaça
                H.threat += (H.tgt - H.threat) * 0.12;
                const th = H.threat;
                H.strings.gain.setTargetAtTime(0.03 + th * 0.07, now, 0.3); H.strLP.frequency.setTargetAtTime(700 + th * 1800, now, 0.3);
                if (H.nextHeart < now + 0.15) {
                    const tt = Math.max(now, H.nextHeart), v = H.slow ? 1 : 0.35 + th * 0.65, gap = H.slow ? 0.7 : 0.62 - th * 0.28;
                    this._ping(tt, 62, 0.2, 0.34 * v, "sine", this._out(), 30); this._ping(tt, 125, 0.08, 0.1 * v, "sine", this._out(), 60);
                    this._ping(tt + 0.17 + (1 - th) * 0.05, 54, 0.22, 0.26 * v, "sine", this._out(), 28);
                    H.nextHeart = tt + gap + 0.22;
                }
                if (H.nextBreath < now + 0.15) {   // inspira/expira ofegante; mais alto e mais curto quando a ameaça está perto
                    const tt = Math.max(now, H.nextBreath), dur = (0.5 - th * 0.22) * (H.slow ? 2.4 : 1), v = 0.025 + th * 0.12 + (H.slow ? 0.05 : 0), fl = c.createBiquadFilter(), g = c.createGain(), s = c.createBufferSource();
                    s.buffer = this._nbuf(); fl.type = "bandpass"; fl.Q.value = 0.9;
                    const f0 = H.breathIn ? 700 : 1000, f1 = H.breathIn ? 1500 : 500; fl.frequency.setValueAtTime(f0, tt); fl.frequency.linearRampToValueAtTime(f1, tt + dur);
                    g.gain.setValueAtTime(0.0001, tt); g.gain.linearRampToValueAtTime(v, tt + dur * 0.4); g.gain.linearRampToValueAtTime(0.0001, tt + dur);
                    s.connect(fl); fl.connect(g); g.connect(this._out()); s.start(tt, Math.random() * 1.4); s.stop(tt + dur + 0.05);
                    H.breathIn = !H.breathIn; H.nextBreath = tt + dur + 0.12 + (1 - th) * 0.3;
                }
            };
            H.timer = setInterval(sched, 30); sched();
            if (this._amb) { const a = this._amb.out.gain; a.cancelScheduledValues(t); a.setValueAtTime(a.value, t); a.linearRampToValueAtTime(0.35, t + 1); }
        }
        slowMo(on) {   // câmera lenta dramática: música abafada, coração grave e lento
            if (!this.ctx) return; const c = this.ctx, t = c.currentTime, H = this._ch;
            if (on) { this._ping(t, 95, 1.6, 0.5, "sine", this._out(), 26); this._burst(t, 1.3, "lowpass", 3200, 0.7, 0.14, this._out(), 110); }
            if (H) { H.slow = !!on; H.out.gain.cancelScheduledValues(t); H.out.gain.setTargetAtTime(on ? 0.2 : 1, t, 0.12); }
        }
        playWake() {   // os olhos da gosma se arregalam: swell grave + estalo úmido
            if (!this.ctx) return; const t = this.ctx.currentTime, g = this.ctx.createGain(); g.gain.value = 1; this._send(g, 0.6);
            this._ping(t, 70, 0.9, 0.16, "sawtooth", g, 46); this._burst(t, 0.5, "bandpass", 420, 2, 0.14, g, 180); this._burst(t + 0.05, 0.05, "lowpass", 1400, 1, 0.12, g);
        }
        playAchievement() {   // sino grave e duas notas ascendentes
            if (!this.ctx) return; const t = this.ctx.currentTime, g = this.ctx.createGain(); g.gain.value = 1; this._send(g, 0.7);
            [[392, 0], [523.3, 0.13], [784, 0.26]].forEach(([f, d]) => { this._ping(t + d, f, 1.1, 0.08, "sine", g); this._ping(t + d, f * 2.01, 0.6, 0.025, "triangle", g); });
            this._ping(t, 98, 0.7, 0.18, "sine", null, 60);
        }
        setThreat(v) { if (this._ch) this._ch.tgt = Math.max(0, Math.min(1, v)); }
        stopChase(fade) {
            const H = this._ch; if (!H) return; this._ch = null; clearInterval(H.timer);
            const c = this.ctx, t = c.currentTime, f = fade === undefined ? 1.5 : fade;
            H.out.gain.cancelScheduledValues(t); H.out.gain.setValueAtTime(H.out.gain.value, t); H.out.gain.linearRampToValueAtTime(0.0001, t + f);
            setTimeout(() => { H.nodes.forEach(n => { try { n.stop(); } catch (e) {} }); try { H.out.disconnect(); } catch (e) {} }, f * 1000 + 300);
            if (this._amb) { const a = this._amb.out.gain; a.cancelScheduledValues(t); a.setValueAtTime(a.value, t); a.linearRampToValueAtTime(1, t + 2); }
        }

        // ---------- MÚSICA DO MENU: suspense suave (drone grave, pad, notas esparsas, batimento distante) ----------
        startMenuMusic() {
            if (!this.ctx || this._mus) return;
            const c = this.ctx, t = c.currentTime, out = c.createGain(), vol = this.musicVol === undefined ? 0.6 : this.musicVol;
            out.gain.setValueAtTime(0.0001, t); out.gain.linearRampToValueAtTime(vol, t + 5);
            out.connect(this._bus()); const rv = c.createGain(); rv.gain.value = 0.55; out.connect(rv); rv.connect(this._rev());
            const M = this._mus = { out, nodes: [], timers: [] };
            const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 340; lp.Q.value = 0.6; lp.connect(out);
            const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 0.06; lg.gain.value = 140; lfo.connect(lg); lg.connect(lp.frequency); lfo.start(); M.nodes.push(lfo);
            [[55, "sine", 0.34], [55.4, "triangle", 0.16], [82.4, "sine", 0.12], [41.2, "sine", 0.22]].forEach(([f, ty, a]) => {   // drone
                const o = c.createOscillator(), g = c.createGain(); o.type = ty; o.frequency.value = f; g.gain.value = a * 0.55; o.connect(g); g.connect(lp); o.start(); M.nodes.push(o);
            });
            [[110, 0.05], [130.8, 0.04], [164.8, 0.035], [196, 0.025]].forEach(([f, a], i) => {   // pad com respiração lenta
                const o = c.createOscillator(), g = c.createGain(), l2 = c.createOscillator(), lg2 = c.createGain(), fl = c.createBiquadFilter();
                o.type = "sine"; o.frequency.value = f; fl.type = "lowpass"; fl.frequency.value = 700; g.gain.value = a; l2.frequency.value = 0.05 + i * 0.017; lg2.gain.value = a * 0.9; l2.connect(lg2); lg2.connect(g.gain);
                o.connect(fl); fl.connect(g); g.connect(out); o.start(); l2.start(); M.nodes.push(o, l2);
            });
            const ws = c.createBufferSource(), wb = c.createBiquadFilter(), wg = c.createGain();   // vento distante
            ws.buffer = this._nbuf(); ws.loop = true; wb.type = "bandpass"; wb.frequency.value = 240; wb.Q.value = 0.9; wg.gain.value = 0.02; ws.connect(wb); wb.connect(wg); wg.connect(out); ws.start(); M.nodes.push(ws);
            const beat = () => {   // batimento grave e distante (acompanha o pulso vermelho do menu, ~1,7 s)
                if (this._mus !== M) return; const tt = c.currentTime;
                this._ping(tt + 0.1, 58, 0.2, 0.16, "sine", out, 34); this._ping(tt + 0.44, 52, 0.22, 0.11, "sine", out, 32);
                M.timers.push(setTimeout(beat, 1700));
            };
            const pent = [196, 220, 261.6, 293.7, 329.6, 392];
            const note = () => {   // sinos/teclas esparsas, bem suaves
                if (this._mus !== M) return;
                const tt = c.currentTime, f = pent[(Math.random() * pent.length) | 0], o = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain(), fl = c.createBiquadFilter();
                o.type = "sine"; o.frequency.value = f; o2.type = "triangle"; o2.frequency.value = f * 2.003; fl.type = "lowpass"; fl.frequency.value = 1400;
                g.gain.setValueAtTime(0.0001, tt); g.gain.linearRampToValueAtTime(0.05, tt + 0.08); g.gain.exponentialRampToValueAtTime(0.0001, tt + 4.2);
                o.connect(fl); o2.connect(fl); fl.connect(g); g.connect(out); o.start(tt); o2.start(tt); o.stop(tt + 4.3); o2.stop(tt + 4.3);
                M.timers.push(setTimeout(note, 4200 + Math.random() * 5200));
            };
            M.timers.push(setTimeout(beat, 1200), setTimeout(note, 3500));
        }
        setMusicVolume(v) { this.musicVol = v; if (this._mus) this._mus.out.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1); }
        stopMenuMusic(fade) {
            const M = this._mus; if (!M) return; this._mus = null;
            const c = this.ctx, t = c.currentTime, f = fade || 1.5;
            M.out.gain.cancelScheduledValues(t); M.out.gain.setValueAtTime(M.out.gain.value, t); M.out.gain.linearRampToValueAtTime(0.0001, t + f);
            M.timers.forEach(clearTimeout);
            setTimeout(() => { M.nodes.forEach(n => { try { n.stop(); } catch (e) {} }); try { M.out.disconnect(); } catch (e) {} }, f * 1000 + 300);
        }

        playThud() {   // impacto grave e redondo (sem agudos)
            if (!this.ctx) return;
            const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter();
            o.type = "sine"; o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(24, t + 1.2);
            lp.type = "lowpass"; lp.frequency.value = 400;
            g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.01, t + 1.2);
            o.connect(lp); lp.connect(g); this._send(g, 0.25); o.start(t); o.stop(t + 1.25);
        }

        playMetalPounding() {   // pancada em chapa grossa: corpo grave + ressonância metálica abafada
            if (!this.ctx) return;
            const c = this.ctx, t = c.currentTime, g = c.createGain(); g.gain.value = 1; this._send(g, 0.4);
            this._ping(t, 120, 0.45, 0.6, "sine", g, 38);
            const o = c.createOscillator(), og = c.createGain(), lp = c.createBiquadFilter();
            o.type = "triangle"; o.frequency.setValueAtTime(190, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.5);
            lp.type = "lowpass"; lp.frequency.value = 700; og.gain.setValueAtTime(0.28, t); og.gain.exponentialRampToValueAtTime(0.005, t + 0.5);
            o.connect(lp); lp.connect(og); og.connect(g); o.start(t); o.stop(t + 0.55);
            this._burst(t, 0.12, "lowpass", 900, 0.7, 0.22, g);
        }

        playAlarm() {   // sirene suave: onda triangular filtrada
            if (!this.ctx) return;
            const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter();
            o.type = "triangle"; o.frequency.setValueAtTime(420, t); o.frequency.linearRampToValueAtTime(620, t + 0.5);
            lp.type = "lowpass"; lp.frequency.value = 900;
            g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.14, t + 0.05); g.gain.exponentialRampToValueAtTime(0.005, t + 0.5);
            o.connect(lp); lp.connect(g); this._send(g, 0.3); o.start(t); o.stop(t + 0.55);
        }

        playRoar() {   // rugido grave com ressonância de garganta (formantes baixos)
            if (!this.ctx) return;
            const c = this.ctx, t = c.currentTime;
            [[0, 1], [2.4, 0.7]].forEach(([det, v]) => {
                const o = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter(), bp = c.createBiquadFilter(), lfo = c.createOscillator(), lg = c.createGain();
                o.type = "sawtooth"; o.frequency.setValueAtTime(130 + det, t); o.frequency.exponentialRampToValueAtTime(34 + det, t + 1.6);
                lfo.frequency.value = 24; lg.gain.value = 10; lfo.connect(lg); lg.connect(o.frequency);
                lp.type = "lowpass"; lp.frequency.value = 520; bp.type = "peaking"; bp.frequency.value = 260; bp.gain.value = 7; bp.Q.value = 1.2;
                g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.5 * v, t + 0.12); g.gain.exponentialRampToValueAtTime(0.01, t + 1.6);
                o.connect(lp); lp.connect(bp); bp.connect(g); this._send(g, 0.4); o.start(t); lfo.start(t); o.stop(t + 1.65); lfo.stop(t + 1.65);
            });
            this._burst(t, 1.3, "lowpass", 420, 0.7, 0.16, this._bus(), 120);
        }

        playVentCrash() {   // 064 despenca do duto: metal pesado retorcendo, quebrando e batendo — tudo grave, sem estalos agudos
            if (!this.ctx) return;
            const c = this.ctx, t = c.currentTime, g = c.createGain(); g.gain.value = 1; this._send(g, 0.5);
            // 1) gemido de chapa dobrando: dois dentes de serra graves desafinados, filtrados e com trêmulo lento
            [[64, 31], [67.5, 33]].forEach(([f0, f1], i) => {
                const o = c.createOscillator(), og = c.createGain(), bp = c.createBiquadFilter(), lp = c.createBiquadFilter(), lfo = c.createOscillator(), lg = c.createGain();
                o.type = "sawtooth"; o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f0 * 1.5, t + 0.5); o.frequency.exponentialRampToValueAtTime(f1, t + 1.5);
                bp.type = "bandpass"; bp.frequency.setValueAtTime(180, t); bp.frequency.linearRampToValueAtTime(330, t + 0.6); bp.frequency.linearRampToValueAtTime(140, t + 1.5); bp.Q.value = 3.2;
                lp.type = "lowpass"; lp.frequency.value = 560; lfo.frequency.value = 9 + i * 2; lg.gain.value = 0.05; lfo.connect(lg); lg.connect(og.gain);
                og.gain.setValueAtTime(0.0001, t); og.gain.linearRampToValueAtTime(0.2, t + 0.25); og.gain.setValueAtTime(0.2, t + 0.9); og.gain.exponentialRampToValueAtTime(0.004, t + 1.6);
                o.connect(bp); bp.connect(lp); lp.connect(og); og.connect(g); o.start(t); lfo.start(t); o.stop(t + 1.7); lfo.stop(t + 1.7);
            });
            // 2) metal quebrando: rajadas graves de ruído (lowpass) em intervalos irregulares
            for (let i = 0; i < 9; i++) this._burst(t + 0.15 + i * 0.1 + Math.random() * 0.06, 0.08 + Math.random() * 0.2, "lowpass", 500 + Math.random() * 700, 0.9, 0.2 + Math.random() * 0.14, g);
            // 3) queda e impacto no piso
            this._ping(t + 0.92, 95, 0.55, 0.55, "sine", g, 30); this._burst(t + 0.92, 0.35, "lowpass", 360, 0.8, 0.4, g, 90);
            this._ping(t + 1.12, 70, 0.4, 0.3, "triangle", g, 36);
            // 4) rugido grave logo em seguida
            setTimeout(() => this.playRoar(), 1250);
        }

        // ---------- ESPINGARDA / SUSTOS: áudio procedural (sem arquivos externos) ----------
        _out() {   // saída mestre: volume + prateleira que corta agudos + passa-baixa (acaba com a estridência)
            if (this._outNode) return this._outNode;
            const c = this.ctx, vol = c.createGain(), sh = c.createBiquadFilter(), lp = c.createBiquadFilter();
            vol.gain.value = this.volume === undefined ? 0.9 : this.volume;
            sh.type = "highshelf"; sh.frequency.value = 2200; sh.gain.value = -6;
            lp.type = "lowpass"; lp.frequency.value = 4600; lp.Q.value = 0.5;
            vol.connect(sh); sh.connect(lp); lp.connect(c.destination); this._outNode = vol; return vol;
        }
        setVolume(v) { this.volume = v; if (this._outNode) this._outNode.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }
        _bus() {   // compressor mestre: tiro forte sem estourar
            if (this._busNode) return this._busNode;
            const c = this.ctx, comp = c.createDynamicsCompressor();
            comp.threshold.value = -14; comp.knee.value = 8; comp.ratio.value = 6; comp.attack.value = 0.002; comp.release.value = 0.22;
            comp.connect(this._out()); this._busNode = comp; return comp;
        }
        _rev() {   // reverb de bunker: resposta ao impulso sintetizada (~1.9 s, cauda escura)
            if (this._revNode) return this._revNode;
            const c = this.ctx, len = (c.sampleRate * 1.9) | 0, ir = c.createBuffer(2, len, c.sampleRate);
            for (let ch = 0; ch < 2; ch++) {
                const d = ir.getChannelData(ch); let lp = 0;
                for (let i = 0; i < len; i++) { lp += ((Math.random() * 2 - 1) - lp) * 0.35; d[i] = lp * Math.pow(1 - i / len, 2.8) * 3; }
            }
            const conv = c.createConvolver(); conv.buffer = ir;
            const wet = c.createGain(); wet.gain.value = 0.7; conv.connect(wet); wet.connect(this._bus());
            this._revNode = conv; return conv;
        }
        _send(node, amt) {   // sinal seco + envio para o reverb
            node.connect(this._bus());
            const s = this.ctx.createGain(); s.gain.value = amt; node.connect(s); s.connect(this._rev());
        }
        playShotgun() {
            if (!this.ctx) return;
            const c = this.ctx, t = c.currentTime;
            // 1) estampido: ruído branco com passa-baixa despencando (9 kHz → 220 Hz)
            const len = (c.sampleRate * 0.8) | 0, nb = c.createBuffer(1, len, c.sampleRate), d = nb.getChannelData(0);
            for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
            const n = c.createBufferSource(); n.buffer = nb;
            const lp = c.createBiquadFilter(); lp.type = "lowpass";
            lp.frequency.setValueAtTime(4200, t); lp.frequency.exponentialRampToValueAtTime(200, t + 0.4);
            const ng = c.createGain(); ng.gain.setValueAtTime(1.5, t); ng.gain.exponentialRampToValueAtTime(0.01, t + 0.6);
            n.connect(lp); lp.connect(ng); this._send(ng, 0.9); n.start(t); n.stop(t + 0.8);
            // 2) corpo grave: seno com queda rápida de frequência (soco no peito)
            const o = c.createOscillator(), og = c.createGain();
            o.type = "sine"; o.frequency.setValueAtTime(170, t); o.frequency.exponentialRampToValueAtTime(34, t + 0.5);
            og.gain.setValueAtTime(1.4, t); og.gain.exponentialRampToValueAtTime(0.01, t + 0.6);
            o.connect(og); this._send(og, 0.6); o.start(t); o.stop(t + 0.65);
            // 3) estalo agudo inicial
            const o2 = c.createOscillator(), g2 = c.createGain();
            o2.type = "triangle"; o2.frequency.setValueAtTime(420, t); o2.frequency.exponentialRampToValueAtTime(60, t + 0.12);
            g2.gain.setValueAtTime(0.35, t); g2.gain.exponentialRampToValueAtTime(0.01, t + 0.14);
            o2.connect(g2); this._send(g2, 0.9); o2.start(t); o2.stop(t + 0.16);
        }
        playShell() {   // cápsula metálica quicando no concreto: estalos agudos sequenciais
            if (!this.ctx) return;
            const c = this.ctx, t0 = c.currentTime;
            [[0, 3400, 0.34], [0.075, 2650, 0.22], [0.135, 3900, 0.13], [0.185, 3150, 0.07]].forEach(([when, f, v]) => {
                const t = t0 + when;
                for (const k of [1, 2.76]) {   // parciais inarmônicas = timbre de metal
                    const o = c.createOscillator(), g = c.createGain(), hp = c.createBiquadFilter();
                    o.type = "sine"; o.frequency.value = f * 0.55 * k; hp.type = "lowpass"; hp.frequency.value = 2600;
                    g.gain.setValueAtTime(v * (k === 1 ? 1 : 0.5) * 0.3, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
                    o.connect(hp); hp.connect(g); this._send(g, 0.35); o.start(t); o.stop(t + 0.12);
                }
            });
        }
        playDryFire() {   // gatilho sem munição
            if (!this.ctx) return;
            const c = this.ctx;
            [0, 0.09].forEach(w => {
                const t = c.currentTime + w, o = c.createOscillator(), g = c.createGain();
                o.type = "triangle"; o.frequency.setValueAtTime(520, t); o.frequency.exponentialRampToValueAtTime(190, t + 0.04);
                g.gain.setValueAtTime(0.22, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
                o.connect(g); g.connect(this._bus()); o.start(t); o.stop(t + 0.06);
            });
        }
        playPain() {   // monstro atingido
            if (!this.ctx) return;
            const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain(), lfo = c.createOscillator(), lg = c.createGain();
            o.type = "triangle"; o.frequency.setValueAtTime(420, t); o.frequency.exponentialRampToValueAtTime(100, t + 0.9);
            lfo.frequency.value = 38; lg.gain.value = 60; lfo.connect(lg); lg.connect(o.frequency);
            g.gain.setValueAtTime(0.7, t); g.gain.exponentialRampToValueAtTime(0.01, t + 0.95);
            o.connect(g); this._send(g, 0.7); o.start(t); lfo.start(t); o.stop(t + 1); lfo.stop(t + 1);
        }
        playGrowl() {   // rosnado grave, encorpado e aterrorizante: sub-grave modulado + garganta distorcida + ruído rouco
            if (!this.ctx) return;
            const c = this.ctx, t = c.currentTime, dur = 2.6, out = c.createGain(); out.gain.value = 1; this._send(out, 0.5);
            const sh = c.createWaveShaper(), cv = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 128 - 1; cv[i] = Math.tanh(x * 3.2); } sh.curve = cv;
            const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.setValueAtTime(900, t); lp.frequency.exponentialRampToValueAtTime(180, t + dur); lp.Q.value = 2.5; sh.connect(lp);
            const am = c.createGain(); am.gain.value = 0.6; const al = c.createOscillator(), alg = c.createGain(); al.frequency.setValueAtTime(18, t); al.frequency.linearRampToValueAtTime(30, t + dur); alg.gain.value = 0.4; al.connect(alg); alg.connect(am.gain); al.start(t); al.stop(t + dur);
            lp.connect(am); const env = c.createGain(); env.gain.setValueAtTime(0.0001, t); env.gain.linearRampToValueAtTime(1, t + 0.18); env.gain.setValueAtTime(1, t + dur * 0.55); env.gain.exponentialRampToValueAtTime(0.001, t + dur); am.connect(env); env.connect(out);
            [[78, 52, "sawtooth", 0.5], [39, 31, "sine", 0.9], [118, 70, "sawtooth", 0.28], [157, 85, "square", 0.12]].forEach(([f0, f1, ty, v]) => {
                const o = c.createOscillator(), g = c.createGain(); o.type = ty; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur); g.gain.value = v; o.connect(g); g.connect(sh); o.start(t); o.stop(t + dur + 0.05);
            });
            const n = c.createBufferSource(), nb = c.createBiquadFilter(), ng = c.createGain(); n.buffer = this._nbuf(); n.loop = true; nb.type = "bandpass"; nb.frequency.setValueAtTime(420, t); nb.frequency.exponentialRampToValueAtTime(140, t + dur); nb.Q.value = 1.2;
            ng.gain.setValueAtTime(0.0001, t); ng.gain.linearRampToValueAtTime(0.5, t + 0.25); ng.gain.exponentialRampToValueAtTime(0.002, t + dur); n.connect(nb); nb.connect(ng); ng.connect(out); n.start(t); n.stop(t + dur + 0.05);
            this._ping(t, 55, 0.5, 0.5, "sine", out, 24);
        }
        playBigRoar() {   // rugido do jumpscare: camadas graves + ruído, com reverb
            if (!this.ctx) return;
            const c = this.ctx, t = c.currentTime;
            [[170, 26, "sawtooth", 0.7, 2.2], [95, 22, "triangle", 0.6, 2.2], [260, 50, "triangle", 0.3, 1.4]].forEach(([f0, f1, type, v, dur]) => {
                const o = c.createOscillator(), g = c.createGain(), lfo = c.createOscillator(), lg = c.createGain();
                o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
                lfo.frequency.value = 26; lg.gain.value = f0 * 0.12; lfo.connect(lg); lg.connect(o.frequency);
                g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.01, t + dur);
                o.connect(g); this._send(g, 0.55); o.start(t); lfo.start(t); o.stop(t + dur); lfo.stop(t + dur);
            });
            const len = (c.sampleRate * 1.2) | 0, nb = c.createBuffer(1, len, c.sampleRate), d = nb.getChannelData(0);
            for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
            const n = c.createBufferSource(), bp = c.createBiquadFilter(), ng = c.createGain();
            n.buffer = nb; bp.type = "bandpass"; bp.Q.value = 0.8; bp.frequency.setValueAtTime(700, t); bp.frequency.exponentialRampToValueAtTime(200, t + 1.1);
            ng.gain.setValueAtTime(0.7, t); ng.gain.exponentialRampToValueAtTime(0.01, t + 1.2);
            n.connect(bp); bp.connect(ng); this._send(ng, 0.5); n.start(t); n.stop(t + 1.2);
        }
        playEnding() {   // trilha da cutscene 3D (~38 s): luz que se abre, cachoeira, vento, acordes serenos, sinos e pássaros — tudo procedural
            if (!this.ctx) return;
            const c = this.ctx, t0 = c.currentTime + 0.1, bus = this._bus(), rv = this._rev(), END = 38;
            // brilho ascendente quando a porta se abre
            [261.6, 392, 523.3, 784].forEach((f, i) => {
                const o = c.createOscillator(), g = c.createGain(); o.type = "sine"; o.frequency.value = f;
                g.gain.setValueAtTime(0.0001, t0 + i * 0.25); g.gain.linearRampToValueAtTime(0.05, t0 + 1.8 + i * 0.25); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 5.5);
                o.connect(g); g.connect(bus); g.connect(rv); o.start(t0 + i * 0.25); o.stop(t0 + 5.6);
            });
            // cachoeira: ruído filtrado com fade-in lento
            const n = c.createBufferSource(), lp = c.createBiquadFilter(), hp = c.createBiquadFilter(), ng = c.createGain();
            n.buffer = this._nbuf(); n.loop = true; lp.type = "lowpass"; lp.frequency.value = 1300; hp.type = "highpass"; hp.frequency.value = 180;
            ng.gain.setValueAtTime(0.0001, t0 + 2.5); ng.gain.linearRampToValueAtTime(0.075, t0 + 12); ng.gain.setValueAtTime(0.07, t0 + END - 3); ng.gain.linearRampToValueAtTime(0.045, t0 + END);
            n.connect(lp); lp.connect(hp); hp.connect(ng); ng.connect(bus); n.start(t0 + 2.5); n.stop(t0 + END + 0.5);
            // vento suave entre as árvores
            const w = c.createBufferSource(), wb = c.createBiquadFilter(), wg = c.createGain(), wl = c.createOscillator(), wlg = c.createGain();
            w.buffer = this._nbuf(); w.loop = true; wb.type = "bandpass"; wb.frequency.value = 520; wb.Q.value = 0.8; wg.gain.value = 0.028;
            wl.frequency.value = 0.12; wlg.gain.value = 0.02; wl.connect(wlg); wlg.connect(wg.gain); w.connect(wb); wb.connect(wg); wg.connect(bus); w.start(t0 + 1); w.stop(t0 + END); wl.start(t0 + 1); wl.stop(t0 + END);
            // acordes: C – G – Am – F (duas voltas), ataque lento
            const ch = [[130.8, 261.6, 329.6, 392, 493.9], [98, 196, 293.7, 392, 493.9], [110, 220, 261.6, 329.6, 392], [87.3, 174.6, 261.6, 349.2, 440]];
            for (let k = 0; k < 8; k++) {
                const s = t0 + 2.4 + k * 4.4;
                ch[k % 4].forEach((f, i) => {
                    const o = c.createOscillator(), g = c.createGain(), fl = c.createBiquadFilter();
                    o.type = i === 0 ? "sine" : "triangle"; o.frequency.value = f; fl.type = "lowpass"; fl.frequency.value = 1800;
                    g.gain.setValueAtTime(0.0001, s); g.gain.linearRampToValueAtTime(i === 0 ? 0.15 : 0.065, s + 1.6); g.gain.linearRampToValueAtTime(0.0001, s + 5.0);
                    o.connect(fl); fl.connect(g); g.connect(bus); g.connect(rv); o.start(s); o.stop(s + 5.1);
                });
            }
            // sinos de contemplação (pentatônica) e pássaros
            const pent = [659.3, 784, 880, 987.8, 1174.7];
            for (let tt = 12; tt < END - 4; tt += 2.2 + Math.random() * 1.6) {
                const s = t0 + tt, f = pent[(Math.random() * pent.length) | 0], o = c.createOscillator(), g = c.createGain();
                o.type = "sine"; o.frequency.value = f; g.gain.setValueAtTime(0.0001, s); g.gain.linearRampToValueAtTime(0.045, s + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, s + 2.4);
                o.connect(g); g.connect(bus); g.connect(rv); o.start(s); o.stop(s + 2.5);
            }
            for (let b = 0; b < 22; b++) {
                const base = t0 + 3 + b * 1.5 + Math.random() * 0.8;
                for (let k = 0; k < 2 + ((Math.random() * 3) | 0); k++) {
                    const s = base + k * 0.17, o = c.createOscillator(), g = c.createGain(), f0 = 2200 + Math.random() * 1500;
                    o.type = "sine"; o.frequency.setValueAtTime(f0, s); o.frequency.exponentialRampToValueAtTime(f0 * 1.45, s + 0.05); o.frequency.exponentialRampToValueAtTime(f0 * 0.9, s + 0.11);
                    g.gain.setValueAtTime(0.0001, s); g.gain.linearRampToValueAtTime(0.045, s + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.13);
                    o.connect(g); g.connect(bus); o.start(s); o.stop(s + 0.15);
                }
            }
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
    const $ = id => document.getElementById(id);
    const ammoHud = $("ammoHud"), ammoCount = $("ammoCount");

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
    // --- estado: cofre/arma, laboratório, perseguição do Espécime 064 ---
    let hasShotgun = false, shells = 0, safeOpened = false;
    let labUnlocked = false, emergency = false, clawShown = false;
    let hasKey = false, keyOnFloor = false, keyRoom = 0, keyX = 0, keyY = 12;
    let pendingLabEvent = false, labEventArmed = false, labEventRunning = false, labFailed = false, endShown = false, exitHint = false;
    const notesRead = [false, false, false];
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
    const PREFS = { cam: 1, joy: 1 };   // sensibilidade da câmera / do joystick (opções do menu)
    function haptic(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} }   // vibração tátil (celulares)
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
    window.addEventListener("keydown", e => {
        const k = e.key.toLowerCase();
        if ((k === "e" || k === "enter") && !e.repeat && activeAction && canMove && !in3DChase) activeAction();
        if ((k === "f" || k === " ") && !e.repeat && !in3DChase) fireShotgun();
    });
    window.addEventListener("blur", () => { for (const k in keys) keys[k] = false; btn.run = btn.look = btn.sprint = false; });

    // Vetor de movimento combinado (teclado + joystick). chase=true: S/↓ é "olhar para trás", não recuar.
    function getAxis(chase) {
        let x = Number(keys.d || keys.arrowright) - Number(keys.a || keys.arrowleft) + Math.max(-1, Math.min(1, stick.x * PREFS.joy));
        let y = Number(keys.w || keys.arrowup) - (chase ? 0 : Number(keys.s || keys.arrowdown)) + Math.max(-1, Math.min(1, stick.y * PREFS.joy));
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
        else { const k = (m - STICK.dead) / (1 - STICK.dead) / m; nx *= k; ny *= k; const m2 = Math.min(1, Math.hypot(nx, ny)); if (m2 > 0) { const c = Math.pow(m2, 1.3) / m2; nx *= c; ny *= c; } }
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
    let slideBuf = 0;
    let jumpBuf = 0;   // toque rápido no PULAR fica "guardado" por 0,18 s (não perde o pulo entre dois quadros)
    $("btnRun").addEventListener("pointerdown", () => { jumpBuf = 0.18; });
    $("btnLook").addEventListener("pointerdown", () => { slideBuf = 0.18; });
    holdButton("btnSprint", "sprint");
    holdButton("btnLook", "look");
    // botão ATIRAR (touch) e botão na tela (PC) + clique do mouse durante a perseguição
    $("btnFire").addEventListener("pointerdown", e => { e.preventDefault(); sound.init(); fireShotgun(); });
    $("fireBtnPc").addEventListener("click", () => fireShotgun());
    game.addEventListener("pointerdown", e => { if (e.pointerType === "mouse" && e.button === 0 && !e.target.closest("button, .modal-overlay, .paper-document")) fireShotgun(); });
    btnAct.addEventListener("pointerdown", e => { e.preventDefault(); sound.init(); if (activeAction) activeAction(); });

    // --- Sem zoom por duplo toque / pinça / scroll elástico ---
    document.addEventListener("touchmove", e => { if (!e.target.closest || !e.target.closest(".paper-body-text, .cctv-box")) e.preventDefault(); }, { passive: false });
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
            let currentSpeed = (currentRoom === 2) ? 0.17 : 0.125;
            const ax = cine.on ? cineAxis() : getAxis(false);
            if (cine.on) currentSpeed = 0.36;   // cutscene: corrida em altíssima velocidade
            else if (specChase.active) currentSpeed = 0.205;   // corrida de emergência
            else if ((keys.shift || btn.sprint) && ax.m > 0.1) currentSpeed *= 1.7;   // SHIFT / botão CORRER
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
                if (stepCounter % (cine.on ? 11 : specChase.active ? 16 : (keys.shift || btn.sprint) ? 17 : currentRoom === 2 ? 20 : 28) === 0) sound.playStep(currentRoom === 3 ? "pad" : (currentRoom === 8 || currentRoom === 7) ? "metal" : "concrete", specChase.active || keys.shift || btn.sprint);
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

            if (currentRoom === 3) { updateGooEyes(); gooWakeCheck(); }
            if (cine.on) { hideAction(); cineFx(); } else checkInteractions();
        } else if (!in3DChase) {
            vx = vy = 0;
            player.classList.remove("is-moving");
        }

        updateSpec(); applyShake();
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
        if (keyOnFloor && keyRoom === currentRoom && isNear(keyX, keyY, 7)) { setAction("PEGAR CHAVE DA SAÍDA", pickKey); return; }

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
        else if (currentRoom === 3) {   // SALA DE CONTENÇÃO (branca, cela arrombada ao centro)
            if (isNear(8, 14, 6.5)) setAction("VOLTAR AO CORREDOR", () => enterRoom(4, 14, 12, "Você recua para a bifurcação."));
            else if (!safeOpened && isNear(50, 14, 9.0)) setAction("ABRIR COFRE DA CELA", openSafe);
            else if (isNear(24, 12, 6.0)) setAction("EXAMINAR RASTRO DE SANGUE", () => showStory("O rastro de arrasto sai da cela arrombada. Algo rastejou por aqui."));
            else if (isNear(36, 14, 4.5) || isNear(64, 14, 4.5)) setAction("EXAMINAR CELA ARROMBADA", inspectContainmentCell);
            else if (isNear(80, 11, 5.0)) setAction("EXAMINAR CAMISA DE FORÇA", inspectJacket);
            else hideAction();
        }
        else if (currentRoom === 4) {   // BIFURCAÇÃO
            if (isNear(10, 15, 6.5)) setAction("ENTRAR NA SALA DE CONTENÇÃO", () => { enterRoom(3, 11, 12, "Paredes brancas acolchoadas, riscadas de vermelho. No centro, a cela arrombada... e as manchas negras parecem te observar."); });
            else if (isNear(86, 15, 7.0)) setAction("SEGUIR PELO CAMINHO PRINCIPAL", () => enterRoom(5, 8, 12, "O chão está tomado por uma substância vermelha, grossa e ainda fresca..."));
            else hideAction();
        }
        else if (currentRoom === 5) {   // CORREDOR VERMELHO
            if (isNear(8, 15, 6.5)) setAction("VOLTAR À BIFURCAÇÃO", () => enterRoom(4, 80, 12));
            else if (isNear(26, 15, 6.5)) setAction("ENTRAR: LABORATÓRIO DE PESQUISAS", () => labUnlocked ? enterRoom(8, 12, 12, "Cheiro de formol e metal. Há papéis brilhando sobre as bancadas.") : (sound.playLocked(), showStory("Trancada. A tranca eletrônica é controlada pela Sala de Vigilância.")));
            else if (isNear(52, 15, 6.5)) setAction("ENTRAR: SALA DE VIGILÂNCIA", () => { $("survDoor").classList.add("door-open"); enterRoom(7, 12, 12, "Monitores zumbindo no escuro. Um deles mostra uma gravação..."); });
            else if (isNear(76, 15, 8.0)) setAction("SUBIR ESCADA: PORTA DE SAÍDA", () => enterRoom(6, 12, 12, "Você sobe os degraus devagar. O ar aqui é mais frio."));
            else hideAction();
        }
        else if (currentRoom === 7) {   // VIGILÂNCIA
            if (isNear(8, 15, 6.5)) setAction("SAIR PARA O CORREDOR", () => enterRoom(5, 52, 12));
            else if (isNear(27, 15, 8.0)) setAction("ASSISTIR GRAVAÇÃO (CAM 07)", openCctv);
            else if (isNear(58, 15, 7.0)) setAction("EXAMINAR CÂMERAS DO COMPLEXO", () => showStory("Térreo, corredor vermelho, Porta de Saída... em todas as imagens algo preto se esgueira fora das luzes."));
            else if (isNear(78, 15, 7.0)) setAction("OPERAR PAINEL DE CONTROLE", operatePanel);
            else hideAction();
        }
        else if (currentRoom === 8) {   // LABORATÓRIO
            if (isNear(8, 15, 6.5)) setAction("SAIR PARA O CORREDOR", () => enterRoom(5, 26, 12));
            else if (isNear(24, 15, 7.0)) setAction("EXAMINAR CÁPSULA 064", () => showStory("Vidro estilhaçado para FORA. A placa diz: ESPÉCIME 064. Vazia."));
            else if (!specChase.active && isNear(45, 15, 6.0)) setAction("LER ANOTAÇÃO — RELATÓRIO A", () => readNote(0));
            else if (!specChase.active && isNear(61, 15, 6.0)) setAction("LER ANOTAÇÃO — RELATÓRIO B", () => readNote(1));
            else if (!specChase.active && isNear(77, 15, 6.0)) setAction("LER ANOTAÇÃO — URGENTE", () => readNote(2));
            else hideAction();
        }
        else if (currentRoom === 6) {   // PORTA DE SAÍDA
            if (isNear(12, 15, 8.0)) setAction("DESCER ESCADA", () => enterRoom(5, 74, 12));
            else if (isNear(44, 15, 7.0)) setAction("EXAMINAR QUADRO DE AVISOS", () => showStory("Mapa riscado de vermelho: 'CONTENÇÃO → TÉRREO. SAÍDA DE EMERGÊNCIA → PORTA DE SAÍDA.'"));
            else if (isNear(88, 15, 7.0)) setAction(hasKey ? "DESTRANCAR PORTA DE SAÍDA" : "EXAMINAR PORTA DE SAÍDA", openDirectorDoor);
            else hideAction();
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
    function openSurveillance() {
        $("survDoor").classList.add("door-open"); sound.playDoor();
        openGenericDocument("SALA DE VIGILÂNCIA", "Dezenas de monitores mortos. Só um ainda liga:\n\nCAM 07 — CELA DE CONTENÇÃO\nA cela está vazia há 3 dias.\nO registro de som mostra que a criatura reage a QUALQUER barulho — passos, vozes, até respiração pesada.");
    }
    function openSafe() {
        safeOpened = true; hasShotgun = true; shells = 2;
        $("cellSafe").classList.add("open"); sound.playUnlock(); setTimeout(() => sound.playDoor(), 700); setAmmo();
        openGenericDocument("COFRE ABERTO", "O cofre estava preso entre os escombros da cela arrombada. A gosma negra ao redor parece observar cada movimento seu.\n\nDentro: uma ESPINGARDA CALIBRE 12 e 2 CARTUCHOS.\n\n[ESPINGARDA ADQUIRIDA — MUNIÇÃO: 2]\n\nDica: use [F], [ESPAÇO] ou o botão ATIRAR quando algo chegar perto.");
        setTimeout(() => $("cellSafe").classList.add("taken"), 400);
    }
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
    // ==========================================
    // MENU PRINCIPAL IMERSIVO: corredor 3D do bunker (perspectiva real), luz de emergência pulsante, poeira, áudio e opções
    // ==========================================
    const MenuFx = (function () {
        const cv = $("menuCanvas"), g = cv.getContext("2d", { alpha: false });
        const SEG = 3, N = 20, HW = 2.0, HT = 3.2;
        let W = 640, H = 360, raf = 0, run = false, t0 = 0, last = 0, z0 = 0, focal = 400;
        const dust = []; for (let i = 0; i < 46; i++) dust.push({ x: (Math.random() - 0.5) * 3.6, y: Math.random() * 3, z: 1 + Math.random() * 22, s: 0.05 + Math.random() * 0.12 });
        function resize() {
            const cw = cv.clientWidth || window.innerWidth, ch = cv.clientHeight || window.innerHeight, q = Math.min(1, 1000 / cw) * (isTouch ? 0.8 : 1);
            W = cv.width = Math.max(320, Math.round(cw * q)); H = cv.height = Math.max(180, Math.round(ch * q)); focal = H * 0.95;
        }
        const mix = (a, b, f) => a + (b - a) * f;
        function frame(now) {
            if (!run) return; raf = requestAnimationFrame(frame);
            const dt = Math.min(0.1, (now - last) / 1000); last = now; const t = (now - t0) / 1000; z0 += dt * 0.5;
            const ph = t % 1.7, beat = Math.max(Math.exp(-Math.pow(ph - 0.17, 2) / 0.012), 0.6 * Math.exp(-Math.pow(ph - 0.51, 2) / 0.016)), flick = (Math.sin(t * 31) > 0.97 && Math.sin(t * 2.3) > 0.7) ? 0.5 : 1;
            const L0 = (0.22 + 0.78 * beat) * flick;
            const camx = Math.sin(t * 0.27) * 0.2, camy = 1.55 + Math.sin(t * 0.9) * 0.025, ox = W / 2 + Math.sin(t * 0.19) * W * 0.014, oy = H * 0.5;
            const px = (x, z) => ox + (x - camx) / z * focal, py = (y, z) => oy - (y - camy) / z * focal;
            g.fillStyle = "#050103"; g.fillRect(0, 0, W, H);
            const base = Math.floor(z0 / SEG);
            const poly = (pts, col, a) => { g.fillStyle = col; if (a !== undefined) g.globalAlpha = a; g.beginPath(); g.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]); g.closePath(); g.fill(); if (a !== undefined) g.globalAlpha = 1; };
            const shade = (c, light, ze) => { const f = 1 - Math.exp(-ze * 0.055), r = c[0] * 0.5 + 255 * light * 0.62, gg = c[1] * 0.46 + 34 * light * 0.5, b = c[2] * 0.5 + 28 * light * 0.5; return "rgb(" + ((mix(r, 8, f)) | 0) + "," + ((mix(gg, 2, f)) | 0) + "," + ((mix(b, 4, f)) | 0) + ")"; };
            const quadX = (x, y0, y1, za, zb, col) => poly([px(x, za), py(y0, za), px(x, za), py(y1, za), px(x, zb), py(y1, zb), px(x, zb), py(y0, zb)], col);   // parede (plano x = const)
            const quadY = (y, x0, x1, za, zb, col) => poly([px(x0, za), py(y, za), px(x1, za), py(y, za), px(x1, zb), py(y, zb), px(x0, zb), py(y, zb)], col);   // piso/teto
            const lamps = [];
            for (let i = base + N; i >= base; i--) {
                let zs = i * SEG - z0, ze = zs + SEG; if (ze < 0.25) continue; const zsRaw = zs; if (zs < 0.25) zs = 0.25;
                const zc = (zs + ze) / 2, wcenter = i * SEG + SEG / 2;
                let L = 0; for (let j = i - 3; j <= i + 3; j++) if (j % 2 === 0) { const lz = j * SEG + SEG / 2, d = (wcenter - lz) / 3.2; L += Math.exp(-d * d) * L0; }
                L = Math.min(1.2, L);
                quadY(HT, -HW, HW, zs, ze, shade([34, 36, 40], L * 0.8, ze));             // teto
                quadY(0, -HW, HW, zs, ze, shade([42, 44, 48], L, ze));                     // piso
                quadX(-HW, 0, HT, zs, ze, shade([62, 66, 72], L, ze)); quadX(HW, 0, HT, zs, ze, shade([58, 62, 68], L, ze));   // paredes
                quadX(-HW + 0.01, 0.55, 2.35, Math.max(zs, zsRaw + 0.35), ze - 0.35, shade([40, 44, 50], L * 0.7, ze));        // painéis
                quadX(HW - 0.01, 0.55, 2.35, Math.max(zs, zsRaw + 0.35), ze - 0.35, shade([38, 42, 48], L * 0.7, ze));
                quadY(HT - 0.02, -1.3, -1.05, zs, ze, shade([22, 24, 28], L * 0.5, ze)); quadY(HT - 0.02, 1.05, 1.3, zs, ze, shade([22, 24, 28], L * 0.5, ze));   // dutos no teto
                quadX(-HW + 0.02, 0, 0.14, zs, ze, shade([160, 130, 20], L * 0.4, ze)); quadX(HW - 0.02, 0, 0.14, zs, ze, shade([160, 130, 20], L * 0.4, ze));    // faixa de alerta no rodapé
                if (i % 4 === 1 && zsRaw + 2.4 > 0.3) { const a = Math.max(0.3, zsRaw + 0.5), b = zsRaw + 2.4; quadX(-HW + 0.03, 0, 2.3, a, b, shade([24, 26, 30], L * 0.5, ze)); poly([px(-HW + 0.04, a + 0.15), py(2.0, a + 0.15), px(-HW + 0.04, a + 0.15), py(2.12, a + 0.15), px(-HW + 0.04, a + 0.3), py(2.12, a + 0.3), px(-HW + 0.04, a + 0.3), py(2.0, a + 0.3)], "rgba(255,40,30," + (0.35 + 0.65 * L0) + ")"); }
                if (zsRaw > 0.3) {   // vigas (moldura) no início do segmento, voltadas para a câmera
                    const c = shade([20, 22, 26], L * 0.6, zsRaw), t2 = 0.18;
                    poly([px(-HW, zsRaw), py(HT, zsRaw), px(HW, zsRaw), py(HT, zsRaw), px(HW, zsRaw), py(HT - t2, zsRaw), px(-HW, zsRaw), py(HT - t2, zsRaw)], c);
                    poly([px(-HW, zsRaw), py(HT, zsRaw), px(-HW + t2, zsRaw), py(HT, zsRaw), px(-HW + t2, zsRaw), py(0, zsRaw), px(-HW, zsRaw), py(0, zsRaw)], c);
                    poly([px(HW - t2, zsRaw), py(HT, zsRaw), px(HW, zsRaw), py(HT, zsRaw), px(HW, zsRaw), py(0, zsRaw), px(HW - t2, zsRaw), py(0, zsRaw)], c);
                }
                if (i % 2 === 0) lamps.push({ z: i * SEG + SEG / 2 - z0 });
                if (i === base + N) { const zf = ze; poly([px(-HW, zf), py(HT, zf), px(HW, zf), py(HT, zf), px(HW, zf), py(0, zf), px(-HW, zf), py(0, zf)], shade([30, 30, 34], L, zf)); }   // fundo do corredor (porta grande)
            }
            // brilho vermelho das lâmpadas de emergência (aditivo)
            g.globalCompositeOperation = "lighter";
            for (const lp of lamps) if (lp.z > 0.6) {
                const x = px(0, lp.z), y = py(HT - 0.12, lp.z), r = focal * 1.5 / lp.z, f = 1 - Math.exp(-lp.z * 0.06), al = L0 * (1 - f) * 0.55;
                const rg = g.createRadialGradient(x, y, 0, x, y, r); rg.addColorStop(0, "rgba(255,70,50," + al + ")"); rg.addColorStop(0.35, "rgba(255,20,10," + al * 0.35 + ")"); rg.addColorStop(1, "rgba(255,0,0,0)"); g.fillStyle = rg; g.fillRect(x - r, y - r, r * 2, r * 2);
                g.fillStyle = "rgba(255,200,190," + Math.min(1, al * 1.4) + ")"; g.beginPath(); g.ellipse(x, y, Math.max(1.5, r * 0.035), Math.max(1, r * 0.018), 0, 0, 6.2832); g.fill();
            }
            for (const d of dust) {   // poeira flutuando na luz
                d.z -= dt * 0.5; d.y += Math.sin(t * 0.6 + d.x * 3) * dt * 0.05; if (d.z < 0.6) { d.z = 22; d.x = (Math.random() - 0.5) * 3.6; d.y = Math.random() * 3; }
                const x = px(d.x, d.z), y = py(d.y, d.z), s = Math.max(1, d.s * focal / d.z * 0.12); g.fillStyle = "rgba(255,150,130," + (0.35 * L0 + 0.08) + ")"; g.fillRect(x, y, s, s);
            }
            g.globalCompositeOperation = "source-over";
        }
        window.addEventListener("resize", () => { if (run) resize(); });
        return { start() { if (run) return; resize(); run = true; t0 = last = performance.now(); raf = requestAnimationFrame(frame); }, stop() { run = false; cancelAnimationFrame(raf); } };
    })();
    MenuFx.start();

    // áudio do menu: navegadores só liberam som depois de um gesto — o primeiro toque/clique/tecla inicia a música
    let menuAudioOn = false;
    const menuHint = $("menuHint");
    function wakeMenuAudio() {
        if (menuAudioOn || menu.classList.contains("hidden")) return;
        menuAudioOn = true; sound.init(); sound.startMenuMusic(); menuHint.classList.add("off");
    }
    ["pointerdown", "keydown", "touchstart"].forEach(ev => window.addEventListener(ev, wakeMenuAudio, { passive: true }));

    // opções (volumes salvos no navegador)
    const optionsModal = $("optionsModal"), volRange = $("volRange"), musRange = $("musRange"), fsCheck = $("fsCheck");
    const camRange = $("camRange"), joyRange = $("joyRange");
    (function loadPrefs() {
        let v = 90, m = 60, c = 100, j = 100;
        try { const sv = localStorage.getItem("eco_vol"), sm = localStorage.getItem("eco_mus"), sc = localStorage.getItem("eco_cam"), sj = localStorage.getItem("eco_joy"); if (sv !== null) v = +sv; if (sm !== null) m = +sm; if (sc !== null) c = +sc; if (sj !== null) j = +sj; } catch (e) {}
        volRange.value = v; musRange.value = m; camRange.value = c; joyRange.value = j;
        $("volOut").textContent = v; $("musOut").textContent = m; $("camOut").textContent = c + "%"; $("joyOut").textContent = j + "%";
        PREFS.cam = c / 100; PREFS.joy = j / 100; sound.setVolume(v / 100); sound.setMusicVolume(m / 100);
    })();
    camRange.addEventListener("input", () => { $("camOut").textContent = camRange.value + "%"; PREFS.cam = camRange.value / 100; try { localStorage.setItem("eco_cam", camRange.value); } catch (e) {} });
    joyRange.addEventListener("input", () => { $("joyOut").textContent = joyRange.value + "%"; PREFS.joy = joyRange.value / 100; try { localStorage.setItem("eco_joy", joyRange.value); } catch (e) {} });
    volRange.addEventListener("change", () => { sound.init(); sound.playBeep(); });   // prévia do volume dos efeitos
    $("gearButton").addEventListener("click", () => { sound.init(); optionsModal.classList.remove("hidden"); });
    volRange.addEventListener("input", () => { $("volOut").textContent = volRange.value; sound.setVolume(volRange.value / 100); try { localStorage.setItem("eco_vol", volRange.value); } catch (e) {} });
    musRange.addEventListener("input", () => { $("musOut").textContent = musRange.value; sound.setMusicVolume(musRange.value / 100); try { localStorage.setItem("eco_mus", musRange.value); } catch (e) {} });
    $("optionsButton").addEventListener("click", () => { sound.init(); optionsModal.classList.remove("hidden"); });
    $("optionsClose").addEventListener("click", () => optionsModal.classList.add("hidden"));
    fsCheck.addEventListener("change", () => { try { if (fsCheck.checked) (document.documentElement.requestFullscreen || function () { return Promise.reject(); }).call(document.documentElement).catch(() => { fsCheck.checked = false; }); else if (document.fullscreenElement) document.exitFullscreen(); } catch (e) { fsCheck.checked = false; } });
    document.addEventListener("fullscreenchange", () => { fsCheck.checked = !!document.fullscreenElement; });
    $("menuCreditsButton").addEventListener("click", () => { sound.init(); $("creditsScreen").classList.remove("hidden"); CreditsFx.start(); });
    window.addEventListener("keydown", e => {
        if (e.key !== "Escape") return;
        if (!optionsModal.classList.contains("hidden")) optionsModal.classList.add("hidden");
        else if (!$("creditsScreen").classList.contains("hidden") && !document.body.classList.contains("ending")) { $("creditsScreen").classList.add("hidden"); CreditsFx.stop(); }
    });

    startButton.addEventListener("click", startGame);

    function startGame() {
        sound.init(); menuAudioOn = true; sound.stopMenuMusic(1.8); sound.startAmbience(); sound.setAmbience(1);
        if (isTouch) {   // celular: tela cheia automática + trava a orientação em paisagem
            try {
                const el = document.documentElement, rf = el.requestFullscreen || el.webkitRequestFullscreen;
                const lock = () => { try { if (screen.orientation && screen.orientation.lock) screen.orientation.lock("landscape").catch(() => {}); } catch (e) {} };
                const p = rf && rf.call(el); if (p && p.then) p.then(lock).catch(() => {}); else lock();
            } catch (e) {}
        }
        startButton.disabled = true;
        menu.style.opacity = "0";

        setTimeout(function () {
            MenuFx.stop();
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
                sound.playUnlock(); setTimeout(() => sound.playDoor(), 650);
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
        if (pendingLabEvent) { pendingLabEvent = false; canMove = false; startLabEvent(false); return; }

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
    const AMB = isTouch ? 0.11 : 0.05;
    const CFG = {
        player: { walk: 3.8, sprint: 6.3, accel: 10, decel: 7, radius: 0.3, drain: 19, regen: 15, minStam: 22 }, // células/s
        cam:    { fov: 70, fovSprint: 84, fovLerp: 6, turnLerp: 9, bob: 1.9, mouseSens: 0.0022, touchSens: 0.0046, touchPitch: 0.55, touchRecenter: 2.4, turnKey: 2.2, lookLerp: 16, maxYaw: 1.35, maxPitch: 0.3 },
        ai:     { patrol: 2.1, investigate: 3.0, chase: 4.0, vision: 22, fovDeg: 110, closeSense: 3,
                  loseTime: 3.2, searchTime: 4, reaction: 1.1, catchDist: 0.7, walkNoise: 8, sprintNoise: 15, hunt: 9 },
        render: { maxW: 960, maxWTouch: 640, col: 2, fog: 24 }
    };
    const MW = 11, MH = 172, HEAD = -Math.PI / 2;   // corredor 11x100 células; jogador vai para o norte (y↓)
    const WALL = { 1: [58, 68, 84], 2: [150, 255, 230], 3: [110, 78, 48] }; // parede / porta do bunker / caixas
    const AI_LABEL = { patrol: "PATRULHANDO", investigate: "INVESTIGANDO SOM", chase: "PERSEGUINDO!", lost: "PERDEU O ALVO" };
    const monsterText = document.getElementById("monsterText");
    let grid = [], in3DChase = false, chaseFailed = false, chaseRAF = 0, lastT = 0, startRemain = 1;
    const ply = { x: 0, y: 0, vx: 0, vy: 0, speed: 0, sprint: false, stam: 100, tired: false, z: 0, vz: 0, fwd: 0, stun: 0, run: 0, air: false, slide: 0, sa: 0, sCd: 0 };
    const mon = { x: 0, y: 0, face: HEAD, state: "patrol", react: 0, lost: 0, t: 0, tx: 0, ty: 0, lx: 0, ly: 0, wp: null, path: null, pathT: 0, d: 99 };
    const cam = { yaw: HEAD, pitch: 0, fov: CFG.cam.fov, bob: 0, step: 0 };
    const look = { yaw: 0, pitch: 0 };   // alvo do olhar livre (a câmera o segue com lerp)
    keys.q = keys.e = false;
    const motes = Array.from({ length: 80 }, () => ({ x: Math.random(), y: Math.random(), s: 0.5 + Math.random() }));
    let zb = new Float32Array(1), bgGrad = null, scare = 0, heart = 0;
    // batimento cardíaco: mais rápido e forte quanto mais perto o monstro está
    sound.playHeart = function (v) {
        if (!this.ctx) return;
        const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.type = "sine"; o.frequency.setValueAtTime(60, t); o.frequency.exponentialRampToValueAtTime(32, t + 0.18);
        g.gain.setValueAtTime(0.15 + v * 0.45, t); g.gain.exponentialRampToValueAtTime(0.01, t + 0.2);
        o.connect(g); g.connect(this._out()); o.start(t); o.stop(t + 0.2);
    };

    // --- Corredor reto e longo: só correr, desviar e pular os obstáculos (estilo "endless runner" em 1ª pessoa) ---
    const RUNNER = true, RUN0 = isTouch ? 4.5 : 5.4, JUMPV = 6.4, GRAV = 24, LATSP = isTouch ? 5.6 : 4.8, SPACE = isTouch ? 1.28 : 1;   // no touch: mais lento, mais espaço entre obstáculos
    let obstacles = [];
    function buildMap() {
        grid = [];
        for (let y = 0; y < MH; y++) { grid.push([]); for (let x = 0; x < MW; x++) grid[y].push(x === 0 || x === MW - 1 || y >= MH - 1 ? 1 : 0); }
        for (let x = 0; x < MW; x++) grid[0][x] = 2;
        obstacles = [];   // barreiras baixas (PULAR) e blocos altos (DESVIAR)
        let y = 140, last = -1, k = 0;   // 0 baixa(pular) 1 viga(deslizar) 2-4 blocos(desviar)
        const KINDS = [{ kind: "low", x0: 1, x1: MW - 1 }, { kind: "beam", x0: 1, x1: MW - 1 }, { kind: "block", x0: 1, x1: 6.3 }, { kind: "block", x0: 4.7, x1: MW - 1 }, { kind: "block", x0: 3.7, x1: 7.3 }];
        while (y > 16) {
            let p = k === 0 ? 0 : (Math.random() * 5) | 0; if (p === last && Math.random() < 0.6) p = (p + 1) % 5; last = p;
            const K = KINDS[p]; obstacles.push({ kind: K.kind, x0: K.x0, x1: K.x1, y, d: 0.7, h: K.kind === "low" ? 0.38 : 0.92, hit: false });
            if (K.kind === "low" && Math.random() < 0.45) { const q = KINDS[2 + ((Math.random() * 3) | 0)]; obstacles.push({ kind: "block", x0: q.x0, x1: q.x1, y: y - 5.2, d: 0.7, h: 0.92, hit: false }); y -= 5.2; }
            y -= (6 + Math.random() * 3.2) * SPACE; k++;
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

    // --- Jogador: corre sozinho para frente; você desvia (esq/dir) e pula ---
    function runPlayer(dt) {
        const ax = getAxis(true); if (jumpBuf > 0) jumpBuf -= dt;
        const wantJump = keys[" "] || keys.w || keys.arrowup || btn.run || jumpBuf > 0;
        if (slideBuf > 0) slideBuf -= dt; ply.sCd -= dt; ply.slide -= dt;
        const wantSlide = keys.s || keys.arrowdown || btn.look || slideBuf > 0;
        ply.run = Math.min(1, ply.run + dt / 20);
        let sp = RUN0 + 1.5 * ply.run;
        if (ply.stun > 0) { ply.stun -= dt; sp *= 0.35; }
        ply.fwd += (sp - ply.fwd) * (1 - Math.exp(-9 * dt));
        ply.y -= ply.fwd * dt; ply.speed = ply.fwd;
        ply.vx += (ax.x * LATSP - ply.vx) * (1 - Math.exp(-13 * dt));
        move(ply, ply.vx * dt, 0, CFG.player.radius);
        const grounded = ply.z <= 0.001 && ply.vz <= 0;
        if (wantSlide && grounded && ply.slide <= 0 && ply.sCd <= 0) { ply.slide = 0.8; ply.sCd = 1.05; sound.playStep("pad", true); haptic(25); }
        ply.sa += ((ply.slide > 0 ? 1 : 0) - ply.sa) * (1 - Math.exp(-14 * dt));
        if (wantJump && grounded && ply.stun < 0.5 && ply.slide <= 0.25) { ply.vz = JUMPV; ply.air = true; sound.playStep("concrete", true); }
        ply.vz -= GRAV * dt; ply.z += ply.vz * dt;
        if (ply.z <= 0) { if (ply.air) { ply.air = false; sound.playStep("concrete", true); } ply.z = 0; if (ply.vz < 0) ply.vz = 0; }
        for (const o of obstacles) {   // colisão: barreira baixa só se você estiver baixo; bloco alto só desviando
            if (o.hit || ply.y > o.y + o.d + 0.3 || ply.y < o.y - 0.3) continue;
            if (ply.x + CFG.player.radius < o.x0 || ply.x - CFG.player.radius > o.x1) continue;
            if (o.kind === "beam") { if (ply.slide > 0) continue; }
            else if (ply.z >= o.h - 0.02) continue;
            o.hit = true; ply.stun = isTouch ? 0.7 : 0.9; ply.fwd *= 0.25; scare = 0.8; sound.playThud(); haptic([90, 40, 90]);
            showStory(o.kind === "low" ? "Tropeçou! PULE as barreiras baixas!" : o.kind === "beam" ? "Cabeçada! DESLIZE sob as vigas!" : "Bateu! DESVIE dos blocos altos!");
        }
        cam.yaw += (HEAD + ply.vx * 0.03 - cam.yaw) * (1 - Math.exp(-10 * dt)); cam.pitch = 0;
        const tf = CFG.cam.fov + ply.fwd * 1.8 + (ply.z > 0 ? 3 : 0);
        cam.fov += (tf - cam.fov) * (1 - Math.exp(-CFG.cam.fovLerp * dt));
        if (!ply.air) cam.bob += ply.fwd * dt * 1.5;
        const st = Math.floor(cam.bob / Math.PI);
        if (st !== cam.step) { cam.step = st; if (!ply.air) sound.playStep("concrete", true); }
        return false;
    }
    // --- Monstro: sempre atrás de você, quase na sua velocidade; cada tropeço o aproxima ---
    function runMonster(dt) {
        const base = (RUN0 + 1.5 * ply.run) * 0.94, d0 = mon.y - ply.y;
        mon.y -= base * (d0 > 22 ? 1.3 : 1) * dt; mon.x += (ply.x - mon.x) * Math.min(1, 3 * dt);
        mon.d = mon.y - ply.y; mon.state = "chase"; mon.face = HEAD;
    }

    // --- Render: 1 raio por coluna (DDA), z-buffer, monstro como sprite com oclusão ---
    function render(now) {
        const g = ctx3D, W = canvas3D.width, H = canvas3D.height, COL = CFG.render.col, px = ply.x, py = ply.y;
        const half = Math.tan(cam.fov * Math.PI / 360), dirX = Math.cos(cam.yaw), dirY = Math.sin(cam.yaw);
        const plX = -dirY * half, plY = dirX * half;
        const al = Math.abs(Math.sin(now / 250)), fl = Math.random() > 0.985 ? 0.45 : 1, alarm = true;   // fuga 3D: sempre sob luzes de emergência vermelhas
        const hor = H / 2 + (ply.z - ply.sa * 0.2) * H * 0.3 + cam.pitch * H * 0.9 + (Math.random() - 0.5) * scare * H * 0.03 + Math.sin(cam.bob) * H * 0.008 * (ply.sprint ? 1.7 : 1) * Math.min(1, ply.speed / 2);
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
            const f = Math.max(AMB * fl, Math.pow(Math.max(0, 1 - dist / CFG.render.fog), 1.5) * fl), c = WALL[hit];   // AMB: luz mínima (bunker sombrio, mas legível no celular)
            let sh = (side ? 0.7 : 1) * f * ((wx * 3) % 1 < 0.04 ? 0.55 : 1);
            if (hit === 2) sh = 0.55 + 0.45 * al;   // porta do bunker: sempre visível e pulsante
            g.fillStyle = `rgb(${(c[0] * sh + al * (alarm ? 95 : 26) * f) | 0},${(c[1] * sh * (alarm ? 1 - al * 0.35 : 1)) | 0},${(c[2] * sh * (alarm ? 1 - al * 0.35 : 1)) | 0})`;
            g.fillRect(x, hor - lh / 2, COL, lh);
            const hs = ((mx * 73856093) ^ (my * 19349663)) >>> 0;
            if (hit === 1 && (mx === 0 || mx === MW - 1) && my % 9 === 4 && wx > 0.14 && wx < 0.86) {   // PORTAS VERMELHAS nas laterais (Level !)
                const edge = wx < 0.18 || wx > 0.82, dh = lh * 0.74;
                g.fillStyle = edge ? `rgb(${(40 * f) | 0},${(8 * f) | 0},${(8 * f) | 0})` : `rgb(${(170 * f + al * 40 * f) | 0},${(14 * f) | 0},${(14 * f) | 0})`; g.fillRect(x, hor + lh / 2 - dh, COL, dh);
                if (!edge) { g.fillStyle = `rgba(0,0,0,${0.35 * f})`; g.fillRect(x, hor + lh / 2 - dh * 0.5, COL, Math.max(1, lh * 0.02)); if (wx > 0.7 && wx < 0.74) { g.fillStyle = `rgba(230,200,120,${f})`; g.fillRect(x, hor + lh * 0.02, COL, lh * 0.05); } }
            } else if (hit === 1) {   // cano, rodapé e manchas de sangue nas paredes
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
            const lp = 0.35 + 0.65 * Math.abs(Math.sin(now / 260 - ly * 0.55));   // lâmpadas pulsam em onda ao longo do corredor
            g.fillStyle = `rgba(255,${(50 + 50 * (1 - lp)) | 0},35,${a})`; g.fillRect(lsx - sc * 0.28, hor - sc * 0.5, sc * 0.56, Math.max(1.5, sc * 0.05));
            const gr2 = g.createRadialGradient(lsx, hor - sc * 0.48, 0, lsx, hor - sc * 0.48, sc * 1.5);   // halo vermelho no teto/paredes
            gr2.addColorStop(0, `rgba(255,30,20,${a * 0.5 * lp})`); gr2.addColorStop(1, "rgba(255,30,20,0)"); g.fillStyle = gr2; g.fillRect(lsx - sc * 1.5, hor - sc * 2, sc * 3, sc * 3);
            g.fillStyle = `rgba(255,30,20,${a * 0.34 * lp})`; g.beginPath(); g.ellipse(lsx, hor + sc * 0.5, sc * 1.4, sc * 0.13, 0, 0, 6.3); g.fill();
        }
        if (alarm) {   // luzes de emergência pulsando no teto e nas paredes laterais (centro livre)
            const gt = g.createLinearGradient(0, 0, 0, H * 0.38); gt.addColorStop(0, `rgba(255,20,20,${0.5 * al})`); gt.addColorStop(1, "rgba(255,20,20,0)"); g.fillStyle = gt; g.fillRect(0, 0, W, H * 0.38);
            const gl = g.createLinearGradient(0, 0, W * 0.2, 0); gl.addColorStop(0, `rgba(255,20,20,${0.4 * (1 - al)})`); gl.addColorStop(1, "rgba(255,20,20,0)"); g.fillStyle = gl; g.fillRect(0, 0, W * 0.2, H);
            const gr = g.createLinearGradient(W, 0, W * 0.8, 0); gr.addColorStop(0, `rgba(255,20,20,${0.4 * (1 - al)})`); gr.addColorStop(1, "rgba(255,20,20,0)"); g.fillStyle = gr; g.fillRect(W * 0.8, 0, W * 0.2, H);
        }
        const hz = g.createRadialGradient(W / 2, hor, 0, W / 2, hor, W * 0.62);   // névoa volumétrica avermelhada no fundo do corredor
        hz.addColorStop(0, `rgba(150,25,20,${0.22 + 0.1 * al})`); hz.addColorStop(0.5, "rgba(90,10,10,0.1)"); hz.addColorStop(1, "rgba(60,0,0,0)"); g.fillStyle = hz; g.fillRect(0, 0, W, H);
        g.fillStyle = "rgba(220,200,200,0.4)";   // partículas de poeira
        for (const m of motes) { m.y = (m.y + m.s * 0.0004) % 1; m.x = (m.x + Math.sin(now / 2000 + m.s * 9) * 0.0003 + 1) % 1; g.fillRect(m.x * W, m.y * H, 1.5 + m.s, 1.5 + m.s); }
        // obstáculos: faces voltadas para você, desenhadas coluna a coluna (oclusão pelas paredes)
        for (let oi = obstacles.length - 1; oi >= 0; oi--) {
            const o = obstacles[oi], yf = o.y + o.d, dd = py - yf;
            if (dd < 0.2 || dd > CFG.render.fog || o.hit && dd < 0.5) continue;
            const hz = o.h;
            for (let x = 0; x < W; x += COL) {
                const cx = 2 * x / W - 1, rdx = dirX + plX * cx, rdy = dirY + plY * cx;
                if (rdy >= -0.0001) continue;
                const t = (yf - py) / rdy; if (t <= 0.15 || t > zb[(x / COL) | 0]) continue;
                const hx = px + t * rdx; if (hx < o.x0 || hx > o.x1) continue;
                const lh = H / t, fy = hor + lh / 2, f = Math.max(AMB * 1.5, Math.pow(Math.max(0, 1 - t / CFG.render.fog), 1.4)), u = (hx - o.x0) * 3.2;
                if (o.kind === "low") {   // barreira baixa: listras de perigo amarelo/preto
                    const stripe = (((hx * 3.4 + 0.0) % 1) < 0.5);
                    g.fillStyle = stripe ? `rgb(${(235 * f) | 0},${(190 * f) | 0},${(20 * f) | 0})` : `rgb(${(26 * f) | 0},${(24 * f) | 0},${(20 * f) | 0})`;
                    g.fillRect(x, fy - hz * lh, COL, hz * lh);
                    g.fillStyle = `rgba(255,40,30,${(0.5 + 0.5 * al) * f})`; g.fillRect(x, fy - hz * lh, COL, Math.max(1, lh * 0.03));
                } else if (o.kind === "beam") {   // viga/cano suspenso: passe deslizando
                    const top = fy - lh, bot = fy - 0.5 * lh;
                    g.fillStyle = `rgb(${(78 * f) | 0},${(80 * f) | 0},${(88 * f) | 0})`; g.fillRect(x, top, COL, bot - top);
                    g.fillStyle = (((hx * 3.4) % 1) < 0.5) ? `rgb(${(235 * f) | 0},${(190 * f) | 0},${(20 * f) | 0})` : `rgb(${(26 * f) | 0},${(24 * f) | 0},${(20 * f) | 0})`; g.fillRect(x, bot - lh * 0.07, COL, lh * 0.07);
                    g.fillStyle = `rgba(255,40,30,${(0.4 + 0.5 * al) * f})`; g.fillRect(x, bot, COL, Math.max(1, lh * 0.025));
                } else {   // bloco alto: armário/contêiner metálico enferrujado com lâmpada de alerta
                    g.fillStyle = `rgb(${(92 * f) | 0},${(54 * f) | 0},${(40 * f) | 0})`; g.fillRect(x, fy - hz * lh, COL, hz * lh);
                    if ((u % 1) < 0.07) { g.fillStyle = `rgba(0,0,0,${0.55 * f})`; g.fillRect(x, fy - hz * lh, COL, hz * lh); }
                    g.fillStyle = `rgba(0,0,0,${0.35 * f})`; g.fillRect(x, fy - hz * lh * 0.5, COL, Math.max(1, lh * 0.03));
                    g.fillStyle = `rgba(255,${(40 + 60 * al) | 0},20,${(0.35 + 0.5 * al) * f})`; g.fillRect(x, fy - hz * lh, COL, Math.max(1.5, lh * 0.05));
                }
            }
        }
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
        bgGrad.addColorStop(0, "#07080c"); bgGrad.addColorStop(0.5, "#020204"); bgGrad.addColorStop(1, isTouch ? "#171c26" : "#10131a");
    }
    window.addEventListener("resize", () => { if (in3DChase) resizeCanvas(); });
    const clampLook = () => {
        look.yaw = Math.max(-CFG.cam.maxYaw, Math.min(CFG.cam.maxYaw, look.yaw));
        look.pitch = Math.max(-CFG.cam.maxPitch, Math.min(CFG.cam.maxPitch, look.pitch));
    };
    let lookId = null, lx = 0, ly = 0;
    canvas3D.addEventListener("pointerdown", e => {
        if (!in3DChase || RUNNER) return;
        if (e.pointerType === "mouse") { if (canvas3D.requestPointerLock) canvas3D.requestPointerLock(); }
        else if (lookId === null) { lookId = e.pointerId; lx = e.clientX; ly = e.clientY; canvas3D.setPointerCapture(lookId); }
    });
    window.addEventListener("pointermove", e => {
        if (!in3DChase || RUNNER) return;
        if (e.pointerType === "mouse") {   // mouse: pointer lock (ou arrastar com botão esquerdo)
            if (document.pointerLockElement !== canvas3D && !(e.buttons & 1)) return;
            look.yaw += e.movementX * CFG.cam.mouseSens * PREFS.cam; look.pitch -= e.movementY * CFG.cam.mouseSens * PREFS.cam;
        } else if (e.pointerId === lookId) {   // touch: arrastar o dedo na metade direita
            // arrasto com ganho progressivo: gesto lento = precisão; gesto rápido = giro amplo (sem saltos)
            const lim = 70, ddx = Math.max(-lim, Math.min(lim, e.clientX - lx)), ddy = Math.max(-lim, Math.min(lim, e.clientY - ly));
            look.yaw += ddx * CFG.cam.touchSens * PREFS.cam * (1 + Math.min(1, Math.abs(ddx) / 30) * 0.7);
            look.pitch -= ddy * CFG.cam.touchSens * PREFS.cam * CFG.cam.touchPitch;
            lx = e.clientX; ly = e.clientY;
        } else return;
        clampLook();
    });
    const lookEnd = e => { if (e.pointerId === lookId) lookId = null; };
    canvas3D.addEventListener("pointerup", lookEnd); canvas3D.addEventListener("pointercancel", lookEnd);

    function start3DChase() {
        sound.setAmbience(0); sound.startChase("corridor");
        buildMap();
        Object.assign(ply, { x: MW / 2, y: 150.5, vx: 0, vy: 0, speed: 0, sprint: false, stam: 100, tired: false, z: 0, vz: 0, fwd: 2, stun: 0, run: 0, air: false, slide: 0, sa: 0, sCd: 0 });
        Object.assign(mon, { x: MW / 2, y: 166.5, face: HEAD, state: "chase", react: 0, lx: MW / 2, ly: 150.5, hunt: 0, lost: 0, t: 0, wp: null, path: null, d: 16 });
        Object.assign(cam, { yaw: HEAD, pitch: 0, fov: CFG.cam.fov, bob: 0, step: 0 }); look.yaw = look.pitch = 0;
        startRemain = ply.y - 1.4; chaseFailed = false; in3DChase = true;
        room2.classList.add("hidden"); darkness.classList.add("hidden");
        chase3DContainer.classList.remove("hidden"); document.body.classList.add("in-chase");
        resizeCanvas(); lastT = performance.now();
        showStory(isTouch ? "CORRA! Joystick: desvie • PULAR: barreiras baixas • DESLIZAR: vigas altas" : "CORRA! ←→ desviam • ESPAÇO pula barreiras baixas • S/↓ desliza sob vigas");
        sound.playRoar(); scare = 1;
        chaseRAF = requestAnimationFrame(chaseLoop);
    }

    function endChase(won) {
        sound.stopChase(won ? 1.2 : 0.4);
        in3DChase = false; cancelAnimationFrame(chaseRAF); if (document.exitPointerLock) document.exitPointerLock();   // [FIX] loop sempre cancelado
        document.body.classList.remove("in-chase");
        firstPersonArms.classList.remove("is-running", "is-sprinting", "is-looking-back");
        lookBackIndicator.classList.add("hidden");
        if (won) { chase3DContainer.classList.add("hidden"); goToRoom3(); }
        else { chaseFailed = true; sound.playRoar(); setGameOverText("corridor"); gameOverModal.classList.remove("hidden"); }
    }

    function chaseLoop(now) {
        if (!in3DChase) return;
        const step = Math.min(0.05, (now - lastT) / 1000 || 0.016); lastT = now;
        const looking = runPlayer(step);
        runMonster(step);
        scare = Math.max(0, scare - step * 1.6);
        sound.setThreat(Math.max(0.15, 1 - mon.d / 20));   // batimentos/respiração/trilha acompanham a distância do monstro
        render(now);
        const rem = Math.max(0, ply.y - 1.4);
        distBar.style.width = (rem / startRemain * 100) + "%"; distText.innerText = Math.ceil(rem) + "m";
        monsterBar.style.width = Math.min(100, mon.d / 20 * 100) + "%"; staminaBar.style.width = (ply.stun > 0 ? 25 : 100) + "%";
        if (monsterText.dataset.s !== mon.state) { monsterText.dataset.s = mon.state; monsterText.innerText = AI_LABEL[mon.state]; monsterText.style.color = mon.state === "chase" ? "#ff3333" : "#ffcc00"; }
        lookBackIndicator.classList.toggle("hidden", !looking);
        firstPersonArms.classList.toggle("is-looking-back", !!looking);
        firstPersonArms.classList.toggle("is-running", !ply.air);
        firstPersonArms.classList.toggle("is-sprinting", ply.fwd > RUN0);
        if (ply.y < 1.4) return endChase(true);
        if (mon.d < 1.2) return endChase(false);
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

        currentRoom = 2; sound.setAmbience(2);
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

        currentRoom = 1; sound.setAmbience(1);
        room2.classList.add("hidden");
        room1.classList.remove("hidden");
        darkness.classList.add("hidden");

        playerX = 82;
        playerY = 12;
        player.style.left = playerX + "%";
        player.style.bottom = playerY + "%";

        setTimeout(function() { canMove = true; }, 500);
    }

    // ==========================================
    // SALAS NOVAS (3 = cela, 4 = bifurcação, 5 = corredor vermelho, 6 = Porta de Saída) + MEDIDOR DE RUÍDO
    // ==========================================
    const roomEls = { 1: room1, 2: room2, 3: room3, 4: $("room4"), 5: $("room5"), 6: $("room6"), 7: $("room7"), 8: $("room8") };

    function enterRoom(n, x, y, story, keepLocked) {
        if (currentRoom === 3 && n !== 3 && cellRun.far && !cellRun.woke) unlockAch("silent");
        if (n === 3) cellRun = { far: false, woke: false };
        canMove = false; hideAction(); sound.playDoor();
        Object.values(roomEls).forEach(r => r.classList.add("hidden"));
        roomEls[n].classList.remove("hidden");
        currentRoom = n; sound.setAmbience(n); darkness.classList.add("hidden");
        if (n === 3) { setupPaddedCell(); setupGoo(); room3EntranceDoor.classList.add("door-open"); }
        if (specChase.active && spec.state === "chase" && spec.room !== n) { spec.delay = cine.on ? 1.0 : 1.8; spec.entryX = x; }   // o monstro te segue pela porta/escada
        playerX = x; playerY = y; vx = vy = 0;
        player.style.left = playerX + "%"; player.style.bottom = playerY + "%";
        updateKeyEl();
        if (story) showStory(story);
        if (n === 8 && labEventArmed && notesRead.every(Boolean)) setTimeout(() => { if (currentRoom === 8) startLabEvent(false); }, 1300);
        if (!keepLocked) setTimeout(() => { canMove = true; }, 500);
    }

    // ==========================================
    // GOSMAS PRETAS OBSERVADORAS (só olham; nunca atacam) — os olhos seguem o jogador
    // ==========================================
    const GOO = [
        // chão (x = centro, y = base; % da sala)
        { x: 18, y: 9, w: 9, h: 7, eyes: 2 }, { x: 31, y: 17, w: 6, h: 5, eyes: 1 }, { x: 46, y: 4, w: 8, h: 6, eyes: 2 },
        { x: 58, y: 18, w: 6, h: 5, eyes: 1 }, { x: 70, y: 8, w: 9, h: 7, eyes: 2 }, { x: 90, y: 13, w: 7, h: 6, eyes: 1 }, { x: 8, y: 17, w: 5, h: 4, eyes: 1 },
        // parede (t = topo)
        { wall: true, x: 13, t: 24, w: 6, h: 12, eyes: 2 }, { wall: true, x: 28, t: 46, w: 4.5, h: 8, eyes: 1 },
        { wall: true, x: 74, t: 30, w: 6.5, h: 13, eyes: 2 }, { wall: true, x: 91, t: 38, w: 5, h: 9, eyes: 1 }, { wall: true, x: 60, t: 12, w: 4, h: 6, eyes: 1 }
    ];
    const gooEls = [];
    function setupGoo() {
        if ($("cellGoo")) return;
        const box = document.createElement("div"); box.id = "cellGoo";
        const spots = [[32, 40], [66, 46], [48, 26]];
        GOO.forEach((g, i) => {
            const el = document.createElement("i");
            el.className = "goo" + (g.wall ? " goo-w" : "");
            el.style.left = g.x + "%"; el.style.width = g.w + "%"; el.style.height = g.h + "%";
            if (g.wall) el.style.top = g.t + "%"; else el.style.bottom = g.y + "%";
            for (let k = 0; k < g.eyes; k++) {
                const e = document.createElement("b"); e.className = "ge";
                e.style.left = spots[k][0] + "%"; e.style.top = spots[k][1] + "%";
                e.style.animationDelay = (-(i * 1.7 + k * 0.9)) + "s";
                e.innerHTML = "<u></u>"; el.appendChild(e);
            }
            box.appendChild(el);
            gooEls.push({ el, cx: g.x, cy: g.wall ? 100 - (g.t + g.h / 2) : g.y + g.h / 2, w: g.w, h: g.h, wall: !!g.wall });
        });
        room3.insertBefore(box, room3.querySelector(".cell-light"));
    }
    let gooTick = 0;
    function updateGooEyes() {   // a cada 2 quadros: aponta a pupila para o jogador e "arregala" quando ele chega perto
        if ((gooTick++ & 1) || !gooEls.length) return;
        const k = innerHeight / innerWidth, px = playerX + 2, py = playerY + 5;
        for (const g of gooEls) {
            const dx = px - g.cx, dy = (py - g.cy) * k, d = Math.hypot(dx, dy) || 1;
            g.el.style.setProperty("--ex", (dx / d).toFixed(2)); g.el.style.setProperty("--ey", (-dy / d).toFixed(2));
            g.el.classList.toggle("near", d < 15);
        }
    }

    // --- vigilância, painel, lab, notas do Espécime 064 e atmosfera ---
    const cctvModal = $("cctvModal");
    function openCctv() { canMove = false; hideAction(); sound.playBeep(); cctvModal.classList.remove("hidden"); }
    $("closeCctvButton").addEventListener("click", () => {
        cctvModal.classList.add("hidden"); canMove = true;
        unlockLab("Fim da gravação. O sistema liberou a tranca do LABORATÓRIO DE PESQUISAS.");
    });
    function unlockLab(msg) {
        if (labUnlocked) return false;
        labUnlocked = true; $("labDoor").classList.add("door-open"); sound.playUnlock(); setTimeout(() => sound.playDoor(), 700); showStory(msg); return true;
    }
    function operatePanel() { if (!unlockLab("PAINEL: tranca do LABORATÓRIO DE PESQUISAS liberada.")) showStory("O painel está em modo automático. O Laboratório já está destrancado."); }
    const NOTES = [
        ["ESPÉCIME 064 — RELATÓRIO A", "Origem: túneis inferiores. Sem olhos funcionais; orienta-se apenas pelo SOM.\n\nAlojado na CELA 064, embutida na parede da Sala de Contenção. O piso e as paredes foram cobertos por uma gosma negra: secreção do espécime."],
        ["ESPÉCIME 064 — RELATÓRIO B", "A secreção parece VIVA: manchas com olhos acompanham qualquer movimento, sem nunca atacar. Observam. Esperam.\n\nO cofre dentro da cela guarda a espingarda do protocolo e 2 cartuchos. Ninguém ousou abri-lo."],
        ["ESPÉCIME 064 — URGENTE", "Incidente 04: o 064 arrancou as barras e fugiu da cela. É a MESMA ENTIDADE que agora caça qualquer um que se mova pelo complexo.\n\nSe você lê isto, ele já ouviu você. Ele está nas tubulações, acima de nós.\n\n— Dr. Halvorsen (última anotação)"]
    ];
    function readNote(i) {
        sound.playPaper(); openGenericDocument(NOTES[i][0], NOTES[i][1]);
        notesRead[i] = true; $("note" + i).classList.add("read");
        if (notesRead.every(Boolean)) pendingLabEvent = true;   // a cena começa quando o jogador fechar o documento
    }
    function clawScratch(vol = 1) {   // garras raspando na tubulação (sintetizado)
        const ctx = sound.ctx; if (!ctx) return;
        for (let i = 0; i < 4; i++) {
            const len = ctx.sampleRate * 0.09, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
            for (let k = 0; k < len; k++) d[k] = (Math.random() * 2 - 1) * (1 - k / len);
            const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
            src.buffer = buf; f.type = "bandpass"; f.frequency.value = 650 + Math.random() * 600; f.Q.value = 1.6; g.gain.value = 0.22 * vol;
            src.connect(f); f.connect(g); g.connect(sound._out()); src.start(ctx.currentTime + i * 0.11 + Math.random() * 0.04);
        }
        haptic([60, 50, 60]);
    }
    let emergencyEpoch = 0;
    function startEmergency() {
        if (emergency) return; emergency = true; const ep = ++emergencyEpoch;
        $("emergencyLight").classList.remove("hidden");
        const loop = () => {
            if (!emergency || ep !== emergencyEpoch) return;   // alarme desligado (checkpoint): para o loop de garras
            if (!in3DChase) { clawScratch(); if (!clawShown) { clawShown = true; showStory("As luzes de emergência pulsam nas paredes. Algo arranha a tubulação acima de você..."); } }
            setTimeout(loop, 6000 + Math.random() * 6000);
        };
        setTimeout(loop, 1500);
    }
    function stopEmergency() {   // desliga alarme e luzes (usado no checkpoint)
        emergency = false; emergencyEpoch++; clawShown = false;
        $("emergencyLight").classList.add("hidden"); alarmOverlay.classList.add("hidden");
    }

    // ==========================================
    // ESPÉCIME 064 — EVENTO DO LABORATÓRIO • PERSEGUIÇÃO 2D • ESPINGARDA • GAME OVER
    // ==========================================
    const specEl = $("spec064"), fxLayer = $("fxLayer"), muzzle = $("muzzleFlash"), gunSprite = $("gunSprite"), keyEl = $("keyItem"),
          chaseBanner = $("chaseBanner"), grabScene = $("grabScene"), fireBtnPc = $("fireBtnPc"), keyTag = $("keyTag"), ammoPart = $("ammoPart");
    const spec = { room: 0, x: 90, y: 13, state: "hidden", dir: -1, delay: 0, speed: 0.12, entryX: 12, t: 0, stun: 0 };
    const specChase = { active: false };
    const SHOT_RANGE = 36, SPEC_CATCH = 3.6, REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let shotCd = 0, lastBanner = "";
    const shake = { amp: 0, t: 0, on: false, p: [0, 0, 0, 0, 0] };

    // --- screen shake: offset estocástico suave (somas de senos com fase aleatória) que decai em ~250 ms ---
    function addShake(a) { shake.amp = Math.max(shake.amp, a * (REDUCED ? 0.3 : 1)); shake.t = 0; shake.p = shake.p.map(() => Math.random() * 6.28); }
    function applyShake() {
        if (shake.amp < 0.15) { if (shake.on) { game.style.transform = ""; shake.on = false; } return; }
        shake.t += dt / 60;
        const a = shake.amp, p = shake.p, t = shake.t;
        const x = (Math.sin(t * 57 + p[0]) + 0.6 * Math.sin(t * 91 + p[1])) * a * 0.6;
        const y = (Math.sin(t * 63 + p[2]) + 0.6 * Math.sin(t * 84 + p[3])) * a * 0.6;
        const r = Math.sin(t * 49 + p[4]) * a * 0.05;
        game.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) rotate(${r.toFixed(2)}deg)`;
        shake.amp *= Math.exp(-0.14 * dt); shake.on = true;
    }

    function setBanner(txt, hot) {
        const key = (txt || "") + (hot ? "!" : "");
        if (key === lastBanner) return; lastBanner = key;
        chaseBanner.textContent = txt || ""; chaseBanner.classList.toggle("hot", !!hot); chaseBanner.classList.toggle("hidden", !txt);
    }
    function setAmmo() {
        ammoHud.classList.toggle("hidden", !(hasShotgun || hasKey));
        ammoPart.classList.toggle("hidden", !hasShotgun);
        ammoCount.textContent = shells; keyTag.classList.toggle("hidden", !hasKey);
        const can = hasShotgun && shells > 0 && specChase.active;
        document.body.classList.toggle("can-fire", can);
        fireBtnPc.classList.toggle("hidden", !(can && !isTouch));
    }
    function updateKeyEl() {
        const show = keyOnFloor && keyRoom === currentRoom;
        keyEl.classList.toggle("hidden", !show);
        if (show) { keyEl.style.left = keyX + "%"; keyEl.style.bottom = keyY + "%"; }
    }
    function pickKey() {
        keyOnFloor = false; hasKey = true; updateKeyEl(); setAmmo(); sound.playKeys();
        showStory("CHAVE DA SAÍDA coletada! Agora destranque a PORTA DE SAÍDA.");
    }
    function openDirectorDoor() {
        if (!hasKey) {
            sound.playMetalPounding();
            showStory(specChase.active ? "TRANCADA! Sem saída... a ESPINGARDA! ATIRE nele quando chegar perto!" : "Trancada. A fechadura pesada exige a CHAVE DA SAÍDA.");
            return;
        }
        if (endShown) return; endShown = true;
        sound.playUnlock(); $("dirDoor").classList.add("door-open"); setTimeout(() => sound.playDoor(), 800);
        showStory("A chave gira. A porta se abre... uma luz intensa invade o corredor.");
        setTimeout(startEnding, 1400);
    }

    // --- efeitos visuais do tiro: flash de luz (~90 ms), fumaça + faíscas, clarão no cenário ---
    function muzzlePos() { const right = facing !== "left"; return { x: playerX + (right ? 7 : -3), y: playerY + 9, right }; }
    function puff(cls, xPct, yBottomPct, dx, dy, size, dur) {
        if (fxLayer.childElementCount > 80) return;
        const p = document.createElement("i");
        p.className = cls; p.style.left = xPct + "%"; p.style.top = (100 - yBottomPct) + "%";
        p.style.setProperty("--dx", dx.toFixed(0) + "px"); p.style.setProperty("--dy", dy.toFixed(0) + "px"); p.style.setProperty("--s", size.toFixed(0) + "px");
        p.style.animationDuration = dur.toFixed(2) + "s";
        p.addEventListener("animationend", () => p.remove()); fxLayer.appendChild(p);
        setTimeout(() => p.remove(), dur * 1000 + 250);
    }
    function dust(xPct, yBottomPct, n) { for (let i = 0; i < n; i++) puff("smk dust", xPct + (Math.random() - 0.5) * 6, yBottomPct, (Math.random() - 0.5) * 220, -(30 + Math.random() * 90), 20 + Math.random() * 30, 0.9 + Math.random() * 0.9); }
    function fxShot(m) {
        muzzle.style.left = m.x + "%"; muzzle.style.top = (100 - m.y) + "%";
        muzzle.classList.remove("fire"); void muzzle.offsetWidth; muzzle.classList.add("fire");
        gunSprite.style.left = (m.right ? playerX + 2 : playerX - 6) + "%"; gunSprite.style.bottom = (playerY + 5) + "%";
        gunSprite.classList.toggle("flip", !m.right);
        gunSprite.classList.remove("show"); void gunSprite.offsetWidth; gunSprite.classList.add("show");
        const lit = roomEls[currentRoom]; lit.classList.remove("lit"); void lit.offsetWidth; lit.classList.add("lit");
        const dir = m.right ? 1 : -1;
        for (let i = 0; i < 12; i++) puff("smk", m.x, m.y, dir * (30 + Math.random() * 100), -(10 + Math.random() * 70), 14 + Math.random() * 26, 0.9 + Math.random() * 1.1);
        for (let i = 0; i < 10; i++) puff("spark", m.x, m.y, dir * (60 + Math.random() * 230), Math.random() * 60 - 40, 6 + Math.random() * 8, 0.25 + Math.random() * 0.3);
    }

    // --- disparo ---
    function fireShotgun() {
        if (!hasShotgun || in3DChase || (!canMove && !slowmo.on) || shotCd > 0) return;
        if (cine.on && !slowmo.on) return;   // na cutscene o tiro só existe no momento da câmera lenta
        if (!specChase.active || spec.room !== currentRoom || spec.state !== "chase") {
            showStory(specChase.active ? "Sem alvo à vista... guarde a munição." : "Guarde a munição. Ainda não há nada para atirar.");
            return;
        }
        if (shells <= 0) { sound.playDryFire(); showStory("Sem munição!"); return; }
        shells--; shotCd = 0.5;
        facing = spec.x >= playerX ? "right" : "left";
        player.classList.remove("facing-left", "facing-right", "facing-up", "facing-down"); player.classList.add("facing-" + facing);
        const m = muzzlePos();
        sound.playShotgun(); setTimeout(() => sound.playShell(), 380);   // estampido agora; cápsula quica no chão ~380 ms depois
        fxShot(m); addShake(18);
        haptic(130);   // vibração seca e forte no disparo
        shotFlash(); 
        playerX = Math.max(2, Math.min(93, playerX + (m.right ? -1.6 : 1.6))); player.style.left = playerX + "%";   // coice
        setAmmo();
        if (Math.abs(spec.x - playerX) <= SHOT_RANGE) hitSpec();
        else { spec.stun = 0.35; showStory("Longe demais! Os chumbos se espalharam. Espere ele chegar mais perto."); }
    }
    function hitSpec() {
        const lastSecond = slowmo.on || Math.abs(spec.x - playerX) <= 15;
        if (slowmo.on) { endSlowmo(); canMove = true; }
        endCine(); sound.stopChase(2.4); shotFlash(true); haptic([160, 50, 120]);
        if (lastSecond) unlockAch("last");
        specChase.active = false; labEventArmed = false; setAmmo(); setBanner("");
        spec.state = "hurt"; spec.t = 0;
        keyOnFloor = true; keyRoom = spec.room;
        keyX = Math.max(10, Math.min(88, spec.x - spec.dir * 7)); keyY = Math.max(5, Math.min(17, spec.y));
        updateKeyEl(); keyEl.classList.remove("drop"); void keyEl.offsetWidth; keyEl.classList.add("drop");
        setTimeout(() => sound.playPain(), 120);
        showStory("ACERTOU! Ele recua rugindo de dor e deixa cair uma CHAVE!");
        setTimeout(() => { if (spec.state === "hurt") spec.state = "flee"; }, 1500);
    }

    // --- atualização por quadro do Espécime 064 ---
    function updateSpec() {
        shotCd = Math.max(0, shotCd - dt / 60);
        if (spec.state === "hidden") { specEl.classList.add("hidden"); return; }
        const ts = slowmo.on ? 0.12 : 1, sec = dt / 60 * ts;
        if (specChase.active && canMove) {   // saídas automáticas durante a fuga (fácil no touch)
            if (currentRoom === 8 && playerX <= 9) { enterRoom(5, 27, 12); }
            else if (currentRoom === 5 && playerX >= 77) { enterRoom(6, 12, 12, "Você sobe os degraus de dois em dois!"); }
        }
        if (spec.state === "chase" && specChase.active && (canMove || slowmo.on)) {
            if (spec.room !== currentRoom) {
                sound.setThreat(0.3);
                spec.delay -= sec;
                if (spec.delay <= 0) { spec.room = currentRoom; spec.x = spec.entryX; spec.y = Math.max(5, Math.min(18, playerY)); sound.playRoar(); }
            } else {
                const dx = playerX - spec.x, dy = playerY - spec.y;
                spec.dir = dx >= 0 ? 1 : -1;
                if (spec.stun > 0) spec.stun -= sec;
                else {
                    spec.x += Math.sign(dx) * Math.min(Math.abs(dx), spec.speed * dt * ts);
                    spec.y += Math.sign(dy) * Math.min(Math.abs(dy), spec.speed * 0.55 * dt * ts);
                }
                if (!slowmo.on && !slowmo.done && (!cine.on || cine.phase === "door") && Math.abs(dx) < 13 && Math.abs(dy) < 9) startSlowmo();   // prestes a ser agarrado → câmera lenta
                if (slowmo.on) {
                    slowmo.t += dt / 60;
                    if (slowmo.t > (slowmo.gun ? 3.2 : 1.9)) { endSlowmo(); grabPlayer(); return; }   // só o tempo decide: a janela para atirar é sempre justa
                } else if (Math.hypot(dx, dy * 0.8) < SPEC_CATCH && !(cine.on && cine.phase === "run")) { grabPlayer(); return; }
                sound.setThreat(0.25 + Math.max(0, 1 - Math.abs(dx) / 70) * 0.75);   // batimentos e respiração sobem com a proximidade

            }
        } else if (spec.state === "hurt") {
            spec.t += sec; if (spec.t < 0.45) spec.x -= spec.dir * 0.45 * dt;
        } else if (spec.state === "flee") {
            spec.x -= spec.dir * 0.75 * dt;
            if (spec.x < -10 || spec.x > 110) { spec.state = "hidden"; specEl.classList.add("hidden"); if (spec.room === currentRoom) showStory("Ele fugiu para as sombras. Pegue a chave!"); return; }
        }
        const show = spec.room === currentRoom;
        specEl.classList.toggle("hidden", !show);
        if (show) {
            specEl.style.left = spec.x + "%"; specEl.style.bottom = spec.y + "%";
            specEl.classList.toggle("dir-r", spec.dir > 0);
            specEl.classList.toggle("walk", spec.state === "chase" && !(spec.stun > 0));
            specEl.classList.toggle("hurt", spec.state === "hurt" || spec.state === "flee");
        }
        if (cine.on && cine.phase === "run" && currentRoom === 6 && playerX >= 82) cineDoor();
        if (specChase.active && !cine.on && currentRoom === 6 && !exitHint && playerX > 70 && !hasKey) {   // chegou à porta trancada: sem saída → lembra da espingarda
            exitHint = true; sound.playLocked();
            showStory(hasShotgun && shells > 0 ? "Trancada! Sem saída... a ESPINGARDA! Vire-se e ATIRE nele!" : "Trancada! Sem saída...");
        }
        if (specChase.active && !cine.on) {
            const near = show && spec.state === "chase" && Math.abs(spec.x - playerX) <= SHOT_RANGE && hasShotgun && shells > 0;
            setBanner(near ? "🔫 ATIRE AGORA!  [F] • [ESPAÇO] • ATIRAR"
                : (currentRoom === 6 ? "ALCANCE A PORTA DE SAÍDA" : "CORRA ATÉ A ESCADA ↑ PORTA DE SAÍDA") + (hasShotgun && shells > 0 ? " • atire quando ele chegar perto" : ""), near);
        }
    }

    // --- agarrão: cena de susto + game over estilizado ---
    function setGameOverText(kind, hadGun) {
        const t = $("goTitle"), p = $("goText"), h = $("goHint");
        gameOverModal.classList.toggle("grab-over", kind === "grab");
        if (kind === "grab") {
            t.textContent = "ELE TE PEGOU"; p.textContent = hadGun ? "O Espécime 064 te arrastou para o escuro do duto." : "Acho que deixei algo passar na Sala de Contenção...";
            h.textContent = hadGun ? "Você volta à bifurcação. Espere ele chegar perto (menos de 1/3 da tela) e atire com [F], [ESPAÇO] ou ATIRAR." : "Sem arma não há como detê-lo. Você volta à bifurcação: pegue a espingarda no cofre da cela arrombada.";
        } else { t.textContent = "VOCÊ FOI PEGO"; p.textContent = "A entidade alcançou você no corredor escuro..."; h.textContent = ""; }
    }
    function grabPlayer() {
        endSlowmo(); endCine(); sound.stopChase(0.5);
        specChase.active = false; spec.state = "grab"; canMove = false; hideAction(); setBanner(""); setAmmo();
        labFailed = true; const gun = hasShotgun;
        grabScene.classList.remove("hidden", "play"); void grabScene.offsetWidth; grabScene.classList.add("play");
        sound.playBigRoar(); setTimeout(() => sound.playThud(), 700); setTimeout(() => sound.playMetalPounding(), 1050);
        addShake(34); const iv = setInterval(() => addShake(14), 280);
        haptic([250, 90, 400]);
        setTimeout(() => { clearInterval(iv); setGameOverText("grab", gun); gameOverModal.classList.remove("hidden"); grabScene.classList.add("hidden"); grabScene.classList.remove("play"); }, 2700);
    }
    function resetVent() {   // grade de volta ao lugar e duto "apagado"
        const v = $("ventGrille"); v.classList.remove("fall", "rattle", "fallen"); v.style.animation = "none"; void v.offsetWidth; v.style.animation = "";
        $("ventHole").classList.remove("active");
    }
    function checkpointHub() {   // GAME OVER → renasce na BIFURCAÇÃO com o mapa e o alarme resetados
        labFailed = false; gameOverModal.classList.add("hidden"); setGameOverText("corridor"); endSlowmo(); endCine(); slowmo.done = false; sound.stopChase(0.3);
        specChase.active = false; spec.state = "hidden"; spec.room = 0; spec.stun = 0; spec.delay = 0;
        specEl.classList.add("hidden"); specEl.classList.remove("hurt", "walk", "drop", "roar", "dir-r");
        hasKey = false; keyOnFloor = false; keyRoom = 0; endShown = false; exitHint = false; $("dirDoor").classList.remove("door-open");
        shells = hasShotgun ? 2 : 0; pendingLabEvent = false; labEventRunning = false;
        labEventArmed = notesRead.every(Boolean);   // ao voltar ao laboratório a cena dispara de novo
        resetVent(); stopEmergency();
        game.classList.remove("heavy-pounding", "shake"); game.style.transform = ""; shake.amp = 0; shake.on = false;
        grabScene.classList.add("hidden"); grabScene.classList.remove("play"); fxLayer.innerHTML = ""; muzzle.classList.remove("fire");
        setBanner(""); setAmmo(); updateKeyEl();
        enterRoom(4, 25, 12, hasShotgun ? "Você renasce na bifurcação. A espingarda está carregada. Escolha seu caminho." : "Você renasce na bifurcação. Sem arma você não escapa: a SALA DE CONTENÇÃO fica à esquerda.");
    }

    // --- cena scriptada do laboratório ---
    // --- CUTSCENE DA PERSEGUIÇÃO NO LABORATÓRIO: o herói corre sozinho até a Porta de Saída, vê que está trancada, o monstro avança e vem a câmera lenta ---
    const cine = { on: false, phase: "run", t: 0 };
    function startCine() {
        cine.on = true; cine.phase = "run"; cine.t = 0; spec.speed = 0.3; vx = vy = 0; hideAction();
        $("slowText").textContent = ""; document.body.classList.add("cine");
        showStory("CORRA!!! Para a Porta de Saída!"); addShake(16); haptic([80, 40, 80]);
    }
    function endCine() { cine.on = false; spec.speed = 0.12; document.body.classList.remove("cine"); }
    function cineAxis() {   // piloto automático: sempre rumo à saída do cenário atual, mantendo a faixa central
        if (cine.phase !== "run" || slowmo.on) return { x: 0, y: 0, m: 0 };
        const dir = currentRoom === 8 ? -1 : 1, ay = Math.max(-1, Math.min(1, (12 - playerY) / 4));
        return { x: dir, y: ay * 0.5, m: 1 };
    }
    let cineTick = 0;
    function cineFx() {   // poeira nos pés, tremor de corrida e passos pesados
        if (cine.phase !== "run" || slowmo.on) return;
        cineTick++;
        if (cineTick % 9 === 0) dust(playerX + (facing === "left" ? 3 : -1), playerY + 1, 2);
        if (cineTick % 22 === 0) addShake(4);
    }
    function cineDoor() {   // chegou à porta: tenta abrir... trancada!
        cine.phase = "door"; exitHint = true; vx = vy = 0;
        facing = "right"; player.classList.remove("facing-left", "facing-right", "facing-up", "facing-down", "is-moving"); player.classList.add("facing-right");
        sound.playLocked(); setTimeout(() => sound.playMetalPounding(), 260); setTimeout(() => sound.playLocked(), 700);
        addShake(16); haptic([70, 40, 70]); showStory("TRANCADA!!! A porta não abre... NÃO HÁ SAÍDA!");
        setTimeout(() => {
            if (!cine.on || slowmo.on) return;
            sound.playBigRoar(); addShake(26); haptic([150, 50, 200]);
            if (spec.room !== 6) { spec.room = 6; spec.x = 4; spec.y = 12; }
            spec.state = "chase"; spec.speed = 0.36; spec.stun = 0; spec.delay = 0; spec.dir = 1;
            showStory(slowmo.done ? "" : "Algo enorme vem pela escada... e vem RÁPIDO!");
        }, 1500);
    }

    // --- câmera lenta do clímax: o monstro está prestes a agarrar → o jogador lembra da espingarda ---
    const slowmo = { on: false, t: 0, done: false, gun: false };
    function startSlowmo() {
        slowmo.on = true; slowmo.done = true; slowmo.t = 0; slowmo.gun = hasShotgun && shells > 0;
        canMove = false; vx = vy = 0; hideAction(); player.classList.remove("is-moving");
        facing = spec.x >= playerX ? "right" : "left";
        player.classList.remove("facing-left", "facing-right", "facing-up", "facing-down"); player.classList.add("facing-" + facing);
        if (slowmo.gun) $("slowText").innerHTML = "…a espingarda.<br><b>" + (isTouch ? "TOQUE EM ATIRAR" : "PRESSIONE [F]") + "</b>"; else $("slowText").textContent = "Acho que deixei algo passar na Sala de Contenção...";
        document.body.classList.add("slowmo"); document.body.classList.toggle("slow-gun", slowmo.gun);
        sound.slowMo(true); haptic([40, 50, 40]);
        showStory(slowmo.gun ? "O tempo desacelera... ele está em cima de você! A ESPINGARDA!" : "O tempo desacelera... e você não tem nada para se defender.");
        setBanner(slowmo.gun ? (isTouch ? "🔫 TOQUE EM ATIRAR!" : "🔫 PRESSIONE [F] PARA ATIRAR!") : "", slowmo.gun);
    }
    function endSlowmo() {
        if (!slowmo.on) { document.body.classList.remove("slowmo", "slow-gun"); return; }
        slowmo.on = false; document.body.classList.remove("slowmo", "slow-gun"); sound.slowMo(false);
    }
    function shotFlash(big) {   // clarão branco do disparo na tela inteira
        const f = $("shotFlash"); f.classList.remove("on", "big"); void f.offsetWidth; f.classList.add("on"); if (big) f.classList.add("big");
    }

    // --- conquistas (pop-ups de HUD) ---
    const ACH = {
        silent: ["Sobrevivente Silencioso", "Atravessou a cela sem acordar os olhos."],
        last: ["Por Um Triz", "Você sentiu o hálito da besta antes de puxar o gatilho."]
    };
    const achDone = {}, achQueue = []; let achShowing = false;
    try { Object.keys(ACH).forEach(k => { if (localStorage.getItem("eco_ach_" + k)) achDone[k] = true; }); } catch (e) {}
    function unlockAch(id) {
        if (achDone[id] === 2 || !ACH[id]) return;   // 2 = já exibida nesta sessão
        achDone[id] = 2; try { localStorage.setItem("eco_ach_" + id, "1"); } catch (e) {}
        achQueue.push(id); if (!achShowing) nextAch();
    }
    function nextAch() {
        const id = achQueue.shift(), el = $("achToast");
        if (!id) { achShowing = false; return; }
        achShowing = true; $("achName").textContent = ACH[id][0]; $("achDesc").textContent = ACH[id][1];
        el.classList.remove("show"); void el.offsetWidth; el.classList.add("show");
        sound.playAchievement(); haptic([30, 40, 30]);
        setTimeout(() => { el.classList.remove("show"); setTimeout(nextAch, 500); }, 4200);
    }
    let cellRun = { far: false, woke: false };   // travessia da cela: chegou ao cofre sem pisar em nenhuma gosma?
    function gooWakeCheck() {
        if (cellRun.woke) return;
        if (playerX >= 44) cellRun.far = true;
        const px = playerX + 2, py = playerY + 1;
        for (const g of gooEls) {
            if (g.wall) continue;
            if (Math.abs(px - g.cx) < g.w * 0.42 && Math.abs(py - g.cy) < g.h * 0.42 + 1) {   // só ao pisar em cima da gosma
                cellRun.woke = true; g.el.classList.add("woke"); sound.playWake(); haptic([40, 30, 40]);
                showStory("Os olhos se arregalam... você acordou a gosma!"); break;
            }
        }
    }

    function startLabEvent(replay) {
        if (labEventRunning) return; labEventRunning = true; labEventArmed = false;
        canMove = false; hideAction(); vx = vy = 0;
        const vent = $("ventGrille"), later = (ms, fn) => setTimeout(fn, ms);
        startEmergency();
        if (!replay) {
            showStory("Um som metálico vem do duto de ventilação, bem acima de você...");
            vent.classList.add("rattle"); clawScratch(1.6); addShake(8); sound.playMetalPounding();
            later(1500, () => { clawScratch(2.2); sound.playMetalPounding(); addShake(5); showStory("Garras... algo enorme se arrasta lá dentro!"); });
            later(3000, () => { clawScratch(2.6); sound.playMetalPounding(); setTimeout(() => sound.playMetalPounding(), 220); addShake(16); haptic([60, 30, 60, 30, 90]); });
            later(4200, () => { vent.classList.remove("rattle"); vent.classList.add("fall"); sound.playVentCrash(); sound.playMetalPounding(); addShake(30); haptic([60, 30, 60]); });   // a grade se solta
            later(5150, () => { sound.playThud(); addShake(22); dust(90, 14, 14); haptic([200, 40, 120]); });                                         // ...e bate no chão
            later(5700, specDrop);
        } else {
            showStory("O duto vazio range... ele voltou!");
            clawScratch(2.2); later(1300, specDrop);
        }
    }
    function specDrop() {
        $("ventHole").classList.add("active");
        spec.room = 8; spec.x = 90; spec.y = 13; spec.dir = -1; spec.state = "drop"; spec.stun = 0;
        specEl.style.left = spec.x + "%"; specEl.style.bottom = spec.y + "%"; specEl.classList.remove("hidden", "hurt", "walk", "dir-r"); specEl.classList.add("drop");
        setTimeout(() => {   // aterrissagem + rugido
            specEl.classList.remove("drop"); specEl.classList.add("roar");
            sound.playBigRoar(); sound.playGrowl(); sound.playThud(); addShake(44); dust(90, 14, 20);
            const gi = setInterval(() => addShake(16), 260); setTimeout(() => clearInterval(gi), 1500);
            game.classList.add("heavy-pounding"); alarmOverlay.classList.remove("hidden");
            showStory("ESPÉCIME 064!!!");
            haptic([220, 60, 300]);   // o monstro despenca do duto
            sound.startChase("lab");
            setTimeout(() => game.classList.remove("heavy-pounding"), 700);
            setTimeout(beginSpecChase, 1500);
        }, 650);
    }
    function beginSpecChase() {
        specEl.classList.remove("roar"); alarmOverlay.classList.add("hidden");
        exitHint = false; slowmo.done = false; spec.state = "chase"; specChase.active = true; spec.delay = 0; spec.dir = -1; spec.stun = 0.9;   // margem justa antes de ele correr
        canMove = true; labEventRunning = false; setAmmo();
        startCine();
    }

    // ==========================================
    // CUTSCENE FINAL 3D — motor próprio em Canvas (perspectiva real, ordenação por profundidade, sem bibliotecas)
    // ==========================================
    const Ending3D = (function () {
        const cvs = $("endCanvas"), g = cvs.getContext("2d", { alpha: false });
        const NEAR = 0.15, FAR = 430, NB = 1536, FOGD = 0.0046, FOGC = [188, 217, 242], WL = -0.9;
        const SUNV = (function () { const v = [0.5, 0.5, 0.95], l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; })();
        const SHD = (function () { const l = Math.hypot(SUNV[0], SUNV[2]); return [-SUNV[0] / l, -SUNV[2] / l]; })();   // direção das sombras no chão
        const lerp = (a, b, t) => a + (b - a) * t, clamp = (v, a, b) => v < a ? a : v > b ? b : v;
        const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
        const easeIO = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
        let seed = 90210; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
        const rr = (a, b) => a + (b - a) * rnd();

        // ---------- ruído e altura do terreno ----------
        const hash2 = (x, z) => { const h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return h - Math.floor(h); };
        function vnoise(x, z) {
            const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi, u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
            return lerp(lerp(hash2(xi, zi), hash2(xi + 1, zi), u), lerp(hash2(xi, zi + 1), hash2(xi + 1, zi + 1), u), v);
        }
        function fbm(x, z, o) { let a = 0.5, f = 1, s = 0; for (let i = 0; i < o; i++) { s += a * vnoise(x * f, z * f); f *= 2.03; a *= 0.5; } return s; }
        function ridged(x, z, o) { let a = 0.5, f = 1, s = 0; for (let i = 0; i < o; i++) { s += a * (1 - Math.abs(2 * vnoise(x * f, z * f) - 1)); f *= 2.07; a *= 0.5; } return s; }
        const riverX = z => 6 + (z + 20) * 0.19 + 2.2 * Math.sin(z * 0.13);
        function H(x, z) {
            let h = (fbm(x * 0.06 + 3.1, z * 0.06 + 7.7, 3) - 0.5) * 1.3 + (fbm(x * 0.21, z * 0.21, 2) - 0.5) * 0.25;
            const rx = (x - riverX(z)) / 2.8, rt = sstep(-24, -14, z) * (1 - sstep(36, 40, z)), riv = Math.exp(-rx * rx) * rt;
            const d = Math.hypot(x * 0.7, z - 10);
            h += sstep(55, 200, d) * (ridged(x * 0.011 + 5, z * 0.011 + 2, 5) * 82 + 8);
            h += sstep(-4, -26, z) * (12 + fbm(x * 0.05, z * 0.05, 3) * 8) * (1 - 0.88 * riv);
            const fl = Math.exp(-(((x + 4.5) / 10) ** 2 + ((z - 3) / 11) ** 2)); h = lerp(h, 0.15, fl * 0.85);   // pátio plano diante do bunker
            h -= 2.5 * riv;
            const pd = Math.hypot((x - 17.5) / 8, (z - 42) / 7.5); h -= 2.8 * Math.exp(-pd * pd);                 // lago ao pé da cachoeira
            const mx = clamp((x - 7.5) / 2.5, 0, 1) * clamp((32.5 - x) / 2.5, 0, 1), mz = clamp((z - 47.5) / 2.5, 0, 1) * (1 - sstep(60, 72, z)), cm = mx * mz;
            if (cm > 0) {
                const edge = (x >= 15 && x <= 20) ? 0 : 1, top = 16 + edge * (fbm(x * 0.3, z * 0.3, 2) - 0.5) * 5;
                h = lerp(h, top, cm);
                if (z >= 50 && z <= 63) h -= 1.3 * Math.exp(-(((x - 17.5) / 2.2) ** 2)) * cm;                     // leito do riacho no topo
            }
            return h;
        }
        function wlAt(x, z) { return (z >= 50 && z <= 63 && x >= 15 && x <= 20) ? 15.15 : WL; }

        // ---------- buffers de geometria ----------
        const MAXV = 70000, MAXT = 46000;
        const VX = new Float32Array(MAXV), VY = new Float32Array(MAXV), VZ = new Float32Array(MAXV);
        const TI = new Uint32Array(MAXT * 3), TCOL = new Uint8ClampedArray(MAXT * 3), TF = new Uint8Array(MAXT), TN = new Float32Array(MAXT * 3), TCEN = new Float32Array(MAXT * 3);
        const CXa = new Float32Array(MAXV), CYa = new Float32Array(MAXV), CZa = new Float32Array(MAXV), SXa = new Float32Array(MAXV), SYa = new Float32Array(MAXV);
        const TB = new Float32Array(MAXT), DEP = new Float32Array(MAXT), NXT = new Int32Array(MAXT), HEAD = new Int32Array(NB);
        let NV = 0, NT = 0, SNV = 0, SNT = 0, triBias = 0;   // triBias: puxa peças "por cima" (cabelo, rosto, cinto) para frente na ordenação, evitando artefatos de profundidade
        const addV = (x, y, z) => { VX[NV] = x; VY[NV] = y; VZ[NV] = z; return NV++; };
        // flags: 1 dupla face · 2 terreno (profundidade = vértice mais distante) · 4 água (idem, desenhada antes do terreno vizinho) · 8 emissivo (sem sombra/neblina)
        function addTri(a, b, c, col, fl, ref, shade) {
            if (NT >= MAXT) return -1;
            const ax = VX[a], ay = VY[a], az = VZ[a], ux = VX[b] - ax, uy = VY[b] - ay, uz = VZ[b] - az, vx = VX[c] - ax, vy = VY[c] - ay, vz = VZ[c] - az;
            let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const len = Math.hypot(nx, ny, nz); if (len < 1e-9) return -1;
            nx /= len; ny /= len; nz /= len;
            const cx = (ax + VX[b] + VX[c]) / 3, cy = (ay + VY[b] + VY[c]) / 3, cz = (az + VZ[b] + VZ[c]) / 3;
            if (ref && nx * (cx - ref[0]) + ny * (cy - ref[1]) + nz * (cz - ref[2]) < 0) { const t = b; b = c; c = t; nx = -nx; ny = -ny; nz = -nz; }
            const t3 = NT * 3; TI[t3] = a; TI[t3 + 1] = b; TI[t3 + 2] = c; TN[t3] = nx; TN[t3 + 1] = ny; TN[t3 + 2] = nz; TCEN[t3] = cx; TCEN[t3 + 1] = cy; TCEN[t3 + 2] = cz;
            const ndl = Math.max(0, nx * SUNV[0] + ny * SUNV[1] + nz * SUNV[2]), sh = shade === undefined ? 1 : shade;
            if (fl & 8) { TCOL[t3] = col[0]; TCOL[t3 + 1] = col[1]; TCOL[t3 + 2] = col[2]; }
            else {
                const sky = 0.10 * ny, dif = 0.80 * ndl * sh;
                TCOL[t3] = col[0] * (0.50 + sky + dif * 1.08); TCOL[t3 + 1] = col[1] * (0.55 + sky + dif); TCOL[t3 + 2] = col[2] * (0.66 + sky + dif * 0.84);
            }
            TF[NT] = fl; TB[NT] = triBias; return NT++;
        }
        const jit = (c, a) => { const k = 1 + (rnd() - 0.5) * a; return [c[0] * k, c[1] * k, c[2] * k]; };
        function quad(a, b, c, d, col, fl, ref, shade) { addTri(a, b, c, col, fl, ref, shade); addTri(a, c, d, col, fl, ref, shade); }
        const BOXF = [[0, 2, 6, 4], [1, 3, 7, 5], [0, 1, 5, 4], [2, 3, 7, 6], [0, 1, 3, 2], [4, 5, 7, 6]];
        function box(cx, cy, cz, sx, sy, sz, col, fl, xf) {   // caixa (opcionalmente transformada por xf) — usada em cenário e personagem
            const p = [], hx = sx / 2, hy = sy / 2, hz = sz / 2;
            for (let i = 0; i < 8; i++) { let q = [cx + ((i & 1) ? hx : -hx), cy + ((i & 2) ? hy : -hy), cz + ((i & 4) ? hz : -hz)]; if (xf) q = xf(q); p.push(addV(q[0], q[1], q[2])); }
            let ct = [cx, cy, cz]; if (xf) ct = xf(ct);
            for (const f of BOXF) quad(p[f[0]], p[f[1]], p[f[2]], p[f[3]], col, fl || 0, ct);
        }
        function cone(cx, cy, cz, r, h, seg, col, rot, shade, cj) {
            const ring = [], ap = addV(cx, cy + h, cz);
            for (let i = 0; i < seg; i++) { const a = rot + i / seg * 6.2832, rj = r * (1 + (rnd() - 0.5) * 0.18); ring.push(addV(cx + Math.cos(a) * rj, cy + (rnd() - 0.5) * 0.12, cz + Math.sin(a) * rj)); }
            for (let i = 0; i < seg; i++) addTri(ring[i], ring[(i + 1) % seg], ap, jit(col, cj || 0.14), 0, [cx, cy + h * 0.35, cz], shade);
        }
        function prism(cx, cy, cz, r0, r1, h, seg, col, shade) {
            const b = [], t = [];
            for (let i = 0; i < seg; i++) { const a = i / seg * 6.2832; b.push(addV(cx + Math.cos(a) * r0, cy, cz + Math.sin(a) * r0)); t.push(addV(cx + Math.cos(a) * r1, cy + h, cz + Math.sin(a) * r1)); }
            for (let i = 0; i < seg; i++) { const j = (i + 1) % seg; quad(b[i], b[j], t[j], t[i], jit(col, 0.12), 0, [cx, cy + h / 2, cz], shade); }
        }
        function blob(cx, cy, cz, rx, ry, rz, rings, seg, col, jv, shade, cj) {   // esfera de baixo polígono (copas, arbustos, pedras)
            const top = addV(cx, cy + ry * (1 + (rnd() - 0.5) * jv), cz), bot = addV(cx, cy - ry * 0.85, cz), rg = [];
            for (let k = 1; k <= rings; k++) {
                const ph = k / (rings + 1) * Math.PI, row = [];
                for (let i = 0; i < seg; i++) { const a = i / seg * 6.2832 + k * 0.5, j = 1 + (rnd() - 0.5) * jv; row.push(addV(cx + Math.cos(a) * Math.sin(ph) * rx * j, cy + Math.cos(ph) * ry * j, cz + Math.sin(a) * Math.sin(ph) * rz * j)); }
                rg.push(row);
            }
            const ref = [cx, cy, cz];
            for (let i = 0; i < seg; i++) addTri(top, rg[0][(i + 1) % seg], rg[0][i], jit(col, cj || 0.16), 0, ref, shade);
            for (let k = 0; k < rings - 1; k++) for (let i = 0; i < seg; i++) { const j = (i + 1) % seg; quad(rg[k][i], rg[k][j], rg[k + 1][j], rg[k + 1][i], jit(col, cj || 0.16), 0, ref, shade); }
            for (let i = 0; i < seg; i++) addTri(bot, rg[rings - 1][i], rg[rings - 1][(i + 1) % seg], jit(col, 0.2), 0, ref, shade);
        }

        // ---------- construção do mundo ----------
        const PATH = [[-6, -3.4], [-6, -1.0], [-5.4, 1.5], [-3.6, 5.0], [-2.2, 8.6]];
        const PLEN = []; let PTOT = 0;
        for (let i = 1; i < PATH.length; i++) { PTOT += Math.hypot(PATH[i][0] - PATH[i - 1][0], PATH[i][1] - PATH[i - 1][1]); PLEN.push(PTOT); }
        function pathAt(d) {
            d = clamp(d, 0, PTOT); let i = 0; while (i < PLEN.length - 1 && d > PLEN[i]) i++;
            const s0 = i ? PLEN[i - 1] : 0, k = (d - s0) / (PLEN[i] - s0);
            return [lerp(PATH[i][0], PATH[i + 1][0], k), lerp(PATH[i][1], PATH[i + 1][1], k)];
        }
        function distToPath(x, z) {
            let best = 1e9;
            for (let i = 1; i < PATH.length; i++) {
                const ax = PATH[i - 1][0], az = PATH[i - 1][1], bx = PATH[i][0], bz = PATH[i][1], vx = bx - ax, vz = bz - az, t = clamp(((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz), 0, 1);
                best = Math.min(best, Math.hypot(x - (ax + vx * t), z - (az + vz * t)));
            }
            return best;
        }
        const TREES = [];   // {x,z,y,type: 0 pinheiro · 1 carvalho · 2 arbusto · 3 pinheiro distante · 4 pedra, s}
        function spotOk(x, z, pad) {
            if (x > -12.5 - pad && x < 0.5 + pad && z > -14.5 - pad && z < 2.5 + pad) return false;                         // bunker
            if (Math.abs(x - riverX(z)) < 5.5 + pad && z > -26 && z < 41) return false;                                       // rio
            if (Math.hypot((x - 17.5) / (11 + pad), (z - 42) / (10 + pad)) < 1) return false;                                 // lago
            if (x > 4 && x < 34 && z > 44 && z < 52) return false;                                                            // paredão da cachoeira
            if (z >= 50 && z <= 64 && x > 13.5 && x < 21.5) return false;                                                    // riacho no topo
            if (distToPath(x, z) < 2.4 + pad) return false;
            return true;
        }
        function scatter() {
            let tries = 0;
            while (TREES.filter(t => t.type <= 1).length < 92 && tries++ < 6000) {
                const x = rr(-58, 58), z = rr(-34, 62), e = ((x + 1) / 17) ** 2 + ((z - 14) / 14) ** 2;
                if (e < 1 || !spotOk(x, z, 1.2)) continue;
                const y = H(x, z); if (y < WL + 0.7 || y > 24) continue;
                if (rnd() > Math.min(1, 0.25 + (e - 1) * 0.5)) continue;
                TREES.push({ x, z, y, type: (rnd() < 0.68 ? 0 : 1), s: rr(0.85, 1.45), rot: rnd() * 6.28 });
            }
            tries = 0; let nb = 0;
            while (nb < 30 && tries++ < 3000) {                // arbustos (também pelo gramado)
                const x = rr(-30, 30), z = rr(-12, 40); if (!spotOk(x, z, 0.8)) continue;
                const y = H(x, z); if (y < WL + 0.7) continue; TREES.push({ x, z, y, type: 2, s: rr(0.6, 1.2), rot: rnd() * 6.28 }); nb++;
            }
            tries = 0; nb = 0;
            while (nb < 30 && tries++ < 3000) {                // pedras (longe do centro do gramado)
                const x = rr(-40, 45), z = rr(-12, 54); if (!spotOk(x, z, 0.5) || ((x + 1) / 11) ** 2 + ((z - 12) / 9) ** 2 < 1) continue;
                const y = H(x, z); if (y < WL + 0.4) continue; TREES.push({ x, z, y, type: 4, s: rr(0.4, 1.15), rot: rnd() * 6.28 }); nb++;
            }
            tries = 0; nb = 0;
            while (nb < 150 && tries++ < 8000) {               // pinheiros distantes (encostas das montanhas)
                const x = rr(-210, 210), z = rr(-90, 210);
                if (x > -52 && x < 52 && z > -39 && z < 64) continue;
                const y = H(x, z); if (y > 30 || y < 0.5) continue;
                TREES.push({ x, z, y, type: 3, s: rr(2.2, 4.2), rot: rnd() * 6.28 }); nb++;
            }
        }
        function shadowAt(x, z) {
            let s = 1;
            for (let i = 0; i < TREES.length; i++) {
                const T = TREES[i]; if (T.type === 3 || T.type === 2) continue;
                const h = T.type === 0 ? 4.4 * T.s : T.type === 1 ? 4.2 * T.s : 0.9 * T.s, L = h * 1.6, vx = x - T.x, vz = z - T.z;
                if (Math.abs(vx) > L + 3 || Math.abs(vz) > L + 3) continue;
                const p = clamp(vx * SHD[0] + vz * SHD[1], 0, L), dx = vx - p * SHD[0], dz = vz - p * SHD[1], dist = Math.hypot(dx, dz), rad = (T.type === 4 ? 0.9 : 1.5) * T.s * (1 - 0.45 * p / L);
                if (dist < rad) s = Math.min(s, 1 - 0.40 * (1 - dist / rad));
            }
            return s;
        }
        function groundCol(x, y, z, ny) {
            const n = fbm(x * 0.13, z * 0.13, 2), n2 = fbm(x * 0.5 + 9, z * 0.5, 2), sl = 1 - ny;
            let c = [lerp(54, 104, n), lerp(116, 168, n), lerp(40, 58, n)];
            if (n2 > 0.62) c = [c[0] * 1.12, c[1] * 1.04, c[2] * 0.9];
            const far = sstep(8, 26, y); c = [lerp(c[0], 40, far * 0.7), lerp(c[1], 92, far * 0.7), lerp(c[2], 38, far * 0.7)];
            const rock = Math.max(sstep(0.26, 0.52, sl), sstep(24, 36, y) * 0.8);
            const rc = [lerp(104, 138, n2), lerp(98, 128, n2), lerp(90, 120, n2)]; c = [lerp(c[0], rc[0], rock), lerp(c[1], rc[1], rock), lerp(c[2], rc[2], rock)];
            const snow = sstep(36, 46, y + n * 7) * (1 - sstep(0.45, 0.8, sl) * 0.7);
            c = [lerp(c[0], 244, snow), lerp(c[1], 247, snow), lerp(c[2], 252, snow)];
            const sand = (1 - sstep(WL + 0.05, WL + 0.9, y)) * (y < 2 ? 1 : 0);
            if (sand > 0) c = [lerp(c[0], 188, sand), lerp(c[1], 172, sand), lerp(c[2], 124, sand)];
            return c;
        }
        const WATER = [], WATERF = [];   // índices de triângulos animados
        function buildTerrain(x0, z0, step, nx, nz, skipRect, withWater) {
            const hv = new Float32Array((nx + 1) * (nz + 1)), vi = new Int32Array((nx + 1) * (nz + 1)), raw = new Float32Array((nx + 1) * (nz + 1));
            for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) { const x = x0 + i * step, z = z0 + j * step, h = H(x, z); raw[j * (nx + 1) + i] = h; hv[j * (nx + 1) + i] = Math.max(h, withWater ? wlAt(x, z) : -50); }
            for (let k = 0; k < hv.length; k++) { const i = k % (nx + 1), j = (k / (nx + 1)) | 0; vi[k] = addV(x0 + i * step, hv[k], z0 + j * step); }
            for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
                const xa = x0 + i * step, za = z0 + j * step;
                if (skipRect && xa >= skipRect[0] && xa + step <= skipRect[1] && za >= skipRect[2] && za + step <= skipRect[3]) continue;
                const k00 = j * (nx + 1) + i, k10 = k00 + 1, k01 = k00 + nx + 1, k11 = k01 + 1, cxm = xa + step / 2, czm = za + step / 2, wl = wlAt(cxm, czm);
                const ks = [[k00, k10, k11], [k00, k11, k01]];
                if (withWater && Math.min(raw[k00], raw[k10], raw[k01], raw[k11]) < wl) {   // célula com água: um quadrilátero de água por baixo da margem
                    const a = addV(xa, wl, za), b = addV(xa + step, wl, za), c = addV(xa + step, wl, za + step), d = addV(xa, wl, za + step);
                    const bc = wl > 5 ? [60, 150, 170] : [34, 98, 138];
                    for (const t of [[a, b, c], [a, c, d]]) { const id = addTri(t[0], t[1], t[2], bc, 1 | 4, [xa, wl - 5, za]); if (id >= 0) WATER.push(id); }
                }
                for (const t of ks) {
                    const r = [raw[t[0]], raw[t[1]], raw[t[2]]]; if (withWater && Math.max(r[0], r[1], r[2]) <= wl + 0.02) continue;   // totalmente submerso: só a água aparece
                    const ay = hv[t[0]], by = hv[t[1]], cy = hv[t[2]], vA = [VX[vi[t[0]]], ay, VZ[vi[t[0]]]], vB = [VX[vi[t[1]]], by, VZ[vi[t[1]]]], vC = [VX[vi[t[2]]], cy, VZ[vi[t[2]]]];
                    const ux = vB[0] - vA[0], uy = vB[1] - vA[1], uz = vB[2] - vA[2], wx = vC[0] - vA[0], wy = vC[1] - vA[1], wz = vC[2] - vA[2];
                    let nyv = Math.abs(uz * wx - ux * wz); const nl = Math.hypot(uy * wz - uz * wy, nyv, ux * wy - uy * wx) || 1; nyv /= nl;
                    const mx = (vA[0] + vB[0] + vC[0]) / 3, mz = (vA[2] + vB[2] + vC[2]) / 3, my = (ay + by + cy) / 3;
                    const col = groundCol(mx, my, mz, nyv), sh = withWater ? shadowAt(mx, mz) : 1;
                    addTri(vi[t[0]], vi[t[1]], vi[t[2]], col, 1 | 2, [mx, my - 20, mz], sh);
                }
            }
        }
        function buildTrees() {
            for (const T of TREES) {
                const s = T.s, x = T.x, z = T.z, y = T.y - 0.12;
                if (T.type === 0) {
                    prism(x, y, z, 0.2 * s, 0.14 * s, 1.5 * s, 5, [92, 62, 38], 1);
                    const tiers = [[2.0, 0.9, 2.5], [1.55, 2.0, 2.3], [1.05, 3.1, 2.0]];
                    tiers.forEach((tr, k) => cone(x, y + tr[1] * s, z, tr[0] * s, tr[2] * s, 8, [lerp(26, 44, k / 2), lerp(88, 124, k / 2), lerp(46, 58, k / 2)], T.rot + k, 1, 0.2));
                } else if (T.type === 1) {
                    prism(x, y, z, 0.26 * s, 0.17 * s, 2.1 * s, 6, [96, 68, 42], 1);
                    const gc = [lerp(72, 120, rnd()), lerp(150, 186, rnd()), 52];
                    blob(x, y + 3.5 * s, z, 1.9 * s, 1.55 * s, 1.9 * s, 3, 7, gc, 0.28, 1, 0.2);
                    blob(x + 0.9 * s, y + 3.0 * s, z + 0.4 * s, 1.2 * s, 1.0 * s, 1.2 * s, 2, 6, gc, 0.25, 1, 0.2);
                    blob(x - 0.8 * s, y + 3.1 * s, z - 0.5 * s, 1.15 * s, 1.0 * s, 1.15 * s, 2, 6, [gc[0] * 0.9, gc[1] * 0.95, gc[2]], 0.25, 1, 0.2);
                } else if (T.type === 2) {
                    blob(x, y + 0.5 * s, z, 0.95 * s, 0.7 * s, 0.95 * s, 2, 6, [lerp(50, 86, rnd()), lerp(120, 160, rnd()), 48], 0.3, 1, 0.2);
                } else if (T.type === 3) {
                    cone(x, y + 0.5 * s, z, 1.4 * s, 4.6 * s, 6, [32, 90, 52], T.rot, 1, 0.2);
                } else {
                    blob(x, y + 0.25 * T.s, z, 1.0 * s, 0.62 * s, 0.85 * s, 2, 6, [lerp(112, 140, rnd()), lerp(114, 140, rnd()), lerp(104, 124, rnd())], 0.42, 1, 0.12);
                }
            }
        }
        function buildPlants() {
            for (let i = 0; i < 190; i++) {   // tufos de grama (lâminas) e flores — sobretudo no gramado
                const x = rr(-24, 18), z = rr(-6, 30); if (!spotOk(x, z, 0)) continue; const y = H(x, z); if (y < WL + 0.5) continue;
                if (i % 3 !== 0) {
                    for (let k = 0; k < 3; k++) {
                        const a = rnd() * 6.28, hh = rr(0.35, 0.8), w = 0.05, lean = rr(0.1, 0.3);
                        const b1 = addV(x + Math.cos(a) * 0.08 - w, y, z + Math.sin(a) * 0.08), b2 = addV(x + Math.cos(a) * 0.08 + w, y, z + Math.sin(a) * 0.08), tp = addV(x + Math.cos(a) * (0.08 + lean), y + hh, z + Math.sin(a) * (0.08 + lean));
                        addTri(b1, b2, tp, jit([lerp(56, 110, rnd()), lerp(130, 178, rnd()), 44], 0.1), 1, null, 1);
                    }
                } else {
                    const hh = rr(0.35, 0.6), pc = [[255, 214, 70], [250, 250, 245], [236, 98, 130], [168, 118, 232], [255, 150, 60]][(rnd() * 5) | 0], r = 0.08;
                    const sa = addV(x - 0.015, y, z), sb = addV(x + 0.015, y, z), st = addV(x, y + hh, z); addTri(sa, sb, st, [62, 130, 48], 1, null, 1);
                    const p0 = addV(x - r, y + hh, z), p1 = addV(x, y + hh + 0.02, z - r), p2 = addV(x + r, y + hh, z), p3 = addV(x, y + hh + 0.02, z + r), pc0 = addV(x, y + hh + 0.05, z);
                    for (const q of [[p0, p1], [p1, p2], [p2, p3], [p3, p0]]) addTri(q[0], q[1], pc0, pc, 1 | 8, null, 1);
                }
            }
        }
        function buildBunker() {
            const c = [124, 128, 126], c2 = [104, 108, 108], first = NT;
            box(-8.2, 1.7, -7.5, 2.6, 3.4, 11, c, 0); box(-3.8, 1.7, -7.5, 2.6, 3.4, 11, c, 0);                // corpo esquerdo/direito
            box(-6, 3.0, -7.5, 1.8, 0.8, 11, c, 0); box(-6, 1.3, -8.8, 1.8, 2.6, 8.4, c2, 0);                 // verga + preenchimento atrás do vestíbulo
            box(-6, 3.55, -7.5, 7.4, 0.28, 12, [78, 118, 52], 0);                                              // telhado com grama
            box(-6, 3.35, -1.85, 7.0, 0.22, 0.3, [236, 190, 40], 0);                                           // faixa de alerta sobre a porta
            box(-6, 2.78, -1.8, 1.0, 0.24, 0.08, [20, 110, 60], 8);                                            // placa SAÍDA (luminosa)
            box(-6.97, 1.28, -1.1, 0.07, 2.5, 1.75, [96, 100, 108], 0);                                        // folha da porta, aberta junto à ombreira
            box(-6, 0.1, -0.6, 1.9, 0.12, 3.4, [148, 144, 136], 0);                                            // laje de concreto na saída
            box(-6.2, 0.08, 3.6, 1.7, 0.1, 2.4, [150, 146, 138], 0); box(-4.6, 0.07, 6.4, 1.6, 0.1, 2.2, [148, 144, 136], 0);
            box(-9.2, 3.95, -5.0, 0.9, 0.5, 0.9, [90, 96, 98], 0); box(-3.0, 4.2, -9.4, 0.18, 1.8, 0.18, [70, 74, 78], 0);   // respiro e antena
            box(-6, 0.06, -3.4, 1.8, 0.1, 2.5, [34, 40, 50], 0);
            for (let i = first; i < NT; i++) {                  // interior do vestíbulo fica na penumbra
                const cx = TCEN[i * 3], cy = TCEN[i * 3 + 1], cz = TCEN[i * 3 + 2];
                if (cx > -6.98 && cx < -5.02 && cz > -4.7 && cz < -1.9 && cy < 2.7) { const k = 0.30 - clamp((-1.9 - cz) / 2.8, 0, 1) * 0.16; TCOL[i * 3] *= k * 0.9; TCOL[i * 3 + 1] *= k * 0.95; TCOL[i * 3 + 2] *= k * 1.3; }
            }
            box(-6, 2.45, -4.45, 0.5, 0.12, 0.12, [255, 70, 50], 8);                                           // luz de emergência no fundo
        }
        function buildCliff() {
            for (let i = 0; i < 16; i++) {                       // lajes de rocha na parede
                const x = rr(8, 29), yy = rr(1.5, 14), zf = 47.4 + 2.5 * (yy + 0.9) / 16 - 0.2;
                if (x > 14.2 && x < 20.8) continue;
                blob(x, yy, zf, rr(1.0, 2.0), rr(0.5, 1.1), rr(0.6, 1.0), 2, 6, [lerp(112, 140, rnd()), lerp(104, 128, rnd()), lerp(94, 116, rnd())], 0.35, 1, 0.12);
            }
            const xs = [15, 16.25, 17.5, 18.75, 20], rows = 14;                   // a cachoeira: faixas de água caindo do topo ao lago
            const mv = [];
            for (let r = 0; r <= rows; r++) { const k = r / rows, row = []; for (let c = 0; c < xs.length; c++) { const jx = (r > 0 && r < rows) ? (rnd() - 0.5) * 0.12 : 0; row.push(addV(xs[c] + jx, lerp(WL, 15.15, k), lerp(47.2, 49.7, k) + (c % 2 ? 0.05 : 0))); } mv.push(row); }
            for (let r = 0; r < rows; r++) for (let c = 0; c < xs.length - 1; c++) {
                const ids = [addTri(mv[r][c], mv[r][c + 1], mv[r + 1][c + 1], [210, 232, 245], 1, [17.5, 6, 40], 1), addTri(mv[r][c], mv[r + 1][c + 1], mv[r + 1][c], [210, 232, 245], 1, [17.5, 6, 40], 1)];
                ids.forEach(id => { if (id >= 0) WATERF.push(id); });
            }
        }
        function build() {
            seed = 90210; NV = NT = 0; WATER.length = 0; WATERF.length = 0; TREES.length = 0;
            scatter();
            buildTerrain(-50, -37.5, 2.5, 40, 40, null, true);
            buildTerrain(-237.5, -87.5, 12.5, 38, 24, [-50, 50, -37.5, 62.5], false);
            buildBunker(); buildTrees(); buildPlants(); buildCliff();
            SNV = NV; SNT = NT;
        }

        // ---------- personagem (malha dinâmica, recalculada a cada quadro) ----------
        const rotX = (p, v, a) => { const c = Math.cos(a), s = Math.sin(a), dy = p[1] - v[1], dz = p[2] - v[2]; return [p[0], v[1] + dy * c - dz * s, v[2] + dy * s + dz * c]; };
        const rotZ = (p, v, a) => { const c = Math.cos(a), s = Math.sin(a), dx = p[0] - v[0], dy = p[1] - v[1]; return [v[0] + dx * c - dy * s, v[1] + dx * s + dy * c, p[2]]; };
        const rotY = (p, v, a) => { const c = Math.cos(a), s = Math.sin(a), dx = p[0] - v[0], dz = p[2] - v[2]; return [v[0] + dx * c + dz * s, p[1], v[2] - dx * s + dz * c]; };
        const SKIN = [226, 178, 146], HAIR = [40, 28, 24], JACKET = [50, 84, 128], PANTS = [40, 46, 62], BOOT = [30, 28, 30];
        function buildHero(h) {   // caixas SEM volumes sobrepostos (nada de cabelo/botas/mangas atravessando outras peças)
            const cy = Math.cos(h.yaw), sy = Math.sin(h.yaw);
            const body = p => [h.x + p[0] * cy + p[2] * sy, h.y + p[1] + h.bob, h.z - p[0] * sy + p[2] * cy];
            const sw = h.swing, lift = h.lift;
            for (const sd of [-1, 1]) {   // pernas (coxa/canela até y=0.12) e botas (0–0.12) lado a lado, sem interseção
                const hip = [sd * 0.11, 0.9, 0], a = sd * sw * 0.9, xf = p => body(rotX(p, hip, a));
                box(sd * 0.11, 0.51, 0, 0.19, 0.78, 0.22, PANTS, 0, xf); box(sd * 0.11, 0.06, 0.05, 0.2, 0.12, 0.34, BOOT, 0, xf);
            }
            box(0, 1.19, 0, 0.46, 0.60, 0.26, JACKET, 0, body);   // tronco (0.89–1.49)
            for (const sd of [-1, 1]) {   // braços: manga (0.84–1.46) e mão (0.72–0.84) encostadas, afastadas do tronco
                const sh = [sd * 0.31, 1.46, 0], xf = p => body(rotZ(rotX(p, sh, -sd * sw * 0.8), sh, sd * lift));
                box(sd * 0.31, 1.15, 0, 0.13, 0.62, 0.15, JACKET, 0, xf); box(sd * 0.31, 0.78, 0, 0.11, 0.12, 0.12, SKIN, 0, xf);
            }
            const neck = [0, 1.5, 0], hx = p => body(rotY(rotX(p, neck, h.hpitch), neck, h.hyaw));
            box(0, 1.53, 0, 0.1, 0.08, 0.1, SKIN, 0, body);                         // pescoço (1.49–1.57)
            box(0, 1.70, 0, 0.22, 0.26, 0.24, SKIN, 0, hx);                         // cabeça (1.57–1.83; z ±0.12)
            triBias = 0.15;   // tudo abaixo fica SEMPRE por cima da pele, em qualquer ângulo da câmera
            // cabelo montado AO REDOR da cabeça (peças encostadas, nunca dentro dela)
            box(0, 1.855, -0.005, 0.25, 0.05, 0.27, HAIR, 0, hx);                   // topo (1.83–1.88)
            box(0, 1.70, -0.135, 0.25, 0.26, 0.03, HAIR, 0, hx);                    // nuca
            box(-0.1225, 1.745, -0.02, 0.025, 0.17, 0.21, HAIR, 0, hx); box(0.1225, 1.745, -0.02, 0.025, 0.17, 0.21, HAIR, 0, hx);   // costeletas
            box(0, 1.8, 0.1275, 0.22, 0.06, 0.015, HAIR, 0, hx);                    // franja na testa
            // rosto em relevo (à frente da pele, sem coincidir com a superfície)
            box(-0.055, 1.725, 0.1275, 0.04, 0.03, 0.015, [18, 18, 22], 0, hx); box(0.055, 1.725, 0.1275, 0.04, 0.03, 0.015, [18, 18, 22], 0, hx);
            box(0, 1.665, 0.126, 0.03, 0.04, 0.012, [206, 156, 126], 0, hx);        // nariz
            box(0, 1.62, 0.1265, 0.07, 0.014, 0.013, [150, 84, 78], 0, hx);         // boca
            triBias = 0;
        }
        const KEYS = [[0, 0, 0], [10.2, 0, 0], [11.8, -0.85, 0.02], [13.0, -0.85, 0.02], [15.0, 0.95, -0.05], [16.4, 0.95, -0.05], [17.6, 0.1, -0.55], [20.0, 0.1, -0.55], [21.8, 0, 0.08], [24, 0, 0.08], [26, 0.5, -0.05], [99, 0.5, -0.05]];
        function headLook(t) {
            for (let i = 1; i < KEYS.length; i++) if (t <= KEYS[i][0]) { const a = KEYS[i - 1], b = KEYS[i], k = easeIO((t - a[0]) / (b[0] - a[0])); return [lerp(a[1], b[1], k), lerp(a[2], b[2], k)]; }
            return [0.5, -0.05];
        }
        const T_WALK0 = 1.0, T_WALK1 = 10.4, TL = 36;
        function heroState(t) {
            const s = clamp((t - T_WALK0) / (T_WALK1 - T_WALK0), 0, 1), u = s * s * (3 - 2 * s) * 0.4 + s * 0.6, d = PTOT * u;
            const p = pathAt(d), q1 = pathAt(d + 1.2), q0 = pathAt(Math.max(0, d - 1.2));
            let heading = Math.atan2(q1[0] - q0[0], q1[1] - q0[1]); if (s <= 0) heading = 0;
            const dudS = 0.4 * (6 * s - 6 * s * s) + 0.6, speed = (s > 0 && s < 1) ? PTOT * dudS / (T_WALK1 - T_WALK0) : 0;
            const amp = clamp(speed / 1.1, 0, 1), phase = d / 1.45 * 6.2832, hl = headLook(t);
            const turn = 0.55 * easeIO((t - 22.5) / 3.5), breathe = Math.sin(t * 1.9) * 0.012;
            const lift = 0.62 * easeIO((t - 15.6) / 1.6) * (1 - easeIO((t - 19.4) / 2.2));
            return { x: p[0], z: p[1], y: Math.max(H(p[0], p[1]), 0.12), yaw: heading + turn, swing: Math.sin(phase) * 0.62 * amp, lift: lift + breathe, bob: Math.abs(Math.sin(phase)) * 0.05 * amp + breathe * 0.4, hyaw: hl[0], hpitch: hl[1], speed, phase, d };
        }

        // ---------- câmera cinematográfica ----------
        function orbitCam(t, hs) {
            const A = 10.5, B = 22.5;
            let th, R, hgt;
            if (t < A) { const k = easeIO(t / A); th = Math.PI * k; R = lerp(5.2, 3.7, k); hgt = lerp(1.25, 1.9, k); }
            else { const k = easeIO((t - A) / (B - A)); th = Math.PI + Math.PI * 0.5 * k; R = lerp(3.7, 3.2, k); hgt = lerp(1.9, 1.6, k); }
            const hx = hs.x, hz = hs.z, hy = hs.y, fx = Math.sin(hs.yaw), fz = Math.cos(hs.yaw);
            const pos = [hx + R * Math.sin(th), hy + hgt, hz + R * Math.cos(th)];
            const chest = [hx, hy + 1.35, hz], ahead = [hx + fx * 7, hy + 2.3, hz + fz * 7], head = [hx, hy + 1.62, hz];
            let tg = chest;
            if (t < A) { const k = sstep(0.5, 1, t / A); tg = [lerp(chest[0], ahead[0], k), lerp(chest[1], ahead[1], k), lerp(chest[2], ahead[2], k)]; }
            else { const k = easeIO((t - A) / (B - A)); tg = [lerp(ahead[0], head[0], k), lerp(ahead[1], head[1], k), lerp(ahead[2], head[2], k)]; }
            return { pos, tg, fov: lerp(52, 46, easeIO(t / B)) };
        }
        const CW = [-14, 9.5, -2], TMID = [9, 4, 30];
        function camAt(t, hs) {
            let pos, tg, fov;
            if (t <= 22.5) { const o = orbitCam(t, hs); pos = o.pos; tg = o.tg; fov = o.fov; }
            else {
                const o = orbitCam(22.5, heroState(22.5)), e = easeIO((t - 22.5) / 12.5), e2 = easeIO((t - 24) / 11), tt = Math.max(0, t - 35);
                pos = [lerp(o.pos[0], CW[0], e) + Math.sin(tt * 0.18) * 2.2, lerp(o.pos[1], CW[1], e) + tt * 0.02, lerp(o.pos[2], CW[2], e)];
                const head = [hs.x, hs.y + 1.6, hs.z]; tg = [lerp(head[0], TMID[0], e2) + Math.sin(tt * 0.12) * 3, lerp(head[1], TMID[1], e2), lerp(head[2], TMID[2], e2)];
                fov = lerp(46, 60, e);
            }
            pos[1] = Math.max(pos[1], H(pos[0], pos[2]) + 0.9);
            const dx = tg[0] - pos[0], dy = tg[1] - pos[1], dz = tg[2] - pos[2];
            return { x: pos[0], y: pos[1], z: pos[2], yaw: Math.atan2(dx, dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)), fov: fov * Math.PI / 180 };
        }
        const CAPS = [[2.6, 6.2, "A luz... depois de tanto tempo."], [10.2, 13.8, "O ar tem cheiro de chuva e de terra."], [15.6, 20.2, "Lá embaixo... só havia eco."], [20.6, 25.4, "Mas agora... eu vejo a liberdade."], [26.0, 33.6, "E eu... sobrevivi!"]];   // poema final

        // ---------- renderização ----------
        let W = 640, HH = 360, quality = 1, running = false, raf = 0, tm = 0, last = 0, built = false, frames = 0, costAcc = 0, doneFired = false, opts = {}, capIdx = -2, lastPhaseStep = 0;
        const cam = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, fov: 1, fx: 0, fy: 0, fz: 1, rx: 1, rz: 0, ux: 0, uy: 1, uz: 0, focal: 500 };
        const CLIPF = new Uint8Array(MAXT);
        const sprite = document.createElement("canvas"); sprite.width = sprite.height = 64;
        (function () { const c = sprite.getContext("2d"), gr = c.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.35, "rgba(255,255,255,.45)"); gr.addColorStop(1, "rgba(255,255,255,0)"); c.fillStyle = gr; c.fillRect(0, 0, 64, 64); })();
        const clouds = []; for (let i = 0; i < 8; i++) { const parts = []; for (let k = 0; k < 6; k++) parts.push([(k - 2.5) * 0.55 + rr(-0.15, 0.15), rr(-0.1, 0.18), rr(0.55, 1.0)]); clouds.push({ az: rr(-1.4, 1.9), el: rr(0.3, 0.75), s: rr(0.025, 0.045), parts, v: rr(0.002, 0.006) }); }
        const motes = []; for (let i = 0; i < 90; i++) motes.push({ x: rr(-16, 10), y: rr(0.3, 7), z: rr(-3, 24), sp: rr(0.05, 0.2), ph: rr(0, 6.28) });
        const flies = []; for (let i = 0; i < 6; i++) flies.push({ x: rr(-9, 4), z: rr(6, 18), ph: rr(0, 6.28), col: [[255, 220, 90], [255, 255, 255], [255, 140, 60], [150, 200, 255], [255, 120, 170], [255, 235, 140]][i] });
        const PR = { x: 0, y: 0, z: 0 };
        function proj(x, y, z) {
            const dx = x - cam.x, dy = y - cam.y, dz = z - cam.z, zc = dx * cam.fx + dy * cam.fy + dz * cam.fz; if (zc < 0.4) return null;
            PR.x = W / 2 + (dx * cam.rx + dz * cam.rz) / zc * cam.focal; PR.y = HH / 2 - (dx * cam.ux + dy * cam.uy + dz * cam.uz) / zc * cam.focal; PR.z = zc; return PR;
        }
        function projDir(dx, dy, dz) {
            const zc = dx * cam.fx + dy * cam.fy + dz * cam.fz; if (zc < 0.05) return null;
            PR.x = W / 2 + (dx * cam.rx + dz * cam.rz) / zc * cam.focal; PR.y = HH / 2 - (dx * cam.ux + dy * cam.uy + dz * cam.uz) / zc * cam.focal; PR.z = zc; return PR;
        }
        function resize() {
            const cw = cvs.clientWidth || window.innerWidth, ch = cvs.clientHeight || window.innerHeight;
            cvs.width = Math.max(320, Math.round(cw * quality)); cvs.height = Math.max(180, Math.round(ch * quality)); W = cvs.width; HH = cvs.height;
        }
        function setCamera(c) {
            cam.x = c.x; cam.y = c.y; cam.z = c.z; cam.yaw = c.yaw; cam.pitch = c.pitch; cam.fov = c.fov;
            const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch), cyw = Math.cos(c.yaw), syw = Math.sin(c.yaw);
            cam.fx = cp * syw; cam.fy = sp; cam.fz = cp * cyw; cam.rx = cyw; cam.rz = -syw; cam.ux = -sp * syw; cam.uy = cp; cam.uz = -sp * cyw;
            cam.focal = (HH / 2) / Math.tan(c.fov / 2);
        }
        function drawSky(t) {
            const hw = W / 2, hy = HH / 2 + Math.tan(cam.pitch) * cam.focal;
            g.fillStyle = "rgb(" + FOGC.join(",") + ")"; g.fillRect(0, 0, W, HH);
            const gr = g.createLinearGradient(0, hy - HH * 1.25, 0, hy);
            gr.addColorStop(0, "#164fb0"); gr.addColorStop(0.4, "#2f84e0"); gr.addColorStop(0.75, "#8fc6f4"); gr.addColorStop(1, "rgb(" + FOGC.join(",") + ")");
            g.fillStyle = gr; g.fillRect(0, 0, W, Math.max(0, hy + 2));
            const s = projDir(SUNV[0], SUNV[1], SUNV[2]);   // sol: disco, halo e raios
            if (s) {
                const sx = s.x, sy = s.y, R = W * 0.05;
                g.globalCompositeOperation = "lighter";
                let rg = g.createRadialGradient(sx, sy, 0, sx, sy, W * 0.38); rg.addColorStop(0, "rgba(255,236,170,.34)"); rg.addColorStop(0.2, "rgba(255,214,140,.10)"); rg.addColorStop(1, "rgba(255,200,120,0)"); g.fillStyle = rg; g.fillRect(0, 0, W, HH);
                g.globalCompositeOperation = "source-over";
                rg = g.createRadialGradient(sx, sy, 0, sx, sy, R); rg.addColorStop(0, "#fffef4"); rg.addColorStop(0.55, "#fff3b8"); rg.addColorStop(1, "rgba(255,230,140,0)"); g.fillStyle = rg; g.beginPath(); g.arc(sx, sy, R, 0, 6.2832); g.fill();
            }
            for (const c of clouds) {   // nuvens: direções fixas no céu, derivando devagar
                const az = c.az + t * c.v, ce = Math.cos(c.el), p = projDir(Math.sin(az) * ce, Math.sin(c.el), Math.cos(az) * ce); if (!p) continue;
                const sz = c.s * cam.focal / p.z * 6.5 * ce;
                for (const pass of [0, 1]) for (const q of c.parts) {
                    g.fillStyle = pass ? "rgba(255,255,255,.93)" : "rgba(196,214,236,.9)";
                    g.beginPath(); g.ellipse(p.x + q[0] * sz, p.y + q[1] * sz * 0.5 + (pass ? 0 : sz * 0.12), q[2] * sz * 0.62, q[2] * sz * 0.34, 0, 0, 6.2832); g.fill();
                }
            }
        }
        function drawScene() {
            const hw = W / 2, hh = HH / 2, f = cam.focal, cx = cam.x, cy = cam.y, cz = cam.z, fx = cam.fx, fy = cam.fy, fz = cam.fz, rx = cam.rx, rz = cam.rz, ux = cam.ux, uy = cam.uy, uz = cam.uz;
            for (let i = 0; i < NV; i++) {
                const dx = VX[i] - cx, dy = VY[i] - cy, dz = VZ[i] - cz, zc = dx * fx + dy * fy + dz * fz, xc = dx * rx + dz * rz, yc = dx * ux + dy * uy + dz * uz;
                CXa[i] = xc; CYa[i] = yc; CZa[i] = zc;
                if (zc > NEAR) { const k = f / zc; SXa[i] = hw + xc * k; SYa[i] = hh - yc * k; }
            }
            HEAD.fill(-1);
            for (let t = 0; t < NT; t++) {
                const t3 = t * 3, a = TI[t3], b = TI[t3 + 1], c = TI[t3 + 2], za = CZa[a], zb = CZa[b], zc2 = CZa[c];
                if (za <= NEAR && zb <= NEAR && zc2 <= NEAR) continue;
                const fl = TF[t];
                if (!(fl & 1) && TN[t3] * (cx - TCEN[t3]) + TN[t3 + 1] * (cy - TCEN[t3 + 1]) + TN[t3 + 2] * (cz - TCEN[t3 + 2]) <= 0) continue;
                const inside = za > NEAR && zb > NEAR && zc2 > NEAR;
                if (inside) {
                    const x0 = SXa[a], x1 = SXa[b], x2 = SXa[c], y0 = SYa[a], y1 = SYa[b], y2 = SYa[c];
                    if ((x0 < 0 && x1 < 0 && x2 < 0) || (x0 > W && x1 > W && x2 > W) || (y0 < 0 && y1 < 0 && y2 < 0) || (y0 > HH && y1 > HH && y2 > HH)) continue;
                    if (Math.max(x0, x1, x2) - Math.min(x0, x1, x2) < 0.35 && Math.max(y0, y1, y2) - Math.min(y0, y1, y2) < 0.35) continue;
                }
                CLIPF[t] = inside ? 0 : 1;
                let key = (za + zb + zc2) / 3; if (fl & 6) key = Math.max(za, zb, zc2) + ((fl & 4) ? 0.3 : 0);
                key -= TB[t]; if (key >= FAR) continue; if (key < NEAR) key = NEAR;
                DEP[t] = key; const bk = Math.min(NB - 1, (Math.sqrt(key / FAR) * NB) | 0); NXT[t] = HEAD[bk]; HEAD[bk] = t;
            }
            const fr = FOGC[0], fg = FOGC[1], fb = FOGC[2];
            for (let bk = NB - 1; bk >= 0; bk--) for (let t = HEAD[bk]; t >= 0; t = NXT[t]) {
                const t3 = t * 3, a = TI[t3], b = TI[t3 + 1], c = TI[t3 + 2];
                let fog = 1 - Math.exp(-DEP[t] * FOGD); if (TF[t] & 8) fog *= 0.25;
                g.fillStyle = "rgb(" + ((TCOL[t3] + (fr - TCOL[t3]) * fog) | 0) + "," + ((TCOL[t3 + 1] + (fg - TCOL[t3 + 1]) * fog) | 0) + "," + ((TCOL[t3 + 2] + (fb - TCOL[t3 + 2]) * fog) | 0) + ")";
                if (!CLIPF[t]) {
                    let x0 = SXa[a], y0 = SYa[a], x1 = SXa[b], y1 = SYa[b], x2 = SXa[c], y2 = SYa[c];
                    const mx = (x0 + x1 + x2) / 3, my = (y0 + y1 + y2) / 3;
                    let d0 = Math.hypot(x0 - mx, y0 - my) || 1, d1 = Math.hypot(x1 - mx, y1 - my) || 1, d2 = Math.hypot(x2 - mx, y2 - my) || 1;
                    x0 += (x0 - mx) / d0 * 0.7; y0 += (y0 - my) / d0 * 0.7; x1 += (x1 - mx) / d1 * 0.7; y1 += (y1 - my) / d1 * 0.7; x2 += (x2 - mx) / d2 * 0.7; y2 += (y2 - my) / d2 * 0.7;
                    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.lineTo(x2, y2); g.closePath(); g.fill();
                } else {   // recorte contra o plano próximo (Sutherland–Hodgman)
                    const px = [CXa[a], CXa[b], CXa[c]], py = [CYa[a], CYa[b], CYa[c]], pz = [CZa[a], CZa[b], CZa[c]], ox = [], oy = [], oz = [];
                    for (let i = 0; i < 3; i++) {
                        const j = (i + 1) % 3, ai = pz[i] > NEAR, aj = pz[j] > NEAR;
                        if (ai) { ox.push(px[i]); oy.push(py[i]); oz.push(pz[i]); }
                        if (ai !== aj) { const k = (NEAR - pz[i]) / (pz[j] - pz[i]); ox.push(px[i] + (px[j] - px[i]) * k); oy.push(py[i] + (py[j] - py[i]) * k); oz.push(NEAR); }
                    }
                    if (ox.length < 3) continue;
                    g.beginPath(); for (let i = 0; i < ox.length; i++) { const k = f / oz[i], sx = hw + ox[i] * k, sy = hh - oy[i] * k; if (i) g.lineTo(sx, sy); else g.moveTo(sx, sy); } g.closePath(); g.fill();
                }
            }
        }
        function animateColors(t) {   // água do lago/rio com brilho do sol; cachoeira com listras caindo
            for (let i = 0; i < WATER.length; i++) {
                const id = WATER[i], x = TCEN[id * 3], z = TCEN[id * 3 + 2], w = Math.sin(x * 0.9 + t * 1.5) * Math.cos(z * 0.8 - t * 1.1), hi = w > 0.86 ? (w - 0.86) * 2.2 : 0, hot = z > 49 ? 1 : 0;
                const base = hot ? [70, 156, 176] : [36, 104, 146], k = 0.88 + 0.16 * w;
                TCOL[id * 3] = Math.min(255, base[0] * k + 210 * hi); TCOL[id * 3 + 1] = Math.min(255, base[1] * k + 220 * hi); TCOL[id * 3 + 2] = Math.min(255, base[2] * k + 230 * hi);
            }
            for (let i = 0; i < WATERF.length; i++) {
                const id = WATERF[i], x = TCEN[id * 3], y = TCEN[id * 3 + 1], s = 0.5 + 0.5 * Math.sin(y * 2.6 - t * 9 + x * 3.7) * Math.sin(y * 0.9 - t * 5.5 + x * 7.1), v = 0.72 + 0.28 * s;
                TCOL[id * 3] = 200 * v + 50; TCOL[id * 3 + 1] = 226 * v + 28; TCOL[id * 3 + 2] = 244 * v + 10;
            }
        }
        function drawOverlay(t) {
            const f = cam.focal;
            // névoa/respingos ao pé da cachoeira
            for (let k = 0; k < 14; k++) {
                const ph = ((t * 0.18 + k / 14) % 1), p = proj(17.5 + Math.sin(k * 2.3) * 3.2, WL + 0.4 + ph * 5, 46.4 + Math.cos(k * 1.7) * 1.3); if (!p) continue;
                const sz = f * (3 + ph * 3) / p.z; g.globalAlpha = 0.10 * (1 - ph) * clamp((p.z - 10) / 12, 0, 1); g.drawImage(sprite, p.x - sz / 2, p.y - sz / 2, sz, sz);
            }
            // partículas de pólen/poeira brilhando ao sol
            for (const m of motes) {
                const y = 0.3 + ((m.y + t * m.sp) % 7), x = m.x + Math.sin(t * 0.4 + m.ph) * 0.8, z = m.z + Math.cos(t * 0.3 + m.ph) * 0.8, p = proj(x, y, z); if (!p || p.z > 40) continue;
                const sz = clamp(f * 0.05 / p.z, 2, 9); g.globalAlpha = 0.55 * (0.5 + 0.5 * Math.sin(t * 2 + m.ph)); g.drawImage(sprite, p.x - sz / 2, p.y - sz / 2, sz, sz);
            }
            g.globalAlpha = 1;
            // borboletas
            for (const b of flies) {
                const x = b.x + Math.sin(t * 0.6 + b.ph) * 3, z = b.z + Math.cos(t * 0.45 + b.ph * 1.3) * 3, y = H(x, z) + 0.9 + Math.sin(t * 1.4 + b.ph) * 0.35, p = proj(x, y, z); if (!p || p.z > 45) continue;
                const s = f * 0.11 / p.z, fl = Math.abs(Math.sin(t * 13 + b.ph));
                g.fillStyle = "rgb(" + b.col.join(",") + ")";
                g.beginPath(); g.ellipse(p.x - s * 0.5, p.y, s * 0.5 * (0.25 + fl * 0.75), s * 0.62, -0.4, 0, 6.2832); g.ellipse(p.x + s * 0.5, p.y, s * 0.5 * (0.25 + fl * 0.75), s * 0.62, 0.4, 0, 6.2832); g.fill();
            }
            // pássaros em bando
            for (let i = 0; i < 7; i++) {
                const a = t * 0.11 + i * 0.28, p = proj(6 + Math.cos(a) * 34, 28 + Math.sin(a * 2 + i) * 3 + i * 0.7, 62 + Math.sin(a) * 20); if (!p) continue;
                const s = f * 1.7 / p.z, fl = Math.sin(t * 8 + i * 1.7);
                g.strokeStyle = "rgba(24,30,40,.85)"; g.lineWidth = Math.max(1, s * 0.13); g.lineCap = "round"; g.beginPath(); g.moveTo(p.x - s, p.y - fl * s * 0.5); g.quadraticCurveTo(p.x - s * 0.3, p.y - fl * s * 0.2 - s * 0.15, p.x, p.y); g.quadraticCurveTo(p.x + s * 0.3, p.y - fl * s * 0.2 - s * 0.15, p.x + s, p.y - fl * s * 0.5); g.stroke();
            }
            // clarão do sol (bloom + reflexos de lente) quando ele está no quadro
            const s = projDir(SUNV[0], SUNV[1], SUNV[2]);
            if (s && s.x > 0 && s.x < W && s.y > 0 && s.y < HH) {
                const off = Math.hypot(s.x - W / 2, s.y - HH / 2) / (W * 0.8), inten = clamp(1.1 - off, 0.15, 1);
                g.globalCompositeOperation = "lighter";
                const rg = g.createRadialGradient(s.x, s.y, 0, s.x, s.y, W * 0.5); rg.addColorStop(0, "rgba(255,238,190," + (0.10 * inten) + ")"); rg.addColorStop(1, "rgba(255,238,190,0)"); g.fillStyle = rg; g.fillRect(0, 0, W, HH);
                for (let k = 1; k <= 4; k++) { const px = lerp(s.x, W - s.x, k * 0.27), py = lerp(s.y, HH - s.y, k * 0.27), r = W * (0.012 + k * 0.01); g.fillStyle = "rgba(" + (k % 2 ? "255,220,150" : "150,210,255") + "," + (0.045 * inten) + ")"; g.beginPath(); g.arc(px, py, r, 0, 6.2832); g.fill(); }
                g.globalCompositeOperation = "source-over";
            }
        }
        function frame(now) {
            if (!running) return;
            raf = requestAnimationFrame(frame);
            const dt = Math.min(0.1, (now - last) / 1000); last = now; tm += dt;
            const t0 = performance.now(), hs = heroState(tm);
            NV = SNV; NT = SNT; buildHero(hs);
            setCamera(camAt(tm, hs)); animateColors(tm);
            drawSky(tm); drawScene(); drawOverlay(tm);
            // passos sincronizados com a caminhada (concreto no vestíbulo, grama lá fora)
            const stp = Math.floor(hs.phase / 3.1416); if (hs.speed > 0.1 && stp !== lastPhaseStep) { lastPhaseStep = stp; if (opts.onStep) opts.onStep(hs.z < -1.8 ? "concrete" : "grass"); }
            let ci = -1; for (let i = 0; i < CAPS.length; i++) if (tm >= CAPS[i][0] && tm < CAPS[i][1]) ci = i;
            if (ci !== capIdx) { capIdx = ci; if (opts.onCaption) opts.onCaption(ci >= 0 ? CAPS[ci][2] : ""); }
            if (!doneFired && tm >= TL) { doneFired = true; if (opts.onDone) opts.onDone(); }
            costAcc += performance.now() - t0; frames++;
            if (frames % 40 === 0) {   // qualidade adaptativa: mantém a fluidez em celulares
                const avg = costAcc / 40; costAcc = 0;
                if (avg > 26 && quality > 0.42) { quality = Math.max(0.42, quality * 0.82); resize(); }
                else if (avg < 9 && quality < qMax) { quality = Math.min(qMax, quality * 1.12); resize(); }
            }
        }
        let qMax = 1;
        window.addEventListener("resize", () => { if (running) resize(); });
        return {
            TL,
            start(o) {
                opts = o || {}; if (!built) { build(); built = true; }
                const cw = cvs.clientWidth || window.innerWidth; qMax = Math.min(1, 1280 / cw) * (isTouch ? 0.7 : 1); quality = qMax; resize();
                tm = 0; doneFired = false; capIdx = -2; lastPhaseStep = 0; running = true; last = performance.now(); raf = requestAnimationFrame(frame);
            },
            stop() { running = false; cancelAnimationFrame(raf); },
            get time() { return tm; }
        };
    })();

    // ---------- fundo animado dos créditos (grade neon + estrelas + faíscas orbitando o nome do Brayan) ----------
    const CreditsFx = (function () {
        // créditos de horror: fundo vermelho/preto, silhueta de monstro ao fundo, partículas caindo (brasas, cinzas, pingos de sangue)
        const cv = $("crCanvas"), c = cv.getContext("2d");
        let raf = 0, run = false, t0 = 0, W = 0, HH = 0;
        const R = Math.random, parts = [];
        const mk = (init) => { const k = R(), p = { x: R(), y: init ? R() : -0.05, v: 0.04 + R() * 0.12, r: 0.8 + R() * 2.4, ph: R() * 6.28, kind: k < 0.55 ? 0 : k < 0.85 ? 1 : 2 }; return p; };   // 0 brasa, 1 cinza, 2 sangue
        for (let i = 0; i < 150; i++) parts.push(mk(true));
        function resize() { W = cv.width = cv.clientWidth || window.innerWidth; HH = cv.height = cv.clientHeight || window.innerHeight; }
        let scalePat = null;   // textura de pele/escamas de monstro (padrão repetido, deriva lentamente)
        function mkScales() {
            const t = document.createElement("canvas"); t.width = 48; t.height = 52; const x = t.getContext("2d");
            for (let r = -1; r < 4; r++) for (let q = -1; q < 3; q++) {
                const cx = q * 24 + (((r % 2) + 2) % 2) * 12 + 12, cy = r * 13 + 13, g = x.createRadialGradient(cx, cy - 6, 1, cx, cy, 15);
                g.addColorStop(0, "rgba(150,10,10,.55)"); g.addColorStop(0.6, "rgba(40,0,0,.5)"); g.addColorStop(1, "rgba(0,0,0,.85)");
                x.fillStyle = g; x.beginPath(); x.arc(cx, cy, 14, 0, 6.2832); x.fill(); x.strokeStyle = "rgba(255,70,50,.18)"; x.lineWidth = 1; x.beginPath(); x.arc(cx, cy, 13.5, 3.5, 5.9); x.stroke();
            }
            scalePat = c.createPattern(t, "repeat");
        }
        function monster(cx, base, h, t) {   // silhueta alta e curvada, braços longos com garras, olhos acesos
            const sw = Math.sin(t * 0.6) * h * 0.012, br = 1 + Math.sin(t * 1.7) * 0.012, w = h * 0.5;
            c.save(); c.translate(cx + sw, base); c.scale(br, br); c.fillStyle = "#020000"; c.strokeStyle = "#020000"; c.lineJoin = "round";
            c.beginPath();   // tronco + ombros largos
            c.moveTo(-w * 0.16, 0); c.bezierCurveTo(-w * 0.22, -h * 0.28, -w * 0.5, -h * 0.5, -w * 0.46, -h * 0.66);
            c.bezierCurveTo(-w * 0.34, -h * 0.74, -w * 0.18, -h * 0.74, -w * 0.12, -h * 0.78);   // pescoço
            c.bezierCurveTo(-w * 0.2, -h * 0.9, -w * 0.12, -h * 1.0, 0, -h * 1.0); c.bezierCurveTo(w * 0.12, -h * 1.0, w * 0.2, -h * 0.9, w * 0.12, -h * 0.78);   // cabeça alongada
            c.bezierCurveTo(w * 0.18, -h * 0.74, w * 0.34, -h * 0.74, w * 0.46, -h * 0.66);
            c.bezierCurveTo(w * 0.5, -h * 0.5, w * 0.22, -h * 0.28, w * 0.16, 0); c.closePath(); c.fill();
            for (const sd of [-1, 1]) {   // braços compridos até o chão + garras
                const sway = Math.sin(t * 0.8 + sd) * h * 0.02;
                c.lineWidth = h * 0.045; c.lineCap = "round"; c.beginPath(); c.moveTo(sd * w * 0.42, -h * 0.64);
                c.bezierCurveTo(sd * w * 0.78, -h * 0.5, sd * w * 0.7 + sway, -h * 0.2, sd * w * 0.62 + sway, -h * 0.02); c.stroke();
                c.lineWidth = h * 0.012; for (let k = -1; k <= 1; k++) { c.beginPath(); c.moveTo(sd * w * 0.62 + sway, -h * 0.02); c.lineTo(sd * w * (0.62 + k * 0.06) + sway + k * h * 0.012, h * 0.05); c.stroke(); }
            }
            c.lineWidth = h * 0.06; c.beginPath(); c.moveTo(-w * 0.1, -h * 0.02); c.lineTo(-w * 0.18, h * 0.03); c.moveTo(w * 0.1, -h * 0.02); c.lineTo(w * 0.18, h * 0.03); c.stroke();
            const blink = (Math.sin(t * 0.9) > 0.96) ? 0.1 : 1, ey = -h * 0.9, ep = 0.65 + 0.35 * Math.sin(t * 3);   // olhos
            c.globalCompositeOperation = "lighter"; c.fillStyle = "rgba(255,30,10," + (0.95 * blink) + ")";
            for (const sd of [-1, 1]) { c.beginPath(); c.ellipse(sd * w * 0.055, ey, w * 0.035, h * 0.008 * blink + 0.5, sd * 0.35, 0, 6.2832); c.fill(); const g = c.createRadialGradient(sd * w * 0.055, ey, 0, sd * w * 0.055, ey, h * 0.05); g.addColorStop(0, "rgba(255,40,20," + (0.5 * ep * blink) + ")"); g.addColorStop(1, "rgba(255,0,0,0)"); c.fillStyle = g; c.fillRect(sd * w * 0.055 - h * 0.05, ey - h * 0.05, h * 0.1, h * 0.1); c.fillStyle = "rgba(255,30,10," + (0.95 * blink) + ")"; }
            c.restore(); c.globalCompositeOperation = "source-over";
        }
        function frame(now) {
            if (!run) return; raf = requestAnimationFrame(frame);
            const t = (now - t0) / 1000, cx = W / 2, cy = HH / 2, beat = Math.max(0, Math.sin(t * 4.2)) ** 6;
            c.clearRect(0, 0, W, HH);
            // brilho vermelho atrás do monstro (pulsa como coração)
            const gr = c.createRadialGradient(cx, HH * 0.62, 0, cx, HH * 0.62, Math.max(W, HH) * 0.62);
            gr.addColorStop(0, "rgba(220,0,0," + (0.5 + beat * 0.2) + ")"); gr.addColorStop(0.45, "rgba(90,0,0,.2)"); gr.addColorStop(1, "rgba(0,0,0,0)"); c.fillStyle = gr; c.fillRect(0, 0, W, HH);
            // névoa rastejando
            for (let i = 0; i < 3; i++) { const fx = ((t * (8 + i * 5) + i * 300) % (W + 600)) - 300, fg = c.createRadialGradient(fx, HH * (0.78 + i * 0.05), 0, fx, HH * (0.78 + i * 0.05), 320); fg.addColorStop(0, "rgba(120,10,10,.16)"); fg.addColorStop(1, "rgba(120,10,10,0)"); c.fillStyle = fg; c.fillRect(fx - 320, HH * 0.5, 640, HH * 0.5); }
            if (!scalePat) mkScales();
            c.save(); c.globalAlpha = 0.5; c.translate(0, (t * 5) % 52); c.fillStyle = scalePat; c.fillRect(0, -52, W, HH + 52); c.restore();   // pele do monstro cobrindo o fundo
            // silhueta ameaçadora ao fundo (cresce devagar, aproxima-se)
            const h = Math.min(HH * 1.02, W * 0.95) * (0.92 + 0.04 * Math.sin(t * 0.25)); monster(cx, HH * 1.0, h, t);
            // chão escuro
            const fl = c.createLinearGradient(0, HH * 0.9, 0, HH); fl.addColorStop(0, "rgba(0,0,0,0)"); fl.addColorStop(1, "rgba(0,0,0,.85)"); c.fillStyle = fl; c.fillRect(0, HH * 0.9, W, HH * 0.1);
            // partículas caindo
            c.globalCompositeOperation = "lighter";
            for (const p of parts) {
                p.y += p.v * 0.016 * (p.kind === 2 ? 2.2 : 1); p.x += Math.sin(t * 0.8 + p.ph) * 0.0004;
                if (p.y > 1.05) Object.assign(p, mk(false)), p.x = R();
                const x = p.x * W, y = p.y * HH;
                if (p.kind === 0) { const a = 0.4 + 0.6 * Math.abs(Math.sin(t * 2 + p.ph)); const g = c.createRadialGradient(x, y, 0, x, y, p.r * 5); g.addColorStop(0, "rgba(255,90,40," + a + ")"); g.addColorStop(1, "rgba(255,0,0,0)"); c.fillStyle = g; c.beginPath(); c.arc(x, y, p.r * 5, 0, 6.2832); c.fill(); }
                else if (p.kind === 1) { c.fillStyle = "rgba(160,120,120,.28)"; c.fillRect(x, y, p.r, p.r); }
                else { c.fillStyle = "rgba(190,10,10,.75)"; c.beginPath(); c.ellipse(x, y, p.r * 0.5, p.r * 2.4, 0, 0, 6.2832); c.fill(); }
            }
            c.globalCompositeOperation = "source-over";
        }
        window.addEventListener("resize", () => { if (run) resize(); });
        return { start() { resize(); run = true; t0 = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); }, stop() { run = false; cancelAnimationFrame(raf); } };
    })();

    // ==========================================
    // CUTSCENE FINAL — transição para o mundo exterior (3D) → tela final → créditos
    // ==========================================
    function startEnding() {
        if (document.body.classList.contains("ending")) return;
        sound.stopChase(0.8); endSlowmo(); endCine();
        canMove = false; hideAction(); setBanner(""); stopEmergency(); specChase.active = false;   // controles travados durante toda a cena
        document.body.classList.add("ending");
        sound.stopAmbience(2.5);
        const sc = $("endingScene"), cap = $("endCaption");
        sc.classList.remove("hidden", "done", "play"); void sc.offsetWidth; sc.classList.add("play");
        sound.playEnding();
        Ending3D.start({
            onStep: kind => sound.playStep(kind, false),
            onCaption: txt => { if (txt) { cap.textContent = txt; cap.classList.toggle("poem", /eco|liberdade|sobrevivi/.test(txt)); } cap.classList.toggle("on", !!txt); },
            onDone: () => sc.classList.add("done")   // título + botões só aparecem quando a câmera termina a trajetória
        });
    }
    $("endRestart").addEventListener("click", () => location.reload());
    $("endCredits").addEventListener("click", () => { $("creditsScreen").classList.remove("hidden"); CreditsFx.start(); });
    $("creditsBack").addEventListener("click", () => { $("creditsScreen").classList.add("hidden"); CreditsFx.stop(); });

    function goToRoom3() {   // fim da fuga 3D → chega à BIFURCAÇÃO (sala 4)
        perspectiveTransition.classList.remove("hidden");
        setTimeout(function() {
            perspectiveTransition.classList.add("hidden");
            chase3DContainer.classList.add("hidden");
            enterRoom(4, 25, 12, null, true);
            sound.playThud();
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
                    showStory("O metal aguentou. Dois caminhos: à ESQUERDA a sala de contenção; à DIREITA o corredor principal. Escolha.");
                    canMove = true;
                }
            }, 650);
        }, 1200);
    }

    // --- Touch: enquanto um modal/cena está aberto, os controles touch ficam inativos (senão o joystick cobre os botões dos modais) ---
    const modalWatch = () => document.body.classList.toggle("modal-open", !!document.querySelector(".modal-overlay:not(.hidden), .grab-scene:not(.hidden)"));
    new MutationObserver(modalWatch).observe(game, { attributes: true, attributeFilter: ["class"], subtree: true });
    modalWatch();

    restartButton.addEventListener("click", function() {
        if (labFailed) checkpointHub();
        else if (chaseFailed) { gameOverModal.classList.add("hidden"); start3DChase(); } // reinicia só a fuga
        else location.reload();
    });
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initGameEngine);
} else {
    initGameEngine();
}