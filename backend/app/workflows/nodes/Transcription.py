from __future__ import annotations
import hashlib
import json
import re
from pathlib import Path
from app.workflows.Node import Node
from app.helpers.Transcript import as_words, group_words

class TranscriptionNode(Node):
    family = 'transcription'
    group = 'Audio'
    icon = 'lucide:captions'
    operations = {
        'audio.transcribe': {'icon':'lucide:mic', 'label':'Transcribe Every Word', 'settings': {'model':'small','language':None,'beam_size':5,'device':'cpu','compute_type':'int8','vad_filter':True,'include_confidence':True}}
    }
    def execute_operation(self, operation, node, outputs, source, workdir):
        cfg=node.get('settings') or {}
        model=str(cfg.get('model') or 'small')
        if model not in {'tiny','base','small','medium','large-v2','large-v3','large-v3-turbo','turbo'}: raise ValueError('Invalid Whisper model')
        language=cfg.get('language') or None
        if language and not re.fullmatch('[a-z]{2,3}',str(language)): raise ValueError('Invalid transcription language')
        device=str(cfg.get('device') or 'cpu')
        if device not in {'cpu','cuda','auto'}: raise ValueError('Invalid Whisper device')
        compute_type=str(cfg.get('compute_type') or ('int8' if device=='cpu' else 'float16'))
        if device=='cpu' and compute_type=='float16': raise ValueError('float16 is not available on CPU')
        beam=int(cfg.get('beam_size',5))
        if not 1<=beam<=10: raise ValueError('beam_size out of range')
        wanted=str(cfg.get('audio_track','0'))
        if not wanted.isdigit(): raise ValueError('audio_track must be a valid numeric index')
        entries=[]
        for parent in outputs.values():
            if isinstance(parent,dict) and isinstance(parent.get('audio_files'),list):
                entries.extend(x for x in parent['audio_files'] if isinstance(x,dict))
            elif isinstance(parent,dict) and parent.get('audio'):
                entries.append({'path':parent['audio'],'track':0})
        if not entries: raise ValueError('Connect Extract Audio before Transcribe Every Word')
        entry=next((x for x in entries if int(x.get('track',0))==int(wanted)),None)
        if entry is None: raise ValueError('Selected audio track was not extracted')
        audio=Path(str(entry['path'])).resolve()
        # Media must originate from current run's audio directory.
        if not audio.is_relative_to((workdir/'audio').resolve()) or not audio.is_file():
            raise ValueError('Audio must belong to current workflow run')
        signature={'path':str(audio),'size':audio.stat().st_size,'mtime':audio.stat().st_mtime_ns, 'model':model, 'language':language,
                   'beam':beam,'device':device,'compute':compute_type,'vad':cfg.get('vad_filter',True),
                   'confidence':cfg.get('include_confidence',True),'offset':entry.get('source_start_seconds',0)}
        fingerprint=hashlib.sha256(json.dumps(signature,sort_keys=True).encode()).hexdigest()
        cache=workdir/f'transcript_{fingerprint}.json'
        if cache.is_file():
            try:
                cached=json.loads(cache.read_text(encoding='utf8'))
                if isinstance(cached.get('words'),list) and 'language' in cached and 'segments' in cached: return cached
            except (ValueError,OSError,AttributeError): pass
        from faster_whisper import WhisperModel
        whisper=WhisperModel(model,device=device,compute_type=compute_type)
        kwargs={'language':language,'beam_size':beam,'word_timestamps':True,'vad_filter':bool(cfg.get('vad_filter',True))}
        if cfg.get('initial_prompt'):kwargs['initial_prompt']=str(cfg['initial_prompt'])[:1000]
        segments,info=whisper.transcribe(str(audio),**kwargs)
        offset=float(entry.get('source_start_seconds') or 0)
        words=[]
        for segment in segments:
            for word in (getattr(segment,'words',None) or []):
                text=str(getattr(word,'word','')).strip()
                if not text:continue
                item={'id':len(words)+1,'text':text,'start':round(float(word.start)+offset,3),'end':round(float(word.end)+offset,3)}
                if cfg.get('include_confidence',True) and getattr(word,'probability',None) is not None:
                    item['confidence']=round(float(word.probability),4)
                words.append(item)
        result={'text':' '.join(w['text'] for w in words),'words':words,'segments':group_words(words),
                'word_count':len(words),'language':str(info.language),'audio_track':int(wanted),'method':'faster_whisper'}
        temp=cache.with_suffix('.tmp');temp.write_text(json.dumps(result,ensure_ascii=False),encoding='utf8');temp.replace(cache)
        return result
