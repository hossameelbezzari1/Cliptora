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
