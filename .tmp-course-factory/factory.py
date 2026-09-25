#!/usr/bin/env python3
"""Ordria course factory - creates the 28-course AI academy on learn.ordria.fr.

Security: every outbound request goes through safe_open(), which enforces
http/https only, an exact host allowlist, and rejects loopback / private /
reserved / link-local resolved addresses (SSRF guard).

Reads PEXELS_API_KEY from the environment (never stored in code).
State file makes reruns idempotent (skips already-created courses).

Usage: uv run --project apps/api python factory.py [catalog_slug ...]
"""
from __future__ import annotations

import ipaddress
import json
import os
import socket
import sys
import time
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

BASE = "https://learn.ordria.fr/api/v1"
ORG_ID = 1
STATE_PATH = Path(__file__).parent / "state.json"
PEXELS = os.environ.get("PEXELS_API_KEY")

EM_DASH = "\u2014"

# SSRF guard: the factory may only talk to these hosts over https.
ALLOWED_HOSTS = {
    "learn.ordria.fr",
    "api.pexels.com",
    "images.pexels.com",
    "www.pexels.com",
}


def _assert_safe_url(url: str):
    u = urllib.parse.urlsplit(url)
    if u.scheme not in ("http", "https"):
        raise ValueError(f"scheme non autorisé: {u.scheme}")
    host = u.hostname or ""
    if host not in ALLOWED_HOSTS:
        raise ValueError(f"hôte non autorisé: {host}")
    for family in (socket.AF_INET, socket.AF_INET6):
        try:
            infos = socket.getaddrinfo(host, 443, family)
        except socket.gaierror:
            continue
        for info in infos:
            ip = ipaddress.ip_address(info[4][0])
            if (ip.is_private or ip.is_loopback or ip.is_reserved
                    or ip.is_link_local or ip.is_multicast or ip.is_unspecified):
                raise ValueError(f"adresse IP interdite pour {host}: {ip}")


def safe_open(url: str, headers: dict | None = None, data: bytes | None = None,
              method: str = "GET", timeout: int = 60):
    _assert_safe_url(url)
    hdrs = {
        # Cloudflare blocks the bare Python-urllib signature (error 1010)
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 "
                      "Safari/537.36 ordria-factory/1.0",
    }
    hdrs.update(headers or {})
    req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
    return urllib.request.urlopen(req, timeout=timeout)


def no_dash(s: str) -> str:
    """House style: no em dash anywhere in generated content."""
    return (s or "").replace(EM_DASH, "-")


class Api:
    def __init__(self, token: str):
        self.token = token

    def _req(self, method: str, path: str, *, json_body=None, form: dict = None,
             files: dict = None, query: dict = None):
        url = BASE + path
        if query:
            url += "?" + urllib.parse.urlencode(query)
        headers = {"Authorization": f"Bearer {self.token}"}
        data = None
        if form is not None or files is not None:
            boundary = "----ordria" + uuid.uuid4().hex
            body = []
            for k, v in (form or {}).items():
                body.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode())
            for k, (fname, blob, ctype) in (files or {}).items():
                body.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"; filename=\"{fname}\"\r\nContent-Type: {ctype}\r\n\r\n".encode() + blob + b"\r\n")
            body.append(f"--{boundary}--\r\n".encode())
            data = b"".join(body)
            headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
        elif json_body is not None:
            data = json.dumps(json_body).encode()
            headers["Content-Type"] = "application/json"
        with safe_open(url, headers=headers, data=data, method=method) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else {}

    def get(self, path, **kw):
        return self._req("GET", path, **kw)

    def post(self, path, **kw):
        return self._req("POST", path, **kw)

    def put(self, path, **kw):
        return self._req("PUT", path, **kw)


def login() -> str:
    body = urllib.parse.urlencode({
        "username": os.environ["ORDRIA_ADMIN_EMAIL"],
        "password": os.environ["ORDRIA_ADMIN_PASSWORD"],
    }).encode()
    with safe_open(BASE + "/auth/login",
                   headers={"Content-Type": "application/x-www-form-urlencoded"},
                   data=body, method="POST", timeout=30) as resp:
        return json.load(resp)["tokens"]["access_token"]


# ── Pexels ────────────────────────────────────────────────────────────────────

_pexels_cache: dict[str, list] = {}


def pexels_search(query: str, per_page: int = 15) -> list:
    if query in _pexels_cache:
        return _pexels_cache[query]
    url = ("https://api.pexels.com/v1/search?query=" + urllib.parse.quote(query)
           + f"&per_page={per_page}&orientation=landscape&size=large&locale=fr-FR")
    req_headers = {"Authorization": PEXELS}
    with safe_open(url, headers=req_headers, timeout=30) as resp:
        photos = json.load(resp).get("photos", [])
    _pexels_cache[query] = photos
    time.sleep(0.35)  # Pexels rate-limit courtesy
    return photos


def pick_image(query: str, used: set, index: int = 0):
    photos = pexels_search(query)
    fresh = [p for p in photos if p["id"] not in used]
    if not fresh:
        fresh = photos
    p = fresh[index % len(fresh)]
    used.add(p["id"])
    return {
        "url": p["src"]["large2x"],
        "name": p["photographer"],
        "page": p["url"],
    }


def download(url: str) -> tuple[bytes, str]:
    with safe_open(url, headers={"User-Agent": "ordria-factory/1.0"}) as resp:
        return resp.read(), resp.headers.get("Content-Type", "image/jpeg")


# ── Tiptap doc builders ───────────────────────────────────────────────────────

def t(text: str) -> dict:
    return {"type": "text", "text": no_dash(text)}


