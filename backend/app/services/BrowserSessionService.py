
"""Local Selenium browser sessions backed by encrypted MySQL snapshots."""
from __future__ import annotations

import json
import os
import shutil
import tempfile
import threading
import time
import uuid

from dataclasses import dataclass
from urllib.parse import urlsplit

from fastapi import HTTPException
from app.core.Config import settings

SITES = {
    "tiktok": (
        "https://www.tiktok.com/login",
        ("tiktok.com",),
    ),
    "instagram": (
        "https://www.instagram.com/accounts/login/",
        ("instagram.com",),
    ),
    "youtube": (
        "https://accounts.google.com/",
        (
            "youtube.com",
            "google.com",
            "googleusercontent.com",
        ),
    ),
}

MAX_SNAPSHOT_BYTES = 1_000_000
LIFETIME_SECONDS = 30 * 60


def _allowed_domain(
    domain: str,
    roots: tuple[str, ...],
) -> bool:
    name = domain.lower().lstrip(".")

    return any(
        name == root or name.endswith("." + root)
        for root in roots
    )


def _desktop_only() -> None:
    if settings().production or not (
        os.name == "nt" or os.getenv("DISPLAY")
    ):
        raise HTTPException(
            409,
            "Interactive Selenium requires a trusted "
            "local desktop backend (not Docker/headless).",
        )

    origin = urlsplit(settings().frontend_origin)

    if origin.hostname not in (
        "localhost",
        "127.0.0.1",
    ):
        raise HTTPException(
            409,
            "Browser login is restricted to localhost "
            "in this version.",
        )


@dataclass
class _Live:
    owner_id: int
    provider: str
    name: str
    driver: object
    profile_path: str
    started: float
    credential_id: int | None = None


