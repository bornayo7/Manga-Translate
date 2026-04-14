import type { Metadata } from "next";

import { Footer } from "@/components/layout/Footer";
import { Navbar } from "@/components/layout/Navbar";
import { TeamSection } from "@/components/sections/TeamSection";

export const metadata: Metadata = {
  title: "About Us | VisionTranslate",
  description:
    "Meet the team behind VisionTranslate, the browser extension for translating text inside webpage images."
};

export default function AboutPage() {
  return (
    <>
      <Navbar />
      <main>
        <TeamSection />
      </main>
      <Footer />
    </>
  );
}
