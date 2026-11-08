import { expect, test } from "@playwright/test";

// Runs at phone and desktop width, in light and dark mode (see playwright.config.ts).
test("loads clean, stays inside the viewport and is one self-contained file", async ({
  page,
  baseURL,
  colorScheme,
}) => {
  const problems: string[] = [];
  const requested: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      problems.push(`console error: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => problems.push(`uncaught error: ${error.message}`));
  page.on("request", (request) => requested.push(request.url()));

  await page.goto("/");
  await expect(page.locator("#app")).not.toBeEmpty();

  const sidewaysOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(sidewaysOverflow, "page scrolls sideways").toBeLessThanOrEqual(0);

  const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const [red = 0] = background.match(/\d+/g)?.map(Number) ?? [];
  expect(red > 128, `body background ${background} in ${colorScheme} mode`).toBe(
    colorScheme === "light",
  );

  expect(requested, "page loaded more than its own document").toEqual([`${baseURL}/`]);
  expect(problems).toEqual([]);
});