class BrowserSessionService:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._live: dict[str, _Live] = {}

    def _get(
        self,
        user_id: int,
        capture_id: str,
    ) -> _Live:
        with self._lock:
            session = self._live.get(capture_id)

        if session is None or session.owner_id != user_id:
            raise HTTPException(
                404,
                "Browser capture not found",
            )

        if (
            time.monotonic() - session.started
            > LIFETIME_SECONDS
        ):
            self.close(user_id, capture_id)
            raise HTTPException(
                410,
                "Browser session expired; start again",
            )

        return session

    def start(
        self,
        user_id: int,
        provider: str,
        name: str,
        credential_id: int | None = None,
        snapshot: dict | None = None,
    ) -> dict:
        _desktop_only()

        if provider not in SITES:
            raise HTTPException(
                422,
                "Unsupported browser provider",
            )

        name = name.strip()

        if not name or len(name) > 160:
            raise HTTPException(
                422,
                "Invalid connection name",
            )

        with self._lock:
            if any(
                session.owner_id == user_id
                for session in self._live.values()
            ):
                raise HTTPException(
                    409,
                    "Close your active browser session "
                    "before opening another",
                )

            from selenium import webdriver
            from selenium.webdriver.chrome.options import Options

            path = tempfile.mkdtemp(
                prefix="cliptora_browser_"
            )

            opts = Options()

            opts.add_argument(
                f"--user-data-dir={path}"
            )
            opts.add_argument("--no-first-run")
            opts.add_argument("--disable-default-apps")

            try:
                driver = webdriver.Chrome(
                    options=opts
                )

                driver.set_page_load_timeout(35)
                driver.set_script_timeout(25)

                login_url, _ = SITES[provider]

                if snapshot is not None:
                    self._restore(
                        driver,
                        provider,
                        snapshot,
                    )
                else:
                    driver.get(login_url)

            except Exception as exc:
                try:
                    driver.quit()
                except Exception:
                    pass

                shutil.rmtree(
                    path,
                    ignore_errors=True,
                )

                raise HTTPException(
                    503,
                    "Chrome could not start or restore "
                    "the session. Verify Selenium/Chrome "
                    "on Windows.",
                ) from exc

            capture_id = uuid.uuid4().hex

            self._live[capture_id] = _Live(
                user_id,
                provider,
                name,
                driver,
                path,
                time.monotonic(),
                credential_id,
            )

        return {
            "capture_id": capture_id,
            "provider": provider,
            "name": name,
            "browser_open": True,
        }

    def capture(
        self,
        user_id: int,
        capture_id: str,
    ) -> tuple[_Live, dict]:
        session = self._get(
            user_id,
            capture_id,
        )

        driver = session.driver
        _, roots = SITES[session.provider]

        try:
            origin = urlsplit(driver.current_url)
            host = (origin.hostname or "").lower()

            if (
                origin.scheme != "https"
                or not _allowed_domain(host, roots)
            ):
                raise HTTPException(
                    409,
                    "Navigate to the supported website "
                    "and complete login before saving",
                )

            origin_url = (
                f"{origin.scheme}://{origin.netloc}"
            )

            storage = driver.execute_script("""
                const read = (s) => {
                  const out = {};
                  for (let i = 0; i < s.length; i++) {
                    const k = s.key(i);
                    if (k !== null) {
                      out[k] = s.getItem(k);
                    }
                  }
                  return out;
                };

                return {
                  localStorage: read(window.localStorage),
                  sessionStorage: read(window.sessionStorage)
                };
            """)

            cookies = driver.execute_cdp_cmd(
                "Storage.getCookies",
                {},
            ).get("cookies", [])

            allowed = []

            for cookie in cookies:
                if _allowed_domain(
                    str(cookie.get("domain", "")),
                    roots,
                ):
                    allowed.append({
                        key: cookie[key]
                        for key in (
                            "name",
                            "value",
                            "domain",
                            "path",
                            "secure",
                            "httpOnly",
                            "expires",
                            "sameSite",
                        )
                        if key in cookie
                    })

            indexed = driver.execute_async_script(
                EXPORT_INDEXED_DB
            )

            snapshot = {
                "version": 1,
                "browser": "chrome",
                "provider": session.provider,
                "origin": origin_url,
                "cookies": allowed,
                "localStorage": storage[
                    "localStorage"
                ],
                "sessionStorage": storage[
                    "sessionStorage"
                ],
                "indexedDB": indexed.get(
                    "databases",
                    [],
                ),
                "warnings": indexed.get(
                    "warnings",
                    [],
                ),
            }

            raw = json.dumps(
                snapshot,
                ensure_ascii=False,
                allow_nan=False,
            ).encode("utf-8")

            if len(raw) > MAX_SNAPSHOT_BYTES:
                raise HTTPException(
                    413,
                    "Browser session exceeds 1 MB; "
                    "cannot save this snapshot",
                )

            if (
                not allowed
                and not storage["localStorage"]
                and not indexed.get("databases")
            ):
                raise HTTPException(
                    422,
                    "No browser session data found; "
                    "finish login before saving",
                )

            return session, snapshot

        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(
                502,
                "Unable to capture browser storage",
            ) from exc

    def _restore(
        self,
        driver: object,
        provider: str,
        snapshot: dict,
    ) -> None:
        if (
            snapshot.get("version") != 1
            or snapshot.get("provider") != provider
        ):
            raise ValueError(
                "Invalid browser snapshot"
            )

        _, roots = SITES[provider]

        parsed = urlsplit(
            str(snapshot.get("origin", ""))
        )

        if (
            parsed.scheme != "https"
            or not _allowed_domain(
                parsed.hostname or "",
                roots,
            )
        ):
            raise ValueError(
                "Snapshot origin is not allowed"
            )

        origin = (
            f"{parsed.scheme}://{parsed.netloc}"
        )

        driver.get(origin)

        actual = urlsplit(
            driver.current_url
        )

        if (
            actual.scheme != parsed.scheme
            or actual.netloc.lower()
            != parsed.netloc.lower()
        ):
            raise ValueError(
                "Site redirected during restore; "
                "cannot safely restore origin storage"
            )

        cdp_cookies = []

        for cookie in snapshot.get(
            "cookies",
            [],
        ):
            if (
                not isinstance(cookie, dict)
                or not _allowed_domain(
                    str(cookie.get("domain", "")),
                    roots,
                )
            ):
                continue

            payload = {
                key: cookie[key]
                for key in (
                    "name",
                    "value",
                    "domain",
                    "path",
                    "secure",
                    "httpOnly",
                )
                if key in cookie
            }

            if (
                not isinstance(
                    payload.get("name"),
                    str,
                )
                or not isinstance(
                    payload.get("value"),
                    str,
                )
            ):
                continue

            if cookie.get("expires"):
                payload["expires"] = float(
                    cookie["expires"]
                )

            if cookie.get("sameSite") in (
                "Strict",
                "Lax",
                "None",
            ):
                payload["sameSite"] = (
                    cookie["sameSite"]
                )

            cdp_cookies.append(payload)

        for cookie in cdp_cookies:
            try:
                driver.execute_cdp_cmd(
                    "Storage.setCookies",
                    {
                        "cookies": [cookie]
                    },
                )
            except Exception:
                pass

        driver.execute_script(
            """
            for (
              const [k, v] of Object.entries(
                arguments[0] || {}
              )
            ) {
              localStorage.setItem(k, v);
            }

            for (
              const [k, v] of Object.entries(
                arguments[1] || {}
              )
            ) {
              sessionStorage.setItem(k, v);
            }
            """,
            snapshot.get(
                "localStorage",
                {},
            ),
            snapshot.get(
                "sessionStorage",
                {},
            ),
        )

        try:
            driver.execute_async_script(
                IMPORT_INDEXED_DB,
                snapshot.get(
                    "indexedDB",
                    [],
                ),
            )
        except Exception:
            pass

        driver.refresh()

    def close(
        self,
        user_id: int,
        capture_id: str,
    ) -> dict:
        session = self._get_no_expiry(
            user_id,
            capture_id,
        )

        with self._lock:
            self._live.pop(
                capture_id,
                None,
            )

        try:
            session.driver.quit()
        except Exception:
            pass
        finally:
            shutil.rmtree(
                session.profile_path,
                ignore_errors=True,
            )

        return {"closed": True}

    def _get_no_expiry(
        self,
        user_id: int,
        capture_id: str,
    ) -> _Live:
        with self._lock:
            session = self._live.get(
                capture_id
            )

        if (
            session is None
            or session.owner_id != user_id
        ):
            raise HTTPException(
                404,
                "Browser capture not found",
            )

        return session


