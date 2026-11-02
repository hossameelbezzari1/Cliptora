from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from app.workflows.nodes.extract_audio import ExtractAudioNode


@unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'FFmpeg tools are required')
class ExtractAudioTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.tmp.name)
        cls.source = cls.root / 'Example Video.mkv'
        subprocess.run([
            'ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
            '-f', 'lavfi', '-i', 'color=c=blue:s=160x120:d=2:r=15',
            '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
            '-f', 'lavfi', '-i', 'sine=frequency=660:duration=2',
            '-map', '0:v', '-map', '1:a', '-map', '2:a',
            '-c:v', 'mpeg4', '-c:a', 'pcm_s16le', '-shortest', str(cls.source)
        ], check=True)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def run_node(self, options, node_id='ExtractAudio1'):
        workdir = self.root / '3' / 'runs' / '4'
        workdir.mkdir(parents=True, exist_ok=True)
        return ExtractAudioNode.execute({'id': node_id, 'type': 'audio.extract', 'settings': options}, {}, self.source, workdir)

    def test_default_wav_and_legacy_audio_path(self):
        result = self.run_node({})
        self.assertEqual(result['status'], 'completed')
        self.assertEqual(len(result['audio_files']), 1)
        audio = Path(result['audio'])
        self.assertTrue(audio.is_file())
        self.assertEqual(result['audio_file']['format'], 'wav')
        self.assertEqual(result['audio_file']['sample_rate'], 16000)
        self.assertEqual(result['audio_file']['channels'], 1)
        self.assertTrue(result['audio_file']['url'].startswith('/api/v1/workflows/3/runs/4/audio/'))
        self.assertEqual(result['audio_files'][0]['track'], 0)

    def test_all_tracks(self):
        result = self.run_node({'audio_track': 'all', 'output_format': 'flac'}, node_id='AllTracks')
        self.assertEqual(len(result['audio_files']), 2)
        self.assertEqual([entry['track'] for entry in result['audio_files']], [0, 1])
        self.assertTrue(all(Path(entry['path']).is_file() for entry in result['audio_files']))

    def test_trim(self):
        result = self.run_node({'trim_enabled': True, 'start_seconds': .3, 'end_seconds': 1.2}, node_id='TrimAudio')
        self.assertGreater(result['audio_file']['duration'], .7)
        self.assertLess(result['audio_file']['duration'], 1.2)

    def test_invalid_track(self):
        with self.assertRaisesRegex(ValueError, 'not available'):
            self.run_node({'audio_track': '6'}, node_id='BadTrack')

    def test_copy_preserves_codec(self):
        result = self.run_node({'output_format': 'copy', 'sample_rate': 'auto', 'channels': 'original'}, node_id='CopyTrack')
        self.assertEqual(result['audio_file']['codec'], 'pcm_s16le')
        self.assertTrue(result['audio_file']['filename'].endswith('.mka'))

    def test_copy_rejects_normalization(self):
        with self.assertRaisesRegex(ValueError, 'cannot'):
            self.run_node({'output_format': 'copy', 'normalize': True}, node_id='BadCopy')

    def test_missing_source(self):
        with self.assertRaisesRegex(ValueError, 'requires a selected'):
            ExtractAudioNode.execute({'id': 'ExtractAudio1', 'settings': {}}, {}, None, self.root)

    def test_trim_bounds(self):
        with self.assertRaisesRegex(ValueError, 'Trim range'):
            self.run_node({'trim_enabled': True, 'start_seconds': 1, 'end_seconds': .5}, node_id='BadTrim')

    def test_filename_sanitized(self):
        result = self.run_node({'output_filename': '../../{{video_name}}/ test'}, node_id='SafeName')
        self.assertNotIn('/', result['audio_file']['filename'])
        self.assertEqual(Path(result['audio']).parent.name, 'audio')


if __name__ == '__main__':
    unittest.main()
