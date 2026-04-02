FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

EXPOSE 5002

CMD ["gunicorn", "--workers", "2", "--bind", "0.0.0.0:5002", "--log-level", "debug", "--capture-output", "--enable-stdio-inheritance", "app:app"]
