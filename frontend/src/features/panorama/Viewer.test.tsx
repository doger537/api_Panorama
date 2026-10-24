import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { AssetRef, Hotspot, Panorama, Poi } from '../../../../CONTRACTS/types';

vi.mock('../../shared/Icon', () => ({ Icon: ({ name }: { name: string }) => <span data-icon={name} /> }));

const viewerState: {
  configs: Record<string, unknown>[];
  viewer: FakeViewer | null;
  fail: boolean;
} = { configs: [], viewer: null, fail: false };

interface FakeViewer {
  container: HTMLElement;
  hotspots: unknown[];
  yaw: number;
  pitch: number;
  hfov: number;
  destroyed: boolean;
  addHotSpot: (hotspot: unknown) => void;
  removeHotSpot: (id: string) => boolean;
  getContainer: () => HTMLElement;
  mouseEventToCoords: () => [number, number];
}

function createFakeViewer(container: HTMLElement, config: Record<string, unknown>): FakeViewer {
  const viewer: FakeViewer = {
    container,
    hotspots: [...((config.hotSpots as unknown[]) ?? [])],
    yaw: Number(config.yaw ?? 0),
    pitch: Number(config.pitch ?? 0),
    hfov: Number(config.hfov ?? 100),
    destroyed: false,
    addHotSpot: vi.fn((hotspot: unknown) => {
      viewer.hotspots.push(hotspot);
    }),
    removeHotSpot: vi.fn((id: string) => {
      viewer.hotspots = viewer.hotspots.filter((item) => (item as { id?: string }).id !== id);
      return true;
    }),
    getContainer: () => container,
    mouseEventToCoords: () => [12.5, 40],
  };
  return viewer;
}

vi.mock('./pannellumLoader', async () => {
  class PannellumUnavailableError extends Error {}
  return {
    PannellumUnavailableError,
    resetPannellumLoaderForTests: vi.fn(),
    loadPannellum: vi.fn(async () => {
      if (viewerState.fail) throw new PannellumUnavailableError('WebGL недоступен');
      return {
        viewer: (container: HTMLElement, config: Record<string, unknown>) => {
          viewerState.configs.push(config);
          const viewer = createFakeViewer(container, config);
          viewerState.viewer = viewer;
          return {
            ...viewer,
            destroy: () => {
              viewer.destroyed = true;
            },
            on: vi.fn(),
            off: vi.fn(),
            isLoaded: () => true,
            getYaw: () => viewer.yaw,
            getPitch: () => viewer.pitch,
            getHfov: () => viewer.hfov,
            setYaw: (value: number) => {
              viewer.yaw = value;
            },
            setPitch: (value: number) => {
              viewer.pitch = value;
            },
            setHfov: (value: number) => {
              viewer.hfov = value;
            },
            setYawBounds: vi.fn(),
            setPitchBounds: vi.fn(),
            setHfovBounds: vi.fn(),
            lookAt: vi.fn(),
            toggleFullscreen: vi.fn(),
            resize: vi.fn(),
          };
        },
      };
    }),
  };
});

// Import after the mock is registered.
const { PanoramaViewer } = await import('./Viewer');

const panorama: Panorama = {
  id: 'pano-1',
  asset_id: 'asset-1',
  title: 'Test Panorama',
  x: 100,
  y: 100,
  nav_node_id: 'node-1',
  heading_offset_deg: 45,
};

const secondPanorama: Panorama = {
  id: 'pano-2',
  asset_id: 'asset-2',
  title: 'Коридор',
  x: 140,
  y: 100,
  nav_node_id: 'node-2',
  heading_offset_deg: 0,
};

const asset: AssetRef = {
  id: 'asset-1',
  kind: 'panorama',
  source: 'upload',
  width_px: 4096,
  height_px: 2048,
  projection: 'equirectangular',
  haov_deg: 360,
  vaov_deg: 170,
  v_offset_deg: 0,
  preview_url: '/media/asset-1/preview',
  mobile_url: '/media/asset-1/mobile',
  full_url: '/media/asset-1/full',
  created_at: '2026-01-01T00:00:00Z',
};

