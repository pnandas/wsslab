FROM docker.io/library/python:3.11-slim

WORKDIR /app

RUN pip install --no-cache-dir fastapi uvicorn PyJWT

COPY idp.py .

EXPOSE 5002

CMD ["uvicorn", "idp:app", "--host", "0.0.0.0", "--port", "5002"]
