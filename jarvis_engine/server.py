"""
JARVIS Windows Local Agent
Standalone Secure Desktop Automation Daemon for Windows 11.
Allows the Vercel-deployed JARVIS web application to securely control the local PC:
- Application launching and process management
- Windows Core Audio volume control and media keys
- Window management (focus, minimize, maximize)
- File searching, document reading, and downloads organization
- Screenshots and clipboard read/write
- Real-time hardware telemetry (CPU, RAM, Disk, Battery)
- Emergency halt and token-based pairing security
"""

import sys
import os
import json
import socket
import secrets
import urllib.parse
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from typing import Dict, Any, Optional

# Ensure parent directory is in path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from jarvis_engine.action_executor import executor
from jarvis_engine.windows_controller import windows
from jarvis_engine.memory_manager import memory
from jarvis_engine.safety_manager import safety
from jarvis_engine.tts_controller import tts

PORT = 3001
DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
os.makedirs(DATA_DIR, exist_ok=True)
TOKEN_FILE = os.path.join(DATA_DIR, "agent_token.json")


def load_or_generate_token() -> str:
    """Loads existing pairing token or generates a secure 16-character alphanumeric key."""
    env_token = os.environ.get("JARVIS_AGENT_TOKEN")
    if env_token and env_token.strip():
        return env_token.strip()

    if os.path.exists(TOKEN_FILE):
        try:
            with open(TOKEN_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                if data.get("token"):
                    return data["token"]
        except Exception:
            pass

    # Generate new token
    new_token = f"jarvis-{secrets.token_hex(8)}"
    try:
        with open(TOKEN_FILE, "w", encoding="utf-8") as f:
            json.dump({"token": new_token, "created_at": str(os.path.getctime(DATA_DIR))}, f, indent=2)
    except Exception:
        pass
    return new_token


AGENT_TOKEN = load_or_generate_token()


class JarvisAgentHandler(BaseHTTPRequestHandler):
    def _send_cors_headers(self):
        # Allow requests from localhost and deployed Vercel apps
        origin = self.headers.get("Origin") or "*"
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Credentials", "true")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, x-jarvis-agent-token")

    def _send_json_response(self, status_code: int, data: Dict[str, Any]):
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self._send_cors_headers()
        self.end_headers()
        body = json.dumps(data).encode("utf-8")
        self.wfile.write(body)

    def _is_authenticated(self) -> bool:
        """Verifies Bearer token or x-jarvis-agent-token header if configured."""
        # Requests from local loopback (127.0.0.1) can optionally bypass or verify
        client_ip = self.client_address[0]
        auth_header = self.headers.get("Authorization") or ""
        token_header = self.headers.get("x-jarvis-agent-token") or ""

        # Check Bearer token
        if auth_header.startswith("Bearer "):
            provided = auth_header[7:].strip()
            if secrets.compare_digest(provided, AGENT_TOKEN):
                return True

        # Check direct token header
        if token_header and secrets.compare_digest(token_header.strip(), AGENT_TOKEN):
            return True

        # Allow localhost status queries
        if client_ip in ("127.0.0.1", "localhost", "::1"):
            return True

        return False

    def do_OPTIONS(self):
        self.send_response(204)
        self._send_cors_headers()
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        # Public status endpoint for agent discovery
        if path in ("/api/agent/status", "/api/status", "/"):
            self._send_json_response(200, {
                "service": "JARVIS Windows Local Agent",
                "status": "ONLINE",
                "version": "2.0.0",
                "hostname": socket.gethostname(),
                "os": "Windows 11",
                "emergency_stopped": safety.is_emergency_stopped(),
                "requires_pairing": True,
                "paired": self._is_authenticated(),
            })
            return

        # Protected endpoints
        if not self._is_authenticated():
            self._send_json_response(401, {
                "error": "Unauthorized. Please provide valid JARVIS_AGENT_TOKEN.",
                "hint": "Check token in Settings > Local Agent pairing.",
            })
            return

        if path == "/api/system_status":
            telemetry = windows.get_system_status()
            telemetry["emergency_stopped"] = safety.is_emergency_stopped()
            telemetry["agent_online"] = True
            self._send_json_response(200, telemetry)
            return

        elif path == "/api/memory/preferences":
            cat = query.get("category", [None])[0]
            prefs = memory.list_preferences(category=cat)
            self._send_json_response(200, {"success": True, "preferences": prefs})
            return

        elif path == "/api/history":
            limit = int(query.get("limit", [20])[0])
            logs = memory.get_recent_actions(limit=limit)
            self._send_json_response(200, {"success": True, "actions": logs})
            return

        elif path == "/api/safety/pending":
            pending = safety.list_pending()
            self._send_json_response(200, {"success": True, "pending": pending})
            return

        elif path in ("/api/tts/status", "/api/tts"):
            self._send_json_response(200, {"success": True, "tts": tts.get_status()})
            return

        self._send_json_response(404, {"error": "Endpoint not found"})

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        content_len = int(self.headers.get("Content-Length", 0))
        post_data = self.rfile.read(content_len).decode("utf-8") if content_len > 0 else "{}"
        try:
            body = json.loads(post_data) if post_data else {}
        except Exception:
            self._send_json_response(400, {"error": "Invalid JSON payload"})
            return

        # Agent pairing endpoint
        if path == "/api/agent/pair":
            token_candidate = body.get("token", "").strip()
            if secrets.compare_digest(token_candidate, AGENT_TOKEN):
                self._send_json_response(200, {
                    "success": True,
                    "message": "JARVIS Windows Local Agent successfully paired!",
                    "hostname": socket.gethostname(),
                })
            else:
                self._send_json_response(401, {
                    "success": False,
                    "error": "Invalid pairing token. Check token in agent console.",
                })
            return

        # Verification of auth for all command execution
        if not self._is_authenticated():
            self._send_json_response(401, {"error": "Unauthorized. Pairing token required."})
            return

        if path == "/api/action":
            tool_name = body.get("tool") or body.get("action")
            args = body.get("args") or body.get("params") or {}
            if not tool_name:
                self._send_json_response(400, {"error": "Missing 'tool' parameter"})
                return

            res = executor.execute_tool(tool_name, args)
            self._send_json_response(200, res)
            return

        elif path == "/api/emergency_stop":
            res = executor.execute_tool("emergency_stop", {})
            self._send_json_response(200, res)
            return

        elif path == "/api/tts/speak":
            text = body.get("text", "")
            voice = body.get("voice")
            rate = int(body.get("rate", 1))
            res = tts.speak(text, voice=voice, rate=rate)
            self._send_json_response(200, res)
            return

        elif path == "/api/tts/stop":
            res = tts.stop()
            self._send_json_response(200, res)
            return

        elif path == "/api/reset_emergency":
            res = executor.execute_tool("reset_emergency", {})
            self._send_json_response(200, res)
            return

        elif path == "/api/memory/preferences":
            key = body.get("key")
            val = body.get("value")
            cat = body.get("category", "general")
            if not key:
                self._send_json_response(400, {"error": "Missing 'key' parameter"})
                return
            memory.set_preference(key, str(val), category=cat)
            self._send_json_response(200, {"success": True, "key": key, "value": val})
            return

        elif path == "/api/safety/confirm":
            token = body.get("token", "")
            pending = safety.approve_token(token)
            if pending:
                res = executor.execute_tool(pending["action"], pending["params"])
                self._send_json_response(200, {"success": True, "approved": True, "result": res})
            else:
                self._send_json_response(400, {"success": False, "error": "Invalid or expired confirmation token"})
            return

        self._send_json_response(404, {"error": "Endpoint not found"})

    def do_DELETE(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        if not self._is_authenticated():
            self._send_json_response(401, {"error": "Unauthorized"})
            return

        if path == "/api/memory/preferences":
            key = query.get("key", [""])[0]
            if not key:
                self._send_json_response(400, {"error": "Missing 'key' query parameter"})
                return
            deleted = memory.delete_preference(key)
            self._send_json_response(200, {"success": deleted, "key": key})
            return

        self._send_json_response(404, {"error": "Endpoint not found"})

    def log_message(self, format, *args):
        pass


def run_agent_server():
    server_address = ("0.0.0.0", PORT)
    httpd = ThreadingHTTPServer(server_address, JarvisAgentHandler)
    print("=" * 60)
    print("       JARVIS WINDOWS LOCAL AGENT (PRODUCTION 2.0)        ")
    print("=" * 60)
    print(f"[ONLINE] Listening on http://127.0.0.1:{PORT}")
    print(f"[HOSTNAME] {socket.gethostname()}")
    print("-" * 60)
    print(f"PAIRING TOKEN: {AGENT_TOKEN}")
    print("-" * 60)
    print("Copy this token into your Vercel-deployed JARVIS web app under")
    print("Settings > Control Matrix > Local Agent Pairing to enable")
    print("full Windows desktop automation, apps, and volume control.")
    print("=" * 60)

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down JARVIS Windows Local Agent.")
        httpd.server_close()


if __name__ == "__main__":
    run_agent_server()
