'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

// Test the function shipped to the browser, not a second implementation.
// script.js is a classic script with DOM initialization, so load just its
// date-maths section in a fresh process for each timezone.
const source = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
const start = source.indexOf('function ymd(birth, at) {');
const end = source.indexOf('\nconst dayNumber', start);
assert.ok(start >= 0 && end > start, 'production date-maths section exists');
const production = source.slice(start, end);

function checkCalendarAge() {
    const assert = require('node:assert/strict');
    const localDate = ([y, m, d, h = 12, min = 0]) => new Date(y, m - 1, d, h, min);
    const cases = [
        ['original negative-day regression', [2026, 1, 31], [2026, 3, 1], { y: 0, m: 1, d: 1 }],
        ['short month anniversary', [2026, 1, 31], [2026, 2, 28], { y: 0, m: 1, d: 0 }],
        ['before short month anniversary', [2026, 1, 31], [2026, 2, 27], { y: 0, m: 0, d: 27 }],
        ['no accumulated clamp drift', [2026, 1, 31], [2026, 3, 30], { y: 0, m: 1, d: 30 }],
        ['original day restored', [2026, 1, 31], [2026, 3, 31], { y: 0, m: 2, d: 0 }],
        ['30-day month', [2026, 3, 31], [2026, 5, 1], { y: 0, m: 1, d: 1 }],
        ['year rollover', [2025, 12, 31], [2026, 1, 30], { y: 0, m: 0, d: 30 }],
        ['longer than a year', [2025, 1, 31], [2026, 3, 1], { y: 1, m: 1, d: 1 }],
        ['leap month', [2024, 1, 31], [2024, 3, 1], { y: 0, m: 1, d: 1 }],
        ['leap birth before anniversary', [2024, 2, 29], [2025, 2, 27], { y: 0, m: 11, d: 29 }],
        ['leap birth clamped anniversary', [2024, 2, 29], [2025, 2, 28], { y: 1, m: 0, d: 0 }],
        ['leap birth following day', [2024, 2, 29], [2025, 3, 1], { y: 1, m: 0, d: 1 }],
        ['leap birth four years later', [2024, 2, 29], [2028, 2, 29], { y: 4, m: 0, d: 0 }],
        ['century is not a leap year', [2096, 2, 29], [2100, 2, 28], { y: 4, m: 0, d: 0 }],
        ['400-year leap rule', [1999, 1, 31], [2000, 3, 1], { y: 1, m: 1, d: 1 }],
        ['same local day ignores hours', [2026, 5, 3, 23, 59], [2026, 5, 3, 0, 1], { y: 0, m: 0, d: 0 }],
        ['midnight boundary', [2026, 5, 3, 23, 59], [2026, 5, 4, 0, 1], { y: 0, m: 0, d: 1 }],
        ['US spring DST', [2026, 3, 7], [2026, 3, 9], { y: 0, m: 0, d: 2 }],
        ['US autumn DST', [2026, 10, 31], [2026, 11, 2], { y: 0, m: 0, d: 2 }],
        ['Egypt spring DST', [2026, 4, 23], [2026, 4, 25], { y: 0, m: 0, d: 2 }],
        ['Egypt autumn DST', [2026, 10, 29], [2026, 10, 31], { y: 0, m: 0, d: 2 }]
    ];
    for (const [name, birth, at, expected] of cases) {
        assert.deepEqual(ymd(localDate(birth), localDate(at)), expected, name);
    }

    // Sweep all birth month-ends across a complete Gregorian leap-year cycle.
    // Independent reconstruction checks that the returned months fit and that
    // the remaining local calendar days land exactly on the requested date.
    let checks = 0;
    for (let year = 2000; year < 2400; year++) {
        for (let month = 0; month < 12; month++) {
            const birth = new Date(year, month + 1, 0, 12);
            for (const offset of [0, 1, 27, 28, 29, 30, 31, 59, 60, 365, 366, 400]) {
                const at = new Date(year, month, birth.getDate() + offset, 12);
                const age = ymd(birth, at);
                assert.ok(Number.isInteger(age.y) && age.y >= 0);
                assert.ok(Number.isInteger(age.m) && age.m >= 0 && age.m < 12);
                assert.ok(Number.isInteger(age.d) && age.d >= 0 && age.d <= 30);
                const months = age.y * 12 + age.m;
                const anchor = (count) => {
                    const last = new Date(year, month + count + 1, 0, 12).getDate();
                    return new Date(year, month + count, Math.min(birth.getDate(), last), 12);
                };
                const base = anchor(months);
                assert.ok(base <= at && anchor(months + 1) > at, 'maximal completed months');
                const rebuilt = new Date(base.getFullYear(), base.getMonth(), base.getDate() + age.d, 12);
                assert.equal(rebuilt.getTime(), at.getTime(), 'exact calendar reconstruction');
                checks++;
            }
        }
    }
    console.log(JSON.stringify({ timezone: process.env.TZ, examples: cases.length, invariantChecks: checks }));
}

for (const zone of ['UTC', 'Africa/Cairo', 'America/New_York', 'America/Los_Angeles', 'Europe/Berlin', 'Asia/Kathmandu', 'Pacific/Kiritimati']) {
    test(`calendar arithmetic in ${zone}`, () => {
        const result = spawnSync(process.execPath, ['-e', `${production}\n(${checkCalendarAge.toString()})();`], {
            env: { ...process.env, TZ: zone }, encoding: 'utf8', timeout: 30000
        });
        assert.ifError(result.error);
        assert.equal(result.status, 0, result.stderr || result.stdout);
        const summary = JSON.parse(result.stdout);
        assert.equal(summary.timezone, zone);
        assert.equal(summary.examples, 21);
        assert.equal(summary.invariantChecks, 57600);
    });
}
