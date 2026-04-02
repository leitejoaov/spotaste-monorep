import os
import base64
import json
import requests as http_requests
from flask import Flask, request, jsonify
from ytmusicapi import YTMusic

app = Flask(__name__)

# Google OAuth2 endpoints
DEVICE_CODE_URL = "https://oauth2.googleapis.com/device/code"
TOKEN_URL = "https://oauth2.googleapis.com/token"
YOUTUBE_MUSIC_SCOPE = "https://www.googleapis.com/auth/youtube"

# YouTube Data API v3 base
YT_API = "https://www.googleapis.com/youtube/v3"

# Client credentials (Google Cloud Console -> TV device type)
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "")


def get_token_data(req):
    """Decode and refresh the OAuth token from X-Token header."""
    token_b64 = req.headers.get("X-Token")
    if not token_b64:
        return None
    token_data = json.loads(base64.b64decode(token_b64).decode("utf-8"))
    return refresh_token_if_needed(token_data)


def get_access_token(req):
    """Get a valid access token string from the request."""
    token_data = get_token_data(req)
    if not token_data:
        return None
    return token_data.get("access_token")


def refresh_token_if_needed(token_data):
    """Refresh the access token using server-side credentials only."""
    refresh_tok = token_data.get("refresh_token")
    if not refresh_tok or not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
        return token_data
    try:
        resp = http_requests.post(TOKEN_URL, data={
            "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "refresh_token": refresh_tok,
            "grant_type": "refresh_token",
        }, timeout=15)
        if resp.status_code == 200:
            new_data = resp.json()
            token_data["access_token"] = new_data.get("access_token", token_data["access_token"])
            token_data["expires_in"] = new_data.get("expires_in", 3600)
        else:
            app.logger.warning(f"Token refresh failed: {resp.status_code}")
    except Exception as e:
        app.logger.warning(f"Token refresh error: {e}")
    return token_data


