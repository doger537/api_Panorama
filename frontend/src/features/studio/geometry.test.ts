import { describe, expect, it } from 'vitest';
import { floorPoint, naturalFrames } from './geometry';
const panorama = { id:'p',asset_id:'a',title:'',x:500,y:500,nav_node_id:null,heading_offset_deg:0 };
describe('floor projection', () => {
  it('projects at known height and bearing in plan units', () => {
    expect(floorPoint(0,-45,1.6,panorama,0.1).y).toBeCloseTo(484);
    expect(floorPoint(90,-45,1.6,panorama,0.1).x).toBeCloseTo(516);
    expect(floorPoint(0,-45,1.6,{...panorama,heading_offset_deg:90},0.1).x).toBeCloseTo(516);
  });
  it('rejects horizon, invalid height and nonfinite inputs', () => {
    for (const pitch of [0,10,-1,NaN,-90]) expect(() => floorPoint(0,pitch,1.6,panorama,.1)).toThrow();
    expect(() => floorPoint(0,-45,0,panorama,.1)).toThrow();
  });
  it('keeps photos 2 and 10 in numeric order', () => {
    const files=['photo_10.jpg','photo_2.jpg','photo_1.jpg'].map(n=>new File([],n));
    expect(naturalFrames(files).map(f=>f.name)).toEqual(['photo_1.jpg','photo_2.jpg','photo_10.jpg']);
  });
});
