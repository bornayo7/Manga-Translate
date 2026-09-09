export type TeamMember = {
  name: string;
  role: string;
  initials: string;
  bio: string;
  avatarUrl?: string;
  github?: string;
  linkedin?: string;
};

export const navLinks = [{label:"Demo",href:"/translate"},{label:"Install",href:"/install"},{label:"About",href:"/about"},{label:"Contact",href:"/contact"}];
export const projectGithub = {label:"Project GitHub",href:"https://github.com/bornayo7/Manga-Translate"};

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

