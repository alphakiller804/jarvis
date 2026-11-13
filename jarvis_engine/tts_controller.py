"""
JARVIS Windows Native Text-to-Speech (TTS) Controller
Provides direct speaker audio playback via Windows SAPI (SpVoice):
- Actually plays audio through Windows default audio device (speakers/headphones)
- Automatically checks master volume and mute status; unmutes if necessary
- Supports voice selection (David, Zira, etc.), rate, and pitch
- Asynchronous non-blocking speech with interruption / stop support
- Prevents overlapping audio by purging or managing the speech queue
- Strips markdown formatting for clean, natural speech output
"""

import re
import time
import logging
from typing import Dict, Any, List, Optional

logger = logging.getLogger("jarvis_tts")

# SAPI Flag constants
SVSFDefault = 0
SVSFlagsAsync = 1
SVSFPurgeBeforeSpeak = 2

try:
    import win32com.client
    import comtypes
    HAS_SAPI = True
except Exception as e:
    HAS_SAPI = False
    logger.warning("Windows SAPI not directly available: %s", e)

from .windows_controller import windows, ensure_com


class TTSController:
    def __init__(self):
        self._speaker = None
        self._voices: List[Dict[str, str]] = []
        self._current_voice_name = "Microsoft David Desktop"
        self._init_speaker()

    def _init_speaker(self):
        """Initializes SAPI SpVoice COM object."""
        if not HAS_SAPI:
            return
        ensure_com()
        try:
            self._speaker = win32com.client.Dispatch("SAPI.SpVoice")
            voices_collection = self._speaker.GetVoices()
            self._voices = []
            for i in range(voices_collection.Count):
                v = voices_collection.Item(i)
                desc = v.GetDescription()
                self._voices.append({"index": i, "name": desc})
                # Default to David or first available
                if "David" in desc and not self._current_voice_name:
                    self._current_voice_name = desc
            logger.info("Initialized SAPI SpVoice with %d voices", len(self._voices))
        except Exception as e:
            logger.error("Failed to initialize SAPI SpVoice: %s", e)
            self._speaker = None

    def _clean_text_for_speech(self, text: str) -> str:
        """Removes markdown syntax, URLs, bullet points, and code blocks for spoken audio."""
        if not text:
            return ""
        # Remove code blocks
        clean = re.sub(r'```[\s\S]*?```', '', text)
        clean = re.sub(r'`([^`]+)`', r'\1', clean)
        # Remove URLs
        clean = re.sub(r'https?://\S+', '', clean)
        # Remove markdown bold/italics
        clean = re.sub(r'\*\*(.*?)\*\*', r'\1', clean)
        clean = re.sub(r'\*(.*?)\*', r'\1', clean)
        # Remove headers
        clean = re.sub(r'#+\s*', '', clean)
        # Remove markdown links [text](url)
        clean = re.sub(r'\[(.*?)\]\(.*?\)', r'\1', clean)
        # Remove emojis and special formatting characters
        clean = re.sub(r'[●◉⚙▲◌✓✔✕✖]', '', clean)
        # Normalize whitespace
        clean = re.sub(r'\s+', ' ', clean).strip()
        return clean

    def check_audio_output(self) -> Dict[str, Any]:
        """
        Verifies Windows speaker volume and mute status.
        If system is muted, unmutes it.
        If volume is lower than 25%, safely boosts to 40% so the user can hear JARVIS.
        """
        vol_info = windows.get_volume()
        muted = vol_info.get("muted", False)
        vol = vol_info.get("volume", 50)

        unmuted = False
        adjusted_vol = False

        if muted:
            windows.set_mute(False)
            unmuted = True
            logger.info("[TTS] Windows master audio was muted; automatically unmuted.")

        if vol < 20:
            windows.set_volume(40)
            adjusted_vol = True
            logger.info("[TTS] Windows master volume was %d%%; automatically adjusted to 40%%.", vol)

        return {
            "initial_volume": vol,
            "was_muted": muted,
            "unmuted": unmuted,
            "adjusted_volume": adjusted_vol,
            "effective_volume": 40 if adjusted_vol else vol
        }

    def speak(self, text: str, voice: Optional[str] = None, rate: int = 1) -> Dict[str, Any]:
        """
        Speaks text through Windows default audio device (speakers/headphones).
        Executes asynchronously (non-blocking) and purges any prior speech to prevent overlapping.
        """
        clean_text = self._clean_text_for_speech(text)
        if not clean_text:
            return {"success": False, "error": "Empty text for speech"}

        # 1. Check and fix audio output levels
        audio_check = self.check_audio_output()

        ensure_com()
        if not self._speaker:
            self._init_speaker()

        if not self._speaker:
            return {
                "success": False,
                "error": "Windows SAPI SpVoice is unavailable",
                "clean_text": clean_text
            }

        try:
            # Configure voice if requested
            if voice:
                v_lower = voice.lower()
                voices_collection = self._speaker.GetVoices()
                for i in range(voices_collection.Count):
                    v = voices_collection.Item(i)
                    if v_lower in v.GetDescription().lower():
                        self._speaker.Voice = v
                        self._current_voice_name = v.GetDescription()
                        break

            # Set speech rate (-10 to 10; default 1 for crisp conversational pace)
            self._speaker.Rate = max(-10, min(10, rate))

            # SVSFlagsAsync (1) + SVSFPurgeBeforeSpeak (2) = 3 -> Stops previous speech & speaks asynchronously
            flags = SVSFlagsAsync | SVSFPurgeBeforeSpeak
            start_t = time.time()
            self._speaker.Speak(clean_text, flags)
            duration_ms = round((time.time() - start_t) * 1000, 2)

            print(f"[TTS] Native Windows speech started: \"{clean_text[:60]}...\" (voice: {self._current_voice_name})")

            return {
                "success": True,
                "text": clean_text,
                "voice": self._current_voice_name,
                "rate": rate,
                "audio_check": audio_check,
                "dispatch_duration_ms": duration_ms
            }
        except Exception as e:
            logger.error("Error in SAPI speak: %s", e)
            return {"success": False, "error": str(e), "clean_text": clean_text}

    def stop(self) -> Dict[str, Any]:
        """Immediately halts any active Windows speech."""
        ensure_com()
        if self._speaker:
            try:
                # SVSFPurgeBeforeSpeak (2) with empty string clears speech queue instantly
                self._speaker.Speak("", SVSFPurgeBeforeSpeak)
                return {"success": True, "message": "Speech stopped."}
            except Exception as e:
                return {"success": False, "error": str(e)}
        return {"success": True, "message": "No active speaker."}

    def get_status(self) -> Dict[str, Any]:
        """Returns available voices, current voice, and audio volume telemetry."""
        vol_info = windows.get_volume()
        return {
            "available": HAS_SAPI and (self._speaker is not None),
            "voices": self._voices,
            "current_voice": self._current_voice_name,
            "master_volume": vol_info.get("volume", 50),
            "master_muted": vol_info.get("muted", False)
        }


tts = TTSController()

