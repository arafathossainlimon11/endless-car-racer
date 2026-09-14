/* ==========================================================================
   ENDLESS CAR RACING GAME - ENGINE & GAME LOGIC
   Fully Vanilla JS - Zero External Dependencies (Canvas & Web Audio API)
   ========================================================================== */

// --- 1. WEB AUDIO API SOUND SYSTEM ---
class SoundController {
    constructor() {
        this.ctx = null;
        this.muted = false;
        this.engineOsc = null;
        this.engineGain = null;
    }

    init() {
        if (!this.ctx) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.ctx = new AudioContext();
        }
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    toggleSound() {
        this.muted = !this.muted;
        if (this.muted && this.engineOsc) {
            this.stopEngine();
        }
        return !this.muted;
    }

    playEngine() {
        if (this.muted || this.engineOsc || !this.ctx) return;
        try {
            this.engineOsc = this.ctx.createOscillator();
            this.engineGain = this.ctx.createGain();
            
            this.engineOsc.type = 'sawtooth';
            this.engineOsc.frequency.setValueAtTime(40, this.ctx.currentTime);
            
            this.engineGain.gain.setValueAtTime(0.05, this.ctx.currentTime);
            
            this.engineOsc.connect(this.engineGain);
            this.engineGain.connect(this.ctx.destination);
            this.engineOsc.start();
        } catch (e) { }
    }

    updateEngineSpeed(speedRatio) {
        if (this.muted || !this.engineOsc) return;
        const targetFreq = 40 + (speedRatio * 120);
        this.engineOsc.frequency.setTargetAtTime(targetFreq, this.ctx.currentTime, 0.1);
    }

    stopEngine() {
        if (this.engineOsc) {
            try {
                this.engineOsc.stop();
                this.engineOsc.disconnect();
            } catch (e) { }
            this.engineOsc = null;
        }
    }

    playCoinSound() {
        if (this.muted || !this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1400, this.ctx.currentTime + 0.1);
        
        gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.1);
        
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.1);
    }

    playCrashSound() {
        if (this.muted || !this.ctx) return;
        const bufferSize = this.ctx.sampleRate * 0.4;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }

        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(800, this.ctx.currentTime);
        filter.frequency.linearRampToValueAtTime(50, this.ctx.currentTime + 0.4);

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.4, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.4);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.ctx.destination);

        noise.start();
        noise.stop(this.ctx.currentTime + 0.4);
    }
}

const soundManager = new SoundController();

// --- 2. CAR DATA DEFINITIONS ---
const CAR_MODELS = [
    { name: "RED LIGHTNING", color: "#ff0055", speed: 8, handling: 7, boost: 7, coinMult: 1 },
    { name: "CYBER PHANTOM", color: "#00f0ff", speed: 10, handling: 8, boost: 9, coinMult: 1.2 },
    { name: "NEON VIPER", color: "#39ff14", speed: 7, handling: 9, boost: 6, coinMult: 1.5 }
];

// --- 3. MAIN GAME CLASS ---
class CarRacingGame {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        
        this.selectedCarIndex = 0;
        this.score = 0;
        this.coins = 0;
        this.highScore = parseInt(localStorage.getItem('racing_highscore')) || 0;
        
        this.state = 'MENU'; // MENU, GARAGE, PLAYING, PAUSED, GAMEOVER
        
        // Dynamic Dimensions
        this.width = 480;
        this.height = 800;
        
        // Road Config
        this.roadWidth = 320;
        this.roadX = (this.width - this.roadWidth) / 2;
        this.lanes = 4;
        this.laneWidth = this.roadWidth / this.lanes;
        this.roadOffset = 0;

        // Player Setup
        this.player = {
            x: 0,
            y: 0,
            width: 44,
            height: 75,
            speed: 0,
            baseSpeed: 5,
            maxSpeed: 12,
            steerSpeed: 7,
            boosting: false,
            boostMeter: 100
        };

        // Entities
        this.traffics = [];
        this.coinsList = [];
        this.particles = [];

        // Controls
        this.keys = { left: false, right: false, up: false, down: false };

