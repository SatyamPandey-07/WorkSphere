/** @jest-environment jsdom */

import { act, render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider, useTheme } from "@/components/ThemeProvider";

function Switcher() {
    const { setTheme } = useTheme();
    return <button onClick={() => setTheme("cyberpunk")}>switch</button>;
}

beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.className = "";
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("style");
});

describe("theme switch transitions", () => {
    it("animates user-triggered theme changes and removes the transition class", async () => {
        render(
            <ThemeProvider>
                <Switcher />
            </ThemeProvider>,
        );

        act(() => {
            screen.getByText("switch").click();
        });

        const root = document.documentElement;
        expect(root.classList.contains("cyberpunk")).toBe(true);
        expect(root.getAttribute("data-theme")).toBe("cyberpunk");
        expect(root.classList.contains("theme-transitioning")).toBe(true);
        await waitFor(() =>
            expect(root.classList.contains("theme-transitioning")).toBe(false),
        );
    });
});
