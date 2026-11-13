"""
JARVIS Safety Manager
Enforces security guardrails, confirmation workflows for destructive/system actions,
and provides an emergency stop mechanism.
"""

import os
import secrets
import time
from typing import Dict, Any, Tuple, Optional

# Sensitive or destructive action categories
DANGEROUS_ACTIONS = {
    "shutdown": "Shut down the computer",
    "restart": "Restart the computer",
    "sleep": "Put the computer to sleep",
    "delete_file": "Permanently delete a file",
    "delete_folder": "Permanently delete a directory",
    "format": "Disk format operation",
    "kill_critical_process": "Terminate critical system process"
}

# Protected paths that should never be deleted or altered
PROTECTED_PATHS = [
    os.environ.get("SystemRoot", "C:\\Windows").lower(),
    os.path.join(os.environ.get("SystemRoot", "C:\\Windows"), "System32").lower(),
    os.environ.get("ProgramFiles", "C:\\Program Files").lower(),
    os.environ.get("ProgramFiles(x86)", "C:\\Program Files (x86)").lower(),
]


class SafetyManager:
    def __init__(self):
        # Pending confirmations: token -> { action, params, expires_at }
        self._pending_confirmations: Dict[str, Dict[str, Any]] = {}
        self._pending_power_action: Optional[Dict[str, Any]] = None
        self._emergency_halt = False

    def is_emergency_stopped(self) -> bool:
        return self._emergency_halt

    def trigger_emergency_stop(self) -> Dict[str, Any]:
        """Halts all background automation, active tasks, and clears pending requests."""
        self._emergency_halt = True
        self._pending_confirmations.clear()
        self._pending_power_action = None
        return {
            "status": "EMERGENCY_STOP_ACTIVE",
            "message": "Emergency stop triggered. All autonomous operations suspended."
        }

    def reset_emergency_stop(self) -> Dict[str, Any]:
        self._emergency_halt = False
        return {
            "status": "NORMAL",
            "message": "Emergency stop cleared. JARVIS operations resumed."
        }

    def get_pending_power_action(self) -> Optional[Dict[str, Any]]:
        """Returns currently pending power action (shutdown, restart, sleep) if not expired."""
        if self._pending_power_action:
            if time.time() <= self._pending_power_action.get("expires_at", 0):
                return self._pending_power_action
            self._pending_power_action = None
        return None

    def confirm_latest_action(self) -> Tuple[bool, Optional[str], Optional[Dict[str, Any]]]:
        """
        Consumes and approves the active pending power action when the user says 'confirm' or 'yes'.
        """
        pending = self.get_pending_power_action()
        if pending:
            self._pending_power_action = None
            self._pending_confirmations.clear()
            return True, pending["action"], pending["params"]
        return False, None, None

    def cancel_pending_action(self) -> Dict[str, Any]:
        """Cancels any pending confirmation request."""
        was_pending = self._pending_power_action is not None or len(self._pending_confirmations) > 0
        self._pending_power_action = None
        self._pending_confirmations.clear()
        return {"cancelled": was_pending, "message": "Pending confirmation cancelled."}

    def check_safety(self, action: str, params: Dict[str, Any]) -> Tuple[bool, Optional[str], Optional[str]]:
        """
        Validates whether an action is safe to execute immediately.
        Returns: (is_allowed, confirmation_token, rejection_or_prompt_reason)
        """
        if self._emergency_halt and action != "reset_emergency":
            return False, None, "JARVIS is currently in EMERGENCY STOP state. Say 'resume operations' or click reset to continue."

        # Check path protection for file operations
        if action in ("delete_file", "delete_folder", "remove"):
            target_path = os.path.abspath(params.get("path", "")).lower()
            for protected in PROTECTED_PATHS:
                if target_path.startswith(protected):
                    return False, None, f"Access Denied: Protected system path '{target_path}' cannot be modified."

        # If action is dangerous, verify confirmation or token
        if action in DANGEROUS_ACTIONS:
            # If explicit confirmation flag is passed
            if params.get("confirmed") is True or params.get("is_confirmed") is True:
                self._pending_power_action = None
                return True, None, None

            provided_token = params.get("confirm_token")
            if provided_token and provided_token in self._pending_confirmations:
                pending = self._pending_confirmations[provided_token]
                if time.time() <= pending["expires_at"]:
                    del self._pending_confirmations[provided_token]
                    self._pending_power_action = None
                    return True, None, None
                else:
                    del self._pending_confirmations[provided_token]
                    return False, None, "Confirmation token has expired. Please repeat the request."

            # Generate new confirmation request and store in state
            token = secrets.token_hex(4).upper()
            pending_record = {
                "action": action,
                "params": params,
                "token": token,
                "expires_at": time.time() + 60.0  # 60s timeout
            }
            self._pending_confirmations[token] = pending_record
            self._pending_power_action = pending_record

            desc = DANGEROUS_ACTIONS[action]
            prompt = f"Confirmation required to {desc}, Sir. Please say 'confirm shutdown' to proceed, or 'cancel'."
            return False, token, prompt

        return True, None, None

    def approve_token(self, token: str) -> Optional[Dict[str, Any]]:
        """Validates and retrieves the pending action for a token."""
        token = token.strip().upper()
        if token in self._pending_confirmations:
            pending = self._pending_confirmations[token]
            if time.time() <= pending["expires_at"]:
                del self._pending_confirmations[token]
                return pending
            del self._pending_confirmations[token]
        return None

    def list_pending(self) -> Dict[str, Any]:
        now = time.time()
        # Clean expired
        expired = [k for k, v in self._pending_confirmations.items() if now > v["expires_at"]]
        for k in expired:
            del self._pending_confirmations[k]
        return self._pending_confirmations


safety = SafetyManager()

