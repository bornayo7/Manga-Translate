# VisionTranslate Website

Marketing website for VisionTranslate. The site presents the browser extension,
explains the OCR and translation workflow, includes a product showcase video,
introduces the engineering team, and provides a contact form for business
inquiries. It also includes a persistent light/dark theme toggle and footer
links for team GitHub and LinkedIn profiles.

## Tech Stack

- Next.js 14 with the App Router
- TypeScript
- Tailwind CSS
- shadcn/ui-style local components
- Responsive desktop and mobile layout

## File Structure

```txt
website/
  app/
    globals.css
    layout.tsx
    page.tsx
  components/
    layout/
      Footer.tsx
      Navbar.tsx
    sections/
      AboutSection.tsx
      ContactSection.tsx
      DemoSection.tsx
      FeaturesSection.tsx
      Hero.tsx
      ProductPreview.tsx
      TeamSection.tsx
    ui/
      badge.tsx
      button.tsx
      card.tsx
      input.tsx
      label.tsx
      textarea.tsx
  data/
    site.ts
  lib/
    utils.ts
  components.json
  next.config.mjs
  package.json
  postcss.config.mjs
  tailwind.config.ts
  tsconfig.json
```

## Setup

```bash
cd website
npm install
npm run dev
```

Open `http://localhost:3000` in your browser.

## Build

```bash
npm run build
npm run start
```

## Customization

- Update team members, use cases, features, and links in `data/site.ts`.
- Replace the showcase placeholder in `components/sections/DemoSection.tsx` with
  a YouTube, Vimeo, or local video embed for the product tour.
- Update the contact links in `data/site.ts`.
