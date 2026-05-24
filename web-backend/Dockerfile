FROM docker.io/library/python:3.11-slim

WORKDIR /app

RUN pip install --no-cache-dir fastapi uvicorn redis requests pydantic

COPY backend.py .

EXPOSE 5000

CMD ["uvicorn", "backend:app", "--host", "0.0.0.0", "--port", "5000"]
