import { useEffect, useRef, useState } from 'react';
import type { Capture, MapSummary } from '../../../../CONTRACTS/types';
import { apiClient } from '../../shared/api';
import { navigate } from '../../shared/router';
import { useWorkspace } from '../organizer/useWorkspace';
import { PlanEditor } from '../plan';
import { PannellumViewport } from '../panorama/PannellumViewport';
import { buildViewerHotspots } from '../panorama/hotspots';
import { naturalFrames, preparePhoto, draftVisibleRoom } from './geometry';
import './studio.css';

const message = (e: unknown) => e instanceof Error ? e.message : String(e);

export function StudioList() {
  const [maps, setMaps] = useState<MapSummary[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { void apiClient.listMaps().then(setMaps).catch(e => setError(message(e))); }, []);
  return <main className="studio"><h1>Панорама и карта</h1><p>16 фотографий → панорама 360° → план пространства</p>
    <button disabled={busy} onClick={async () => { setBusy(true); try {
      const { map } = await apiClient.createMap({ title: 'Новое пространство', description: 'План по панораме: приблизительная геометрия, требующая проверки на месте.', width_units: 1000, height_units: 1000, scale_m_per_unit: 0.1, max_walk_gap_units: 150 });
      navigate(`/studio/${map.snapshot.id}`);
    } catch(e) { setError(message(e)); } finally { setBusy(false); } }}>+ Новая панорама</button>
    {error && <p role="alert">{error}</p>}<div className="studio-projects">{maps.map(m => <a key={m.id} href={`/studio/${m.id}`}>{m.title}<span>Открыть →</span></a>)}</div></main>;
}

