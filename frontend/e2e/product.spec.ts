import { test, expect } from "@playwright/test";

test("organizer creates a navigable map, publishes, updates, conflicts and revokes it", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/organize");
  await expect(
    page.getByRole("heading", { name: "Вход организатора" }),
  ).toBeVisible();
  await page.getByLabel("Email").fill(process.env.E2E_EMAIL!);
  await page
    .getByLabel("Пароль", { exact: true })
    .fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await page
    .getByLabel("Название карты", { exact: true })
    .fill("E2E пространство");
  await page.getByRole("button", { name: "Создать карту" }).click();
  const canvas = page.getByTestId("plan-canvas");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("No plan canvas");
  await canvas.click({ position: { x: box.width * 0.2, y: box.height * 0.4 } });
  await page.getByLabel("Название объекта", { exact: true }).fill("Вход");
  await canvas.click({ position: { x: box.width * 0.7, y: box.height * 0.4 } });
  await page.getByLabel("Название объекта", { exact: true }).fill("Зал");
  await page
    .getByRole("combobox", { name: "От узла", exact: true })
    .selectOption({ label: "Вход" });
  await page
    .getByRole("combobox", { name: "К узлу", exact: true })
    .selectOption({ label: "Зал" });
  await page.getByRole("button", { name: "Добавить проход" }).click();
  // Generate a valid test raster in the browser; this tests direct upload, not real stitching.
  const png = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 800;
    c.height = 400;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#65a4c9";
    ctx.fillRect(0, 0, 800, 400);
    return c.toDataURL().split(",")[1];
  });
  await page
    .getByLabel(/Импорт плана/)
    .setInputFiles({
      name: "plan.png",
      mimeType: "image/png",
      buffer: Buffer.from(png, "base64"),
    });
  await expect(canvas.locator("image")).toHaveAttribute(
    "href",
    /\/api\/v1\/media\//,
  );
  for (const name of ["Первая сфера", "Вторая сфера"]) {
    const picker = page.getByTestId("capture-point-picker");
    const rect = await picker.boundingBox();
    await picker.click({
      position: {
        x: rect!.width * (name === "Первая сфера" ? 0.2 : 0.7),
        y: rect!.height * 0.4,
      },
    });
    await page.getByLabel("Название панорамы", { exact: true }).fill(name);
    await page
      .getByLabel("Загрузить готовую панораму", { exact: true })
      .setInputFiles({
        name: "sphere.png",
        mimeType: "image/png",
        buffer: Buffer.from(png, "base64"),
      });
    await expect(
      page
        .getByRole("combobox", { name: "Панорама", exact: true })
        .locator("option")
        .filter({ hasText: name }),
    ).toHaveCount(1);
  }
  await page
    .getByRole("combobox", { name: "Панорама", exact: true })
    .selectOption({ label: "Первая сфера" });
  await page.route('**/api/v1/media/*/mobile', (route) => route.fulfill({ status: 404, body: 'Missing image' }), { times: 1 });
  await page.getByRole("button", { name: "Редактировать хотспоты" }).click();
  await expect(page.getByTestId('pannellum-fallback')).toBeVisible();
  await expect(page.getByText('Загружаем сферу 360°…', { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Закрыть панораму" }).click();
  await page.getByRole("button", { name: "Редактировать хотспоты" }).click();
  await expect(page.locator(".pnlm-render-container canvas")).toBeVisible();
  await expect(page.getByTestId("pannellum-fallback")).toHaveCount(0);
  await page.getByLabel('Тип хотспота').selectOption('poi');
  await page.getByLabel('Целевой POI').selectOption({ label: 'Вход' });
  await page.getByRole('button', { name: 'Добавить хотспот в центре' }).click();
  await page.getByLabel("Тип хотспота").selectOption("transition");
  await page
    .getByLabel("Целевая панорама")
    .selectOption({ label: "Вторая сфера" });
  await page.getByRole("button", { name: "Добавить хотспот в центре" }).click();
  await expect(page.getByText(/Добавлено хотспотов: 2/)).toBeVisible();
  await page.getByRole("button", { name: "Закрыть панораму" }).click();
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect(page.getByText("Сохранено · v2", { exact: true })).toBeVisible();
  const mapId = page.url().split("/").pop()!;
  const snapshot = await (
    await page.request.get(`/api/v1/maps/${mapId}`)
  ).json();
  const slug = snapshot.snapshot.slug;
  await page.reload();
  await expect(
    page.getByTestId("plan-canvas").locator("image"),
  ).toHaveAttribute("href", /\/media\//);
  const guest = await browser.newContext();
  const visitor = await guest.newPage();
  await visitor.goto(`${process.env.E2E_BASE_URL}/m/${slug}`);
  await expect(visitor.getByTestId("public-space-page")).toBeVisible();
  const route = await visitor.request.post(
    `${process.env.E2E_BASE_URL}/api/v1/public/maps/${slug}/route`,
    {
      data: {
        revision: 2,
        from_node_id: snapshot.snapshot.document.pois[0].nav_node_id,
        to_node_id: snapshot.snapshot.document.pois[1].nav_node_id,
      },
    },
  );
  expect(route.status()).toBe(200);
  expect((await route.json()).walk.available).toBe(true);
  await visitor.getByRole('combobox', { name: 'Откуда', exact: true }).selectOption({ label: 'Вход' });
  await visitor.getByRole('combobox', { name: 'Куда', exact: true }).selectOption({ label: 'Зал' });
  await visitor.getByRole('button', { name: 'Построить', exact: true }).click();
  await expect(visitor.getByText('Виртуальный проход: 2 шагов', { exact: true })).toBeVisible();
  await visitor.getByTitle('Панорама 1', { exact: true }).click();
  await expect(visitor.locator('.pnlm-render-container canvas')).toBeVisible();
  await visitor.getByRole('button', { name: 'Закрыть панораму' }).click();
  const embed = await guest.newPage();
  await embed.goto(`${process.env.E2E_FRAME_URL}/?slug=${slug}`);
  await expect(
    embed.frameLocator("iframe").getByTestId("public-space-page"),
  ).toBeVisible();
  const stale = await page.context().newPage();
  await stale.goto(page.url());
  await expect(
    stale.getByText("Сохранено · v2", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Название карты", { exact: true })
    .fill("Обновлённая карта");
  await page
    .getByRole("button", { name: "Сохранить карту", exact: true })
    .click();
  await expect(page.getByText("Сохранено · v3", { exact: true })).toBeVisible();
  await expect(
    visitor.getByRole("heading", { name: "Обновлённая карта", exact: true }),
  ).toBeVisible({ timeout: 20000 });
  await stale
    .getByLabel("Название карты", { exact: true })
    .fill("Локальная версия");
  await stale
    .getByRole("button", { name: "Сохранить карту", exact: true })
    .click();
  await expect(
    stale.getByText(/Карта изменена в другой вкладке/),
  ).toBeVisible();
  await expect(stale.getByLabel("Название карты", { exact: true })).toHaveValue(
    "Локальная версия",
  );
  await page.getByRole("button", { name: "Снять с публикации" }).click();
  await expect(visitor.getByTestId("public-not-found")).toBeVisible({
    timeout: 20000,
  });
  expect(
    (
      await visitor.request.get(
        `${process.env.E2E_BASE_URL}${snapshot.snapshot.assets[0].full_url}`,
      )
    ).status(),
  ).toBe(404);
  expect(errors).toEqual([]);
  await guest.close();
});
