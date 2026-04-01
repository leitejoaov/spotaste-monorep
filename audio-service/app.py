import os
import uuid
import glob
import math
import numpy as np
from flask import Flask, request, jsonify
import yt_dlp
import essentia.standard as es

app = Flask(__name__)

MODELS_DIR = "/app/models"

# Pre-load TF models on startup for faster inference
EMBEDDING_MODEL = None
CLASSIFICATION_MODELS = {}

MOOD_HEADS = [
    "mood_happy",
    "mood_sad",
    "mood_aggressive",
    "mood_relaxed",
    "mood_party",
    "voice_instrumental",
    "mood_acoustic",
    "danceability",
]


def load_models():
    global EMBEDDING_MODEL, CLASSIFICATION_MODELS

    embedding_path = os.path.join(MODELS_DIR, "msd-musicnn-1.pb")
    if not os.path.exists(embedding_path):
        app.logger.warning("MusiCNN embedding model not found, TF features disabled")
        return

    EMBEDDING_MODEL = es.TensorflowPredictMusiCNN(
        graphFilename=embedding_path, output="model/dense/BiasAdd"
    )

    for head in MOOD_HEADS:
        path = os.path.join(MODELS_DIR, f"{head}-msd-musicnn-1.pb")
        if os.path.exists(path):
            CLASSIFICATION_MODELS[head] = es.TensorflowPredict2D(
                graphFilename=path, output="model/Softmax"
            )
            app.logger.info(f"  loaded {head}")
        else:
            app.logger.warning(f"  model not found: {path}")

    app.logger.info(f"Loaded {len(CLASSIFICATION_MODELS)} classification models")


def download_audio(track: str, artist: str) -> str:
    query = f"{track} {artist} official audio"
    output_path = f"/tmp/{uuid.uuid4()}"

    ydl_opts = {
        "format": "bestaudio/best",
        "outtmpl": output_path + ".%(ext)s",
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "match_filter": yt_dlp.utils.match_filter_func("duration < 600"),
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
            }
        ],
        "default_search": "ytsearch1",
        "socket_timeout": 60,
    }

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(query, download=True)
        if info is None:
            raise FileNotFoundError("No results found on YouTube")

    mp3_path = output_path + ".mp3"
    if not os.path.exists(mp3_path):
        matches = glob.glob(output_path + ".*")
        if matches:
            return matches[0]
        raise FileNotFoundError("Downloaded file not found")

    return mp3_path


def analyze_audio(file_path: str) -> dict:
    # Load at 44100 for standard analysis
    audio_44k = es.MonoLoader(filename=file_path, sampleRate=44100)()

    # BPM
    rhythm_extractor = es.RhythmExtractor2013(method="multifeature")
    bpm, _, _, _, _ = rhythm_extractor(audio_44k)

    # Key
    key_extractor = es.KeyExtractor()
    key, scale, key_strength = key_extractor(audio_44k)

    # Loudness
    loudness_extractor = es.Loudness()
    loudness = loudness_extractor(audio_44k)
    loudness_db = 20 * math.log10(loudness + 1e-10)

    # Energy
    energy_extractor = es.Energy()
    energy = energy_extractor(audio_44k)
    energy_normalized = min(1.0, energy / (len(audio_44k) * 0.1 + 1e-10))

    # Danceability (algorithmic)
    danceability_extractor = es.Danceability()
    danceability_algo, _ = danceability_extractor(audio_44k)

    result = {
        "bpm": round(float(bpm), 1),
        "key": key,
        "mode": scale,
        "energy": round(float(energy_normalized), 2),
        "danceability": round(float(danceability_algo), 2),
        "loudness": round(float(loudness_db), 1),
        "source": "essentia",
    }

    # TF-based mood/classification features
    if EMBEDDING_MODEL and CLASSIFICATION_MODELS:
        try:
            audio_16k = es.MonoLoader(filename=file_path, sampleRate=16000)()
            embeddings = EMBEDDING_MODEL(audio_16k)

            for head_name, model in CLASSIFICATION_MODELS.items():
                predictions = model(embeddings)
                # predictions shape: (frames, 2) — column 1 is positive class
                score = float(np.mean(predictions[:, 1]))
                result[head_name] = round(score, 3)

                # Use TF danceability if available (overrides algorithmic)
                if head_name == "danceability":
                    result["danceability"] = round(score, 2)
        except Exception as e:
            app.logger.error(f"TF analysis failed (basic features still returned): {e}")

    return result


@app.route("/analyze", methods=["POST"])
def analyze():
    data = request.get_json()
    if not data or "track" not in data or "artist" not in data:
        return jsonify({"error": "Missing 'track' and 'artist' in request body"}), 400

    track = data["track"]
    artist = data["artist"]
    file_path = None

    try:
        file_path = download_audio(track, artist)
        features = analyze_audio(file_path)
        return jsonify(features)

    except FileNotFoundError as e:
        return jsonify({"error": str(e)}), 404

    except Exception as e:
        app.logger.error(f"Analysis failed: {e}")
        return jsonify({"error": f"Analysis failed: {str(e)}"}), 500

    finally:
        if file_path and os.path.exists(file_path):
            os.remove(file_path)


@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "tf_models_loaded": len(CLASSIFICATION_MODELS),
    })


if __name__ == "__main__":
    with app.app_context():
        load_models()
    app.run(host="0.0.0.0", port=5001)
