import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { PublicMap, RouteResponse } from '../../../../CONTRACTS/types';
import { snapshot } from './visitorTestData';

vi.mock('../../shared/Icon', () => ({ Icon: ({ name }: { name: string }) => <span data-icon={name} /> }));

const apiState: {
  snapshot: PublicMap;
  notFound: boolean;
  failMessage: string | null;
} = { snapshot, notFound: false, failMessage: null };

vi.mock('../../shared/api', () => {
  class ApiClientError extends Error {
    readonly status: number;
    constructor(status: number, message = 'error') {
      super(message);
      this.status = status;
      this.name = 'ApiClientError';
    }
  }
  return {
    ApiClientError,
    apiClient: {
      getPublicMap: vi.fn(async (slug: string, ifNoneMatch?: string) => {
        if (apiState.notFound) throw new ApiClientError(404, 'Published map not found');
        if (apiState.failMessage) throw new ApiClientError(500, apiState.failMessage);
        if (ifNoneMatch && ifNoneMatch === `"map-${apiState.snapshot.id}-v${apiState.snapshot.revision}"`) {
          return { status: 304 as const, etag: ifNoneMatch };
        }
        return {
          status: 200 as const,
          map: { ...apiState.snapshot, slug },
          etag: `"map-${apiState.snapshot.id}-v${apiState.snapshot.revision}"`,
        };
      }),
      buildRoute: vi.fn(
        async (): Promise<RouteResponse> => ({
          revision: apiState.snapshot.revision,
          node_ids: ['node-1', 'node-2', 'node-3'],
          polyline: [
            { x: 100, y: 100 },
            { x: 300, y: 100 },
            { x: 600, y: 400 },
          ],
          distance_units: 400,
          distance_m: 20,
          walk: {
            available: true,
            steps: [
              { node_id: 'node-1', panorama_id: 'pano-1', yaw_deg: 90, next_hotspot_id: 'hs-1' },
              { node_id: 'node-2', panorama_id: 'pano-1', yaw_deg: 0, next_hotspot_id: null },
            ],
            gaps: [],
          },
        }),
      ),
    },
  };
});

const { PublicSpacePage } = await import('./PublicSpacePage');
const { apiClient } = await import('../../shared/api');

describe('PublicSpacePage', () => {
  beforeEach(() => {
    apiState.snapshot = snapshot;
    apiState.notFound = false;
    apiState.failMessage = null;
    vi.clearAllMocks();
  });

  it('loads any published slug from the API instead of the demo catalogue', async () => {
    render(<PublicSpacePage slug="ttk-any-published-slug" pollMs={600000} />);

    expect(await screen.findByText('ТТК Экспо')).toBeInTheDocument();
    expect(apiClient.getPublicMap).toHaveBeenCalledWith('ttk-any-published-slug', undefined);
    expect(screen.getByText('Live · v7')).toBeInTheDocument();
    expect(screen.getByLabelText('Точка: Стенд ТТК')).toBeInTheDocument();
  });

  it('shows the new revision when a different published slug is loaded', async () => {
    render(<PublicSpacePage slug="another-map-slug" pollMs={600000} />);
    await screen.findByText('ТТК Экспо');
    expect(apiClient.getPublicMap).toHaveBeenCalledWith('another-map-slug', undefined);
  });

  it('shows a friendly not-found screen for an unpublished map', async () => {
    apiState.notFound = true;
    render(<PublicSpacePage slug="gone" pollMs={600000} />);

    expect(await screen.findByTestId('public-not-found')).toBeInTheDocument();
    expect(screen.getByText(/снята с публикации/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Попробовать снова/i }));
    await waitFor(() => expect(apiClient.getPublicMap).toHaveBeenCalledTimes(2));
  });

  it('filters the POI list by search query', async () => {
    render(<PublicSpacePage slug="ttk-any-published-slug" pollMs={600000} />);
    await screen.findByText('ТТК Экспо');

    // The plan keeps every pin; the sidebar list is what gets filtered.
    expect(screen.getByText('Главный стенд', { exact: false })).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Найти стенд, зал, Wi-Fi…'), { target: { value: 'лаунж' } });
    await waitFor(() => expect(screen.queryByText(/Главный стенд/)).toBeNull());
    expect(screen.getByText('Зона отдыха')).toBeInTheDocument();
  });

  it('opens the POI card and prefills the route destination', async () => {
    render(<PublicSpacePage slug="ttk-any-published-slug" pollMs={600000} />);
    await screen.findByText('ТТК Экспо');

    fireEvent.click(screen.getByLabelText('Точка: Wi-Fi зона'));
    expect(await screen.findByTestId('poi-card')).toBeInTheDocument();
    expect(screen.getByText('TTK_Guest')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Маршрут сюда/i }));
    expect((screen.getByLabelText('Куда') as HTMLSelectElement).value).toBe('poi-2');
    expect((screen.getByLabelText('Откуда') as HTMLSelectElement).value).not.toBe('');
  });

  it('builds a route through the public API and renders the walkthrough steps', async () => {
    render(<PublicSpacePage slug="ttk-any-published-slug" pollMs={600000} />);
    await screen.findByText('ТТК Экспо');

    fireEvent.change(screen.getByLabelText('Откуда'), { target: { value: 'poi-1' } });
    fireEvent.change(screen.getByLabelText('Куда'), { target: { value: 'poi-3' } });
    fireEvent.click(screen.getByRole('button', { name: /Построить/i }));

    await waitFor(() => expect(screen.getByTestId('route-polyline')).toBeInTheDocument());
    expect(apiClient.buildRoute).toHaveBeenCalledWith('ttk-any-published-slug', {
      revision: 7,
      from_node_id: 'node-1',
      to_node_id: 'node-3',
    });
    expect(screen.getByText('20.0 м')).toBeInTheDocument();
    expect(screen.getByText(/Виртуальный проход: 2 шагов/)).toBeInTheDocument();
  });

  it('hides the sidebar in embed mode but keeps the plan interactive', async () => {
    render(<PublicSpacePage slug="ttk-any-published-slug" mode="embed" pollMs={600000} />);
    await screen.findByText('ТТК Экспо');

    expect(screen.queryByPlaceholderText('Найти стенд, зал, Wi-Fi…')).toBeNull();
    expect(screen.queryByLabelText('Приблизить план')).toBeNull();
    expect(screen.getAllByRole('button', { name: /Стенд ТТК/i }).length).toBeGreaterThan(0);
  });

  it('opens the 360 viewer when a panorama marker is clicked', async () => {
    render(<PublicSpacePage slug="ttk-any-published-slug" pollMs={600000} />);
    await screen.findByText('ТТК Экспо');

    fireEvent.click(screen.getByLabelText('Панорама: Панорама входа'));
    expect(await screen.findByRole('button', { name: 'Закрыть панораму' })).toBeInTheDocument();
  });

  it('keeps the last revision on screen when the network fails', async () => {
    const { unmount } = render(<PublicSpacePage slug="ttk-any-published-slug" pollMs={600000} />);
    await screen.findByText('ТТК Экспо');
    unmount();

    apiState.failMessage = 'boom';
    render(<PublicSpacePage slug="ttk-any-published-slug" pollMs={600000} />);
    expect(await screen.findByText(/Карта недоступна/i)).toBeInTheDocument();
  });
});
