# Market Insights — Web (Next.js)

Modern trading dashboard UI using Next.js, TailwindCSS, and Framer Motion. Talks to the FastAPI backend in `../app`.

## Setup

1) Install deps

```
npm install
```

2) Configure env

```
cp .env.example .env
# adjust NEXT_PUBLIC_API_URL if backend is remote
```

3) Run dev server

```
npm run dev
```

Open http://localhost:3000

## Notes
- Uses a glassmorphism dark theme with subtle gradients and shadows
- Sidebar nav with icons
- Cards for Watchlist, Last Quote, News, Macro Calendar, Analyses, Entry Plan
- Animations with Framer Motion
- Wire API calls in `lib/api.ts` where needed