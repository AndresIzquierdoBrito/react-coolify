import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Izbri Projects",
    short_name: "Izbri Projects",
    description: "Live applications, case studies, and independently measured reliability by Izbri.",
    start_url: "/en",
    display: "standalone",
    background_color: "#f8f7f4",
    theme_color: "#f8f7f4",
    icons: [
      {
        src: "/izbri-projects-icon.png",
        sizes: "1100x1142",
        type: "image/png",
      },
      {
        src: "/izbri-projects-icon.svg",
        type: "image/svg+xml",
      },
    ],
  };
}
