export type TeamMember = {
  name: string;
  role: string;
  initials: string;
  bio: string;
  avatarUrl?: string;
  github?: string;
  linkedin?: string;
};

export const navLinks = [
  { label: "Home", href: "/" },
  { label: "Translate", href: "/translate" },
  { label: "About us", href: "/about" },
  { label: "Contact", href: "/contact" }
];

export const projectGithub = {
  label: "Project GitHub",
  href: "https://github.com/bornayo7/Hack-SMU-VII"
};

export const heroStats = [
  { value: "In-image", label: "translation that stays inside the original visual context" },
  { value: "OCR + LLM", label: "multi-step pipeline built for real webpage images" },
  { value: "Production-ready", label: "made for manga, screenshots, signs, menus, and more" }
];

export const features = [
  {
    title: "In-place image translation",
    description:
      "Translate text locked inside images and redraw the result directly where users see it on the page.",
    icon: "image"
  },
  {
    title: "OCR text detection",
    description:
      "Detect text regions, bounding boxes, and readable copy from image-based content across the web.",
    icon: "scan"
  },
  {
    title: "Flexible AI translation",
    description:
      "Use configurable translation providers to generate natural, context-aware translations for visual text.",
    icon: "languages"
  },
  {
    title: "Browser-first workflow",
    description:
      "Launch the full experience from the browser toolbar without copying text, switching tabs, or downloading files.",
    icon: "browser"
  },
  {
    title: "Seamless visual overlays",
    description:
      "Keep the original layout and visual flow while translated text appears where the source text was shown.",
    icon: "sparkles"
  },
  {
    title: "Built to scale",
    description:
      "Designed to expand beyond webpages into manga, scanned packets, classroom handouts, and document-heavy workflows.",
    icon: "file"
  }
];

export const howItWorks = [
  {
    step: "01",
    title: "Find image-based text",
    description:
      "VisionTranslate scans the current page for images, visual panels, and other content that may contain embedded text.",
    icon: "scan"
  },
  {
    step: "02",
    title: "Extract regions with OCR",
    description:
      "OCR identifies text areas and returns structured regions so the system knows what to translate and where it belongs.",
    icon: "ocr"
  },
  {
    step: "03",
    title: "Translate with AI",
    description:
      "The extracted text is translated into the selected language with a configurable AI or translation provider.",
    icon: "translate"
  },
  {
    step: "04",
    title: "Redraw on the page",
    description:
      "The extension overlays the translated result back onto the original image so the experience feels native to the page.",
    icon: "overlay"
  }
];

export const useCases = [
  {
    title: "Manga and comics",
    description:
      "Read panels, speech bubbles, captions, and stylized text without leaving the page or breaking the reading flow.",
    image:
      "https://images.unsplash.com/photo-1588497859490-85d1c17db96d?auto=format&fit=crop&w=900&q=80",
    alt: "Colorful printed comic pages"
  },
  {
    title: "Travel signs and menus",
    description:
      "Understand photographed menus, transit signs, posters, and street-level text in a faster, more visual way.",
    image:
      "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=900&q=80",
    alt: "Restaurant table with menu and plates"
  },
  {
    title: "Screenshots and posts",
    description:
      "Translate screenshots, app captures, memes, and image-based social posts without manually retyping anything.",
    image:
      "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=900&q=80",
    alt: "Laptop screen with digital work open"
  },
  {
    title: "Classroom materials",
    description:
      "Make diagrams, visual notes, scanned handouts, and course resources easier to understand across languages.",
    image:
      "https://images.unsplash.com/photo-1524995997946-a1c2e315a42f?auto=format&fit=crop&w=900&q=80",
    alt: "Open books and study materials"
  },
  {
    title: "Infographics and explainers",
    description:
      "Translate charts, posters, dashboards, and visual explainers while preserving the surrounding design context.",
    image:
      "https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=900&q=80",
    alt: "Analytics dashboard and charts on a laptop"
  },
  {
    title: "Scanned documents",
    description:
      "Understand scanned pages, printed forms, and reference material that cannot be copied like normal webpage text.",
    image:
      "https://images.unsplash.com/photo-1504711434969-e33886168f5c?auto=format&fit=crop&w=900&q=80",
    alt: "Newspapers and printed documents on a table"
  }
];

export const teamMembers: TeamMember[] = [
  {
    name: "Yash Baruah",
    role: "Product & UI Engineer",
    initials: "YB",
    bio:
      "Designed the application's user interface and co-developed the website. Additionally, contributed to fine-tuning the OCR models and is leading the integration of Auth0 and voice assistant capabilities.",
    avatarUrl: "https://github.com/bornayo7.png?size=256",
    github: "https://github.com/bornayo7",
    linkedin: "https://www.linkedin.com/in/yashbaruah/"
  },
  {
    name: "Karyn L.D.",
    role: "Product and Frontend Engineer",
    initials: "KL",
    bio:
      "Focuses on creating a seamless user experience through robust frontend architecture, ensuring the extension and website are highly responsive, intuitive, and visually polished.",
    avatarUrl: "https://github.com/KBuildingPrograms.png?size=256",
    github: "https://github.com/KBuildingPrograms",
    linkedin: "https://www.linkedin.com/in/karyn-ld/"
  },
  {
    name: "Ijaz Kiani",
    role: "Full Stack Engineer",
    initials: "IK",
    bio:
      "Bridges the gap between backend services and user interfaces, weaving the website, browser extension, and core product workflows into a single, cohesive full-stack experience.",
    avatarUrl: "https://github.com/ijazkiani10.png?size=256",
    github: "https://github.com/ijazkiani10",
    linkedin: "https://www.linkedin.com/in/ijaz-kiani/"
  },
  {
    name: "Daniel Oni",
    role: "Backend and OCR Engineer",
    initials: "DO",
    bio:
      "Architects the core backend infrastructure and OCR pipeline, ensuring rapid, reliable text extraction and efficient data processing across the entire product ecosystem.",
    avatarUrl: "https://github.com/Logan722.png?size=256",
    github: "https://github.com/Logan722",
    linkedin: "https://www.linkedin.com/in/daniel-oni-mscs/"
  }
];

export const contactLinks = [
  { label: "Email", href: "mailto:hello@visiontranslate.dev" },
  projectGithub
];

export const githubLinks = teamMembers
  .filter(
    (member): member is TeamMember & { github: string } =>
      Boolean(member.github)
  )
  .map((member) => ({
    label: member.name,
    href: member.github
  }));

export const linkedinLinks = teamMembers
  .filter(
    (member): member is TeamMember & { linkedin: string } =>
      Boolean(member.linkedin)
  )
  .map((member) => ({
    label: member.name,
    href: member.linkedin
  }));
