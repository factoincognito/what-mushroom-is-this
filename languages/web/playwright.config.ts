import { defineConfig, devices } from "@playwright/test";

const viewports = {
  phone: { width: 375, height: 800 },
  desktop: { width: 1280, height: 800 },
};
const colorSchemes = ["light", "dark"] as const;

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: "http://localhost:4173" },
  // Every test runs at phone and desktop width, in light and dark mode.
  projects: Object.entries(viewports).flatMap(([name, viewport]) =>
    colorSchemes.map((colorScheme) => ({
      name: `${name}-${colorScheme}`,
      use: { ...devices["Desktop Chrome"], viewport, colorScheme },
    })),
  ),
  // Serves the built single file. `npm run test:e2e` builds first.
  webServer: {
    command: "npm run preview -- --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
  },
});
