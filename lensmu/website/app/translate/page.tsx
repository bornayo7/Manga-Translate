import { Metadata } from "next";
import { Footer } from "@/components/layout/Footer";
import { Navbar } from "@/components/layout/Navbar";
import { TranslatorSection } from "@/components/sections/TranslatorSection";

export const metadata: Metadata = {
  title: "Document Translator | VisionTranslate",
  description:
    "Upload PDFs and images to detect, translate, and securely overlay text right where it belongs."
};

export default function TranslatePage() {
  return (
    <>
      <Navbar />
      <main>
        <TranslatorSection />
      </main>
      <Footer />
    </>
  );
}
