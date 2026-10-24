import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LoginPage } from "./LoginPage";
import { iframeCode } from "./share";
import { apiClient } from "../../shared/api";
vi.mock("../../shared/api");
vi.mock("../../shared/router", () => ({ navigate: vi.fn() }));
import { navigate } from "../../shared/router";
beforeEach(() => vi.clearAllMocks());
describe("organizer login and sharing", () => {
  it("has empty credentials and never logs in on a network failure", async () => {
    vi.mocked(apiClient.login).mockRejectedValue(new Error("offline"));
    render(<LoginPage />);
    expect(screen.getByLabelText("Email")).toHaveValue("");
    expect(screen.getByLabelText("Пароль")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "org@example.test" },
    });
    fireEvent.change(screen.getByLabelText("Пароль"), {
      target: { value: "long-password-123" },
    });
    fireEvent.submit(
      screen.getByRole("button", { name: "Войти" }).closest("form")!,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
    expect(navigate).not.toHaveBeenCalled();
  });
  it("navigates only after server authentication", async () => {
    vi.mocked(apiClient.login).mockResolvedValue({} as never);
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "org@example.test" },
    });
    fireEvent.change(screen.getByLabelText("Пароль"), {
      target: { value: "long-password-123" },
    });
    fireEvent.submit(
      screen.getByRole("button", { name: "Войти" }).closest("form")!,
    );
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/organize"));
  });
  it("escapes an iframe title without injecting additional attributes", () => {
    const container = document.createElement("div");
    container.innerHTML = iframeCode(
      "https://map.test",
      "valid",
      '" onload="alert(1) <img>',
    );
    expect(container.children).toHaveLength(1);
    expect(container.firstElementChild?.hasAttribute("onload")).toBe(false);
    expect(container.firstElementChild?.getAttribute("title")).toBe(
      '" onload="alert(1) <img>',
    );
  });
});
