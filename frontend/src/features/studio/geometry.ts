import type { AssetRef, Panorama, Point } from '../../../../CONTRACTS/types';

/** Intersect a sight ray with a level floor. Camera height is an explicit estimate. */
export function floorPoint(yaw: number, pitch: number, cameraHeight: number, panorama: Panorama, scale: number): Point {
  if (![yaw, pitch, cameraHeight, scale].every(Number.isFinite) || pitch > -3 || pitch <= -90 || cameraHeight <= 0 || scale <= 0)
    throw new Error('Выберите точку на полу ниже горизонта (не менее 3°).');
  const distance = cameraHeight / Math.tan(-pitch * Math.PI / 180) / scale;
  const bearing = (yaw + panorama.heading_offset_deg) * Math.PI / 180;
  return { x: panorama.x + Math.sin(bearing) * distance, y: panorama.y - Math.cos(bearing) * distance };
}

export function naturalFrames(files: File[]): File[] {
  return [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

/** Resize before upload; the API deliberately caps decoded frame dimensions. */
export async function preparePhoto(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const ratio = Math.min(1, 800 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Не удалось подготовить фотографию.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      value => value ? resolve(value) : reject(new Error('Не удалось сжать фотографию.')), 'image/jpeg', 0.9));
    return new File([blob], file.name, { type: 'image/jpeg' });
  } finally { bitmap.close(); }
}

/** Floor-plane approximation; missing coverage stays transparent. */
export async function projectFloor(asset: AssetRef, panorama: Panorama, width: number, height: number, scale: number, cameraHeight: number): Promise<File> {
  if (!Number.isFinite(cameraHeight) || cameraHeight < .5 || cameraHeight > 3 || scale <= 0) throw new Error('Укажите высоту камеры от 0,5 до 3 м.');
  const response = await fetch(asset.full_url, { credentials: 'same-origin' });
  if (!response.ok) throw new Error('Не удалось загрузить панораму для расчёта плана.');
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const source = document.createElement('canvas'); source.width = bitmap.width; source.height = bitmap.height;
    const context = source.getContext('2d'); if (!context) throw new Error('Canvas недоступен');
    context.drawImage(bitmap,0,0);
    const pixels = context.getImageData(0,0,source.width,source.height).data;
    const canvas=document.createElement('canvas');
    const ratio=1200/Math.max(width,height);canvas.width=Math.max(1,Math.round(width*ratio));canvas.height=Math.max(1,Math.round(height*ratio));
    const output=canvas.getContext('2d');if(!output) throw new Error('Canvas недоступен');
    const image=output.createImageData(canvas.width,canvas.height);
    const vaov=asset.vaov_deg ?? 180, offset=asset.v_offset_deg ?? 0;
    for(let y=0;y<canvas.height;y++) for(let x=0;x<canvas.width;x++) {
      const dx=(x/canvas.width*width-panorama.x)*scale, dy=(y/canvas.height*height-panorama.y)*scale;
      const distance=Math.hypot(dx,dy), pitch=-Math.atan2(cameraHeight,distance)*180/Math.PI;
      if(distance>20 || pitch<offset-vaov/2 || pitch>offset+vaov/2) continue;
      const yaw=Math.atan2(dx,-dy)*180/Math.PI-panorama.heading_offset_deg;
      const sx=Math.floor((((yaw+180)%360+360)%360)/360*source.width);
      const sy=Math.min(source.height-1,Math.max(0,Math.floor((offset+vaov/2-pitch)/vaov*source.height)));
      const from=(sy*source.width+sx)*4,to=(y*canvas.width+x)*4;
      image.data[to]=pixels[from]; image.data[to+1]=pixels[from+1];image.data[to+2]=pixels[from+2];image.data[to+3]=255;
    }
    output.putImageData(image,0,0);
    const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Не удалось создать план')),'image/png'));
    return new File([blob],'floor-projection.png',{type:'image/png'});
  } finally { bitmap.close(); }
}

/** Guess four visible floor boundaries from vertical image edges. This drafts one
 * room around one camera point; it cannot see through walls or discover rooms. */
export async function draftVisibleRoom(asset: AssetRef, panorama: Panorama, width: number, height: number, scale: number, cameraHeight: number): Promise<Point[]> {
  if (!Number.isFinite(cameraHeight) || cameraHeight < .5 || cameraHeight > 3 || scale <= 0)
    throw new Error('Высота камеры или масштаб карты не заданы.');
  const response = await fetch(asset.mobile_url, { credentials: 'same-origin' });
  if (!response.ok) throw new Error('Панорама недоступна для расчёта схемы.');
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
    const context=canvas.getContext('2d');if(!context)throw new Error('Canvas недоступен');
    context.drawImage(bitmap,0,0);
    const pixels=context.getImageData(0,0,canvas.width,canvas.height).data;
    const vaov=asset.vaov_deg??180,offset=asset.v_offset_deg??0;
    const reach=(bearing:number)=>{
      const yaw=bearing-panorama.heading_offset_deg;
      const x=Math.floor(((((yaw+180)%360)+360)%360)/360*canvas.width);
      const row=(pitch:number)=>Math.round((offset+vaov/2-pitch)/vaov*canvas.height);
      const first=Math.max(1,row(-4)),last=Math.min(canvas.height-2,row(-30));
      let bestRow=Math.round((first+last)/2),best=-1;
      for(let y=first;y<=last;y+=2){
        let score=0;
        for(const dx of [-6,-3,0,3,6]){
          const sx=(x+dx+canvas.width)%canvas.width;
          const a=(y*canvas.width+sx)*4,b=((y+2)*canvas.width+sx)*4;
          score+=Math.abs(pixels[a]-pixels[b])+Math.abs(pixels[a+1]-pixels[b+1])+Math.abs(pixels[a+2]-pixels[b+2]);
        }
        // Prefer nearer floor edges when furniture creates competing gradients.
        score*=1+(y-first)/Math.max(1,last-first)*.15;
        if(score>best){best=score;bestRow=y;}
      }
      const pitch=offset+vaov/2-bestRow/canvas.height*vaov;
      const metres=cameraHeight/Math.tan(Math.max(4,-pitch)*Math.PI/180);
      return Math.max(4,Math.min(20,metres))/scale;
    };
    const north=Math.min(reach(0),panorama.y-5),east=Math.min(reach(90),width-panorama.x-5);
    const south=Math.min(reach(180),height-panorama.y-5),west=Math.min(reach(270),panorama.x-5);
    if(Math.min(north,east,south,west)<10)throw new Error('Точка съёмки слишком близко к краю карты.');
    return [
      {x:panorama.x-west,y:panorama.y-north},
      {x:panorama.x+east,y:panorama.y-north},
      {x:panorama.x+east,y:panorama.y+south},
      {x:panorama.x-west,y:panorama.y+south},
    ];
  }finally{bitmap.close();}
}
