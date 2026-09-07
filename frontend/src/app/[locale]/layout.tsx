import type { Metadata } from "next";
import { notFound } from "next/navigation";

export function generateStaticParams() { return [{ locale: "en" }, { locale: "es" }]; }
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!["en", "es"].includes(locale)) return {};
  const english = locale === "en";
  return { title: english ? "Live projects" : "Proyectos en vivo", description: english ? "Explore Izbri's live applications and their independently measured reliability." : "Explora las aplicaciones en vivo de Izbri y su fiabilidad medida de forma independiente.", alternates: { canonical: `/${locale}`, languages: { en: "/en", es: "/es" } }, openGraph: { locale: english ? "en_US" : "es_ES", type: "website" } };
}
export default async function LocaleLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!["en", "es"].includes(locale)) notFound();
  return children;
}