const secondAsset: AssetRef = {
  ...asset,
  id: 'asset-2',
  preview_url: '/media/asset-2/preview',
  mobile_url: '/media/asset-2/mobile',
  full_url: '/media/asset-2/full',
};

const poi: Poi = {
  id: 'poi-1',
  title: 'Test POI',
  category: 'booth',
  category_label: 'Стенд',
  description: 'Test description',
  x: 100,
  y: 100,
  nav_node_id: null,
};

const poiHotspot: Hotspot = {
  id: 'hotspot-1',
  panorama_id: 'pano-1',
  kind: 'poi',
  yaw_deg: 20,
  pitch_deg: 0,
  poi_id: 'poi-1',
  target_panorama_id: null,
};

const transitionHotspot: Hotspot = {
  id: 'hotspot-2',
  panorama_id: 'pano-1',
  kind: 'transition',
  yaw_deg: 120,
  pitch_deg: 0,
  poi_id: null,
  target_panorama_id: 'pano-2',
};

function baseProps() {
  return {
    isOpen: true,
    onClose: vi.fn(),
    title: 'Test Panorama View',
    imageUrl: '/media/asset-1/full',
    panorama,
    panoramas: [panorama, secondPanorama],
    hotspots: [poiHotspot, transitionHotspot],
    pois: [poi],
    richPois: [],
    assets: [asset, secondAsset],
    onSelectPanorama: vi.fn(),
    onSelectPoi: vi.fn(),
    onAddHotspot: vi.fn(),
    onDeleteHotspot: vi.fn(),
  };
}

