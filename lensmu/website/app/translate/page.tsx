import { Metadata } from "next";
import { TranslatorSection } from "@/components/sections/TranslatorSection";

export const metadata: Metadata = {
  title: "Image Translator Demo | lensmu",
  description:
    "Upload a JPG, PNG, or WEBP image, detect text with your local OCR backend, and redraw the translated result."
};

export default function TranslatePage() {
  return (
    <>
      <main id="main-content">
        <TranslatorSection />
      </main>
    </>
  );
}
