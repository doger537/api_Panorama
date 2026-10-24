import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { snapshot } from '../src/features/visitor/visitorTestData';

vi.mock('../src/shared/Icon', () => ({ Icon: ({ name }: { name: string }) => <span data-icon={name} /> }));

vi.mock('../src/shared/api', () => {
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
      getPublicMap: vi.fn(async (slug: string) => ({
        status: 200 as const,
        map: { ...snapshot, slug },
        etag: `"map-${snapshot.id}-v${snapshot.revision}"`,
      })),
      buildRoute: vi.fn(),
      session: vi.fn(async () => Promise.reject(new ApiClientError(401))),
      listMaps: vi.fn(async () => []),
      getCsrfToken: vi.fn(() => null),
      setCsrfToken: vi.fn(),
      getMapEtag: vi.fn(),
      setMapEtag: vi.fn(),
    },
  };
});

const { App } = await import('../src/App');
const { apiClient } = await import('../src/shared/api');

function goTo(path: string) {
  window.history.replaceState({}, '', path);
}

describe('public link routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    goTo('/');
  });

  it('renders the visitor screen for an arbitrary /m/:slug link', async () => {
    goTo('/m/venue-created-by-organizer');
    render(<App />);

    expect(await screen.findByText('ТТК Экспо')).toBeInTheDocument();
    expect(apiClient.getPublicMap).toHaveBeenCalledWith('venue-created-by-organizer', undefined);
    expect(screen.getByTestId('public-space-page')).toBeInTheDocument();
  });

  it('renders the compact embed layout for /embed/:slug', async () => {
    goTo('/embed/venue-created-by-organizer');
    render(<App />);

    expect(await screen.findByTestId('public-space-page')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Найти стенд, зал, Wi-Fi…')).toBeNull();
  });

  it('does not poll the demo catalogue while a public link is open', async () => {
    goTo('/m/venue-created-by-organizer');
    render(<App />);
    await screen.findByText('ТТК Экспо');

    const requestedSlugs = (apiClient.getPublicMap as unknown as { mock: { calls: unknown[][] } }).mock.calls.map(
      (call) => call[0],
    );
    expect(requestedSlugs).toEqual(['venue-created-by-organizer']);
  });
});
