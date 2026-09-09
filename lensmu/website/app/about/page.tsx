import type { Metadata } from "next";

import { TeamSection } from "@/components/sections/TeamSection";

export const metadata: Metadata = {
  title: "About Us | lensmu",
  description:
    "Meet the team behind lensmu, the browser extension for translating text inside webpage images."
};

export default function AboutPage() {
  return (
    <>
      <main id="main-content">
        <TeamSection />
      </main>
    </>
  );
}
