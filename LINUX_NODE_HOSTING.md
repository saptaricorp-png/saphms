# SHPL — Saptari Hospital Pvt Ltd Clinical ERP
# Linux Node.js-Only Hosting & CloudLinux Deployment Guide
*(Designed & Developed by Dr. Santosh Majhi)*

This package includes **both**:
1. **Pre-built production bundles** (`dist/` frontend + `dist-server/server.js` Node.js server + `app.cjs` entry) — **ready to run immediately on Linux shared hosting that supports only Node.js** without running heavy Vite builds on the server.
2. **Full editable source code** (`src/`, `server/`, `server.ts`, `package.json`, `vite.config.ts`).

---

## Option 1: cPanel / DirectAdmin — CloudLinux Node.js Selector (Recommended for Shared Hosting)
1. Upload & extract the ZIP archive into your application folder (e.g. `~/hospital-erp`).
2. Open **cPanel → Setup Node.js App → Create Application**:
   - **Node.js version**: `18.x`, `20.x`, or `22.x` LTS
   - **Application mode**: `Production`
   - **Application root**: `hospital-erp` (folder where `package.json` and `app.cjs` sit)
   - **Application URL**: your hospital domain/subdomain
   - **Application startup file**: `app.cjs`
3. Click **Run NPM Install** (or via Terminal/SSH run `npm install --omit=dev` — installs only `express`, `compression`, `dotenv`).
4. Ensure `./data` directory is writable (`chmod 755 data`).
5. Click **Restart App** — live immediately! Phusion Passenger / LiteSpeed injects `PORT` automatically.

---

## Option 2: Direct Linux Node.js-Only Hosting / Plesk / Render / Railway / SSH
Extract the archive and run:
```bash
npm install --omit=dev
NODE_ENV=production PORT=3000 node app.cjs
```
Or use the 1-command launcher:
```bash
bash start-linux.sh
```

---

## Option 3: Linux VPS with PM2 Process Manager (Auto-Restart on Reboot)
```bash
npm install --omit=dev
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

---

## Option 4: Rebuilding After Custom Source Code Edits
If you modify files in `src/` or `server.ts`:
```bash
npm install
npm run build
```
Then restart `app.cjs` or `npm start`.

---

## Data Persistence & Backups
- All hospital, pharmacy, patient, billing, and finance records are stored atomically in `./data/lims-db.json`.
- Keep `./data/` backed up regularly and ensure the Node.js user has read/write permission to `./data/`.
- Health endpoint check: `GET /api/health`
