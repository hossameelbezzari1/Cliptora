"""Run with PYTHONPATH=backend python -m unittest discover -s backend/tests -p test_transcribe_every_word_v2.py -v"""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from app.workflows.nodes import transcribe_every_word as node_module


class FakeWhisper:
    def __init__(self):
        self.calls = []

    def transcribe(self, audio, **kwargs):
        self.calls.append((audio, kwargs))
        words = [
            SimpleNamespace(start=0.2, end=0.6, word=' Hello', probability=0.97),
            SimpleNamespace(start=0.75, end=1.1, word=' world.', probability=0.85),
        ]
        segments = [SimpleNamespace(text=' Hello world.', words=words)]
        info = SimpleNamespace(language='en', language_probability=0.99, duration=1.3)
        return iter(segments), info


class TranscribeEveryWordTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.workdir = Path(self.temp.name)
        self.audio = self.workdir / 'audio' / 'sample.wav'
        self.audio.parent.mkdir()
        self.audio.write_bytes(b'FAKE AUDIO')
        self.whisper = FakeWhisper()
        self.patch_model = patch.object(node_module, '_model', return_value=self.whisper)
        self.patch_model.start()
        self.node = {'id': 'words', 'type': 'audio.transcribe', 'settings': {}}
        self.outputs = {'extract': {'audio': str(self.audio), 'audio_file': {
            'path': str(self.audio), 'track': 0, 'source_start_seconds': 60.0,
        }, 'audio_files': [{'path': str(self.audio), 'track': 0, 'source_start_seconds': 60.0}]}}

    def tearDown(self):
        self.patch_model.stop()
        self.temp.cleanup()

    def test_word_alignment_and_compatibility(self):
        data = node_module.execute(self.node, self.outputs, None, self.workdir)
        self.assertEqual(data['text'], 'Hello world.')
        self.assertEqual(data['language'], 'en')
        self.assertEqual(data['word_count'], 2)
        self.assertEqual(data['word_count'], len(data['words']))
        self.assertEqual(data['segments'][0]['start_word_id'], 1)
        self.assertEqual(data['segments'][0]['end_word_id'], 2)
        self.assertEqual(data['words'][0]['start'], 60.2)
        self.assertEqual(data['words'][1]['end'], 61.1)
        self.assertEqual(data['words'][0]['confidence'], 0.97)
        self.assertEqual(self.whisper.calls[0][1]['word_timestamps'], True)
        self.assertIsNone(self.whisper.calls[0][1]['language'])

    def test_french_options_and_no_confidence(self):
        self.node['settings'] = {
            'language': 'fr', 'model': 'base', 'beam_size': 2,
            'vad_filter': False, 'vad_min_silence_ms': 700,
            'initial_prompt': 'CLIPTORA', 'include_confidence': False,
        }
        result = node_module.execute(self.node, self.outputs, None, self.workdir)
        kwargs = self.whisper.calls[-1][1]
        self.assertEqual(kwargs['language'], 'fr')
        self.assertEqual(kwargs['beam_size'], 2)
        self.assertFalse(kwargs['vad_filter'])
        self.assertEqual(kwargs['initial_prompt'], 'CLIPTORA')
        self.assertNotIn('confidence', result['words'][0])

    def test_missing_audio(self):
        with self.assertRaisesRegex(ValueError, 'Connect Extract Audio'):
            node_module.execute(self.node, {}, None, self.workdir)

    def test_audio_path_outside_run_is_rejected(self):
        with tempfile.TemporaryDirectory() as external:
            other = Path(external) / 'other.wav'
            other.write_bytes(b'secret')
            self.outputs['extract']['audio_files'][0]['path'] = str(other)
            with self.assertRaisesRegex(ValueError, 'current workflow run'):
                node_module.execute(self.node, self.outputs, None, self.workdir)

    def test_invalid_model_language_beam_and_device(self):
        for settings in [
            {'model': 'some-untrusted-model'},
            {'language': '../x'},
            {'beam_size': 42},
            {'device': 'ssh'},
            {'device': 'cpu', 'compute_type': 'float16'},
        ]:
            self.node['settings'] = settings
            with self.assertRaises(ValueError):
                node_module.execute(self.node, self.outputs, None, self.workdir)

    def test_multiple_audio_tracks(self):
        second = self.workdir / 'audio' / 'other.wav'
        second.write_bytes(b'TRACK TWO')
        self.outputs['extract']['audio_files'].append({'path': str(second), 'track': 1})
        self.node['settings']['audio_track'] = '1'
        result = node_module.execute(self.node, self.outputs, None, self.workdir)
        self.assertEqual(result['audio_track'], 1)
        self.assertEqual(self.whisper.calls[-1][0], str(second))
        self.assertEqual(result['words'][0]['start'], 0.2)

    def test_wrong_audio_track(self):
        self.node['settings']['audio_track'] = '3'
        with self.assertRaisesRegex(ValueError, 'not extracted'):
            node_module.execute(self.node, self.outputs, None, self.workdir)

    def test_metadata_contract(self):
        meta = node_module.TranscribeEveryWordNode.metadata()
        self.assertEqual(meta['label'], 'Transcribe Every Word')
        self.assertEqual(meta['settings']['model'], 'small')
        self.assertEqual(node_module.NODE.type, 'audio.transcribe')


if __name__ == '__main__':
    unittest.main()
