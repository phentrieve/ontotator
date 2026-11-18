import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeSetting } from "../src/me/ThemeSetting";
import { applyTheme, chooseTheme, readTheme, THEME_CHOICES, THEME_STORAGE_KEY } from "../src/ui/theme";

const frontend = resolve(__dirname, "..");
const earlyScript = readFileSync(resolve(frontend, "public/theme.js"), "utf8");
/** Runs public/theme.js as the browser does before the app starts. */
const runEarlyScript = () => new Function(earlyScript)();
const rootTheme = () => document.documentElement.getAttribute("data-theme");

beforeEach(() => { window.localStorage.clear(); document.documentElement.removeAttribute("data-theme"); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("theme", () => {
  it("is System until a choice is stored, and ignores a stored value it does not know", () => {
    expect(readTheme()).toBe("system");
    window.localStorage.setItem(THEME_STORAGE_KEY, "sepia");
    expect(readTheme()).toBe("system");
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    expect(readTheme()).toBe("dark");
  });

  it("Light and Dark set data-theme and are stored; System removes both", () => {
    chooseTheme("dark");
    expect(rootTheme()).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    chooseTheme("light");
    expect(rootTheme()).toBe("light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    chooseTheme("system");
    expect(rootTheme()).toBeNull();
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it("works without storage: the choice shows, nothing throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(readTheme()).toBe("system");
    expect(() => chooseTheme("dark")).not.toThrow();
    expect(rootTheme()).toBe("dark");
    expect(() => chooseTheme("system")).not.toThrow();
    expect(rootTheme()).toBeNull();
    expect(() => runEarlyScript()).not.toThrow();
    expect(rootTheme()).toBeNull();
  });

  it("the early script applies what the setting stored, with the same key and values", () => {
    expect(earlyScript).toContain(`"${THEME_STORAGE_KEY}"`);
    for (const { value } of THEME_CHOICES) {
      chooseTheme(value);
      document.documentElement.removeAttribute("data-theme");
      runEarlyScript();
      expect(rootTheme()).toBe(value === "system" ? null : value);
      const afterScript = rootTheme();
      applyTheme(readTheme());
      expect(rootTheme()).toBe(afterScript);
    }
    window.localStorage.setItem(THEME_STORAGE_KEY, "sepia");
    document.documentElement.removeAttribute("data-theme");
    runEarlyScript();
    expect(rootTheme()).toBeNull();
  });

  it("index.html loads the early script as a file, before the application, and has no inline script", () => {
    const html = readFileSync(resolve(frontend, "index.html"), "utf8");
    const early = html.indexOf('<script src="/theme.js"></script>');
    expect(early).toBeGreaterThan(-1);
    expect(early).toBeLessThan(html.indexOf('<script type="module"'));
    // The Content-Security-Policy (script-src 'self') refuses inline scripts.
    expect(html.match(/<script(?![^>]*\bsrc=)[^>]*>/g)).toBeNull();
  });
});

describe("ThemeSetting", () => {
  it("offers System, Light and Dark, shows the stored choice and applies a new one at once", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    render(<ThemeSetting />);
    const select = screen.getByRole("combobox", { name: "Theme" }) as HTMLSelectElement;
    expect([...select.options].map((option) => option.textContent)).toEqual(["System", "Light", "Dark"]);
    expect(select.value).toBe("light");
    fireEvent.change(select, { target: { value: "dark" } });
    expect(select.value).toBe("dark");
    expect(rootTheme()).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    fireEvent.change(select, { target: { value: "system" } });
    expect(rootTheme()).toBeNull();
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(screen.getByText("System follows the light or dark setting of your device. The choice is kept in this browser.")).toBeDefined();
  });

  it("follows a change made in another tab", () => {
    render(<ThemeSetting />);
    const select = screen.getByRole("combobox", { name: "Theme" }) as HTMLSelectElement;
    expect(select.value).toBe("system");
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    fireEvent(window, new StorageEvent("storage", { key: THEME_STORAGE_KEY, newValue: "dark" }));
    expect(select.value).toBe("dark");
    expect(rootTheme()).toBe("dark");
    // Another key changes nothing.
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    fireEvent(window, new StorageEvent("storage", { key: "something.else", newValue: "x" }));
    expect(select.value).toBe("dark");
  });
});
