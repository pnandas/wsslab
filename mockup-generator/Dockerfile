FROM docker.io/library/python:3.11-slim

WORKDIR /app

RUN pip install --no-cache-dir pika fastapi uvicorn

COPY generator.py .

EXPOSE 5001

CMD ["uvicorn", "generator:app", "--host", "0.0.0.0", "--port", "5001"]
