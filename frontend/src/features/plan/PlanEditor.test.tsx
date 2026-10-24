import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useState } from "react";
import { PlanEditor } from "./PlanEditor";
import { emptyMapDocument } from "../../shared/document";
import { apiClient } from "../../shared/api";
import { connectNodes, removeSelection } from "./model";
vi.mock("../../shared/api");
const notify = vi.fn();
function Editor() {
  const [doc, change] = useState(emptyMapDocument());
  return (
    <>
      <PlanEditor
        mapId="map"
        widthUnits={700}
        heightUnits={500}
        document={doc}
        isAuthenticated
        onChangeDocument={change}
        onNotify={notify}
        onSaveDocument={vi.fn()}
      />
      <output data-testid="document">{JSON.stringify(doc)}</output>
    </>
  );
}
function canvas() {
  const element = screen.getByTestId("plan-canvas");
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: 700,
    height: 500,
  } as DOMRect);
  return element;
}
describe("plan editor", () => {
  it("creates POIs without inventing edges and edits their attributes", () => {
    render(<Editor />);
    const svg = canvas();
    fireEvent.click(svg, { clientX: 100, clientY: 150 });
    fireEvent.change(screen.getByLabelText("Название объекта"), {
      target: { value: "Вход" },
    });
    fireEvent.change(screen.getByLabelText("Категория"), {
      target: { value: "entrance" },
    });
    fireEvent.click(svg, { clientX: 500, clientY: 300 });
    const doc = JSON.parse(screen.getByTestId("document").textContent!);
    expect(doc.pois[0]).toMatchObject({
      title: "Вход",
      category: "entrance",
      x: 100,
      y: 150,
    });
    expect(doc.nodes).toHaveLength(2);
    expect(doc.edges).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("От узла"), {
      target: { value: doc.nodes[0].id },
    });
    fireEvent.change(screen.getByLabelText("К узлу"), {
      target: { value: doc.nodes[1].id },
    });
    fireEvent.click(screen.getByRole("button", { name: "Добавить проход" }));
    expect(
      JSON.parse(screen.getByTestId("document").textContent!).edges,
    ).toHaveLength(1);
  });
  it("draws an arbitrary corridor and supports undo and redo", () => {
    render(<Editor />);
    const svg = canvas();
    fireEvent.click(screen.getByRole("button", { name: "Коридор" }));
    for (const [clientX, clientY] of [
      [20, 20],
      [200, 20],
      [150, 80],
      [20, 80],
    ])
      fireEvent.click(svg, { clientX, clientY });
    fireEvent.click(screen.getByRole("button", { name: "Завершить фигуру" }));
    expect(
      JSON.parse(screen.getByTestId("document").textContent!).shapes[0].points,
    ).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "Отменить правку" }));
    expect(
      JSON.parse(screen.getByTestId("document").textContent!).shapes,
    ).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Повторить правку" }));
    expect(
      JSON.parse(screen.getByTestId("document").textContent!).shapes,
    ).toHaveLength(1);
  });
  it("uses the saved asset URL for the imported background", async () => {
    vi.mocked(apiClient.uploadAsset).mockResolvedValue({
      id: "asset",
      kind: "plan",
    } as never);
    render(<Editor />);
    fireEvent.change(screen.getByLabelText(/Импорт плана/), {
      target: {
        files: [new File(["image"], "plan.png", { type: "image/png" })],
      },
    });
    await waitFor(() =>
      expect(document.querySelector("image")).toHaveAttribute(
        "href",
        "/api/v1/media/asset/full",
      ),
    );
  });
  it("places a POI inside an existing room while the POI tool is active", () => {
    render(<Editor />);
    const svg = canvas();
    fireEvent.click(screen.getByRole("button", { name: "Комната", exact: true }));
    for (const [clientX, clientY] of [[20, 20], [200, 20], [200, 200], [20, 200]])
      fireEvent.click(svg, { clientX, clientY });
    fireEvent.click(screen.getByRole("button", { name: "Завершить фигуру" }));
    fireEvent.click(screen.getByRole("button", { name: "Точка POI" }));
    fireEvent.click(svg.querySelector('polygon')!, { clientX: 100, clientY: 100 });
    expect(JSON.parse(screen.getByTestId("document").textContent!).pois[0]).toMatchObject({ x: 100, y: 100 });
  });
  it("cleans references when removing a graph node and rejects duplicate edges", () => {
    let doc = emptyMapDocument();
    doc.nodes = [
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 10, y: 10 },
    ];
    doc = connectNodes(doc, "b", "a");
    expect(() => connectNodes(doc, "a", "b")).toThrow("уже соединены");
    const next = removeSelection(doc, { kind: "nodes", id: "a" });
    expect(next.edges).toHaveLength(0);
    expect(next.nodes).toHaveLength(1);
  });
});
