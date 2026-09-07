import type { ProjectAccent } from "@izbri/contracts";

export const projectAccents: { value: ProjectAccent; label: string; hex: string }[] = [
  { value: "lime", label: "Electric lime", hex: "#c2ef4e" },
  { value: "chartreuse", label: "Volt chartreuse", hex: "#9dff57" },
  { value: "mint", label: "Laser mint", hex: "#65efac" },
  { value: "aqua", label: "Plasma aqua", hex: "#53f4cf" },
  { value: "cyan", label: "Acid cyan", hex: "#42e8dc" },
  { value: "turquoise", label: "Digital turquoise", hex: "#38d8ff" },
  { value: "sky", label: "Signal blue", hex: "#67b7ff" },
  { value: "periwinkle", label: "Electric periwinkle", hex: "#8b9cff" },
  { value: "yellow", label: "Lemon flash", hex: "#e8ff54" },
  { value: "amber", label: "Solar amber", hex: "#ffc857" },
  { value: "tangerine", label: "Neon tangerine", hex: "#ff9f43" },
  { value: "coral", label: "Hot coral", hex: "#ff7d70" },
  { value: "raspberry", label: "Laser raspberry", hex: "#ff5f89" },
  { value: "pink", label: "Neon pink", hex: "#ff79b8" },
];

export function projectAccentHex(value: ProjectAccent) {
  return projectAccents.find((accent) => accent.value === value)?.hex ?? projectAccents[0]!.hex;
}
