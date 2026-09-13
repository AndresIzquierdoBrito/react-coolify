import { expect, test, type Page } from "@playwright/test";

const adminCatalogResources = [
  { id: "resource-1", resourceType: "application", resourceUuid: "uuid-1", name: "Atlas API", description: "Customer billing API", status: "running", sourceType: "docker-compose", suggestedUrls: ["https://atlas.example.com"], imported: false, syncedAt: "2026-09-13T12:00:00.000Z", team: { id: "team-default", name: "Default team" } },
  { id: "resource-2", resourceType: "service", resourceUuid: "uuid-2", name: "Atlas Worker", description: "Background jobs", status: "running", sourceType: "docker-compose", suggestedUrls: ["https://worker.example.com"], imported: false, syncedAt: "2026-09-13T12:00:00.000Z", team: { id: "team-default", name: "Default team" } },
  { id: "resource-3", resourceType: "application", resourceUuid: "uuid-3", name: "Lumen Web", description: "Public dashboard", status: "running", sourceType: "github", suggestedUrls: ["https://lumen.example.com"], imported: false, syncedAt: "2026-09-13T12:00:00.000Z", team: { id: "team-apuntex", name: "Apuntex Team" } },
  { id: "resource-4", resourceType: "application", resourceUuid: "uuid-4", name: "Lumen Docs", description: "Documentation site", status: "running", sourceType: "github", suggestedUrls: ["https://docs.example.com"], imported: false, syncedAt: "2026-09-13T12:00:00.000Z", team: { id: "team-apuntex", name: "Apuntex Team" } },
  { id: "resource-5", resourceType: "service", resourceUuid: "uuid-5", name: "Orbit Queue", description: "Queue service", status: "running", sourceType: "docker-compose", suggestedUrls: ["https://queue.example.com"], imported: false, syncedAt: "2026-09-13T12:00:00.000Z", team: { id: "team-default", name: "Default team" } },
  { id: "resource-6", resourceType: "application", resourceUuid: "uuid-6", name: "Nova Admin", description: "Internal admin surface", status: "running", sourceType: "gitlab", suggestedUrls: ["https://nova.example.com"], imported: false, syncedAt: "2026-09-13T12:00:00.000Z", team: { id: "team-apuntex", name: "Apuntex Team" } },
];

async function mockAuthenticatedAdmin(page: Page) {
  await page.route("**/api/v1/auth/session", (route) => route.fulfill({ json: { authenticated: true, configured: true, methods: { github: true, password: false }, csrfToken: "test-csrf", user: { login: "izbri", displayName: "Andrés Izbri", avatarUrl: null } } }));
  await page.route("**/api/v1/admin/projects", (route) => route.fulfill({ json: { projects: [] } }));
  await page.route("**/api/v1/admin/coolify/resources", (route) => route.fulfill({ json: { configured: true, teams: [{ id: "team-default", name: "Default team", apiUrl: "https://coolify.example.com", credentialSource: "database", tokenConfigured: true, enabled: true, syncStatus: "success", lastAttemptAt: null, lastSuccessfulAt: null, lastErrorCode: null, lastErrorMessage: null, syncedResourceCount: 3 }, { id: "team-apuntex", name: "Apuntex Team", apiUrl: "https://apuntes.example.com", credentialSource: "database", tokenConfigured: true, enabled: true, syncStatus: "success", lastAttemptAt: null, lastSuccessfulAt: null, lastErrorCode: null, lastErrorMessage: null, syncedResourceCount: 3 }], resources: adminCatalogResources, sentinel: { serverCount: 0, enabledCount: 0, metricsEnabledCount: 0, lastReportedAt: null } } }));
}

