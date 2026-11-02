"""Catalog's icon source is the Node class, not a parallel frontend catalog."""
from app.workflows.Catalog import tool_catalog
from app.workflows.Registry import node_metadata


def test_every_node_has_icon_metadata():
    catalog = tool_catalog()
    assert len(catalog) >= 20
    seen = set()
    for item in catalog:
        assert item['type'] not in seen
        seen.add(item['type'])
        for prop in ('icon', 'family_icon', 'operation_icon'):
            assert item[prop].startswith(('brand:', 'lucide:'))
        assert item['icon'] == item['operation_icon']
        for action in item.get('actions', []):
            assert action['icon'].startswith(('brand:', 'lucide:'))


def test_gemini_has_all_individual_action_icons():
    item = next(x for x in tool_catalog() if x['type'] == 'ai.gemini')
    assert item['family_icon'] == 'brand:gemini'
    assert len(item['actions']) == 15
    assert len({action['id'] for action in item['actions']}) == 15
    assert next(a for a in item['actions'] if a['id'] == 'analyze_video')['icon'] == 'lucide:video'
    assert item['settings']['action'] == 'message_model'


def test_legacy_persisted_types_unchanged():
    data = node_metadata()
    assert 'ai.gemini' in data
    assert 'core.video_source' in data
    assert 'audio.extract' in data
    assert 'audio.transcribe' in data
