class TranscriptionProvider:
    """Transcription is executed by the native transcribe_every_word node."""
    def available(self) -> bool:
        try:
            import faster_whisper
            return True
        except ImportError:
            return False