test("renders localized controls without horizontal overflow", async ({ page }) => {
  await page.goto("/es");
  await expect(page.getByRole("heading", { name: /Izbri Proyectos/i })).toBeVisible();
  await expect(page.getByRole("button", { name: "Filtrar proyectos" })).toBeVisible();
  if ((page.viewportSize()?.width ?? 1000) <= 650) {
    const toolbar = await page.getByRole("navigation", { name: "Controles de proyectos" }).boundingBox();
    const language = page.getByRole("button", { name: "Switch to English" });
    expect(Math.abs(((toolbar?.x ?? 0) + (toolbar?.width ?? 0) / 2) - (page.viewportSize()?.width ?? 0) / 2)).toBeLessThan(2);
    await expect(language.locator("svg.language-flag")).toBeVisible();
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
  const sort = page.getByRole("button", { name: "Ordenar proyectos" });
  await sort.click();
  const [triggerBox, menuBox] = await Promise.all([sort.boundingBox(), page.locator(".sort-popover").boundingBox()]);
  expect((menuBox?.x ?? 0) + 2).toBeGreaterThanOrEqual(triggerBox?.x ?? 0);
});

test("language and appearance controls remain interactive", async ({ page }) => {
  const scriptWarnings: string[] = [];
  page.on("console", (message) => { if (message.type() === "error" && message.text().includes("Encountered a script tag")) scriptWarnings.push(message.text()); });
  await page.goto("/en");
  await page.getByRole("button", { name: "Cambiar a español" }).click();
  await expect(page).toHaveURL(/\/es(?:\?|$)/);
  await expect(page.getByRole("heading", { name: "Izbri Proyectos" })).toBeVisible();
  expect(scriptWarnings).toHaveLength(0);
  const before = await page.locator("html").getAttribute("data-theme");
  await page.getByRole("button", { name: "Cambiar tema de color" }).click();
  await expect.poll(() => page.locator("html").getAttribute("data-theme")).not.toBe(before);
});

test("long project names stay inside their identity region", async ({ page }) => {
  await page.goto("/en");
  const identity = page.locator(".project-identity").first();
  const title = identity.locator("h2");
  await title.evaluate((element) => { element.textContent = "andres-izquierdo-portfolio-main-c85hnv9p69wbhcmunm8ugs5-with-an-even-longer-unbroken-suffix"; });
  const [identityBox, titleBox] = await Promise.all([identity.boundingBox(), title.boundingBox()]);
  expect((titleBox?.x ?? 0) + (titleBox?.width ?? 0)).toBeLessThanOrEqual((identityBox?.x ?? 0) + (identityBox?.width ?? 0) + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
});

test("admin requires authentication", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Izbri Projects admin" })).toBeVisible();
});

test("Coolify catalog supports responsive views, filters, and preserved import drafts", async ({ page }) => {
  await mockAuthenticatedAdmin(page);
  let importBody: Record<string, unknown> | null = null;
  await page.route("**/api/v1/admin/projects/import", async (route) => {
    importBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: "imported-project" }) });
  });
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Import something new" })).toBeVisible();

  const cards = page.locator(".resource-strip .import-card:not([hidden])");
  await expect(cards).toHaveCount(adminCatalogResources.length);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  if ((page.viewportSize()?.width ?? 1000) > 700) {
    const boxes = await cards.evaluateAll((elements) => elements.map((element) => Math.round(element.getBoundingClientRect().y)));
    expect(new Set(boxes).size).toBeGreaterThan(1);
  }

  const search = page.getByRole("searchbox", { name: "Search Coolify resources" });
  await search.fill("lumen");
  await expect(cards).toHaveCount(2);
  await page.getByRole("combobox", { name: "Filter by team" }).selectOption("team-apuntex");
  await page.getByRole("combobox", { name: "Filter by resource type" }).selectOption("application");
  await expect(cards).toHaveCount(2);
  await search.fill("does-not-exist");
  await expect(page.getByText("No resources match these filters.")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).first().click();
  await expect(cards).toHaveCount(adminCatalogResources.length);

  const atlasCard = page.locator(".import-card").filter({ hasText: "Atlas API" });
  const atlasUrl = atlasCard.getByRole("textbox", { name: "Public URL" });
  await atlasUrl.fill("https://edited-atlas.example.com");
  await page.getByRole("button", { name: "List" }).click();
  await expect(page.getByRole("button", { name: "List" })).toHaveAttribute("aria-pressed", "true");
  await expect(atlasUrl).toHaveValue("https://edited-atlas.example.com");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  if ((page.viewportSize()?.width ?? 1000) <= 700) {
    const listCardBox = await atlasCard.boundingBox();
    expect(listCardBox?.width ?? 0).toBeLessThanOrEqual((page.viewportSize()?.width ?? 0) - 24);
  }
  await atlasCard.getByRole("button", { name: "Import draft" }).click();
  await expect.poll(() => importBody).toMatchObject({ resourceId: "resource-1", liveUrl: "https://edited-atlas.example.com" });
  await page.reload();
  await expect(page.getByRole("button", { name: "List" })).toHaveAttribute("aria-pressed", "true");
});

