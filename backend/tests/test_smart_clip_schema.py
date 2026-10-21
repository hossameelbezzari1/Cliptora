from app.schemas.objects import ClipProperties


def test_repeat_effects_and_shape_payload():
    payload = {
        'effect_stack': [{'name': 'Gaussian Blur', 'parameters': {'amount': .2}}],
        'animation_stack': [{'name': 'Fade In', 'parameters': {'duration': 1.5}}],
        'repeat': {'mode': 'interval', 'interval': 20, 'until': 'target_end', 'targetId': 'target-a'},
        'shape_kind': 'Circle',
        'follow_target_id': 'target-a'
    }
    item = ClipProperties.model_validate(payload)
    recovered = ClipProperties.model_validate_json(item.model_dump_json())
    assert recovered.repeat['interval'] == 20
    assert recovered.effect_stack[0]['name'] == 'Gaussian Blur'
    assert recovered.shape_kind == 'Circle'
    assert recovered.follow_target_id == 'target-a'
