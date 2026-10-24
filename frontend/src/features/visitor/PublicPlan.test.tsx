import type React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { buildVisitorModel } from './model';
import { PublicPlan } from './PublicPlan';
import { snapshot } from './visitorTestData';

vi.mock('../../shared/Icon', () => ({ Icon: ({ name }: { name: string }) => <span data-icon={name} /> }));

const model = buildVisitorModel(snapshot);

function setup(overrides: Partial<React.ComponentProps<typeof PublicPlan>> = {}) {
  const props = {
    model,
    selectedPoiId: null,
    routePolyline: null,
    onSelectPoi: vi.fn(),
    onOpenPanorama: vi.fn(),
    ...overrides,
  };
  render(<PublicPlan {...props} />);
  return props;
}

describe('PublicPlan', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the uploaded plan image as the background', () => {
    setup();
    const background = screen.getByTestId('plan-background');
    expect(background.getAttribute('href')).toBe('/media/plan/mobile');
    expect(background.getAttribute('width')).toBe('700');
    expect(background.getAttribute('height')).toBe('500');
  });

  it('renders shapes when no plan image was uploaded', () => {
    render(
      <PublicPlan
        model={buildVisitorModel({ ...snapshot, document: { ...snapshot.document, background_asset_id: null } })}
        selectedPoiId={null}
        onSelectPoi={vi.fn()}
        onOpenPanorama={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('plan-background')).toBeNull();
    expect(document.querySelector('polygon')).not.toBeNull();
  });

  it('shows a pin for every POI and reports selection', () => {
    const props = setup();
    expect(screen.getByLabelText('Точка: Стенд ТТК')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Точка: Wi-Fi зона'));
    expect(props.onSelectPoi).toHaveBeenCalledWith(expect.objectContaining({ id: 'poi-2' }));
  });

  it('opens a panorama from its plan marker', () => {
    const props = setup();
    fireEvent.click(screen.getByLabelText('Панорама: Панорама входа'));
    expect(props.onOpenPanorama).toHaveBeenCalledWith(expect.objectContaining({ id: 'pano-1' }));
  });

  it('draws the calculated route polyline with start and finish', () => {
    setup({
      routePolyline: [
        { x: 100, y: 100 },
        { x: 300, y: 100 },
      ],
    });
    const polyline = screen.getByTestId('route-polyline');
    expect(polyline.getAttribute('points')).toBe('100,100 300,100');
    expect(document.querySelectorAll('circle')).toHaveLength(2);
  });

  it('does not draw a route with a single point', () => {
    setup({ routePolyline: [{ x: 100, y: 100 }] });
    expect(screen.queryByTestId('route-polyline')).toBeNull();
  });

  it('hides zoom controls in compact embed mode', () => {
    setup({ compact: true });
    expect(screen.queryByLabelText('Приблизить план')).toBeNull();
    expect(screen.getByText(/3 объектов/)).toBeInTheDocument();
  });
});
