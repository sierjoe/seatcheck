# SeatCheck — setup

## 1. Put it online once (free, GitHub Pages)
1. Sign up at github.com, then tap **+ → New repository**. Name it `seatcheck`, set it to **Public**, create it.
2. Tap **Add file → Upload files** and upload all the files in the folder (index.html, sw.js, sf2.js, clean.js, xlsx.js, jszip.min.js, qrcode.js, jsqr.js, sf2-template.xlsx, manifest.webmanifest, and the 3 PNG icons). Commit.
3. Go to **Settings → Pages**. Under "Branch", pick **main** and **/(root)**, then Save.
4. After 1–2 minutes your link is: `https://YOUR-USERNAME.github.io/seatcheck/`

Only the app itself goes online. Student names and attendance stay on your devices.

## 2. Install
- **iPhone:** open the link in Safari, tap **Share → Add to Home Screen**. Open it once from the home screen while online. After that it works offline.
- **MacBook:** open the link in Safari, then **File → Add to Dock**.

Always open the app from the home screen / Dock icon, not a Safari tab. They keep separate data.

## 3. Moving data between iPhone and Mac
Classes tab → **Export backup** → AirDrop the file → on the other device, **Import backup**. Importing replaces that device's data.

## Updating the app later
Upload the changed files, then change `seatcheck-v1` to `seatcheck-v2` in sw.js. Open the app online twice to pick up the update.
