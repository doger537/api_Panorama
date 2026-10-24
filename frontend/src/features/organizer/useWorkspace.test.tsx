import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useWorkspace } from "./useWorkspace";
import { apiClient, ApiClientError } from "../../shared/api";
import { emptyMapDocument } from "../../shared/document";
import type { OrganizerMap } from "../../../../CONTRACTS/types";
import { navigate } from "../../shared/router";
vi.mock("../../shared/api", async (original) => ({
  ...(await original<typeof import("../../shared/api")>()),
  apiClient: { getMap: vi.fn(), replaceMapDocument: vi.fn() },
}));
const original: OrganizerMap = {
  owner_id: "owner",
  created_at: "now",
  snapshot: {
    id: "map",
    slug: "slug",
    revision: 1,
    width_units: 700,
    height_units: 500,
    updated_at: "now",
    document: emptyMapDocument(),
    assets: [],
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(apiClient.getMap).mockResolvedValue({ map: original, etag: "v1" });
});
describe("workspace persistence", () => {
  it("protects dirty work during application navigation and releases the guard on unmount", async () => {
    window.history.replaceState(null, '', '/organize/map');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { result, unmount } = renderHook(() => useWorkspace('map'));
    await waitFor(() => expect(result.current.draft).not.toBeNull());
    act(() => result.current.change({ ...result.current.draft!, title: 'Unsaved' }));
    act(() => navigate('/organize/other'));
    expect(window.location.pathname).toBe('/organize/map');
    expect(confirm).toHaveBeenCalledOnce();
    unmount();
    navigate('/organize');
    expect(window.location.pathname).toBe('/organize');
    confirm.mockRestore();
  });
  it("keeps late local edits after the in-flight save finishes", async () => {
    let finish!: (value: { map: OrganizerMap; etag: string }) => void;
    vi.mocked(apiClient.replaceMapDocument).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { result } = renderHook(() => useWorkspace("map"));
    await waitFor(() => expect(result.current.draft).not.toBeNull());
    act(() =>
      result.current.change({ ...result.current.draft!, title: "First" }),
    );
    let saving!: Promise<boolean>;
    act(() => {
      saving = result.current.save();
    });
    act(() =>
      result.current.change({ ...result.current.draft!, title: "Newer" }),
    );
    await act(async () => {
      finish({
        map: {
          ...original,
          snapshot: {
            ...original.snapshot,
            revision: 2,
            document: { ...original.snapshot.document, title: "First" },
          },
        },
        etag: "v2",
      });
      await saving;
    });
    expect(result.current.draft?.title).toBe("Newer");
    expect(result.current.dirty).toBe(true);
  });
  it("retains the draft on 412 and never confirms rejected publication", async () => {
    vi.mocked(apiClient.replaceMapDocument).mockRejectedValue(
      new ApiClientError(412, {
        error: {
          code: "VERSION_CONFLICT",
          message: "Changed",
          issues: [],
          current_revision: 2,
        },
      }),
    );
    const { result } = renderHook(() => useWorkspace("map"));
    await waitFor(() => expect(result.current.draft).not.toBeNull());
    act(() =>
      result.current.change({ ...result.current.draft!, title: "Local" }),
    );
    await act(async () => {
      await result.current.save(true);
    });
    expect(result.current.conflict).toBe(true);
    expect(result.current.draft?.title).toBe("Local");
    expect(result.current.map?.snapshot.document.is_published).toBe(false);
  });
});
