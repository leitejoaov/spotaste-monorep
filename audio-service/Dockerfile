FROM python:3.11-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY download_models.py .
RUN python download_models.py

COPY app.py .

EXPOSE 5001

# Analysis is CPU-bound and single-threaded, so throughput scales with worker processes.
# Each worker loads its own models (~1.3 GB RAM); a track can take well over gunicorn's default 30s timeout.
CMD ["gunicorn", "--workers", "3", "--timeout", "300", "--bind", "0.0.0.0:5001", "app:app"]
