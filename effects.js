'use strict';

/* ==========================================================================
   Light visual effects — no libraries, nothing runs unless it is playing.

   - confetti()   : one <canvas>, one rAF loop, removed automatically (~2.6 s)
   - countUp()    : one rAF loop for the whole group of numbers (~0.9 s)

   Deliberately NOT animated: the per-second counter. A Web Animations pulse on the seconds
   digit was measured at ~+5 ms of main-thread time per second (extra layout + ~7 style
   recalcs every second), which is the opposite of what this page is optimised for.

   Everything is skipped for users who prefer reduced motion and while the tab is hidden.
   ========================================================================== */

const Effects = (() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    /* ---------------------------- Confetti ---------------------------- */

    const COLORS = ['#38bdf8', '#34d399', '#fbbf24', '#f43f5e', '#a78bfa', '#f1f5f9'];
    const DURATION = 2600;
    let canvas = null, confettiRaf = 0, killTimer = 0;

    function stopConfetti() {
        cancelAnimationFrame(confettiRaf);
        clearTimeout(killTimer);
        confettiRaf = killTimer = 0;
        if (canvas) { canvas.remove(); canvas = null; }
    }

    function confetti(options = {}) {
        if (reduceMotion.matches || document.hidden) return;
        stopConfetti();

        const count = options.count || 110;
        const spread = options.spread || 1.45;               // radians
        const w = window.innerWidth, h = window.innerHeight;
        const dpr = Math.min(window.devicePixelRatio || 1, 1.5);

        canvas = document.createElement('canvas');
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        canvas.setAttribute('aria-hidden', 'true');
        canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999';
        document.body.appendChild(canvas);
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const ox = (options.x == null ? 0.5 : options.x) * w, oy = (options.y == null ? 0.62 : options.y) * h;
        const parts = [];
        for (let i = 0; i < count; i++) {
            const angle = -Math.PI / 2 + (Math.random() - 0.5) * spread;
            const speed = 9 + Math.random() * 11;
            parts.push({
                x: ox, y: oy, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
                w: 6 + Math.random() * 7, h: 4 + Math.random() * 6,
                rot: Math.random() * 6.283, vr: (Math.random() - 0.5) * 0.35, wob: Math.random() * 6.283,
                color: COLORS[(Math.random() * COLORS.length) | 0], round: Math.random() < 0.3
            });
        }

        const start = performance.now();
        let last = start;
        const frame = (now) => {
            const dt = Math.min((now - last) / 16.67, 3);    // normalised to 60 fps, clamped after stalls
            last = now;
            const age = now - start;
            const fadeFrom = DURATION * 0.65;
            const alpha = age > fadeFrom ? 1 - (age - fadeFrom) / (DURATION - fadeFrom) : 1;
            if (alpha <= 0) { stopConfetti(); return; }

            ctx.clearRect(0, 0, w, h);
            ctx.globalAlpha = alpha;
            const drag = Math.pow(0.985, dt);
            for (const p of parts) {
                p.vx *= drag;
                p.vy = p.vy * drag + 0.32 * dt;
                p.wob += 0.08 * dt;
                p.x += p.vx * dt + Math.sin(p.wob) * 0.6;
                p.y += p.vy * dt;
                p.rot += p.vr * dt;
                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate(p.rot);
                ctx.fillStyle = p.color;
                if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.w / 2.2, 0, 6.283); ctx.fill(); }
                else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
                ctx.restore();
            }
            confettiRaf = requestAnimationFrame(frame);
        };
        confettiRaf = requestAnimationFrame(frame);
        killTimer = setTimeout(stopConfetti, DURATION + 1500);   // safety net, e.g. tab hidden mid-animation
    }

    /* ---------------------------- Count-up ---------------------------- */

    let countRaf = 0;

    function stopCountUp() {
        cancelAnimationFrame(countRaf);
        countRaf = 0;
    }

    /** items: [{ set: (n) => void, to: number }] — all numbers animate together from 0. */
    function countUp(items, duration = 900) {
        stopCountUp();
        if (reduceMotion.matches || document.hidden) return;
        const start = performance.now();
        for (const it of items) it.set(0);
        const step = (now) => {
            const t = Math.min((now - start) / duration, 1);
            const k = 1 - Math.pow(1 - t, 3);                    // easeOutCubic
            for (const it of items) it.set(t === 1 ? it.to : Math.round(it.to * k));
            countRaf = t < 1 ? requestAnimationFrame(step) : 0;
        };
        countRaf = requestAnimationFrame(step);
    }

    return { confetti, stopConfetti, countUp, stopCountUp, reduceMotion };
})();