EXPORT_INDEXED_DB = r"""
const done = arguments[arguments.length - 1];

(async () => {
  const databases = [];
  const warnings = [];

  if (!indexedDB.databases) {
    done({
      databases,
      warnings: ['IndexedDB enumeration unsupported']
    });
    return;
  }

  const entries = await indexedDB.databases();

  for (const info of entries) {
    if (!info.name) continue;

    try {
      const db = await new Promise((ok, bad) => {
        const req = indexedDB.open(info.name);
        req.onsuccess = () => ok(req.result);
        req.onerror = () => bad(req.error);
      });

      const stores = [];

      for (const name of Array.from(db.objectStoreNames)) {
        const tx = db.transaction(name, 'readonly');
        const store = tx.objectStore(name);
        const rows = [];

        await new Promise((ok, bad) => {
          const req = store.openCursor();

          req.onerror = () => bad(req.error);

          req.onsuccess = () => {
            const cursor = req.result;

            if (!cursor) {
              ok();
              return;
            }

            try {
              const key = JSON.parse(
                JSON.stringify(cursor.key)
              );

              const value = JSON.parse(
                JSON.stringify(cursor.value)
              );

              if (
                key !== undefined
                && value !== undefined
              ) {
                rows.push({
                  key,
                  value
                });
              } else {
                warnings.push(
                  'Skipped non-JSON IndexedDB value'
                );
              }
            } catch (error) {
              warnings.push(
                'Skipped non-JSON IndexedDB value'
              );
            }

            cursor.continue();
          };
        });

        stores.push({
          name,
          keyPath: store.keyPath,
          autoIncrement: store.autoIncrement,
          rows
        });
      }

      databases.push({
        name: info.name,
        version: db.version,
        stores
      });

      db.close();
    } catch (error) {
      warnings.push(
        'IndexedDB export failed: ' + info.name
      );
    }
  }

  done({
    databases,
    warnings
  });
})().catch(() => {
  done({
    databases: [],
    warnings: ['IndexedDB export failed']
  });
});
"""


IMPORT_INDEXED_DB = r"""
const entries = arguments[0] || [];
const done = arguments[arguments.length - 1];

(async () => {
  for (const entry of entries) {
    if (
      !entry.name
      || !Array.isArray(entry.stores)
    ) {
      continue;
    }

    try {
      const existing = await indexedDB.databases();

      const prior = existing.find(
        db => db.name === entry.name
      );

      const version = prior?.version
        || Math.max(1, entry.version || 1);

      const request = indexedDB.open(
        entry.name,
        version
      );

      const db = await new Promise((ok, bad) => {
        request.onupgradeneeded = () => {
          const database = request.result;

          for (const store of entry.stores) {
            if (!database.objectStoreNames.contains(
              store.name
            )) {
              database.createObjectStore(
                store.name,
                {
                  keyPath: store.keyPath ?? undefined,
                  autoIncrement: !!store.autoIncrement
                }
              );
            }
          }
        };

        request.onsuccess = () => ok(
          request.result
        );

        request.onerror = () => bad(
          request.error
        );
      });

      for (const store of entry.stores) {
        if (!db.objectStoreNames.contains(
          store.name
        )) {
          continue;
        }

        await new Promise((ok, bad) => {
          const tx = db.transaction(
            store.name,
            'readwrite'
          );

          const objectStore = tx.objectStore(
            store.name
          );

          tx.oncomplete = () => ok();
          tx.onerror = () => bad(tx.error);
          tx.onabort = () => bad(tx.error);

          for (const row of store.rows || []) {
            try {
              if (objectStore.keyPath == null) {
                objectStore.put(
                  row.value,
                  row.key
                );
              } else {
                objectStore.put(
                  row.value
                );
              }
            } catch (error) {}
          }
        });
      }

      db.close();
    } catch (error) {}
  }

  done(true);
})().catch(() => done(false));
"""


browser_sessions = BrowserSessionService()
