import type { Metadata } from "next";

import { ContactSection } from "@/components/sections/ContactSection";

export const metadata: Metadata = {
  title: "Contact | lensmu",
  description:
    "Contact the lensmu team for business inquiries, collaboration, or product questions."
};

export default function ContactPage() {
  return (
    <>
      <main id="main-content">
        <ContactSection />
      </main>
    </>
  );
}
