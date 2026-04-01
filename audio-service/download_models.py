"""Download Essentia TensorFlow models at build time."""
import os
import urllib.request

MODELS_DIR = "/app/models"
BASE = "https://essentia.upf.edu/models"

MODELS = {
    # Embedding extractor
    "msd-musicnn-1.pb": f"{BASE}/feature-extractors/musicnn/msd-musicnn-1.pb",
    # Classification heads
    "mood_happy-msd-musicnn-1.pb": f"{BASE}/classification-heads/mood_happy/mood_happy-msd-musicnn-1.pb",
    "mood_sad-msd-musicnn-1.pb": f"{BASE}/classification-heads/mood_sad/mood_sad-msd-musicnn-1.pb",
    "mood_aggressive-msd-musicnn-1.pb": f"{BASE}/classification-heads/mood_aggressive/mood_aggressive-msd-musicnn-1.pb",
    "mood_relaxed-msd-musicnn-1.pb": f"{BASE}/classification-heads/mood_relaxed/mood_relaxed-msd-musicnn-1.pb",
    "mood_party-msd-musicnn-1.pb": f"{BASE}/classification-heads/mood_party/mood_party-msd-musicnn-1.pb",
    "voice_instrumental-msd-musicnn-1.pb": f"{BASE}/classification-heads/voice_instrumental/voice_instrumental-msd-musicnn-1.pb",
    "mood_acoustic-msd-musicnn-1.pb": f"{BASE}/classification-heads/mood_acoustic/mood_acoustic-msd-musicnn-1.pb",
    "danceability-msd-musicnn-1.pb": f"{BASE}/classification-heads/danceability/danceability-msd-musicnn-1.pb",
}

os.makedirs(MODELS_DIR, exist_ok=True)

for name, url in MODELS.items():
    path = os.path.join(MODELS_DIR, name)
    if os.path.exists(path):
        print(f"  skip {name}")
        continue
    print(f"  downloading {name}...")
    urllib.request.urlretrieve(url, path)

print(f"All {len(MODELS)} models ready in {MODELS_DIR}")
