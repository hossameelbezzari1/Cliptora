import unittest

from app.workflows.source_selection import select_workflow_source_id


class SourceSelectionTests(unittest.TestCase):
    def node(self, kind, value):
        return {'type': kind, 'settings': {'source_id': value}}

    def test_inspect_video_is_used(self):
        self.assertEqual(select_workflow_source_id([self.node('media.probe', 12)]), 12)

    def test_extract_audio_same_selection(self):
        self.assertEqual(select_workflow_source_id([
            self.node('media.probe', 12), self.node('audio.extract', 12)]), 12)

    def test_old_source_video_still_supported(self):
        self.assertEqual(select_workflow_source_id([self.node('core.video_source', 7)]), 7)

    def test_explicit_works_without_settings(self):
        self.assertEqual(select_workflow_source_id([], 19), 19)

    def test_no_video(self):
        self.assertIsNone(select_workflow_source_id([self.node('core.schedule_trigger', None)]))

    def test_conflicting_nodes_rejected(self):
        with self.assertRaisesRegex(ValueError, 'different source'):
            select_workflow_source_id([self.node('media.probe', 12), self.node('audio.extract', 13)])

    def test_conflicting_request_rejected(self):
        with self.assertRaisesRegex(ValueError, 'does not match'):
            select_workflow_source_id([self.node('media.probe', 12)], 13)

    def test_invalid_ids_rejected(self):
        for value in [False, 0, -1, '12', 3.5]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                select_workflow_source_id([self.node('media.probe', value)])

    def test_unrelated_nodes_ignored(self):
        self.assertIsNone(select_workflow_source_id([self.node('core.schedule_trigger', 100)]))


if __name__ == '__main__':
    unittest.main()