def yt_api_get(access_token, endpoint, params=None):
    """Make an authenticated GET to YouTube Data API v3."""
    resp = http_requests.get(
        f"{YT_API}/{endpoint}",
        headers={"Authorization": f"Bearer {access_token}"},
        params=params or {},
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()


def yt_api_post(access_token, endpoint, body, params=None):
    """Make an authenticated POST to YouTube Data API v3."""
    resp = http_requests.post(
        f"{YT_API}/{endpoint}",
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        },
        json=body,
        params=params or {},
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()


def require_token(req):
    """Return (access_token, error_response)."""
    token = get_access_token(req)
    if not token:
        return None, (jsonify({"error": "Missing or invalid X-Token header"}), 401)
    return token, None


def format_playlist_item(item):
    """Format a YouTube Data API playlistItem into our track format."""
    snippet = item.get("snippet", {})
    thumbnails = snippet.get("thumbnails", {})
    thumb = (thumbnails.get("high") or thumbnails.get("medium")
             or thumbnails.get("default") or {}).get("url", "")

    video_id = snippet.get("resourceId", {}).get("videoId", "")
    title = snippet.get("title", "")
    artist = snippet.get("videoOwnerChannelTitle", "").replace(" - Topic", "")

    return {
        "videoId": video_id,
        "title": title,
        "artist": artist,
        "album": "",
        "thumbnail": thumb,
        "duration": "",
    }


def format_search_song(item):
    """Format a ytmusicapi search result."""
    artists = item.get("artists") or []
    artist_name = artists[0].get("name", "") if artists else item.get("artist", "")

    album_info = item.get("album") or {}
    album_name = album_info.get("name", "") if isinstance(album_info, dict) else str(album_info)

    thumbnails = item.get("thumbnails") or []
    thumbnail = thumbnails[-1].get("url", "") if thumbnails else ""

    return {
        "videoId": item.get("videoId", ""),
        "title": item.get("title", ""),
        "artist": artist_name,
        "album": album_name,
        "thumbnail": thumbnail,
        "duration": item.get("duration", ""),
    }


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


# ---------------------------------------------------------------------------
# Auth endpoints (device code flow — unchanged)
# ---------------------------------------------------------------------------

@app.route("/auth/setup", methods=["GET"])
def auth_setup():
    """Initiate Google OAuth TV device flow."""
    if not GOOGLE_CLIENT_ID:
        return jsonify({"error": "GOOGLE_CLIENT_ID not configured"}), 500
    try:
        resp = http_requests.post(DEVICE_CODE_URL, data={
            "client_id": GOOGLE_CLIENT_ID,
            "scope": YOUTUBE_MUSIC_SCOPE,
        }, timeout=15)
        if resp.status_code != 200:
            return jsonify({"error": f"Google device code request failed: {resp.text}"}), 502
        data = resp.json()
        return jsonify({
            "verification_url": data.get("verification_url", ""),
            "user_code": data.get("user_code", ""),
            "device_code": data.get("device_code", ""),
            "interval": data.get("interval", 5),
        })
    except Exception as e:
        return jsonify({"error": f"Failed to initiate OAuth flow: {str(e)}"}), 500


@app.route("/auth/token", methods=["POST"])
def auth_token():
    """Poll Google's token endpoint for device code authorization."""
    body = request.get_json() or {}
    device_code = body.get("device_code")
    if not device_code:
        return jsonify({"error": "Missing device_code"}), 400
    if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
        return jsonify({"error": "OAuth credentials not configured"}), 500

    try:
        resp = http_requests.post(TOKEN_URL, data={
            "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "device_code": device_code,
            "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
        }, timeout=15)
        data = resp.json()

        if resp.status_code == 200:
            token = {
                "access_token": data.get("access_token", ""),
                "refresh_token": data.get("refresh_token", ""),
                "token_type": data.get("token_type", "Bearer"),
                "expires_in": data.get("expires_in", 3600),
                "scope": data.get("scope", YOUTUBE_MUSIC_SCOPE),
            }

            # Get channel ID via YouTube Data API v3
            channel_id = ""
            try:
                ch_data = yt_api_get(token["access_token"], "channels", {
                    "part": "snippet",
                    "mine": "true",
                })
                items = ch_data.get("items", [])
                if items:
                    channel_id = items[0].get("id", "")
            except Exception:
                pass

            return jsonify({"token": token, "channel_id": channel_id})

        error_code = data.get("error", "")
        if error_code == "authorization_pending":
            return jsonify({"pending": True})
        elif error_code == "slow_down":
            return jsonify({"pending": True, "slow_down": True})
        elif error_code == "expired_token":
            return jsonify({"error": "Device code expired. Please restart the flow."}), 410
        elif error_code == "access_denied":
            return jsonify({"error": "User denied access"}), 403
        else:
            return jsonify({"error": data.get("error_description", error_code)}), 400

    except Exception as e:
        return jsonify({"error": f"Token request failed: {str(e)}"}), 500


@app.route("/auth/refresh", methods=["POST"])
def auth_refresh():
    """Refresh an OAuth token."""
    body = request.get_json() or {}
    token = body.get("token")
    if not token or not token.get("refresh_token"):
        return jsonify({"error": "Missing token or refresh_token"}), 400
    try:
        resp = http_requests.post(TOKEN_URL, data={
            "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "refresh_token": token["refresh_token"],
            "grant_type": "refresh_token",
        }, timeout=15)
        if resp.status_code != 200:
            return jsonify({"error": f"Token refresh failed: {resp.text}"}), 502
        data = resp.json()
        updated_token = {
            "access_token": data.get("access_token", token.get("access_token")),
            "refresh_token": token.get("refresh_token", ""),
            "expires_in": data.get("expires_in", 3600),
            "token_type": data.get("token_type", "Bearer"),
            "scope": token.get("scope", YOUTUBE_MUSIC_SCOPE),
        }
        return jsonify({"token": updated_token})
    except Exception as e:
        return jsonify({"error": f"Token refresh failed: {str(e)}"}), 500


# ---------------------------------------------------------------------------
# User endpoints (YouTube Data API v3)
# ---------------------------------------------------------------------------

@app.route("/user/info", methods=["GET"])
def user_info():
    """Get authenticated user's channel info via YouTube Data API v3."""
    token, err = require_token(request)
    if err:
        return err
    try:
        data = yt_api_get(token, "channels", {"part": "snippet", "mine": "true"})
        items = data.get("items", [])
        if not items:
            return jsonify({"channelId": "unknown", "name": "YouTube User"})
        ch = items[0]
        return jsonify({
            "channelId": ch.get("id", ""),
            "name": ch.get("snippet", {}).get("title", ""),
        })
    except Exception as e:
        return jsonify({"error": f"Failed to get user info: {str(e)}"}), 500


@app.route("/user/liked-songs", methods=["GET"])
def user_liked_songs():
    """Get user's liked music via YouTube Data API v3 (playlist 'LM')."""
    token, err = require_token(request)
    if err:
        return err
    try:
        limit = int(request.args.get("limit", 200))
        tracks = []
        page_token = None

        while len(tracks) < limit:
            params = {
                "part": "snippet",
                "playlistId": "LM",
                "maxResults": min(50, limit - len(tracks)),
            }
            if page_token:
                params["pageToken"] = page_token

            data = yt_api_get(token, "playlistItems", params)
            items = data.get("items", [])
            if not items:
                break

            for item in items:
                tracks.append(format_playlist_item(item))

            page_token = data.get("nextPageToken")
            if not page_token:
                break

        return jsonify(tracks)
    except Exception as e:
        error_msg = str(e)
        # LM playlist might not exist for all users
        if "404" in error_msg or "playlistNotFound" in error_msg:
            return jsonify([])
        return jsonify({"error": f"Failed to get liked songs: {error_msg}"}), 500


@app.route("/user/history", methods=["GET"])
def user_history():
    """Get user's watch history. YouTube Data API doesn't expose this directly,
    so we return an empty list — liked songs are used for top tracks instead."""
    return jsonify([])


# ---------------------------------------------------------------------------
# Search (ytmusicapi unauthenticated — still works)
# ---------------------------------------------------------------------------

@app.route("/search", methods=["GET"])
def search():
    """Search YouTube Music for songs (unauthenticated via ytmusicapi)."""
    query = request.args.get("q", "").strip()
    if not query:
        return jsonify({"error": "Missing query parameter 'q'"}), 400

    limit = int(request.args.get("limit", 20))

    try:
        yt = YTMusic()
        results = yt.search(query, filter="songs", limit=limit)
        return jsonify([format_search_song(r) for r in results])
    except Exception as e:
        return jsonify({"error": f"Search failed: {str(e)}"}), 500


# ---------------------------------------------------------------------------
# Artist (ytmusicapi unauthenticated)
# ---------------------------------------------------------------------------

@app.route("/artist/<channel_id>", methods=["GET"])
def artist(channel_id):
    """Get artist info and top songs (unauthenticated via ytmusicapi)."""
    try:
        yt = YTMusic()
        artist_data = yt.get_artist(channel_id)

        thumbnails = artist_data.get("thumbnails") or []
        thumbnail = thumbnails[-1].get("url", "") if thumbnails else ""

        top_songs = []
        songs_data = artist_data.get("songs", {})
        if isinstance(songs_data, dict):
            songs_list = songs_data.get("results", [])
        elif isinstance(songs_data, list):
            songs_list = songs_data
        else:
            songs_list = []

        for song in songs_list[:10]:
            album_info = song.get("album") or {}
            album_name = album_info.get("name", "") if isinstance(album_info, dict) else str(album_info)
            top_songs.append({
                "videoId": song.get("videoId", ""),
                "title": song.get("title", ""),
                "album": album_name,
                "plays": song.get("views", ""),
            })

        return jsonify({
            "name": artist_data.get("name", ""),
            "description": artist_data.get("description", ""),
            "thumbnail": thumbnail,
            "subscribers": artist_data.get("subscribers", ""),
            "topSongs": top_songs,
        })
    except Exception as e:
        return jsonify({"error": f"Failed to get artist: {str(e)}"}), 500


# ---------------------------------------------------------------------------
# Playlist (YouTube Data API v3)
# ---------------------------------------------------------------------------

@app.route("/playlist/create", methods=["POST"])
def playlist_create():
    """Create a new playlist via YouTube Data API v3."""
    token, err = require_token(request)
    if err:
        return err

    body = request.get_json() or {}
    title = body.get("title", "").strip()
    if not title:
        return jsonify({"error": "Missing title"}), 400

    description = body.get("description", "")

    try:
        data = yt_api_post(token, "playlists", {
            "snippet": {
                "title": title,
                "description": description,
            },
            "status": {
                "privacyStatus": "private",
            },
        }, params={"part": "snippet,status"})
        return jsonify({"playlistId": data.get("id", "")})
    except Exception as e:
        return jsonify({"error": f"Failed to create playlist: {str(e)}"}), 500


@app.route("/playlist/<playlist_id>/add", methods=["POST"])
def playlist_add(playlist_id):
    """Add tracks to a playlist via YouTube Data API v3."""
    token, err = require_token(request)
    if err:
        return err

    body = request.get_json() or {}
    video_ids = body.get("videoIds", [])
    if not video_ids:
        return jsonify({"error": "Missing videoIds"}), 400

    added = 0
    try:
        for vid in video_ids:
            yt_api_post(token, "playlistItems", {
                "snippet": {
                    "playlistId": playlist_id,
                    "resourceId": {
                        "kind": "youtube#video",
                        "videoId": vid,
                    },
                },
            }, params={"part": "snippet"})
            added += 1
        return jsonify({"status": "STATUS_SUCCEEDED", "added": added})
    except Exception as e:
        return jsonify({"error": f"Failed to add tracks (added {added}): {str(e)}"}), 500


# ---------------------------------------------------------------------------
# CORS
# ---------------------------------------------------------------------------

@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "http://127.0.0.1:3000"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, X-Token"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return response


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5002, debug=True)