describe('PanoramaViewer (Pannellum)', () => {
  beforeEach(() => {
    viewerState.configs = [];
    viewerState.viewer = null;
    viewerState.fail = false;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('boots a real equirectangular Pannellum scene instead of a stretched background image', async () => {
    render(<PanoramaViewer {...baseProps()} />);
    await waitFor(() => expect(viewerState.configs).toHaveLength(1));

    const config = viewerState.configs[0];
    expect(config.type).toBe('equirectangular');
    expect(config.panorama).toBe('/media/asset-1/mobile');
    expect(config.haov).toBe(360);
    expect(config.vaov).toBe(170);
    expect(config.vOffset).toBe(0);
    expect(config.hfov).toBe(100);
    expect(config.minPitch).toBeLessThan(0);
    expect(config.maxPitch).toBeGreaterThan(0);
  });

  it('passes contract hotspots to the viewer with labels and transitions', async () => {
    render(<PanoramaViewer {...baseProps()} />);
    await waitFor(() => expect(viewerState.configs).toHaveLength(1));

    const hotSpots = viewerState.configs[0].hotSpots as { id: string; yaw: number; cssClass: string }[];
    expect(hotSpots.map((hotspot) => hotspot.id)).toEqual(['hotspot-1', 'hotspot-2']);
    expect(hotSpots[1].cssClass).toContain('ttk-pano-hotspot--transition');
  });

  it('opens a POI card when a POI hotspot is clicked inside the sphere', async () => {
    const props = baseProps();
    render(<PanoramaViewer {...props} />);
    await waitFor(() => expect(viewerState.configs).toHaveLength(1));

    const hotSpots = viewerState.configs[0].hotSpots as {
      clickHandlerFunc: (event: unknown, args: unknown) => void;
      clickHandlerArgs: unknown;
    }[];
    hotSpots[0].clickHandlerFunc({}, hotSpots[0].clickHandlerArgs);

    expect(props.onSelectPoi).toHaveBeenCalledWith('poi-1');
    expect(await screen.findByText('Test description')).toBeInTheDocument();
    expect(screen.getByText('Стенд')).toBeInTheDocument();
  });

  it('navigates to the neighbouring panorama through a transition hotspot', async () => {
    const props = baseProps();
    render(<PanoramaViewer {...props} />);
    await waitFor(() => expect(viewerState.configs).toHaveLength(1));

    const hotSpots = viewerState.configs[0].hotSpots as {
      clickHandlerFunc: (event: unknown, args: unknown) => void;
      clickHandlerArgs: unknown;
    }[];
    hotSpots[1].clickHandlerFunc({}, hotSpots[1].clickHandlerArgs);

    expect(props.onSelectPanorama).toHaveBeenCalledWith('pano-2');
  });

  it('adds a hotspot at the clicked sphere coordinates in edit mode', async () => {
    const props = { ...baseProps(), editable: true };
    render(<PanoramaViewer {...props} />);
    await waitFor(() => expect(viewerState.viewer).not.toBeNull());

    fireEvent.doubleClick(viewerState.viewer!.container);

    expect(props.onAddHotspot).toHaveBeenCalledWith(
      expect.objectContaining({ panorama_id: 'pano-1', kind: 'poi', yaw_deg: 40, pitch_deg: 12.5, poi_id: 'poi-1' }),
    );
  });

  it('adds a transition hotspot when the transition tool is selected', async () => {
    const props = { ...baseProps(), editable: true };
    render(<PanoramaViewer {...props} />);
    await waitFor(() => expect(viewerState.viewer).not.toBeNull());

    fireEvent.change(screen.getByLabelText('Тип хотспота'), { target: { value: 'transition' } });
    fireEvent.doubleClick(viewerState.viewer!.container);

    expect(props.onAddHotspot).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'transition', target_panorama_id: 'pano-2', poi_id: null }),
    );
  });

  it('lists existing hotspots in edit mode and deletes one', async () => {
    const props = { ...baseProps(), editable: true };
    render(<PanoramaViewer {...props} />);
    await waitFor(() => expect(viewerState.viewer).not.toBeNull());

    fireEvent.click(screen.getByLabelText('Удалить хотспот Test POI'));
    expect(props.onDeleteHotspot).toHaveBeenCalledWith('hotspot-1');
  });

  it('removes a hotspot from the live viewer when the document drops it', async () => {
    const props = baseProps();
    const { rerender } = render(<PanoramaViewer {...props} editable />);
    await waitFor(() => expect(viewerState.viewer).not.toBeNull());

    rerender(<PanoramaViewer {...props} editable hotspots={[transitionHotspot]} />);
    await waitFor(() => expect(viewerState.viewer!.removeHotSpot).toHaveBeenCalledWith('hotspot-1'));
  });

  it('offers an HD switch and reloads the full-size sphere on demand', async () => {
    render(<PanoramaViewer {...baseProps()} />);
    await waitFor(() => expect(viewerState.configs).toHaveLength(1));

    fireEvent.click(screen.getByRole('button', { name: 'HD' }));
    await waitFor(() => expect(viewerState.configs).toHaveLength(2));
    expect(viewerState.configs[1].panorama).toBe('/media/asset-1/full');
  });

  it('falls back to a static sphere when Pannellum cannot start', async () => {
    viewerState.fail = true;
    render(<PanoramaViewer {...baseProps()} />);

    expect(await screen.findByTestId('pannellum-fallback')).toBeInTheDocument();
    expect(screen.getByText(/Интерактивный 3D-просмотр недоступен/)).toBeInTheDocument();
  });

  it('closes the modal and destroys the viewer', async () => {
    const props = baseProps();
    const { unmount } = render(<PanoramaViewer {...props} />);
    await waitFor(() => expect(viewerState.viewer).not.toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть панораму' }));
    expect(props.onClose).toHaveBeenCalled();

    unmount();
    expect(viewerState.viewer!.destroyed).toBe(true);
  });

  it('renders nothing when closed', () => {
    render(<PanoramaViewer {...baseProps()} isOpen={false} />);
    expect(screen.queryByText('Test Panorama View')).toBeNull();
  });
});
