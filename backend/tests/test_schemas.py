from pydantic import ValidationError
from app.schemas.objects import ClipIn, RegisterIn

def test_password_confirmation():
    try:
        RegisterIn(display_name='Test',email='test@example.com',password='somepassword12',password_confirmation='different')
        assert False
    except ValidationError:
        pass

def test_negative_clip_start_is_rejected():
    try:
        ClipIn(client_id='x',name='c',type='video',start=-1,duration=5)
        assert False
    except ValidationError:
        pass


def test_mixed_layer_accepts_all_clip_types():
    from app.schemas.objects import TrackIn, TimelineIn
    common={'start':0,'duration':5,'source_offset':0,'text':None,'color':'#5bff93'}
    clips=[{'client_id':f'clip-{i}','name':kind,'type':kind,'media_id':None if kind=='text' else 1,**{**common,'start':i*5}} for i,kind in enumerate(('video','audio','image','text'))]
    timeline=TimelineIn(revision=1,tracks=[TrackIn(client_id='layer-1',name='Layer 1',type='mixed',position=0,clips=clips)])
    assert [clip.type for clip in timeline.tracks[0].clips]==['video','audio','image','text']

def test_100_layers_are_permitted():
    from app.schemas.objects import TrackIn, TimelineIn
    layers=[TrackIn(client_id=f'layer-{i}',name=f'Layer {i+1}',type='mixed',position=i) for i in range(100)]
    assert len(TimelineIn(revision=1,tracks=layers).tracks)==100


def test_v24_properties_validation_and_default():
    from app.schemas.objects import ClipIn, TrackIn
    clip=ClipIn(client_id='transform',name='Transform',type='text',start=0,duration=10, props={'x':22.5,'width':50,'rotation':70,'scale':1.25})
    assert clip.props.x==22.5 and clip.props.width==50
    assert clip.props.opacity==1
    layer=TrackIn(client_id='layer',name='Layer',type='mixed',position=0,background_color='#123abc')
    assert layer.background_color=='#123abc'
    try:
        ClipIn(client_id='bad',name='Bad',type='text',start=0,duration=10,props={'scale':0})
        assert False
    except ValidationError:
        pass
