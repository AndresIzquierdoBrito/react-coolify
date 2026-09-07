"use client";

import Link from "next/link";
import { ArrowLeft, Orbit } from "lucide-react";
import { usePathname } from "next/navigation";

export default function NotFound() {
  const spanish = usePathname().startsWith("/es");
  return <main className="not-found-page">
    <div className="not-found-art" aria-hidden="true"><span>404</span><Orbit /></div>
    <span className="eyebrow">{spanish ? "Ruta no encontrada" : "Route not found"}</span>
    <h1>{spanish ? "Este proyecto se salió de órbita." : "This project drifted out of orbit."}</h1>
    <p>{spanish ? "La página que buscas no existe o se ha movido a una nueva dirección." : "The page you’re looking for does not exist or has moved somewhere new."}</p>
    <Link className="primary-button" href={spanish ? "/es" : "/en"}><ArrowLeft size={17} />{spanish ? "Volver a los proyectos" : "Back to projects"}</Link>
  </main>;
}
