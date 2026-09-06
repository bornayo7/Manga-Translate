# VisionTranslate Website

Marketing website for VisionTranslate. The site presents the browser extension,
explains the OCR and translation workflow, embeds a product showcase video,
introduces the engineering team, provides a contact form for business
inquiries, and hosts a limited in-browser translation demo at `/translate`.
It also includes a persistent light/dark theme toggle and an optional
Auth0-backed preferences API that only activates when its environment
variables are set.

## Tech Stack

- Next.js 16 with the App Router
- TypeScript
- Tailwind CSS
- shadcn/ui-style local components
- Auth0 (`@auth0/nextjs-auth0`, optional) for sign-in and the preferences API
- Responsive desktop and mobile layout

## File Structure

```txt
website/
  app/
    about/page.tsx
    api/preferences/route.ts   GET/PUT synced preferences (Auth0-gated)
    contact/page.tsx
    translate/page.tsx         limited in-browser demo
    globals.css
    layout.tsx
    page.tsx
  components/
    auth/
      AppAuthProvider.tsx
      AuthButtons.tsx
    layout/
      BrandLogo.tsx
      Footer.tsx
      Navbar.tsx
    sections/
      AboutSection.tsx
      ContactSection.tsx
      DemoSection.tsx
      Hero.tsx
      HowItWorksSection.tsx
      TeamSection.tsx
      TranslatorSection.tsx
      UseCasesSection.tsx
    ui/
      badge.tsx
      button.tsx
      card.tsx
      input.tsx
      label.tsx
      reveal-on-scroll.tsx
      textarea.tsx
  data/
    site.ts                    copy, team, links
  lib/
    api-auth.ts                bearer-token / session auth for the API
    auth0.ts                   Auth0 client, enabled only with env vars
    extension-cors.ts          CORS allowlist for the extension origin
    preferences-schema.ts      zod schema mirroring ../extension/shared/preferences.js
    preferences-store.ts       Auth0 user_metadata read/write
    translator.ts              demo pipeline: backend OCR -> MyMemory -> canvas
    utils.ts
  proxy.ts                     Next.js middleware wrapping Auth0
  .env.example
  components.json
  eslint.config.mjs
  next.config.mjs
  package.json
  postcss.config.mjs
  tailwind.config.ts
  tsconfig.json
```

The preferences schema imports the canonical defaults from
`../extension/shared/preferences.js`, so the website and the extension cannot
drift apart on what a preference is called or what its default is.

## Setup

```bash
cd lensmu/website
npm install
npm run dev
```

Open `http://localhost:3000` in your browser.

Node.js 20.9 or newer is required.

Auth0 sign-in and the `/api/preferences` route are off until the variables in
`.env.example` are provided in `.env.local`; the public pages work without
them. The `/translate` demo needs the Python backend running on
`http://localhost:8000` (see `../backend/README.md`).

## Build

```bash
npm run lint
npm run typecheck
npm run build
npm run start
```

## Customization

- Update team members, use cases, features, and links in `data/site.ts`.
- The product tour in `components/sections/DemoSection.tsx` is a YouTube embed;
  swap the video ID there.
- Update the contact links in `data/site.ts`.