export function Studio({ mapId }: { mapId: string }) {
  const ws = useWorkspace(mapId);
  const [tab, setTab] = useState<'panorama' | 'map' | 'upload'>('panorama');
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [job, setJob] = useState<Capture | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [panoramaId, setPanoramaId] = useState('');
  const [cameraHeight, setCameraHeight] = useState(1.6);
  const hfov = 65;
  const [yaw, setYaw] = useState(0);
  const [advanced, setAdvanced] = useState(false);
  const [selectedPoi, setSelectedPoi] = useState('');
  const [attachRequested, setAttachRequested] = useState(false);
  const [projecting, setProjecting] = useState(false);
  const latest = useRef(ws); latest.current = ws;
  const attached = useRef(new Set<string>());
  useEffect(() => { const urls = files.map(f => URL.createObjectURL(f)); setPreviews(urls); return () => urls.forEach(URL.revokeObjectURL); }, [files]);
  useEffect(() => { let alive = true; void apiClient.listCaptures(mapId).then(jobs => { if (alive) setJob(jobs[0] ?? null); }).catch(e => { if (alive) setError(message(e)); }); return () => { alive = false; }; }, [mapId]);
  useEffect(() => {
    if (!job || !['queued', 'running'].includes(job.state)) return;
    let alive = true;
    const timer = window.setInterval(() => { void apiClient.getCapture(mapId, job.id).then(value => { if (alive) setJob(value); }).catch(e => { if (alive) setError(message(e)); }); }, 1500);
    return () => { alive = false; clearInterval(timer); };
  }, [mapId, job?.id, job?.state]);
  useEffect(() => {
    const assetId = job?.result_asset_id;
    if (!attachRequested || job?.state !== 'succeeded' || !assetId || !ws.draft || attached.current.has(assetId)) return;
    attached.current.add(assetId);
    void apiClient.listAssets(mapId).then(async assets => {
      const current = latest.current; const doc = current.draft;
      const asset = assets.find(a => a.id === assetId);
      if (!asset || !doc) throw new Error('Готовый файл не найден. Обновите страницу.');
      current.addAsset(asset);
      if (!doc.panoramas.some(p => p.asset_id === assetId)) {
        const id = crypto.randomUUID(), nodeId = crypto.randomUUID();
        current.change({ ...doc, nodes: [...doc.nodes, { id: nodeId, x: job.x, y: job.y }], panoramas: [...doc.panoramas, { id, asset_id: assetId, title: job.title, x: job.x, y: job.y, nav_node_id: nodeId, heading_offset_deg: 0 }] });
        setPanoramaId(id); setTab('panorama'); setNotice('Панорама готова. Нажмите «Сохранить изменения», чтобы сохранить привязку к карте.');
      }
      setAttachRequested(false);
    }).catch(e => { attached.current.delete(assetId); setError(message(e)); });
  }, [job?.state, job?.result_asset_id, ws.draft, mapId, attachRequested]);

  if (!ws.map || !ws.draft) return <main className="studio"><p role={ws.error ? 'alert' : 'status'}>{ws.error || 'Загружаем пространство…'}</p></main>;
  const doc = ws.draft, snapshot = ws.map.snapshot;
  const panorama = doc.panoramas.find(p => p.id === panoramaId) ?? doc.panoramas.at(-1) ?? null;
  const asset = ws.assets.find(a => a.id === panorama?.asset_id);
  const running = busy || Boolean(job && ['queued', 'running'].includes(job.state));
  const hotspotConfigs = buildViewerHotspots({ panorama, panoramas: doc.panoramas, hotspots: doc.hotspots, pois: doc.pois, onActivate: action => { if (action.kind === 'poi') setSelectedPoi(action.poiId); else setPanoramaId(action.panoramaId); } });
  const poi = doc.pois.find(p => p.id === selectedPoi);
  async function upload() {
    if (files.length !== 16 || running) return;
    setBusy(true); setError('');
    try {
      // Resume only the still-collecting job; uploaded slots are replaceable/idempotent.
      let current = job?.state === 'collecting' ? job : await apiClient.createCapture(mapId, { title: `Панорама ${doc.panoramas.length + 1}`, x: snapshot.width_units / 2, y: snapshot.height_units / 2, hfov_hint_deg: hfov });
      setJob(current);
      for (let index = 0; index < 16; index++) {
        setNotice(`Подготовка и загрузка: ${index + 1} / 16`);
        current = await apiClient.uploadCaptureFrame(mapId, current.id, index, { file: await preparePhoto(files[index]) });
        setJob(current);
      }
      setJob(await apiClient.startStitch(mapId, current.id)); setAttachRequested(true); setNotice('');
    } catch(e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function generateSchematic() {
    if (!asset || !panorama || projecting) return;
    if (doc.shapes.length && !window.confirm('Заменить текущие контуры черновой схемой по панораме?')) return;
    setProjecting(true); setError('');
    try {
      const distinct=doc.panoramas.filter((item,index,list) => list.findIndex(other => Math.hypot(other.x-item.x,other.y-item.y)<10)===index);
      const shapes=[];
      for (const item of distinct) {
        const image=ws.assets.find(candidate=>candidate.id===item.asset_id);
        if (!image) continue;
        const points=await draftVisibleRoom(image,item,snapshot.width_units,snapshot.height_units,doc.scale_m_per_unit ?? .1,cameraHeight);
        shapes.push({id:crypto.randomUUID(),kind:'room' as const,label:`${item.title} (черновик)`,points});
      }
      if (!shapes.length) throw new Error('Нет доступных панорам для расчёта схемы.');
      ws.change({...doc,background_asset_id:null,shapes});
      setNotice(`Черновая схема построена по ${shapes.length} точкам съёмки. Проверьте стены, размеры и проходы, затем сохраните изменения.`);
    } catch(e) { setError(message(e)); } finally { setProjecting(false); }
  }
  const viewPoints = [...doc.shapes.flatMap(s => s.points), ...doc.pois, ...doc.panoramas];
  const centerX=snapshot.width_units/2, centerY=snapshot.height_units/2;
  const hasGeometry=doc.shapes.length>0 || doc.pois.length>0;
  const contentMinX=Math.min(...viewPoints.map(p=>p.x)),contentMaxX=Math.max(...viewPoints.map(p=>p.x));
  const contentMinY=Math.min(...viewPoints.map(p=>p.y)),contentMaxY=Math.max(...viewPoints.map(p=>p.y));
  const padding=hasGeometry ? Math.max(10,Math.max(contentMaxX-contentMinX,contentMaxY-contentMinY)*.15) : 100;
  const minX=doc.background_asset_id ? 0 : Math.max(0,(hasGeometry ? contentMinX : centerX)-padding);
  const minY=doc.background_asset_id ? 0 : Math.max(0,(hasGeometry ? contentMinY : centerY)-padding);
  const maxX=doc.background_asset_id ? snapshot.width_units : Math.min(snapshot.width_units,(hasGeometry ? contentMaxX : centerX)+padding);
  const maxY=doc.background_asset_id ? snapshot.height_units : Math.min(snapshot.height_units,(hasGeometry ? contentMaxY : centerY)+padding);
  const background=ws.assets.find(a=>a.id===doc.background_asset_id);
  const plan = <svg className="studio-map" role="img" aria-label="2D-план пространства" viewBox={`${minX} ${minY} ${maxX-minX} ${maxY-minY}`}>
    <defs><pattern id="studio-grid" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M 10 0 L 0 0 0 10" fill="none" stroke="#dce4ec" strokeWidth=".35" /></pattern></defs>
    <rect x={minX} y={minY} width={maxX-minX} height={maxY-minY} fill="url(#studio-grid)" />
    {background && <image href={background.full_url} x="0" y="0" width={snapshot.width_units} height={snapshot.height_units} preserveAspectRatio="none" />}
    {doc.shapes.map(s => s.kind === 'wall' ? <polyline key={s.id} points={s.points.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#536c80" strokeWidth="1.5" /> : <g key={s.id}><polygon points={s.points.map(p => `${p.x},${p.y}`).join(' ')} fill={s.kind === 'corridor' ? '#eef7f4' : '#edf3f9'} stroke="#26374d" strokeWidth="2" /><text x={s.points.reduce((n,p) => n+p.x,0)/s.points.length} y={s.points.reduce((n,p) => n+p.y,0)/s.points.length} fontSize="6" fill="#26374d" fontWeight="700" textAnchor="middle">{s.label}</text></g>)}
    {doc.edges.map(e => { const a = doc.nodes.find(n => n.id === e.a), b = doc.nodes.find(n => n.id === e.b); return a && b ? <line key={e.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#539d87" strokeDasharray="3 2" /> : null; })}
    {doc.pois.map(p => <g key={p.id} onClick={() => setSelectedPoi(p.id)}><circle cx={p.x} cy={p.y} r="2.8" fill="#d24d37" /><text x={p.x+5} y={p.y+1.5} fontSize="4.5">{p.title}</text></g>)}
    {panorama && <g transform={`translate(${panorama.x} ${panorama.y})`}><path d="M0 0 L-16 -25 A30 30 0 0 1 16 -25 Z" fill="#e34d3940" transform={`rotate(${yaw + panorama.heading_offset_deg})`} /><circle r="3.5" fill="#e34d39" stroke="white" strokeWidth="1" /></g>}
  </svg>;
  return <main className="studio">
    <header className="studio-heading"><div><a href="/studio">← Пространства</a><h1>{doc.title}</h1><p>{asset ? `${asset.width_px} px · обзор 360° · ${Math.round(asset.vaov_deg ?? 180)}° по вертикали` : 'Загрузите серию из 16 фотографий с одной точки'}</p></div><div className="studio-actions"><button disabled={ws.saving || !ws.dirty || ws.conflict} onClick={() => void ws.save().then(ok => { if(ok) setNotice('Изменения сохранены'); })}>{ws.saving ? 'Сохраняем…' : ws.dirty ? 'Сохранить изменения' : 'Сохранено'}</button><a href={`/organize/${mapId}`}>Полный редактор</a></div></header>
    <nav className="studio-tabs" aria-label="Разделы пространства">{([['panorama','Панорама 360°'],['map','2D-карта'],['upload','Загрузить 16 фото']] as const).map(([id,label]) => <button key={id} aria-pressed={tab===id} onClick={() => setTab(id)}>{label}</button>)}</nav>
    {(error || ws.error) && <p className="studio-error" role="alert">{error || ws.error}</p>}{ws.conflict && <p>Версия на сервере изменилась. Скачайте JSON ниже, затем обновите страницу.</p>}
    {notice && <p className="studio-notice" role="status">{notice}</p>}
    {tab === 'panorama' && <div className="studio-view"><section>{asset && panorama ? <><div className="studio-toolbar"><select aria-label="Выбрать панораму" value={panorama.id} onChange={e => { setPanoramaId(e.target.value);  }}>{doc.panoramas.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select><span>Потяните, чтобы оглядеться · колесо — масштаб</span></div><PannellumViewport key={panorama.id} imageUrl={asset.full_url} previewUrl={asset.preview_url} asset={asset} initialHfovDeg={90} hotspots={hotspotConfigs} onViewChanged={view => setYaw(view.yaw)} className="studio-sphere" /></> : <div className="studio-empty"><h2>Здесь будет ваша панорама</h2><p>Снимите полный круг из одной точки с перекрытием соседних кадров.</p><button onClick={() => setTab('upload')}>Выбрать 16 фотографий</button></div>}</section><aside><h2>Точка съёмки</h2>{plan}<p>Красный сектор показывает направление взгляда.</p><button onClick={() => setTab('map')}>Открыть 2D-карту</button></aside></div>}
    {tab === 'map' && <section><div className="studio-toolbar"><h2>План пространства</h2><button disabled={!asset || projecting} onClick={() => void generateSchematic()}>{projecting ? "Строим схему…" : "Создать схему по панораме"}</button><button onClick={() => setAdvanced(v => !v)}>{advanced ? 'Закрыть редактор' : 'Редактировать план и точки'}</button></div><p>Черновой план видимого помещения. Размеры, перегородки и проходы проверьте на месте; невидимые комнаты добавьте в редакторе или импортируйте чертёж.</p>{advanced ? <PlanEditor mapId={mapId} widthUnits={snapshot.width_units} heightUnits={snapshot.height_units} document={doc} isAuthenticated assets={ws.assets} onChangeDocument={ws.change} onSaveDocument={() => ws.save()} onNotify={setNotice} onAsset={ws.addAsset} /> : plan}</section>}
    {tab === 'upload' && <section className="studio-upload"><h2>Один круг. 16 фотографий.</h2><p>Выберите все кадры сразу. Порядок — по номеру в имени файла; первый и последний кадры должны перекрываться. Уберите повторы и снимайте с одной точки.</p><label className="studio-drop">Выбрать фотографии<input aria-label="Выбрать 16 фотографий" type="file" multiple accept="image/jpeg,image/png,image/webp" disabled={running} onChange={e => { const chosen=naturalFrames(Array.from(e.target.files ?? [])); setFiles(current => chosen.length===16 ? chosen : [...current,...chosen.filter(f => !current.some(old => old.name===f.name))].slice(0,16)); e.currentTarget.value=''; setError(''); }}/></label><div className="studio-frame-grid">{files.map((f,i) => <div key={`${f.name}-${i}`}><img src={previews[i]} alt={`Кадр ${i+1}`} /><span>{i+1}. {f.name}</span><button aria-label={`Передвинуть кадр ${i+1} влево`} disabled={running || i===0} onClick={() => setFiles(list => { const next=[...list]; [next[i-1],next[i]]=[next[i],next[i-1]]; return next; })}>←</button><button className="studio-remove" aria-label={`Удалить кадр ${i+1}`} disabled={running} onClick={() => setFiles(list => list.filter((_,index) => index !== i))}>✕</button></div>)}</div><p>Выбрано: {files.length} / 16</p><button disabled={files.length!==16 || running} onClick={() => void upload()}>{busy ? 'Загружаем…' : 'Склеить панораму'}</button>
      {job && <div className={`studio-job studio-job--${job.state}`}><strong>{({ collecting:'Загрузка кадров', queued:'В очереди', running:'Склейка', succeeded:'Готово', failed:'Склейка не удалась', cancelled:'Отменено' })[job.state]}</strong>{['collecting','queued','running'].includes(job.state) && <><progress max="100" value={job.state==='collecting' ? job.frames.length/16*100 : job.progress}/><span>{job.state==='collecting' ? `${job.frames.length}/16 кадров` : `${job.progress}%`}</span></>}{job.state==='succeeded' && job.started_at && job.finished_at && <p>Обработка: {Math.round((Date.parse(job.finished_at)-Date.parse(job.started_at))/1000)} с</p>}{job.state==='succeeded' && !doc.panoramas.some(p=>p.asset_id===job.result_asset_id) && <button onClick={() => { attached.current.delete(job.result_asset_id!); setAttachRequested(true); }}>Добавить готовую панораму на карту</button>}{job.state==='cancelled' && <p>Склейка остановлена. Выберите 16 кадров и нажмите «Склеить панораму» ещё раз.</p>}{job.error_message && <p role="alert">{job.error_message} ({job.error_code})</p>}{['collecting','queued','running'].includes(job.state) && !busy && <button onClick={() => void apiClient.cancelCapture(mapId,job.id).then(setJob).catch(e => setError(message(e)))}>Отменить</button>}{job.state==='failed' && job.attempt<2 && <button onClick={() => void apiClient.startStitch(mapId,job.id).then(value => { setJob(value); setAttachRequested(true); }).catch(e => setError(message(e)))}>Повторить склейку</button>}</div>}
    </section>}
    {poi && <div className="studio-poi"><button onClick={() => setSelectedPoi('')}>Закрыть</button><h3>{poi.title}</h3><p>{poi.description}</p></div>}

  </main>;
}
