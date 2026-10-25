# Health Tracker

A self-hosted health app for your household. It runs on your own server (for example a Proxmox container), and everyone gets their own private account.

## Features

- **Food log:** track calories, protein, carbs and fat by meal (breakfast, lunch, dinner, snacks), with daily goals and a 7-day chart.
  - **Scan a barcode** with your phone's camera, from a photo, or by typing the number. Product data comes from [Open Food Facts](https://world.openfoodfacts.org).
  - **Search** foods by name.
  - **Enter food manually**, or re-log something from your **recent** foods in one tap.
  - **Ask Claude:** opens a chat with Claude that already asks for the food's nutrition. Claude's estimate has an **Add to log** button, and you can keep chatting.
- **Water tracker:** quick-add buttons, a daily goal, and 7-day history. Amounts can be shown in oz or ml.
- **Recipes:** save your recipes with ingredients and servings. The app works out the nutrition per serving, so you can log a serving in one tap.
- **Workouts:** recommended plans for **home** and **gym** based on your goal (lose fat, build muscle, get fitter, core), plus an exercise library. Each exercise has step-by-step instructions and a **Watch how to do it** link to how-to videos.
- **Multiple users:** each person signs in with their own username and password. Logs, water, recipes and goals are separate, so nobody's entries mix with anyone else's.
- **Everything is stored on your server** in one SQLite file (`data/health.db`).

The app is mobile-first. On a phone, open it in the browser and choose **Add to Home Screen** to use it like an app.

## Run it on Proxmox

The easiest way is Docker inside a small Debian container (LXC) or VM.

### 1. Create the container

In the Proxmox web UI, click **Create CT** and use these settings:

- Template: **Debian 12**
- Disk: 8 GB
- CPU: 1 core
- Memory: 1024 MB
- Network: DHCP, or a static IP (a static IP is easier to bookmark)
- On the **Options** tab after it's created, set **Features → Nesting = on** (Docker needs this).

Start the container and open its console.

### 2. Install Docker and get the app

```bash
apt update && apt install -y curl git
curl -fsSL https://get.docker.com | sh

git clone https://github.com/JohnKeeg8/food_tracker_app.git
cd food_tracker_app
cp .env.example .env
nano .env        # paste your Anthropic API key, then save with Ctrl+O, Enter, Ctrl+X
```

### 3. Start it

```bash
docker compose up -d --build
```

Open `http://<container-ip>:8080` on your phone or computer. Each person taps **Create an account**.

Once everyone has an account, set `ALLOW_SIGNUP=false` in `.env` and run `docker compose up -d` so nobody else can sign up.

### Updating

```bash
cd food_tracker_app
git pull
docker compose up -d --build
```

Your data in `data/` is kept.

### Backups

All data is in `food_tracker_app/data/health.db`. Proxmox's built-in backups (**Datacenter → Backup**) of the container include it. You can also copy the file somewhere else.

## Live barcode scanning needs HTTPS

Browsers only allow live camera access on HTTPS pages. Over plain `http://` the Scan tab still works: tap **Take a photo of the barcode** (the phone camera opens and the app reads the barcode from the photo), or type the number.

For the live camera view, use one of these:

- **Tailscale (recommended, with a real certificate):** install [Tailscale](https://tailscale.com) in the container and on your phones. Then run `tailscale serve --bg 8080` and open the `https://<name>.<tailnet>.ts.net` address it prints. This also lets you use the app away from home.
- **Built-in HTTPS proxy (self-signed):** set `SITE_ADDRESS` in `.env` to the container's IP, then run `docker compose --profile https up -d`. Open `https://<container-ip>`. Your browser will warn that the certificate isn't trusted. Accept it once (or install Caddy's root certificate from `caddy-data/caddy/pki/authorities/local/root.crt` on your devices).

## Ask Claude

"Ask Claude" uses the [Anthropic API](https://console.anthropic.com). Create an API key there, put it in `.env` as `ANTHROPIC_API_KEY`, and restart with `docker compose up -d`. API usage is billed to that key's account. The app uses short answers to keep costs low. If the key is left empty, the Ask Claude buttons are hidden.

## Settings (`.env`)

| Variable | Default | What it does |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | (empty) | Enables Ask Claude. |
| `CLAUDE_MODEL` | `claude-opus-5-5` | Claude model used for the chat. |
| `ALLOW_SIGNUP` | `true` | Whether new accounts can be created. |
| `SIGNUP_CODE` | (empty) | If set, people must enter this code to sign up. |
| `APP_PORT` | `8080` | Port the app is served on. |
| `SITE_ADDRESS` | | Address used by the optional HTTPS proxy. |

## Development

Requires Node.js 22.13 or later.

```bash
npm install
npm run dev:server   # API on http://localhost:8080 (data stored in ./data)
npm run dev:client   # web app on http://localhost:5173, proxies /api to the server
npm run build        # production build; then `npm start`
```

Project layout:

- `server/`: Express + TypeScript API, SQLite via Node's built-in `node:sqlite`.
  - `src/auth.ts`: accounts and sessions.
  - `src/routes/tracking.ts`: food, water, goals and history.
  - `src/routes/recipes.ts`: recipes.
  - `src/routes/lookup.ts`: Open Food Facts barcode lookup and search.
  - `src/routes/chat.ts`: Ask Claude.
- `client/`: React + Vite web app.
  - `src/pages/`: one file per screen.
  - `src/data/workouts.ts`: the workout plans and exercise library, which you can edit to add your own.
