/**
 * Starter tests — keep CI green on a fresh project.
 * Delete them together with the starter App when you write your own components and tests.
 */
import { render, screen } from "@testing-library/react-native";

import App, { greeting } from "./App";

describe("greeting", () => {
  it("greets by name", () => {
    expect(greeting("Ada")).toBe("Hello, Ada!");
  });

  it("falls back to a plain greeting for a blank name", () => {
    expect(greeting("   ")).toBe("Hello!");
  });
});

describe("App", () => {
  it("renders the greeting on screen", async () => {
    await render(<App name="Ada" />);
    expect(screen.getByText("Hello, Ada!")).toBeOnTheScreen();
  });

  it("renders the plain greeting when no name is given", async () => {
    await render(<App />);
    expect(screen.getByText("Hello!")).toBeOnTheScreen();
  });
});
