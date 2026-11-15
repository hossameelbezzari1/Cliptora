import tempfile
import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))

from app.workflows.ClipVoiceoverBatch import _text
from app.workflows.nodes.VideoRemix import VideoRemixNode, _cut_plan


def manifest():
    return {
        'version': 1,
        'groups': [{
            'group_id': 'group_0001',
            'label': 'A',
            'selected_text': 'one two three four',
            'clips': [{
                'clip_id': 'a', 'original_clip_id': 'a', 'instance_id': 'a',
                'source_start': 0.0, 'source_end': 4.0, 'duration': 4.0,
                'order': 0, 'transforms': {},
            }],
        }],
    }


class ClipVoiceoverTests(unittest.TestCase):
    def test_split_assigns_word_timed_text_to_each_clip(self):
        words = [
            {'start': 0.0, 'end': 0.8, 'text': 'one'},
            {'start': 1.0, 'end': 1.8, 'text': 'two'},
            {'start': 2.0, 'end': 2.8, 'text': 'three'},
            {'start': 3.0, 'end': 3.8, 'text': 'four'},
        ]
        result = VideoRemixNode().execute_operation(
            'video.remix_split',
            {'settings': {'input_path': 'cut.clip_manifest', 'min_seconds': 2, 'max_seconds': 2}},
            {'cut': {'clip_manifest': manifest()}, 'transcript': {'words': words}},
            None, Path('.'),
        )

        clips = result['clip_manifest']['groups'][0]['clips']
        self.assertEqual([clip['selected_text'] for clip in clips], ['one two', 'three four'])
        self.assertEqual([clip['instance_id'] for clip in clips], ['a_s001', 'a_s002'])

    def test_multi_clip_group_without_clip_text_does_not_reuse_whole_group_text(self):
        group = {'selected_text': 'whole group', 'clips': [{}, {}]}
        self.assertEqual(_text(group, group['clips'][0]), '')

    def test_cut_plan_keeps_voiceover_mapping_and_timeline(self):
        value = manifest()
        clip = value['groups'][0]['clips'][0]
        clip['selected_text'] = 'hello'
        clip['voiceover_status'] = 'generated'
        clip['voiceover'] = {'path': 'A1.mp3', 'url': '/audio/A1'}

        plan = _cut_plan(value)

        self.assertEqual(plan[0]['timeline_start'], 0)
        self.assertEqual(plan[0]['selected_text'], 'hello')
        self.assertEqual(plan[0]['voiceover']['path'], 'A1.mp3')

    def test_render_requires_audio_only_for_clips_that_have_text(self):
        value = manifest()
        value['groups'][0]['clips'][0]['selected_text'] = 'needs audio'
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / 'source.mp4'
            source.write_bytes(b'x')
            with self.assertRaisesRegex(ValueError, 'clips with text have no voice-over'):
                VideoRemixNode._render(
                    value,
                    {'require_clip_voiceovers': True},
                    source,
                    Path(folder),
                )


if __name__ == '__main__':
    unittest.main()
