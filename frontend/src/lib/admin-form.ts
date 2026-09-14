import type { ProjectInput } from "@izbri/contracts";

export function getMissingPublicationFields(form: ProjectInput): Partial<Record<keyof ProjectInput, string>> {
  const errors: Partial<Record<keyof ProjectInput, string>> = {};
  const required: [keyof ProjectInput, string][] = [
    ["titleEn", "Add the English project name before publishing."],
    ["titleEs", "Añade el nombre del proyecto en español antes de publicar."],
    ["summaryEn", "Add the English summary before publishing."],
    ["summaryEs", "Añade el resumen en español antes de publicar."],
    ["descriptionEn", "Add the English detailed overview before publishing."],
    ["descriptionEs", "Añade la descripción detallada en español antes de publicar."],
    ["coverAltEn", "Add English alternative text before publishing."],
    ["coverAltEs", "Añade el texto alternativo en español antes de publicar."],
  ];
  for (const [key, message] of required) if (typeof form[key] === "string" && !form[key].trim()) errors[key] = message;
  if (form.operationalNoticeType !== "none") {
    if (!form.maintenanceMessageEn.trim()) errors.maintenanceMessageEn = "Add the English notice before publishing.";
    if (!form.maintenanceMessageEs.trim()) errors.maintenanceMessageEs = "Añade el aviso en español antes de publicar.";
  }
  for (const [index, resource] of (form.resources ?? []).entries()) {
    if (!resource.labelEn.trim()) errors.resources = `Add an English label for resource ${index + 1}.`;
    if (!resource.labelEs.trim()) errors.resources = `Añade una etiqueta en español para el recurso ${index + 1}.`;
    if (resource.uptimeEnabled && !resource.healthUrl?.trim()) errors.resources = `Add a health-check URL for resource ${index + 1}.`;
  }
  return errors;
}

export function getChangedProjectFields(form: ProjectInput, saved: ProjectInput): (keyof ProjectInput)[] {
  return (Object.keys(form) as (keyof ProjectInput)[]).filter((key) => {
    const left = form[key];
    const right = saved[key];
    return Array.isArray(left) && Array.isArray(right) ? JSON.stringify(left) !== JSON.stringify(right) : left !== right;
  });
}