def para(*parts) -> dict:
    text = " ".join(str(p) for p in parts)
    return {"type": "paragraph", "content": [t(text)]}


def heading(level: int, text: str) -> dict:
    return {"type": "heading", "attrs": {"level": level}, "content": [t(text)]}


def bullets(items: list[str]) -> dict:
    return {"type": "bulletList", "content": [
        {"type": "listItem", "content": [para(i)]} for i in items
    ]}


def ordered(items: list[str]) -> dict:
    return {"type": "orderedList", "content": [
        {"type": "listItem", "content": [para(i)]} for i in items
    ]}


def callout_info(text: str) -> dict:
    return {"type": "calloutInfo", "content": [t(text)]}


def callout_warning(text: str) -> dict:
    return {"type": "calloutWarning", "content": [t(text)]}


def image(img: dict, width: int = 700) -> dict:
    return {"type": "blockImage", "attrs": {
        "blockObject": None,
        "size": {"width": width},
        "alignment": "center",
        "unsplash_url": img["url"],
        "unsplash_photographer_name": img.get("name", ""),
        "unsplash_photographer_url": img.get("page", ""),
        "unsplash_photo_url": img.get("page", ""),
    }}


def quiz_node(questions: list[dict]) -> dict:
    qs = []
    for q in questions:
        answers = [{"answer_id": f"answer_{uuid.uuid4()}", "answer": no_dash(a["a"]), "correct": bool(a["c"])}
                   for a in q["answers"]]
        qs.append({"question_id": f"question_{uuid.uuid4()}", "question": no_dash(q["q"]),
                   "type": "multiple_choice", "answers": answers})
    return {"type": "blockQuiz", "attrs": {"quizId": f"quiz_{uuid.uuid4()}", "questions": qs}}


def doc(*blocks) -> dict:
    return {"type": "doc", "content": [b for b in blocks if b]}


# ── Creation engine ───────────────────────────────────────────────────────────

def load_state() -> dict:
    if STATE_PATH.exists():
        return json.loads(STATE_PATH.read_text())
    return {"courses": {}}


def save_state(st: dict):
    STATE_PATH.write_text(json.dumps(st, indent=1, ensure_ascii=False))


def create_course(api: Api, c: dict, st: dict) -> str | None:
    if c["slug"] in st["courses"]:
        print(f"  = déjà créé, ignoré : {c['title']}")
        return None
    used: set = set()
    cover = pick_image(c["cover_query"], used)
    blob, ctype = download(cover["url"])
    ext = "jpeg" if "jpeg" in ctype else "png"
    course = api.post("/courses/", query={"org_id": ORG_ID},
                      form={"name": no_dash(c["title"]),
                            "description": no_dash(c["description"]),
                            "public": "true",
                            "learnings": no_dash(c["learnings"]),
                            "tags": no_dash(c["tags"]),
                            "about": no_dash(c["description"])},
                      files={"thumbnail": (f"cover.{ext}", blob, ctype)})
    course_uuid = course.get("course_uuid", "")
    cid = course.get("id")
    print(f"  + cours créé id={cid} uuid={course_uuid}")
    st["courses"][c["slug"]] = {"uuid": course_uuid, "id": cid, "chapters": []}

    for ch in c["chapters"]:
        chap = api.post("/chapters/", json_body={
            "name": no_dash(ch["title"]), "description": no_dash(ch.get("description", "")),
            "thumbnail_image": "", "course_id": cid, "org_id": ORG_ID,
        })
        chid = chap.get("id")
        print(f"    + chapitre « {ch['title']} » id={chid}")
        st["courses"][c["slug"]]["chapters"].append({"id": chid, "title": ch["title"], "activities": []})

        for act in ch["activities"]:
            img = pick_image(act["image_query"], used) if act.get("image_query") else None
            created = api.post("/activities/", query={"coursechapter_id": chid, "org_id": ORG_ID},
                               json_body={"name": no_dash(act["title"]), "chapter_id": chid,
                                          "activity_type": "TYPE_DYNAMIC",
                                          "activity_sub_type": "SUBTYPE_DYNAMIC_PAGE",
                                          "content": {}, "published_version": 1, "version": 1,
                                          "course_id": cid})
            auuid = created.get("activity_uuid")
            content = act["build"](img)
            api.put(f"/activities/{auuid}", json_body={"content": content, "published": True})
            print(f"      + activité « {act['title']} » ({len(json.dumps(content))} octets)")
            st["courses"][c["slug"]]["chapters"][-1]["activities"].append(
                {"uuid": auuid, "title": act["title"]})
            save_state(st)
            time.sleep(0.25)

    api.put(f"/courses/{course_uuid}", json_body={"published": True, "public": True})
    st["courses"][c["slug"]]["published"] = True
    save_state(st)
    print(f"  ★ publié : {c['title']}")
    return course_uuid


def run(catalogs: list[str]):
    st = load_state()
    api = Api(login())
    from importlib import import_module
    all_courses = []
    for mod_name in catalogs:
        mod = import_module(mod_name)
        all_courses.extend(mod.COURSES)
    print(f"{len(all_courses)} cours à créer dans l'org {ORG_ID}")
    for c in all_courses:
        print(f"── {c['slug']}")
        try:
            create_course(api, c, st)
        except Exception as e:
            print(f"  !! ERREUR sur {c['slug']}: {e}")
            save_state(st)
    done = sum(1 for v in st["courses"].values() if v.get("published"))
    print(f"\nTerminé : {done}/{len(all_courses)} cours publiés (état dans {STATE_PATH})")


if __name__ == "__main__":
    mods = sys.argv[1:] or ["catalog_a", "catalog_b", "catalog_c", "catalog_d"]
    run(mods)
