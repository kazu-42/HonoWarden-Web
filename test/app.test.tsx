import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { App } from "../src/App";

describe("App", () => {
  it("renders a locked boundary without inventing an incomplete login flow", () => {
    render(<App session={{ status: "locked" }} onLock={vi.fn()} />);

    expect(
      screen.getByRole("heading", { name: "HonoWarden Web Vault" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Locked")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("renders the authenticated application shell without secret material", async () => {
    const onLock = vi.fn();
    const user = userEvent.setup();

    const { container } = render(
      <App
        session={{
          status: "authenticated",
          accountLabel: "synthetic@example.test",
          expiresAt: Date.parse("2026-07-17T13:00:00.000Z"),
        }}
        onLock={onLock}
      />,
    );

    expect(
      screen.getByRole("navigation", { name: "Vault" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Vault" })).toBeInTheDocument();
    expect(screen.getByText("synthetic@example.test")).toBeInTheDocument();
    expect(container.textContent).not.toContain("access-token");
    expect(container.textContent).not.toContain("refresh-token");

    await user.click(screen.getByRole("button", { name: "Lock vault" }));
    expect(onLock).toHaveBeenCalledTimes(1);
  });
});