        this.init();
    }

    init() {
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());

        this.bindEvents();
        this.updateUI();

        this.renderCarPreview();

        this.lastTime = performance.now();
        requestAnimationFrame((t) => this.gameLoop(t));
    }

    resizeCanvas() {
        const wrapper = document.getElementById('game-wrapper');
        this.canvas.width = wrapper.clientWidth;
        this.canvas.height = wrapper.clientHeight;
        
        this.width = this.canvas.width;
        this.height = this.canvas.height;

        this.roadWidth = Math.min(this.width * 0.82, 360);
        this.roadX = (this.width - this.roadWidth) / 2;
        this.laneWidth = this.roadWidth / this.lanes;

        // Adjust Player Y so it stays cleanly above the elevated touch buttons
        this.player.y = this.height - 195;
        if (this.state !== 'PLAYING') {
            this.player.x = this.roadX + (this.roadWidth / 2) - (this.player.width / 2);
        }
    }

    bindEvents() {
        window.addEventListener('keydown', (e) => {
            soundManager.init();
            if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') this.keys.left = true;
            if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') this.keys.right = true;
            if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') this.keys.up = true;
            if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') this.keys.down = true;
            if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') this.togglePause();
        });

        window.addEventListener('keyup', (e) => {
            if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') this.keys.left = false;
            if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') this.keys.right = false;
            if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') this.keys.up = false;
            if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') this.keys.down = false;
        });

        const bindTouch = (id, key) => {
            const btn = document.getElementById(id);
            if (!btn) return;
            btn.addEventListener('touchstart', (e) => { e.preventDefault(); soundManager.init(); this.keys[key] = true; });
            btn.addEventListener('touchend', (e) => { e.preventDefault(); this.keys[key] = false; });
        };

        bindTouch('btn-touch-left', 'left');
        bindTouch('btn-touch-right', 'right');
        bindTouch('btn-touch-boost', 'up');
        bindTouch('btn-touch-brake', 'down');

        document.getElementById('btn-play').onclick = () => this.startGame();
        document.getElementById('btn-garage').onclick = () => this.showScreen('screen-garage');
        document.getElementById('btn-howto').onclick = () => this.showScreen('screen-howto');
        document.getElementById('btn-back-howto').onclick = () => this.showScreen('screen-home');
        document.getElementById('btn-select-car').onclick = () => this.showScreen('screen-home');
        
        document.getElementById('btn-prev-car').onclick = () => this.changeCar(-1);
        document.getElementById('btn-next-car').onclick = () => this.changeCar(1);

        document.getElementById('btn-pause').onclick = () => this.togglePause();
        document.getElementById('btn-resume').onclick = () => this.togglePause();
        document.getElementById('btn-restart-pause').onclick = () => this.startGame();
        document.getElementById('btn-home-pause').onclick = () => this.showScreen('screen-home');

        document.getElementById('btn-restart').onclick = () => this.startGame();
        document.getElementById('btn-home-over').onclick = () => this.showScreen('screen-home');

        document.getElementById('btn-sound-toggle').onclick = () => {
            const isSoundOn = soundManager.toggleSound();
            document.getElementById('btn-sound-toggle').innerText = `🔊 Sound: ${isSoundOn ? 'ON' : 'OFF'}`;
        };
    }

    changeCar(direction) {
        this.selectedCarIndex = (this.selectedCarIndex + direction + CAR_MODELS.length) % CAR_MODELS.length;
        const car = CAR_MODELS[this.selectedCarIndex];
        
        document.getElementById('car-name').innerText = car.name;
        document.getElementById('stat-speed').style.width = `${car.speed * 10}%`;
        document.getElementById('stat-handling').style.width = `${car.handling * 10}%`;
        document.getElementById('stat-boost').style.width = `${car.boost * 10}%`;

        this.renderCarPreview();
    }

    renderCarPreview() {
        const previewCanvas = document.getElementById('carPreviewCanvas');
        if (!previewCanvas) return;
        const pCtx = previewCanvas.getContext('2d');
        pCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
        
        const car = CAR_MODELS[this.selectedCarIndex];
        this.drawCarShape(pCtx, previewCanvas.width / 2 - 22, previewCanvas.height / 2 - 37.5, 44, 75, car.color, true);
    }

    showScreen(screenId) {
        document.querySelectorAll('.ui-screen').forEach(s => {
            s.classList.remove('active');
            s.classList.add('hidden');
        });
        
        const target = document.getElementById(screenId);
        if (target) {
            target.classList.remove('hidden');
            target.classList.add('active');
        }

        if (screenId === 'screen-home') {
            this.state = 'MENU';
            soundManager.stopEngine();
            document.getElementById('hud').classList.add('hidden');
        }
    }

    startGame() {
        soundManager.init();
        soundManager.playEngine();

        this.state = 'PLAYING';
        this.score = 0;
        this.coins = 0;
        
        const carData = CAR_MODELS[this.selectedCarIndex];
        this.player.baseSpeed = 5 + (carData.speed * 0.3);
        this.player.speed = this.player.baseSpeed;
        this.player.steerSpeed = 5 + (carData.handling * 0.4);
        this.player.boostMeter = 100;
        
        this.player.x = this.roadX + (this.roadWidth / 2) - (this.player.width / 2);
        this.player.y = this.height - 195;

        this.traffics = [];
        this.coinsList = [];
        this.particles = [];

        document.querySelectorAll('.ui-screen').forEach(s => {
            s.classList.remove('active');
            s.classList.add('hidden');
        });
        document.getElementById('hud').classList.remove('hidden');
    }

    togglePause() {
        if (this.state === 'PLAYING') {
            this.state = 'PAUSED';
            soundManager.stopEngine();
            document.getElementById('screen-pause').classList.remove('hidden');
            document.getElementById('screen-pause').classList.add('active');
        } else if (this.state === 'PAUSED') {
            this.state = 'PLAYING';
            soundManager.playEngine();
            document.getElementById('screen-pause').classList.remove('active');
            document.getElementById('screen-pause').classList.add('hidden');
        }
    }

    gameOver() {
        this.state = 'GAMEOVER';
        soundManager.stopEngine();
        soundManager.playCrashSound();

        for (let i = 0; i < 40; i++) {
            this.particles.push({
                x: this.player.x + this.player.width / 2,
                y: this.player.y + this.player.height / 2,
                vx: (Math.random() - 0.5) * 12,
                vy: (Math.random() - 0.5) * 12,
                size: Math.random() * 6 + 2,
                color: Math.random() > 0.5 ? '#ff0055' : '#ff9900',
                life: 1
            });
        }

        if (this.score > this.highScore) {
            this.highScore = Math.floor(this.score);
            localStorage.setItem('racing_highscore', this.highScore);
        }

        document.getElementById('final-score').innerText = Math.floor(this.score);
        document.getElementById('final-coins').innerText = `🪙 ${this.coins}`;
        document.getElementById('final-highscore').innerText = this.highScore;
        document.getElementById('home-highscore').innerText = this.highScore;

        setTimeout(() => {
            document.getElementById('hud').classList.add('hidden');
            document.getElementById('screen-gameover').classList.remove('hidden');
            document.getElementById('screen-gameover').classList.add('active');
        }, 800);
    }

    // --- GAME LOOP & UPDATES ---
    gameLoop(timestamp) {
        const dt = (timestamp - this.lastTime) / 1000;
        this.lastTime = timestamp;

        this.update(dt);
        this.render();

        requestAnimationFrame((t) => this.gameLoop(t));
    }

    update(dt) {
        if (this.state !== 'PLAYING') return;

        if (this.keys.left) this.player.x -= this.player.steerSpeed;
        if (this.keys.right) this.player.x += this.player.steerSpeed;

        const minX = this.roadX + 10;
        const maxX = this.roadX + this.roadWidth - this.player.width - 10;
        this.player.x = Math.max(minX, Math.min(maxX, this.player.x));

        if (this.keys.up && this.player.boostMeter > 0) {
            this.player.speed = this.player.baseSpeed * 1.6;
            this.player.boosting = true;
            this.player.boostMeter -= 25 * dt;

            this.particles.push({
                x: this.player.x + this.player.width / 2 + (Math.random() * 10 - 5),
                y: this.player.y + this.player.height,
                vx: (Math.random() - 0.5) * 2,
                vy: Math.random() * 4 + 4,
                size: Math.random() * 4 + 2,
                color: '#00f0ff',
                life: 1
            });
        } else if (this.keys.down) {
            this.player.speed = this.player.baseSpeed * 0.5;
            this.player.boosting = false;
        } else {
            this.player.speed = this.player.baseSpeed;
            this.player.boosting = false;
            if (this.player.boostMeter < 100) this.player.boostMeter += 10 * dt;
        }

        this.roadOffset += this.player.speed * 3;
        soundManager.updateEngineSpeed(this.player.speed / this.player.baseSpeed);

        if (Math.random() < 0.025) {
            this.spawnTraffic();
        }

        if (Math.random() < 0.02) {
            this.spawnCoin();
        }

        for (let i = this.traffics.length - 1; i >= 0; i--) {
            let t = this.traffics[i];
            t.y += (this.player.speed - t.speed);

            if (this.checkCollision(this.player, t)) {
                this.gameOver();
                break;
            }

            if (t.y > this.height + 100 || t.y < -300) {
                this.traffics.splice(i, 1);
            }
        }

        for (let i = this.coinsList.length - 1; i >= 0; i--) {
            let c = this.coinsList[i];
            c.y += this.player.speed;

            const dist = Math.hypot((this.player.x + this.player.width/2) - c.x, (this.player.y + this.player.height/2) - c.y);
            if (dist < 30) {
                soundManager.playCoinSound();
                const mult = CAR_MODELS[this.selectedCarIndex].coinMult;
                this.coins += Math.round(1 * mult);
                this.score += 50;

                for(let p = 0; p < 8; p++) {
                    this.particles.push({
                        x: c.x, y: c.y,
                        vx: (Math.random() - 0.5) * 6, vy: (Math.random() - 0.5) * 6,
                        size: 3, color: '#ffd700', life: 1
                    });
                }

                this.coinsList.splice(i, 1);
                continue;
            }

            if (c.y > this.height + 50) {
                this.coinsList.splice(i, 1);
            }
        }

        for (let i = this.particles.length - 1; i >= 0; i--) {
            let p = this.particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.life -= dt * 2;
            if (p.life <= 0) this.particles.splice(i, 1);
        }

        this.score += this.player.speed * 0.1;
        this.player.baseSpeed += 0.0005;

        this.updateUI();
    }

    spawnTraffic() {
        const laneIndex = Math.floor(Math.random() * this.lanes);
        const laneX = this.roadX + (laneIndex * this.laneWidth) + (this.laneWidth / 2) - 22;
        
        for (let t of this.traffics) {
            if (Math.abs(t.x - laneX) < 10 && t.y < -50) return;
        }

        const colors = ['#e74c3c', '#3498db', '#f1c40f', '#9b59b6', '#1abc9c'];
        const randomColor = colors[Math.floor(Math.random() * colors.length)];

        this.traffics.push({
            x: laneX,
            y: -120,
            width: 44,
            height: 75,
            speed: Math.random() * 2 + 2,
            color: randomColor
        });
    }

    spawnCoin() {
        const laneIndex = Math.floor(Math.random() * this.lanes);
        const coinX = this.roadX + (laneIndex * this.laneWidth) + (this.laneWidth / 2);

        this.coinsList.push({
            x: coinX,
            y: -50,
            rotation: 0
        });
    }

    checkCollision(rect1, rect2) {
        const margin = 4;
        return (
            rect1.x + margin < rect2.x + rect2.width - margin &&
            rect1.x + rect1.width - margin > rect2.x + margin &&
            rect1.y + margin < rect2.y + rect2.height - margin &&
            rect1.y + rect1.height - margin > rect2.y + margin
        );
    }

    updateUI() {
        document.getElementById('score-display').innerText = Math.floor(this.score);
        document.getElementById('coin-display').innerText = `🪙 ${this.coins}`;
        document.getElementById('speed-display').innerText = `${Math.floor(this.player.speed * 18)} KM/H`;
        document.getElementById('boost-bar').style.width = `${this.player.boostMeter}%`;
        document.getElementById('home-highscore').innerText = this.highScore;
    }

    // --- RENDERING METHODS ---
    render() {
        this.ctx.clearRect(0, 0, this.width, this.height);

        // 1. Draw Side Grass
        this.ctx.fillStyle = '#0b130e';
        this.ctx.fillRect(0, 0, this.width, this.height);

        // 2. Draw Road Asphalt
        this.ctx.fillStyle = '#1a1d24';
        this.ctx.fillRect(this.roadX, 0, this.roadWidth, this.height);

        // Road Curb
        const curbWidth = 8;
        const stripeHeight = 30;
        for (let y = -stripeHeight; y < this.height + stripeHeight; y += stripeHeight) {
            const shiftY = (y + (this.roadOffset % stripeHeight));
            this.ctx.fillStyle = Math.floor((y + this.roadOffset) / stripeHeight) % 2 === 0 ? '#ff0055' : '#ffffff';
            this.ctx.fillRect(this.roadX - curbWidth, shiftY, curbWidth, stripeHeight);
            this.ctx.fillRect(this.roadX + this.roadWidth, shiftY, curbWidth, stripeHeight);
        }

        // Dashed Lane Lines
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        this.ctx.lineWidth = 4;
        this.ctx.setLineDash([20, 20]);
        this.ctx.lineDashOffset = -this.roadOffset;

        for (let i = 1; i < this.lanes; i++) {
            const x = this.roadX + (i * this.laneWidth);
            this.ctx.beginPath();
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, this.height);
            this.ctx.stroke();
        }
        this.ctx.setLineDash([]);

        // 3. Draw Coins
        for (let c of this.coinsList) {
            this.ctx.save();
            this.ctx.translate(c.x, c.y);
            this.ctx.fillStyle = '#ffd700';
            this.ctx.shadowColor = '#ffd700';
            this.ctx.shadowBlur = 10;
            this.ctx.beginPath();
            this.ctx.arc(0, 0, 10, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.fillStyle = '#da9100';
            this.ctx.font = '10px Orbitron';
            this.ctx.fillText('$', -3, 3);
            this.ctx.restore();
        }

        // 4. Draw Traffic Cars
        for (let t of this.traffics) {
            this.drawCarShape(this.ctx, t.x, t.y, t.width, t.height, t.color, false);
        }

        // 5. Draw Player Car
        if (this.state === 'PLAYING' || this.state === 'PAUSED') {
            const playerColor = CAR_MODELS[this.selectedCarIndex].color;
            this.drawCarShape(this.ctx, this.player.x, this.player.y, this.player.width, this.player.height, playerColor, true);
        }

        // 6. Draw Particles
        for (let p of this.particles) {
            this.ctx.save();
            this.ctx.globalAlpha = Math.max(0, p.life);
            this.ctx.fillStyle = p.color;
            this.ctx.beginPath();
            this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.restore();
        }
    }

    drawCarShape(ctx, x, y, w, h, color, isPlayer) {
        ctx.save();
        ctx.translate(x, y);

        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.fillRect(2, 4, w, h);

        ctx.fillStyle = color;
        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(0, 0, w, h, [8, 8, 4, 4]);
        } else {
            ctx.rect(0, 0, w, h);
        }
        ctx.fill();

        ctx.fillStyle = '#111';
        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(6, h * 0.25, w - 12, h * 0.4, 4);
        } else {
            ctx.rect(6, h * 0.25, w - 12, h * 0.4);
        }
        ctx.fill();

        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.fillRect(8, h * 0.27, w - 16, h * 0.1);

        if (isPlayer) {
            ctx.fillStyle = '#00f0ff';
            ctx.shadowColor = '#00f0ff';
            ctx.shadowBlur = 10;
            ctx.fillRect(4, 2, 8, 4);
            ctx.fillRect(w - 12, 2, 8, 4);
            
            ctx.fillStyle = '#ff0055';
            ctx.shadowColor = '#ff0055';
            ctx.fillRect(4, h - 4, 8, 3);
            ctx.fillRect(w - 12, h - 4, 8, 3);
        } else {
            ctx.fillStyle = '#ffff00';
            ctx.fillRect(4, h - 4, 8, 3);
            ctx.fillRect(w - 12, h - 4, 8, 3);
            
            ctx.fillStyle = '#ff0000';
            ctx.fillRect(4, 2, 8, 3);
            ctx.fillRect(w - 12, 2, 8, 3);
        }

        ctx.restore();
    }
}

window.addEventListener('load', () => {
    new CarRacingGame();
});
