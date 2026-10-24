"""Launch local panorama studio with production API and a separate Hugin worker."""
import argparse
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import time
ROOT=Path(__file__).resolve().parents[1]
def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--port',type=int,default=8008)
    parser.add_argument('--hugin-bin',type=Path)
    parser.add_argument('--data-dir',type=Path,default=ROOT/'data/studio')
    args=parser.parse_args()
    directory=args.data_dir.resolve();directory.mkdir(parents=True,exist_ok=True)
    os.environ.update(DATABASE_PATH=str(directory/'studio.sqlite'),MEDIA_PATH=str(directory/'media'),APP_ORIGIN=f'http://127.0.0.1:{args.port}',COOKIE_SECURE='false',TTK_AUTO_SEED='0')
    if args.hugin_bin: os.environ['PATH']=str(args.hugin_bin.resolve())+os.pathsep+os.environ['PATH']
    for tool in ['pto_gen','cpfind','cpclean','autooptimiser','pano_modify','pano_trafo','nona','enblend']:
        if not shutil.which(tool): raise SystemExit(f'Missing {tool}; install Hugin/enblend or use --hugin-bin')
    if not (ROOT/'frontend/dist/index.html').is_file(): raise SystemExit('Run npm --prefix frontend run build first')
    sys.path.insert(0,str(ROOT))
    from backend.app.db import initialize_database,database
    from backend.app.auth import create_organizer
    initialize_database()
    with database() as db:
        row=db.execute('SELECT id FROM users WHERE email=?',('studio@local.test',)).fetchone()
    os.environ['TTK_LOCAL_STUDIO_USER_ID']=row['id'] if row else create_organizer('studio@local.test',secrets.token_urlsafe(32))
    options={'creationflags':subprocess.CREATE_NO_WINDOW} if os.name=='nt' else {}
    children=[];logs=[]
    try:
        for name,module,extra in [('api','uvicorn',['scripts.studio_app:app','--host','127.0.0.1','--port',str(args.port),'--no-proxy-headers']),('worker','backend.worker.main',[])]:
            log=(directory/f'{name}.log').open('a',encoding='utf-8');logs.append(log)
            children.append(subprocess.Popen([sys.executable,'-m',module,*extra],cwd=ROOT,stdout=log,stderr=log,**options))
        print(f'Open http://127.0.0.1:{args.port}/',flush=True)
        while all(child.poll() is None for child in children): time.sleep(1)
        raise SystemExit('API or worker stopped. Inspect data directory logs.')
    except KeyboardInterrupt: pass
    finally:
        for child in children:
            if child.poll() is None:
                if os.name=='nt': subprocess.run(['taskkill','/PID',str(child.pid),'/T','/F'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,**options)
                else: child.terminate()
                child.wait()
        for log in logs: log.close()
if __name__=='__main__': main()
