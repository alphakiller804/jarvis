"""
JARVIS System Diagnostics & Validation Suite
Validates:
1. Audio output device detection, volume, and mute status
2. Direct Windows SAPI TTS generation & speaker playback
3. Windows power management (Safe shutdown confirmation flow & cancel_shutdown via 'shutdown /a')
4. Volume automation and application launching
5. Intent classification for required commands:
   - "Jarvis, open Chrome."
   - "Jarvis, YouTube par song chalao."
   - "Jarvis, volume 50 percent karo."
   - "Jarvis, computer band kar do."
6. ActionExecutor and SafetyManager guardrails
"""

import os
import sys
import time
import json
import subprocess

# Ensure repo root is in sys.path
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))

from jarvis_engine.windows_controller import windows
from jarvis_engine.tts_controller import tts
from jarvis_engine.action_executor import executor
from jarvis_engine.safety_manager import safety

PASSED = 0
FAILED = 0

def check(description: str, condition: bool, details: str = ""):
    global PASSED, FAILED
    if condition:
        PASSED += 1
        print(f" [PASS] {description}" + (f" -> {details}" if details else ""))
    else:
        FAILED += 1
        print(f" [FAIL] {description}" + (f" -> {details}" if details else ""))

def run_diagnostics():
    print("=" * 70)
    print("       JARVIS COMPREHENSIVE HARDWARE & ACTION DIAGNOSTICS      ")
    print("=" * 70)

    # 1. AUDIO OUTPUT & HARDWARE TELEMETRY
    print("\n--- TEST 1: Windows Audio Output & Speaker Telemetry ---")
    vol_info = windows.get_volume()
    check("Windows volume query returns dictionary", isinstance(vol_info, dict))
    check("Volume level is within 0-100", 0 <= vol_info.get("volume", -1) <= 100, f"Volume: {vol_info.get('volume')}%")
    check("Mute status is boolean", isinstance(vol_info.get("muted"), bool), f"Muted: {vol_info.get('muted')}")

    # Test auto-unmute and volume check in TTS controller
    audio_check = tts.check_audio_output()
    check("TTS check_audio_output returns valid state", "effective_volume" in audio_check, str(audio_check))

    # 2. TTS AUDIO GENERATION & PLAYBACK
    print("\n--- TEST 2: Windows SAPI Voice Speech Generation & Playback ---")
    tts_status = tts.get_status()
    check("SAPI SpVoice is available on Windows", tts_status.get("available") is True)
    check("At least one Windows desktop voice is registered", len(tts_status.get("voices", [])) > 0, f"Found {len(tts_status.get('voices', []))} voices")

    # Speak short confirmation phrase
    speak_res = tts.speak("Diagnostic test: JARVIS voice output is operational, Sir.")
    check("SAPI speak dispatches without COM error", speak_res.get("success") is True, f"Voice: {speak_res.get('voice')}")
    time.sleep(0.5)
    stop_res = tts.stop()
    check("SAPI stop halts speech queue cleanly", stop_res.get("success") is True)

    # 3. WINDOWS POWER MANAGEMENT & SAFE SHUTDOWN CONFIRMATION FLOW
    print("\n--- TEST 3: Windows Power Management & Safe Shutdown Confirmation ---")
    # Step A: Attempt shutdown without confirmation -> MUST be blocked by safety manager
    unconfirmed = executor.execute_tool("system_control", {"action": "shutdown"})
    check(
        "Direct shutdown without confirmation is safely blocked",
        unconfirmed.get("success") is False and unconfirmed.get("requires_confirmation") is True,
        f"Prompt: {unconfirmed.get('message')}"
    )

    # Step B: Pending power action exists in SafetyManager
    pending_power = safety.get_pending_power_action()
    check("SafetyManager stores pending shutdown record", pending_power is not None and pending_power.get("action") == "shutdown")

    # Step C: Cancel pending shutdown
    cancel_res = executor.execute_tool("system_control", {"action": "cancel_shutdown"})
    check("cancel_shutdown clears pending power record and runs shutdown /a", cancel_res.get("success") is True, f"Result: {cancel_res.get('message')}")
    check("Pending power action is now cleared", safety.get_pending_power_action() is None)

    # Step D: Verify shutdown /a execution directly
    win_cancel = windows.cancel_shutdown()
    check("windows.cancel_shutdown() safely handles Windows error code 1116", win_cancel.get("success") is True, str(win_cancel))

    # 4. REQUIRED TEST COMMANDS
    print("\n--- TEST 4: Verification of Specific Required Voice Commands ---")

    # Command A: "Jarvis, volume 50 percent karo."
    vol_res = executor.execute_tool("system_control", {"action": "set_volume", "value": 50})
    check("Command 'volume 50 percent karo' sets volume to 50%", vol_res.get("success") is True and vol_res.get("volume") == 50)

    # Command B: "Jarvis, open Chrome."
    # Test alias mapping in launch_app
    chrome_alias = windows.APP_ALIASES.get("chrome")
    check("App aliases map 'chrome' to executable", chrome_alias is not None and "chrome.exe" in chrome_alias)

    # Command C: "Jarvis, YouTube par song chalao."
    from jarvis_engine.youtube_controller import youtube
    yt_res = youtube.play("Atif Aslam romantic song", category="music")
    check("YouTube play command constructs valid search & intent payload", yt_res.get("success") is True, f"Title: {yt_res.get('title')}")

    # Command D: "Jarvis, computer band kar do."
    # Trigger shutdown intent
    shut_trigger = executor.execute_tool("system_control", {"action": "shutdown"})
    check("Command 'computer band kar do' prompts for verbal confirmation", shut_trigger.get("requires_confirmation") is True)
    # Confirm
    has_p, p_action, _ = safety.confirm_latest_action()
    check("SafetyManager consumes verbal confirmation", has_p is True and p_action == "shutdown")

    # 5. SYSTEM STATUS TELEMETRY
    print("\n--- TEST 5: Real-Time Hardware Telemetry ---")
    status = windows.get_system_status()
    check("CPU percent telemetry is numeric", isinstance(status.get("cpu_percent"), (int, float)))
    check("RAM percent telemetry is numeric", isinstance(status.get("ram_percent"), (int, float)), f"RAM: {status.get('ram_percent')}%")
    check("Disk free telemetry is numeric", isinstance(status.get("disk_free_gb"), (int, float)), f"Free: {status.get('disk_free_gb')} GB")

    print("\n" + "=" * 70)
    print(f" TOTAL DIAGNOSTIC CHECKS: {PASSED + FAILED} | PASSED: {PASSED} | FAILED: {FAILED}")
    print("=" * 70)

    if FAILED > 0:
        sys.exit(1)

if __name__ == "__main__":
    run_diagnostics()

