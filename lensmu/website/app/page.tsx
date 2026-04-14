import { Footer } from "@/components/layout/Footer";
import { Navbar } from "@/components/layout/Navbar";
import { AboutSection } from "@/components/sections/AboutSection";
import { DemoSection } from "@/components/sections/DemoSection";
import { Hero } from "@/components/sections/Hero";
import { HowItWorksSection } from "@/components/sections/HowItWorksSection";
import { UseCasesSection } from "@/components/sections/UseCasesSection";

export default function Home() {
  return (
    <>
      <Navbar />
      <main>
        <Hero />
        <DemoSection />
        <AboutSection />
        <HowItWorksSection />
        <UseCasesSection />
      </main>
      <Footer />
    </>
  );
}
