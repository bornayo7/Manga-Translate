import { Metadata } from "next";
import { Footer } from "@/components/layout/Footer";
import { Navbar } from "@/components/layout/Navbar";
import { TranslatorSection } from "@/components/sections/TranslatorSection";

export const metadata: Metadata = {
  title: "Image Translator Demo | VisionTranslate",
  description:
    "Upload a JPG, PNG, or WEBP image, detect text with your local OCR backend, and redraw the translated result."
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
