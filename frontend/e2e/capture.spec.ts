import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

test.use({ viewport: { width: 390, height: 844 } });

test('real capture frames survive reload and produce a measured panorama through the worker', async ({ page }) => {
  test.setTimeout(240000);
  const frames=await Promise.all(Array.from({length:16},(_,i)=>readFile(resolve(`backend/tests/fixtures/stitch/series_01/photo_${i+1}_2026-10-24_08-13-40.jpg`),'base64')));
  await page.addInitScript(({frames})=>{
    const scope=window as unknown as { auditFrameIndex:number; auditDraw:()=>Promise<void> };
    scope.auditFrameIndex=0;
    const canvas=document.createElement('canvas');canvas.width=600;canvas.height=800;
    scope.auditDraw=async()=>{const image=new Image();image.src=`data:image/jpeg;base64,${frames[scope.auditFrameIndex]}`;await image.decode();canvas.getContext('2d')!.drawImage(image,0,0,600,800);};
    Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>{await scope.auditDraw();return canvas.captureStream(10);}}});
  },{frames});
  await page.goto('/login');await page.getByLabel('Email').fill(process.env.E2E_EMAIL!);await page.getByLabel('Пароль',{exact:true}).fill(process.env.E2E_PASSWORD!);await page.getByRole('button',{name:'Войти',exact:true}).click();
  await page.getByLabel('Название карты',{exact:true}).fill('Capture E2E');await page.getByRole('button',{name:'Создать карту'}).click();
  await page.getByRole('button',{name:'Активировать камеру'}).click();await page.getByRole('button',{name:'Снять кадр 1',exact:true}).click();await expect(page.getByAltText('Кадр 1',{exact:true})).toBeVisible();
  // Actual IndexedDB and reload, without a test-only encoder or API stub.
  await page.reload();await expect(page.getByAltText('Кадр 1',{exact:true})).toBeVisible();
  await page.route('**/captures/*/frames/0', (route) => route.abort(), { times: 1 });
  await page.getByRole('button',{name:'Оставить кадр',exact:true}).click();
  await expect(page.getByAltText('Кадр 1',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Повторить загрузку кадра',exact:true}).click();
  await page.getByRole('button',{name:'Активировать камеру'}).click();
  await page.route('**/captures/*/stitch', (route) => route.abort(), { times: 1 });
  await page.route('**/maps/*/assets', (route) => route.request().method() === 'GET' ? route.abort() : route.continue(), { times: 1 });
  for(let index=1;index<16;index++) {
    await page.locator('video').scrollIntoViewIfNeeded();
    // Register BEFORE drawing: captureStream emits only when the canvas changes.
    await page.locator('video').evaluate((video:HTMLVideoElement, index)=>new Promise<void>((resolve, reject)=>{
      const scope=window as unknown as {auditFrameIndex:number;auditDraw:()=>Promise<void>};
      const timeout = window.setTimeout(() => reject(new Error('Fixture video did not render a new frame')), 10000);
      video.requestVideoFrameCallback(()=>{ window.clearTimeout(timeout); resolve(); });
      scope.auditFrameIndex=index;
      void scope.auditDraw().catch(reject);
    }), index);
    await page.getByRole('button',{name:`Снять кадр ${index+1}`,exact:true}).click();
    if (index === 1) {
      await page.getByRole('button', { name: 'Переснять', exact: true }).click();
      await page.getByRole('button', { name: 'Снять кадр 2', exact: true }).click();
    }
    await page.getByRole('button',{name:'Оставить кадр',exact:true}).click();
    if(index<15) await expect(page.getByRole('button',{name:`Снять кадр ${index+2}`,exact:true})).toBeEnabled();
  }
  await page.getByRole('button', { name: 'Запустить склейку', exact: true }).click();
  await expect(page.getByText('Панорама готова',{exact:true})).toBeVisible({timeout:150000});
  await page.getByRole('button', { name: 'Получить готовую панораму', exact: true }).click();
  await expect(page.getByRole('combobox',{name:'Панорама',exact:true}).locator('option')).toHaveCount(2);
  await page.getByRole('button',{name:'Сохранить карту',exact:true}).click();await expect(page.getByText('Сохранено · v2',{exact:true})).toBeVisible();
  const mapId=page.url().split('/').pop();const response=await page.request.get(`/api/v1/maps/${mapId}`);const data=await response.json();
  expect(data.snapshot.document.panoramas).toHaveLength(1);
  const asset=data.snapshot.assets.find((a:{kind:string})=>a.kind==='panorama');
  expect(asset.vaov_deg).toBeGreaterThanOrEqual(40);expect(asset.vaov_deg).toBeLessThan(180);
  expect(asset.height_px).toBeCloseTo(asset.width_px*asset.vaov_deg/360,0);

  // A new series of repeated frames must fail through the real worker, and
  // neither retry nor cancellation may be represented as a ready panorama.
  await page.getByRole('button', { name: 'Активировать камеру', exact: true }).click();
  for (let index = 0; index < 16; index++) {
    await page.getByRole('button', { name: `Снять кадр ${index + 1}`, exact: true }).click();
    await page.getByRole('button', { name: 'Оставить кадр', exact: true }).click();
    if (index < 15) await expect(page.getByRole('button', { name: `Снять кадр ${index + 2}`, exact: true })).toBeEnabled();
  }
  await expect(page.getByText('Ошибка склейки (NOT_ENOUGH_OVERLAP)', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Повторить склейку (попытка 2/2)', exact: true }).click();
  await expect(page.getByText('Ошибка склейки (NOT_ENOUGH_OVERLAP)', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Повторить склейку/ })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Панорама', exact: true }).locator('option')).toHaveCount(2);
  await page.getByRole('button', { name: 'Активировать камеру', exact: true }).click();
  await page.getByRole('button', { name: 'Снять кадр 1', exact: true }).click();
  await page.getByRole('button', { name: 'Отменить съёмку', exact: true }).click();
  await page.getByRole('button', { name: 'Активировать камеру', exact: true }).click();
  await page.getByRole('button', { name: 'Снять кадр 1', exact: true }).click();
  await page.getByRole('button', { name: 'Оставить кадр', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Снять кадр 2', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(page.getByText('Съёмка отменена', { exact: true })).toBeVisible();
  const captures = await (await page.request.get(`/api/v1/maps/${mapId}/captures`)).json();
  expect(captures.map((capture: {state: string}) => capture.state).sort()).toEqual(['cancelled', 'cancelled', 'failed', 'succeeded']);
  expect(captures.find((capture: {state: string}) => capture.state === 'failed').result_asset_id).toBeNull();
});
