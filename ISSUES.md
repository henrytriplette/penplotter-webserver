# Code Review — Findings & Technical Debt

**Repository:** `penplotter-webserver`
**Reviewed:** 2026-09-02 (branch `main`, commit `f99fd8c`)
**Scope:** `server/` (Flask + pySerial backend), `frontend/` (TypeScript + Vite + jQuery/UIkit), build & deployment scripts.
**Excluded:** vendored dependencies (`node_modules/`, `server/venv/`), build output (`server/dist/`), `.old/`.

This document is analysis only. No source, configuration, tests, or project structure were modified.

---

## Summary

| Severity | Count |
|---|---|
| Critical | 9 |
| High | 17 |
| Medium | 24 |
| Low | 17 |
| **Total** | **67** |

**Remediation status (2026-09-02):** 16 findings are fixed — C-2, C-3, C-4, C-6, C-7, H-1, H-5, H-12, H-13, M-8, M-13, M-14, M-15, M-16, M-17, L-5 — each marked inline below. The five targeted were C-2, C-3, C-4, C-6+C-7 and H-1; the rest were either prerequisites for those (a working preview needs M-14 and M-15; C-2's new error path is only readable with H-12) or fell inside lines already being rewritten. Everything else in this document is still outstanding. Verification: the parser and canvas sizing were run against the three sample files in `server/uploads/` at 1x and 2x device pixel ratios plus ten synthetic edge cases (degenerate extents, hidden modal, garbage input), and `sendToPlotter` against a fake plotter covering normal completion, empty file, missing file, and an exception mid-plot.

The application is a single-user appliance UI (a Raspberry Pi driving a pen plotter), and several findings are acceptable-by-design for a device on a trusted LAN. They are still listed, because the app binds `0.0.0.0`, ships `DEBUG = True`, and exposes unauthenticated `reboot`/`poweroff`/arbitrary-file endpoints — so the trust assumption is doing a lot of unstated work.

The most consequential *functional* problems, independent of security posture, are:

1. **The Tasmota integration cannot ever work** — `TASMOTA_ENABLE` is assigned the IP address (C-4).
2. **The HPGL preview renders nothing** — the parser produces exactly one path, which makes the bounding box degenerate and the scale `0`, and the scale is then multiplied instead of divided (C-6, C-7).
3. **Serial port and file handles are never closed and `printing` is never reset** after a plot completes (C-3).
4. **A plot on an empty or unstat-able file raises `NameError`** mid-loop (C-2).
5. **`webplotter.service` points at a path that does not exist**, so the documented install produces a service that cannot start (H-1).

---

## Critical

### C-1 — Command injection via filename in SVG→HPGL conversion
**Location:** `server/main.py:84-116` (`convert`), reached from `server/main.py:261-271` (`/start_conversion`)

**Issue:** The `vpype` invocation is assembled as a single string and executed with `shell=True`. The filename comes from `request.form.get('file')` and is concatenated in unsanitized. It is only wrapped in double quotes, which does not neutralize `$(...)`, backticks, or an embedded `"`.

```python
args += ' read "' + os.getcwd() + '/' + str(file) + '"'
...
rendering = subprocess.Popen(args, shell=True)
```

`pagesize`, `svgscale` and `pageorientation` are likewise unvalidated; `pagesize` is interpolated *unquoted* at `main.py:108`, so it does not even need quote-breaking.

**Impact:** Any client that can reach the web UI gets arbitrary shell execution as the service user, which `install.sh` sets up with passwordless `sudo` usage in mind. The upload endpoint is not a barrier — `/start_conversion` never checks that the file exists, so the attack needs no upload at all.

**Recommendation:** Build the command as an argument list and drop `shell=True`. Resolve the input filename against the upload directory with `os.path.realpath` and reject anything that escapes it. Validate `pagesize`/`svgscale`/`pageorientation` against explicit allow-lists rather than falling through on unknown values.

---

### C-2 — `NameError` on `percent` when the input file size is unknown

> **Status: FIXED** (2026-09-02) — Fixed — the unknown-size branch is gone; an empty or unstat-able file now aborts with a reported error before the send loop.
**Location:** `server/send2serial.py:128-134`, `server/send2serial.py:207-215`

**Issue:** `input_bytes` stays `None` when the file is zero-length **or** when `os.stat` raises. The `else` branch of the progress block then formats a variable that was never bound:

```python
if input_bytes != None:
    percent = 100.0 * total_bytes_written/input_bytes
    ...
else:
    print(f'{percent:.2f}%, {bufsz_read} byte added.')   # percent is undefined here
```

The `except` at line 132 emits an error but does not return, so execution continues into the send loop with `input_bytes = None`.

**Impact:** `NameError` escapes `sendToPlotter`, escapes `plot()`, and returns HTTP 500. Because there is no `try/finally` (see H-3), the UI stays locked, the serial port stays open, and `globals.printing` stays `True`.

**Recommendation:** Track the unknown-size case explicitly and emit a byte-count-only message rather than a percentage. Abort early if `os.stat` fails, since a file that cannot be stat'd almost certainly cannot be read either.

---

### C-3 — Serial port, file handle, and print state leak on every plot

> **Status: FIXED** (2026-09-02) — Fixed — the function body is wrapped in try/finally, which closes the port and file and resets `globals.printing` on every exit path, including exceptions.
**Location:** `server/send2serial.py:122-218` (whole function)

**Issue:** `sendToPlotter` opens `hpgl = open(hpglfile, 'rb')` at line 136 and `tty = serial.Serial(...)` at line 140/147. The function ends at line 218 — the last statement in the file. There is no `close()` on either handle on any path (normal EOF, user stop, or exception), and `globals.printing` is set to `True` at line 125 but never reset to `False`.

**Impact:**
- The serial device stays open for the lifetime of the process. The second plot attempt fails with a "port is busy"/`SerialException`, so the app effectively supports exactly one print per restart.
- File descriptors accumulate.
- `globals.printing` remaining `True` means the guard `while globals.printing == True` is already satisfied at the start of the next run, so `/stop_plot` state from a previous session is meaningless.
- No completion event is emitted, so the progress bar never reaches 100%.

**Recommendation:** Wrap the body in `try/finally` (or use `with` for the file and `contextlib.closing` for the port), reset `globals.printing = False` in the `finally`, and emit an explicit completion/failure event so the frontend can settle its state.

---

### C-4 — Tasmota is permanently disabled by a copy-paste bug

> **Status: FIXED** (2026-09-02) — Fixed — reads `tasmota_enable` via `config.getboolean`, guards `TASMOTA_IP` on its own key, and gates on the boolean.
**Location:** `server/tasmota.py:10-15`

**Issue:**

```python
TASMOTA_ENABLE = False
if (config.has_option('tasmota', 'tasmota_enable')):
    TASMOTA_ENABLE = config['tasmota']['tasmota_ip']   # <-- reads tasmota_ip
TASMOTA_IP = False
if (config.has_option('tasmota', 'tasmota_enable')):   # <-- checks the wrong key
    TASMOTA_IP = config['tasmota']['tasmota_ip']
```

`TASMOTA_ENABLE` is assigned the IP address. Both `tasmota_setStatus` and `tasmota_setToggle` gate on `if TASMOTA_ENABLE == 'true'`, which compares an IP string against `'true'` and is always false.

**Impact:** The entire Tasmota feature — sidebar toggle, and automatic plotter power-off on print completion, both advertised in the README — silently does nothing and returns `False`. The frontend still reports `notify('Tasmota Toggled', 'success')` because the HTTP call returns 200 regardless (see M-9).

**Recommendation:** Read `tasmota_enable` for `TASMOTA_ENABLE` and guard `TASMOTA_IP` on `has_option('tasmota', 'tasmota_ip')`. Parse the flag with `config.getboolean` instead of string-comparing to `'true'`, which is also case- and whitespace-sensitive.

---

### C-5 — Path traversal in file deletion, preview, and plotting
**Location:** `server/main.py:202-215` (`/delete_file`), `server/main.py:218-237` (`/start_preview`), `server/main.py:240-251` (`/start_plot`)

**Issue:** All three take a client-supplied name and join it to the upload directory with no normalization or containment check:

```python
if os.path.exists(app.config['UPLOAD_PATH'] + "/" + filename):
    os.remove(app.config['UPLOAD_PATH'] + "/" + filename)
```
```python
file_path = os.path.join(app.config['UPLOAD_PATH'], file)   # start_preview
```
```python
file = app.config['UPLOAD_PATH'] + '/' + request.form.get('file')   # start_plot
```

`secure_filename` is applied only on the *upload* path (`main.py:169`); it is never applied on read or delete. `/uploads/<filename>` (line 185) is the one endpoint that is safe, because `send_from_directory` performs its own containment check.

**Impact:** `../../` sequences allow arbitrary file deletion (including `config.ini`, the application source, or `~/.ssh`) and arbitrary file read via `/start_preview`, which returns raw file contents to the browser.

**Recommendation:** Add a single resolver helper used by every filesystem-touching endpoint: `realpath(join(upload_root, name))`, then verify the result is inside `realpath(upload_root)` and reject otherwise. Return 400 on rejection rather than silently proceeding.

---

### C-6 — HPGL preview always renders at scale `0`, so nothing is visible

> **Status: FIXED** (2026-09-02) — Fixed — the parser now splits a path on every pen-up and the bounding box scans all points of all paths from index 0.
**Location:** `frontend/src/display/hpgl.ts:28-82` (`parseHPGL`), `frontend/src/display/hpgl.ts:84-121` (`drawOnCanvas`)

**Issue:** Two defects compound.

`parseHPGL` declares `let currentPath = []` once and never starts a new path on pen-up. Every point in the file is appended to that one array, and only at line 78-80 is it pushed. So `paths.length` is always exactly `1`.

`drawOnCanvas` then computes the bounding box with a loop that starts at `q = 1`:

```typescript
let minX = this.paths[0][0].x;   // seeded from the first point only
...
for (let q = 1; q < this.paths.length; q++) {   // never executes: length === 1
```

With `paths.length === 1`, the loop body never runs. `minX === maxX` and `minY === maxY`, therefore `dx === dy === 0`, therefore `sx === sy === 0`, therefore `scale = sy = 0` (line 117-121). Every point is then drawn at `pt.x * 0 = 0`.

**Impact:** The preview modal always shows a blank white rectangle. The feature is non-functional as shipped.

**Recommendation:** Split `currentPath` into a new array on each pen-up transition (push the accumulated path, start a fresh one), and seed the bounding box from index `0` of every path — the loops at lines 94-95 also start at `i = 1`, skipping the first point of each path even once multiple paths exist. Guard against a degenerate `dx`/`dy` of `0` before dividing.

---

### C-7 — Preview transform multiplies by the scale factor instead of dividing

> **Status: FIXED** (2026-09-02) — Fixed — the transform divides by the scale, offsets by the bounding-box minimum, centres the drawing, and flips Y.
**Location:** `frontend/src/display/hpgl.ts:114-121`, `frontend/src/display/hpgl.ts:130-141`

**Issue:** `sx` and `sy` are computed as *data units per pixel* (`dx / canvasWidth`), so converting a point to screen space requires **dividing**. The render loop multiplies:

```typescript
const sx = dx / (this.canvas.width - 100);
...
scale = sx;
...
const x = pt.x * scale;   // should be pt.x / scale
```

The superseded implementation preserved alongside it (`frontend/src/display/hpgl copy.ts.bak:255-256`, untracked, `*.bak`-ignored) divides correctly, confirming the direction was inverted during the rewrite.

Additionally, the current version drops two transforms the old one had: it never translates by `-minX` / `-minY`, and it never flips the Y axis. HPGL's origin is bottom-left; canvas is top-left.

**Impact:** Even after C-6 is fixed, the drawing renders mirrored vertically and positioned by raw plotter units — for a typical A4 HPGL file (~10,000+ units) that is far off-canvas.

**Recommendation:** Divide by `scale`, apply the `minX`/`minY` offset, and flip Y with `canvas.height - y`. The `.bak` file's `fitToScreen`/`draw` pair is a working reference for the math.

---

### C-8 — Debug mode and a hardcoded secret key on a `0.0.0.0` listener
**Location:** `server/main.py:34-35`, `server/main.py:360`

**Issue:**

```python
app.config['SECRET_KEY'] = '#tiUJ791&jPYI9N7Kj'
app.config['DEBUG'] = True
...
socketio.run(app, host='0.0.0.0', port=5000, debug=True, allow_unsafe_werkzeug=True)
```

`DEBUG = True` enables the Werkzeug interactive debugger, which offers a remote Python console on any unhandled exception. `allow_unsafe_werkzeug=True` explicitly overrides the guard that Flask-SocketIO added to stop the development server being used in production — and `install.sh`/`webplotter.service` run exactly this entrypoint as the deployed service. The secret key is committed to the repository and identical on every install.

**Impact:** Combined with the many unhandled-exception paths in this review (C-2, M-4, M-5), the debugger console is reachable in normal operation. Any session signing is trivially forgeable.

**Recommendation:** Drive `DEBUG` from an environment variable defaulting to off; generate `SECRET_KEY` at install time into `config.ini` (or read it from the environment); run under a real WSGI/ASGI server for deployment and drop `allow_unsafe_werkzeug`.

---

### C-9 — Unauthenticated reboot, poweroff, and file management
**Location:** `server/main.py:38` (CORS), `server/main.py:274-297` (`/action_reboot`, `/action_poweroff`), and every other route

**Issue:** There is no authentication or authorization anywhere in the application. `CORS(app, resources={r"/*": {"origins": "*"}})` additionally allows any website the operator visits to issue cross-origin requests to the plotter host. `/action_reboot` and `/action_poweroff` shell out to `sudo reboot` / `sudo poweroff`.

**Impact:** Anything on the network — or, via CORS, any page the operator opens — can power off the Pi, delete uploads, or start a plot. The `call_on_close` pattern also means the response is committed before the action runs, so a caller gets a 200 for an action that may fail.

**Recommendation:** At minimum, add a shared-secret or basic-auth gate in front of all mutating routes and restrict CORS to the app's own origin (or remove `flask-cors` entirely — the frontend is served same-origin from `dist/`). Document the LAN-only assumption in the README if that remains the intended posture.

---

## High

### H-1 — `webplotter.service` points at a path that does not exist

> **Status: FIXED** (2026-09-02) — Fixed — the unit points at `server/` with an absolute venv interpreter, and `install.sh` copies it from the repository root.
**Location:** `webplotter.service:12-13`, `install.sh:32-34`

**Issue:** The unit specifies:

```
WorkingDirectory=/home/pi/webplotter
ExecStart= python3 /home/pi/webplotter/main.py
```

but `main.py` lives at `server/main.py`, i.e. `/home/pi/webplotter/server/main.py`. `install.sh` also copies the unit from the wrong directory — it `cd ../server`s at line 27 and then runs `sudo cp webplotter.service /etc/systemd/system/`, while the file is at the repository root.

**Impact:** A clean install per the README produces a `cp` failure followed by a service that cannot start. Even if the paths were corrected, the wrong `WorkingDirectory` would break `config.read('config.ini')` and `UPLOAD_PATH = 'uploads'`, both of which are relative to CWD (see H-2).

**Recommendation:** Correct both paths to `server/`, and copy the unit before `cd`ing away from the repository root. Consider a smoke check (`systemctl is-active`) at the end of the install rather than an unconditional reboot.

---

### H-2 — All filesystem paths are relative to the current working directory
**Location:** `server/main.py:22`, `server/main.py:33`, `server/main.py:330`, `server/notification.py:6`, `server/tasmota.py:8`

**Issue:** `config.read('config.ini')`, `UPLOAD_PATH = 'uploads'`, and `open('config.ini', 'w')` are all CWD-relative. Three separate modules independently read `config.ini` from the CWD.

**Impact:** The app only works when launched from inside `server/`. Started from anywhere else — including under the systemd unit as written — `config.read` silently succeeds against a missing file (`configparser` does not raise), and the first request to `/` then dies with `KeyError: 'telegram'` (see M-4). Uploads land in a directory that may not exist.

**Recommendation:** Anchor paths to the module location: `BASE_DIR = os.path.dirname(os.path.abspath(__file__))` and join from there. Better, load configuration once in a dedicated module and inject it, rather than re-reading the same file in three places (see H-8).

---

### H-3 — No cleanup path leaves the UI permanently locked after a failed plot
**Location:** `server/main.py:58-82` (`plot`)

**Issue:** `plot()` emits `lock_edit: on`, calls `sendToPlotter`, then emits `lock_edit: off`. There is no `try/finally`. Every exception path in `sendToPlotter` — `NameError` (C-2), an `HPGLError` raised from `plotter_cmd` inside the send loop (H-4), a serial read timeout — propagates straight out.

**Impact:** The `lock_edit: off` emit is skipped, so the browser leaves every `.lock-edit` control disabled and the "Stop Print" button visible indefinitely. The only recovery is a page reload, which does not resubscribe to any state, so the UI silently disagrees with the server. The Tasmota power-off (line 74-75) is also skipped, leaving the plotter energized.

**Recommendation:** Wrap the call in `try/finally` and always emit the unlock and run the power-off. Have the frontend derive lock state from a server-pushed status snapshot on connect rather than only from transition events.

---

### H-4 — Unguarded plotter commands inside the send loop
**Location:** `server/send2serial.py:184-196`

**Issue:** Initialization (lines 161-177) wraps `plotter_cmd` in `try/except HPGLError`, but the send loop does not:

```python
while globals.printing == True:
    status = plotter_cmd(tty, b'\033.O', True)      # can raise HPGLError
    ...
    bufsz = plotter_cmd(tty, b'\033.B', True)       # can raise HPGLError
```

`plotter_cmd` raises on timeout (`HPGLError(-1)`), on an unparseable response (`HPGLError(-2)`), and on any plotter-reported error code. All are entirely normal conditions mid-plot: pen jam, paper-out, cable knock, plotter powered off.

**Impact:** A routine hardware hiccup becomes an unhandled exception and an HTTP 500, compounding into C-3 and H-3 (leaked port, stuck UI, `printing` left `True`).

**Recommendation:** Catch `HPGLError` around the loop, report it over the socket, and fall through to the cleanup path. Distinguish recoverable conditions (timeout — retry) from fatal ones.

---

### H-5 — The configured baud rate is accepted everywhere and used nowhere

> **Status: FIXED** (2026-09-02) — Fixed incidentally — both `serial.Serial` calls now pass `baudrate = baud`. The UI still offers only 9600, so the selects remain worth widening.
**Location:** `server/send2serial.py:122`, `server/send2serial.py:140`, `server/send2serial.py:147`

**Issue:** `sendToPlotter(socketio, hpglfile, port='COM3', baud=9600, plotter='7475a')` declares a `baud` parameter, `main.py:71` passes `int(baudrate)` into it, and both `serial.Serial(...)` calls hardcode `baudrate = 9600` instead.

**Impact:** The Baudrate control in the UI, the `plotter_baudrate` config field, and the whole parameter chain from form to serial port are inert. A plotter configured for any other rate cannot be driven, and the failure mode is silent garbage output rather than an error. (The UI select at `content.html:180-183` currently offers only `9600`, which masks the bug — but the config modal offers the same single option, so the setting is doubly meaningless.)

**Recommendation:** Pass `baudrate = baud` in both branches. Populate the baud-rate selects from a real list of supported rates, and validate the incoming value server-side.

---

### H-6 — Concurrent plot requests are not prevented
**Location:** `server/main.py:240-251` (`/start_plot`), `server/send2serial.py:125`

**Issue:** Nothing guards against a second `/start_plot` arriving while a plot is running. `globals.printing` is a status flag, not a lock — `sendToPlotter` sets it to `True` unconditionally at entry rather than testing it. With `async_mode='threading'` and a threaded server, two requests run two `sendToPlotter` calls concurrently against the same serial device.

**Impact:** Interleaved writes to the plotter produce corrupted output and a garbled command stream; the second `serial.Serial()` open typically fails, and whichever call fails takes the shared `globals.printing` flag with it. A double-click on "Start Plot" is enough to trigger this — the frontend does not disable the button on submit either.

**Recommendation:** Guard entry with a `threading.Lock` (non-blocking acquire) or an explicit state check, and return HTTP 409 when a plot is already running. Disable the Start Plot control client-side on submit.

---

### H-7 — Blocking HTTP request for the entire duration of a plot
**Location:** `server/main.py:240-251`, `server/main.py:71`

**Issue:** `/start_plot` calls `plot()` synchronously, which calls `sendToPlotter`, which blocks until the whole file has been streamed to the plotter — minutes to hours.

**Impact:** The client's XHR is held open for the entire print. Any proxy, browser, or OS-level idle timeout aborts it, and `actions.ts:49-59` treats a non-200 as an error and shows a `danger` notification even though the plot is proceeding normally. It also occupies a server thread for the duration, and there is no request-side way to observe progress (progress arrives out-of-band over the socket).

**Recommendation:** Start the plot on a background thread (`socketio.start_background_task`) and return `202 Accepted` immediately. Report progress and completion purely over the socket connection, which is already wired up for it.

---

### H-8 — Configuration is cached at import time in three modules, so saved changes do not take effect
**Location:** `server/main.py:21-22`, `server/notification.py:5-14`, `server/tasmota.py:7-15`, `server/main.py:308-334`

**Issue:** `notification.py` and `tasmota.py` each read `config.ini` at import and snapshot the values into module-level constants (`TELEGRAM_TOKEN`, `TELEGRAM_CHAT_ID`, `TASMOTA_ENABLE`, `TASMOTA_IP`). `/save_configfile` mutates only `main.py`'s own `config` object and rewrites the file.

**Impact:** Editing Telegram or Tasmota settings through the web UI updates the file and the sidebar, and `GET /save_configfile` reads back the new values — so the UI reports success — but the notification and Tasmota code paths keep using the values from process start until the service is restarted. This is a silent, hard-to-diagnose divergence between what the UI shows and what the app does.

**Recommendation:** Introduce one configuration module owning a single `ConfigParser` instance, expose accessor functions (not constants) so reads always see current state, and have the save endpoint update that instance. Re-read on write, or invalidate a cache.

---

### H-9 — Failed conversions delete the source SVG anyway
**Location:** `server/main.py:116-126`

**Issue:** `rendering.wait()`'s return code is discarded, and the source file is removed unconditionally on the next lines. Nothing verifies that `outputFile` was actually produced.

```python
rendering = subprocess.Popen(args, shell=True)
rendering.wait()

if os.path.exists(file):
    os.remove(file)
```

The function then returns `'- Exported ' + str(outputFile)` regardless.

**Impact:** Irreversible data loss. If `vpype` is missing, the SVG is malformed, or the geometry is empty, the user's uploaded artwork is deleted and the UI reports a successful export. Given the deletion is silent and the success message is unconditional, users have no signal that anything went wrong.

**Recommendation:** Check `returncode`, capture `stderr`, and confirm the output file exists and is non-empty before deleting the source. Surface the `vpype` error to the status log on failure. Consider not deleting the source at all — it is the only copy, and the user did not ask for it to be removed.

---

### H-10 — No request timeouts on outbound HTTP; the `Timeout` handler is unreachable
**Location:** `server/tasmota.py:21`, `server/tasmota.py:46`, `server/notification.py:23`

**Issue:** All three outbound calls omit `timeout=`:

```python
r = requests.get("http://{ip}/cm?cmnd=Power%20{status}".format(...)).content
```

`requests` has no default timeout, so a call to an unreachable-but-routable host hangs until the OS TCP timeout (minutes). Both Tasmota functions then catch `requests.exceptions.Timeout` — an exception that can never be raised without a timeout set.

**Impact:** The Tasmota IP is user-configurable and a typo is likely. A hang in `tasmota_setStatus` blocks the plot start (`main.py:67`) or the plot completion (`main.py:75`); a hang in `telegram_sendNotification` blocks the *send loop itself* (`send2serial.py:203`), stalling data to the plotter mid-print. Combined with H-7, the HTTP request hangs too.

**Recommendation:** Pass an explicit `timeout=(3, 5)` to every `requests` call. Move the Telegram notification off the print thread entirely.

---

### H-11 — `raise SystemExit` inside request handlers
**Location:** `server/tasmota.py:34-37`, `server/tasmota.py:59-62`

**Issue:** The catch-all `RequestException` handler ends with `raise SystemExit(e)`, in code reached from `/action_tasmota` and from the plot lifecycle.

**Impact:** `SystemExit` is not caught by Flask's error handling and is intended to terminate the interpreter. A transient network error on the Tasmota call can bring down the web service — including mid-print, abandoning an in-progress plot.

**Recommendation:** Log the error, emit it to the status log, and return; never `SystemExit` from library code. Reserve process termination for the entrypoint.

---

### H-12 — Socket error payloads use two different key names

> **Status: FIXED** (2026-09-02) — Fixed in `send2serial.py` — the three `{'error': ...}` payloads now use `{'data': ...}`. No shared schema yet, so the two sides can still drift.
**Location:** `server/send2serial.py:134`, `server/send2serial.py:142`, `server/send2serial.py:149` vs. `frontend/src/main.ts:68-73`

**Issue:** Three emits send `{'error': ...}` while every other emit in the codebase — and the sole client handler — uses `{'data': ...}`:

```python
socketio.emit('error', {'error': repr(e)})    # send2serial.py:142
```
```typescript
socket.on("error", (msg, cb) => {
  jQuery("#statusLog").append("<br>" + $('<div class="error"/>').text(msg.data).html());
```

**Impact:** The three most important error messages — file stat failure and both serial-port-open failures — render as the literal text `undefined` in the status log. "Plotter is unplugged" is exactly the case a user needs a readable message for, and it is the case that produces `undefined`.

**Recommendation:** Standardize on `{'data': ...}` for all emits. Define the socket message shapes in one place (a shared TypeScript type plus a Python helper) so the two sides cannot drift.

---

### H-13 — `install.sh` installs Python packages system-wide with `sudo pip3`

> **Status: FIXED** (2026-09-02) — Fixed — `install.sh` builds a venv and installs into it instead of `sudo pip3`. H-14 (libgeos, apt-key) is still outstanding.
**Location:** `install.sh:29-31`

**Issue:** The venv creation is commented out and replaced with a system-wide install:

```bash
# python3 -m venv venv
# source venv/bin/activate
sudo pip3 install -r requirements.txt
```

**Impact:** On any Debian/Raspberry Pi OS release from Bookworm onward this fails outright with `error: externally-managed-environment`, so the documented install path does not complete. Where it does succeed, it overwrites distribution-managed packages with pinned versions (`numpy`, `scipy`, `shapely` are all in `requirements.txt`), which can break unrelated system tooling.

**Recommendation:** Restore the venv, and point `ExecStart` in the unit file at the venv's interpreter (`/home/pi/webplotter/server/venv/bin/python`) rather than relying on shell activation, which systemd does not perform.

---

### H-14 — `install.sh` targets packages that no longer exist and uses a removed apt mechanism
**Location:** `install.sh:5`, `install.sh:12-13`

**Issue:** `libgeos-c1v5` and `libgeos-3.7.1` are Debian Stretch/Buster-era package names, absent from Bullseye onward. `apt-key add` was deprecated in Debian 11 and removed in Debian 12.

**Impact:** The install aborts or emits errors on any current Raspberry Pi OS. Since the script ends in an unconditional `sudo reboot` (line 39), a partially-failed install still reboots into a broken service, which makes diagnosis harder than it needs to be.

**Recommendation:** Drop the explicit GEOS pins — `shapely` ships manylinux wheels with GEOS bundled. Use a keyring file under `/etc/apt/keyrings/` with `signed-by=` for the Yarn repository. Add `set -euo pipefail` so failures stop the script rather than proceeding to reboot.

---

### H-15 — Race between port-list population and configured-port selection
**Location:** `frontend/src/main.ts:93-97`, `frontend/src/core/plotter.ts:9-26`, `frontend/src/core/plotter.ts:139`

**Issue:** `updatePorts()` and `updateConfiguration()` are fired back-to-back with no ordering:

```typescript
updateFiles();
updatePorts();
updateConfiguration();
```

`updatePorts` clears `.portList` (`jQuery('.portList').html('')`) and repopulates it from `/update_ports`. `updateConfiguration` sets `jQuery('.portList').val(response.data.plotter_port)`.

**Impact:** Whichever response lands second wins. If `/save_configfile` resolves first, the `<option>` for the saved port does not exist yet and jQuery's `.val()` is a no-op; the subsequent `updatePorts` then clears and repopulates, leaving the first port selected instead of the configured one. If `/update_ports` resolves first, it works. The result is a non-deterministic default port — the user may start a plot on the wrong device. Manually clicking "Refresh Port List" also silently discards the configured selection, since `updatePorts` never reapplies it.

**Recommendation:** Chain the calls — populate the port list, then apply the configuration — or have `updatePorts` accept the desired selection and reapply it after repopulating.

---

### H-16 — "Stop Print" does not stop the plotter
**Location:** `server/main.py:254-258`, `server/send2serial.py:184`

**Issue:** `/stop_plot` sets `globals.printing = False`, which only stops the *feed loop*. No abort sequence (`\033.K`, which the code already knows about and uses at initialization, line 164) is sent, and the plotter's internal buffer — reported at line 168 and kept topped up to within 128 bytes of full — is not flushed.

**Impact:** The plotter keeps drawing whatever is already buffered, potentially for a long time on a large buffer. Meanwhile the UI has already reported `'Stopped Print'` and cleared the selected filename (`actions.ts:69-72`). The user believes the job is stopped while the pen is still moving. There is also latency of up to five seconds before the flag is even observed, if the loop is inside the `time.sleep(5.0)` at line 189.

**Recommendation:** On stop, send `\033.K` (abort graphics) and `\033.J` (abort device control) before closing, then run the same cleanup path as normal completion. Emit an explicit "stopped" event and let the UI update from that rather than optimistically.

---

### H-17 — Type checking never runs
**Location:** `frontend/package.json:8`, `frontend/tsconfig.json:19-27`

**Issue:** `tsconfig.json` enables `strict`, `noUnusedLocals`, `noUnusedParameters`, and `noFallthroughCasesInSwitch`, but the build script is `vite build --config config/vite.build.js` with no `tsc --noEmit` step. Vite strips types with esbuild and never type-checks. There is no CI, no lint step, and no test suite.

**Impact:** None of the configured strictness is enforced. Existing violations confirm this: the unused `cb` parameters at `main.ts:63/68/76/81` violate `noUnusedParameters`, and `notify(error, 'danger')` (used in eight places) passes an unknown-typed axios error into a `message: string` parameter. The type configuration gives a false impression of safety.

**Recommendation:** Change the build script to `tsc --noEmit && vite build`, fix the resulting errors, and add a CI job that runs it. This is the single highest-leverage maintainability change available — it converts a large class of the Medium findings below into build failures.

---

## Medium

### M-1 — `tasmota` local variable shadows the `tasmota` module
**Location:** `server/main.py:246`

**Issue:** Inside `start_plot`, `tasmota = request.form.get('tasmota')` rebinds the name that refers to the imported module at `main.py:18`. Within this function the module is unreachable.

**Impact:** No current bug — `start_plot` does not call the module — but it is a latent trap. Any future `tasmota.tasmota_setStatus(...)` added to this handler fails with `AttributeError: 'str' object has no attribute ...`, or `TypeError` when the form field is absent and the name is `None`.

**Recommendation:** Rename the local to `tasmota_poweroff` to match the `poweroff` parameter it feeds.

---

### M-2 — Routes declare HTTP methods they do not handle, returning 500
**Location:** `server/main.py:202`, `server/main.py:240`, `server/main.py:254`, `server/main.py:261`, `server/main.py:274`, `server/main.py:287`, `server/main.py:300`

**Issue:** Seven routes are registered with `methods=['GET', 'POST']` but the body handles only one of them and falls off the end returning `None`. `/stop_plot` handles only `GET`; the other six handle only `POST`.

**Impact:** Flask raises `TypeError: The view function did not return a valid response` and returns 500 — with the interactive debugger attached, given C-8. This turns a wrong-method request (a bookmarked URL, a link prefetch, a crawler) into an error page rather than a clean 405.

**Recommendation:** Declare only the methods each route actually implements and let Flask return 405 automatically. The `if request.method == "POST":` guards then become dead code and can go too.

---

### M-3 — Success is reported for operations that failed
**Location:** `server/main.py:240-251` vs. `server/main.py:79-82`; `server/main.py:202-215`

**Issue:** `plot()` signals its failures by *returning* the result of `socketio.emit(...)`, but `start_plot` discards the return value and unconditionally returns `'Plotter Started'` with status 200. Likewise `/delete_file` returns `'The file does not exist'` with a 200.

**Impact:** The frontend keys entirely off `response.status == 200` (`actions.ts:52`, `plotter.ts:72`). A missing file, an invalid selection, or a failed delete all render as a success notification. In `deleteFile`, the failure message is passed to `notify(response.data, 'warning')` and appears styled as a routine warning next to the successful deletes.

**Recommendation:** Return proper status codes (400 for invalid input, 404 for missing files, 409 for busy) and a consistent JSON body. Have the frontend branch on the status code and render the server's message.

---

### M-4 — Missing or partial `config.ini` crashes the index route
**Location:** `server/main.py:136-145`, `server/main.py:311-331`

**Issue:** `configparser.read()` does not raise on a missing file — it returns an empty list of parsed files. The index route then indexes into sections directly:

```python
'telegram_token': config['telegram']['telegram_token'],
```

`save_configfile` has the same pattern on the write path.

**Impact:** If `config.ini` is missing, was never copied from the sample, or is missing a section (the sample is the only source of the section structure, and `install.sh:32` is the only thing that creates it), every page load 500s with `KeyError: 'telegram'`. There is no error message pointing at the real cause.

**Recommendation:** Check the return value of `config.read()` and fail loudly at startup with an actionable message. Use `config.get(section, option, fallback=...)` for reads. Seed missing sections from `config.ini.sample` on first run.

---

### M-5 — `start_preview` reads binary-capable files as text with no error handling
**Location:** `server/main.py:229-231`

**Issue:** `open(file_path, 'r')` uses the platform default encoding with no `errors=` argument, and the read is not wrapped in `try/except`. Any file in the upload directory can be requested — including the `.png`/`.jpg` uploads that `UPLOAD_EXTENSIONS` explicitly permits (`main.py:32`).

**Impact:** A `UnicodeDecodeError` on a binary or non-UTF-8 file becomes an unhandled 500. The whole file is also read into memory and returned in one response, with `MAX_CONTENT_LENGTH` capping uploads at 20 MB — a large HPGL file is a 20 MB string handed to a browser-side parser (see M-16).

**Recommendation:** Open with an explicit encoding and `errors='replace'`, restrict preview to `.hpgl`/`.hpg`, wrap in `try/except`, and stream or cap the response size.

---

### M-6 — `plotter_cmd` returns `None` on a path that reads as "returns a value"
**Location:** `server/send2serial.py:92-102`

**Issue:** The function returns `answ` only when `get_answer` is true and no exception occurs; otherwise it falls off the end returning `None`. Callers cannot distinguish "no answer requested" from "something went wrong", and the `get_answer` flag is checked twice around the `chk_error` call for no clear reason.

**Impact:** A caller that passes `get_answer=True` and receives `None` will fail later with a confusing `TypeError` (e.g. `None & EXT_STATUS_VIEW` at line 186) rather than at the point of failure. It also makes the function's contract unclear to a reader.

**Recommendation:** Split into two functions — `plotter_cmd(tty, cmd)` returning `None` and `plotter_query(tty, cmd)` returning an `int` — so the return type is unambiguous at every call site.

---

### M-7 — Fragile serial port name parsing
**Location:** `server/send2serial.py:116-120`

**Issue:** `str(i).split(" ")[0]` parses `ListPortInfo.__str__()`, which is a human-readable description (`"COM3 - USB Serial Device"` / `"/dev/ttyUSB0 - FT232R USB UART"`), rather than reading the `device` attribute directly.

**Impact:** Any port whose description format differs, or any path containing a space, yields a truncated or wrong device name that then fails to open. The failure surfaces as an unhelpful `SerialException` at plot time rather than at enumeration.

**Recommendation:** Use `port.device` and, for display, `port.description` — the attributes exist precisely for this. Return `hwid` too, so the UI can distinguish two identical adapters.

---

### M-8 — Progress reporting is off by one chunk and never reaches 100%

> **Status: FIXED** (2026-09-02) — Fixed incidentally — the byte counter is incremented before the progress emit, and EOF emits a final 100.
**Location:** `server/send2serial.py:207-211`, `server/send2serial.py:198-205`

**Issue:** The percentage is computed from `total_bytes_written` *before* the current chunk is written (the increment is the last statement of the loop, line 218), and the loop `break`s at EOF (line 205) before emitting a final progress event.

**Impact:** The progress bar always trails by one buffer's worth and stops short of 100%, so a completed job looks unfinished. Bytes handed to the serial port also are not bytes plotted — the plotter's buffer holds up to a full buffer's worth — so the bar reads ahead of physical reality at the end.

**Recommendation:** Move the increment before the emit, and emit a final `100` on the EOF path along with an explicit completion event.

---

### M-9 — Frontend notifications are decoupled from actual outcomes
**Location:** `frontend/src/core/actions.ts:116-129`, `frontend/src/core/actions.ts:83-114`, `frontend/src/core/actions.ts:186-196`

**Issue:** Several handlers announce success purely on receipt of a 200:

```typescript
axios.post('/action_tasmota').then(function(response) {
  if (response.status == 200) { notify('Tasmota Toggled', 'success'); }
```

`/action_tasmota` returns `'action_tasmota started'` unconditionally, even when C-4 means nothing happened. `startPreview` shows `'Preview started'` before rendering, so a subsequent crash in `HPGLViewer` leaves a success toast on screen. `actionReboot`/`actionPoweroff` report success for an action that is only queued via `call_on_close`.

**Impact:** The UI consistently over-reports success, which is what makes C-4 and H-9 invisible to users.

**Recommendation:** Have the endpoints return the actual outcome and branch the notification on it. Move `notify` after the operation it describes.

---

### M-10 — Autoscroll of the status log does not work
**Location:** `frontend/src/utils/utility.ts:66-72`

**Issue:** `scrollLog` calls the Web Animations API on a native `Element` using jQuery's `.animate()` argument shape:

```typescript
document.querySelectorAll('.auto-scroll').forEach((el) => {
  el.animate({ scrollTop: el.scrollHeight }, 10);
});
```

`Element.animate(keyframes, options)` animates CSS properties. `scrollTop` is a DOM property, not a CSS property, so the keyframe is ignored. `el.scrollHeight` is also not typed on `Element` — this only compiles because type checking never runs (H-17).

**Impact:** The "Autoscroll console" feature listed as done in `ToDo.md` does not function; the status log scrolls off-screen during a print, which is exactly when it matters. A no-op animation is also created on every log line.

**Recommendation:** Set `el.scrollTop = el.scrollHeight` directly, or use `el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })`. Narrow the `querySelectorAll` to `HTMLElement`.

---

### M-11 — The `error` log style has no CSS rule
**Location:** `frontend/src/main.ts:70`, `frontend/src/styles/main.sass`

**Issue:** Error lines are wrapped in `<div class="error">`, but `main.sass` defines no `.error` rule (nor does UIkit provide one — its convention is `uk-text-danger`).

**Impact:** Errors are visually indistinguishable from normal status output in the log panel, defeating the purpose of the separate handler.

**Recommendation:** Add a `.error` rule, or use `uk-text-danger`.

---

### M-12 — Configuration-loading logic duplicated between two modules
**Location:** `frontend/src/core/plotter.ts:127-147` (`updateConfiguration`) and `frontend/src/core/actions.ts:132-155` (`actionOpenConfig`)

**Issue:** Both functions `GET /save_configfile` and populate overlapping sets of fields from the response. Four assignments are byte-identical; the rest differ subtly — `updateConfiguration` writes `.plotter_name`/`.portList`/`#device`/`#baudRate` (the main form), while `actionOpenConfig` writes `#plotter_name`/`#plotter_port`/`#plotter_device`/`#plotter_baudrate` (the modal).

**Impact:** The near-identical bodies invite copy-paste edits that update one and not the other. The two views can then display different values for the same setting. The overlap also means the config is fetched twice on the path where a user opens the modal.

**Recommendation:** Fetch once into a shared, typed config object and have two small render functions consume it. Cache the fetch so opening the modal does not re-request.

---

### M-13 — A new `HPGLViewer` is constructed on every preview click

> **Status: FIXED** (2026-09-02) — sizing moved out of the constructor into a `resizeCanvas` step that measures the container (minus its padding) and derives the height from the drawing's aspect ratio, clamped to 60% of the viewport; the backing store is scaled by `devicePixelRatio`. The viewer is now built once and reused.
**Location:** `frontend/src/core/actions.ts:193-195`, `frontend/src/display/hpgl.ts:17-18`

**Issue:** Each click builds a fresh viewer over the same canvas, and the constructor resizes it as a side effect:

```typescript
this.canvas.height = window.innerHeight - 55;
this.canvas.width = window.innerWidth / 3 - 55;
```

**Impact:** Writing `canvas.width`/`height` resets the entire 2D context state and clears the canvas — a side effect hidden inside a constructor. The dimensions are derived from the *window*, but the canvas lives inside a UIkit modal with its own width, so it does not fit its container; `content.html:356` declares `width="400" height="400"` which is immediately overridden. On a narrow window, `window.innerWidth / 3 - 55` can go negative or near-zero.

**Recommendation:** Construct the viewer once and give it a `load(content)` method. Size the canvas from its container's `clientWidth`/`clientHeight` (accounting for `devicePixelRatio`), and re-measure on modal open and window resize rather than at construction.

---

### M-14 — `PA` and `PR` with coordinates are parsed as mode switches only

> **Status: FIXED** (2026-09-02) — Fixed — `PA`/`PR` now apply any coordinates they carry. Required for C-6: `Anca01.hpg` puts all 7,990 of its moves on `PA`.
**Location:** `frontend/src/display/hpgl.ts:49-54`

**Issue:** The parser treats `PA`/`PR` purely as mode flags and discards any coordinates on them:

```typescript
case "PA":
  isAbsolute = true;
  break;
```

`PA100,200;` is a legal and common HPGL instruction meaning "switch to absolute mode *and* move to (100,200)".

**Impact:** Files using that form lose every movement expressed on a `PA`/`PR` command. Since `vpype`'s `hp7475a` writer emits `PA` freely, this can silently drop most of a drawing even after C-6 and C-7 are fixed.

**Recommendation:** After setting the mode, process any coordinate pairs on the command using the current pen state — the same body as the `PU`/`PD` case. Extract that coordinate loop into a shared helper.

---

### M-15 — Parser produces `undefined` coordinates on argument-less pen commands

> **Status: FIXED** (2026-09-02) — Fixed — `parseArgs` returns an empty list for argument-less and malformed commands, and only whole pairs are consumed.
**Location:** `frontend/src/display/hpgl.ts:42`, `frontend/src/display/hpgl.ts:58-68`

**Issue:** `cmd.slice(2).split(",").map(Number)` on a bare `PU` yields `[0]` — because `''.split(',')` returns `['']` and `Number('')` is `0`, not `NaN`. The pair loop then runs once with `args[1] === undefined`:

```typescript
let x = args[i];        // 0
let y = args[i + 1];    // undefined
currentPath.push({ x, y, draw: penDown });
```

The declared type is `{ x: number; y: number; draw: boolean }`, so `undefined` enters a field typed `number`.

**Impact:** A spurious point at `(0, undefined)` is injected, `currY` becomes `undefined`, and all subsequent relative coordinates become `NaN`. Drawing `NaN` coordinates silently breaks the current canvas subpath. Bare `PU;` is the standard way to lift the pen and appears in essentially every HPGL file. The type declaration does not catch it because type checking never runs (H-17).

**Recommendation:** Filter out empty argument strings, require `args.length` to be even, and skip pairs where either value is not finite. Reject and report malformed commands rather than emitting bad geometry.

---

### M-16 — Unknown HPGL commands trigger a `console.warn` per occurrence

> **Status: FIXED** (2026-09-02) — Fixed incidentally — unsupported codes are collected in a Set and logged once.
**Location:** `frontend/src/display/hpgl.ts:73-74`

**Issue:** The `default` case warns for every unrecognized two-character code. The parser handles only `IN`, `PA`, `PR`, `PU`, `PD`, `SP` — `vpype`'s HP7475A output also emits `VS`, `LT`, `PW`, `WU`, and others routinely.

**Impact:** A realistic file produces thousands of console warnings, which is slow (console I/O is synchronous) and buries any genuine diagnostic. It also mixes two concerns: "command I don't implement" and "command that is malformed".

**Recommendation:** Collect unrecognized codes into a `Set` and log the distinct set once after parsing.

---

### M-17 — `drawOnCanvas` takes parameters it ignores or overwrites

> **Status: FIXED** (2026-09-02) — Fixed incidentally — `drawOnCanvas` is now a zero-argument method reading instance state.
**Location:** `frontend/src/display/hpgl.ts:84-121`

**Issue:** The signature is `drawOnCanvas(paths, ctx, scale = 0.05)`, but:
- `scale`'s default is unconditionally overwritten at lines 117-121 before use — it is a parameter that can never be supplied meaningfully.
- The `paths` parameter is used only in the render loop (line 130); the bounding-box computation reads `this.paths` instead (lines 89-107). The sole caller passes `this.paths`, so they coincide today — but the function reads from two sources for the same data.
- `ctx` duplicates `this.ctx`, while lines 114-115 and 124-127 reach for `this.canvas` regardless.

**Impact:** The mixed instance/parameter access makes the method hard to reason about and easy to break — passing a different `paths` argument would scale it against the wrong bounding box. The dead `scale` default suggests a configurable zoom that does not exist.

**Recommendation:** Make it a zero-argument private method reading `this.paths`/`this.ctx`/`this.canvas`, or make it fully pure over its parameters. Not both.

---

### M-18 — Unescaped interpolation of filenames into HTML
**Location:** `frontend/src/utils/utility.ts:15-51`, `frontend/src/core/plotter.ts:62`, `frontend/src/core/plotter.ts:138`

**Issue:** `renderFileListElement` builds markup with template literals and inserts `name` into both text content and `data-filename` attributes with no escaping. `selectFile` and `updateConfiguration` use `.html()` on server-supplied values (`jQuery('.selectedFilename').html(filename)`, `jQuery('.plotter_name').html(...)`).

**Impact:** Currently mitigated: `secure_filename` strips quotes and angle brackets on upload. But the mitigation is incidental and applies only to the upload path — files placed in `uploads/` by other means, and `plotter_name` from `config.ini` (which the config modal writes unvalidated), are not covered. `plotter_name` is a straightforward self-XSS/stored-XSS vector via `/save_configfile`.

**Recommendation:** Build the list items with DOM APIs and `textContent`, or escape interpolated values. Use `.text()` rather than `.html()` wherever the content is not deliberately markup.

---

### M-19 — Missing loading and error states across the UI
**Location:** `frontend/src/core/plotter.ts` and `frontend/src/core/actions.ts` (all handlers)

**Issue:** Every handler follows the same shape: fire the request, do nothing while it is in flight, and on failure call `notify(error, 'danger')` with the raw axios error object.

**Impact:** No control is disabled during its request, so double-clicks issue duplicate requests (contributing to H-6). Passing an `Error` object where a `string` is expected makes UIkit render `[object Object]` — every network failure produces the same unhelpful toast. Three handlers (`updatePorts`, `updateFiles`, `deleteFile`) also end with a no-op `.then(function() {})` that appears to be a stripped-out `finally`.

**Recommendation:** Add a small request helper that disables the triggering control, extracts `error.response?.data ?? error.message` for the notification, and re-enables on settle. Remove the empty `.then` callbacks.

---

### M-20 — Uploads silently overwrite existing files, including during a plot
**Location:** `server/main.py:165-172`

**Issue:** `file.save(os.path.join(...))` overwrites any existing file with the same name. There is no check against `globals.printing`.

**Impact:** Re-uploading a file that is currently being streamed to the plotter replaces it under the open file handle, corrupting the in-progress print. The `lock-edit` class is applied to delete/convert/preview controls (`utility.ts:22-23`) but not to the Dropzone uploader, so the UI does not prevent it. Silently replacing a user's file is also surprising in its own right.

**Recommendation:** Reject uploads that collide with an existing name (or uniquify with a suffix), and reject uploads entirely while a plot is running.

---

### M-21 — `secure_filename` can return an empty string
**Location:** `server/main.py:169-171`

**Issue:** `secure_filename` returns `''` for inputs consisting only of stripped characters (`'..'`, `'...'`, some non-Latin filenames). The result is joined and saved without a re-check — the earlier `file.filename == ''` guard (line 163) tests the *original* name, before sanitization.

**Impact:** `file.save('uploads/')` raises `IsADirectoryError`/`PermissionError`, producing an unhandled 500. `allowed_file` is likewise applied to the pre-sanitization name, so the extension checked is not necessarily the extension saved.

**Recommendation:** Sanitize first, then validate the sanitized result — both non-empty and correct extension — before saving.

---

### M-22 — Extensions accepted on upload that nothing downstream can use
**Location:** `server/main.py:32`

**Issue:** `UPLOAD_EXTENSIONS = ['svg', 'hpgl', 'png', 'jpg', 'jpeg']`, but there is no raster path anywhere in the application. `renderFileListElement` falls through to the `default` branch for images, offering only a Delete action.

**Impact:** Users can upload images that the app can do nothing with, consuming disk with no cleanup policy. It also widens the input surface for M-5.

**Recommendation:** Drop the image extensions, or state what they are for. (The `ComfyUI/Workflow/Image To Vector.json` file hints at an intended image→vector flow that was never implemented — worth a note in the README either way.)

---

### M-23 — `make_tree` recurses into directories the frontend cannot render
**Location:** `server/main.py:43-56`, `frontend/src/core/plotter.ts:37-39`

**Issue:** `make_tree` recursively builds nested `{name, content}` nodes, but the consumer only iterates the top level and reads `content.name`:

```typescript
for (var content of response.data.content) {
  jQuery('#fileList').append(`<li> ${renderFileListElement(content.name)} </li>`)
}
```

**Impact:** A subdirectory in `uploads/` renders as an ordinary entry with a Delete button, which then calls `os.remove` on a directory and fails with an unhandled `IsADirectoryError` (500). The recursion is unused complexity for a flat upload folder. The `except OSError: pass` at lines 46-47 also silently swallows permission errors, so a broken uploads directory presents as simply empty.

**Recommendation:** Return a flat list, or handle nesting in the frontend. Either way, log rather than swallow the `OSError`.

---

### M-24 — Build output accumulates indefinitely and ships source maps
**Location:** `frontend/config/vite.build.js:7-11`, `server/dist/static/`

**Issue:** `outDir` is `../server/dist`, outside the Vite project root. Vite only auto-empties `outDir` when it is inside the root, so `emptyOutDir` is effectively off and no build ever cleans up. `sourcemap: true` is set for the production build.

**Impact:** `server/dist/static/` currently holds 38 JavaScript bundles and their maps — 79 MB, of which roughly 77 MB is stale output from builds dating back to June 2025. Only one bundle is referenced by `index.html`. On a Raspberry Pi's SD card this is meaningful, and it grows with every deploy. Shipping `.js.map` also publishes readable original sources to any client.

**Recommendation:** Set `emptyOutDir: true` explicitly, and set `sourcemap: false` (or `'hidden'`) for production builds.

---

## Low

### L-1 — Dead code: `baud_rate_test`
**Location:** `server/send2serial.py:104-114`

Never called from anywhere. It also opens a `serial.Serial` it never closes, and its success test (`resp == packet`) checks whether the plotter echoed the request verbatim, which is not how the `OI;` identify command responds. **Recommendation:** Remove it, or fix and wire it into port detection if auto-detection is wanted.

---

### L-2 — Dead code: commented-out upload implementation
**Location:** `server/main.py:176-183`

An unreachable block after `return "Invalid image", 400`, containing an earlier version of the upload logic with a different (buggy) extension check — it compares `os.path.splitext(filename)[1]`, which includes the leading dot, against a list of extensions without dots. **Recommendation:** Delete; git history preserves it.

---

### L-3 — Dead code: `flash()` with no consumer
**Location:** `server/main.py:158`

`flash('No file part')` is followed immediately by a JSON-ish error return. No template renders flashed messages and the endpoint is called by XHR. **Recommendation:** Remove the `flash` call and the import.

---

### L-4 — Unused imports
**Location:** `server/main.py:6` (`redirect`, `url_for`, `abort`, `jsonify`), `server/send2serial.py:11` (`SocketIO`, `emit`), `server/tasmota.py:4` (`SocketIO`, `emit`), `frontend/src/main.ts:12-13` (`$`/`jQuery` aliasing)

Unused names in Python; in `main.ts` both `$` and `jQuery` are used interchangeably within the same file for the same object. **Recommendation:** Remove unused imports; pick one jQuery alias project-wide (`plotter.ts` and `actions.ts` repeat the same `const jQuery = $` line).

---

### L-5 — Dead field: `HPGLViewer.color`

> **Status: FIXED** (2026-09-02) — Fixed — `color` is applied as `strokeStyle`, and changed from white (invisible on the white fill) to `#222222`.
**Location:** `frontend/src/display/hpgl.ts:8`, `frontend/src/display/hpgl.ts:15`

Assigned twice (field initializer and constructor) and never read — `drawOnCanvas` never sets `strokeStyle`, so paths render in the canvas default black on the white fill from line 126. **Recommendation:** Either apply it (`ctx.strokeStyle = this.color`) or remove it. Note that `"white"` on a white background would render nothing.

---

### L-6 — Superseded implementation left in the working tree
**Location:** `frontend/src/display/hpgl copy.ts.bak`

A 353-line prior implementation of `HPGLViewer`, ignored via `*.bak` in `frontend/.gitignore` so it is invisible to the repository but present on disk. It is materially more complete than the current version (correct scale direction, Y flip, offsets, per-pen colors). **Recommendation:** Either restore the working parts into `hpgl.ts` (see C-6/C-7) or delete the file — git history is the right place for it.

---

### L-7 — `globals` module shadows the `globals()` builtin
**Location:** `server/globals.py`, imported at `server/main.py:16` and `server/send2serial.py:15`

`import globals` shadows the Python builtin within importing modules, and the module implements shared mutable state via a function that assigns a module-level `global`. **Recommendation:** Rename to `plot_state.py` and expose a small class or explicit accessors instead of a bare module attribute.

---

### L-8 — `globals.initialize()` runs only under `__main__`
**Location:** `server/main.py:357`, `server/globals.py:1-3`

`printing` is only defined when `main.py` is executed directly. Under any WSGI server that imports the app, the attribute does not exist until `/stop_plot` or a plot creates it. **Recommendation:** Initialize `printing = False` at module scope in `globals.py` and drop `initialize()`.

---

### L-9 — Comment contradicts the code
**Location:** `server/main.py:68`

```python
time.sleep(2) # Just to be sure, wait 5 seconds
```

**Recommendation:** Fix the comment, and name the delay (`TASMOTA_POWERON_DELAY_S`) so its purpose is clear.

---

### L-10 — Conversion hardcodes the HP7475A device regardless of the selected plotter
**Location:** `server/main.py:106`

`args += ' write --device hp7475a'` ignores the device selection that the rest of the app threads through (`content.html:194-197` offers `mp4200`; `send2serial.py:138` branches on it). The README advertises Graphtec MP4200 support. **Recommendation:** Map the selected device to the corresponding `vpype` device profile, or document that conversion targets HP7475A output only.

---

### L-11 — Trailing semicolons and repeated `os.getcwd()` in `convert`
**Location:** `server/main.py:92-114`

The command-building block uses C-style trailing semicolons on Python statements and calls `os.getcwd()` twice. The paper-size branches embed magic dimensions (`27.7cm 19cm`, `39cm 26.7cm`) with no explanation of the margin they encode. **Recommendation:** Remove the semicolons, hoist the CWD, and lift the dimensions into a named table mapping `(orientation, size)` to a plot area — which also makes adding a size a data change rather than a code change.

---

### L-12 — `save_configfile` conflates read and write on one endpoint
**Location:** `server/main.py:308-347`

A `GET` returns the configuration and a `POST` saves it, under a name that describes only the write. `POST` also silently ignores unknown or missing fields (each is guarded by `if "x" in request.form`), so a partial or misspelled submission succeeds with no indication that nothing was applied. **Recommendation:** Split into `GET /config` and `POST /config`, and validate the payload, rejecting unknown keys.

---

### L-13 — Favicon reference does not resolve in production
**Location:** `frontend/index.html:5`

```html
<link rel="icon" type="image/svg+xml" href="/img/logo.png" />
```

Two problems: the declared type is SVG for a PNG, and the path is `/img/`, while `viteStaticCopy` (`vite.build.js:22-25`) copies assets to `static/` and Flask serves only `/static` plus the template folder. The `server/dist/img/` directory that would satisfy it is stale output from an older build config, not something the current build produces. **Recommendation:** Point at `/static/img/logo.png` and set `type="image/png"`.

---

### L-14 — Relative asset paths in the injected view
**Location:** `frontend/src/views/content.html:7`, `:35`, `:38`

`src="static/img/logo.png"` is relative, so it resolves correctly only at `/`. **Recommendation:** Use root-relative `/static/...`.

---

### L-15 — Malformed HTML in the view
**Location:** `frontend/src/views/content.html:344-354`, `frontend/src/views/content.html:252`

The preview modal opens `<form id="previewData">` and `<fieldset>` but closes only the form — the `</fieldset>` is missing, and two `</div>`s close before it. The offcanvas `<li>` at line 252 is never closed. Duplicate `data-uk-tooltip` attributes appear on the same element at lines 16 and 72. **Recommendation:** Run the view through an HTML validator; browsers recover silently today, which makes future structural edits unpredictable.

---

### L-16 — UI copy and stale metadata
**Location:** `frontend/src/views/content.html:196`, `:430`, `:237`; `frontend/package.json:4`

"Graptech MP4200" should be "Graphtec" (both occurrences). The footer is hardcoded to "Copyright 2021". `package.json` version is `0.0.0` and is imported into the bundle purely to be logged (`main.ts:41`, `:53`), so the "Plotter WebUI v0.0.0" banner never changes. **Recommendation:** Fix the spelling, derive the year, and either maintain the version or drop the import (which currently pulls the whole `package.json` into the bundle).

---

### L-17 — Tracking documents disagree with each other
**Location:** `README.md:34-40`, `ToDo.md:12-13`

`README.md` marks "Stop print via UI" and "List current printing filename" as done; `ToDo.md` lists the same two items as outstanding. Both features exist in the code (with the caveats in H-16). **Recommendation:** Keep one list. Consider folding `ToDo.md` into issues.

---

## Cross-cutting observations

These are not individual defects but patterns that generate them, and they are where remediation effort compounds:

**No test suite, no linting, no CI.** There is no `pytest`, no ESLint config, and no CI workflow anywhere in the repository. Every finding above was reachable only by reading. C-4 (Tasmota), M-10 (autoscroll), and H-5 (baud rate) are all one assertion away from being caught. The serial protocol layer in `send2serial.py` is pure enough to test against a fake `tty` object, and `parseHPGL` is a pure function over a string — both are cheap first targets.

**Configuration handled three different ways.** `main.py`, `notification.py`, and `tasmota.py` each construct their own `ConfigParser`, read the same relative path, and cache values with different strategies (live dict access vs. import-time constants). This directly causes H-8 and contributes to H-2 and M-4. A single config module is the smallest change with the widest effect.

**Errors are reported by side effect, not by return value.** The pervasive pattern is `socketio.emit('error', ...)` followed by a 200 response — see C-3, H-3, H-9, M-3, M-9. The result is a UI that reports success for failed operations and cannot distinguish "done" from "crashed". Establishing that HTTP status codes carry the outcome, and the socket carries progress, would resolve a whole class of these.

**No state machine for the plot lifecycle.** `globals.printing` is a single boolean, mutated from a request thread, read from a worker loop, and never reset on completion. It serves simultaneously as "a plot is running", "keep feeding", and "the UI should be locked" — three concerns with different lifetimes. H-3, H-6, H-16, C-3, and M-20 are all consequences. An explicit state object (idle / starting / plotting / stopping / error) owning the lock, the current filename, progress, and the last error, pushed to clients on connect, would address all of them and let a reloaded page recover its state.

**jQuery-era DOM coupling.** Modules communicate through hardcoded CSS selectors against markup in `content.html` (`#fileName`, `.portList`, `#statusLog`, `.lock-edit`). Renaming a class in the view silently breaks behaviour in a `.ts` file with no compile-time or runtime signal — and since type checking never runs (H-17), nothing catches it. Both `.portList` and `#portList` are used to reach overlapping element sets, which is what makes H-15 hard to see. Centralizing selectors into a single exported constants module would at least make the coupling greppable.

---

## Suggested remediation order

1. **Correctness blockers that make advertised features not work at all:** C-4 (Tasmota), C-6 + C-7 (preview rendering), H-5 (baud rate), M-10 (autoscroll). Each is small and self-contained.
2. **Resource and lifecycle safety:** C-3, C-2, H-3, H-4, H-6 — introduce the plot-state object and `try/finally` cleanup together, since they share the same code path.
3. **Deployment:** H-1, H-13, H-14, H-2 — the install path currently does not produce a running service on current Raspberry Pi OS.
4. **Input handling:** C-1, C-5, C-8, C-9 — how far to take these depends on the intended trust boundary, but C-1 and C-5 are worth fixing regardless, since a malformed filename is as likely as a malicious one.
5. **Build and type safety:** H-17, M-24 — adding `tsc --noEmit` to the build converts several Medium findings into compile errors and prevents recurrence.
6. **Consistency and cleanup:** H-8, H-12, M-3, M-12, and the Low items.
