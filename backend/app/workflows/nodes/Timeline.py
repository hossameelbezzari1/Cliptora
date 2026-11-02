from __future__ import annotations
import math
from app.workflows.Node import Node
from app.workflows.nodes.OpenAI import OpenAINode
from app.workflows.nodes.Gemini import GeminiNode
from app.helpers.Transcript import get_input,as_words,group_words,normalize_highlights,offline_highlights

class TimelineNode(Node):
    family='timeline'
    group='Timeline / AI Editing'
    icon = 'lucide:scissors'
    operations={
        'ai.highlights':{'icon':'lucide:sparkles', 'label':'Select Highlights','settings':{'mode':'offline','target_duration':120,'strategy':'story_recap','highlights':[]}},
        'ai.summary':{'icon':'lucide:file-text', 'label':'Recap Script','settings':{'mode':'offline','language':'auto','prompt':''}},
        'timeline.cut_plan':{'icon':'lucide:scissors', 'label':'Cut Plan','settings':{'padding':0.16}},
    }
    def execute_operation(self,operation,node,outputs,source,workdir):
        cfg=node.get('settings') or {}
        if operation=='ai.summary':
            moments=get_input(outputs,'highlights') or []
            segments=get_input(outputs,'segments') or []
            words=get_input(outputs,'words') or []
            text=get_input(outputs,'text') or ' '.join(str(w.get('text','')) for w in words if isinstance(w,dict))
            mode=str(cfg.get('mode') or 'offline')
            if mode=='offline':
                # Deterministic text-only fallback (not an LLM-generated summary).
                selected=[]
                for highlight in moments:
                    selected.extend(w.get('text','') for w in words if isinstance(w,dict) and w.get('start',-1)>=highlight.get('start',0) and w.get('end',0)<=highlight.get('end',0))
                return {'summary':' '.join(selected) if selected else str(text)[:12000], 'method':'offline_excerpts'}
            if mode=='openai':
                return OpenAINode.openai_chat({'prompt':cfg.get('prompt') or f'Summarize the following dialogue, without inventing events:\n{text}'},outputs)
            raise ValueError('Unsupported summary mode')
        if operation=='ai.highlights':
            words=as_words(get_input(outputs,'words'))
            mode=str(cfg.get('mode') or 'offline')
            target=int(cfg.get('target_duration') or 120)
            if not 1<=target<=7200:raise ValueError('Invalid highlight duration')
            if mode=='offline':highlights=offline_highlights(words,target,str(cfg.get('strategy') or 'story_recap'))
            elif mode=='manual':highlights=normalize_highlights(cfg.get('highlights') or [],words)
            elif mode=='openai':
                from app.helpers.Transcript import HIGHLIGHTS_SCHEMA
                transcript=' '.join(f'[{w["id"]}]{w["text"]}' for w in words)
                data=OpenAINode.openai_json(str(cfg.get('prompt') or 'Select highlights using only word IDs.'),transcript,HIGHLIGHTS_SCHEMA)
                highlights=normalize_highlights(data.get('highlights',[]),words)
            elif mode=='gemini':
                return GeminiNode.message_model({'settings':{**cfg,'output_mode':'highlights'}},outputs)
            else:raise ValueError('Unsupported highlight mode')
            cleaned=[]
            budget=float(target)
            for h in highlights:
                if budget<=0:break
                if float(h['end'])-float(h['start'])>budget:
                    last=next((w for w in reversed(words) if w['id']<=h['end_word_id'] and w['end']<=h['start']+budget),None)
                    if last is None:continue
                    h={**h,'end':last['end'],'end_word_id':last['id']}
                budget-=h['end']-h['start'];cleaned.append(h)
            return {'highlights':cleaned,'method':mode,'target_duration':target,'selected_duration':round(target-budget,3)}
        padding=float(cfg.get('padding',0.16))
        if not math.isfinite(padding) or not 0<=padding<=30:raise ValueError('Cut padding must be finite and nonnegative')
        moments=get_input(outputs,'highlights') or []
        probe=get_input(outputs,'probe') or {}
        duration=float(probe.get('duration') or 14400) if isinstance(probe,dict) else 14400
        cuts=[]
        for entry in moments:
            if not isinstance(entry,dict):continue
            start,end=float(entry.get('start',0)),float(entry.get('end',0))
            if not math.isfinite(start) or not math.isfinite(end) or start<0 or end<=start:raise ValueError('Invalid highlight timing')
            if start>=duration:continue
            a=max(0,start-padding);b=min(duration,end+padding)
            cuts.append({'source_start':round(a,3),'source_end':round(b,3),'duration':round(b-a,3),
                         'reason':str(entry.get('reason',''))[:240]})
        return {'cut_plan':cuts,'output_duration':round(sum(c['duration'] for c in cuts),3)}
