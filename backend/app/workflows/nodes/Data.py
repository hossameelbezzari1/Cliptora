from __future__ import annotations
from app.workflows.Node import Node
from app.helpers.Http import execute_http_request,value_path
from app.helpers.Transcript import get_input

class DataNode(Node):
    family='data'
    group='Data / Integrations'
    icon = 'lucide:database'
    operations={
        'data.json_extract':{'icon':'lucide:braces', 'label':'JSON Extract','settings':{'path':''}},
        'integration.http_request':{'icon':'lucide:globe', 'label':'HTTP Request','settings':{'method':'GET','url':'','response_format':'auto'}},
    }
    def execute_operation(self,operation,node,outputs,source,workdir):
        cfg=node.get('settings') or {}
        if operation=='integration.http_request':return execute_http_request(cfg)
        path=str(cfg.get('path') or '')
        value=get_input(outputs,'json')
        if value is None:value=next(iter(outputs.values()),{})
        return {'value':value_path(value,path)}
