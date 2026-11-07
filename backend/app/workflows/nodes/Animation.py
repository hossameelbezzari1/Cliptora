from __future__ import annotations
import math
from app.workflows.Node import Node
from app.helpers.Transcript import get_input

class AnimationNode(Node):
    family='animation'
    group='Animation'
    icon = 'lucide:wand-sparkles'
    operations={
        'animation.storyboard':{'icon':'lucide:book-open', 'label':'Storyboard','settings':{'script':'','scene_seconds':4}},
        'animation.keyframes':{'icon':'lucide:wand-sparkles', 'label':'Keyframes','settings':{'preset':'fade-pop'}},
    }
    parameter_fields = {'animation.storyboard': {'script': {'type':'string','widget':'textarea'}, 'scene_seconds': {'type':'integer','minimum':1,'maximum':600}}}

    def execute_operation(self,operation,node,outputs,source,workdir):
        cfg=node.get('settings') or {}
        if operation=='animation.storyboard':
            duration=float(cfg.get('scene_seconds',4))
            if not math.isfinite(duration) or not 0<duration<=600:raise ValueError('Invalid scene duration')
            lines=[x.strip() for x in str(cfg.get('script') or '').splitlines() if x.strip()][:200]
            return {'scenes':[{'id':i+1,'start':round(i*duration,3),'end':round((i+1)*duration,3),'text':line} for i,line in enumerate(lines)]}
        scenes=get_input(outputs,'scenes') or []
        preset=str(cfg.get('preset') or 'fade-pop')
        if preset not in {'fade-pop','fade','slide','zoom','none'}:raise ValueError('Unsupported animation preset')
        return {'keyframes':[{'scene_id':x.get('id',i+1),'preset':preset,'start':x.get('start'), 'end':x.get('end')} for i,x in enumerate(scenes) if isinstance(x,dict)]}
