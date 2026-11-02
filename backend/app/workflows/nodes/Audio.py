from __future__ import annotations
import hashlib
import json
import math
import re
from pathlib import Path
from app.workflows.Node import Node
from app.helpers import Media as media

class AudioNode(Node):
    family = 'audio'
    group = 'Audio'
    icon = 'lucide:audio-lines'
    operations = {
        'audio.extract': {'icon':'lucide:audio-lines', 'label': 'Extract Audio', 'settings': {'audio_track':'0','output_format':'wav','sample_rate':16000,'channels':'mono','trim_enabled':False}},
    }
    def execute_operation(self, operation, node, outputs, source, workdir):
        if source is None or not source.is_file():
            raise ValueError('Extract Audio requires a selected source video')
        cfg = node.get('settings') or {}
        fmt = str(cfg.get('output_format') or 'wav')
        if fmt not in {'wav','mp3','flac','m4a','copy'}:
            raise ValueError('Unsupported audio output format')
        if fmt == 'copy' and (cfg.get('normalize') or cfg.get('sample_rate', 'auto') not in ('auto', None) or cfg.get('channels','original') not in ('original',None)):
            raise ValueError('copy cannot normalize or resample audio')
        start = float(cfg.get('start_seconds') or 0) if cfg.get('trim_enabled') else 0.
        end = float(cfg.get('end_seconds') or 0) if cfg.get('trim_enabled') else 0.
        if not all(math.isfinite(n) and n>=0 for n in (start,end)) or (cfg.get('trim_enabled') and end<=start):
            raise ValueError('Trim range must have end greater than start')
        track_value = str(cfg.get('audio_track','0'))
        if track_value != 'all' and not (track_value.isdecimal() and 0<=int(track_value)<=255):
            raise ValueError('Audio track must be a nonnegative index or all')
        # Metadata comes from FFprobe; preserve stream index mapping for multi-track assets.
        details = media.probe(source)
        tracks = details.get('audio') or []
        choices = list(range(len(tracks))) if track_value=='all' else [int(track_value)]
        if not tracks or any(i >= len(tracks) for i in choices):
            raise ValueError('Audio track not available')
        directory = workdir / 'audio';directory.mkdir(parents=True,exist_ok=True)
        safe_id = re.sub('[^A-Za-z0-9_-]','_',str(node.get('id') or 'audio'))[:48]
        filename_base = re.sub('[^A-Za-z0-9_-]','_',str(cfg.get('output_filename') or safe_id))[:70].strip('_') or safe_id
        ext = 'mka' if fmt=='copy' else fmt
        items=[]
        for index in choices:
            target=directory/f'{filename_base}_{index}.{ext}'
            needs = (not target.is_file() or target.stat().st_mtime_ns < source.stat().st_mtime_ns or target.stat().st_size==0)
            if needs:
                # Output is always beneath the workflow workspace; no shell=True.
                temp=target.with_name(target.stem+'.part.'+ext)
                args=['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-y']
                if cfg.get('trim_enabled'): args.extend(['-ss',str(start)])
                args.extend(['-i',str(source),'-map',f'0:a:{index}','-vn'])
                if cfg.get('trim_enabled'): args.extend(['-t',str(end-start)])
                if fmt=='copy': args.extend(['-c:a','copy'])
                else:
                    codecs={'wav':'pcm_s16le','mp3':'libmp3lame','flac':'flac','m4a':'aac'}
                    args.extend(['-c:a',codecs[fmt]])
                    rate=cfg.get('sample_rate',16000)
                    if rate not in ('auto',None): args.extend(['-ar',str(int(rate))])
                    channels=cfg.get('channels','mono')
                    if channels not in ('original',None): args.extend(['-ac','1' if channels in ('mono',1,'1') else '2'])
                args.extend(['-f','matroska' if fmt=='copy' else ({'m4a':'ipod'}.get(fmt,fmt)),str(temp)])
                try:
                    media.tool(*args,timeout=900)
                    if not temp.is_file() or temp.stat().st_size==0:
                        raise RuntimeError('FFmpeg returned an empty audio file')
                    temp.replace(target)
                finally: temp.unlink(missing_ok=True)
            match = re.search(r'/([0-9]+)/([0-9]+)/runs/([0-9]+)$',str(workdir).replace('\\','/'))
            url = f'/api/v1/workflows/{match.group(2)}/runs/{match.group(3)}/audio/{safe_id}/{index}' if match else None
            item={'path':str(target),'filename':target.name,'track':index,'format':ext,'codec': tracks[index].get('codec'),
                  'sample_rate':16000 if fmt!='copy' and cfg.get('sample_rate',16000) not in ('auto',None) else tracks[index].get('sample_rate'),
                  'channels':1 if fmt!='copy' and cfg.get('channels','mono') in ('mono',1,'1') else tracks[index].get('channels'),
                  'source_start_seconds':start, 'duration': (end-start) if cfg.get('trim_enabled') else details.get('duration')}
            if url: item['url']=url
            items.append(item)
        first=items[0]
        return {'status':'completed','audio':first['path'],'audio_file':first,'audio_files':items,'audio_track':first['track'], 'audio_path':first['path']}