test("sample projects open URL-backed details when the real catalog is empty", async ({ page }) => {
  await page.goto("/en");
  const sampleNotice = page.getByText("Sample projects are shown until the first real project is published.");
  test.skip(!await sampleNotice.isVisible(), "A real published project has replaced the empty-catalog samples.");
  await expect(page.locator("article.project-card")).toHaveCount(3);
  await expect(page.locator("article.project-card").first().getByRole("link", { name: /Open live application/ })).toHaveAttribute("href", "https://example.com");
  await page.getByRole("button", { name: /Atlas Inbox/ }).click();
  await expect(page).toHaveURL(/project=demo-atlas-inbox/);
  await expect(page.getByRole("dialog", { name: "Atlas Inbox" })).toBeVisible();
  await page.getByRole("dialog", { name: "Atlas Inbox" }).getByRole("button", { name: "Close details" }).click();
  await expect(page).not.toHaveURL(/project=/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: /Atlas Inbox/ }).click();
  await expect(page.getByRole("dialog", { name: "Atlas Inbox" }).locator(".carousel-graphic")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Next project image" })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Atlas Inbox" }).locator(".deployment-meta > div")).toHaveCount(6);
  const chart = page.locator(".latency-chart");
  await expect(chart).toBeVisible();
  expect(await chart.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe("rgb(17, 19, 14)");
  expect(Number(await chart.locator("polyline").evaluate((element) => getComputedStyle(element).strokeWidth.replace("px", "")))).toBeGreaterThanOrEqual(3.5);
});

test("sample operational notices distinguish deployments, maintenance, and incidents", async ({ page }) => {
  await page.goto("/en");
  const sampleNotice = page.getByText("Sample projects are shown until the first real project is published.");
  test.skip(!await sampleNotice.isVisible(), "A real published project has replaced the empty-catalog samples.");
  const canary = page.locator("article.project-card").filter({ hasText: "Canary Notes" });
  await expect(canary.locator(".deployment-pill")).toContainText("Deployment in progress");
  await expect(canary.locator(".operational-banner")).toContainText("Maintenance in progress");
  await expect(canary.locator(".operational-banner")).toContainText("Brief maintenance is planned");
  const lumen = page.locator("article.project-card").filter({ hasText: "Lumen API" });
  await expect(lumen.locator(".operational-banner")).toContainText("Active incident");
  await expect(lumen.locator(".operational-banner")).toContainText("HTTP 503");
  await expect(lumen.locator(".operational-banner").getByRole("link", { name: /Contact the owner/ })).toBeVisible();
  await expect(lumen.getByRole("link", { name: /Report a problem/ })).toHaveAttribute("href", /project=demo-lumen-api/);
});

test("switching detail projects does not replay list entrance animation", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) <= 860, "The mobile full-screen sheet intentionally covers the list.");
  await page.goto("/en");
  const sampleNotice = page.getByText("Sample projects are shown until the first real project is published.");
  test.skip(!await sampleNotice.isVisible(), "A real published project has replaced the empty-catalog samples.");
  await page.getByRole("button", { name: /Atlas Inbox/ }).click();
  await expect(page.getByRole("dialog", { name: "Atlas Inbox" })).toBeVisible();
  await page.waitForTimeout(550);
  await page.evaluate(() => {
    const card = document.querySelector("article.project-card");
    (window as typeof window & { cardStyleMutations?: number }).cardStyleMutations = 0;
    if (card) new MutationObserver((records) => { (window as typeof window & { cardStyleMutations?: number }).cardStyleMutations! += records.length; }).observe(card, { attributes: true, attributeFilter: ["style"] });
  });
  await page.getByRole("button", { name: /Canary Notes/ }).click();
  await expect(page.getByRole("dialog", { name: "Canary Notes" })).toBeVisible();
  expect(await page.evaluate(() => (window as typeof window & { cardStyleMutations?: number }).cardStyleMutations ?? 0)).toBe(0);
});

test("footer carries Izbri identity and verified icon links", async ({ page }) => {
  await page.goto("/en");
  const footer = page.locator("footer.site-footer");
  await expect(footer.getByText("izbri.com™")).toBeVisible();
  await expect(footer.getByRole("link", { name: "Main website" })).toHaveAttribute("href", "https://izbri.com");
  await expect(footer.getByRole("link", { name: "LinkedIn" })).toHaveAttribute("href", "https://www.linkedin.com/in/andresizbri");
  await expect(footer.getByRole("link", { name: "GitHub" })).toHaveAttribute("href", /github\.com/);
});

test("unknown routes use the localized 404", async ({ page }) => {
  await page.goto("/es/esto-no-existe");
  await expect(page.getByRole("heading", { name: "Este proyecto se salió de órbita." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Volver a los proyectos" })).toHaveAttribute("href", "/es");
});
