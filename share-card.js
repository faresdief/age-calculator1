'use strict';

/* ==========================================================================
   Share card — draws a 1080x1350 PNG of the user's age on a <canvas>.
   No libraries: text is drawn directly, so Arabic shaping / RTL follow the browser.
   ========================================================================== */

const ShareCard = (() => {
    const W = 1080, H = 1350;

    const THEMES = {
        dark: {
            bg: ['#0b1120', '#1e1b4b', '#0f172a'], glowA: 'rgba(56,189,248,0.30)', glowB: 'rgba(167,139,250,0.26)',
            card: 'rgba(30,41,59,0.78)', stat: 'rgba(15,23,42,0.72)', pill: 'rgba(15,23,42,0.70)', border: 'rgba(148,163,184,0.28)',
            text: '#f1f5f9', muted: '#94a3b8', accent: '#38bdf8', accent2: '#34d399', gold: '#fbbf24', rose: '#fb7185'
        },
        light: {
            bg: ['#e0f2fe', '#f8fafc', '#ede9fe'], glowA: 'rgba(56,189,248,0.35)', glowB: 'rgba(167,139,250,0.28)',
            card: 'rgba(255,255,255,0.88)', stat: 'rgba(241,245,249,0.95)', pill: 'rgba(241,245,249,0.95)', border: 'rgba(100,116,139,0.28)',
            text: '#0f172a', muted: '#64748b', accent: '#0284c7', accent2: '#059669', gold: '#b45309', rose: '#e11d48'
        }
    };

    function roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    /** Shrinks the font until the text fits maxWidth. Returns the final size. */
    function fit(ctx, text, maxWidth, size, weight, family, min = 16) {
        let s = size;
        ctx.font = `${weight} ${s}px ${family}`;
        while (s > min && ctx.measureText(text).width > maxWidth) {
            s -= 2;
            ctx.font = `${weight} ${s}px ${family}`;
        }
        return s;
    }

    /** Waits (max ~1.5 s) for the page font so the PNG does not use a fallback face. */
    async function fontsReady(family, sample) {
        if (!document.fonts || !document.fonts.load) return;
        const loads = [400, 600, 700, 800, 900].map((w) => document.fonts.load(`${w} 40px ${family}`, sample).catch(() => []));
        await Promise.race([Promise.all(loads), new Promise((r) => setTimeout(r, 1500))]);
    }

    /**
     * o = { theme, dir, family, title, stamp, years, yearsLabel, months, monthsLabel, days, daysLabel,
     *       stats: [{ value, label } x4], hijri: { label, value } | null, countdown: { label, value }, footer }
     */
    async function render(o) {
        const P = THEMES[o.theme] || THEMES.dark;
        const F = o.family || 'sans-serif';
        await fontsReady(F, o.title + o.yearsLabel + o.years);

        const canvas = document.createElement('canvas');
        canvas.width = W; canvas.height = H;
        const ctx = canvas.getContext('2d');
        ctx.direction = o.dir || 'ltr';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';

        // Background + soft glows
        const bg = ctx.createLinearGradient(0, 0, W, H);
        bg.addColorStop(0, P.bg[0]); bg.addColorStop(0.55, P.bg[1]); bg.addColorStop(1, P.bg[2]);
        ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
        for (const [x, y, r, c] of [[170, 150, 560, P.glowA], [930, 1230, 600, P.glowB]]) {
            const g = ctx.createRadialGradient(x, y, 0, x, y, r);
            g.addColorStop(0, c); g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        }

        // Card
        roundRect(ctx, 56, 56, W - 112, 1238, 56);
        ctx.fillStyle = P.card; ctx.fill();
        const edge = ctx.createLinearGradient(56, 56, W - 56, 1294);
        edge.addColorStop(0, P.accent); edge.addColorStop(0.5, '#a78bfa'); edge.addColorStop(1, P.gold);
        ctx.lineWidth = 3; ctx.strokeStyle = edge; ctx.globalAlpha = 0.55; ctx.stroke(); ctx.globalAlpha = 1;

        // Header
        fit(ctx, o.title, 820, 46, 800, F);
        ctx.fillStyle = P.accent; ctx.fillText(o.title, W / 2, 190);
        fit(ctx, o.stamp, 820, 28, 600, F);
        ctx.fillStyle = P.muted; ctx.fillText(o.stamp, W / 2, 242);
        ctx.strokeStyle = P.gold; ctx.lineWidth = 4; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(W / 2 - 54, 276); ctx.lineTo(W / 2 + 54, 276); ctx.stroke();

        // Big number of years
        const years = String(o.years);
        const ys = fit(ctx, years, 640, 280, 900, F, 120);
        const textW = ctx.measureText(years).width;
        const yg = ctx.createLinearGradient(W / 2 - textW / 2, 0, W / 2 + textW / 2, 0);
        yg.addColorStop(0, P.accent); yg.addColorStop(1, P.accent2);
        ctx.save();
        ctx.shadowColor = 'rgba(56,189,248,0.45)'; ctx.shadowBlur = 46;
        ctx.fillStyle = yg; ctx.fillText(years, W / 2, 330 + ys * 0.82);
        ctx.restore();
        fit(ctx, o.yearsLabel, 600, 54, 700, F);
        ctx.fillStyle = P.muted; ctx.fillText(o.yearsLabel, W / 2, 330 + ys * 0.82 + 74);

        // Months / days pill
        const md = `${o.months} ${o.monthsLabel}   ·   ${o.days} ${o.daysLabel}`;
        fit(ctx, md, 760, 44, 700, F);
        const pw = Math.min(ctx.measureText(md).width + 100, 880), py = 652;
        roundRect(ctx, W / 2 - pw / 2, py, pw, 84, 42);
        ctx.fillStyle = P.pill; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = P.gold; ctx.globalAlpha = 0.6; ctx.stroke(); ctx.globalAlpha = 1;
        ctx.fillStyle = P.gold; ctx.fillText(md, W / 2, py + 58);

        // 2 x 2 stats
        const cw = 440, ch = 160, gap = 24;
        const cells = [[W / 2 - gap / 2 - cw, 774], [W / 2 + gap / 2, 774], [W / 2 - gap / 2 - cw, 774 + ch + gap], [W / 2 + gap / 2, 774 + ch + gap]];
        o.stats.slice(0, 4).forEach((s, i) => {
            const [x, y] = cells[i];
            roundRect(ctx, x, y, cw, ch, 32);
            ctx.fillStyle = P.stat; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = P.border; ctx.stroke();
            fit(ctx, s.value, cw - 48, 46, 800, F, 20);
            ctx.fillStyle = P.gold; ctx.fillText(s.value, x + cw / 2, y + 82);
            fit(ctx, s.label, cw - 48, 28, 600, F, 16);
            ctx.fillStyle = P.muted; ctx.fillText(s.label, x + cw / 2, y + 132);
        });

        // Hijri line
        if (o.hijri) {
            const t = `🌙 ${o.hijri.label} ${o.hijri.value}`;
            fit(ctx, t, 880, 32, 600, F, 18);
            ctx.fillStyle = P.text; ctx.fillText(t, W / 2, 1178);
        }

        // Birthday countdown pill
        const cd = `🎂 ${o.countdown.label} ${o.countdown.value}`;
        fit(ctx, cd, 820, 32, 700, F, 18);
        const cpw = Math.min(ctx.measureText(cd).width + 80, 900), cpy = 1198;
        roundRect(ctx, W / 2 - cpw / 2, cpy, cpw, 66, 33);
        ctx.fillStyle = P.pill; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = P.rose; ctx.globalAlpha = 0.7; ctx.stroke(); ctx.globalAlpha = 1;
        ctx.fillStyle = P.rose; ctx.fillText(cd, W / 2, cpy + 44);

        // Footer
        fit(ctx, o.footer, 760, 26, 600, F, 14);
        ctx.fillStyle = P.muted; ctx.fillText(o.footer, W / 2, 1328);

        return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    }

    return { render, W, H };
})();
