from __future__ import annotations
import re
from datetime import datetime
from pathlib import Path
from app.workflows.Node import Node
from app.helpers.Transcript import get_input, input_path, compare_value

class LogicNode(Node):
    family='logic'
    group='Logic'
    icon = 'lucide:git-branch'
    operations={
        'flow.if':{'icon':'lucide:git-branch', 'label':'IF', 'settings':{'path':'','operator':'truthy','value':''}},
        'flow.merge':{'icon':'lucide:git-merge', 'label':'Merge', 'settings':{'mode':'append'}},
        'flow.switch':{'icon':'lucide:split', 'label':'Switch', 'settings':{'path':'','cases':[],'fallback':True}},
    }
    def execute_operation(self,operation,node,outputs,source,workdir):
        cfg=node.get('settings') or {}
        if operation=='flow.merge':
            mode=str(cfg.get('mode') or 'append')
            values=list(outputs.values())
            if mode=='append':
                result=[]
                for item in values:
                    if isinstance(item,dict):
                        value=item.get('items',item)
                        result.extend(value if isinstance(value,list) else [value])
                return {'items':result}
            if mode=='combine':
                merged={}
                for item in values:
                    if isinstance(item,dict):merged.update(item.get('items',item) if isinstance(item.get('items',item),dict) else {})
                return {'items':merged}
            raise ValueError('Unsupported Merge mode')
        if operation=='flow.switch':
            value=input_path(outputs,str(cfg.get('path') or '')) if cfg.get('path') else None
            cases=cfg.get('cases') or []
            if not isinstance(cases,list) or len(cases)>10:raise ValueError('Invalid Switch cases')
            for i,case in enumerate(cases):
                if isinstance(case,dict) and value==case.get('value'):return {'route':i,'value':value}
            return {'route':None,'value':value}
        rules=cfg.get('conditions')
        if rules is None:
            actual=input_path(outputs,str(cfg.get('path',''))) if cfg.get('path') else get_input(outputs,'condition')
            result=compare_value(actual,str(cfg.get('operator','truthy')),cfg.get('value'))
            return {'condition':bool(result),'matched_count':int(bool(result))}
        if not isinstance(rules,list) or not 1<=len(rules)<=25:raise ValueError('IF requires between 1 and 25 conditions')
        results=[]
        for rule in rules:
            if not isinstance(rule,dict):raise ValueError('Invalid IF rule')
            kind=str(rule.get('type','string'));op=str(rule.get('operator','equals'))
            if kind not in {'number','string','boolean','datetime','array','object'}:raise ValueError('Invalid IF rule type')
            def resolve(side):
                value=side.get('value') if isinstance(side,dict) else side
                mode=side.get('mode','fixed') if isinstance(side,dict) else 'fixed'
                if mode=='expression':
                    match=re.fullmatch(r'\s*\{\{\s*(?:\$json\.)?([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)\s*\}\}\s*',str(value))
                    if match is None:raise ValueError('IF expression like {{ step.value }} required; no eval')
                    path=match.group(1)
                    if path.split('.')[0] not in outputs and len(outputs)==1:path=next(iter(outputs))+'.'+path
                    return input_path(outputs,path)
                if mode=='fixed':return value
                raise ValueError('IF supports only fixed and expression operands')
            left=resolve(rule.get('left',{}));right=resolve(rule.get('right',{}))
            if kind=='number':
                if op not in {'equals','not_equals','greater_than','less_than','greater_or_equal','less_or_equal'}:raise ValueError('Invalid IF number operator')
                if not cfg.get('convert_types') and isinstance(left,str) and (rule.get('left') or {}).get('mode')=='expression':
                    raise ValueError('Convert types must be enabled for string-to-number values')
                a,b=float(left),float(right)
                import math
                if not math.isfinite(a) or not math.isfinite(b):raise ValueError('Nonfinite numeric value')
                ok={'equals':lambda:a==b,'not_equals':lambda:a!=b,'greater_than':lambda:a>b,'less_than':lambda:a<b,'greater_or_equal':lambda:a>=b,'less_or_equal':lambda:a<=b}[op]()
            elif kind=='datetime':
                if op not in {'before','after','equals'}:raise ValueError('Invalid IF datetime operator')
                def parse(x):return datetime.fromisoformat(str(x).replace('Z','+00:00'))
                a,b=parse(left),parse(right)
                ok= a<b if op=='before' else a>b if op=='after' else a==b
            elif kind=='boolean':
                if op not in {'is_true','is_false','equals'}:raise ValueError('Invalid IF boolean operator')
                ok= bool(left) if op=='is_true' else not bool(left) if op=='is_false' else bool(left)==(str(right).lower()=='true')
            elif kind=='array':
                if not isinstance(left,list):raise ValueError('Expected IF array')
                if op not in {'is_empty','is_not_empty','contains'}:raise ValueError('Invalid IF array operator')
                ok=(not left) if op=='is_empty' else bool(left) if op=='is_not_empty' else right in left
            elif kind=='object':
                if not isinstance(left,dict) or op not in {'contains_key','is_empty','is_not_empty'}:raise ValueError('Invalid IF object operator')
                ok= str(right) in left if op=='contains_key' else not left if op=='is_empty' else bool(left)
            else:
                if op not in {'equals','not_equals','contains','is_empty','is_not_empty'}:raise ValueError('Invalid IF string operator')
                a=str(left or '');b=str(right or '')
                if cfg.get('ignore_case'):a=a.casefold();b=b.casefold()
                ok= a==b if op=='equals' else a!=b if op=='not_equals' else b in a if op=='contains' else not a if op=='is_empty' else bool(a)
            results.append(bool(ok))
        combine=str(cfg.get('combine','all'))
        if combine not in ('all','any'):raise ValueError('IF combine must be all or any')
        passed=all(results) if combine=='all' else any(results)
        return {'condition':passed,'matched_count':sum(results),'rule_count':len(rules)}
