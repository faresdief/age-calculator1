# Professional Age Dashboard | منصة العمر الاحترافية

A static website that works out your age to the second from a birth date. Pure HTML, CSS and JavaScript, no server and no libraries. Everything you enter stays in your browser.

**Live demo:** https://faresdief.github.io/age-calculator1/

موقع ثابت بيحسب عمرك بالسنة والشهر واليوم والثانية، وكل البيانات بتتحفظ على جهازك بس.

## Features

- Live age counter (years, months, days, hours, minutes, seconds) and totals in weeks, days, hours and seconds
- Age in the Hijri calendar and the Hijri birth date
- Countdown to the next birthday, birthday weekday, silver and gold jubilee dates and age milestones
- Health estimates: heartbeats, breaths, water and sleep
- Compare ages with family members (up to 12 people saved on the device)
- Share card: save your age as a 1080x1350 PNG image
- Six interface languages: Arabic, English, French, Spanish, German and Russian
- Dark and light themes, installable, works offline

## الملفات | Files

| File | Purpose |
|---|---|
| `index.html` | The page, SEO tags and a small head script that sets language and theme before first paint |
| `style.css` | Styles and animation (respects `prefers-reduced-motion`) |
| `i18n.js` | All text in the six languages |
| `script.js` | Logic: live counter, Hijri, family comparison, saving, install |
| `effects.js` | Confetti and number counters, no external library |
| `share-card.js` | Draws the share image |
| `sw.js`, `manifest.webmanifest` | Offline support and install |
| `fonts.css`, `download-fonts.py` | Optional self-hosted Cairo font (see below) |
| `test/calendar-age.test.js` | Age calculation tests |

## Run it

Any static server works:

```bash
python3 -m http.server 8000
# open http://localhost:8000/
```

## Tests

Node.js 18 or later, nothing to install:

```bash
npm test
```

Years, months and days use the local calendar date, so time zones and daylight saving do not change the result. A full month counts from the original birth day; when the month is shorter the last day of that month is used (31 January to 28 February is one month, to 1 March is one month and one day). Someone born on 29 February turns a year older on 28 February in non-leap years. The tests cover month ends, leap years, year rollover, midnight and daylight saving in seven time zones, and 57,600 month-end cases per zone over a full 400-year calendar cycle.

## Deploy

1. Bump `VERSION` at the top of `sw.js` (for example `v2.0.2`) so browsers drop the old cache and load the new files.
2. Push to `main`. A GitHub Actions workflow publishes the site to GitHub Pages.

## Self-hosted font (optional)

The page loads Cairo from Google Fonts by default. To host it yourself, `download-fonts.py` downloads the font files into `fonts/`, fills `fonts.css` and removes the Google Fonts links from `index.html`. The script finds the project root as the parent of its own folder, so put it in a `tools/` folder first and run `python tools/download-fonts.py` (needs internet once), then commit `fonts/` and `index.html`.

## SEO to-do

Add `<link rel="canonical">`, `og:url` and `og:image` with full URLs, a `sitemap.xml`, and a `Sitemap:` line in `robots.txt`.

## License

Copyright (c) 2026 Fares Mahmoud (faresdief). All rights reserved. See `LICENSE`.
