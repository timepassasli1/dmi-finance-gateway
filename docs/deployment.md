# Cloud Deployment Guide

Deploy the entire platform **for free** using:
- **Railway** — Go backend + verification agent
- **Neon** — PostgreSQL database (free tier)
- **Upstash** — Redis (free tier)
- **Vercel** — Next.js frontend

---

## Step 1 — Database (Neon)

1. Go to [neon.tech](https://neon.tech) → Create account → New Project
2. Name it `gateway`
3. Copy the **Connection string** (looks like `postgresql://user:pass@host/gateway?sslmode=require`)
4. Save it as `DATABASE_URL`

---

## Step 2 — Redis (Upstash)

1. Go to [upstash.com](https://upstash.com) → Create account → New Database
2. Choose region closest to your Railway region
3. Copy the **Redis URL** (looks like `redis://default:pass@host:port`)
4. Save it as `REDIS_URL`

---

## Step 3 — Backend (Railway)

1. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub Repo
2. Connect your GitHub and select this repo
3. Set **Root Directory** to `/` (uses `railway.json` in project root)
4. Add these environment variables in Railway dashboard:

```
DATABASE_URL=<your Neon connection string>
REDIS_URL=<your Upstash Redis URL>
JWT_SECRET=<random 64-char string>
ENCRYPTION_KEY=<random 64-hex-char string>
ADMIN_EMAIL=admin@yourdomain.com
ADMIN_PASSWORD=<strong password>
CORS_ORIGINS=https://your-app.vercel.app
ENVIRONMENT=production
PORT=8080
```

5. Railway will auto-deploy. Note your backend URL: `https://xxx.railway.app`

> **Generate secrets:**
> ```bash
> # JWT_SECRET (64 chars)
> openssl rand -base64 48
> # ENCRYPTION_KEY (32 bytes = 64 hex chars)
> openssl rand -hex 32
> ```

---

## Step 4 — Frontend (Vercel)

1. Go to [vercel.com](https://vercel.com) → New Project → Import GitHub repo
2. Set **Root Directory** to `frontend`
3. Add environment variables:

```
NEXT_PUBLIC_API_URL=https://your-backend.railway.app
NEXT_PUBLIC_APP_URL=https://your-app.vercel.app
```

4. Deploy! Note your frontend URL.

5. Go back to Railway → update `CORS_ORIGINS` to your Vercel URL.

---

## Step 5 — Verification Agent (Railway — separate service)

1. In Railway → same project → **Add Service** → GitHub Repo
2. Set **Root Directory** to `verification-agent`
3. Set **Dockerfile Path** to `Dockerfile`
4. Add environment variables:

```
GATEWAY_URL=https://your-backend.railway.app
AGENT_API_KEY=<get from admin panel after login>
POLL_INTERVAL=30s
```

5. To get the `AGENT_API_KEY`:
   - Login to admin panel at `https://your-app.vercel.app/admin`
   - Go to Agents → Register New Agent → copy the API key

---

## Step 6 — Update vercel.json

Edit `vercel.json` in the root, replace the placeholder URLs:

```json
{
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "https://YOUR-BACKEND.railway.app/api/:path*"
    }
  ]
}
```

---

## Quick Secrets Generator

```bash
echo "JWT_SECRET=$(openssl rand -base64 48)"
echo "ENCRYPTION_KEY=$(openssl rand -hex 32)"
```

---

## Architecture on Cloud

```
Clients/Browser
      │
      ▼
┌─────────────┐     ┌──────────────────┐
│   Vercel    │────▶│ Railway Backend  │
│  (Next.js)  │     │   (Go + Gin)     │
└─────────────┘     └────────┬─────────┘
                             │
               ┌─────────────┼─────────────┐
               ▼             ▼             ▼
          ┌────────┐  ┌──────────┐  ┌──────────┐
          │  Neon  │  │ Upstash  │  │ Railway  │
          │ (PgSQL)│  │ (Redis)  │  │  Agent   │
          └────────┘  └──────────┘  └──────────┘
```

---

## Cost (Free Tier)

| Service | Free Tier |
|---------|-----------|
| Neon | 0.5 GB storage, 190 compute hours/month |
| Upstash Redis | 10,000 commands/day |
| Railway | $5 free credit/month (~500 hours) |
| Vercel | 100 GB bandwidth, unlimited deploys |

For production traffic, Railway ~$5-10/month, Neon ~$19/month Pro.
