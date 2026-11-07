from __future__ import annotations
import math
import shutil
import tempfile
from pathlib import Path
from app.workflows.Node import Node
from app.helpers.Transcript import get_input
from app.helpers import Media as media

class OutputNode(Node):
    family='output'
    group='Output'
    icon = 'lucide:film'
    operations={
        'caption.generate':{'icon':'lucide:captions', 'label':'Generate Captions','settings':{'max_words':6,'style':'karaoke'}},
        'video.render':{'icon':'lucide:film', 'label':'Render Video','settings':{'enabled':False,'aspect_ratio':'original'}},
    }
    parameter_fields = {
        'video.render': {'enabled': {'type':'boolean'}, 'aspect_ratio': {'type':'string','enum':['original','16:9','9:16','1:1']}},
        'caption.generate': {'style': {'type':'string','enum':['karaoke','word-pop','classic']}, 'max_words': {'type':'integer','minimum':1,'maximum':30}},
    }

    def execute_operation(self,operation,node,outputs,source,workdir):
        cfg=node.get('settings') or {}
        if operation=='caption.generate':
            words=get_input(outputs,'words') or []
            max_words=int(cfg.get('max_words',6))
            if not 1<=max_words<=30:raise ValueError('max_words out of range')
            chunks=[words[i:i+max_words] for i in range(0,len(words),max_words)]
            return {'captions':[{'start':c[0]['start'],'end':c[-1]['end'],
                                 'text':' '.join(w.get('text','') for w in c),'words':c} for c in chunks if c],
                    'style':str(cfg.get('style','karaoke'))}
        if not cfg.get('enabled',False):return {'render':{'enabled':False,'status':'disabled'}}
        if source is None or not source.is_file():raise ValueError('Render Video requires a source video')
        cuts=get_input(outputs,'cut_plan') or []
        if not cuts:raise ValueError('Render Video requires a nonempty Cut Plan')
        if len(cuts)>200:raise ValueError('Too many cuts')
        fragments=[]
        for item in cuts:
            if not isinstance(item,dict):raise ValueError('Invalid cut timing')
            start=float(item.get('source_start',float('nan')))
            duration=float(item.get('duration',float('nan')))
            if not math.isfinite(start) or not math.isfinite(duration) or start<0 or duration<=0 or start+duration>86400:
                raise ValueError('Invalid cut timing')
            fragments.append((start,duration))
        aspect=cfg.get('aspect_ratio','original')
        if aspect not in {'original','16:9','9:16','1:1'}:raise ValueError('Invalid render aspect ratio')
        workdir.mkdir(parents=True,exist_ok=True)
        # Generate all trims in memory as filtergraph, pass via subprocess argument list, not shell.
        graph=[]
        for i,(start,length) in enumerate(fragments):
            graph.append(f'[0:v]trim=start={start:.6f}:duration={length:.6f},setpts=PTS-STARTPTS[v{i}]')
        graph.append(''.join(f'[v{i}]' for i in range(len(fragments)))+f'concat=n={len(fragments)}:v=1:a=0[outv]')
        with tempfile.TemporaryDirectory(prefix='cliptora-render-',dir=workdir) as temp:
            tmp=Path(temp)/'rendered.mp4'
            args=['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-y','-i',str(source),'-filter_complex',';'.join(graph),'-map','[outv]','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',str(tmp)]
            media.tool(*args,timeout=3600)
            if not tmp.is_file() or tmp.stat().st_size<=0:raise RuntimeError('FFmpeg returned an empty video')
            tmp.replace(workdir/'final.mp4')
        return {'render':{'enabled':True,'status':'completed','filename':'final.mp4',
                          'duration':round(sum(d for _,d in fragments),3),'cuts':len(fragments)}}
