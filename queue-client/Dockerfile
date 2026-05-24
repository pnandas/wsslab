FROM docker.io/library/python:3.11-slim

WORKDIR /app

RUN pip install --no-cache-dir pika redis

COPY client.py .

CMD ["python", "client.py"]
